/**
 * Integration r5 (WS-C): the shared object-action row on journey stops, the journey-level links, the shared widgets
 * under a stop card's "More", and the focus hand-off into Journeys.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import type { Star, UnifiedTarget } from "@/lib/astronomy";
import { LINK_LABELS, NOOP_ACTIONS, type ObjectActions, type ObjectCatalog } from "@/lib/object-links";
import { emptyFeedbackStore, emptyJourneyStore } from "@/lib/journeys/progress";
import { addOptions, hopOptions, journeyRefFor, resolvedLabel, StopActions } from "../StopActions";
import { StopCard } from "../StopCard";
import { objectSummary } from "@/lib/object-info";
import { JourneyPlanActions, JourneyOverview } from "../JourneyOverview";
import { JourneyDone } from "../JourneyDone";
import { focusResult, overviewStopFromPath, type JourneysShared } from "../JourneysPage";
import { GlossaryProvider } from "../Glossary";
import { indexObjects } from "../journey-view";

vi.mock("@/components/SkyChart", () => ({ SkyChart: () => null }));

const journey = MOCK_JOURNEY_RESULT.journeys[0];
const objects = indexObjects(FIXTURE_KB);
const target = (id: string, name: string, ra: number, dec: number): UnifiedTarget => ({ id, name, displayName: name, mag: 4, ra, dec, con: "Ori", category: "Emission Nebula", categoryShort: "Nebula", source: "messier" });
const M42 = target("M42", "Orion Nebula", 83.82, -5.39);
const CATALOG: ObjectCatalog = {
  targets: [M42, target("M1", "Crab Nebula", 83.63, 22.01)],
  stars: [{ id: "HR1713", hr: 1713, ra: 78.63, dec: -8.2, mag: 0.12, name: "Rigel", bayer: "β", constellation: "Ori" } as Star],
};
const html = (props: Partial<Parameters<typeof StopActions>[0]> & { objectId: string }) => renderToStaticMarkup(createElement(StopActions, { actions: NOOP_ACTIONS, ...props }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("StopActions: one calm row with the shared labels", () => {
  it("shows every action in the contract's order and words", () => {
    const t = text(html({ objectId: "M42" }));
    const order = [LINK_LABELS.hop, LINK_LABELS.moon, LINK_LABELS.clock, LINK_LABELS.catalog, LINK_LABELS.images, LINK_LABELS.addToNight, "More"].map((l) => t.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).not.toMatch(/Hop to it|Clock ↗|Check Moon|Add to night\b/);
  });
  it("says 'In tonight's plan' and disables adding when the object is already in tonight's plan", () => {
    const inNight = { ...NOOP_ACTIONS, isInNight: (id: string) => id === "M42" };
    const h = html({ objectId: "M42", actions: inNight });
    expect(text(h)).toContain("In tonight's plan");
    expect(text(h)).not.toContain(LINK_LABELS.addToNight);
    expect(h).toMatch(/<button[^>]*class="object-action add saved"[^>]*disabled=""/);
    // It is the app's one action row (ObjectActionRow), not a second implementation.
    expect(h).toContain('data-testid="object-action-row"');
    expect(html({ objectId: "M1", actions: inNight })).not.toMatch(/disabled=""/);
  });
  it("reaches plain BSC stars (HR<n>) and hides itself for KB-only objects the other tabs cannot show", () => {
    expect(text(html({ objectId: "HR1713", catalog: CATALOG }))).toContain(LINK_LABELS.hop);
    expect(html({ objectId: "HD226868", catalog: CATALOG })).toBe("");
    // Without a catalog the id is used as given; lunar features have no row.
    expect(html({ objectId: "moon:tycho" })).toBe("");
  });
  it("folds the look-up links behind More in compact rows", () => {
    expect(html({ objectId: "M42", compact: true })).toContain('class="stop-actions compact" data-more="closed"');
  });
});

describe("StopActions hands the journey context to the shared actions", () => {
  const at = new Date("2027-01-15T04:54:00Z"), ref = { key: journey.key, stop: 4 };
  it("hops from the previous stop (never from the stop itself) and keeps the journey ref for 'Back to journey'", () => {
    expect(hopOptions("HR2061", { from: "AST-OrionBelt", at, journey: ref })).toEqual({ at, from: "AST-OrionBelt", journey: ref });
    expect(hopOptions("STAR-Betelgeuse", { from: "HR2061", at })).toEqual({ at });
    expect(hopOptions("M42", {})).toEqual({});
  });
  it("tags 'Add to tonight's plan' with the journey and its 1-based stop number", () => {
    expect(addOptions({ journey: ref })).toEqual({ journeyKey: journey.key, journeyStops: [4] });
    expect(addOptions({ journey: ref, plannedAt: at })).toEqual({ journeyKey: journey.key, journeyStops: [4], plannedAts: [at] });
    expect(addOptions({})).toEqual({});
  });
});

function sharedFor(actions: ObjectActions = NOOP_ACTIONS): JourneysShared {
  const page = {
    location: `/journeys/${journey.key}`, navigate: () => {}, lat: 37.77, lon: -122.42, date: new Date("2027-01-15T04:30:00Z"), timezone: "America/Los_Angeles",
    live: true, locationName: "San Francisco", skyBrightness: 21, profile: { fov: 6.5, aperture: 50, magnification: 10, stabilized: false, transmission: 0.9 },
    stars: CATALOG.stars as Star[], targets: CATALOG.targets as UnifiedTarget[], constellations: [], denseStars: [], milkyWay: [], catalogsLoading: false,
    moon: { alt: -10, az: 0, ra: 0, dec: 0, illumination: 0.2 } as unknown as JourneysShared["page"]["moon"], sunAlt: -30, offlineLabel: "Online",
    redLight: false, onRedLight: () => {}, onTime: () => {}, onLive: () => {}, onMoonTab: () => {}, onEditSetup: () => {}, actions,
  } as JourneysShared["page"];
  const store = { ...emptyJourneyStore(), active: { key: journey.key, journey, startedAt: 0, stopIndex: 4, phase: "look", outcomes: journey.stops.map((_, i) => (i === 2 ? { outcome: "skipped" } : { outcome: "seen" })), completedAt: 1 } } as unknown as JourneysShared["store"];
  return {
    page, kb: FIXTURE_KB, objects, skyNodes: [], stopNodes: () => [], moonRing: null, minAlt: 30, go: () => {}, store, updateStore: () => {},
    feedback: emptyFeedbackStore(), updateFeedback: () => {}, actions, catalog: CATALOG, resolve: () => null, hopLeg: () => null, startJourney: () => {},
  };
}
const withResolve = (shared: JourneysShared): JourneysShared => ({ ...shared, resolve: (o) => (typeof o === "string" ? null : CATALOG.targets.some((t) => t.id === o.id) ? { unifiedId: o.id, routingId: o.id, sessionId: o.id, kbId: o.id, name: o.id, ra: o.ra, dec: o.dec, mag: o.mag ?? 0 } : null) });

describe("journey-level links (Overview and Done)", () => {
  it("offers the whole journey as a chained hop and all stops for tonight's plan, plus the Moon check", () => {
    const conditions = { moon: { up: true, illumination: 0.26, rise: null, set: null }, closestMoonDeg: 50 };
    const j = { ...journey, conditions, stops: journey.stops.map((s) => ({ ...s, moonSepDeg: 50 })) };
    const t = text(renderToStaticMarkup(createElement(JourneyPlanActions, { shared: withResolve(sharedFor()), journey: j })));
    expect(t).toContain(LINK_LABELS.hopChain);
    expect(t).toContain(LINK_LABELS.addAllToNight);
    expect(t).toContain("Moon 26% lit and up, nearest stop 50° from it");
    expect(t).toContain(LINK_LABELS.moon);
  });
  it("disables both when no stop is in the app's catalogs", () => {
    const h = renderToStaticMarkup(createElement(JourneyPlanActions, { shared: sharedFor(), journey }));
    expect(h.match(/disabled=""/g)?.length).toBe(2);
  });
  it("reads 'All stops in tonight's plan' when every stop is already there", () => {
    const shared = withResolve({ ...sharedFor(), actions: { ...NOOP_ACTIONS, isInNight: () => true } });
    expect(text(renderToStaticMarkup(createElement(JourneyPlanActions, { shared, journey })))).toContain("All stops in tonight's plan");
  });
  it("sits under Start on the Overview and above the buttons on Done; an opened card closes on the stop actions", () => {
    const shared = withResolve(sharedFor());
    const overview = renderToStaticMarkup(createElement(JourneyOverview, { shared, journey, initialOpen: 0 }));
    expect(overview).toContain('data-testid="journey-plan-actions"');
    expect(overview.indexOf('data-testid="journey-start"')).toBeLessThan(overview.indexOf('data-testid="journey-plan-actions"'));
    expect(overview).toContain('data-testid="stop-actions"');
    const done = renderToStaticMarkup(createElement(JourneyDone, { shared, journey }));
    expect(done).toContain('data-testid="journey-plan-actions"');
    expect(done).toContain('data-testid="journey-recap-actions-3"');
  });
});

describe("the stop card under More: the Catalog's own description and name", () => {
  const sky = { targets: CATALOG.targets, lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles", skyBrightness: 21, profile: sharedFor().page.profile, at: new Date("2027-01-15T04:30:00Z") };
  const render = (id: string, withSky: boolean) => {
    const stop = journey.stops.find((s) => s.objectId === id)!;
    return renderToStaticMarkup(createElement(GlossaryProvider, { entries: [] }, createElement(StopCard, { object: objects.get(id)!, stop, journey, kb: FIXTURE_KB, mode: "field", fovDeg: 6.5, transition: null, ...(withSky ? { sky } : {}) })));
  };
  it("shows the app's shared short description (lib/object-info) under 'Also in the Catalog'", () => {
    const summary = objectSummary("M42", { target: M42, targets: CATALOG.targets });
    expect(summary?.text).toBeTruthy();
    const h = render("M42", true);
    expect(h).toContain('data-testid="journey-stop-catalog-notes"');
    expect(text(h)).toContain("Also in the Catalog");
    expect(text(h)).toContain(summary!.text.slice(0, 30));
  });
  it("titles the stop with the app's one display name (r5 UX #3) and keeps the story-only card without a sky", () => {
    const h = render("M42", true);
    expect(text(h)).toContain("Orion Nebula (M42)");
    expect(h).not.toContain('data-testid="journey-stop-catalog-name"');
    const bare = render("M42", false);
    expect(bare).not.toContain('data-testid="journey-stop-catalog-notes"');
  });
  it("hides 'Also in the Catalog' when the shared description is only the generic line", () => {
    const m43 = { ...target("M43", "De Mairan's Nebula", 83.88, -5.27), desc: "" };
    expect(objectSummary("M43", { target: m43, targets: [m43] })?.source).toBe("generic");
    const stop = { ...journey.stops[0], objectId: "M43" };
    const h = renderToStaticMarkup(createElement(GlossaryProvider, { entries: [] }, createElement(StopCard, { object: objects.get("M43")!, stop, journey, kb: FIXTURE_KB, mode: "field", fovDeg: 6.5, transition: null, sky: { ...sky, targets: [m43] } })));
    expect(h).toContain('data-testid="journey-stop-card"');
    expect(h).not.toContain('data-testid="journey-stop-catalog-notes"');
  });
});

describe("one name per object on journey screens (r5 UX #3)", () => {
  it("labels a resolved object with the app's display name, the star's Bayer form too", () => {
    expect(resolvedLabel({ unifiedId: "M42", routingId: "M42", sessionId: "M42", kbId: "M42", name: "M42", ra: 0, dec: 0, mag: 4 }, CATALOG)).toBe("Orion Nebula (M42)");
    expect(resolvedLabel({ hr: 1713, routingId: "HR1713", sessionId: "star:HR1713", kbId: "HR1713", name: "Rigel", ra: 0, dec: 0, mag: 0.1 }, CATALOG)).toBe("Rigel (β Ori)");
  });
});

describe("Back to journey returns to where the hop was opened (r5 UX #12)", () => {
  it("marks a hop opened from an Overview card, and the Overview reads ?stop=n", () => {
    expect(journeyRefFor({ key: "k", stop: 3 }, "overview")).toEqual({ key: "k", stop: 3, from: "overview" });
    expect(journeyRefFor({ key: "k", stop: 3 }, "field")).toEqual({ key: "k", stop: 3 });
    expect(journeyRefFor(undefined, "overview")).toBeUndefined();
    expect(overviewStopFromPath("/journeys/abc?stop=3")).toBe(2);
    expect(overviewStopFromPath("/journeys/abc?stop=3&from=overview&view=overview")).toBe(2);
    expect(overviewStopFromPath("/journeys/abc?stop=9", 5)).toBeNull();
    expect(overviewStopFromPath("/journeys/abc")).toBeNull();
    expect(overviewStopFromPath("/journeys/abc?stop=0")).toBeNull();
  });
});

describe("focus hand-off (#/journeys?focus=<id>)", () => {
  it("matches the focus object in any id form", () => {
    const result = MOCK_JOURNEY_RESULT;
    expect(focusResult(result, "STAR-Betelgeuse", "Betelgeuse").matched).toBe(true);
    expect(focusResult(result, "star:HR2061", "Betelgeuse").matched).toBe(true);
    expect(focusResult(result, "HR2061", "Betelgeuse").result?.journeys).toHaveLength(1);
    expect(focusResult(result, "NGC7209", "NGC 7209")).toMatchObject({ matched: false, result });
  });
});
