/**
 * Sky Journeys: pure data helpers behind the stop card and its in-app visuals (spec decision 11, doc 06 §7,
 * doc 04 §6.2, doc 02 §6). No React, no DOM, no Date.now(): everything here is deterministic and unit-tested
 * in __tests__/visual-data.test.ts.
 *
 * Reference values used by the visuals (not KB facts, but every one is cited in VISUAL_REFERENCES and shown
 * under "Numbers & sizes → Sources" whenever the visual that uses it is on screen):
 * - Sun: Teff 5,772 K and R☉ = 695,700 km (IAU 2015 Resolution B3, Prša et al. 2016); M_V = 4.81
 *   (Willmer 2018); age 4,568 Myr (Bouvier & Wadhwa 2010), rounded to 4,600 Myr for the "Sun-day" clock so it
 *   matches the narration bank's {scaled} rule.
 * - Planet orbits and sizes: NASA NSSDCA Planetary Fact Sheet (Earth 149.6, Mars 228.0, Jupiter 778.5 × 10⁶ km;
 *   Earth diameter 12,756 km, Jupiter 142,984 km).
 * - Main-sequence line: Pecaut & Mamajek 2013 (ApJS 208, 9), table version 2022.04.16.
 * - Blackbody colour: Planck spectrum integrated against the CIE 1931 2° colour-matching functions in the
 *   analytic form of Wyman, Sloan & Shirley 2013 (JCGT 2(2)), D65 sRGB; checked against Mitchell Charity's
 *   blackbody colour table in the tests.
 * - Distance-ladder landmarks: Sirius 8.6 ly (Hipparcos 2007), Galactic centre 8,178 pc ≈ 26,700 ly (GRAVITY
 *   Collaboration 2019, A&A 625, L10), Andromeda 2.5 Mly (NASA Hubble Messier 31 page).
 * - Age bar landmarks: end of the dinosaurs 66 Myr (Renne et al. 2013, Science 339, 684); age of the Universe
 *   13,787 Myr (Planck 2018 VI).
 * - Light-curve shapes: Cepheid rise ≈ 25 % of the period (GCVS M−m for δ Cep, see SAS/popastro δ Cep guide);
 *   Algol eclipse ≈ 10 h of a 2.87-day period (Sky & Telescope).
 */
import type { FactKey, FactValue, Facts, KbObject, KbVisual, NarrationBank, Source, StarObject, VariabilityClass } from './types';

// ───────────────────────────── reference constants ─────────────────────────────

export interface VisualReference { id: string; title: string; url: string; citation: string }

export const VISUAL_REFERENCES: Record<string, VisualReference> = {
  iau2015: { id: 'iau2015', title: 'Nominal values for selected solar and planetary quantities: IAU 2015 Resolution B3', url: 'https://arxiv.org/abs/1605.09788', citation: 'Prša et al. 2016, AJ 152, 41' },
  willmer2018: { id: 'willmer2018', title: 'The Absolute Magnitude of the Sun in Several Filters', url: 'https://arxiv.org/abs/1804.07788', citation: 'Willmer 2018, ApJS 236, 47' },
  bouvier2010: { id: 'bouvier2010', title: 'The age of the Solar System redefined by the oldest Pb–Pb age of a meteoritic inclusion', url: 'https://www.nature.com/articles/ngeo941', citation: 'Bouvier & Wadhwa 2010, Nature Geoscience 3, 637' },
  nasaFactSheet: { id: 'nasaFactSheet', title: 'Planetary Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/', citation: 'NASA NSSDCA Planetary Fact Sheet' },
  pecautMamajek2013: { id: 'pecautMamajek2013', title: 'A Modern Mean Dwarf Stellar Color and Effective Temperature Sequence', url: 'https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt', citation: 'Pecaut & Mamajek 2013, ApJS 208, 9 (table v2022.04.16)' },
  wyman2013: { id: 'wyman2013', title: 'Simple Analytic Approximations to the CIE XYZ Color Matching Functions', url: 'https://jcgt.org/published/0002/02/01/', citation: 'Wyman, Sloan & Shirley 2013, JCGT 2(2), 1' },
  charityBlackbody: { id: 'charityBlackbody', title: 'What color is a blackbody? (sRGB blackbody colour table)', url: 'http://www.vendian.org/mncharity/dir3/blackbody/', citation: 'M. Charity 2001, blackbody colour datafile' },
  hrBackground: { id: 'hrBackground', title: 'HR diagram of naked-eye stars (BSC5 B−V, SIMBAD parallaxes)', url: 'https://vizier.idia.ac.za/viz-bin/VizieR?-source=V/50', citation: 'Hoffleit & Warren 1991 (BSC5, V/50) + SIMBAD parallaxes; built by script/journeys/build_stars_auto.py' },
  hip2007: { id: 'hip2007', title: 'Validation of the new Hipparcos reduction', url: 'https://ui.adsabs.harvard.edu/abs/2007A%26A...474..653V/abstract', citation: 'van Leeuwen 2007, A&A 474, 653' },
  gravity2019: { id: 'gravity2019', title: 'A geometric distance measurement to the Galactic Center black hole with 0.3% uncertainty', url: 'https://arxiv.org/abs/1904.05721', citation: 'GRAVITY Collaboration 2019, A&A 625, L10' },
  nasaM31: { id: 'nasaM31', title: 'Messier 31 (the Andromeda Galaxy)', url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/', citation: 'NASA Hubble Messier catalog' },
  renne2013: { id: 'renne2013', title: 'Time Scales of Critical Events Around the Cretaceous-Paleogene Boundary', url: 'https://www.science.org/doi/10.1126/science.1230492', citation: 'Renne et al. 2013, Science 339, 684' },
  planck2018: { id: 'planck2018', title: 'Planck 2018 results. VI. Cosmological parameters', url: 'https://arxiv.org/abs/1807.06209', citation: 'Planck Collaboration 2020, A&A 641, A6' },
  delCepGuide: { id: 'delCepGuide', title: 'Guide to Delta Cephei', url: 'https://www.popastro.com/variablestar/reference/guides/guide-to-delta-cephei/', citation: 'Society for Popular Astronomy, Variable Star Section' },
  algolSnT: { id: 'algolSnT', title: 'The top 12 naked-eye variable stars', url: 'https://skyandtelescope.org/observing/celestial-objects-to-watch/the-top-12-naked-eye-variable-stars/', citation: 'Sky & Telescope' },
};

export const SUN = {
  teffK: 5772,
  radiusKm: 695_700,
  absMagV: 4.81,
  /** Rounded from 4,568 Myr so the Sun-day clock matches the narration bank. */
  ageMyr: 4600,
  bv: 0.65,
} as const;

const KM_PER_LY = 9.4607e12;
/** Sun = 1 cm marble, so 1 cm ↔ the Sun's diameter (1,391,400 km). */
const SUN_DIAMETER_KM = 2 * SUN.radiusKm;
/** Marble-scale kilometres per light-year (≈ 68 km, the narration bank's constant). */
export const MARBLE_KM_PER_LY = (KM_PER_LY / SUN_DIAMETER_KM) * 1e-5;

/** Orbit radii in solar radii (NASA fact sheet semi-major axes ÷ IAU nominal R☉). */
export const ORBITS_RSUN = [
  { id: 'earth', label: "Earth's orbit", radiusRsun: 149.6e6 / SUN.radiusKm },
  { id: 'mars', label: "Mars's orbit", radiusRsun: 228.0e6 / SUN.radiusKm },
  { id: 'jupiter', label: "Jupiter's orbit", radiusRsun: 778.5e6 / SUN.radiusKm },
] as const;
export const BODIES_RSUN = {
  earth: 12_756 / 2 / SUN.radiusKm,
  jupiter: 142_984 / 2 / SUN.radiusKm,
} as const;

// ───────────────────────────── number formatting ─────────────────────────────

/** Round to `sig` significant figures (doc 06 §7.1: 2). */
export function roundSig(x: number, sig = 2): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const p = Math.ceil(Math.log10(Math.abs(x)));
  const f = 10 ** (sig - p);
  return Math.round(x * f) / f;
}

/** "1,400", "2.6", "0.0092" — rounded to 2 significant figures, US grouping. */
export function fmtSig(x: number, sig = 2): string {
  const r = roundSig(x, sig);
  const decimals = Math.abs(r) >= 10 ** (sig - 1) ? 0 : Math.min(6, sig - 1 - Math.floor(Math.log10(Math.abs(r) || 1)));
  return r.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, decimals), minimumFractionDigits: 0 });
}

/** Big round numbers in words: 2,500,000 → "2.5 million". */
export function fmtLarge(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `${fmtSig(x / 1e9)} billion`;
  if (a >= 1e6) return `${fmtSig(x / 1e6)} million`;
  return fmtSig(x);
}

/** Value with unit as a card shows it, without the "≈" (that is added by `formatFactDisplay`). */
export function formatFactValue(key: FactKey, v: number, unit = ''): string {
  switch (key) {
    case 'distanceLy': return `${fmtLarge(v)} light-years`;
    case 'sizeLy': return `${fmtLarge(v)} light-years across`;
    case 'teffK': return `${fmtSig(v)} K`;
    case 'radiusRsun': return `${fmtSig(v)} × the Sun's radius`;
    case 'massMsun': return `${fmtSig(v)} × the Sun's mass`;
    case 'lumLsun': return `${fmtLarge(v)} × the Sun's light`;
    case 'ageMyr': return formatAgeMyr(v);
    case 'memberCount': return `${fmtLarge(v)} stars`;
    case 'periodDays': return v < 1 ? `${fmtSig(v * 24)} hours` : `${fmtSig(v)} days`;
    case 'angularSizeArcmin': return `${fmtSig(v / 60)}° across`;
    case 'vMax': case 'vMin': case 'absMagV': return `magnitude ${v.toFixed(1)}`;
    case 'radialVelocityKms': case 'spaceVelocityKms': case 'vsiniKms': return `${fmtSig(v)} km/s`;
    default: return `${fmtSig(v)}${unit ? ` ${unit}` : ''}`;
  }
}

export function formatAgeMyr(v: number): string {
  if (v >= 1000) return `${fmtSig(v / 1000)} billion years`;
  if (v >= 1) return `${fmtSig(v)} million years`;
  return `${fmtLarge(v * 1e6)} years`;
}

/** "≈ 760 × the Sun's radius". */
export function formatFactDisplay(key: FactKey, f: FactValue): string {
  return `≈ ${formatFactValue(key, f.value, f.unit)}`;
}

/** Published range for the tap-to-expand row, or null. "702–880 × the Sun's radius". */
export function formatFactRange(key: FactKey, f: FactValue): string | null {
  if (f.min === undefined && f.max === undefined) return null;
  const lo = f.min ?? f.value, hi = f.max ?? f.value;
  if (lo === hi) return null;
  const a = formatFactValue(key, lo, f.unit), b = formatFactValue(key, hi, f.unit);
  // Share the unit when both ends use the same wording after the number ("702–880 × the Sun's radius").
  const split = (s: string) => { const m = /^(-?[\d.,]+(?: (?:million|billion))?)(.*)$/.exec(s); return m ? [m[1], m[2]] : [s, '']; };
  const [na, ua] = split(a), [nb, ub] = split(b);
  if (key === 'vMax' || key === 'vMin' || key === 'absMagV') return `${a} to ${b}`;
  return ua === ub ? `${na}–${nb}${ub}` : `${a} to ${b}`;
}

/** Relative 1σ-ish uncertainty from min/max (null when not published). */
export function relativeUncertainty(f: FactValue): number | null {
  if (f.min === undefined || f.max === undefined || f.value <= 0) return null;
  return (f.max - f.min) / 2 / f.value;
}

// ───────────────────────────── light-travel time ─────────────────────────────

/** Calendar label for a (possibly negative, astronomical-numbering) year: 1470, "680 CE", "5500 BCE". */
export function formatCalendarYear(year: number): string {
  if (year >= 1000) return String(year);
  if (year >= 1) return `${year} CE`;
  // Astronomical year 0 = 1 BCE; rounded (approximate) years keep their round look: −4500 → "4500 BCE".
  return `${year % 10 === 0 ? -year : 1 - year} BCE`;
}

export interface LightLeft {
  /** Calendar text ("1470", "680 CE", "5500 BCE"); null when the distance is too uncertain or too large. */
  year: string | null;
  /** Travel time without "about": "550 years", "2.5 million years". */
  ago: string;
  /** Short label for the ladder: "light left ~1470" / "light left ~2.5 million years ago". */
  short: string;
}

/**
 * When the light now arriving left the object (narration placeholder rules: rounded to the decade above 100 ly,
 * to the century above 1,000 ly). MC5 honesty rule (doc 02 §6.6): no calendar year when σd/d > 15 %; then the
 * year is given to the century ("the 1400s") or, beyond 12,000 ly, only as a duration.
 */
export function lightLeft(distanceLy: number, refYear: number, relUnc: number | null = null): LightLeft {
  const d = Math.max(0, distanceLy);
  const ago = d >= 1e6 ? `${fmtLarge(roundSig(d, 2))} years` : d >= 1000 ? `${roundSig(d, 2).toLocaleString('en-US')} years` : d >= 100 ? `${(Math.round(d / 10) * 10).toLocaleString('en-US')} years` : `${Math.max(1, Math.round(d))} year${Math.round(d) === 1 ? '' : 's'}`;
  if (d > 12_000) return { year: null, ago, short: `light left ~${ago} ago` };
  const step = d >= 1000 ? 100 : d >= 100 ? 10 : 1;
  const raw = refYear - d;
  if (relUnc !== null && relUnc > 0.15) {
    // Too uncertain for a year: give the century ("the 1400s") or a rounded era ("500 BCE").
    const floorCentury = Math.floor(raw / 100) * 100;
    const year = floorCentury >= 1000 ? `the ${floorCentury}s` : formatCalendarYear(Math.round(raw / 100) * 100 || 1);
    return { year, ago, short: `light left ~${year}` };
  }
  const y = Math.round(raw / step) * step;
  const year = formatCalendarYear(y === 0 ? 1 : y);
  return { year, ago, short: `light left ~${year}` };
}

// ───────────────────────────── relatable lines (doc 06 §7.1) ─────────────────────────────

/** Default comparison template per fact when the card row names none (never show a bare number). */
export const DEFAULT_COMPARISON: Partial<Record<FactKey, string>> = {
  distanceLy: 'distance.light-left',
  radiusRsun: 'size.marble',
  teffK: 'temperature.sun',
  massMsun: 'mass.supernova-limit',
  ageMyr: 'time.sun-day',
  lumLsun: 'luminosity.sun',
  sizeLy: 'size.light-years',
  periodDays: 'period.days',
  memberCount: 'members.count',
  angularSizeArcmin: 'angle.moon',
  vMax: 'brightness.magnitude',
  vMin: 'brightness.magnitude',
};

/** FNV-1a 32-bit (deterministic variant choice). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function fillPlaceholders(text: string, vars: Record<string, string | undefined>): string | null {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) { missing = true; return ''; }
    return v;
  });
  return missing ? null : out;
}

/** Length on the marble scale (Sun = 1 cm across): "0.09 mm", "45 cm", "7.6 m", "1,600 km". */
export function formatMarbleLength(cm: number): string {
  if (cm < 0.1) return `${fmtSig(cm * 10)} mm`;
  if (cm < 100) return `${fmtSig(cm)} cm`;
  if (cm < 100_000) return `${fmtSig(cm / 100)} m`;
  return `${fmtLarge(roundSig(cm / 100_000, 2))} km`;
}

/** Duration on a clock where the Sun's life so far is 24 h. */
export function formatSunDay(ageMyr: number): string {
  const seconds = (ageMyr / SUN.ageMyr) * 86_400;
  if (seconds < 1) return `${fmtSig(seconds)} seconds`;
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `${fmtSig(hours)} hours`;
  return `${fmtSig(hours / 24)} days`;
}

/** "about 2 times hotter than the Sun" / "about 1.6 times cooler" — compares with the Sun. */
export function sunRatioPhrase(key: FactKey, v: number): string | undefined {
  const sun = key === 'teffK' ? SUN.teffK : key === 'radiusRsun' || key === 'massMsun' || key === 'lumLsun' ? 1 : undefined;
  if (sun === undefined || v <= 0) return undefined;
  const r = v >= sun ? v / sun : sun / v;
  const words: Partial<Record<FactKey, [string, string]>> = { teffK: ['hotter', 'cooler'], radiusRsun: ['wider', 'smaller'], massMsun: ['heavier', 'lighter'], lumLsun: ['brighter', 'dimmer'] };
  const [up, down] = words[key]!;
  return `about ${fmtSig(r)} times ${v >= sun ? up : down} than the Sun`;
}

function pickBand(bank: NarrationBank | undefined, base: string, facts: Facts, factRef: FactKey): string | null {
  const bands = bank?.bands?.[base];
  if (!bands) return null;
  for (const b of bands) {
    const f = facts[b.fact ?? factRef];
    if (!f) continue;
    if ((b.min === undefined || f.value >= b.min) && (b.max === undefined || f.value < b.max)) return `${base}.${b.suffix}`;
  }
  return null;
}

export interface RelatableContext {
  /** Calendar year the observation happens in (from the stop window; never Date.now()). */
  refYear: number;
  /** Variant seed (object id is fine). */
  seed?: string;
}

/** Placeholder values for a compare.* line about `fact` of object `name`. */
export function comparisonVars(name: string, key: FactKey, f: FactValue, facts: Facts, ctx: RelatableContext): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = { name, value: formatFactValue(key, f.value, f.unit), ratioPhrase: sunRatioPhrase(key, f.value) };
  const dist = facts.distanceLy;
  if (dist) {
    const ll = lightLeft(dist.value, ctx.refYear, relativeUncertainty(dist));
    vars.year = ll.year ?? undefined;
    vars.ago = ll.ago;
  }
  // Sun = 1 cm across, so a star of R solar radii is R cm across.
  if (key === 'radiusRsun') vars.scaled = formatMarbleLength(f.value);
  else if (key === 'distanceLy') vars.scaled = `${fmtLarge(roundSig(f.value * MARBLE_KM_PER_LY, 2))} km`;
  else if (key === 'sizeLy') vars.scaled = `${fmtLarge(roundSig(f.value * MARBLE_KM_PER_LY, 2))} km`;
  else if (key === 'ageMyr') vars.scaled = formatSunDay(f.value);
  return vars;
}

/** Built-in fallbacks for comparison keys the narration bank lacks (all original text). */
const BUILTIN_COMPARISONS: Record<string, string> = {
  'distance.light-left': 'The light reaching you from {name} left it around {year}.',
  'distance.light-left.ago': 'Light from {name} has been travelling for about {ago}.',
  'size.marble': 'If the Sun were a 1 cm marble, {name} would be about {scaled} across.',
  'temperature.sun': "About {value} at the surface; the Sun's is about 5,800 K.",
  'mass.supernova-limit': 'About {value}. Stars above roughly 8 Suns end as supernovae; lighter ones end as white dwarfs.',
  'time.sun-day': "If the Sun's life so far were one day, {name} would be about {scaled} old.",
  'luminosity.sun': "About {value}, measured against the Sun's output.",
  'size.light-years': 'On the marble scale (Sun = 1 cm), {name} would still span about {scaled}; light itself needs that many years to cross it.',
  'period.days': 'One full cycle of change takes about {value}: watch it over several nights.',
  'members.count': 'About {value}, all born from the same cloud at about the same time.',
  'angle.moon': 'About {value} on the sky; the full Moon is about half a degree wide.',
  'brightness.magnitude': 'Smaller numbers mean brighter: the faintest stars you can see without optics are about magnitude 6.',
};

/**
 * The relatable line under a key number (doc 06 §7.1). Uses the KB narration bank's banded `compare.*`
 * variants (deterministic variant per object) and falls back to built-in templates. Never returns an empty line.
 */
export function relatableLine(obj: Pick<KbObject, 'id' | 'names' | 'facts'>, factRef: FactKey, comparisonKey: string | undefined,
  bank: NarrationBank | undefined, ctx: RelatableContext): string {
  const f = obj.facts[factRef];
  if (!f) return '';
  const key = comparisonKey ?? DEFAULT_COMPARISON[factRef] ?? '';
  const base = `compare.${key}`;
  const vars = comparisonVars(obj.names.display, factRef, f, obj.facts, ctx);
  const seed = hash32(`${ctx.seed ?? obj.id}|${key}`);
  const banded = pickBand(bank, base, obj.facts, factRef);
  for (const k of [banded, base]) {
    const list = k ? bank?.variants[k] : undefined;
    if (!list?.length) continue;
    for (let i = 0; i < list.length; i++) {
      const t = fillPlaceholders(list[(seed + i) % list.length], vars);
      if (t) return t;
    }
  }
  for (const k of [key, `${key}.ago`]) {
    const t = BUILTIN_COMPARISONS[k] ? fillPlaceholders(BUILTIN_COMPARISONS[k], vars) : null;
    if (t) return t;
  }
  return `About ${vars.value}.`;
}

/** "About 17 times larger than Aldebaran (stop 2)" — accumulates comparisons along the journey. */
export function compareWithPrevious(factRef: FactKey, current: Pick<KbObject, 'facts'>,
  prev: { obj: Pick<KbObject, 'facts' | 'names'>; stopNumber: number }[]): string | null {
  const c = current.facts[factRef];
  if (!c || c.value <= 0) return null;
  const more: Partial<Record<FactKey, string>> = {
    distanceLy: 'farther away', radiusRsun: 'larger', teffK: 'hotter', massMsun: 'heavier', ageMyr: 'older',
    lumLsun: 'more luminous', sizeLy: 'wider',
  };
  const word = more[factRef];
  if (!word) return null;
  for (let i = prev.length - 1; i >= 0; i--) {
    const p = prev[i].obj.facts[factRef];
    if (!p || p.value <= 0) continue;
    const r = c.value / p.value;
    const name = `${prev[i].obj.names.display} (stop ${prev[i].stopNumber})`;
    if (r > 0.9 && r < 1.1) return `About the same as ${name}.`;
    const times = `${fmtSig(r >= 1 ? r : 1 / r)} times ${word}`;
    // Always phrase as "N times more", never "N times less": flip the sentence when this stop is the smaller one.
    return r >= 1 ? `About ${times} than ${name}.` : `${name} is about ${times}.`;
  }
  return null;
}

// ───────────────────────────── temperature & blackbody colour ─────────────────────────────

/** Asymmetric Gaussian lobe used by the Wyman–Sloan–Shirley CMF fit. */
function lobe(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
/** CIE 1931 2° colour-matching functions, multi-lobe fit (Wyman, Sloan & Shirley 2013). */
export function cie1931(lambdaNm: number): [number, number, number] {
  const l = lambdaNm;
  const x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}

const srgbEncode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Display colour of a blackbody at `teffK` (sRGB, D65 white, brightest channel = 255). This is the colour of
 * the light itself, normalised in brightness; a faint star looks white to the eye whatever its temperature.
 */
export function blackbodyRgb(teffK: number): [number, number, number] {
  const T = Math.max(1000, Math.min(40_000, teffK));
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const m = l * 1e-9;
    const planck = 1 / (m ** 5 * Math.expm1(1.438776877e-2 / (m * T)));
    const [x, y, z] = cie1931(l);
    X += planck * x; Y += planck * y; Z += planck * z;
  }
  const lin = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ].map((c) => Math.max(0, c));
  const max = Math.max(...lin);
  return lin.map((c) => Math.round(255 * srgbEncode(c / max))) as [number, number, number];
}

export function blackbodyHex(teffK: number): string {
  return `#${blackbodyRgb(teffK).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Colour word for the swatch label (bands match the narration bank's compare.temperature.sun bands). */
export function temperatureWord(teffK: number): string {
  if (teffK < 3700) return 'orange-red';
  if (teffK < 5200) return 'orange';
  if (teffK < 6500) return 'yellow-white';
  if (teffK < 10_000) return 'white';
  return 'blue-white';
}

/** Ballesteros (2012) B−V → Teff, as in lib/stellar-appearance.ts. */
export function teffFromBV(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}
/** Inverse of Ballesteros (monotonic for B−V in −0.4..2.5), by bisection. */
export function bvFromTeff(teffK: number): number {
  let lo = -0.4, hi = 2.5;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (teffFromBV(mid) > teffK) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

/** Position 0..1 on the doc 02 log temperature bar (2,500–40,000 K), hot on the LEFT (HR convention). */
export const TEMP_BAR = { minK: 2500, maxK: 40_000 } as const;
export function temperatureBarPosition(teffK: number): number {
  const t = Math.max(TEMP_BAR.minK, Math.min(TEMP_BAR.maxK, teffK));
  return 1 - Math.log(t / TEMP_BAR.minK) / Math.log(TEMP_BAR.maxK / TEMP_BAR.minK);
}

/** Teff for the swatch: the fact, else from B−V. */
export function objectTeff(obj: Pick<KbObject, 'facts'>): number | null {
  if (obj.facts.teffK) return obj.facts.teffK.value;
  if (obj.facts.bv) return teffFromBV(obj.facts.bv.value);
  return null;
}

// ───────────────────────────── HR diagram ─────────────────────────────

export const HR_DOMAIN = { bvMin: -0.4, bvMax: 2.0, mvMin: -9, mvMax: 15 } as const;

/** Columnar hr-background.json (script/journeys/build_stars_auto.py). */
export interface HrBackgroundFile { version?: string; count?: number; hr?: number[]; bv: (number | null)[]; absMagV: (number | null)[] }
export interface HrCell { i: number; j: number; count: number }
export interface HrGrid { bvStep: number; mvStep: number; cells: HrCell[]; maxCount: number; source: 'file' | 'builtin' }

const BV_STEP = 0.1, MV_STEP = 1.0;

/** Bin a background into the coarse grid the mini-plot draws (cells with ≥ minCount stars). */
export function binHrBackground(data: HrBackgroundFile, minCount = 3): HrGrid {
  const counts = new Map<number, number>();
  const nI = Math.round((HR_DOMAIN.bvMax - HR_DOMAIN.bvMin) / BV_STEP), nJ = Math.round((HR_DOMAIN.mvMax - HR_DOMAIN.mvMin) / MV_STEP);
  const n = Math.min(data.bv.length, data.absMagV.length);
  for (let k = 0; k < n; k++) {
    const bv = data.bv[k], mv = data.absMagV[k];
    if (bv === null || mv === null || !Number.isFinite(bv) || !Number.isFinite(mv)) continue;
    const i = Math.floor((bv - HR_DOMAIN.bvMin) / BV_STEP + 1e-9), j = Math.floor((mv - HR_DOMAIN.mvMin) / MV_STEP + 1e-9);
    if (i < 0 || i >= nI || j < 0 || j >= nJ) continue;
    counts.set(i * 100 + j, (counts.get(i * 100 + j) ?? 0) + 1);
  }
  const cells: HrCell[] = [];
  counts.forEach((count, key) => { if (count >= minCount) cells.push({ i: Math.floor(key / 100), j: key % 100, count }); });
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return { bvStep: BV_STEP, mvStep: MV_STEP, cells, maxCount: Math.max(1, ...cells.map((c) => c.count)), source: 'file' };
}

/**
 * Built-in fallback: hr-background.json (8,451 BSC stars, version 2026-11-01) binned at 0.1 mag in B−V × 1 mag in
 * M_V, cells with ≥3 stars, as flat [i, j, count] triples. Used when the file is missing or offline-uncached.
 */
const BUILTIN_HR = '1,4,3,1,5,18,1,6,28,1,7,5,2,4,5,2,5,58,2,6,117,2,7,221,2,8,165,2,9,34,3,3,3,3,4,13,3,5,20,3,6,69,3,7,185,3,8,323,3,9,328,3,10,53,4,3,5,4,4,12,4,5,17,4,6,19,4,7,55,4,8,184,4,9,292,4,10,243,5,3,8,5,4,10,5,5,10,5,7,13,5,8,37,5,9,147,5,10,229,5,11,46,6,2,4,6,3,12,6,4,11,6,6,6,6,7,9,6,8,13,6,9,106,6,10,191,6,11,176,7,3,7,7,4,7,7,5,5,7,7,6,7,8,5,7,9,23,7,10,89,7,11,200,7,12,51,8,3,3,8,4,3,8,5,8,8,7,4,8,8,3,8,9,9,8,10,76,8,11,165,8,12,170,8,13,9,9,3,4,9,4,6,9,5,6,9,7,3,9,8,7,9,9,4,9,10,15,9,11,67,9,12,104,9,13,70,10,3,4,10,4,3,10,5,8,10,6,6,10,7,5,10,8,5,10,9,13,10,10,4,10,11,15,10,12,49,10,13,74,10,14,11,11,5,5,11,6,6,11,7,5,11,8,7,11,9,9,11,10,7,11,11,8,11,12,16,11,13,15,11,14,25,12,5,8,12,6,6,12,7,12,12,8,40,12,9,66,12,10,18,12,11,12,12,12,10,12,14,15,12,15,9,13,5,7,13,6,9,13,7,19,13,8,83,13,9,387,13,10,91,13,11,30,13,12,11,13,15,4,14,5,4,14,6,14,14,7,29,14,8,73,14,9,343,14,10,89,14,11,20,14,15,4,15,5,3,15,6,19,15,7,31,15,8,100,15,9,227,15,10,77,15,11,4,16,4,4,16,5,4,16,6,15,16,7,26,16,8,119,16,9,96,16,10,27,17,5,4,17,6,22,17,7,44,17,8,141,17,9,62,17,10,6,18,5,11,18,6,24,18,7,57,18,8,158,18,9,30,19,5,11,19,6,17,19,7,97,19,8,178,19,9,17,20,4,4,20,5,11,20,6,30,20,7,193,20,8,81,20,9,3,21,4,5,21,5,8,21,6,10,21,7,23,21,8,12,22,5,7,22,6,5,22,7,9';

export function builtinHrGrid(): HrGrid {
  const v = BUILTIN_HR.split(',').map(Number);
  const cells: HrCell[] = [];
  for (let k = 0; k + 2 < v.length; k += 3) cells.push({ i: v[k], j: v[k + 1], count: v[k + 2] });
  return { bvStep: BV_STEP, mvStep: MV_STEP, cells, maxCount: Math.max(...cells.map((c) => c.count)), source: 'builtin' };
}

/** Pecaut & Mamajek 2013 dwarf sequence (B−V, M_V) from O9V to M5V: the labelled main-sequence line. */
export const MAIN_SEQUENCE_LINE: readonly [number, number][] = [
  [-0.312, -4.2], [-0.301, -3.9], [-0.215, -1.8], [-0.156, -0.85], [-0.109, 0.0], [0.0, 0.99], [0.07, 1.35],
  [0.16, 2.01], [0.295, 2.57], [0.37, 2.97], [0.44, 3.37], [0.595, 4.48], [0.65, 4.8], [0.68, 4.98],
  [0.816, 5.78], [0.884, 6.07], [1.15, 7.28], [1.42, 8.8], [1.505, 10.21], [1.65, 12.61], [1.83, 14.15],
];

export interface HrBox { x: number; y: number; width: number; height: number }

/** Map (B−V, M_V) to plot coordinates: hot (blue) left, luminous up. Clamped to the box. */
export function hrProject(bv: number, mv: number, box: HrBox): { x: number; y: number; clamped: boolean } {
  const fx = (bv - HR_DOMAIN.bvMin) / (HR_DOMAIN.bvMax - HR_DOMAIN.bvMin);
  const fy = (mv - HR_DOMAIN.mvMin) / (HR_DOMAIN.mvMax - HR_DOMAIN.mvMin);
  const cx = Math.max(0, Math.min(1, fx)), cy = Math.max(0, Math.min(1, fy));
  return { x: box.x + cx * box.width, y: box.y + cy * box.height, clamped: cx !== fx || cy !== fy };
}

/** Absolute visual magnitude: fact, else apparent magnitude + distance, else luminosity (bolometric ≈ visual). */
export function objectAbsMag(obj: Pick<KbObject, 'facts' | 'mag'>): number | null {
  if (obj.facts.absMagV) return obj.facts.absMagV.value;
  const d = obj.facts.distanceLy?.value;
  if (obj.mag !== null && d && d > 0) return obj.mag - 5 * Math.log10(d / 3.26156 / 10);
  if (obj.facts.lumLsun) return 4.74 - 2.5 * Math.log10(obj.facts.lumLsun.value);
  return null;
}

export function objectBV(obj: Pick<KbObject, 'facts'>): number | null {
  if (obj.facts.bv) return obj.facts.bv.value;
  if (obj.facts.teffK) return bvFromTeff(obj.facts.teffK.value);
  return null;
}

export interface HrMarker { id: string; label: string; stopNumber: number; bv: number; mv: number; current: boolean }

/**
 * HR markers for the current star and the earlier STAR stops of the journey (numbered by stop order).
 * Objects without a usable colour or absolute magnitude are skipped.
 */
export function hrMarkers(current: KbObject, prev: { obj: KbObject; stopNumber: number }[], currentStopNumber: number): HrMarker[] {
  const out: HrMarker[] = [];
  for (const p of prev) {
    if (p.obj.kind !== 'star') continue;
    const bv = objectBV(p.obj), mv = objectAbsMag(p.obj);
    if (bv === null || mv === null) continue;
    out.push({ id: p.obj.id, label: p.obj.names.display, stopNumber: p.stopNumber, bv, mv, current: false });
  }
  if (current.kind === 'star') {
    const bv = objectBV(current), mv = objectAbsMag(current);
    if (bv !== null && mv !== null) out.push({ id: current.id, label: current.names.display, stopNumber: currentStopNumber, bv, mv, current: true });
  }
  return out;
}

/** Ticks for the temperature axis: B−V positions labelled in kelvin. */
export function hrTemperatureTicks(): { bv: number; label: string }[] {
  return [20_000, 10_000, 6000, 4000, 3000].map((t) => ({ bv: bvFromTeff(t), label: `${fmtSig(t)} K` }));
}

// ───────────────────────────── size comparison ─────────────────────────────

export interface SizeCircle { id: string; label: string; radiusRsun: number; rPx: number; marble: string; kind: 'sun' | 'object' | 'previous' | 'planet' }
export interface SizeRing { id: string; label: string; radiusRsun: number; rPx: number }
export interface SizeModel {
  mode: 'nested' | 'bar';
  circles: SizeCircle[];
  rings: SizeRing[];
  /** Bar mode: two (or three) items on a broken linear axis. */
  bar?: { label: string; marble: string; radiusRsun: number }[];
  /** "If the Sun were a 1 cm marble, Betelgeuse would be about 15 m across." */
  marbleSentence: string;
  scaleNote: string;
}

/**
 * Star size comparison on the shared marble scale (doc 06 §7.2 item 2, doc 02 §6.3). Nested circles to a linear
 * scale while the largest:smallest ratio is below 300 (Sun drawn to scale); beyond that, the bar form. Giants
 * get planetary orbit rings (Earth/Mars/Jupiter) up to the first ring outside the star; dwarfs compare with
 * Earth and Jupiter.
 */
export const GIANT_RING_MIN_RSUN = 40;
export function sizeComparisonModel(obj: { id: string; name: string; radiusRsun: number }, prev: { id: string; name: string; radiusRsun: number } | null, maxPx = 70): SizeModel {
  const R = obj.radiusRsun;
  const marble = (r: number) => formatMarbleLength(r); // diameter in cm = radius in R☉
  const marbleSentence = `If the Sun were a 1 cm marble, ${obj.name} would be about ${marble(R)} across.`;
  const circles: SizeCircle[] = [];
  const rings: SizeRing[] = [];
  if (R < 0.1) {
    // White dwarfs, neutron stars: Earth and Jupiter as the yardsticks, Sun as an arc.
    const items = [
      { id: 'jupiter', label: 'Jupiter', radiusRsun: BODIES_RSUN.jupiter, kind: 'planet' as const },
      { id: 'earth', label: 'Earth', radiusRsun: BODIES_RSUN.earth, kind: 'planet' as const },
      { id: obj.id, label: obj.name, radiusRsun: R, kind: 'object' as const },
    ];
    const big = Math.max(...items.map((i) => i.radiusRsun));
    for (const it of items) circles.push({ ...it, rPx: (it.radiusRsun / big) * maxPx, marble: marble(it.radiusRsun) });
    return { mode: 'nested', circles, rings, marbleSentence, scaleNote: 'Linear scale. The Sun would be about 10 times wider than Jupiter.' };
  }
  // Orbit rings only for giants big enough that Earth's orbit is a useful yardstick (R ≥ 40 R☉, ~1/5 AU).
  const giant = R >= GIANT_RING_MIN_RSUN;
  const outerRing = giant ? ORBITS_RSUN.find((o) => o.radiusRsun > R) : undefined;
  const ringList = giant ? ORBITS_RSUN.filter((o) => o.radiusRsun <= R * 1.0001 || o === outerRing) : [];
  const sizes = [1, R, ...(prev ? [prev.radiusRsun] : []), ...ringList.map((o) => o.radiusRsun)];
  const big = Math.max(...sizes);
  const ratio = big / Math.min(1, R, prev?.radiusRsun ?? Infinity);
  const px = (r: number) => (r / big) * maxPx;
  if (ratio >= 300 && !ringList.length) {
    const bar = [{ label: 'Sun', marble: marble(1), radiusRsun: 1 }, ...(prev ? [{ label: prev.name, marble: marble(prev.radiusRsun), radiusRsun: prev.radiusRsun }] : []), { label: obj.name, marble: marble(R), radiusRsun: R }];
    return { mode: 'bar', circles, rings, bar, marbleSentence, scaleNote: 'Bar lengths on a broken linear axis.' };
  }
  circles.push({ id: 'sun', label: 'Sun', radiusRsun: 1, rPx: px(1), marble: marble(1), kind: 'sun' });
  if (prev && prev.id !== obj.id) circles.push({ id: prev.id, label: prev.name, radiusRsun: prev.radiusRsun, rPx: px(prev.radiusRsun), marble: marble(prev.radiusRsun), kind: 'previous' });
  circles.push({ id: obj.id, label: obj.name, radiusRsun: R, rPx: px(R), marble: marble(R), kind: 'object' });
  for (const o of ringList) rings.push({ id: o.id, label: o.label, radiusRsun: o.radiusRsun, rPx: px(o.radiusRsun) });
  const sunPx = px(1);
  const scaleNote = ringList.length
    ? `Linear scale, centered where the Sun would be.${sunPx < 1 ? ' The Sun is far smaller than one pixel here.' : ''}`
    : 'Linear scale; circles share one center line.';
  return { mode: 'nested', circles, rings, marbleSentence, scaleNote };
}

/** Deep-sky physical size on the light-year scale, compared with the Sun–nearest-star gap (Proxima 4.2 ly). */
export const NEAREST_STAR_LY = 4.25;
export function cloudSizeModel(obj: { name: string; sizeLy: number }, prev: { name: string; sizeLy: number } | null): { items: { label: string; ly: number; frac: number; marble: string }[]; sentence: string } {
  const items = [
    { label: 'Sun to nearest star', ly: NEAREST_STAR_LY },
    ...(prev ? [{ label: prev.name, ly: prev.sizeLy }] : []),
    { label: obj.name, ly: obj.sizeLy },
  ];
  const max = Math.max(...items.map((i) => i.ly));
  return {
    items: items.map((i) => ({ ...i, frac: i.ly / max, marble: `${fmtLarge(roundSig(i.ly * MARBLE_KM_PER_LY, 2))} km` })),
    sentence: `${obj.name} is about ${fmtSig(obj.sizeLy / NEAREST_STAR_LY)} times the gap between the Sun and its nearest neighbor star.`,
  };
}

// ───────────────────────────── light curve ─────────────────────────────

export type LightCurveShape = Extract<KbVisual, { type: 'light-curve' }>['shape'];

export function lightCurveShapeFor(cls: VariabilityClass | undefined): LightCurveShape | null {
  switch (cls) {
    case 'eclipsing-algol': case 'eclipsing-beta-lyrae': case 'eclipsing-long-period': return 'eclipsing';
    case 'cepheid': case 'rr-lyrae': case 'delta-scuti': case 'beta-cephei': return 'pulsating';
    case 'mira': return 'mira';
    case 'r-crb': return 'fading';
    case 'recurrent-nova': case 'dwarf-nova': return 'nova';
    case 'semiregular': case 'irregular': case 'rv-tauri': case 'gamma-cas-be': case 'lbv': case 'yellow-hypergiant':
    case 'young-stellar-object': case 'alpha2-cvn': case 'rotational': return 'irregular';
    default: return null;
  }
}

/** Deterministic 0..1 pseudo-random sequence (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Normalised brightness 0 (faintest, vMin) .. 1 (brightest, vMax) at phase t (cycles, may exceed 1).
 * Shapes are schematic ("typical shape, not a forecast"): Algol-type dip ≈ 14 % of the cycle (10 h of 69 h);
 * Cepheid rise 25 % of the period; Mira a near-sinusoid with a 45 % rise.
 */
export function lightCurveValue(shape: LightCurveShape, t: number, opts: { seed?: number; betaLyrae?: boolean } = {}): number {
  const ph = t - Math.floor(t);
  switch (shape) {
    case 'eclipsing': {
      if (opts.betaLyrae) {
        // Continuous variation (β Lyr type): primary minimum at phase 0, shallower secondary at 0.5.
        const m = (1 + Math.cos(4 * Math.PI * ph)) / 2;
        const w = 0.8 + 0.2 * Math.cos(2 * Math.PI * ph);
        return 1 - m * w;
      }
      const w = 0.07; // half-width of the primary eclipse in phase
      const d = Math.min(ph, 1 - ph);
      if (d >= w) return 1;
      const flat = 0.005; // brief minimum
      return d <= flat ? 0 : (d - flat) / (w - flat);
    }
    case 'pulsating': {
      const rise = 0.25;
      return ph < rise ? 0.5 - 0.5 * Math.cos(Math.PI * ph / rise) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - rise) / (1 - rise));
    }
    case 'mira': {
      const rise = 0.45;
      return ph < rise ? 0.5 - 0.5 * Math.cos(Math.PI * ph / rise) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - rise) / (1 - rise));
    }
    case 'fading': {
      // Long at maximum, a sudden drop (≈ 3 % of the window), slow recovery.
      if (ph < 0.3) return 1;
      if (ph < 0.33) return 1 - (ph - 0.3) / 0.03;
      return Math.min(1, ((ph - 0.33) / 0.67) ** 1.6);
    }
    case 'nova': {
      if (ph < 0.2) return 0;
      if (ph < 0.23) return (ph - 0.2) / 0.03;
      return Math.exp(-(ph - 0.23) * 9);
    }
    case 'irregular':
    default: {
      // Smooth value noise between 0.15 and 0.95 so it never looks periodic.
      const r = rng(opts.seed ?? 1);
      const knots = Array.from({ length: 12 }, () => 0.15 + 0.8 * r());
      const x = (t / 3) * 11, i = Math.max(0, Math.min(10, Math.floor(x))), f = x - i;
      const s = f * f * (3 - 2 * f);
      return knots[i] * (1 - s) + knots[i + 1] * s;
    }
  }
}

export interface LightCurveModel {
  shape: LightCurveShape;
  points: { x: number; y: number }[];
  /** SVG path in the given box. */
  d: string;
  cycles: number;
  xLabel: string;
  yTop: string;
  yBottom: string;
  caption: string;
}

/** Schematic light curve in a box (brighter is UP; axis labels carry the true range and period). */
export function lightCurveModel(shape: LightCurveShape, v: { vMax?: number; vMin?: number; periodDays?: number; seed?: number; betaLyrae?: boolean },
  box: HrBox, samples = 160): LightCurveModel {
  const cycles = shape === 'irregular' || shape === 'fading' || shape === 'nova' ? 3 : 2;
  const points: { x: number; y: number }[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = (k / samples) * cycles;
    const b = Math.max(0, Math.min(1, lightCurveValue(shape, shape === 'fading' || shape === 'nova' ? t / cycles : t, { seed: v.seed, betaLyrae: v.betaLyrae })));
    points.push({ x: box.x + (k / samples) * box.width, y: box.y + (1 - b) * box.height });
  }
  const d = points.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const P = v.periodDays;
  const xLabel = P && (shape === 'eclipsing' || shape === 'pulsating' || shape === 'mira')
    ? `time → (${cycles} cycles of ${P < 1 ? `${fmtSig(P * 24)} hours` : `${fmtSig(P, 3)} days`})`
    : shape === 'fading' ? 'time → (months to years)' : shape === 'nova' ? 'time → (weeks to months)' : P ? `time → (roughly ${fmtSig(P)}-day swings, irregular)` : 'time → (irregular)';
  const yTop = v.vMax !== undefined ? `brighter · mag ${v.vMax.toFixed(1)}` : 'brighter';
  const yBottom = v.vMin !== undefined ? `fainter · mag ${v.vMin.toFixed(1)}` : 'fainter';
  return { shape, points, d, cycles, xLabel, yTop, yBottom, caption: 'Typical shape, not a forecast.' };
}

// ───────────────────────────── distance ladder ─────────────────────────────

export const LADDER_DOMAIN = { minLy: 1, maxLy: 1e7 } as const;
export const LADDER_LANDMARKS = [
  { id: 'sirius', label: 'Sirius', ly: 8.6, refId: 'hip2007' },
  { id: 'galactic-centre', label: 'Galactic center', ly: 26_700, refId: 'gravity2019' },
  { id: 'andromeda', label: 'Andromeda', ly: 2.5e6, refId: 'nasaM31' },
] as const;

/** 0..1 along the log ladder. */
export function ladderPosition(ly: number): number {
  const v = Math.max(LADDER_DOMAIN.minLy, Math.min(LADDER_DOMAIN.maxLy, ly));
  return Math.log10(v / LADDER_DOMAIN.minLy) / Math.log10(LADDER_DOMAIN.maxLy / LADDER_DOMAIN.minLy);
}

export interface LadderStop { id: string; stopNumber: number; name: string; ly: number; pos: number; lightLeft: string; current: boolean; row: number }

/** Journey stops with a distance, positioned on the log ladder; labels staggered into rows to avoid overlap. */
export function distanceLadderModel(stops: { obj: Pick<KbObject, 'id' | 'names' | 'facts'>; stopNumber: number }[], refYear: number, currentStopNumber?: number): { stops: LadderStop[]; ticks: { ly: number; pos: number; label: string }[]; landmarks: { id: string; label: string; ly: number; pos: number }[] } {
  const out: LadderStop[] = [];
  for (const s of stops) {
    const f = s.obj.facts.distanceLy;
    if (!f) continue;
    out.push({ id: s.obj.id, stopNumber: s.stopNumber, name: s.obj.names.display, ly: f.value, pos: ladderPosition(f.value), lightLeft: lightLeft(f.value, refYear, relativeUncertainty(f)).short, current: s.stopNumber === currentStopNumber, row: 0 });
  }
  const sorted = [...out].sort((a, b) => a.pos - b.pos);
  const lastPosInRow: number[] = [];
  for (const s of sorted) {
    let row = 0;
    while (lastPosInRow[row] !== undefined && s.pos - lastPosInRow[row] < 0.12) row++;
    s.row = row; lastPosInRow[row] = s.pos;
  }
  const ticks = [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7].map((ly) => ({ ly, pos: ladderPosition(ly), label: ly >= 1e6 ? `${ly / 1e6}M` : ly >= 1000 ? `${ly / 1000}k` : String(ly) }));
  return { stops: out, ticks, landmarks: LADDER_LANDMARKS.map((l) => ({ id: l.id, label: l.label, ly: l.ly, pos: ladderPosition(l.ly) })) };
}

// ───────────────────────────── cluster age bar ─────────────────────────────

export const AGE_DOMAIN = { minMyr: 0.1, maxMyr: 13_787 } as const;
export const AGE_LANDMARKS = [
  { id: 'dinosaurs', label: 'Dinosaurs die out', ageMyr: 66, refId: 'renne2013' },
  { id: 'sun', label: 'Sun’s age', ageMyr: 4568, refId: 'bouvier2010' },
  { id: 'universe', label: 'Universe', ageMyr: 13_787, refId: 'planck2018' },
] as const;

export function agePosition(ageMyr: number): number {
  const v = Math.max(AGE_DOMAIN.minMyr, Math.min(AGE_DOMAIN.maxMyr, ageMyr));
  return Math.log10(v / AGE_DOMAIN.minMyr) / Math.log10(AGE_DOMAIN.maxMyr / AGE_DOMAIN.minMyr);
}

export interface AgeMarker { id: string; stopNumber: number; name: string; ageMyr: number; pos: number; minPos?: number; maxPos?: number; current: boolean; label: string }

export function ageBarModel(stops: { obj: Pick<KbObject, 'id' | 'names' | 'facts'>; stopNumber: number }[], currentStopNumber: number): { markers: AgeMarker[]; landmarks: { id: string; label: string; ageMyr: number; pos: number }[]; ticks: { pos: number; label: string }[]; sunDay: string | null } {
  const markers: AgeMarker[] = [];
  let sunDay: string | null = null;
  for (const s of stops) {
    const f = s.obj.facts.ageMyr;
    if (!f) continue;
    const current = s.stopNumber === currentStopNumber;
    if (current) sunDay = formatSunDay(f.value);
    markers.push({ id: s.obj.id, stopNumber: s.stopNumber, name: s.obj.names.display, ageMyr: f.value, pos: agePosition(f.value), minPos: f.min !== undefined ? agePosition(f.min) : undefined, maxPos: f.max !== undefined ? agePosition(f.max) : undefined, current, label: formatAgeMyr(f.value) });
  }
  const ticks = [0.1, 1, 10, 100, 1000, 10_000].map((m) => ({ pos: agePosition(m), label: m >= 1000 ? `${m / 1000} Gyr` : m >= 1 ? `${m} Myr` : `${m * 1e3}k yr` }));
  return { markers, landmarks: AGE_LANDMARKS.map((l) => ({ id: l.id, label: l.label, ageMyr: l.ageMyr, pos: agePosition(l.ageMyr) })), ticks, sunDay };
}

// ───────────────────────────── card assembly helpers ─────────────────────────────

/** Calendar year of the stop (light-left labels). Falls back to 2026 only if the ISO string is unparsable. */
export function stopYear(iso: string | undefined): number {
  const y = iso ? Number(iso.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1000 ? y : 2026;
}

export function compass8(azDeg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
}

/** Which in-app visuals a stop card shows, in display order (doc 06 §7.2; spec 11). */
export type VisualKind = 'temperature-swatch' | 'hr-diagram' | 'size-comparison' | 'cloud-size' | 'light-curve' | 'age-bar' | 'distance-ladder';
export function visualsFor(obj: KbObject): VisualKind[] {
  const declared = new Set(obj.media.visuals.map((v) => v.type));
  const out: VisualKind[] = [];
  if (obj.kind === 'star') {
    if (objectTeff(obj) !== null) out.push('temperature-swatch');
    if (objectBV(obj) !== null && objectAbsMag(obj) !== null) out.push('hr-diagram');
    if (obj.facts.radiusRsun) out.push('size-comparison');
    if ((obj as StarObject).variability || declared.has('light-curve')) out.push('light-curve');
  } else {
    if (obj.facts.sizeLy) out.push('cloud-size');
    if (obj.facts.ageMyr && obj.evoStage !== 8) out.push('age-bar');
  }
  if (obj.facts.distanceLy) out.push('distance-ladder');
  return out;
}

/** References the visuals on screen rely on (shown under Sources next to the KB sources). */
export function visualReferenceIds(kinds: VisualKind[]): string[] {
  const ids = new Set<string>();
  for (const k of kinds) {
    if (k === 'temperature-swatch') ['iau2015', 'wyman2013', 'charityBlackbody'].forEach((i) => ids.add(i));
    if (k === 'hr-diagram') ['hrBackground', 'pecautMamajek2013', 'willmer2018'].forEach((i) => ids.add(i));
    if (k === 'size-comparison') ['iau2015', 'nasaFactSheet'].forEach((i) => ids.add(i));
    if (k === 'light-curve') ['delCepGuide', 'algolSnT'].forEach((i) => ids.add(i));
    if (k === 'distance-ladder') ['hip2007', 'gravity2019', 'nasaM31'].forEach((i) => ids.add(i));
    if (k === 'age-bar') ['bouvier2010', 'renne2013', 'planck2018'].forEach((i) => ids.add(i));
  }
  return Array.from(ids);
}

/** Resolve the sources cited by an object (+ visual references) for the Sources list. */
export function cardSources(obj: KbObject, sources: Source[], visualRefIds: string[]): { id: string; title: string; url: string; citation?: string }[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ids = new Set<string>(obj.sources);
  for (const f of Object.values(obj.facts)) if (f) ids.add(f.sourceId);
  const out: { id: string; title: string; url: string; citation?: string }[] = [];
  ids.forEach((id) => { const s = byId.get(id); if (s) out.push({ id: s.id, title: s.title, url: s.url, citation: s.citation }); });
  for (const id of visualRefIds) { const r = VISUAL_REFERENCES[id]; if (r && !out.some((o) => o.url === r.url)) out.push({ id: r.id, title: r.title, url: r.url, citation: r.citation }); }
  return out;
}
