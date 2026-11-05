/**
 * The owner's rule: "if there are classic routes that work, then we should try to use them because they exist for a
 * good reason. We should revert to algorithmic calculations whenever a classic, well-established, good route does
 * not exist." A classic (field guide) route that works tonight leads Star hop's list, the chain's pick and the
 * route option labels; without one the list is the computed routes by score.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { classicRouteWorks, classicRoutesFirst, isClassicMoveFollowable, loadBinocularTargets, loadMessier, loadStars, planRoutes, resolveKnownRouteWaypoints, type KnownRoute, type ObservingParams, type Route, type SkyNode } from "../astronomy";
import { pickRoute, routeOptionLabels } from "../hop-chain";

vi.stubGlobal("fetch", async (input: string) =>
  new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), { status: 200, headers: { "Content-Type": "application/json" } }));
afterAll(() => vi.unstubAllGlobals());

/** San Francisco on an autumn evening: Andromeda high in the east. */
const autumn: ObservingParams = {
  lat: 37.77, lon: -122.42, date: new Date("2026-11-04T05:30:00Z"),
  fovWidth: 3.7, fovHeight: 3.7, fovShape: "circle", limitingMag: 8,
  targetId: "M31", numRoutes: 3, observingMode: "binocular", difficulty: "beginner",
};
const OPTICS = [
  { label: "14×50, 3.7° field", fovWidth: 3.7, fovHeight: 3.7, limitingMag: 8 },
  { label: "10×50, 6.5° field", fovWidth: 6.5, fovHeight: 6.5, limitingMag: 6.5 },
];
const ALPHERATZ = "HR15", MIRACH = "HR337", DELTA_AND = "HR165", MU_AND = "HR269";

describe("a classic route that works leads", () => {
  for (const optic of OPTICS) {
    for (const difficulty of ["beginner", "intermediate"] as const) {
      it(`lists the Alpheratz → δ And → Mirach → μ And → M31 route first (${optic.label}, ${difficulty})`, async () => {
        const result = await planRoutes({ ...autumn, ...optic, difficulty });
        expect(result.routes.length).toBeGreaterThan(1);
        const first = result.routes[0];
        expect(first.isExpertRoute).toBe(true);
        expect(first.startAnchor.id).toBe(ALPHERATZ);
        // The classic landmarks, in order, and the naked-eye jumps kept as single moves.
        const centres = first.hops.map((h) => `${h.center.ra},${h.center.dec}`);
        const at = (id: string) => { const n = result.nodes.find((x) => x.id === id)!; return centres.indexOf(`${n.ra},${n.dec}`); };
        const order = [ALPHERATZ, DELTA_AND, MIRACH, MU_AND].map(at);
        expect(order).toEqual([0, 1, 2, 3]);
        expect(first.hops.at(-1)!.center.ra).toBe(result.targetNode!.ra);
        // The classic leads even though a computed route scores higher.
        expect(Math.max(...result.routes.slice(1).map((r) => r.score))).toBeGreaterThan(first.score);
        expect(result.routes.slice(1).every((r) => !r.isExpertRoute)).toBe(true);
        // An honest score: the naked-eye jumps count as easy moves (it read 5/100 when they were charged as "too far").
        expect(first.score).toBeGreaterThanOrEqual(optic.fovWidth > 5 ? 75 : 40);
        // A computed route through the very same fields is not listed a second time.
        const fields = (r: Route) => r.hops.map((h) => `${h.center.ra},${h.center.dec}`).join(";");
        expect(result.routes.slice(1).some((r) => fields(r) === fields(first))).toBe(false);
        // The chain and the route options agree.
        expect(pickRoute(result.routes, optic.fovWidth)).toBe(first);
        expect(routeOptionLabels(result.routes)[0]).toBe("Classic route");
        expect(result.warning).toBeUndefined();
      });
    }
  }
});

describe("without a working classic route the computed routes are ordered by score", () => {
  const byScore = (routes: Route[]) => routes.every((r, i) => i === 0 || routes[i - 1].score >= r.score);
  it("a target with no classic route (NGC 884, the Double Cluster's eastern half)", async () => {
    const result = await planRoutes({ ...autumn, targetId: "NGC884", difficulty: "intermediate" });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.some((r) => r.isExpertRoute)).toBe(false);
    expect(byScore(result.routes)).toBe(true);
  });
  it("a classic route the optic cannot follow (μ And → M31 is 3.9°, beyond a 1.5° telescope field's reach) is dropped", async () => {
    const result = await planRoutes({ ...autumn, observingMode: "telescope", fovWidth: 1.5, fovHeight: 1.5, limitingMag: 10, difficulty: "intermediate" });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.some((r) => r.isExpertRoute)).toBe(false);
    expect(byScore(result.routes)).toBe(true);
  });
});

describe("classic route rules", () => {
  const node = (id: string, ra: number, dec: number, mag: number, type: SkyNode["type"] = "star"): SkyNode =>
    ({ id, ra, dec, mag, type, name: id, alt: 45, az: 90 });
  it("follows a long naked-eye jump at any difficulty, but holds fainter waypoints to the planner's reach", () => {
    const from = node("A", 0, 0, 2), brightStar = node("B", 0, 8, 3.3), faint = node("C", 0, 8, 6.5), dso = node("D", 0, 4, 4.4, "messier");
    for (const d of ["beginner", "intermediate", "expert"] as const) expect(isClassicMoveFollowable(from, brightStar, false, 3.7, d)).toBe(true);
    expect(isClassicMoveFollowable(from, faint, false, 3.7, "intermediate")).toBe(false);
    expect(isClassicMoveFollowable(from, faint, false, 3.7, "beginner")).toBe(false);
    expect(isClassicMoveFollowable(from, dso, true, 3.7, "intermediate")).toBe(true);
    expect(isClassicMoveFollowable(from, dso, true, 3.7, "beginner")).toBe(false);
    expect(isClassicMoveFollowable(from, dso, true, 0.8, "intermediate")).toBe(false);
  });
  it("puts working classic routes first (by score among themselves), then the rest by score", () => {
    // A route of `moves` moves over 10° (legHopBound(10, 3.7) = 7 moves).
    const r = (id: string, score: number, moves: number, isExpertRoute = false) => ({
      id, score, isExpertRoute, target: { ra: 0, dec: 10 },
      hops: Array.from({ length: moves + 1 }, (_, i) => ({ center: { ra: 0, dec: (10 * i) / moves }, distanceDeg: i ? 10 / moves : 0 })),
    }) as unknown as Route;
    const computed = [r("a", 90, 3), r("b", 95, 3)];
    expect(classicRoutesFirst(computed, [r("c1", 10, 4, true), r("c2", 40, 4, true)], 3.7).map((x) => x.id)).toEqual(["c2", "c1", "b", "a"]);
    expect(classicRoutesFirst(computed, [], 3.7).map((x) => x.id)).toEqual(["b", "a"]);
    // A classic adapted into far more fields than the distance needs (12 > 7 moves) is not promoted: score order.
    expect(classicRoutesFirst(computed, [r("long", 92, 12, true)], 3.7).map((x) => x.id)).toEqual(["b", "long", "a"]);
    expect(pickRoute(classicRoutesFirst(computed, [r("c", 10, 4, true)], 3.7), 3.7).id).toBe("c");
    expect(pickRoute(classicRoutesFirst(computed, [r("long", 92, 12, true)], 3.7), 3.7).id).toBe("b");
  });
});

describe("field guide waypoints resolve against the app's catalogs", () => {
  const known: KnownRoute[] = JSON.parse(readFileSync(resolve(__dirname, "../../../public/data/known-routes.json"), "utf8"));
  let nodes: SkyNode[] = [];
  const byId = (id: string) => nodes.find((n) => n.id === id)!;
  const ids = (targetId: string, i = 0) => resolveKnownRouteWaypoints(known.find((k) => k.targetId === targetId)!.routes[i], nodes, byId(targetId))?.nodes.map((n) => n.id);
  it("resolves every route except Collinder 69, which has no target in the app", async () => {
    const [stars, messier, bino] = await Promise.all([loadStars(), loadMessier(), loadBinocularTargets()]);
    // The fields buildSkyNodes gives each node (altitude is not used by the resolver).
    nodes = [
      ...stars.map((s) => ({ id: s.id, ra: s.ra, dec: s.dec, alt: 45, az: 0, mag: s.mag, name: s.name || s.bayer || `HR${s.hr}`, type: "star" as const, constellation: s.constellation, bayer: s.bayer, flamsteed: s.flamsteed })),
      ...messier.map((m) => ({ id: m.id, ra: m.ra, dec: m.dec, alt: 45, az: 0, mag: m.mag, name: m.name || m.m, type: "messier" as const })),
    ];
    const seen = new Set(nodes.map((n) => n.id));
    for (const t of bino) if (!seen.has(t.id)) nodes.push({ id: t.id, ra: t.ra, dec: t.dec, alt: 45, az: 0, mag: t.mag, name: t.name, type: "binocular", constellation: t.con });
    const failures = known.flatMap((k) => k.routes.flatMap((r, i) => {
      const target = nodes.find((n) => n.id === k.targetId);
      return target && resolveKnownRouteWaypoints(r, nodes, target) ? [] : [`${k.targetId} #${i}`];
    }));
    expect(failures).toEqual(["Cr69 #0"]);
  });
  it("maps asterisms to the star the guide means and ends on the target", () => {
    expect(ids("M15")).toEqual(["HR8781", "HR8308", "M15"]); // Great Square → Markab (α Peg, not κ Vel) → Enif
    expect(ids("M13")).toEqual(["HR6220", "M13"]); // Keystone → η Her, merged with the η Her step
    expect(ids("M45")?.[0]).toBe("HR1903"); // Orion's Belt → Alnilam
    expect(ids("M64")).toEqual(["HR4968", "HR4894", "M64"]); // 35 Comae Berenices
    expect(ids("M81")).toEqual(["HR4554", "HR4301", "M81"]); // stops at M81 instead of going on to M82
    expect(ids("DS-Albireo")?.at(-1)).toBe("DS-Albireo"); // "Albireo (Beta Cyg)" is the target itself
    expect(ids("AST-Coathanger")?.at(-1)).toBe("AST-Coathanger");
  });
});

describe("a classic route that overshoots is not promoted", () => {
  const route = (path: [number, number][]) => ({
    target: { ra: path.at(-1)![0], dec: path.at(-1)![1] },
    hops: path.map(([ra, dec], i) => ({ center: { ra, dec }, distanceDeg: i ? Math.hypot(ra - path[i - 1][0], dec - path[i - 1][1]) : 0 })),
  }) as unknown as Route;
  it("keeps a chain that bends (≈ 1.6× the direct distance) and rejects a pointer walked as hops (out 20°, back 15°)", () => {
    expect(classicRouteWorks(route([[0, 0], [0, 7], [5, 12], [3, 14]]), 6.5)).toBe(true);
    expect(classicRouteWorks(route([[0, 0], [0, 20], [0, 5]]), 6.5)).toBe(false);
  });
});
