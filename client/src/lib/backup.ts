import { z } from "zod";
import { settingsSchema, nightListSchema, mergeJourneyTag, journeyTagOf, type NightItem, type Settings } from "./session";
import { plannerStoreSchema, type PlannerStore, type ObservingSession } from "./session-planner";
import { savedLocationsSchema, type SavedLocation } from "./saved-locations";
import {
  feedbackStoreSchema, journeyStoreSchema, MAX_FEEDBACK_RECORDS, MAX_RECENT_JOURNEYS, parseFeedbackStore, parseJourneyStore,
  JOURNEY_FEEDBACK_KEY, JOURNEY_PROGRESS_KEY, type FeedbackRecord, type FeedbackStore, type JourneyStore,
} from "./journeys/progress";

export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const BACKUP_VERSION = 1 as const;

export type BackupData = {
  settings: Settings;
  planner: PlannerStore;
  savedLocations: SavedLocation[];
  unscheduled?:NightItem[];
  /** Sky Journeys device storage: starhop-journey-v1 (progress) and starhop-journey-feedback-v1 (seen/skip/ratings). */
  journeys?: JourneyBackup;
};
export type JourneyBackup = { progress: JourneyStore | null; feedback: FeedbackStore | null };
const journeyBackupSchema = z.object({ progress: journeyStoreSchema.nullable(), feedback: feedbackStoreSchema.nullable() }).strict();
export type BackupMode = "merge" | "replace";

const backupSchema = z.object({
  format: z.literal("starhop-backup"),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().datetime(),
  data: z.object({
    settings: settingsSchema,
    planner: plannerStoreSchema,
    savedLocations: savedLocationsSchema,
    unscheduled:nightListSchema.optional(),
    journeys:journeyBackupSchema.optional(),
  }).strict(),
}).strict();

export type BackupPreview = {
  backup: BackupData;
  exportedAt: string;
  /** `journeys` (journeys kept on the device) and `journeyFeedback` (seen/skip/rating records) only when the file has them. */
  counts: { sessions: number; targets: number; observations: number; locations: number; journeys?: number; journeyFeedback?: number };
};

/** The backup JSON (one format for files and "Send to phone" links). `compact` drops the indentation (links). */
export function createBackup(data: BackupData, now = new Date(), { compact = false }: { compact?: boolean } = {}): string {
  const parsed = backupSchema.parse({
    format: "starhop-backup",
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data,
  });
  return compact ? JSON.stringify(parsed, compactSettings(parsed.data.settings)) : JSON.stringify(parsed, null, 2);
}
/**
 * Links stay short (QR codes): leave out settings that import back to the same value from their schema defaults
 * (haze "auto", age "30-49", no manual elevation, a support that binocularStabilized already implies).
 */
function compactSettings(settings: Settings) {
  const derivable = settings.binocularSupport === (settings.binocularStabilized ? "stabilized" : "handheld");
  const omit = new Set<string>([
    ...(settings.transparencyMode === "auto" ? ["transparencyMode"] : []),
    ...(settings.observerAge === "30-49" ? ["observerAge"] : []),
    ...(settings.siteElevation === null ? ["siteElevation"] : []),
    ...(derivable ? ["binocularSupport"] : []),
  ]);
  return function (this: unknown, key: string, value: unknown) { return this === settings && omit.has(key) ? undefined : value; };
}

export function parseBackupText(text: string): BackupPreview {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > BACKUP_MAX_BYTES) throw new Error("This backup is larger than 5 MiB.");
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new Error("The selected file is not valid JSON."); }
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new Error("This file is not a supported Starhop backup or contains invalid data.");
  const sessions = parsed.data.data.planner.sessions;
  const items = [...sessions.flatMap(session => session.items),...(parsed.data.data.unscheduled??[])];
  return {
    backup: parsed.data.data,
    exportedAt: parsed.data.exportedAt,
    counts: {
      sessions: sessions.length,
      targets: new Set(items.map(item => item.id)).size,
      observations: items.reduce((sum,item)=>sum+(item.observations?.length??(item.observedAt?1:0)),0),
      locations: parsed.data.data.savedLocations.length,
      ...journeyCounts(parsed.data.data.journeys),
    },
  };
}

export async function readBackupFile(file: Pick<File, "size" | "text">): Promise<BackupPreview> {
  if (file.size > BACKUP_MAX_BYTES) throw new Error("This backup is larger than 5 MiB.");
  return parseBackupText(await file.text());
}

function mergeNotes(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming || incoming === existing || existing.includes(incoming)) return existing;
  if (incoming.includes(existing)) return incoming;
  return `${existing}\n\n${incoming}`;
}

function mergeSession(existing: ObservingSession, incoming: ObservingSession): ObservingSession {
  const items = new Map(existing.items.map(item => [item.id, item]));
  for (const item of incoming.items) {
    const previous = items.get(item.id);
    if (!previous) { items.set(item.id, item); continue; }
    items.set(item.id, {
      ...previous,
      addedAt: previous.addedAt < item.addedAt ? previous.addedAt : item.addedAt,
      observedAt: previous.observedAt && item.observedAt
        ? (previous.observedAt > item.observedAt ? previous.observedAt : item.observedAt)
        : previous.observedAt ?? item.observedAt,
      notes: mergeNotes(previous.notes, item.notes),
      // Journey tag (mergeJourneyTag): a restored item keeps the backup's planned time when it has one.
      ...journeyTagOf(mergeJourneyTag(previous, item, { preferIncomingTime: true })),
      observations:Array.from(new Map([...(previous.observations??(previous.observedAt?[{at:previous.observedAt,notes:previous.notes}]:[])),...(item.observations??(item.observedAt?[{at:item.observedAt,notes:item.notes}]:[]))].map(entry=>[`${entry.at}/${entry.notes}`,entry])).values()),
    });
  }
  return plannerStoreSchema.shape.sessions.element.parse({ ...existing, items: Array.from(items.values()) });
}

export function applyBackup(current: BackupData, incoming: BackupData, mode: BackupMode): BackupData {
  if (mode === "replace") return backupSchema.shape.data.parse(incoming);

  const sessions = new Map(current.planner.sessions.map(session => [session.id, session]));
  for (const session of incoming.planner.sessions) {
    const existing = sessions.get(session.id);
    sessions.set(session.id, existing ? mergeSession(existing, session) : session);
  }
  if (sessions.size > 300) throw new Error("Merging these backups would exceed the 300 session limit.");

  const locations = [...current.savedLocations];
  for (const location of incoming.savedLocations) {
    if (locations.some(site => site.id === location.id || site.name.toLocaleLowerCase() === location.name.toLocaleLowerCase() || (Math.abs(site.lat - location.lat) < 1e-6 && Math.abs(site.lon - location.lon) < 1e-6))) continue;
    locations.push(location);
  }
  if (locations.length > 50) throw new Error("Merging these backups would exceed the 50 saved location limit.");

  return {
    // Preferences describe one device's current working setup, so imported
    // preferences become current while lists and sessions are combined.
    settings: settingsSchema.parse(incoming.settings),
    planner: plannerStoreSchema.parse({
      sessions: Array.from(sessions.values()),
      activeId: current.planner.activeId && sessions.has(current.planner.activeId)
        ? current.planner.activeId
        : incoming.planner.activeId,
    }),
    savedLocations: savedLocationsSchema.parse(locations),
    unscheduled:nightListSchema.parse([...(current.unscheduled??[]),...(incoming.unscheduled??[])]),
    ...(current.journeys||incoming.journeys ? { journeys: mergeJourneyBackup(current.journeys, incoming.journeys) } : {}),
  };
}

// ───────────────────────────── Sky Journeys storage ─────────────────────────────

function journeyCounts(j: JourneyBackup | undefined): { journeys?: number; journeyFeedback?: number } {
  if (!j) return {};
  const keys = new Set([...(j.progress?.active ? [j.progress.active.key] : []), ...(j.progress?.recent ?? []).map(r => r.journey.key)]);
  return { journeys: keys.size, journeyFeedback: j.feedback?.records.length ?? 0 };
}

const unfinished = (store: JourneyStore | null) => (store?.active && !store.active.completedAt ? store.active : null);

/**
 * Merge two journey progress stores. An unfinished journey on this device stays active; otherwise an unfinished
 * imported one becomes active. Recent journeys are combined (newest copy of each key). Imported preferences become
 * current, like the app settings.
 */
export function mergeJourneyStores(current: JourneyStore | null, incoming: JourneyStore | null): JourneyStore | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const active = unfinished(current) ?? unfinished(incoming)
    ?? ([current.active, incoming.active].filter(Boolean).sort((a, b) => b!.savedAt - a!.savedAt)[0] ?? null);
  const byKey = new Map<string, JourneyStore["recent"][number]>();
  for (const r of [...current.recent, ...incoming.recent]) {
    const seen = byKey.get(r.journey.key);
    if (!seen || r.savedAt > seen.savedAt) byKey.set(r.journey.key, r);
  }
  const recent = Array.from(byKey.values()).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_RECENT_JOURNEYS);
  const skipPreflight = incoming.skipPreflight ?? current.skipPreflight;
  const prefs = incoming.prefs ?? current.prefs;
  return journeyStoreSchema.parse({ version: 1, active, recent, ...(skipPreflight !== undefined ? { skipPreflight } : {}), ...(prefs ? { prefs } : {}) });
}

const feedbackIdentity = (r: FeedbackRecord) => (r.type === "stop" ? `stop|${r.journeyKey}|${r.stopIndex}` : `journey|${r.journeyKey}`);

/** Merge feedback logs: one record per stop/journey (the latest wins), oldest first, capped like the app's store. */
export function mergeFeedbackStores(current: FeedbackStore | null, incoming: FeedbackStore | null): FeedbackStore | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const byId = new Map<string, FeedbackRecord>();
  for (const r of [...current.records, ...incoming.records]) {
    const id = feedbackIdentity(r), seen = byId.get(id);
    if (!seen || r.at >= seen.at) byId.set(id, r);
  }
  const records = Array.from(byId.values()).sort((a, b) => a.at - b.at);
  return feedbackStoreSchema.parse({ version: 1, records: records.slice(Math.max(0, records.length - MAX_FEEDBACK_RECORDS)) });
}

function mergeJourneyBackup(current: JourneyBackup | undefined, incoming: JourneyBackup | undefined): JourneyBackup {
  return {
    progress: mergeJourneyStores(current?.progress ?? null, incoming?.progress ?? null),
    feedback: mergeFeedbackStores(current?.feedback ?? null, incoming?.feedback ?? null),
  };
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;
const deviceStorage = (): KeyValueStorage | null => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

/** Read both journey keys from this device (validated, expired live entries dropped); undefined when there is nothing. */
export function readJourneyBackup(storage: KeyValueStorage | null = deviceStorage(), now = Date.now()): JourneyBackup | undefined {
  if (!storage) return undefined;
  let rawProgress: string | null = null, rawFeedback: string | null = null;
  try { rawProgress = storage.getItem(JOURNEY_PROGRESS_KEY); rawFeedback = storage.getItem(JOURNEY_FEEDBACK_KEY); } catch { return undefined; }
  const progress = rawProgress ? parseJourneyStore(rawProgress, now) : null;
  const feedback = rawFeedback ? parseFeedbackStore(rawFeedback) : null;
  const hasProgress = !!progress && (!!progress.active || progress.recent.length > 0 || !!progress.prefs || progress.skipPreflight !== undefined);
  const hasFeedback = !!feedback && feedback.records.length > 0;
  return hasProgress || hasFeedback ? { progress: hasProgress ? progress : null, feedback: hasFeedback ? feedback : null } : undefined;
}

/** Write restored journey storage back to this device (schema-checked). Keys the backup does not carry are left untouched. */
export function writeJourneyBackup(journeys: JourneyBackup | undefined, storage: KeyValueStorage | null = deviceStorage()): boolean {
  if (!journeys || !storage) return true;
  let ok = true;
  if (journeys.progress) ok = (journeyStoreSchema.safeParse(journeys.progress).success && trySet(storage, JOURNEY_PROGRESS_KEY, journeys.progress)) && ok;
  if (journeys.feedback) ok = (feedbackStoreSchema.safeParse(journeys.feedback).success && trySet(storage, JOURNEY_FEEDBACK_KEY, journeys.feedback)) && ok;
  return ok;
}
function trySet(storage: KeyValueStorage, key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
