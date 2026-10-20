import { useEffect, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { SeasonTrajectory, TrajectoryScope } from '@/lib/season-trajectories';
import { trajectoryIncluded } from '@/lib/season-trajectories';
import { observationAt } from '@/lib/observing-profile';
import type { UnifiedTarget } from '@/lib/astronomy';
import { ContextDateButton } from './ObservingContext';
import { resolveLocalMoment } from '@/lib/session';
import { shiftClockDate } from '@/lib/astronomical-clock';
export function trajectoryMoment(track: SeasonTrajectory, index: number, timezone: string) {
  index=Math.max(0,Math.min(track.hour.length-1,index));
  return track.ms?.[index] !== undefined ? new Date(track.ms[index]) : resolveLocalMoment(track.hour[index]<12?shiftClockDate(track.day,1):track.day,`${String(Math.floor(track.hour[index])).padStart(2,'0')}:${String(Math.round((track.hour[index]%1)*60)).padStart(2,'0')}`,timezone)!;
}
const altitudeColor = (alt: number) => `hsl(${205-alt*.8} 44% ${18+Math.max(0,alt)*.52}%)`;
/** A date is explicit in this view, avoiding ambiguous superposition of many nights. */
export function SeasonAltitudeCalendar({ tracks, object, target, scope, lat, lon, timezone, onTime }: { tracks: SeasonTrajectory[]; object: number; target: UnifiedTarget; scope: TrajectoryScope; lat: number; lon: number; timezone: string; onTime: (date: Date)=>void }) {
  const [cursor,setCursor]=useState<{day:number;sample:number}|null>(null);
  useEffect(()=>setCursor(null),[tracks,object,scope,timezone]);
  const track=cursor?tracks[cursor.day]:null, at=track&&cursor?trajectoryMoment(track,cursor.sample,timezone):null;
  const value=at?observationAt(target,lat,lon,at,21.6):null;
  const included=track&&cursor?trajectoryIncluded(track,cursor.sample,object,scope):false;
  const pick=(e:React.MouseEvent<SVGSVGElement>)=>{
    const r=e.currentTarget.getBoundingClientRect(), day=Math.max(0,Math.min(tracks.length-1,Math.floor((((e.clientX-r.left)/r.width)*800-48)/720*tracks.length))), hour=12+Math.max(0,Math.min(23.99,(((e.clientY-r.top)/r.height)*390-30)/300*24));
    const sample=tracks[day].hour.reduce((best,h,i)=>Math.abs((h<12?h+24:h)-hour)<Math.abs((tracks[day].hour[best]<12?tracks[day].hour[best]+24:tracks[day].hour[best])-hour)?i:best,0);
    return {day,sample};
  };
  return <div className="season-altitude-calendar"><h4>Altitude through the year</h4><p className="astro-note">Each column is one observing night; each row is local time. Color shows altitude for samples above the horizon and included by the selected time filter. Empty cells mean below the horizon or outside that filter. All hours includes daylight; the Darkness and Observing limits filters can leave daylight or Moon-rejected times empty. Every night stays separate, so a colored cell never means the target is always visible.</p>
    <svg viewBox="0 0 800 390" role="slider" tabIndex={0} aria-label={`Date-by-time altitude calendar for ${target.name}. A colored cell means above the horizon and included by the selected filter. Left/right change date; up/down change time; Enter opens the selected moment.`} aria-valuemin={0} aria-valuemax={tracks.length-1} aria-valuenow={cursor?.day??0} aria-valuetext={value&&at?`${formatInTimeZone(at,timezone,'MMM d HH:mm')}: ${value.alt.toFixed(1)} degrees, ${value.alt>=0?'above':'below'} horizon, ${included?'included':'outside'} current time filter, ${value.separation.toFixed(1)} degrees from Moon`: 'Choose a date and time'} onPointerMove={e=>setCursor(pick(e))} onClick={e=>{const c=pick(e);setCursor(c);onTime(trajectoryMoment(tracks[c.day],c.sample,timezone));}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape'){setCursor(null);return;} const c=cursor??{day:0,sample:20};if(e.key==='Enter'){onTime(trajectoryMoment(tracks[c.day],c.sample,timezone));return;}const nextDay=Math.max(0,Math.min(tracks.length-1,c.day+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)));setCursor({day:nextDay,sample:Math.max(0,Math.min(tracks[nextDay].hour.length-1,c.sample+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)))});}}>
      <rect x="48" y="30" width="720" height="300" fill="#07131e"/>
      {tracks.map((t,d)=>t.hour.map((hour,i)=>{const alt=t.alt[object][i],h=(hour+12)%24;return alt>=0&&trajectoryIncluded(t,i,object,scope)?<rect key={`${d}-${i}`} x={48+d/tracks.length*720} y={30+(h-.25)/24*300} width={720/tracks.length+.15} height={300/48+.1} fill={altitudeColor(alt)}/>:null;}))}
      {[12,18,24,30,36].map(h=><g key={h}><line x1="48" x2="768" y1={30+(h-12)/24*300} y2={30+(h-12)/24*300} stroke="#8aa2ad" strokeOpacity=".25"/><text x="40" y={34+(h-12)/24*300} textAnchor="end">{String(h%24).padStart(2,'0')}:00</text></g>)}
      {tracks.map((t,i)=>(i===0||t.day.endsWith('-01'))&&<text key={t.day} x={48+i/tracks.length*720} y="353">{new Date(`${t.day}T12:00:00Z`).toLocaleDateString('en',{month:'short',timeZone:'UTC'})}</text>)}
      {cursor&&track&&<circle cx={48+(cursor.day+.5)/tracks.length*720} cy={30+((track.hour[cursor.sample]+12)%24)/24*300} r="4" fill="none" stroke="#eee4d2" strokeWidth="1.5"/>}
    </svg>
    <div className="season-altitude-key">{[0,15,30,45,60,75,90].map(alt=><span key={alt}><i style={{background:altitudeColor(alt)}}/>{alt}°</span>)}</div>
    <div className="season-calendar-reading" aria-live="polite">{value&&at?<><ContextDateButton value={at} timezone={timezone} onChange={onTime}>{formatInTimeZone(at,timezone,'MMM d, yyyy · HH:mm')}</ContextDateButton><p>{value.alt.toFixed(1)}° high · {value.alt>=0?'Above horizon':'Below horizon'} · {value.moon.sunAlt<=-18?'Astronomical darkness':'Twilight / daylight'} · {included?'Included by current filter':'Outside current filter'} · {value.separation.toFixed(1)}° from Moon · Moon {Math.round(value.moon.illumination*100)}% lit</p></>:<p>Hover or touch to read a date, time, altitude and visibility. Tap to open that moment in the clock.</p>}</div>
  </div>;
}
