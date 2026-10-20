import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildUnifiedTargets, loadBinocularTargets, loadMessier, loadStars } from "../astronomy";
import { catalogSearchDiagnostics, catalogSearchScore, deduplicateCatalogMatches } from "../catalog-search";
import { starPlanningTarget } from "../session-planner";

vi.stubGlobal("fetch", async (input: string) => new Response(
  readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"),
  { status: 200, headers: { "Content-Type": "application/json" } },
));
afterAll(() => vi.unstubAllGlobals());

let planningTargets: ReturnType<typeof buildUnifiedTargets>;
beforeAll(async () => {
  const [messier, binocular, stars] = await Promise.all([loadMessier(), loadBinocularTargets(), loadStars()]);
  planningTargets = [...buildUnifiedTargets(messier, binocular), ...stars.map(starPlanningTarget)];
});

describe("real catalog search regressions", () => {
  it("ranks the Andromeda Galaxy first for the reported typo", () => {
    const ranked = planningTargets.map(target => ({ target, score: catalogSearchScore(target, "andromda") }))
      .filter(match => Number.isFinite(match.score))
      .sort((a, b) => a.score - b.score || a.target.name.localeCompare(b.target.name));
    expect(ranked[0]?.target.id).toBe("M31");
    expect(catalogSearchScore(planningTargets.find(target => target.name === "10 And")!, "andromda")).toBe(Infinity);
  });

  it.each(["Vega", "Sirius", "Betelgeuse", "Mizar"])("deduplicates catalog copies for %s", name => {
    const matches = planningTargets.map(target => ({ target, score: catalogSearchScore(target, name) }))
      .filter(match => Number.isFinite(match.score));
    const unique = deduplicateCatalogMatches(matches);
    expect(unique.filter(match => match.target.category === "Star" && match.target.name.toLowerCase().includes(name.toLowerCase()))).toHaveLength(1);
    if (name === "Mizar") expect(unique.some(match => match.target.name === "1 CMi")).toBe(false);
  });

  it("finds the Owl Cluster in the bundled binocular catalog", () => {
    const owl = planningTargets.find(target => target.id === "NGC457")!;
    expect(catalogSearchScore(owl, "owl cluster")).toBeLessThan(Infinity);
  });

  it("distinguishes a real catalog match hidden by filters from a missing name", () => {
    const all = planningTargets;
    const visible = all.filter(target => target.id !== "M42");
    expect(catalogSearchDiagnostics("orion nebula", all, visible).kind).toBe("filtered");
    expect(catalogSearchDiagnostics("zzzz", all).kind).toBe("no-match");
  });
});
