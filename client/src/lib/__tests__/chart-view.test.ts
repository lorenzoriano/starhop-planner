import { describe, expect, it } from "vitest";
import { chartFrame, projectChartPoint, skyZenith } from "../chart-view";
import { eqToHorizontal, stereographicProject } from "../astronomy";
import { chartPreferencesSchema } from "../../components/ChartPreferences";

describe("shared sky chart projection", () => {
  const kochab = { ra: 222.676, dec: 74.155 };
  const polaris = { ra: 37.954, dec: 89.264 };
  const pherkad = { ra: 230.182, dec: 71.834 };
  it("follows a polar route by translation, preserving star separation and orientation", () => {
    const frame = chartFrame([kochab, polaris]);
    const pair = (focus: typeof kochab) => {
      const a = projectChartPoint(polaris, frame, focus, 8)!;
      const b = projectChartPoint(pherkad, frame, focus, 8)!;
      return { x: b.x - a.x, y: b.y - a.y };
    };
    expect(pair(kochab).x).toBeCloseTo(pair(polaris).x, 10);
    expect(pair(kochab).y).toBeCloseTo(pair(polaris).y, 10);
    // A changing tangent frame (the previous behavior) visibly turns this pair.
    const oldPair = (focus: typeof kochab) => {
      const a = stereographicProject(polaris.ra, polaris.dec, focus.ra, focus.dec, 8)!;
      const b = stereographicProject(pherkad.ra, pherkad.dec, focus.ra, focus.dec, 8)!;
      return { x: b.x - a.x, y: b.y - a.y };
    };
    expect(Math.hypot(oldPair(kochab).x - oldPair(polaris).x, oldPair(kochab).y - oldPair(polaris).y)).toBeGreaterThan(50);
  });
  it("centers the selected hop without changing the fixed frame", () => {
    const frame = chartFrame([kochab, polaris]);
    expect(projectChartPoint(polaris, frame, polaris, 8)).toEqual({ x: 0, y: 0 });
  });
  it("places a field crossing RA zero at zero rather than the opposite sky", () => {
    const center = chartFrame([{ ra: 359, dec: 20 }, { ra: 1, dec: 20 }]);
    expect(Math.min(center.ra, 360 - center.ra)).toBeLessThan(1e-8);
    expect(center.dec).toBeCloseTo(20, 1);
  });
  it("computes the actual zenith for an overhead chart in either hemisphere", () => {
    const at = new Date("2026-10-16T04:00:00Z");
    for (const [lat, lon] of [[37.77, -122.42], [-33.87, 151.21]]) {
      const p = skyZenith(lat, lon, at);
      expect(eqToHorizontal(p.ra, p.dec, lat, lon, at).alt).toBeCloseTo(90, 0);
      expect(p.ra).toBeGreaterThanOrEqual(0);
      expect(p.ra).toBeLessThan(360);
    }
  });
  it("rejects points behind the fixed projection rather than drawing false coordinates", () => {
    expect(projectChartPoint({ ra: 180, dec: 0 }, { ra: 0, dec: 0 }, { ra: 0, dec: 0 }, 1)).toBeNull();
  });
  it("validates saved orientation and brightness preferences before using them", () => {
    const settings = { labelSize: 12, starBrightness: 8, navStarSize: 5, showLegend: true, showGhostCircles: true, showConstellations: true, mirrored: true, rotation: 90, starsOnly: false };
    expect(chartPreferencesSchema.safeParse(settings).success).toBe(true);
    expect(chartPreferencesSchema.safeParse({ ...settings, rotation: 17 }).success).toBe(false);
    expect(chartPreferencesSchema.safeParse({ ...settings, starBrightness: 50 }).success).toBe(false);
  });
});
