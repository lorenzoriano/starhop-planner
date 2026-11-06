/**
 * Sky Journeys: regenerable journey keys for `#/journeys/:key` (spec decision 12).
 *
 * A key carries everything needed to rebuild and re-validate the journey without the original request:
 * format version, a short hash of the KB version, template (+ the one archetype switch), the ordered stop ids
 * and their slot indices, the 15-minute UTC slot the journey was planned in, the site rounded to 0.1° (spec
 * decision 5, so a shared link does not reveal more than the seed already uses), the instrument (field, aperture,
 * magnification, stabilised), sky brightness, and the hard-constraint settings it passed (altitude floor,
 * region radius and centre, minutes per stop, challenge allowed). Relaxed journeys therefore re-validate under
 * the relaxed rules they were found with.
 *
 * Encoding: the fields are joined with "|" and the UTF-8 bytes written as base64url (RFC 4648 §5, no padding),
 * so the key is safe in a URL hash and a path segment. A key is stable inside one 15-minute slot, like the seed.
 * Decoding never throws: a malformed or unknown-format key gives null.
 */
import { fnv1a53 } from './seed';
import type { KnowledgeBase } from './types';

export const JOURNEY_KEY_FORMAT = 'j1';

export interface JourneyKeyData {
  format: typeof JOURNEY_KEY_FORMAT;
  /** 4 hex chars of fnv1a53(kb.version): tells whether the key was made with the same KB. */
  kbHash: string;
  templateId: string;
  /** The one archetype switch: target template and the index of the switch stop. */
  switch: { toTemplateId: string; at: number } | null;
  stopIds: string[];
  /** Slot index per stop (into the source template up to the switch stop, into the target after it). */
  slots: number[];
  /** Start of the 15-minute UTC slot, minutes since the Unix epoch. */
  slotMinute: number;
  /** Site rounded to 0.1°. */
  lat: number;
  lon: number;
  fovDeg: number;
  aperture: number;
  magnification: number;
  stabilized: boolean;
  skyBrightness: number;
  minAlt: number;
  regionRadius: number;
  minutesPerStop: number;
  includeChallenge: boolean;
  /** Region cap centre (0.01°). */
  centerRa: number;
  centerDec: number;
}

export const kbHashOf = (kbVersion: string) => (fnv1a53(kbVersion) % 65536).toString(16).padStart(4, '0');

const num = (x: number, digits: number) => String(Number(x.toFixed(digits)));

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of Array.from(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(key: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  try {
    const b64 = key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Compact URL-safe key (see module doc). Ids must not contain "|" or ","; the KB schema ids never do.
 * The local skyline (JourneyRequest.horizon) is deliberately NOT part of a key: it is per device and per site, and
 * would make links long. A key rebuilt elsewhere (assemble.rebuildJourney) is checked against the skyline of the device
 * that opens it, for that device's own site; at another site the rebuild assumes a flat horizon.
 */
export function encodeJourneyKey(d: Omit<JourneyKeyData, 'format'>): string {
  if (d.stopIds.some((id) => /[|,]/.test(id)) || /[|@]/.test(d.templateId)) throw new Error('journey key: id contains a separator');
  if (d.slots.some((j) => !Number.isInteger(j) || j < 0 || j > 35) || d.slots.length !== d.stopIds.length) throw new Error('journey key: bad slots');
  const fields = [
    JOURNEY_KEY_FORMAT,
    d.kbHash,
    d.templateId,
    d.switch ? `${d.switch.toTemplateId}@${d.switch.at}` : '',
    d.stopIds.join(','),
    d.slots.map((j) => j.toString(36)).join(''),
    d.slotMinute.toString(36),
    num(d.lat, 1), num(d.lon, 1),
    num(d.fovDeg, 2), num(d.aperture, 1), num(d.magnification, 1), d.stabilized ? '1' : '0',
    num(d.skyBrightness, 1),
    num(d.minAlt, 1), num(d.regionRadius, 1), num(d.minutesPerStop, 1), d.includeChallenge ? '1' : '0',
    num(d.centerRa, 2), num(d.centerDec, 2),
  ];
  return toBase64Url(fields.join('|'));
}

/** Inverse of encodeJourneyKey; null for anything that is not a well-formed key of this format. */
export function decodeJourneyKey(key: string): JourneyKeyData | null {
  const text = fromBase64Url(key);
  if (!text) return null;
  const f = text.split('|');
  if (f.length !== 20 || f[0] !== JOURNEY_KEY_FORMAT) return null;
  const n = (x: string) => (x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : NaN);
  const stopIds = f[4].split(',');
  const slots = Array.from(f[5]).map((c) => parseInt(c, 36));
  let sw: JourneyKeyData['switch'] = null;
  if (f[3]) {
    const m = /^([^@]+)@(\d+)$/.exec(f[3]);
    if (!m) return null;
    sw = { toTemplateId: m[1], at: Number(m[2]) };
  }
  const d: JourneyKeyData = {
    format: JOURNEY_KEY_FORMAT,
    kbHash: f[1],
    templateId: f[2],
    switch: sw,
    stopIds,
    slots,
    slotMinute: parseInt(f[6], 36),
    lat: n(f[7]), lon: n(f[8]),
    fovDeg: n(f[9]), aperture: n(f[10]), magnification: n(f[11]), stabilized: f[12] === '1',
    skyBrightness: n(f[13]),
    minAlt: n(f[14]), regionRadius: n(f[15]), minutesPerStop: n(f[16]), includeChallenge: f[17] === '1',
    centerRa: n(f[18]), centerDec: n(f[19]),
  };
  const nums = [d.slotMinute, d.lat, d.lon, d.fovDeg, d.aperture, d.magnification, d.skyBrightness, d.minAlt, d.regionRadius, d.minutesPerStop, d.centerRa, d.centerDec];
  if (nums.some((x) => !Number.isFinite(x))) return null;
  if (!d.templateId || !stopIds.length || stopIds.some((id) => !id) || slots.length !== stopIds.length || slots.some((j) => !Number.isInteger(j))) return null;
  if (Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180 || d.fovDeg <= 0) return null;
  if (sw && (sw.at < 0 || sw.at >= stopIds.length - 1)) return null;
  return d;
}

/**
 * A check for "does this key still name a journey this KB can show": the key is well formed and its theme (and the
 * theme it switches to) and every stop object are in the KB. Keys made before a KB rebuild that removed or renamed
 * any of them fail, and the app drops what carries them (stored progress, Planner journey tags, deep links).
 * The returned function caches the KB's id sets, so checking many keys is cheap.
 */
export function journeyKeyResolver(kb: Pick<KnowledgeBase, 'objects' | 'templates'>): (key: string) => boolean {
  const objects = new Set(kb.objects.map((o) => o.id));
  const templates = new Set(kb.templates.map((t) => t.id));
  return (key) => {
    const d = decodeJourneyKey(key);
    return !!d && templates.has(d.templateId) && (!d.switch || templates.has(d.switch.toTemplateId)) && d.stopIds.every((id) => objects.has(id));
  };
}
