/**
 * Journey links for one object, on every tab (integration r5, WS-D). Lazy-loaded via lazy-entry.ts so the KB stays
 * out of the main bundle, and it never runs the engine itself: tonight's journeys come from the shared
 * useTonightJourneys cache (one call per request, shared with the Tonight teaser and every other chip).
 *
 * - One of tonight's real journeys includes the object → "In journey: <title> · stop n" (opens the journey) and
 *   "Start here" (field mode at that stop, like the teaser's Start). At the journey's last stop: "Start journey"
 *   (stop 1) next to "Jump to stop n", so the story is not skipped by accident.
 * - Otherwise, when an active theme can tell the object → "Find a journey with this" (Discovery focused on it, which
 *   plans for the coming dark with the object pinned). When no journey fits right now because it is not dark yet:
 *   "Journeys open at HH:MM" (the next dusk), which leads to the same place.
 * - Otherwise, while loading, or with only the demo KB → nothing.
 * Without `sky` only the second level is possible. It never says "tonight" for theme membership.
 */
import { useMemo } from "react";
import { Clock3, Play, Waypoints } from "lucide-react";
import { LINK_LABELS, type JourneyLink, type ObjectActions, type ObjectSkyContext } from "@/lib/object-links";
import { journeyLinkDecision, journeysOpenAt, openJourneyAt, startChoices, useInActiveLens, useTonightJourneys } from "./use-tonight-journeys";
import { localTime } from "./journey-view";
import "./entry-points.css";

export interface ObjectJourneyLinksProps {
  /** Any id form (unified, HR<n>, star:HR<n>, KB id). */
  objectId: string;
  actions: ObjectActions;
  /** One-line chip for cards and rows. */
  compact?: boolean;
  /** Observing context for "tonight" journeys; without it only level 1 is shown. */
  sky?: ObjectSkyContext;
}

export default function ObjectJourneyLinks({ objectId, actions, compact = false, sky }: ObjectJourneyLinksProps) {
  const tonight = useTonightJourneys(sky ?? null);
  const links = tonight.linksFor(objectId);
  const needLens = !links.length && tonight.status !== "loading" && tonight.status !== "hidden";
  const inLens = useInActiveLens(objectId, needLens);
  const noneNow = tonight.status === "ready" && !tonight.journeys.length;
  // Only when nothing fits now: the next dusk of the shared night window (daylight → "Journeys open at 18:36").
  const opensAt = useMemo(() => (noneNow && sky ? journeysOpenAt(sky) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sky's instant and place decide the dusk
    [noneNow, sky?.at.getTime(), sky?.lat, sky?.lon, sky?.timezone]);
  const decision = journeyLinkDecision({ status: tonight.status, links, inLens, journeysNow: tonight.status === "ready" ? tonight.journeys.length : undefined, opensAt });
  const live = sky?.live ?? false;

  if (decision.kind === "pending" || decision.kind === "none") return null;
  if (decision.kind === "opens") {
    return <div className={`object-journey-links ${compact ? "compact" : ""}`} data-testid="object-journey-links" data-state="opens">
      <button type="button" className="ojl-find" title={LINK_LABELS.findJourney} onClick={() => actions.journey({ objectId })}>
        <Clock3 size={14} aria-hidden="true"/>Journeys open at {localTime(decision.at, sky?.timezone ?? "UTC")}<span aria-hidden="true">›</span>
      </button>
    </div>;
  }
  if (decision.kind === "find") {
    return <div className={`object-journey-links ${compact ? "compact" : ""}`} data-testid="object-journey-links" data-state="find">
      <button type="button" className="ojl-find" onClick={() => actions.journey({ objectId })}>
        <Waypoints size={14} aria-hidden="true"/>{LINK_LABELS.findJourney}<span aria-hidden="true">›</span>
      </button>
    </div>;
  }
  const link: JourneyLink = decision.link, journey = tonight.journeys.find((j) => j.key === link.key);
  const label = LINK_LABELS.inJourney(link.title, link.stop);
  return <div className={`object-journey-links ${compact ? "compact" : ""}`} data-testid="object-journey-links" data-state="in-journey">
    <button type="button" className="ojl-journey" title={`Open “${link.title}” (stop ${link.stop} of ${link.stopCount})`}
      onClick={() => journey ? openJourneyAt(journey, actions, { live }) : actions.journey({ key: link.key })}>
      <Waypoints size={14} aria-hidden="true"/><span>{label}</span>{decision.more > 0 && <small> +{decision.more}</small>}
    </button>
    {startChoices(link).map((c, k) => <button key={c.stop} type="button" className={k === 0 ? "ojl-start" : "ojl-jump"} aria-label={`${c.label}: ${link.title}${c.label.includes(String(c.stop)) ? "" : `, stop ${c.stop}`}`}
      onClick={() => journey ? openJourneyAt(journey, actions, { live, startAt: c.stop }) : actions.journey({ key: link.key, stop: c.stop })}>
      {k === 0 && <Play size={13} aria-hidden="true"/>}{c.label}
    </button>)}
  </div>;
}
