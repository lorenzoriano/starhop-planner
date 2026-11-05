import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageFallback, imageCalibrationPrefill, imageTargetFor } from "../ImageFallback";
import type { Star, UnifiedTarget } from "@/lib/astronomy";

const targets = [
  { id: "NGC869", name: "Double Cluster (h Per)", displayName: "Double Cluster (h Per)", ra: 34.75, dec: 57.13, mag: 4.3, con: "Per", category: "Open Cluster", categoryShort: "Open Cluster", source: "binocular" },
] as unknown as UnifiedTarget[];
const stars = [
  { id: "HR2061", hr: 2061, name: "Betelgeuse", bayer: "α", constellation: "Ori", ra: 88.79, dec: 7.41, mag: 0.5 },
] as unknown as Star[];

describe("image page destination", () => {
  it("is empty without an object id (current behaviour)", () => {
    expect(imageTargetFor(undefined, targets, stars)).toBeNull();
    expect(imageTargetFor("NOPE123", targets, stars)).toBeNull();
    const html = renderToStaticMarkup(createElement(ImageFallback));
    expect(html).not.toContain("Destination:");
    expect(html).not.toContain('data-testid="link-image-back"');
    expect(html).toContain("Upload a star chart image to begin");
  });

  it("resolves a unified target with the shared display name", () => {
    const t = imageTargetFor("NGC869", targets, stars)!;
    expect(t).toMatchObject({ id: "NGC869", ra: 34.75, dec: 57.13 });
    expect(t.label).toContain("Double Cluster");
    expect(imageCalibrationPrefill(t)).toEqual({ label: t.label, ra: "34.7500", dec: "57.1300" });
  });

  it("resolves a plain BSC star in any id form", () => {
    for (const id of ["HR2061", "star:HR2061"]) {
      const t = imageTargetFor(id, targets, stars)!;
      expect(t.id).toBe("HR2061");
      expect(t.label).toContain("Betelgeuse");
      expect(t.ra).toBeCloseTo(88.79);
    }
  });

  it("renders the destination and a back link when given", () => {
    const html = renderToStaticMarkup(createElement(ImageFallback, { objectId: "NGC869", targets, stars, back: { label: "Back to tonight", href: "#/" } }));
    expect(html).toContain("Destination:");
    expect(html).toContain("Double Cluster");
    expect(html).toContain('href="#/"');
    expect(html).toContain("Back to tonight");
  });
});
