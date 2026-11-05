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
  it("keeps the classic naked-eye jumps and breaks only the longer moves onto fainter fields into overlapping ones", () => {
    // At 7° every move is a naked-eye jump or within 0.7 field: the guide's own five fields and instructions.
    const route = buildKnownRoute(entry, nodes, target, params)!;
    expect(route).not.toBeNull();
    expect(route.hops.map((h) => h.instruction)).toEqual(entry.waypoints.map((w) => w.instruction));
    // At 3.7° the μ And → M31 move (3.9°) is broken into overlapping fields; the landmarks stay in order.
    const narrow = { ...params, fovWidth: 3.7, fovHeight: 3.7 };
    const guided = buildKnownRoute(entry, nodes, target, narrow)!;
    expect(guided.hops.length).toBeGreaterThan(5);
    const landmarks = ["HR15", "HR165", "HR337", "HR269"].map((id) => { const star = stars.find((s) => s.id === id)!; return guided.hops.findIndex((h) => h.center.ra === star.ra && h.center.dec === star.dec); });
    expect(landmarks).toEqual([0, 1, 2, 3]);
    expect(guided.hops[1].instruction).toBe(entry.waypoints[1].instruction);
    for (let i = 1; i < guided.hops.length; i++) {
      const from = guided.hops[i - 1].center, to = guided.hops[i].center;
      expect(guided.hops[i].distanceDeg).toBeCloseTo(angularDistance(from.ra, from.dec, to.ra, to.dec));
      if (i > 3) expect(guided.hops[i].distanceDeg).toBeLessThanOrEqual(narrow.fovWidth + 1e-6);
    }
    expect(guided.hops.at(-1)!.center.ra).toBe(target.ra);
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
