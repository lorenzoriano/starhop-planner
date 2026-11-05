import { describe, expect, it } from "vitest";
import type { UnifiedTarget } from "../astronomy";
import { BINOCULAR_ENTRIES } from "../binocular-guide";
import { clipSentences, objectSummary, objectSummaryText, SUMMARY_MAX_CHARS } from "../object-info";
import { OBJECT_GUIDES } from "../observing";

const target = (id: string, name: string, extra: Partial<UnifiedTarget> = {}): UnifiedTarget =>
  ({ id, name, displayName: name, mag: 7, ra: 10, dec: 20, con: "Lac", category: "Open Cluster", categoryShort: "Open Cl.", source: "binocular", ...extra });

describe("objectSummary sources", () => {
  it("prefers the curated OBJECT_GUIDES story over the Binoculars guide", () => {
    expect(BINOCULAR_ENTRIES.some((e) => e.targetId === "M45")).toBe(true);
    const s = objectSummary("M45")!;
    expect(s.source).toBe("guide");
    expect(s.text).toBe(OBJECT_GUIDES.M45.story);
    expect(s.lookFor).toBe(OBJECT_GUIDES.M45.lookFor);
  });

  it("falls back to the Binoculars guide impression and finding", () => {
    const entry = BINOCULAR_ENTRIES.find((e) => e.targetId === "M35")!;
    const s = objectSummary("M35")!;
    expect(s.source).toBe("binocular-guide");
    expect(s.text).toBe(entry.impression);
    expect(s.lookFor).toBe(entry.finding);
  });

  it("covers the extra Binoculars guide entries (JSON)", () => {
    expect(objectSummary("NGC7209")?.source).toBe("binocular-guide");
  });

  it("uses the catalog description when it is a real sentence, else the generic line", () => {
    const real = target("DS-Test", "Test Pair", { desc: "Gold and blue color-contrast double", binoTip: "Support the binoculars" });
    expect(objectSummary(real.id, { target: real })).toEqual({ text: "Gold and blue color-contrast double.", lookFor: "Support the binoculars.", source: "catalog" });
    const boiler = target("NGC9999", "NGC 9999", { desc: "Binocular target in the Astronomical League deep-sky program." });
    expect(objectSummary(boiler.id, { target: boiler })).toMatchObject({ text: "NGC 9999 is an open cluster in Lacerta.", source: "generic" });
    const messier = target("M999", "Test", { source: "messier", desc: "Open cluster, 20'", category: "Globular Cluster", con: "Her" });
    expect(objectSummary(messier.id, { target: messier })?.text).toBe("Test (M999) is a globular cluster in Hercules.");
  });

  it("finds the target in `targets`, including star:HR planning targets", () => {
    const star = target("star:HR1017", "Mirfak", { category: "Star", con: "Per", desc: "Position and magnitude from the bundled Bright Star Catalogue." });
    for (const id of ["HR1017", "star:HR1017"]) {
      expect(objectSummary(id, { targets: [star] })).toMatchObject({ source: "generic", text: expect.stringMatching(/^Mirfak.* is a star in Perseus\.$/) });
    }
  });

  it("returns null (and '' text) for an unknown id without a target", () => {
    expect(objectSummary("NGC123456")).toBeNull();
    expect(objectSummaryText("NGC123456")).toBe("");
  });
});

describe("objectSummary identity", () => {
  it("gives every id form of one object the same summary", () => {
    const a = objectSummary("STAR-Betelgeuse"), b = objectSummary("HR2061"), c = objectSummary("star:HR2061");
    expect(a?.source).toBe("binocular-guide");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
  it("resolves legacy alias ids", () => {
    expect(objectSummary("AST-IC37")).toEqual(objectSummary("NGC2169"));
  });
  it("expands constellation codes when the target is known, as on the Binoculars tab", () => {
    const t = target("NGC869", "Double Cluster (h Per)", { con: "Per" });
    const s = objectSummary("NGC869", { target: t })!;
    expect(s.source).toBe("guide");
    const entry = BINOCULAR_ENTRIES.find((e) => /\bPer\b/.test(e.impression + e.finding) && !OBJECT_GUIDES[e.targetId]);
    if (entry) {
      const withTarget = objectSummary(entry.targetId, { target: target(entry.targetId, "x", { con: "Per" }) })!;
      expect(withTarget.text + withTarget.lookFor).not.toMatch(/\bPer\b/);
    }
  });
});

describe("clipSentences", () => {
  it("keeps whole sentences within the cap and always the first one", () => {
    const long = `${"A".repeat(150)}. ${"B".repeat(100)}.`;
    expect(clipSentences(long)).toBe(`${"A".repeat(150)}.`);
    expect(clipSentences("Short one. Two.")).toBe("Short one. Two.");
    const first = `${"C".repeat(SUMMARY_MAX_CHARS + 20)}. Next.`;
    expect(clipSentences(first)).toBe(`${"C".repeat(SUMMARY_MAX_CHARS + 20)}.`);
  });
  it("keeps every shared summary short", () => {
    for (const e of BINOCULAR_ENTRIES) expect(objectSummaryText(e.targetId).length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
  });
});
