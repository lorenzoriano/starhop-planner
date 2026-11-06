import { describe, expect, it } from "vitest";
import { skylineTargetWindow } from "../BinocularGuide";
import { targetWindow, visibilityWindow } from "@/lib/target-visibility";
import { eqToHorizontal } from "@/lib/astronomy";

const timezone = "America/Los_Angeles", lat = 37.7749, lon = -122.4194;
const night = visibilityWindow("2026-11-08", "12:00", "12:00", "night", timezone, lat, lon);
if (!night.ok) throw new Error("no night");
const M31 = { ra: 10.6847, dec: 41.269 };
const lookup = (alt: number[]) => (az: number) => alt[Math.round(((az % 360) + 360) % 360) % 360];
const wallAt = (from: number, to: number, height: number) => lookup(Array.from({ length: 360 }, (_, az) => (az >= from && az <= to ? height : -5)));

describe("Binoculars tab: highest clear altitude over the window", () => {
  it("with a low skyline the clear maximum matches the flat window to sampling accuracy", () => {
    const flat = targetWindow(M31.ra, M31.dec, lat, lon, night);
    const clear = skylineTargetWindow(M31.ra, M31.dec, lat, lon, night, wallAt(0, -1, 0), flat);
    expect(clear.max).toBeCloseTo(flat.max, 6);
    expect(+clear.bestAt).toBe(+flat.bestAt);
  });
  it("a skyline wall where the target culminates moves the best time to a clear moment", () => {
    const flat = targetWindow(M31.ra, M31.dec, lat, lon, night);
    const culminationAz = eqToHorizontal(M31.ra, M31.dec, lat, lon, flat.bestAt).az;
    // A wall 90° high over ±15° around the culmination azimuth.
    const skyline = lookup(Array.from({ length: 360 }, (_, az) => { const d = Math.abs(((az - culminationAz + 540) % 360) - 180); return d <= 15 ? 90 : -5; }));
    const clear = skylineTargetWindow(M31.ra, M31.dec, lat, lon, night, skyline, flat);
    expect(clear.max).toBeLessThan(flat.max);
    expect(clear.max).toBeGreaterThan(0);
    const at = eqToHorizontal(M31.ra, M31.dec, lat, lon, clear.bestAt);
    expect(Math.abs(((at.az - culminationAz + 540) % 360) - 180)).toBeGreaterThan(15);
    // A skyline it never clears: −90 (hidden by any altitude limit of 0° or more) and the flat best time.
    const never = skylineTargetWindow(M31.ra, M31.dec, lat, lon, night, wallAt(0, 359, 90), flat);
    expect(never).toEqual({ max: -90, min: -90, bestAt: flat.bestAt });
  });
});
