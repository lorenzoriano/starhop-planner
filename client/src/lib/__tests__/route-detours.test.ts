/**
 * Detours (hopper audit, r5): the Guided hopper must stay near-direct unless a detour buys real recognisability.
 *
 * Causes pinned here: (1) the strategy costs were pure distance × obscurity, so a path riding bright landmarks could be
 * 3–5× longer and still look cheaper, and the number of moves cost nothing; (2) Guided's hard 0.7-field cap sits on the
 * bright-star catalogue's percolation radius at the default 3.7° field, so gaps forced 10–16-move detours;
 * (3) scoreRoute summed per-move bonuses, so a 6-move detour outscored a direct 2-move route (HR 2405).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { angularDistance, planRoutes, scoreRoute, type HopStep, type ObservingParams, type PatternType, type SkyNode } from "../astronomy";
import { LandmarkDiscountStrategy, type CostContext } from "../cost-strategies";
import { legHopBound } from "../hop-chain";
import {
  DIFFICULTY_PRESETS, GUIDED_MAX_HOP_FOV, GUIDED_NAKED_EYE_HOP_FOV, GUIDED_OVERLAP_HOP_FOV, MOVE_COST, STRETCH_MOVES_MIN,
  guidedMaxHopFov, guidedStretchCost, isNakedEyePoint, sweepDiscomfort, variableReachAStar,
} from "../route-planner";

vi.stubGlobal("fetch", async (input: string | URL) => new Response(readFileSync(resolve(__dirname, "../../../public", String(input).replace(/^\.\//, "")), "utf8"), { status: 200, headers: { "Content-Type": "application/json" } }));
afterAll(() => vi.unstubAllGlobals());

// ─── scoreRoute normalisation (synthetic fields) ─────────────

const bino: ObservingParams = { lat: 0, lon: 0, date: new Date("2026-11-04T05:30:00Z"), fovWidth: 6.5, fovHeight: 6.5, fovShape: "circle", limitingMag: 6.5, numRoutes: 3, targetId: "", observingMode: "binocular", difficulty: "beginner" };
const star = (id: string, mag = 5): SkyNode => ({ id, ra: 0, dec: 0, alt: 45, az: 0, mag, name: id, type: "star" });
const QUALITY: Record<"excellent" | "poor", { patternType: PatternType; patternScore: number; patternConfidence: number; guides: number }> = {
  excellent: { patternType: "triangle", patternScore: 90, patternConfidence: 0.9, guides: 4 },
  poor: { patternType: "field", patternScore: 30, patternConfidence: 0.4, guides: 1 },
};
/** A field centred at (ra, dec), reached by a move of `distanceDeg` (0 for the start field). */
function field(ra: number, dec: number, distanceDeg: number, quality: keyof typeof QUALITY = "excellent", startMag = 3): HopStep {
  const q = QUALITY[quality];
  return {
    center: { ra, dec, alt: 45, az: 0 }, visibleGuideStars: Array.from({ length: q.guides }, (_, i) => star(`g${i}`, i === 0 ? startMag : 5)), pattern: "", patternType: q.patternType,
    patternConfidence: q.patternConfidence, patternScore: q.patternScore, patternAnchors: [], patternLabels: [], direction: "north", distanceDeg, instruction: "",
  };
}
/** A straight route north along ra = 100 from dec 0 to dec `total` in `moves` equal moves. */
const straight = (total: number, moves: number, quality: (i: number) => keyof typeof QUALITY = () => "excellent") =>
  [field(100, 0, 0), ...Array.from({ length: moves }, (_, i) => field(100, (total * (i + 1)) / moves, total / moves, quality(i + 1)))];

describe("scoreRoute: length-penalised field quality", () => {
  it("a detour cannot outscore a direct route by adding well-patterned fields (HR 2405: 6 moves/20.7° beat 2 moves)", () => {
    const direct = straight(8.8, 2);
    // Same start and end, six excellent fields along a 20.7° path.
    const detour = [field(100, 0, 0), ...[1, 2, 3, 4, 5].map((i) => field(100 + i * 1.5, i * 1.6, 3.45)), field(100, 8.8, 3.45)];
    expect(scoreRoute(direct, bino)).toBeGreaterThan(scoreRoute(detour, bino) + 20);
  });

  it("never adds points for an extra move over the same distance", () => {
    const scores = [1, 2, 3, 4, 5, 6].map((moves) => scoreRoute(straight(4, moves), bino));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  });

  it("does not let good padding moves dilute a poor target field (η Her → M13 beats a longer route into the same field)", () => {
    const fov37 = { ...bino, fovWidth: 3.7, fovHeight: 3.7 };
    const direct = [field(100, 0, 0, "poor"), field(100, 2.5, 2.5, "poor")];
    const padded = [field(100, -3.6, 0, "poor"), field(100, -1.1, 2.5, "excellent"), field(100, 0, 3.4, "poor"), field(100, 2.5, 2.5, "poor")];
    expect(scoreRoute(direct, fov37)).toBeGreaterThan(scoreRoute(padded, fov37));
  });

  it("still lets a short detour win when it avoids poor fields (recognisability is worth a move)", () => {
    const poorDirect = straight(8, 2, () => "poor");
    const recognisable = [field(100, 0, 0), field(101.5, 2.8, 3.1), field(101.5, 5.6, 2.8), field(100, 8, 2.9)];
    expect(scoreRoute(recognisable, bino)).toBeGreaterThan(scoreRoute(poorDirect, bino));
  });

  it("stays within 5–100", () => {
    expect(scoreRoute(straight(2, 1), bino)).toBeLessThanOrEqual(100);
    expect(scoreRoute(straight(40, 20, () => "poor"), bino)).toBe(5);
  });
});

// ─── A* cost pieces ──────────────────────────────────────────

describe("Guided hop limits and sweep comfort", () => {
  it("prices a stretched Guided move at ≥ STRETCH_MOVES_MIN moves, rising with length, and nothing within 0.7 field", () => {
    expect(guidedStretchCost(GUIDED_OVERLAP_HOP_FOV)).toBe(0);
    expect(guidedStretchCost(0.3)).toBe(0);
    expect(guidedStretchCost(0.71)).toBeGreaterThanOrEqual(STRETCH_MOVES_MIN * MOVE_COST);
    expect(guidedStretchCost(1.0)).toBeGreaterThan(guidedStretchCost(0.85));
    expect(guidedStretchCost(0.85, 1)).toBeCloseTo(guidedStretchCost(0.85) / MOVE_COST);
  });

  it("lets a Guided move aim at a naked-eye star up to 1.5 fields, otherwise one field", () => {
    expect(isNakedEyePoint(star("bright", 3.2))).toBe(true);
    expect(isNakedEyePoint(star("faint", 5.5))).toBe(false);
    expect(isNakedEyePoint({ mag: 3.4, type: "messier" })).toBe(false); // M31 is not a point to aim at
    expect(isNakedEyePoint({ mag: 3.5, type: "binocular", binocularCategory: "DS" })).toBe(true);
    expect(guidedMaxHopFov(star("bright", 2))).toBe(GUIDED_NAKED_EYE_HOP_FOV);
    expect(guidedMaxHopFov(star("bright", 2), false)).toBe(GUIDED_MAX_HOP_FOV);
    expect(guidedMaxHopFov(star("faint", 6))).toBe(GUIDED_MAX_HOP_FOV);
  });

  it("gives Balanced a shorter comfortable sweep than Direct", () => {
    expect(sweepDiscomfort(1.8, DIFFICULTY_PRESETS.intermediate)).toBe(0);
    expect(sweepDiscomfort(2.4, DIFFICULTY_PRESETS.intermediate)).toBeGreaterThan(0);
    expect(sweepDiscomfort(2.4, DIFFICULTY_PRESETS.expert)).toBe(0);
    expect(sweepDiscomfort(3.0, DIFFICULTY_PRESETS.expert)).toBeLessThan(sweepDiscomfort(3.0, DIFFICULTY_PRESETS.intermediate));
  });
});

// ─── A* on synthetic skies ───────────────────────────────────

const node = (id: string, ra: number, dec: number, mag: number): SkyNode => ({ id, ra, dec, alt: 60, az: 0, mag, name: id, type: "star" });
const moves = (path: SkyNode[]) => path.slice(1).map((n, i) => angularDistance(path[i].ra, path[i].dec, n.ra, n.dec));

describe("variableReachAStar stays near-direct", () => {
  it("does not ride a long arc of bright landmarks when a direct line of faint stars exists", () => {
    const fov = 6.5;
    const start = node("S", 100, 0, 2), goal = node("G", 100, 16, 5.5);
    const line = [4, 8, 12].map((d) => node(`L${d}`, 100, d, 6));
    // An arc ~1.8× as long through bright named landmarks (landmark score 3 → obscurity 0.25).
    const arc = [[103.5, 2], [106, 5], [107, 8.5], [106, 12], [103.5, 14.5]].map(([ra, dec], i) => node(`A${i}`, ra, dec, 2.5));
    const landmarkScores = new Map<string, number>([...arc.map((a) => [a.id, 3] as [string, number]), ...line.map((l) => [l.id, 0] as [string, number]), ["S", 3], ["G", 0.5]]);
    const ctx: CostContext = { difficulty: "beginner", landmarkScores };
    const path = variableReachAStar(start, goal, [start, goal, ...line, ...arc], fov, "beginner", new LandmarkDiscountStrategy(), ctx)!;
    expect(path).not.toBeNull();
    const length = moves(path).reduce((a, b) => a + b, 0);
    expect(length).toBeLessThan(16 * 1.2);
    expect(path.length - 1).toBeLessThanOrEqual(legHopBound(16, fov) - 2);
  });

  it("bridges a catalogue gap with one stretched move instead of a long overlapping detour", () => {
    const fov = 3.7; // 0.7 field = 2.59°; the gap below is 3.3° (0.89 field)
    const start = node("S", 100, 0, 3), goal = node("G", 100, 8.1, 5.5);
    const line = [node("L1", 100, 2.4, 6), node("L2", 100, 5.7, 6)];
    // An all-overlapping detour around the gap: six more fields.
    const detour = [[102.4, 2.4], [104.8, 2.6], [106.4, 4.4], [104.8, 6.0], [102.4, 6.2]].map(([ra, dec], i) => node(`D${i}`, ra, dec, 6));
    const ctx: CostContext = { difficulty: "beginner", landmarkScores: new Map() };
    const path = variableReachAStar(start, goal, [start, goal, ...line, ...detour], fov, "beginner", new LandmarkDiscountStrategy(), ctx)!;
    expect(path.map((n) => n.id)).toEqual(["S", "L1", "L2", "G"]);
    const stretched = moves(path).filter((d) => d > GUIDED_OVERLAP_HOP_FOV * fov);
    expect(stretched).toHaveLength(1);
    expect(stretched[0]).toBeLessThanOrEqual(GUIDED_MAX_HOP_FOV * fov);
  });

  it("aims straight at a naked-eye star across an empty field, unless naked-eye moves are off", () => {
    const fov = 3.7;
    const start = node("S", 100, 0, 3), goal = node("G", 100, 5, 2.5); // 1.35 fields, nothing in between
    const around = [[102.5, 0.5], [104.5, 2], [104.5, 4.2], [102.5, 5.5]].map(([ra, dec], i) => node(`R${i}`, ra, dec, 6));
    const ctx: CostContext = { difficulty: "beginner", landmarkScores: new Map() };
    const stars = [start, goal, ...around];
    expect(variableReachAStar(start, goal, stars, fov, "beginner", new LandmarkDiscountStrategy(), ctx)!.map((n) => n.id)).toEqual(["S", "G"]);
    const strict = variableReachAStar(start, goal, stars, fov, "beginner", new LandmarkDiscountStrategy(), ctx, { nakedEyeMoves: false });
    expect(strict!.length).toBeGreaterThan(2);
    for (const d of moves(strict!)) expect(d).toBeLessThanOrEqual(GUIDED_MAX_HOP_FOV * fov + 1e-9);
  });
});

// ─── Real-catalogue regressions (hopper audit cases) ─────────

describe("hopper audit regressions (real catalogues)", () => {
  it("HR 2405 (10×50, San Francisco, Jan 2027): the direct 2-move route from θ Gem leads; no alternative detours", async () => {
    const params: ObservingParams = { ...bino, lat: 37.77, lon: -122.42, date: new Date("2027-01-08T04:15:00Z"), targetId: "HR2405" };
    const result = await planRoutes(params);
    expect(result.routes.length).toBeGreaterThan(1);
    const top = result.routes[0];
    expect(top.startAnchor.id).toBe("HR2540"); // θ Geminorum
    expect(top.hops.length - 1).toBeLessThanOrEqual(2);
    // Before the fix ν Aur's 6-move, 20.7° route (8.8° direct) scored 95 and led.
    for (const route of result.routes.filter((r) => !r.isExpertRoute)) {
      const direct = angularDistance(route.hops[0].center.ra, route.hops[0].center.dec, route.target.ra, route.target.dec);
      expect(route.hops.length - 1).toBeLessThanOrEqual(legHopBound(direct, params.fovWidth));
      expect(route.hops.reduce((s, h) => s + h.distanceDeg, 0)).toBeLessThan(direct * 1.3);
    }
  }, 30_000);

  it("Alderamin → Alfirk (14×50, 3.7° field, stars to 8): a short Guided route, not 11 moves over 21°", async () => {
    const params: ObservingParams = { ...bino, lat: 37.77, lon: -122.42, date: new Date("2026-11-04T05:30:00Z"), fovWidth: 3.7, fovHeight: 3.7, limitingMag: 8, targetId: "HR8238", startStarId: "HR8162" };
    const result = await planRoutes(params);
    expect(result.warning).toBeUndefined(); // Guided itself, no Balanced fallback
    const route = result.routes[0];
    expect(route.startAnchor.id).toBe("HR8162");
    const direct = angularDistance(route.hops[0].center.ra, route.hops[0].center.dec, route.target.ra, route.target.dec);
    expect(route.hops.length - 1).toBeLessThanOrEqual(4);
    expect(route.hops.length - 1).toBeLessThanOrEqual(legHopBound(direct, 3.7));
    const nodeAt = (h: HopStep) => result.nodes.find((n) => n.ra === h.center.ra && n.dec === h.center.dec)!;
    for (const hop of route.hops.slice(1)) expect(hop.distanceDeg).toBeLessThanOrEqual(guidedMaxHopFov(nodeAt(hop)) * 3.7 + 1e-6);
  }, 30_000);
});
