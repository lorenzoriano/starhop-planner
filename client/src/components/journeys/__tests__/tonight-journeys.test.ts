import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import { lensFixtureKb } from "@/lib/journeys/__fixtures__/fixture-lenses";
import type { Journey, JourneyRequest, JourneyResult, JourneyStop } from "@/lib/journeys/types";
import { objectKey } from "@/lib/object-links";
import { activeLensObjectKeys } from "../journey-membership";
import { controlsFromPrefs, journeyRequestFor } from "../journey-view";
import {
  journeyLinkDecision, journeyLinksFor, journeyMoonLine, journeyNightPlan, loadLensKeys, loadTonightJourneys, peekTonightJourneys,
  journeysOpenAt, resetTonightJourneysCache, startChoices, tonightJourneyRequest, TONIGHT_JOURNEY_LIMIT, type TonightEngine,
} from "../use-tonight-journeys";

const SKY = { at: new Date("2026-11-04T04:37:00Z"), lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles", skyBrightness: 21.6, profile: { fov: 6.5, aperture: 50, magnification: 10 } };
const request = (patch: Partial<JourneyRequest> = {}): JourneyRequest => ({ ...tonightJourneyRequest(SKY, { prefs: undefined }, []), ...patch });

function stubEngine(mode: "mock" | "worker" = "worker", result: JourneyResult = MOCK_JOURNEY_RESULT) {
  const calls: JourneyRequest[] = [];
  let kbLoads = 0, fail = false;
  const engine: TonightEngine = {
    resolvedMode: async () => mode,
    client: { generate: async (req) => { calls.push(req); if (fail) throw new Error("worker down"); return result; } },
    loadKb: async () => { kbLoads++; return lensFixtureKb(); },
  };
  return { engine, calls, kbLoads: () => kbLoads, failNext: (v: boolean) => { fail = v; } };
}

const stop = (objectId: string, moonSepDeg: number | null = null, windowStart = "2026-11-04T04:45:00Z"): JourneyStop => ({
  index: 0, objectId, role: "r", arc: "setup", link: null, windowStart, windowEnd: "2026-11-04T05:00:00Z", altAtStart: 40, azAtStart: 120,
  moonSepDeg, challenge: false, transitionText: null, getThere: { mode: "naked-eye", fields: 0, distanceDeg: 0, bearingText: "" },
} as unknown as JourneyStop);
const journey = (key: string, ids: string[], seps: (number | null)[] = []): Journey => ({
  ...MOCK_JOURNEY_RESULT.journeys[0], key, title: `Journey ${key}`, templateId: "A1-cradle-to-grave", stops: ids.map((id, i) => ({ ...stop(id, seps[i] ?? null), index: i })),
});

afterEach(() => resetTonightJourneysCache());

describe("tonight's journey request", () => {
  it("is exactly the teaser's / Discovery's first-page request (limit 3, shuffle 0, device prefs)", () => {
    const prefs = { theme: "A2-thermometer", length: "short" as const, minAlt: 25 };
    const expected = journeyRequestFor({ date: SKY.at, lat: SKY.lat, lon: SKY.lon, timezone: SKY.timezone, profile: SKY.profile, skyBrightness: 21.6, controls: controlsFromPrefs(prefs, "37.77,-122.42"), shuffle: 0, limit: 3, seen: ["M42"] });
    expect(tonightJourneyRequest(SKY, { prefs }, ["M42"])).toEqual(expected);
    expect(expected.limit).toBe(TONIGHT_JOURNEY_LIMIT);
    expect(expected.instant).toBe("2026-11-04T04:30:00.000Z");
  });
  it("lets a caller override the theme (Moonlight-proof on the Moon tab) and nothing else", () => {
    const base = tonightJourneyRequest(SKY, { prefs: { theme: "A2-thermometer" } }, []);
    const moonlit = tonightJourneyRequest(SKY, { prefs: { theme: "A2-thermometer" } }, [], "A12-moonlit");
    expect(moonlit).toEqual({ ...base, theme: "A12-moonlit" });
  });
});

describe("one shared engine call per request", () => {
  it("shares one in-flight call between the teaser and every chip, then serves the cache", async () => {
    const { engine, calls } = stubEngine();
    const a = loadTonightJourneys(request(), engine, false), b = loadTonightJourneys(request(), engine, false);
    expect(a).toBe(b);
    expect(peekTonightJourneys(JSON.stringify(request()))).toBeUndefined();
    await Promise.all([a, b, ...Array.from({ length: 20 }, () => loadTonightJourneys(request(), engine, false))]);
    expect(calls).toHaveLength(1);
    expect(peekTonightJourneys(JSON.stringify(request()))).toBe(MOCK_JOURNEY_RESULT);
    expect(await loadTonightJourneys(request(), engine, false)).toBe(MOCK_JOURNEY_RESULT);
    expect(calls).toHaveLength(1);
  });
  it("asks again for a different request (another slot, theme or site)", async () => {
    const { engine, calls } = stubEngine();
    await loadTonightJourneys(request(), engine, false);
    await loadTonightJourneys(request({ theme: "A12-moonlit" }), engine, false);
    await loadTonightJourneys(request({ instant: "2026-11-04T04:45:00.000Z" }), engine, false);
    expect(calls).toHaveLength(3);
  });
  it("never runs the demo engine unless the device opted in, and hides the result", async () => {
    const hidden = stubEngine("mock");
    expect(await loadTonightJourneys(request(), hidden.engine, false)).toBeNull();
    expect(hidden.calls).toHaveLength(0);
    resetTonightJourneysCache();
    const demo = stubEngine("mock");
    expect(await loadTonightJourneys(request(), demo.engine, true)).toBe(MOCK_JOURNEY_RESULT);
  });
  it("does not cache a failure, so the next caller retries", async () => {
    const s = stubEngine();
    s.failNext(true);
    expect(await loadTonightJourneys(request(), s.engine, false)).toBeNull();
    s.failNext(false);
    expect(await loadTonightJourneys(request(), s.engine, false)).toBe(MOCK_JOURNEY_RESULT);
    expect(s.calls).toHaveLength(2);
  });
});

describe("object → journey links", () => {
  const journeys = [journey("j1", ["M42", "STAR-Betelgeuse", "HR1713"]), journey("j2", ["M45", "HR2061"])];
  it("matches every id form of one object (unified, HR, star:HR) with its 1-based stop", () => {
    for (const id of ["STAR-Betelgeuse", "HR2061", "star:HR2061"]) {
      expect(journeyLinksFor(journeys, id).map((l) => [l.key, l.stop])).toEqual([["j1", 2], ["j2", 2]]);
    }
    expect(journeyLinksFor(journeys, "star:HR1713")).toEqual([{ key: "j1", title: "Journey j1", themeId: "A1-cradle-to-grave", stop: 3, stopCount: 3, tonight: true }]);
    expect(journeyLinksFor(journeys, "M31")).toEqual([]);
  });
  it("finds the real fixture journey's stops", () => {
    const j = MOCK_JOURNEY_RESULT.journeys[0];
    const last = j.stops[j.stops.length - 1].objectId;
    expect(journeyLinksFor(MOCK_JOURNEY_RESULT.journeys, last)[0]).toMatchObject({ key: j.key, stop: j.stops.length, stopCount: j.stops.length });
  });
});

describe("chip decision", () => {
  const link = { key: "j1", title: "Cradle to Grave", themeId: "A1-cradle-to-grave", stop: 2, stopCount: 5, tonight: true };
  it("says 'In journey' only for one of tonight's real journeys", () => {
    expect(journeyLinkDecision({ status: "ready", links: [link, { ...link, key: "j2" }], inLens: true })).toEqual({ kind: "in-journey", link, more: 1 });
    expect(journeyLinkDecision({ status: "ready", links: [{ ...link, tonight: false }], inLens: true })).toEqual({ kind: "find" });
  });
  it("otherwise offers Discovery only when an active theme can tell the object", () => {
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: true })).toEqual({ kind: "find" });
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: false })).toEqual({ kind: "none" });
    expect(journeyLinkDecision({ status: "idle", links: [], inLens: true })).toEqual({ kind: "find" });
  });
  it("shows nothing while unknown or with only the demo KB", () => {
    expect(journeyLinkDecision({ status: "loading", links: [], inLens: true })).toEqual({ kind: "pending" });
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: null })).toEqual({ kind: "pending" });
    expect(journeyLinkDecision({ status: "hidden", links: [link], inLens: true })).toEqual({ kind: "none" });
  });
});

describe("active theme lenses", () => {
  it("collects the objects of every active theme's lens, in canonical form", () => {
    const kb = lensFixtureKb(), keys = activeLensObjectKeys(kb);
    for (const lens of kb.lenses ?? []) for (const id of Object.keys(lens.objects)) expect(keys.has(objectKey(id))).toBe(true);
    expect(keys.has("HR1895")).toBe(false); // no A1/A2 lens on purpose (fixture-lenses.ts)
  });
  it("ignores retired themes' lenses", () => {
    const kb = lensFixtureKb();
    const retired = { ...kb, templates: kb.templates.map((t) => ({ ...t, id: t.id === "A2-thermometer" ? "A10-stars-that-change" : t.id })) };
    const a2Only = Object.keys(kb.lenses!.find((l) => l.archetype === "A2")!.objects).filter((id) => !(id in kb.lenses!.find((l) => l.archetype === "A1")!.objects));
    expect(a2Only.length).toBeGreaterThan(0);
    for (const id of a2Only) expect(activeLensObjectKeys(retired).has(objectKey(id))).toBe(false);
  });
  it("falls back to theme membership for a KB without lenses", () => {
    const keys = activeLensObjectKeys(FIXTURE_KB);
    expect(keys.has("M42")).toBe(true);
  });
  it("loads the KB once for every chip", async () => {
    const s = stubEngine();
    const [a, b] = await Promise.all([loadLensKeys(s.engine, false), loadLensKeys(s.engine, false)]);
    expect(a).toBe(b);
    expect(s.kbLoads()).toBe(1);
  });
});

describe("planner and Moon helpers", () => {
  it("adds all stops in story order with 1-based stop numbers at the journey's start", () => {
    const j = journey("j1", ["M42", "NAME-Mystery", "STAR-Betelgeuse"]);
    const plan = journeyNightPlan(j);
    expect(plan).toMatchObject({ ids: ["M42", "NAME-Mystery", "STAR-Betelgeuse"], journeyStops: [1, 2, 3], at: new Date("2026-11-04T04:45:00Z") });
    // each stop at its own time, so the Planner keeps the journey as one block in story order
    expect(plan.plannedAts.map((d) => d?.toISOString())).toEqual(j.stops.map((s) => new Date(s.windowStart).toISOString()));
    const kept = journeyNightPlan(j, (id) => !id.startsWith("NAME-"));
    expect(kept).toMatchObject({ ids: ["M42", "STAR-Betelgeuse"], journeyStops: [1, 3] });
    expect(kept.plannedAts.map((d) => d?.toISOString())).toEqual([j.stops[0], j.stops[2]].map((s) => new Date(s.windowStart).toISOString()));
  });
  it("says how the Moon sits with a journey", () => {
    expect(journeyMoonLine(journey("a", ["M42", "M45"], [62.4, 48.6]))).toBe("Moon at least 49° from every stop");
    expect(journeyMoonLine(journey("b", ["M42", "M45"]))).toBe("Moon down for the whole journey");
    expect(journeyMoonLine(journey("c", ["M42", "M45"], [null, 30]))).toMatch(/^Moon down for part of it; at least 30°/);
  });
});

describe("daylight: no dead end (r5 UX #4)", () => {
  const dusk = new Date("2026-11-04T02:36:00Z"), dawn = new Date("2026-11-04T13:20:00Z");
  it("says when journeys open instead of 'Find a journey with this' while nothing fits before dusk", () => {
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: true, journeysNow: 0, opensAt: dusk })).toEqual({ kind: "opens", at: dusk });
    // Dark but nothing fits: hide rather than lead to "No journey fits right now".
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: true, journeysNow: 0, opensAt: null })).toEqual({ kind: "none" });
    // Journeys exist now, just not through this object: the Discovery link (which pins the object).
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: true, journeysNow: 3, opensAt: null })).toEqual({ kind: "find" });
    expect(journeyLinkDecision({ status: "ready", links: [], inLens: false, journeysNow: 0, opensAt: dusk })).toEqual({ kind: "none" });
  });
  it("opens at the next dusk only when it is not dark yet", () => {
    const sky = { at: new Date("2026-11-03T20:00:00Z"), lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles" };
    expect(journeysOpenAt(sky, { astroDusk: dusk, astroDawn: dawn })).toEqual(dusk);
    // At night the next dawn comes first: journeys are open now.
    expect(journeysOpenAt({ ...sky, at: new Date("2026-11-04T05:00:00Z") }, { astroDusk: new Date("2026-11-05T02:37:00Z"), astroDawn: dawn })).toBeNull();
    expect(journeysOpenAt(sky, { astroDusk: null, astroDawn: null })).toBeNull();
  });
  it("finds San Francisco's real dusk from the shared night window", () => {
    const at = journeysOpenAt({ at: new Date("2026-11-03T20:00:00Z"), lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles" });
    expect(at).not.toBeNull();
    // Astronomical dusk in early November: about 18:25–18:35 PST.
    expect(at!.getTime()).toBeGreaterThan(Date.parse("2026-11-04T02:15:00Z"));
    expect(at!.getTime()).toBeLessThan(Date.parse("2026-11-04T02:45:00Z"));
  });
});

describe("Start here at a journey's last stop (r5 UX #10)", () => {
  it("offers Start journey (stop 1) next to Jump to stop n", () => {
    expect(startChoices({ stop: 5, stopCount: 5 })).toEqual([{ label: "Start journey", stop: 1 }, { label: "Jump to stop 5", stop: 5 }]);
    expect(startChoices({ stop: 2, stopCount: 5 })).toEqual([{ label: "Start here", stop: 2 }]);
    expect(startChoices({ stop: 1, stopCount: 1 })).toEqual([{ label: "Start here", stop: 1 }]);
  });
});
