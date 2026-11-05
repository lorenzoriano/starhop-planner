import { describe, expect, it } from "vitest";
import { journeySlots, makeSession, sessionFreeGaps, sessionTimelineItems, suggestSequence } from "../session-planner";
import { appendNightItems } from "../night-ops";
import { nightListSchema, type NightItem } from "../session";
import type { UnifiedTarget } from "../astronomy";

// "How Deep Does Perseus Go?" on the night of Nov 3, 2026 in San Francisco: stops 1–5 from 20:30 to ~21:02 PST.
const t = (id: string, ra: number, dec: number, mag: number, category: string): UnifiedTarget =>
  ({ id, name: id, displayName: id, ra, dec, con: "Per", mag, category, categoryShort: category, source: "binocular" });
const targets: UnifiedTarget[] = [
  t("STAR-Algol", 47.04, 40.96, 2.1, "Star"), t("Mel20", 51.1, 49.5, 1.2, "Open Cluster"), t("Stock2", 33.75, 59.5, 4.4, "Open Cluster"),
  t("NGC457", 19.8, 58.3, 6.4, "Open Cluster"), t("M31", 10.68, 41.27, 3.4, "Spiral Galaxy"), t("M13", 250.42, 36.46, 5.8, "Globular Cluster"),
  t("M45", 56.75, 24.12, 1.6, "Open Cluster"),
];
const STOPS = ["STAR-Algol", "Mel20", "Stock2", "NGC457", "M31"];
const first = new Date("2026-11-04T04:30:00Z"); // 20:30 PST
const stopTimes = STOPS.map((_, i) => new Date(+first + i * 8 * 60_000)); // 20:30, 20:38, 20:46, 20:54, 21:02
const KEY = "A3-how-far~perseus";
const ADDED = "2026-11-04T04:29:00.000Z";
const journeyItems = () => appendNightItems([], STOPS, { at: ADDED, journeyKey: KEY, journeyStops: [1, 2, 3, 4, 5], plannedAts: stopTimes }).items;
const hhmm = (d: Date | null) => d ? d.toISOString().slice(11, 16) : null;

describe("journey stops in the Planner", () => {
  it("stores each stop's own time (plannedAt) and the schema keeps it", () => {
    const items = journeyItems();
    expect(items.map((i) => [i.id, i.journeyStop, i.plannedAt])).toEqual(STOPS.map((id, i) => [id, i + 1, stopTimes[i].toISOString()]));
    expect(nightListSchema.parse(items)).toEqual(items);
    // Older data without plannedAt still parses; invalid times are dropped by appendNightItems.
    expect(nightListSchema.parse([{ id: "M31", addedAt: ADDED, notes: "" }])[0].plannedAt).toBeUndefined();
    expect(appendNightItems([], ["M31"], { at: ADDED, plannedAts: [new Date("nope")] }).items[0].plannedAt).toBeUndefined();
  });

  it("an existing untagged item gains the journey tag and its planned time without moving", () => {
    const existing: NightItem[] = [{ id: "M31", addedAt: "2026-11-01T10:00:00.000Z", notes: "keep" }];
    const { items } = appendNightItems(existing, STOPS, { at: ADDED, journeyKey: KEY, journeyStops: [1, 2, 3, 4, 5], plannedAts: stopTimes });
    expect(items[0]).toEqual({ ...existing[0], journeyKey: KEY, journeyStop: 5, plannedAt: stopTimes[4].toISOString() });
  });

  it("keeps story order and the journey's times as one locked block (no re-sorting by altitude)", () => {
    const session = makeSession("Nov 3", first, 37.77, -122.42, journeyItems());
    const steps = suggestSequence(session, targets);
    expect(steps.map((s) => s.id)).toEqual(STOPS);
    expect(steps.map((s) => hhmm(s.date))).toEqual(["04:30", "04:38", "04:46", "04:54", "05:02"]);
    expect(steps.every((s) => s.journey?.key === KEY)).toBe(true);
    expect(steps.map((s) => s.minutes)).toEqual([8, 8, 8, 8, 8]);
    expect(steps[0].reason).toBe("At the journey’s time");
    // The block opens the session: no "Free 20:30–22:00" before it, one free span after it.
    const gaps = sessionFreeGaps(session, steps);
    expect(gaps.map((g) => [hhmm(g.start), hhmm(g.end)])).toEqual([["05:10", "07:30"]]);
    expect(sessionTimelineItems(session.items, steps).map((i) => i.id)).toEqual(STOPS);
  });

  it("fits free targets around the journey block without overlapping it", () => {
    const items = [...journeyItems(), { id: "M45", addedAt: ADDED, notes: "" }, { id: "M13", addedAt: ADDED, notes: "" }];
    const session = makeSession("Nov 3", new Date(+first - 60 * 60_000), 37.77, -122.42, items);
    const steps = suggestSequence(session, targets).filter((s) => s.date);
    const journey = steps.filter((s) => s.journey);
    expect(journey.map((s) => s.id)).toEqual(STOPS);
    expect(journey.map((s) => +s.date!)).toEqual(stopTimes.map((d) => +d));
    const blockStart = +stopTimes[0], blockEnd = +stopTimes[4] + 8 * 60_000;
    for (const free of steps.filter((s) => !s.journey)) {
      const start = +free.date!, end = start + session.minutesPerTarget * 60_000;
      expect(end <= blockStart || start >= blockEnd).toBe(true);
    }
    // Steps come back in time order.
    expect(steps.map((s) => +s.date!)).toEqual(steps.map((s) => +s.date!).slice().sort((a, b) => a - b));
  });

  it("never moves a stop whose journey time is outside the session; it is listed as not fitting", () => {
    const session = makeSession("Nov 3", first, 37.77, -122.42, journeyItems());
    session.durationMinutes = 30; // ends 21:00, before stops 4 (20:54 starts inside) and 5 (21:02)
    const steps = suggestSequence(session, targets);
    expect(steps.filter((s) => s.date).map((s) => s.id)).toEqual(STOPS.slice(0, 4));
    const out = steps.find((s) => s.id === "M31")!;
    expect(out.date).toBeNull();
    expect(out.journey?.plannedAt.toISOString()).toBe(stopTimes[4].toISOString());
    expect(out.reason).toBe("The journey visits it outside this session");
  });

  it("older journey items without times still keep story order", () => {
    const items = appendNightItems([], [...STOPS].reverse(), { at: ADDED, journeyKey: KEY, journeyStops: [5, 4, 3, 2, 1] }).items;
    expect(journeySlots({ ...makeSession("x", first, 37.77, -122.42, items) })).toEqual([]);
    const session = makeSession("Nov 3", first, 37.77, -122.42, items);
    const scheduled = suggestSequence(session, targets).filter((s) => s.date);
    expect(scheduled.map((s) => s.id)).toEqual(STOPS.filter((id) => scheduled.some((s) => s.id === id)));
    expect(scheduled.length).toBeGreaterThanOrEqual(4);
  });

  it("observed journey items leave the block", () => {
    const items = journeyItems().map((i, n) => n === 0 ? { ...i, observedAt: "2026-11-04T04:35:00.000Z" } : i);
    const steps = suggestSequence(makeSession("Nov 3", first, 37.77, -122.42, items), targets);
    expect(steps.map((s) => s.id)).toEqual(STOPS.slice(1));
  });
});
