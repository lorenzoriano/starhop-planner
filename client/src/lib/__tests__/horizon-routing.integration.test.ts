import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { eqToHorizontal, planRoutes, type ObservingParams } from "../astronomy";
import { refractionDeg, type CompactHorizon } from "../horizon/profile";

vi.stubGlobal(
  "fetch",
  async (input: string) =>
    new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
);
afterAll(() => vi.unstubAllGlobals());

const params: ObservingParams = {
  lat: 37.77,
  lon: -122.42,
  date: new Date("2026-10-13T04:00:00Z"),
  fovWidth: 7,
  fovHeight: 7,
  fovShape: "circle",
  limitingMag: 6.5,
  targetId: "M31",
  numRoutes: 3,
  observingMode: "binocular",
  difficulty: "beginner",
};
/** Synthetic skyline: `wallAlt` (geometric) on azimuths [from, to] (wrapping through north when from > to), `rest` elsewhere. */
const wall = (from: number, to: number, wallAlt: number, rest = -90): CompactHorizon => ({
  kind: "geometric",
  stepDeg: 1,
  alt: Array.from({ length: 360 }, (_, az) => ((from <= to ? az >= from && az <= to : az >= from || az <= to) ? wallAlt : rest)),
});
const summary = (r: Awaited<ReturnType<typeof planRoutes>>) => ({
  belowHorizon: r.belowHorizon,
  behindTerrain: r.behindTerrain,
  nodes: r.nodes.map((n) => n.id),
  routes: r.routes.map((route) => [route.startAnchor.id, route.hops.map((h) => `${h.center.ra},${h.center.dec}`)]),
});

describe("route planning with a local skyline", () => {
  it("is unchanged without a horizon, or with a skyline that never binds", async () => {
    const flat = summary(await planRoutes(params));
    expect(summary(await planRoutes({ ...params, horizon: null }))).toEqual(flat);
    expect(summary(await planRoutes({ ...params, horizon: wall(0, 359, -1) }))).toEqual(flat);
  }, 60_000);
  it("treats sky nodes behind the skyline like nodes below the horizon, and start stars must clear it as well as 15°", async () => {
    const skyline = wall(0, 359, 20);
    const result = await planRoutes({ ...params, horizon: skyline });
    expect(result.routes.length).toBeGreaterThan(0);
    for (const n of result.nodes) {
      const geometric = n.type === "planet" ? n.alt - refractionDeg(n.alt) : n.alt;
      expect(geometric).toBeGreaterThanOrEqual(20 - 1e-9);
    }
    for (const route of result.routes) for (const hop of route.hops) expect(hop.center.alt).toBeGreaterThanOrEqual(20 - 1e-9);
    // A 25° wall to the northeast only: automatic start stars there must clear 25°, elsewhere 15° as before.
    const partial = await planRoutes({ ...params, horizon: wall(20, 80, 25) });
    for (const route of partial.routes.filter((r) => !r.isExpertRoute)) {
      const { alt, az } = route.startAnchor;
      expect(alt).toBeGreaterThanOrEqual(az >= 20 && az <= 80 ? 25 : 15);
    }
  }, 60_000);
  it("reports a target hidden behind the skyline as below the horizon, behind terrain", async () => {
    const { alt, az } = eqToHorizontal(10.685, 41.269, params.lat, params.lon, params.date);
    expect(alt).toBeGreaterThan(5);
    const a = Math.round(az);
    const result = await planRoutes({ ...params, horizon: wall((a + 350) % 360, (a + 10) % 360, alt + 5) });
    expect(result.routes).toHaveLength(0);
    expect(result.belowHorizon).toBe(true);
    expect(result.behindTerrain).toBe(true);
    // A real low target stays a plain below-the-horizon case.
    const low = await planRoutes({ ...params, lat: 70, targetId: "M7", horizon: wall(0, 359, 3) });
    expect(low.belowHorizon).toBe(true);
    expect(low.behindTerrain).toBeUndefined();
  }, 60_000);
  it("refuses a chosen start star that is hidden behind the skyline", async () => {
    const mirach = await planRoutes({ ...params, startStarId: "HR337" });
    expect(mirach.routes.length).toBeGreaterThan(0);
    const star = mirach.nodes.find((n) => n.id === "HR337")!;
    const a = Math.round(star.az);
    const hidden = await planRoutes({ ...params, startStarId: "HR337", horizon: wall((a + 357) % 360, (a + 3) % 360, star.alt + 2) });
    expect(hidden.routes).toHaveLength(0);
    expect(hidden.anchorUnavailable).toBe(true);
  }, 60_000);
});
