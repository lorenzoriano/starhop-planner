/**
 * Tonight's journeys, shared by every screen that links into Sky Journeys (integration r5, WS-D): the Tonight
 * teaser, every ObjectJourneyLinks chip (TargetCards, featured object, Catalog, Binoculars, Moon, Clock), the
 * Planner's "Add a journey to this night" and the Moon tab's journey list.
 *
 * It builds exactly the request Discovery and the teaser always built (journeyRequestFor + controlsFromPrefs, limit 3,
 * shuffle 0), so the worker's own cache serves Discovery afterwards and "Start" opens the very journey shown. Here,
 * one engine call per request key is ever in flight: the promise is cached (bounded), so twenty chips on the Tonight
 * grid and the teaser share one call. Only reachable through lazy modules (it reads the journeys runtime).
 */
import { useEffect, useMemo, useState } from "react";
import { LINK_LABELS, objectKey, type JourneyLink, type ObjectActions, type ObjectSkyContext } from "@/lib/object-links";
import { moveTo, readFeedbackStore, readJourneyStore, rememberJourney, seenObjectIds, siteKey, startJourneyProgress, writeJourneyStore, type JourneyStore } from "@/lib/journeys/progress";
import type { Journey, JourneyEngineClient, JourneyRequest, JourneyResult, KnowledgeBase } from "@/lib/journeys/types";
import { ENGINE_OVERRIDE_KEY, getJourneyEngineSource, type JourneyEngineMode } from "./journey-engine";
import { activeLensObjectKeys } from "./journey-membership";
import { controlsFromPrefs, journeyRequestFor, journeyRequestKey, slotInstant } from "./journey-view";
import { nightEvents, type NightEvents } from "./conditions-explainer";
import { sharedSkyInputs, withSkyInputs, type SharedSkyInputs } from "@/lib/journeys/request-inputs";
import { compactHorizon, horizonFingerprint } from "@/lib/horizon/profile";
import type { LocalHorizon } from "@/lib/horizon/types";
import { useLocalHorizon } from "@/hooks/use-local-horizon";

/** Journeys per request: the teaser's (and Discovery's first page) count, so all of them share one cache entry. */
export const TONIGHT_JOURNEY_LIMIT = 3;
/** The Moonlight-proof theme (A12), suggested on the Moon tab when the Moon is bright. */
export const MOONLIGHT_THEME = "A12-moonlit";

/** What the request needs from the sky (ObjectSkyContext without the `live` flag). */
export type TonightSky = Pick<ObjectSkyContext, "at" | "lat" | "lon" | "timezone" | "skyBrightness"> & {
  profile: { fov: number; aperture: number; magnification: number; stabilized?: boolean };
};

/**
 * The engine request for tonight at this sky, with the device's Discovery preferences (theme overridable) and the
 * site's local horizon (seeds the open directions and travels as the request's skyline, exactly as in Discovery).
 */
export function tonightJourneyRequest(sky: TonightSky, store: Pick<JourneyStore, "prefs"> = readJourneyStore(), seen: string[] = seenObjectIds(readFeedbackStore()), theme?: string | null, inputs: Pick<SharedSkyInputs, "observedIds" | "boostIds"> = sharedSkyInputs(), horizon: LocalHorizon | null = null): JourneyRequest {
  const controls = controlsFromPrefs(store.prefs, siteKey(sky.lat, sky.lon), horizon);
  // Same linked inputs as Discovery (JourneysPage): Planner observed ids and Tonight's Best top ids.
  return withSkyInputs(journeyRequestFor({
    date: slotInstant(sky.at), lat: sky.lat, lon: sky.lon, timezone: sky.timezone, profile: sky.profile, skyBrightness: sky.skyBrightness,
    controls: theme === undefined ? controls : { ...controls, theme }, shuffle: 0, limit: TONIGHT_JOURNEY_LIMIT, seen, horizon: compactHorizon(horizon),
  }), inputs);
}

/** The engine as this module uses it (the shared JourneyEngineSource; tests pass a stub). */
export interface TonightEngine { resolvedMode(): Promise<JourneyEngineMode>; client: JourneyEngineClient; loadKb(): Promise<KnowledgeBase> }

const demoAllowed = () => { try { return localStorage.getItem(ENGINE_OVERRIDE_KEY) === "mock"; } catch { return false; } };
const CACHE_LIMIT = 8;
/** requestKey → engine result; null = hidden (demo KB only, or the engine failed). */
const inflight = new Map<string, Promise<JourneyResult | null>>();
const settled = new Map<string, JourneyResult | null>();

/**
 * Tonight's journeys for a request: at most one engine call per request key, ever in flight or cached. Resolves null
 * when only the demo knowledge base is available (unless the device opted into it) or the engine fails; a failure is
 * not cached, so the next caller tries again.
 */
export function loadTonightJourneys(request: JourneyRequest, engine: TonightEngine = getJourneyEngineSource(), allowDemo: boolean = demoAllowed()): Promise<JourneyResult | null> {
  const key = journeyRequestKey(request);
  const cached = inflight.get(key);
  if (cached) return cached;
  let failed = false;
  const promise = engine.resolvedMode()
    .then((mode) => (mode === "mock" && !allowDemo ? null : engine.client.generate(request)))
    .catch(() => { failed = true; return null; })
    .then((result) => {
      if (failed) inflight.delete(key);
      else { settled.set(key, result); if (settled.size > CACHE_LIMIT) settled.delete(settled.keys().next().value as string); }
      return result;
    });
  inflight.set(key, promise);
  if (inflight.size > CACHE_LIMIT) inflight.delete(inflight.keys().next().value as string);
  return promise;
}
/** A settled result for a request key, synchronously (undefined while unknown), so remounts render without a flash. */
export const peekTonightJourneys = (requestKey: string): JourneyResult | null | undefined => settled.get(requestKey);
/** Tests only. */
export function resetTonightJourneysCache() { inflight.clear(); settled.clear(); lensKeys = null; }

/** The journeys among `journeys` that pass through the object (any id form), with its 1-based stop number. */
export function journeyLinksFor(journeys: readonly Journey[], objectId: string, tonight = true): JourneyLink[] {
  return journeyLinkIndex(journeys, tonight).get(objectKey(objectId)) ?? [];
}
/** objectKey → links, in journey rank order (the first link is tonight's best journey through the object). */
export function journeyLinkIndex(journeys: readonly Journey[], tonight = true): Map<string, JourneyLink[]> {
  const index = new Map<string, JourneyLink[]>();
  for (const j of journeys) j.stops.forEach((s, i) => {
    const key = objectKey(s.objectId), list = index.get(key) ?? [];
    if (!list.some((l) => l.key === j.key)) list.push({ key: j.key, title: j.title, themeId: j.templateId, stop: i + 1, stopCount: j.stops.length, tonight });
    index.set(key, list);
  });
  return index;
}

/** Keys of every object some active theme can tell (journey-membership activeLensObjectKeys), loaded once. */
let lensKeys: Promise<ReadonlySet<string> | null> | null = null;
export function loadLensKeys(engine: TonightEngine = getJourneyEngineSource(), allowDemo: boolean = demoAllowed()): Promise<ReadonlySet<string> | null> {
  return (lensKeys ??= engine.resolvedMode()
    .then(async (mode) => (mode === "mock" && !allowDemo ? null : activeLensObjectKeys(await engine.loadKb())))
    .catch(() => { lensKeys = null; return null; }));
}

export type TonightStatus = "idle" | "loading" | "ready" | "hidden";
/**
 * What a journey chip shows: tonight's journey through the object, the Discovery link, "Journeys open at HH:MM"
 * (daytime: no journey fits yet), nothing, or (still) nothing yet.
 */
export type JourneyLinkDecision = { kind: "in-journey"; link: JourneyLink; more: number } | { kind: "find" } | { kind: "opens"; at: Date } | { kind: "none" } | { kind: "pending" };
/**
 * "In journey: <title> · stop n" only when one of tonight's real journeys includes the object; otherwise "Find a
 * journey with this" only when an active theme can tell it (`inLens`; null = not known yet); otherwise nothing.
 * When no journey fits right now at all (`journeysNow` 0) and the dark is still to come (`opensAt`), the find link
 * says when journeys open instead (r5 UX #4: in daylight "Find a journey with this" led to "No journey fits").
 * Hidden (demo KB) → nothing.
 */
export function journeyLinkDecision(a: { status: TonightStatus; links: readonly JourneyLink[]; inLens: boolean | null; journeysNow?: number; opensAt?: Date | null }): JourneyLinkDecision {
  if (a.status === "hidden") return { kind: "none" };
  const tonight = a.links.filter((l) => l.tonight);
  if (tonight.length) return { kind: "in-journey", link: tonight[0], more: tonight.length - 1 };
  if (a.status === "loading" || a.inLens === null) return { kind: "pending" };
  if (!a.inLens) return { kind: "none" };
  if (a.journeysNow === 0 && a.status === "ready") return a.opensAt ? { kind: "opens", at: a.opensAt } : { kind: "none" };
  return { kind: "find" };
}

/**
 * When journeys open for a sky where none fits now: the next astronomical dusk of the app's shared night window
 * (nightEvents: the Clock's and Tonight's dark segments), or null when it is dark already or no dusk comes within
 * a day and a half. Dark now = the next dawn comes before the next dusk.
 */
export function journeysOpenAt(sky: Pick<ObjectSkyContext, "at" | "lat" | "lon" | "timezone">, events?: Pick<NightEvents, "astroDusk" | "astroDawn">): Date | null {
  const e = events ?? nightEvents(sky.lat, sky.lon, sky.at, sky.timezone);
  const dusk = e.astroDusk;
  if (!dusk || dusk.getTime() <= sky.at.getTime()) return null;
  if (e.astroDawn && e.astroDawn.getTime() < dusk.getTime()) return null;
  return dusk;
}

/**
 * The buttons beside "In journey: …" for one link: "Start here" (field mode at that stop); at a journey's last stop,
 * "Start journey" (stop 1) next to "Jump to stop n", so arriving at the end never skips the story silently.
 */
export function startChoices(link: Pick<JourneyLink, "stop" | "stopCount">): { label: string; stop: number }[] {
  if (link.stopCount > 1 && link.stop === link.stopCount) return [{ label: "Start journey", stop: 1 }, { label: `Jump to stop ${link.stop}`, stop: link.stop }];
  return [{ label: LINK_LABELS.startHere, stop: link.stop }];
}

export interface TonightJourneys {
  status: TonightStatus;
  request: JourneyRequest | null;
  result: JourneyResult | null;
  journeys: Journey[];
  /** Tonight's journeys through an object (any id form). */
  linksFor(objectId: string): JourneyLink[];
}

/**
 * React access to tonight's journeys for `sky` (null → idle). `enabled: false` skips the engine (the teaser while a
 * journey is active); `theme` overrides the device's theme preference (a separate request and cache entry).
 */
export function useTonightJourneys(sky: TonightSky | null | undefined, opts: { enabled?: boolean; theme?: string | null } = {}): TonightJourneys {
  const enabled = opts.enabled ?? true, slot = sky ? slotInstant(sky.at).getTime() : 0, p = sky?.profile, inputs = sharedSkyInputs();
  // The site's local horizon (one shared computation per site, lib/horizon/terrain-jobs), as Discovery uses it.
  const { horizon } = useLocalHorizon(sky ? sky.lat : NaN, sky ? sky.lon : NaN);
  const skylineKey = useMemo(() => horizonFingerprint(horizon), [horizon]);
  const request = useMemo(() => (sky ? tonightJourneyRequest({ ...sky, at: new Date(slot) }, readJourneyStore(), seenObjectIds(readFeedbackStore()), opts.theme, inputs, horizon) : null),
    // The request depends only on these fields (the slot, not the exact instant; the shared inputs and the skyline by their keys).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!sky, slot, sky?.lat, sky?.lon, sky?.timezone, sky?.skyBrightness, p?.fov, p?.aperture, p?.magnification, p?.stabilized, opts.theme, inputs.key, skylineKey]);
  const requestKey = request ? journeyRequestKey(request) : "";
  const [state, setState] = useState<{ key: string; result: JourneyResult | null } | null>(null);
  useEffect(() => {
    if (!request || !enabled) return;
    let cancelled = false;
    void loadTonightJourneys(request).then((result) => { if (!cancelled) setState({ key: requestKey, result }); });
    return () => { cancelled = true; };
    // requestKey captures every field of `request`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled]);
  const peeked = state?.key === requestKey ? state.result : peekTonightJourneys(requestKey);
  const known = state?.key === requestKey || peeked !== undefined;
  const result = known ? peeked ?? null : null;
  const journeys = useMemo(() => result?.journeys ?? [], [result]);
  const index = useMemo(() => journeyLinkIndex(journeys), [journeys]);
  const status: TonightStatus = !request || !enabled ? "idle" : !known ? "loading" : result ? "ready" : "hidden";
  return { status, request, result, journeys, linksFor: (id) => index.get(objectKey(id)) ?? [] };
}

/** React access to "can some active theme tell this object" (null while unknown or when `enabled` is false). */
export function useInActiveLens(objectId: string, enabled: boolean): boolean | null {
  const [keys, setKeys] = useState<ReadonlySet<string> | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || keys !== undefined) return;
    let cancelled = false;
    void loadLensKeys().then((k) => { if (!cancelled) setKeys(k); });
    return () => { cancelled = true; };
  }, [enabled, keys]);
  if (!enabled || keys === undefined) return null;
  return keys ? keys.has(objectKey(objectId)) : false;
}

/** Keep a journey on the device so `#/journeys/<key>` resolves, optionally starting field mode at a 1-based stop. */
export function openJourneyAt(journey: Journey, actions: ObjectActions, o: { live: boolean; startAt?: number }) {
  const store = rememberJourney(readJourneyStore(), journey, o.live);
  if (o.startAt) {
    const started = startJourneyProgress(store, journey, o.live);
    writeJourneyStore(started.active ? { ...started, active: moveTo(started.active, o.startAt - 1, "get-there") } : started);
    actions.journey({ key: journey.key, stop: o.startAt });
  } else {
    writeJourneyStore(store);
    actions.journey({ key: journey.key });
  }
}

/** Remember a journey on the device (so `#/journeys/<key>` and the Planner badge find it) without navigating. */
export function rememberJourneyOnly(journey: Journey, live: boolean) {
  writeJourneyStore(rememberJourney(readJourneyStore(), journey, live));
}

/**
 * "Add all stops to tonight's plan" for a journey: its stop ids in story order with their 1-based stop numbers
 * and each stop's own time (`plannedAts`; parallel arrays for actions.addToNight), at the first stop's time so the stops
 * land on the journey's night as one block in story order.
 * `plannable` leaves out stops the Planner cannot hold (KB-only objects); numbering keeps the journey's.
 */
export function journeyNightPlan(journey: Pick<Journey, "stops">, plannable?: (id: string) => boolean): { ids: string[]; journeyStops: number[]; plannedAts: (Date | undefined)[]; at: Date | undefined } {
  const ids: string[] = [], journeyStops: number[] = [], plannedAts: (Date | undefined)[] = [];
  const when = (iso: string | undefined) => { const d = iso ? new Date(iso) : undefined; return d && Number.isFinite(d.getTime()) ? d : undefined; };
  journey.stops.forEach((s, i) => { if (!plannable || plannable(s.objectId)) { ids.push(s.objectId); journeyStops.push(i + 1); plannedAts.push(when(s.windowStart)); } });
  return { ids, journeyStops, plannedAts, at: when(journey.stops[0]?.windowStart) };
}

/** One line on how a journey sits with tonight's Moon (from the engine's per-stop Moon separations). */
export function journeyMoonLine(journey: Pick<Journey, "stops">): string {
  const seps = journey.stops.map((s) => s.moonSepDeg).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (!seps.length) return "Moon down for the whole journey";
  const min = Math.round(Math.min(...seps));
  return seps.length < journey.stops.length ? `Moon down for part of it; at least ${min}° from the stops while up` : `Moon at least ${min}° from every stop`;
}
