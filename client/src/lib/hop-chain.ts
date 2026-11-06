/**
 * Chained star hops (integration r5, WS-B): plan a sequence of stops (a journey, a night, a list) as one hop route.
 *
 * Each leg is planned from the last stop that was reached (planRoutes with `startNodeId`, so a deep-sky stop can
 * start the next leg). Legs longer than MAX_CHAIN_LEG_DEG are not hopped: the observer jumps by eye to the anchor the
 * route planner would choose for that stop and hops from there. A leg whose stop shares the field with the previous
 * stop (≤ 0.8 field) is one synthetic field. A leg that cannot be routed is recorded and the chain continues from the
 * last reached stop. Routed legs are concatenated into one Route like planRoutes waypoints (`hops.slice(1)` when the
 * leg starts on the previous stop's field), and the last field of every leg ends "Stop N reached: <name>.".
 */
import { angularDistance, directionBetween, formatRouteNodeName, hopStepsAlong, classicRouteWorks, legHopBound, planRoutes, routeWithinHopBound, type HopStep, type ObservingParams, type Route, type SkyNode } from "./astronomy";
import type { ChainResult, ChainStop, LegReport, LegStatus } from "./object-links";

/** Legs longer than this (degrees) are not hopped: "Needs a naked-eye jump", then hop from an anchor near the stop. */
export const MAX_CHAIN_LEG_DEG = 20;
/** A stop within this many fields of the previous stop is in the same field (one synthetic hop, no planning). */
export const SAME_FIELD_FOV = 0.8;
/** Brightest start stars the route planner accepts as naked-eye anchors (findAnchors). */
const ANCHOR_MAG = 4.5;

type PlanResult = Awaited<ReturnType<typeof planRoutes>>;

export interface PlanChainOptions {
  /** Abort the remaining legs (a newer chain request, the user left Star hop). */
  signal?: AbortSignal;
  /** Override MAX_CHAIN_LEG_DEG. */
  maxLegDeg?: number;
  /** Plans one leg; defaults to planRoutes (the worker passes its own; tests pass a fake). */
  planLeg?: (params: ObservingParams) => ReturnType<typeof planRoutes>;
  /** Progress callback after each leg. */
  onLeg?: (leg: LegReport) => void;
}

/** Empty result for `stops` (nothing routed). */
export const emptyChain = (stops: ChainStop[]): ChainResult => ({ stops, route: null, nodes: [], targetNode: null, legs: [], stopHopIndex: stops.map(() => -1), coverage: 0 });

const fieldOf = (p: ObservingParams) => (p.fovShape === "rectangle" ? Math.min(p.fovWidth, p.fovHeight) : p.fovWidth);
const abortError = () => (typeof DOMException !== "undefined" ? new DOMException("Chain planning aborted", "AbortError") : Object.assign(new Error("Chain planning aborted"), { name: "AbortError" }));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** Let queued messages (an abort) run between legs; planRoutes itself is synchronous work after its catalog loads. */
const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Leg metrics from one planned route (moves after the starting field). */
function routeMetrics(route: Route, fov: number) {
  const moves = route.hops.slice(1);
  return {
    hops: moves.length,
    maxHopFov: moves.length ? Math.max(...moves.map((h) => h.distanceDeg)) / fov : 0,
    minPatternScore: moves.length ? Math.min(...moves.map((h) => h.patternScore)) : route.hops[0]?.patternScore ?? null,
    routeScore: route.score,
    strategyId: route.isExpertRoute ? "field-guide" : route.strategyId,
    usedExpertRoute: !!route.isExpertRoute,
  };
}
/**
 * The alternative a chain uses: a classic (field guide) route that works — planRoutes offers one only when it is
 * followable tonight and starts where the leg must start (startStarId / startNodeId), and it works when its moves
 * stay within legHopBound without overshooting (classicRouteWorks, the rule planRoutes ranks it first by) — else the best-scoring route
 * within legHopBound of its own start → stop distance, else the one with the fewest fields.
 */
export function pickRoute(routes: Route[], fov: number): Route {
  const within = routes.filter((r) => routeWithinHopBound(r, fov));
  return routes.find((r) => r.isExpertRoute && classicRouteWorks(r, fov)) ?? within[0] ?? routes.reduce((a, b) => (b.hops.length < a.hops.length ? b : a));
}
const failureStatus = (r: PlanResult): LegStatus => (r.belowHorizon ? "below-horizon" : r.anchorUnavailable ? "anchor-unavailable" : !r.targetNode ? "unresolved" : "no-route");
const FAILURE_NOTES: Partial<Record<LegStatus, string>> = {
  "below-horizon": "Below the horizon at this time",
  "anchor-unavailable": "No usable start star near the previous stop",
  unresolved: "Not in the star-hop catalogs",
  "no-route": "No hop route found with this field and star limit",
};
/** A below-horizon leg whose stop is above 5° but hidden by the site's own skyline (ObservingParams.horizon). */
const BEHIND_SKYLINE_NOTE = "Hidden behind the hills at this time";

/** Plan `stops` in order as one chained hop route. `base` supplies site, time, field and difficulty; its targetId/startStarId/waypointIds are ignored. */
export async function planChain(base: ObservingParams, stops: ChainStop[], opts: PlanChainOptions = {}): Promise<ChainResult> {
  const planLeg = opts.planLeg ?? planRoutes, maxLeg = opts.maxLegDeg ?? MAX_CHAIN_LEG_DEG, fov = fieldOf(base);
  const legBase: ObservingParams = { ...base, startStarId: undefined, startNodeId: undefined, startIsWaypoint: undefined, waypointIds: [] };
  const hops: HopStep[] = [], legs: LegReport[] = [], stopHopIndex = stops.map(() => -1);
  /** The chain so far: last reached stop (legs start there), first start star, weakest leg score, sky nodes seen. */
  const at: { last: { node: SkyNode; label: string } | null; anchor: SkyNode | null; score: number; nodes: SkyNode[]; byId: Map<string, SkyNode> } =
    { last: null, anchor: null, score: 100, nodes: [], byId: new Map() };
  const plan = async (p: Partial<ObservingParams>) => {
    const r = await planLeg({ ...legBase, ...p });
    if (r.nodes.length) { at.nodes = r.nodes; at.byId = new Map(r.nodes.map((n) => [n.id, n])); }
    return r;
  };

  for (let i = 0; i < stops.length; i++) {
    if (i > 0) await yieldToEvents();
    if (opts.signal?.aborted) throw abortError();
    const stop = stops[i], n = stop.stop ?? i + 1, t0 = now(), from = at.last;
    const known = at.byId.get(stop.id) ?? null;
    const distance = from && known ? angularDistance(from.node.ra, from.node.dec, known.ra, known.dec) : null;
    const report: LegReport = { leg: i + 1, from: from?.node.id ?? null, to: stop.id, status: "no-route", hops: 0, distanceDeg: distance, maxHopFov: null, minPatternScore: null, routeScore: null, usedExpertRoute: false, ms: 0, ...(stop.getThere ? { journeyGetThere: stop.getThere } : {}) };
    const fail = (r: PlanResult) => { report.status = failureStatus(r); report.note = r.behindTerrain ? BEHIND_SKYLINE_NOTE : FAILURE_NOTES[report.status]; };
    const reached = (node: SkyNode) => {
      const k = hops.length - 1;
      hops[k] = { ...hops[k], instruction: `${hops[k].instruction} Stop ${n} reached: ${stop.label}.` };
      stopHopIndex[i] = k;
      at.last = { node, label: stop.label };
      if (report.distanceDeg === null && from) report.distanceDeg = angularDistance(from.node.ra, from.node.dec, node.ra, node.dec);
    };
    /** Append a planned route: from the previous stop's field (slice(1)) or from a new start field (all hops). */
    const append = (route: Route, continues: boolean, prefix?: string) => {
      const added = (continues && hops.length ? route.hops.slice(1) : route.hops).map((h) => ({ ...h }));
      if (prefix && added.length) added[0] = { ...added[0], instruction: `${prefix} ${added[0].instruction}` };
      at.anchor ??= route.startAnchor;
      at.score = Math.min(at.score, route.score);
      hops.push(...added);
      Object.assign(report, routeMetrics(route, fov));
      // The moves a sensible route of this length takes, from the field the route itself starts on (a jump's anchor).
      report.hopBound = legHopBound(angularDistance(route.hops[0].center.ra, route.hops[0].center.dec, route.target.ra, route.target.dec), fov);
      reached(route.target);
    };
    /** A fresh leg from a naked-eye anchor: the stop's own anchor (the journey's "Find X by eye") when it routes, else the planner's choice. */
    const planFresh = async () => {
      if (stop.startStarId) { const r = await plan({ targetId: stop.id, startStarId: stop.startStarId }); if (r.routes.length) return r; }
      return plan({ targetId: stop.id });
    };
    /** Naked-eye jump: the leg starts on its anchor's field (the stop's own anchor, else the route planner's choice). */
    const jump = async (reason: string) => {
      const r = await planFresh();
      if (!r.routes.length) return fail(r);
      const route = pickRoute(r.routes, fov), anchor = formatRouteNodeName(route.startAnchor);
      append(route, false, `Find ${anchor} by eye, then hop (${reason}).`);
      report.status = "jump";
      report.anchor = anchor;
      report.note = `Needs a naked-eye jump: find ${anchor} by eye, then hop (${reason})`;
    };
    /** The journey says to find this stop itself by eye ("Find Betelgeuse by eye"): one field centred on it, no hops. */
    const eyeLeg = async (): Promise<boolean> => {
      const node = known ?? (await plan({ targetId: stop.id })).targetNode;
      const field = node ? hopStepsAlong([node], at.nodes, legBase)[0] : undefined;
      if (!node || !field) return false;
      hops.push({ ...field, instruction: `Lower the binoculars and find ${stop.label} by eye, then raise them onto it. ${field.instruction}`.trim() });
      Object.assign(report, { status: "jump" as const, hops: 0, anchor: stop.label, distanceDeg: from ? angularDistance(from.node.ra, from.node.dec, node.ra, node.dec) : 0, maxHopFov: 0, minPatternScore: field.patternScore, routeScore: 100 });
      reached(node);
      return true;
    };
    /**
     * The journey's own naked-eye step ("Lower the binoculars and find Mirach by eye, then hop … to the Andromeda
     * Galaxy"): Star hop starts the leg at that anchor too, so the card and the hop agree (hopping on from the previous
     * stop could take a dozen small fields). False when the anchor does not route; the caller then hops on.
     */
    const journeyJump = async (): Promise<boolean> => {
      const r = await plan({ targetId: stop.id, startStarId: stop.startStarId });
      if (!r.routes.length) return false;
      const route = pickRoute(r.routes, fov), anchor = formatRouteNodeName(route.startAnchor);
      append(route, false, `Lower the binoculars and find ${anchor} by eye, then hop.`);
      Object.assign(report, { status: "jump" as const, anchor, distanceDeg: report.distanceDeg ?? angularDistance(route.startAnchor.ra, route.startAnchor.dec, route.target.ra, route.target.dec) });
      return true;
    };

    if (from && known && distance !== null && distance <= SAME_FIELD_FOV * fov) {
      // Same field: one synthetic field centred on the stop, described from the previous stop.
      const step = hopStepsAlong([from.node, known], at.nodes, legBase)[1];
      hops.push({ ...step, instruction: distance < 0.05 ? `${stop.label} is in the same field as ${from.label}.` : `Same field: ${step.instruction}` });
      Object.assign(report, { status: "same-field" as const, hops: 0, maxHopFov: distance / fov, minPatternScore: step.patternScore });
      reached(known);
    } else if (from && stop.byEye && stop.getThere?.mode === "naked-eye-hop" && await eyeLeg()) {
      /* the journey finds this stop by eye */
    } else if (from && stop.startStarId && stop.getThere?.mode === "naked-eye-hop" && await journeyJump()) {
      /* the journey's naked-eye step */
    } else if (from && known && distance !== null && distance > maxLeg) {
      await jump(`${Math.round(distance)}° ${directionBetween(from.node.ra, from.node.dec, known.ra, known.dec)} of ${from.label}`);
    } else if (!from) {
      // First leg (or nothing reached yet): the stop's own naked-eye anchor, else the route planner's choice.
      const r = await planFresh();
      const opener = r.targetNode;
      if (opener && !stop.startStarId && opener.mag <= ANCHOR_MAG && (opener.type === "star" || /^(STAR-|HR\d)/.test(opener.id))) {
        // A naked-eye star opens the chain itself: one field, found by eye (no hop from a neighbour to reach it).
        const first = hopStepsAlong([opener], at.nodes, legBase)[0];
        if (first) {
          hops.push({ ...first, instruction: `Find ${stop.label} by eye and centre it: the first stop. ${first.instruction}`.trim() });
          at.anchor ??= opener;
          Object.assign(report, { status: "ok" as const, hops: 0, distanceDeg: 0, maxHopFov: 0, minPatternScore: first.patternScore, routeScore: 100 });
          reached(opener);
        }
      }
      if (stopHopIndex[i] >= 0) { /* opened by eye */ }
      else if (r.routes.length) {
        const route = pickRoute(r.routes, fov);
        append(route, false);
        report.status = "ok";
        report.anchor = formatRouteNodeName(route.startAnchor);
        report.distanceDeg = angularDistance(route.startAnchor.ra, route.startAnchor.dec, route.target.ra, route.target.dec);
      } else fail(r);
    } else {
      // Hop on from the stop just reached (a deep-sky object can start a leg).
      const r = await plan({ targetId: stop.id, startNodeId: from.node.id });
      if (r.routes.length) { append(pickRoute(r.routes, fov), true); report.status = "ok"; }
      else if (r.belowHorizon || !r.targetNode) fail(r);
      else {
        // Fall back to the brightest naked-eye star beside the previous stop, then to the planner's own anchor.
        const helper = at.nodes.filter((s) => s.type === "star" && s.mag <= ANCHOR_MAG && s.id !== from.node.id && angularDistance(s.ra, s.dec, from.node.ra, from.node.dec) <= 1.5 * fov).sort((a, b) => a.mag - b.mag || angularDistance(a.ra, a.dec, from.node.ra, from.node.dec) - angularDistance(b.ra, b.dec, from.node.ra, from.node.dec))[0];
        const viaHelper = helper ? await plan({ targetId: stop.id, startStarId: helper.id }) : null;
        if (helper && viaHelper?.routes.length) {
          append(pickRoute(viaHelper.routes, fov), false, `From ${from.label}, move to ${formatRouteNodeName(helper)} beside it.`);
          report.status = "ok";
          report.note = `Starts from ${formatRouteNodeName(helper)} beside ${from.label}`;
        } else await jump(`no hop path from ${from.label}`);
      }
    }
    report.ms = Math.round(now() - t0);
    legs.push(report);
    opts.onLeg?.(report);
  }

  const reachedNode = at.last?.node ?? null;
  const route: Route | null = hops.length && at.anchor && reachedNode ? { id: "route-chain", score: at.score, startAnchor: at.anchor, target: reachedNode, hops } : null;
  const routed = stopHopIndex.filter((h) => h >= 0).length;
  return { stops, route, nodes: at.nodes, targetNode: at.byId.get(stops.at(-1)?.id ?? "") ?? reachedNode, legs, stopHopIndex, coverage: stops.length ? routed / stops.length : 0 };
}

// ───────────────────────────── chain navigation (pure, shared by the bar and tests) ─────────────────────────────

/** First field index of each stop's leg (where "go to stop N" lands); -1 when the stop is not reached. */
export function legStartHops(chain: Pick<ChainResult, "stopHopIndex">): number[] {
  let previous = -1;
  return chain.stopHopIndex.map((hop) => {
    if (hop < 0) return -1;
    const start = Math.min(hop, previous + 1);
    previous = hop;
    return start;
  });
}
/** Index of the stop whose leg contains field `step` (the next reached stop at or after it); -1 without reached stops. */
export function stopAtStep(chain: Pick<ChainResult, "stopHopIndex">, step: number): number {
  let lastReached = -1;
  for (let i = 0; i < chain.stopHopIndex.length; i++) {
    const hop = chain.stopHopIndex[i];
    if (hop < 0) continue;
    if (hop >= step) return i;
    lastReached = i;
  }
  return lastReached;
}

export type LegDifficultyLevel = "easy" | "moderate" | "hard" | "jump" | "unroutable";
/** Without a hop bound (older reports), a leg of this many hops counts as hard. */
export const HARD_LEG_HOPS = 5;

/**
 * The one hop-count wording (journey card "Get there", the chain bar, Star hop's route options): "1 hop", "3 hops";
 * a pre-plan estimate reads "one hop", "one or two hops", "about 3 hops".
 */
export function hopCountLabel(hops: number, o: { estimate?: boolean } = {}): string {
  const n = Math.max(0, Math.round(hops));
  if (o.estimate) return n <= 1 ? "one hop" : n === 2 ? "one or two hops" : `about ${n} hops`;
  return n === 1 ? "1 hop" : `${n} hops`;
}

/**
 * Moves Star hop's Guided hopper typically needs for a leg `fields` wide (distance / field), before the leg is planned.
 * Guided hops overlap (≤ 0.7 field each, longer only across a gap in the waypoint catalogue) and seldom run in a
 * straight line, so a leg takes about one move more than its straight-line minimum (calibrated on journey-hopper-audit.test.ts; a stop within SAME_FIELD_FOV is 0).
 */
export function estimateHops(fields: number): number {
  if (!(fields > SAME_FIELD_FOV)) return 0;
  const straight = Math.ceil(fields / 0.7);
  return fields > 1.5 ? straight + 1 : straight;
}

/** Moves of a planned route (its fields after the starting field). */
export const routeHops = (route: Pick<Route, "hops">) => Math.max(0, route.hops.length - 1);

/** A routed leg is hard when it detours past its hop bound (or HARD_LEG_HOPS without one), loses field overlap, or scores weakly. */
function legIsHard(leg: LegReport): boolean {
  const detour = leg.hopBound !== undefined ? leg.hops > leg.hopBound : leg.hops >= HARD_LEG_HOPS;
  return detour || (leg.maxHopFov ?? 0) > 1 || (leg.routeScore ?? 100) < 45;
}

/**
 * The user-facing difficulty line of a leg ("Same field", "2 hops", "9 hops · hard", "By eye to Mirach · 4 hops",
 * "No hop needed" for a naked-eye first stop). Hop counts use hopCountLabel.
 */
export function legDifficulty(leg: LegReport): { label: string; level: LegDifficultyLevel } {
  const hops = hopCountLabel(leg.hops);
  switch (leg.status) {
    case "same-field": return { label: "Same field", level: "easy" };
    case "jump": if (leg.hops === 0) return { label: "No hop needed", level: "easy" };
      return { label: `${leg.anchor ? `By eye to ${leg.anchor}` : "Naked-eye jump"} · ${hops}${legIsHard(leg) ? " · hard" : ""}`, level: "jump" };
    case "ok": {
      if (leg.hops === 0 && !leg.from) return { label: "No hop needed", level: "easy" };
      const hard = legIsHard(leg);
      return { label: hard ? `${hops} · hard` : hops, level: hard ? "hard" : leg.hops >= 3 ? "moderate" : "easy" };
    }
    case "below-horizon": return { label: leg.note === BEHIND_SKYLINE_NOTE ? "Behind the hills" : "Below the horizon", level: "unroutable" };
    case "unresolved": return { label: "Not in the star-hop catalogs", level: "unroutable" };
    case "anchor-unavailable": return { label: "No start star", level: "unroutable" };
    default: return { label: "No hop route", level: "unroutable" };
  }
}
/** Upper bound on the moves of a sensible leg: ceil(distance / (0.7·field)) + 3 (hopper audit; defined beside planRoutes, which ranks classic routes by it). */
export { legHopBound };

/**
 * Star hop's route option names, told apart by what differs: "Via Algol", or for two routes from the same start
 * "Via Algol · past Mirfak" (the first guide star one route passes and the other does not), else "Via Algol · route 2".
 */
export function routeOptionLabels(routes: readonly Pick<Route, "isExpertRoute" | "startAnchor" | "hops">[]): string[] {
  const base = routes.map((r) => (r.isExpertRoute ? "Classic route" : `Via ${formatRouteNodeName(r.startAnchor)}`));
  // The guide star each intermediate field is centred on (the waypoint the route passes).
  const waypoint = (h: HopStep) => h.visibleGuideStars.reduce<{ n: SkyNode | null; d: number }>((best, n) => { const d = angularDistance(n.ra, n.dec, h.center.ra, h.center.dec); return d < best.d ? { n, d } : best; }, { n: null, d: 0.25 }).n;
  const guides = routes.map((r) => r.hops.slice(1, -1).map(waypoint).filter((n): n is SkyNode => !!n));
  return base.map((label, i) => {
    const twins = base.flatMap((other, j) => (other === label && j !== i ? [j] : []));
    if (!twins.length) return label;
    const others = new Set(twins.flatMap((j) => guides[j].map((n) => n.id)));
    const own = guides[i].find((n) => !others.has(n.id) && !!(n.bayer || n.flamsteed || (n.name && !/^HR\s*\d+$/i.test(n.name))));
    return own ? `${label} · past ${formatRouteNodeName(own)}` : `${label} · route ${base.slice(0, i + 1).filter((b) => b === label).length}`;
  });
}
/** A leg the observer finds by eye: a naked-eye first stop, or a stop the journey finds by eye (0 hops). */
const foundByEye = (leg: LegReport) => leg.hops === 0 && (leg.status === "jump" || (leg.status === "ok" && !leg.from));
/** The chain bar's leg line: "Leg 1: find Algol by eye", "Leg 2: Algol → Alpha Persei Cluster (Mel 20)", "Leg 5: Andromeda Galaxy (M31)" (a jump names its anchor in the chip). */
export function legLine(leg: LegReport, stop: Pick<ChainStop, "label">, fromLabel: string): string {
  if (foundByEye(leg)) return `Leg ${leg.leg}: find ${stop.label} by eye`;
  if (leg.status === "jump") return `Leg ${leg.leg}: ${stop.label}`;
  return `Leg ${leg.leg}: ${fromLabel} → ${stop.label}`;
}
/** The difficulty chip beside the leg line; none when the line already says the stop is found by eye (no "by eye" twice). */
export function legChip(leg: LegReport): ReturnType<typeof legDifficulty> | null {
  return foundByEye(leg) ? null : legDifficulty(leg);
}
/** "Stop 3 · Hyades (Mel 25)" when field `step` reaches a stop of the chain, else null (field navigation badge). */
export function chainCheckpoint(chain: Pick<ChainResult, "stops" | "stopHopIndex">, step: number): string | null {
  const i = chain.stopHopIndex.indexOf(step);
  if (i < 0 || step < 0) return null;
  return `Stop ${chain.stops[i].stop ?? i + 1} · ${chain.stops[i].label}`;
}
