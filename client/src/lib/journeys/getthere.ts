/**
 * Sky Journeys: "Get there" guidance between stops (spec decision 12, doc 06 §6.3, owner feedback round 1).
 *
 * Mode by angular distance d and the binocular true field f (the observer's selected binocular profile):
 *   same field  d ≤ 0.8 f      "Stay put: NGC 1981 is in the same view, just above the Orion Nebula."
 *   sweep       0.8 f < d ≤ 4 f "Sweep up and to the left about one and a half fields of your 6.5° binoculars (10°) to M35, still in Gemini."
 *   naked-eye   d > 4 f, or the first stop: lower the binoculars, find a bright anchor by eye, then hop.
 * Naked-eye starts name the anchor's constellation and a recognisable description ("Arcturus, the bright orange
 * star of Boötes, about 45° up in the east; follow the arc of the Big Dipper's handle to it"). Hops are stated in
 * fields of the selected binoculars, with the field size and the degrees, so the text matches the instrument.
 * Directions are given relative to the horizon at the stop time (up = toward the zenith, right = increasing
 * azimuth), which is what the observer does with the binoculars. A real star hop is computed only on request by
 * the UI (route worker), never here.
 */
import { getConstellationName } from '../astronomy';
import { capitalizeSentences, nameInSentence } from './plain-language';
import { compassWord } from './region';
import { seededPick } from './seed';
import type { GetThereMode, JourneyStop, NarrationBank } from './types';

const RAD = Math.PI / 180;
export const SAME_FIELD_FIELDS = 0.8;
export const SWEEP_MAX_FIELDS = 4;
/** Anchors must be easy naked-eye objects. */
export const ANCHOR_MAX_MAG = 3.0;
export const ANCHOR_MAX_SEP_DEG = 20;

export interface SkyPos { ra: number; dec: number; alt: number; az: number }

export function getThereMode(distanceDeg: number, fovDeg: number, first: boolean): GetThereMode {
  if (first) return 'naked-eye-hop';
  const fields = distanceDeg / fovDeg;
  if (fields <= SAME_FIELD_FIELDS) return 'same-field';
  if (fields <= SWEEP_MAX_FIELDS) return 'sweep';
  return 'naked-eye-hop';
}

/**
 * Direction of `to` seen from `from`, in the observer's frame at `from`: 0° = straight up (toward the
 * zenith), 90° = right (increasing azimuth), 180° = down, 270° = left.
 */
export function screenBearing(from: { alt: number; az: number }, to: { alt: number; az: number }): number {
  const v = (alt: number, az: number) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];
  const p = v(from.alt, from.az), q = v(to.alt, to.az);
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const a = from.alt * RAD, z = from.az * RAD;
  const up = [-Math.sin(a) * Math.sin(z), -Math.sin(a) * Math.cos(z), Math.cos(a)];
  const right = [Math.cos(z), -Math.sin(z), 0];
  const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
  const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const ang = Math.atan2(x, y) / RAD;
  return (ang + 360) % 360;
}

const MOVE_WORDS = ['up', 'up and to the right', 'right', 'down and to the right', 'down', 'down and to the left', 'left', 'up and to the left'];
const PLACE_WORDS = ['just above', 'above and to the right of', 'just right of', 'below and to the right of', 'just below', 'below and to the left of', 'just left of', 'above and to the left of'];
const sector = (bearing: number) => Math.round(bearing / 45) % 8;
export const moveWords = (bearing: number) => MOVE_WORDS[sector(bearing)];
export const placeWords = (bearing: number) => PLACE_WORDS[sector(bearing)];

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "half a", "one", "one and a half", "two", … (rounded to halves). */
export function fieldsPhrase(fields: number): string {
  const h = Math.max(0.5, Math.round(fields * 2) / 2);
  if (h === 0.5) return 'half a';
  const whole = Math.floor(h);
  const words = whole <= 10 ? NUM[whole] : String(whole);
  return h - whole ? `${words} and a half` : words;
}

/** Field size as printed: "6.5", "8", "4.2" (one decimal at most). */
export const fovText = (fovDeg: number) => String(Math.round(fovDeg * 10) / 10);

/**
 * A hop in fields of the selected binoculars plus degrees, grammatical in the singular:
 * "about half a field of your 6.5° binoculars (3°)", "about one field of your 8° binoculars (8°)",
 * "about two fields of your 6.5° binoculars (13°)".
 */
export function spanPhrase(distanceDeg: number, fovDeg: number): string {
  // A hop well under half a field is not "half a field": say the degrees (Mimosa → Jewel Box is 1°, not 3°).
  if (distanceDeg / fovDeg < 0.35) return `about ${Math.max(1, Math.round(distanceDeg))}° (a fraction of one field of your ${fovText(fovDeg)}° binoculars)`;
  const f = fieldsPhrase(distanceDeg / fovDeg);
  const noun = f === 'half a' || f === 'one' ? 'field' : 'fields';
  return `about ${f} ${noun} of your ${fovText(fovDeg)}° binoculars (${Math.max(1, Math.round(distanceDeg))}°)`;
}

/** Fill {placeholders}; returns null if any placeholder is left unfilled. */
export function fillTemplate(text: string, vars: Record<string, string | undefined>): string | null {
  const out = text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? vars[k]! : m));
  return /\{\w+\}/.test(out) || /undefined|NaN/.test(out)
    ? null
    : out.replace(/\s+([,.;])/g, '$1').replace(/,([.;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Seeded variant from the narration bank, skipping variants that leave placeholders unfilled. */
export function narrate(bank: NarrationBank | undefined, key: string, vars: Record<string, string | undefined>, rng: () => number): string | null {
  const variants = bank?.variants[key];
  if (!variants?.length) return null;
  const filled = variants.map((t) => fillTemplate(t, vars)).filter((t): t is string => t !== null);
  return filled.length ? seededPick(filled, rng) : null;
}

// ───────────────────────────── recognisable anchors ─────────────────────────────

/**
 * How to recognise the common naked-eye anchors: a description that names the constellation, and optionally a
 * pointer from a pattern everyone knows. Keyed by KB object id. Descriptions are qualitative and orientation-free
 * (no "left/right", which depends on the hour), so they hold at any time of night.
 */
export const ANCHOR_HINTS: Readonly<Record<string, { look: string; path?: string }>> = {
  'STAR-Sirius': { look: 'the brightest star in the night sky, in Canis Major', path: 'Orion’s Belt points to it' },
  HR2326: { look: 'the second-brightest star in the night sky, in Carina' },
  'STAR-Arcturus': { look: 'the bright orange star of Boötes', path: 'follow the arc of the Big Dipper’s handle to it' },
  HR5459: { look: 'the brighter of the two Pointers beside the Southern Cross, in Centaurus' },
  HR5267: { look: 'the fainter of the two Pointers beside the Southern Cross, in Centaurus' },
  'STAR-Betelgeuse': { look: 'the orange-red shoulder star of Orion' },
  'STAR-Vega': { look: 'the brilliant blue-white star of Lyra, brightest of the Summer Triangle' },
  'STAR-Capella': { look: 'the bright yellow star of Auriga' },
  HR1713: { look: 'the blue-white foot of Orion, diagonally across from Betelgeuse' },
  'STAR-Procyon': { look: 'the bright star of Canis Minor, east of Orion' },
  'AST-OrionBelt': { look: 'the row of three bright stars across the middle of Orion' },
  HR472: { look: 'the bright star at the far southern end of Eridanus, the River' },
  'AST-Hyades': { look: 'the V of stars around orange Aldebaran in Taurus' },
  HR7557: { look: 'the bright star of Aquila, flanked by two fainter stars, a corner of the Summer Triangle' },
  'STAR-Aldebaran': { look: 'the orange eye of Taurus the Bull, at the tip of the V-shaped Hyades' },
  'STAR-Antares': { look: 'the red heart of Scorpius' },
  HR5056: { look: 'the bright blue-white star of Virgo', path: 'continue the arc from Arcturus on to it' },
  HR2990: { look: 'the brighter of the two Twins of Gemini' },
  HR2891: { look: 'the fainter of the two Twins of Gemini' },
  'STAR-Fomalhaut': { look: 'the lone bright star of Piscis Austrinus, in an otherwise empty part of the sky' },
  Mel20: { look: 'the spray of stars around Mirfak, the brightest star of Perseus' },
  HR1017: { look: 'the brightest star of Perseus' },
  'STAR-Algol': { look: 'the Demon Star of Perseus' },
  'STAR-Deneb': { look: 'the tail of Cygnus the Swan, a corner of the Summer Triangle' },
  HR7796: { look: 'the center of the Northern Cross, where the wings of Cygnus meet its body' },
  HR4730: { look: 'the foot of the Southern Cross' },
  HR4853: { look: 'one of the arms of the Southern Cross' },
  HR3982: { look: 'the bright star at the base of the Sickle, the backward question mark in Leo' },
  HR4534: { look: 'the tail of Leo the Lion' },
  M45: { look: 'the tight little dipper of stars in Taurus' },
  HR4301: { look: 'the Big Dipper’s pointer star nearest Polaris' },
  HR4295: { look: 'the Big Dipper’s pointer star farther from Polaris' },
  HR4554: { look: 'the corner of the Big Dipper’s bowl next to Merak' },
  HR4905: { look: 'the first star of the Big Dipper’s handle, next to the bowl' },
  'DS-MizarAlcor': { look: 'the middle star of the Big Dipper’s handle, with faint Alcor beside it' },
  HR5191: { look: 'the star at the end of the Big Dipper’s handle' },
  HR424: { look: 'the Pole Star, at the end of the Little Dipper’s handle', path: 'the two pointer stars of the Big Dipper’s bowl lead to it' },
  HR5563: { look: 'the orange star at the end of the Little Dipper’s bowl' },
  'DS-AlpCVn': { look: 'the brightest star of Canes Venatici, below the Big Dipper’s handle' },
  'Mel111': { look: 'the faint spray of stars of Coma Berenices' },
  'STAR-Alphard': { look: 'the lone orange star of Hydra' },
  HR617: { look: 'the brightest star of Aries' },
  HR15: { look: 'the corner of the Great Square of Pegasus that belongs to Andromeda' },
  HR337: { look: 'the orange star two steps along the chain of Andromeda from the Great Square' },
  'DS-AlmaakDS': { look: 'the third bright star along the chain of Andromeda from the Great Square' },
  HR8781: { look: 'a corner of the Great Square of Pegasus' },
  HR8775: { look: 'a corner of the Great Square of Pegasus' },
  HR39: { look: 'a corner of the Great Square of Pegasus' },
  HR8308: { look: 'the nose of Pegasus' },
  HR168: { look: 'the orange star in the W of Cassiopeia' },
  HR21: { look: 'one end of the W of Cassiopeia' },
  HR264: { look: 'the middle star of the W of Cassiopeia' },
  HR403: { look: 'a star of the W of Cassiopeia' },
  HR8162: { look: 'the brightest star of Cepheus' },
  HR5793: { look: 'the brightest star of the little semicircle of Corona Borealis' },
  HR6705: { look: 'the brightest of the four stars that form the head of Draco' },
  HR6536: { look: 'one of the four stars of Draco’s head' },
  HR6148: { look: 'the brightest star of Hercules' },
  HR6212: { look: 'a corner of the Keystone of Hercules' },
  HR6556: { look: 'the head of Ophiuchus, the Serpent Bearer' },
  HR7525: { look: 'the orange star beside Altair in Aquila' },
  HR5506: { look: 'the orange star of the kite of Boötes, near Arcturus' },
  HR5235: { look: 'the star of Boötes close to Arcturus' },
  HR7949: { look: 'one wing of Cygnus the Swan' },
  HR7528: { look: 'one wing of Cygnus the Swan' },
  HR2088: { look: 'the second-brightest star of Auriga, near Capella' },
  HR1605: { look: 'the tip of the Kids, the small triangle beside Capella in Auriga' },
  HR1791: { look: 'the tip of the Bull’s northern horn, where Taurus meets Auriga' },
  HR1910: { look: 'the tip of the Bull’s southern horn, in Taurus' },
  HR1165: { look: 'the brightest star of the Pleiades' },
  HR1790: { look: 'the shoulder of Orion opposite Betelgeuse' },
  HR2004: { look: 'the foot of Orion opposite Rigel' },
  HR1903: { look: 'the middle star of Orion’s Belt' },
  HR1948: { look: 'the end of Orion’s Belt nearest the Sword' },
  HR1852: { look: 'the end of Orion’s Belt nearest Bellatrix' },
  HR2294: { look: 'the star beside Sirius in Canis Major' },
  HR2421: { look: 'the foot of the Twins, in Gemini' },
  HR6879: { look: 'the bright base of the Teapot in Sagittarius' },
  HR7121: { look: 'a star of the Teapot’s handle, in Sagittarius' },
  HR6527: { look: 'the stinger at the end of the Scorpion’s tail' },
  'STAR-Mira': { look: 'the wonderful star of Cetus the Whale, whose brightness swings over months' },
  HR4057: { look: 'a star of the Sickle in Leo' },
  HR4763: { look: 'the red-orange top of the Southern Cross' },
  HR5953: { look: 'the middle star of the Scorpion’s head' },
  HR6084: { look: 'the star just beside Antares in Scorpius' },
  HR6241: { look: 'an orange star of the Scorpion’s tail' },
  HR6553: { look: 'a star of the Scorpion’s curling tail' },
  HR6508: { look: 'the fainter of the two stinger stars of Scorpius' },
  NGC6231: { look: 'the bright knot of stars near ζ Scorpii, in the Scorpion’s tail' },
  HR6913: { look: 'the top of the Teapot’s lid, in Sagittarius' },
  HR6859: { look: 'a corner of the Teapot in Sagittarius' },
  HR7194: { look: 'a corner of the Teapot’s handle, in Sagittarius' },
  SMC: { look: 'a detached scrap of Milky Way glow in Tucana' },
  LMC: { look: 'a detached patch of Milky Way glow in Dorado' },
  HR3207: { look: 'the brightest star of Vela, the Sails' },
  HR3634: { look: 'the orange star of Vela, the Sails' },
  HR3485: { look: 'a corner of the False Cross, in Vela' },
  HR3734: { look: 'a corner of the False Cross, in Vela' },
  HR3307: { look: 'a corner of the False Cross, in Carina' },
  HR3699: { look: 'a corner of the False Cross, in Carina' },
  IC2602: { look: 'the bright cluster around θ Carinae, in Carina' },
  HR4199: { look: 'the brightest star of the Southern Pleiades, in Carina' },
  HR8636: { look: 'the red star of Grus, the Crane' },
  HR8425: { look: 'the brightest star of Grus, the Crane' },
  HR5685: { look: 'the northern pan of Libra, the Scales' },
  'DS-AlpLib': { look: 'the southern pan of Libra, the Scales' },
  HR2773: { look: 'an orange star of Puppis, the Stern' },
  HR3165: { look: 'the brightest star of Puppis, the Stern, in the Milky Way south-east of Sirius' },
};

export interface AnchorCandidate {
  id: string; name: string; ra: number; dec: number; mag: number | null; alt: number; az: number;
  /** IAU constellation abbreviation; used to name the constellation when the anchor has no hint. */
  con?: string;
}

/** A bright naked-eye object near the target (the target itself when it is bright enough). */
export function chooseAnchor(target: AnchorCandidate, pool: readonly AnchorCandidate[], sep: (a: AnchorCandidate, b: AnchorCandidate) => number, minAlt: number): AnchorCandidate | null {
  if (target.mag !== null && target.mag <= ANCHOR_MAX_MAG) return target;
  let best: AnchorCandidate | null = null, bestScore = Infinity;
  for (const c of pool) {
    if (c.id === target.id || c.mag === null || c.mag > ANCHOR_MAX_MAG || c.alt < Math.min(minAlt, 25)) continue;
    const d = sep(c, target);
    if (d > ANCHOR_MAX_SEP_DEG) continue;
    const score = d + 3 * c.mag;
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && best && c.id < best.id)) { best = c; bestScore = score; }
  }
  return best;
}

/** "about 45° up in the east", "nearly overhead". */
export function wherePhrase(p: { alt: number; az: number }): string {
  return p.alt >= 75 ? 'nearly overhead' : `about ${Math.round(p.alt / 5) * 5}° up in the ${compassWord(p.az)}`;
}

/**
 * The anchor named so it can be recognised: "Arcturus, the bright orange star of Boötes," (with the closing
 * comma, so the variant can continue "… by eye"), or "Alphecca in Corona Borealis", or the bare name.
 */
export function anchorLook(a: { id: string; name: string; con?: string }): string {
  const h = ANCHOR_HINTS[a.id];
  const name = nameInSentence(a.name);
  if (h) return `${name}, ${h.look},`;
  return a.con ? `${name} in ${getConstellationName(a.con)}` : name;
}

/**
 * What follows "Find <name> by eye" for a star picked out by eye, with its own leading punctuation:
 * ", the bright orange star of Boötes, about 45° up in the east" + path "follow the arc of …",
 * or " in Perseus, nearly overhead", or ", about 40° up in the east".
 */
export function byEyeDescription(x: { id: string; con?: string }, where: string): { desc: string; path?: string } {
  const h = ANCHOR_HINTS[x.id];
  if (h) return { desc: `, ${h.look}, ${where}`, path: h.path };
  return { desc: x.con ? ` in ${getConstellationName(x.con)}, ${where}` : `, ${where}` };
}

export interface GetThereInput {
  prev: (SkyPos & { id: string; name: string; con: string }) | null;
  next: SkyPos & { id: string; name: string; con: string };
  anchor: AnchorCandidate | null;
  /** True field of the observer's selected binoculars (degrees). */
  fovDeg: number;
  /** Great-circle distance prev → next (degrees); ignored for the first stop. */
  distanceDeg: number;
  /** Distance anchor → next (degrees). */
  anchorDistanceDeg: number;
  bank?: NarrationBank;
  rng: () => number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildGetThere(x: GetThereInput): JourneyStop['getThere'] {
  const { anchor, fovDeg } = x;
  // Names as they read in a sentence ("the Andromeda Galaxy"); ids and positions unchanged.
  const prev = x.prev ? { ...x.prev, name: nameInSentence(x.prev.name) } : null;
  const next = { ...x.next, name: nameInSentence(x.next.name) };
  const first = prev === null;
  const mode = getThereMode(x.distanceDeg, fovDeg, first);
  const where = wherePhrase(next);
  const anchorIsTarget = !!anchor && anchor.id === next.id;
  const hopFrom = mode === 'naked-eye-hop' ? (anchor && !anchorIsTarget ? anchor : null) : prev;
  const bearing = hopFrom ? screenBearing(hopFrom, next) : 0;
  const hopDeg = mode === 'naked-eye-hop' ? (anchor && !anchorIsTarget ? x.anchorDistanceDeg : 0) : x.distanceDeg;
  const fields = hopDeg / fovDeg;
  const compassHint = prev && prev.con !== next.con ? `, toward ${getConstellationName(next.con)}` : '';
  // Every hop names the constellation it lands in (owner feedback r1): "…, still in Cygnus" or "…, in Lyra".
  const inCon = prev && next.con ? `, ${prev.con === next.con ? 'still in' : 'in'} ${getConstellationName(next.con)}` : '';
  const vars: Record<string, string | undefined> = {
    prev: prev?.name,
    next: next.name,
    anchor: anchor ? nameInSentence(anchor.name) : undefined,
    anchorLook: anchor && !anchorIsTarget ? anchorLook(anchor) : undefined,
    screenDir: moveWords(bearing),
    fields: fieldsPhrase(fields),
    deg: String(Math.max(1, Math.round(hopDeg))),
    fov: fovText(fovDeg),
    span: spanPhrase(hopDeg, fovDeg),
    compassHint,
    inCon,
    region: where,
  };

  let text: string | null = null;
  if (mode === 'same-field' && prev) {
    const bank = x.bank?.variants['direction.same-field']
      ? { version: '', variants: { k: x.bank.variants['direction.same-field'].map((t) => t.replace('{screenDir} of {prev}', `${placeWords(bearing)} {prev}`)) } }
      : undefined;
    text = narrate(bank, 'k', vars, x.rng) ?? `Stay put: ${next.name} is in the same view, ${placeWords(bearing)} ${prev.name}.`;
  } else if (mode === 'sweep' && prev) {
    text = narrate(x.bank, 'direction.sweep', vars, x.rng) ?? `Sweep ${vars.screenDir} ${vars.span} to ${next.name}${inCon}.`;
  } else if (anchor && !anchorIsTarget) {
    if (first) {
      // Naked-eye start: describe the anchor where it stands, then the binocular hop to the first stop.
      const a = byEyeDescription(anchor, wherePhrase(anchor));
      text = `Find ${nameInSentence(anchor.name)} by eye${a.desc}${a.path ? `; ${a.path}` : ''}. From there, hop ${vars.screenDir} ${vars.span} to ${next.name}.`;
    } else {
      text = narrate(x.bank, 'direction.naked-eye-hop', vars, x.rng)
        ?? `Lower the binoculars and find ${vars.anchorLook} by eye. From there, hop ${vars.screenDir} ${vars.span} to ${next.name}.`;
    }
  } else if (anchorIsTarget) {
    const t = byEyeDescription(next, where);
    text = first
      ? `Find ${next.name} by eye${t.desc}${t.path ? `; ${t.path}` : ''}. Then raise your binoculars onto it.`
      : `Lower the binoculars and find ${next.name} by eye${t.desc}, then raise them onto it.`;
  } else {
    text = `Lower the binoculars, face the ${compassWord(next.az)} ${next.alt >= 75 ? 'and look nearly overhead' : `about ${Math.round(next.alt / 5) * 5}° up`}${next.con ? `, in ${getConstellationName(next.con)},` : ''} and sweep slowly to find ${next.name}.`;
  }
  text = capitalizeSentences(text.replace(/,,/g, ',').replace(/\s{2,}/g, ' '));
  return {
    mode,
    fields: round2(first ? fields : x.distanceDeg / fovDeg),
    distanceDeg: round1(first ? hopDeg : x.distanceDeg),
    bearingText: text,
    ...(mode === 'naked-eye-hop' && anchor ? { anchorId: anchor.id } : {}),
  };
}
