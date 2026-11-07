/**
 * Pure helpers for the capture screens (components/horizon/HorizonCapture.tsx): plain-words instructions, the
 * panorama strip's geometry, the sky-mask tint, the night trace's coverage, the landmark alignment and the terrain
 * match of a traced skyline.
 */
import { angleDiffDeg } from '../calibrate/quat';
import type { TapTarget } from '../calibrate/tap-targets';
import { terrainMatchFix } from '../calibrate/terrain-match';
import { chooseYaw, fixesDisagree } from '../calibrate/yaw';
import { PANORAMA_ALT_MAX, PANORAMA_ALT_MIN, type SkyGrid, type YawChoice, type YawFix } from '../photo-types';
import { compassWord } from '../profile';
import { relativeSkyline } from '../segment/grid';
import type { HorizonProfile } from '../types';

const norm = (az: number) => ((az % 360) + 360) % 360;
const fmtSigma = (s: number) => (s < 1 ? s.toFixed(1) : String(Math.round(s)));

/** "Lined up using the Sun (±0.5°)": the alignment in plain words. */
export function yawSentence(choice: YawChoice): string {
  const c = choice.chosen;
  if (c.source === 'manual' && c.sigmaDeg >= 90) return 'Not lined up with north yet. After saving, use "Line up" in Look around.';
  const what = c.source === 'manual' ? 'by hand' : `using ${c.label || 'a landmark'}`;
  return `Lined up ${what} (±${fmtSigma(c.sigmaDeg)}°)`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "The Sun is to your southwest, 24° up. Centre it in the circle and press Tap when centred." */
export function tapInstruction(t: TapTarget): string {
  const height = t.alt < 10 ? 'low' : `${Math.round(t.alt)}° up`;
  return `${capitalise(t.label)} is to your ${compassWord(t.az)}, ${height}. Centre it in the circle and press Tap when centred.`;
}

/** Shown whenever the Sun is the target. */
export const SUN_WARNING = 'Never look at the Sun directly, and never through binoculars or a telescope. Look only at the phone screen.';

/** Panorama strip: x across 0…360° from north, y from PANORAMA_ALT_MAX at the top to PANORAMA_ALT_MIN at the bottom. */
export function stripToAzAlt(x: number, y: number, width: number, height: number): { az: number; alt: number } {
  return { az: norm((x / width) * 360), alt: PANORAMA_ALT_MAX - (y / height) * (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN) };
}

export function azAltToStrip(az: number, alt: number, width: number, height: number): { x: number; y: number } {
  return { x: (norm(az) / 360) * width, y: ((PANORAMA_ALT_MAX - alt) / (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN)) * height };
}

/** Vertical placement of the sky grid inside the strip (the grid covers less altitude than the panorama). */
export function gridRectInStrip(grid: SkyGrid, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const top = azAltToStrip(0, grid.altMaxDeg, width, height).y, bottom = azAltToStrip(0, grid.altMinDeg, width, height).y;
  return { x: 0, y: top, w: width, h: bottom - top };
}

/**
 * RGBA tint for the sky grid (grid size): clear sky blue in proportion to its alpha, unseen cells grey, obstruction
 * left untinted so the photo shows through.
 */
export function maskTint(grid: SkyGrid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let i = 0; i < grid.alpha.length; i++) {
    const o = i * 4;
    if (!grid.known[i]) {
      out[o] = 40; out[o + 1] = 44; out[o + 2] = 52; out[o + 3] = 150;
    } else {
      out[o] = 70; out[o + 1] = 170; out[o + 2] = 255; out[o + 3] = Math.round(grid.alpha[i] * 0.45);
    }
  }
  return out;
}

/** Azimuth range a trace covers (the complement of its largest gap); undefined when it goes all the way round. */
export function traceCoverage(points: ReadonlyArray<{ az: number }>, fullCircleGapDeg = 5): { fromAz: number; toAz: number } | undefined {
  if (points.length < 2) return points.length ? { fromAz: norm(points[0].az), toAz: norm(points[0].az) } : undefined;
  const az = points.map(p => norm(p.az)).sort((a, b) => a - b);
  let gap = az[0] + 360 - az[az.length - 1], start = az[0], end = az[az.length - 1];
  for (let i = 1; i < az.length; i++) {
    const g = az[i] - az[i - 1];
    if (g > gap) { gap = g; start = az[i]; end = az[i - 1]; }
  }
  return gap <= fullCircleGapDeg ? undefined : { fromAz: start, toAz: end };
}

/** Points sorted along the circle starting after the largest gap, so a trace can be drawn as one line. */
export function orderTrace<T extends { az: number }>(points: readonly T[]): T[] {
  const cov = traceCoverage(points);
  const from = cov?.fromAz ?? 0;
  return [...points].sort((a, b) => norm(a.az - from) - norm(b.az - from));
}

/**
 * Make a landmark the alignment (it is the user's explicit choice, so it wins over the automatic fixes) and say so
 * plainly when it disagrees with what was chosen before (the same rule as chooseYaw: more than max(3°, 2 combined sigma)).
 * Returns the new choice and the azimuth shift to apply to the grid and panorama.
 */
export function chooseLandmark(prev: YawChoice, landmark: YawFix): { choice: YawChoice; deltaDeg: number } {
  const old = prev.chosen;
  const deltaDeg = angleDiffDeg(landmark.offsetDeg, old.offsetDeg);
  const fixes = [...prev.fixes.filter(f => f.source !== 'landmark'), landmark];
  const known = !(old.source === 'manual' && old.sigmaDeg >= 90);
  const disagreement = known && fixesDisagree(deltaDeg, old.sigmaDeg, landmark.sigmaDeg)
    ? `${capitalise(landmark.label || 'the landmark')} disagrees with ${old.label} by ${Math.round(Math.abs(deltaDeg))}°; using ${landmark.label || 'the landmark'}.`
    : undefined;
  return { choice: { chosen: landmark, fixes, ...(disagreement ? { disagreement } : {}) }, deltaDeg };
}

/**
 * Night trace with north from the compass only: line the traced skyline up with the hills of the terrain map. The
 * traced grid is already turned by the current alignment, so the match looks for the small remaining offset around 0
 * and adds it to the compass's. Returns the new choice and the azimuth shift for the grid, panorama and trace, or null
 * when there is no terrain, north does not come from the compass, or the hills give no better alignment.
 */
export function traceTerrainFix(yaw: YawChoice, traced: SkyGrid, terrain: HorizonProfile | null): { choice: YawChoice; deltaDeg: number } | null {
  if (!terrain || yaw.chosen.source !== 'compass') return null;
  // Search at least ±20°, wider for an unsettled compass.
  const residual = terrainMatchFix(relativeSkyline(traced), terrain, 0, { searchDeg: Math.min(180, Math.max(20, 3 * yaw.chosen.sigmaDeg)) });
  if (!residual || residual.sigmaDeg >= yaw.chosen.sigmaDeg) return null;
  const hills: YawFix = { ...residual, offsetDeg: Math.round(angleDiffDeg(yaw.chosen.offsetDeg + residual.offsetDeg, 0) * 100) / 100 };
  const choice = chooseYaw([...yaw.fixes.filter(f => f.source !== 'terrain'), hills]);
  return choice && choice.chosen === hills ? { choice, deltaDeg: residual.offsetDeg } : null;
}

/** Parse "45.97, 7.65" (or with a space or semicolon) into a position, or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Tap targets bright enough to see on the camera preview now. By day the Sun and the Moon (tapTargets offers nothing
 * else by day; anything at least as bright as Venus would pass too). In twilight and at night never the Sun, and only
 * objects of magnitude 1 or brighter: stricter than tapTargets' 1.5, since a phone's preview shows only the brightest.
 */
export function visibleTapTargets(targets: readonly TapTarget[], light: 'day' | 'twilight' | 'night'): TapTarget[] {
  if (light === 'day') return targets.filter(t => t.source === 'sun' || t.source === 'moon' || t.mag <= -3);
  return targets.filter(t => t.source !== 'sun' && t.mag <= 1);
}
