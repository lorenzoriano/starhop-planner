import { describe, expect, it } from "vitest";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import { isJourneyEligible } from "@/lib/journeys/candidates";
import { getJourneyEngineSource, JOURNEY_ENGINE, probeJourneyKb } from "../journey-engine";
import { journeyMembership } from "../journey-membership";
import {
  COMPASS8, controlsFromPrefs, indexObjects, journeyConditionLines, journeyRequestFor, journeyStory, NEUTRAL_BRIDGE, transitionFor,
} from "../journey-view";

const journey = MOCK_JOURNEY_RESULT.journeys[0];
const objects = indexObjects(FIXTURE_KB);
const PROFILE = { fov: 6.5, aperture: 50, magnification: 10 };

describe("engine selection", () => {
  it("defaults to the mock in tests and resolves it without fetching", async () => {
    expect(JOURNEY_ENGINE).toBe("mock");
    const source = getJourneyEngineSource();
    expect(await source.resolvedMode()).toBe("mock");
    expect((await source.loadKb()).version).toBe(FIXTURE_KB.version);
  });

  it("probes data/journeys/kb.json: JSON → reachable; HTML fallback, 404 or network error → not", async () => {
    const res = (status: number, type: string) => async () => new Response(status === 200 ? "{}" : "", { status, headers: { "content-type": type } });
    expect(await probeJourneyKb("http://x/", res(200, "application/json") as typeof fetch)).toBe(true);
    expect(await probeJourneyKb("http://x/", res(200, "text/html") as typeof fetch)).toBe(false);
    expect(await probeJourneyKb("http://x/", res(404, "application/json") as typeof fetch)).toBe(false);
    expect(await probeJourneyKb("http://x/", (async () => { throw new TypeError("offline"); }) as typeof fetch)).toBe(false);
    let asked = "";
    await probeJourneyKb("http://host/app/", (async (u: string) => { asked = u; return new Response("{}", { headers: { "content-type": "application/json" } }); }) as typeof fetch);
    expect(asked).toBe("http://host/app/data/journeys/kb.json");
  });
});

describe("optional engine fields", () => {
  it("after skipping stop k, stop k+1 uses stop k's transitionSkipText, else the neutral bridge", () => {
    expect(transitionFor(journey, 2, 0, objects)).toEqual({ heading: "Next chapter", text: NEUTRAL_BRIDGE });
    const withSkip = { ...journey, stops: journey.stops.map((s, i) => (i <= 1 ? { ...s, transitionSkipText: `We'll leave stop ${i + 1} for another night.` } : s)) };
    // Stop 2 (index 1) skipped, stop 1 seen → stop 3 uses stop 2's bridge.
    expect(transitionFor(withSkip, 2, 0, objects)).toEqual({ heading: "Next chapter", text: "We'll leave stop 2 for another night." });
    // Stop 1 skipped at the start → stop 2 uses stop 1's bridge.
    expect(transitionFor(withSkip, 1, -1, objects)?.text).toBe("We'll leave stop 1 for another night.");
    // Two skips in a row: the bridge would name an unseen stop, so the neutral one is used.
    expect(transitionFor(withSkip, 2, -1, objects)?.text).toBe(NEUTRAL_BRIDGE);
    // Previous stop seen: the engine's normal transition wins.
    expect(transitionFor(withSkip, 2, 1, objects)?.text).toBe(journey.stops[2].transitionText);
  });

  it("reads Journey.story and Journey.payoff as trimmed texts", () => {
    expect(journeyStory(journey)).toEqual({ intro: null, payoff: null });
    expect(journeyStory({ ...journey, story: "  A star's life in five stops. " })).toEqual({ intro: "A star's life in five stops.", payoff: null });
    expect(journeyStory({ ...journey, story: "  ", payoff: " Heavy stars die young. " })).toEqual({ intro: null, payoff: "Heavy stars die young." });
  });

  it("summarises Journey.conditions (JourneyConditions) in plain words, and passes strings through", () => {
    expect(journeyConditionLines(journey)).toEqual([]);
    const conditions = {
      instant: "2027-01-15T04:30:00Z", darkness: "night", sunAltDeg: -40, darkWindow: { start: "2027-01-15T03:00:00Z", end: "2027-01-15T13:00:00Z" },
      moon: { up: true, illumination: 0.42, altDeg: 30, azDeg: 120, minSepDeg: 25, rise: null, set: "2027-01-15T09:10:00Z" },
      glowLimits: { diffuse: 0.3, cluster: 0.6, star: 1.5 }, sunLimits: { star: -12, dso: -18 }, minAlt: 30, regionRadius: 30, skyBrightness: 21,
      limitingFactors: [], closestMoonDeg: 48.4,
    };
    expect(journeyConditionLines({ conditions }, "UTC")).toEqual(["Fully dark until 13:00", "Moon 42% lit and up, nearest stop 48° from it; sets 09:10", "every stop above 30°"]);
    expect(journeyConditionLines({ conditions: { ...conditions, darkness: "nautical", moon: { ...conditions.moon, up: false, illumination: 0.01 } } }, "UTC"))
      .toEqual(["Twilight: bright stars and doubles first", "No Moon", "every stop above 30°"]);
    expect(journeyConditionLines({ conditions: "Moon down; fully dark." })).toEqual(["Moon down; fully dark."]);
    expect(journeyConditionLines({ conditions: [{ message: "Moon 40% lit" }, "Dark from 18:40", { code: "x" }] })).toEqual(["Moon 40% lit", "Dark from 18:40"]);
  });
});

describe("shared engine request (Discovery = Tonight teaser)", () => {
  it("rounds to the 15-minute slot and applies remembered prefs with defaults", () => {
    const controls = controlsFromPrefs(undefined, "37.77,-122.42");
    expect(controls).toEqual({ theme: null, length: "medium", minAlt: 30, includeChallenge: true, openDirections: COMPASS8 });
    const a = journeyRequestFor({ date: new Date("2027-01-15T04:31:10Z"), lat: 37.77, lon: -122.42, timezone: "UTC", profile: PROFILE, skyBrightness: 21, controls, shuffle: 0, limit: 3, seen: [] });
    const b = journeyRequestFor({ date: new Date("2027-01-15T04:44:59Z"), lat: 37.77, lon: -122.42, timezone: "UTC", profile: PROFILE, skyBrightness: 21, controls, shuffle: 0, limit: 3, seen: [] });
    expect(a).toEqual(b);
    expect(a.instant).toBe("2027-01-15T04:30:00.000Z");
    expect(a.length).toBe(5);
    expect(a.openDirections).toBeUndefined();
    const limited = journeyRequestFor({ date: new Date(0), lat: 0, lon: 0, timezone: "UTC", profile: PROFILE, skyBrightness: 21, controls: controlsFromPrefs({ openSky: { "0.00,0.00": ["S", "SW"] }, length: "short" }, "0.00,0.00"), shuffle: 2, limit: 6, seen: ["M42"] });
    expect(limited).toMatchObject({ openDirections: ["S", "SW"], length: 4, shuffle: 2, limit: 6, seenObjectIds: ["M42"] });
  });
});

describe("'Part of N journeys' membership (no engine run)", () => {
  it("counts templates where an eligible object has a linked partner that fits too", () => {
    const eligible = FIXTURE_KB.objects.filter(isJourneyEligible);
    expect(eligible.length).toBeGreaterThan(1);
    const counts = eligible.map((o) => journeyMembership(FIXTURE_KB, o.id));
    expect(counts.some((m) => m.templateIds.length > 0)).toBe(true);
    for (const m of counts) {
      for (const id of m.templateIds) expect(FIXTURE_KB.templates.some((t) => t.id === id)).toBe(true);
      expect(new Set(m.partnerIds).size).toBe(m.partnerIds.length);
    }
  });

  it("is empty for unknown or ineligible objects and when no partner is up", () => {
    expect(journeyMembership(FIXTURE_KB, "NOPE")).toEqual({ templateIds: [], partnerIds: [] });
    const some = FIXTURE_KB.objects.find((o) => isJourneyEligible(o) && journeyMembership(FIXTURE_KB, o.id).templateIds.length > 0)!;
    expect(journeyMembership(FIXTURE_KB, some.id, { isUp: () => false })).toEqual({ templateIds: [], partnerIds: [] });
    expect(journeyMembership(FIXTURE_KB, some.id, { patchDeg: 0 }).templateIds).toEqual([]);
  });
});
