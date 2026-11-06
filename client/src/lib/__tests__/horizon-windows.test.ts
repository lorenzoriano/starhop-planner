import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { eqToHorizontal, type UnifiedTarget } from "../astronomy";
import type { CompactHorizon } from "../horizon/profile";
import { darkWindowEnd, nextSkylineClear, nightAltitudeSamples, skylineWithMinimum, targetDayEvents, targetSkylineEvents, visibilityWindow } from "../target-visibility";
import * as Astro from "astronomy-engine";
import { observationAt, observationProfile, suggestedObservation } from "../observing-profile";
import { moonFreeTargetWindows, nearestMoonFreeTargetTime, upcomingNights } from "../upcoming-nights";
import { makeSession, skylineHoldReason, suggestSequence } from "../session-planner";

/** Synthetic geometric skyline: `height`° from azimuth `from` to `to` (inclusive), 0° elsewhere. */
const wall = (from: number, to: number, height: number): CompactHorizon =>
  ({ kind: "geometric", stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => (i >= from && i <= to ? height : 0)) });
const sf = { lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles" };
const target = (id: string, ra: number, dec: number): UnifiedTarget =>
  ({ id, name: id, displayName: id, ra, dec, con: "", mag: 5, category: "Open Cluster", categoryShort: "OC", source: "messier" });
const m31 = { ...target("M31", 10.68, 41.27), category: "Spiral Galaxy" };
// Transits due south at about 42° around local midnight in November.
const southern = target("S", 45, -10);
// Sets in the west-southwest (geometric set azimuth ≈ 257°).
const western = target("W", 300, -10);

describe("local horizon: target windows and rise/set", () => {
  it("adds azimuth to night samples", () => {
    const night = visibilityWindow("2026-11-08", "12:00", "12:00", "night", sf.timezone, sf.lat, sf.lon);
    const samples = nightAltitudeSamples(m31.ra, m31.dec, sf.lat, sf.lon, night).flatMap((s) => s.samples);
    for (const s of samples) expect(s.az).toBeCloseTo(eqToHorizontal(m31.ra, m31.dec, sf.lat, sf.lon, s.date).az, 10);
  });

  it("has no skyline events without a horizon", () => {
    const day = targetDayEvents(western.ra, western.dec, sf.lat, sf.lon, new Date("2026-11-08T20:00:00Z"), sf.timezone);
    expect(targetSkylineEvents(western.ra, western.dec, sf.lat, sf.lon, day.start, day.end, null)).toBeNull();
    expect(skylineWithMinimum(undefined, 30)).toBeNull();
  });

  it("finds when a target goes behind a western wall, before its geometric set, to the minute", () => {
    const day = targetDayEvents(western.ra, western.dec, sf.lat, sf.lon, new Date("2026-11-08T20:00:00Z"), sf.timezone);
    const h = wall(200, 260, 20);
    const events = targetSkylineEvents(western.ra, western.dec, sf.lat, sf.lon, day.start, day.end, h)!;
    expect(events.hide).not.toBeNull();
    expect(+events.hide!).toBeLessThan(+day.set!);
    const pos = (ms: number) => eqToHorizontal(western.ra, western.dec, sf.lat, sf.lon, new Date(ms));
    expect(pos(+events.hide! - 60_000).alt).toBeGreaterThan(20);
    expect(pos(+events.hide! + 60_000).alt).toBeLessThan(20);
    expect(pos(+events.hide!).az).toBeGreaterThanOrEqual(200);
    // A flat 0° skyline clears at the geometric rise and hides at the geometric set.
    const flat = targetSkylineEvents(western.ra, western.dec, sf.lat, sf.lon, day.start, day.end, wall(0, -1, 0))!;
    expect(Math.abs(+flat.clear! - +day.rise!)).toBeLessThan(60_000);
    expect(Math.abs(+flat.hide! - +day.set!)).toBeLessThan(60_000);
  });

  it("splits a moon-free window around a wall and otherwise matches the flat result", () => {
    const base = { ...sf, date: new Date("2026-11-08T20:00:00Z"), target: southern, days: 3, minAltitude: 30 as const };
    const flat = moonFreeTargetWindows(base);
    expect(moonFreeTargetWindows({ ...base, horizon: null })).toEqual(flat);
    // A 0° skyline takes the horizon path and agrees with the flat search to about a second.
    const zero = moonFreeTargetWindows({ ...base, horizon: wall(0, -1, 0) });
    expect(zero).toHaveLength(flat.length);
    zero.forEach((w, i) => {
      expect(Math.abs(+w.start - +flat[i].start)).toBeLessThan(2000);
      expect(Math.abs(+w.end - +flat[i].end)).toBeLessThan(2000);
    });
    const split = moonFreeTargetWindows({ ...base, horizon: wall(170, 190, 60) });
    expect(split).toHaveLength(flat.length * 2);
    for (const w of split) {
      const mid = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, new Date((+w.start + +w.end) / 2));
      expect(mid.alt).toBeGreaterThanOrEqual(30);
      expect(mid.az < 170 || mid.az > 190).toBe(true);
    }
    // The nearest usable time falls inside a clear window.
    const nearest = nearestMoonFreeTargetTime({ ...base, horizon: wall(170, 190, 60) })!;
    const at = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, nearest);
    expect(at.az < 170 || at.az > 190).toBe(true);
  });

  it("counts good target hours only when clear of the skyline", () => {
    const base = { ...sf, date: new Date("2026-11-08T20:00:00Z"), days: 2, targets: [southern], selected: southern };
    const flat = upcomingNights(base);
    expect(upcomingNights({ ...base, horizon: null })).toEqual(flat);
    const blocked = upcomingNights({ ...base, horizon: wall(0, 359, 80) });
    for (const night of blocked) {
      expect(night.selectedTarget!.goodAltitudeHours).toBe(0);
      expect(night.selectedTarget!.bestAt).toBeNull();
      expect(night.feasibleTargetCount).toBe(0);
    }
    const partial = upcomingNights({ ...base, horizon: wall(170, 190, 60) });
    partial.forEach((night, i) => {
      expect(night.selectedTarget!.goodAltitudeHours).toBeLessThan(flat[i].selectedTarget!.goodAltitudeHours);
      if (night.selectedTarget!.bestAt) {
        const best = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, night.selectedTarget!.bestAt);
        expect(best.alt).toBeGreaterThanOrEqual(30);
        expect(best.az < 170 || best.az > 190).toBe(true);
      }
    });
  });

  it("marks samples behind the skyline and never suggests them", () => {
    const night = visibilityWindow("2026-11-08", "12:00", "12:00", "night", sf.timezone, sf.lat, sf.lon);
    const flat = observationProfile(southern, sf.lat, sf.lon, night, 21.6);
    expect(flat.flatMap((s) => s.samples).every((s) => !("blocked" in s))).toBe(true);
    const h = wall(150, 210, 60);
    const samples = observationProfile(southern, sf.lat, sf.lon, night, 21.6, undefined, h).flatMap((s) => s.samples);
    expect(samples.some((s) => s.blocked)).toBe(true);
    const best = suggestedObservation(samples, southern)!;
    expect(best.blocked).toBe(false);
    expect(best.az < 150 || best.az > 210).toBe(true);
    const flatBest = suggestedObservation(flat.flatMap((s) => s.samples), southern)!;
    expect(observationAt(southern, sf.lat, sf.lon, flatBest.date, 21.6, undefined, h).blocked).toBe(true);
  });
});

describe("local horizon: session planner", () => {
  const start = new Date("2026-10-19T04:00:00Z");
  const session = () => {
    const s = makeSession("Hills", start, sf.lat, sf.lon, [{ id: "M31", addedAt: start.toISOString(), notes: "" }]);
    s.durationMinutes = 240;
    return s;
  };

  it("is unchanged without a horizon", () => {
    expect(suggestSequence(session(), [m31], 21.6, null)).toEqual(suggestSequence(session(), [m31], 21.6));
  });

  it("waits until the target clears the hills and says why", () => {
    // M31 starts at 55° in the northeast; a 75° ridge from azimuth 40° to 100° hides it for the first two hours.
    const h = wall(40, 100, 75);
    const [step] = suggestSequence(session(), [m31], 21.6, h);
    expect(step.date).not.toBeNull();
    expect(step.reason).toMatch(/^Behind the hills to the (northeast|east) until \d\d:\d\d$/);
    const until = step.reason.match(/(\d\d:\d\d)$/)![1];
    // The first minute it clears the ridge (alt ≥ 75° or outside azimuth 40–101°).
    let first = +start;
    for (;; first += 60_000) {
      const p = eqToHorizontal(m31.ra, m31.dec, sf.lat, sf.lon, new Date(first));
      if (p.alt >= 75 || p.az < 40 || p.az > 101) break;
    }
    expect([first - 60_000, first].map((ms) => formatInTimeZone(new Date(ms), sf.timezone, "HH:mm"))).toContain(until);
    expect(+step.date!).toBeGreaterThanOrEqual(first - 60_000);
    for (const at of [step.date!, new Date(+step.date! + 15 * 60_000)]) {
      const p = eqToHorizontal(m31.ra, m31.dec, sf.lat, sf.lon, at);
      expect(p.alt >= 75 || p.az < 40 || p.az > 101).toBe(true);
    }
  });

  it("does not schedule a target that stays behind the skyline", () => {
    const h = wall(0, 359, 89);
    const [step] = suggestSequence(session(), [m31], 21.6, h);
    expect(step.date).toBeNull();
    expect(step.reason).toMatch(/^Stays behind the hills to the \w+ tonight$/);
    expect(skylineHoldReason(session(), "M31", m31, null, start, new Date(+start + 3600_000))).toBeNull();
  });
});

describe("local horizon: when a hidden target next clears the skyline tonight", () => {
  // 21:00 in San Francisco; S rises in the east-southeast and is low there now.
  const at = new Date("2026-11-09T05:00:00Z");
  const sunAlt = (d: Date) => {
    const o = new Astro.Observer(sf.lat, sf.lon, 0), eq = Astro.Equator(Astro.Body.Sun, d, o, true, true);
    return Astro.Horizon(d, o, eq.ra, eq.dec).altitude;
  };
  const blocked = (h: CompactHorizon, d: Date) => {
    const p = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, d);
    return p.alt < h.alt[Math.floor(((p.az % 360) + 360) % 360)];
  };

  it("ends the dark window at astronomical dawn", () => {
    const dawn = darkWindowEnd(sf.lat, sf.lon, at);
    expect(+dawn).toBeGreaterThan(+at);
    expect(+dawn - +at).toBeLessThan(12 * 3600_000);
    expect(sunAlt(dawn)).toBeCloseTo(-18, 1);
    expect(sunAlt(new Date(+dawn - 10 * 60_000))).toBeLessThan(-18);
  });

  it("finds the clearing time before dawn, minute-consistent with targetSkylineEvents", () => {
    const pos = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, at);
    const h = wall(Math.floor(pos.az) - 10, Math.floor(pos.az) + 25, Math.ceil(pos.alt) + 8);
    expect(blocked(h, at)).toBe(true);
    const t = nextSkylineClear(southern.ra, southern.dec, sf.lat, sf.lon, at, h);
    expect(t).toBeInstanceOf(Date);
    const clears = t as Date;
    expect(+clears).toBeGreaterThan(+at);
    expect(+clears).toBeLessThan(+darkWindowEnd(sf.lat, sf.lon, at));
    expect(blocked(h, new Date(+clears - 5_000))).toBe(true);
    expect(blocked(h, new Date(+clears + 5_000))).toBe(false);
    // Another view samples the night from a different start: the same HH:mm (no off-by-one minute).
    const other = targetSkylineEvents(southern.ra, southern.dec, sf.lat, sf.lon, new Date(+at - 3 * 3600_000 - 17 * 60_000), new Date(+at + 9 * 3600_000), h)!;
    const same = other.clears.find((c) => Math.abs(+c - +clears) < 60_000)!;
    expect(same).toBeDefined();
    expect(formatInTimeZone(same, sf.timezone, "HH:mm")).toBe(formatInTimeZone(clears, sf.timezone, "HH:mm"));
    expect(Math.abs(+same - +clears)).toBeLessThan(2_000);
  });

  it("says 'after-dawn' when it stays hidden through the dark window, null without a skyline", () => {
    const pos = eqToHorizontal(southern.ra, southern.dec, sf.lat, sf.lon, at);
    const h = wall(Math.floor(pos.az) - 10, Math.floor(pos.az) + 25, Math.ceil(pos.alt) + 8);
    // The dark window ends before it clears.
    expect(nextSkylineClear(southern.ra, southern.dec, sf.lat, sf.lon, at, h, new Date(+at + 10 * 60_000))).toBe("after-dawn");
    // A skyline it never clears tonight.
    expect(nextSkylineClear(southern.ra, southern.dec, sf.lat, sf.lon, at, wall(0, 359, 60))).toBe("after-dawn");
    expect(nextSkylineClear(southern.ra, southern.dec, sf.lat, sf.lon, at, null)).toBeNull();
  });
});
