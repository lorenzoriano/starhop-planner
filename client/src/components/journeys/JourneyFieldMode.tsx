/**
 * Screen C — Field mode (doc 06 §6): full screen, Get there → Look & learn per stop, primary actions in the
 * bottom thumb zone (≥56 px), progress persisted in starhop-journey-v1 so a reload resumes the same stop and phase.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, HelpCircle, Map as MapIcon, Moon, Navigation, SkipForward, X } from "lucide-react";
import { SkyChart, type JourneyOverlay } from "@/components/SkyChart";
import { angularDistance } from "@/lib/astronomy";
import { moonCategory } from "@/lib/journeys/conditions";
import { moonVerdict } from "@/lib/sky-feasibility";
import { moonIllumination } from "@/lib/moon";
import {
  completeJourney, journeyStopTime, lastSeenBefore, markStopSeen, moveTo, recordOutcome, rememberJourney, SKIP_REASON_LABELS, startJourneyProgress, stopVisitStates,
  type FeedbackRecord, type JourneyPhase, type JourneyProgress, type SkipReason,
} from "@/lib/journeys/progress";
import { LINK_LABELS, objectName } from "@/lib/object-links";
import type { Journey, KbObject } from "@/lib/journeys/types";
import type { JourneysShared } from "./JourneysPage";
import { StopCard } from "./stop-card-slot";
import { StopActions } from "./StopActions";
import { JourneyMapDialog } from "./JourneyRouteMap";
import { trapTab } from "./use-overlay-dismiss";
import { plainClass } from "./plain-language-adapter";
import { compassOf, COMPASS_WORDS, fieldAnchor, getThereFor, journeySpine, chapterOf, legSummary, overlayStop, showLowerBinoculars as showLower, spineBeatOf, stopAltitudeState, stopBeatLabel, stopRoleLine, transitionFor } from "./journey-view";

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

export function JourneyFieldMode({ shared, journey, stopNumber, onFeedback }: { shared: JourneysShared; journey: Journey; stopNumber: number; onFeedback: (r: FeedbackRecord) => void }) {
  const { page, kb, objects, store, updateStore, actions } = shared;
  const last = journey.stops.length - 1;
  const index = Math.max(0, Math.min(last, stopNumber - 1));
  const progress: JourneyProgress | null = store.active?.key === journey.key ? store.active : null;

  // Deep link or reload without matching progress: start (or resume) it here.
  useEffect(() => {
    if (!progress) updateStore((s) => startJourneyProgress(rememberJourney(s, journey, page.live), journey, page.live));
  }, [progress, updateStore, journey, page.live]);
  // The URL decides the stop; a new stop starts in Get there.
  useEffect(() => {
    if (progress && progress.stopIndex !== index) updateStore((s) => (s.active ? { ...s, active: moveTo(s.active, index, "get-there") } : s));
  }, [progress, index, updateStore]);
  // Out-of-range stop numbers are corrected in place.
  useEffect(() => { if (stopNumber !== index + 1) shared.go({ view: "stop", key: journey.key, stop: index + 1 }, true); }, [stopNumber, index, shared, journey.key]);

  const phase: JourneyPhase = progress?.stopIndex === index ? progress.phase : "get-there";
  const outcome = progress?.outcomes[index]?.outcome ?? null;
  const lastSeen = progress ? lastSeenBefore(progress, index) : index - 1;
  const stop = journey.stops[index];
  const object = objects.get(stop.objectId);
  const fov = page.profile.fov;
  const guide = useMemo(() => getThereFor(journey, index, lastSeen, objects, fov), [journey, index, lastSeen, objects, fov]);
  const spine = useMemo(() => journeySpine(journey, kb), [journey, kb]);
  const transition = useMemo(() => transitionFor(journey, index, lastSeen, objects), [journey, index, lastSeen, objects]);
  const chapter = stop.lens ? chapterOf(spine, index) : null;
  const role = chapter ? stopRoleLine(stop, chapter.label) : null;
  const nextChapter = chapter && chapter.n < chapter.total && spineBeatOf(spine, index + 1) === chapter.n ? spine[chapter.n] : null;
  // One name per object on every tab (lib/object-links): the stop title, the rail, the sheets and the map agree with
  // Star hop, the Planner and Tonight. Map labels use the short form (objectName.name).
  const nameOf = useCallback((o: KbObject | undefined, id: string) => (o ? objectName(o, page.targets).label : id), [page.targets]);
  const stopName = (i: number) => nameOf(objects.get(journey.stops[i].objectId), journey.stops[i].objectId);

  // ── full-screen focus mode: hide the app header, nav, time bar and footer ──
  useEffect(() => {
    const shell = document.querySelector(".observatory-shell");
    shell?.setAttribute("data-journey-focus", "on");
    return () => shell?.removeAttribute("data-journey-focus");
  }, []);

  // ── phase timing + "can't find it" counts for local feedback ──
  const phaseStart = useRef(Date.now());
  const timings = useRef<{ getThereMs?: number; lookMs?: number; cantFindOpens: number }>({ cantFindOpens: 0 });
  useEffect(() => { phaseStart.current = Date.now(); }, [index, phase]);
  useEffect(() => { timings.current = { cantFindOpens: 0 }; }, [index]);
  const closePhaseTimer = () => {
    const ms = Date.now() - phaseStart.current;
    if (phase === "get-there") timings.current.getThereMs = (timings.current.getThereMs ?? 0) + ms; else timings.current.lookMs = (timings.current.lookMs ?? 0) + ms;
    phaseStart.current = Date.now();
  };
  const stopFeedback = (result: "seen" | "skipped", reason?: SkipReason) => onFeedback({
    type: "stop", journeyKey: journey.key, templateId: journey.templateId, objectId: stop.objectId, stopIndex: index, outcome: result,
    ...(reason ? { reason } : {}), ...(timings.current.getThereMs !== undefined ? { getThereMs: Math.round(timings.current.getThereMs) } : {}),
    ...(timings.current.lookMs !== undefined ? { lookMs: Math.round(timings.current.lookMs) } : {}), cantFindOpens: timings.current.cantFindOpens, at: Date.now(),
  });

  // ── actions ──
  const setPhase = useCallback((next: JourneyPhase) => updateStore((s) => (s.active ? { ...s, active: moveTo(s.active, index, next) } : s)), [updateStore, index]);
  const goStop = useCallback((i: number) => shared.go({ view: "stop", key: journey.key, stop: i + 1 }), [shared, journey.key]);
  const finish = () => {
    updateStore((s) => (s.active ? { ...s, active: completeJourney(s.active) } : s));
    onFeedback({ type: "journey", journeyKey: journey.key, templateId: journey.templateId, status: "completed", at: Date.now() });
    shared.go({ view: "done", key: journey.key });
  };
  const advance = () => (index < last ? goStop(index + 1) : finish());
  // "I see it": one pure update of the journey store and the feedback log (markStopSeen, shared with the Star hop bar),
  // then the same observation in the Planner log, under the id the Planner lists (so both say "seen").
  const seeIt = () => {
    closePhaseTimer();
    const now = Date.now(), ref = { key: journey.key, stop: index + 1 }, o = { live: page.live, now, timings: { ...timings.current } };
    // Each store is updated from its own latest state; the journey is always findable (it is the one on screen).
    updateStore((s) => markStopSeen({ store: rememberJourney(s, journey, page.live, now), feedback: shared.feedback }, ref, o).store);
    shared.updateFeedback((f) => markStopSeen({ store: rememberJourney(store, journey, page.live, now), feedback: f }, ref, o).feedback);
    // Tagged with this stop and its planned time, as the Star hop bar's "I see" does (mergeJourneyTag).
    if (logId) actions.markObserved(logId, { journeyKey: journey.key, journeyStop: index + 1, plannedAt: journeyStopTime(journey, index + 1) });
  };
  const [sheet, setSheet] = useState<null | "skip" | "help">(null);
  const [mapOpen, setMapOpen] = useState(false);
  const skip = (reason?: SkipReason) => {
    closePhaseTimer();
    updateStore((s) => (s.active ? { ...s, active: recordOutcome(s.active, index, "skipped", reason) } : s));
    stopFeedback("skipped", reason);
    setSheet(null);
    advance();
  };
  const [confirm, setConfirm] = useState<null | { kind: "exit" } | { kind: "jump"; to: number }>(null);
  const exit = () => {
    if (progress && !progress.completedAt) onFeedback({ type: "journey", journeyKey: journey.key, templateId: journey.templateId, status: "abandoned", atStop: index, at: Date.now() });
    shared.go({ view: "overview", key: journey.key });
  };
  // Ids the shared actions take (lib/object-links): null = a KB-only object no other tab can show (no hop, no log).
  const resolved = useMemo(() => (object ? shared.resolve(object) : null), [object, shared]);
  const hopTarget = resolved?.routingId ?? null;
  const logId = resolved?.sessionId ?? null;
  // "Plan star hop" starts where the directions start: the previous stop, or the anchor the jump names (guide.startId).
  const planHop = () => { if (hopTarget) actions.hop(hopTarget, { at: page.date, ...(guide.startId ? { from: guide.startId } : {}), journey: { key: journey.key, stop: index + 1 } }); };
  // After "I see it": the next leg as a star hop, from this stop (or the anchor the next card names for a jump).
  const nextStop = index < last ? journey.stops[index + 1] : null;
  const nextObject = nextStop ? objects.get(nextStop.objectId) : undefined;
  const nextTarget = nextObject ? shared.resolve(nextObject)?.routingId ?? null : null;
  const hopNext = () => {
    if (!nextTarget) return;
    const nextGuide = getThereFor(journey, index + 1, index, objects, fov);
    actions.hop(nextTarget, { at: page.date, ...(nextGuide.startId ? { from: nextGuide.startId } : {}), journey: { key: journey.key, stop: index + 2 } });
  };

  // ── pre-flight sheet (once per journey unless "don't ask again"); a modal: the page behind waits ──
  const showPreflight = !!progress && !progress.preflightDone && !store.skipPreflight && index === 0 && !outcome;
  // Spec §9: red light is the default suggestion once the Sun is below −6°: the box starts ticked, the user decides
  // (unticking keeps it off; "Begin" applies the choice).
  const redRecommended = page.sunAlt < -6;
  const [redChoice, setRedChoice] = useState(() => page.redLight || redRecommended);
  const preflightRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (showPreflight) preflightRef.current?.querySelector<HTMLElement>("input, button")?.focus(); }, [showPreflight]);
  const beginJourney = () => {
    if (redChoice !== page.redLight) page.onRedLight(redChoice);
    updateStore((s) => (s.active ? { ...s, active: { ...s.active, preflightDone: true } } : s));
  };
  const [wakeOn, setWakeOn] = useState(false);
  const wakeSupported = typeof navigator !== "undefined" && !!(navigator as WakeLockNavigator).wakeLock;
  useEffect(() => {
    if (!wakeOn || !wakeSupported) return;
    let sentinel: WakeLockSentinelLike | null = null, cancelled = false;
    const acquire = () => { (navigator as WakeLockNavigator).wakeLock!.request("screen").then((s) => { if (cancelled) void s.release(); else sentinel = s; }, () => setWakeOn(false)); };
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); void sentinel?.release(); };
  }, [wakeOn, wakeSupported]);

  // ── keyboard (desktop): ←/→, Space, S, R, Esc ──
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))) return;
    // The route map and the image viewer own the keyboard while they are open.
    if (mapOpen || document.querySelector(".jlightbox, .jmap-dialog")) return;
    if (showPreflight || sheet) { if (e.key === "Escape") setSheet(null); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); if (phase === "get-there") setPhase("look"); else if (outcome) advance(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (phase === "look") setPhase("get-there"); else if (index > 0) goStop(index - 1); }
    else if (e.key === " " && !(el && el.tagName === "BUTTON")) { e.preventDefault(); if (!outcome) seeIt(); }
    else if (e.key === "s" || e.key === "S") { e.preventDefault(); if (outcome !== "seen") setSheet("skip"); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); page.onRedLight(!page.redLight); }
    else if (e.key === "Escape") { e.preventDefault(); setConfirm({ kind: "exit" }); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => keyHandler.current(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  // ── live altitude checks (doc 06 §6.7) ──
  const altStates = useMemo(() => journey.stops.map((s) => { const o = objects.get(s.objectId); return o ? stopAltitudeState(o, page.lat, page.lon, page.date, shared.minAlt, page.timezone) : null; }), [journey, objects, page.lat, page.lon, page.date, shared.minAlt, page.timezone]);
  const lowSoon = altStates.findIndex((a, i) => i > index && !progress?.outcomes[i] && a?.kind === "getting-low");

  // ── chart overlay for the leg ──
  // Recorded outcomes only: stops jumped over ("Start here" at stop 5) stay neutral on the rail and the maps.
  const visit = useMemo(() => stopVisitStates(progress, journey.stops.length, index), [progress, journey.stops.length, index]);
  const anchorLabelled = useCallback((a: ReturnType<typeof fieldAnchor>) => {
    const o = a ? objects.get(a.id) : undefined;
    return a && o ? { ...a, label: objectName(o, page.targets).name } : a;
  }, [objects, page.targets]);
  const focusFrom = guide.restarted ? lastSeen : index - 1;
  const overlay = useMemo<JourneyOverlay>(() => ({
    stops: journey.stops.flatMap((s, i) => {
      const o = objects.get(s.objectId);
      if (!o) return [];
      return [{ ...overlayStop(o, visit[i]), label: objectName(o, page.targets).name }];
    }),
    focus: focusFrom >= 0 ? [focusFrom, index] : [index],
    fieldRadiusDeg: guide.mode === "naked-eye-hop" ? Math.max(18, Math.min(45, guide.distanceDeg / 2 + 8)) : undefined,
    regionBufferDeg: Math.max(1, fov * 0.6),
    anchor: anchorLabelled(fieldAnchor(journey, index, focusFrom, objects, guide.mode)),
    // The directions say "left / right / up" as the observer sees the sky, so the map turns to match (zenith up).
    observerUp: true,
  }), [journey, objects, visit, index, focusFrom, guide.mode, guide.distanceDeg, fov, page.targets, anchorLabelled]);
  const nodes = useMemo(() => [...shared.skyNodes, ...shared.stopNodes(journey)], [shared, journey]);

  if (!object) return <section className="journeys journeys-message"><h1>This stop is missing from the knowledge base</h1><button type="button" className="journey-button" onClick={advance}>Continue</button></section>;
  const alt = altStates[index];
  // The one Moon verdict (lib/sky-feasibility): the same call the engine, the Moon tab and the Planner use.
  const moonCheck = moonVerdict({ alt: alt?.alt ?? stop.altAtStart, separation: angularDistance(page.moon.ra, page.moon.dec, object.ra, object.dec), category: moonCategory(object) }, page.moon, page.skyBrightness);
  const trail = journey.stops.slice(0, index).filter((_, i) => progress?.outcomes[i]?.outcome === "seen").map((s) => s.objectId);
  const logged = !!logId;
  const title = nameOf(object, stop.objectId);

  return <section className={`journeys journey-field phase-${phase}`} data-testid="journey-field" aria-labelledby="journey-field-title">
    <header className="journey-field-top">
      <button type="button" className="journey-icon-button" onClick={() => setConfirm({ kind: "exit" })} aria-label="Exit field mode"><X size={20}/></button>
      <p className="journey-field-title"><span>{journey.title}</span></p>
      <div className="journey-field-tools">
        <button type="button" className="journey-icon-button" onClick={() => setMapOpen(true)} aria-label="Route map" aria-haspopup="dialog" data-testid="journey-field-map"><MapIcon size={18}/><span>Map</span></button>
        <button type="button" className={`journey-icon-button journey-red-toggle ${page.redLight ? "active" : ""}`} aria-pressed={page.redLight} onClick={() => page.onRedLight(!page.redLight)} aria-label="Red light"><Moon size={18}/><span>Red</span></button>
      </div>
    </header>
    {mapOpen && <JourneyMapDialog shared={shared} journey={journey} fieldAt={index} title={`Stop ${index + 1} of ${journey.stops.length}: ${title}`}
      states={visit}
      onStopSelect={(i) => { if (i !== index) { setMapOpen(false); setConfirm({ kind: "jump", to: i }); } }}
      onClose={() => setMapOpen(false)}/>}
    <nav className="journey-rail" aria-label="Journey progress">
      <ol>{journey.stops.map((s, i) => {
        // A little extra gap where the storyline moves to its next beat: the stepper doubles as the beat grouping.
        const beatStart = i > 0 && spineBeatOf(spine, i) !== spineBeatOf(spine, i - 1);
        const missed = visit[i] === "todo" && altStates[i]?.kind === "missed";
        const state = missed ? "missed" : visit[i];
        return <li key={s.objectId + i} className={beatStart ? "rail-beat-start" : undefined}><button type="button" className={`rail-${state}`} aria-current={i === index ? "step" : undefined}
          aria-label={`Stop ${i + 1}: ${stopName(i)}${state === "done" ? ", seen" : state === "skipped" ? ", skipped" : state === "missed" ? ", missed (too low)" : ""}`}
          onClick={() => { if (i !== index) setConfirm({ kind: "jump", to: i }); }}>
          <span aria-hidden="true">{state === "done" ? "✓" : state === "skipped" ? "–" : state === "missed" ? "×" : i + 1}</span></button></li>;
      })}</ol>
    </nav>
    <div className="journey-phase-toggle" role="tablist" aria-label="Step">
      <button type="button" role="tab" aria-selected={phase === "get-there"} className={phase === "get-there" ? "active" : ""} onClick={() => setPhase("get-there")}>Get there</button>
      <button type="button" role="tab" aria-selected={phase === "look"} className={phase === "look" ? "active" : ""} onClick={() => setPhase("look")}>Look &amp; learn</button>
    </div>
    {confirm && <div className="journey-confirm" role="alertdialog" aria-label={confirm.kind === "exit" ? "Leave field mode" : "Jump to another stop"}>
      <p>{confirm.kind === "exit" ? "Leave field mode? Your progress is saved on this device." : `Jump to stop ${confirm.to + 1}, ${stopName(confirm.to)}?`}</p>
      <div className="journey-actions-row"><button type="button" className="journey-button" onClick={() => setConfirm(null)}>Stay</button><button type="button" className="journey-button primary" onClick={() => { const c = confirm; setConfirm(null); if (c.kind === "exit") exit(); else goStop(c.to); }}>{confirm.kind === "exit" ? "Leave" : "Jump"}</button></div>
    </div>}
    {(alt && alt.kind !== "ok") && <p className={`journey-alt-chip alt-${alt.kind}`} role="status">{alt.text}</p>}
    {lowSoon >= 0 && <p className="journey-alt-chip alt-getting-low" role="status">Stop {lowSoon + 1}, {stopName(lowSoon)}: {altStates[lowSoon]?.text}<button type="button" className="journey-button small" onClick={() => goStop(lowSoon)}>Do it next</button></p>}

    <div className="journey-field-body">
      <div className="journey-field-chart" hidden={phase === "look" ? true : undefined}>
        <SkyChart nodes={nodes} constellations={page.constellations} route={null} targetNode={null} animStep={0}
          fovWidth={fov} fovHeight={fov} fovShape="circle" lat={page.lat} lon={page.lon} date={page.date}
          limitingMag={6.5} denseStars={page.denseStars} milkyWay={page.milkyWay} isBinocular journey={overlay}/>
        <p className="journey-field-orient" data-testid="journey-field-orient">As you see it: up is overhead, as in the directions</p>
      </div>
      <div className="journey-field-panel">
        {phase === "get-there" ? <div className="journey-getthere">
          {/* r5 UX #11: the stop count leads (it matches the numbered pager above); the chapter is its subtitle.
              "Next in the story" waits for "I see it", where it pulls you on to the next stop. */}
          <p className="journey-field-beat" data-testid="journey-field-chapter"><span className="journey-field-count">Stop {index + 1} of {journey.stops.length}</span>
            <span className="journey-field-chapter-name">{"\u00a0· "}{chapter ? chapter.label : stopBeatLabel(stop)}</span></p>
          <h1 id="journey-field-title">{title}</h1>
          <p className="journey-field-kind">{plainClass(object)}{role && <span className="journey-field-role"> · {role}</span>}</p>
          {/* One summary for the leg, counted from where the binocular hop starts (the same start "Plan star hop" uses). */}
          <p className="journey-mode-chip" data-testid="journey-leg-summary"><span aria-hidden="true">{guide.mode === "same-field" ? "◎" : guide.mode === "sweep" ? "→" : "⇡"}</span>{legSummary(guide, shared.hopLeg(journey.key, index + 1))}</p>
          {showLower(guide, index) && <p className="journey-lower"><strong>Lower your binoculars first.</strong> Find the spot with your eyes, then raise them.</p>}
          <p className="journey-guidance">{guide.text}</p>
          {/* Labelled with the target, so it never reads as a second, contradicting number for the anchor star. */}
          {alt && <p className="journey-where">{title} now: {Math.round(alt.alt)}° up, toward the {COMPASS_WORDS[compassOf(stop.azAtStart)]}</p>}
          {hopTarget && <button type="button" className="journey-button journey-hop-button" onClick={planHop} data-testid="journey-hop-from-previous"><Navigation size={15} aria-hidden="true"/>{LINK_LABELS.hop}{guide.startName && <small>from {guide.startName}</small>}</button>}
        </div> : <>
          <StopCard object={object} stop={stop} journey={journey} kb={kb} mode="field" fovDeg={fov} transition={transition} trailObjectIds={trail} altitudeDeg={alt?.alt}
            sky={{ targets: page.targets, lat: page.lat, lon: page.lon, timezone: page.timezone, skyBrightness: page.skyBrightness, profile: page.profile, at: page.date }}/>
          <StopActions objectId={object.id} actions={actions} catalog={shared.catalog} journey={{ key: journey.key, stop: index + 1 }} from={guide.startId ?? undefined} at={page.date} plannedAt={journeyStopTime(journey, index + 1)} name={title} origin="field" compact/>
        </>}
      </div>
    </div>

    {/* The pre-flight sheet is modal: a backdrop over the page takes
        every tap until "Begin"; the dock sits above it. */}
    {showPreflight && <div className="journey-sheet-backdrop" aria-hidden="true" data-testid="journey-preflight-backdrop"/>}
    {/* Bottom dock: sticky, so it stays in the viewport. Sheets open in the same dock. */}
    <div className={`journey-thumb-zone ${sheet || showPreflight ? "with-sheet" : ""}`}>
      {!sheet && !showPreflight && <>
      {/* "I see it" confirms in place: the app's toast moves to the top in field mode, away from the thumb zone. */}
      {outcome === "seen" && <div className="journey-seen-row">
        <p className="journey-seen-note" role="status" data-testid="journey-seen-note"><Check size={14} aria-hidden="true"/>Seen{logged ? " · saved to tonight's log" : ""}</p>
        {nextTarget && <button type="button" className="journey-link journey-hop-next" onClick={hopNext} data-testid="journey-hop-next"><Navigation size={15} aria-hidden="true"/>Hop to the next stop</button>}
      </div>}
      {outcome === "seen" && nextChapter && <p className="journey-next-chapter" data-testid="journey-next-chapter">Next in the story: {nextChapter.label}</p>}
      <div className={`journey-thumb-bar${!outcome ? " with-help" : ""}`}>
        {!outcome && <button type="button" className="journey-button thumb journey-cant-find" onClick={() => { timings.current.cantFindOpens++; setSheet("help"); }} data-testid="journey-cant-find"><HelpCircle size={18} aria-hidden="true"/><span>Can't find it?</span></button>}
        {outcome === "seen"
          ? <button type="button" className="journey-button thumb" onClick={() => (phase === "look" ? setPhase("get-there") : setPhase("look"))}>{phase === "look" ? <><ChevronLeft size={18} aria-hidden="true"/>Get there</> : <><Eye size={18} aria-hidden="true"/>Look &amp; learn</>}</button>
          : <button type="button" className="journey-button thumb" onClick={() => setSheet("skip")} data-testid="journey-skip"><SkipForward size={18} aria-hidden="true"/>Skip</button>}
        {outcome === "seen"
          ? <button type="button" className="journey-button thumb primary" onClick={advance} data-testid="journey-next">{index < last ? <>Next stop<ChevronRight size={18} aria-hidden="true"/></> : <>Finish<ChevronRight size={18} aria-hidden="true"/></>}</button>
          : <button type="button" className="journey-button thumb primary" onClick={seeIt} data-testid="journey-see-it"><Check size={18} aria-hidden="true"/>I see it</button>}
      </div>
      </>}
      {sheet === "skip" && <div className="journey-sheet" role="region" aria-label="Skip this stop">
        <h2>Skip {title}?</h2>
        <p>Why? (optional — it helps future journeys)</p>
        <div className="journey-actions-row">{(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => <button key={r} type="button" className="journey-button" onClick={() => skip(r)}>{SKIP_REASON_LABELS[r]}</button>)}</div>
        <div className="journey-actions-row"><button type="button" className="journey-button" onClick={() => setSheet(null)}>Cancel</button><button type="button" className="journey-button primary" onClick={() => skip()}>Skip without a reason</button></div>
      </div>}
      {sheet === "help" && <div className="journey-sheet" role="region" aria-label={`Can't find ${title}`}>
        <h2>Can't find {title}?</h2>
        <ul className="journey-diagnostics">
          {object.obsDifficulty >= 3 && <li>It's faint: look slightly to one side of where it should be (averted vision).</li>}
          <li>Rest your elbows on something and hold still for 10 seconds.</li>
          {alt && <li>{alt.alt < shared.minAlt + 5 ? `It's only ${Math.round(alt.alt)}° high — low objects dim in thick air; trees and haze may hide it.` : `It's ${Math.round(alt.alt)}° high — height is not the problem.`}</li>}
          <li>{!moonCheck.moonUp ? "Moon glow: none, the Moon is down." : moonCheck.tooClose || moonCheck.tooBright ? `Moon glow: the ${moonIllumination(page.date).percent}% Moon is ${Math.round(moonCheck.separation)}° away and brightens the sky here (${moonCheck.level.toLowerCase()}).` : `Moon glow: the Moon is ${Math.round(moonCheck.separation)}° away; ${moonCheck.level.toLowerCase()}.`}</li>
          <li>{page.sunAlt > -18 ? (page.sunAlt > -12 ? "Twilight: the sky is still bright; faint objects may not show yet." : "Late twilight: faint glows improve over the next half hour.") : "The sky is fully dark."}</li>
        </ul>
        <div className="journey-actions-row">
          <button type="button" className="journey-button" onClick={() => { setSheet(null); setPhase("get-there"); }}>Show the directions again</button>
          {hopTarget && <button type="button" className="journey-button" onClick={planHop}><Navigation size={15} aria-hidden="true"/>{LINK_LABELS.hop}</button>}
        </div>
        <div className="journey-actions-row"><button type="button" className="journey-button" onClick={() => setSheet(null)}>Keep looking</button><button type="button" className="journey-button primary" onClick={() => skip("not-found")}>Skip — I couldn't see it</button></div>
      </div>}

      {showPreflight && <div className="journey-sheet journey-preflight" role="region" aria-label="Before you start" data-testid="journey-preflight" ref={preflightRef} onKeyDown={trapTab}>
        <h2>Before you start</h2>
        <label className="journey-check big"><input type="checkbox" checked={redChoice} data-testid="journey-preflight-red" onChange={(e) => { setRedChoice(e.target.checked); page.onRedLight(e.target.checked); }}/>Red light {redRecommended && <small>(recommended now)</small>}</label>
        {wakeSupported && <label className="journey-check big"><input type="checkbox" checked={wakeOn} onChange={(e) => setWakeOn(e.target.checked)}/>Keep the screen awake</label>}
        <label className="journey-check big"><input type="checkbox"/>I've been outside 15–20 minutes (eyes adapted)</label>
        <p>Your binoculars: {page.profile.magnification}×{page.profile.aperture} · {fov.toFixed(1)}° field <button type="button" className="journey-link" onClick={page.onEditSetup}>edit</button></p>
        <p>Face the {COMPASS_WORDS[compassOf(journey.stops[0].azAtStart)]}. {journey.stops[0].getThere.bearingText}</p>
        <label className="journey-check"><input type="checkbox" checked={!!store.skipPreflight} onChange={(e) => updateStore((s) => ({ ...s, skipPreflight: e.target.checked }))}/>Don't ask again</label>
        <button type="button" className="journey-button primary big" onClick={beginJourney} data-testid="journey-preflight-begin">Begin at stop 1<ChevronRight size={18} aria-hidden="true"/></button>
      </div>}
    </div>
  </section>;
}
