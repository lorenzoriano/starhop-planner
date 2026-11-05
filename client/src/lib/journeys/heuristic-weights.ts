/**
 * Sky Journeys: hand-tuned scoring baselines (spec decision 7, tier 1).
 *
 * 1. HEURISTIC_WEIGHTS: a linear score over the 36 clipped features (raw units). It restates doc 05 §5.5's
 *    per-stop heuristic h at journey level (per-stop averages instead of sums, so length alone does not win)
 *    and adds doc 04 §4.4's emphasis on arc shape. Signs obey MONOTONE_CONSTRAINTS (tested), so the baseline
 *    never prefers a lower, moonlit, zig-zag journey "all else equal".
 * 2. doc04Quality(criteria): doc 04 §4.4's Q from the F1–F20 criteria, logged for judge-slate selection and
 *    as a second baseline in train.py.
 *
 * The engine's own beam objective h (search.ts) remains the runtime default when no model is loaded; these
 * weights ship as the `heuristic` model in model.json until a learned model passes the ship gate (doc 05 §7.6).
 *
 * v2 (owner feedback round 1, docs/sky-journeys/engine-eval.md "Round 1 owner feedback"): one challenge stop is a
 * plus, the weakest link and the ordering progression weigh more. The archetype prior that pulls A6 down lives in
 * h (search.ts ARCHETYPE_PRIOR): no feature carries the archetype.
 */
import type { Doc04Criteria } from './features';
import { FEATURE_NAMES, type FeatureName, type HeuristicModel } from './types';

/** Weight per unit of each (clipped) feature. Comments give the doc 05 §5.5 term it approximates. */
export const HEURISTIC_WEIGHTS: Readonly<Record<FeatureName, number>> = {
  // geometry / path comfort — h: −0.6·hop/R − 0.5·max(0, turn − 90°)/90° per step
  n_stops: 0.05,            // mild preference for using the requested length fully
  mean_hop_deg: -0.02,      // 0.6/R per degree (R = 30°)
  max_hop_deg: -0.01,
  path_over_cap: -0.25,
  mean_turn_deg: -0.004,    // ≈0.5/90 per degree beyond a straight sweep, averaged
  sharp_turns: -0.3,
  reversals: -0.3,
  cap_used: -0.1,
  log_hop_fields: -0.1,
  // observing quality — h: −0.8·glow/0.7 − 0.6·max(0, 45° − alt)/15°
  min_alt: 0.02,
  mean_alt: 0.01,
  max_glow: -0.6,
  min_moon_sep: 0.002,
  mean_rating: -0.2,
  has_challenge: 0.15,      // round 1: the owner likes one challenge stop (was −0.1)
  min_margin_min: 0.002,
  twilight_stops: -0.05,
  setting_first: 0.1,       // observe setting objects first (doc 05 §7.2 #17)
  // story / teaching / wonder — h: +1.0·interest + 0.8·link + 0.4·superlative + progression ±0.3/step
  edge_strength_mean: 0.8,
  edge_strength_min: 0.6,   // doc 04 F15: min link ≥ 0.4; round 1: weak derived links cost more (was 0.4)
  curated_edge_frac: 0.3,
  edge_type_count: 0.05,
  kind_count: 0.08,         // doc 04 F6 family variety; h: −0.4 for three of a kind in a row
  concept_count: 0.01,
  progression_rho: 0.7,     // doc 04 F5 ordering monotonicity (weight 0.20 in Q); round 1: story progression (was 0.5)
  interest_mean: 1.0,
  interest_max: 0.3,
  opener_showpiece: 0.3,    // h: +0.3 showpiece opener; doc 04 F8 hook
  finale_lift: 0.3,         // doc 04 F7/F9 payoff late, peak-end
  superlative_count: 0.1,
  scale_span: 0.05,
  theme_drift: -0.3,        // doc 04 F2: continuity; drift is left for the learned model to value
  // content support + context
  fact_coverage: 0.4,
  image_coverage: 0.2,
  moon_illum: 0,            // context only: identical inside a slate
  sky_brightness: 0,        // context only
};

export const HEURISTIC_MODEL_VERSION = 'heuristic-2026.11-v2';

/** The tier-1 baseline as a ScorerModel (weights in FEATURE_NAMES order, applied to raw clipped features). */
export const HEURISTIC_MODEL: HeuristicModel = {
  type: 'heuristic',
  modelVersion: HEURISTIC_MODEL_VERSION,
  features: [...FEATURE_NAMES],
  weights: FEATURE_NAMES.map((n) => HEURISTIC_WEIGHTS[n]),
};

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * Doc 04 §4.4 hand-weighted quality Q in [0, 1]:
 * Q = 0.20·norm(F1,F5) + 0.15·F15 + 0.15·F4 + 0.15·(F7,F8,F9,F10) + 0.10·(1 − load(F11,F12,F3))
 *   + 0.10·(F13,F14) + 0.10·F6 + 0.05·F18.
 * Each bracket is mapped to [0, 1] against the "good range" column of doc 04 §4.2.
 */
export function doc04Quality(c: Doc04Criteria): number {
  const theme = 0.5 * clamp01(c.F1_themeCoverage / 0.8) + 0.5 * clamp01((c.F5_orderingMonotonicity + 1) / 1.8);
  const links = 0.6 * clamp01(c.F15_linkMean / 0.75) + 0.4 * clamp01(c.F15_linkMin / 0.4);
  const contrast = 0.5 * clamp01(c.F4_contrastMean / 0.35) + 0.5 * clamp01(c.F4_contrastMax / 0.6);
  const arc = 0.25 * clamp01(c.F7_payoffPosition / 0.67) + 0.25 * c.F8_hookOk
    + 0.25 * clamp01((c.F9_peakEnd - 2) / 8) + 0.25 * c.F10_callback;
  const load = clamp01(Math.max(0, c.F11_newTermsMax - 2) / 3 + Math.max(0, c.F11_newTermsTotal - 8) / 8
    + Math.max(0, c.F12_bridges - 1) / 3 + (c.F12_coreConcepts > 4 ? (c.F12_coreConcepts - 4) / 4 : c.F12_coreConcepts < 2 ? 0.25 : 0));
  const ramp = 0.25 * clamp01((c.F13_difficultyRho + 1) / 1.3) + 0.25 * (c.F13_maxJump <= 2 ? 1 : 0)
    + 0.1 * (c.F13_startDifficulty <= 2 ? 1 : 0) + 0.4 * clamp01(c.F14_visibilityMarginDeg / 30);
  const variety = 0.7 * clamp01(c.F6_familyEntropy / 0.6) + 0.3 * (c.F6_familyRuns === 0 ? 1 : 0);
  const wonder = c.F18_wonderDensity >= 0.3 && c.F18_wonderDensity <= 0.6 ? 1 : c.F18_wonderDensity < 0.3 ? c.F18_wonderDensity / 0.3 : 0.8;
  const q = 0.2 * theme + 0.15 * links + 0.15 * contrast + 0.15 * arc + 0.1 * (1 - load) + 0.1 * ramp + 0.1 * variety + 0.05 * wonder;
  return Math.round(q * 1e6) / 1e6;
}
