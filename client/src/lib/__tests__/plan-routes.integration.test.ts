import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { planRoutes, type ObservingParams } from "../astronomy";

vi.stubGlobal(
  "fetch",
  async (input: string) =>
    new Response(
      readFileSync(
        resolve(__dirname, "../../../public", input.replace(/^\.\//, "")),
        "utf8",
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
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

describe("full catalog route planning", () => {
  it("returns distinct computed alternatives and a calibrated field guide route", async () => {
    const result = await planRoutes(params);
    expect(result.belowHorizon).toBe(false);
    expect(result.routes.length).toBeGreaterThan(1);
    const calculated = result.routes.filter((r) => !r.isExpertRoute);
    const signatures = calculated.map((r) =>
      r.hops.map((h) => `${h.center.ra},${h.center.dec}`).join(";"),
    );
    expect(new Set(signatures).size).toBe(calculated.length);
    const reference = result.routes.find((r) => r.isExpertRoute)!;
    expect(reference.hops.length).toBeGreaterThan(5);
    for(const route of result.routes)for(const hop of route.hops.slice(1))expect(hop.distanceDeg).toBeLessThanOrEqual(7*.7+1e-6);
    expect(reference.hops[1].distanceDeg).toBeGreaterThan(1);
    expect(reference.hops[1].center.ra).not.toBe(reference.hops[0].center.ra);
    expect(
      result.routes.every(
        (r) => r.hops.at(-1)!.center.ra === result.targetNode!.ra,
      ),
    ).toBe(true);
  });
  it("returns no route for a real target below the horizon", async () => {
    const result = await planRoutes({ ...params, lat: 70, targetId: "M7" });
    expect(result.belowHorizon).toBe(true);
    expect(result.routes).toHaveLength(0);
  });
});
