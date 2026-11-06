/**
 * The shared sky model (r5): one place for "is this object observable now, and how much does the Moon hurt?".
 * Journeys (lib/journeys), the Planner sequence (session-planner.ts), Tonight's Best (observing.ts rankTonight),
 * the Moon tab (moon.ts targetMoonlight) and the membership/hop UIs all read their limits here, so one object never
 * gets two answers from two tabs.
 *
 * Two named rules, because the tabs ask two different questions (callers must name the one they use):
 *
 *   "possible"     Can it be seen at all? Planner sequence, Tonight ranking, Star hop's low-sky warning.
 *                  Altitude ≥ 15°; Sun ≤ −6° (civil dusk) for a bright stellar object (mag ≤ 5), else ≤ −18°.
 *   "comfortable"  A good view worth a story stop: Journeys, journey membership, Star hop's "well placed".
 *                  Altitude ≥ 30° (the user may lower it to 20°; the engine fallback never below 25°);
 *                  Sun ≤ −12° (nautical) for stars, ≤ −18° (astronomical night) for deep-sky objects.
 *
 * The Moon (one verdict, `moonVerdict`): K–S scattered moonlight (Krisciunas & Schaefer 1991, moon.ts) measured
 * against a sky no darker than GLOW_REFERENCE_SKY, a per-category glow limit, and a phase-scaled separation floor.
 * The journey engine's values are unchanged by this module (golden tests: sky-feasibility.test.ts and
 * journeys/__tests__/engine.golden-r5.test.ts).
 */
import { angularDistance } from "./astronomy";
import { MOONLIGHT_LEVELS, moonlightLevel, scatteredMoonlight, type MoonlightLevel, type MoonState } from "./moon";

export { MOONLIGHT_LEVELS, moonlightLevel, type MoonlightLevel };

// ───────────────────────────── altitude ─────────────────────────────

export type VisibilityRule = "possible" | "comfortable";

export const MIN_ALT = {
  /** Lowest altitude the Planner schedules a deep-sky object or star at, and Tonight's ranking accepts. */
  possible: 15,
  /** Journeys' default stop altitude and the "well placed" line for star hops and journey membership. */
  comfortable: 30,
  /** Lowest altitude a user may set for journeys (spec decision 4). */
  journeyFloor: 20,
  /** The journey engine's own fallback never lowers the floor below this (doc 05 §5.8). */
  journeyFallback: 25,
  /** Lunar features (the Moon itself is bright enough low down). */
  lunar: 5,
} as const;

/** Minimum altitude (degrees) of a rule. */
export const minAltitude = (rule: VisibilityRule): number => MIN_ALT[rule];

// ───────────────────────────── twilight ─────────────────────────────

/**
 * Sun altitude limits (degrees, at the Sun's centre). Twilight bands: civil 0…−6°, nautical −6…−12°, astronomical
 * −12…−18°, night below −18° (USNO definitions as summarised by NOAA/NWS, https://www.weather.gov/lmk/twilight-types).
 */
export const TWILIGHT = { civil: -6, nautical: -12, astronomical: -18 } as const;
/** "possible": a stellar object at least this bright shows in civil twilight. */
export const BRIGHT_STELLAR_MAG = 5;

/** What the twilight rule needs to know about an object. `stellar`: a star, double or asterism (point-like light). */
export interface TwilightSubject { stellar: boolean; mag: number | null }

/** Highest Sun altitude at which the object is still observable under the rule. */
export function twilightLimit(o: TwilightSubject, rule: VisibilityRule): number {
  if (rule === "comfortable") return o.stellar ? TWILIGHT.nautical : TWILIGHT.astronomical;
  return o.stellar && o.mag !== null && o.mag <= BRIGHT_STELLAR_MAG ? TWILIGHT.civil : TWILIGHT.astronomical;
}
export const darkEnough = (sunAlt: number, o: TwilightSubject, rule: VisibilityRule) => sunAlt <= twilightLimit(o, rule);

/** Unified-catalog category → stellar for the twilight rule (Planner's historical test: star or asterism). */
export const isStellarCategory = (category: string) => /star|asterism/i.test(category);
/** Unified-catalog category → diffuse light the Moon washes out first (galaxies, nebulae, star clouds). */
export const isDiffuseCategory = (category: string) => /galaxy|nebula|cloud/i.test(category);

// ───────────────────────────── the Moon ─────────────────────────────

/**
 * K–S moonlight brightening limits (mag) per category (journeys doc 05 §5.2). The Krisciunas & Schaefer (1991, PASP
 * 103, 1033) model is good to roughly 8–23 % (≈0.1–0.25 mag) in V, and later photometry (e.g. arXiv:2205.07773,
 * SAAO) finds the real moonlit sky often brighter than predicted, so these limits are kept deliberately tight for
 * diffuse objects; they are guidance, not a guarantee.
 */
export const GLOW_LIMIT = { diffuse: 0.7, cluster: 1.2, star: 2.5 } as const;
export type MoonCategory = keyof typeof GLOW_LIMIT;
/**
 * The moonlight limits are measured against a sky no darker than this (mag/arcsec², a rural sky). K–S brightening
 * is relative: the same Moon brightens a 21.5 mag/arcsec² site by ~2 mag more than a 19.0 city sky, yet the moonlit
 * dark site is still the darker sky. Measured against the site's own baseline the full Moon emptied every journey at
 * a dark site while the city next door kept three (journeys P4 evaluation).
 */
export const GLOW_REFERENCE_SKY = 20.0;
/** Separation floor: max(MOON_SEPARATION.min, base + perIllumination·illumination) degrees (doc 05 §5.2). */
export const MOON_SEPARATION = { min: 15, base: 10, perIllumination: 30 } as const;

/** Moon disc (any part) above the horizon. */
export const moonIsUp = (m: Pick<MoonState, "alt" | "diameter">) => m.alt > -m.diameter / 2;

/** Moonlight brightening (mag) used by the glow limits: K–S against min(site sky, GLOW_REFERENCE_SKY). */
export function moonGlow(moon: MoonState, targetAlt: number, separation: number, sky: number): number {
  return scatteredMoonlight(moon, targetAlt, separation, Math.min(sky, GLOW_REFERENCE_SKY)).brightening;
}

/** Minimum Moon distance, scaled with phase: max(15°, 10° + 30°·illumination). */
export function moonMinSeparation(illumination: number): number {
  return Math.max(MOON_SEPARATION.min, MOON_SEPARATION.base + MOON_SEPARATION.perIllumination * illumination);
}

/** Moon category of a unified-catalog target: diffuse (galaxy/nebula/cloud) first, then stellar, else cluster. */
export function moonCategoryOfCategory(category: string): MoonCategory {
  return isDiffuseCategory(category) ? "diffuse" : isStellarCategory(category) ? "star" : "cluster";
}

export interface MoonVerdictTarget {
  /** Target altitude (degrees). */
  alt: number;
  category: MoonCategory;
  /** Moon separation (degrees); computed from ra/dec when absent. */
  separation?: number;
  ra?: number;
  dec?: number;
}
export interface MoonVerdict {
  moonUp: boolean;
  /** Target–Moon separation (degrees). */
  separation: number;
  /** Phase-scaled separation floor (degrees). */
  minSeparation: number;
  /** K–S brightening against min(site sky, GLOW_REFERENCE_SKY) (mag); 0 when the Moon is down. The limits read this. */
  glow: number;
  glowLimit: number;
  /** K–S brightening against the site's own sky (mag): what MoonlightCard and the Planner show. */
  brightening: number;
  tooClose: boolean;
  tooBright: boolean;
  /** Neither too close nor too bright (always true with the Moon down). */
  ok: boolean;
  /** Moon-tab wording of `brightening` ("Little moonlight" …). */
  level: MoonlightLevel;
}

/**
 * The one Moon verdict for an object at one instant: used by the journey engine (best window), Tonight's Best
 * (rankTonight), the Planner score and the Moon tab level. `sky` = site zenith sky brightness (mag/arcsec²).
 */
export function moonVerdict(target: MoonVerdictTarget, moon: MoonState, sky: number): MoonVerdict {
  const up = moonIsUp(moon);
  const separation = target.separation ?? angularDistance(target.ra ?? 0, target.dec ?? 0, moon.ra, moon.dec);
  const minSeparation = moonMinSeparation(moon.illumination);
  const glowLimit = GLOW_LIMIT[target.category];
  if (!up) return { moonUp: false, separation, minSeparation, glow: 0, glowLimit, brightening: 0, tooClose: false, tooBright: false, ok: true, level: moonlightLevel(0, false) };
  const brightening = scatteredMoonlight(moon, target.alt, separation, sky).brightening;
  const glow = sky <= GLOW_REFERENCE_SKY ? brightening : moonGlow(moon, target.alt, separation, sky);
  const tooClose = separation < minSeparation;
  const tooBright = glow > glowLimit;
  return { moonUp: true, separation, minSeparation, glow, glowLimit, brightening, tooClose, tooBright, ok: !tooClose && !tooBright, level: moonlightLevel(brightening, true) };
}

// ───────────────────────────── one call for "observable now?" ─────────────────────────────

export interface FeasibilityInput extends TwilightSubject {
  alt: number; category: MoonCategory; ra: number; dec: number;
  /** Local skyline in the target's direction: the GEOMETRIC altitude it must reach to clear it
   *  (lib/horizon/profile.ts horizonThresholdAt). Absent: flat horizon. */
  horizonAlt?: number;
}
export interface Feasibility {
  /** The rule's minimum altitude holds (a comfort limit, independent of the skyline). */
  altitudeOk: boolean;
  /** Behind the local skyline (always false without one). */
  obstructed: boolean;
  darkEnough: boolean; moon: MoonVerdict; ok: boolean;
}

/** Altitude, skyline, twilight and Moon under one rule: the minimum altitude and the skyline combine
 *  (alt ≥ max(minimum, skyline)). Twilight and moonlight stay flat. The engine checks the same over whole stop intervals. */
export function skyFeasibility(o: FeasibilityInput, moon: MoonState, sky: number, rule: VisibilityRule): Feasibility {
  const altitudeOk = o.alt >= minAltitude(rule);
  const obstructed = o.horizonAlt !== undefined && Number.isFinite(o.horizonAlt) && o.alt < o.horizonAlt;
  const dark = darkEnough(moon.sunAlt, o, rule);
  const verdict = moonVerdict(o, moon, sky);
  return { altitudeOk, obstructed, darkEnough: dark, moon: verdict, ok: altitudeOk && !obstructed && dark && verdict.ok };
}

// ───────────────────────────── Planner moon weighting ─────────────────────────────

/** Planner sequence score: altitude minus brightening × weight (diffuse light suffers most, bright stars least). */
export const PLANNER_MOON_WEIGHT = { diffuse: 14, brightStellar: 2, other: 6 } as const;
export function plannerMoonWeight(category: string, mag: number): number {
  if (isDiffuseCategory(category)) return PLANNER_MOON_WEIGHT.diffuse;
  return isStellarCategory(category) && mag <= BRIGHT_STELLAR_MAG ? PLANNER_MOON_WEIGHT.brightStellar : PLANNER_MOON_WEIGHT.other;
}
