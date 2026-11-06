/**
 * Sky Journeys: the 36-feature journey vector (doc 05 §7.2) and doc 04's computable criteria F1–F20 (doc 04 §4.2).
 *
 * One TypeScript module computes features for training-data export (script/journeys/train/export-candidates.ts)
 * and at runtime (score.ts), so there is no train/serve skew (doc 05 D6). Every feature is finite and clipped
 * to FEATURE_RANGES; the vector order is FEATURE_NAMES (frozen per modelVersion, see types.ts).
 *
 * The core functions take an engine-agnostic `FeatureInput` (plain numbers per stop), which tests and tools
 * can build by hand. `featureInputFromScoring` adapts the engine's scoring hook (assemble.ts `ScoringInput`).
 */
import { minutesClear } from './conditions';
import { meanPosition, pathGeometry, type RaDec } from './region';
import { fnv1a53 } from './seed';
import type { ScoringInput } from './assemble';
import {
  FEATURE_NAMES, type ArcRole, type Concept, type EdgeType, type FactKey, type FeatureName, type KbObject, type Template,
} from './types';

// ───────────────────────────── input ─────────────────────────────

export interface FeatureStopInput {
  object: KbObject;
  /** Altitude at the start of the stop window (deg). */
  alt: number;
  /** Lowest altitude during the stop window (deg). */
  minAlt: number;
  /** Largest Krisciunas–Schaefer moonlight brightening during the window (mag; 0 when the Moon is down). */
  glow: number;
  /** Smallest Moon separation while the Moon is up (deg); null = Moon down for the whole window. */
  moonSep: number | null;
  /** binocularAssessment rating 0..2 (3 never reaches a valid journey). */
  rating: number;
  /** Highest Sun altitude during the window (deg). */
  sunAlt: number;
  /** Minutes the object stays above the altitude floor after the stop window ends. */
  minutesLeft: number;
  /** Minutes the object stays above the altitude floor counted from the journey start (setting order). */
  minutesToSet: number;
  /** Link used to arrive here (null on stop 0). */
  link: { type: EdgeType; strength: number; curated: boolean } | null;
  /** Arc role of the template slot this stop fills (doc 04 criteria only). */
  arc?: ArcRole;
}

export interface FeatureInput {
  stops: FeatureStopInput[];
  /** Cap centre; defaults to the mean position of the stops. */
  center?: RaDec;
  /** Cap radius (deg). */
  radius: number;
  /** Instrument true field (deg). */
  fovDeg: number;
  /** Moon illumination 0..1 when it is up during the journey, else 0. */
  moonIllumination: number;
  /** Zenith sky brightness (mag/arcsec²). */
  skyBrightness: number;
  /** Template (progression axis, theme concepts for doc 04 criteria). */
  template?: Pick<Template, 'progression' | 'coreConcepts'> | null;
  /** KB concept graph (parent closure, prereqs, terms, bridges). */
  concepts: readonly Concept[];
}

// ───────────────────────────── ranges & constraints ─────────────────────────────

/** Clip range and default (used when a value is not finite) per feature. */
export const FEATURE_RANGES: Readonly<Record<FeatureName, readonly [lo: number, hi: number, def: number]>> = {
  n_stops: [3, 10, 5],
  mean_hop_deg: [0, 40, 0],
  max_hop_deg: [0, 40, 0],
  path_over_cap: [0, 3, 0],
  mean_turn_deg: [0, 180, 0],
  sharp_turns: [0, 9, 0],
  reversals: [0, 9, 0],
  cap_used: [0, 2, 0],
  log_hop_fields: [0, 4, 0],
  min_alt: [0, 90, 30],
  mean_alt: [0, 90, 30],
  max_glow: [0, 5, 0],
  min_moon_sep: [0, 180, 180],
  mean_rating: [0, 3, 1],
  has_challenge: [0, 1, 0],
  min_margin_min: [0, 180, 0],
  twilight_stops: [0, 10, 0],
  setting_first: [-1, 1, 0],
  edge_strength_mean: [0, 1, 0],
  edge_strength_min: [0, 1, 0],
  curated_edge_frac: [0, 1, 0],
  edge_type_count: [0, 10, 0],
  kind_count: [0, 10, 1],
  concept_count: [0, 40, 0],
  progression_rho: [-1, 1, 0],
  interest_mean: [0, 1, 0],
  interest_max: [0, 1, 0],
  opener_showpiece: [0, 1, 0],
  finale_lift: [-1, 1, 0],
  superlative_count: [0, 10, 0],
  scale_span: [0, 10, 0],
  theme_drift: [0, 1, 0],
  fact_coverage: [0, 1, 0],
  image_coverage: [0, 1, 0],
  moon_illum: [0, 1, 0],
  sky_brightness: [16, 23, 20],
};

/**
 * Monotone constraints for training (doc 05 §7.1): +1 more is never worse, −1 more is never better.
 * train.py reads them from feature-meta.json (written by export-candidates.ts --meta-only).
 */
export const MONOTONE_CONSTRAINTS: Readonly<Partial<Record<FeatureName, 1 | -1>>> = {
  min_alt: 1, mean_alt: 1, max_glow: -1, min_moon_sep: 1, max_hop_deg: -1, reversals: -1, sharp_turns: -1,
  path_over_cap: -1, fact_coverage: 1, image_coverage: 1, edge_strength_mean: 1,
};

/** Feature groups for ablations (doc 05 §7.6). */
export const FEATURE_GROUPS: Readonly<Record<'geometry' | 'quality' | 'story' | 'content', readonly FeatureName[]>> = {
  geometry: FEATURE_NAMES.slice(0, 9),
  quality: FEATURE_NAMES.slice(9, 18),
  story: FEATURE_NAMES.slice(18, 32),
  content: FEATURE_NAMES.slice(32, 36),
};

export const monotoneVector = (): number[] => FEATURE_NAMES.map((n) => MONOTONE_CONSTRAINTS[n] ?? 0);

/** Stable hash of the frozen feature list (stored in model.trainedOn.featuresHash). */
export function featuresHash(names: readonly string[] = FEATURE_NAMES): string {
  return fnv1a53(names.join(',')).toString(16).padStart(14, '0');
}

/** True when a model's feature list equals FEATURE_NAMES exactly (doc 05 §7.2: asserted at load). */
export function sameFeatureNames(names: readonly string[]): boolean {
  return names.length === FEATURE_NAMES.length && names.every((n, i) => n === FEATURE_NAMES[i]);
}

export function clipFeature(name: FeatureName, v: number): number {
  const [lo, hi, def] = FEATURE_RANGES[name];
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

// ───────────────────────────── small stats ─────────────────────────────

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r9 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x);

/** Kendall τ-b between two equal-length sequences (0 when undefined). */
export function kendallTau(a: readonly number[], b: readonly number[]): number {
  let c = 0, d = 0, ta = 0, tb = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const da = Math.sign(a[j] - a[i]), db = Math.sign(b[j] - b[i]);
      if (da === 0 && db === 0) continue;
      if (da === 0) ta++;
      else if (db === 0) tb++;
      else if (da === db) c++;
      else d++;
    }
  }
  const den = Math.sqrt((c + d + ta) * (c + d + tb));
  return den > 0 ? (c - d) / den : 0;
}

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman ρ (Pearson on average ranks; 0 when undefined). */
export function spearmanRho(a: readonly number[], b: readonly number[]): number {
  if (a.length < 2) return 0;
  const ra = ranks(a), rb = ranks(b);
  const ma = mean(ra), mb = mean(rb);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < ra.length; i++) {
    sab += (ra[i] - ma) * (rb[i] - mb);
    saa += (ra[i] - ma) ** 2;
    sbb += (rb[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};

// ───────────────────────────── KB helpers ─────────────────────────────

const conceptMaps = new WeakMap<readonly Concept[], Map<string, Concept>>();
export function conceptIndex(concepts: readonly Concept[]): Map<string, Concept> {
  let m = conceptMaps.get(concepts);
  if (!m) { m = new Map(concepts.map((c) => [c.id, c] as const)); conceptMaps.set(concepts, m); }
  return m;
}

/** Concept ids an object teaches with strength ≥ minStrength, plus their parents (doc 04 F2 "concept plus parent"). */
export function conceptClosure(o: KbObject, concepts: readonly Concept[], minStrength = 1): Set<string> {
  const idx = conceptIndex(concepts);
  const out = new Set<string>();
  for (const t of o.teaches) {
    if (t.strength < minStrength) continue;
    out.add(t.conceptId);
    let p = idx.get(t.conceptId)?.parent, guard = 0;
    while (p && guard++ < 8) { out.add(p); p = idx.get(p)?.parent; }
  }
  return out;
}

/** Variety key: star (by role) or deep-sky class. */
export function featureKind(o: KbObject): string {
  if (o.kind === 'dso') return o.dsoClass;
  if (o.roles.includes('supergiant')) return 'star:supergiant';
  if (o.roles.includes('giant')) return 'star:giant';
  if (o.roles.includes('wd')) return 'star:wd';
  return 'star';
}

/** Value of the template progression axis (evoStage, or log10 of a positive fact); null if absent. */
export function progressionAxisValue(o: KbObject, property: FactKey | 'evoStage'): number | null {
  if (property === 'evoStage') return o.evoStage === null || o.evoStage === 8 ? null : o.evoStage;
  const f = o.facts[property];
  return f && f.value > 0 ? Math.log10(f.value) : null;
}

const sourcedFactCount = (o: KbObject) =>
  Object.values(o.facts).filter((f) => f && Number.isFinite(f.value) && !!f.sourceId).length;

// ───────────────────────────── the 36 features ─────────────────────────────

/** Spearman ρ toward the archetype direction; `arc` = best split at a turning point, |ρ| per side (doc 05 #24). */
export function progressionRho(objs: readonly KbObject[], progression: Template['progression'] | undefined): number {
  if (!progression) return 0;
  const pts: [number, number][] = [];
  objs.forEach((o, i) => { const v = progressionAxisValue(o, progression.property); if (v !== null) pts.push([i, v]); });
  if (pts.length < 2) return 0;
  const rho = (p: [number, number][]) => (p.length < 2 ? 0 : spearmanRho(p.map((x) => x[0]), p.map((x) => x[1])));
  if (progression.direction === 'up') return rho(pts);
  if (progression.direction === 'down') return -rho(pts);
  let best = Math.abs(rho(pts));
  for (let k = 2; k <= pts.length - 2; k++) {
    const left = pts.slice(0, k), right = pts.slice(k - 1); // the turning point belongs to both halves
    const v = (Math.abs(rho(left)) * left.length + Math.abs(rho(right)) * right.length) / (left.length + right.length);
    if (v > best) best = v;
  }
  return best;
}

/** The 36-vector (doc 05 §7.2) in FEATURE_NAMES order, deterministic, finite, clipped. */
export function computeFeatures(input: FeatureInput): number[] {
  const st = input.stops;
  const n = st.length;
  const objs = st.map((s) => s.object);
  const R = input.radius > 0 ? input.radius : 30;
  const center = input.center ?? meanPosition(objs.map((o) => ({ ra: o.ra, dec: o.dec })));
  const geo = pathGeometry(objs.map((o) => ({ ra: o.ra, dec: o.dec })), center, R);
  const fov = input.fovDeg > 0 ? input.fovDeg : 5;
  const links = st.slice(1).map((s) => s.link).filter((l): l is NonNullable<FeatureStopInput['link']> => !!l);
  const strengths = links.map((l) => l.strength);
  const interests = objs.map((o) => o.interest);
  const imean = mean(interests);
  const closures = objs.map((o) => conceptClosure(o, input.concepts));
  const direct = new Set<string>();
  objs.forEach((o) => o.teaches.forEach((t) => direct.add(t.conceptId)));
  const dists = objs.map((o) => o.facts.distanceLy?.value).filter((d): d is number => d !== undefined && d > 0);
  const moonSeps = st.map((s) => s.moonSep).filter((x): x is number => x !== null);

  const raw: Record<FeatureName, number> = {
    n_stops: n,
    mean_hop_deg: geo.hops.length ? mean(geo.hops) : 0,
    max_hop_deg: geo.maxHopDeg,
    path_over_cap: geo.pathDeg / R,
    mean_turn_deg: geo.turns.length ? mean(geo.turns) : 0,
    sharp_turns: geo.sharpTurns,
    reversals: geo.reversals,
    cap_used: geo.capUsed,
    log_hop_fields: geo.hops.length ? mean(geo.hops.map((h) => Math.log2(1 + h / fov))) : 0,
    min_alt: Math.min(...st.map((s) => s.minAlt)),
    mean_alt: mean(st.map((s) => s.alt)),
    max_glow: Math.max(0, ...st.map((s) => s.glow)),
    min_moon_sep: moonSeps.length ? Math.min(...moonSeps) : 180,
    mean_rating: mean(st.map((s) => Math.max(0, s.rating))),
    has_challenge: st.some((s) => s.rating >= 2) ? 1 : 0,
    min_margin_min: Math.min(180, ...st.map((s) => s.minutesLeft)),
    twilight_stops: st.filter((s) => s.sunAlt > -18).length,
    setting_first: kendallTau(st.map((_, i) => i), st.map((s) => s.minutesToSet)),
    edge_strength_mean: strengths.length ? mean(strengths) : 0,
    edge_strength_min: strengths.length ? Math.min(...strengths) : 0,
    curated_edge_frac: links.length ? links.filter((l) => l.curated).length / links.length : 0,
    edge_type_count: new Set(links.map((l) => l.type)).size,
    kind_count: new Set(objs.map(featureKind)).size,
    concept_count: direct.size,
    progression_rho: progressionRho(objs, input.template?.progression),
    interest_mean: imean,
    interest_max: Math.max(...interests),
    opener_showpiece: objs.slice(0, 2).some((o) => o.showpiece) ? 1 : 0,
    finale_lift: n ? interests[n - 1] - imean : 0,
    superlative_count: objs.filter((o) => o.superlatives.length > 0).length,
    scale_span: dists.length >= 2 ? Math.log10(Math.max(...dists) / Math.min(...dists)) : 0,
    theme_drift: n >= 2 ? 1 - mean(closures.slice(1).map((c, i) => jaccard(closures[i], c))) : 0,
    fact_coverage: mean(objs.map((o) => Math.min(1, sourcedFactCount(o) / 6))),
    image_coverage: mean(objs.map((o) => (o.media.images.length > 0 ? 1 : 0))),
    moon_illum: input.moonIllumination,
    sky_brightness: input.skyBrightness,
  };
  return FEATURE_NAMES.map((name) => r9(clipFeature(name, raw[name])));
}

/** Named view of a vector (debug output, training rows). */
export function featureRecord(x: readonly number[]): Record<FeatureName, number> {
  return Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, x[i]])) as Record<FeatureName, number>;
}

// ───────────────────────────── doc 04 §4.2 criteria F1–F20 ─────────────────────────────

/** Doc 04's computable criteria. Logged with every training row; several feed the doc 04 §4.4 baseline Q. */
export interface Doc04Criteria {
  F1_themeCoverage: number;
  F2_conceptContinuity: number;
  F3_prereqViolations: number;
  F4_contrastMean: number;
  F4_contrastMax: number;
  F5_orderingMonotonicity: number;
  F6_familyEntropy: number;
  F6_familyRuns: number;
  F7_payoffPosition: number;
  F8_hookOk: number;
  F8_hookWow: number;
  F9_peakEnd: number;
  F10_callback: number;
  F11_newTermsMax: number;
  F11_newTermsTotal: number;
  F12_coreConcepts: number;
  F12_bridges: number;
  F13_difficultyRho: number;
  F13_maxJump: number;
  F13_startDifficulty: number;
  F14_visibilityMarginDeg: number;
  F15_linkMean: number;
  F15_linkMin: number;
  F16_pathDeg: number;
  F16_maxHopDeg: number;
  F16_reversals: number;
  F17_durationMin: number;
  F18_wonderDensity: number;
  F19_misconceptionTwists: number;
  F20_novelty: number;
}

export interface CriteriaOptions {
  /** Altitude floor the journey was built with (F14). Default 30. */
  minAlt?: number;
  /** Concepts this device already learned (F3, F11). */
  learnedConcepts?: Iterable<string>;
  /** Object ids seen in this device's recent journeys (F20). */
  seenObjectIds?: Iterable<string>;
  /** All KB objects, for KB-wide percentile ranks in F4 (defaults to the journey's own stops). */
  kbObjects?: readonly KbObject[];
}

const CONTRAST_AXES: (FactKey | 'evoStage')[] = ['teffK', 'distanceLy', 'ageMyr', 'radiusRsun', 'evoStage'];
const pctMemo = new WeakMap<readonly KbObject[], Map<string, number[]>>();
function axisSorted(objs: readonly KbObject[], axis: FactKey | 'evoStage'): number[] {
  let m = pctMemo.get(objs);
  if (!m) { m = new Map(); pctMemo.set(objs, m); }
  let arr = m.get(axis);
  if (!arr) {
    arr = objs.map((o) => progressionAxisValue(o, axis)).filter((v): v is number => v !== null).sort((a, b) => a - b);
    m.set(axis, arr);
  }
  return arr;
}
function percentile(sorted: readonly number[], v: number): number {
  if (!sorted.length) return 0.5;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  let hi2 = lo;
  while (hi2 < sorted.length && sorted[hi2] === v) hi2++;
  return ((lo + hi2) / 2) / sorted.length;
}

/** Doc 04 §4.2 criteria for one journey (needs arc roles on the stops for F7/F8/F18/F19). */
export function computeCriteria(input: FeatureInput, opts: CriteriaOptions = {}): Doc04Criteria {
  const st = input.stops;
  const n = st.length;
  const objs = st.map((s) => s.object);
  const cidx = conceptIndex(input.concepts);
  const strong = objs.map((o) => conceptClosure(o, input.concepts, 2));
  const theme = new Set<string>();
  for (const id of input.template?.coreConcepts ?? []) {
    theme.add(id);
    let p = cidx.get(id)?.parent, g = 0;
    while (p && g++ < 8) { theme.add(p); p = cidx.get(p)?.parent; }
  }
  const learned = new Set(opts.learnedConcepts ?? []);
  const seen = new Set(opts.seenObjectIds ?? []);
  const R = input.radius > 0 ? input.radius : 30;
  const center = input.center ?? meanPosition(objs.map((o) => ({ ra: o.ra, dec: o.dec })));
  const geo = pathGeometry(objs.map((o) => ({ ra: o.ra, dec: o.dec })), center, R);

  // F1, F2
  const F1 = theme.size ? strong.filter((c) => Array.from(c).some((x) => theme.has(x))).length / Math.max(1, n) : 0;
  const pairJ = strong.slice(1).map((c, i) => jaccard(strong[i], c));
  const F2 = pairJ.length ? mean(pairJ) : 0;

  // F3 prerequisite violations / bridges, F11 new terms, F12 core concepts
  const taught = new Set<string>(learned);
  let F3 = 0, termsMax = 0, termsTotal = 0;
  const seenTerms = new Set<string>();
  const core3 = new Set<string>();
  objs.forEach((o, i) => {
    const primary = o.teaches.slice().sort((a, b) => b.strength - a.strength)[0];
    if (primary) {
      const pre = cidx.get(primary.conceptId)?.prereqs ?? [];
      if (pre.some((p) => !taught.has(p))) F3++;
    }
    let fresh = 0;
    for (const t of o.teaches) {
      if (t.strength === 3) core3.add(t.conceptId);
      if (t.strength < 2 || learned.has(t.conceptId)) continue;
      for (const term of cidx.get(t.conceptId)?.terms ?? []) if (!seenTerms.has(term)) { seenTerms.add(term); fresh++; }
    }
    termsMax = Math.max(termsMax, fresh);
    termsTotal += fresh;
    strong[i].forEach((c) => taught.add(c));
    o.teaches.forEach((t) => taught.add(t.conceptId));
  });

  // F4 contrast (KB-wide percentile ranks)
  const pool = opts.kbObjects ?? objs;
  const contrast: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = objs[i], b = objs[i + 1];
    const shares = featureKind(a) === featureKind(b) || a.con === b.con || jaccard(strong[i], strong[i + 1]) > 0
      || a.contextIds.some((c) => b.contextIds.includes(c));
    if (!shares) { contrast.push(0); continue; }
    let best = featureKind(a) !== featureKind(b) ? 0.5 : 0;
    for (const axis of CONTRAST_AXES) {
      const va = progressionAxisValue(a, axis), vb = progressionAxisValue(b, axis);
      if (va === null || vb === null) continue;
      const sorted = axisSorted(pool, axis);
      best = Math.max(best, Math.abs(percentile(sorted, va) - percentile(sorted, vb)));
    }
    contrast.push(best);
  }

  // F5 monotonicity along the archetype axis, hook and coda excluded
  let F5 = 0;
  const prog = input.template?.progression;
  if (prog) {
    const pts: [number, number][] = [];
    st.forEach((s, i) => {
      if (s.arc === 'hook' || s.arc === 'coda') return;
      const v = progressionAxisValue(s.object, prog.property);
      if (v !== null) pts.push([i, v]);
    });
    if (pts.length >= 2) {
      const tau = kendallTau(pts.map((p) => p[0]), pts.map((p) => p[1]));
      F5 = prog.direction === 'down' ? -tau : prog.direction === 'arc' ? Math.abs(tau) : tau;
    }
  }

  // F6 family entropy, runs
  const kinds = objs.map(featureKind);
  const counts = new Map<string, number>();
  kinds.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  let H = 0;
  counts.forEach((c) => { const p = c / n; H -= p * Math.log(p); });
  let runs = 0, run = 1;
  for (let i = 1; i < n; i++) {
    if (kinds[i] === kinds[i - 1]) { run++; if (run === 3) runs++; } else run = 1;
  }

  // F7–F10 arc
  const wi = objs.map((o) => o.wow + o.insight);
  let peak = 0;
  wi.forEach((v, i) => { if (v > wi[peak]) peak = i; });
  const first = objs[0], last = objs[n - 1];
  // Callback: the last stop shares a concept or a context (association, cloud) with the hook.
  const callback = n >= 2 && (jaccard(strong[0], strong[n - 1]) > 0 || last.contextIds.some((c) => first.contextIds.includes(c)));

  // F13 difficulty ramp
  const diff = objs.map((o) => o.obsDifficulty);
  let maxJump = 0;
  for (let i = 1; i < n; i++) if (!(st[i].rating >= 2)) maxJump = Math.max(maxJump, diff[i] - diff[i - 1]);

  // F17 duration: dwell by difficulty + hop time (≈0.5 min per binocular field, ≥0.5 min per hop)
  const fov = input.fovDeg > 0 ? input.fovDeg : 5;
  const duration = diff.reduce((a, d) => a + 5 + 1.5 * (d - 1), 0) + geo.hops.reduce((a, h) => a + Math.max(0.5, 0.5 * (h / fov)), 0);

  const minAltFloor = opts.minAlt ?? 30;
  const linkS = st.slice(1).map((s) => s.link?.strength ?? 0);
  const out: Doc04Criteria = {
    F1_themeCoverage: F1,
    F2_conceptContinuity: F2,
    F3_prereqViolations: F3,
    F4_contrastMean: contrast.length ? mean(contrast) : 0,
    F4_contrastMax: contrast.length ? Math.max(...contrast) : 0,
    F5_orderingMonotonicity: F5,
    F6_familyEntropy: n > 1 ? H / Math.log(n) : 0,
    F6_familyRuns: runs,
    F7_payoffPosition: n ? (peak + 1) / n : 0,
    F8_hookOk: first && first.wow >= 3 && first.obsDifficulty <= 2 ? 1 : 0,
    F8_hookWow: first?.wow ?? 0,
    F9_peakEnd: n ? (wi[peak] + wi[n - 1]) / 2 : 0,
    F10_callback: callback ? 1 : 0,
    F11_newTermsMax: termsMax,
    F11_newTermsTotal: termsTotal,
    F12_coreConcepts: core3.size,
    F12_bridges: F3,
    F13_difficultyRho: spearmanRho(diff.map((_, i) => i), diff),
    F13_maxJump: maxJump,
    F13_startDifficulty: first?.obsDifficulty ?? 0,
    F14_visibilityMarginDeg: Math.min(...st.map((s) => s.minAlt)) - minAltFloor,
    F15_linkMean: linkS.length ? mean(linkS) : 0,
    F15_linkMin: linkS.length ? Math.min(...linkS) : 0,
    F16_pathDeg: geo.pathDeg,
    F16_maxHopDeg: geo.maxHopDeg,
    F16_reversals: geo.reversals,
    F17_durationMin: duration,
    F18_wonderDensity: n ? objs.filter((o, i) => o.insight >= 4 || o.superlatives.length > 0 || st[i].arc === 'twist').length / n : 0,
    F19_misconceptionTwists: objs.filter((o, i) => o.misconceptions.length > 0 && st[i].arc === 'twist').length,
    F20_novelty: n ? objs.filter((o) => !seen.has(o.id)).length / n : 1,
  };
  for (const k of Object.keys(out) as (keyof Doc04Criteria)[]) out[k] = Number.isFinite(out[k]) ? r9(out[k]) : 0;
  return out;
}

// ───────────────────────────── engine adapter ─────────────────────────────

/** Build a FeatureInput from the engine's scoring hook (assemble.ts). */
export function featureInputFromScoring(x: ScoringInput): FeatureInput {
  const { table, plan, journey } = x;
  const { prep, s, grid } = table;
  const n = plan.stops.length;
  const start0 = grid.intervals[0].samples[0];
  const stops: FeatureStopInput[] = plan.stops.map((ps, i) => {
    const o = prep.objects[ps.obj];
    const ev = table.stops[ps.obj][i];
    const tr = table.tracks[ps.obj];
    const iv = grid.intervals[i];
    const endK = iv.samples[iv.samples.length - 1];
    const js = journey.stops[i];
    return {
      object: o,
      alt: js?.altAtStart ?? ev.altStart,
      minAlt: ev.minAlt,
      glow: ev.maxGlow,
      moonSep: ev.minMoonSep,
      rating: Math.max(0, ev.rating),
      sunAlt: ev.maxSunAlt,
      // Analytic without a binding skyline; sampled against it when the hills rise above minAlt (conditions.minutesClear).
      minutesLeft: minutesClear(tr.raDate, tr.decDate, s, grid.gastDeg[endK]),
      minutesToSet: minutesClear(tr.raDate, tr.decDate, s, grid.gastDeg[start0]),
      link: js?.link ? { type: js.link.type, strength: js.link.strength, curated: js.link.curated } : null,
      arc: js?.arc ?? plan.template.t.slots[ps.slot]?.arc,
    };
  });
  let illum = 0;
  for (let i = 0; i < n; i++) {
    for (const k of grid.intervals[i].samples) if (grid.moonUp[k]) illum = Math.max(illum, grid.moon[k].illumination);
  }
  return {
    stops,
    center: plan.center,
    radius: plan.radius,
    fovDeg: s.fovDeg,
    moonIllumination: illum,
    skyBrightness: s.sky,
    template: plan.template.t,
    concepts: x.kb.concepts,
  };
}
