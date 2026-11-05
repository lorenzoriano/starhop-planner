/**
 * Sky Journeys S5: exact re-ordering and validation (doc 05 §5.6).
 *
 * Story order and geometric order conflict. For each candidate stop set (n ≤ 10) a Held–Karp DP over
 * (visited mask, last stop) finds the best order that respects:
 * - the template grammar (slot runs contiguous, slot ranks non-decreasing, lower-rank slots first; in a lens theme
 *   the stops of one beat follow ThemeLens.rank);
 * - per-position time windows (stop time depends only on its index, so the windows are exact in the DP);
 * - an allowed story link between consecutive stops and the hop limit.
 * The DP objective is the order-dependent part of h (node terms at their positions + link strength − hop);
 * turn, variety and progression terms are then scored exactly with `planHeuristic`. One pass of Or-opt
 * (move one stop) follows. The best order that passes `journeyViolations` wins; none valid ⇒ dropped.
 * Plans with an archetype switch keep their beam order (validated, not re-ordered).
 */
import { hopLimitInto, lensRankOk, slotLink, type CandidateTable } from './candidates';
import { CHALLENGE_BONUS, WEAK_LINK_PENALTY, isWeakDerivedLink, planHeuristic } from './search';
import { journeyViolations, type Plan, type Violation } from './validate';

export interface OrderResult {
  plan: Plan;
  h: number;
}

/** Order-dependent node value of object idx at position pos (same weights as sequenceHeuristic). */
function nodeValue(table: CandidateTable, idx: number, pos: number): number {
  const o = table.prep.objects[idx];
  const ev = table.stops[idx][pos];
  let v = -(0.8 * ev.maxGlow) / 0.7 - (0.6 * Math.max(0, 45 - ev.minAlt)) / 15;
  if (pos === 0 && o.showpiece) v += 0.3;
  if (ev.rating === 2) v += CHALLENGE_BONUS;
  return v;
}

interface OrderModel {
  n: number;
  /** May stop k open the journey? */
  canStart: (k: number) => boolean;
  /** May stop k follow `last` at position pos, given the already-placed mask? */
  canStep: (mask: number, last: number, k: number, pos: number) => boolean;
  node: (k: number, pos: number) => number;
  link: (a: number, b: number) => number;
}

/** Constraints + objective of the order DP for one candidate set (shared by Held–Karp and its tests). */
function orderModel(table: CandidateTable, plan: Plan): OrderModel {
  const n = plan.stops.length;
  const { prep, s } = table;
  const ct = plan.template;
  const objs = plan.stops.map((x) => x.obj);
  const slots = plan.stops.map((x) => x.slot);
  const rank = slots.map((j) => ct.ranks[j]);
  const slotMask = new Map<number, number>();
  slots.forEach((j, k) => slotMask.set(j, (slotMask.get(j) ?? 0) | (1 << k)));
  const lowerRankMask = rank.map((r) => rank.reduce((m, rr, k) => (rr < r ? m | (1 << k) : m), 0));
  const minRank = Math.min(...rank);
  const strength: number[][] = [], hop: number[][] = [], weak: number[][] = [];
  for (let a = 0; a < n; a++) {
    strength.push([]); hop.push([]); weak.push([]);
    for (let b = 0; b < n; b++) {
      // The link a→b depends on both slots (TemplateSlot.inEdges, on-theme facts and direction), not on the order.
      const e = a === b ? null : slotLink(prep, ct, slots[a], slots[b], objs[a], objs[b]);
      strength[a].push(e ? e.strength : -1);
      weak[a].push(isWeakDerivedLink(e) ? WEAK_LINK_PENALTY : 0);
      hop[a].push(prep.sepDeg(objs[a], objs[b]));
    }
  }
  const feasible = (k: number, pos: number) => pos < table.depth && (table.feasibleMask[objs[k]] & (1 << pos)) !== 0;
  return {
    n,
    canStart: (k) => rank[k] === minRank && feasible(k, 0),
    canStep: (mask, last, k, pos) => {
      if (mask & (1 << k)) return false;
      if (strength[last][k] < 0 || hop[last][k] > hopLimitInto(ct, slots[k], s.maxHop) + 1e-9 || !feasible(k, pos)) return false;
      if (slots[k] === slots[last] && ct.lens && !lensRankOk(ct, prep.objects[objs[last]].id, prep.objects[objs[k]].id)) return false;
      if (slots[k] !== slots[last]) {
        const run = slotMask.get(slots[last])!;
        if ((run & mask) !== run) return false; // the current slot run must be finished
        if ((slotMask.get(slots[k])! & mask) !== 0) return false; // a slot run cannot restart
        if (rank[k] < rank[last]) return false;
        if ((lowerRankMask[k] & mask) !== lowerRankMask[k]) return false; // lower-rank slots come first
      }
      return true;
    },
    node: (k, pos) => nodeValue(table, objs[k], pos),
    link: (a, b) => 0.8 * strength[a][b] - weak[a][b] - (0.6 * hop[a][b]) / plan.radius,
  };
}

/** DP objective of one order (indices into plan.stops), or −Infinity if the order breaks a DP constraint. */
export function orderObjective(table: CandidateTable, plan: Plan, order: readonly number[]): number {
  return objectiveOf(orderModel(table, plan), order);
}

function objectiveOf(m: OrderModel, order: readonly number[]): number {
  if (order.length !== m.n || !m.canStart(order[0])) return -Infinity;
  let mask = 1 << order[0], val = m.node(order[0], 0);
  for (let pos = 1; pos < order.length; pos++) {
    const last = order[pos - 1], k = order[pos];
    if (!m.canStep(mask, last, k, pos)) return -Infinity;
    val += m.node(k, pos) + m.link(last, k);
    mask |= 1 << k;
  }
  return val;
}

/** Held–Karp over the plan's stops; returns the best grammar-respecting order or null. */
export function heldKarpOrder(table: CandidateTable, plan: Plan): Plan | null {
  const n = plan.stops.length;
  if (n === 0 || n > table.depth) return null;
  const m = orderModel(table, plan);
  const size = 1 << n;
  const best = new Float64Array(size * n).fill(-Infinity);
  const parent = new Int16Array(size * n).fill(-1);
  for (let k = 0; k < n; k++) if (m.canStart(k)) best[(1 << k) * n + k] = m.node(k, 0);
  const popcount = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  for (let mask = 1; mask < size; mask++) {
    const pos = popcount(mask);
    if (pos >= n) continue;
    for (let last = 0; last < n; last++) {
      const cur = best[mask * n + last];
      if (cur === -Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (!m.canStep(mask, last, k, pos)) continue;
        const val = cur + m.node(k, pos) + m.link(last, k);
        const idx = (mask | (1 << k)) * n + k;
        if (val > best[idx] + 1e-12) { best[idx] = val; parent[idx] = last; }
      }
    }
  }
  const full = size - 1;
  let end = -1, endVal = -Infinity;
  for (let k = 0; k < n; k++) if (best[full * n + k] > endVal + 1e-12) { endVal = best[full * n + k]; end = k; }
  if (end < 0) return null;
  const order: number[] = [];
  let mask = full, k = end;
  while (k >= 0) {
    order.push(k);
    const p = parent[mask * n + k];
    mask &= ~(1 << k);
    k = p;
  }
  order.reverse();
  if (order.length !== n) return null;
  return { ...plan, stops: order.map((i) => plan.stops[i]) };
}

/** Move one stop to another position (single best-improvement pass). */
export function orOpt(table: CandidateTable, plan: Plan, h: number): OrderResult {
  let best: OrderResult = { plan, h };
  const n = plan.stops.length;
  // The DP constraints (grammar, time windows, links, hop limit) are necessary conditions of journeyViolations,
  // so a move the DP model rejects is skipped without the full validation.
  const m = orderModel(table, plan);
  const idx = plan.stops.map((_, k) => k);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const order = idx.slice();
      const [mk] = order.splice(i, 1);
      order.splice(j, 0, mk);
      if (objectiveOf(m, order) === -Infinity) continue;
      const stops = plan.stops.slice();
      const [moved] = stops.splice(i, 1);
      stops.splice(j, 0, moved); // `moved` ends at position j
      const cand: Plan = { ...plan, stops };
      if (journeyViolations(table, cand).length) continue;
      const hh = planHeuristic(table, cand);
      if (hh > best.h + 1e-9) best = { plan: cand, h: hh };
    }
  }
  return best;
}

/**
 * Best valid order of a candidate set: beam order vs Held–Karp order, then Or-opt.
 * Returns null (with the beam order's violations) when no order passes the validator.
 */
export function reorderAndValidate(table: CandidateTable, plan: Plan, opts: { exact?: boolean } = {}): { result: OrderResult | null; violations: Violation[] } {
  const options: OrderResult[] = [];
  const beamViolations = journeyViolations(table, plan);
  if (!beamViolations.length) options.push({ plan, h: planHeuristic(table, plan) });
  // A switched plan is two grammars glued at the switch stop; its beam order is kept as found (the DP and
  // Or-opt model one template). It is still validated like every other plan.
  if (plan.switch) return beamViolations.length ? { result: null, violations: beamViolations } : { result: options[0], violations: [] };
  if (opts.exact !== false) {
    const hk = heldKarpOrder(table, plan);
    if (hk && !journeyViolations(table, hk).length) options.push({ plan: hk, h: planHeuristic(table, hk) });
  }
  if (!options.length) return { result: null, violations: beamViolations };
  options.sort((a, b) => b.h - a.h);
  const improved = opts.exact !== false ? orOpt(table, options[0].plan, options[0].h) : options[0];
  return { result: improved, violations: [] };
}
