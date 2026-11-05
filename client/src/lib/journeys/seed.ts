/**
 * Sky Journeys: deterministic seeding (doc 05 §9, spec decision 5).
 *
 * The engine never calls Math.random() or Date.now(). Every random choice (shuffle noise, text variants,
 * tie-breaks not settled by id) goes through `rngFor(seedKey, ...parts)`, so the same request gives the same
 * journeys on every device, and a live-mode request inside the same 15-minute slot does not reshuffle.
 */
import type { JourneyRequest } from './types';

export const ENGINE_VERSION = 'journeys-engine-1';
export const SLOT_MS = 15 * 60_000;

/** FNV-1a over UTF-16 code units, folded to a 53-bit safe integer (two 32-bit lanes). */
export function fnv1a53(text: string): number {
  let h1 = 0x811c9dc5 ^ 0, h2 = 0x050c5d1f ^ 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 7);
  }
  return ((h2 >>> 0) & 0x1fffff) * 0x100000000 + (h1 >>> 0);
}

/** Short stable hex hash (for journey keys). */
export function hashHex(text: string): string {
  return fnv1a53(text).toString(16).padStart(14, '0');
}

/** mulberry32 PRNG: returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A PRNG derived from the seed key plus any number of parts (journey id, stop index, shuffle index…). */
export function rngFor(seedKey: string, ...parts: (string | number)[]): () => number {
  const h = fnv1a53([seedKey, ...parts].join('|'));
  return mulberry32((h % 4294967296) ^ Math.floor(h / 4294967296));
}

/** Standard Gumbel(0, 1) sample from a uniform PRNG (Gumbel-top-k shuffle, Kool et al. 2019). */
export function gumbel(rng: () => number): number {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
  return -Math.log(-Math.log(u));
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick one element deterministically. */
export function seededPick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Scores are quantised before any comparison so tiny float differences between JS engines cannot reorder results. */
export const quantize = (x: number) => Math.round(x * 1e6) / 1e6;

/** Start of the 15-minute UTC slot containing the instant (every real time-zone offset is a multiple of 15 min). */
export function slotStartMs(instantMs: number): number {
  return Math.floor(instantMs / SLOT_MS) * SLOT_MS;
}

/**
 * Local "night date": the local-mean-solar date of (instant − 12 h), so one observing night (evening to
 * morning) keeps one date. Uses longitude, not a time zone, so the engine needs no tz database.
 */
export function localNightDate(instantMs: number, lon: number): string {
  const localMs = instantMs + (lon / 15) * 3_600_000 - 12 * 3_600_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

/**
 * Seed key (spec decision 5): night, 15-minute slot, site rounded to 0.1°, binoculars, theme and the request
 * options that change the result. `shuffle` is deliberately excluded (it is applied on top of the seed).
 */
export function buildSeedKey(req: JourneyRequest, kbVersion: string, modelVersion: string): string {
  const ms = Date.parse(req.instant);
  const i = req.instrument;
  return [
    ENGINE_VERSION, kbVersion, modelVersion,
    localNightDate(ms, req.lon),
    new Date(slotStartMs(ms)).toISOString().slice(11, 16),
    req.lat.toFixed(1), req.lon.toFixed(1),
    i.fovDeg.toFixed(1), Math.round(i.aperture), Math.round(i.magnification), i.stabilized ? 'IS' : '-',
    req.skyBrightness.toFixed(1),
    req.theme ?? '*', req.length ?? '-', req.minAlt ?? '-', req.regionRadius ?? '-',
    req.level ?? '-', req.includeChallenge ?? '-', req.minutesPerStop ?? '-',
    (req.openDirections ?? []).slice().sort().join(','),
    req.seed ?? '',
  ].join('|');
}
