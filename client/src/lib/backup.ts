import { z } from "zod";
import { settingsSchema, nightListSchema, type NightItem, type Settings } from "./session";
import { plannerStoreSchema, type PlannerStore, type ObservingSession } from "./session-planner";
import { savedLocationsSchema, type SavedLocation } from "./saved-locations";

export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const BACKUP_VERSION = 1 as const;

export type BackupData = {
  settings: Settings;
  planner: PlannerStore;
  savedLocations: SavedLocation[];
  unscheduled?:NightItem[];
};
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
  }).strict(),
}).strict();

export type BackupPreview = {
  backup: BackupData;
  exportedAt: string;
  counts: { sessions: number; targets: number; observations: number; locations: number };
};

export function createBackup(data: BackupData, now = new Date()): string {
  const parsed = backupSchema.parse({
    format: "starhop-backup",
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data,
  });
  return JSON.stringify(parsed, null, 2);
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
  };
}
