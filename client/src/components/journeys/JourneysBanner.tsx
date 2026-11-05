/** Binoculars page banner (doc 06 §2.1): "Turn this month's sky into a story → Sky Journeys". Tiny and eager. */
import { ArrowRight, Waypoints } from "lucide-react";
import "./entry-points.css";

export function JourneysBanner({ monthName, onOpen }: { monthName: string; onOpen: () => void }) {
  return <button type="button" className="journeys-banner" onClick={onOpen} data-testid="binocular-journeys-banner"
    aria-label={`Turn ${monthName}'s sky into a story: open Sky Journeys for this date and time`}>
    <Waypoints size={18} aria-hidden="true"/>
    <span><strong>Turn this month's sky into a story</strong><small>Guided binocular tours with the why behind each stop</small></span>
    <span className="journeys-banner-cta">Sky Journeys<ArrowRight size={15} aria-hidden="true"/></span>
  </button>;
}
