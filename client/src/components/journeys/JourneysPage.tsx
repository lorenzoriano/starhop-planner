/**
 * Sky Journeys section (spec decision 12; doc 06). Lazy-loaded from planner.tsx. Owns its own UI state; the
 * planner passes the observing context, catalogs and session callbacks (doc 01 §3).
 *
 * Routes: #/journeys (Discovery) · #/journeys/:key (Overview) · #/journeys/:key/stop/:n (Field mode) ·
 *         #/journeys/:key/done (Summary). Queries: #/journeys?focus=<id> (journeys through an object) and
 *         #/journeys/:key?stop=n (Overview with stop n's card open: "Back to journey" from a hop opened there).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chartSolarSystemPositions, eqToHorizontal, type ConstellationLine, type DenseStar, type MilkyWayFeature, type SkyNode, type Star as CatalogStar, type UnifiedTarget } from "@/lib/astronomy";
import type { BinocularProfile } from "@/lib/binocular-assessment";
import type { MoonState } from "@/lib/moon";
import { journeyFocusFromPath, journeyRouteFromPath, pathForJourneyRoute, type JourneyRoute } from "@/lib/navigation";
import {
  appendFeedback, findStoredJourney, pruneFeedbackStore, pruneJourneyStore, readFeedbackStore, readJourneyStore, rememberJourney, seenObjectIds,
  siteKey, startJourneyProgress, writeFeedbackStore, writeJourneyStore, type FeedbackStore, type JourneyPrefs, type JourneyStore,
} from "@/lib/journeys/progress";
import { journeyKeyResolver } from "@/lib/journeys/journey-key";
import { NOOP_ACTIONS, objectName, resolveObject, sameObject, toKbId, type ChainResult, type HopSource, type LegReport, type ObjectActions, type ObjectCatalog, type ResolvedObject } from "@/lib/object-links";
import type { Compass8, Journey, JourneyRequest, JourneyResult, KbObject, KnowledgeBase } from "@/lib/journeys/types";
import { plannerObservedIds, sharedSkyInputs, withSkyInputs } from "@/lib/journeys/request-inputs";
import { getJourneyEngineSource } from "./journey-engine";
import { controlsFromPrefs, indexObjects, JOURNEY_FOCUS_KEY, journeyFitsKb, journeyRequestFor, slotInstant, type LengthChoice, type ObjectIndex } from "./journey-view";
import { moonKeepOut } from "./conditions-explainer";
import { journeysOpenAt } from "./use-tonight-journeys";
import { JourneyDiscovery } from "./JourneyDiscovery";
import { JourneyOverview } from "./JourneyOverview";
import { JourneyFieldMode } from "./JourneyFieldMode";
import { JourneyDone } from "./JourneyDone";
import "./journeys.css";

export interface JourneysPageProps {
  /** Current hash path, e.g. "/journeys/abc/stop/2". */
  location: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  lat: number;
  lon: number;
  /** The single observing instant (planner `date`). */
  date: Date;
  timezone: string;
  live: boolean;
  locationName: string;
  skyBrightness: number;
  profile: BinocularProfile;
  stars: CatalogStar[];
  targets: UnifiedTarget[];
  constellations: ConstellationLine[];
  denseStars: DenseStar[];
  milkyWay: MilkyWayFeature[];
  catalogsLoading: boolean;
  moon: MoonState;
  sunAlt: number;
  offlineLabel: string;
  redLight: boolean;
  onRedLight: (on: boolean) => void;
  /** Preview another instant without leaving Journeys (planner previewMoment(at, lat, lon, false)). */
  onTime: (at: Date) => void;
  onLive: () => void;
  onMoonTab: () => void;
  onEditSetup: () => void;
  /**
   * Additive (WS-C): the Planner's nights. Objects marked observed there count as seen for journey suggestions
   * (withSkyInputs observedIds), so "I see it" in a journey and the Planner log agree in both directions.
   */
  sessions?: readonly { items: readonly { id: string; observedAt?: string | null }[] }[];
  /**
   * Additive (WS-C): the planner's hop chain (useHopChain state). When it covers this journey, the cards show Star hop's
   * own leg count ("4 hops") instead of an estimate.
   */
  hopChain?: { source: HopSource | null; chain: ChainResult | null };
  /** Shared cross-tab object verbs (lib/object-links); optional so tests and previews can omit it (NOOP_ACTIONS). */
  actions?: ObjectActions;
}

/** Everything the screens share. */
export interface JourneysShared {
  page: JourneysPageProps;
  kb: KnowledgeBase;
  objects: ObjectIndex;
  /** Background stars + Moon/planets for SkyChart. */
  skyNodes: SkyNode[];
  stopNodes: (journey: Journey) => SkyNode[];
  moonRing: { ra: number; dec: number; radiusDeg: number } | null;
  minAlt: number;
  go: (route: JourneyRoute, replace?: boolean) => void;
  store: JourneyStore;
  updateStore: (fn: (store: JourneyStore) => JourneyStore) => void;
  feedback: FeedbackStore;
  updateFeedback: (fn: (store: FeedbackStore) => FeedbackStore) => void;
  /** Shared cross-tab verbs (NOOP_ACTIONS when the page is rendered without the planner). */
  actions: ObjectActions;
  /** The planner's loaded catalogs (unified targets + BSC stars) that object-links resolves against. */
  catalog: ObjectCatalog;
  /** A stop object (or any id form) resolved against the catalogs: its routing/session ids and position; null = KB-only. */
  resolve: (o: KbObject | string) => ResolvedObject | null;
  /** Star hop's report for the leg into journey stop `stop` (1-based) when a planned chain covers this journey; else null. */
  hopLeg: (journeyKey: string, stop: number) => LegReport | null;
  /** Open a journey in field mode (resuming when it is already active). */
  startJourney: (journey: Journey) => void;
}

export interface DiscoveryControls {
  theme: string | null;
  length: LengthChoice;
  minAlt: number;
  includeChallenge: boolean;
  openDirections: Compass8[];
  shuffle: number;
  showMore: boolean;
}

const BACKGROUND_STAR_LIMIT = 6.5;

function takeJourneyFocus(): string | null {
  try {
    const id = sessionStorage.getItem(JOURNEY_FOCUS_KEY);
    sessionStorage.removeItem(JOURNEY_FOCUS_KEY);
    return id && id.length < 200 ? id : null;
  } catch { return null; }
}
/**
 * `#/journeys/:key?stop=n` → the Overview opens stop n's card (0-based index), e.g. "Back to journey" from a hop that
 * was opened from that card. `view=overview` / `from=overview` may ride along and are ignored here. Null otherwise.
 */
export function overviewStopFromPath(path: string, stopCount = 99): number | null {
  const q = path.includes("?") ? new URLSearchParams(path.slice(path.indexOf("?") + 1)) : null;
  const n = q?.get("stop");
  return n && /^[1-9]\d?$/.test(n) && Number(n) <= stopCount ? Number(n) - 1 : null;
}

/** Journeys through the focus object first (any id form); when none qualifies, keep the full list and say so. */
export function focusResult(result: JourneyResult | null, id: string, name: string): { result: JourneyResult | null; matched: boolean; name: string } {
  if (!result) return { result, matched: true, name };
  const through = result.journeys.filter((j) => j.stops.some((s) => sameObject(s.objectId, id)));
  return through.length ? { result: { ...result, journeys: through }, matched: true, name } : { result, matched: false, name };
}

function JourneysLoading({ slow }: { slow: boolean }) {
  return <section className="journeys journeys-loading" aria-busy="true" aria-live="polite" data-testid="journeys-loading">
    <p className="eyebrow">SKY JOURNEYS</p>
    <h1>Gathering the sky's stories<span>…</span></h1>
    <p className="journey-lede">{slow
      ? "The journey library is large, so the first visit takes a little while. After that it is stored on this device and opens offline."
      : "Loading the stars, clusters and nebulae these journeys are built from."}</p>
    <div className="journey-skeletons">{[0, 1, 2].map((i) => <div key={i} className="journey-card skeleton" aria-hidden="true"/>)}</div>
  </section>;
}
const nodeType = (o: KbObject, targets: Map<string, UnifiedTarget>): SkyNode["type"] => {
  const t = targets.get(o.id);
  return t ? (t.source === "messier" ? "messier" : "binocular") : o.kind === "star" ? "star" : "binocular";
};

export default function JourneysPage(page: JourneysPageProps) {
  const { lat, lon, date, live, profile, skyBrightness, timezone } = page;
  const route = useMemo(() => journeyRouteFromPath(page.location) ?? { view: "discover" as const }, [page.location]);
  const engine = useMemo(() => getJourneyEngineSource(), []);
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);
  const loadKb = useCallback(() => {
    setKbError(null);
    engine.loadKb().then(setKb, (error: unknown) => setKbError(error instanceof Error ? error.message : "Could not load the journey stories."));
  }, [engine]);
  useEffect(loadKb, [loadKb]);
  const objects = useMemo(() => indexObjects(kb), [kb]);
  // The KB is large on a first visit: after a moment, say so (and that it is cached for offline use afterwards).
  const [slowKb, setSlowKb] = useState(false);
  useEffect(() => { if (kb) return; const t = setTimeout(() => setSlowKb(true), 1800); return () => clearTimeout(t); }, [kb]);

  // Optional focus object: `#/journeys?focus=<id>` ("Find a journey with this", actions.journey({objectId})) or the
  // one-shot sessionStorage hand-off of the binocular dialog chip. Journeys through it come first; when tonight has one,
  // its overview opens at that stop (below).
  const urlFocus = journeyFocusFromPath(page.location);
  const [focusId, setFocusId] = useState<string | null>(() => (urlFocus && urlFocus.length < 200 ? urlFocus : null) ?? takeJourneyFocus());
  useEffect(() => { if (urlFocus && urlFocus.length < 200) setFocusId(urlFocus); }, [urlFocus]);
  /** The overview stop card to open on arrival (a focus that matched a journey). 0-based. */
  const [openAt, setOpenAt] = useState<{ key: string; index: number } | null>(null);

  // ── device storage ──
  const [store, setStore] = useState<JourneyStore>(() => readJourneyStore());
  const [storageWarning, setStorageWarning] = useState(false);
  const updateStore = useCallback((fn: (s: JourneyStore) => JourneyStore) => setStore((current) => {
    const next = fn(current);
    if (!writeJourneyStore(next)) setStorageWarning(true);
    return next;
  }), []);
  const [feedback, setFeedback] = useState<FeedbackStore>(() => readFeedbackStore());
  const updateFeedback = useCallback((fn: (s: FeedbackStore) => FeedbackStore) => setFeedback((current) => { const next = fn(current); writeFeedbackStore(next); return next; }), []);
  // Journeys whose key no longer resolves against the real KB (a rebuild removed their theme or objects) are dropped
  // from the device, with their feedback. Never against the demo KB, which knows none of the real journeys.
  useEffect(() => {
    if (!kb) return;
    let cancelled = false;
    engine.resolvedMode().then((mode) => {
      if (cancelled || mode !== "worker") return;
      const resolves = journeyKeyResolver(kb);
      setStore((current) => { const next = pruneJourneyStore(current, resolves); if (next !== current) writeJourneyStore(next); return next; });
      setFeedback((current) => { const next = pruneFeedbackStore(current, resolves); if (next !== current) writeFeedbackStore(next); return next; });
    }, () => {});
    return () => { cancelled = true; };
  }, [kb, engine]);

  // ── discovery controls (remembered on the device; open sky per site) ──
  const prefs = store.prefs ?? {};
  const site = siteKey(lat, lon);
  const [shuffle, setShuffle] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const controls: DiscoveryControls = { ...controlsFromPrefs(prefs, site), shuffle, showMore };
  const setControls = useCallback((patch: Partial<DiscoveryControls>) => {
    if (patch.shuffle !== undefined) setShuffle(patch.shuffle);
    if (patch.showMore !== undefined) setShowMore(patch.showMore);
    const { shuffle: _s, showMore: _m, openDirections, ...rest } = patch;
    if (!Object.keys(rest).length && !openDirections) return;
    if (rest.theme !== undefined || rest.length !== undefined) { setShuffle(0); setShowMore(false); }
    updateStore((s) => {
      const current: JourneyPrefs = s.prefs ?? {};
      const openSky = { ...(current.openSky ?? {}) };
      if (openDirections) { if (openDirections.length >= 8 || !openDirections.length) delete openSky[site]; else openSky[site] = openDirections; }
      return { ...s, prefs: { ...current, ...rest, openSky } };
    });
  }, [updateStore, site]);

  // ── engine request: keyed on the 15-minute slot so live mode does not reshuffle ──
  // "Find a journey with this" (r5 UX #4): the request pins the focus object (mustInclude) and, before dark, plans for
  // the coming dusk (the shared night window), so a daytime link never lands on "No journey fits right now".
  const focusAt = useMemo(() => (focusId ? journeysOpenAt({ at: date, lat, lon, timezone }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slot stands for `date`
    [focusId, slotInstant(date).getTime(), lat, lon, timezone]);
  const slot = slotInstant(focusAt ?? date).getTime();
  const seen = useMemo(() => seenObjectIds(feedback), [feedback]);
  // Planner observations (any night) as KB ids; keyed on their joined text so a new array with the same ids is no change.
  // Plus the app-wide inputs the planner shell shares (Planner observed ids, Tonight's Best top ids), so this request is
  // byte-identical to the teaser's and the chips' (use-tonight-journeys) and they agree on tonight's journeys.
  const inputs = sharedSkyInputs();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- inputs.key identifies inputs.observedIds
  const observedKey = useMemo(() => Array.from(new Set([...inputs.observedIds, ...plannerObservedIds(page.sessions ?? [])])).join("\n"), [page.sessions, inputs.key]);
  const request = useMemo<JourneyRequest>(() => withSkyInputs(journeyRequestFor({
    date: focusAt ?? date, lat, lon, timezone, profile, skyBrightness,
    controls: { theme: controls.theme, length: controls.length, minAlt: controls.minAlt, includeChallenge: controls.includeChallenge, openDirections: controls.openDirections },
    shuffle: controls.shuffle, limit: controls.showMore || focusId ? 6 : 3, seen,
  }), { observedIds: observedKey ? observedKey.split("\n") : [], boostIds: inputs.boostIds, ...(focusId ? { mustInclude: [focusId] } : {}) }),
  // `date` matters only through its 15-minute slot (journeyRequestFor rounds it), so key on the slot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [slot, lat, lon, timezone, profile.fov, profile.aperture, profile.magnification, profile.stabilized, skyBrightness, controls.theme, controls.length, controls.minAlt, controls.includeChallenge, controls.openDirections, controls.shuffle, controls.showMore, seen, focusId, observedKey, inputs.key]);
  const requestKey = JSON.stringify(request);
  const [result, setResult] = useState<{ key: string; value: JourneyResult } | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setEngineError(null);
    engine.client.generate(request).then((value) => { if (!cancelled) setResult({ key: requestKey, value }); }, (error: unknown) => {
      if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
      setEngineError(error instanceof Error ? error.message : "Could not plan journeys for this sky.");
    });
    return () => { cancelled = true; };
    // requestKey captures every field of `request`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, requestKey, retry]);
  const pending = !result || result.key !== requestKey;

  // ── sky nodes for the charts ──
  const targetIndex = useMemo(() => new Map(page.targets.map((t) => [t.id, t])), [page.targets]);
  const catalog = useMemo<ObjectCatalog>(() => ({ targets: page.targets, stars: page.stars }), [page.targets, page.stars]);
  const resolve = useCallback((o: KbObject | string) => resolveObject(o, catalog), [catalog]);
  const actions = page.actions ?? NOOP_ACTIONS;
  const chainSource = page.hopChain?.source, chainResult = page.hopChain?.chain;
  const hopLeg = useCallback((journeyKey: string, stop: number): LegReport | null => {
    if (chainSource?.kind !== "journey" || chainSource.key !== journeyKey || !chainResult) return null;
    const k = chainResult.stops.findIndex((s) => s.stop === stop);
    return k >= 0 ? chainResult.legs[k] ?? null : null;
  }, [chainSource, chainResult]);
  const skyNodes = useMemo<SkyNode[]>(() => [
    ...page.stars.filter((s) => s.mag <= BACKGROUND_STAR_LIMIT).map((s) => ({ ...s, ...eqToHorizontal(s.ra, s.dec, lat, lon, date), name: s.name || s.bayer || s.id, type: "star" as const })).filter((s) => s.alt > -2),
    ...chartSolarSystemPositions(lat, lon, date),
  ], [page.stars, lat, lon, date]);
  const skyNodeIds = useMemo(() => new Set(skyNodes.map((n) => n.id)), [skyNodes]);
  // Stop markers for SkyChart; stops that already exist as background stars (HR ids) are not duplicated.
  const stopNodes = useCallback((journey: Journey): SkyNode[] => journey.stops.flatMap((stop, i) => {
    const o = objects.get(stop.objectId);
    if (!o || skyNodeIds.has(o.id) || journey.stops.findIndex((s) => s.objectId === o.id) !== i) return [];
    const t = targetIndex.get(o.id);
    const pos = eqToHorizontal(o.ra, o.dec, lat, lon, date);
    return [{ id: o.id, ra: o.ra, dec: o.dec, ...pos, mag: o.mag ?? 6, name: objectName(o, page.targets).name, type: nodeType(o, targetIndex), constellation: o.con, category: t?.category, size: t?.size }];
  }), [objects, targetIndex, lat, lon, date, skyNodeIds, page.targets]);
  const moonRing = useMemo(() => moonKeepOut(page.moon), [page.moon]);

  const go = useCallback((next: JourneyRoute, replace = false) => page.navigate(pathForJourneyRoute(next), replace ? { replace } : undefined), [page]);
  const startJourney = useCallback((journey: Journey) => {
    updateStore((s) => startJourneyProgress(rememberJourney(s, journey, live), journey, live));
    const active = store.active?.key === journey.key && !store.active.completedAt ? store.active.stopIndex : 0;
    go({ view: "stop", key: journey.key, stop: active + 1 });
  }, [updateStore, live, store.active, go]);

  // Scroll to the top when the screen (not just the stop) changes.
  const viewKey = route.view === "stop" ? `stop:${route.key}` : `${route.view}:${"key" in route ? route.key : ""}`;
  const firstView = useRef(true);
  useEffect(() => { if (firstView.current) { firstView.current = false; return; } window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, [viewKey]);

  // Resolve the journey for keyed routes: the latest result first, then the device store (only a stored journey the
  // loaded KB can still show: its theme and stops survived the last KB rebuild).
  const journey = useMemo(() => {
    if (!("key" in route)) return null;
    const stored = kb ? findStoredJourney(store, route.key) : null;
    const found = result?.value.journeys.find((j) => j.key === route.key) ?? (stored && journeyFitsKb(kb!, stored, objects) ? stored : null);
    return found;
  }, [route, result, store, kb, objects]);
  // A key that names no journey here (an old bookmark, a journey from before a KB rebuild, one expired on this device)
  // goes straight to the Journeys list once tonight's journeys are in, instead of a dead page.
  const unresolved = "key" in route && !!kb && !journey && (!pending || !!engineError);
  useEffect(() => { if (unresolved) go({ view: "discover" }, true); }, [unresolved, go]);
  // Remember journeys that were opened by key so a reload of the deep link works.
  useEffect(() => {
    if (journey && !store.recent.some((r) => r.journey.key === journey.key) && store.active?.key !== journey.key) updateStore((s) => rememberJourney(s, journey, live));
  }, [journey, store.recent, store.active, updateStore, live]);

  // A focus that one of tonight's journeys passes through opens that journey's overview at that stop (r5: "In journey" /
  // "Find a journey with this" land on the story, not on a list). Otherwise Discovery shows the full list and says so.
  useEffect(() => {
    if (route.view !== "discover" || !focusId || pending || !result) return;
    for (const j of result.value.journeys) {
      const index = j.stops.findIndex((s) => sameObject(s.objectId, focusId));
      if (index < 0) continue;
      setFocusId(null);
      setOpenAt({ key: j.key, index });
      // Planned for the coming dark: look at that sky everywhere (the time bar says "Viewing planned sky").
      const planned = !!focusAt;
      updateStore((s) => rememberJourney(s, j, live && !planned));
      if (focusAt) page.onTime(focusAt);
      go({ view: "overview", key: j.key }, true);
      return;
    }
  }, [route.view, focusId, focusAt, pending, result, updateStore, live, go, page]);

  if (kbError) {
    return <section className="journeys journeys-message" aria-live="polite"><p className="eyebrow">SKY JOURNEYS</p><h1>Journeys could not load</h1><p>{kbError}</p><button type="button" className="journey-button primary" onClick={loadKb}>Try again</button></section>;
  }
  if (!kb) return <JourneysLoading slow={slowKb}/>;

  const shared: JourneysShared = { page, kb, objects, skyNodes, stopNodes, moonRing, minAlt: controls.minAlt, go, store, updateStore, feedback, updateFeedback, actions, catalog, resolve, hopLeg, startJourney };
  const warning = storageWarning && <p className="journey-note" role="status">This device is not saving journey progress. Keep this page open to finish the journey.</p>;

  if (route.view === "discover") {
    const shown = pending ? null : result!.value;
    const focusObject = objects.get(toKbId(focusId ?? "") ?? focusId ?? "");
    const focus = focusId ? focusResult(shown, focusId, focusObject ? objectName(focusObject, page.targets).label : resolve(focusId)?.name ?? "this object") : null;
    const clearFocus = () => { setFocusId(null); if (urlFocus) page.navigate("/journeys", { replace: true }); };
    return <>{warning}<JourneyDiscovery shared={shared} controls={controls} setControls={setControls} result={focus?.result ?? shown} stale={pending && !!result} error={engineError} onRetry={() => setRetry((n) => n + 1)}
      focus={focus ? { name: focus.name, matched: focus.matched, clear: clearFocus, at: focusAt } : null} /></>;
  }
  if (!journey) return <JourneysLoading slow={false}/>;
  if (route.view === "overview") {
    const fromQuery = overviewStopFromPath(page.location, journey.stops.length);
    return <>{warning}<JourneyOverview key={journey.key} shared={shared} journey={journey} initialOpen={fromQuery ?? (openAt?.key === journey.key ? openAt.index : null)} /></>;
  }
  if (route.view === "done") return <>{warning}<JourneyDone shared={shared} journey={journey} /></>;
  return <>{warning}<JourneyFieldMode shared={shared} journey={journey} stopNumber={route.stop} onFeedback={(record) => updateFeedback((s) => appendFeedback(s, record))} /></>;
}
