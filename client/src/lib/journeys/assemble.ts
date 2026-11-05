/**
 * Sky Journeys engine entry point: `generate(kb, req) → JourneyResult` (doc 05 §3, §5.7–5.8, §9).
 *
 * S0 night context → S1 candidate table → S2 patches → S3/S4 template-guided beam search →
 * S5 exact re-ordering + the single validator → S6 scoring → S7 MMR / Gumbel shuffle → texts.
 * If fewer than `limit` DISTINCT journeys survive (different archetype, < MAX_SHARED_STOPS shared stops),
 * constraints are relaxed in doc 05 order (length, region radius, altitude floor 25°, one challenge stop at
 * first-night level); Moon, twilight and rating-3 rules never relax. The strict length and the length relaxation
 * share one search (the relaxed tier is validated only when needed).
 * Selection (P4 evaluation, docs/sky-journeys/engine-eval.md; owner feedback round 1): MMR over shared stops /
 * opener / archetype / patch over the best few eligible journeys for each pick (PICK_WINDOW: suggestions come from
 * the top of the score distribution), a repeated archetype only as a last resort, never two near-identical
 * journeys (≥ 2 shared stops, or the same archetype over the same region) and never two equal titles,
 * night-seeded rotation (never per slot), one slot reserved for a bright-Moon archetype on a moonlit night,
 * relaxed lengths ranked by closeness to the request, and at most one contrast tour (A6), placed only where it beats
 * every other story by A6_MARGIN (theme balance, unless the request forces an A6 theme).
 * Pure function of (kb, request, model): no Date.now(), no Math.random(), no storage.
 *
 * Wiring (P3):
 * - Scorer: `opts.scorer`, else the learned `opts.model` (score.ts createModelScorer, invalid → heuristic), else h.
 * - Texts: every title / transition / why-here / skip / story line comes from narrate.ts (narrateAndApply) for
 *   the journeys that are returned; {region} is the bare constellation name holding most stops ("Orion").
 * - Keys: Journey.key is a regenerable key (journey-key.ts); `rebuildJourney(kb, key, req)` rebuilds the
 *   journey and re-validates it with the single validator.
 * - Journey.conditions / JourneyResult.conditions summarise the night for the conditions strip.
 * - At most one archetype switch per journey (Template.switchRule; search.ts / validate.ts PlanSwitch), and none for a
 *   theme told through a lens (round 3: a journey is one story).
 */
import * as Astro from 'astronomy-engine';
import { formatInTimeZone } from 'date-fns-tz';
import { angularDistance as angular, eqToHorizontal, getConstellationName } from '../astronomy';
import { moonState } from '../moon';
import {
  FALLBACK_MIN_ALT, GLOW_LIMIT, MIN_STOPS, PATH_OVER_RADIUS, MAX_HOP_DEG, SUN_LIMIT_DSO, SUN_LIMIT_STAR, buildNightContext, buildNightGrid,
  fastAltAz, moonCategory, moonDuring, moonMinSeparation, moonIsUp, moonVerdict, nextMoonEvent, normalizeRequest, ofDateConverter, sunCrossings, sunLimitFor,
  type EngineSettings, type NightGrid,
} from './conditions';
import { buildCandidateTable, lensArcAt, lensOf, prepareKb, slotAccepts, templateNightBlock, type CandidateTable, type PreparedKb } from './candidates';
import { buildGetThere, chooseAnchor, type AnchorCandidate } from './getthere';
import { decodeJourneyKey, encodeJourneyKey, kbHashOf, type JourneyKeyData } from './journey-key';
import { narrateAndApply, type JourneyNarration } from './narrate';
import { reorderAndValidate } from './order';
import { altAzPhrase, buildPatches, pathGeometry, type Patch } from './region';
import { createModelScorer } from './score';
import { moonlitFit, planHeuristic, searchJourneys, selectTemplates, themeMatches, type SearchCandidate } from './search';
import { buildSeedKey, gumbel, localNightDate, quantize, rngFor, slotStartMs } from './seed';
import { compileSwitch, journeyViolations, partEnd, planLinks, stopTemplate, type Plan, type Violation } from './validate';
import type {
  Journey, JourneyConditions, JourneyRequest, JourneyResult, JourneyStop, KnowledgeBase,
  LimitingFactor, NightContext, RejectReason, ScorerModel,
} from './types';

// ───────────────────────────── scoring hook ─────────────────────────────

export interface ScoringInput {
  journey: Journey;
  plan: Plan;
  /** Hand-tuned heuristic h of the plan (doc 05 §5.5). */
  heuristic: number;
  table: CandidateTable;
  kb: KnowledgeBase;
  night: NightContext;
  request: JourneyRequest;
}
export interface ScoreOutput {
  score: number;
  features?: number[];
  scorer: ScorerModel['type'];
}
/** Ranks one valid journey. The default uses the heuristic h; the learned scorer plugs in here. */
export type JourneyScorer = (x: ScoringInput) => ScoreOutput;
export const heuristicScorer: JourneyScorer = (x) => ({ score: x.heuristic, scorer: 'heuristic' });

export interface GenerateOptions {
  /** Learned scorer (model.json). Used when `scorer` is absent; invalid models fall back to the heuristic. */
  model?: ScorerModel | null;
  /** Explicit scorer; default `createModelScorer(model)` with a model, else `heuristicScorer`. */
  scorer?: JourneyScorer;
  /** Allow the one archetype switch per journey (spec decision 6). Default true. */
  switches?: boolean;
  /** Training-slate mode: no relaxations, no MMR; returns the whole valid pool ranked by score. */
  explore?: boolean;
  /** Timing source for diagnostics.ms only (never affects the result). */
  clock?: () => number;
  /** When given with `clock`, receives cumulative milliseconds per stage (table, patches, search, order). */
  profile?: Record<string, number>;
  /**
   * Debug/eval hook: receives the whole ranked pool selection drew from (relaxed tiers last, then by score; texts
   * not narrated yet), so callers can see how deep the suggestions sit (owner feedback round 1). Read only.
   * `info[i]` gives the relaxation tier of `ranked[i]` (0 = strict) and the relaxations it relies on.
   */
  inspectPool?: (ranked: readonly Readonly<Journey>[], info: readonly PoolInfo[]) => void;
}

/** Per pool entry (GenerateOptions.inspectPool): relaxation tier (0 = strict) and the relaxations it relies on. */
export interface PoolInfo { tier: number; relaxed: readonly string[] }

// ───────────────────────────── internals ─────────────────────────────

interface Built {
  journey: Journey;
  plan: Plan;
  patch: Patch;
  h: number;
  ids: string[];
  /** Template (+ switch) and ordered stop ids: two Builts with the same ident are the same journey. */
  ident?: string;
  /** Settings of the run that produced it (relaxed runs differ). */
  s: EngineSettings;
  /** 0 = strict; n = found after the n-th relaxation (ranks after every strict journey). */
  tier: number;
  /** Relaxations the journey relies on. */
  relaxed?: string[];
  /** Stops short of / beyond the requested length (length relaxation; ranking only). */
  lengthMiss?: number;
  /** Centroid of the stops (near-identical suggestions, NEAR_REGION_DEG). */
  centroid?: { ra: number; dec: number };
}

interface RunResult {
  built: Built[];
  /** Candidates held back by runOnce's `only` filter, validated on demand. */
  more?: () => Built[];
  table: CandidateTable;
  patches: Patch[];
  searched: number;
  dropped: Partial<Record<RejectReason, number>>;
}

const tableMemo = new Map<string, CandidateTable>();
const gridMemo = new Map<string, NightGrid>();
function remember<T>(m: Map<string, T>, key: string, make: () => T, size = 6): T {
  const hit = m.get(key);
  if (hit) { m.delete(key); m.set(key, hit); return hit; }
  const v = make();
  m.set(key, v);
  while (m.size > size) m.delete(m.keys().next().value as string);
  return v;
}

function tableFor(prep: PreparedKb, s: EngineSettings, depth: number): CandidateTable {
  const gridKey = [s.slotMs, s.lat, s.lon, s.sky, s.minutesPerStop, s.length].join('|');
  const grid = remember(gridMemo, gridKey, () => buildNightGrid(s));
  const key = [prep.kb.version, gridKey, s.minAlt, s.fovDeg, s.aperture, s.magnification, s.stabilized, s.includeChallenge,
    s.openDirections ? Array.from(s.openDirections).sort().join(',') : '*', depth].join('|');
  let t = remember(tableMemo, key, () => buildCandidateTable(prep, s, grid, depth));
  // A new KB object with the same version string must not reuse rows.
  if (t.prep !== prep) { t = buildCandidateTable(prep, s, grid, depth); tableMemo.set(key, t); }
  // Rows depend only on the key above; everything else (instant, radius limits, seen, limit…) is per request.
  return { ...t, s };
}

const siderealDeg = (t: number) => Astro.SiderealTime(new Date(t)) * 15;

/**
 * Seed for every journey text (titles, transitions, get-there lines, story). Texts vary with the journey key
 * (which carries the 15-minute slot) but not with the request, so a journey rebuilt from its key reads the same.
 */
export const TEXT_SEED = 'journeys-text-1';

function timeLabel(ms: number, s: EngineSettings): string {
  return s.timezone ? formatInTimeZone(new Date(ms), s.timezone, 'HH:mm') : `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/** Times (around the request) when every stop of the journey passes the sky rules (alt, darkness, Moon). */
function bestWindow(table: CandidateTable, objs: number[], s: EngineSettings): { start: string; end: string } | undefined {
  const step = 15 * 60_000, m = s.minutesPerStop * 60_000, n = objs.length;
  const conv = ofDateConverter(s.slotMs);
  const pos = objs.map((i) => conv.raDec(table.prep.objects[i].ra, table.prep.objects[i].dec));
  const moonCache = new Map<number, ReturnType<typeof moonState>>();
  const moonAt = (t: number) => { let x = moonCache.get(t); if (!x) { x = moonState(s.lat, s.lon, new Date(t)); moonCache.set(t, x); } return x; };
  const okAt = (t0: number) => objs.every((idx, i) => [t0 + i * m, t0 + (i + 1) * m].every((t) => {
    const o = table.prep.objects[idx];
    const h = fastAltAz(pos[i].ra, pos[i].dec, s.lat, s.lon, siderealDeg(t));
    const mo = moonAt(Math.round(t / step) * step);
    if (h.alt < s.minAlt || mo.sunAlt > sunLimitFor(o)) return false;
    // The shared Moon verdict (lib/sky-feasibility.ts): separation floor and glow limit, nothing with the Moon down.
    return !moonIsUp(mo) || moonVerdict({ alt: h.alt, separation: angular(o.ra, o.dec, mo.ra, mo.dec), category: moonCategory(o) }, mo, s.sky).ok;
  }));
  if (!okAt(s.slotMs)) return undefined;
  let a = s.slotMs, b = s.slotMs;
  for (let k = 0; k < 40 && okAt(a - step); k++) a -= step;
  for (let k = 0; k < 40 && okAt(b + step); k++) b += step;
  return { start: new Date(a).toISOString(), end: new Date(b + n * m).toISOString() };
}


/** Identity of a plan (template, switch, ordered stops): what makes two journeys "the same". */
function identOf(prep: PreparedKb, plan: Plan): string {
  const sw = plan.switch ? `>${plan.switch.template.t.id}@${plan.switch.at}` : '';
  return `${plan.template.t.id}${sw}|${plan.stops.map((x) => prep.objects[x.obj].id).join('>')}`;
}

/** Regenerable key (journey-key.ts) of a plan found under settings `s`. */
export function journeyKeyOf(prep: PreparedKb, s: EngineSettings, plan: Plan): string {
  return encodeJourneyKey({
    kbHash: kbHashOf(prep.kb.version),
    templateId: plan.template.t.id,
    switch: plan.switch ? { toTemplateId: plan.switch.template.t.id, at: plan.switch.at } : null,
    stopIds: plan.stops.map((x) => prep.objects[x.obj].id),
    slots: plan.stops.map((x) => x.slot),
    slotMinute: Math.round(s.slotMs / 60_000),
    lat: s.lat, lon: s.lon,
    fovDeg: s.fovDeg, aperture: s.aperture, magnification: s.magnification, stabilized: s.stabilized,
    skyBrightness: s.sky,
    minAlt: s.minAlt, regionRadius: plan.radius, minutesPerStop: s.minutesPerStop, includeChallenge: s.includeChallenge,
    centerRa: plan.center.ra, centerDec: plan.center.dec,
  });
}

/** Bare region name for titles ({region}): the constellation holding most of the stops (weighted by interest). */
function regionNameOf(objs: readonly { con: string; interest: number }[]): string {
  const w = new Map<string, number>();
  for (const o of objs) w.set(o.con, (w.get(o.con) ?? 0) + 1 + o.interest);
  const con = Array.from(w.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return con ? getConstellationName(con) : 'the sky';
}

/** Naked-eye anchors (mag ≤ 3, above 15°) at the start of stop interval i; memoised per candidate table rows. */
const anchorMemo = new WeakMap<CandidateTable['tracks'], AnchorCandidate[][]>();
function anchorPoolOf(table: CandidateTable, i: number): AnchorCandidate[] {
  let byStop = anchorMemo.get(table.tracks);
  if (!byStop) { byStop = []; anchorMemo.set(table.tracks, byStop); }
  let pool = byStop[i];
  if (!pool) {
    const k0 = table.grid.intervals[i].samples[0];
    pool = [];
    table.prep.objects.forEach((o, k) => {
      const alt = table.tracks[k].alt[k0];
      if (o.mag !== null && o.mag <= 3 && alt > 15) pool!.push({ id: o.id, name: o.names.display, ra: o.ra, dec: o.dec, mag: o.mag, alt, az: table.tracks[k].az[k0], con: o.con });
    });
    byStop[i] = pool;
  }
  return pool;
}

function buildJourney(table: CandidateTable, plan: Plan, patch: Patch, h: number): Built {
  const { prep, s } = table;
  const t = plan.template.t;
  const objs = plan.stops.map((x) => x.obj);
  const ids = objs.map((i) => prep.objects[i].id);
  const key = journeyKeyOf(prep, s, plan);
  const links = planLinks(table, plan);
  const geo = pathGeometry(objs.map((i) => prep.objects[i]), plan.center, plan.radius);
  const bank = prep.kb.narration;
  const m = s.minutesPerStop * 60_000;
  const positions = objs.map((idx, i) => {
    const o = prep.objects[idx];
    const at = s.instantMs + i * m;
    return { ...eqToHorizontal(o.ra, o.dec, s.lat, s.lon, new Date(at)), ra: o.ra, dec: o.dec, id: o.id, name: o.names.display, con: o.con, at };
  });
  const anchorPool = (i: number) => anchorPoolOf(table, i);
  const stops: JourneyStop[] = objs.map((idx, i) => {
    const o = prep.objects[idx];
    const ev = table.stops[idx][i];
    const tpl = stopTemplate(plan, i);
    const slot = tpl.t.slots[plan.stops[i].slot];
    // A lens theme's arc is positional (first stop hook, its part's last stop payoff); its lens is the stop's card lens.
    const afterSwitch = !!plan.switch && i > plan.switch.at;
    const arc = tpl.lens ? lensArcAt(i, afterSwitch ? plan.switch!.at + 1 : 0, partEnd(plan, i), !afterSwitch) : slot.arc;
    const lens = lensOf(tpl, o.id);
    const e = i > 0 ? links[i - 1] : null;
    const p = positions[i];
    const rng = rngFor(TEXT_SEED, key, 'get-there', i);
    const prevPos = i > 0 ? positions[i - 1] : null;
    const pool = anchorPool(i);
    const target: AnchorCandidate = { id: o.id, name: o.names.display, ra: o.ra, dec: o.dec, mag: o.mag, alt: p.alt, az: p.az, con: o.con };
    const anchor = chooseAnchor(target, pool, (a, b) => angular(a.ra, a.dec, b.ra, b.dec), s.minAlt);
    return {
      index: i,
      objectId: o.id,
      role: slot.label,
      arc,
      link: e ? { from: prep.objects[objs[i - 1]].id, type: e.type, subtype: e.subtype, strength: e.strength, reasonKey: e.reasonKey, curated: e.curated } : null,
      windowStart: new Date(p.at).toISOString(),
      windowEnd: new Date(p.at + m).toISOString(),
      altAtStart: Math.round(p.alt * 10) / 10,
      azAtStart: Math.round(p.az * 10) / 10,
      moonSepDeg: ev.minMoonSep === null ? null : Math.round(ev.minMoonSep * 10) / 10,
      challenge: ev.rating === 2,
      // Filled by the narrator (narrate.ts) for the journeys that are returned.
      transitionText: null,
      getThere: buildGetThere({
        prev: prevPos, next: p, anchor, fovDeg: s.fovDeg,
        distanceDeg: i > 0 ? geo.hops[i - 1] : 0,
        anchorDistanceDeg: anchor ? angular(anchor.ra, anchor.dec, o.ra, o.dec) : 0,
        bank, rng,
      }),
      ...(lens ? { lens: { ...lens } } : {}),
    };
  });
  const challengeStop = stops.find((x) => x.challenge);
  const hardest = objs.reduce((a, b) => (prep.objects[b].obsDifficulty > prep.objects[a].obsDifficulty ? b : a), objs[0]);
  const difficulty: Journey['difficulty'] = challengeStop ? 'stretch' : prep.objects[hardest].obsDifficulty >= 3 ? 'moderate' : 'easy';
  const difficultyReason = challengeStop
    ? `${prep.objects[prep.index.get(challengeStop.objectId)!].names.display} is a faint challenge stop; a dark sky and steady hands help.`
    : difficulty === 'moderate' ? `${prep.objects[hardest].names.display} is faint or tricky to find.` : undefined;
  const regionName = regionNameOf(objs.map((i) => prep.objects[i]));
  const centerHz = eqToHorizontal(plan.center.ra, plan.center.dec, s.lat, s.lon, new Date(s.instantMs));
  const where = altAzPhrase(centerHz.alt, centerHz.az);
  const sw = plan.switch;
  const journey: Journey = {
    key,
    templateId: t.id,
    title: t.title,
    drivingQuestion: t.drivingQuestion,
    hook: t.hookLine,
    stops,
    regionCenter: {
      ra: plan.center.ra, dec: plan.center.dec, altDeg: Math.round(centerHz.alt * 10) / 10, azDeg: Math.round(centerHz.az * 10) / 10,
      label: `${where.charAt(0).toUpperCase()}${where.slice(1)}, around ${regionName}`,
    },
    regionRadius: plan.radius,
    totalPathDeg: Math.round(geo.pathDeg * 10) / 10,
    durationMin: Math.round((objs.length * m) / 60_000),
    difficulty,
    ...(difficultyReason ? { difficultyReason } : {}),
    score: 0,
    regionName,
    ...(sw ? { switch: { atStop: sw.at, fromTemplateId: t.id, toTemplateId: sw.template.t.id, toTitle: sw.template.t.title } } : {}),
  };
  return { journey, plan, patch, h, ids, ident: identOf(prep, plan), s, tier: 0, centroid: centroidOf(objs.map((i) => prep.objects[i])) };
}

/** Mean direction of a set of sky positions (degrees). */
function centroidOf(objs: readonly { ra: number; dec: number }[]): { ra: number; dec: number } {
  let x = 0, y = 0, z = 0;
  for (const o of objs) {
    const r = (o.ra * Math.PI) / 180, d = (o.dec * Math.PI) / 180;
    x += Math.cos(d) * Math.cos(r); y += Math.cos(d) * Math.sin(r); z += Math.sin(d);
  }
  const ra = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { ra, dec: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI };
}

/** Writes the narrated texts (title, question, hook, story, transitions, why-here, skip texts) into the journey. */
function narrateBuilt(b: Built, kb: KnowledgeBase, night: NightContext): JourneyNarration {
  const { journey, narration } = narrateAndApply(b.journey, kb, {
    seedKey: TEXT_SEED,
    region: b.journey.regionName,
    moonIllumination: night.moon.up ? night.moon.illumination : 0,
  });
  b.journey = journey;
  return narration;
}

/** Cumulative stage timer for GenerateOptions.profile (no-op without clock + profile). */
function stageTimer(opts: GenerateOptions): (stage: string) => void {
  let mark = opts.clock?.() ?? 0;
  return (stage) => {
    if (!opts.clock || !opts.profile) return;
    const t = opts.clock();
    opts.profile[stage] = (opts.profile[stage] ?? 0) + (t - mark);
    mark = t;
  };
}

/** Candidates per stop count validated for the length-relaxed tier (it only fills variety). */
const RELAXED_PER_LENGTH = 120;

/**
 * One search + validation pass. With `only`, just the candidates whose stop count passes it are validated now; the
 * others wait in RunResult.more (validated on demand, e.g. when the length relaxation is needed).
 */
function runOnce(prep: PreparedKb, s: EngineSettings, lengthRange: [number, number], explore: boolean, opts: GenerateOptions = {}, only?: (stops: number) => boolean): RunResult {
  const lap = stageTimer(opts);
  // One spare stop index (L + 1) so the length relaxation (3 … L + 1) reuses the same candidate table.
  const depth = Math.min(10, Math.max(lengthRange[1], s.length + 1));
  const table = tableFor(prep, s, depth);
  lap('table');
  const g = table.grid;
  const mid = g.midIndex;
  const conv = ofDateConverter(g.times[mid]);
  const moonMid = g.moon[mid];
  const patches = buildPatches(prep.objects.map((o, i) => ({
    ra: o.ra, dec: o.dec, feasible: table.feasibleMask[i] !== 0, interest: o.interest,
    concepts: Array.from(prep.coreConcepts[i]), con: o.con,
  })), {
    radius: s.radius,
    minAlt: s.minAlt,
    altAz: (ra, dec) => { const p = conv.raDec(ra, dec); return fastAltAz(p.ra, p.dec, s.lat, s.lon, g.gastDeg[mid]); },
    moon: { up: g.moonUp[mid], ra: moonMid.ra, dec: moonMid.dec, illumination: moonMid.illumination },
  });
  lap('patches');
  // Night gates (dark sky, Moon limits) read the brightest Moon while it is up during the requested journey.
  const moonIll = moonDuring(g, s.length);
  const templates = selectTemplates(prep, s.theme, s.sky, moonIll);
  // Switch targets ignore the theme filter (the theme may drift once) but keep the night gates.
  const switchable = new Map(selectTemplates(prep, null, s.sky, moonIll).map((ct) => [ct.t.id, ct] as const));
  const { candidates, stats } = searchJourneys(table, patches, templates, {
    lengthRange,
    beamWidth: explore ? 48 : 24,
    keepPerPair: explore ? 48 : 24,
    ...(opts.switches === false ? {} : {
      switchTargets: (ct) => (ct.t.switchRule?.to ?? []).map((id) => switchable.get(id)).filter((x): x is NonNullable<typeof x> => !!x),
    }),
  });
  // Exact re-ordering for the most promising candidates, validation for all.
  lap('search');
  if (opts.profile && opts.clock) {
    opts.profile.expansions = (opts.profile.expansions ?? 0) + stats.expansions;
    opts.profile.pairsTried = (opts.profile.pairsTried ?? 0) + stats.pairsTried;
  }
  const ranked = candidates.slice().sort((a, b) => b.h - a.h || a.key.localeCompare(b.key));
  const dropped: Partial<Record<RejectReason, number>> = {};
  // Exact re-ordering for the 160 most promising candidates of each stop count (the rank is counted per stop
  // count, so validating one length now and the others later gives the same result as one pass).
  const rankInLength = new Map<number, number>();
  const rankOf = new Map(ranked.map((c) => {
    const len = c.plan.stops.length;
    const n = rankInLength.get(len) ?? 0;
    rankInLength.set(len, n + 1);
    return [c, n] as const;
  }));
  const validate = (list: SearchCandidate[]): Built[] => {
    const best = new Map<string, Built>();
    for (const c of list) {
      const { result, violations } = reorderAndValidate(table, c.plan, { exact: rankOf.get(c)! < 160 });
      if (!result) {
        for (const v of violations) dropped[v.code] = (dropped[v.code] ?? 0) + 1;
        continue;
      }
      const k = identOf(prep, result.plan);
      const prev = best.get(k);
      if (prev && prev.h >= result.h) continue;
      best.set(k, buildJourney(table, result.plan, c.patch, result.h));
    }
    lap('order+build');
    return Array.from(best.values());
  };
  const now = only ? ranked.filter((c) => only(c.plan.stops.length)) : ranked;
  // The held-back (relaxed) tier only fills variety: its best RELAXED_PER_LENGTH candidates per stop count suffice.
  const later = only ? ranked.filter((c) => !only(c.plan.stops.length) && rankOf.get(c)! < RELAXED_PER_LENGTH) : [];
  return { built: validate(now), table, patches, searched: candidates.length, dropped, ...(later.length ? { more: () => validate(later) } : {}) };
}

// ───────────────────────────── ranking & diversity (S6–S7) ─────────────────────────────

const jaccard = (a: readonly string[], b: readonly string[]) => {
  const B = new Set(b);
  let inter = 0;
  for (const x of a) if (B.has(x)) inter++;
  return inter / (a.length + b.length - inter || 1);
};
const sharedStops = (a: Built, b: Built) => { const B = new Set(b.ids); return a.ids.filter((x) => B.has(x)).length; };
/**
 * Similarity of two suggestions (P4 evaluation: the three suggestions shared 2.2 stops on average and often the
 * same opener). Shared stops count against the shorter journey; the same opener, archetype or patch add to it.
 */
const similarity = (a: Built, b: Built) =>
  sharedStops(a, b) / Math.min(a.ids.length, b.ids.length)
  + (a.ids[0] === b.ids[0] ? 0.3 : 0)
  + (a.journey.templateId === b.journey.templateId ? 0.3 : 0)
  + (a.patch.id === b.patch.id ? 0.15 : 0);
/**
 * A suggestion sharing MAX_SHARED_STOPS stops with one already picked is never shown with it (nearIdentical); one
 * telling the same archetype again only as a last resort (−1). Three suggestions should be three different stories.
 */
export const MAX_SHARED_STOPS = 2;
/**
 * Ranking cost (on the 0..1 normalised score) per stop a length-relaxed journey misses the requested length by:
 * for an 8-stop request a 7-stop journey ranks before a 4-stop one.
 */
export const LENGTH_MISS_COST = 0.1;
/** Moon illumination (up, at the request) above which one suggestion is reserved for a bright-Moon archetype. */
export const MOONLIT_PREFER = 0.5;
/** Night rotation (staleness): Gumbel noise scale on the normalised score, seeded per night, not per slot. */
export const NIGHT_ROTATION = 0.12;
/**
 * Suggestions come from the top of the score distribution (owner feedback round 1: the app's own top 3 sat at pool
 * ranks #35..#174, because MMR and the night rotation's Gumbel noise ranged over the whole pool, and the more
 * journeys get a lottery ticket the deeper the winner). Each pick is now made among the PICK_WINDOW best journeys
 * still eligible for it (not near-identical to an earlier pick, of an archetype not shown yet while the pool has
 * one): rotation and MMR only reorder near-equals at the top. A pick sits deeper only when every journey above it
 * repeats a story already picked.
 */
export const PICK_WINDOW = 8;
/**
 * Two journeys of the same archetype whose stops are centred within this many degrees (or in the same named
 * region) are the same suggestion twice (owner, cal-02: "C and D are pretty much the same").
 */
export const NEAR_REGION_DEG = 20;
/**
 * Theme balance (owner feedback round 1, second pass): the contrast tours (A6) still led half the nights (most
 * Santiago and Sydney nights) after the h prior, because the pool holds many near-equal A6 tours over any patch of
 * bright stars. A result now holds at most ONE journey that tells A6 (as its template or after a switch), never as
 * a last resort either, and an A6 tour takes a slot only when it beats the best other eligible journey for that
 * slot by A6_MARGIN on the 0..1 normalised score, before rotation noise and MMR (nothing else of comparable
 * quality); otherwise it waits for a later slot. 0.15 of the pool's range is about 0.7 h on a typical night, more
 * than the gaps by which h preferred the A6 tours the owner ranked 3rd and 4th (cal-02, cal-03: about 0.5). A
 * forced A6 theme lifts both rules: the user asked for contrasts.
 */
export const CAPPED_ARCHETYPE = 'A6';
export const A6_MARGIN = 0.15;

/** Archetype of a template id ("A6-contrasts" → "A6"). */
const archetypeOfId = (id: string) => id.split('-')[0];
/** Does the journey tell the capped archetype (as its template or after its switch)? */
export function tellsCapped(b: Pick<Built, 'journey'> & { plan?: Partial<Plan> }): boolean {
  const own = b.plan?.template?.t.archetype ?? archetypeOfId(b.journey.templateId);
  const to = b.plan?.switch?.template.t.archetype ?? (b.journey.switch ? archetypeOfId(b.journey.switch.toTemplateId) : null);
  return own === CAPPED_ARCHETYPE || to === CAPPED_ARCHETYPE;
}

/**
 * Near-identical suggestions never appear together (owner feedback round 1): MAX_SHARED_STOPS or more shared
 * stops, or the same archetype over the same region (same region name, or stop centroids within NEAR_REGION_DEG).
 */
export function nearIdentical(a: Built, b: Built): boolean {
  if (sharedStops(a, b) >= MAX_SHARED_STOPS) return true;
  if (a.journey.templateId !== b.journey.templateId) return false;
  if (a.journey.regionName !== undefined && a.journey.regionName === b.journey.regionName) return true;
  return !!a.centroid && !!b.centroid && angular(a.centroid.ra, a.centroid.dec, b.centroid.ra, b.centroid.dec) < NEAR_REGION_DEG;
}

/** Learned-score bonus for a journey made only of Tonight's Best objects (JourneyRequest.boostIds), pro rata. */
export const BOOST_SCORE = 0.3;
/** Ranking bonus (normalised score units, below one relaxation tier) for covering every must-include object. */
export const MUST_INCLUDE_RANK = 0.9;
/** Share of the request's must-include objects (JourneyRequest.mustInclude) this journey visits. */
export function mustCoverage(b: Pick<Built, 'ids'> & { s?: Partial<Pick<EngineSettings, 'must'>> }): number {
  const must = b.s?.must;
  return must?.size ? b.ids.filter((id) => must.has(id)).length / must.size : 0;
}

/**
 * A journey shorter than this ranks after every journey of the same theme that has at least this many stops, whatever
 * the scores and tiers (round 3, owner simulator: three-stop Cygnus and Canes Venatici versions of A11 were picked over
 * four- and five-stop ones; a three-stop story rarely gets past its opening). SHORT_JOURNEY_DEMOTION outweighs every
 * relaxation tier.
 */
export const SHORT_JOURNEY_STOPS = 4;
export const SHORT_JOURNEY_DEMOTION = 10;

/** Ranking value of a journey before diversity: score normalised over the pool, relaxed tiers and length misses last. */
function baseValues(pool: readonly Built[]): Map<string, number> {
  if (!pool.length) return new Map();
  const scores = pool.map((b) => b.journey.score);
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const hasLong = new Set(pool.filter((b) => b.ids.length >= SHORT_JOURNEY_STOPS).map((b) => b.journey.templateId));
  // Relaxed-tier journeys always rank after strict ones (−1 per tier dominates the 0..1 normalised score); a short
  // journey after every longer one of its theme.
  return new Map(pool.map((b) => {
    const v = (hi > lo ? (b.journey.score - lo) / (hi - lo) : 1) - b.tier - LENGTH_MISS_COST * (b.lengthMiss ?? 0)
      - (b.ids.length < SHORT_JOURNEY_STOPS && hasLong.has(b.journey.templateId) ? SHORT_JOURNEY_DEMOTION : 0);
    // Must-include coverage ranks within a tier (MUST_INCLUDE_RANK < 1 per tier); untouched without mustInclude.
    return [b.journey.key, b.s?.must?.size ? v + MUST_INCLUDE_RANK * mustCoverage(b) : v];
  }));
}

/**
 * Greedy MMR (λ = 0.6 on `base` + optional Gumbel noise per Journey.key, −0.4·similarity to the picks) over the
 * PICK_WINDOW best eligible journeys for each slot. Never two near-identical journeys; a repeated archetype only
 * when no other is left (last resort); the last slot goes to a preferred journey (a bright-Moon archetype on a
 * moonlit night) when no earlier pick is one and an eligible one exists. With `capA6`: at most one A6 journey, and
 * only in a slot where it beats the best other eligible journey by A6_MARGIN.
 */
function selectTop(pool: Built[], k: number, base: Map<string, number>, noise: Map<string, number> | null, prefer?: (b: Built) => boolean, capA6 = false): Built[] {
  if (!pool.length) return [];
  const value = (b: Built) => quantize(base.get(b.journey.key)! + (noise?.get(b.journey.key) ?? 0));
  const ranked = pool.slice().sort((a, b) => base.get(b.journey.key)! - base.get(a.journey.key)! || (a.journey.key < b.journey.key ? -1 : a.journey.key > b.journey.key ? 1 : 0));
  const picked: Built[] = [];
  while (picked.length < k) {
    let left = ranked.filter((b) => !picked.includes(b) && !picked.some((p) => nearIdentical(b, p)));
    if (capA6 && picked.some(tellsCapped)) left = left.filter((b) => !tellsCapped(b));
    if (!left.length) break;
    const fresh = left.filter((b) => !picked.some((p) => p.journey.templateId === b.journey.templateId));
    if (fresh.length) left = fresh;
    if (prefer && k > 1 && picked.length === k - 1 && !picked.some(prefer)) {
      const preferred = left.filter(prefer);
      if (preferred.length) left = preferred;
    }
    // Theme balance: an A6 tour takes this slot only when it beats the best other eligible journey by A6_MARGIN on
    // the score itself (before rotation noise and MMR); otherwise it waits for a later slot.
    if (capA6) {
      const a6 = left.find(tellsCapped), other = left.find((b) => !tellsCapped(b));
      if (a6 && other && base.get(a6.journey.key)! - base.get(other.journey.key)! < A6_MARGIN) left = left.filter((b) => !tellsCapped(b));
    }
    let best = left[0], bestV = -Infinity;
    for (const b of left.slice(0, PICK_WINDOW)) {
      const sim = picked.length ? Math.max(...picked.map((p) => similarity(b, p))) : 0;
      const v = quantize(0.6 * value(b) - 0.4 * sim);
      if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && b.journey.key < best.journey.key)) { bestV = v; best = b; }
    }
    picked.push(best);
  }
  return picked;
}

/**
 * Canonical pick (shuffle 0) or the k-th deterministic shuffle (Gumbel-top-k + MMR, avoiding earlier shuffles),
 * both drawn from the top of the pool first (selectTop) and never holding two near-identical journeys.
 * `rotationSeed` (one value per observing night and site, never per 15-minute slot) adds NIGHT_ROTATION noise to
 * the canonical pick so near-equal journeys take turns from night to night instead of the same three repeating
 * for weeks; within one night the pick stays fixed (live mode does not reshuffle). `prefer` reserves the last
 * slot for a preferred journey when no earlier pick is one (bright-Moon archetypes on a moonlit night). `capA6`:
 * at most one A6 journey per page, in a slot only by A6_MARGIN (generate sets it unless the theme asks for A6).
 */
export function selectWithShuffle<T extends Built>(pool: T[], limit: number, shuffle: number, seedKey: string, rotationSeed?: string, prefer?: (b: Built) => boolean, capA6 = false): T[] {
  const memo = new Map<number, T[]>();
  const base = baseValues(pool);
  const rotation = rotationSeed
    ? new Map(pool.map((b) => [b.journey.key, NIGHT_ROTATION * gumbel(rngFor(rotationSeed, 'rotate', b.ident ?? b.journey.key))]))
    : null;
  const pick = (k: number): T[] => {
    const hit = memo.get(k);
    if (hit) return hit;
    let res: T[];
    if (k === 0) res = selectTop(pool, limit, base, rotation, prefer, capA6) as T[];
    else {
      const shownKeys = new Set<string>(), shown: T[] = [];
      for (let j = Math.max(0, k - 12); j < k; j++) for (const b of pick(j)) if (!shownKeys.has(b.journey.key)) { shownKeys.add(b.journey.key); shown.push(b); }
      const noise = new Map(pool.map((b) => [b.journey.key, 0.15 * gumbel(rngFor(seedKey, 'shuffle', k, b.journey.key))]));
      const fresh = pool.filter((b) => !shownKeys.has(b.journey.key));
      const distinct = fresh.filter((b) => shown.every((x) => jaccard(b.ids, x.ids) < 0.5));
      res = selectTop(distinct, limit, base, noise, prefer, capA6) as T[];
      // Fill from journeys shown before, never with one near-identical to a pick (owner feedback round 1).
      const fill = (from: T[]) => {
        if (res.length >= limit) return;
        const ok = (b: T) => !res.some((p) => nearIdentical(b, p)) && !(capA6 && tellsCapped(b) && res.some(tellsCapped));
        const more = selectTop(from.filter((b) => !res.includes(b) && ok(b)), limit, base, noise, undefined, capA6) as T[];
        for (const b of more) if (res.length < limit && ok(b)) res = res.concat(b);
      };
      fill(fresh);
      fill(pool);
    }
    memo.set(k, res);
    return res;
  };
  return pick(shuffle);
}

// ───────────────────────────── diagnostics ─────────────────────────────

/** Fewer feasible objects than this makes altitude a limiting factor (diagnostics). */
const LOW_FEASIBLE = 25;

function diagnose(runs: RunResult[], s: EngineSettings, night: NightContext, count: number, chosen: readonly Built[] = []): Pick<JourneyResult['diagnostics'], 'reasonsRejected' | 'limitingFactors' | 'message'> {
  const table = runs[0].table;
  const reasons: Partial<Record<RejectReason, number>> = {};
  let feasible = 0;
  table.feasibleMask.forEach((mask, i) => {
    if (mask) { feasible++; return; }
    const row = table.stops[i][0];
    for (const r of row.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
  });
  for (const run of runs) for (const [k, v] of Object.entries(run.dropped)) reasons[k as RejectReason] = (reasons[k as RejectReason] ?? 0) + (v ?? 0);
  const eligible = table.prep.eligible.filter(Boolean).length;
  const factors: LimitingFactor[] = [];
  const moonPct = Math.round(night.moon.illumination * 100);
  const sun = night.sunAltDeg;
  if (sun > -18) factors.push('twilight');
  if (night.moon.up && night.moon.illumination > 0.4 && ((reasons['moon-separation'] ?? 0) + (reasons['moon-glow'] ?? 0)) > 0) factors.push('moon');
  // Most of the sky is always below 30°, so altitude only limits when few objects are left to work with.
  if (feasible < LOW_FEASIBLE && (reasons.altitude ?? 0) > eligible / 2) factors.push('altitude');
  if (feasible >= 3 && !count) factors.push('region');
  if (eligible < 3) factors.push('kb');
  const parts: string[] = [];
  const dusk = sunCrossings(s, -18).dusk, nautical = sunCrossings(s, -12).dusk;
  if (sun > -0.833) {
    parts.push(`It is daytime here (the Sun is ${Math.round(sun)}° up).${dusk && +dusk > s.instantMs ? ` Deep-sky journeys open at ${timeLabel(+dusk, s)}.` : ''}`);
  } else if (sun > -18) {
    const starsAt = nautical && +nautical > s.instantMs ? ` Bright stars work from ${timeLabel(+nautical, s)};` : ' Only bright stars and doubles show well now;';
    parts.push(`The sky is still in twilight.${starsAt} faint nebulae, clusters and galaxies need full darkness${dusk && +dusk > s.instantMs ? ` from ${timeLabel(+dusk, s)}` : ''}.`);
  }
  if (night.moon.up && night.moon.illumination > 0.4) {
    const set = nextMoonEvent(s, -1);
    parts.push(`The Moon is ${moonPct}% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least ${Math.round(moonMinSeparation(night.moon.illumination))}° from it${set ? `; it sets at ${timeLabel(+set, s)}` : ''}.`);
  }
  if (!count && !s.theme && factors.includes('altitude')) parts.push(`Few objects are higher than ${s.minAlt}° right now.`);
  if (s.openDirections && (reasons.direction ?? 0) > 0) parts.push(`Only part of the sky is open from here (${Array.from(s.openDirections).sort().join(', ')}).`);
  if (factors.includes('kb')) parts.push('The knowledge base has too few curated objects for this sky yet.');
  if (!count && s.theme) {
    // A forced theme that cannot run says why first (the generic reasons above may not concern it at all).
    const why = themeDiagnosis(table, runs.flatMap((r) => r.patches), s, night);
    if (why) parts.unshift(why);
  }
  if (!count && !parts.length) parts.push('No compact group of tonight’s objects links into a story at this time. Try another time, a wider region or a lower altitude limit.');
  // Every suggestion tells the same kind of story, or a short list holds one: say so (the KB is thin in this part
  // of the sky tonight; a second contrast tour is never shown to make up the number).
  const themes = new Set(chosen.map((b) => b.journey.templateId));
  if ((chosen.length > 1 || (chosen.length === 1 && s.limit > 1)) && themes.size === 1 && !s.theme) {
    const t = table.prep.templates.find((ct) => themes.has(ct.t.id));
    parts.push(`Only “${t?.t.title ?? chosen[0].journey.templateId}” stories fit this part of the sky right now; other themes may open up later in the night.`);
  }
  if (count && !parts.length) parts.push(night.moon.up ? `Moon ${moonPct}% lit; journeys keep their distance from it.` : 'Dark sky with the Moon down: every kind of journey is available.');
  return { reasonsRejected: reasons, limitingFactors: factors, message: parts.join(' ') };
}

/**
 * Why a forced theme found nothing (P4 evaluation: the empty state used to blame the altitude for a theme that
 * needs a dark sky). Checks, in order: unknown theme, night gates (dark sky, Moon limits), required slots with no
 * object up tonight, required slots that never meet inside one region, and links.
 */
function themeDiagnosis(table: CandidateTable, patches: readonly Patch[], s: EngineSettings, night: NightContext): string | null {
  const { prep } = table;
  const cands = prep.templates.filter((ct) => themeMatches(ct, s.theme));
  if (!cands.length) return `There is no journey theme called “${s.theme}”.`;
  const moon = moonDuring(table.grid, s.length);
  const lines: string[] = [];
  for (const ct of cands) {
    const title = `“${ct.t.title}”`;
    const block = templateNightBlock(ct.t, s.sky, moon);
    if (block === 'dark-sky') { lines.push(`${title} needs a dark sky (darker than ${Math.max(20, ct.t.ingredients.minSkyBrightness ?? 20)} mag/arcsec²); this site is set to ${s.sky.toFixed(1)}.`); continue; }
    if (block === 'moon-bright') { lines.push(`${title} needs a dark, moonless sky: the Moon is ${Math.round(moon * 100)}% lit and up (the limit is ${Math.round((ct.t.ingredients.maxMoonIllumination ?? 0) * 100)}%).`); continue; }
    if (block === 'moon-faint') { lines.push(`${title} is a bright-Moon theme: it runs when the Moon is at least ${Math.round((ct.t.ingredients.minMoonIllumination ?? 0) * 100)}% lit and up.`); continue; }
    if (ct.lens) {
      // A lens theme needs minBeats of its storyline beats, each told by an object that is up tonight.
      const up = ct.lens.beats.filter((_, j) => prep.objects.some((o, i) => table.feasibleMask[i] !== 0 && slotAccepts(ct, j, o, prep.concepts[i])));
      if (up.length < ct.lens.minBeats) {
        const missing = ct.lens.beats.filter((b) => !up.includes(b)).slice(0, 2).map((b) => `“${b.label}”`);
        lines.push(`${title} needs at least ${ct.lens.minBeats} chapters of its story tonight and only ${up.length} can be seen right now${missing.length ? ` (nothing up for ${missing.join(' or ')})` : ''}.`);
        continue;
      }
      const together = patches.some((p) => ct.lens!.beats.filter((_, j) => p.members.some((i) => table.feasibleMask[i] !== 0 && slotAccepts(ct, j, prep.objects[i], prep.concepts[i]))).length >= ct.lens!.minBeats);
      lines.push(together
        ? `${title}: tonight's candidates do not line up into its story in order; a longer or shorter journey, or another time, may work.`
        : `${title}: the stops its story needs are up tonight but too far apart to fit one ${s.radius}° region.`);
      continue;
    }
    const missing = ct.t.slots
      .map((sl, j) => ({ sl, j }))
      .filter(({ sl, j }) => !sl.optional && !prep.objects.some((o, i) => table.feasibleMask[i] !== 0 && slotAccepts(ct, j, o, prep.concepts[i])));
    if (missing.length) {
      const { sl, j } = missing[0];
      const examples = prep.objects.filter((o, i) => prep.eligible[i] && slotAccepts(ct, j, o, prep.concepts[i])).sort((a, b) => b.interest - a.interest).slice(0, 3).map((o) => o.names.display);
      lines.push(`${title} needs a “${sl.label}” stop${examples.length ? ` (such as ${examples.join(', ')})` : ''}, and none is high enough in a dark enough sky right now.`);
      continue;
    }
    const together = patches.some((p) => ct.t.slots.every((sl, j) => sl.optional || p.members.some((i) => table.feasibleMask[i] !== 0 && slotAccepts(ct, j, prep.objects[i], prep.concepts[i]))));
    lines.push(together
      ? `${title}: tonight's candidates do not link into a complete story; a longer or shorter journey, or another time, may work.`
      : `${title}: the stops it needs are up tonight but too far apart to fit one ${s.radius}° region.`);
  }
  return lines.slice(0, 2).join(' ') || null;
}

// ───────────────────────────── conditions strip ─────────────────────────────

/** Night summary shared by every journey of a request (JourneyConditions, minus the per-journey fields). */
function nightConditions(s: EngineSettings, night: NightContext, factors: LimitingFactor[]): JourneyConditions {
  const rise = nextMoonEvent(s, 1), set = nextMoonEvent(s, -1);
  return {
    instant: night.instant,
    darkness: night.darkness,
    sunAltDeg: Math.round(night.sunAltDeg * 10) / 10,
    darkWindow: { start: night.astroDusk, end: night.astroDawn },
    moon: {
      up: night.moon.up,
      illumination: Math.round(night.moon.illumination * 1000) / 1000,
      altDeg: Math.round(night.moon.altDeg * 10) / 10,
      azDeg: Math.round(night.moon.azDeg * 10) / 10,
      minSepDeg: Math.round(moonMinSeparation(night.moon.illumination) * 10) / 10,
      rise: rise ? rise.toISOString() : null,
      set: set ? set.toISOString() : null,
    },
    glowLimits: { ...GLOW_LIMIT },
    sunLimits: { star: SUN_LIMIT_STAR, dso: SUN_LIMIT_DSO },
    minAlt: s.minAlt,
    regionRadius: s.radius,
    skyBrightness: s.sky,
    limitingFactors: factors.slice(),
  };
}

function journeyConditions(shared: JourneyConditions, b: Built): JourneyConditions {
  const seps = b.journey.stops.map((x) => x.moonSepDeg).filter((x): x is number => x !== null);
  return {
    ...shared,
    minAlt: b.s.minAlt,
    regionRadius: b.journey.regionRadius,
    ...(b.relaxed?.length ? { relaxed: b.relaxed.slice() } : {}),
    closestMoonDeg: seps.length ? Math.min(...seps) : null,
  };
}

// ───────────────────────────── public API ─────────────────────────────

export interface PoolResult {
  journeys: Journey[];
  seedKey: string;
  night: NightContext;
  diagnostics: JourneyResult['diagnostics'];
  /** Narration of every pool journey by key (texts are already applied to the journeys). */
  narrations: Record<string, JourneyNarration>;
}

function scoreAll(builts: Built[], kb: KnowledgeBase, req: JourneyRequest, night: NightContext, table: CandidateTable, scorer: JourneyScorer): ScorerModel['type'] {
  let type: ScorerModel['type'] = 'heuristic';
  for (const b of builts) {
    const out = scorer({ journey: b.journey, plan: b.plan, heuristic: b.h, table, kb, night, request: req });
    const seenFrac = table.s.seen.size ? b.ids.filter((id) => table.s.seen.has(id)).length / b.ids.length : 0;
    // The heuristic h already carries "seen" and the Tonight's Best boost per stop (search.addStopTerms); a learned
    // score gets them here, scaled to the journey.
    const boostFrac = table.s.boost?.size ? b.ids.filter((id) => table.s.boost.has(id)).length / b.ids.length : 0;
    b.journey.score = quantize(out.score - (out.scorer === 'heuristic' ? 0 : 0.5 * seenFrac - (boostFrac ? BOOST_SCORE * boostFrac : 0)));
    if (out.features) b.journey.features = out.features;
    type = out.scorer;
  }
  return type;
}

/** Greedy count of mutually distinct journeys (different archetype, fewer than MAX_SHARED_STOPS shared stops). */
function distinctCount(pool: readonly Built[]): number {
  const picked: Built[] = [];
  for (const b of pool) {
    if (picked.every((p) => p.journey.templateId !== b.journey.templateId && sharedStops(b, p) < MAX_SHARED_STOPS)) picked.push(b);
  }
  return picked.length;
}

/** Default scorer (doc 05 §7.5): an explicit scorer wins; else the learned model (validated, heuristic fallback). */
export function scorerFor(opts: Pick<GenerateOptions, 'model' | 'scorer'>): JourneyScorer {
  return opts.scorer ?? (opts.model ? createModelScorer(opts.model) : heuristicScorer);
}

function core(kb: KnowledgeBase, req: JourneyRequest, opts: GenerateOptions) {
  const t0 = opts.clock?.() ?? 0;
  const prep = prepareKb(kb);
  const base = normalizeRequest(req);
  const modelVersion = opts.model?.modelVersion ?? 'heuristic';
  const seedKey = buildSeedKey(req, kb.version, modelVersion);
  const scorer = scorerFor(opts);
  const L = base.length;
  const steps: { label: string | null; s: EngineSettings; range: [number, number] }[] = [{ label: null, s: base, range: [L, L] }];
  if (!opts.explore) {
    let s = base, range: [number, number] = [L, L];
    // A relaxed length stays within 4 stops of the request (an 8-stop request is never answered with 3 stops).
    range = [Math.max(MIN_STOPS, L - 4), Math.min(10, L + 1)];
    steps.push({ label: `length ${range[0]}–${range[1]} stops`, s, range });
    if (s.radius < 40) { s = { ...s, radius: 40, maxHop: Math.min(MAX_HOP_DEG, 0.75 * 40), maxPath: PATH_OVER_RADIUS * 40 }; steps.push({ label: 'wider region (40°)', s, range }); }
    if (s.minAlt > FALLBACK_MIN_ALT) { s = { ...s, minAlt: FALLBACK_MIN_ALT }; steps.push({ label: `altitude floor ${FALLBACK_MIN_ALT}°`, s, range }); }
    if (!s.includeChallenge) { s = { ...s, includeChallenge: true }; steps.push({ label: 'one challenge stop allowed', s, range }); }
  }
  const runs: RunResult[] = [];
  const pool: Built[] = [];
  const idents = new Set<string>();
  const relaxed: string[] = [];
  let scorerType: ScorerModel['type'] = 'heuristic';
  const lap = stageTimer(opts);
  const night = buildNightContext(base, tableFor(prep, base, Math.min(10, L + 1)).grid, seedKey);
  lap('night');
  const add = (built: Built[], n: number, table: CandidateTable) => {
    const fresh = built.filter((b) => !idents.has(b.ident!));
    if (!fresh.length) return;
    scorerType = scoreAll(fresh, kb, req, night, table, scorer);
    // Relaxations are cumulative: a journey from step n relies on every relaxation up to n.
    const mine = steps.slice(1, n + 1).map((st) => st.label).filter((x): x is string => !!x);
    for (const l of mine) if (!relaxed.includes(l)) relaxed.push(l);
    for (const b of fresh) {
      b.tier = n; b.relaxed = mine; idents.add(b.ident!);
      // A relaxed length still aims at the requested one (ranking only; the score stays the scorer's).
      b.lengthMiss = Math.abs(b.ids.length - L);
    }
    pool.push(...fresh);
  };
  // Relax while there are fewer than `limit` DISTINCT journeys (different archetype, < MAX_SHARED_STOPS shared
  // stops): three near-copies of one contrast tour are not three suggestions (P4 evaluation, sparse skies).
  const enough = () => distinctCount(pool) >= base.limit;
  let first = 0;
  if (steps.length > 1) {
    // The strict length and the length relaxation share one search: the beam is the same up to depth L and the
    // search keeps its best candidates per stop count, so journeys of exactly L stops are the strict tier and the
    // others the length-relaxed tier (used only when the strict tier lacks variety). Half the work for a request
    // that needs the relaxation, the same result.
    const run = runOnce(prep, steps[1].s, steps[1].range, false, opts, (stops) => stops === L);
    runs.push(run);
    add(run.built, 0, run.table);
    if (!enough() && run.more) add(run.more(), 1, run.table);
    first = 2;
  }
  steps.forEach((step, n) => {
    if (n < first || (n > 0 && enough())) return;
    const run = runOnce(prep, step.s, step.range, !!opts.explore, opts);
    runs.push(run);
    add(run.built, n, run.table);
  });
  pool.sort((a, b) => a.tier - b.tier || b.journey.score - a.journey.score || a.journey.key.localeCompare(b.journey.key));
  return { prep, base, seedKey, night, runs, pool, relaxed, scorerType, t0, modelVersion };
}

/** Night-level seed for the canonical rotation: night date, site (0.1°), optics, sky, theme and length; no slot. */
function rotationSeedOf(req: JourneyRequest, kbVersion: string): string {
  const ms = Date.parse(req.instant);
  const i = req.instrument;
  return ['rotate-1', kbVersion, localNightDate(ms, req.lon), req.lat.toFixed(1), req.lon.toFixed(1), i.fovDeg.toFixed(1), Math.round(i.magnification),
    req.skyBrightness.toFixed(1), req.theme ?? '*', req.length ?? '-', req.seed ?? ''].join('|');
}

/** Public engine entry: the observer's best `limit` journeys (or the `shuffle`-th alternative set). */
export function generate(kb: KnowledgeBase, req: JourneyRequest, opts: GenerateOptions = {}): JourneyResult {
  const c = core(kb, req, opts);
  const lap = stageTimer(opts);
  // On a bright-Moon night one suggestion should be an archetype built for moonlight (doc 04 §3.2 bright-ok).
  const moonIll = c.night.moon.up ? c.night.moon.illumination : 0;
  const prefer = moonIll >= MOONLIT_PREFER ? (b: Built) => moonlitFit(b.plan.template, 1) > 0 : undefined;
  // Theme balance: at most one A6 tour, in a slot only by A6_MARGIN, unless the request forces an A6 theme.
  const capA6 = !c.prep.templates.some((ct) => ct.t.archetype === CAPPED_ARCHETYPE && c.base.theme !== null && themeMatches(ct, c.base.theme));
  // Titles are narrated (narrate.ts) after selection; two suggestions must never share one (owner feedback round 1).
  // Same archetype + same region is already excluded (nearIdentical), so a clash needs a fallback title: the
  // clashing journey is set aside and the selection rerun without it.
  const narrated = new Set<Built>();
  const narrate = (b: Built) => { if (!narrated.has(b)) { narrateBuilt(b, kb, c.night); narrated.add(b); } };
  let chosen: Built[] = c.pool;
  opts.inspectPool?.(c.pool.map((b) => b.journey), c.pool.map((b) => ({ tier: b.tier, relaxed: b.relaxed ?? [] })));
  if (!opts.explore) {
    const setAside = new Set<Built>();
    for (let guard = 0; guard <= c.base.limit; guard++) {
      const pool = setAside.size ? c.pool.filter((b) => !setAside.has(b)) : c.pool;
      chosen = selectWithShuffle(pool, c.base.limit, c.base.shuffle, c.seedKey, rotationSeedOf(req, kb.version), prefer, capA6);
      chosen.forEach(narrate);
      const titles = new Set<string>();
      const clash = chosen.find((b) => { const t = b.journey.title.trim().toLowerCase(); if (titles.has(t)) return true; titles.add(t); return false; });
      if (!clash) break;
      setAside.add(clash);
      if (guard === c.base.limit) chosen = chosen.filter((b) => b !== clash);
    }
  }
  if (!opts.explore) {
    for (const b of chosen) {
      const w = bestWindow(c.runs[0].table, b.plan.stops.map((x) => x.obj), b.s);
      if (w) b.journey.bestWindow = w;
    }
  }
  lap('select+window');
  const diag = diagnose(c.runs, c.base, c.night, chosen.length, chosen);
  const conditions = nightConditions(c.base, c.night, diag.limitingFactors);
  lap('diagnose');
  for (const b of chosen) {
    narrate(b);
    b.journey.conditions = journeyConditions(conditions, b);
  }
  lap('narrate');
  const journeys = chosen.map((b) => b.journey);
  return {
    journeys,
    seedKey: c.seedKey,
    kbVersion: kb.version,
    modelVersion: c.modelVersion,
    diagnostics: {
      ...diag,
      ...(c.relaxed.length ? { relaxed: c.relaxed } : {}),
      candidates: c.runs.reduce((a, r) => a + r.searched, 0),
      validated: c.pool.length,
      scorer: c.scorerType,
      ...(opts.clock ? { ms: Math.round((opts.clock() - c.t0) * 10) / 10 } : {}),
    },
    conditions,
  };
}

/** Training-slate helper: the whole valid pool (no relaxation, no MMR), narrated, with features when the scorer gives them. */
export function generatePool(kb: KnowledgeBase, req: JourneyRequest, opts: GenerateOptions = {}): PoolResult {
  const c = core(kb, req, { ...opts, explore: true });
  const diag = diagnose(c.runs, c.base, c.night, c.pool.length);
  const conditions = nightConditions(c.base, c.night, diag.limitingFactors);
  const narrations: Record<string, JourneyNarration> = {};
  for (const b of c.pool) {
    narrations[b.journey.key] = narrateBuilt(b, kb, c.night);
    b.journey.conditions = journeyConditions(conditions, b);
  }
  return {
    journeys: c.pool.map((b) => b.journey),
    seedKey: c.seedKey,
    night: c.night,
    diagnostics: {
      ...diag,
      candidates: c.runs.reduce((a, r) => a + r.searched, 0),
      validated: c.pool.length,
      scorer: c.scorerType,
    },
    narrations,
  };
}

// ───────────────────────────── #/journeys/:key ─────────────────────────────

export interface RebuildOptions extends Pick<GenerateOptions, 'model' | 'scorer'> {
  /**
   * When to re-validate the journey. Default: the request instant if it falls in the key's 15-minute slot,
   * else the start of that slot (the journey exactly as it was planned).
   */
  instant?: string;
  /** Whose site to use: the key's (default, the journey as shared) or the request's (re-check from here). */
  site?: 'key' | 'request';
}

export interface RebuildResult {
  /** The rebuilt, narrated journey (also when it no longer passes; check `valid`). Null when it cannot be rebuilt. */
  journey: Journey | null;
  /** Every hard constraint holds at the rebuild instant. */
  valid: boolean;
  /** Plain-language reasons the journey no longer works (empty when valid). */
  problems: string[];
  /** Validator codes behind `problems`. */
  codes: RejectReason[];
  decoded: JourneyKeyData | null;
}

const PROBLEM_TEXT: Partial<Record<RejectReason, (name: string, s: EngineSettings) => string>> = {
  altitude: (n, s) => `${n} is lower than ${s.minAlt}° during its stop.`,
  twilight: (n) => `The sky is not dark enough for ${n} at its stop time.`,
  'moon-separation': (n) => `${n} is too close to the Moon.`,
  'moon-glow': (n) => `Moonlight washes out ${n}.`,
  'binocular-rating': (n) => `${n} is too faint to see in these conditions.`,
  extent: (n) => `${n} is too large for this binocular field.`,
  direction: (n) => `${n} is in a part of the sky that is blocked from here.`,
  'not-eligible': (n) => `${n} is no longer part of the journey knowledge base.`,
};

function problemText(v: Violation, plan: Plan, prep: PreparedKb, s: EngineSettings): string {
  const name = v.stop !== undefined && plan.stops[v.stop] ? prep.objects[plan.stops[v.stop].obj].names.display : null;
  const f = PROBLEM_TEXT[v.code];
  if (name && f) return f(name, s);
  if (v.code === 'region' || v.code === 'geometry') return `The route no longer fits the region rules (${v.detail}).`;
  return `The story no longer holds together (${v.detail}).`;
}

const FACTOR_OF: Partial<Record<RejectReason, LimitingFactor>> = {
  altitude: 'altitude', twilight: 'twilight', 'moon-separation': 'moon', 'moon-glow': 'moon',
  region: 'region', geometry: 'region', 'not-eligible': 'kb', story: 'kb',
};

/**
 * Rebuild the journey a key names (#/journeys/:key) and re-validate it with the single validator. Deterministic:
 * the same key and KB give the same journey and texts. Settings not carried by the key (time zone, open
 * directions, seen objects, level) come from `req`.
 */
export function rebuildJourney(kb: KnowledgeBase, key: string, req: JourneyRequest, opts: RebuildOptions = {}): RebuildResult {
  const d = decodeJourneyKey(key);
  const fail = (problem: string): RebuildResult => ({ journey: null, valid: false, problems: [problem], codes: [], decoded: d });
  if (!d) return fail('This journey link is not valid.');
  const prep = prepareKb(kb);
  const missing = d.stopIds.filter((id) => !prep.index.has(id));
  if (missing.length) return fail(`This journey uses objects that are no longer in the knowledge base (${missing.join(', ')}).`);
  const ct = prep.templates.find((x) => x.t.id === d.templateId);
  if (!ct) return fail(`The journey theme ${d.templateId} is no longer available.`);
  const target = d.switch ? prep.templates.find((x) => x.t.id === d.switch!.toTemplateId) : undefined;
  if (d.switch && !target) return fail(`The journey theme ${d.switch.toTemplateId} is no longer available.`);
  const sw = d.switch && target ? compileSwitch(ct, target, d.switch.at) : null;
  if (d.switch && !sw) return fail(`${d.templateId} may no longer switch to ${d.switch.toTemplateId}.`);

  const slotStart = d.slotMinute * 60_000;
  const reqMs = Date.parse(req.instant);
  const instant = opts.instant ?? (Number.isFinite(reqMs) && slotStartMs(reqMs) === slotStart ? req.instant : new Date(slotStart).toISOString());
  const site = opts.site === 'request' ? { lat: req.lat, lon: req.lon } : { lat: d.lat, lon: d.lon };
  const r: JourneyRequest = {
    ...req, ...site, instant,
    instrument: { fovDeg: d.fovDeg, aperture: d.aperture, magnification: d.magnification, stabilized: d.stabilized },
    skyBrightness: d.skyBrightness, minAlt: d.minAlt, regionRadius: d.regionRadius, minutesPerStop: d.minutesPerStop,
    includeChallenge: d.includeChallenge, length: d.stopIds.length, shuffle: 0,
  };
  const s = normalizeRequest(r);
  const n = d.stopIds.length;
  const table = tableFor(prep, s, Math.min(10, Math.max(n, 3)));
  const plan: Plan = {
    template: ct,
    center: { ra: d.centerRa, dec: d.centerDec },
    radius: s.radius,
    stops: d.stopIds.map((id, i) => ({ obj: prep.index.get(id)!, slot: d.slots[i] })),
    ...(sw ? { switch: sw } : {}),
  };
  // Slot indices must name real slots before anything indexes them.
  const badSlot = plan.stops.findIndex((x, i) => !stopTemplate(plan, i).t.slots[x.slot]);
  if (badSlot >= 0 || n > 10) return fail('This journey link does not match the current story templates.');
  const violations = journeyViolations(table, plan);
  const h = planHeuristic(table, plan);
  const pseudoPatch = { id: 'rebuild', ra: plan.center.ra, dec: plan.center.dec, radius: plan.radius, altDeg: 0, azDeg: 0, shortLabel: '', label: '', members: [], score: 0 } as Patch;
  const b = buildJourney(table, plan, pseudoPatch, h);
  const modelVersion = opts.model?.modelVersion ?? 'heuristic';
  const night = buildNightContext(s, table.grid, buildSeedKey(r, kb.version, modelVersion));
  const out = scorerFor(opts)({ journey: b.journey, plan, heuristic: h, table, kb, night, request: r });
  b.journey.score = quantize(out.score);
  if (out.features) b.journey.features = out.features;
  const w = bestWindow(table, plan.stops.map((x) => x.obj), s);
  if (w) b.journey.bestWindow = w;
  narrateBuilt(b, kb, night);
  const codes = Array.from(new Set(violations.map((v) => v.code)));
  const factors = Array.from(new Set(codes.map((c) => FACTOR_OF[c]).filter((x): x is LimitingFactor => !!x)));
  b.journey.conditions = journeyConditions(nightConditions(s, night, factors), b);
  const problems = Array.from(new Set(violations.map((v) => problemText(v, plan, prep, s))));
  return { journey: b.journey, valid: violations.length === 0, problems, codes, decoded: d };
}
