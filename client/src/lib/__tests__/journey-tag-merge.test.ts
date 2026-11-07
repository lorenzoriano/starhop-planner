/**
 * Journey stops keep their journey tag and their own planned time wherever they enter a night: "Add to tonight's plan"
 * (appendNightItems), the stored-list dedupe (nightListSchema), backup merge (applyBackup) and "I see" (mergeJourneyTag).
 * Also: journey stops keep their slot length, and fitting a session to a journey holds its whole block.
 */
import { describe, expect, it } from "vitest";
import { appendNightItems, nightHolds } from "../night-ops";
import { defaultSettings, mergeJourneyTag, nightListSchema, type NightItem } from "../session";
import { applyBackup, type BackupData } from "../backup";
import { emptyPlanner, journeyBlockFit, journeySlots, makeSession, type ObservingSession } from "../session-planner";


const KEY = "A3-how-far~perseus";
const T1 = "2026-11-04T04:30:00.000Z", T2 = "2026-11-04T04:38:00.000Z";
const item = (id: string, extra: Partial<NightItem> = {}): NightItem => ({ id, addedAt: "2026-11-01T10:00:00.000Z", notes: "", ...extra });

describe("mergeJourneyTag: one rule for a night item's journey tag", () => {
  it("an untagged item takes the journey, its stop and its time", () => {
    expect(mergeJourneyTag(item("M31"), { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })).toEqual(item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T1 }));
  });
  it("the same journey stop without a time gets the incoming time; a time already there stays", () => {
    const untimed = item("M31", { journeyKey: KEY, journeyStop: 5 });
    expect(mergeJourneyTag(untimed, { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })).toEqual({ ...untimed, plannedAt: T1 });
    const timed = { ...untimed, plannedAt: T2 };
    expect(mergeJourneyTag(timed, { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })).toBe(timed);
    // A backup restore keeps the backup's time when it has one.
    expect(mergeJourneyTag(timed, { journeyKey: KEY, journeyStop: 5, plannedAt: T1 }, { preferIncomingTime: true }).plannedAt).toBe(T1);
    expect(mergeJourneyTag(timed, { journeyKey: KEY, journeyStop: 5 }, { preferIncomingTime: true }).plannedAt).toBe(T2);
  });
  it("a stop number known on one side only is filled in; another stop or another journey never changes the item", () => {
    expect(mergeJourneyTag(item("M31", { journeyKey: KEY }), { journeyKey: KEY, journeyStop: 2, plannedAt: T1 })).toEqual(item("M31", { journeyKey: KEY, journeyStop: 2, plannedAt: T1 }));
    const tagged = item("M31", { journeyKey: KEY, journeyStop: 5 });
    expect(mergeJourneyTag(tagged, { journeyKey: KEY, journeyStop: 4, plannedAt: T1 })).toBe(tagged);
    expect(mergeJourneyTag(tagged, { journeyKey: "other", journeyStop: 5, plannedAt: T1 })).toBe(tagged);
    expect(mergeJourneyTag(tagged, {})).toBe(tagged);
  });
});

describe("appendNightItems fills the time of stops already tagged", () => {
  it("a stop tagged without a time gets the journey's time, reported as updated (not added)", () => {
    const existing = [item("M31", { journeyKey: KEY, journeyStop: 1, notes: "keep" }), item("M45", { journeyKey: "other", journeyStop: 1 })];
    const { items, added, updated } = appendNightItems(existing, ["M31", "M45", "NGC869"], { at: T1, journeyKey: KEY, journeyStops: [1, 2, 3], plannedAts: [T1, T2, T2] });
    expect(items[0]).toEqual({ ...existing[0], plannedAt: T1 });
    expect(items[1]).toBe(existing[1]);
    expect(added).toEqual(["NGC869"]);
    expect(updated).toEqual(["M31"]);
    // Adding again changes nothing.
    expect(appendNightItems(items, ["M31", "M45", "NGC869"], { at: T1, journeyKey: KEY, journeyStops: [1, 2, 3], plannedAts: [T1, T2, T2] })).toEqual({ items, added: [], updated: [] });
  });
  it("nightHolds: a stop in the night but untagged or untimed is not 'in' yet, so the add stays enabled", () => {
    const at = new Date(T1);
    expect(nightHolds([item("M31")], "M31")).toBe(true);
    expect(nightHolds([], "M31")).toBe(false);
    expect(nightHolds([item("M31")], "M31", { journeyKey: KEY, journeyStop: 1, plannedAt: at })).toBe(false);
    expect(nightHolds([item("M31", { journeyKey: KEY, journeyStop: 1 })], "M31", { journeyKey: KEY, journeyStop: 1, plannedAt: at })).toBe(false);
    expect(nightHolds([item("M31", { journeyKey: KEY, journeyStop: 1 })], "M31", { journeyKey: KEY, journeyStop: 1 })).toBe(true);
    expect(nightHolds([item("M31", { journeyKey: KEY, journeyStop: 1, plannedAt: T1 })], "M31", { journeyKey: KEY, journeyStop: 1, plannedAt: at })).toBe(true);
    // Another journey's stop: adding cannot change it, so it counts as in the night.
    expect(nightHolds([item("M31", { journeyKey: "other", journeyStop: 3 })], "M31", { journeyKey: KEY, journeyStop: 1, plannedAt: at })).toBe(true);
  });
});

describe("stored lists and backups use the same rule", () => {
  it("the stored-list dedupe fills a missing time for the same journey stop", () => {
    const [merged] = nightListSchema.parse([item("M31", { journeyKey: KEY, journeyStop: 5 }), item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })]);
    expect(merged).toMatchObject({ id: "M31", journeyKey: KEY, journeyStop: 5, plannedAt: T1 });
  });
  it("backup merge fills a missing time and keeps the backup's time when present", () => {
    const session = (items: NightItem[]): ObservingSession => ({ ...makeSession("Nov 3", new Date(T1), 37.77, -122.42, items), id: "night", createdAt: T1 });
    const data = (items: NightItem[]): BackupData => ({ settings: defaultSettings, planner: { ...emptyPlanner, sessions: [session(items)] }, savedLocations: [] });
    const fill = applyBackup(data([item("M31", { journeyKey: KEY, journeyStop: 5 })]), data([item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })]), "merge");
    expect(fill.planner.sessions[0].items[0].plannedAt).toBe(T1);
    const keep = applyBackup(data([item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T2 })]), data([item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })]), "merge");
    expect(keep.planner.sessions[0].items[0].plannedAt).toBe(T1);
    const other = applyBackup(data([item("M31", { journeyKey: "other", journeyStop: 1, plannedAt: T2 })]), data([item("M31", { journeyKey: KEY, journeyStop: 5, plannedAt: T1 })]), "merge");
    expect(other.planner.sessions[0].items[0]).toMatchObject({ journeyKey: "other", journeyStop: 1, plannedAt: T2 });
  });
});

describe("journey stops keep their slot length", () => {
  it("uses each journey stop's own minutes, not the session's minutes per target", () => {
    const start = new Date("2026-11-04T04:00:00Z");
    const items = appendNightItems([], ["M31", "NGC869"], { at: T1, journeyKey: KEY, journeyStops: [1, 2], plannedAts: [new Date(+start + 30 * 60_000), new Date(+start + 35 * 60_000)] }).items;
    const session = { ...makeSession("Nov 3", start, 37.77, -122.42, items), minutesPerTarget: 15 };
    expect(journeySlots(session).map((slot) => slot.minutes)).toEqual([5, 5]);
  });
});

describe("journeyBlockFit: moving or extending a session for a journey holds the whole block", () => {
  const base = new Date("2026-11-04T04:00:00Z");
  const journeySession = (startMinutes: number, duration: number, stopMinutes: number[]) => {
    const items = appendNightItems([], ["M31", "NGC869", "M45"].slice(0, stopMinutes.length), { at: T1, journeyKey: KEY, journeyStops: stopMinutes.map((_, i) => i + 1), plannedAts: stopMinutes.map((m) => new Date(+base + m * 60_000)) }).items;
    return { ...makeSession("Nov 3", new Date(+base + startMinutes * 60_000), 37.77, -122.42, items), durationMinutes: duration };
  };
  const minutesOf = (d: Date) => (+d - +base) / 60_000;
  it("a journey starting before the session moves the start to its first stop and keeps its last stop inside", () => {
    // Session 01:00–01:30 after base; journey 0:00, 0:40, 1:20 (each 40 min apart, capped at 15 per target).
    const fit = journeyBlockFit(journeySession(60, 30, [0, 40, 80]), KEY)!;
    expect(minutesOf(fit.startAt)).toBe(0);
    expect(minutesOf(fit.startAt) + fit.durationMinutes).toBeGreaterThanOrEqual(80 + 15);
    expect(fit.clamped).toBe(false);
  });
  it("a journey after the session extends the end to its last stop's slot, keeping the start", () => {
    const fit = journeyBlockFit(journeySession(0, 60, [90, 100]), KEY)!;
    expect(minutesOf(fit.startAt)).toBe(0);
    expect(fit.durationMinutes).toBe(110);
  });
  it("past the 12-hour limit the start moves later to hold the block, and says when even that cannot fit", () => {
    const later = journeyBlockFit(journeySession(0, 60, [710, 720]), KEY)!;
    expect(minutesOf(later.startAt)).toBe(10);
    expect(minutesOf(later.startAt) + later.durationMinutes).toBeGreaterThanOrEqual(720);
    expect(later.durationMinutes).toBeLessThanOrEqual(720);
    expect(later.clamped).toBe(false);
    const tooLong = journeyBlockFit(journeySession(0, 60, [0, 400, 800]), KEY)!;
    expect(tooLong.clamped).toBe(true);
    expect(minutesOf(tooLong.startAt)).toBe(0);
    expect(tooLong.durationMinutes).toBe(720);
  });
  it("is null for a journey with no timed stop in the session", () => {
    expect(journeyBlockFit(journeySession(0, 60, [10]), "another")).toBeNull();
  });
});
