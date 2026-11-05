import { describe, expect, it, vi } from "vitest";
import { MOCK_JOURNEY_RESULT } from "../__fixtures__/fixture-kb";
import {
  appendFeedback, completeJourney, emptyFeedbackStore, emptyJourneyStore, findStoredJourney, journeyRating, lastSeenBefore,
  LIVE_MAX_AGE_MS, markStopSeen, MAX_FEEDBACK_RECORDS, moveTo, outcomeCounts, parseFeedbackStore, parseJourneyStore, rateJourney,
  readFeedbackStore, readJourneyStore, recordOutcome, recordStopSeen, journeyStopTime, storedStopTime, rememberJourney, seenObjectIds, spineStateOf, startJourneyProgress, stopVisitStates, writeJourneyStore, type FeedbackRecord,
} from "../progress";

const journey = MOCK_JOURNEY_RESULT.journeys[0];
const T0 = Date.UTC(2027, 0, 15, 4, 30);

describe("journey progress store (starhop-journey-v1)", () => {
  it("round-trips through JSON and zod validation", () => {
    let store = startJourneyProgress(emptyJourneyStore(), journey, false, T0);
    store = { ...store, active: recordOutcome(moveTo(store.active!, 2, "look", T0 + 1), 1, "seen", undefined, T0 + 2) };
    const back = parseJourneyStore(JSON.stringify(store), T0 + 10);
    expect(back.active?.stopIndex).toBe(2);
    expect(back.active?.phase).toBe("look");
    expect(back.active?.outcomes[1]?.outcome).toBe("seen");
    expect(back.active?.journey.stops.map((s) => s.objectId)).toEqual(journey.stops.map((s) => s.objectId));
  });

  it("expires live progress after 8 hours but keeps planned progress", () => {
    const live = startJourneyProgress(emptyJourneyStore(), journey, true, T0);
    expect(parseJourneyStore(JSON.stringify(live), T0 + LIVE_MAX_AGE_MS - 1000).active).not.toBeNull();
    expect(parseJourneyStore(JSON.stringify(live), T0 + LIVE_MAX_AGE_MS + 1000).active).toBeNull();
    const planned = startJourneyProgress(emptyJourneyStore(), journey, false, T0);
    expect(parseJourneyStore(JSON.stringify(planned), T0 + 10 * LIVE_MAX_AGE_MS).active).not.toBeNull();
  });

  it("rejects malformed, future-dated and oversized data without throwing", () => {
    expect(parseJourneyStore("{not json", T0)).toEqual(emptyJourneyStore());
    expect(parseJourneyStore(JSON.stringify({ version: 2, active: null, recent: [] }), T0)).toEqual(emptyJourneyStore());
    const store = startJourneyProgress(emptyJourneyStore(), journey, false, T0 + 3_600_000);
    expect(parseJourneyStore(JSON.stringify(store), T0).active).toBeNull();
    const broken = { ...store, active: { ...store.active!, stopIndex: 99 } };
    expect(parseJourneyStore(JSON.stringify(broken), T0 + 4_000_000).active).toBeNull();
    expect(parseJourneyStore("x".repeat(500_000), T0)).toEqual(emptyJourneyStore());
  });

  it("resumes the same unfinished journey instead of restarting it", () => {
    let store = startJourneyProgress(emptyJourneyStore(), journey, false, T0);
    store = { ...store, active: moveTo(store.active!, 3, "look", T0 + 5) };
    expect(startJourneyProgress(store, journey, false, T0 + 10).active?.stopIndex).toBe(3);
    const done = { ...store, active: completeJourney(store.active!, T0 + 20) };
    expect(startJourneyProgress(done, journey, false, T0 + 30).active?.stopIndex).toBe(0);
  });

  it("remembers recent journeys for deep links, newest first and deduplicated", () => {
    let store = rememberJourney(emptyJourneyStore(), journey, true, T0);
    const other = { ...journey, key: "other-key" };
    store = rememberJourney(store, other, true, T0 + 1);
    store = rememberJourney(store, journey, true, T0 + 2);
    expect(store.recent.map((r) => r.journey.key)).toEqual([journey.key, "other-key"]);
    expect(findStoredJourney(store, "other-key")?.key).toBe("other-key");
    expect(findStoredJourney(store, "missing")).toBeNull();
    expect(parseJourneyStore(JSON.stringify(store), T0 + LIVE_MAX_AGE_MS + 10).recent).toEqual([]);
  });

  it("finds the last seen stop for skip-aware transitions", () => {
    let p = startJourneyProgress(emptyJourneyStore(), journey, false, T0).active!;
    p = recordOutcome(p, 0, "seen", undefined, T0);
    p = recordOutcome(p, 1, "skipped", "too-faint", T0);
    expect(lastSeenBefore(p, 2)).toBe(0);
    expect(lastSeenBefore(p, 0)).toBe(-1);
    expect(outcomeCounts(p)).toEqual({ seen: 1, skipped: 1, missed: 0, pending: 3 });
    expect(recordOutcome(p, 9, "seen")).toBe(p);
  });
});

describe("journey feedback store (starhop-journey-feedback-v1)", () => {
  const stop = (i: number, outcome: "seen" | "skipped" = "seen"): FeedbackRecord =>
    ({ type: "stop", journeyKey: journey.key, templateId: journey.templateId, objectId: journey.stops[i % 5].objectId, stopIndex: i % 100, outcome, at: T0 + i });

  it("replaces a stop record for the same journey stop and caps at 500 records", () => {
    let store = appendFeedback(emptyFeedbackStore(), stop(0, "skipped"));
    store = appendFeedback(store, stop(0, "seen"));
    expect(store.records).toHaveLength(1);
    expect(seenObjectIds(store)).toEqual([journey.stops[0].objectId]);
    let big = emptyFeedbackStore();
    for (let i = 0; i < MAX_FEEDBACK_RECORDS + 40; i++) big = appendFeedback(big, { ...stop(i), journeyKey: `k${i}` } as FeedbackRecord);
    expect(big.records).toHaveLength(MAX_FEEDBACK_RECORDS);
    expect(big.records[0].journeyKey).toBe("k40");
  });

  it("stores a rating without losing the completion status", () => {
    let store = appendFeedback(emptyFeedbackStore(), { type: "journey", journeyKey: journey.key, templateId: journey.templateId, status: "abandoned", atStop: 2, at: T0 });
    store = rateJourney(store, journey.key, journey.templateId, 3, T0 + 1);
    expect(journeyRating(store, journey.key)).toBe(3);
    const rec = store.records.find((r) => r.type === "journey");
    expect(rec).toMatchObject({ status: "abandoned", atStop: 2, rating: 3 });
    expect(parseFeedbackStore(JSON.stringify(store))).toEqual(store);
    expect(parseFeedbackStore("[]")).toEqual(emptyFeedbackStore());
  });
});

describe("markStopSeen: one 'I see it' for field mode and the Star hop bar", () => {
  it("marks the stop seen, moves to its Look & learn and writes one feedback record", () => {
    const store = startJourneyProgress(emptyJourneyStore(), journey, false, T0);
    const r = markStopSeen({ store, feedback: emptyFeedbackStore() }, { key: journey.key, stop: 3 }, { now: T0 + 5, timings: { getThereMs: 1234.4, cantFindOpens: 1 } });
    expect(r.objectId).toBe(journey.stops[2].objectId);
    expect(r.store.active?.outcomes[2]?.outcome).toBe("seen");
    expect(r.store.active?.stopIndex).toBe(2);
    expect(r.store.active?.phase).toBe("look");
    expect(r.feedback.records).toEqual([{ type: "stop", journeyKey: journey.key, templateId: journey.templateId, objectId: journey.stops[2].objectId, stopIndex: 2, outcome: "seen", getThereMs: 1234, cantFindOpens: 1, at: T0 + 5 }]);
    expect(seenObjectIds(r.feedback)).toEqual([journey.stops[2].objectId]);
    // Marking twice keeps one record per stop.
    const again = markStopSeen({ store: r.store, feedback: r.feedback }, { key: journey.key, stop: 3 }, { now: T0 + 9 });
    expect(again.feedback.records).toHaveLength(1);
  });
  it("starts a remembered journey that is not the active one (hopped from Star hop without field mode)", () => {
    const store = rememberJourney(emptyJourneyStore(), journey, true, T0);
    const r = markStopSeen({ store, feedback: emptyFeedbackStore() }, { key: journey.key, stop: 1 }, { now: T0 + 1, live: true });
    expect(r.store.active?.key).toBe(journey.key);
    expect(r.store.active?.live).toBe(true);
    expect(r.store.active?.outcomes[0]?.outcome).toBe("seen");
  });
  it("changes nothing for an unknown journey or an out-of-range stop", () => {
    const stores = { store: startJourneyProgress(emptyJourneyStore(), journey, false, T0), feedback: emptyFeedbackStore() };
    expect(markStopSeen(stores, { key: "nope", stop: 1 })).toEqual({ ...stores, objectId: null });
    expect(markStopSeen(stores, { key: journey.key, stop: 99 })).toEqual({ ...stores, objectId: null });
  });
  it("recordStopSeen writes both stores and logs under the Planner's id (or not at all)", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    try {
      writeJourneyStore(rememberJourney(emptyJourneyStore(), journey, false, Date.now()));
      const logged: string[] = [];
      expect(recordStopSeen({ key: journey.key, stop: 4 }, (id) => logged.push(id), { logId: (id) => (id === "STAR-Betelgeuse" ? "STAR-Betelgeuse" : null) })).toBe("STAR-Betelgeuse");
      expect(logged).toEqual(["STAR-Betelgeuse"]);
      expect(readJourneyStore().active?.outcomes[3]?.outcome).toBe("seen");
      expect(seenObjectIds(readFeedbackStore())).toEqual(["STAR-Betelgeuse"]);
      expect(recordStopSeen({ key: journey.key, stop: 1 }, (id) => logged.push(id), { logId: () => null })).toBe(journey.stops[0].objectId);
      expect(logged).toEqual(["STAR-Betelgeuse"]);
    } finally { vi.unstubAllGlobals(); }
  });
  it("recordStopSeen logs with the stop's own planned time (its windowStart), so 'I see' keeps the journey's block", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    try {
      writeJourneyStore(rememberJourney(emptyJourneyStore(), journey, false, Date.now()));
      const logged: [string, Date | undefined][] = [];
      recordStopSeen({ key: journey.key, stop: 2 }, (id, at) => logged.push([id, at]));
      expect(logged).toEqual([[journey.stops[1].objectId, new Date(journey.stops[1].windowStart)]]);
    } finally { vi.unstubAllGlobals(); }
  });
  it("journeyStopTime / storedStopTime: a stop's windowStart, undefined when unknown or invalid", () => {
    expect(journeyStopTime(journey, 1)).toEqual(new Date(journey.stops[0].windowStart));
    expect(journeyStopTime(journey, 99)).toBeUndefined();
    expect(journeyStopTime(null, 1)).toBeUndefined();
    expect(journeyStopTime({ stops: [{ ...journey.stops[0], windowStart: "not a time" }] }, 1)).toBeUndefined();
    const store = rememberJourney(emptyJourneyStore(), journey, false, Date.now());
    expect(storedStopTime(store, { key: journey.key, stop: 3 })).toEqual(new Date(journey.stops[2].windowStart));
    expect(storedStopTime(store, { key: "elsewhere", stop: 3 })).toBeUndefined();
  });
});

describe("stopVisitStates: stops jumped over stay neutral (UX r5 #10)", () => {
  it("a Start here at the last stop marks nothing before it as done", () => {
    const n = journey.stops.length, store = startJourneyProgress(emptyJourneyStore(), journey, false, T0);
    const at = moveTo(store.active!, n - 1, "get-there", T0 + 1);
    const states = stopVisitStates(at, n, n - 1);
    expect(states.slice(0, -1).every((s) => s === "todo")).toBe(true);
    expect(states[n - 1]).toBe("current");
    expect(states.map(spineStateOf).filter((s) => s === "past")).toEqual([]);
  });
  it("only seen stops are done; skipped stops keep their own state", () => {
    let p = startJourneyProgress(emptyJourneyStore(), journey, false, T0).active!;
    p = recordOutcome(recordOutcome(p, 0, "seen", undefined, T0), 1, "skipped", "too-faint", T0);
    expect(stopVisitStates(p, 4, 3)).toEqual(["done", "skipped", "todo", "current"]);
    expect(stopVisitStates(p, 4, 3).map(spineStateOf)).toEqual(["past", "future", "future", "current"]);
  });
  it("on the Overview a seen current stop keeps its tick; in field mode the current stop wins", () => {
    const p = recordOutcome(startJourneyProgress(emptyJourneyStore(), journey, false, T0).active!, 2, "seen", undefined, T0);
    expect(stopVisitStates(p, 3, 2, { currentFirst: false })[2]).toBe("done");
    expect(stopVisitStates(p, 3, 2)[2]).toBe("current");
    expect(stopVisitStates(null, 3, null)).toEqual(["todo", "todo", "todo"]);
  });
});
