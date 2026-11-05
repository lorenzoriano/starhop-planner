import { describe, expect, it } from "vitest";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import { journeyRouteFromPath, pageForPath, pathForJourneyRoute, pathForPage, targetFromPath } from "@/lib/navigation";
import { conditionNotes, emptyState, isDarkAt, moonKeepOut, nightEvents, type ConditionsInput } from "../conditions-explainer";
import { lightboxHint } from "../ImageLightbox";
import {
  arcChips, durationLabel, getThereFor, indexObjects, journeyConditionLines, journeyEffort, journeyMoonCheck, journeyStats, journeyStatus, legSummary, NEUTRAL_BRIDGE, plannedFov,
  regionWords, showLowerBinoculars, slotInstant, stopAltitudeState, themeOptions, transitionFor,
} from "../journey-view";
import { turningRange } from "../JourneyOverview";
import { uiMockJourneyClient } from "../mock-engine";
import type { LegReport } from "@/lib/object-links";

const journey = MOCK_JOURNEY_RESULT.journeys[0];
const objects = indexObjects(FIXTURE_KB);
const SF = { lat: 37.77, lon: -122.42, tz: "America/Los_Angeles" };
const AT = new Date("2027-01-15T04:30:00Z");

describe("journey routes (#/journeys…)", () => {
  it("parses and builds every journeys sub-route and keeps the old pages working", () => {
    for (const path of ["/journeys", "/journeys/abc", "/journeys/abc/stop/3", "/journeys/abc/done", "/journeys/abc/"]) expect(pageForPath(path)).toBe("journeys");
    expect(journeyRouteFromPath("/journeys")).toEqual({ view: "discover" });
    expect(journeyRouteFromPath("/journeys/fx-a1~x")).toEqual({ view: "overview", key: "fx-a1~x" });
    expect(journeyRouteFromPath("/journeys/k/stop/10")).toEqual({ view: "stop", key: "k", stop: 10 });
    expect(journeyRouteFromPath("/journeys/k/done")).toEqual({ view: "done", key: "k" });
    expect(journeyRouteFromPath("/journeys/k/stop/0")).toBeNull();
    expect(journeyRouteFromPath("/journeys/k/other")).toBeNull();
    expect(pageForPath("/journeys/k/stop/x")).toBeNull();
    const key = "life cycle/é";
    for (const route of [{ view: "overview", key }, { view: "stop", key, stop: 4 }, { view: "done", key }] as const) expect(journeyRouteFromPath(pathForJourneyRoute(route))).toEqual(route);
    expect(pathForPage("journeys")).toBe("/journeys");
    expect(pageForPath("/hop/M31")).toBe("hop");
    expect(targetFromPath("/hop/M31")).toBe("M31");
    expect(pageForPath("/unknown")).toBeNull();
  });
});

describe("journey card helpers", () => {
  it("builds arc chips, durations and region words", () => {
    // One chip per storyline beat: consecutive stops in the same role share a chip.
    // at most three beats on one line, then "+N" (design review r2)
    expect(arcChips({ stops: journey.stops.slice(0, 3) })).toEqual(["Nursery", "Young family"]);
    expect(arcChips(journey)).toEqual(["Nursery", "Young family", "Doomed giant", "+1"]);
    const long = { stops: [...journey.stops, ...journey.stops.slice(0, 3)] };
    expect(arcChips(long)).toEqual(["Nursery", "Young family", "Doomed giant", "+3"]);
    expect(durationLabel(38)).toBe("~40 min");
    expect(durationLabel(2)).toBe("~5 min");
    expect(regionWords(journey)).toBe("South-east · 41–69° high");
  });
  it("labels the status from the best window", () => {
    expect(journeyStatus(journey, AT, SF.tz).kind).toBe("now");
    expect(journeyStatus(journey, new Date("2027-01-15T02:00:00Z"), SF.tz)).toEqual({ kind: "later", text: "Starts at 19:45" });
    expect(journeyStatus(journey, new Date("2027-01-15T07:10:00Z"), SF.tz).kind).toBe("ending");
    expect(journeyStatus(journey, new Date("2027-01-15T09:00:00Z"), SF.tz).kind).toBe("past");
  });
  it("offers Surprise me first and short labels for known archetypes", () => {
    const opts = themeOptions(FIXTURE_KB.templates);
    expect(opts[0]).toMatchObject({ id: null, label: "Surprise me" });
    expect(opts.map((o) => o.label)).toEqual(["Surprise me", "Lives of stars", "Star colors"]);
    // A4 (time machine), A7 (record breakers) and A10 (stars that change) are retired as journeys.
    expect(themeOptions([]).length).toBe(10);
    for (const id of ["A4-time-machine", "A7-record-breakers", "A10-stars-that-change"]) expect(themeOptions([]).map((o) => o.id)).not.toContain(id);
  });
  it("keys engine requests to 15-minute slots", () => {
    expect(slotInstant(new Date("2027-01-15T04:37:59Z")).toISOString()).toBe("2027-01-15T04:30:00.000Z");
  });
});

describe("one leg, one start: the card, the field chip and Plan star hop agree (r5)", () => {
  it("starts a same-field or sweep leg at the previous stop, with the leg's own numbers", () => {
    const g = getThereFor(journey, 1, 0, objects, 6.5);
    expect(g).toMatchObject({ mode: "same-field", startId: "M42", startName: "Orion Nebula", restarted: false });
    expect(legSummary(g)).toBe("Same field as the Orion Nebula");
  });
  it("starts a naked-eye jump at the anchor the directions name, counted from the anchor (not the 19° leg)", () => {
    // A jump of 30° from Betelgeuse to M42, found from Orion's Belt by eye: the hop is Belt → M42.
    const jumpJourney = { stops: journey.stops.map((s, i) => (i === 1 ? { ...s, objectId: "M42", getThere: { mode: "naked-eye-hop" as const, fields: 4.6, distanceDeg: 30, bearingText: "Lower the binoculars and find Orion's Belt by eye. From there, hop down about one field.", anchorId: "AST-OrionBelt" } } : s)) };
    const g = getThereFor(jumpJourney, 1, 0, objects, 6.5);
    expect(g.startId).toBe("AST-OrionBelt");
    expect(g.startName).toBe(objects.get("AST-OrionBelt")!.names.display);
    expect(g.hopDeg).toBeGreaterThan(1);
    expect(g.hopDeg).toBeLessThan(10);
    const summary = legSummary(g);
    // Hop units (the hopper-calibrated estimate), and the directions keep the degrees: no number twice, none of the 30° leg.
    expect(summary).toMatch(/^By eye to .+, then (?:one hop|one or two hops|about \d+ hops)$/);
    expect(summary).not.toContain("°");
  });
  it("keeps the anchor (never an unseen stop) when a skipped stop forces a restart", () => {
    const g = getThereFor(journey, 4, -1, objects, 6.5);
    expect(g.restarted).toBe(true);
    expect(g.startId).toBe("HR1910");
    // The anchor is not in this fixture KB: no invented numbers, and not the leg distance from the unseen Betelgeuse.
    expect(g.hopDeg).toBeNull();
    expect(g.distanceDeg).toBe(0);
    expect(legSummary(g)).toMatch(/^By eye to .+, then a short hop$/);
  });
  it("lets Star hop choose when a jump has no anchor, and names a stop found by eye", () => {
    const noAnchor = { ...journey.stops[4], getThere: { ...journey.stops[4].getThere, anchorId: undefined } };
    const g = getThereFor({ stops: [...journey.stops.slice(0, 4), noAnchor] }, 4, 3, objects, 6.5);
    expect(g.startId).toBeNull();
    expect(legSummary(g)).toBe("Naked-eye jump");
    // The stop is its own anchor: the directions say "by eye", the summary does not repeat it.
    const self = { ...journey.stops[4], getThere: { ...journey.stops[4].getThere, anchorId: "M1" } };
    expect(legSummary(getThereFor({ stops: [...journey.stops.slice(0, 4), self] }, 4, 3, objects, 6.5))).toBe("No hop needed");
  });
  it("says a sweep's distance and a hop estimate, and Star hop's own count once the journey's chain is planned", () => {
    const sweep = getThereFor(journey, 3, 2, objects, 6.5);
    // These directions give no degrees, so the summary says them once; with "(10°)" in the directions it does not.
    expect(legSummary(sweep)).toMatch(/^From Orion’s Belt, about 10° · about \d+ hops$/);
    expect(legSummary({ ...sweep, text: `${sweep.text} (10°)` })).toMatch(/^From Orion’s Belt · about \d+ hops$/);
    const report = { leg: 4, from: "AST-OrionBelt", to: "STAR-Betelgeuse", status: "ok" as const, hops: 5, distanceDeg: 9.8, maxHopFov: 0.8, minPatternScore: 50, routeScore: 70, usedExpertRoute: false, ms: 3 };
    expect(legSummary(sweep, report)).toMatch(/^From Orion’s Belt, about 10° · 5 hops · hard$/);
    expect(legSummary(sweep, { ...report, hopBound: 6 })).toMatch(/ · 5 hops$/);
    // An unroutable report changes nothing.
    expect(legSummary(sweep, { ...report, status: "no-route" })).toBe(legSummary(sweep));
    expect(legSummary(getThereFor(journey, 1, 0, objects, 6.5), { ...report, status: "same-field", hops: 0 })).toBe("Same field as the Orion Nebula");
    // A stop the chain finds by eye (the journey's anchor is the stop itself).
    expect(legSummary(sweep, { ...report, status: "jump", hops: 0 })).toBe("No hop needed");
  });
  it("counts a journey's hops like Star hop: the estimate before the chain is planned, Star hop's legs after", () => {
    const estimate = journeyEffort(journey, objects, 6.5);
    expect(estimate.planned).toBe(false);
    expect(estimate.hops).toBeGreaterThan(0);
    const leg = (i: number, o: Partial<LegReport> = {}): LegReport => ({ leg: i + 1, from: i ? "x" : null, to: "y", status: "ok", hops: 3, distanceDeg: 6, maxHopFov: .6, minPatternScore: 60, routeScore: 80, usedExpertRoute: false, ms: 1, hopBound: 6, ...o });
    const legs = journey.stops.map((_, i) => leg(i));
    expect(journeyEffort(journey, objects, 6.5, legs)).toEqual({ hops: 3 * journey.stops.length, planned: true, hardLegs: 0 });
    // A missing or unrouted leg keeps the estimate (the chain does not cover the journey).
    expect(journeyEffort(journey, objects, 6.5, [...legs.slice(1), null]).planned).toBe(false);
    const hard = journeyEffort(journey, objects, 6.5, legs.map((l, i) => (i < 2 ? { ...l, hops: 14, hopBound: 9 } : l)));
    expect(hard.hardLegs).toBe(2);
    const stats = journeyStats({ ...journey, difficulty: "easy", durationMin: 20 }, hard);
    expect(stats.find((x) => x.id === "hops")?.label).toBe(`${hard.hops} hops`);
    expect(stats.find((x) => x.id === "difficulty")?.label).toBe("Stretch");
    // Time covers the hopping and is never below the engine's own estimate.
    expect(stats.find((x) => x.id === "time")?.label).toBe(durationLabel(journey.stops.length * 4 + hard.hops * 1.5));
    expect(journeyStats({ ...journey, durationMin: 300 }, estimate).find((x) => x.id === "time")?.label).toBe(durationLabel(300));
    expect(journeyStats(journey, estimate).find((x) => x.id === "hops")?.label).toMatch(/^(?:one hop|one or two hops|about \d+ hops)$/);
    // Without effort: unchanged chips.
    expect(journeyStats(journey).map((x) => x.id)).toEqual(["time", "stops", ...(journey.totalPathDeg > 0 ? ["path"] : []), "difficulty"]);
  });
  it("reads the true field the journey was planned with from its own numbers", () => {
    expect(plannedFov({ getThere: { mode: "sweep", fields: 2, distanceDeg: 8, bearingText: "" } }, 6.5)).toBe(4);
    expect(plannedFov({ getThere: { mode: "naked-eye-hop", fields: 0, distanceDeg: 0, bearingText: "" } }, 6.5)).toBe(6.5);
  });
});

describe("the journey's Moon check", () => {
  const conditions = { darkness: "night", minAlt: 30, closestMoonDeg: 41.6, moon: { up: true, illumination: 0.26, rise: null, set: "2027-01-15T09:20:00Z" } };
  it("reuses the engine's conditions and points at the stop nearest the Moon", () => {
    const j = { ...journey, conditions, stops: journey.stops.map((s, i) => ({ ...s, moonSepDeg: [80, 60, 41.6, 70, null][i] ?? null })) };
    const check = journeyMoonCheck(j, SF.tz);
    expect(check).toEqual({ text: "Moon 26% lit and up, nearest stop 42° from it; sets 01:20", stopIndex: 2 });
    // The Sky row leaves the Moon to that line when asked, and keeps it by default.
    expect(journeyConditionLines(j, SF.tz, { moon: false }).some((l) => l.startsWith("Moon"))).toBe(false);
    expect(journeyConditionLines(j, SF.tz)).toContain(check!.text);
  });
  it("is absent without engine conditions", () => {
    expect(journeyMoonCheck(journey, SF.tz)).toBeNull();
  });
});

describe("skip-aware field guidance", () => {
  it("uses the engine transition only when the previous stop was seen", () => {
    expect(transitionFor(journey, 0, -1, objects)).toBeNull();
    expect(transitionFor(journey, 3, 2, objects)).toEqual({ heading: "From Orion’s Belt", text: journey.stops[3].transitionText });
    expect(transitionFor(journey, 3, 1, objects)).toEqual({ heading: "Next chapter", text: NEUTRAL_BRIDGE });
  });
  it("restarts the leg from the last seen stop or a naked-eye jump", () => {
    expect(getThereFor(journey, 1, 0, objects, 6.5)).toMatchObject({ mode: "same-field", restarted: false, fromName: "Orion Nebula" });
    const restarted = getThereFor(journey, 2, 0, objects, 6.5);
    expect(restarted.restarted).toBe(true);
    expect(restarted.fromName).toBe("Orion Nebula");
    expect(restarted.text).not.toContain("NGC 1981");
    const jump = getThereFor(journey, 4, -1, objects, 6.5);
    expect(jump.mode).toBe("naked-eye-hop");
    expect(jump.text).toMatch(/^Lower your binoculars/);
  });
  it("says 'lower your binoculars' only where it adds something", () => {
    const hop = { mode: "naked-eye-hop" as const, text: "Find Deneb, the Swan's tail, then hop two fields up." };
    expect(showLowerBinoculars(hop, 2)).toBe(true);
    // never on stop 1: the observer is not at the eyepiece yet
    expect(showLowerBinoculars(hop, 0)).toBe(false);
    // the directions already say it
    expect(showLowerBinoculars({ ...hop, text: "Find Algol by eye, then raise your binoculars onto it." }, 2)).toBe(false);
    expect(showLowerBinoculars({ ...hop, text: "Lower your binoculars. Find Algol." }, 2)).toBe(false);
    expect(showLowerBinoculars({ mode: "sweep", text: "Sweep two fields east." }, 2)).toBe(false);
  });
  it("flags stops that are setting or already too low", () => {
    const betelgeuse = objects.get("STAR-Betelgeuse")!;
    expect(stopAltitudeState(betelgeuse, SF.lat, SF.lon, AT, 30, SF.tz).kind).toBe("ok");
    expect(stopAltitudeState(betelgeuse, SF.lat, SF.lon, new Date("2027-01-15T13:30:00Z"), 30, SF.tz).kind).toBe("missed");
  });
});

describe("conditions explainer", () => {
  const base = (patch: Partial<ConditionsInput>): ConditionsInput => ({
    date: AT, timezone: SF.tz, sunAlt: -40, moon: { alt: -10, illumination: 0.1, ra: 0, dec: 0 }, events: nightEvents(SF.lat, SF.lon, AT),
    minAlt: 30, openDirections: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], theme: null, result: MOCK_JOURNEY_RESULT, ...patch,
  });
  it("says nothing on a dark moonless night with journeys", () => {
    expect(conditionNotes(base({}))).toEqual([]);
  });
  it("explains a bright Moon with at least two fixes", () => {
    const notes = conditionNotes(base({ moon: { alt: 40, illumination: 0.92, ra: 110, dec: 22 } }));
    expect(notes).toHaveLength(1);
    expect(notes[0].code).toBe("moon");
    expect(notes[0].body).toContain("92% lit in Gemini");
    expect(notes[0].body).toContain("38°");
    expect(notes[0].actions.length).toBeGreaterThanOrEqual(2);
  });
  it("explains twilight and daylight with a jump-to-dark time", () => {
    const evening = new Date("2027-01-16T01:30:00Z"); // 17:30 PST, after sunset
    const tw = conditionNotes(base({ date: evening, sunAlt: -8, events: nightEvents(SF.lat, SF.lon, evening) }));
    expect(tw[0].code).toBe("twilight");
    expect(tw[0].actions.map((a) => a.id)).toEqual(["twilight-journey", "jump-dark"]);
    expect(tw[0].actions[1].at!.getTime()).toBeGreaterThan(evening.getTime());
    const noon = new Date("2027-01-15T20:00:00Z");
    const day = conditionNotes(base({ date: noon, sunAlt: 30, events: nightEvents(SF.lat, SF.lon, noon) }));
    expect(day[0].code).toBe("day");
    expect(day[0].actions.length).toBeGreaterThanOrEqual(2);
  });
  it("gives an empty state with plain reasons and at least two actions", () => {
    const empty = { journeys: [], diagnostics: { reasonsRejected: { altitude: 4 }, limitingFactors: ["altitude" as const], message: "Too low." } };
    const input = base({ result: empty, openDirections: ["S"] });
    const notes = conditionNotes(input);
    expect(notes.map((n) => n.code)).toEqual(["altitude", "region"]);
    for (const n of notes) expect(n.actions.length).toBeGreaterThanOrEqual(2);
    const state = emptyState(notes, input);
    expect(state.reasons.length).toBeGreaterThan(0);
    expect(state.reasons.length).toBeLessThanOrEqual(3);
    expect(state.actions.length).toBeGreaterThanOrEqual(2);
    expect(emptyState([], { date: AT, timezone: SF.tz, theme: null, result: empty }).actions.length).toBeGreaterThanOrEqual(2);
  });
  it("in daylight, says so once: no altitude note and no 'Try' time that is still daylight", () => {
    const noon = new Date("2027-01-15T20:00:00Z");
    const input = base({ date: noon, sunAlt: 30, events: nightEvents(SF.lat, SF.lon, noon), result: { journeys: [], diagnostics: { reasonsRejected: { altitude: 4 }, limitingFactors: ["altitude" as const, "region" as const], message: "Too low." } }, openDirections: ["S"] });
    const notes = conditionNotes(input);
    expect(notes.map((n) => n.code)).not.toContain("altitude");
    for (const a of notes.flatMap((n) => n.actions)) if (a.at) expect(isDarkAt(a.at, input) || a.id === "tomorrow", `${a.id} ${a.label}`).toBe(true);
    expect(notes.flatMap((n) => n.actions).map((a) => a.label).join(" ")).not.toMatch(/Try 14:00/);
  });
  it("knows when a suggested time is dark", () => {
    const noonInput = { sunAlt: 30, events: nightEvents(SF.lat, SF.lon, new Date("2027-01-15T20:00:00Z")) };
    expect(isDarkAt(new Date("2027-01-15T22:00:00Z"), noonInput)).toBe(false);
    expect(isDarkAt(new Date("2027-01-16T05:00:00Z"), noonInput)).toBe(true);
    expect(isDarkAt(new Date("2027-01-15T06:30:00Z"), { sunAlt: -40, events: nightEvents(SF.lat, SF.lon, AT) })).toBe(true);
  });
  it("draws a Moon keep-out ring only when the Moon is up", () => {
    expect(moonKeepOut({ alt: -5, illumination: 1, ra: 0, dec: 0 })).toBeNull();
    expect(moonKeepOut({ alt: 20, illumination: 0.5, ra: 10, dec: 5 })).toEqual({ ra: 10, dec: 5, radiusDeg: 25 });
  });
});

describe("overview helpers and the UI mock engine", () => {
  it("measures the turning range across north", () => {
    expect(turningRange([350, 10, 40])).toMatchObject({ from: "north", to: "north-east", span: 50 });
    expect(turningRange([100, 150])).toMatchObject({ from: "east", to: "south-east", span: 50 });
    expect(turningRange([]))
      .toBeNull();
  });
  it("is deterministic, honours limit/shuffle and gives an explained empty state", async () => {
    const req = { instant: "2027-01-15T04:30:00Z", lat: SF.lat, lon: SF.lon, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 20 };
    const a = await uiMockJourneyClient.generate(req), b = await uiMockJourneyClient.generate(req);
    expect(a.journeys.map((j) => j.key)).toEqual(b.journeys.map((j) => j.key));
    expect(a.journeys).toHaveLength(3);
    expect(a.journeys[0].key).toBe(journey.key);
    const more = await uiMockJourneyClient.generate({ ...req, limit: 6 });
    expect(more.journeys.length).toBeGreaterThan(3);
    const shuffled = await uiMockJourneyClient.generate({ ...req, shuffle: 1 });
    expect(shuffled.journeys[0].key).not.toBe(a.journeys[0].key);
    const blocked = await uiMockJourneyClient.generate({ ...req, openDirections: ["N", "NW"] });
    expect(blocked.journeys).toEqual([]);
    expect(blocked.diagnostics.message).toBeTruthy();
    for (const j of a.journeys) for (const s of j.stops) expect(objects.has(s.objectId)).toBe(true);
  });
});

describe("image viewer hint", () => {
  it("is one short line; keyboard keys only where there is a keyboard", () => {
    expect(lightboxHint(true, true)).toBe("Pinch to zoom · swipe for next");
    expect(lightboxHint(true, false)).toBe("Pinch to zoom");
    expect(lightboxHint(false, true)).toMatch(/Esc/);
    expect(lightboxHint(true, true)).not.toMatch(/Esc|←/);
  });
});
