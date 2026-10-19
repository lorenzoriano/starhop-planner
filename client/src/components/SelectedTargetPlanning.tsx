import { useMemo,useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { UnifiedTarget } from '@/lib/astronomy';
import { visibilityWindow,targetDayEvents } from '@/lib/target-visibility';
import { NightAltitudeChart } from './ObservingVisuals';

/** Reuses the object/session chart, with a whole-day option for daylight planning. */
export function SelectedTargetPlanning({target,lat,lon,date,timezone,skyBrightness}:{target:UnifiedTarget;lat:number;lon:number;date:Date;timezone:string;skyBrightness:number}) {
  const [span,setSpan]=useState<'night'|'day'>('night');
  const day=formatInTimeZone(date,timezone,'yyyy-MM-dd');
  const window=useMemo(()=>visibilityWindow(day,span==='night'?'12:00':'00:00','00:00',span==='night'?'night':'range',timezone,lat,lon),[day,span,timezone,lat,lon]);
  const events=useMemo(()=>targetDayEvents(target.ra,target.dec,lat,lon,date,timezone),[target.ra,target.dec,lat,lon,day,timezone]);
  const event=(at:Date|null)=>at?formatInTimeZone(at,timezone,'HH:mm'):'None today';
  return <section className="selected-target-planning" aria-label={`Observing graph for ${target.name}`}>
    <div className="selected-planning-heading"><span>{formatInTimeZone(date,timezone,'MMM d, yyyy')}</span><select aria-label="Selected object graph time span" value={span} onChange={e=>setSpan(e.target.value as 'night'|'day')}><option value="night">Astronomical night</option><option value="day">Whole selected day</option></select></div>
    <div className="binocular-event-times"><span>Rise<strong>{events.alwaysUp?'Always up':events.neverUp?'Never rises':event(events.rise)}</strong></span><span>Transit<strong>{event(events.transit)}</strong></span><span>Set<strong>{events.alwaysUp?'Always up':events.neverUp?'Never rises':event(events.set)}</strong></span></div>
    <NightAltitudeChart target={target} lat={lat} lon={lon} night={window} timezone={timezone} skyBrightness={skyBrightness} showContext span={span} selectedAt={date}/>
    {span==='night'&&window.ok&&window.segments.length>0&&!window.segments.some(s=>date>=s.start&&date<=s.end)&&<p className="selected-graph-zone">Your chosen {formatInTimeZone(date,timezone,'HH:mm')} is outside astronomical darkness. Choose “Whole selected day” to see it on the graph.</p>}
    <p className="selected-graph-zone">Times local · {timezone.replaceAll('_',' ')}</p>
  </section>;
}
