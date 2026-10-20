import { describe, expect, it } from "vitest";
import type { UnifiedTarget } from "../astronomy";
import { angularSizeLabel, meanSurfaceBrightnessLabel, targetDesignation } from "../catalog-presentation";

const target: UnifiedTarget = {
  id: "AST-Coathanger", name: "Coathanger", displayName: "Coathanger", aliases: ["Cr 399"],
  mag: 3.6, ra: 0, dec: 0, con: "Vul", category: "Asterism", categoryShort: "Asterism", source: "binocular", size: "60",
};

describe("catalog presentation", () => {
  it("labels bare catalog sizes as arcminutes and shows a degree equivalent", () => {
    expect(angularSizeLabel("50")).toBe("50′ (0.8°)");
    expect(angularSizeLabel("12.0′")).toBe("12′ (0.2°)");
  });

  it("uses readable designations without exposing internal IDs", () => {
    expect(targetDesignation(target)).toBe("Cr 399");
    expect(targetDesignation({ ...target, aliases: [], id: "AST-Coathanger" })).toBe("");
  });

  it("shows approximate mean surface brightness only for diffuse targets with dimensions", () => {
    expect(meanSurfaceBrightnessLabel({ ...target, id: "M101", name: "Pinwheel Galaxy", category: "Spiral Galaxy", source: "messier", size: "22′", mag: 7.9 })).toMatch(/Approx\. mean surface brightness .* mag\/arcsec²/);
    expect(meanSurfaceBrightnessLabel(target)).toBeUndefined();
  });
});
