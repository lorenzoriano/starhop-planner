import { describe, expect, it } from "vitest";
import { angularDistance } from "../astronomy";
import { angularRing, chartHopDirection, RETICLE_DIAMETERS } from "../finder-view";
import { chartPreferencesSchema } from "../../components/ChartPreferences";

describe("finder reticles", () => {
  it("uses the actual Telrad and QuickFinder diameters", () => {
    expect(RETICLE_DIAMETERS.telrad).toEqual([0.5, 2, 4]);
    expect(RETICLE_DIAMETERS.rigel).toEqual([0.5, 2]);
  });
  it("keeps every ring point at its angular radius across RA zero and the pole", () => {
    for (const center of [{ ra:359.8, dec:20 }, { ra:48, dec:87 }, { ra:250, dec:90 }]) {
      for (const diameter of RETICLE_DIAMETERS.telrad) {
        const points = angularRing(center, diameter / 2);
        for (const point of points) expect(angularDistance(center.ra, center.dec, point.ra, point.dec)).toBeCloseTo(diameter / 2, 6);
        expect(angularDistance(points[0].ra, points[0].dec, points.at(-1)!.ra, points.at(-1)!.dec)).toBeLessThan(1e-5);
      }
    }
  });
  it("migrates existing display preferences without resetting their orientation", () => {
    const old = { labelSize:18, starBrightness:7, navStarSize:5, showLegend:true, showGhostCircles:false, showConstellations:true, mirrored:true, rotation:90, starsOnly:false };
    expect(chartPreferencesSchema.parse(old)).toEqual({ ...old, finderReticle:"field" });
    expect(chartPreferencesSchema.safeParse({ ...old, finderReticle:"unknown" }).success).toBe(false);
  });
});

describe("directions in the matched chart", () => {
  const frame = { ra:10, dec:0 }, north = { ra:10, dec:1 }, west = { ra:9, dec:0 };
  it("keeps north and west consistent with the displayed compass", () => {
    expect(chartHopDirection(frame,north,frame,false,0)).toEqual({direction:"up",clock:12});
    expect(chartHopDirection(frame,west,frame,false,0)).toEqual({direction:"right",clock:3});
    expect(chartHopDirection(frame,north,frame,false,180)).toEqual({direction:"down",clock:6});
    expect(chartHopDirection(frame,west,frame,false,180)).toEqual({direction:"left",clock:9});
  });
  it("reflects before rotation, including combined diagonal orientations", () => {
    expect(chartHopDirection(frame,west,frame,true,0)).toEqual({direction:"left",clock:9});
    expect(chartHopDirection(frame,west,frame,true,90)).toEqual({direction:"up",clock:12});
    expect(chartHopDirection(frame,north,frame,true,270)).toEqual({direction:"left",clock:9});
  });
  it("does not invent a move for the starting field or a point behind the projection", () => {
    expect(chartHopDirection(frame,frame,frame,false,0)).toBeNull();
    expect(chartHopDirection(frame,{ra:190,dec:0},frame,false,0)).toBeNull();
  });
});
