import { beforeAll, describe, expect, it } from "vitest";
import { clockSeason, type ClockSeason } from "../astronomical-clock";
import { eqToHorizontal } from "../astronomy";
import { targetDayEvents } from "../target-visibility";
import { resolveLocalMoment } from "../session";
import {
  altitudeBand,
  densityOpacity,
  monthlyTrajectories,
  trajectoryCellDates,
  trajectoryDensity,
  trajectorySector,
  type SeasonTrajectory,
} from "../season-trajectories";
const targets = [
  { id: "AST-Coathanger", name: "Coathanger", ra: 291.5, dec: 20.1 },
  { id: "M42", name: "Orion Nebula", ra: 83.82, dec: -5.39 },
  { id: "M31", name: "Andromeda Galaxy", ra: 10.685, dec: 41.269 },
  { id: "star:HR424", name: "Polaris", ra: 37.95, dec: 89.264 },
];
const site = { lat: 37.77, lon: -122.42, zone: "America/Los_Angeles" };
let year: ClockSeason;
beforeAll(() => {
  year = clockSeason({
    ...site,
    targets,
    from: "2026-01-01",
    to: "2026-12-31",
    minAlt: 30,
    minSeparation: 30,
  });
}, 30000);
describe("seasonal altitude and time distribution", () => {
  it("preserves different summer, winter and autumn evening trajectories", () => {
    const alt = (day: string, object: number) => {
      const track = year.trajectories.find((t) => t.day === day)!;
      return track.alt[object][track.hour.indexOf(21.25)];
    };
    expect(alt("2026-07-15", 0)).toBeGreaterThan(30);
    expect(alt("2026-01-15", 0)).toBeLessThan(0);
    expect(alt("2026-01-15", 1)).toBeGreaterThan(35);
    expect(alt("2026-07-15", 1)).toBeLessThan(0);
    expect(alt("2026-10-15", 2)).toBeGreaterThan(50);
    expect(alt("2026-04-15", 2)).toBeLessThan(10);
    // Raw geometry is retained even when it fails an observing-hour threshold.
    expect(
      year.trajectories.some((t) =>
        t.alt[0].some((a, i) => a < 0 && !t.qualified[0][i]),
      ),
    ).toBe(true);
  });
  it("keeps continuous Moon contrast separate from a hard separation cutoff for every seasonal target", () => {
    let rejectedButUseful = 0;
    for (const day of year.days) day.available.forEach((available, i) => {
      expect(day.contrast[i]).toBeGreaterThanOrEqual(0);
      expect(day.contrast[i]).toBeLessThanOrEqual(available + 1e-9);
      expect(day.hours[i]).toBeLessThanOrEqual(available);
      if (available === 0) expect(day.contrast[i]).toBe(0);
      if (day.hours[i] === 0 && day.contrast[i] > .1) rejectedButUseful++;
    });
    // These dates previously fell to zero solely because of a distance threshold.
    expect(rejectedButUseful).toBeGreaterThan(0);
    targets.forEach((_,i)=>expect(year.days.some(day=>day.available[i]>0)).toBe(true));
  });
  it("retains real instants for seasonal cursor readouts, including the next civil day", () => {
    for(const track of year.trajectories.filter(t=>['2026-03-07','2026-10-31','2026-10-15'].includes(t.day))) {
      expect(track.ms).toHaveLength(track.hour.length);
      track.ms!.forEach((ms,i)=>{
        if(i) expect(ms-track.ms![i-1]).toBe(30*60000);
        const position=eqToHorizontal(targets[2].ra,targets[2].dec,site.lat,site.lon,new Date(ms));
        expect(position.alt).toBeCloseTo(track.alt[2][i],8);
      });
    }
    expect(densityOpacity(.05)).toBeCloseTo(.05,8);
  });
  it("places Polaris in a narrow band near latitude, never at the zenith", () => {
    const alts = year.trajectories.flatMap((t) => t.alt[3]);
    expect(Math.min(...alts)).toBeGreaterThan(36);
    expect(Math.max(...alts)).toBeLessThan(39);
    expect(Math.max(...alts) - Math.min(...alts)).toBeLessThan(2);
    const density = trajectoryDensity(year.trajectories, 3, "all");
    density.forEach((row) => {
      expect(row[altitudeBand(37.77)]).toBeCloseTo(1, 8);
      expect(row.at(-1)).toBe(0);
    });
    expect(
      targetDayEvents(
        targets[3].ra,
        targets[3].dec,
        site.lat,
        site.lon,
        new Date("2026-01-15"),
        site.zone,
      ).alwaysUp,
    ).toBe(true);
  });
  it("normalizes each local half hour independently and keeps darkness separate from raw geometry", () => {
    for (let object = 0; object < targets.length; object++) {
      const all = trajectoryDensity(year.trajectories, object, "all"),
        dark = trajectoryDensity(year.trajectories, object, "dark"),
        qualified = trajectoryDensity(year.trajectories, object, "qualified");
      all.forEach((row, time) => {
        expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
        row.forEach((v, alt) => {
          expect(dark[time][alt]).toBeLessThanOrEqual(v + 1e-12);
          expect(qualified[time][alt]).toBeLessThanOrEqual(
            dark[time][alt] + 1e-12,
          );
        });
      });
    }
  });
  it("retains exact catalog geometry at every seasonal representative sample", () => {
    for (const track of monthlyTrajectories(year.trajectories)) {
      targets.forEach((target, index) => {
        const sample = track.hour.indexOf(21.25),
          at = resolveLocalMoment(track.day, "21:15", site.zone)!;
        expect(track.alt[index][sample]).toBeCloseTo(
          eqToHorizontal(target.ra, target.dec, site.lat, site.lon, at).alt,
          8,
        );
      });
      expect(track.day.slice(8)).toBe("15");
    }
    expect(monthlyTrajectories(year.trajectories)).toHaveLength(12);
  });
  it("retains actual DST samples and handles a repeated wall hour without double-counting a date", () => {
    expect(
      year.trajectories.find((t) => t.day === "2026-10-31")!.hour,
    ).toHaveLength(50);
    expect(
      year.trajectories.find((t) => t.day === "2026-03-07")!.hour,
    ).toHaveLength(46);
    const repeated: SeasonTrajectory = {
      day: "2026-10-31",
      hour: [1.25, 1.25],
      alt: [[10, 40]],
      dark: [true, true],
      qualified: [[true, true]],
    };
    const cells = trajectoryDensity([repeated], 0, "all");
    expect(cells[2][altitudeBand(10)]).toBe(0.5);
    expect(cells[2][altitudeBand(40)]).toBe(0.5);
    expect(
      trajectoryCellDates([repeated], 0, "all", 2, altitudeBand(10)),
    ).toEqual(["2026-10-31"]);
  });
  it("selects real matching dates instead of inventing a probability forecast", () => {
    const dates = trajectoryCellDates(
      year.trajectories,
      0,
      "dark",
      42,
      altitudeBand(50),
    );
    expect(dates.length).toBeGreaterThan(0);
    for (const day of dates) {
      const t = year.trajectories.find((t) => t.day === day)!;
      expect(
        t.hour.some(
          (h, i) =>
            Math.floor(h * 2) === 42 &&
            altitudeBand(t.alt[0][i]) === altitudeBand(50) &&
            t.dark[i],
        ),
      ).toBe(true);
    }
  });
});
describe("seasonal edge cases", () => {
  it("keeps northern Polaris below the Sydney horizon and rejects it from qualified hours", () => {
    const result = clockSeason({
      targets,
      lat: -33.87,
      lon: 151.21,
      zone: "Australia/Sydney",
      from: "2026-10-15",
      to: "2026-10-15",
      minAlt: 0,
      minSeparation: 0,
    });
    expect(result.trajectories[0].alt[3].every((a) => a < 0)).toBe(true);
    expect(result.days[0].hours[3]).toBe(0);
    expect(
      trajectoryDensity(result.trajectories, 3, "qualified")
        .flat()
        .every((v) => v === 0),
    ).toBe(true);
    expect(
      trajectoryDensity(result.trajectories, 3, "all")
        .flat()
        .some((v) => v > 0),
    ).toBe(true);
  });
  it("preserves geometry during polar daylight without fabricating dark trajectories", () => {
    const result = clockSeason({
      targets,
      lat: 89,
      lon: 0,
      zone: "Etc/UTC",
      from: "2026-06-21",
      to: "2026-06-21",
      minAlt: 30,
      minSeparation: 30,
    });
    expect(
      trajectoryDensity(result.trajectories, 3, "dark")
        .flat()
        .every((v) => v === 0),
    ).toBe(true);
    expect(
      trajectoryDensity(result.trajectories, 3, "all")
        .flat()
        .some((v) => v > 0),
    ).toBe(true);
    expect(result.trajectories[0].alt[3].every((a) => a > 87)).toBe(true);
  });
  it("supports short and leap-day intervals with no missing monthly representative", () => {
    const result = clockSeason({
      ...site,
      targets,
      from: "2028-02-29",
      to: "2028-03-01",
      minAlt: 30,
      minSeparation: 30,
    });
    expect(monthlyTrajectories(result.trajectories).map((t) => t.day)).toEqual([
      "2028-02-29",
      "2028-03-01",
    ]);
    expect(altitudeBand(-90)).toBe(0);
    expect(altitudeBand(90)).toBe(35);
    expect(densityOpacity(0)).toBe(0);
    expect(densityOpacity(1)).toBe(1);
    expect(trajectorySector(23.5, 24, -90, -85)).not.toMatch(/NaN|Infinity/);
  });
});
