import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NightAltitudeChart } from "../ObservingVisuals";
import { SelectedTargetPlanning } from "../SelectedTargetPlanning";
import { detailedUnavailableReason } from "../SessionPlanner";
import { visibilityWindow } from "@/lib/target-visibility";
import { saveHorizonLayer } from "@/lib/horizon/store";
import type { HorizonProfile } from "@/lib/horizon/types";
import { makeSession, type SequenceStep } from "@/lib/session-planner";
import type { UnifiedTarget } from "@/lib/astronomy";

const timezone = "America/Los_Angeles", lat = 37.7749, lon = -122.4194;
const southern = { id: "S", name: "Southern cluster", displayName: "Southern cluster", ra: 45, dec: -10, con: "", mag: 5, category: "Open Cluster", categoryShort: "OC", source: "messier" } as UnifiedTarget;
const night = visibilityWindow("2026-11-08", "12:00", "12:00", "night", timezone, lat, lon);
/** Terrain layer: `height`° (apparent) from azimuth `from` to `to`, 0° elsewhere. */
const terrain = (from: number, to: number, height: number): HorizonProfile => ({
  kind: "terrain", stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => (i >= from && i <= to ? height : 0)),
  lat, lon, computedAt: "2026-11-01T00:00:00Z", source: "test",
});
const g = globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem"> };
let original: typeof g.localStorage;
beforeEach(() => {
  original = g.localStorage;
  const data = new Map<string, string>();
  g.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
});
afterEach(() => { g.localStorage = original; });

describe("views with a local horizon", () => {
  it("keeps the night chart unchanged without a horizon", () => {
    const html = renderToStaticMarkup(createElement(NightAltitudeChart, { target: southern, lat, lon, timezone, night, skyBrightness: 21 }));
    expect(html).not.toContain("night-skyline-band");
    expect(html).not.toContain("Your skyline");
    expect(html).not.toContain("target-altitude-blocked");
  });

  it("draws the skyline band and fades the blocked curve", () => {
    expect(saveHorizonLayer(terrain(150, 210, 60))).toBe(true);
    const html = renderToStaticMarkup(createElement(NightAltitudeChart, { target: southern, lat, lon, timezone, night, skyBrightness: 21 }));
    expect(html).toContain('class="night-skyline-band"');
    expect(html).toContain("Your skyline");
    expect(html).toContain('class="target-altitude-blocked"');
    expect(html).toMatch(/class="target-altitude-line"[^>]*clip-path="url\(#[^)]*-clear\)"/);
  });

  it("says when the whole night is behind the skyline", () => {
    saveHorizonLayer(terrain(0, 359, 85));
    const html = renderToStaticMarkup(createElement(NightAltitudeChart, { target: southern, lat, lon, timezone, night, skyBrightness: 21 }));
    expect(html).toContain("Behind the hills all night");
    expect(html).toContain("No dark window above 15° and clear of your skyline");
  });

  it("leads the selected-target times with the skyline", () => {
    const props = { target: southern, lat, lon, timezone, date: new Date("2026-11-09T07:00:00Z"), skyBrightness: 21 };
    const flat = renderToStaticMarkup(createElement(SelectedTargetPlanning, props));
    expect(flat).not.toContain("skyline");
    saveHorizonLayer(terrain(90, 140, 25));
    const html = renderToStaticMarkup(createElement(SelectedTargetPlanning, props));
    expect(html).toMatch(/Clears your skyline \d\d:\d\d · sets behind it \d\d:\d\d/);
    expect(html).toContain("Rise (flat horizon)");
  });

  it("explains a session target hidden by the hills", () => {
    const start = new Date("2026-11-09T06:00:00Z"); // 22:00 PST, the cluster climbing in the southeast
    const session = makeSession("Hills", start, lat, lon, [{ id: "S", addedAt: start.toISOString(), notes: "" }]);
    session.durationMinutes = 60;
    const step = { id: "S", name: "S", date: null, alt: 0, az: 0, separation: null, moonlight: 0, reason: "", lunar: false } as SequenceStep;
    const flat = detailedUnavailableReason(step, session, southern, timezone);
    expect(flat).not.toMatch(/hills/);
    const ridge = { kind: "geometric" as const, stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => (i >= 100 && i <= 175 ? 45 : 0)) };
    expect(detailedUnavailableReason(step, session, southern, timezone, ridge)).toMatch(/^Behind the hills to the (southeast|south) until \d\d:\d\d\.$/);
  });
});
