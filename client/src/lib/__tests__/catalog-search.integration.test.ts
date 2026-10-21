import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildUnifiedTargets, loadBinocularTargets, loadMessier, loadStars } from "../astronomy";
import { catalogSearchDiagnostics, catalogSearchScore, searchCatalog, deduplicateCatalogMatches } from "../catalog-search";
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

  it("does not pad exact Mizar searches with fuzzy names or the Cigar Galaxy", () => {
    const matches=searchCatalog(planningTargets,"mizar");
    expect(matches.map(m=>m.target.name)).toEqual(expect.arrayContaining(["Mizar","Mizar & Alcor"]));
    expect(matches[0].target.name).toBe("Mizar");
    expect(matches.every(match=>match.score<=5)).toBe(true);
  });

  it("keeps the curated Mizar & Alcor entry without Cigar Galaxy filler", () => {
    const matches=searchCatalog(planningTargets.filter(target=>target.category!=="Star"),"mizar");
    expect(matches).toHaveLength(1);
    expect(matches[0].target.name).toMatch(/Mizar/);
    expect(matches.some(match=>match.target.id==="M82")).toBe(false);
  });

  it.each([["andromda","M31"],["orion nebula","M42"],["h persei","NGC869"],["brocchi's","AST-Coathanger"],["owl cluster","NGC457"]])("preserves %s aliases and typos", (query,id) => {
    expect(searchCatalog(planningTargets,query)[0]?.target.id).toBe(id);
  });

  it("explains the specific filter hiding a known target", () => {
    const result=catalogSearchDiagnostics("Vega",planningTargets,[],()=>"It is 10° high, below the 15° limit of “Above 15°”.");
    expect(result.kind).toBe("filtered");
    expect(result.message).toContain("Vega was found.");
    expect(result.message).toContain("10° high");
    expect(result.message).toContain("Above 15°");
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

it("keeps catalog prefixes alongside an exact M3 result",()=>{
 const ids=searchCatalog(planningTargets,"m3").map(m=>m.target.id);
 expect(ids[0]).toBe("M3");expect(ids).toContain("M31");expect(ids).toContain("M33");
});
