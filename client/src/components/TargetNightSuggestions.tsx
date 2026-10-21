import { useState } from "react";
import type { UnifiedTarget } from "@/lib/astronomy";
import { UpcomingNights } from "./UpcomingNights";

/** Use the same weather-aware comparison everywhere a target's best nights appear. */
export function TargetNightSuggestions({target,lat,lon,timezone,date,onDate}:{target:UnifiedTarget;lat:number;lon:number;timezone:string;date:Date;onDate:(date:Date)=>void}) {
  const [open,setOpen]=useState(false);
  return <details className="target-best-nights" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Best nights for {target.name}</summary>{open&&<UpcomingNights selected={target} lat={lat} lon={lon} timezone={timezone} date={date} onDate={onDate}/>}</details>;
}
