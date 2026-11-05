import { describe, expect, it } from "vitest";
import { angularDistance, type HopStep, type ObservingParams, type Route, type SkyNode, type planRoutes } from "../astronomy";
import { chainCheckpoint, emptyChain, estimateHops, hopCountLabel, legChip, legDifficulty, legLine, legHopBound, legStartHops, MAX_CHAIN_LEG_DEG, planChain, routeOptionLabels, stopAtStep } from "../hop-chain";
import type { ChainStop, LegReport } from "../object-links";

// A strip of sky along the celestial equator: guide stars every 1.5°, deep-sky stops at chosen right ascensions.
const node = (id: string, ra: number, extra: Partial<SkyNode> = {}): SkyNode => ({ id, ra, dec: 0, alt: 50, az: 180, mag: 3, name: id, type: "star", ...extra });
const STARS = Array.from({ length: 50 }, (_, i) => node(`HR${100 + i}`, i * 1.5, { mag: 3 + (i % 3) }));
const DSO = (id: string, ra: number) => node(id, ra, { type: "binocular", mag: 6, name: `Object ${id}` });
const SKY: SkyNode[] = [...STARS, DSO("A", 10), DSO("B", 15.2), DSO("C", 16), DSO("D", 50), DSO("FAIL", 20), DSO("NEAR", 18)];
const base: ObservingParams = { lat: 0, lon: 0, date: new Date("2026-11-04T05:30:00Z"), fovWidth: 5, fovHeight: 5, fovShape: "circle", limitingMag: 6.5, numRoutes: 3, targetId: "IGNORED", observingMode: "binocular", difficulty: "beginner", startStarId: "HR999", waypointIds: ["HR1"] };
const stop = (id: string, i: number): ChainStop => ({ id, label: `Label ${id}`, stop: i + 1 });

const hopAt = (n: SkyNode, prev: SkyNode | null): HopStep => ({
  center: { ra: n.ra, dec: n.dec, alt: n.alt, az: n.az }, visibleGuideStars: [], pattern: "p", patternType: "field", patternConfidence: .5, patternScore: 60,
  patternAnchors: [], patternLabels: [], direction: "E", distanceDeg: prev ? angularDistance(prev.ra, prev.dec, n.ra, n.dec) : 0, instruction: `Field at ${n.id}.`,
});
type Result = Awaited<ReturnType<typeof planRoutes>>;
/** Fake planner: straight hops of ≤ 3° from the start (startNodeId / startStarId / a star 4° west of the target). */
function fakePlanner() {
  const calls: ObservingParams[] = [];
  const planLeg = async (p: ObservingParams): Promise<Result> => {
    calls.push(p);
    if (p.targetId === "LOW") return { routes: [], nodes: SKY, targetNode: null, belowHorizon: true };
    const target = SKY.find((n) => n.id === p.targetId) ?? null;
    if (!target) return { routes: [], nodes: SKY, targetNode: null, belowHorizon: false };
    if (target.id === "FAIL") return { routes: [], nodes: SKY, targetNode: target, belowHorizon: false };
    const start = p.startNodeId ? SKY.find((n) => n.id === p.startNodeId)! : p.startStarId ? SKY.find((n) => n.id === p.startStarId)! : STARS.reduce((a, b) => (Math.abs(b.ra - (target.ra - 4)) < Math.abs(a.ra - (target.ra - 4)) ? b : a));
    const path: SkyNode[] = [start];
    for (let ra = start.ra + 3; ra < target.ra; ra += 3) path.push(node(`P${ra}`, ra));
    path.push(target);
    const hops = path.map((n, i) => hopAt(n, i ? path[i - 1] : null));
    const route: Route = { id: "route-1", score: 80 - hops.length, startAnchor: start, target, hops, strategyId: "landmark-discount" };
    return { routes: [route], nodes: SKY, targetNode: target, belowHorizon: false };
  };
  return { calls, planLeg };
}

describe("planChain", () => {
  it("plans legs in order from the last reached stop and concatenates them like planRoutes waypoints", async () => {
    const { calls, planLeg } = fakePlanner();
    const chain = await planChain(base, [stop("A", 0), stop("B", 1)], { planLeg });
    expect(calls.map((c) => [c.targetId, c.startNodeId, c.startStarId, c.waypointIds])).toEqual([["A", undefined, undefined, []], ["B", "A", undefined, []]]);
    const [leg1, leg2] = chain.legs;
    expect(leg1).toMatchObject({ leg: 1, from: null, to: "A", status: "ok", usedExpertRoute: false, strategyId: "landmark-discount" });
    expect(leg2).toMatchObject({ leg: 2, from: "A", to: "B", status: "ok", hops: 2 });
    expect(leg2.distanceDeg).toBeCloseTo(5.2, 5);
    expect(leg2.maxHopFov).toBeCloseTo(3 / 5, 5);
    // Leg 2 starts on A's field, which is already the last field of leg 1: hops.slice(1).
    const route = chain.route!;
    expect(route.hops.map((h) => h.center.ra)).toEqual([6, 9, 10, 13, 15.2]);
    expect(chain.stopHopIndex).toEqual([2, 4]);
    expect(route.hops[2].instruction).toMatch(/^Field at A\. Stop 1 reached: Label A\.$/);
    expect(route.hops[4].instruction).toMatch(/ Stop 2 reached: Label B\.$/);
    expect(route.startAnchor.id).toBe("HR104");
    expect(route.target.id).toBe("B");
    expect(chain.targetNode?.id).toBe("B");
    expect(chain.coverage).toBe(1);
    expect(route.score).toBe(Math.min(80 - 3, 80 - 3));
  });

  it("treats a stop in the previous stop's field as one synthetic field, without planning", async () => {
    const { calls, planLeg } = fakePlanner();
    const chain = await planChain(base, [stop("A", 0), stop("B", 1), stop("C", 2)], { planLeg });
    expect(calls.map((c) => c.targetId)).toEqual(["A", "B"]);
    const leg = chain.legs[2];
    expect(leg).toMatchObject({ status: "same-field", hops: 0, from: "B" });
    expect(leg.distanceDeg).toBeCloseTo(0.8, 5);
    expect(chain.stopHopIndex).toEqual([2, 4, 5]);
    const last = chain.route!.hops[5];
    expect(last.center.ra).toBe(16);
    expect(last.instruction).toMatch(/^Same field: .* Stop 3 reached: Label C\.$/);
    expect(legDifficulty(leg).label).toBe("Same field");
  });

  it("turns a leg over MAX_CHAIN_LEG_DEG into a naked-eye jump to the planner's own anchor", async () => {
    const { calls, planLeg } = fakePlanner();
    const chain = await planChain(base, [stop("C", 0), stop("D", 1)], { planLeg });
    expect(MAX_CHAIN_LEG_DEG).toBe(20);
    expect(calls[1]).toMatchObject({ targetId: "D", startNodeId: undefined, startStarId: undefined });
    const leg = chain.legs[1];
    expect(leg.status).toBe("jump");
    expect(leg.distanceDeg).toBeCloseTo(34, 5);
    expect(leg.note).toMatch(/^Needs a naked-eye jump: find HR 131 by eye, then hop \(34° east of Label C\)$/);
    // The jump leg keeps its anchor field (no slice(1)).
    const hops = chain.route!.hops;
    const first = chain.stopHopIndex[0] + 1;
    expect(hops[first].center.ra).toBe(46.5);
    expect(hops[first].instruction).toMatch(/^Find HR 131 by eye, then hop/);
    expect(leg.anchor).toBe("HR 131");
    expect(legDifficulty(leg)).toEqual({ label: "By eye to HR 131 · 2 hops", level: "jump" });
    // A larger limit hops the same leg from C.
    const hopped = await planChain(base, [stop("C", 0), stop("D", 1)], { planLeg: fakePlanner().planLeg, maxLegDeg: 40 });
    expect(hopped.legs[1].status).toBe("ok");
  });

  it("starts a leg at the journey's own naked-eye anchor (rule 5: the card's \"Find Mirach by eye\" and Star hop agree)", async () => {
    const { calls, planLeg } = fakePlanner();
    const jumpStop: ChainStop = { ...stop("B", 1), getThere: { mode: "naked-eye-hop", fields: 1 }, startStarId: "HR107" };
    const chain = await planChain(base, [stop("A", 0), jumpStop], { planLeg });
    expect(calls[1]).toMatchObject({ targetId: "B", startStarId: "HR107", startNodeId: undefined });
    expect(chain.legs[1]).toMatchObject({ status: "jump", anchor: "HR 107", from: "A" });
    expect(chain.legs[1].note).toBeUndefined();
    expect(chain.route!.hops[chain.stopHopIndex[0] + 1].instruction).toMatch(/^Lower the binoculars and find HR 107 by eye, then hop\./);
    expect(legDifficulty(chain.legs[1]).label).toBe("By eye to HR 107 · 2 hops");
    // A sweep with an anchor is still hopped on from the previous stop.
    const sweep = await planChain(base, [stop("A", 0), { ...jumpStop, getThere: { mode: "sweep", fields: 1 } }], { planLeg: fakePlanner().planLeg });
    expect(sweep.legs[1]).toMatchObject({ status: "ok", from: "A" });
  });

  it("finds a stop by eye when the journey's anchor is the stop itself (one field, no hops)", async () => {
    const { calls, planLeg } = fakePlanner();
    const eye: ChainStop = { ...stop("HR120", 1), getThere: { mode: "naked-eye-hop", fields: 3 }, byEye: true };
    const chain = await planChain(base, [stop("A", 0), eye], { planLeg });
    expect(calls.map((c) => c.targetId)).toEqual(["A"]);
    expect(chain.legs[1]).toMatchObject({ status: "jump", hops: 0, anchor: "Label HR120" });
    expect(chain.stopHopIndex).toEqual([2, 3]);
    expect(chain.route!.hops[3].center.ra).toBe(30);
    expect(chain.route!.hops[3].instruction).toMatch(/^Lower the binoculars and find Label HR120 by eye, then raise them onto it\./);
    expect(legDifficulty(chain.legs[1])).toEqual({ label: "No hop needed", level: "easy" });
  });

  it("records failed legs, keeps going from the last reached stop, and reports coverage", async () => {
    const { calls, planLeg } = fakePlanner();
    const seen: LegReport[] = [];
    const chain = await planChain(base, [stop("A", 0), stop("LOW", 1), stop("UNKNOWN", 2), stop("FAIL", 3), stop("B", 4)], { planLeg, onLeg: (l) => seen.push(l) });
    expect(chain.legs.map((l) => l.status)).toEqual(["ok", "below-horizon", "unresolved", "no-route", "ok"]);
    expect(seen.map((l) => l.leg)).toEqual([1, 2, 3, 4, 5]);
    expect(chain.legs[1].note).toBe("Below the horizon at this time");
    expect(chain.legs[2].note).toBe("Not in the star-hop catalogs");
    // FAIL: from A, then from the brightest star beside A, then as a jump; all fail.
    const failCalls = calls.filter((c) => c.targetId === "FAIL");
    expect(failCalls.map((c) => [c.startNodeId, c.startStarId])).toEqual([["A", undefined], [undefined, "HR106"], [undefined, undefined]]);
    expect(chain.legs[4]).toMatchObject({ from: "A", status: "ok" });
    expect(calls.at(-1)).toMatchObject({ targetId: "B", startNodeId: "A" });
    expect(chain.stopHopIndex).toEqual([2, -1, -1, -1, 4]);
    expect(chain.coverage).toBeCloseTo(2 / 5, 5);
    expect(legStartHops(chain)).toEqual([0, -1, -1, -1, 3]);
  });

  it("plans the next stop as a first leg when nothing has been reached yet", async () => {
    const { calls, planLeg } = fakePlanner();
    const chain = await planChain(base, [stop("LOW", 0), stop("A", 1)], { planLeg });
    expect(calls[1]).toMatchObject({ targetId: "A", startNodeId: undefined });
    expect(chain.legs[1]).toMatchObject({ from: null, status: "ok" });
    expect(chain.route!.hops[0].center.ra).toBe(6);
  });

  it("stops at an abort between legs", async () => {
    const { planLeg } = fakePlanner();
    const controller = new AbortController();
    await expect(planChain(base, [stop("A", 0), stop("B", 1), stop("D", 2)], { planLeg, onLeg: () => controller.abort(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns an empty chain for no stops", async () => {
    expect(await planChain(base, [], { planLeg: fakePlanner().planLeg })).toEqual({ ...emptyChain([]), coverage: 0 });
  });
});

describe("chain navigation helpers", () => {
  const chain = { stops: ["A", "B", "C", "D"].map(stop), stopHopIndex: [2, -1, 5, 5] };
  it("finds each stop's first field and the stop at a field", () => {
    expect(legStartHops(chain)).toEqual([0, -1, 3, 5]);
    expect([0, 2, 3, 5, 9].map((s) => stopAtStep(chain, s))).toEqual([0, 0, 2, 2, 3]);
    expect(chainCheckpoint(chain, 2)).toBe("Stop 1 · Label A");
    expect(chainCheckpoint(chain, 3)).toBeNull();
  });
  it("labels leg difficulty", () => {
    const leg = (o: Partial<LegReport>): LegReport => ({ leg: 1, from: "A", to: "B", status: "ok", hops: 2, distanceDeg: 6, maxHopFov: .6, minPatternScore: 60, routeScore: 80, usedExpertRoute: false, ms: 1, ...o });
    expect(legDifficulty(leg({})).label).toBe("2 hops");
    expect(legDifficulty(leg({ hops: 1 })).label).toBe("1 hop");
    expect(legDifficulty(leg({ hops: 5 }))).toEqual({ label: "5 hops · hard", level: "hard" });
    expect(legDifficulty(leg({ hops: 2, maxHopFov: 1.3 })).level).toBe("hard");
    expect(legDifficulty(leg({ status: "no-route", hops: 0 })).label).toBe("No hop route");
    expect(legHopBound(14, 5)).toBe(4 + 3);
    // With the leg's hop bound, hard means a detour past it, not a fixed count.
    expect(legDifficulty(leg({ hops: 8, hopBound: 9 }))).toEqual({ label: "8 hops", level: "moderate" });
    expect(legDifficulty(leg({ hops: 14, hopBound: 10 }))).toEqual({ label: "14 hops · hard", level: "hard" });
    expect(legDifficulty(leg({ from: null, hops: 0 }))).toEqual({ label: "No hop needed", level: "easy" });
  });
  it("says the leg line once: a stop found by eye has no chip, a jump names its anchor in the chip", () => {
    const leg = (o: Partial<LegReport>): LegReport => ({ leg: 2, from: "A", to: "B", status: "ok", hops: 3, distanceDeg: 6, maxHopFov: .6, minPatternScore: 60, routeScore: 80, usedExpertRoute: false, ms: 1, ...o });
    const b = { label: "Andromeda Galaxy (M31)" };
    expect(legLine(leg({ from: null, hops: 0, leg: 1 }), { label: "Algol" }, "x")).toBe("Leg 1: find Algol by eye");
    expect(legChip(leg({ from: null, hops: 0 }))).toBeNull();
    expect(legLine(leg({ status: "jump", hops: 0 }), { label: "Betelgeuse" }, "x")).toBe("Leg 2: find Betelgeuse by eye");
    expect(legChip(leg({ status: "jump", hops: 0 }))).toBeNull();
    expect(legLine(leg({ status: "jump", anchor: "Mirach" }), b, "ET Cluster")).toBe("Leg 2: Andromeda Galaxy (M31)");
    expect(legChip(leg({ status: "jump", anchor: "Mirach" }))?.label).toBe("By eye to Mirach · 3 hops");
    expect(legLine(leg({}), b, "ET Cluster")).toBe("Leg 2: ET Cluster → Andromeda Galaxy (M31)");
    expect(legChip(leg({}))?.label).toBe("3 hops");
  });
  it("shares one hop-count wording and a hopper-calibrated estimate", () => {
    expect([0, 1, 2, 5].map((n) => hopCountLabel(n))).toEqual(["0 hops", "1 hop", "2 hops", "5 hops"]);
    expect([1, 2, 3].map((n) => hopCountLabel(n, { estimate: true }))).toEqual(["one hop", "one or two hops", "about 3 hops"]);
    // Same field, one overlapping move, and about one move more than the straight-line minimum beyond 1.5 fields.
    expect([0.5, 0.8, 1, 1.4, 2, 3.2, 4.8].map(estimateHops)).toEqual([0, 0, 2, 2, 4, 6, 8]);
  });
  it("names route options by what differs between routes from the same start star", () => {
    const anchor = node("STAR-Algol", 0, { name: "Algol" }), target = DSO("A", 10);
    const field = (n: SkyNode): HopStep => ({ ...hopAt(n, null), visibleGuideStars: [n] });
    const via = (...ids: [string, string][]) => ({ startAnchor: anchor, hops: [field(anchor), ...ids.map(([id, name]) => field(node(id, 3, { name, bayer: name }))), field(target)] });
    expect(routeOptionLabels([via(["HR1", "Mirfak"]), via(["HR2", "Atik"]), { ...via(), isExpertRoute: true }, { ...via(), startAnchor: node("HR9", 1, { name: "Capella" }) }]))
      .toEqual(["Via Algol · past Mirfak", "Via Algol · past Atik", "Classic route", "Via Capella"]);
    expect(routeOptionLabels([via(["HR1", "Mirfak"]), via(["HR1", "Mirfak"])])).toEqual(["Via Algol · route 1", "Via Algol · route 2"]);
  });
});
