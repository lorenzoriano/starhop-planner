import { clockNightDate, clockTargetEvents } from "@/lib/astronomical-clock";
import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import { useMemo,useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { UnifiedTarget } from '@/lib/astronomy';
import { visibilityWindow,targetDayEvents,targetSkylineEvents } from '@/lib/target-visibility';
import { useLocalHorizon } from '@/hooks/use-local-horizon';
import { NightAltitudeChart } from './ObservingVisuals';
import { displayName } from '@/lib/object-links';

/** Reuses the object/session chart, with a whole-day option for daylight planning. */
export function SelectedTargetPlanning({target,lat,lon,date,timezone,skyBrightness}:{target:UnifiedTarget;lat:number;lon:number;date:Date;timezone:string;skyBrightness:number}) {
  const [span,setSpan]=useState<'night'|'day'>('night');
  const day=span==='night'?clockNightDate(date,timezone):formatInTimeZone(date,timezone,'yyyy-MM-dd');
  const window=useMemo(()=>visibilityWindow(day,span==='night'?'12:00':'00:00','00:00',span==='night'?'night':'range',timezone,lat,lon),[day,span,timezone,lat,lon]);
  const events=useMemo(()=>span==='night'?clockTargetEvents(target,lat,lon,day,timezone):targetDayEvents(target.ra,target.dec,lat,lon,date,timezone),[target.ra,target.dec,lat,lon,day,timezone,span]);
  const {horizon}=useLocalHorizon(lat,lon);
  // With a local horizon, lead with when it clears the skyline and goes behind it; keep the geometric rise/set too.
  const skyline=useMemo(()=>targetSkylineEvents(target.ra,target.dec,lat,lon,events.start,events.end,horizon),[target.ra,target.dec,lat,lon,events,horizon]);
  const event=(at:Date|null)=>at?formatInTimeZone(at,timezone,'HH:mm'):'None today';
  const skylineSummary=skyline&&!events.neverUp&&(skyline.neverClear?'Stays behind the hills all day':skyline.alwaysClear?'Clear of your skyline all day':[...skyline.clears.map(at=>({at,clears:true})),...skyline.hides.map(at=>({at,clears:false}))].sort((a,b)=>+a.at-+b.at)
    .map((e,i)=>e.clears?`${i===0?'Clears your skyline':'clears it again'} ${event(e.at)}`:`${i===0?'Goes behind your skyline':'sets behind it'} ${event(e.at)}`).join(' · '));
  return <section className="selected-target-planning" aria-label={`Observing graph for ${displayName(target)}`}>
    <div className="selected-planning-heading"><ContextDateButton value={date} timezone={timezone}>{formatInTimeZone(new Date(`${day}T12:00:00Z`),'UTC','MMM d, yyyy')}</ContextDateButton><select aria-label="Selected object graph time span" value={span} onChange={e=>setSpan(e.target.value as 'night'|'day')}><option value="night">Astronomical night</option><option value="day">Whole selected day</option></select></div>
    {skylineSummary&&<p className="selected-skyline-times"><strong>{skylineSummary}</strong></p>}
    <div className="binocular-event-times"><span>{skyline?'Rise (flat horizon)':'Rise'}<strong>{events.alwaysUp?'Always up':events.neverUp?'Never rises':event(events.rise)}</strong></span><span>Transit<strong>{event(events.transit)}</strong></span><span>{skyline?'Set (flat horizon)':'Set'}<strong>{events.alwaysUp?'Always up':events.neverUp?'Never rises':event(events.set)}</strong></span></div>
    <NightAltitudeChart target={target} lat={lat} lon={lon} night={window} timezone={timezone} skyBrightness={skyBrightness} showContext span={span} selectedAt={date}/>
    {span==='night'&&window.ok&&window.segments.length>0&&!window.segments.some(s=>date>=s.start&&date<=s.end)&&<p className="selected-graph-zone">Your chosen {formatInTimeZone(date,timezone,'HH:mm')} is outside astronomical darkness. Choose “Whole selected day” to see it on the graph.</p>}
    <p className="selected-graph-zone">Times local · <ContextLocationButton>{timezone.replaceAll('_',' ')}</ContextLocationButton></p>
  </section>;
}
