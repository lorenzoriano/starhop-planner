import { describe, it, expect } from "vitest";
import {
  altitudeLabel,
  altitudeSamples,
  compassLabel,
  guideFor,
  orientChartPoint,
  rankTargets,
  skyConditions,
} from "../observing";
import { settingsSchema, defaultSettings, nightListSchema } from "../session";
import type { UnifiedTarget } from "../astronomy";

const andromeda: UnifiedTarget = {
  id: "M31",
  name: "Andromeda",
  displayName: "M31 — Andromeda",
  mag: 3.4,
  ra: 10.68,
  dec: 41.27,
  con: "And",
  category: "Spiral Galaxy",
  categoryShort: "Galaxy",
  source: "messier",
};
const ring: UnifiedTarget = {
  ...andromeda,
  id: "M57",
  name: "Ring Nebula",
  category: "Planetary Nebula",
  categoryShort: "Plan. Neb.",
  ra: 283.4,
  dec: 33.03,
  mag: 8.8,
};
const date = new Date("2026-10-13T04:00:00Z");

describe("observing companion", () => {
  it("distinguishes local daylight from astronomical darkness", () => {
    expect(skyConditions(37.77, -122.42, date).isDark).toBe(true);
    expect(
      skyConditions(37.77, -122.42, new Date("2026-10-12T20:00:00Z")).darkness,
    ).toBe("Daylight");
  });
  it("reports physical Moon illumination and altitude bounds", () => {
    const conditions = skyConditions(-33.9, 151.2, date);
    expect(conditions.illumination).toBeGreaterThanOrEqual(0);
    expect(conditions.illumination).toBeLessThanOrEqual(100);
    expect(conditions.moonAlt).toBeGreaterThanOrEqual(-90);
    expect(conditions.moonAlt).toBeLessThanOrEqual(90);
  });
  it("ranks suitable binocular targets without treating all bright objects as binocular picks", () => {
    const bino = rankTargets(
      [andromeda, ring],
      37.77,
      -122.42,
      date,
      "binocular",
    );
    const scope = rankTargets(
      [andromeda, ring],
      37.77,
      -122.42,
      date,
      "telescope",
    );
    expect(
      bino.find((o) => o.target.id === "M31")!.score -
        scope.find((o) => o.target.id === "M31")!.score,
    ).toBe(15);
    expect(bino.find((o) => o.target.id === "M57")!.score).toBe(
      scope.find((o) => o.target.id === "M57")!.score,
    );
    expect(guideFor(ring).binocular).toBe(false);
  });
  it("identifies objects that never rise at a selected location", () => {
    const south = { ...andromeda, id: "south", dec: -80 };
    expect(rankTargets([south], 70, 0, date, "binocular")[0].alt).toBeLessThan(
      0,
    );
    expect(altitudeLabel(-5)).toBe("Below horizon");
  });
  it("samples exactly eight hours across midnight without resetting the date", () => {
    const samples = altitudeSamples(andromeda, 37.77, -122.42, date);
    expect(samples).toHaveLength(33);
    expect(samples[32].date.getTime() - samples[0].date.getTime()).toBe(
      8 * 60 * 60 * 1000,
    );
    expect(samples.every((s) => Number.isFinite(s.alt))).toBe(true);
  });
  it("wraps compass bearings at north", () => {
    expect(compassLabel(359)).toBe("N");
    expect(compassLabel(-90)).toBe("W");
    expect(compassLabel(450)).toBe("E");
  });
  it("mirrors and rotates positions while preserving distances", () => {
    expect(orientChartPoint({ x: -10, y: 0 }, true, 0)).toEqual({
      x: 10,
      y: 0,
    });
    const p = orientChartPoint({ x: 0, y: -10 }, false, 90);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
    const q = orientChartPoint({ x: 3, y: 4 }, true, 270);
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(5);
  });
});
describe("saved session validation", () => {
  it("rejects out of range or corrupt saved observing settings", () => {
    expect(settingsSchema.safeParse(defaultSettings).success).toBe(true);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, lat: 200 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, fov: 0 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, date: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, time: "25:99" }).success,
    ).toBe(false);
    expect(settingsSchema.safeParse({ mode: "unknown" }).success).toBe(false);
  });
  it("preserves field notes and observation timestamps through JSON storage", () => {
    const list = [
      {
        id: "M31",
        addedAt: date.toISOString(),
        observedAt: date.toISOString(),
        notes: "Faint oval glow, brighter core.",
      },
    ];
    expect(nightListSchema.parse(JSON.parse(JSON.stringify(list)))).toEqual(
      list,
    );
    expect(nightListSchema.safeParse([{ id: "M31", notes: 12 }]).success).toBe(
      false,
    );
  });
});
