/**
 * Sky Journeys S3–S4: archetype pre-check and template-guided beam search (doc 05 §5.4–5.5).
 *
 * For every (template × patch) pair whose required slots can be filled tonight, sequences are grown slot by
 * slot following the template's slot grammar (spec decision 6). Each step needs an allowed typed story link
 * (strength ≥ 0.35, NEIGHBOR never counts, the target slot's inEdges, on the archetype's theme:
 * candidates.slotLink / themeLinkOk) and must respect the per-index time window, the cap, hop/path limits, the
 * one-challenge rule (never on a payoff that does not ask for a hard object), the same-view rule
 * (StoryGraph.pairOk) and the one-back-track rule. Full-plan rules that need the whole set
 * (principal-axis reversals, template ingredients) are enforced by validate.ts after re-ordering.
 *
 * Archetype switch (spec decision 6, Template.switchRule): once the source grammar is complete at its `atArc`
 * slot (the payoff in every shipped template), a state may continue in a target template from the target's
 * first build slot on; the switch stop doubles as the target's hook and the next link must be one of the
 * rule's `via` types at ≥ minStrength. At most one switch per sequence (a switched state never switches again).
 * A lens theme never switches and is never switched into (round 3: a journey is one story).
 *
 * Lens themes (doc 05 §5.4a): stops sharing a beat follow ThemeLens.rank; a back-track may ride the storyline when
 * it moves on to a later beat (candidates.backtrackLinkOk); h pays for beats left out (lensCoverageTerm) and the
 * last stop may be a challenge only on the theme's final or end beat (candidates.lensPayoffOk).
 *
 * `stepHeuristic` is the hand-tuned journey heuristic h (also the scorer baseline and the beam objective).
 */
import { MAX_STOPS, MIN_STOPS, moonDuring } from './conditions';
import {
  backtrackLinkOk, challengePayoffAllowed, FINALE_HOP_STRETCH, grammarComplete, hopLimitInto, lensPayoffOk, lensRankOk, lensVisibleOk, nextSlots, slotAccepts, slotLink, switchArcOk,
  switchEntryFor, switchableInto, templateIngredientsMet, templateNightBlock,
  type CandidateTable, type CompiledTemplate, type PreparedKb,
} from './candidates';
import { SHARP_TURN_DEG, gnomonic, pathGeometry, sepDeg as vecSepDeg, turnAngleDeg, unitVec, type Patch, type RaDec } from './region';
import { quantize } from './seed';
import { compileSwitch, planLinks, switchLinkOf, type Plan, type PlanSwitch } from './validate';
import type { ArcRole, Edge, KbObject } from './types';

// ───────────────────────────── heuristic h ─────────────────────────────

/** Progression value of an object for a template axis (evoStage, or log10 of a fact). */
export function progressionValue(o: KbObject, ct: CompiledTemplate): number | null {
  const p = ct.t.progression;
  if (!p) return null;
  if (p.property === 'evoStage') return o.evoStage === null || o.evoStage === 8 ? null : o.evoStage;
  const f = o.facts[p.property];
  return f && f.value > 0 ? Math.log10(f.value) : null;
}

/**
 * Owner feedback round 1 (docs/sky-journeys/owner-feedback-r1.md, engine-eval.md "Round 1 owner feedback"): the
 * owner ranked journeys with a clear progression and a payoff first (a distance ladder, stars that change, doubles
 * with a story) and the contrast tours (A6) low twice, while h ranked A6 first in 2 of 3 sets and A6 filled 39% of
 * the suggestions. The calibration is deliberately moderate (three ranked sets):
 * - ARCHETYPE_PRIOR: a per-archetype prior added once per journey (A6 down by about one stop's interest, the
 *   progression stories up a little);
 * - CLEAN_PROGRESSION_BONUS: a progression that never steps backwards over at least 3 steps;
 * - CHALLENGE_BONUS: one challenge stop is a plus ("I like the idea of having a challenge in the set");
 * - WEAK_LINK_PENALTY: a derived link weaker than WEAK_LINK_STRENGTH costs extra (a vague "same kind" step);
 * - the "three of a kind in a row" penalty no longer applies inside star-only themes (doubles, variables, colours),
 *   where three stars in a row is the theme (CompiledTemplate.oneKindTheme).
 */
export const ARCHETYPE_PRIOR: Readonly<Record<string, number>> = {
  // Ranked low both times it was h's favourite (cal-02, cal-03); filled 39% of the suggestions.
  A6: -1.0,
  // Progression story with a payoff the owner ranked first (A3 cal-01). A4, A7 and A10 are retired as journeys
  // (templates.json "retired": true).
  A3: 0.3,
  // A9 Seeing Double: first once (cal-02, a good story), last once (cal-03): no prior.
};
export const CLEAN_PROGRESSION_BONUS = 0.3;
export const CHALLENGE_BONUS = 0.25;
export const WEAK_LINK_STRENGTH = 0.45;
export const WEAK_LINK_PENALTY = 0.3;

/** Is `e` a weak derived link (WEAK_LINK_STRENGTH)? Curated links carry an authored reason and never count. */
export const isWeakDerivedLink = (e: Pick<Edge, 'curated' | 'strength'> | null | undefined) => !!e && !e.curated && e.strength < WEAK_LINK_STRENGTH;

/** Prior of an archetype (ARCHETYPE_PRIOR; 0 when not listed). */
export const archetypePrior = (ct: CompiledTemplate) => ARCHETYPE_PRIOR[ct.t.archetype] ?? 0;

/**
 * Progression of a lens theme (owner feedback r2): its beats are the progression, whatever numbers the stops carry
 * (a thermometer told hot to cool is not "against" anything). +0.3 per stop that advances to a later beat,
 * CLEAN_PROGRESSION_BONUS from 3 distinct beats, LENS_FINALE_BONUS when the story reaches its last beat (round 3:
 * the climax, A7's farthest light, A8's ending, A12's glow, is worth reaching).
 */
export const LENS_FINALE_BONUS = 0.5;
export function lensProgressionTerm(objs: readonly KbObject[], ct: CompiledTemplate): number {
  const lens = ct.lens!;
  const steps = objs.map((o) => lens.byObject.get(o.id)?.step).filter((x): x is number => x !== undefined);
  let t = 0;
  for (let i = 1; i < steps.length; i++) if (steps[i] > steps[i - 1]) t += 0.3;
  if (new Set(steps).size >= 3) t += CLEAN_PROGRESSION_BONUS;
  if (steps.includes(lens.beats[lens.beats.length - 1].step)) t += LENS_FINALE_BONUS;
  return t;
}

/**
 * Whole stories (round 3, owner simulator): a lens journey that leaves out a beat it could have told tonight is a
 * weaker story, so h pays for it. A beat "could have been told" when an object with a lens on that beat is in reach:
 * inside the journey's region cap, a sure sight (rating below challenge) at that position, not sharing a view with
 * its would-be neighbours, and within one hop of them. Scoring penalties rather than hard rules, so a night whose
 * only nursery leads nowhere still gets a journey (availability):
 * - LENS_OPEN_PENALTY: the journey opens on a later beat although an earlier beat is in reach of its first stop
 *   (A1 should open at the nursery when the Orion Nebula is up, A2 at red or orange, A5 at "born together"). A beat
 *   listed in the storyline's firstSteps is always a fine opening.
 * - LENS_SKIP_PENALTY, per beat: two consecutive stops jump over a beat that is in reach of both (A2 jumping from
 *   red to yellow with an orange star in the same field).
 * - LENS_REPEAT_PENALTY: a second stop on the same beat while the next beat, never visited by the journey, has a
 *   candidate in reach of the previous stop (two clusters on one rung when a "stars of known power" rung was there).
 * Skip and repeat prices are multiplied by KEY_BEAT_FACTOR for a beat listed in the storyline's keySteps.
 */
export const LENS_OPEN_PENALTY = 1.5;
export const LENS_SKIP_PENALTY = 1.0;
export const LENS_REPEAT_PENALTY = 0.5;
/**
 * Round 4 (owner simulator): a beat whose candidate is not within a hop of the stops beside the gap, but is within a
 * hop of some stop of the journey (the route passes by it), still counts as left out, at a lower price. A2 in
 * Cepheus skipped orange Schedar while the next cards pointed at it; A1 in Cygnus opened on M39 (beat 3) with
 * NGC 6871 (beat 2) a hop from Deneb.
 */
export const LENS_OPEN_SOFT_PENALTY = 0.6;
export const LENS_SKIP_SOFT_PENALTY = 0.4;
/**
 * Owner feedback r3: a theme's turn (ThemeStoryline.keySteps; A9's strangers) left out while in reach costs this
 * many times the skip and repeat prices above. In Lyra and Cygnus the only stranger, Albireo, sits a hop from the
 * route but never a hop from both the orange 31 Cygni and the partners 16 and 61 Cygni, so the jump over it was
 * priced softly and the night's rotation often picked the journey without the twist.
 */
export const KEY_BEAT_FACTOR = 2;

interface LensReach {
  /** Per slot (beat): lens objects inside the region cap that these binoculars can honour (lensVisibleOk). */
  bySlot: number[][];
  memo: Map<string, boolean>;
}
const reachMemo = new WeakMap<object, Map<string, LensReach>>();

function lensReach(table: CandidateTable, ct: CompiledTemplate, center: RaDec, radius: number): LensReach {
  let byTable = reachMemo.get(table.stops);
  if (!byTable) { byTable = new Map(); reachMemo.set(table.stops, byTable); }
  const key = `${ct.t.id}|${center.ra.toFixed(4)}|${center.dec.toFixed(4)}|${radius}|${table.s.maxHop}`;
  let r = byTable.get(key);
  if (!r) {
    const { prep, s } = table;
    const c = unitVec(center.ra, center.dec);
    const lens = ct.lens!;
    const bySlot: number[][] = lens.beats.map(() => []);
    lens.byObject.forEach((l, id) => {
      const i = prep.index.get(id);
      const j = lens.slotOfStep.get(l.step);
      if (i === undefined || j === undefined || table.feasibleMask[i] === 0) return;
      const o = prep.objects[i];
      if (vecSepDeg(c, unitVec(o.ra, o.dec)) > radius + 1e-9) return;
      if (!slotAccepts(ct, j, o, prep.concepts[i]) || !lensVisibleOk(ct, o, s.magnification)) return;
      bySlot[j].push(i);
    });
    r = { bySlot, memo: new Map() };
    byTable.set(key, r);
  }
  return r;
}

/**
 * Could a sure sight on slot j stand at position `pos` next to the stops `near` (within a hop, no shared view)?
 * Beats run in order, so a candidate for a beat the journey skips (or never reaches) is never one of its stops.
 */
function slotInReach(table: CandidateTable, r: LensReach, j: number, pos: number, near: readonly number[]): boolean {
  const key = `${j}|${pos}|${near.join(',')}`;
  let hit = r.memo.get(key);
  if (hit === undefined) {
    const { prep, s } = table;
    hit = r.bySlot[j].some((cand) => {
      if (pos < table.depth && (!(table.feasibleMask[cand] & (1 << pos)) || table.stops[cand][pos].rating >= 2)) return false;
      return near.every((k) => k !== cand && prep.sepDeg(k, cand) <= s.maxHop + 1e-9 && prep.graph.pairOk(k, cand));
    });
    r.memo.set(key, hit);
  }
  return hit;
}

/** Like slotInReach, but within a hop of ANY of `route` (the journey passes by it), with no shared view with any. */
function slotNearRoute(table: CandidateTable, r: LensReach, j: number, pos: number, route: readonly number[]): boolean {
  const key = `near|${j}|${pos}|${route.join(',')}`;
  let hit = r.memo.get(key);
  if (hit === undefined) {
    const { prep, s } = table;
    hit = r.bySlot[j].some((cand) => {
      if (route.includes(cand)) return false;
      if (pos < table.depth && (!(table.feasibleMask[cand] & (1 << pos)) || table.stops[cand][pos].rating >= 2)) return false;
      return route.some((k) => prep.sepDeg(k, cand) <= s.maxHop + 1e-9) && route.every((k) => prep.graph.pairOk(k, cand));
    });
    r.memo.set(key, hit);
  }
  return hit;
}

/** Penalty of a lens journey (stops `objs`, region cap center/radius) for the beats it leaves out (see LENS_OPEN_PENALTY). */
export function lensCoverageTerm(table: CandidateTable, ct: CompiledTemplate, objs: readonly number[], center: RaDec, radius: number): number {
  const lens = ct.lens;
  if (!lens || !objs.length) return 0;
  const { prep } = table;
  const r = lensReach(table, ct, center, radius);
  const slots = objs.map((i) => lens.slotOfStep.get(lens.byObject.get(prep.objects[i].id)?.step ?? NaN));
  if (slots.some((j) => j === undefined)) return 0;
  const sl = slots as number[];
  let pen = 0;
  // Opening: an earlier beat in reach of the first stop (a firstSteps beat is always a fine opening).
  if (!lens.firstSlots?.has(sl[0])) {
    let open = 0;
    for (let j = 0; j < sl[0] && open < LENS_OPEN_PENALTY; j++) {
      if (slotInReach(table, r, j, 0, [objs[0]])) open = LENS_OPEN_PENALTY;
      else if (slotNearRoute(table, r, j, 0, objs)) open = Math.max(open, LENS_OPEN_SOFT_PENALTY);
    }
    pen += open;
  }
  const visited = new Set(sl);
  const weight = (j: number) => (lens.keySlots?.has(j) ? KEY_BEAT_FACTOR : 1);
  for (let i = 1; i < objs.length; i++) {
    // Skipped beats between two consecutive stops (fully priced when in reach of both, softly when the route passes by).
    for (let j = sl[i - 1] + 1; j < sl[i]; j++) {
      if (slotInReach(table, r, j, i, [objs[i - 1], objs[i]])) pen += LENS_SKIP_PENALTY * weight(j);
      else if (slotNearRoute(table, r, j, i, objs)) pen += LENS_SKIP_SOFT_PENALTY * weight(j);
    }
    // A second stop on one beat while the next beat, never visited, was in reach.
    const nb = sl[i] + 1;
    if (sl[i] === sl[i - 1] && nb < lens.beats.length && !visited.has(nb) && slotInReach(table, r, nb, i, [objs[i - 1]])) pen += LENS_REPEAT_PENALTY * weight(nb);
  }
  return pen;
}

/** Progression term of one theme part: the lens beats for a lens theme, else the template's numeric progression. */
export const themeProgressionTerm = (objs: readonly KbObject[], ct: CompiledTemplate): number => (ct.lens ? lensProgressionTerm(objs, ct) : progressionTerm(objs, ct));

/**
 * +0.3 per step that follows the archetype progression, −0.3 against; `arc` may flip direction once for free.
 * A progression with at least 3 steps and none against gains CLEAN_PROGRESSION_BONUS.
 */
export function progressionTerm(objs: readonly KbObject[], ct: CompiledTemplate): number {
  const p = ct.t.progression;
  if (!p) return 0;
  let last: number | null = null, sign = 0, flips = 0, total = 0, steps = 0, against = 0;
  for (const o of objs) {
    const v = progressionValue(o, ct);
    if (v === null) continue;
    if (last !== null && Math.abs(v - last) > 1e-9) {
      const step = Math.sign(v - last);
      steps++;
      if (p.direction === 'up') { total += step > 0 ? 0.3 : -0.3; if (step < 0) against++; }
      else if (p.direction === 'down') { total += step < 0 ? 0.3 : -0.3; if (step > 0) against++; }
      else {
        if (sign === 0 || step === sign) total += 0.3;
        else if (flips === 0) { flips = 1; total += 0.1; }
        else { total -= 0.3; against++; }
        sign = step;
      }
    }
    last = v;
  }
  if (steps >= 3 && against === 0) total += CLEAN_PROGRESSION_BONUS;
  return total;
}

export interface StepInput {
  objs: readonly number[];
  links: readonly (Edge | null)[];
  hops: readonly number[];
  turns: readonly number[];
  /** Index of the switch stop (last stop of the first theme) when the sequence changes archetype. */
  switchAt?: number;
  /** Template the sequence switches into. */
  switchTo?: CompiledTemplate;
  /** Arc role of each stop's slot (payoff quality term). */
  arcs?: readonly ArcRole[];
  /** Per stop: its template is a star-only theme (no "three of a kind" penalty; CompiledTemplate.oneKindTheme). */
  kindFree?: readonly boolean[];
  /** Region cap of the sequence (a lens theme's beat coverage, lensCoverageTerm, needs it; absent = not scored). */
  region?: { center: RaDec; radius: number };
}

/**
 * Payoff quality (P4 evaluation): the payoff is the stop the journey builds toward, so it should be something
 * to see. +0.35 per wow point above 3, −0.3 per difficulty point above 2, −0.2 per magnitude for star payoffs
 * fainter than 5 (a faint red dwarf or a mag-8 globular as the climax was the most common lecturer complaint).
 */
export const PAYOFF_WOW_WEIGHT = 0.35;
export const PAYOFF_DIFFICULTY_WEIGHT = 0.3;
/** Star payoffs fainter than mag 5 lose this much per magnitude (a mag-6 twin star is no climax). */
export const PAYOFF_FAINT_STAR_WEIGHT = 0.2;

/** Payoff-quality term of h for object o at a payoff stop. */
export function payoffTerm(o: KbObject): number {
  const faint = o.kind === 'star' && o.mag !== null ? Math.max(0, o.mag - 5) : 0;
  return PAYOFF_WOW_WEIGHT * (o.wow - 3) - PAYOFF_DIFFICULTY_WEIGHT * Math.max(0, o.obsDifficulty - 2) - PAYOFF_FAINT_STAR_WEIGHT * faint;
}


/** h bonus per stop that is one of Tonight's Best top objects (JourneyRequest.boostIds): a nudge, less than "seen" (−0.5). */
export const BOOST_STOP_BONUS = 0.3;
/** h bonus per stop the request must include (JourneyRequest.mustInclude): keeps such sequences in the beam. */
export const MUST_STOP_BONUS = 3;

/** Cost of the one allowed archetype switch: a drifting theme must earn its place with stronger story links. */
export const SWITCH_COST = 0.2;

/**
 * Hand-tuned heuristic h of a whole sequence (doc 05 §5.5):
 * Σ 1.0·interest + 0.8·link + 0.4·superlative − 0.6·hop/R − 0.5·max(0, turn−90°)/90° − 0.8·glow/0.7
 *   − 0.6·max(0, 45°−alt)/15° + 0.3·new concept − 0.4·same kind as previous two (not in star-only themes)
 *   + 0.3·showpiece opener − 0.5·already seen + progression term (+ clean-progression bonus)
 *   + payoff quality at payoff stops (payoffTerm) + bright-Moon fit of the archetype (moonlitFit)
 *   + CHALLENGE_BONUS for a challenge stop − WEAK_LINK_PENALTY per weak derived link + ARCHETYPE_PRIOR
 *   + BOOST_STOP_BONUS per Tonight's Best stop + MUST_STOP_BONUS per must-include stop (both 0 unless requested)
 *   (round 1 owner calibration, see ARCHETYPE_PRIOR).
 * With an archetype switch, each theme's progression is scored on its own stops (the switch stop counts for
 * both), the prior is the mean of the two archetypes' and SWITCH_COST is subtracted.
 */
export function sequenceHeuristic(table: CandidateTable, ct: CompiledTemplate, radius: number, x: StepInput): number {
  let h = 0;
  for (let i = 0; i < x.objs.length; i++) h = addStopTerms(table, radius, x, i, h);
  return closeHeuristic(table, ct, x, h);
}

/**
 * The per-stop part of h for stop i, added to the running sum `h` in a fixed order. The beam search keeps the
 * running sum per state and adds one stop at a time; sequenceHeuristic loops over all stops. Both apply the same
 * floating-point operations in the same order, so incremental and full h agree bit for bit.
 */
export function addStopTerms(table: CandidateTable, radius: number, x: StepInput, i: number, h: number): number {
  const { prep } = table;
  const idx = x.objs[i];
  const o = prep.objects[idx];
  const ev = table.stops[idx][i];
  h += 1.0 * o.interest + (o.superlatives.length ? 0.4 : 0);
  h -= (0.8 * ev.maxGlow) / 0.7 + (0.6 * Math.max(0, 45 - ev.minAlt)) / 15;
  if (i === 0 && o.showpiece) h += 0.3;
  if (x.arcs?.[i] === 'payoff') h += payoffTerm(o);
  if (table.s.seen.has(o.id)) h -= 0.5;
  if (table.s.boost?.size && table.s.boost.has(o.id)) h += BOOST_STOP_BONUS;
  if (table.s.must?.size && table.s.must.has(o.id)) h += MUST_STOP_BONUS;
  if (ev.rating === 2) h += CHALLENGE_BONUS;
  if (i > 0) {
    const e = x.links[i - 1];
    h += 0.8 * (e?.strength ?? 0) - (0.6 * x.hops[i - 1]) / radius;
    if (isWeakDerivedLink(e)) h -= WEAK_LINK_PENALTY;
    // +0.3 when the stop brings at least one concept no earlier stop carried.
    let fresh = false;
    for (const c of Array.from(prep.concepts[idx])) {
      let seen = false;
      for (let k = 0; k < i && !seen; k++) seen = prep.concepts[x.objs[k]].has(c);
      if (!seen) { fresh = true; break; }
    }
    if (fresh) h += 0.3;
  }
  if (i > 1) {
    h -= (0.5 * Math.max(0, x.turns[i - 2] - 90)) / 90;
    const k = prep.kindKey[idx];
    if (!x.kindFree?.[i] && k === prep.kindKey[x.objs[i - 1]] && k === prep.kindKey[x.objs[i - 2]]) h -= 0.4;
  }
  return h;
}

/**
 * Bright-Moon fit (P4 evaluation): on a moonlit night the archetypes built for moonlight (moonSuitability
 * 'bright-ok' / moonFriendly: thermometer, doubles, variables, families, moonlit) gain MOONLIT_FIT × the Moon's
 * illumination while it is up during the journey, so they lead the suggestions instead of trailing star-only
 * versions of dark-sky themes.
 */
export const MOONLIT_FIT = 0.5;
const moonMemo = new WeakMap<object, number[]>();
function moonFor(table: CandidateTable, n: number): number {
  let byLen = moonMemo.get(table.grid);
  if (!byLen) { byLen = []; moonMemo.set(table.grid, byLen); }
  return (byLen[n] ??= moonDuring(table.grid, n));
}
export function moonlitFit(ct: CompiledTemplate, moonIllumination: number): number {
  const friendly = ct.t.moonSuitability ? ct.t.moonSuitability === 'bright-ok' : ct.t.moonFriendly;
  return friendly ? MOONLIT_FIT * moonIllumination : 0;
}

/** Adds the progression term(s), bright-Moon fit (and the switch cost) to the per-stop sum and quantises: the final h. */
export function closeHeuristic(table: CandidateTable, ct: CompiledTemplate, x: Pick<StepInput, 'objs' | 'switchAt' | 'switchTo' | 'region'>, h: number): number {
  const { prep } = table;
  const objs = x.objs.map((i) => prep.objects[i]);
  const fit = moonlitFit(ct, moonFor(table, x.objs.length));
  if (fit) h += fit;
  const last = objs.length - 1;
  if (x.switchTo && x.switchAt !== undefined) {
    // Only non-lens templates switch (candidates.switchArcOk / switchableInto).
    h += themeProgressionTerm(objs.slice(0, x.switchAt + 1), ct) + themeProgressionTerm(objs.slice(x.switchAt), x.switchTo) - SWITCH_COST;
    h += (archetypePrior(ct) + archetypePrior(x.switchTo)) / 2;
  } else {
    h += themeProgressionTerm(objs, ct) + archetypePrior(ct);
    // A lens theme's payoff is positional (its last stop; candidates.lensArcAt): its quality term is added here, on
    // the sequence as it stands, so the beam and the full h agree. So is the cost of the beats it leaves out.
    if (ct.lens && last >= 0) {
      h += payoffTerm(objs[last]);
      if (x.region) h -= lensCoverageTerm(table, ct, x.objs, x.region.center, x.region.radius);
    }
  }
  return quantize(h);
}

/** Arc role of every stop of a plan (switched plans read the target template after the switch). */
export function planArcs(plan: Plan): ArcRole[] {
  return plan.stops.map((x, i) => {
    const ct = plan.switch && i > plan.switch.at ? plan.switch.template : plan.template;
    return ct.t.slots[x.slot]?.arc ?? 'build';
  });
}

/** Per stop: does its template treat three stars in a row as the theme (CompiledTemplate.oneKindTheme)? */
export function planKindFree(plan: Plan): boolean[] {
  return plan.stops.map((_, i) => (plan.switch && i > plan.switch.at ? plan.switch.template : plan.template).oneKindTheme);
}

/** h of a plan (recomputes links and geometry). */
export function planHeuristic(table: CandidateTable, plan: Plan): number {
  const objs = plan.stops.map((s) => s.obj);
  const links = planLinks(table, plan);
  const geo = pathGeometry(objs.map((i) => table.prep.objects[i]), plan.center, plan.radius);
  return sequenceHeuristic(table, plan.template, plan.radius, {
    objs, links, hops: geo.hops, turns: geo.turns, arcs: planArcs(plan), kindFree: planKindFree(plan), region: { center: plan.center, radius: plan.radius },
    ...(plan.switch ? { switchAt: plan.switch.at, switchTo: plan.switch.template } : {}),
  });
}

// ───────────────────────────── beam search ─────────────────────────────

export interface SearchOptions {
  /** Inclusive stop-count range wanted from this run (intersected with each template's length). */
  lengthRange: [number, number];
  beamWidth?: number;
  /** Completed candidates kept per (template, patch). */
  keepPerPair?: number;
  /** Global expansion budget before the beam narrows (doc 05 §5.5 safety valve). */
  expansionBudget?: number;
  /**
   * Templates a journey may switch into (spec decision 6). Called with the source template; the result is
   * intersected with its switchRule.to. Absent = no switches.
   */
  switchTargets?: (ct: CompiledTemplate) => readonly CompiledTemplate[];
}

export interface SearchCandidate {
  plan: Plan;
  patch: Patch;
  h: number;
  /** Ordered object ids + template id (+ switch target). */
  key: string;
}

export interface SearchStats {
  pairsTried: number;
  pairsSkipped: number;
  expansions: number;
  completed: number;
  /** Completed candidates that take an archetype switch. */
  switched: number;
}

interface BeamState {
  objs: number[];
  slots: number[];
  links: (Edge | null)[];
  pts: [number, number][];
  hops: number[];
  turns: number[];
  cur: number;
  count: number;
  visited: number;
  path: number;
  backtracks: number;
  challenge: boolean;
  h: number;
  /** Set once the sequence has switched archetype (slots/cur/count/visited then refer to sw.template). */
  sw: PlanSwitch | null;
  arcs: ArcRole[];
  /** Running per-stop sum of h (addStopTerms) before the progression terms. */
  acc: number;
  kindFree: boolean[];
}

const matchCache = new WeakMap<PreparedKb, Map<string, boolean[]>>();
/** slot-match table for one template slot over all KB objects (static per KB). */
function slotMatchRow(prep: PreparedKb, ct: CompiledTemplate, j: number): boolean[] {
  let m = matchCache.get(prep);
  if (!m) { m = new Map(); matchCache.set(prep, m); }
  const key = `${ct.t.id}#${j}`;
  let row = m.get(key);
  if (!row) {
    row = prep.objects.map((o, i) => slotAccepts(ct, j, o, prep.concepts[i]));
    m.set(key, row);
  }
  return row;
}

/** Does a template answer the request's theme (template id, archetype or theme tag; null = any)? */
export const themeMatches = (ct: CompiledTemplate, theme: string | null) =>
  !theme || ct.t.id === theme || ct.t.archetype === theme || ct.t.themeTags.includes(theme);

/**
 * Templates usable for this request: theme filter and the night-level gates (dark sky, Moon limits;
 * candidates.templateNightBlock). `moonIllumination` = brightest Moon while it is up during the journey.
 */
export function selectTemplates(prep: PreparedKb, theme: string | null, sky: number, moonIllumination = 0): CompiledTemplate[] {
  return prep.templates.filter((ct) => themeMatches(ct, theme) && !templateNightBlock(ct.t, sky, moonIllumination));
}

interface Option { tpl: CompiledTemplate; j: number; sw: PlanSwitch | null; entering: boolean; base: { cur: number; count: number; visited: number } }

/** S3 + S4 over all (template × patch) pairs. Deterministic: patches by score, templates by id. */
export function searchJourneys(table: CandidateTable, patches: readonly Patch[], templates: readonly CompiledTemplate[], opts: SearchOptions): { candidates: SearchCandidate[]; stats: SearchStats } {
  const { prep, s } = table;
  const stats: SearchStats = { pairsTried: 0, pairsSkipped: 0, expansions: 0, completed: 0, switched: 0 };
  const budget = opts.expansionBudget ?? 2_000_000;
  const keep = opts.keepPerPair ?? 24;
  const all: SearchCandidate[] = [];
  const bestCache = new Map<string, Map<number, Edge | null>>();
  const nObj = prep.objects.length;
  // Slightly generous (1e-6°) so the exact sepDeg test below still decides every hop near the limit.
  const cosMaxHop = Math.cos(((s.maxHop + 1e-6) * Math.PI) / 180);
  // The hop onto a lens theme's final beat may be longer (candidates.hopLimitInto).
  const cosFinaleHop = Math.cos(((s.maxHop * FINALE_HOP_STRETCH + 1e-6) * Math.PI) / 180);

  for (const patch of patches) {
    const center = { ra: patch.ra, dec: patch.dec };
    const proj = new Map<number, [number, number]>();
    const projOf = (i: number) => {
      let p = proj.get(i);
      if (!p) { p = gnomonic(center, prep.objects[i].ra, prep.objects[i].dec); proj.set(i, p); }
      return p;
    };
    const members = patch.members.filter((i) => table.feasibleMask[i] !== 0);
    const matcherMemo = new Map<string, number[][]>();
    const matchersOf = (tpl: CompiledTemplate) => {
      let m = matcherMemo.get(tpl.t.id);
      if (!m) {
        // A lens theme also drops the stops whose lens look these binoculars cannot honour (a split they cannot make).
        m = tpl.t.slots.map((_, j) => {
          const row = slotMatchRow(prep, tpl, j);
          return members.filter((i) => row[i] && (!tpl.lens || lensVisibleOk(tpl, prep.objects[i], s.magnification)));
        });
        matcherMemo.set(tpl.t.id, m);
      }
      return m;
    };
    for (const ct of templates) {
      // A lens theme never switches, and is never switched into (round 3: one story per journey).
      const targets = ct.lens ? [] : (opts.switchTargets?.(ct) ?? []).filter((x) => x.t.id !== ct.t.id && ct.t.switchRule?.to.includes(x.t.id) && switchableInto(x));
      const lo = Math.max(opts.lengthRange[0], ct.t.length[0]);
      const hi = Math.min(opts.lengthRange[1], table.depth, targets.length ? MAX_STOPS : ct.t.length[1]);
      if (lo > hi) { stats.pairsSkipped++; continue; }
      const matchers = matchersOf(ct);
      if (ct.t.slots.some((sl, j) => !sl.optional && matchers[j].length === 0) || !templateIngredientsMet(prep, members, ct)
        || (ct.lens && matchers.filter((m) => m.length > 0).length < ct.lens.minBeats)) {
        stats.pairsSkipped++;
        continue;
      }
      stats.pairsTried++;
      const width = stats.expansions > budget ? Math.max(6, (opts.beamWidth ?? 24) >> 1) : opts.beamWidth ?? 24;
      // Link lookups are memoised per (template, source-is-hook, target slot) with numeric pair keys: only whether
      // the source slot is the hook changes slotLink's answer (themeLinkOk's direction exemption).
      const linkTable = (tpl: CompiledTemplate, from: number, j: number) => {
        const hook = tpl.t.slots[from]?.arc === 'hook';
        const k = `${tpl.t.id}#${hook ? 'h' : '-'}>${j}`;
        let m = bestCache.get(k);
        if (!m) { m = new Map(); bestCache.set(k, m); }
        return { m, from: hook ? from : -1 };
      };
      const best = (lt: ReturnType<typeof linkTable>, tpl: CompiledTemplate, j: number, a: number, b: number) => {
        const k = a * nObj + b;
        let e = lt.m.get(k);
        if (e === undefined) { e = slotLink(prep, tpl, lt.from, j, a, b); lt.m.set(k, e); }
        return e;
      };
      const switchLink = (sw: PlanSwitch, j: number, a: number, b: number) => {
        const tk = `sw:${ct.t.id}>${sw.template.t.id}#${j}`;
        let m = bestCache.get(tk);
        if (!m) { m = new Map(); bestCache.set(tk, m); }
        let e = m.get(a * nObj + b);
        if (e === undefined) { e = switchLinkOf(prep, sw, j, a, b); m.set(a * nObj + b, e); }
        return e;
      };
      const options = (st: BeamState): Option[] => {
        const out: Option[] = [];
        if (st.sw) {
          const T = st.sw.template;
          if (st.objs.length - st.sw.at < T.t.length[1]) {
            for (const j of nextSlots(T, st.cur, st.count, st.visited)) out.push({ tpl: T, j, sw: st.sw, entering: false, base: st });
          }
          return out;
        }
        if (st.objs.length < ct.t.length[1]) {
          for (const j of nextSlots(ct, st.cur, st.count, st.visited)) out.push({ tpl: ct, j, sw: null, entering: false, base: st });
        }
        const rule = ct.t.switchRule;
        if (rule && targets.length && st.objs.length >= MIN_STOPS && switchArcOk(ct, st.cur) && grammarComplete(ct, st.cur, st.count, st.visited)) {
          for (const T of targets) {
            const entry = switchEntryFor(T);
            if (!entry) continue;
            const sw = compileSwitch(ct, T, st.objs.length - 1);
            if (!sw) continue;
            for (const j of nextSlots(T, entry.cur, entry.count, entry.visited)) out.push({ tpl: T, j, sw, entering: true, base: entry });
          }
        }
        return out;
      };
      const done = new Map<string, SearchCandidate>();
      let beam: BeamState[] = [{ objs: [], slots: [], links: [], pts: [], hops: [], turns: [], cur: -1, count: 0, visited: 0, path: 0, backtracks: 0, challenge: false, h: 0, sw: null, arcs: [], acc: 0, kindFree: [] }];
      for (let depth = 0; depth < hi && beam.length; depth++) {
        const next: BeamState[] = [];
        for (const st of beam) {
          for (const opt of options(st)) {
            const lt = depth > 0 && !opt.entering ? linkTable(opt.tpl, st.slots[depth - 1], opt.j) : null;
            for (const o of matchersOf(opt.tpl)[opt.j]) {
              stats.expansions++;
              if (!(table.feasibleMask[o] & (1 << depth))) continue;
              // Out of reach of the last stop: the cheapest rejection, before any per-pair check.
              if (depth > 0 && prep.cosSep(st.objs[depth - 1], o) < cosFinaleHop) continue;
              if (st.objs.includes(o)) continue;
              // Stops sharing a beat run in the theme's own order (ThemeLens.rank).
              if (opt.tpl.lens && depth > 0 && opt.j === st.cur && !lensRankOk(opt.tpl, prep.objects[st.objs[depth - 1]].id, prep.objects[o].id)) continue;
              const ev = table.stops[o][depth];
              const isChallenge = ev.rating === 2;
              if (isChallenge && (st.challenge || !challengePayoffAllowed(opt.tpl.t.slots[opt.j]))) continue;
              let close = false;
              for (const p of st.objs) if (!prep.graph.pairOk(p, o)) { close = true; break; }
              if (close) continue;
              let link: Edge | null = null, hop = 0, turn = 0, backtracks = st.backtracks;
              const pt = projOf(o);
              if (depth > 0) {
                const last = st.objs[depth - 1];
                // Geometry first: it is cheap, and a link (derived edges) is only worth computing for a reachable hop.
                hop = prep.sepDeg(last, o);
                if (hop > hopLimitInto(opt.tpl, opt.j, s.maxHop) + 1e-9 || st.path + hop > s.maxPath + 1e-9) continue;
                link = opt.entering && opt.sw ? switchLink(opt.sw, opt.j, last, o) : best(lt!, opt.tpl, opt.j, last, o);
                if (!link) continue;
                if (depth > 1) {
                  turn = turnAngleDeg(st.pts[depth - 2], st.pts[depth - 1], pt, st.hops[depth - 2], hop);
                  if (turn > SHARP_TURN_DEG) {
                    if (backtracks >= 1 || !backtrackLinkOk(opt.tpl, link, st.slots[depth - 1], opt.j)) continue;
                    backtracks++;
                  }
                }
              }
              const objs = [...st.objs, o];
              const links = depth > 0 ? [...st.links, link] : [];
              const hops = depth > 0 ? [...st.hops, hop] : [];
              const turns = depth > 1 ? [...st.turns, turn] : [];
              const b = opt.base;
              const cur = opt.j, count = opt.j === b.cur ? b.count + 1 : 1;
              const sw = opt.sw;
              const arcs = [...st.arcs, opt.tpl.t.slots[opt.j].arc];
              const kindFree = [...st.kindFree, opt.tpl.oneKindTheme];
              const acc = addStopTerms(table, patch.radius, { objs, links, hops, turns, arcs, kindFree }, depth, st.acc);
              const ns: BeamState = {
                objs, slots: [...st.slots, opt.j], links, pts: [...st.pts, pt], hops, turns,
                cur, count, visited: b.visited | (1 << opt.j), path: st.path + hop, backtracks,
                challenge: st.challenge || isChallenge,
                acc, h: closeHeuristic(table, ct, { objs, region: { center, radius: patch.radius }, ...(sw ? { switchAt: sw.at, switchTo: sw.template } : {}) }, acc),
                sw, arcs, kindFree,
              };
              next.push(ns);
              const len = objs.length;
              // A lens theme ends on its payoff (positional): a star bright enough, and a challenge stop only on the
              // theme's final or end beat (lensPayoffOk).
              const complete = (!ct.lens || lensPayoffOk(ct, cur, prep.objects[o], ev.rating, { aperture: table.s.aperture, glowMag: ev.maxGlow })) && (sw
                ? len >= lo && len - sw.at <= sw.template.t.length[1] && grammarComplete(sw.template, cur, count, ns.visited) && templateIngredientsMet(prep, objs.slice(0, sw.at + 1), ct)
                : len >= lo && grammarComplete(ct, cur, count, ns.visited) && templateIngredientsMet(prep, objs, ct));
              if (complete) {
                const key = `${ct.t.id}${sw ? `>${sw.template.t.id}@${sw.at}` : ''}|${objs.map((i) => prep.objects[i].id).join('>')}`;
                const prev = done.get(key);
                if (!prev || prev.h < ns.h) {
                  done.set(key, {
                    key, patch, h: ns.h,
                    plan: { template: ct, center, radius: patch.radius, stops: objs.map((obj, k) => ({ obj, slot: ns.slots[k] })), ...(sw ? { switch: sw } : {}) },
                  });
                }
              }
            }
          }
        }
        // Rank, dedupe by (set, last, grammar state), keep the beam width.
        next.sort((a, b) => b.h - a.h || cmpSeq(a.objs, b.objs));
        const seen = new Set<string>();
        beam = [];
        for (const ns of next) {
          const k = `${ns.objs.slice().sort((a, b) => a - b).join(',')}|${ns.objs[ns.objs.length - 1]}|${ns.cur}|${ns.count}|${ns.visited}|${ns.sw ? `${ns.sw.template.t.id}@${ns.sw.at}` : ''}`;
          if (seen.has(k)) continue;
          seen.add(k);
          beam.push(ns);
          if (beam.length >= width) break;
        }
      }
      // Keep the best `keep` per stop count, so a run over a length range finds exactly what a run at each single
      // length would (assemble.ts shares one search between the strict length and the length relaxation).
      const byLength = new Map<number, SearchCandidate[]>();
      for (const c of Array.from(done.values())) {
        const n = c.plan.stops.length;
        const list = byLength.get(n);
        if (list) list.push(c); else byLength.set(n, [c]);
      }
      const finished = Array.from(byLength.keys()).sort((a, b) => a - b)
        .flatMap((n) => byLength.get(n)!.sort((a, b) => b.h - a.h || a.key.localeCompare(b.key)).slice(0, keep));
      stats.completed += finished.length;
      stats.switched += finished.filter((c) => c.plan.switch).length;
      all.push(...finished);
    }
  }
  return { candidates: all, stats };
}

function cmpSeq(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
