import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonCharts, SeasonChart } from "../ObjectComparisonCharts";
import { CLOCK_COLORS, type ClockSample, type ClockSeason } from "@/lib/astronomical-clock";
import { MONTH_COLORS } from "@/lib/seasonal-clock-visual";
import type { UnifiedTarget } from "@/lib/astronomy";

const target = { id: "m31", name: "M31", displayName: "Andromeda", ra: 0, dec: 0 } as UnifiedTarget;
const samples: ClockSample[] = [18, 19, 20, 21].map((hour) => ({
  ms: Date.parse(`2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`),
  hour,
  sun: -20,
  moon: -10,
  lit: 0.5,
  alt: [hour === 19 ? 0 : 30],
  separation: [45],
}));

describe("clock comparison chart", () => {
  it("marks the horizon and labels dusk, dawn, and whole local hours", () => {
    const html = renderToStaticMarkup(createElement(ComparisonCharts, {
      samples,
      targets: [target],
      at: new Date(samples[1].ms),
      timezone: "UTC",
      values: [{ alt: 0, separation: 45 }],
      onCursor: () => undefined,
      onTime: () => undefined,
      locked: false,
      onUnlock: () => undefined,
      onAdjustTime: () => undefined,
    }));

    expect(html).toContain('stroke="#d5e1d9"');
    expect(html).toContain("0°");
    expect(html).toContain("Dusk · 18:00");
    expect(html).toContain("19:00");
    expect(html).toContain("Dawn · 21:00");
    expect(html).not.toContain("19:50");
    expect(html).toContain('stroke-dasharray="10 3 2 3"');
    expect(html).toContain('width="28" height="8"');
    expect(html).not.toContain("Moon altitude · long/short dashes");
  });

  it("defaults the seasonal chart to the actual Moon-free hours series", () => {
    const season: ClockSeason = {
      days: [{
        day: "2026-01-01",
        moonFree: [2.5],
        hours: [7],
        available: [9],
        contrast: [4.2],
        lit: 0.5,
      }],
      bins: [[0]],
      trajectories: [],
    };
    const html = renderToStaticMarkup(createElement(SeasonChart, {
      season,
      targets: [target],
      night: "2026-01-01",
      onNight: () => undefined,
      timezone: "UTC",
    }));

    expect(html).toContain('value="moonFree" selected=""');
    expect(html).toContain("Estimated time in astronomical darkness");
    expect(html).toContain(`stroke="${CLOCK_COLORS[0]}"`);
    expect(html).toContain("M31 · 2.5 h");
    expect(html).toContain('y="');
    expect(html).toContain("Jan 1, 2026");
    expect(html).not.toContain(">2026-01-01</button>");
  });

  it("assigns a distinct color to each monthly trajectory", () => {
    expect(MONTH_COLORS).toHaveLength(12);
    expect(new Set(MONTH_COLORS).size).toBe(12);
  });
});
