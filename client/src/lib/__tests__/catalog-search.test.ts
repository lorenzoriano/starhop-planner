import { describe, expect, it } from "vitest";
import type { UnifiedTarget } from "../astronomy";
import { catalogSearchScore, deduplicateCatalogMatches, lunarSearchHint, unsupportedPlanetMessage } from "../catalog-search";

const target = (id: string, name: string, category = "Open Cluster", aliases: string[] = []): UnifiedTarget => ({
  id, name, displayName: `${id} — ${name}`, aliases, mag: 5, ra: 0, dec: 0,
  con: "Per", category, categoryShort: category, source: "binocular",
});

const targets = [
  target("M42", "Orion Nebula", "Diffuse Nebula"),
  target("AST-Coathanger", "Coathanger", "Asterism"),
  target("NGC869", "Double Cluster · h Persei", "Open Cluster"),
  target("NGC884", "Double Cluster · chi Persei", "Open Cluster"),
  target("M45", "Pleiades", "Open Cluster"),
  target("M31", "Andromeda Galaxy", "Galaxy"),
  target("Saturn-Nebula", "Saturn Nebula", "Planetary Nebula"),
  target("NGC3242", "Ghost of Jupiter", "Planetary Nebula"),
];

const score = (query: string, id: string) => catalogSearchScore(targets.find(item => item.id === id)!, query);

describe("catalogSearchScore", () => {
  it("keeps exact catalog identifiers ahead of names, aliases and partial matches", () => {
    expect(score("M42", "M42")).toBe(0);
    expect(score("Orion Nebula", "M42")).toBe(1);
    expect(score("Orion", "M42")).toBe(3);
  });

  it("recognizes common names and catalog aliases", () => {
    expect(score("Orion Nebula", "M42")).toBeLessThan(Infinity);
    expect(score("Brocchi", "AST-Coathanger")).toBeLessThan(Infinity);
    expect(score("Collinder 399", "AST-Coathanger")).toBeLessThan(Infinity);
    expect(score("Cr399", "AST-Coathanger")).toBeLessThan(Infinity);
    expect(score("h Persei", "NGC869")).toBeLessThan(Infinity);
    expect(score("chi Persei", "NGC884")).toBeLessThan(Infinity);
    expect(score("Seven Sisters", "M45")).toBeLessThan(Infinity);
    expect(score("Pleiades", "M45")).toBeLessThan(Infinity);
  });

  it("corrects short spelling errors in longer catalog words", () => {
    expect(Number.isFinite(score("plaeides", "M45"))).toBe(true);
    expect(Number.isFinite(score("andromda", "M31"))).toBe(true);
    expect(score("plaeides", "M45")).toBeGreaterThan(score("M45", "M45"));
  });

  it("does not mistake an exact planet request for a deep-sky name", () => {
    expect(score("Saturn", "Saturn-Nebula")).toBe(Infinity);
    expect(score("Jupiter", "NGC3242")).toBe(Infinity);
    expect(unsupportedPlanetMessage("Saturn")).toMatch(/planet/i);
    expect(unsupportedPlanetMessage("Saturn Nebula")).toBeUndefined();
  });

  it("points lunar landmark searches toward the Moon view", () => {
    expect(lunarSearchHint("Tycho crater")).toMatch(/lunar landmarks/i);
    expect(lunarSearchHint("Andromeda")).toBeUndefined();
  });
});

it("keeps distinct neighboring stars while collapsing copies of one named star",()=>{
 const a=target("star:1","Alpha","Star"),b={...target("star:2","Beta","Star"),ra:.001},copy={...a,id:"STAR-Alpha",ra:.0001};
 expect(deduplicateCatalogMatches([a,b,copy].map(target=>({target,score:1}))).map(match=>match.target.id)).toEqual(["star:1","star:2"]);
});
