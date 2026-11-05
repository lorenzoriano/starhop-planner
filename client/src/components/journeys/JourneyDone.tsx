/**
 * Journey summary (doc 06 §6.9): a headline in the story's own terms, the journey's question and its answer as one
 * frame, the stops you saw grouped under the storyline's beats, and an optional 1-tap rating stored on this device.
 * Desktop adds the route map with every seen stop ticked: the recap of where your eye went.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleHelp, Meh, Minus, Smile, Sparkles } from "lucide-react";
import { journeyRating, journeyStopTime, rateJourney, SKIP_REASON_LABELS } from "@/lib/journeys/progress";
import type { Journey } from "@/lib/journeys/types";
import { objectName } from "@/lib/object-links";
import type { JourneysShared } from "./JourneysPage";
import { JourneyRouteMap } from "./JourneyRouteMap";
import { JourneyPlanActions } from "./JourneyOverview";
import { StopActions } from "./StopActions";
import { doneHeadline, getThereFor, journeySpine, journeyStory, seenCountLine, stopBeatLabel, stopRoleLine, themeLabel } from "./journey-view";

/** Text chips with line icons (no emoji: they turn into red blobs in red-light mode). */
const RATINGS = [{ value: 1, Icon: Meh, label: "Meh" }, { value: 2, Icon: Smile, label: "Good" }, { value: 3, Icon: Sparkles, label: "Wow" }] as const;

const WIDE = "(min-width: 1101px)";
/** True on wide screens, where the done screen has room for the recap map beside the text. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

export function JourneyDone({ shared, journey }: { shared: JourneysShared; journey: Journey }) {
  const { kb, objects, store, feedback } = shared;
  const progress = store.active?.key === journey.key ? store.active : null;
  const outcomes = journey.stops.map((_, i) => progress?.outcomes[i]?.outcome ?? null);
  const seen = outcomes.flatMap((o, i) => (o === "seen" ? [i] : []));
  const { headline, detail } = doneHeadline(journey, seen, objects, kb);
  const rating = journeyRating(feedback, journey.key) ?? progress?.rating;
  const payoff = journeyStory(journey).payoff;
  const spine = useMemo(() => journeySpine(journey, kb), [journey, kb]);
  // The thread at a glance: seen stops under their beats (one flat list when the journey has no lens storyline).
  const groups = spine.length >= 2 && journey.stops.some((s) => s.lens) ? spine : [{ step: 0, label: "", stops: journey.stops.map((_, i) => i) }];
  const states = journey.stops.map((_, i) => (outcomes[i] === "seen" ? "done" as const : outcomes[i] ? "skipped" as const : "todo" as const));
  const wide = useWide();
  // One stop's shared actions open under its row (a skipped stop: add it to tonight's plan, hop to it, see it in the Catalog).
  const [actionsAt, setActionsAt] = useState<number | null>(null);
  const rate = (value: 1 | 2 | 3) => {
    shared.updateFeedback((s) => rateJourney(s, journey.key, journey.templateId, value));
    shared.updateStore((s) => (s.active?.key === journey.key ? { ...s, active: { ...s.active, rating: value } } : s));
  };
  return <section className="journeys journey-done" aria-labelledby="journey-done-title" data-testid="journey-done">
    <div className="journey-done-main">
      <p className="eyebrow journey-theme-eyebrow">Journey complete · {themeLabel(journey.templateId)}</p>
      <h1 id="journey-done-title" data-testid="journey-done-headline">{headline}<span>.</span></h1>
      <p className="journey-lede">{journey.title} · {seenCountLine(seen.length, journey.stops.length)}{detail ? `; ${detail}` : ""}.</p>
      {/* Owner feedback r2: the conclusion carries no label ("Where it lands" is gone). The journey's question sits in
          the same gold box as a card's question, so the whole night reads as one question and its answer. */}
      {payoff && journey.drivingQuestion && !journey.switch && <div className="journey-done-question" data-testid="journey-done-question">
        <span className="journey-done-question-icon" aria-hidden="true"><CircleHelp size={20}/></span>
        <p>{journey.drivingQuestion}</p>
      </div>}
      {payoff && <section className="journey-conclusion" data-testid="journey-payoff" aria-label="The journey’s conclusion">
        <span className="journey-conclusion-mark" aria-hidden="true">✦</span>
        <p className="journey-conclusion-text">{payoff}</p>
      </section>}
      <div className="journey-recap" data-testid="journey-recap" aria-label="Your journey">
        {groups.map((g, k) => {
          const allSeen = g.stops.every((i) => outcomes[i] === "seen");
          return <section key={`${g.step}-${k}`} className={`journey-recap-group${g.label ? "" : " flat"}${allSeen ? " all-seen" : ""}`} aria-label={g.label || "Stops"}>
            {g.label && <h2 className="journey-recap-beat"><span className="journey-recap-beat-dot" aria-hidden="true"/>{g.label}</h2>}
            <ol>{g.stops.map((i) => {
              const s = journey.stops[i];
              const o = outcomes[i];
              const reason = progress?.outcomes[i]?.reason;
              const ko = objects.get(s.objectId), name = ko ? objectName(ko, shared.page.targets).label : s.objectId;
              const open = actionsAt === i;
              return <li key={s.objectId + i} className={`recap-${o ?? "none"}${open ? " recap-open" : ""}`}>
                <span className="journey-badge" aria-hidden="true">{o === "seen" ? <Check size={13}/> : <Minus size={13}/>}</span>
                <span className="recap-name"><strong>{name}</strong>{(() => { const role = g.label ? stopRoleLine(s, g.label) : stopBeatLabel(s); return role ? <small>{role}</small> : null; })()}</span>
                {/* Design review r4: one mark per seen stop (the badge); the state word is for the other outcomes. */}
                {o === "seen" ? <span className="sr-only">seen</span> : <span className="recap-state">{o === "skipped" ? (reason ? `skipped · ${SKIP_REASON_LABELS[reason].toLowerCase()}` : "skipped") : o === "missed" ? "missed (too low)" : "not marked"}</span>}
                <button type="button" className="recap-more" aria-expanded={open} aria-label={`Plan, compare and look up ${name}`} onClick={() => setActionsAt(open ? null : i)} data-testid={`journey-recap-actions-${i + 1}`}><ChevronDown size={16} aria-hidden="true"/></button>
                {open && <div className="recap-actions">
                  <StopActions objectId={s.objectId} actions={shared.actions} catalog={shared.catalog} journey={{ key: journey.key, stop: i + 1 }} name={name} plannedAt={journeyStopTime(journey, i + 1)}
                    from={getThereFor(journey, i, i - 1, objects, shared.page.profile.fov).startId ?? undefined} compact/>
                </div>}
              </li>;
            })}</ol>
          </section>;
        })}
      </div>
      <div className="journey-rating" role="radiogroup" aria-label="How was this journey?">
        <p>How was it?</p>
        {RATINGS.map(({ value, Icon, label }) => <button key={value} type="button" role="radio" aria-checked={rating === value} className={rating === value ? "active" : ""} onClick={() => rate(value)} data-testid={`journey-rate-${value}`}><Icon size={18} aria-hidden="true"/>{label}</button>)}
        {rating && <p className="journey-note" role="status">Saved on this device only. It helps rank future journeys.</p>}
      </div>
      <JourneyPlanActions shared={shared} journey={journey}/>
      <div className="journey-actions-row">
        <button type="button" className="journey-button primary" onClick={() => shared.go({ view: "discover" })}><Sparkles size={15} aria-hidden="true"/>More journeys</button>
        <button type="button" className="journey-button" onClick={() => shared.go({ view: "overview", key: journey.key })}><ArrowLeft size={15} aria-hidden="true"/>Journey map</button>
      </div>
    </div>
    {wide && <aside className="journey-done-map" aria-label="Where your eye went">
      <JourneyRouteMap shared={shared} journey={journey} states={states} fieldAt={null}/>
    </aside>}
  </section>;
}
