/** Screen A — Discovery (doc 06 §4): conditions strip + limiter, controls, 3 suggestions, show more, Shuffle. */
import { MIN_ALT } from "@/lib/sky-feasibility";
import { useMemo } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AlertTriangle, Binoculars, Moon, Play, Shuffle, SlidersHorizontal, Sun, X } from "lucide-react";
import { rememberJourney } from "@/lib/journeys/progress";
import { moonIllumination } from "@/lib/moon";
import type { JourneyResult } from "@/lib/journeys/types";
import type { DiscoveryControls, JourneysShared } from "./JourneysPage";
import { JourneyCard } from "./JourneyCard";
import { conditionNotes, emptyState, nightEvents, type ConditionAction, type ConditionNote } from "./conditions-explainer";
import { COMPASS8, COMPASS_WORDS, LENGTHS, localTime, terrainDirections, terrainHint, themeOptions, type LengthChoice } from "./journey-view";

interface Props {
  shared: JourneysShared;
  controls: DiscoveryControls;
  setControls: (patch: Partial<DiscoveryControls>) => void;
  result: JourneyResult | null;
  /** A previous result is on screen while the next one is computed. */
  stale: boolean;
  error: string | null;
  onRetry: () => void;
  /**
   * Journeys filtered to one object ("Find a journey with this"). matched=false: none of tonight's journeys visits it.
   * `at`: the request was planned for the coming dark (it is not dark yet), null = now.
   */
  focus?: { name: string; matched: boolean; clear: () => void; at?: Date | null } | null;
}

export function JourneyDiscovery({ shared, controls, setControls, result, stale, error, onRetry, focus }: Props) {
  const { page, kb, objects, store } = shared;
  const { date, timezone, lat, lon, moon, sunAlt } = page;
  const events = useMemo(() => nightEvents(lat, lon, date, timezone), [lat, lon, date, timezone]);
  // Hills from the site's terrain: the hint by the direction boxes, and whether the open directions are still that default.
  const terrain = useMemo(() => terrainDirections(shared.horizon, controls.minAlt), [shared.horizon, controls.minAlt]);
  const openSkyFromTerrain = !!terrain.open && terrain.open.length === controls.openDirections.length && terrain.open.every((d) => controls.openDirections.includes(d));
  const notes = useMemo(() => conditionNotes({ date, timezone, sunAlt, moon, events, minAlt: controls.minAlt, openDirections: controls.openDirections, openSkyFromTerrain, theme: controls.theme, result }),
    [date, timezone, sunAlt, moon, events, controls.minAlt, controls.openDirections, openSkyFromTerrain, controls.theme, result]);
  const themes = useMemo(() => themeOptions(kb.templates), [kb.templates]);
  const journeys = result?.journeys ?? [];
  const active = store.active && !store.active.completedAt ? store.active : null;

  const act = (action: ConditionAction) => {
    switch (action.id) {
      case "moon-friendly": setControls({ theme: "A12-moonlit" }); break;
      case "twilight-journey": setControls({ theme: "A2-thermometer" }); break;
      case "moon-tab": page.onMoonTab(); break;
      case "lower-alt": setControls({ minAlt: 20 }); break;
      case "open-sky": setControls({ openDirections: COMPASS8 }); break;
      case "surprise": setControls({ theme: null }); break;
      default: if (action.at) page.onTime(action.at);
    }
  };
  const setWhen = (value: string) => {
    if (!/^\d\d:\d\d$/.test(value)) return;
    const today = formatInTimeZone(date, timezone, "yyyy-MM-dd");
    let at = fromZonedTime(`${today}T${value}:00`, timezone);
    // Times after midnight belong to the same observing night.
    if (Number(value.slice(0, 2)) < 12 && Number(formatInTimeZone(date, timezone, "HH")) >= 12) at = new Date(at.getTime() + 86_400_000);
    page.onTime(at);
  };
  const toggleDirection = (d: (typeof COMPASS8)[number]) => {
    const set = new Set(controls.openDirections);
    if (set.has(d)) { if (set.size === 1) return; set.delete(d); } else set.add(d);
    setControls({ openDirections: COMPASS8.filter((x) => set.has(x)) });
  };
  const darkText = sunAlt < -18 ? (events.astroDawn ? `Dark until ${localTime(events.astroDawn, timezone)}` : "Dark") : events.astroDusk ? `Dark from ${localTime(events.astroDusk, timezone)}` : sunAlt > -0.8 ? "Daylight" : "Twilight";
  // In daylight "up" or "down" says nothing about the night ahead: the phase alone.
  // The one illumination figure every tab shows for this instant (lib/moon moonIllumination).
  const moonPct = moonIllumination(date).percent;
  const moonText = sunAlt > -0.8 ? `Moon ${moonPct}% lit` : moon.alt > 0 ? `Moon ${moonPct}% · up` : `Moon ${moonPct}% · down`;
  const empty = result && !journeys.length ? emptyState(notes, { date, timezone, theme: controls.theme, result }) : null;
  // One message for a focus that no journey passes through (r5 UX #4): in the empty state's heading when nothing fits
  // at all, else one banner over tonight's list; never both.
  const focusMiss = focus && !focus.matched ? focus : null;
  const focusAtText = focus?.at ? localTime(focus.at, timezone) : null;
  // Half-hour start times for the observing night, in the app's 24-hour format (a native time input showed
  // "08:30 PM" beside the time bar's 20:30).
  const startTimes = useMemo(() => startTimeOptions(formatInTimeZone(date, timezone, "HH:mm")), [date, timezone]);

  return <section className="journeys journey-discovery" aria-labelledby="journeys-title">
    <header className="journey-head">
      <div>
        <p className="eyebrow">SKY JOURNEYS</p>
        <h1 id="journeys-title">Where will the sky take you<span>?</span></h1>
        <p className="journey-lede">Short guided binocular tours: what to look at, what you'll really see, and why it matters.</p>
      </div>
      {/* The time bar above already names the date, time and place; the card keeps what it adds. */}
      <div className="journey-conditions-strip" aria-label="Tonight's conditions">
        <p><span className="cond">{sunAlt < -18 ? <Moon size={13} aria-hidden="true"/> : <Sun size={13} aria-hidden="true"/>}{darkText}</span><span className="cond"><Moon size={13} aria-hidden="true"/>{moonText}</span></p>
        <p><span className="cond"><Binoculars size={13} aria-hidden="true"/>{page.profile.magnification}×{page.profile.aperture} · {page.profile.fov.toFixed(1)}° field</span><span className="cond">{page.offlineLabel}</span></p>
        {/* The footer of the conditions card: how these conditions shape the journeys. */}
        <details className="journey-limits-help">
          <summary>How journeys respect the sky</summary>
          <ul>
            <li><strong>Altitude.</strong> Every stop stays at least {controls.minAlt}° above the horizon for its whole visit; low objects shine through thick, murky air.</li>
            <li><strong>Darkness.</strong> Clusters, nebulae and galaxies wait for full darkness (Sun 18° below the horizon); bright stars and doubles are fine in late twilight.</li>
            <li><strong>Moon.</strong> When the Moon is up, stops keep a distance from it that grows with its phase, and faint glows are dropped when moonlight would drown them.</li>
            <li><strong>One patch of sky.</strong> Stops sit close together, so you turn your body once at most.</li>
          </ul>
        </details>
      </div>
    </header>

    {/* When nothing fits, the reasons are said once, in the empty-state box below, not twice. */}
    {notes.length > 0 && !empty && !(focusMiss && focus?.at) && <ConditionsPanel notes={notes} onAction={act}/>}

    <div className="journey-controls">
      <div className="journey-theme-chips" role="radiogroup" aria-label="Theme" data-testid="journeys-theme-chips">
        {themes.map((t) => <button key={t.id ?? "surprise"} type="button" role="radio" aria-checked={controls.theme === t.id} className={controls.theme === t.id ? "active" : ""} title={t.description || undefined} data-testid={`journeys-theme-${t.id ?? "surprise"}`} onClick={() => setControls({ theme: t.id })}>{t.label}</button>)}
      </div>
      <div className="journey-control-row">
        <div className="journey-segmented" role="radiogroup" aria-label="Length">
          {(Object.keys(LENGTHS) as LengthChoice[]).map((k) => <button key={k} type="button" role="radio" aria-checked={controls.length === k} className={controls.length === k ? "active" : ""} title={LENGTHS[k].detail} onClick={() => setControls({ length: k })}>{LENGTHS[k].label}</button>)}
        </div>
        <div className="journey-when">
          <button type="button" className={page.live ? "active" : ""} aria-pressed={page.live} onClick={page.onLive}>Now</button>
          <label><span>Start at</span><select aria-label="Start time" value={startTimes.value} onChange={(e) => setWhen(e.target.value)}>
            {startTimes.options.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></label>
        </div>
      </div>
      <details className="journey-more-options">
        <summary><SlidersHorizontal size={14} aria-hidden="true"/>More options · open sky, altitude</summary>
        <fieldset className="journey-compass">
          <legend>I can see toward</legend>
          {COMPASS8.map((d) => <label key={d} className={controls.openDirections.includes(d) ? "on" : ""}><input type="checkbox" checked={controls.openDirections.includes(d)} onChange={() => toggleDirection(d)} aria-label={`Open sky to the ${COMPASS_WORDS[d]}`}/>{d}</label>)}
        </fieldset>
        {terrain.blocked.length > 0 && <p className="journey-compass-hint" data-testid="journeys-terrain-hint">{terrainHint(terrain.blocked)}</p>}
        <div className="journey-control-row">
          <label className="journey-select">Lowest stop<select value={controls.minAlt} onChange={(e) => setControls({ minAlt: Number(e.target.value) })} aria-label="Minimum altitude">{[20, 25, 30, 35, 40].map((a) => <option key={a} value={a}>{a}° above the horizon{a === MIN_ALT.comfortable ? " (default)" : ""}</option>)}</select></label>
          <label className="journey-check"><input type="checkbox" checked={controls.includeChallenge} onChange={(e) => setControls({ includeChallenge: e.target.checked })}/>Allow one challenge object</label>
        </div>
      </details>
    </div>

    {active && <div className="journey-resume" role="status">
      <p><strong>{active.journey.title}</strong> · stop {active.stopIndex + 1} of {active.journey.stops.length}</p>
      <button type="button" className="journey-button primary" onClick={() => shared.go({ view: "stop", key: active.key, stop: active.stopIndex + 1 })}><Play size={15} aria-hidden="true"/>Resume</button>
    </div>}

    {focus && !(focusMiss && empty) && <div className="journey-focus" role="status" data-testid="journeys-focus">
      <p>{focus.matched ? <>Showing journeys through <strong>{focus.name}</strong>.</>
        : <>{focusAtText ? `When it gets dark at ${focusAtText}, no journey` : "No journey tonight"} passes through <strong>{focus.name}</strong>. These are tonight's journeys.</>}</p>
      <button type="button" className="journey-button small" onClick={focus.clear}><X size={14} aria-hidden="true"/>{focus.matched ? "Show all" : "Close"}</button>
    </div>}

    {error && <div className="journey-note warning" role="alert"><AlertTriangle size={15} aria-hidden="true"/><span>{error}</span><button type="button" className="journey-button" onClick={onRetry}>Try again</button></div>}

    <div className="journey-results" aria-busy={!result} aria-live="polite">
      {!result && !error && <div className="journey-skeletons">{[0, 1, 2].map((i) => <div key={i} className="journey-card skeleton" aria-hidden="true"/>)}<span className="sr-only">Planning journeys for your sky…</span></div>}
      {empty && <div className="journey-empty" data-testid="journeys-empty">
        <h2>{focusMiss ? <>No journey through {focusMiss.name} fits right now.</> : "No journey fits right now."}</h2>
        {/* The conditions panel steps aside here, so each reason keeps its one-line explanation. */}
        <ul>{empty.reasons.map((r) => { const note = notes.find((n) => n.title === r); return <li key={r}>{note ? <><strong>{r}.</strong> {note.body}</> : r}</li>; })}</ul>
        <p>Try:</p>
        <div className="journey-actions-row">{empty.actions.map((a) => <button key={a.id + a.label} type="button" className="journey-button" onClick={() => act(a)}>{a.label}</button>)}</div>
      </div>}
      {journeys.length > 0 && <div className={`journey-grid ${stale ? "stale" : ""}`}>
        {journeys.map((j) => <JourneyCard key={j.key} journey={j} objects={objects} kb={kb} targets={page.targets} now={date} timezone={timezone} minAlt={controls.minAlt}
          resumeStop={active?.key === j.key ? active.stopIndex + 1 : undefined}
          onStart={() => shared.startJourney(j)}
          onPreview={() => { shared.updateStore((s) => rememberJourney(s, j, page.live)); shared.go({ view: "overview", key: j.key }); }}/>)}
      </div>}
      {journeys.length > 0 && <div className="journey-more-row">
        {!controls.showMore && <button type="button" className="journey-button" onClick={() => setControls({ showMore: true })} data-testid="journeys-show-more">Show 3 more</button>}
        <button type="button" className="journey-button" onClick={() => setControls({ shuffle: controls.shuffle + 1 })} data-testid="journeys-shuffle"><Shuffle size={15} aria-hidden="true"/>Shuffle</button>
      </div>}
      {result && journeys.length > 0 && <p className="journey-footnote">{result.diagnostics.message}</p>}
    </div>
  </section>;
}

/**
 * Start-time choices for "Start at": every half hour from 16:00 to 08:00 (the observing night, 24-hour clock), plus
 * the current time when it falls between them, so the select always shows the instant being viewed.
 */
export function startTimeOptions(current: string): { value: string; options: string[] } {
  const options: string[] = [];
  for (let m = 16 * 60; m <= 32 * 60; m += 30) { const h = Math.floor(m / 60) % 24; options.push(`${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); }
  if (/^\d\d:\d\d$/.test(current) && !options.includes(current)) {
    const key = (t: string) => { const [h, mm] = t.split(":").map(Number); return ((h < 12 ? h + 24 : h) * 60) + mm; };
    options.push(current);
    options.sort((a, b) => key(a) - key(b));
  }
  return { value: current, options };
}

export function ConditionsPanel({ notes, onAction }: { notes: ConditionNote[]; onAction: (a: ConditionAction) => void }) {
  return <div className="journey-limiters" data-testid="journeys-conditions">
    {notes.map((n) => <section key={n.code} className={`journey-limiter limiter-${n.code}`} aria-label={n.title}>
      <h2>{n.code === "moon" ? <Moon size={15} aria-hidden="true"/> : n.code === "day" || n.code === "twilight" ? <Sun size={15} aria-hidden="true"/> : <AlertTriangle size={15} aria-hidden="true"/>}{n.title}</h2>
      <p>{n.body}</p>
      <div className="journey-actions-row">{n.actions.map((a) => <button key={a.id + a.label} type="button" className="journey-button small" onClick={() => onAction(a)}>{a.label}</button>)}</div>
    </section>)}
  </div>;
}
