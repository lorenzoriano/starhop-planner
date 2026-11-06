import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import qrcode from "qrcode-generator";
import { createBackup, readJourneyBackup, type BackupData } from "../backup";
import { defaultSettings, type NightItem, type Settings } from "../session";
import { emptyPlanner, type ObservingSession } from "../session-planner";
import { MOCK_JOURNEY_RESULT } from "../journeys/__fixtures__/fixture-kb";
import { emptyJourneyStore, rememberJourney } from "../journeys/progress";
import {
  applyShareImport, buildShareLink, compressText, decompressText, fromBase64Url, instrumentLabel,
  isShareHash, journeyTitleFrom, matchingNight, nightSummary, planShareData, QR_MAX_LINK_CHARS, readShareHash,
  referencedJourneys, sameInstrument, ShareLinkError, shareLink, toBase64Url, type SharePayload,
} from "../plan-share";
import { captureShareHash, clearPendingImport, readPendingImport } from "../import-arrival";

const BASE = "https://lorenzoriano.github.io/starhop-planner/";
const journey = MOCK_JOURNEY_RESULT.journeys[0];
// A real journey key is ~280 base64url characters; the fixture's is short, so lengthen it to measure realistic sizes.
const KEY = `j1${"Aa0_-".repeat(56)}`;
const T = "2026-11-06T04:00:00.000Z";

const item = (id: string, extra: Partial<NightItem> = {}): NightItem => ({ id, addedAt: "2026-11-05T18:00:00.000Z", notes: "", ...extra });
const night = (id: string, items: NightItem[], o: Partial<ObservingSession> = {}): ObservingSession => ({
  id, name: "Nov 5 observing night", startAt: T, lat: 37.77, lon: -122.42, locationName: "San Francisco",
  durationMinutes: 180, minutesPerTarget: 15, items, archived: false, createdAt: "2026-11-05T17:00:00.000Z", ...o,
});
const data = (sessions: ObservingSession[] = [], o: Partial<BackupData> = {}): BackupData => ({
  settings: defaultSettings, planner: { ...emptyPlanner, sessions, activeId: sessions[0]?.id ?? null }, savedLocations: [], ...o,
});
/** A typical plan: 8 free objects and 4 journey stops with their own times. */
const typicalItems = (count = 12, journeyStops = 4) => Array.from({ length: count }, (_, i) => i < journeyStops
  ? item(`M${i + 1}`, { journeyKey: KEY, journeyStop: i + 1, plannedAt: new Date(Date.parse(T) + i * 12 * 60_000).toISOString() })
  : item(["M31", "M45", "NGC869", "NGC884", "M13", "M92", "M57", "M27", "M11", "M8", "M20", "M22", "M7", "M6", "M39", "M29", "M15", "M2", "M33", "M52"][i % 20] + (i >= 20 ? `-${i}` : "")));
const payloadOf = (link: string): SharePayload => readShareHash(new URL(link).hash);

describe("Send to phone links", () => {
  it("round-trips bytes through base64url and DEFLATE", () => {
    const bytes = new Uint8Array(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256));
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
    const text = "Andromeda · M31 ✓ — notes\n".repeat(50);
    expect(decompressText(compressText(text))).toBe(text);
  });

  it("encodes a plan as a backup and decodes the same night, items, times and journey tags", () => {
    const source = night("n1", typicalItems());
    const shared = planShareData({ session: source, settings: { ...defaultSettings, binocularMagnification: 10, binocularFov: 6.5, fov: 6.5, fovHeight: 6.5 }, savedLocations: [{ id: "sf", name: "San Francisco", lat: 37.77, lon: -122.42 }] });
    const result = buildShareLink(BASE, "plan", shared, new Date("2026-11-05T19:00:00Z"));
    expect(result.link.startsWith(`${BASE}#/import?v=1&k=plan&d=`)).toBe(true);
    const payload = payloadOf(result.link);
    expect(payload.kind).toBe("plan");
    expect(payload.preview.backup.planner.sessions).toEqual([source]);
    expect(payload.preview.backup.savedLocations).toEqual([{ id: "sf", name: "San Francisco", lat: 37.77, lon: -122.42 }]);
    expect(payload.preview.backup.settings.binocularMagnification).toBe(10);
    expect(payload.preview.exportedAt).toBe("2026-11-05T19:00:00.000Z");
  });

  it("keeps typical plans small enough for a QR code a phone reads off a laptop screen", () => {
    const sizes = [3, 12, 25].map((count) => {
      const r = buildShareLink(BASE, "plan", planShareData({ session: night("0b1c6a4e-2d6f-4f55-9a8e-1c2d3e4f5a6b", typicalItems(count, Math.min(4, count))), settings: defaultSettings, savedLocations: [] }));
      return { count, chars: r.chars, fitsQr: r.fitsQr };
    });
    console.info("Send-to-phone link sizes (chars):", sizes.map((s) => `${s.count} objects → ${s.chars}`).join(", "));
    expect(sizes[0].chars).toBeLessThan(900);
    expect(sizes[1].chars).toBeLessThan(1500);
    expect(sizes.every((s) => s.fitsQr)).toBe(true);
    // The QR library places the longest link in a version ≤ 30 code at the lowest error correction.
    const longest = buildShareLink(BASE, "plan", planShareData({ session: night("x", typicalItems(25)), settings: defaultSettings, savedLocations: [] })).link;
    const qr = qrcode(0, "L"); qr.addData(longest, "Byte"); qr.make();
    expect(qr.getModuleCount()).toBeLessThanOrEqual(17 + 4 * 30);
  });

  it("carries the night's journeys when they fit, and drops them (keeping the tags) when they do not", () => {
    const session = night("n1", typicalItems(6, 3).map((i) => (i.journeyKey ? { ...i, journeyKey: journey.key } : i)));
    const store = rememberJourney(emptyJourneyStore(), journey, false, Date.now());
    const journeys = referencedJourneys(session, store);
    expect(journeys?.progress?.recent.map((r) => r.journey.key)).toEqual([journey.key]);
    expect(referencedJourneys(night("n2", [item("M31")]), store)).toBeUndefined();
    const shared = planShareData({ session, settings: defaultSettings, savedLocations: [], journeys });
    const r = buildShareLink(BASE, "plan", shared);
    const decoded = payloadOf(r.link).preview.backup;
    if (r.includesJourneys) expect(journeyTitleFrom(journey.key, decoded.journeys?.progress)).toBe(journey.title);
    else {
      expect(r.fitsQr).toBe(true);
      expect(decoded.journeys).toBeUndefined();
    }
    expect(decoded.planner.sessions[0].items.filter((i) => i.journeyKey === journey.key)).toHaveLength(3);
    // Forced: a huge journey never makes the QR code fail when the plan alone fits.
    const heavy = { ...journey, stops: Array.from({ length: 40 }, () => journey.stops[0]) };
    const big = buildShareLink(BASE, "plan", { ...shared, journeys: { progress: { version: 1, active: null, recent: [{ journey: heavy, savedAt: 1, live: false }] }, feedback: null } });
    expect(big.includesJourneys).toBe(false);
    expect(big.fitsQr).toBe(true);
    // The link still names the journey for the import preview (display only).
    expect(payloadOf(big.link).journeyTitles).toEqual({ [journey.key]: journey.title });
  });

  it("reports when even the plan is too large for a QR code (the link still works for Copy / Share)", () => {
    const huge = night("n1", Array.from({ length: 200 }, (_, i) => item(`NGC${1000 + i}`, { notes: `Note ${i}: ${Math.random().toString(36).repeat(4)}` })));
    const r = buildShareLink(BASE, "plan", planShareData({ session: huge, settings: defaultSettings, savedLocations: [] }));
    expect(r.fitsQr).toBe(false);
    expect(r.chars).toBeGreaterThan(QR_MAX_LINK_CHARS);
    expect(payloadOf(r.link).preview.backup.planner.sessions[0].items).toHaveLength(200);
  });

  it("rejects other versions, damaged data and links that are not plans", () => {
    const good = buildShareLink(BASE, "plan", planShareData({ session: night("n1", [item("M31")]), settings: defaultSettings, savedLocations: [] })).link;
    const hash = new URL(good).hash;
    expect(() => readShareHash(hash.replace("v=1", "v=2"))).toThrow(/newer StarHop/);
    expect(() => readShareHash(hash.replace("v=1", "v=0"))).toThrow(/damaged/);
    expect(() => readShareHash(hash.replace("k=plan", "k=other"))).toThrow(/damaged/);
    expect(() => readShareHash(hash.slice(0, -20))).toThrow(ShareLinkError);
    expect(() => readShareHash(hash.replace(/d=.*/, "d=***"))).toThrow(/damaged/);
    expect(() => readShareHash("#/planner")).toThrow(/not a StarHop plan link/);
    // Valid DEFLATE, but not a backup (schema validation).
    expect(() => readShareHash(`#/import?v=1&k=plan&d=${compressText(JSON.stringify({ format: "starhop-backup", version: 1 }))}`)).toThrow(/this version can read/);
    expect(() => readShareHash(`#/import?v=1&k=plan&d=${compressText(createBackup(data([])))}`)).toThrow(/no observing night/);
    // A decompression bomb stops at the 5 MiB backup cap.
    const bomb = toBase64Url(deflateSync(new Uint8Array(6 * 1024 * 1024).fill(32), { level: 9 }));
    expect(() => readShareHash(`#/import?v=1&k=all&d=${bomb}`)).toThrow(/5 MiB/);
    expect(isShareHash("#/import?v=1")).toBe(true);
    expect(isShareHash("#/importer")).toBe(false);
  });

  it("summarises a night for the import preview", () => {
    const summary = nightSummary(night("n1", typicalItems(12, 4)));
    expect(summary).toMatchObject({ when: "Thu Nov 5 · 20:00", site: "San Francisco", objects: 12, journeyKeys: [KEY] });
    expect(nightSummary(night("n1", [], { locationName: "" }), [{ id: "x", name: "Dark site", lat: 37.77, lon: -122.42 }]).site).toBe("Dark site");
    expect(instrumentLabel(defaultSettings)).toBe("14×50 binoculars · 3.7° field");
  });
});

describe("importing a shared plan", () => {
  const incoming = (sessions: ObservingSession[], o: Partial<BackupData> = {}): SharePayload => ({
    kind: "plan", preview: { backup: data(sessions, o), exportedAt: T, counts: { sessions: sessions.length, targets: 0, observations: 0, locations: 0 } },
  });

  it("adds a new night, its site and focuses it; this device's settings stay unless the instrument is chosen", () => {
    const phone: Settings = { ...defaultSettings, redLight: true, binocularMagnification: 7, binocularAperture: 35 };
    const current = data([night("other", [item("M42")], { startAt: "2026-12-01T04:00:00.000Z" })], { settings: phone });
    const laptop = { ...defaultSettings, binocularMagnification: 10, binocularAperture: 50 };
    const share = incoming([night("n1", typicalItems())], { settings: laptop, savedLocations: [{ id: "sf", name: "Back garden", lat: 37.77, lon: -122.42 }] });
    const kept = applyShareImport(current, share, "add");
    expect(kept.next.settings).toEqual(phone);
    expect(kept.focus?.id).toBe("n1");
    expect(kept.next.planner.activeId).toBe("n1");
    expect(kept.next.planner.sessions.map((s) => s.id)).toEqual(["other", "n1"]);
    expect(kept.next.savedLocations.map((s) => s.name)).toEqual(["Back garden"]);
    const withInstrument = applyShareImport(current, share, "add", { useInstrument: true });
    expect(withInstrument.next.settings).toMatchObject({ redLight: true, binocularMagnification: 10, binocularAperture: 50 });
    expect(sameInstrument(withInstrument.next.settings, laptop)).toBe(true);
  });

  it("adding the same plan twice merges into one night (no duplicates, journey times kept)", () => {
    const sent = night("n1", typicalItems());
    const once = applyShareImport(data(), incoming([sent]), "add").next;
    const twice = applyShareImport(once, incoming([sent]), "add").next;
    expect(twice.planner.sessions).toHaveLength(1);
    expect(twice.planner.sessions[0].items).toEqual(sent.items.map((i) => expect.objectContaining(i)));
  });

  it("add merges into the phone's own night for the same date and site, keeping its notes and observations", () => {
    const phoneNight = night("phone-id", [item("M31", { notes: "faint oval", observedAt: "2026-11-06T05:00:00.000Z" }), item("M42")], { startAt: "2026-11-06T03:30:00.000Z", name: "My night" });
    const current = data([phoneNight]);
    const sent = night("laptop-id", [item("M31", { journeyKey: KEY, journeyStop: 2, plannedAt: "2026-11-06T04:24:00.000Z" }), item("M45")]);
    const { next, focus } = applyShareImport(current, incoming([sent]), "add");
    expect(matchingNight(current.planner.sessions, sent)?.id).toBe("phone-id");
    expect(next.planner.sessions).toHaveLength(1);
    expect(focus?.id).toBe("phone-id");
    const items = Object.fromEntries(next.planner.sessions[0].items.map((i) => [i.id, i]));
    expect(Object.keys(items).sort()).toEqual(["M31", "M42", "M45"]);
    expect(items.M31).toMatchObject({ notes: "faint oval", observedAt: "2026-11-06T05:00:00.000Z", journeyKey: KEY, journeyStop: 2, plannedAt: "2026-11-06T04:24:00.000Z" });
    expect(next.planner.sessions[0].name).toBe("My night");
  });

  it("replace swaps the matching night for the incoming one and leaves other nights alone", () => {
    const current = data([night("phone-id", [item("M42"), item("M31")]), night("later", [item("M1")], { startAt: "2026-12-01T04:00:00.000Z" })]);
    const sent = night("laptop-id", [item("M31"), item("M45")]);
    const { next, focus } = applyShareImport(current, incoming([sent]), "replace");
    expect(next.planner.sessions.map((s) => s.id).sort()).toEqual(["laptop-id", "later"]);
    expect(next.planner.sessions.find((s) => s.id === "laptop-id")?.items.map((i) => i.id)).toEqual(["M31", "M45"]);
    expect(focus?.id).toBe("laptop-id");
  });

  it("a different night at the same site is never merged", () => {
    const current = data([night("phone-id", [item("M42")], { startAt: "2026-11-07T04:00:00.000Z" })]);
    expect(matchingNight(current.planner.sessions, night("n1", []))).toBeUndefined();
    expect(applyShareImport(current, incoming([night("n1", [item("M31")])]), "add").next.planner.sessions).toHaveLength(2);
  });

  it("a full backup link uses the backup's merge and replace", () => {
    const current = data([night("a", [item("M42")], { startAt: "2026-12-01T04:00:00.000Z" })], { savedLocations: [{ id: "home", name: "Home", lat: 1, lon: 1 }] });
    const all: SharePayload = { ...incoming([night("b", [item("M31")])], { settings: { ...defaultSettings, redLight: true } }), kind: "all" };
    const merged = applyShareImport(current, all, "add");
    expect(merged.next.planner.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(merged.next.settings.redLight).toBe(true);
    expect(merged.next.savedLocations).toHaveLength(1);
    expect(merged.focus?.id).toBe("b");
    const replaced = applyShareImport(current, all, "replace");
    expect(replaced.next.planner.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(replaced.next.savedLocations).toEqual([]);
  });

  it("imports journeys carried by the link into the journey store merge", () => {
    const store = rememberJourney(emptyJourneyStore(), journey, false, 1000);
    const share = incoming([night("n1", [item("M31", { journeyKey: journey.key, journeyStop: 1 })])], { journeys: { progress: store, feedback: null } });
    const { next } = applyShareImport(data(), share, "add");
    expect(next.journeys?.progress?.recent.map((r) => r.journey.key)).toEqual([journey.key]);
    expect(readJourneyBackup(null)).toBeUndefined();
  });
});

describe("arrival of an import link", () => {
  it("captures the import hash, strips it from the URL and keeps it pending until handled", () => {
    const events: string[] = [];
    let href = `${BASE}#/import?v=1&k=plan&d=abc`;
    const memory = new Map<string, string>();
    const g = globalThis as unknown as { sessionStorage?: Storage };
    const previous = g.sessionStorage;
    g.sessionStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) } as Storage;
    const win = {
      get location() { const u = new URL(href); return { hash: u.hash, href } as Location; },
      history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { href = url; } },
      dispatchEvent: (e: Event) => { events.push(e.type); return true; },
    } as unknown as Window;
    try {
      expect(captureShareHash(win)).toBe(true);
      expect(href).toBe(`${BASE}#/planner`);
      expect(readPendingImport()).toBe("#/import?v=1&k=plan&d=abc");
      expect(events).toEqual(["starhop-pending-import"]);
      expect(captureShareHash(win)).toBe(false);
      clearPendingImport();
      expect(readPendingImport()).toBeNull();
    } finally { g.sessionStorage = previous; }
  });

  it("builds links on any base (localhost dev, GitHub Pages sub-path)", () => {
    expect(shareLink("http://localhost:5000/", "all", "{}")).toMatch(/^http:\/\/localhost:5000\/#\/import\?v=1&k=all&d=/);
  });
});
