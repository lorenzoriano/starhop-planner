/**
 * Bar at the top of Star hop while a chain is active (integration r5, WS-B; r5 fix 1): "<title> · stop 3 of 5 · Leg 3:
 * Pleiades → Hyades · 2 hops", stop checkpoints (chain.stopHopIndex; a click opens that stop's first field), Previous
 * stop / Next stop, "I see <stop>" at a checkpoint, and at the journey's last stop "Journey complete" (the journey's
 * summary). Exits: "Back to journey" and one ×. Hop counts use the shared wording (lib/hop-chain hopCountLabel via
 * legDifficulty), the same words as the journey's stop cards.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Eye, Flag, Waypoints, X } from "lucide-react";
import { formatRouteNodeName } from "@/lib/astronomy";
import { legChip, legDifficulty, legLine, legStartHops, stopAtStep } from "@/lib/hop-chain";
import { LINK_LABELS, type ChainStop, type JourneyRef, type ObjectActions, type ObjectCatalog } from "@/lib/object-links";
import { chainStopFor, type HopChainState } from "./useHopChain";
import "./HopChainBar.css";

export interface HopChainBarProps {
  chain: HopChainState;
  /** Current field index in the combined route (planner `step`). */
  step: number;
  /** Jump to a field (a stop checkpoint). */
  onStep: (step: number) => void;
  actions: ObjectActions;
  /**
   * "I see <stop>": for a journey chain the planner records the journey outcome and the Planner log together
   * (progress.recordStopSeen); without it (or outside a journey) the bar logs with actions.markObserved.
   */
  onSeen?: (stop: ChainStop, journey: JourneyRef | null) => void;
  /** A single hop opened from a journey stop (`#/hop/<id>?journey=KEY&stop=N[&from=overview]`): shows the journey strip when no chain is active. */
  journey?: JourneyRef | null;
  /** Catalogs for the strip's next-stop name. */
  catalog?: ObjectCatalog;
  /** The strip's ×: leave the journey context and keep this hop (the planner drops the query from the URL). */
  onLeaveJourney?: () => void;
}

/**
 * "<title> · Stop 4 of 5 · Back to journey · × · Next stop: Mirfak · Hop the whole journey" above a single hop that was
 * opened from a journey stop. The journey comes from the device journey store (a dynamic import: the store is not in
 * the main bundle).
 */
function JourneyHopStrip({ journey: ref, actions, catalog, onLeave }: { journey: JourneyRef; actions: ObjectActions; catalog?: ObjectCatalog; onLeave?: () => void }) {
  const [info, setInfo] = useState<{ title: string; ids: string[] } | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    void import("@/lib/journeys/progress").then(({ findStoredJourney, readJourneyStore }) => {
      const j = findStoredJourney(readJourneyStore(), ref.key);
      if (cancelled) return;
      setInfo(j ? { title: j.title, ids: j.stops.map((s) => s.objectId) } : null);
      setMissing(!j);
    }, () => {});
    return () => { cancelled = true; };
  }, [ref.key]);
  // A journey no longer on this device (an old link, a journey from before a KB rebuild): leave its context and keep
  // the plain hop, rather than offer "Back to journey" into nothing.
  useEffect(() => { if (missing) onLeave?.(); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (missing) return null;
  const nextId = info?.ids[ref.stop], here = info?.ids[ref.stop - 1];
  const nextName = nextId ? (catalog ? chainStopFor(nextId, catalog).label : nextId) : null;
  const last = !!info && ref.stop >= info.ids.length;
  return <section className="hop-chain-bar hop-journey-strip" aria-label="Journey" data-testid="hop-journey-strip">
    <div className="hop-chain-head">
      <strong className="hop-chain-name"><Waypoints size={15} aria-hidden="true"/> {info?.title ?? "Sky journey"}</strong>
      <p className="hop-chain-summary">{info && <span className="hop-chain-count">Stop {ref.stop} of {info.ids.length}</span>}</p>
      <div className="hop-chain-actions">
        <button type="button" className="text-action hop-chain-back" data-testid="hop-journey-back" onClick={() => actions.journey({ key: ref.key, stop: ref.stop, ...(ref.from ? { from: ref.from } : {}) })}><ArrowLeft size={14}/>{LINK_LABELS.backToJourney}</button>
        {onLeave && <button type="button" className="icon-button hop-chain-exit" aria-label="Leave the journey (keep this hop)" title="Leave the journey (keep this hop)" onClick={onLeave}><X size={15}/></button>}
      </div>
    </div>
    <div className="hop-chain-row">
      <div className="hop-chain-nav">
        {nextId && <button type="button" className="text-action" data-testid="hop-journey-next" onClick={() => actions.hop(nextId, { from: here, journey: { key: ref.key, stop: ref.stop + 1, ...(ref.from ? { from: ref.from } : {}) } })}>{LINK_LABELS.nextStop}: {nextName}<ChevronRight size={14}/></button>}
        {/* "Journey complete" opens the journey's summary through the shared actions, like every journey link. */}
        {last && <button type="button" className="text-action hop-chain-done" onClick={() => actions.journey({ key: ref.key, done: true })} data-testid="hop-journey-done"><Flag size={14}/>{LINK_LABELS.journeyComplete}</button>}
        <button type="button" className="text-action" data-testid="hop-journey-chain" onClick={() => actions.hopChain({ kind: "journey", key: ref.key })}>{LINK_LABELS.hopChain}<ChevronRight size={14}/></button>
      </div>
    </div>
  </section>;
}

export function HopChainBar({ chain: state, step, onStep, actions, onSeen, journey, catalog, onLeaveJourney }: HopChainBarProps) {
  const { source, chain, title, noun } = state;
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSeen(new Set()), [source]);
  // `&leg=N` in the URL opens that leg once the chain is planned.
  useEffect(() => {
    if (!chain || !state.focusLeg) return;
    const start = legStartHops(chain)[state.focusLeg - 1];
    if (start !== undefined && start >= 0) onStep(start);
    state.consumeFocusLeg();
  }, [chain, state.focusLeg]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) return journey ? <JourneyHopStrip journey={journey} actions={actions} catalog={catalog} onLeave={onLeaveJourney}/> : null;
  const journeyKey = source.kind === "journey" ? source.key : null;
  const heading = title ?? (source.kind === "night" ? "Tonight's plan" : "Hop sequence");
  const back = (stop?: number) => journeyKey && <button type="button" className="text-action hop-chain-back" onClick={() => actions.journey({ key: journeyKey, ...(stop ? { stop } : {}) })}><ArrowLeft size={14}/>{LINK_LABELS.backToJourney}</button>;
  const exit = <button type="button" className="icon-button hop-chain-exit" aria-label="Leave this hop sequence" title="Leave this hop sequence" data-testid="button-leave-chain" onClick={state.clear}><X size={15}/></button>;

  if (!chain) {
    return <section className="hop-chain-bar" aria-label="Hop sequence" aria-live="polite" data-state={state.error ? "error" : "planning"}>
      <div className="hop-chain-head">
        <strong className="hop-chain-name">{heading}</strong>
        <p className="hop-chain-summary"><span>{state.error ?? (state.progress ? `Planning the star hops · leg ${Math.min(state.progress.done + 1, state.progress.total)} of ${state.progress.total}…` : "Planning the star hops…")}</span></p>
        <div className="hop-chain-actions">{back()}{exit}</div>
      </div>
    </section>;
  }

  const current = Math.max(0, stopAtStep(chain, step)), starts = legStartHops(chain);
  const stop = chain.stops[current], leg = chain.legs[current], n = stop?.stop ?? current + 1, of = Math.max(state.stopTotal, n);
  const reachedBefore = chain.stopHopIndex.slice(0, current).map((hop, i) => (hop >= 0 ? i : -1)).filter((i) => i >= 0);
  const fromLabel = reachedBefore.length ? chain.stops[reachedBefore.at(-1)!].label : chain.route ? formatRouteNodeName(chain.route.startAnchor) : "a bright star";
  const atCheckpoint = chain.stopHopIndex[current] === step;
  const chip = leg ? legChip(leg) : null;
  const prev = reachedBefore.at(-1), next = chain.stopHopIndex.findIndex((hop, i) => i > current && hop >= 0);
  const missed = chain.stops.map((s, i) => ({ s, i, leg: chain.legs[i] })).filter(({ i }) => chain.stopHopIndex[i] < 0);
  const seenHere = !!stop && seen.has(stop.id);
  const Noun = noun === "stop" ? "Stop" : "Target";
  // The journey's end: no stop after this one (the whole journey, not a part of it).
  const journeyEnds = !!journeyKey && next < 0 && n >= of;

  return <section className="hop-chain-bar" aria-label={`${heading}: hop sequence`} data-state={state.planning ? "replanning" : "ready"} data-testid="hop-chain-bar">
    <div className="hop-chain-head">
      <strong className="hop-chain-name">{journeyKey && <Waypoints size={15} aria-hidden="true"/>} {heading}</strong>
      <p className="hop-chain-summary">
        <span className="hop-chain-count">{Noun} {n} of {of}</span>
        {leg && stop && <span className="hop-chain-leg">{legLine(leg, stop, fromLabel)}</span>}
        {chip && <span className="hop-chain-difficulty" data-level={chip.level}>{chip.label}</span>}
      </p>
      <div className="hop-chain-actions">{back(n)}{exit}</div>
    </div>
    {/* Only a jump the chain had to add (too far to hop) explains itself; a journey's own naked-eye step is in the chip. */}
    {leg?.status === "jump" && leg.note && <p className="hop-chain-note" data-kind="jump"><strong>Needs a naked-eye jump:</strong> {leg.note.replace(/^Needs a naked-eye jump: /, "")}</p>}
    {leg?.note && leg.status === "ok" && <p className="hop-chain-note">{leg.note}</p>}
    {missed.length > 0 && <p className="hop-chain-note" data-kind="missed">
      Not hopped: {missed.map(({ s, i, leg: l }) => `${s.stop ?? i + 1} · ${s.label}${l ? ` (${l.note ?? legDifficulty(l).label})` : ""}`).join("; ")}
    </p>}
    <div className="hop-chain-row">
      <ol className="hop-chain-stops" aria-label={`${heading}: ${noun}s`}>
        {chain.stops.map((s, i) => {
          const reached = chain.stopHopIndex[i] >= 0, d = chain.legs[i] ? legDifficulty(chain.legs[i]) : null;
          const label = `${Noun} ${s.stop ?? i + 1}: ${s.label}${d ? ` · ${d.label}` : ""}${!reached && chain.legs[i]?.note ? ` · ${chain.legs[i].note}` : ""}`;
          return <li key={`${s.id}-${i}`}>
            <button type="button" className="hop-chain-stop" disabled={!reached} aria-current={i === current ? "step" : undefined} title={label} aria-label={label}
              data-state={!reached ? "missed" : i === current ? "current" : i < current ? "done" : "todo"} data-level={d?.level} onClick={() => reached && onStep(starts[i])}>
              <span className="hop-chain-stop-number">{seen.has(s.id) ? <Check size={12}/> : s.stop ?? i + 1}</span>
              <span className="hop-chain-stop-label">{s.label}</span>
            </button>
          </li>;
        })}
      </ol>
      <div className="hop-chain-nav">
        <button type="button" className="text-action" disabled={prev === undefined} onClick={() => prev !== undefined && onStep(starts[prev])}><ChevronLeft size={14}/>Previous {noun}</button>
        {atCheckpoint && stop && <button type="button" className="hop-chain-seen" data-seen={seenHere || undefined}
          onClick={() => { const ref = journeyKey && stop.stop ? { key: journeyKey, stop: stop.stop } : null; if (onSeen) onSeen(stop, ref); else actions.markObserved(stop.id); setSeen((s) => new Set(s).add(stop.id)); }}>
          {seenHere ? <Check size={14}/> : <Eye size={14}/>}<span>{seenHere ? `Seen: ${stop.label}` : `I see ${stop.label}`}</span>
        </button>}
        {journeyEnds
          ? <button type="button" className="text-action hop-chain-done" onClick={() => actions.journey({ key: journeyKey!, done: true })} data-testid="hop-chain-done" data-ready={seenHere || undefined}><Flag size={14}/>{LINK_LABELS.journeyComplete}<ChevronRight size={14}/></button>
          : <button type="button" className="text-action" disabled={next < 0} onClick={() => next >= 0 && onStep(starts[next])}>{noun === "stop" ? LINK_LABELS.nextStop : "Next target"}<ChevronRight size={14}/></button>}
      </div>
    </div>
  </section>;
}
