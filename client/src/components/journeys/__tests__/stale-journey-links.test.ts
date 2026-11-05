/** No dead journey links: Planner badges of journeys not on this device, and the stale-key check's demo-KB guard. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import { emptyJourneyStore, JOURNEY_PROGRESS_KEY, rememberJourney } from "@/lib/journeys/progress";
import { NOOP_ACTIONS } from "@/lib/object-links";
import { realJourneyKeyResolver, type JourneyEngineSource } from "../journey-engine";
import { NightJourneyBadge } from "../TonightJourneyList";

const journey = MOCK_JOURNEY_RESULT.journeys[0];

function stubStorage(entries: Record<string, string>) {
  vi.stubGlobal("localStorage", { getItem: (k: string) => entries[k] ?? null, setItem: () => {}, removeItem: () => {} });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("NightJourneyBadge", () => {
  it("links to a journey kept on this device", () => {
    stubStorage({ [JOURNEY_PROGRESS_KEY]: JSON.stringify(rememberJourney(emptyJourneyStore(), journey, false)) });
    const html = renderToStaticMarkup(createElement(NightJourneyBadge, { journeyKey: journey.key, stop: 2, actions: NOOP_ACTIONS }));
    expect(html).toMatch(/^<button/);
    expect(html).toContain(journey.title);
  });

  it("is a plain label, not a dead link, when the journey is gone from this device", () => {
    stubStorage({});
    const html = renderToStaticMarkup(createElement(NightJourneyBadge, { journeyKey: "an-old-key", stop: 2, actions: NOOP_ACTIONS }));
    expect(html).toMatch(/^<span/);
    expect(html).not.toContain("<button");
  });
});

describe("realJourneyKeyResolver", () => {
  const source = (mode: "mock" | "worker"): JourneyEngineSource => ({
    mode, resolvedMode: async () => mode, client: { generate: async () => MOCK_JOURNEY_RESULT }, loadKb: async () => FIXTURE_KB, dispose: () => {},
  });

  it("checks keys against the real KB only, never against the demo KB", async () => {
    expect(await realJourneyKeyResolver(source("mock"))).toBeNull();
    const resolves = await realJourneyKeyResolver(source("worker"));
    expect(resolves).toBeTypeOf("function");
    expect(resolves!("nonsense")).toBe(false);
  });
});
