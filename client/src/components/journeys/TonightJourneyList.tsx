/**
 * Tonight's journeys as a short list on other tabs (integration r5, WS-D), from the shared useTonightJourneys cache:
 * - Planner, "Add a journey to this night": each journey with "Add all stops to tonight's plan" (tagged with the
 *   journey, so the rows carry a "Journey · <title> · stop n" badge back).
 * - Moon tab, "Journeys that work under tonight's Moon": each journey with how far the Moon stays from its stops,
 *   plus Moonlight-proof journeys (theme A12) when the Moon is bright.
 * Also the planner rows' NightJourneyBadge. Lazy (lazy-entry.ts): the journeys runtime stays out of the main bundle.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight, Moon, Plus, Waypoints } from "lucide-react";
import { LINK_LABELS, objectKey, type ObjectActions, type ObjectSkyContext } from "@/lib/object-links";
import { findStoredJourney, readJourneyStore } from "@/lib/journeys/progress";
import type { Journey } from "@/lib/journeys/types";
import { durationLabel, journeyStatus, themeLabel } from "./journey-view";
import { journeyBadgeLabel } from "@/components/SessionPlanner";
import { journeyMoonLine, journeyNightPlan, MOONLIGHT_THEME, openJourneyAt, rememberJourneyOnly, useTonightJourneys, type TonightJourneys } from "./use-tonight-journeys";
import "./journeys.css";
import "./entry-points.css";

export interface TonightJourneyListProps {
  sky: ObjectSkyContext;
  actions: ObjectActions;
  /** "night": Planner (add all stops); "moon": Moon tab (Moon distance, Moonlight-proof when bright). */
  mode: "night" | "moon";
  /** Moon tab: the Moon is bright tonight (also list the Moonlight-proof theme). */
  moonBright?: boolean;
  /** Planner: ids (any form) the night can hold; stops outside it are left out of "Add all stops". */
  plannableIds?: readonly string[];
  /** How many journeys to list (default 3). */
  limit?: number;
  /** Section heading, shown only when there is something to show (never with the demo KB). */
  heading?: ReactNode;
  className?: string;
}

function JourneyItems({ list, sky, actions, mode, plannable, limit }: { list: TonightJourneys; sky: ObjectSkyContext; actions: ObjectActions; mode: "night" | "moon"; plannable: Set<string> | null; limit: number }) {
  const [added, setAdded] = useState<Record<string, number>>({});
  if (list.status === "loading") return <p className="tjl-status" role="status">Finding tonight’s journeys…</p>;
  if (list.status !== "ready" || !list.result) return null;
  if (!list.journeys.length) return <p className="tjl-status" role="status">{list.result.diagnostics.message || "No sky journey fits right now."}</p>;
  const addAll = (journey: Journey) => {
    const plan = journeyNightPlan(journey, plannable ? (id) => plannable.has(objectKey(id)) : undefined);
    if (!plan.ids.length) return;
    rememberJourneyOnly(journey, sky.live);
    actions.addToNight(plan.ids, { at: plan.at, journeyKey: journey.key, journeyStops: plan.journeyStops, plannedAts: plan.plannedAts });
    setAdded((a) => ({ ...a, [journey.key]: plan.ids.length }));
  };
  return <ul className="tjl-list">{list.journeys.slice(0, limit).map((j) => {
    const status = journeyStatus(j, sky.at, sky.timezone), moon = journeyMoonLine(j);
    return <li key={j.key} className="tjl-item" data-testid="tonight-journey-item">
      <div className="tjl-copy">
        <span className="eyebrow">{themeLabel(j.templateId).toUpperCase()}</span>
        <strong>{j.title}</strong>
        <small>{j.stops.length} stops · {durationLabel(j.durationMin)} · {status.text}</small>
        {mode === "moon" ? <small className="tjl-moon"><Moon size={12} aria-hidden="true"/> {moon}</small> : <p>{j.hook}</p>}
      </div>
      <div className="tjl-actions">
        <button type="button" className="journey-link" onClick={() => openJourneyAt(j, actions, { live: sky.live })}>Open journey<ChevronRight size={14} aria-hidden="true"/></button>
        {mode === "night" && (added[j.key]
          ? <span className="tjl-added" role="status">Added {added[j.key]} {added[j.key] === 1 ? "stop" : "stops"}</span>
          : <button type="button" className="journey-button" onClick={() => addAll(j)}><Plus size={14} aria-hidden="true"/>{LINK_LABELS.addAllToNight}</button>)}
      </div>
    </li>;
  })}</ul>;
}

export default function TonightJourneyList({ sky, actions, mode, moonBright = false, plannableIds, limit = 3, heading, className = "" }: TonightJourneyListProps) {
  const tonight = useTonightJourneys(sky);
  const moonlit = useTonightJourneys(mode === "moon" && moonBright ? sky : null, { theme: MOONLIGHT_THEME });
  const plannable = plannableIds ? new Set(plannableIds.map(objectKey)) : null;
  if (tonight.status === "hidden") return null;
  return <div className={`journeys tonight-journey-list ${className}`} data-testid={`tonight-journey-list-${mode}`}>
    {heading}
    <JourneyItems list={tonight} sky={sky} actions={actions} mode={mode} plannable={plannable} limit={limit}/>
    {mode === "moon" && moonBright && moonlit.status !== "hidden" && moonlit.status !== "idle" && <>
      <h3 className="tjl-subheading"><Moon size={14} aria-hidden="true"/> {themeLabel(MOONLIGHT_THEME)} journeys</h3>
      <JourneyItems list={{ ...moonlit, journeys: moonlit.journeys.filter((j) => !tonight.journeys.some((t) => t.key === j.key)) }} sky={sky} actions={actions} mode={mode} plannable={plannable} limit={limit}/>
    </>}
    <button type="button" className="journey-link tjl-more" onClick={() => actions.journey({})}><Waypoints size={14} aria-hidden="true"/>All journeys<ChevronRight size={14} aria-hidden="true"/></button>
  </div>;
}

/**
 * "Journey · <title> · stop n" on a Planner row tagged with a journey; opens that stop. A journey no longer kept on this
 * device cannot be opened, so its badge is a plain label, not a dead link.
 */
export function NightJourneyBadge({ journeyKey, stop, actions }: { journeyKey: string; stop?: number; actions: ObjectActions }) {
  const title = findStoredJourney(readJourneyStore(), journeyKey)?.title;
  if (!title) return <span className="night-journey-badge"><Waypoints size={12} aria-hidden="true"/>{journeyBadgeLabel(undefined, stop)}</span>;
  return <button type="button" className="night-journey-badge" onClick={() => actions.journey({ key: journeyKey, ...(stop ? { stop } : {}) })} title={`Open “${title}”${stop ? ` at stop ${stop}` : ""}`}>
    <Waypoints size={12} aria-hidden="true"/>{journeyBadgeLabel(title, stop)}
  </button>;
}
