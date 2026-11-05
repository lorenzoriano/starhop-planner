import { describe, expect, it } from "vitest";
import type { Star, UnifiedTarget } from "../astronomy";
import type { KbObject } from "../journeys/types";
import { displayName, hrOf, startStarFor, kbToUnifiedTarget, NOOP_ACTIONS, objectKey, objectName, resolveObject, sameObject, toKbId, toRoutingId, toSessionId } from "../object-links";

const target = (id: string, name: string, extra: Partial<UnifiedTarget> = {}): UnifiedTarget =>
  ({ id, name, displayName: name, mag: 4, ra: 10, dec: 20, con: "Per", category: "Open Cluster", categoryShort: "Open Cl.", source: "binocular", ...extra });
const targets = [
  target("STAR-Betelgeuse", "Betelgeuse", { aliases: ["α Ori"], category: "Star", ra: 88.79, dec: 7.41 }),
  target("NGC869", "Double Cluster (h Per)", { aliases: ["NGC 869"] }),
  target("M42", "Orion Nebula", { source: "messier", aliases: ["NGC1976"] }),
  target("NGC7209", "NGC 7209"),
];
const stars: Star[] = [
  { id: "HR2061", hr: 2061, ra: 88.79, dec: 7.41, mag: 0.5, name: "Betelgeuse", bayer: "α", constellation: "Ori" },
  { id: "HR1017", hr: 1017, ra: 51.08, dec: 49.86, mag: 1.79, name: "Mirfak", bayer: "α", constellation: "Per" },
];

describe("object ids", () => {
  it("treats STAR-Betelgeuse, HR2061 and star:HR2061 as one object", () => {
    for (const id of ["STAR-Betelgeuse", "HR2061", "star:HR2061"]) {
      expect(objectKey(id)).toBe("STAR-Betelgeuse");
      expect(toRoutingId(id)).toBe("STAR-Betelgeuse");
      expect(toSessionId(id)).toBe("STAR-Betelgeuse");
      expect(toKbId(id)).toBe("STAR-Betelgeuse");
      expect(hrOf(id)).toBe(2061);
    }
    expect(sameObject("HR2061", "star:HR2061")).toBe(true);
  });
  it("maps plain BSC stars to HR<n> for routing/KB and star:HR<n> for sessions, idempotently", () => {
    expect(toRoutingId("star:HR1017")).toBe("HR1017");
    expect(toSessionId("HR1017")).toBe("star:HR1017");
    expect(toKbId("star:HR1017")).toBe("HR1017");
    for (const f of [toRoutingId, toSessionId, toKbId]) for (const id of ["HR1017", "star:HR1017", "M42", "NGC869", "STAR-Vega", "HD209458"]) expect(f(f(id)!)).toBe(f(id));
  });
  it("passes other ids through, resolves legacy aliases and keeps lunar features out of routing and the KB", () => {
    expect(toRoutingId("M42")).toBe("M42");
    expect(toSessionId("DS-16Cyg")).toBe("DS-16Dra");
    expect(toRoutingId("moon:tycho")).toBeNull();
    expect(toKbId("moon:tycho")).toBeNull();
    expect(toSessionId("moon:tycho")).toBe("moon:tycho");
  });
  it("resolves any form against the catalogs, preferring the unified target", () => {
    expect(resolveObject("star:HR2061", { targets, stars })).toMatchObject({ unifiedId: "STAR-Betelgeuse", hr: 2061, routingId: "STAR-Betelgeuse", sessionId: "STAR-Betelgeuse", name: "Betelgeuse" });
    expect(resolveObject("HR1017", { targets, stars })).toEqual({ hr: 1017, routingId: "HR1017", sessionId: "star:HR1017", kbId: "HR1017", name: "Mirfak", ra: 51.08, dec: 49.86, mag: 1.79 });
    expect(resolveObject({ id: "HD99999", hr: 1017 }, { targets, stars })).toMatchObject({ routingId: "HR1017", kbId: "HD99999" });
    expect(resolveObject("M42", { targets, stars })).toMatchObject({ unifiedId: "M42", routingId: "M42", sessionId: "M42", kbId: "M42" });
    expect(resolveObject("HD209458", { targets, stars })).toBeNull();
    expect(resolveObject("moon:tycho", { targets, stars })).toBeNull();
  });
});

describe("display names", () => {
  it("gives one label per object: common name with its designation, the rest as also-known-as", () => {
    expect(displayName(targets[1])).toBe("Double Cluster (NGC 869)");
    expect(objectName(targets[1]).alsoKnownAs).toEqual(["h Per"]);
    expect(displayName(targets[0])).toBe("Betelgeuse (α Ori)");
    expect(displayName(targets[2])).toBe("Orion Nebula (M42)");
    expect(objectName(targets[2]).alsoKnownAs).toEqual(["NGC 1976"]);
    expect(displayName(targets[3])).toBe("NGC 7209");
    expect(displayName(stars[1])).toBe("Mirfak (α Per)");
    expect(displayName({ id: "NGC869", names: { display: "Double Cluster (h Persei)", designation: "NGC 869", aliases: ["h Persei", "Caldwell 14"] } })).toBe("Double Cluster (NGC 869)");
    expect(objectName({ id: "NGC869", names: { display: "Double Cluster (h Persei)", designation: "NGC 869", aliases: ["h Persei", "Caldwell 14"] } }).alsoKnownAs).toEqual(["h Persei", "Caldwell 14"]);
  });
  it("never labels a named star by its HR number (curated STAR-* targets)", () => {
    expect(displayName(target("STAR-Capella", "Capella", { aliases: ["α Aur"], category: "Star" }))).toBe("Capella (α Aur)");
    const hrOnly = objectName(target("STAR-Vega", "Vega", { aliases: ["HR 7001"], category: "Star" }));
    expect(hrOnly.label).toBe("Vega");
    expect(hrOnly.alsoKnownAs).toEqual(["HR 7001"]);
    expect(displayName({ id: "HR1708", hr: 1708, ra: 79, dec: 46, mag: 0.1, name: "Capella", bayer: "α", constellation: "Aur" })).toBe("Capella (α Aur)");
    expect(displayName({ id: "HR9999", hr: 9999, ra: 79, dec: 46, mag: 6 })).toBe("HR 9999");
  });
  it("does not repeat a Bayer name as its designation", () => {
    expect(displayName({ id: "HR7056", names: { display: "ζ Lyrae", designation: "ζ Lyr", aliases: [] } })).toBe("ζ Lyrae");
    expect(displayName({ id: "HR7056", names: { display: "Zeta Lyrae", designation: "ζ Lyr", aliases: [] } })).toBe("Zeta Lyrae");
    expect(displayName({ id: "HR1", names: { display: "δ² Lyrae", designation: "δ² Lyr", aliases: [] } })).toBe("δ² Lyrae");
  });
  it("keeps a distinguishing parenthesis when there is no designation", () => {
    expect(displayName(target("AST-X", "Double Cluster (χ Per)"))).toBe("Double Cluster (χ Per)");
  });
});

describe("kbToUnifiedTarget", () => {
  const dso = { id: "NGC7209", kind: "dso", dsoClass: "open-cluster", names: { display: "NGC 7209", aliases: ["Cr 444"] }, mag: 7.7, ra: 331.2, dec: 46.5, con: "Lac", extent: { majorArcmin: 25, sourceId: "x" }, facts: {} } as unknown as KbObject;
  const darkNebula = { ...dso, id: "DN-Pipe", dsoClass: "dark-nebula", mag: null, extent: undefined, facts: { angularSizeArcmin: { value: 420 } } } as unknown as KbObject;
  it("converts a KB record exactly as the journey engine rates it", () => {
    expect(kbToUnifiedTarget(dso)).toEqual({ id: "NGC7209", name: "NGC 7209", displayName: "NGC 7209", aliases: ["Cr 444"], mag: 7.7, ra: 331.2, dec: 46.5, con: "Lac", category: "Open Cluster", categoryShort: "Open Cluster", source: "binocular", size: "25×25′" });
    expect(kbToUnifiedTarget(darkNebula)).toMatchObject({ mag: 99, category: "Dark Nebula", size: "420×420′" });
    expect(kbToUnifiedTarget(darkNebula, { missingMag: 6 }).mag).toBe(6);
  });
  it("prefers the real unified target when one is given", () => {
    expect(kbToUnifiedTarget(dso, { targets })).toBe(targets[3]);
    const hrStar = { ...dso, id: "HR2061", kind: "star", hr: 2061 } as unknown as KbObject;
    expect(kbToUnifiedTarget(hrStar, { targets })).toBe(targets[0]);
  });
});

describe("startStarFor", () => {
  it("starts on a naked-eye BSC star itself, else the brightest one within 1.5 fields, else lets Star hop choose", () => {
    const betelgeuse = resolveObject("STAR-Betelgeuse", { targets, stars })!;
    expect(startStarFor(betelgeuse, stars, 3.7)).toBe("HR2061");
    expect(startStarFor({ ra: 52, dec: 49, mag: 7 }, stars, 3.7)).toBe("HR1017");
    expect(startStarFor({ ra: 200, dec: -40, mag: 7 }, stars, 3.7)).toBeUndefined();
    expect(startStarFor({ ra: 51.08, dec: 49.86, mag: 5, hr: 1017 }, stars, 3.7, 1)).toBeUndefined();
  });
});

it("NOOP_ACTIONS is inert", () => {
  expect(NOOP_ACTIONS.isInNight("M42")).toBe(false);
  expect(() => { NOOP_ACTIONS.hop("M42"); NOOP_ACTIONS.addToNight(["M42"]); NOOP_ACTIONS.journey({ key: "k", stop: 1 }); }).not.toThrow();
});

it("every unified catalog target has a label without a bare HR number (real catalogs)", async () => {
  const { readFileSync } = await import("node:fs");
  const { buildUnifiedTargets } = await import("../astronomy");
  const binocular = JSON.parse(readFileSync("client/public/data/binocular-catalog.json", "utf8"));
  const unified = buildUnifiedTargets([], binocular);
  const stars = unified.filter((t) => t.id.startsWith("STAR-"));
  expect(stars.length).toBeGreaterThanOrEqual(16);
  for (const t of stars) expect(displayName(t)).not.toMatch(/HR\s*\d/);
  expect(displayName(unified.find((t) => t.id === "STAR-Capella")!)).toBe("Capella (α Aur)");
});
