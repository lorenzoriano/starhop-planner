import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  buildKnownRoute,
  resolveKnownWaypoint,
  angularDistance,
  type KnownRoute,
  type ObservingParams,
} from "../astronomy";
import { loadTestCatalogs } from "./test-helpers";

const { stars, targets } = loadTestCatalogs();
const nodes = [...stars, ...targets];
const target = targets.find((t) => t.id === "M31")!;
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
const known: KnownRoute[] = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../public/data/known-routes.json"),
    "utf8",
  ),
);
const entry = known.find((r) => r.targetId === "M31")!.routes[0];

describe("field guide route waypoints", () => {
  it("resolves written Bayer designations to the correct real stars", () => {
    expect(resolveKnownWaypoint("Delta Andromedae", nodes)?.id).toBe("HR165");
    expect(resolveKnownWaypoint("Mu Andromedae", nodes)?.id).toBe("HR269");
    expect(resolveKnownWaypoint("Beta Andromedae (Mirach)", nodes)?.id).toBe(
      "HR337",
    );
    expect(resolveKnownWaypoint("δ And", nodes)?.id).toBe("HR165");
  });
  it("matches catalog IDs exactly rather than confusing M1 with M13", () => {
    expect(
      resolveKnownWaypoint("M1 (Crab Nebula)", [
        targets.find((t) => t.id === "M13")!,
      ]),
    ).toBeNull();
    expect(resolveKnownWaypoint("M31 (Andromeda)", nodes)?.id).toBe("M31");
  });
  it("preserves the classic landmarks while inserting overlapping guided fields", () => {
    const route = buildKnownRoute(entry, nodes, target, params)!;
    expect(route).not.toBeNull();
    expect(route.hops.length).toBeGreaterThan(5);
    for(const id of ["HR15","HR165","HR337","HR269"]){const star=stars.find(s=>s.id===id)!;expect(route.hops.some(h=>h.center.ra===star.ra&&h.center.dec===star.dec)).toBe(true);}
    for(let i=1;i<route.hops.length;i++){
      const from=route.hops[i-1].center,to=route.hops[i].center;
      expect(route.hops[i].distanceDeg).toBeCloseTo(angularDistance(from.ra,from.dec,to.ra,to.dec));
      expect(route.hops[i].distanceDeg).toBeLessThanOrEqual(params.fovWidth*.7+1e-6);
    }
    expect(route.hops.at(-1)!.center.ra).toBe(target.ra);
  });
  it("omits a route with unresolved or unavailable landmarks", () => {
    expect(
      buildKnownRoute(
        {
          ...entry,
          waypoints: [
            { name: "Uncharted asterism", instruction: "Find it" },
            { name: "M31", instruction: "Arrive" },
          ],
        },
        nodes,
        target,
        params,
      ),
    ).toBeNull();
    expect(
      buildKnownRoute(
        entry,
        nodes.filter((n) => n.id !== "HR269"),
        target,
        params,
      ),
    ).toBeNull();
  });
  it("omits a reference route whose waypoint is below the horizon", () => {
    const lowNodes = nodes.map((n) =>
      n.id === "HR269" ? { ...n, alt: -10 } : n,
    );
    expect(buildKnownRoute(entry, lowNodes, target, params)).toBeNull();
  });
});
