import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { planRoutes, loadStars, formatRouteNodeName, type ObservingParams } from "../astronomy";
import { starPlanningTarget } from "../session-planner";
import { catalogSearchScore } from "../catalog-search";

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
  it("uses the same star designations in badges and confirmation text, without galaxy guide stars", async () => {
    for(const targetId of ["M31","M42"]){
      const result=await planRoutes({...params,targetId,date:new Date("2026-11-09T06:00:00Z"),fovWidth:3.7,fovHeight:3.7});
      expect(result.routes.length).toBeGreaterThan(0);
      for(const route of result.routes)for(const hop of route.hops){
        expect(hop.patternAnchors.every(star=>star.type==='star')).toBe(true);
        expect(hop.pattern).not.toMatch(/Andromeda Galaxy.*guide star/);
        expect(hop.instruction).not.toMatch(/Keep Andromeda Galaxy in view as a guide/);
        for(const anchor of hop.patternAnchors)expect(hop.pattern).toContain(formatRouteNodeName(anchor));
      }
    }
  }, 30_000);
  it("returns no route for a real target below the horizon", async () => {
    const result = await planRoutes({ ...params, lat: 70, targetId: "M7" });
    expect(result.belowHorizon).toBe(true);
    expect(result.routes).toHaveLength(0);
  });
  it("starts every candidate at an explicitly chosen Mirach, retaining M31 and field overlap", async () => {
    const result = await planRoutes({ ...params, startStarId:"HR337" });
    expect(result.routes.length).toBeGreaterThan(0);
    for (const route of result.routes) {
      expect(route.startAnchor.id).toBe("HR337");
      expect(route.target.id).toBe("M31");
      for (const hop of route.hops.slice(1)) expect(hop.distanceDeg).toBeLessThanOrEqual(7*.7+1e-6);
    }
  }, 30_000);
  it("does not silently fall back when a forced star is faint, below the horizon or absent", async () => {
    for (const startStarId of ["HR5958", "HR4730", "HR999999"]) {
      const result = await planRoutes({ ...params, startStarId });
      expect(result.routes).toHaveLength(0);
      expect(result.anchorUnavailable).toBe(true);
    }
  });
  it("finds the reported real BSC landmarks and their stellar aliases", async () => {
    const stars=await loadStars();
    const queries: Record<string,string[]> = {
      HR424:["Polaris","Alpha UMi","α UMi","1 UMi","HR 424"],
      HR4301:["Dubhe","50 UMa"], HR4295:["Merak","Beta UMa"],
      HR168:["Shedir","Schedar","Alpha Cas"], HR21:["Caph","Beta Cas"], HR617:["Hamal","Alpha Ari"],
    };
    for (const [id, aliases] of Object.entries(queries)) {
      const target=starPlanningTarget(stars.find(star=>star.id===id)!);
      for (const query of aliases) expect(catalogSearchScore(target,query),`${id}: ${query}`).toBeLessThan(Infinity);
    }
  });
});
