/**
 * The shared sky model (lib/sky-feasibility.ts). Golden values: every number equals what the journey engine,
 * the Planner sequence, the Moon tab and Tonight used before r5, so moving them here changed no output.
 */
import { describe, expect, it } from "vitest";
import type { UnifiedTarget } from "../astronomy";
import { KITE_14X50 } from "../binocular-assessment";
import * as conditions from "../journeys/conditions";
import { moonIllumination, moonIlluminationLabel, moonState, scatteredMoonlight, targetMoonlight } from "../moon";
import { rankTargets, rankTonight, skyConditions, TONIGHT_PENALTY } from "../observing";
import { visibilityWindow } from "../target-visibility";
import {
  BRIGHT_STELLAR_MAG, GLOW_LIMIT, GLOW_REFERENCE_SKY, MIN_ALT, MOONLIGHT_LEVELS, TWILIGHT, darkEnough, minAltitude,
  moonCategoryOfCategory, moonGlow, moonIsUp, moonMinSeparation, moonVerdict, moonlightLevel, plannerMoonWeight,
  skyFeasibility, twilightLimit,
} from "../sky-feasibility";

const SF = { lat: 37.77, lon: -122.42 };
const FULL = new Date("2027-01-22T07:00:00Z"); // full Moon high over San Francisco
const REVIEW = new Date("2026-11-04T04:30:00Z"); // r5 review night, 20:30 PST

const target = (id: string, category: string, mag: number, ra: number, dec: number, size?: string): UnifiedTarget =>
  ({ id, name: id, displayName: id, mag, ra, dec, con: "Ori", category, categoryShort: category, source: "binocular", ...(size ? { size } : {}) });

describe("golden constants (pre-r5 values)", () => {
  it("altitude: journeys 30 / 20 / 25, Planner 15, lunar 5", () => {
    expect(MIN_ALT).toEqual({ possible: 15, comfortable: 30, journeyFloor: 20, journeyFallback: 25, lunar: 5 });
    expect(conditions.DEFAULT_MIN_ALT).toBe(30);
    expect(conditions.FLOOR_MIN_ALT).toBe(20);
    expect(conditions.FALLBACK_MIN_ALT).toBe(25);
    expect(minAltitude("possible")).toBe(15);
    expect(minAltitude("comfortable")).toBe(30);
  });
  it("twilight: journeys star −12 / DSO −18; Planner mag ≤ 5 stellar −6, else −18", () => {
    expect(TWILIGHT).toEqual({ civil: -6, nautical: -12, astronomical: -18 });
    expect(conditions.SUN_LIMIT_STAR).toBe(-12);
    expect(conditions.SUN_LIMIT_DSO).toBe(-18);
    expect(twilightLimit({ stellar: true, mag: 7 }, "comfortable")).toBe(-12);
    expect(twilightLimit({ stellar: false, mag: 1 }, "comfortable")).toBe(-18);
    expect(BRIGHT_STELLAR_MAG).toBe(5);
    expect(twilightLimit({ stellar: true, mag: 5 }, "possible")).toBe(-6);
    expect(twilightLimit({ stellar: true, mag: 5.01 }, "possible")).toBe(-18);
    expect(twilightLimit({ stellar: true, mag: null }, "possible")).toBe(-18);
    expect(twilightLimit({ stellar: false, mag: 3 }, "possible")).toBe(-18);
    expect(darkEnough(-6, { stellar: true, mag: 2 }, "possible")).toBe(true);
    expect(darkEnough(-5.9, { stellar: true, mag: 2 }, "possible")).toBe(false);
  });
  it("Moon: glow limits 0.7 / 1.2 / 2.5, reference sky 20.0, separation max(15, 10 + 30·k)", () => {
    expect(GLOW_LIMIT).toEqual({ diffuse: 0.7, cluster: 1.2, star: 2.5 });
    expect(conditions.GLOW_LIMIT).toBe(GLOW_LIMIT);
    expect(GLOW_REFERENCE_SKY).toBe(20);
    expect(conditions.GLOW_REFERENCE_SKY).toBe(20);
    for (const k of [0, 0.1, 1 / 6, 0.5, 0.9, 1]) expect(moonMinSeparation(k)).toBe(Math.max(15, 10 + 30 * k));
    expect(conditions.moonMinSeparation).toBe(moonMinSeparation);
    expect(conditions.moonGlow).toBe(moonGlow);
    expect(MOONLIGHT_LEVELS).toEqual({ little: 0.3, some: 1, brightened: 2 });
  });
  it("Planner moon weights 14 / 2 / 6", () => {
    expect(plannerMoonWeight("Spiral Galaxy", 3)).toBe(14);
    expect(plannerMoonWeight("Star Cloud", 4)).toBe(14);
    expect(plannerMoonWeight("Star", 5)).toBe(2);
    expect(plannerMoonWeight("Asterism", 4.5)).toBe(2);
    expect(plannerMoonWeight("Star", 6)).toBe(6);
    expect(plannerMoonWeight("Open Cluster", 3)).toBe(6);
  });
});

describe("moonVerdict", () => {
  const moon = moonState(SF.lat, SF.lon, FULL);
  it("matches the engine's old per-sample check exactly", () => {
    expect(moonIsUp(moon)).toBe(true);
    for (const sky of [18.5, 20, 21.5]) for (const sep of [5, 20, 45, 90, 150]) for (const alt of [10, 35, 70]) for (const category of ["diffuse", "cluster", "star"] as const) {
      const v = moonVerdict({ alt, separation: sep, category }, moon, sky);
      const glow = scatteredMoonlight(moon, alt, sep, Math.min(sky, 20)).brightening;
      expect(v.glow).toBe(glow);
      expect(v.brightening).toBe(scatteredMoonlight(moon, alt, sep, sky).brightening);
      const oldOk = !(sep < Math.max(15, 10 + 30 * moon.illumination)) && !(glow > GLOW_LIMIT[category]);
      expect(v.ok).toBe(oldOk);
    }
  });
  it("is always ok with the Moon down", () => {
    const down = moonState(SF.lat, SF.lon, new Date("2027-01-09T05:00:00Z"));
    expect(moonIsUp(down)).toBe(false);
    const v = moonVerdict({ alt: 40, ra: down.ra, dec: down.dec, category: "diffuse" }, down, 21.5);
    expect(v).toMatchObject({ moonUp: false, ok: true, glow: 0, brightening: 0, level: "Moon below horizon" });
  });
  it("computes the separation from ra/dec when not given", () => {
    const v = moonVerdict({ alt: 50, ra: moon.ra + 3, dec: moon.dec, category: "star" }, moon, 21);
    expect(v.separation).toBeGreaterThan(2);
    expect(v.separation).toBeLessThan(3.1);
    expect(v.tooClose).toBe(true);
  });
  it("Moon-tab levels are the old wording", () => {
    expect([0, 0.29, 0.3, 0.99, 1, 1.99, 2, 5].map((b) => moonlightLevel(b, true))).toEqual(
      ["Little moonlight", "Little moonlight", "Some moonlight", "Some moonlight", "Brightened sky", "Brightened sky", "Strong moonlight", "Strong moonlight"]);
    expect(moonlightLevel(3, false)).toBe("Moon below horizon");
  });
  it("targetMoonlight keeps its level and flags (golden grid)", () => {
    const m42 = target("M42", "Emission Nebula", 4, 83.82, -5.39, "85×60′");
    const betel = target("STAR-Betelgeuse", "Star", 0.5, 88.79, 7.41);
    for (const t of [m42, betel]) for (const at of [FULL, REVIEW, new Date("2027-01-22T12:00:00Z")]) {
      const r = targetMoonlight(t, SF.lat, SF.lon, at, 21);
      const old = r.moon.alt <= -r.moon.diameter / 2 ? "Moon below horizon" : r.brightening < 0.3 ? "Little moonlight" : r.brightening < 1 ? "Some moonlight" : r.brightening < 2 ? "Brightened sky" : "Strong moonlight";
      expect(r.level).toBe(old);
      expect(r.diffuse).toBe(/galaxy|nebula|cloud/i.test(t.category));
      expect(r.stars).toBe(/star|asterism/i.test(t.category));
    }
  });
  it("category of unified targets: diffuse first, then stellar, else cluster", () => {
    expect(moonCategoryOfCategory("Star Cloud")).toBe("diffuse");
    expect(moonCategoryOfCategory("Double Star")).toBe("star");
    expect(moonCategoryOfCategory("Globular Cluster")).toBe("cluster");
  });
  it("skyFeasibility combines altitude, twilight and Moon under one rule", () => {
    const reviewMoon = moonState(SF.lat, SF.lon, REVIEW);
    const f = skyFeasibility({ alt: 20, stellar: false, mag: 4, category: "cluster", ra: 0, dec: 0 }, reviewMoon, 21, "possible");
    expect(f.altitudeOk).toBe(true);
    expect(skyFeasibility({ alt: 20, stellar: false, mag: 4, category: "cluster", ra: 0, dec: 0 }, reviewMoon, 21, "comfortable").altitudeOk).toBe(false);
  });
});

describe("one Moon illumination", () => {
  it("every tab's number at one instant is the same rounding of the same fraction", () => {
    for (const at of [REVIEW, FULL, new Date("2026-11-04T08:00:00Z")]) {
      const shared = moonIllumination(at);
      expect(skyConditions(SF.lat, SF.lon, at).illumination).toBe(shared.percent); // Tonight selected panel
      expect(Math.round(moonState(SF.lat, SF.lon, at).illumination * 100)).toBe(shared.percent); // Moon tab, night card
      expect(shared.label).toBe(`${shared.percent}% lit`);
    }
  });
  it("the 24 % / 26 % split was two instants: the selected time and the middle of the dark window", () => {
    // Tonight's selected panel and the Moon tab read the selected time (20:30 PST: 26 %); the night card
    // (NightAltitudeChart) and Upcoming nights read the middle of astronomical darkness (23:53 PST: 24 %).
    const night = visibilityWindow("2026-11-03", "12:00", "12:00", "night", "America/Los_Angeles", SF.lat, SF.lon);
    if (!night.ok) throw new Error("no night");
    const dark = night.segments[0];
    const middle = new Date((+dark.start + +dark.end) / 2);
    expect(moonIllumination(REVIEW).percent).toBe(26);
    expect(moonIllumination(middle).percent).toBe(24);
    expect(moonIlluminationLabel(middle, "America/Los_Angeles", { withTime: true })).toBe("Moon 24% lit at 23:53");
    expect(moonIlluminationLabel(REVIEW, "America/Los_Angeles")).toBe("Moon 26% lit");
  });
});

describe("rankTonight (Tonight's Best on the shared model)", () => {
  const targets = [
    target("M42", "Emission Nebula", 4, 83.82, -5.39, "85×60′"),
    target("M45", "Open Cluster", 1.6, 56.75, 24.12, "110×110′"),
    target("M31", "Spiral Galaxy", 3.4, 10.68, 41.27, "190×60′"),
    target("NGC869", "Open Cluster", 5.3, 34.75, 57.13, "29×29′"),
    target("STAR-Betelgeuse", "Star", 0.5, 88.79, 7.41),
    target("M57", "Planetary Nebula", 8.8, 283.4, 33.03, "1.4×1′"),
  ];
  it("keeps rankTargets' score when the Moon is down, it is dark and every rating is excellent", () => {
    const at = new Date("2027-01-09T07:00:00Z");
    const plain = rankTargets(targets, SF.lat, SF.lon, at, "telescope");
    const tonight = rankTonight(targets, SF.lat, SF.lon, at, "telescope", { skyBrightness: 21 });
    for (const t of tonight) {
      const p = plain.find((x) => x.target.id === t.target.id)!;
      expect(t.moon.moonUp).toBe(false);
      expect(t.rating).toBeNull();
      expect(t.score).toBeCloseTo(p.score - (t.darkEnough ? 0 : TONIGHT_PENALTY.twilight), 9);
    }
  });
  it("pushes diffuse objects near a bright Moon down and reports the same verdict the engine uses", () => {
    const moon = moonState(SF.lat, SF.lon, FULL);
    const tonight = rankTonight(targets, SF.lat, SF.lon, FULL, "binocular", { skyBrightness: 21, profile: KITE_14X50, moon });
    const m42 = tonight.find((t) => t.target.id === "M42")!;
    expect(m42.moon.moonUp).toBe(true);
    expect(m42.moon.glow).toBe(moonGlow(moon, m42.alt, m42.moon.separation, 21));
    const betel = tonight.find((t) => t.target.id === "STAR-Betelgeuse")!;
    expect(tonight.indexOf(betel)).toBeLessThan(tonight.indexOf(m42));
    expect(tonight.every((t) => t.rating !== null || t.alt <= 0)).toBe(true);
    for (let i = 1; i < tonight.length; i++) expect(tonight[i - 1].score).toBeGreaterThanOrEqual(tonight[i].score);
  });
  it("feasible = altitude, twilight and Moon under the rule", () => {
    const tonight = rankTonight(targets, SF.lat, SF.lon, REVIEW, "binocular", { skyBrightness: 20.5, profile: KITE_14X50 });
    for (const t of tonight) expect(t.feasible).toBe(t.alt >= 15 && t.darkEnough && t.moon.ok);
    const strict = rankTonight(targets, SF.lat, SF.lon, REVIEW, "binocular", { skyBrightness: 20.5, profile: KITE_14X50, rule: "comfortable" });
    for (const t of strict) if (t.feasible) expect(t.alt).toBeGreaterThanOrEqual(30);
  });
});
