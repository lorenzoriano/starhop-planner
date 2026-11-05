import { describe, expect, it } from "vitest";
import {
  applyBackup, createBackup, mergeFeedbackStores, mergeJourneyStores, parseBackupText, readJourneyBackup, writeJourneyBackup, type BackupData,
} from "../backup";
import { defaultSettings } from "../session";
import { emptyPlanner } from "../session-planner";
import { MOCK_JOURNEY_RESULT } from "../journeys/__fixtures__/fixture-kb";
import {
  appendFeedback, completeJourney, emptyFeedbackStore, emptyJourneyStore, JOURNEY_FEEDBACK_KEY, JOURNEY_PROGRESS_KEY, rateJourney,
  recordOutcome, rememberJourney, startJourneyProgress, type FeedbackRecord,
} from "../journeys/progress";

const [j1, j2 = MOCK_JOURNEY_RESULT.journeys[0]] = MOCK_JOURNEY_RESULT.journeys;
const other = { ...j2, key: `${j2.key}-other` };
const T0 = Date.UTC(2027, 0, 15, 4, 30);
const base = (journeys?: BackupData["journeys"]): BackupData => ({ settings: defaultSettings, planner: emptyPlanner, savedLocations: [], ...(journeys ? { journeys } : {}) });
const stop = (journeyKey: string, stopIndex: number, at: number, outcome: "seen" | "skipped" = "seen"): FeedbackRecord =>
  ({ type: "stop", journeyKey, templateId: "A1", objectId: `OBJ${stopIndex}`, stopIndex, outcome, at });

class MemoryStorage { map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } }

describe("backups include Sky Journeys storage", () => {
  const progress = startJourneyProgress(rememberJourney(emptyJourneyStore(), j1, false, T0), j1, false, T0);
  const withSeen = { ...progress, active: recordOutcome(progress.active!, 0, "seen", undefined, T0 + 1) };
  const feedback = rateJourney(appendFeedback(emptyFeedbackStore(), stop(j1.key, 0, T0 + 1)), j1.key, j1.templateId, 3, T0 + 2);

  it("round-trips starhop-journey-v1 and starhop-journey-feedback-v1 and counts them in the preview", () => {
    const parsed = parseBackupText(createBackup(base({ progress: withSeen, feedback }), new Date(T0)));
    expect(parsed.backup.journeys?.progress?.active?.outcomes[0]?.outcome).toBe("seen");
    expect(parsed.backup.journeys?.feedback?.records).toHaveLength(2);
    expect(parsed.counts).toMatchObject({ journeys: 1, journeyFeedback: 2 });
  });

  it("still reads older backups without journeys (no journey counts)", () => {
    const parsed = parseBackupText(createBackup(base()));
    expect(parsed.backup.journeys).toBeUndefined();
    expect(parsed.counts.journeys).toBeUndefined();
  });

  it("rejects a backup whose journey storage is malformed", () => {
    const raw = JSON.parse(createBackup(base({ progress: withSeen, feedback })));
    raw.data.journeys.progress.active.stopIndex = "two";
    expect(() => parseBackupText(JSON.stringify(raw))).toThrow(/invalid data/);
  });

  it("merge keeps this device's unfinished journey, adds imported recent journeys and de-duplicates feedback", () => {
    const incomingStore = startJourneyProgress(rememberJourney(emptyJourneyStore(), other, false, T0 + 50), other, false, T0 + 50);
    const incomingFeedback = appendFeedback(appendFeedback(emptyFeedbackStore(), stop(j1.key, 0, T0 + 5, "skipped")), stop(other.key, 1, T0 + 6));
    const merged = applyBackup(base({ progress: withSeen, feedback }), base({ progress: incomingStore, feedback: incomingFeedback }), "merge");
    expect(merged.journeys?.progress?.active?.key).toBe(j1.key);
    expect(merged.journeys?.progress?.recent.map((r) => r.journey.key)).toEqual([other.key, j1.key]);
    const records = merged.journeys!.feedback!.records;
    expect(records).toHaveLength(3); // j1 stop 0 (newer imported skip wins), j1 rating, other stop 1
    expect(records.find((r) => r.type === "stop" && r.journeyKey === j1.key)).toMatchObject({ outcome: "skipped", at: T0 + 5 });
  });

  it("merge makes an imported unfinished journey active when this device's journey is finished", () => {
    const done = { ...withSeen, active: completeJourney(withSeen.active!, T0 + 10) };
    const incoming = startJourneyProgress(emptyJourneyStore(), other, false, T0 + 20);
    expect(mergeJourneyStores(done, incoming)?.active?.key).toBe(other.key);
    expect(mergeJourneyStores(null, incoming)).toBe(incoming);
    expect(mergeJourneyStores(done, null)).toBe(done);
  });

  it("caps merged feedback at the store limit, keeping the newest", () => {
    const many = (from: number) => ({ version: 1 as const, records: Array.from({ length: 300 }, (_, i) => stop(`k${from + i}`, 0, T0 + from + i)) });
    const merged = mergeFeedbackStores(many(0), many(1000))!;
    expect(merged.records).toHaveLength(500);
    expect(merged.records.at(-1)?.journeyKey).toBe("k1299");
    expect(merged.records[0].journeyKey).toBe("k100");
  });

  it("replace restores the backup's journey storage, and leaves the device's alone when the backup has none", () => {
    const incoming = base({ progress: startJourneyProgress(emptyJourneyStore(), other, false, T0), feedback: null });
    expect(applyBackup(base({ progress: withSeen, feedback }), incoming, "replace").journeys?.progress?.active?.key).toBe(other.key);
    expect(applyBackup(base({ progress: withSeen, feedback }), base(), "replace").journeys).toBeUndefined();
  });

  it("reads and writes the two device keys", () => {
    const storage = new MemoryStorage();
    expect(readJourneyBackup(storage, T0)).toBeUndefined();
    expect(writeJourneyBackup({ progress: withSeen, feedback }, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(JOURNEY_PROGRESS_KEY)!).active.key).toBe(j1.key);
    expect(JSON.parse(storage.getItem(JOURNEY_FEEDBACK_KEY)!).records).toHaveLength(2);
    const back = readJourneyBackup(storage, T0 + 100)!;
    expect(back.progress?.active?.key).toBe(j1.key);
    expect(back.feedback?.records).toHaveLength(2);
    // A backup without feedback leaves the device's feedback key untouched; invalid stores are not written.
    expect(writeJourneyBackup({ progress: null, feedback: null }, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(JOURNEY_FEEDBACK_KEY)!).records).toHaveLength(2);
    expect(writeJourneyBackup({ progress: { version: 2 } as never, feedback: null }, storage)).toBe(false);
    expect(JSON.parse(storage.getItem(JOURNEY_PROGRESS_KEY)!).version).toBe(1);
  });
});
