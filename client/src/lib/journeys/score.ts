/**
 * Sky Journeys: journey scoring with the three scorer tiers (spec decision 7, doc 05 §7.5).
 *
 *   heuristic  hand-tuned weights over the 36 features (heuristic-weights.ts); without weights the engine's
 *              beam objective h is used as-is.
 *   linear     pairwise (Bradley–Terry) logistic ranker: b + Σ wᵢ·(xᵢ − meanᵢ)/stdᵢ.
 *   gbdt       LightGBM lambdarank trees exported to compact parallel arrays (leaves = negative child ~index).
 *              Monotone constraints are applied at training time (train.py); inference is a plain tree walk.
 *
 * Load-time validation (`validateModel`) checks names against FEATURE_NAMES, array shapes and child indices;
 * an invalid model falls back to the heuristic tier (doc 05 §7.5). Scores are quantised to 1e-6.
 */
import { computeFeatures, featureInputFromScoring, sameFeatureNames } from './features';
import { HEURISTIC_MODEL } from './heuristic-weights';
import { quantize } from './seed';
import type { JourneyScorer } from './assemble';
import { FEATURE_NAMES, type GbdtModel, type HeuristicModel, type LinearModel, type ScorerModel } from './types';

const N = FEATURE_NAMES.length;

// ───────────────────────────── inference cores ─────────────────────────────

/** Sum of tree outputs (LightGBM raw score). Numerical splits: go left when x ≤ threshold. */
export function scoreGbdt(m: GbdtModel, x: ArrayLike<number>): number {
  let s = m.base;
  for (const tr of m.trees) {
    if (!tr.f.length) { s += tr.v[0] ?? 0; continue; } // single-leaf tree
    let node = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const next = x[tr.f[node]] <= tr.t[node] ? tr.l[node] : tr.r[node];
      if (next < 0) { s += tr.v[~next]; break; }
      node = next;
    }
  }
  return s;
}

export function scoreLinear(m: LinearModel, x: ArrayLike<number>): number {
  let s = m.b;
  for (let i = 0; i < m.w.length; i++) s += (m.w[i] * (x[i] - m.mean[i])) / (m.std[i] || 1);
  return s;
}

/** Weighted feature sum; `fallback` (the engine's h) when the model carries no weights. */
export function scoreHeuristic(m: HeuristicModel, x: ArrayLike<number>, fallback?: number): number {
  if (!m.weights) return fallback ?? scoreHeuristic(HEURISTIC_MODEL, x);
  let s = 0;
  for (let i = 0; i < m.weights.length; i++) s += m.weights[i] * x[i];
  return s;
}

// ───────────────────────────── validation & fallback ─────────────────────────────

/** Problems that make a model unusable (empty = OK). */
export function validateModel(m: ScorerModel): string[] {
  const out: string[] = [];
  if (!sameFeatureNames(m.features)) out.push(`feature names differ from FEATURE_NAMES (${m.features.length} vs ${N})`);
  const finite = (xs: number[]) => xs.every((v) => Number.isFinite(v));
  if (m.type === 'heuristic') {
    if (m.weights && (m.weights.length !== N || !finite(m.weights))) out.push('heuristic weights must be 36 finite numbers');
  } else if (m.type === 'linear') {
    for (const k of ['mean', 'std', 'w'] as const) if (m[k].length !== N || !finite(m[k])) out.push(`linear.${k} must be 36 finite numbers`);
    if (m.std.some((v) => !(v > 0))) out.push('linear.std must be > 0');
    if (!Number.isFinite(m.b)) out.push('linear.b not finite');
  } else {
    if (!Number.isFinite(m.base)) out.push('gbdt.base not finite');
    m.trees.forEach((t, k) => {
      const nodes = t.f.length;
      if (t.t.length !== nodes || t.l.length !== nodes || t.r.length !== nodes) out.push(`tree ${k}: node arrays differ in length`);
      if (nodes === 0 && t.v.length !== 1) out.push(`tree ${k}: a single-leaf tree needs exactly one value`);
      if (nodes > 0 && t.v.length !== nodes + 1) out.push(`tree ${k}: ${t.v.length} leaves for ${nodes} internal nodes`);
      if (t.f.some((f) => !Number.isInteger(f) || f < 0 || f >= N)) out.push(`tree ${k}: feature index out of range`);
      if (!finite(t.t) || !finite(t.v)) out.push(`tree ${k}: non-finite threshold or leaf`);
      const okChild = (c: number) => Number.isInteger(c) && (c >= 0 ? c > 0 && c < nodes : ~c < t.v.length);
      if (!t.l.every(okChild) || !t.r.every(okChild)) out.push(`tree ${k}: child index out of range`);
      // Every internal node except the root has exactly one parent, and children point forward (no cycles).
      const parents = new Array<number>(nodes).fill(0);
      t.l.concat(t.r).forEach((c) => { if (c > 0 && c < nodes) parents[c]++; });
      if (parents.some((p, i) => (i === 0 ? p !== 0 : p !== 1))) out.push(`tree ${k}: not a tree`);
      if (t.l.some((c, i) => c >= 0 && c <= i) || t.r.some((c, i) => c >= 0 && c <= i)) out.push(`tree ${k}: child before parent`);
    });
  }
  return out;
}

export interface ResolvedModel {
  model: ScorerModel;
  /** Why the requested model was replaced (null when used as given). */
  fallbackReason: string | null;
}

/** The model to use: the given one if valid, else the tier-1 heuristic (doc 05 §7.5 fallback chain). */
export function resolveModel(m: ScorerModel | null | undefined): ResolvedModel {
  if (!m) return { model: HEURISTIC_MODEL, fallbackReason: 'no model' };
  const problems = validateModel(m);
  return problems.length ? { model: HEURISTIC_MODEL, fallbackReason: problems.join('; ') } : { model: m, fallbackReason: null };
}

/**
 * Score one feature vector. Assumes a validated model (see resolveModel). `heuristic` is the engine's h, used
 * by a heuristic model without weights. Quantised to 1e-6 (doc 05 D10).
 */
export function scoreJourney(features: ArrayLike<number>, model: ScorerModel, opts: { heuristic?: number } = {}): number {
  if (features.length !== N) throw new Error(`expected ${N} features, got ${features.length}`);
  const s = model.type === 'gbdt' ? scoreGbdt(model, features)
    : model.type === 'linear' ? scoreLinear(model, features)
      : scoreHeuristic(model, features, opts.heuristic);
  return quantize(s);
}

/**
 * Engine plug-in (assemble.ts `GenerateOptions.scorer`): features from the candidate table, then the model.
 * An invalid model silently degrades to the heuristic tier; the returned `scorer` reports what was used.
 */
export function createModelScorer(model: ScorerModel | null | undefined): JourneyScorer {
  const { model: m } = resolveModel(model);
  return (x) => {
    const features = computeFeatures(featureInputFromScoring(x));
    return { score: scoreJourney(features, m, { heuristic: x.heuristic }), features, scorer: m.type };
  };
}

/**
 * Training-export scorer: attaches features but ranks by the engine's h (the documented baseline), so
 * slates are drawn from the same candidate distribution the heuristic produces.
 */
export const featureCapturingScorer: JourneyScorer = (x) => ({
  score: x.heuristic,
  features: computeFeatures(featureInputFromScoring(x)),
  scorer: 'heuristic',
});
