/**
 * Sky Journeys S1 + story layer: what can be used tonight, and how objects link.
 *
 * - KB preparation (memoised per KnowledgeBase object): objects sorted by id, journey eligibility (doc 05 §4 gate,
 *   script/journeys/README.md), derived life stage (spec decision 2), concept sets, compiled templates.
 * - Story graph: curated edges plus edges derived from facts (doc 05 §4), computed lazily per pair and memoised.
 *   NEIGHBOR alone never justifies a step (spec decision 3).
 * - Slot grammars (spec decision 6): slot matching and order rules shared by search, re-ordering and validation.
 * - Candidate table: per object × stop index feasibility, evaluated by validate.ts (the single validator).
 */
import {
  BACKTRACK_MIN_STRENGTH, MAX_STOPS, MIN_EDGE_STRENGTH, fadingFloor, SAME_POINT_DEG, SAME_VIEW_DEG, STAR_COLOR_MAG, buildNightGrid, makeRater, minutesAboveAlt, hourAngle,
  majorArcmin, ofDateConverter, trackObject, type EngineSettings, type NightGrid, type ObjectTrack,
} from './conditions';
import { evaluateStop, type StopEval } from './validate';
import {
  FACT_KEYS, type ArcRole, type Candidate, type Concept, type Edge, type EdgeType, type EvolutionaryStage, type FactKey, type KbObject,
  type KnowledgeBase, type LifeStage, type RejectReason, type SlotMatch, type StorylineBeat, type Template, type TemplateIngredients,
  type TemplateSlot, type ThemeLens, type ThemeLensSet,
} from './types';

// ───────────────────────────── eligibility & life stage ─────────────────────────────

/** Journey-eligibility gate: curated/reviewed, ≥1 teaches, ≥1 sourced numeric fact, complete card (wonder/connect may be empty), DSO view not derived. */
export function isJourneyEligible(o: KbObject): boolean {
  const status = o.provenance?.status;
  if (status !== 'curated' && status !== 'reviewed') return false;
  if (!o.teaches.length) return false;
  if (!Object.values(o.facts).some((f) => f && Number.isFinite(f.value) && !!f.sourceId)) return false;
  const c = o.card;
  // wonder and connect are optional (owner brief r2: one sentence, or empty when it would only repeat the card).
  if (![c.glance, c.whyHere, c.see, c.understand].every((x) => typeof x === 'string' && x.trim().length > 0)) return false;
  if (o.kind === 'dso' && o.view.basis === 'derived') return false;
  return Number.isFinite(o.ra) && Number.isFinite(o.dec);
}

const LATE_STAR_STAGES: ReadonlySet<EvolutionaryStage> = new Set<EvolutionaryStage>([
  'blue-supergiant', 'yellow-supergiant', 'yellow-hypergiant', 'red-supergiant', 'lbv', 'wolf-rayet', 'early-agb', 'tp-agb', 'post-agb',
]);
const GIANT_STAGES: ReadonlySet<EvolutionaryStage> = new Set<EvolutionaryStage>([
  'subgiant', 'red-giant-branch', 'red-clump', 'horizontal-branch',
]);

/**
 * Doc 05's 0..6 LifeStage derived from the authored evoStage (spec decision 2):
 * 0 nursery · 1 pre-MS / very young cluster · 2 main sequence · 3 subgiant/giant · 4 supergiant/AGB ·
 * 5 PN / white dwarf · 6 SNR / neutron star. Galaxies and asterisms → null.
 */
export function lifeStageOf(o: KbObject): LifeStage | null {
  const e = o.evoStage;
  if (e === null || e === 8) return null;
  if (o.kind === 'star') {
    const st = o.evolutionaryStage;
    if (st === 'white-dwarf') return 5;
    if (st === 'pre-main-sequence') return 1;
    if ((st && LATE_STAR_STAGES.has(st)) || o.roles.includes('supergiant')) return 4;
    if ((st && GIANT_STAGES.has(st)) || o.roles.includes('giant') || e === 5 || e === 6) return 3;
    if (e === 7) return 5;
    return 2;
  }
  switch (e) {
    case 0: return 0;
    case 1: return 1;
    case 2: case 3: return 2;
    case 4: case 5: return 3;
    case 6: return o.dsoClass === 'planetary-nebula' ? 5 : 4;
    case 7: return o.dsoClass === 'planetary-nebula' ? 5 : 6;
    default: return null;
  }
}

/** "Same kind" key for SAME_FAMILY edges and the variety heuristic. */
export function kindKey(o: KbObject): string {
  return o.kind === 'star' ? `star:${lifeStageOf(o) ?? '-'}` : o.dsoClass;
}

// ───────────────────────────── templates & slot grammar ─────────────────────────────

export interface CompiledTemplate {
  t: Template;
  /**
   * Order rank per slot: strict = index, partial = smallest index of its swap group, free = by arc (hook first,
   * then build/twist in any order, then payoff, then coda: a free order may shuffle the middle, never the arc).
   */
  ranks: number[];
  /** Link types allowed anywhere in the template (NEIGHBOR excluded). */
  allowed: ReadonlySet<EdgeType>;
  /** Link types allowed to ARRIVE at each slot: TemplateSlot.inEdges ∩ allowed (allowed when absent). */
  slotAllowed: ReadonlySet<EdgeType>[];
  repeatMin: number[];
  repeatMax: number[];
  optional: boolean[];
  /**
   * Every slot asks for a star (kinds ['star'], star roles or a variability class): doubles, variables, star
   * colours. Three stars in a row is the theme there, not a lack of variety (search.ts kind-run term).
   */
  oneKindTheme: boolean;
  /** A distance ladder (progression distanceLy up): every step obeys ladderStepOk (owner feedback round 1). */
  ladder: boolean;
  /**
   * Theme lens (owner feedback round 2), when the archetype has one: `t.slots` are then the storyline beats (one
   * optional slot per beat, strict order, repeat up to the beat's maxStops) and only objects with a lens fill them.
   */
  lens?: CompiledLens;
}

/** A theme's lens set compiled for the engine (CompiledTemplate.lens). */
export interface CompiledLens {
  set: ThemeLensSet;
  /** Beats in step order; slot j of the compiled template is beats[j]. */
  beats: StorylineBeat[];
  /** objectId → lens. */
  byObject: ReadonlyMap<string, ThemeLens>;
  /** Beat step → slot index. */
  slotOfStep: ReadonlyMap<number, number>;
  /** Fewest distinct beats a journey covers. */
  minBeats: number;
  /** Slots (beats) the journey may end on (ThemeStoryline.endSteps); undefined = any. */
  endSlots?: ReadonlySet<number>;
  /** Slots (beats) a journey may open on (ThemeStoryline.firstSteps); undefined = the lowest beat in reach (search.ts). */
  firstSlots?: ReadonlySet<number>;
  /** Slots (beats) whose omission costs KEY_BEAT_FACTOR × more (ThemeStoryline.keySteps, search.ts); undefined = none. */
  keySlots?: ReadonlySet<number>;
}
/**
 * Strength of the lens thread link: the step between two stops of a lens theme is justified by the storyline itself
 * (the beats, written for this theme), so it needs no typed story edge and counts like a good curated link. A real
 * edge at least this strong is used instead (any type but NEIGHBOR); a curated edge already from
 * LENS_CURATED_MIN_STRENGTH, because its authored pair line may add to the lens transition (narrate.ts).
 */
export const LENS_LINK_STRENGTH = 0.7;
export const LENS_CURATED_MIN_STRENGTH = 0.5;
/** Edge subtype (and reasonKey) of the lens thread link. */
export const LENS_LINK_SUBTYPE = 'lens-thread';
export const isLensLink = (e: Pick<Edge, 'subtype'> | null | undefined): boolean => !!e && e.subtype === LENS_LINK_SUBTYPE;
/**
 * In a lens distance ladder (A3) each rung lies at least this many times farther than the one before: the beats
 * set the method (parallax, cluster fitting, standard candles), the distances must still climb (owner feedback
 * round 1: "it should have been of increasing distances").
 */
export const LENS_LADDER_MIN_RATIO = 1.25;

const FREE_ARC_RANK: Record<ArcRole, number> = { hook: 0, build: 1, twist: 1, payoff: 2, coda: 3 };
const STAR_ROLES: ReadonlySet<string> = new Set(['double', 'variable', 'giant', 'supergiant', 'main-sequence', 'wd']);
const starOnlySlot = (m: SlotMatch) =>
  (!!m.kinds && m.kinds.length > 0 && m.kinds.every((k) => k === 'star'))
  || (!!m.roles && m.roles.length > 0 && m.roles.every((r) => STAR_ROLES.has(r)))
  || (!!m.variabilityClasses && m.variabilityClasses.length > 0);

// ───────────────────────────── distance ladders (owner feedback round 1) ─────────────────────────────

/**
 * Distance ladders (A3 How Far, A4 Time Machine, A11 Inside Our Galaxy) climb: every rung is at least
 * LADDER_MIN_RATIO times farther than the one before (A3's hook line promises "at least twice as far"), and at
 * most LADDER_MAX_RATIO times, so a run of near-equal distances never ends in one giant leap (owner, cal-03:
 * "four of them are within the same range, and then you put that cluster that is thousands of light-years away").
 * Together the two bounds keep the in-galaxy steps even in log distance: the largest step is at most
 * log(15)/log(2) ≈ 3.9 times the smallest.
 */
export const LADDER_MIN_RATIO = 2;
export const LADDER_MAX_RATIO = 15;
/** Beyond this distance (light-years) a rung is outside the Milky Way: another galaxy. */
export const EXTRAGALACTIC_LY = 100_000;
/**
 * The one step that may exceed LADDER_MAX_RATIO is the leap out of our galaxy (nothing visible lies between
 * ~30,000 and 160,000 light-years), and only from a rung at least this far: the ladder first climbs through the
 * Milky Way (cal-01's liked ladder reached 9,170 light-years before Andromeda).
 */
export const LADDER_LEAP_FROM_LY = 2_000;

/** May a distance ladder step from `from` to `to`? Both need a distance; see LADDER_MIN_RATIO. */
export function ladderStepOk(from: KbObject, to: KbObject): boolean {
  const a = from.facts.distanceLy?.value, b = to.facts.distanceLy?.value;
  if (!(a !== undefined && b !== undefined && a > 0 && b > 0)) return false;
  const r = b / a;
  if (r < LADDER_MIN_RATIO) return false;
  if (r <= LADDER_MAX_RATIO) return true;
  return b >= EXTRAGALACTIC_LY && a < EXTRAGALACTIC_LY && a >= LADDER_LEAP_FROM_LY;
}

/** Is `o` a Milky Way scene (star cloud, Milky Way field) rather than an object at one distance? */
export const isSceneObject = (o: KbObject) => o.kind === 'dso' && SCENE_CLASSES.has(o.dsoClass);

export function compileTemplate(t: Template, lensSet?: ThemeLensSet | null): CompiledTemplate {
  if (lensSet) return compileLensTemplate(t, lensSet);
  const ranks = t.slots.map((sl, j) => {
    if (t.order === 'free') return FREE_ARC_RANK[sl.arc];
    if (t.order === 'strict') return j;
    const g = (t.swapGroups ?? []).find((grp) => grp.includes(j));
    return g ? Math.min(...g) : j;
  });
  const allowed: ReadonlySet<EdgeType> = new Set(t.edges.filter((e) => e !== 'NEIGHBOR'));
  return {
    t,
    ranks,
    allowed,
    slotAllowed: t.slots.map((sl) => (sl.inEdges ? new Set(sl.inEdges.filter((e) => allowed.has(e))) : allowed)),
    repeatMin: t.slots.map((s) => Math.max(1, s.repeat?.[0] ?? 1)),
    repeatMax: t.slots.map((s) => Math.max(1, s.repeat?.[1] ?? 1)),
    optional: t.slots.map((s) => !!s.optional),
    oneKindTheme: t.slots.length > 0 && t.slots.every((s) => starOnlySlot(s.match)),
    ladder: t.progression?.property === 'distanceLy' && t.progression.direction === 'up',
  };
}

/**
 * A lens archetype (owner feedback round 2): the storyline beats ARE the arc. One optional slot per beat in step
 * order (strict), each repeatable up to the beat's maxStops; a journey covers at least minBeats distinct beats
 * (grammarComplete). The stop's arc is positional: the first stop is the hook, the last the payoff (lensArcAt).
 * The length range follows from the beats: minBeats (at least 3) to the sum of maxStops (at most 10). The
 * template's own slot clauses, ingredients and numeric progression no longer apply (the lens decides which object
 * tells which beat); the template-level stop rules (colors bright enough to see) and a distance ladder's climb
 * still do.
 */
function compileLensTemplate(t: Template, set: ThemeLensSet): CompiledTemplate {
  const beats = set.beats.slice().sort((a, b) => a.step - b.step);
  const slots: TemplateSlot[] = beats.map((b) => ({
    arc: 'build', label: b.label, match: {}, optional: true, repeat: [1, Math.max(1, b.maxStops ?? 1)],
  }));
  const maxLen = Math.min(MAX_STOPS, slots.reduce((a, s) => a + s.repeat![1], 0));
  const minBeats = Math.max(1, Math.min(set.minBeats, beats.length));
  const lo = Math.min(maxLen, Math.max(3, minBeats));
  const lensT: Template = { ...t, slots, order: 'strict', swapGroups: undefined, length: [lo, Math.max(lo, maxLen)] };
  const base = compileTemplate(lensT);
  const original = t.slots.length > 0 && t.slots.every((s) => starOnlySlot(s.match));
  return {
    ...base,
    oneKindTheme: original,
    ladder: t.progression?.property === 'distanceLy' && t.progression.direction === 'up',
    lens: {
      set,
      beats,
      byObject: new Map(Object.entries(set.objects)),
      slotOfStep: new Map(beats.map((b, j) => [b.step, j] as const)),
      minBeats,
      ...(set.endSteps?.length ? { endSlots: new Set(beats.flatMap((b, j) => (set.endSteps!.includes(b.step) ? [j] : []))) } : {}),
      ...(set.firstSteps?.length ? { firstSlots: new Set(beats.flatMap((b, j) => (set.firstSteps!.includes(b.step) ? [j] : []))) } : {}),
      ...(set.keySteps?.length ? { keySlots: new Set(beats.flatMap((b, j) => (set.keySteps!.includes(b.step) ? [j] : []))) } : {}),
    },
  };
}

/**
 * Positional arc of stop `i` in a lens theme whose part of the journey runs over stops `from`..`to` (inclusive):
 * the first is the hook (unless the part opens after a switch, where the switch stop was the hook), the last the
 * payoff, the others build.
 */
export function lensArcAt(i: number, from: number, to: number, opensJourney = true): ArcRole {
  if (i === to) return 'payoff';
  if (i === from && opensJourney) return 'hook';
  return 'build';
}

/**
 * Is slot j the climax of lens theme `ct`: its final beat, or one of its endSteps? Only there may a challenge stop
 * close the journey (round 3: A8's violent ending at the Veil or the Crab, A1's remnant).
 */
export function lensFinaleSlot(ct: CompiledTemplate, j: number): boolean {
  const lens = ct.lens;
  return !!lens && (j === lens.beats.length - 1 || !!lens.endSlots?.has(j));
}

/**
 * Does lens theme `ct` accept object `o` in slot `j` as its last stop (the payoff)? A star must be bright enough to
 * be a climax. A challenge stop (rating 2) closes the journey only on the theme's final beat or an end beat
 * (lensFinaleSlot), and only when its rating says it is visible tonight with these binoculars in this sky
 * (validate.ts evaluateStop: rating 3 never passes, rating 2 only from stop 3 on and when challenges are allowed):
 * a variable that may have faded below reach (conditions.fadingFloor) is rated a challenge for that reason alone, so
 * it never closes a journey.
 */
export function lensPayoffOk(ct: CompiledTemplate, j: number, o: KbObject, rating: number, night?: { aperture: number; glowMag: number }): boolean {
  if (rating === 2 && (!lensFinaleSlot(ct, j) || fadingFloor(o) === 2)) return false;
  // Round 4 (owner simulator, visibility honesty): a challenge never closes the story with small binoculars (the
  // curated grades are for 50 mm; 40 Eridani B was the payoff on 7×35 nights while its own card says 7×35s lose it)
  // or in moonlight (the Dumbbell's shape as the payoff under a 95% Moon). The night then ends on the beat before.
  if (rating === 2 && night && (night.aperture < CHALLENGE_PAYOFF_MIN_APERTURE || night.glowMag >= CHALLENGE_PAYOFF_MAX_GLOW)) return false;
  return o.kind !== 'star' || (o.mag !== null && o.mag <= PAYOFF_STAR_MAG);
}

/**
 * The hop onto a lens theme's final beat may run FINALE_HOP_STRETCH × the night's hop limit (round 4, owner
 * simulator: the southern planetary nebulae sat just past 20° from the Carina and Vela brinks, so southern A1/A8
 * nights never reached a remnant). Such a hop starts from a naked-eye anchor anyway (getthere.ts naked-eye mode).
 */
export const FINALE_HOP_STRETCH = 1.25;
export function hopLimitInto(ct: CompiledTemplate, j: number, maxHop: number): number {
  return ct.lens && j === ct.lens.beats.length - 1 ? maxHop * FINALE_HOP_STRETCH : maxHop;
}

/** Smallest aperture (mm) at which a challenge stop may close a journey (the curated grades are 50 mm grades). */
export const CHALLENGE_PAYOFF_MIN_APERTURE = 45;
/** Moonlight (sky brightening at the stop, mag) above which a challenge stop may not close a journey. */
export const CHALLENGE_PAYOFF_MAX_GLOW = 0.3;

/**
 * Same-beat order (round 3 contract, ThemeLens.rank): when two consecutive stops share a beat and both lenses carry
 * a rank, the lower rank comes first (A5 by age, A3 by distance). Without ranks any order passes.
 */
export function lensRankOk(ct: CompiledTemplate, aId: string, bId: string): boolean {
  const a = ct.lens?.byObject.get(aId), b = ct.lens?.byObject.get(bId);
  if (!a || !b || a.step !== b.step || a.rank === undefined || b.rank === undefined) return true;
  return a.rank <= b.rank;
}

/**
 * A back-track (a turn sharper than SHARP_TURN_DEG; at most one per journey) must ride a strong link
 * (BACKTRACK_MIN_STRENGTH). In a lens theme the storyline itself is that reason when the step moves on to a later
 * beat: Albireo sits 10° off Lyra with no doubles beyond it in reach, so a doubles journey that visits it must come
 * back (owner simulator: Albireo and δ Boötis were never picked in A9 because the lens thread link, 0.7, was too
 * weak to turn back on).
 */
export function backtrackLinkOk(ct: CompiledTemplate, e: Edge, fromSlot: number, toSlot: number): boolean {
  return e.strength >= BACKTRACK_MIN_STRENGTH || (!!ct.lens && toSlot > fromSlot);
}

/**
 * The link a lens theme uses from a to b: the best real edge (any type but NEIGHBOR; curated from
 * LENS_CURATED_MIN_STRENGTH, derived from LENS_LINK_STRENGTH; a derived SAME_PHYSICS link must share a core concept)
 * else the lens thread link. In a distance ladder the distances must climb by LENS_LADDER_MIN_RATIO (a Milky Way
 * scene is not a rung); otherwise there is no link.
 */
const lensLinkMemo = new WeakMap<CompiledLens, Map<number, Edge | null>>();
export function lensLink(prep: PreparedKb, ct: CompiledTemplate, a: number, b: number): Edge | null {
  const lens = ct.lens!;
  let memo = lensLinkMemo.get(lens);
  if (!memo) { memo = new Map(); lensLinkMemo.set(lens, memo); }
  const key = a * prep.objects.length + b;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const A = prep.objects[a], B = prep.objects[b];
  let out: Edge | null = null;
  if (lensStepOk(ct, A, B)) {
    for (const e of prep.graph.ranked(a, b)) {
      if (e.type === 'NEIGHBOR' || e.strength < (e.curated ? LENS_CURATED_MIN_STRENGTH : LENS_LINK_STRENGTH)) continue;
      if (e.type === 'SAME_PHYSICS' && !e.curated && ct.t.coreConcepts.length
        && !ct.t.coreConcepts.some((c) => prep.concepts[a].has(c) && prep.concepts[b].has(c))) continue;
      out = e;
      break;
    }
    out ??= { from: A.id, to: B.id, type: 'SAME_PHYSICS', subtype: LENS_LINK_SUBTYPE, strength: LENS_LINK_STRENGTH, reasonKey: LENS_LINK_SUBTYPE, curated: false, directed: true };
  }
  memo.set(key, out);
  return out;
}

/** Order rule between two consecutive stops of a lens theme beyond the beats: a distance ladder climbs. */
export function lensStepOk(ct: CompiledTemplate, A: KbObject, B: KbObject): boolean {
  if (!ct.ladder || isSceneObject(A)) return true;
  const a = A.facts.distanceLy?.value, b = B.facts.distanceLy?.value;
  return a !== undefined && b !== undefined && a > 0 && b >= a * LENS_LADDER_MIN_RATIO;
}

// ───────────────────────────── what the binoculars can really show (owner feedback r2) ─────────────────────────────

/**
 * A binocular splits a pair whose separation is at least SPLIT_ARCSEC_X_MAG / magnification arcseconds (about 30″ at
 * 10×, 43″ at 7×), with a companion no fainter than SPLIT_MAX_COMPANION_MAG; a companion more than
 * SPLIT_HARD_DELTA_MAG fainter than its primary needs twice that separation (the glare hides it).
 */
export const SPLIT_ARCSEC_X_MAG = 300;
export const SPLIT_MAX_COMPANION_MAG = 9.5;
export const SPLIT_HARD_DELTA_MAG = 3;

/** Does the star show as two (or more) points at this magnification (its widest qualifying pair)? */
export function splitsAt(o: KbObject, magnification: number): boolean {
  if (o.kind !== 'star' || !o.multiplicity) return false;
  const limit = SPLIT_ARCSEC_X_MAG / Math.max(1, magnification);
  return o.multiplicity.pairs.some((p) => p.magSecondary <= SPLIT_MAX_COMPANION_MAG
    && p.sepArcsec >= (Math.abs(p.magSecondary - p.magPrimary) > SPLIT_HARD_DELTA_MAG ? 2 * limit : limit));
}

/**
 * Does a lens line promise that the observer will split the star ("binoculars split it into two")? A sentence that
 * mentions splitting and does not deny it (not, never, cannot, too close, needs a telescope).
 */
export function claimsSplit(text: string | undefined): boolean {
  if (!text) return false;
  return text.split(/(?<=[.!?;])\s+/).some((x) => /\bsplit/i.test(x)
    && !/\b(not|never|cannot|unsplittable)\b|n['’]t\b|\btoo (close|tight)\b|\btelescope|\bno binoculars?\b/i.test(x));
}

/**
 * The lens's "what to look at" must be true for the selected binoculars (owner feedback r2: doubles only if the
 * pair actually splits): a star whose lens look promises a split is a stop only when this magnification splits it,
 * and a lens with a minMagnification is a stop only at that magnification or more.
 */
export function lensVisibleOk(ct: CompiledTemplate, o: KbObject, magnification: number): boolean {
  const lens = ct.lens?.byObject.get(o.id);
  if (!lens) return true;
  // The writer's own floor (ThemeLens.minMagnification): the look is written for that power and up.
  if (lens.minMagnification !== undefined && magnification < lens.minMagnification) return false;
  if (o.kind !== 'star' || !o.multiplicity?.pairs.length || !claimsSplit(lens.look)) return true;
  return splitsAt(o, magnification);
}

/** Lens of object `o` in a compiled template (undefined when the template has no lens or the object none there). */
export const lensOf = (ct: CompiledTemplate, objectId: string): ThemeLens | undefined => ct.lens?.byObject.get(objectId);

/** Story ingredients of a theme part: a lens theme has none beyond its beats (minBeats). */
export function templateIngredientsMet(prep: PreparedKb, objs: readonly number[], ct: CompiledTemplate): boolean {
  return ct.lens ? true : ingredientsMet(prep, objs, ct.t.ingredients);
}

/**
 * May the source template switch out after a stop in slot `cur`? A lens theme never switches (round 3: a journey is
 * one story; switches added a second payoff stop, dropped the first theme's payoff and put the second theme's raw
 * question into a transition). Other templates switch at their rule's `atArc` slot.
 */
export function switchArcOk(ct: CompiledTemplate, cur: number): boolean {
  const rule = ct.t.switchRule;
  if (!rule || ct.lens) return false;
  return ct.t.slots[cur]?.arc === rule.atArc;
}

// ───────────────────────────── theme-consistent links ─────────────────────────────

const FACT_KEY_SET: ReadonlySet<string> = new Set(FACT_KEYS);
/** Deep-sky classes that are scenes rather than objects at one distance (no direction rule out of such a hook). */
const SCENE_CLASSES: ReadonlySet<string> = new Set(['milky-way-field', 'star-cloud']);
/** Facts that tell a life story (evoStage archetypes): derived contrasts on anything else are off-theme. */
const LIFE_FACTS: ReadonlySet<FactKey> = new Set<FactKey>(['ageMyr', 'teffK', 'radiusRsun', 'lumLsun', 'massMsun']);

/** Facts an edge is "about": its subtype (or subtype head, "distanceLy-up"), its factRefs, distance for TIME_MACHINE. */
const edgeFactsMemo = new WeakMap<object, FactKey[]>();
export function edgeFacts(e: Pick<Edge, 'type' | 'subtype' | 'factRefs'>): FactKey[] {
  const hit = edgeFactsMemo.get(e);
  if (hit) return hit;
  const out = new Set<FactKey>();
  const head = e.subtype.split('-')[0];
  if (FACT_KEY_SET.has(e.subtype)) out.add(e.subtype as FactKey);
  else if (FACT_KEY_SET.has(head)) out.add(head as FactKey);
  for (const r of e.factRefs ?? []) out.add(r.fact);
  if (e.type === 'TIME_MACHINE') out.add('distanceLy');
  const list = Array.from(out);
  edgeFactsMemo.set(e, list);
  return list;
}

/**
 * Is a link on the archetype's theme (P4 engine evaluation)?
 * - Fact-bearing links (CONTRAST, SCALE, TIME_MACHINE) in an archetype with a fact progression must be about that
 *   fact: a distance ladder steps by distance, not by star radius; a thermometer compares temperatures.
 * - A distance ladder (CompiledTemplate.ladder) climbs at every step, whatever the link and slot (ladderStepOk,
 *   owner feedback round 1). Other progressions:
 * - They must also go the progression's way: SCALE / TIME_MACHINE everywhere but into a coda ("Back home"); a
 *   CONTRAST, or a LINE_OF_SIGHT in a distance archetype, into build and payoff slots (Alnair → ε Indi, 101 → 12
 *   light-years, is no "next rung"; a twist may contrast either way). Steps out of a hook that is a Milky Way scene
 *   are free (A11's star cloud spans thousands of light-years: a scene, not a rung).
 * - Life-story archetypes (evoStage) accept every curated link, but derived contrasts only on life facts (age,
 *   temperature, size, luminosity, mass), never on distance alone.
 * - A derived SAME_PHYSICS link must share one of the archetype's core concepts (concept sets incl. parents).
 * Other link types, and archetypes without a progression, pass.
 */
export function themeLinkOk(
  ct: CompiledTemplate, fromArc: ArcRole | null, arc: ArcRole, e: Edge, from: KbObject, to: KbObject,
  fromConcepts?: ReadonlySet<string>, toConcepts?: ReadonlySet<string>,
): boolean {
  // A derived SAME_PHYSICS link must share one of the archetype's core concepts: in a thermometer the "same
  // physics" is colour and temperature, not how clusters dissolve.
  if (e.type === 'SAME_PHYSICS' && !e.curated && fromConcepts && toConcepts && ct.t.coreConcepts.length
    && !ct.t.coreConcepts.some((c) => fromConcepts.has(c) && toConcepts.has(c))) return false;
  const p = ct.t.progression;
  if (!p) return true;
  // A distance ladder only ever climbs, in even-ish steps (ladderStepOk), whatever the link type and slot: no coda
  // "back home", no twist that steps nearer. Only a Milky Way scene opening the journey is not a rung.
  if (ct.ladder && !(fromArc === 'hook' && isSceneObject(from)) && !ladderStepOk(from, to)) return false;
  // Any other numeric progression (A5 ages, A2 temperatures) also keeps its direction into build and payoff
  // slots, whatever the link type: a curated LIFE_NEXT from NGC 1342 (160 Myr) to the Pleiades (125 Myr) is a
  // step back in a "families grow older" story (review panel, A/B round 1). A twist and a coda may turn.
  if (!ct.ladder && p.property !== 'evoStage' && p.direction !== 'arc' && (arc === 'build' || arc === 'payoff')
    && !(fromArc === 'hook' && isSceneObject(from))) {
    const a = from.facts[p.property]?.value, b = to.facts[p.property]?.value;
    if (a !== undefined && b !== undefined && Math.abs(b - a) > 1e-9 && (b > a) !== (p.direction === 'up')) return false;
  }
  // A LINE_OF_SIGHT link is a distance comparison: in a distance archetype it keeps the direction like a CONTRAST.
  const los = e.type === 'LINE_OF_SIGHT' && p.property === 'distanceLy';
  if (!los && e.type !== 'CONTRAST' && e.type !== 'SCALE' && e.type !== 'TIME_MACHINE') return true;
  if (!los) {
    const facts = edgeFacts(e);
    if (p.property === 'evoStage') return e.curated || facts.some((f) => LIFE_FACTS.has(f));
    if (!facts.includes(p.property)) return false;
  }
  if (p.property === 'evoStage' || p.direction === 'arc') return true;
  // Direction: SCALE / TIME_MACHINE steps everywhere but the coda; a CONTRAST (or a distance LINE_OF_SIGHT) only
  // into build and payoff slots (a twist may contrast either way). Steps out of a scene-setting hook are free.
  const directed = e.type === 'CONTRAST' || los ? arc === 'build' || arc === 'payoff' : arc !== 'coda';
  const sceneHook = fromArc === 'hook' && from.kind === 'dso' && SCENE_CLASSES.has(from.dsoClass);
  if (directed && !sceneHook) {
    const a = from.facts[p.property]?.value, b = to.facts[p.property]?.value;
    if (a !== undefined && b !== undefined && Math.abs(b - a) > 1e-9 && (b > a) !== (p.direction === 'up')) return false;
  }
  return true;
}

/**
 * The link a template uses from object a (in slot `from`, −1 = unknown) into slot j at object b: slot inEdges,
 * on-theme facts and direction (themeLinkOk), min strength.
 */
export function slotLink(prep: PreparedKb, ct: CompiledTemplate, from: number, j: number, a: number, b: number): Edge | null {
  if (ct.lens) return lensLink(prep, ct, a, b);
  const arc = ct.t.slots[j]?.arc ?? 'build';
  const fromArc = ct.t.slots[from]?.arc ?? null;
  const allowed = ct.slotAllowed[j] ?? ct.allowed;
  const A = prep.objects[a], B = prep.objects[b];
  // Same choice as graph.best(a, b, allowed, MIN_EDGE_STRENGTH, themeLinkOk…) without a closure per call (hot path).
  for (const e of prep.graph.ranked(a, b)) {
    if (e.type === 'NEIGHBOR' || !allowed.has(e.type) || e.strength < MIN_EDGE_STRENGTH) continue;
    if (themeLinkOk(ct, fromArc, arc, e, A, B, prep.concepts[a], prep.concepts[b])) return e;
  }
  return null;
}

/**
 * Template-level stop rule: in a colour (teffK) archetype every star must be bright enough to show its colour in
 * binoculars (STAR_COLOR_MAG); a mag-9 "blue-hot star" teaches nothing about colour.
 */
export function themeStopOk(ct: CompiledTemplate, o: KbObject): boolean {
  if (ct.t.progression?.property === 'teffK' && o.kind === 'star') return o.mag !== null && o.mag <= STAR_COLOR_MAG;
  return true;
}

/**
 * A challenge stop may be the payoff only where the archetype asks for a hard payoff (slot maxObsDifficulty ≥ 4,
 * e.g. A8's supernova remnant); elsewhere the climax must be a sure sight.
 */
export function challengePayoffAllowed(slot: { arc: ArcRole; match: { maxObsDifficulty?: number } }): boolean {
  return slot.arc !== 'payoff' || (slot.match.maxObsDifficulty ?? 0) >= 4;
}

/**
 * Star payoffs must be naked-eye stars (mag ≤ PAYOFF_STAR_MAG) unless the slot asks for a hard payoff
 * (maxObsDifficulty ≥ 4): Lalande 21185 at mag 7.5 as "Deepest contrast" was a typical lecturer veto.
 */
export const PAYOFF_STAR_MAG = 6.0;
export function payoffStopOk(slot: { arc: ArcRole; match: { maxObsDifficulty?: number } }, o: KbObject): boolean {
  if (slot.arc !== 'payoff' || o.kind !== 'star' || (slot.match.maxObsDifficulty ?? 0) >= 4) return true;
  return o.mag !== null && o.mag <= PAYOFF_STAR_MAG;
}

/**
 * In a variable-star story (theme tag "variable-stars", A10 Stars That Change) the hook and the payoff are the
 * stars the observer watches change, so their swing must be visible: at least VISIBLE_AMPLITUDE_MAG between vMax
 * and vMin when the KB knows both (owner feedback round 1: a 0.05 mag β Cephei pulsator opened the most repeated
 * A10 journey). Microvariables stay welcome as supporting (build / twist) stops; an unknown amplitude passes.
 */
export const VISIBLE_AMPLITUDE_MAG = 0.3;
export const VARIABLE_THEME_TAG = 'variable-stars';
export function variableStopOk(ct: CompiledTemplate, slot: { arc: ArcRole }, o: KbObject): boolean {
  if ((slot.arc !== 'hook' && slot.arc !== 'payoff') || !ct.t.themeTags.includes(VARIABLE_THEME_TAG)) return true;
  const v = o.kind === 'star' ? o.variability : undefined;
  if (!v || !Number.isFinite(v.vMax) || !Number.isFinite(v.vMin)) return true;
  return Math.abs(v.vMin - v.vMax) >= VISIBLE_AMPLITUDE_MAG - 1e-6;
}

/** Slot j of template ct accepts object o: the slot's match clauses plus the template-level stop rules. */
export function slotAccepts(ct: CompiledTemplate, j: number, o: KbObject, concepts: ReadonlySet<string>): boolean {
  if (ct.lens) {
    const beat = ct.lens.beats[j];
    return !!beat && ct.lens.byObject.get(o.id)?.step === beat.step && themeStopOk(ct, o);
  }
  const slot = ct.t.slots[j];
  return !!slot && slotMatches(o, slot.match, concepts) && themeStopOk(ct, o) && payoffStopOk(slot, o) && variableStopOk(ct, slot, o);
}

/**
 * Night-level archetype gates (doc 04 §3.1/§3.2 ingredients): a dark-sky archetype needs the sky brightness, and
 * the Moon limits compare with its illumination while it is up during the journey (`moonIllumination`, 0 when the
 * Moon stays down). Returns the reason the archetype cannot run, or null.
 */
export function templateNightBlock(t: Template, sky: number, moonIllumination: number): 'dark-sky' | 'moon-bright' | 'moon-faint' | null {
  const ing = t.ingredients;
  if ((t.needsDark && sky < 20) || (ing.minSkyBrightness !== undefined && sky < ing.minSkyBrightness)) return 'dark-sky';
  if (ing.maxMoonIllumination !== undefined && moonIllumination > ing.maxMoonIllumination) return 'moon-bright';
  if (ing.minMoonIllumination !== undefined && moonIllumination < ing.minMoonIllumination) return 'moon-faint';
  return null;
}

/** Slot options after being in slot `cur` (−1 = start) with `count` fillers and `visited` slot bitmask. */
export function nextSlots(ct: CompiledTemplate, cur: number, count: number, visited: number): number[] {
  const out: number[] = [];
  if (cur >= 0 && count < ct.repeatMax[cur]) out.push(cur);
  if (cur >= 0 && count < ct.repeatMin[cur]) return out;
  const curRank = cur >= 0 ? ct.ranks[cur] : -1;
  for (let j = 0; j < ct.ranks.length; j++) {
    if (j === cur || visited & (1 << j)) continue;
    if (ct.ranks[j] < curRank) continue;
    let ok = true;
    for (let k = 0; k < ct.ranks.length && ok; k++) {
      if (k === j || k === cur || visited & (1 << k)) continue;
      if (ct.ranks[k] < ct.ranks[j] && !ct.optional[k]) ok = false;
    }
    if (ok) out.push(j);
  }
  return out;
}

const popcount = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

/**
 * Grammar complete: current run long enough and every unvisited slot optional; a lens theme also needs `minBeats`
 * distinct beats (default its lens minBeats) and ends on one of its end beats.
 */
export function grammarComplete(ct: CompiledTemplate, cur: number, count: number, visited: number, minBeats?: number): boolean {
  if (cur < 0 || count < ct.repeatMin[cur]) return false;
  for (let k = 0; k < ct.ranks.length; k++) if (!(visited & (1 << k)) && !ct.optional[k]) return false;
  if (ct.lens && popcount(visited) < (minBeats ?? ct.lens.minBeats)) return false;
  if (ct.lens?.endSlots && !ct.lens.endSlots.has(cur)) return false;
  return true;
}

/** Grammar position inside a template: current slot, fillers in it so far, visited-slot bitmask. */
export interface GrammarState { cur: number; count: number; visited: number }

/**
 * Grammar state right after an archetype switch INTO `ct` (spec decision 6, Template.switchRule): the stop that
 * closed the previous theme stands in for the target's hook, so every slot before the target's first `build`
 * slot counts as visited and its run is closed. Null when the target has no build slot after its opening.
 */
export function switchEntryState(ct: CompiledTemplate): GrammarState | null {
  if (ct.lens) return null; // a lens theme's entry depends on the switch stop (switchEntryFor)
  const firstBuild = ct.t.slots.findIndex((s) => s.arc === 'build');
  if (firstBuild <= 0) return null;
  let visited = 0;
  for (let j = 0; j < firstBuild; j++) visited |= 1 << j;
  const cur = firstBuild - 1;
  return { cur, count: ct.repeatMax[cur], visited };
}

/**
 * Grammar state right after a switch into `ct` (switchEntryState). A lens theme is never a switch target (round 3:
 * a journey is one story), so the result is null there.
 */
export function switchEntryFor(ct: CompiledTemplate): GrammarState | null {
  return ct.lens ? null : switchEntryState(ct);
}

/** Can `ct` be a switch target at all (never a lens theme)? */
export const switchableInto = (ct: CompiledTemplate): boolean => !ct.lens && !!switchEntryState(ct);

/** Whole-sequence grammar check (validator, re-ordering); `init` continues from a switch entry state. */
export function slotSequenceValid(ct: CompiledTemplate, slots: readonly number[], init?: GrammarState, minBeats?: number): boolean {
  let cur = init?.cur ?? -1, count = init?.count ?? 0, visited = init?.visited ?? 0;
  for (const j of slots) {
    if (!nextSlots(ct, cur, count, visited).includes(j)) return false;
    if (j === cur) count++;
    else { cur = j; count = 1; visited |= 1 << j; }
  }
  return grammarComplete(ct, cur, count, visited, minBeats);
}

/**
 * Superlative tags are matched on their stem: templates say "most-luminous-in-view" / "hottest-star-in-view" /
 * "fastest-moving" where curators wrote "most-luminous" / "hottest" / "fastest" (doc 04 tags vs curated tags).
 */
export function superlativeStem(tag: string): string {
  return tag.toLowerCase().replace(/-in-view$/, '').replace(/-(star|cluster|moving|spinning|spinner)$/, '');
}

/** Does an object satisfy a slot's match clauses? */
export function slotMatches(o: KbObject, m: SlotMatch, concepts: ReadonlySet<string>): boolean {
  if (m.kinds && !m.kinds.includes(o.kind)) return false;
  if (m.dsoClasses && (o.kind !== 'dso' || !(m.dsoClasses.includes(o.dsoClass) || (o.secondaryClasses ?? []).some((c) => m.dsoClasses!.includes(c))))) return false;
  if (m.roles && !m.roles.some((r) => o.roles.includes(r))) return false;
  if (m.anyConcepts && !m.anyConcepts.some((c) => concepts.has(c))) return false;
  if (m.allConcepts && !m.allConcepts.every((c) => concepts.has(c))) return false;
  if (m.evoStageIn && (o.evoStage === null || !m.evoStageIn.includes(o.evoStage))) return false;
  if (m.superlativeTags) {
    const want = new Set(m.superlativeTags.map(superlativeStem));
    if (!o.superlatives.some((s) => s.tag && want.has(superlativeStem(s.tag)))) return false;
  }
  if (m.variabilityClasses && !(o.kind === 'star' && o.variability && m.variabilityClasses.includes(o.variability.class))) return false;
  if (m.hasHistoryHook && !o.historyHook) return false;
  if (m.minWow !== undefined && o.wow < m.minWow) return false;
  if (m.maxObsDifficulty !== undefined && o.obsDifficulty > m.maxObsDifficulty) return false;
  if (m.minInterest !== undefined && o.interest < m.minInterest) return false;
  if (m.hasMisconception && !o.misconceptions.length) return false;
  if (m.factRanges) {
    for (const [k, r] of Object.entries(m.factRanges) as [FactKey, { min?: number; max?: number }][]) {
      const f = o.facts[k];
      if (!f) return false;
      if (r.min !== undefined && f.value < r.min) return false;
      if (r.max !== undefined && f.value > r.max) return false;
    }
  }
  return true;
}

// ───────────────────────────── ingredients (doc 04 §3.1) ─────────────────────────────

export function ingredientsMet(prep: PreparedKb, objs: readonly number[], ing: TemplateIngredients): boolean {
  const os = objs.map((i) => prep.objects[i]);
  for (const r of ing.roles ?? []) {
    if (os.filter((o) => o.roles.some((x) => r.anyOf.includes(x))).length < r.min) return false;
  }
  if (ing.minDistinctEvoStages !== undefined) {
    const st = new Set(os.map((o) => o.evoStage).filter((e) => e !== null));
    if (st.size < ing.minDistinctEvoStages) return false;
  }
  for (const f of ing.factSpans ?? []) {
    const vals = os.map((o) => o.facts[f.fact]?.value).filter((v): v is number => v !== undefined);
    if (vals.length < 2) return false;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (f.minSpan !== undefined && hi - lo < f.minSpan) return false;
    if (f.minRatio !== undefined && (lo <= 0 || hi / lo < f.minRatio)) return false;
  }
  if (ing.minStars !== undefined && os.filter((o) => o.kind === 'star').length < ing.minStars) return false;
  // Story ingredients are counted on the objects themselves (patch members in the pre-check, stops in a journey):
  // a time machine must tell at least one historical story, a record-breakers tour must show the records.
  if (ing.minSuperlatives !== undefined && os.filter((o) => o.superlatives.length > 0).length < ing.minSuperlatives) return false;
  if (ing.minHistoryHooks !== undefined && os.filter((o) => !!o.historyHook).length < ing.minHistoryHooks) return false;
  return true;
}

// ───────────────────────────── story graph ─────────────────────────────

const TYPE_ORDER: Record<EdgeType, number> = {
  CAUSE: 0, LIFE_NEXT: 1, SIBLING: 2, LINE_OF_SIGHT: 3, CONTRAST: 4, SCALE: 5, TIME_MACHINE: 6, SAME_PHYSICS: 7, SAME_FAMILY: 8, NEIGHBOR: 9,
};
/**
 * Derived CONTRAST.distanceLy edges ("{prev} and {next} look like neighbors, but…", "…though they share this patch
 * of sky") only between objects within this many degrees, about a fist at arm's length (P4 evaluation).
 */
export const DEPTH_CONTRAST_MAX_SEP_DEG = 10;
/** A star inside a deep-sky object's extent shares its view only this close to the object's centre (half a field). */
export const INSIDE_VIEW_DEG = 3;
/** Reason key of the derived "mass decides the fate" contrast (narrate.ts has a built-in text when the bank lacks it). */
export const FATE_REASON_KEY = 'CONTRAST.fate';
/** Curated edges win ties against derived ones (doc 05 §12.4: curated CAUSE beats derived). */
export const CURATED_BONUS = 0.15;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const log10ratio = (a: number, b: number) => (a > 0 && b > 0 ? Math.log10(b / a) : 0);

export class StoryGraph {
  private curated = new Map<number, Edge[]>();
  private derivedCache = new Map<number, Edge[]>();
  constructor(private prep: PreparedKb) {
    const n = prep.objects.length;
    const add = (a: number, b: number, e: Edge) => {
      const key = a * n + b;
      const list = this.curated.get(key);
      if (list) list.push(e); else this.curated.set(key, [e]);
    };
    for (const e of prep.kb.edges) {
      const a = prep.index.get(e.from), b = prep.index.get(e.to);
      if (a === undefined || b === undefined) continue; // context-node edges are not stop-to-stop links
      add(a, b, e);
      if (e.directed === false) add(b, a, e);
    }
  }

  curatedEdges(a: number, b: number): readonly Edge[] {
    return this.curated.get(a * this.prep.objects.length + b) ?? [];
  }

  derivedEdges(a: number, b: number): readonly Edge[] {
    const key = a * this.prep.objects.length + b;
    let list = this.derivedCache.get(key);
    if (!list) { list = this.derive(a, b); this.derivedCache.set(key, list); }
    return list;
  }

  /**
   * Two objects may both be stops of one journey (P4 evaluation, "duplicate-ish stops"). Stops closer than
   * SAME_POINT_DEG are one sight (the two components of α Centauri or Acrux, a star at the heart of its own small
   * cluster) and never both count. Closer than SAME_VIEW_DEG they share one binocular view: that is only worth
   * two stops when a curated comparison of the two is the lesson (LINE_OF_SIGHT, CONTRAST or CAUSE, e.g. M35 and
   * NGC 2158, M81 and M82, Mimosa and the Jewel Box). A star inside a deep-sky object's own extent (Alcyone in the
   * Pleiades, θ Tauri in the Hyades) needs a curated LINE_OF_SIGHT edge (Aldebaran, a foreground star).
   */
  pairOk(a: number, b: number): boolean {
    if (a === b) return false;
    const n = this.prep.objects.length;
    const key = Math.min(a, b) * n + Math.max(a, b);
    let ok = this.pairCache.get(key);
    if (ok === undefined) { ok = this.computePairOk(a, b); this.pairCache.set(key, ok); }
    return ok;
  }

  private pairCache = new Map<number, boolean>();

  private computePairOk(a: number, b: number): boolean {
    const d = this.prep.sepDeg(a, b);
    if (d < SAME_POINT_DEG) return false;
    const A = this.prep.objects[a], B = this.prep.objects[b];
    // A star inside a deep-sky object's extent and within half a binocular field of its centre shares its view
    // (Mirfak sits 1.2° from the centre of the 3° Alpha Persei Cluster).
    const insideOf = (star: KbObject, dso: KbObject) => {
      if (star.kind !== 'star' || dso.kind !== 'dso') return false;
      const m = majorArcmin(dso);
      return m !== null && d < m / 120 && d < INSIDE_VIEW_DEG;
    };
    const inside = insideOf(A, B) || insideOf(B, A);
    if (d >= SAME_VIEW_DEG && !inside) return true;
    const types = [...this.curatedEdges(a, b), ...this.curatedEdges(b, a)].map((e) => e.type);
    if (inside) return types.includes('LINE_OF_SIGHT');
    return types.some((t) => t === 'LINE_OF_SIGHT' || t === 'CONTRAST' || t === 'CAUSE');
  }

  /** Best usable a→b link among `allowed` types, strength ≥ minStrength, NEIGHBOR excluded, passing `accept`. */
  best(a: number, b: number, allowed: ReadonlySet<EdgeType>, minStrength = MIN_EDGE_STRENGTH, accept?: (e: Edge) => boolean): Edge | null {
    for (const e of this.ranked(a, b)) {
      if (e.type === 'NEIGHBOR' || !allowed.has(e.type) || e.strength < minStrength) continue;
      if (accept && !accept(e)) continue;
      return e;
    }
    return null;
  }

  private rankedCache = new Map<number, Edge[]>();

  /**
   * Every a→b edge (curated, then derived) in preference order: strength + CURATED_BONUS (descending, 1e-9
   * tolerance), then TYPE_ORDER, then subtype, then scan order. `best` returns the first edge that passes its
   * filters, i.e. the preferred usable edge (memoised: the beam asks for the same pairs many times).
   */
  ranked(a: number, b: number): readonly Edge[] {
    const key = a * this.prep.objects.length + b;
    let list = this.rankedCache.get(key);
    if (!list) {
      const all = [...this.curatedEdges(a, b), ...this.derivedEdges(a, b)];
      const score = (e: Edge) => e.strength + (e.curated ? CURATED_BONUS : 0);
      list = all.map((e, i) => ({ e, i, s: score(e) })).sort((x, y) => {
        if (Math.abs(x.s - y.s) > 1e-9) return y.s - x.s;
        if (TYPE_ORDER[x.e.type] !== TYPE_ORDER[y.e.type]) return TYPE_ORDER[x.e.type] - TYPE_ORDER[y.e.type];
        if (x.e.subtype !== y.e.subtype) return x.e.subtype < y.e.subtype ? -1 : 1;
        return x.i - y.i;
      }).map((x) => x.e);
      this.rankedCache.set(key, list);
    }
    return list;
  }

  /** Doc 05 §4 derived rules (deterministic, facts only). */
  private derive(a: number, b: number): Edge[] {
    if (a === b) return [];
    const p = this.prep, A = p.objects[a], B = p.objects[b];
    const out: Edge[] = [];
    const edge = (type: EdgeType, subtype: string, strength: number, reasonKey: string, directed: boolean, facts: FactKey[] = []): Edge => ({
      from: A.id, to: B.id, type, subtype, strength: r3(Math.max(0.2, Math.min(1, strength))), reasonKey, curated: false, directed,
      ...(facts.length ? { factRefs: facts.flatMap((f) => [{ objectId: A.id, fact: f }, { objectId: B.id, fact: f }]) } : {}),
    });
    // LIFE_NEXT: next derived life stage; mass-compatible fates are strong.
    const la = p.lifeStage[a], lb = p.lifeStage[b];
    if (la !== null && lb !== null) {
      const massiveFate = la === 4 && lb === 6 && A.kind === 'star';
      const sunLikeFate = la === 3 && lb === 5 && A.kind === 'star' && (A.facts.massMsun?.value ?? 1) < 8;
      if (massiveFate || sunLikeFate) out.push(edge('LIFE_NEXT', `stage-${la}-${lb}`, 0.9, 'LIFE_NEXT', true));
      else if (lb === la + 1) out.push(edge('LIFE_NEXT', `stage-${la}-${lb}`, 0.6, 'LIFE_NEXT', true));
    }
    // SIBLING: members of the same context node (association, cloud, moving group, system).
    if (p.contexts[a].some((c) => p.contexts[b].includes(c))) out.push(edge('SIBLING', 'same-context', 0.7, 'SIBLING', false));
    // CONTRAST (symmetric): alike in one attribute, very different on another (doc 04 SAME_X_DIFF_Y needs the
    // shared attribute: same kind, a shared role or a shared non-trivial concept).
    const sameKind = A.kind === B.kind;
    let sharedConcept = false;
    p.coreConcepts[a].forEach((c) => { if (p.coreConcepts[b].has(c)) sharedConcept = true; });
    const alike = p.kindKey[a] === p.kindKey[b] || A.roles.some((r) => B.roles.includes(r)) || sharedConcept;
    const theta0 = p.sepDeg(a, b);
    for (const f of ['teffK', 'radiusRsun', 'lumLsun', 'ageMyr', 'distanceLy'] as FactKey[]) {
      if (!alike || ((f === 'teffK' || f === 'radiusRsun' || f === 'lumLsun') && !sameKind)) continue;
      // A distance contrast says "they look like neighbours, yet one is far deeper": only true for a shared patch.
      if (f === 'distanceLy' && theta0 > DEPTH_CONTRAST_MAX_SEP_DEG) continue;
      const fa = A.facts[f]?.value, fb = B.facts[f]?.value;
      if (fa === undefined || fb === undefined) continue;
      const lr = Math.abs(log10ratio(fa, fb));
      if (lr >= 0.5) out.push(edge('CONTRAST', f, Math.min(1, lr / 2), `CONTRAST.${f}`, false, [f]));
    }
    // SCALE / TIME_MACHINE (directional steps; the archetype progression rewards the wanted direction).
    for (const f of ['distanceLy', 'sizeLy', 'radiusRsun'] as FactKey[]) {
      const fa = A.facts[f]?.value, fb = B.facts[f]?.value;
      if (fa === undefined || fb === undefined) continue;
      const lr = log10ratio(fa, fb);
      if (Math.abs(lr) >= 0.3) {
        const s = Math.min(1, 0.3 + Math.abs(lr) / 4);
        out.push(edge('SCALE', `${f}-${lr > 0 ? 'up' : 'down'}`, s, `SCALE.${f}`, true, [f]));
        if (f === 'distanceLy') out.push(edge('TIME_MACHINE', lr > 0 ? 'farther' : 'nearer', s, 'TIME_MACHINE', true, [f]));
      }
    }
    // CONTRAST of fates: mass decides how a star ends. A planetary nebula / white dwarf (a light star's end) against
    // a supergiant or a supernova remnant (a heavy star's end) is the textbook comparison (doc 04 A8, "how stars
    // die"); subtype head massMsun keeps it on-theme for life-story archetypes.
    const light = (x: number) => p.lifeStage[x] === 5;
    const heavy = (x: number) => p.lifeStage[x] === 6 || (p.lifeStage[x] === 4 && p.objects[x].kind === 'star');
    if ((light(a) && heavy(b)) || (heavy(a) && light(b))) out.push(edge('CONTRAST', 'massMsun-fate', 0.8, FATE_REASON_KEY, false));
    // SAME_FAMILY: same kind, different specimen (weak).
    if (p.kindKey[a] === p.kindKey[b]) out.push(edge('SAME_FAMILY', p.kindKey[a], 0.4, 'SAME_FAMILY', false));
    // SAME_PHYSICS: shared non-trivial concepts (Jaccard).
    const ca = p.coreConcepts[a], cb = p.coreConcepts[b];
    let inter = 0;
    ca.forEach((c) => { if (cb.has(c)) inter++; });
    if (inter > 0) out.push(edge('SAME_PHYSICS', 'shared-concept', inter / (ca.size + cb.size - inter), 'SAME_PHYSICS', false));
    // LINE_OF_SIGHT: close on the sky, very different distances.
    const da = A.facts.distanceLy?.value, db = B.facts.distanceLy?.value;
    const theta = p.sepDeg(a, b);
    if (da !== undefined && db !== undefined) {
      if (theta < 1.5 && Math.abs(log10ratio(da, db)) >= 0.3) out.push(edge('LINE_OF_SIGHT', 'line-of-sight', 0.6, 'LINE_OF_SIGHT', false, ['distanceLy']));
      const d3 = Math.sqrt(da * da + db * db - 2 * da * db * Math.cos(theta * Math.PI / 180));
      if (d3 < 300) out.push(edge('NEIGHBOR', 'within-300-ly', 0.3, 'NEIGHBOR', false));
    }
    return out;
  }
}

// ───────────────────────────── prepared KB (memoised) ─────────────────────────────

export interface PreparedKb {
  kb: KnowledgeBase;
  /** Objects sorted by id (result independent of KB array order). */
  objects: KbObject[];
  index: Map<string, number>;
  eligible: boolean[];
  lifeStage: (LifeStage | null)[];
  kindKey: string[];
  /** Concept ids incl. parents (slot matching, theme drift). */
  concepts: Set<string>[];
  /** Concepts excluding tier-0 sky-literacy ones (SAME_PHYSICS). */
  coreConcepts: Set<string>[];
  /** Context ids incl. memberships declared on context nodes and ancestors. */
  contexts: string[][];
  templates: CompiledTemplate[];
  graph: StoryGraph;
  sepDeg: (a: number, b: number) => number;
  /** Cosine of the separation (cheap pre-check before sepDeg's acos). */
  cosSep: (a: number, b: number) => number;
}

const prepared = new WeakMap<KnowledgeBase, PreparedKb>();

export function prepareKb(kb: KnowledgeBase): PreparedKb {
  const hit = prepared.get(kb);
  if (hit) return hit;
  const objects = kb.objects.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = new Map(objects.map((o, i) => [o.id, i] as const));
  const conceptById = new Map<string, Concept>(kb.concepts.map((c) => [c.id, c] as const));
  const concepts = objects.map((o) => {
    const set = new Set<string>();
    for (const t of o.teaches) {
      set.add(t.conceptId);
      let parent = conceptById.get(t.conceptId)?.parent, guard = 0;
      while (parent && guard++ < 8) { set.add(parent); parent = conceptById.get(parent)?.parent; }
    }
    return set;
  });
  const coreConcepts = concepts.map((set) => new Set(Array.from(set).filter((c) => (conceptById.get(c)?.tier ?? 1) > 0)));
  const ctxById = new Map(kb.contexts.map((c) => [c.id, c] as const));
  const contexts = objects.map((o) => {
    const set = new Set<string>(o.contextIds);
    for (const c of kb.contexts) if (c.memberIds.includes(o.id)) set.add(c.id);
    for (const c of Array.from(set)) {
      let parent = ctxById.get(c)?.parentId, guard = 0;
      while (parent && guard++ < 8) { set.add(parent); parent = ctxById.get(parent)?.parentId; }
    }
    return Array.from(set).sort();
  });
  const vec = objects.map((o) => {
    const r = (o.ra * Math.PI) / 180, d = (o.dec * Math.PI) / 180;
    return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)] as const;
  });
  const cosSep = (a: number, b: number) => {
    const u = vec[a], v = vec[b];
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  };
  const sepDeg = (a: number, b: number) => (Math.acos(Math.max(-1, Math.min(1, cosSep(a, b)))) * 180) / Math.PI;
  const lifeStage = objects.map(lifeStageOf);
  const lensByArchetype = new Map((kb.lenses ?? []).map((l) => [l.archetype, l] as const));
  const prep = {
    kb, objects, index,
    eligible: objects.map(isJourneyEligible),
    lifeStage,
    kindKey: objects.map(kindKey),
    concepts, coreConcepts, contexts,
    templates: kb.templates.slice().sort((a, b) => a.id.localeCompare(b.id)).map((t) => compileTemplate(t, lensByArchetype.get(t.archetype))),
    sepDeg, cosSep,
  } as Omit<PreparedKb, 'graph'> as PreparedKb;
  prep.graph = new StoryGraph(prep);
  prepared.set(kb, prep);
  return prep;
}

// ───────────────────────────── candidate table ─────────────────────────────

export interface CandidateTable {
  prep: PreparedKb;
  s: EngineSettings;
  grid: NightGrid;
  tracks: ObjectTrack[];
  /** stops[obj][i] for i < depth. */
  stops: StopEval[][];
  /** Bit i set ⇔ object feasible as stop index i. */
  feasibleMask: number[];
  /** Number of stop indices evaluated. */
  depth: number;
  candidates: Candidate[];
}

/** Build the S1 table (doc 05 §5.1). `depth` = number of stop indices to evaluate (≤ 10). */
export function buildCandidateTable(prep: PreparedKb, s: EngineSettings, grid?: NightGrid, depth = MAX_STOPS): CandidateTable {
  const g = grid ?? buildNightGrid(s);
  const conv = ofDateConverter(g.times[g.midIndex]);
  const rate = makeRater(s);
  const d = Math.min(MAX_STOPS, depth);
  const tracks: ObjectTrack[] = [];
  const stops: StopEval[][] = [];
  const feasibleMask: number[] = [];
  const candidates: Candidate[] = [];
  prep.objects.forEach((o, idx) => {
    const tr = trackObject(o, s, g, conv);
    tracks.push(tr);
    const row: StopEval[] = [];
    let mask = 0;
    for (let i = 0; i < d; i++) {
      const ev = evaluateStop(o, tr, g, i, s, rate, prep.eligible[idx]);
      row.push(ev);
      if (ev.ok) mask |= 1 << i;
    }
    stops.push(row);
    feasibleMask.push(mask);
    const first = row.find((r) => r.ok) ?? row[0];
    let altMax = -90;
    for (let k = 0; k < tr.alt.length; k++) altMax = Math.max(altMax, tr.alt[k]);
    const moonUp0 = g.moonUp[0];
    candidates.push({
      objectId: o.id,
      feasible: mask !== 0,
      altStart: tr.alt[0],
      altMax,
      azStart: tr.az[0],
      moonSepDeg: moonUp0 ? tr.moonSep[0] : null,
      moonGlowMag: tr.glow[0],
      rating: (first.rating < 0 ? 3 : first.rating) as 0 | 1 | 2 | 3,
      minutesAboveMinAlt: minutesAboveAlt(tr.decDate, s.lat, hourAngle(tr.raDate, s.lon, g.gastDeg[0]), s.minAlt),
      rejectReasons: mask !== 0 ? [] : (row[0].reasons as RejectReason[]),
    });
  });
  return { prep, s, grid: g, tracks, stops, feasibleMask, depth: d, candidates };
}
