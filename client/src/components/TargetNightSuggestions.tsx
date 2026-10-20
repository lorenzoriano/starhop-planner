import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { bestUpcomingNights } from "@/lib/upcoming-nights";
import type { UnifiedTarget } from "@/lib/astronomy";

/** A compact target-specific entry to the same Moon-free night comparison. */
export function TargetNightSuggestions({target,lat,lon,timezone,date,onDate}:{target:UnifiedTarget;lat:number;lon:number;timezone:string;date:Date;onDate:(date:Date)=>void}) {
  const day=formatInTimeZone(date,timezone,"yyyy-MM-dd");
  const nights=useMemo(()=>bestUpcomingNights({selected:target,lat,lon,timezone,date}),[target,lat,lon,timezone,day]);
  return <details className="target-best-nights"><summary>Best nights for {target.name}</summary><div>{nights.length?nights.map(night=><button type="button" className="text-action" key={night.date} onClick={()=>onDate(night.chooseAt)}>{formatInTimeZone(night.chooseAt,timezone,"EEE, MMM d · HH:mm")} · {night.selectedTarget!.goodAltitudeHours.toFixed(1)} h above 30° in Moon-free darkness</button>):<p>No Moon-free dark time above 30° in the next 30 nights. Use the clock to inspect other seasons or nights with moonlight.</p>}</div><small>Geometry only; check the forecast for each night.</small></details>;
}
