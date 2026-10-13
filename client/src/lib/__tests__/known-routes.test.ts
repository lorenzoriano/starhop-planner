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
  it("maps the classic Andromeda chain to five distinct fields and measured hop distances", () => {
    const route = buildKnownRoute(entry, nodes, target, params)!;
    expect(route).not.toBeNull();
    expect(route.hops).toHaveLength(5);
    expect(new Set(route.hops.map((h) => h.center.ra))).toHaveProperty(
      "size",
      5,
    );
    expect(route.hops[1].center.ra).toBe(
      stars.find((s) => s.id === "HR165")!.ra,
    );
    const from = route.hops[0].center,
      to = route.hops[1].center;
    expect(route.hops[1].distanceDeg).toBeCloseTo(
      angularDistance(from.ra, from.dec, to.ra, to.dec),
    );
    expect(route.hops[1].distanceDeg).toBeGreaterThan(0);
    expect(route.hops[4].center.ra).toBe(target.ra);
    expect(route.hops[4].distanceDeg).toBeCloseTo(4, 1);
    expect(route.hops[4].instruction).toContain("4 degrees NW from Mu");
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
