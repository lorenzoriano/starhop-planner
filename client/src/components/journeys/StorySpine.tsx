/**
 * Storyline spine (owner feedback r2: "a journey must be a story"): the beats of THIS journey in order, so the reader
 * always sees where the thread has been and where it goes next.
 * - "full" (overview, done screen): every beat named, in a wrapping row joined by a thin line.
 * - "compact" (top of each stop card): one dot per stop grouped by beat, plus "next: …" for the pull forward.
 * States are told by fill and size and by text, never by hue alone (red light).
 */
import type { SpineBeat } from "./journey-view";
import { spineBeatOf } from "./journey-view";
import "./StorySpine.css";

export type SpineStopState = "past" | "current" | "future";

export interface StorySpineProps {
  beats: SpineBeat[];
  /** Stop index the reader is on (card) or that is highlighted (overview); null = none. */
  current?: number | null;
  variant: "full" | "compact";
  /** Total stops (compact caption). Defaults to the stops the beats cover. */
  totalStops?: number;
  /** Optional per-stop state (done screen: seen stops count as past). */
  stopState?: (index: number) => SpineStopState | null;
  /** Compact only: draw the dot track (false in field mode, where the numbered stepper already shows progress). */
  dots?: boolean;
}

const range = (stops: number[]) => (stops.length === 1 ? `${stops[0] + 1}` : `${stops[0] + 1}–${stops[stops.length - 1] + 1}`);

export function StorySpine({ beats, current = null, variant, totalStops, stopState, dots = true }: StorySpineProps) {
  if (beats.length < 2) return null;
  const at = current === null ? -1 : spineBeatOf(beats, current);
  const stateOf = (i: number): SpineStopState => stopState?.(i) ?? (current === null ? "future" : i < current ? "past" : i === current ? "current" : "future");

  if (variant === "compact") {
    const total = totalStops ?? beats.reduce((n, b) => n + b.stops.length, 0);
    const next = at >= 0 ? beats[at + 1] : undefined;
    if (!dots && !next && at !== beats.length - 1) return null;
    return <div className={`jspine jspine-compact${dots ? "" : " jspine-nodots"}`} data-testid="journey-spine" role="group"
      aria-label={`Storyline: ${beats.map((b) => b.label).join(", then ")}`}>
      {dots && <ol className="jspine-track" aria-hidden="true">
        {beats.map((b, k) => <li key={`${b.step}-${k}`} className={`jspine-seg${k === at ? " is-current" : k < at ? " is-past" : ""}`}>
          {b.stops.map((i) => <span key={i} className={`jspine-dot dot-${stateOf(i)}`}/>)}
        </li>)}
      </ol>}
      <p className="jspine-caption">
        {dots && current !== null && <span className="jspine-count">Stop {current + 1} of {total}</span>}
        {dots && (next || at === beats.length - 1) && <span aria-hidden="true"> · </span>}
        {next ? <span className="jspine-next">{dots ? "next" : "Next in the story"}: {next.label}</span> : at === beats.length - 1 ? <span className="jspine-next">{dots ? "the last chapter" : "The last chapter of the story"}</span> : null}
      </p>
    </div>;
  }

  return <ol className="jspine jspine-full" data-testid="journey-spine" aria-label="Storyline">
    {beats.map((b, k) => {
      const states = b.stops.map(stateOf);
      const state = states.includes("current") ? "current" : states.every((s) => s === "past") ? "past" : "future";
      return <li key={`${b.step}-${k}`} className={`jspine-beat beat-${state}`} aria-current={state === "current" ? "step" : undefined}>
        <span className="jspine-num" aria-label={b.stops.length > 1 ? `Stops ${range(b.stops)}` : `Stop ${range(b.stops)}`}>{state === "past" ? "✓" : range(b.stops)}</span>
        <span className="jspine-label">{b.label}</span>
      </li>;
    })}
  </ol>;
}
