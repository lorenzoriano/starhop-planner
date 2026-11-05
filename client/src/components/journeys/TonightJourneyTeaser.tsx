/**
 * "Tonight's journey" teaser on the Tonight page (doc 06 §2.1). Lazy-loaded after the page is idle (see
 * lazy-entry.ts) and planned in the journey worker, so it never slows Tonight. It builds exactly the request
 * Discovery would, so opening Journeys afterwards is served from the worker's cache and Start opens this journey.
 *
 * - An unfinished journey on this device → "Resume journey" (no engine call at all).
 * - Nothing fits → one line saying why (the engine's plain-language diagnostics).
 * - Engine/KB unavailable, or only the demo KB → nothing rendered.
 */
import { useMemo } from "react";
import { ChevronRight, Play, Waypoints } from "lucide-react";
import { pathForJourneyRoute } from "@/lib/navigation";
import { readJourneyStore, rememberJourney, startJourneyProgress, writeJourneyStore } from "@/lib/journeys/progress";
import type { Journey } from "@/lib/journeys/types";
import { JourneyDomeThumb } from "./JourneyCard";
import { durationLabel, journeyStatus, regionWords } from "./journey-view";
import { useTonightJourneys } from "./use-tonight-journeys";
import "./journeys.css";

export interface TonightJourneyTeaserProps {
  lat: number;
  lon: number;
  date: Date;
  timezone: string;
  live: boolean;
  skyBrightness: number;
  profile: { fov: number; aperture: number; magnification: number; stabilized?: boolean };
  /** Navigate to an app path, e.g. "/journeys" or "/journeys/<key>/stop/1". */
  navigate: (path: string) => void;
}

export default function TonightJourneyTeaser({ lat, lon, date, timezone, live, skyBrightness, profile, navigate }: TonightJourneyTeaserProps) {
  const store = useMemo(() => readJourneyStore(), []);
  const active = store.active && !store.active.completedAt ? store.active : null;
  // Shared with every journey chip: one engine call per request (use-tonight-journeys). None while a journey is active.
  const sky = useMemo(() => ({ at: date, lat, lon, timezone, skyBrightness, profile }), [date, lat, lon, timezone, skyBrightness, profile]);
  const tonight = useTonightJourneys(sky, { enabled: !active });
  const request = tonight.request;

  const open = (journey: Journey) => {
    const s = readJourneyStore();
    writeJourneyStore(startJourneyProgress(rememberJourney(s, journey, live), journey, live));
    navigate(pathForJourneyRoute({ view: "stop", key: journey.key, stop: 1 }));
  };
  const more = () => navigate(pathForJourneyRoute({ view: "discover" }));

  if (active) {
    const j = active.journey;
    return <section className="panel journeys journey-teaser" aria-labelledby="journey-teaser-title" data-testid="journey-teaser">
      <div className="journey-teaser-body">
        <JourneyDomeThumb journey={j} minAlt={store.prefs?.minAlt ?? 30} size={76}/>
        <div className="journey-teaser-text">
          <p className="eyebrow"><Waypoints size={12} aria-hidden="true"/> YOUR JOURNEY</p>
          <h2 id="journey-teaser-title">{j.title}</h2>
          <p className="journey-teaser-meta">Stop {active.stopIndex + 1} of {j.stops.length} · progress saved on this device</p>
        </div>
      </div>
      <div className="journey-teaser-actions">
        <button type="button" className="journey-button primary" onClick={() => navigate(pathForJourneyRoute({ view: "stop", key: active.key, stop: active.stopIndex + 1 }))} data-testid="journey-teaser-resume"><Play size={15} aria-hidden="true"/>Resume journey</button>
        <button type="button" className="journey-link" onClick={more}>More journeys<ChevronRight size={15} aria-hidden="true"/></button>
      </div>
    </section>;
  }

  if (tonight.status !== "ready" || !tonight.result) return null;
  const top = tonight.result.journeys[0];
  if (!top) {
    return <p className="journey-teaser-reason" role="status" data-testid="journey-teaser-reason">
      <Waypoints size={14} aria-hidden="true"/><span>{tonight.result.diagnostics.message || "No sky journey fits right now."}</span>
      <button type="button" className="journey-link" onClick={more}>Journeys<ChevronRight size={14} aria-hidden="true"/></button>
    </p>;
  }
  const status = journeyStatus(top, date, timezone);
  return <section className="panel journeys journey-teaser" aria-labelledby="journey-teaser-title" data-testid="journey-teaser">
    <div className="journey-teaser-body">
      <JourneyDomeThumb journey={top} minAlt={request?.minAlt ?? 30} size={76}/>
      <div className="journey-teaser-text">
        <p className="eyebrow"><Waypoints size={12} aria-hidden="true"/> TONIGHT'S JOURNEY</p>
        <h2 id="journey-teaser-title">{top.title}</h2>
        <p className="journey-teaser-hook">{top.hook}</p>
        <p className="journey-teaser-meta">{top.stops.length} stops · {durationLabel(top.durationMin)} · {regionWords(top)} · {status.text}</p>
      </div>
    </div>
    <div className="journey-teaser-actions">
      <button type="button" className="journey-button primary" onClick={() => open(top)} data-testid="journey-teaser-start"><Play size={15} aria-hidden="true"/>Start journey</button>
      <button type="button" className="journey-link" onClick={more} data-testid="journey-teaser-more">More journeys<ChevronRight size={15} aria-hidden="true"/></button>
    </div>
  </section>;
}
