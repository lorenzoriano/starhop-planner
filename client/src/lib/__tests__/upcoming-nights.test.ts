import { describe, expect, it } from "vitest";
import { bestUpcomingNights, upcomingNights } from "../upcoming-nights";
import type { UnifiedTarget } from "../astronomy";

const sanFrancisco = { lat: 37.77, lon: -122.42, timezone: "America/Los_Angeles" };
const m31: UnifiedTarget = {
  id: "M31", name: "Andromeda Galaxy", displayName: "M31 — Andromeda Galaxy",
  ra: 10.6847, dec: 41.269, con: "And", mag: 3.4, category: "Spiral Galaxy",
  categoryShort: "Galaxy", source: "messier",
};

describe("upcoming observing nights", () => {
  it("uses local noon-to-noon dates and real elapsed duration across daylight saving", () => {
    const nights = upcomingNights({
      ...sanFrancisco,
      date: new Date("2026-03-08T09:30:00Z"), // 1:30 am before the spring clock change
      days: 3,
    });

    expect(nights.map((night) => night.date)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect((+nights[0].end - +nights[0].start) / 3_600_000).toBe(23);
    expect((+nights[1].end - +nights[1].start) / 3_600_000).toBe(24);
    expect(nights[0].moonFreeDarkHours).toBeGreaterThanOrEqual(0);
    expect(nights[0].moonFreeDarkHours).toBeLessThanOrEqual(nights[0].darkHours);
  });

  it("reports target altitude only during moon-free darkness and ranks three feasible nights within 30 days", () => {
    const options = {
      ...sanFrancisco,
      date: new Date("2026-10-25T04:30:00Z"), // full-Moon week, after local evening begins
      targets: [m31],
      selected: m31,
    };
    const nights = upcomingNights({ ...options, days: 7 });
    expect(nights).toHaveLength(7);
    for (const night of nights) {
      expect(night.moonFreeDarkHours).toBeGreaterThanOrEqual(0);
      expect(night.moonFreeDarkHours).toBeLessThanOrEqual(night.darkHours + 1e-8);
      expect(night.selectedTarget?.id).toBe("M31");
      expect(night.selectedTarget?.goodAltitudeHours).toBeGreaterThanOrEqual(0);
      if (night.selectedTarget?.bestAt) {
        expect(+night.selectedTarget.bestAt).toBeGreaterThanOrEqual(+night.start);
        expect(+night.selectedTarget.bestAt).toBeLessThan(+night.end);
        expect(night.selectedTarget.goodAltitudeHours).toBeGreaterThan(0);
      }
    }

    const best = bestUpcomingNights(options);
    expect(best).toHaveLength(3);
    expect(best.every((night) => night.selectedTarget!.goodAltitudeHours > 0)).toBe(true);
    expect(best.map((night) => night.geometryScore)).toEqual(
      [...best.map((night) => night.geometryScore)].sort((a, b) => b - a),
    );
    expect(new Set(best.map((night) => night.date)).size).toBe(3);
  });
});
