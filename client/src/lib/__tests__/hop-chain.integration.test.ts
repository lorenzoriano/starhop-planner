import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { angularDistance, buildUnifiedTargets, loadBinocularTargets, loadMessier, loadStars, planRoutes, type ObservingParams } from "../astronomy";
import { legDifficulty, legHopBound, planChain } from "../hop-chain";
import { resolveChainSource, chainOverlay, journeyChainStops } from "@/components/useHopChain";
import type { ObjectCatalog } from "../object-links";
import type { KbObject } from "../journeys/types";
import { makeSession } from "../session-planner";

vi.stubGlobal("fetch", async (input: string) => new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), { status: 200, headers: { "Content-Type": "application/json" } }));
afterAll(() => vi.unstubAllGlobals());

// San Francisco, 4 Nov 2026 21:30 PST: Andromeda, Triangulum, Perseus and the Pleiades are well up.
const base: ObservingParams = { lat: 37.77, lon: -122.42, date: new Date("2026-11-04T05:30:00Z"), fovWidth: 6.5, fovHeight: 6.5, fovShape: "circle", limitingMag: 6.5, numRoutes: 3, targetId: "M31", observingMode: "binocular", difficulty: "beginner" };
let catalog: ObjectCatalog | null = null;
async function loadCatalog(): Promise<ObjectCatalog> {
  if (catalog) return catalog;
  const [stars, messier, bino] = await Promise.all([loadStars(), loadMessier(), loadBinocularTargets()]);
  return (catalog = { stars, targets: buildUnifiedTargets(messier, bino) });
}

describe("chained hops on the real catalogs", () => {
  it("starts a leg at a deep-sky stop (startNodeId): M31 → M33 hops on from Andromeda's field", async () => {
    const direct = await planRoutes({ ...base, targetId: "M33", startNodeId: "M31" });
    expect(direct.anchorUnavailable).toBeFalsy();
    expect(direct.routes.length).toBeGreaterThan(0);
    for (const route of direct.routes) {
      expect(route.startAnchor.id).toBe("M31");
      expect(route.hops[0].center.ra).toBe(route.startAnchor.ra);
      expect(route.hops.at(-1)!.center.ra).toBe(direct.targetNode!.ra);
    }
    // A start node below the horizon or unknown is reported, not silently replaced.
    const missing = await planRoutes({ ...base, targetId: "M33", startNodeId: "NOT-A-NODE" });
    expect(missing).toMatchObject({ routes: [], anchorUnavailable: true });
  }, 60_000);

  it("opens a chain on a naked-eye star by eye (no hop from a neighbour to reach it)", async () => {
    const cat = await loadCatalog();
    const resolved = await resolveChainSource({ kind: "ids", ids: ["STAR-Algol", "Mel20"] }, cat, []);
    const chain = await planChain(base, resolved.stops);
    expect(chain.legs[0]).toMatchObject({ status: "ok", hops: 0 });
    expect(legDifficulty(chain.legs[0]).label).toBe("No hop needed");
    expect(chain.stopHopIndex[0]).toBe(0);
    expect(chain.route!.startAnchor.id).toBe("STAR-Algol");
    expect(chain.route!.hops[0].instruction).toMatch(/^Find Algol \(β Per\) by eye/);
    expect(chain.stopHopIndex[1]).toBeGreaterThan(0);
  }, 60_000);

  it("chains DSO → DSO legs, a same-field stop and a naked-eye jump into one route", async () => {
    const cat = await loadCatalog();
    const resolved = await resolveChainSource({ kind: "ids", ids: ["M31", "M33", "NGC869", "NGC884", "M45"], label: "Autumn test" }, cat, []);
    expect(resolved.stops.map((s) => s.id)).toEqual(["M31", "M33", "NGC869", "NGC884", "M45"]);
    expect(resolved.stops[2].label).toBe("Double Cluster (NGC 869)");
    const chain = await planChain(base, resolved.stops);
    const status = chain.legs.map((l) => l.status);
    expect(status[0]).toBe("ok");
    expect(status[1]).toBe("ok");
    expect(chain.legs[1].from).toBe("M31");
    // M33 → Double Cluster is ~28°: jump; h → χ Persei is 0.5°: the same field; Double Cluster → Pleiades ~25°: jump.
    expect(chain.legs[2].distanceDeg!).toBeGreaterThan(20);
    expect(status[2]).toBe("jump");
    expect(status[3]).toBe("same-field");
    expect(status[4]).toBe("jump");
    expect(chain.coverage).toBe(1);
    const route = chain.route!;
    // Every stop is reached at its own position, in order, and each leg's last field says so.
    chain.stops.forEach((stop, i) => {
      const hop = route.hops[chain.stopHopIndex[i]];
      const node = chain.nodes.find((n) => n.id === stop.id)!;
      expect(angularDistance(hop.center.ra, hop.center.dec, node.ra, node.dec)).toBeLessThan(1e-6);
      expect(hop.instruction.endsWith(` Stop ${i + 1} reached: ${stop.label}.`)).toBe(true);
      if (i) expect(chain.stopHopIndex[i]).toBeGreaterThan(chain.stopHopIndex[i - 1]);
    });
    // Leg 2 continues from M31's field: the next field is one hop from Andromeda.
    const m31 = chain.stopHopIndex[0];
    expect(route.hops[m31 + 1].distanceDeg).toBeLessThanOrEqual(6.5 * 0.7 + 1e-6);
    for (const leg of chain.legs.filter((l) => l.status === "ok" || l.status === "jump")) expect(leg.hops).toBeLessThanOrEqual(legHopBound(leg.status === "jump" ? 30 : leg.distanceDeg!, 6.5));
    // The chart overlay numbers the stops and frames the current leg.
    const overlay = chainOverlay(chain, chain.stopHopIndex[1])!;
    expect(overlay.stops.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(overlay.routeLeg).toEqual({ start: chain.stopHopIndex[0], end: chain.stopHopIndex[1] });
    expect(chainOverlay(chain, chain.stopHopIndex[1])).toBe(overlay);
  }, 120_000);

  it("resolves plain BSC stars and curated stars to one routing id and display name", async () => {
    const cat = await loadCatalog();
    const resolved = await resolveChainSource({ kind: "ids", ids: ["star:HR1017", "HR2061", "moon:Tycho", "NOPE-1"] }, cat, []);
    expect(resolved.stops.map((s) => s.id)).toEqual(["HR1017", "STAR-Betelgeuse", "NOPE-1"]);
    expect(resolved.stops[0].label).toMatch(/^Mirfak/);
    expect(resolved.stops[1].label).toMatch(/^Betelgeuse/);
  }, 60_000);

  it("hops to a KB-only journey stop (not in the hop catalogs) through extraTargets", async () => {
    const cat = await loadCatalog();
    // RW Cephei (HD 212466, mag ~6.6): a journey stop that is neither a unified target nor a BSC star.
    const rwCep = { id: "HD212466", kind: "star", names: { display: "RW Cephei" }, ra: 335.9, dec: 55.96, mag: 6.6 } as unknown as KbObject;
    const { stops, extraTargets } = journeyChainStops(["DS-DeltaCep", "HD212466", "NGC869"], cat, { kbObject: (id) => (id === rwCep.id ? rwCep : undefined) });
    expect(stops.map((s) => [s.id, s.label])).toEqual([["DS-DeltaCep", expect.stringMatching(/δ Cep/)], ["HD212466", "RW Cephei"], ["NGC869", "Double Cluster (NGC 869)"]]);
    expect(extraTargets).toEqual([{ id: "HD212466", name: "RW Cephei", ra: 335.9, dec: 55.96, mag: 6.6 }]);
    const without = await planChain(base, stops);
    expect(without.legs[1].status).toBe("unresolved");
    const chain = await planChain({ ...base, extraTargets }, stops);
    expect(chain.legs.map((l) => l.status)).not.toContain("unresolved");
    expect(chain.stopHopIndex.every((h) => h >= 0)).toBe(true);
    expect(chain.legs[2].from).toBe("HD212466");
  }, 120_000);

  it("orders a Planner night by its suggested sequence", async () => {
    const cat = await loadCatalog();
    const items = ["M45", "M31", "NGC869", "moon:Tycho"].map((id) => ({ id, addedAt: "2026-11-04T04:00:00.000Z" }));
    const session = makeSession("Nov 3 observing night", new Date("2026-11-04T04:00:00Z"), 37.77, -122.42, items);
    const resolved = await resolveChainSource({ kind: "night", sessionId: session.id }, cat, [session]);
    expect(resolved).toMatchObject({ title: "Tonight's plan", noun: "target", total: 3 });
    expect([...resolved.stops.map((s) => s.id)].sort()).toEqual(["M31", "M45", "NGC869"]);
    await expect(resolveChainSource({ kind: "night", sessionId: "gone" }, cat, [session])).rejects.toThrow(/no longer in the Planner/);
  }, 60_000);
});
