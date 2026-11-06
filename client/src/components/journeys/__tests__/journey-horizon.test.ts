import { describe, expect, it } from "vitest";
import { eqToHorizontal } from "@/lib/astronomy";
import { compactHorizon, horizonFingerprint } from "@/lib/horizon/profile";
import type { HorizonProfile, LocalHorizon } from "@/lib/horizon/types";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import { conditionNotes, nightEvents, type ConditionsInput } from "../conditions-explainer";
import {
  altitudeHelpText, COMPASS8, controlsFromPrefs, indexObjects, journeyRequestFor, journeyRequestKey, openSkyToStore, stopAltitudeState, terrainDirections, terrainHint,
} from "../journey-view";
import { tonightJourneyRequest } from "../use-tonight-journeys";

const SF = { lat: 37.77, lon: -122.42, tz: "America/Los_Angeles" };
const AT = new Date("2027-01-15T04:30:00Z");
const objects = indexObjects(FIXTURE_KB);

/** Terrain layer: `high`° (apparent) between az `from` and `to` (wrapping), `low`° elsewhere. */
function terrain(from: number, to: number, high: number, low = 0): LocalHorizon {
  const inside = (az: number) => (from <= to ? az >= from && az <= to : az >= from || az <= to);
  const profile: HorizonProfile = { kind: "terrain", stepDeg: 1, alt: Array.from({ length: 360 }, (_, az) => (inside(az) ? high : low)), lat: SF.lat, lon: SF.lon, computedAt: "2026-11-01T00:00:00Z", source: "test" };
  return { terrain: profile };
}

describe("open directions seeded from the terrain", () => {
  const ridgeNW = terrain(285, 345, 40);
  it("closes a direction only where the hills rise above the lowest stop altitude", () => {
    expect(terrainDirections(ridgeNW, 30)).toEqual({ blocked: ["NW"], open: ["N", "NE", "E", "SE", "S", "SW", "W"] });
    expect(terrainDirections(ridgeNW, 40).open).toBeUndefined();
    expect(terrainDirections(terrain(200, 260, 20), 30)).toEqual({ blocked: [], open: undefined });
    expect(terrainDirections(null, 30)).toEqual({ blocked: [], open: undefined });
    // Walled in all around: no seed (the engine's exact skyline check does the work).
    expect(terrainDirections(terrain(0, 359, 50), 30).open).toBeUndefined();
    expect(terrainHint(["NW"])).toBe("Hills block the northwest from here.");
    expect(terrainHint(["W", "NW"])).toBe("Hills block the west and northwest from here.");
    expect(terrainHint([])).toBeNull();
  });
  it("seeds the default until the user chooses; a manual choice always wins", () => {
    const site = "37.77,-122.42";
    expect(controlsFromPrefs({}, site).openDirections).toEqual(COMPASS8);
    expect(controlsFromPrefs({}, site, ridgeNW).openDirections).toEqual(["N", "NE", "E", "SE", "S", "SW", "W"]);
    expect(controlsFromPrefs({ openSky: { [site]: COMPASS8 } }, site, ridgeNW).openDirections).toEqual(COMPASS8);
    expect(controlsFromPrefs({ openSky: { [site]: ["S"] } }, site, ridgeNW).openDirections).toEqual(["S"]);
    // A lower stop limit than the hills: still seeded; a higher one: nothing to close.
    expect(controlsFromPrefs({ minAlt: 40 }, site, ridgeNW).openDirections).toEqual(COMPASS8);
  });
  it("remembers a choice only when it differs from the default", () => {
    expect(openSkyToStore(COMPASS8, null, 30)).toBeUndefined();
    expect(openSkyToStore([], ridgeNW, 30)).toBeUndefined();
    expect(openSkyToStore(["N", "NE", "E", "SE", "S", "SW", "W"], ridgeNW, 30)).toBeUndefined();
    // Re-opening the north-west by hand is remembered, so the seed does not close it again.
    expect(openSkyToStore(COMPASS8, ridgeNW, 30)).toEqual(COMPASS8);
    expect(openSkyToStore(["SW", "S"], ridgeNW, 30)).toEqual(["S", "SW"]);
  });
});

describe("the engine request carries the skyline", () => {
  const args = {
    date: AT, lat: SF.lat, lon: SF.lon, timezone: SF.tz, profile: { fov: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 20.5,
    controls: controlsFromPrefs({}, "x"), shuffle: 0, limit: 3, seen: [],
  };
  it("is unchanged without a skyline and keyed by its fingerprint with one", () => {
    const plain = journeyRequestFor(args);
    expect("horizon" in plain).toBe(false);
    expect(journeyRequestFor({ ...args, horizon: null })).toEqual(plain);
    expect(journeyRequestKey(plain)).toBe(JSON.stringify(plain));
    const h = compactHorizon(terrain(200, 260, 35))!;
    const req = journeyRequestFor({ ...args, horizon: h });
    expect(req.horizon).toBe(h);
    expect(journeyRequestKey(req)).toContain(horizonFingerprint(h));
    expect(journeyRequestKey(req)).not.toContain('"horizon":[');
  });
  it("the tonight teaser builds the same request as Discovery for the same horizon", () => {
    const horizon = terrain(285, 345, 40);
    const sky = { at: AT, lat: SF.lat, lon: SF.lon, timezone: SF.tz, skyBrightness: 20.5, profile: { fov: 6.5, aperture: 50, magnification: 10 } };
    const tonight = tonightJourneyRequest(sky, { prefs: {} }, [], undefined, { observedIds: [], boostIds: [] }, horizon);
    expect(tonight.horizon).toEqual(compactHorizon(horizon));
    expect(tonight.openDirections).toEqual(["N", "NE", "E", "SE", "S", "SW", "W"]);
    expect(tonightJourneyRequest(sky, { prefs: {} }, [], undefined, { observedIds: [], boostIds: [] })).not.toHaveProperty("horizon");
  });
});

describe("live altitude check against the skyline", () => {
  const betelgeuse = objects.get("STAR-Betelgeuse")!;
  const pos = eqToHorizontal(betelgeuse.ra, betelgeuse.dec, SF.lat, SF.lon, AT);
  const around = (h: number) => terrain(Math.round(pos.az + 340) % 360, Math.round(pos.az + 20) % 360, h);
  it("is the flat-horizon check without a skyline", () => {
    const flat = stopAltitudeState(betelgeuse, SF.lat, SF.lon, AT, 30, SF.tz);
    expect(flat).toMatchObject({ kind: "ok", clearance: null });
    expect(stopAltitudeState(betelgeuse, SF.lat, SF.lon, AT, 30, SF.tz, null)).toEqual(flat);
    expect(stopAltitudeState(betelgeuse, SF.lat, SF.lon, new Date("2027-01-15T13:30:00Z"), 30, SF.tz)).toMatchObject({ kind: "missed", reason: "low" });
  });
  it("says behind the hills, not low, when the skyline hides a high-enough stop", () => {
    const hidden = stopAltitudeState(betelgeuse, SF.lat, SF.lon, AT, 30, SF.tz, around(pos.alt + 10));
    expect(hidden.kind).toBe("missed");
    expect(hidden.reason).toBe("terrain");
    expect(hidden.text).toMatch(/^Missed — now behind the hills to the /);
    expect(stopAltitudeState(betelgeuse, SF.lat, SF.lon, AT, 30, SF.tz, around(pos.alt - 10))).toMatchObject({ kind: "ok" });
    expect(altitudeHelpText(hidden, 30)).toMatch(/behind the hills/);
  });
  it("words the help line precisely when the skyline is known", () => {
    expect(altitudeHelpText({ alt: 52, az: 180, clearance: null }, 30)).toBe("It's 52° high — height is not the problem.");
    expect(altitudeHelpText({ alt: 52, az: 180, clearance: 40 }, 30)).toBe("It's 52° high and 40° above your skyline — height is not the problem.");
    expect(altitudeHelpText({ alt: 33, az: 225, clearance: 2.4 }, 30)).toMatch(/only 2° above your skyline to the southwest/);
    expect(altitudeHelpText({ alt: 32, az: 90, clearance: 20 }, 30)).toBe("It's only 32° high — low objects dim in thick air. It clears your skyline to the east by 20°.");
  });
});

describe("conditions explainer with hills", () => {
  const base = (patch: Partial<ConditionsInput>): ConditionsInput => ({
    date: AT, timezone: SF.tz, sunAlt: -40, moon: { alt: -10, illumination: 0.1, ra: 0, dec: 0 }, events: nightEvents(SF.lat, SF.lon, AT),
    minAlt: 30, openDirections: COMPASS8, theme: null, result: MOCK_JOURNEY_RESULT, ...patch,
  });
  it("explains a terrain limit and terrain-closed directions in plain words", () => {
    const empty = { journeys: [], diagnostics: { reasonsRejected: { terrain: 5 }, limitingFactors: ["terrain" as const], message: "" } };
    const notes = conditionNotes(base({ result: empty, openDirections: ["N", "NE", "E", "SE", "S", "SW", "W"], openSkyFromTerrain: true }));
    expect(notes.map((n) => n.code)).toEqual(["terrain", "region"]);
    expect(notes[1].body).toBe("Hills block the northwest from here, so no journeys fit.");
    const manual = conditionNotes(base({ result: empty, openDirections: ["S"] }));
    expect(manual.find((n) => n.code === "region")?.body).toMatch(/^You marked only the south as open/);
  });
});
