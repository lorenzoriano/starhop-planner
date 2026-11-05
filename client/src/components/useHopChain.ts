/**
 * Star hop chain state (integration r5, WS-B): resolves a HopSource into stops (a journey from the journey store or
 * its key, a Planner night in suggestSequence order, an id list), plans them with planChain in the route worker
 * (abortable, per-leg memo), restores a chain from the URL (`#/hop/<final>?journey=KEY&chain=1-5[&leg=3]`) and
 * navigates there with navigateHash. The journey store (lib/journeys/progress) and the journeys KB are dynamic imports,
 * so they load only for journey sources and stay out of the main bundle (the planner lazy-loads BackupControls, the
 * only other main-bundle importer of the store).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObservingParams } from "@/lib/astronomy";
import type { Journey, KbObject } from "@/lib/journeys/types";
import { hopPath, navigateHash, parseHopLocation } from "@/lib/navigation";
import { displayName, resolveObject, sameObject, type ChainResult, type ChainStop, type HopSource, type LegReport, type ObjectCatalog } from "@/lib/object-links";
import { starPlanningTarget, suggestSequence, type ObservingSession } from "@/lib/session-planner";
import { planChainInWorker } from "@/lib/route-client";
import { stopAtStep } from "@/lib/hop-chain";
import type { JourneyOverlay } from "./SkyChart";

export interface UseHopChainOptions {
  /** The planner's current observing params (site, time, field, difficulty). */
  params: ObservingParams;
  catalog: ObjectCatalog;
  /** Planner sessions, for `{kind:"night"}` sources. */
  sessions: readonly ObservingSession[];
  /** Current hash location (a chain is restored from `#/hop/<id>?journey=…&chain=…`). */
  location: string;
  /** Planner navigation; use navigateHash for paths with a query. */
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** Live clock: the chain is replanned only when the sky has moved REPLAN_MS (a planned time replans at once). */
  live?: boolean;
}
export interface HopChainState {
  /** What the active chain covers; null when no chain is active. */
  source: HopSource | null;
  chain: ChainResult | null;
  planning: boolean;
  error: string | null;
  /** Plan and show a chain (replaces any active one). */
  start(src: HopSource): void;
  /** Leave the chain (Star hop goes back to single-target routes). */
  clear(): void;
  /** Heading of the chain: the journey title, "Tonight's plan", or the id list's label (null before it resolves). */
  title: string | null;
  /** What one stop is called in "stop 3 of 5" ("stop" for journeys, "target" for a night or a list). */
  noun: "stop" | "target";
  /** Stops in the whole journey or night (the "of 5"); 0 before the source resolves. */
  stopTotal: number;
  /** Legs planned so far while planning (progress line). */
  progress: { done: number; total: number } | null;
  /** 1-based leg from the URL (`&leg=3`) for the bar to open at; null once consumed or absent. */
  focusLeg: number | null;
  /** The bar consumed focusLeg. */
  consumeFocusLeg(): void;
  /** Chart overlay for the chained route at field `step` (numbered stops, current/done states, leg framing). */
  overlay(step: number): JourneyOverlay | null;
}

/** Stops of a resolved source, with its heading. */
export interface ResolvedChainSource {
  title: string; noun: "stop" | "target"; stops: ChainStop[];
  /** Stops in the whole journey / night ("stop 3 of 5"). */
  total: number;
  journeyKey?: string; range?: { from: number; to: number };
  /** KB-only stops as extra sky nodes for the planner (ObservingParams.extraTargets). */
  extraTargets?: NonNullable<ObservingParams["extraTargets"]>;
}

const sameSource = (a: HopSource | null, b: HopSource | null) => JSON.stringify(a) === JSON.stringify(b);
/** Replan only when the sky moved this much (live clock) or another setting changed. */
const REPLAN_MS = 30 * 60_000;

/**
 * A readable label for an id nothing could resolve (the journeys KB did not load): "DS-DeltaCep" → "Delta Cep",
 * "NGC869" → "NGC 869", "Stock2" → "Stock 2". Never shown when the object resolves (displayName).
 */
export function readableId(id: string): string {
  return id.replace(/^(?:DS|STAR|AST|DSO)-/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/[-_]+/g, " ").trim() || id;
}

/** One display label per object (lib/object-links displayName), resolving through the loaded catalogs. */
export function chainStopFor(id: string | { id: string; hr?: number }, catalog: ObjectCatalog, fallback?: string): Omit<ChainStop, "stop" | "getThere"> {
  const raw = typeof id === "string" ? id : id.id;
  const r = resolveObject(id, catalog);
  if (!r?.routingId) return { id: raw, label: fallback ?? readableId(raw), kbId: raw };
  const target = r.unifiedId ? catalog.targets.find((t) => t.id === r.unifiedId) : undefined;
  const star = !target && r.hr ? catalog.stars.find((s) => s.hr === r.hr) : undefined;
  return { id: r.routingId, label: target ? displayName(target) : star ? displayName(star) : r.name, ...(r.kbId ? { kbId: r.kbId } : {}) };
}

type ExtraTarget = NonNullable<ObservingParams["extraTargets"]>[number];
/**
 * Journey stop ids → chain stops. Objects outside the hop catalogs are looked up in the KB (`kbObject`): by their HR
 * number when they have one, else they become extra sky nodes at their KB position (RW Cephei, Cygnus X-1) so the
 * hopper can still reach them.
 */
export function journeyChainStops(ids: readonly string[], catalog: ObjectCatalog, opts: { journey?: Journey | null; kbObject?: (id: string) => KbObject | undefined } = {}): { stops: ChainStop[]; extraTargets: ExtraTarget[] } {
  const extraTargets: ExtraTarget[] = [];
  const stops = ids.map((objectId, i): ChainStop => {
    const s = opts.journey?.stops[i];
    // The journey's naked-eye anchor for this stop ("Find Alderamin by eye") starts a fresh leg, so Star hop and the card agree.
    const anchor = s?.getThere.anchorId ? resolveObject(s.getThere.anchorId, catalog) : null;
    const startStarId = anchor?.hr && anchor.mag <= 4.5 && !sameObject(anchor.routingId ?? "", objectId) ? `HR${anchor.hr}` : undefined;
    // The anchor is the stop itself ("Find Betelgeuse by eye"): Star hop finds it by eye too, without hops.
    const byEye = !!s && s.getThere.mode === "naked-eye-hop" && !!s.getThere.anchorId && sameObject(s.getThere.anchorId, objectId);
    const meta = { stop: i + 1, ...(s ? { getThere: { mode: s.getThere.mode, fields: s.getThere.fields } } : {}), ...(startStarId ? { startStarId } : {}), ...(byEye ? { byEye } : {}) };
    if (resolveObject(objectId, catalog)) return { ...chainStopFor(objectId, catalog), ...meta };
    const o = opts.kbObject?.(objectId);
    if (!o) return { ...chainStopFor(objectId, catalog), ...meta };
    if (resolveObject({ id: o.id, hr: o.hr }, catalog)) return { ...chainStopFor({ id: o.id, hr: o.hr }, catalog), ...meta };
    const label = displayName(o, catalog.targets);
    extraTargets.push({ id: o.id, name: label, ra: o.ra, dec: o.dec, mag: o.mag ?? 8 });
    return { id: o.id, label, kbId: o.id, ...meta };
  });
  return { stops, extraTargets };
}

/**
 * Resolve a HopSource to chain stops. Journeys come from the device journey store (what Journeys showed), else from
 * the stop ids carried in the regenerable key; the journeys KB is loaded (lazily) only when a stop is outside the
 * hop catalogs.
 */
export async function resolveChainSource(src: HopSource, catalog: ObjectCatalog, sessions: readonly ObservingSession[]): Promise<ResolvedChainSource> {
  if (src.kind === "journey") {
    const [progress, keys] = await Promise.all([import("@/lib/journeys/progress"), import("@/lib/journeys/journey-key")]);
    const journey = progress.findStoredJourney(progress.readJourneyStore(), src.key);
    const ids = journey?.stops.map((s) => s.objectId) ?? keys.decodeJourneyKey(src.key)?.stopIds;
    if (!ids?.length) throw new Error("This journey is no longer on this device. Open it from Journeys again.");
    const from = Math.max(1, Math.min(ids.length, src.fromStop ?? 1)), to = Math.max(from, Math.min(ids.length, src.toStop ?? ids.length));
    let kbObject: ((id: string) => KbObject | undefined) | undefined;
    if (ids.some((id) => !resolveObject(id, catalog))) {
      try {
        const { getJourneyEngineSource } = await import("./journeys/journey-engine");
        const kb = await getJourneyEngineSource().loadKb();
        const byId = new Map(kb.objects.map((o) => [o.id, o]));
        kbObject = (id) => byId.get(id);
      } catch { /* without the KB those stops report "unresolved" */ }
    }
    const { stops, extraTargets } = journeyChainStops(ids, catalog, { journey, kbObject });
    return { title: journey?.title ?? "Sky journey", noun: "stop", stops: stops.slice(from - 1, to), total: ids.length, journeyKey: src.key, range: { from, to }, ...(extraTargets.length ? { extraTargets } : {}) };
  }
  if (src.kind === "night") {
    const session = sessions.find((s) => s.id === src.sessionId);
    if (!session) throw new Error("That night is no longer in the Planner.");
    const targets = [...catalog.targets, ...catalog.stars.map(starPlanningTarget)];
    const order = suggestSequence(session, targets).map((step) => step.id).filter((id) => !id.startsWith("moon:"));
    const stops = order.map((id, i) => ({ ...chainStopFor(id, catalog), stop: i + 1 }));
    return { title: "Tonight's plan", noun: "target", stops, total: stops.length };
  }
  if (src.kind === "ids") {
    const stops = src.ids.filter((id) => !id.startsWith("moon:")).map((id, i) => ({ ...chainStopFor(id, catalog), stop: i + 1 }));
    return { title: src.label ?? "Hop sequence", noun: "target", stops, total: stops.length };
  }
  return { title: "", noun: "stop", stops: [], total: 0 };
}

/** Where Star hop shows a chain: the final stop, with the journey range in the query (journeys only). */
export function chainLocation(resolved: ResolvedChainSource, leg?: number): string | null {
  const final = resolved.stops.at(-1);
  if (!final) return null;
  return hopPath(final.id, resolved.journeyKey && resolved.range ? { journey: { key: resolved.journeyKey }, chain: resolved.range, ...(leg ? { leg } : {}) } : {});
}

// One overlay object per chain and current stop, so the chart does not re-place its labels on every render.
const overlayCache = new WeakMap<ChainResult, Map<number, JourneyOverlay | null>>();
/** SkyChart overlay for a chain at field `step`: numbered stops (done / current / to do / skipped) and the current leg's fields to frame. */
export function chainOverlay(chain: ChainResult, step: number): JourneyOverlay | null {
  if (!chain.route) return null;
  const current = stopAtStep(chain, step);
  let byStop = overlayCache.get(chain);
  if (!byStop) overlayCache.set(chain, (byStop = new Map()));
  if (byStop.has(current)) return byStop.get(current)!;
  const nodes = new Map(chain.nodes.map((n) => [n.id, n]));
  const stops = chain.stops.flatMap((stop, i) => {
    const node = nodes.get(stop.id);
    if (!node) return [];
    const state = chain.stopHopIndex[i] < 0 ? "skipped" as const : i === current ? "current" as const : i < current ? "done" as const : "todo" as const;
    return [{ id: stop.id, ra: node.ra, dec: node.dec, label: stop.label, state, mag: node.mag < 30 ? node.mag : null, kind: node.type === "star" ? "star" as const : "dso" as const }];
  });
  const currentIndex = stops.findIndex((s) => s.state === "current");
  const end = chain.stopHopIndex[current] ?? -1;
  let start = 0;
  for (let i = current - 1; i >= 0; i--) if (chain.stopHopIndex[i] >= 0) { start = chain.stopHopIndex[i]; break; }
  const overlay: JourneyOverlay | null = stops.length ? { stops, highlight: currentIndex >= 0 ? currentIndex : null, hideRegion: true, hideLegs: true, ...(end >= 0 ? { routeLeg: { start, end } } : {}) } : null;
  byStop.set(current, overlay);
  return overlay;
}

export function useHopChain(options: UseHopChainOptions): HopChainState {
  const { params, catalog, sessions, location, live = false } = options;
  const [source, setSource] = useState<HopSource | null>(null);
  const [resolved, setResolved] = useState<ResolvedChainSource | null>(null);
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [focusLeg, setFocusLeg] = useState<number | null>(null);
  const latest = useRef({ catalog, sessions, location });
  latest.current = { catalog, sessions, location };
  const resolveRun = useRef(0);
  const catalogReady = catalog.stars.length > 0 && catalog.targets.length > 0;

  const begin = useCallback((src: HopSource, navigateAfter: boolean) => {
    const run = ++resolveRun.current;
    setSource(src); setResolved(null); setChain(null); setError(null); setProgress(null); setPlanning(true);
    void resolveChainSource(src, latest.current.catalog, latest.current.sessions).then((value) => {
      if (resolveRun.current !== run) return;
      if (!value.stops.length) { setPlanning(false); setError("Nothing to hop to in this sequence."); return; }
      setResolved(value);
      // Normalise the journey range so the URL restore below recognises this chain.
      if (src.kind === "journey" && value.range) setSource({ kind: "journey", key: src.key, fromStop: value.range.from, toStop: value.range.to });
      const path = chainLocation(value);
      if (navigateAfter && path && path !== latest.current.location) navigateHash(path);
    }, (e: unknown) => {
      if (resolveRun.current !== run) return;
      setPlanning(false); setError(e instanceof Error ? e.message : "Could not open this hop sequence.");
    });
  }, []);
  const start = useCallback((src: HopSource) => { if (src.kind === "single") { clearRef.current(); return; } setFocusLeg(null); begin(src, true); }, [begin]);
  const clear = useCallback(() => {
    resolveRun.current++;
    setSource(null); setResolved(null); setChain(null); setPlanning(false); setError(null); setProgress(null); setFocusLeg(null);
    // Leave the chain URL too, or the restore below would start it again.
    const here = parseHopLocation(latest.current.location);
    if (here?.chain) navigateHash(hopPath(here.targetId), { replace: true });
  }, []);
  const clearRef = useRef(clear);
  clearRef.current = clear;

  // Restore from (and follow) the URL: `?journey=KEY&chain=a-b` starts that journey chain; another Star hop
  // destination outside the chain leaves it.
  useEffect(() => {
    if (!catalogReady) return;
    const here = parseHopLocation(location);
    if (here?.journey && here.chain) {
      const want: HopSource = { kind: "journey", key: here.journey.key, fromStop: here.chain.from, toStop: here.chain.to };
      if (here.leg) setFocusLeg(here.leg);
      if (!sameSource(source, want)) begin(want, false);
      return;
    }
    if (here && source && resolved && !resolved.stops.some((s) => sameObject(s.id, here.targetId))) clear();
  }, [location, catalogReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plan when the stops resolve and whenever the sky settings change. A live clock ticks every 30 s: it replans only
  // when the sky has moved REPLAN_MS; a planned time the user chose replans at once.
  const plannedAt = useRef<number | null>(null);
  let dateMs = params.date.getTime();
  if (live && plannedAt.current !== null && Math.abs(dateMs - plannedAt.current) < REPLAN_MS) dateMs = plannedAt.current;
  const skyKey = JSON.stringify({ ...params, date: dateMs, targetId: undefined, startStarId: undefined, startNodeId: undefined, waypointIds: undefined, startIsWaypoint: undefined, numRoutes: undefined });
  useEffect(() => {
    if (!resolved) return;
    const controller = new AbortController();
    plannedAt.current = dateMs;
    setPlanning(true); setError(null); setProgress({ done: 0, total: resolved.stops.length });
    const base: ObservingParams = { ...params, date: new Date(dateMs), numRoutes: 3, ...(resolved.extraTargets ? { extraTargets: resolved.extraTargets } : {}) };
    planChainInWorker(base, resolved.stops, { signal: controller.signal, onLeg: (leg: LegReport) => setProgress({ done: leg.leg, total: resolved.stops.length }) })
      .then((value) => { setChain(value); setPlanning(false); setProgress(null); if (!value.route) setError("None of these stops can be reached with star hops at this time."); })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setPlanning(false); setProgress(null); setError(e instanceof Error ? e.message : "Could not plan this hop sequence.");
      });
    return () => controller.abort();
  }, [resolved, skyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const consumeFocusLeg = useCallback(() => setFocusLeg(null), []);
  const overlay = useCallback((step: number) => (chain ? chainOverlay(chain, step) : null), [chain]);
  return useMemo<HopChainState>(() => ({
    source, chain, planning, error, start, clear, title: resolved?.title ?? null, noun: resolved?.noun ?? (source?.kind === "journey" ? "stop" : "target"), stopTotal: resolved?.total ?? 0,
    progress, focusLeg, consumeFocusLeg, overlay,
  }), [source, chain, planning, error, start, clear, resolved, progress, focusLeg, consumeFocusLeg, overlay]);
}
