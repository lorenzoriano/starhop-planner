import { describe, it, expect } from "vitest";
import { eqToHorizontal, angularDistance } from "../astronomy";
import { moonState } from "../moon";
import {
  clockBounds,
  clockSamples,
  clockNightDate,
  clockPoint,
  clockCurve,
  comparisonIds,
  clockSeason,
  seasonDates,
  seasonEligible,
  clockTargetEvents,
  clockMoonEvents,
  clockBehindSkyline,
  type ClockSample,
} from "../astronomical-clock";
import { horizonLookup, type CompactHorizon } from "../horizon/profile";
const zone = "America/Los_Angeles",
  lat = 37.77,
  lon = -122.42;
const targets = [
  { id: "M31", name: "Andromeda", ra: 10.685, dec: 41.269 },
  { id: "M42", name: "Orion", ra: 83.82, dec: -5.39 },
];
describe("astronomical clock", () => {
  it("uses actual noon-to-noon elapsed time through DST and assigns early morning to the previous night", () => {
    expect(
      (+clockBounds("2026-10-31", zone).end -
        +clockBounds("2026-10-31", zone).start) /
        3600000,
    ).toBe(25);
    expect(
      (+clockBounds("2026-03-07", zone).end -
        +clockBounds("2026-03-07", zone).start) /
        3600000,
    ).toBe(23);
    expect(clockNightDate(new Date("2026-10-20T12:00Z"), zone)).toBe(
      "2026-10-19",
    );
    expect(clockNightDate(new Date("2026-10-20T20:00Z"), zone)).toBe(
      "2026-10-20",
    );
  });
  it("plots midnight at top, noon at bottom and below-horizon objects inside the horizon ring", () => {
    expect(clockPoint(0, 90)).toEqual({ x: 320, y: 66 });
    expect(clockPoint(12, 90).y).toBe(574);
    expect(clockPoint(6, 0).x).toBe(447);
    expect(clockPoint(6, -45).x).toBeLessThan(447);
    expect(clockPoint(6, -90).x).toBe(320);
  });
  it("shares real Sun and Moon states across independent object curves", () => {
    const samples = clockSamples(targets, lat, lon, "2026-10-19", zone, 60);
    expect(samples.length).toBeGreaterThan(25);
    expect(samples[0].hour).toBe(12);
    expect(samples.some((s) => s.hour === 0)).toBe(true);
    for (const s of samples) {
      const at = new Date(s.ms),
        moon = moonState(lat, lon, at);
      expect(s.sun).toBe(moon.sunAlt);
      expect(s.moon).toBe(moon.alt);
      expect(s.lit).toBe(moon.illumination);
      targets.forEach((t, i) => {
        expect(s.alt[i]).toBeCloseTo(
          eqToHorizontal(t.ra, t.dec, lat, lon, at).alt,
          8,
        );
        expect(s.separation[i]).toBeCloseTo(
          angularDistance(t.ra, t.dec, moon.ra, moon.dec),
          8,
        );
      });
    }
    expect(samples.some((s) => s.sun <= -18)).toBe(true);
    expect(samples.some((s) => Math.abs(s.alt[0] - s.alt[1]) > 20)).toBe(true);
  });
  it("breaks a polar curve at a DST wall-clock discontinuity", () => {
    const samples = clockSamples([], lat, lon, "2026-10-31", zone, 10),
      path = clockCurve(samples, (s) => s.moon);
    expect((path.match(/M/g) || []).length).toBe(2);
    expect(path).not.toContain("NaN");
  });
  it("retains exact twilight bounds and next-day events within the displayed night", () => {
    const samples = clockSamples(targets, lat, lon, "2026-10-19", zone),
      dark = samples.filter((s) => s.sun <= -18 + 0.0001);
    expect(dark[0].sun).toBeCloseTo(-18, 3);
    expect(dark.at(-1)!.sun).toBeCloseTo(-18, 3);
    const bounds = clockBounds("2026-10-19", zone),
      events = clockTargetEvents(targets[1], lat, lon, "2026-10-19", zone),
      moon = clockMoonEvents(lat, lon, "2026-10-19", zone);
    for (const at of [
      events.rise,
      events.transit,
      events.set,
      moon.rise,
      moon.transit,
      moon.set,
    ])
      if (at) {
        expect(at >= bounds.start && at < bounds.end).toBe(true);
      }
    expect(events.transit).not.toBeNull();
    expect(
      eqToHorizontal(targets[1].ra, targets[1].dec, lat, lon, events.transit!)
        .alt,
    ).toBeGreaterThan(45);
  });
  it("sanitizes persisted selections and keeps at most eight unique IDs", () => {
    expect(comparisonIds(["M31", null, "", "M31", 4, "M42"])).toEqual([
      "M31",
      "M42",
    ]);
    expect(comparisonIds({})).toEqual([]);
    expect(
      comparisonIds(Array.from({ length: 12 }, (_, i) => `M${i}`)),
    ).toHaveLength(8);
  });
});
describe("seasonal clock availability", () => {
  it("bounds a full leap year and rejects invalid or excessive intervals", () => {
    expect(seasonDates("2028-01-01", "2028-12-31")).toHaveLength(366);
    expect(() => seasonDates("2026-02-30", "2026-03-01")).toThrow();
    expect(() => seasonDates("2026-02-01", "2026-01-01")).toThrow();
    expect(() => seasonDates("2026-01-01", "2027-01-02")).toThrow();
  });
  it("requires darkness and altitude at the same time, with Moon-down exemption", () => {
    expect(seasonEligible(60, -18, -5, 5, 50, 60)).toBe(true);
    expect(seasonEligible(60, -17, -5, 90, 50, 60)).toBe(false);
    expect(seasonEligible(49, -20, -5, 90, 50, 60)).toBe(false);
    expect(seasonEligible(60, -20, 10, 59, 50, 60)).toBe(false);
    expect(seasonEligible(60, -20, 10, 60, 50, 60)).toBe(true);
  });
  it("returns no dark availability during polar summer and keeps independent object results", () => {
    const summer = clockSeason({
      targets,
      lat: 89,
      lon: 0,
      zone: "Etc/UTC",
      from: "2026-06-21",
      to: "2026-06-21",
      minAlt: 0,
      minSeparation: 0,
    });
    expect(summer.days[0].hours).toEqual([0, 0]);
    expect(summer.bins.flat().every((v) => v === 0)).toBe(true);
    const night = clockSeason({
      targets: [
        { id: "up", name: "Pole", ra: 0, dec: 89 },
        { id: "down", name: "South", ra: 0, dec: -89 },
      ],
      lat,
      lon,
      zone,
      from: "2026-10-19",
      to: "2026-10-20",
      minAlt: 15,
      minSeparation: 0,
    });
    expect(night.days[0].hours[0]).toBeGreaterThan(8);
    expect(night.days.every((d) => d.hours[1] === 0)).toBe(true);
    expect(night.bins.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

/** Synthetic skyline: `wallAlt` (geometric) for azimuths [from, to], −90 elsewhere (a flat skyline that never binds). */
const wall = (from: number, to: number, wallAlt: number): CompactHorizon => ({
  kind: "geometric",
  stepDeg: 1,
  alt: Array.from({ length: 360 }, (_, az) => (az >= from && az <= to ? wallAlt : -90)),
});
describe("astronomical clock with a local skyline", () => {
  const request = {
    targets,
    lat,
    lon,
    zone,
    from: "2026-12-01",
    to: "2026-12-03",
    minAlt: 0,
    minSeparation: 0,
  };
  it("samples azimuths alongside altitudes", () => {
    const samples = clockSamples(targets, lat, lon, "2026-10-19", zone, 60);
    for (const s of samples)
      targets.forEach((t, i) =>
        expect(s.az[i]).toBeCloseTo(
          eqToHorizontal(t.ra, t.dec, lat, lon, new Date(s.ms)).az,
          8,
        ),
      );
  });
  it("combines the skyline with the minimum altitude and never replaces it", () => {
    for (const skyline of [undefined, null])
      expect(seasonEligible(18, -20, -5, 90, 15, 60, skyline)).toBe(true);
    expect(seasonEligible(18, -20, -5, 90, 15, 60, 20)).toBe(false);
    expect(seasonEligible(22, -20, -5, 90, 15, 60, 20)).toBe(true);
    expect(seasonEligible(10, -20, -5, 90, 15, 60, 5)).toBe(false);
    expect(seasonEligible(10, -20, -5, 90, 0, 60, -3)).toBe(true);
  });
  it("is unchanged without a horizon, or with a skyline that never binds", () => {
    const flat = clockSeason(request);
    expect(clockSeason({ ...request, horizon: null })).toEqual(flat);
    expect(clockSeason({ ...request, horizon: wall(0, 359, -2) })).toEqual(flat);
  });
  it("drops the half hours a target spends behind a wall and leaves other directions alone", () => {
    const flat = clockSeason(request),
      blocked = clockSeason({ ...request, horizon: wall(200, 260, 20) }),
      skyline = horizonLookup(wall(200, 260, 20))!;
    // Orion's nebula sets through the southwest; Andromeda never goes there.
    expect(blocked.days.map((d) => d.hours[0])).toEqual(flat.days.map((d) => d.hours[0]));
    blocked.days.forEach((d, k) => {
      expect(d.hours[1]).toBeLessThan(flat.days[k].hours[1]);
      expect(d.hours[1]).toBeGreaterThan(0);
      expect(d.available[1]).toBeLessThan(flat.days[k].available[1]);
    });
    for (const track of blocked.trajectories)
      track.qualified[1].forEach((q, j) => {
        const at = new Date(track.ms![j]),
          { alt, az } = eqToHorizontal(targets[1].ra, targets[1].dec, lat, lon, at);
        if (q) expect(alt).toBeGreaterThanOrEqual(skyline(az));
      });
    // A wall all around above the target's culmination hides it every night.
    const hidden = clockSeason({ ...request, horizon: wall(0, 359, 89) });
    expect(hidden.days.every((d) => d.hours.every((h) => h === 0))).toBe(true);
  });
  it("splits a polar curve into the stretches clear of the skyline", () => {
    const samples = clockSamples(targets, lat, lon, "2026-12-01", zone, 10),
      skyline = horizonLookup(wall(200, 260, 20));
    const full = clockCurve(samples, (s) => s.alt[1]);
    expect(clockCurve(samples, (s) => s.alt[1], () => true)).toBe(full);
    const behind = samples.filter((s) => clockBehindSkyline(s, 1, skyline));
    expect(behind.length).toBeGreaterThan(0);
    for (const s of behind) {
      expect(s.alt[1]).toBeGreaterThanOrEqual(0);
      expect(s.az[1]).toBeGreaterThanOrEqual(199);
      expect(s.az[1]).toBeLessThanOrEqual(261);
    }
    expect(samples.some((s) => clockBehindSkyline(s, 0, skyline))).toBe(false);
    expect(samples.some((s) => clockBehindSkyline(s, 1, null))).toBe(false);
    const clear = clockCurve(samples, (s) => s.alt[1], (s: ClockSample) => !clockBehindSkyline(s, 1, skyline));
    expect(clear.length).toBeLessThan(full.length);
    expect((clear.match(/M/g) || []).length).toBeGreaterThan((full.match(/M/g) || []).length);
    expect(clear).not.toContain("NaN");
  });
});
