/**
 * How rewarding an object is in binoculars — condition-independent, 0..10 — and the combined "Best tonight" value.
 *
 * Two dimensions, kept apart in the UI:
 *  - Reward ("How rewarding"): the object itself, in typical astronomy binoculars (7×50–15×70) under a dark rural sky
 *    with no Moon and the object high. Scale anchors: 10 = Pleiades, Double Cluster, M31, M42, Hyades, Mel 20;
 *    8–9 = M44, M7, Albireo, M13…; 6–7 = M35, M11, M27…; 4–5 = M81/M82, M33, M5…; 2–3 = M57, M51, M1; 0–1 = faint
 *    Virgo galaxies. Researched objects (reward-data.json, 297 entries) carry a score grounded in observer reports
 *    (Harrington, Seronik, Tonkin, Astronomical League lists, Cloudy Nights …); the evidence lives in
 *    docs/binocular-reward-sources.json and is never shown in the UI.
 *  - Tonight (./model.ts estimateVisibility): how well it is seen with tonight's sky, Moon and altitude.
 *
 * Objects without research (journey-only KB objects, future catalogs, user-added) get an ESTIMATE from a small linear
 * model fitted on the researched scores (script/fit-reward.ts → reward-model.json). Its features are physical and
 * computed from data the app already has: the visibility margin under a fixed dark-sky reference, integrated
 * brightness, apparent size vs the field (and a too-big penalty), how many cluster stars the binoculars resolve,
 * double-star split and colour contrast, single-star colour and variability, and the object class.
 *
 * Researched values dominate. Low-confidence research is shrunk toward the model (0.6 research + 0.4 model).
 * Optics: the model's change between the reference 10×50 and the user's binoculars is added at half weight, capped at
 * ±1 point (a tiny planetary gains a little at 15×70; a 4° cluster loses a little in a narrow 3° field).
 */
import type { UnifiedTarget } from '../astronomy';
import type { KbObject } from '../journeys/types';
import { extinctionForTransparency } from './conditions';
import { estimateBrightestStar, estimateVisibility } from './model';
import rewardData from './reward-data.json';
import rewardModel from './reward-model.json';
import { toVisibilityTarget } from './targets';
import type { Optics, SkyInputs, VisibilityLevel, VisibilityTarget } from './types';

export type RewardConfidence = 'high' | 'medium' | 'low';
interface ResearchedReward { reward: number; confidence: RewardConfidence; why: string; traits: string[] }
const RESEARCHED = rewardData as Record<string, ResearchedReward>;

/** Extra facts the catalogue target may not carry (from KB records: B−V, spectral types, variability range). */
export interface RewardExtras {
  /** B−V colour of the (primary) star. */
  bv?: number;
  /** B−V of the companion of a double, when known. */
  bv2?: number;
  /** Visual amplitude of a variable star, magnitudes (vMin − vMax). */
  variableAmplitude?: number;
}

export interface RewardResult {
  /** 0..10, one decimal. */
  reward: number;
  source: 'researched' | 'estimated';
  confidence: RewardConfidence;
  /** One plain sentence on what makes it worth (or not worth) the look. */
  why: string;
  traits: string[];
  /** The model's estimate for these optics (for transparency/debugging). */
  model: number;
}

/** Reference binoculars and sky the reward is defined for: 10×50 on a tripod, rural-dark SQM 21.3, normal haze, 60° up. */
export const REWARD_REFERENCE_OPTICS: Optics = { aperture: 50, magnification: 10, fov: 6.5, transmission: 0.85, support: 'tripod' };
export const REWARD_REFERENCE_SKY: SkyInputs = { zenithSqm: 21.3, elevationM: 0, extinctionK: extinctionForTransparency(3, 0), extinctionSource: 'default', moon: null };
export const REWARD_REFERENCE_ALT = 60;

/** Low-confidence research is blended with the model: research weight. */
export const LOW_CONFIDENCE_RESEARCH_WEIGHT = 0.6;
/** Share of the model's optics-dependent change applied to a score, and its cap in reward points. */
export const OPTICS_ADJUST_WEIGHT = 0.5, OPTICS_ADJUST_CAP = 1;

// ───────────────────────────── features ─────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const SPECTRAL_BV: Record<string, number> = { O: -0.3, B: -0.15, A: 0.1, F: 0.42, G: 0.7, K: 1.15, M: 1.6, C: 2.5, N: 2.5, S: 1.8 };
/** B−V of each component of a spectral text such as "K3 II + B9.5 V" (by spectral class). */
export function spectralColours(text: string | undefined): number[] {
  if (!text) return [];
  return text.replace(/\([^)]*\)/g, '').split('+').flatMap((part) => {
    const m = /\b([OBAFGKMCNS])\d/.exec(part.trim()) ?? /^([OBAFGKMCNS])/.exec(part.trim());
    return m ? [SPECTRAL_BV[m[1]]] : [];
  });
}

/** Reward extras from a KB record: B−V (facts.bv, else the spectral class), the companion's colour from the spectral
 *  text of a double, and the variability range (facts.vMin − facts.vMax). */
export function rewardExtrasFromKb(o: KbObject): RewardExtras {
  const facts = o.facts as Record<string, { value?: number } | undefined>;
  const colours = spectralColours(o.kind === 'star' ? o.spectral?.text : undefined);
  const bv = facts.bv?.value ?? colours[0];
  const out: RewardExtras = {};
  if (bv !== undefined) out.bv = bv;
  if (colours.length >= 2) { out.bv = colours[0]; out.bv2 = colours[1]; }
  const vMax = facts.vMax?.value, vMin = facts.vMin?.value;
  if (vMax !== undefined && vMin !== undefined && vMin > vMax) out.variableAmplitude = vMin - vMax;
  return out;
}

/** Feature names, in the order of reward-model.json coefficients. */
export const REWARD_FEATURES = [
  // class intercepts
  'galaxy', 'globular', 'open', 'asterism', 'nebula', 'planetary', 'dark', 'star', 'double',
  // physical
  'margin', 'brightness', 'logSize', 'overfill', 'starlike', 'resolvedStars',
  'split', 'pairDeltaMag', 'colourContrast', 'starBrightness', 'redness', 'variability',
] as const;
export type RewardFeature = (typeof REWARD_FEATURES)[number];

/**
 * Physically meaningful features for the reward model, for `optics` under the reference dark sky.
 * Exported for script/fit-reward.ts (the fit and the runtime must use the same code).
 */
export function rewardFeatures(t: VisibilityTarget, optics: Optics = REWARD_REFERENCE_OPTICS, extras: RewardExtras = {}): Record<RewardFeature, number> {
  const est = estimateVisibility(t, optics, REWARD_REFERENCE_SKY, REWARD_REFERENCE_ALT);
  const f = Object.fromEntries(REWARD_FEATURES.map((k) => [k, 0])) as Record<RewardFeature, number>;
  const cls = t.objectClass ?? 'other';
  const point = t.kind === 'star' || t.kind === 'double';
  if (t.kind === 'double') f.double = 1;
  else if (t.kind === 'star') f.star = 1;
  else if (cls === 'galaxy') f.galaxy = 1;
  else if (cls === 'globular') f.globular = 1;
  else if (cls === 'open') f.open = 1;
  else if (cls === 'asterism' || cls === 'star-cloud') f.asterism = 1;
  else if (cls === 'planetary') f.planetary = 1;
  else if (cls === 'dark') f.dark = 1;
  else f.nebula = 1;

  f.margin = clamp(est.margin, -1.5, 3);
  const mag = Number.isFinite(t.mag) && t.mag < 90 ? t.mag : 12;
  if (!point) {
    f.brightness = clamp(8 - mag, -3, 8);
    const major = t.majorArcmin;
    if (major) {
      const field = optics.fov * 60;
      f.logSize = Math.log10(clamp(major, 1, 600) / 30);
      f.overfill = Math.max(0, Math.log2(major / (0.9 * field)));
      f.starlike = clamp(Math.log10(20 / (major * optics.magnification)), 0, 1.5);
    } else f.starlike = 1.5;
    if (t.kind === 'cluster') {
      const brightest = estimateBrightestStar(t);
      const n = est.limitingMag - 0.5 > brightest ? Math.min(t.memberCount ?? Infinity, 5 * 10 ** (0.3 * (est.limitingMag - 0.5 - brightest))) : 0;
      f.resolvedStars = Math.log10(1 + n);
    }
  } else {
    f.starBrightness = clamp(3 - mag, -4, 4.5);
    if (extras.bv !== undefined) f.redness = clamp(extras.bv - 0.9, 0, 2);
    if (extras.variableAmplitude !== undefined) f.variability = Math.log2(1 + clamp(extras.variableAmplitude, 0, 8));
    if (t.kind === 'double') {
      const m1 = Math.min(t.mag, t.mag2 ?? t.mag), m2 = Math.max(t.mag, t.mag2 ?? t.mag), dm = Math.min(m2 - m1, 4);
      const rhoReq = Math.max((160 * (1 + 0.1 * dm)) / optics.magnification, 116 / optics.aperture, 2);
      f.split = Math.log2(clamp((t.sepArcsec ?? 0) / rhoReq, 0.25, 16));
      f.pairDeltaMag = dm;
      if (extras.bv !== undefined && extras.bv2 !== undefined) f.colourContrast = clamp(Math.abs(extras.bv - extras.bv2), 0, 2);
    }
  }
  return f;
}

interface RewardModel { coefficients: Record<RewardFeature, number> }
const MODEL = rewardModel as unknown as RewardModel;

/** The fitted model's reward for these features, clamped to 0..10. */
export function modelReward(features: Record<RewardFeature, number>, coefficients: Record<RewardFeature, number> = MODEL.coefficients): number {
  let y = 0;
  for (const k of REWARD_FEATURES) y += (coefficients[k] ?? 0) * features[k];
  return clamp(y, 0, 10);
}

// ───────────────────────────── score ─────────────────────────────

const isUnified = (t: UnifiedTarget | VisibilityTarget): t is UnifiedTarget => 'category' in t;
const round1 = (x: number) => Math.round(x * 10) / 10;
const sameOptics = (a: Optics, b: Optics) => a.aperture === b.aperture && a.magnification === b.magnification && a.fov === b.fov;

const vtCache = new WeakMap<UnifiedTarget, VisibilityTarget>();
const resultCache = new WeakMap<object, Map<string, RewardResult>>();

function estimatedWhy(t: VisibilityTarget, f: Record<RewardFeature, number>, reward: number): { why: string; traits: string[] } {
  const traits: string[] = [];
  if (f.overfill > 0) traits.push('too big for the field');
  if (f.starlike > 0.6 && t.kind !== 'star' && t.kind !== 'double') traits.push('star-like', 'tiny');
  if (f.resolvedStars > 1.3) traits.push('many bright stars');
  if (f.split > 1) traits.push('double split');
  if (f.colourContrast > 0.6) traits.push('colour contrast');
  if (f.redness > 0.4) traits.push('vivid colour');
  if (f.variability > 0.5) traits.push('variable');
  if (f.margin < 0.15 && t.kind !== 'star') traits.push('faint smudge');
  const est = estimateVisibility(t, REWARD_REFERENCE_OPTICS, REWARD_REFERENCE_SKY, REWARD_REFERENCE_ALT);
  const view = est.appearance.replace(/ — .*$/, '').replace(/;.*$/, '');
  const word = reward >= 6.5 ? 'should be a fine binocular sight' : reward >= 4.5 ? 'is a pleasant binocular target' : reward >= 2.5 ? 'is a modest binocular target' : 'is mostly of interest for the hunt';
  return { why: `Estimated from its brightness, size and type: under a dark sky, “${view.toLowerCase()}” — it ${word}.`, traits };
}

/**
 * How rewarding `target` is in binoculars, 0..10 (condition-independent). `optics` (default: the 10×50 reference)
 * applies a modest field/power adjustment. `extras` adds star colour/variability for objects without research.
 */
export function rewardScore(target: UnifiedTarget | VisibilityTarget, optics: Optics = REWARD_REFERENCE_OPTICS, extras: RewardExtras = {}): RewardResult {
  const key = `${optics.aperture}/${optics.magnification}/${optics.fov}/${extras.bv ?? ''}/${extras.bv2 ?? ''}/${extras.variableAmplitude ?? ''}`;
  let byKey = resultCache.get(target);
  const hit = byKey?.get(key);
  if (hit) return hit;

  let vt: VisibilityTarget;
  if (isUnified(target)) {
    vt = vtCache.get(target) ?? toVisibilityTarget(target);
    vtCache.set(target, vt);
  } else vt = target;
  const reference = modelReward(rewardFeatures(vt, REWARD_REFERENCE_OPTICS, extras));
  const withOptics = sameOptics(optics, REWARD_REFERENCE_OPTICS) ? reference : modelReward(rewardFeatures(vt, optics, extras));
  const opticsAdjust = clamp(OPTICS_ADJUST_WEIGHT * (withOptics - reference), -OPTICS_ADJUST_CAP, OPTICS_ADJUST_CAP);

  const researched = RESEARCHED[target.id];
  let result: RewardResult;
  if (researched) {
    const base = researched.confidence === 'low'
      ? LOW_CONFIDENCE_RESEARCH_WEIGHT * researched.reward + (1 - LOW_CONFIDENCE_RESEARCH_WEIGHT) * reference
      : researched.reward;
    result = { reward: round1(clamp(base + opticsAdjust, 0, 10)), source: 'researched', confidence: researched.confidence, why: researched.why, traits: researched.traits, model: round1(withOptics) };
  } else {
    const features = rewardFeatures(vt, optics, extras);
    const reward = round1(withOptics);
    result = { reward, source: 'estimated', confidence: 'low', ...estimatedWhy(vt, features, reward), model: reward };
  }
  if (!byKey) { byKey = new Map(); resultCache.set(target, byKey); }
  byKey.set(key, result);
  return result;
}

/** The researched record for an id, if any (no model, no optics). */
export const researchedReward = (id: string): ResearchedReward | undefined => RESEARCHED[id];

// ───────────────────────────── words ─────────────────────────────

export type RewardBand = 0 | 1 | 2 | 3 | 4;
/** 0 Showpiece (≥ 8.5) · 1 Rewarding (≥ 6.5) · 2 Pleasant (≥ 4.5) · 3 Modest (≥ 2.5) · 4 Faint smudge / Plain star. */
export const rewardBand = (reward: number): RewardBand => (reward >= 8.5 ? 0 : reward >= 6.5 ? 1 : reward >= 4.5 ? 2 : reward >= 2.5 ? 3 : 4);
const BAND_WORDS = ['Showpiece', 'Rewarding', 'Pleasant', 'Modest', 'Faint smudge'] as const;
/** The band word; the lowest band reads "Little to see" for stars and doubles (they are points, not smudges). */
export function rewardWord(reward: number, kind?: VisibilityTarget['kind']): string {
  const band = rewardBand(reward);
  return band === 4 && (kind === 'star' || kind === 'double') ? 'Little to see' : BAND_WORDS[band];
}
/** Filled dots of five (half a dot per reward point, rounded). */
export const rewardDots = (reward: number) => clamp(Math.round(reward / 2), 0, 5);

// ───────────────────────────── combined ranking ─────────────────────────────

/** How much of an object's reward survives tonight, by visibility level (Excellent … Not visible). */
export const TONIGHT_WEIGHT: Record<VisibilityLevel, number> = { 0: 1, 1: 0.85, 2: 0.6, 3: 0.3, 4: 0 };
/** Tie-break per visibility-score point (score 0..100 → at most 0.2 reward points). */
export const TONIGHT_TIEBREAK = 0.002;

/** "Best tonight": reward × w(level) + a small tie-break by the visibility score. */
export function tonightValue(reward: number, visibility: { level: VisibilityLevel; score: number }): number {
  return reward * TONIGHT_WEIGHT[visibility.level] + TONIGHT_TIEBREAK * visibility.score;
}
