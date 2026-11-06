/**
 * Sky Journeys: THE hard-constraint validator (spec decision 4, doc 05 §5.2).
 *
 * Hard constraints are plain code and live only here:
 * - `evaluateStop` decides whether one object can be stop i (altitude for the whole window, clear of the local
 *   skyline when one is known, darkness, Moon distance and moonlight, binocular rating, angular extent, open-sky
 *   direction, journey eligibility). The
 *   candidate table is built from it, so search pruning and validation share one definition.
 * - `journeyViolations` checks a whole plan: per-stop feasibility at its position, at most one challenge stop
 *   (never stop 1 or 2, never the payoff except on a lens theme's final or end beat), duplicates / same-view stops
 *   (StoryGraph.pairOk), the region cap, hop and path limits, sharp turns and reversals (one back-track, only on a
 *   link of strength ≥ 0.85 or, in a lens theme, a step to a later beat), story links (slot inEdges, on-theme
 *   facts), the template grammar and ingredients (a lens theme: beat order, lens rank within a beat, no switch),
 *   and the archetype's night gates (dark sky, Moon limits).
 * The learned scorer only ranks plans that passed (doc 05 D2).
 */
import {
  BACKTRACK_MIN_STRENGTH, MIN_EDGE_STRENGTH, MIN_STOPS, MAX_STOPS, extentOk, glowLimitFor, hourAngle,
  lowerCulminationAlt, moonDuring, moonMinSeparation, sunLimitFor, type EngineSettings, type NightGrid, type ObjectTrack, type Rater,
} from './conditions';
import {
  backtrackLinkOk, challengePayoffAllowed, hopLimitInto, isSceneObject, lensPayoffOk, lensRankOk, lensStepOk, lensVisibleOk, slotAccepts, switchArcOk, switchEntryFor,
  templateIngredientsMet, themeLinkOk, type PreparedKb, slotLink, slotSequenceValid, templateNightBlock, type CandidateTable, type CompiledTemplate,
} from './candidates';
import { compass8, pathGeometry, type RaDec } from './region';
import type { ArcRole, Edge, EdgeType, FactKey, KbObject, RejectReason } from './types';

export interface StopEval {
  ok: boolean;
  reasons: RejectReason[];
  /** Lowest altitude over the covering interval (incl. a lower culmination inside it). */
  minAlt: number;
  altStart: number;
  azStart: number;
  maxGlow: number;
  /** Smallest Moon separation while the Moon is up (null: Moon down throughout). */
  minMoonSep: number | null;
  maxSunAlt: number;
  /** binocular rating 0..3, or −1 when not evaluated (another constraint already failed). */
  rating: number;
}

/** Can object `o` be stop index `i`? Conservative over the stop's covering interval. */
export function evaluateStop(o: KbObject, tr: ObjectTrack, grid: NightGrid, i: number, s: EngineSettings, rate: Rater, eligible: boolean): StopEval {
  const iv = grid.intervals[i];
  const ks = iv.samples;
  let minAlt = Infinity, maxGlow = 0, maxSun = -90, minSep: number | null = null, glowK = -1;
  let moonTooClose = false, dirBad = false, behind = false;
  const sky = tr.skyline;
  for (const k of ks) {
    minAlt = Math.min(minAlt, tr.alt[k]);
    // Behind the skyline while above the altitude floor: the hills, not the height, hide it (alt ≥ max(minAlt, skyline)).
    if (sky && tr.alt[k] < sky[k] && tr.alt[k] >= s.minAlt) behind = true;
    maxSun = Math.max(maxSun, grid.sunAlt[k]);
    if (grid.moonUp[k]) {
      const sep = tr.moonSep[k];
      minSep = minSep === null ? sep : Math.min(minSep, sep);
      if (sep < moonMinSeparation(grid.moon[k].illumination)) moonTooClose = true;
      if (tr.glow[k] >= maxGlow) { maxGlow = tr.glow[k]; glowK = k; }
    }
    if (s.openDirections && !s.openDirections.has(compass8(tr.az[k]))) dirBad = true;
  }
  // A lower culmination inside the interval is the true minimum (hour angle wraps through ±180°).
  const ha0 = hourAngle(tr.raDate, s.lon, grid.gastDeg[ks[0]]);
  const ha1 = hourAngle(tr.raDate, s.lon, grid.gastDeg[ks[ks.length - 1]]);
  if (ha0 > 90 && ha1 < -90) {
    const low = lowerCulminationAlt(tr.decDate, s.lat);
    minAlt = Math.min(minAlt, low);
    // Lower culmination happens due north (south of the equator: due south).
    if (sky && s.skyline && low >= s.minAlt && low < s.skyline(s.lat >= 0 ? 0 : 180)) behind = true;
  }

  const reasons: RejectReason[] = [];
  if (!eligible) reasons.push('not-eligible');
  if (minAlt < s.minAlt) reasons.push('altitude');
  if (behind) reasons.push('terrain');
  if (maxSun > sunLimitFor(o)) reasons.push('twilight');
  if (moonTooClose) reasons.push('moon-separation');
  if (maxGlow > glowLimitFor(o)) reasons.push('moon-glow');
  if (!extentOk(o, s.fovDeg)) reasons.push('extent');
  if (dirBad) reasons.push('direction');
  let rating = -1;
  if (!reasons.length) {
    const moonK = glowK >= 0 ? glowK : ks[0];
    rating = rate(o, minAlt, grid.moon[moonK], glowK >= 0 ? Math.round(maxGlow * 10) : -1);
    if (rating >= 3 || (rating === 2 && (i < 2 || !s.includeChallenge))) reasons.push('binocular-rating');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    minAlt,
    altStart: tr.alt[ks[0]],
    azStart: tr.az[ks[0]],
    maxGlow,
    minMoonSep: minSep,
    maxSunAlt: maxSun,
    rating,
  };
}

// ───────────────────────────── whole-journey validation ─────────────────────────────

export interface PlanStop {
  obj: number;
  slot: number;
}

/**
 * The one archetype switch (spec decision 6). Stop `at` filled the source template's `atArc` slot and also stands
 * for the target's hook; stops after it use `template`'s slots (from its first build slot on). The link
 * at → at+1 must be one of `via` with strength ≥ `minStrength`.
 */
export interface PlanSwitch {
  at: number;
  template: CompiledTemplate;
  atArc: ArcRole;
  via: ReadonlySet<EdgeType>;
  minStrength: number;
}

export interface Plan {
  template: CompiledTemplate;
  /** Cap centre and radius of the patch the plan was built in. */
  center: RaDec;
  radius: number;
  stops: PlanStop[];
  /** Present when the journey changes archetype once. */
  switch?: PlanSwitch;
}

/** Compiled switch rule of `ct` into `target` (null when `ct` has no rule naming it). */
export function compileSwitch(ct: CompiledTemplate, target: CompiledTemplate, at: number): PlanSwitch | null {
  const r = ct.t.switchRule;
  if (!r || !r.to.includes(target.t.id)) return null;
  return { at, template: target, atArc: r.atArc, via: new Set(r.via.filter((e) => e !== 'NEIGHBOR')), minStrength: Math.max(MIN_EDGE_STRENGTH, r.minStrength) };
}

/**
 * The switch link from the switch stop `a` into the target's slot j at `b`: one of the rule's `via` types at
 * ≥ minStrength, and on the TARGET's theme (themeLinkOk): the new question continues its own progression from
 * the switch stop (after the farthest globular, a time machine does not step back to a star 6 light-years away).
 */
export function switchLinkOf(prep: PreparedKb, sw: PlanSwitch, j: number, a: number, b: number): Edge | null {
  const T = sw.template, arc = T.t.slots[j]?.arc ?? 'build';
  const A = prep.objects[a], B = prep.objects[b];
  // Into a lens theme the beats carry the order; only a distance ladder's climb still applies to the link.
  if (T.lens) return lensStepOk(T, A, B) ? prep.graph.best(a, b, sw.via, sw.minStrength) : null;
  return prep.graph.best(a, b, sw.via, sw.minStrength, (e) => themeLinkOk(T, null, arc, e, A, B, prep.concepts[a], prep.concepts[b]));
}

/** Last stop index of the theme part stop `i` belongs to (the switch stop closes the first part). */
export function partEnd(plan: Pick<Plan, 'stops' | 'switch'>, i: number): number {
  return plan.switch && i <= plan.switch.at ? plan.switch.at : plan.stops.length - 1;
}

/** Template whose slot grammar stop i follows. */
export const stopTemplate = (plan: Plan, i: number): CompiledTemplate => (plan.switch && i > plan.switch.at ? plan.switch.template : plan.template);

export interface Violation {
  code: RejectReason;
  stop?: number;
  detail: string;
}

/** Link used from stop k to stop k+1 (the switch link must ride the rule's `via` types at ≥ minStrength). */
export function linkAt(table: CandidateTable, plan: Plan, k: number): Edge | null {
  const a = plan.stops[k].obj, b = plan.stops[k + 1].obj;
  if (plan.switch && k === plan.switch.at) return switchLinkOf(table.prep, plan.switch, plan.stops[k + 1].slot, a, b);
  // Right after a switch (k = at + 1 … ) both stops follow the target template; the source slot of stop `at` belongs
  // to the first template, so it is passed only when stop k uses the same template as stop k + 1.
  const tpl = stopTemplate(plan, k + 1);
  return slotLink(table.prep, tpl, stopTemplate(plan, k) === tpl ? plan.stops[k].slot : -1, plan.stops[k + 1].slot, a, b);
}

/** Links actually used between consecutive stops (null when no allowed link exists). */
export function planLinks(table: CandidateTable, plan: Plan): (Edge | null)[] {
  return plan.stops.slice(1).map((_, k) => linkAt(table, plan, k));
}

/** Every hard-constraint violation of a plan (empty = valid). */
export function journeyViolations(table: CandidateTable, plan: Plan): Violation[] {
  const v: Violation[] = [];
  const { prep, s } = table;
  const n = plan.stops.length;
  const ct = plan.template;
  const sw = plan.switch;
  if (n < MIN_STOPS || n > MAX_STOPS) v.push({ code: 'story', detail: `length ${n} outside 3..10` });
  if (!sw && (n < ct.t.length[0] || n > ct.t.length[1])) v.push({ code: 'story', detail: `length ${n} outside template ${ct.t.id} ${ct.t.length.join('..')}` });
  if (sw) {
    const first = sw.at + 1, second = n - sw.at;
    if (sw.at < 0 || sw.at >= n - 1) v.push({ code: 'story', detail: `switch at ${sw.at} outside the journey` });
    if (n < ct.t.length[0] || first > ct.t.length[1]) v.push({ code: 'story', detail: `length ${n} (first theme ${first}) outside template ${ct.t.id} ${ct.t.length.join('..')}` });
    if (second > sw.template.t.length[1]) v.push({ code: 'story', detail: `second theme ${second} stops > ${sw.template.t.id} max ${sw.template.t.length[1]}` });
    if (!ct.t.switchRule?.to.includes(sw.template.t.id)) v.push({ code: 'story', detail: `${ct.t.id} may not switch to ${sw.template.t.id}` });
    // A lens theme tells one story: it never switches and is never switched into (round 3).
    if (ct.lens || sw.template.lens) v.push({ code: 'story', detail: `a theme told through a lens never switches (${ct.t.id} → ${sw.template.t.id})` });
  }
  if (n > table.depth) { v.push({ code: 'story', detail: `length ${n} beyond evaluated depth ${table.depth}` }); return v; }
  const moon = moonDuring(table.grid, n);
  for (const t of sw ? [ct, sw.template] : [ct]) {
    const block = templateNightBlock(t.t, s.sky, moon);
    if (block) v.push({ code: block === 'moon-bright' ? 'moon-glow' : 'story', detail: `${t.t.id} cannot run tonight (${block})` });
  }

  // Per-stop feasibility at its position.
  let challenges = 0;
  plan.stops.forEach((st, i) => {
    const ev = table.stops[st.obj][i];
    if (!ev.ok) v.push({ code: ev.reasons[0] ?? 'altitude', stop: i, detail: `${prep.objects[st.obj].id} not feasible as stop ${i}: ${ev.reasons.join(', ')}` });
    const tpl = stopTemplate(plan, i);
    const slot = tpl.t.slots[st.slot];
    if (ev.rating === 2) {
      challenges++;
      if (slot && !tpl.lens && !challengePayoffAllowed(slot)) v.push({ code: 'binocular-rating', stop: i, detail: `challenge stop ${prep.objects[st.obj].id} as the payoff` });
    }
    if (tpl.lens && !lensVisibleOk(tpl, prep.objects[st.obj], s.magnification)) {
      v.push({ code: 'binocular-rating', stop: i, detail: `${prep.objects[st.obj].id}: these binoculars do not split the pair its ${tpl.t.id} card promises` });
    }
    // A lens theme's payoff is its last stop: a naked-eye star, and a challenge only on the final or an end beat.
    if (tpl.lens && i === partEnd(plan, i) && !lensPayoffOk(tpl, st.slot, prep.objects[st.obj], ev.rating, { aperture: s.aperture, glowMag: ev.maxGlow })) {
      v.push({ code: ev.rating === 2 ? 'binocular-rating' : 'story', stop: i, detail: `${prep.objects[st.obj].id} cannot close the ${tpl.t.id} story (challenge off its final beat, or a faint star)` });
    }
    // Stops sharing a beat follow the theme's own order (ThemeLens.rank).
    if (tpl.lens && i > 0 && stopTemplate(plan, i - 1) === tpl && plan.stops[i - 1].slot === st.slot
      && !lensRankOk(tpl, prep.objects[plan.stops[i - 1].obj].id, prep.objects[st.obj].id)) {
      v.push({ code: 'story', stop: i, detail: `${prep.objects[st.obj].id} comes before ${prep.objects[plan.stops[i - 1].obj].id} in the ${tpl.t.id} order of its beat (lens rank)` });
    }
    if (!slot || !slotAccepts(tpl, st.slot, prep.objects[st.obj], prep.concepts[st.obj])) v.push({ code: 'story', stop: i, detail: `${prep.objects[st.obj].id} does not match slot ${st.slot}` });
  });
  if (challenges > 1) v.push({ code: 'binocular-rating', detail: `${challenges} challenge stops (max 1)` });
  const firstSeg = sw ? plan.stops.slice(0, sw.at + 1) : plan.stops;
  if (!slotSequenceValid(ct, firstSeg.map((x) => x.slot))) v.push({ code: 'story', detail: 'slot order breaks the template grammar' });
  if (sw) {
    const atStop = plan.stops[sw.at];
    const entry = atStop ? switchEntryFor(sw.template) : null;
    if (!atStop || !switchArcOk(ct, atStop.slot) || ct.t.switchRule?.atArc !== sw.atArc) v.push({ code: 'story', stop: sw.at, detail: `switch stop does not fill the ${sw.atArc} slot` });
    if (!entry || !slotSequenceValid(sw.template, plan.stops.slice(sw.at + 1).map((x) => x.slot), entry)) v.push({ code: 'story', detail: `second theme breaks the ${sw.template.t.id} grammar` });
  }
  if (!templateIngredientsMet(prep, firstSeg.map((x) => x.obj), ct)) v.push({ code: 'story', detail: `missing ${ct.t.id} ingredients (doc 04 §3.1)` });
  // A numeric progression ends at its climax: the payoff of a thermometer is the hottest star of the night, the
  // payoff of a families story the oldest family (review panel, A/B round 1: a twist back to Betelgeuse let a
  // 12,000 K Rigel close a thermometer that had already visited 29,000 K Alnitak).
  const prog = ct.t.progression;
  if (!sw && !ct.lens && prog && prog.property !== 'evoStage' && prog.direction !== 'arc') {
    const pi = plan.stops.findIndex((st) => ct.t.slots[st.slot]?.arc === 'payoff');
    const key = prog.property as FactKey;
    const val = (k: number) => prep.objects[plan.stops[k].obj].facts[key]?.value;
    const pv = pi > 0 ? val(pi) : undefined;
    if (pv !== undefined) {
      for (let k = 0; k < pi; k++) {
        if (k === 0 && isSceneObject(prep.objects[plan.stops[k].obj])) continue;
        const x = val(k);
        if (x !== undefined && (prog.direction === 'up' ? x > pv : x < pv)) {
          v.push({ code: 'story', stop: pi, detail: `payoff ${prep.objects[plan.stops[pi].obj].id} is not the ${prog.property} extreme (stop ${k} goes further)` });
          break;
        }
      }
    }
  }

  // Duplicates and near-duplicates.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = plan.stops[i].obj, b = plan.stops[j].obj;
      if (a === b) v.push({ code: 'geometry', stop: j, detail: `duplicate ${prep.objects[a].id}` });
      else if (!prep.graph.pairOk(a, b)) {
        v.push({ code: 'geometry', stop: j, detail: `${prep.objects[a].id} and ${prep.objects[b].id} share one binocular view without a curated comparison` });
      }
    }
  }

  // Region and path.
  const coords = plan.stops.map((st) => prep.objects[st.obj]);
  const geo = pathGeometry(coords, plan.center, plan.radius);
  if (geo.maxFromCenter > plan.radius + 1e-9) v.push({ code: 'region', detail: `stop ${geo.maxFromCenter.toFixed(1)}° from cap centre (R ${plan.radius}°)` });
  geo.hops.forEach((h, k) => {
    const limit = hopLimitInto(stopTemplate(plan, k + 1), plan.stops[k + 1].slot, s.maxHop);
    if (h > limit + 1e-9) v.push({ code: 'geometry', stop: k + 1, detail: `hop ${h.toFixed(1)}° > ${limit}°` });
  });
  if (geo.pathDeg > s.maxPath + 1e-9) v.push({ code: 'geometry', detail: `path ${geo.pathDeg.toFixed(1)}° > ${s.maxPath}°` });
  if (geo.sharpTurns > 1) v.push({ code: 'geometry', detail: `${geo.sharpTurns} sharp turns (max 1)` });
  if (geo.reversals > 1) v.push({ code: 'geometry', detail: `${geo.reversals} reversals (max 1)` });
  if (geo.backtrackHops.length > 1) v.push({ code: 'geometry', detail: `${geo.backtrackHops.length} back-tracks (max 1)` });

  // Story links; a back-track must ride a strong link.
  const links = planLinks(table, plan);
  links.forEach((e, k) => {
    if (!e) v.push({ code: 'story', stop: k + 1, detail: `no allowed link ${prep.objects[plan.stops[k].obj].id} → ${prep.objects[plan.stops[k + 1].obj].id}` });
  });
  // (In a lens theme the storyline carries a back-track that moves on to a later beat: candidates.backtrackLinkOk.)
  for (const k of geo.backtrackHops) {
    const e = links[k];
    const tpl = stopTemplate(plan, k + 1);
    const sameTpl = stopTemplate(plan, k) === tpl;
    if (e && !backtrackLinkOk(tpl, e, sameTpl ? plan.stops[k].slot : Infinity, plan.stops[k + 1].slot)) {
      v.push({ code: 'geometry', stop: k + 1, detail: `back-track on a link of strength ${e.strength} (< ${BACKTRACK_MIN_STRENGTH})` });
    }
  }
  return v;
}
