/**
 * Sky Journeys device storage (spec decision 12, doc 06 §2 / §6.6). Two keys, both zod-validated on read:
 *
 * - `starhop-journey-v1`: the active journey's progress (current stop, phase, per-stop outcomes) plus a short
 *   list of recently opened journeys, so a deep link `#/journeys/:key` survives a reload. Entries saved while the
 *   app was in live-sky mode expire after 8 h, like `hop-progress.ts`; planned-sky entries are kept.
 * - `starhop-journey-feedback-v1`: local-only learning signals (seen / skipped / rating), capped at 500 records.
 *
 * Pure functions take and return plain objects; only the read/write helpers touch localStorage and they never throw.
 */
import { z } from "zod";
import { JourneySchema } from "./kb-schema";
import type { Journey } from "./types";

export const JOURNEY_PROGRESS_KEY = "starhop-journey-v1";
export const JOURNEY_FEEDBACK_KEY = "starhop-journey-feedback-v1";
export const LIVE_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const MAX_RECENT_JOURNEYS = 6;
export const MAX_FEEDBACK_RECORDS = 500;
const MAX_RAW = 400_000;
const FUTURE_SLACK_MS = 60_000;

// ───────────────────────────── progress ─────────────────────────────

export const stopOutcomeSchema = z.enum(["seen", "skipped", "missed"]);
export type StopOutcome = z.infer<typeof stopOutcomeSchema>;
export const skipReasonSchema = z.enum(["not-found", "too-faint", "blocked", "not-interested"]);
export type SkipReason = z.infer<typeof skipReasonSchema>;
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  "not-found": "Couldn't find it",
  "too-faint": "Too faint",
  blocked: "Blocked by a tree or house",
  "not-interested": "Not interested",
};

export const stopRecordSchema = z.object({
  outcome: stopOutcomeSchema,
  reason: skipReasonSchema.optional(),
  at: z.number().finite(),
});
export type StopRecord = z.infer<typeof stopRecordSchema>;

export const journeyPhaseSchema = z.enum(["get-there", "look"]);
export type JourneyPhase = z.infer<typeof journeyPhaseSchema>;

export const journeyProgressSchema = z.object({
  key: z.string().min(1).max(400),
  journey: JourneySchema,
  /** 0-based index of the current stop. */
  stopIndex: z.number().int().min(0).max(99),
  phase: journeyPhaseSchema,
  /** One entry per stop (null = not reached yet). */
  outcomes: z.array(stopRecordSchema.nullable()).max(100),
  startedAt: z.number().finite(),
  savedAt: z.number().finite(),
  live: z.boolean(),
  completedAt: z.number().finite().optional(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** Pre-flight sheet already shown for this journey. */
  preflightDone: z.boolean().optional(),
});
export type JourneyProgress = z.infer<typeof journeyProgressSchema>;

export const recentJourneySchema = z.object({ journey: JourneySchema, savedAt: z.number().finite(), live: z.boolean() });
export type RecentJourney = z.infer<typeof recentJourneySchema>;

const compass8Schema = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
/** Discovery controls remembered on this device. Open sky is per site (key "lat,lon" rounded to 0.01°). */
export const journeyPrefsSchema = z.object({
  theme: z.string().max(100).nullable().optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  minAlt: z.number().min(20).max(40).optional(),
  includeChallenge: z.boolean().optional(),
  openSky: z.record(z.string().max(40), z.array(compass8Schema).min(1).max(8)).optional(),
});
export type JourneyPrefs = z.infer<typeof journeyPrefsSchema>;
export const siteKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export const journeyStoreSchema = z.object({
  version: z.literal(1),
  active: journeyProgressSchema.nullable(),
  recent: z.array(recentJourneySchema).max(20),
  /** "Don't ask again" on the pre-flight sheet. */
  skipPreflight: z.boolean().optional(),
  prefs: journeyPrefsSchema.optional(),
});
export type JourneyStore = z.infer<typeof journeyStoreSchema>;

export const emptyJourneyStore = (): JourneyStore => ({ version: 1, active: null, recent: [] });

const fresh = (savedAt: number, live: boolean, now: number) =>
  savedAt <= now + FUTURE_SLACK_MS && (!live || now - savedAt <= LIVE_MAX_AGE_MS);

/** Validate + expire. Invalid JSON or schema → empty store; expired entries are dropped individually. */
export function parseJourneyStore(raw: string | null, now = Date.now()): JourneyStore {
  if (!raw || raw.length > MAX_RAW) return emptyJourneyStore();
  try {
    const parsed = journeyStoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return emptyJourneyStore();
    const s = parsed.data;
    const active = s.active && fresh(s.active.savedAt, s.active.live, now) && s.active.stopIndex < s.active.journey.stops.length ? s.active : null;
    return { ...s, active, recent: s.recent.filter((r) => fresh(r.savedAt, r.live, now)).slice(0, MAX_RECENT_JOURNEYS) };
  } catch {
    return emptyJourneyStore();
  }
}

export function readJourneyStore(now = Date.now()): JourneyStore {
  try { return parseJourneyStore(localStorage.getItem(JOURNEY_PROGRESS_KEY), now); } catch { return emptyJourneyStore(); }
}

export function writeJourneyStore(store: JourneyStore): boolean {
  try {
    const raw = JSON.stringify(store);
    if (raw.length > MAX_RAW || !journeyStoreSchema.safeParse(store).success) return false;
    localStorage.setItem(JOURNEY_PROGRESS_KEY, raw);
    return true;
  } catch { return false; }
}

/** Keep a generated journey so `#/journeys/:key` resolves after a reload (most recent first, deduplicated). */
export function rememberJourney(store: JourneyStore, journey: Journey, live: boolean, now = Date.now()): JourneyStore {
  const recent = [{ journey, savedAt: now, live }, ...store.recent.filter((r) => r.journey.key !== journey.key)].slice(0, MAX_RECENT_JOURNEYS);
  return { ...store, recent };
}

export function findStoredJourney(store: JourneyStore, key: string): Journey | null {
  if (store.active?.key === key) return store.active.journey;
  return store.recent.find((r) => r.journey.key === key)?.journey ?? null;
}

/**
 * Drop the journeys whose key no longer resolves (`resolves`, e.g. journey-key.ts journeyKeyResolver(kb)): after a KB
 * rebuild removed a theme or an object, the active journey or a recent one cannot be shown any more. Returns `store`
 * itself when every entry still resolves.
 */
export function pruneJourneyStore(store: JourneyStore, resolves: (key: string) => boolean): JourneyStore {
  const active = store.active && !resolves(store.active.key) ? null : store.active;
  const recent = store.recent.filter((r) => resolves(r.journey.key));
  return active === store.active && recent.length === store.recent.length ? store : { ...store, active, recent };
}

/** A journey stop's own planned time (its `windowStart`; `stop` is 1-based), or undefined when unknown or invalid. */
export function journeyStopTime(journey: Pick<Journey, "stops"> | null | undefined, stop: number): Date | undefined {
  const iso = journey?.stops[Math.round(stop) - 1]?.windowStart;
  const at = iso ? new Date(iso) : undefined;
  return at && Number.isFinite(at.getTime()) ? at : undefined;
}
/** The planned time of stop `ref.stop` of a journey kept on this device (journeyStopTime over findStoredJourney). */
export function storedStopTime(store: JourneyStore, ref: { key: string; stop: number }): Date | undefined {
  return journeyStopTime(findStoredJourney(store, ref.key), ref.stop);
}

/** Begin (or resume, when the same journey is already active and unfinished) field mode. */
export function startJourneyProgress(store: JourneyStore, journey: Journey, live: boolean, now = Date.now()): JourneyStore {
  if (store.active?.key === journey.key && !store.active.completedAt) return { ...store, active: { ...store.active, savedAt: now, live } };
  const active: JourneyProgress = {
    key: journey.key, journey, stopIndex: 0, phase: "get-there",
    outcomes: journey.stops.map(() => null), startedAt: now, savedAt: now, live,
  };
  return { ...store, active };
}

export function moveTo(progress: JourneyProgress, stopIndex: number, phase: JourneyPhase, now = Date.now()): JourneyProgress {
  const i = Math.max(0, Math.min(progress.journey.stops.length - 1, Math.round(stopIndex)));
  return { ...progress, stopIndex: i, phase, savedAt: now };
}

export function recordOutcome(progress: JourneyProgress, stopIndex: number, outcome: StopOutcome, reason?: SkipReason, now = Date.now()): JourneyProgress {
  const outcomes = progress.journey.stops.map((_, i) => progress.outcomes[i] ?? null);
  if (stopIndex < 0 || stopIndex >= outcomes.length) return progress;
  outcomes[stopIndex] = { outcome, ...(reason ? { reason } : {}), at: now };
  return { ...progress, outcomes, savedAt: now };
}

export function completeJourney(progress: JourneyProgress, now = Date.now()): JourneyProgress {
  return { ...progress, completedAt: progress.completedAt ?? now, savedAt: now };
}

/** Index of the last stop before `index` that the observer actually saw (−1 if none). */
export function lastSeenBefore(progress: Pick<JourneyProgress, "outcomes">, index: number): number {
  for (let i = Math.min(index, progress.outcomes.length) - 1; i >= 0; i--) if (progress.outcomes[i]?.outcome === "seen") return i;
  return -1;
}

/** How a stop is drawn on the rail, the maps and the storyline. "todo" is neutral: not reached, or jumped over. */
export type StopVisitState = "done" | "skipped" | "current" | "todo";

/**
 * Per-stop visit states from what the observer actually recorded. A stop is "done" only when it was seen and
 * "skipped" only when it was skipped; stops jumped over (a "Start here" at stop 5, a jump on the rail) stay "todo",
 * never done. `current` (0-based, or null) marks the stop on screen: in field mode it wins over the outcome
 * (`currentFirst`), on the Overview a seen stop keeps its tick.
 */
export function stopVisitStates(progress: Pick<JourneyProgress, "outcomes"> | null | undefined, count: number, current: number | null, o: { currentFirst?: boolean } = {}): StopVisitState[] {
  const currentFirst = o.currentFirst ?? true;
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const outcome = progress?.outcomes[i]?.outcome;
    if (i === current && (currentFirst || !outcome)) return "current";
    return outcome === "seen" ? "done" : outcome ? "skipped" : "todo";
  });
}

/** The storyline spine's state for a stop from its visit state: only a seen stop is "past" (a ticked beat). */
export function spineStateOf(state: StopVisitState | undefined): "past" | "current" | "future" {
  return state === "done" ? "past" : state === "current" ? "current" : "future";
}

export function outcomeCounts(progress: Pick<JourneyProgress, "outcomes">) {
  const counts = { seen: 0, skipped: 0, missed: 0, pending: 0 };
  for (const o of progress.outcomes) counts[o ? o.outcome : "pending"]++;
  return counts;
}

// ───────────────────────────── feedback ─────────────────────────────

const stopFeedbackSchema = z.object({
  type: z.literal("stop"),
  journeyKey: z.string().min(1).max(400),
  templateId: z.string().max(200),
  objectId: z.string().min(1).max(200),
  stopIndex: z.number().int().min(0).max(99),
  outcome: z.enum(["seen", "skipped", "not-reached"]),
  reason: skipReasonSchema.optional(),
  /** Time spent in Get there / Look & learn (ms), when measured. */
  getThereMs: z.number().nonnegative().optional(),
  lookMs: z.number().nonnegative().optional(),
  cantFindOpens: z.number().int().nonnegative().optional(),
  at: z.number().finite(),
});
const journeyFeedbackSchema = z.object({
  type: z.literal("journey"),
  journeyKey: z.string().min(1).max(400),
  templateId: z.string().max(200),
  status: z.enum(["completed", "abandoned"]),
  /** 0-based stop where an abandoned journey stopped. */
  atStop: z.number().int().min(0).max(99).optional(),
  /** 1 = meh · 2 = good · 3 = wow. */
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  at: z.number().finite(),
});
export const feedbackRecordSchema = z.discriminatedUnion("type", [stopFeedbackSchema, journeyFeedbackSchema]);
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
export type StopFeedback = z.infer<typeof stopFeedbackSchema>;
export type JourneyFeedback = z.infer<typeof journeyFeedbackSchema>;
export const feedbackStoreSchema = z.object({ version: z.literal(1), records: z.array(feedbackRecordSchema).max(MAX_FEEDBACK_RECORDS) });
export type FeedbackStore = z.infer<typeof feedbackStoreSchema>;
export const emptyFeedbackStore = (): FeedbackStore => ({ version: 1, records: [] });

/** Feedback is not time-limited, but malformed records drop the whole store (it is a learning aid, never critical). */
export function parseFeedbackStore(raw: string | null): FeedbackStore {
  if (!raw || raw.length > MAX_RAW) return emptyFeedbackStore();
  try {
    const parsed = feedbackStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyFeedbackStore();
  } catch { return emptyFeedbackStore(); }
}
export function readFeedbackStore(): FeedbackStore {
  try { return parseFeedbackStore(localStorage.getItem(JOURNEY_FEEDBACK_KEY)); } catch { return emptyFeedbackStore(); }
}
export function writeFeedbackStore(store: FeedbackStore): boolean {
  try {
    if (!feedbackStoreSchema.safeParse(store).success) return false;
    localStorage.setItem(JOURNEY_FEEDBACK_KEY, JSON.stringify(store));
    return true;
  } catch { return false; }
}

/** Drop feedback records of journeys whose key no longer resolves (see pruneJourneyStore); `store` itself when none. */
export function pruneFeedbackStore(store: FeedbackStore, resolves: (key: string) => boolean): FeedbackStore {
  const records = store.records.filter((r) => resolves(r.journeyKey));
  return records.length === store.records.length ? store : { ...store, records };
}

/** Append, dropping the oldest records beyond the cap. A stop record replaces an earlier one for the same journey+stop. */
export function appendFeedback(store: FeedbackStore, record: FeedbackRecord): FeedbackStore {
  const keep = store.records.filter((r) =>
    record.type === "stop"
      ? !(r.type === "stop" && r.journeyKey === record.journeyKey && r.stopIndex === record.stopIndex)
      : !(r.type === "journey" && r.journeyKey === record.journeyKey));
  const records = [...keep, record];
  return { ...store, records: records.slice(Math.max(0, records.length - MAX_FEEDBACK_RECORDS)) };
}

/** Set (or change) the 1-tap end-of-journey rating, keeping the completion status already recorded. */
export function rateJourney(store: FeedbackStore, journeyKey: string, templateId: string, rating: 1 | 2 | 3, now = Date.now()): FeedbackStore {
  const previous = store.records.find((r): r is JourneyFeedback => r.type === "journey" && r.journeyKey === journeyKey);
  return appendFeedback(store, { type: "journey", journeyKey, templateId, status: previous?.status ?? "completed", ...(previous?.atStop !== undefined ? { atStop: previous.atStop } : {}), rating, at: now });
}

export function journeyRating(store: FeedbackStore, journeyKey: string): 1 | 2 | 3 | undefined {
  const r = store.records.find((x): x is JourneyFeedback => x.type === "journey" && x.journeyKey === journeyKey);
  return r?.rating;
}

/** Object ids the observer has already seen in a journey (fed back to the engine as `seenObjectIds`). */
export function seenObjectIds(store: FeedbackStore): string[] {
  return Array.from(new Set(store.records.filter((r): r is StopFeedback => r.type === "stop" && r.outcome === "seen").map((r) => r.objectId)));
}

// ───────────────────────────── "I see it" (shared by field mode and the Star hop bar) ─────────────────────────────

export interface StopSeenTimings { getThereMs?: number; lookMs?: number; cantFindOpens?: number }
export interface StopSeenResult {
  store: JourneyStore;
  feedback: FeedbackStore;
  /** KB id of the stop that was marked; null when the journey is not on this device or the stop is out of range. */
  objectId: string | null;
}

/**
 * "I see it" for journey stop `stop` (1-based) as one pure update of both device stores: the stop's outcome becomes
 * "seen", the journey moves to that stop's Look & learn, and one feedback record is written (it feeds
 * `seenObjectIds`). The journey is found in the store (active, else recent) and started when it is not the active one,
 * so the Star hop bar can mark a stop of a journey that was hopped but never opened in field mode. The caller logs the
 * observation in the Planner with `actions.markObserved` (see `recordStopSeen`), so the journey and the log agree.
 */
export function markStopSeen(stores: { store: JourneyStore; feedback: FeedbackStore }, ref: { key: string; stop: number }, o: { live?: boolean; now?: number; timings?: StopSeenTimings } = {}): StopSeenResult {
  const now = o.now ?? Date.now(), index = Math.round(ref.stop) - 1;
  const journey = findStoredJourney(stores.store, ref.key);
  const stop = journey?.stops[index];
  if (!journey || !stop) return { ...stores, objectId: null };
  let store = stores.store;
  if (store.active?.key !== journey.key) store = startJourneyProgress(store, journey, o.live ?? store.active?.live ?? false, now);
  const active = store.active!;
  store = { ...store, active: moveTo(recordOutcome(active, index, "seen", undefined, now), index, "look", now) };
  const t = o.timings ?? {};
  const feedback = appendFeedback(stores.feedback, {
    type: "stop", journeyKey: journey.key, templateId: journey.templateId, objectId: stop.objectId, stopIndex: index, outcome: "seen",
    ...(t.getThereMs !== undefined ? { getThereMs: Math.round(t.getThereMs) } : {}), ...(t.lookMs !== undefined ? { lookMs: Math.round(t.lookMs) } : {}),
    ...(t.cantFindOpens !== undefined ? { cantFindOpens: t.cantFindOpens } : {}), at: now,
  });
  return { store, feedback, objectId: stop.objectId };
}

/**
 * The side-effecting "I see it" for screens outside Journeys (the Star hop bar): read both stores, apply
 * `markStopSeen`, write them back and log the observation through `markObserved` (ObjectActions.markObserved), with
 * the stop's planned time (`storedStopTime`) when the journey has one.
 * `logId` maps the stop's KB id to the id the Planner logs (e.g. `id => resolveObject(id, catalogs)?.sessionId ?? null`);
 * a null there marks the journey stop without a Planner entry (a KB-only object the Planner cannot list).
 * Returns the stop's KB id, or null when the journey is not on this device.
 */
export function recordStopSeen(ref: { key: string; stop: number }, markObserved: (id: string, plannedAt?: Date) => void, o: { live?: boolean; now?: number; logId?: (kbId: string) => string | null } = {}): string | null {
  const before = readJourneyStore(o.now);
  const result = markStopSeen({ store: before, feedback: readFeedbackStore() }, ref, o);
  if (!result.objectId) return null;
  writeJourneyStore(result.store);
  writeFeedbackStore(result.feedback);
  const logId = o.logId ? o.logId(result.objectId) : result.objectId;
  // The stop's own planned time goes with the log, so the Planner keeps the stop in the journey's block.
  if (logId) markObserved(logId, storedStopTime(before, ref));
  return result.objectId;
}
