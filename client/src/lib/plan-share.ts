/**
 * "Send to phone": a plan (or the whole backup) as a link, shown as a QR code on the laptop and opened on the phone.
 *
 * No server and no second format: the link carries the normal backup JSON (backup.ts createBackup, compact),
 * deflated (fflate, raw DEFLATE) and written as base64url in the hash route `#/import?v=1&k=<plan|all>&d=<data>`.
 * The phone validates it with the backup schema (parseBackupText) and merges with the backup merge rules
 * (applyBackup, mergeJourneyStores, mergeJourneyTag), so a plan sent twice never duplicates a night.
 *
 * `v` is the link encoding version (the backup inside keeps its own `format`/`version`). `k=plan` is one observing
 * night with its site and the sender's instrument; `k=all` is a full backup.
 */
import { deflateSync, Inflate } from "fflate";
import { formatInTimeZone } from "date-fns-tz";
import { applyBackup, BACKUP_MAX_BYTES, createBackup, parseBackupText, type BackupData, type BackupPreview, type JourneyBackup } from "./backup";
import { settingsSchema, type Settings } from "./session";
import { plannerStoreSchema, sessionTimezone, type ObservingSession } from "./session-planner";
import { observingNightDate } from "./session-draft";
import { knownLocationName, matchingLocation, type SavedLocation } from "./saved-locations";
import type { JourneyStore } from "./journeys/progress";
import { isShareHash } from "./import-arrival";

export const SHARE_LINK_VERSION = 1;
export const SHARE_ROUTE = "/import";
/** Longest link drawn as a QR code: about a version-30 code at the lowest error correction, which a phone still reads from a laptop screen. */
export const QR_MAX_LINK_CHARS = 1800;
/** Longest link the phone decodes (a full backup can exceed what a chat app keeps; use the backup file then). */
export const SHARE_MAX_LINK_CHARS = 200_000;
export type ShareKind = "plan" | "all";
export type ShareMode = "add" | "replace";

export class ShareLinkError extends Error {}

// ───────────────────────────── encoding ─────────────────────────────

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new ShareLinkError("This link is damaged or incomplete. Copy the whole link, or scan the QR code again.");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** UTF-8 text -> raw DEFLATE (level 9) -> base64url. */
export function compressText(text: string): string {
  return toBase64Url(deflateSync(new TextEncoder().encode(text), { level: 9 }));
}
/** Inverse of compressText; stops at the backup size cap (BACKUP_MAX_BYTES) so a crafted link cannot exhaust memory. */
export function decompressText(data: string): string {
  const chunks: Uint8Array[] = [];
  let size = 0, tooLarge = false;
  const inflate = new Inflate((chunk) => {
    size += chunk.length;
    if (size > BACKUP_MAX_BYTES) { tooLarge = true; throw new ShareLinkError("This link holds more than a backup may (5 MiB)."); }
    chunks.push(chunk);
  });
  try { inflate.push(fromBase64Url(data), true); }
  catch (error) {
    if (tooLarge || error instanceof ShareLinkError) throw error instanceof ShareLinkError ? error : new ShareLinkError("This link holds more than a backup may (5 MiB).");
    throw new ShareLinkError("This link is damaged or incomplete. Copy the whole link, or scan the QR code again.");
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(out); }
  catch { throw new ShareLinkError("This link is damaged or incomplete. Copy the whole link, or scan the QR code again."); }
}

/** The app's own address without the hash (works on GitHub Pages' sub-path and on localhost). */
export const shareBase = (loc: Pick<Location, "origin" | "pathname"> = window.location) => `${loc.origin}${loc.pathname}`;

/**
 * `titles` (optional, display only): the titles of the plan's journeys, in planJourneyKeys order, for the import
 * preview when the journeys themselves are left out to keep the QR code small.
 */
export function shareLink(base: string, kind: ShareKind, backupJson: string, titles: string[] = []): string {
  const t = titles.length ? `&t=${toBase64Url(new TextEncoder().encode(titles.map((x) => x.replace(/\n/g, " ").slice(0, 120)).join("\n")))}` : "";
  return `${base}#${SHARE_ROUTE}?v=${SHARE_LINK_VERSION}&k=${kind}${t}&d=${compressText(backupJson)}`;
}
/** Every journey key the shared nights carry (sorted, deduplicated). */
export const planJourneyKeys = (data: Pick<BackupData, "planner">) =>
  Array.from(new Set(data.planner.sessions.flatMap((s) => s.items.flatMap((i) => (i.journeyKey ? [i.journeyKey] : []))))).sort();

export { isShareHash };

export type SharePayload = { kind: ShareKind; preview: BackupPreview; /** Display-only journey titles carried by the link (`t`). */ journeyTitles?: Record<string, string> };

function linkTitles(value: string | null, keys: string[]): Record<string, string> | undefined {
  if (!value || !keys.length) return undefined;
  try {
    const titles = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(value)).split("\n").slice(0, keys.length);
    const entries = titles.map((title, i) => [keys[i], title.trim().slice(0, 120)] as const).filter(([, title]) => !!title);
    return entries.length ? Object.fromEntries(entries) : undefined;
  } catch { return undefined; }
}

/** Decode and validate an import hash (`#/import?v=1&k=plan&d=…`). Throws ShareLinkError with a message for the user. */
export function readShareHash(hash: string): SharePayload {
  if (!isShareHash(hash)) throw new ShareLinkError("This is not a StarHop plan link.");
  if (hash.length > SHARE_MAX_LINK_CHARS) throw new ShareLinkError("This link is too long to import. Send the backup file instead.");
  const query = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
  const version = query.get("v"), kind = query.get("k"), data = query.get("d");
  if (version !== String(SHARE_LINK_VERSION)) {
    throw new ShareLinkError(version && /^\d+$/.test(version) && Number(version) > SHARE_LINK_VERSION
      ? "This link was made by a newer StarHop. Update the app (reload it while online), then open the link again."
      : "This link is damaged or incomplete. Copy the whole link, or scan the QR code again.");
  }
  if (kind !== "plan" && kind !== "all") throw new ShareLinkError("This link is damaged or incomplete. Copy the whole link, or scan the QR code again.");
  if (!data) throw new ShareLinkError("This link is damaged or incomplete. Copy the whole link, or scan the QR code again.");
  const text = decompressText(data);
  let preview: BackupPreview;
  try { preview = parseBackupText(text); }
  catch { throw new ShareLinkError("This link does not hold a StarHop plan this version can read."); }
  if (kind === "plan" && preview.backup.planner.sessions.length === 0) throw new ShareLinkError("This link holds no observing night.");
  const journeyTitles = linkTitles(query.get("t"), planJourneyKeys(preview.backup));
  return { kind, preview, ...(journeyTitles ? { journeyTitles } : {}) };
}

// ───────────────────────────── building links ─────────────────────────────

/** The settings that describe the instrument (binoculars/telescope profile), sent with a plan. */
export const INSTRUMENT_KEYS = [
  "mode", "instrumentSelected", "fov", "fovHeight", "shape", "limitingMag", "binocularMagnification", "binocularFov",
  "binocularAperture", "binocularStabilized", "binocularSupport", "binocularTransmission", "binocularProfileVersion",
] as const satisfies readonly (keyof Settings)[];
const instrumentOf = (s: Settings) => Object.fromEntries(INSTRUMENT_KEYS.map((key) => [key, s[key]])) as Pick<Settings, (typeof INSTRUMENT_KEYS)[number]>;
export const sameInstrument = (a: Settings, b: Settings) => INSTRUMENT_KEYS.every((key) => a[key] === b[key]);
/** "14×50 binoculars · 3.7° field" or "Telescope · 1.0° field". */
export function instrumentLabel(s: Settings): string {
  return s.mode === "binocular"
    ? `${s.binocularMagnification}×${s.binocularAperture} binoculars · ${(s.binocularFov ?? s.fov).toFixed(1)}° field`
    : `Telescope · ${s.fov.toFixed(1)}° field`;
}

/** Journeys the night's items come from, as kept on this device (so the phone shows their titles and can open them). */
export function referencedJourneys(session: ObservingSession, store: JourneyStore | null | undefined): JourneyBackup | undefined {
  if (!store) return undefined;
  const keys = new Set(session.items.flatMap((item) => (item.journeyKey ? [item.journeyKey] : [])));
  if (!keys.size) return undefined;
  const recent = store.recent.filter((r) => keys.has(r.journey.key));
  if (store.active && keys.has(store.active.key) && !recent.some((r) => r.journey.key === store.active!.key)) {
    recent.unshift({ journey: store.active.journey, savedAt: store.active.savedAt, live: store.active.live });
  }
  return recent.length ? { progress: { version: 1, active: null, recent }, feedback: null } : undefined;
}

/** One night as backup data: the night, its saved site (when it is one), the sender's settings and, optionally, its journeys. */
export function planShareData(o: { session: ObservingSession; settings: Settings; savedLocations: SavedLocation[]; journeys?: JourneyBackup }): BackupData {
  const site = matchingLocation(o.savedLocations, o.session.lat, o.session.lon);
  return {
    settings: o.settings,
    planner: { sessions: [{ ...o.session, archived: false }], activeId: o.session.id },
    savedLocations: site ? [site] : [],
    ...(o.journeys ? { journeys: o.journeys } : {}),
  };
}

export type ShareLinkResult = { link: string; kind: ShareKind; chars: number; fitsQr: boolean; includesJourneys: boolean };

/**
 * Build the link. A plan first tries to carry its journeys (titles and "open journey" on the phone); when that is too
 * long for a QR code it drops them (the stops keep their journey tag and planned times either way).
 */
export function buildShareLink(base: string, kind: ShareKind, data: BackupData, now = new Date()): ShareLinkResult {
  const make = (d: BackupData): ShareLinkResult => {
    // Without the journeys, the link still names them for the preview.
    const titles = kind === "plan" && !d.journeys && data.journeys ? planJourneyKeys(d).map((key) => journeyTitleFrom(key, data.journeys?.progress) ?? "") : [];
    const link = shareLink(base, kind, createBackup(d, now, { compact: true }), titles.some(Boolean) ? titles : []);
    return { link, kind, chars: link.length, fitsQr: link.length <= QR_MAX_LINK_CHARS, includesJourneys: !!d.journeys };
  };
  const first = make(data);
  if (first.fitsQr || kind !== "plan" || !data.journeys) return first;
  const { journeys: _journeys, ...withoutJourneys } = data;
  const second = make(withoutJourneys);
  return second.fitsQr ? second : first.chars <= second.chars ? first : second;
}

// ───────────────────────────── preview ─────────────────────────────

export type NightSummary = { id: string; name: string; when: string; site: string; objects: number; journeyKeys: string[] };
export function nightSummary(session: ObservingSession, savedLocations: SavedLocation[] = []): NightSummary {
  const zone = sessionTimezone(session);
  return {
    id: session.id, name: session.name,
    when: formatInTimeZone(new Date(session.startAt), zone, "EEE MMM d · HH:mm"),
    site: session.locationName || knownLocationName(savedLocations, session.lat, session.lon) || `${session.lat.toFixed(2)}°, ${session.lon.toFixed(2)}°`,
    objects: session.items.length,
    journeyKeys: Array.from(new Set(session.items.flatMap((item) => (item.journeyKey ? [item.journeyKey] : [])))),
  };
}
/** Title of a journey: from the link's own journeys first, then from this device's journey store. */
export function journeyTitleFrom(key: string, ...stores: (JourneyStore | null | undefined)[]): string | undefined {
  for (const store of stores) {
    if (!store) continue;
    if (store.active?.key === key) return store.active.journey.title;
    const found = store.recent.find((r) => r.journey.key === key);
    if (found) return found.journey.title;
  }
  return undefined;
}

// ───────────────────────────── applying ─────────────────────────────

/** The night on this device that an incoming night updates: the same night id, else the same observing night at the same site. */
export function matchingNight(sessions: ObservingSession[], incoming: ObservingSession): ObservingSession | undefined {
  const byId = sessions.find((s) => s.id === incoming.id);
  if (byId) return byId;
  const zone = sessionTimezone(incoming), night = observingNightDate(new Date(incoming.startAt), zone);
  return sessions.find((s) => !s.archived && Math.abs(s.lat - incoming.lat) < 0.001 && Math.abs(s.lon - incoming.lon) < 0.001
    && observingNightDate(new Date(s.startAt), sessionTimezone(s)) === night);
}

/**
 * Apply a shared link to this device's data.
 * - plan, add: the night merges into the matching night on this device (backup merge: notes, observations and journey
 *   tags combine, the incoming planned times win), or is added as a new night. Its saved site is added when new.
 * - plan, replace: the matching night is replaced by the incoming one (objects removed on the laptop disappear).
 * - all: exactly the backup's Merge / Replace.
 * Settings stay this device's own, except the instrument when `useInstrument` (plan) or the whole settings (all, as a
 * backup restore does). `focus` is the night to open afterwards.
 */
export function applyShareImport(current: BackupData, payload: SharePayload, mode: ShareMode, o: { useInstrument?: boolean } = {}): { next: BackupData; focus: ObservingSession | null } {
  const incoming = payload.preview.backup;
  if (payload.kind === "all") {
    const next = applyBackup(current, incoming, mode === "add" ? "merge" : "replace");
    const focusId = incoming.planner.activeId ?? next.planner.activeId;
    return { next, focus: next.planner.sessions.find((s) => s.id === focusId && !s.archived) ?? null };
  }
  let sessions = current.planner.sessions;
  const arriving: ObservingSession[] = [];
  for (const night of incoming.planner.sessions) {
    const target = matchingNight(sessions, night);
    if (mode === "replace") {
      if (target) sessions = sessions.filter((s) => s.id !== target.id);
      arriving.push({ ...night, archived: false });
    } else {
      // Same id as the matching night, so the backup merge combines the two instead of adding a second night.
      arriving.push(target ? { ...night, id: target.id, archived: false } : { ...night, archived: false });
    }
  }
  const settings = o.useInstrument ? settingsSchema.parse({ ...current.settings, ...instrumentOf(incoming.settings) }) : current.settings;
  const merged = applyBackup(
    { ...current, planner: { ...current.planner, sessions } },
    { settings, planner: { sessions: arriving, activeId: arriving[0]?.id ?? null }, savedLocations: incoming.savedLocations, ...(incoming.journeys ? { journeys: incoming.journeys } : {}) },
    "merge",
  );
  const focusId = arriving[0]?.id ?? null;
  const next = { ...merged, planner: plannerStoreSchema.parse({ ...merged.planner, activeId: focusId ?? merged.planner.activeId }) };
  return { next, focus: next.planner.sessions.find((s) => s.id === focusId) ?? null };
}
