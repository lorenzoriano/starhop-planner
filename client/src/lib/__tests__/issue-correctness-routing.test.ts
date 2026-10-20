import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { angularDistance, eqToHorizontal, loadStars, planRoutes, type ObservingParams } from "../astronomy";

vi.stubGlobal("fetch", async (input: string | URL) => {
  const path = String(input).replace(/^\.\//, "");
  return new Response(readFileSync(resolve(__dirname, "../../../public", path), "utf8"), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
afterAll(() => vi.unstubAllGlobals());

const base: ObservingParams = {
  lat: 37.77,
  lon: -122.42,
  date: new Date("2026-10-20T04:00:00Z"),
  fovWidth: 3.7,
  fovHeight: 3.7,
  fovShape: "circle",
  limitingMag: 6.5,
  numRoutes: 3,
  targetId: "M31",
  observingMode: "telescope",
  difficulty: "beginner",
};

describe("full-catalog forced-anchor and required-waypoint routing", () => {
  it("connects the reported NGC 752 binocular target at the default 3.7 degree field",async()=>{
    const result=await planRoutes({...base,targetId:"NGC752",observingMode:"binocular",limitingMag:8});
    expect(result.belowHorizon).toBe(false);
    expect(result.routes.length,result.warning??"No route").toBeGreaterThan(0);
    expect(result.routes[0].target.id).toBe("NGC752");
  });
  it("keeps a forced Mirach anchor in Guided mode or clearly labels its Balanced fallback", async () => {
    const stars = await loadStars();
    const mirach = stars.find((star) => star.id === "HR337")!;
    expect(mirach.name).toBe("Mirach");
    expect(mirach.mag).toBeLessThan(4.5);
    expect(eqToHorizontal(mirach.ra, mirach.dec, base.lat, base.lon, base.date).alt).toBeGreaterThan(5);

    const result = await planRoutes({ ...base, startStarId: "HR337" });
    expect(result.routes.length, result.warning ?? "No route returned").toBeGreaterThan(0);
    expect(result.routes.every((route) => route.startAnchor.id === "HR337")).toBe(true);
    expect(result.routes.every((route) => route.target.id === "M31")).toBe(true);
    if (result.warning) expect(result.warning).toContain("Balanced");
  });

  it("includes a required HR224 waypoint in order on a real Mirach-to-M31 plan", async () => {
    const stars = await loadStars();
    const waypoint = stars.find((star) => star.id === "HR224")!;
    expect(waypoint.constellation).toBe("Psc");
    expect(waypoint.mag).toBe(4.43);
    expect(eqToHorizontal(waypoint.ra, waypoint.dec, base.lat, base.lon, base.date).alt).toBeGreaterThan(5);

    const result = await planRoutes({ ...base, startStarId: "HR337", waypointIds: ["HR224"] });
    expect(result.routes.length).toBeGreaterThan(0);
    const route = result.routes[0];
    expect(route.startAnchor.id).toBe("HR337");
    expect(route.target.id).toBe("M31");
    const node = result.nodes.find((candidate) => candidate.id === "HR224")!;
    const waypointIndex = route.hops.findIndex((hop) => angularDistance(hop.center.ra, hop.center.dec, node.ra, node.dec) < 0.01);
    expect(waypointIndex).toBeGreaterThan(0);
    const targetIndex = route.hops.findIndex((hop) => hop.center.ra === result.targetNode!.ra && hop.center.dec === result.targetNode!.dec);
    expect(targetIndex).toBeGreaterThan(waypointIndex);
  });

  it("can use a required star fainter than magnitude 4.5 as the start of the following leg", async () => {
    const stars = await loadStars();
    const waypoint = stars.find((star) => star.id === "HR425")!;
    expect(waypoint.mag).toBeGreaterThan(4.5);
    expect(waypoint.mag).toBeLessThanOrEqual(base.limitingMag);
    expect(eqToHorizontal(waypoint.ra, waypoint.dec, base.lat, base.lon, base.date).alt).toBeGreaterThan(5);

    const result = await planRoutes({ ...base, fovWidth: 7, fovHeight: 7, startStarId: "HR337", waypointIds: ["HR425"] });
    expect(result.routes.length, result.warning ?? "No route returned").toBeGreaterThan(0);
    const route = result.routes[0];
    expect(route.startAnchor.id).toBe("HR337");
    const node = result.nodes.find((candidate) => candidate.id === "HR425")!;
    const waypointIndex = route.hops.findIndex((hop) => angularDistance(hop.center.ra, hop.center.dec, node.ra, node.dec) < 0.01);
    expect(waypointIndex).toBeGreaterThan(0);
    const targetIndex = route.hops.findIndex((hop) => hop.center.ra === result.targetNode!.ra && hop.center.dec === result.targetNode!.dec);
    expect(targetIndex).toBeGreaterThan(waypointIndex);
  });
});
