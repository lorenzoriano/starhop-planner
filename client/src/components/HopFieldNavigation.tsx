import { Check, ChevronRight, SkipBack } from "lucide-react";
import { Button } from "./ui/button";
import { useChartPreferences } from "./ChartPreferences";
import { chartHopDirection } from "@/lib/finder-view";
import type { Route } from "@/lib/astronomy";

export function HopViewDirection({ route, step }: { route: Route; step: number }) {
  const { preferences } = useChartPreferences();
  if (step < 1) return null;
  const direction = chartHopDirection(route.hops[step - 1].center, route.hops[step].center, route.target, preferences.mirrored, preferences.rotation);
  return direction && <span className="hop-view-direction" data-testid="hop-view-direction">Chart: {direction.direction} · {direction.clock} o’clock</span>;
}

export function HopFieldNavigation({ route, step, observed, onPrevious, onNext }: {
  route: Route; step: number; observed: boolean; onPrevious: () => void; onNext: () => void;
}) {
  const hop = route.hops[step], last = step === route.hops.length - 1;
  return <div className="chart-hop-navigation" role="group" aria-label="Field navigation beside the chart">
    <div className="chart-hop-heading">
      <div><span className="eyebrow">FIELD {step + 1} OF {route.hops.length}</span>
        <p>{step === 0 ? `Start at ${route.startAnchor.name}` : `Sky: ${hop.distanceDeg.toFixed(1)}° ${hop.direction}`}</p>
        <HopViewDirection route={route} step={step}/>
      </div>
      <div className="chart-hop-actions">
        <button className="icon-button" disabled={step === 0} aria-label="Previous field on chart" onClick={onPrevious}><SkipBack size={16}/></button>
        <Button onClick={onNext} aria-label={last ? (observed ? "Mark unseen on chart" : "I found it on chart") : "Next field on chart"}>
          {last ? <><Check size={16}/>{observed ? "Mark unseen" : "I found it!"}</> : <>Next <ChevronRight size={16}/></>}
        </Button>
      </div>
    </div>
    <details><summary>Field guide</summary><p>{hop.instruction}</p><p>{hop.pattern}</p></details>
  </div>;
}
