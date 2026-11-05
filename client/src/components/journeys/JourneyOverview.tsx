/** Screen B — Overview (doc 06 §5): route map + the story, the storyline spine and the stops as collapsed cards. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, Check, ChevronDown, Clock, Gauge, Link2, ListOrdered, Map as MapIcon, Moon, Orbit, Play, Plus, Route as RouteIcon, Spline } from "lucide-react";
import { SkyChart, type JourneyOverlay } from "@/components/SkyChart";
import type { Journey, KbObject } from "@/lib/journeys/types";
import { journeyStopTime, spineStateOf, stopVisitStates } from "@/lib/journeys/progress";
import { LINK_LABELS, objectName } from "@/lib/object-links";
import type { JourneysShared } from "./JourneysPage";
import { StopCard } from "./stop-card-slot";
import { StopActions } from "./StopActions";
import { JourneyRouteMap } from "./JourneyRouteMap";
import { StorySpine } from "./StorySpine";
import { plainClass } from "./plain-language-adapter";
import { COMPASS_WORDS, compassOf, DIFFICULTY_HELP, DIFFICULTY_LABELS, durationLabel, getThereFor, journeyEffort, journeyConditionLines, journeyMoonCheck, journeySpine, journeyStats, localTime, overlayStop, regionWords, spineBeatOf, stopBeatLabel, stopRoleLine, storyProse, themeLabel, transitionFor, type JourneyStat, type SpineBeat } from "./journey-view";

const STAT_ICON: Record<JourneyStat["id"], typeof Clock> = { time: Clock, stops: ListOrdered, path: Spline, hops: RouteIcon, difficulty: Gauge };

/** A chapter's why-here line without the driving question it may open with (the story panel just showed it). */
export function chapterLine(text: string, question: string): string {
  const t = text.trim(), q = question.trim();
  return q && t.startsWith(q) && t.length > q.length ? t.slice(q.length).trim() : t;
}

/** Smallest azimuth arc that contains every stop, as words: "east-south-east to south, about 40°". */
export function turningRange(azimuths: number[]): { from: string; to: string; span: number } | null {
  if (!azimuths.length) return null;
  const a = azimuths.map((x) => ((x % 360) + 360) % 360).sort((p, q) => p - q);
  let gap = -1, at = 0;
  for (let i = 0; i < a.length; i++) { const g = (a[(i + 1) % a.length] - a[i] + 360) % 360 || (a.length === 1 ? 360 : 0); if (g > gap) { gap = g; at = i; } }
  const start = a[(at + 1) % a.length], end = a[at];
  return { from: COMPASS_WORDS[compassOf(start)], to: COMPASS_WORDS[compassOf(end)], span: Math.round((360 - gap + 360) % 360) };
}

/** Stops grouped under their storyline beat (one group without a header when the journey has no lens storyline). */
export function stopGroups(spine: readonly SpineBeat[], stopCount: number, lensed: boolean): { label: string | null; step: number; stops: number[] }[] {
  if (!lensed || spine.length < 2) return [{ label: null, step: 0, stops: Array.from({ length: stopCount }, (_, i) => i) }];
  return spine.map((b) => ({ label: b.label, step: b.step, stops: b.stops }));
}

/**
 * Journey-level links (Overview story box, Done): "Hop the whole journey" (a chained star hop over every stop),
 * "Add all stops to tonight's plan" (at the journey's times, tagged with their stop numbers) and the one-line Moon
 * check from the engine's own conditions, linking to the Moon tab on the stop that passes closest to the Moon.
 */
export function JourneyPlanActions({ shared, journey }: { shared: JourneysShared; journey: Journey }) {
  const { page, objects, actions } = shared;
  const [added, setAdded] = useState(false);
  const resolved = journey.stops.map((s, i) => ({ r: shared.resolve(objects.get(s.objectId) ?? s.objectId), stop: i + 1, at: journeyStopTime(journey, i + 1) }))
    .filter((x) => !!x.r?.routingId);
  const ids = resolved.map((x) => x.r!.routingId!);
  // "All in" means every stop is in the night with its journey stop and time; stops there but untagged or untimed keep
  // the button enabled, and adding fills them in (night-ops mergeJourneyTag).
  const allIn = added || (ids.length > 0 && ids.every((id, k) => actions.isInNight(id, { journeyKey: journey.key, journeyStop: resolved[k].stop, plannedAt: resolved[k].at })));
  // The journey's own schedule starts at its first stop (the best window can open in twilight, before it).
  const start = new Date(journey.stops[0]?.windowStart ?? journey.bestWindow?.start ?? page.date);
  // Plan for the journey's own time unless it is (about) now: a live sky stays live.
  const planAt = Math.abs(start.getTime() - page.date.getTime()) > 15 * 60_000 ? start : undefined;
  const moon = journeyMoonCheck(journey, page.timezone);
  const moonStop = moon ? [moon.stopIndex, ...journey.stops.map((_, i) => i)].map((i) => resolved.find((x) => x.stop === i + 1)).find(Boolean) : undefined;
  const addAll = () => {
    // Each stop at its own time (plannedAts), so the Planner keeps the journey's order and times as one block.
    actions.addToNight(ids, { at: resolved[0]?.at ?? start, journeyKey: journey.key, journeyStops: resolved.map((x) => x.stop), plannedAts: resolved.map((x) => x.at) });
    setAdded(true);
  };
  return <div className="journey-plan" data-testid="journey-plan-actions">
    <div className="journey-plan-row">
      <button type="button" className="journey-button small quiet" onClick={() => actions.hopChain({ kind: "journey", key: journey.key }, planAt)} disabled={!ids.length} data-testid="journey-hop-all">
        <RouteIcon size={15} aria-hidden="true"/>{LINK_LABELS.hopChain}
      </button>
      <button type="button" className="journey-button small quiet" onClick={addAll} disabled={!ids.length || allIn} aria-pressed={allIn} data-testid="journey-add-all">
        {allIn ? <Check size={15} aria-hidden="true"/> : <Plus size={15} aria-hidden="true"/>}{allIn ? "All stops in tonight's plan" : LINK_LABELS.addAllToNight}
      </button>
    </div>
    {moon && <div className="journey-moon-check" data-testid="journey-moon-check"><Moon size={14} aria-hidden="true"/><span>{moon.text}</span>
      {moonStop && <button type="button" className="journey-link" onClick={() => actions.moon(moonStop.r!.routingId!, moonStop.at)}>{LINK_LABELS.moon}</button>}</div>}
  </div>;
}

export function JourneyOverview({ shared, journey, initialOpen = null }: { shared: JourneysShared; journey: Journey; /** Stop card open on first render (deep links, tests). */ initialOpen?: number | null }) {
  const { page, kb, objects, store } = shared;
  const [highlight, setHighlight] = useState<number | null>(null);
  // Owner feedback r2: every stop card starts collapsed; a click opens it in place (no instructions, no Read mode).
  // Design review r2: one card open at a time (an accordion), so the page never holds two 2000 px cards.
  const [open, setOpen] = useState<number | null>(initialOpen);
  const [chartView, setChartView] = useState<"route" | "sky">("route");
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const active = store.active?.key === journey.key ? store.active : null;
  const resumable = active && !active.completedAt ? active : null;
  const spine = useMemo(() => journeySpine(journey, kb), [journey, kb]);
  const groups = useMemo(() => stopGroups(spine, journey.stops.length, journey.stops.some((s) => s.lens)), [spine, journey]);

  // Only what the observer recorded: stops jumped over (a "Start here" at stop 5) stay neutral, never ticked (r5 UX #10).
  const states = useMemo(() => stopVisitStates(active, journey.stops.length, resumable?.stopIndex ?? null, { currentFirst: false }), [journey, active, resumable]);
  // One name per object on every tab (lib/object-links): the same label as Star hop, the Planner and Tonight.
  const label = useCallback((o: KbObject | undefined, id: string) => (o ? objectName(o, page.targets).label : id), [page.targets]);
  const reveal = useCallback((i: number) => {
    const smooth = typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById(`journey-chapter-${i + 1}`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
  }, []);
  // Arriving with a stop to open (a focus link): open that card and bring it into view (also when the request to open
  // it lands just after the first render).
  useEffect(() => { if (initialOpen !== null) { setOpen(initialOpen); setHighlight(initialOpen); reveal(initialOpen); } }, [initialOpen, reveal]);
  const toggle = useCallback((i: number) => {
    const opening = open !== i;
    setOpen(opening ? i : null);
    if (opening) reveal(i);
  }, [open, reveal]);
  // A stop tapped on the map (or the "Next" button at the end of a card) opens its card and brings it into view.
  const selectStop = useCallback((i: number) => {
    setHighlight(i);
    setOpen(i);
    reveal(i);
  }, [reveal]);
  const overlay = useMemo<JourneyOverlay>(() => ({
    stops: journey.stops.flatMap((stop, i) => {
      const o = objects.get(stop.objectId);
      return o ? [{ ...overlayStop(o, states[i]), label: objectName(o, page.targets).name }] : [];
    }),
    highlight, onStopSelect: selectStop,
    onStopHover: setHighlight, moon: shared.moonRing, minAlt: shared.minAlt, fit: true,
  }), [journey, objects, states, highlight, shared.moonRing, shared.minAlt, selectStop, page.targets]);
  const nodes = useMemo(() => [...shared.skyNodes, ...shared.stopNodes(journey)], [shared, journey]);
  const turn = turningRange(journey.stops.map((s) => s.azAtStart));
  const alts = journey.stops.map((s) => s.altAtStart);
  const highest = journey.stops[alts.indexOf(Math.max(...alts))], lowest = journey.stops[alts.indexOf(Math.min(...alts))];
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied("ok"); } catch { setCopied("fail"); }
  };
  const start = () => shared.startJourney(journey);
  // Phones: the start bar sticks to the bottom only once the story's own Start button has scrolled away, so it
  // never covers the hook or the map on first view.
  const inlineStart = useRef<HTMLDivElement>(null);
  const [inlineGone, setInlineGone] = useState(false);
  useEffect(() => {
    const el = inlineStart.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInlineGone(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const startLabel = resumable ? `Resume at stop ${resumable.stopIndex + 1}` : "Start journey";
  const story = storyProse(journey);
  // Hops, time and effort from Star hop's own legs once the journey's chain is planned, else Star hop's typical estimate
  // (journey-view journeyEffort), so the Overview and the hop chain tell one story (r5 UX #2).
  const effort = useMemo(() => journeyEffort(journey, objects, page.profile.fov, journey.stops.map((_, i) => shared.hopLeg(journey.key, i + 1))), [journey, objects, page.profile.fov, shared]);
  const stats = journeyStats(journey, effort);
  const viewSwitch = <div className="journey-segmented journey-chart-switch" role="group" aria-label="Map view">
          <button type="button" className={chartView === "route" ? "active" : ""} aria-pressed={chartView === "route"} onClick={() => setChartView("route")}><MapIcon size={15} aria-hidden="true"/>Route map</button>
          <button type="button" className={chartView === "sky" ? "active" : ""} aria-pressed={chartView === "sky"} onClick={() => setChartView("sky")}><Orbit size={15} aria-hidden="true"/>Whole sky</button>
        </div>;
  // The Moon has its own line with a "Moon effect" link in the story box (JourneyPlanActions).
  const skyLines = journeyConditionLines(journey, page.timezone, { moon: false });
  const spineAt = highlight ?? resumable?.stopIndex ?? null;
  // The spine ticks only beats whose stops were seen; the highlighted or current stop is "current".
  const spineState = (i: number) => (i === spineAt ? "current" as const : spineStateOf(states[i]));

  const renderStop = (i: number) => {
    const stop = journey.stops[i];
    const o = objects.get(stop.objectId);
    const outcome = active?.outcomes[i]?.outcome;
    const isOpen = open === i;
    const hook = stopHook(journey, i, o);
    const name = label(o, stop.objectId);
    const nextStop = journey.stops[i + 1];
    const nextObj = nextStop ? objects.get(nextStop.objectId) : undefined;
    const nextBeat = nextStop ? spine[spineBeatOf(spine, i + 1)] : undefined;
    const sameBeat = nextBeat && spineBeatOf(spine, i + 1) === spineBeatOf(spine, i);
    const grouped = groups.some((g) => g.label);
    const role = grouped ? stopRoleLine(stop, spine[spineBeatOf(spine, i)]?.label) : stopBeatLabel(stop);
    return <li key={stop.objectId + i} id={`journey-chapter-${i + 1}`} data-testid={`journey-stop-${i + 1}`}
      className={`jstopitem${isOpen ? " is-open" : ""}${highlight === i ? " highlighted" : ""}`}
      onMouseEnter={() => setHighlight(i)} onMouseLeave={() => setHighlight(null)}>
      <button type="button" className="jstopitem-head" aria-expanded={isOpen} aria-controls={`journey-stop-body-${i + 1}`} data-testid="journey-stop-toggle"
        onClick={() => { setHighlight(i); toggle(i); }} onFocus={() => setHighlight(i)}
        aria-label={`Stop ${i + 1}, ${stopBeatLabel(stop)}: ${name}`}>
        <span className={`journey-badge ${outcome === "seen" ? "done" : outcome ? "skipped" : ""}`} aria-hidden="true">{outcome === "seen" ? <Check size={13}/> : i + 1}</span>
        <span className="jstopitem-body">
          {/* Design review r4: the chapter heading above the group is the one gold label; the row names the stop's own
              role only when it adds to the chapter, as a plain subtitle. Time and height keep one fixed right slot. */}
          <span className="jstopitem-meta"><span className="jstopitem-meta-main">{role && <span className={grouped ? "jstopitem-role" : "jstopitem-beat"}>{role}</span>}{stop.challenge && <span className="jstopitem-challenge">◆ challenge</span>}</span>
            <span className="jstopitem-when">{localTime(stop.windowStart, page.timezone)} · {Math.round(stop.altAtStart)}° up</span></span>
          <strong className="jstopitem-name">{name}</strong>
          {o && <span className="jstopitem-kind">{plainClass(o)}</span>}
          {hook && <span className="jstopitem-hook">{hook}</span>}
        </span>
        <ChevronDown className="jstopitem-chevron" size={18} aria-hidden="true"/>
      </button>
      {isOpen && o && <div className="jstopitem-card" id={`journey-stop-body-${i + 1}`}>
        <StopCard object={o} stop={stop} journey={journey} kb={kb} mode="read" fovDeg={page.profile.fov} embedded
          transition={transitionFor(journey, i, i - 1, objects)} trailObjectIds={journey.stops.slice(0, i).map((s) => s.objectId)}
          legReport={shared.hopLeg(journey.key, i + 1)}
          sky={{ targets: page.targets, lat: page.lat, lon: page.lon, timezone: page.timezone, skyBrightness: page.skyBrightness, profile: page.profile, at: new Date(stop.windowStart) }}/>
        {/* The shared object actions close the card, after the story (r5): the hop starts where the card's Get there starts. */}
        <StopActions objectId={o.id} actions={shared.actions} catalog={shared.catalog} journey={{ key: journey.key, stop: i + 1 }} origin="overview" name={name}
          from={getThereFor(journey, i, i - 1, objects, page.profile.fov).startId ?? undefined} at={new Date(stop.windowStart)} plannedAt={journeyStopTime(journey, i + 1)}/>
        {/* Forward pull at the end of the card: close this one, open the next, led by the next stop's question. */}
        {nextStop && <button type="button" className="jstopitem-next" data-testid="journey-stop-next" onClick={() => selectStop(i + 1)}>
          <span className="jstopitem-next-label">Next: {i + 2} · {label(nextObj, nextStop.objectId)}{nextBeat && !sameBeat ? <span className="jstopitem-next-beat"> · {nextBeat.label}</span> : null}</span>
          {stopHook(journey, i + 1, nextObj) && <span className="jstopitem-next-hook">{stopHook(journey, i + 1, nextObj)}</span>}
          <ArrowDown className="jstopitem-next-icon" size={18} aria-hidden="true"/>
        </button>}
      </div>}
    </li>;
  };

  return <section className="journeys journey-overview" aria-labelledby="journey-overview-title" data-testid="journey-overview">
    <div className="journey-overview-bar">
      <button type="button" className="journey-link" onClick={() => shared.go({ view: "discover" })}><ArrowLeft size={15} aria-hidden="true"/>Journeys</button>
      <button type="button" className="journey-button small quiet" onClick={share} aria-live="polite"><Link2 size={14} aria-hidden="true"/>{copied === "ok" ? "Link copied" : copied === "fail" ? "Copy the address bar" : "Share"}</button>
    </div>

    {/* Desktop: title and map on the left, the story column starting level with the title on the right.
        Phones: title → story question (the hook) → map → stops (CSS reorders; see journeys.css). */}
    <div className="journey-overview-layout">
      <header className="journey-overview-head">
        <p className="eyebrow journey-theme-eyebrow">{themeLabel(journey.templateId)}<span aria-hidden="true"> · </span>Sky journey</p>
        <h1 id="journey-overview-title">{journey.title}</h1>
        <p className="journey-lede">{journey.hook}</p>
        <ul className="journey-stats" aria-label="At a glance" data-testid="journey-stats">
          {stats.map((s) => { const Icon = STAT_ICON[s.id]; return <li key={s.id} className={`journey-stat stat-${s.id}`} title={s.title}><Icon size={14} aria-hidden="true"/>{s.label}</li>; })}
        </ul>
      </header>
      <div className="journey-overview-chart" data-testid="journey-path-chart" data-view={chartView}>
        {chartView === "route" ? <JourneyRouteMap shared={shared} journey={journey} states={states} fieldAt={highlight ?? resumable?.stopIndex ?? 0} highlight={highlight}
          onStopSelect={selectStop} onStopHover={setHighlight} leading={viewSwitch}/> : <>
          {viewSwitch}
          <SkyChart nodes={nodes} constellations={page.constellations} route={null} targetNode={null} animStep={0}
            fovWidth={page.profile.fov} fovHeight={page.profile.fov} fovShape="circle" lat={page.lat} lon={page.lon} date={page.date}
            limitingMag={6.5} denseStars={page.denseStars} milkyWay={page.milkyWay} overview isBinocular journey={overlay}/>
          <p className="journey-chart-key"><span className="key-region">dashed outline = the patch of sky</span><span className="key-path">arrows = the order</span>{shared.moonRing && <span className="key-moon">dotted circle = Moon keep-out</span>}<span className="key-alt">dashed ring = {shared.minAlt}° minimum</span></p>
        </>}
      </div>
      <div className="journey-story">
        <section className="journey-story-text" aria-labelledby="journey-question">
          <h2 className="sr-only">The story</h2>
          <p className="journey-question" id="journey-question">{journey.drivingQuestion}</p>
          {story && <p className="journey-story-intro" data-testid="journey-story-intro">{story}</p>}
          <StorySpine beats={spine} current={spineAt} variant="full" stopState={spineState}/>
          <div className="journey-start-inline" ref={inlineStart}>
            <button type="button" className="journey-button primary big" onClick={start} data-testid="journey-start"><Play size={17} aria-hidden="true"/>{startLabel}</button>
          </div>
          <JourneyPlanActions shared={shared} journey={journey}/>
        </section>
        <div className="journey-stops" data-testid="journey-stop-list">
          {groups.map((g, k) => <section key={`${g.step}-${k}`} className={`jstopgroup${g.label ? "" : " jstopgroup-flat"}`} aria-label={g.label ? `${g.label}: stop${g.stops.length > 1 ? "s" : ""} ${g.stops.map((i) => i + 1).join(" and ")}` : "Stops"}>
            {g.label && <h3 className="jstopgroup-head" data-testid="journey-stop-group">{g.label}</h3>}
            <ol className="jstopgroup-list" start={g.stops[0] + 1}>{g.stops.map(renderStop)}</ol>
          </section>)}
        </div>
        <dl className="journey-practical">
          <div><dt>Time</dt><dd>{durationLabel(journey.durationMin)}{journey.bestWindow && ` · best ${localTime(journey.bestWindow.start, page.timezone)}–${localTime(journey.bestWindow.end, page.timezone)}`}</dd></div>
          <div><dt>Where</dt><dd>{regionWords(journey)}{turn && turn.span > 5 ? ` · you'll turn from ${turn.from} to ${turn.to}, about ${turn.span}°` : " · no turning needed"}</dd></div>
          <div><dt>Heights</dt><dd>Highest {label(objects.get(highest.objectId), highest.objectId)} ({Math.round(highest.altAtStart)}°), lowest {label(objects.get(lowest.objectId), lowest.objectId)} ({Math.round(lowest.altAtStart)}°)</dd></div>
          {skyLines.length > 0 && <div data-testid="journey-conditions"><dt>Sky</dt><dd>{skyLines.join(" · ")}</dd></div>}
          <div><dt>Difficulty</dt><dd>{DIFFICULTY_LABELS[journey.difficulty]} — {journey.difficultyReason ?? DIFFICULTY_HELP[journey.difficulty]}</dd></div>
          <div><dt>Helps</dt><dd>20 minutes outside for dark adaptation, a chair or steady stance, and red light on.</dd></div>
        </dl>
      </div>
    </div>

    {/* Phones: a sticky start bar (the overview reserves its height at the bottom, so it never hides the last row). */}
    <div className="journey-sticky-actions" data-shown={inlineGone ? "true" : "false"}>
      <button type="button" className="journey-button primary big" onClick={start} data-testid="journey-start"><Play size={17} aria-hidden="true"/>{startLabel}</button>
    </div>
  </section>;
}

/** The collapsed row's hook: the stop's lens question, else the card question, else its why-here line. */
function stopHook(journey: Journey, i: number, o: { card: { question?: string; whyHere: string } } | undefined): string {
  const stop = journey.stops[i];
  return stop.lens?.question || o?.card.question || chapterLine(stop.whyHereText ?? o?.card.whyHere ?? "", journey.drivingQuestion);
}
