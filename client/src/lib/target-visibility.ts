import { equatorialOfDate } from "./fixed-equatorial";
import * as Astro from "astronomy-engine";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { eqToHorizontal } from "./astronomy";
import { resolveLocalMoment } from "./session";
import { clearIntervals, compactHorizon, horizonLookup, type CompactHorizon, type HorizonInput } from "./horizon/profile";

const siderealDay=86164090.5,rad=Math.PI/180;
const wrap=(angle:number)=>((angle+180)%360+360)%360-180;
export function nextLocalDate(date:string) {
  const day=new Date(`${date}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+1);return day.toISOString().slice(0,10);
}
/** Fixed catalog coordinates, matching the star charts; geometric flat horizon. */
function hourAngleEvents(ra:number,lon:number,angle:number,start:Date,end:Date,dec=0) {
  const initial=Astro.SiderealTime(start)*15+lon-equatorialOfDate(ra,dec,start).ra;
  const delta=((angle-initial)%360+360)%360;
  const events:Date[]=[];
  for(let cycle=-1;cycle<=2;cycle++) {
    let ms=start.getTime()+(delta/360+cycle)*siderealDay;
    for(let i=0;i<4;i++)ms-=wrap(Astro.SiderealTime(new Date(ms))*15+lon-equatorialOfDate(ra,dec,new Date(ms)).ra-angle)/360*siderealDay;
    if(ms>=start.getTime()&&ms<end.getTime())events.push(new Date(ms));
  }
  return events.sort((a,b)=>a.getTime()-b.getTime());
}
/** Search the requested interval itself: a civil date can contain two sidereal events. */
export function targetIntervalEvents(ra:number,dec:number,lat:number,lon:number,start:Date,end:Date) {
  const currentDec=equatorialOfDate(ra,dec,new Date((+start+ +end)/2)).dec;
  const center=Math.sin(lat*rad)*Math.sin(currentDec*rad),amplitude=Math.cos(lat*rad)*Math.cos(currentDec*rad);
  const alwaysUp=center-amplitude>0,neverUp=center+amplitude<=0;
  const angle=Math.acos(Math.max(-1,Math.min(1,-center/amplitude)))/rad;
  const crosses=!alwaysUp&&!neverUp&&amplitude>1e-12;
  const events={rise:crosses?hourAngleEvents(ra,lon,-angle,start,end,dec):[],transit:hourAngleEvents(ra,lon,0,start,end,dec),set:crosses?hourAngleEvents(ra,lon,angle,start,end,dec):[]};
  return {start,end,alwaysUp,neverUp,events,rise:events.rise[0]??null,transit:events.transit[0]??null,set:events.set[0]??null};
}
export function targetDayEvents(ra:number,dec:number,lat:number,lon:number,date:Date,timezone:string) {
  const label=formatInTimeZone(date,timezone,"yyyy-MM-dd");
  return targetIntervalEvents(ra,dec,lat,lon,fromZonedTime(`${label}T00:00:00`,timezone),fromZonedTime(`${nextLocalDate(label)}T00:00:00`,timezone));
}
export type VisibilityMode="time"|"night"|"range";
export type VisibilityWindow={ok:true;start:Date;end:Date;segments:{start:Date;end:Date}[]}|{ok:false;error:string};
export function visibilityWindow(date:string,time:string,until:string,mode:VisibilityMode,timezone:string,lat:number,lon:number):VisibilityWindow {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!resolveLocalMoment(date,"12:00",timezone))return {ok:false,error:"Choose a valid observing date."};
  const start=resolveLocalMoment(date,mode==="night"?"12:00":time,timezone);
  const endDate=mode==="night"||mode==="range"&&until<=time?nextLocalDate(date):date;
  const end=mode==="time"?start:resolveLocalMoment(endDate,mode==="night"?"12:00":until,timezone);
  if(!start||!end)return {ok:false,error:"Choose valid local times. A daylight-saving change may skip that time."};
  if(mode!=="night")return {ok:true,start,end,segments:[{start,end}]};
  // The observing night is the darkness between local noon and the next noon.
  // Roots delimit astronomical darkness, including partial and polar nights.
  const observer=new Astro.Observer(lat,lon,0),days=(end.getTime()-start.getTime())/86400000;
  const bounds=[start,end];
  for(const direction of [-1,1]){const event=Astro.SearchAltitude(Astro.Body.Sun,observer,direction,start,days,-18)?.date;if(event&&event>start&&event<end)bounds.push(event);}
  bounds.sort((a,b)=>a.getTime()-b.getTime());
  const segments=[];
  for(let i=1;i<bounds.length;i++) {const a=bounds[i-1],b=bounds[i],mid=new Date((a.getTime()+b.getTime())/2),eq=Astro.Equator(Astro.Body.Sun,mid,observer,true,true);
    if(Astro.Horizon(mid,observer,eq.ra,eq.dec).altitude<-18)segments.push({start:a,end:b});}
  return {ok:true,start,end,segments};
}
/** Include exact culmination extrema so even a short high-altitude window counts. */
export function targetWindow(ra:number,dec:number,lat:number,lon:number,window:Extract<VisibilityWindow,{ok:true}>) {
  let max=-Infinity,min=Infinity,bestAt=window.start;
  for(const segment of window.segments) {
    const times=[segment.start,segment.end,...hourAngleEvents(ra,lon,0,segment.start,segment.end,dec),...hourAngleEvents(ra,lon,180,segment.start,segment.end,dec)];
    for(const at of times){const alt=eqToHorizontal(ra,dec,lat,lon,at).alt;if(alt>max){max=alt;bestAt=at;}min=Math.min(min,alt);}
  }
  return {max,min,bestAt};
}

/** Sample only astronomical-darkness segments, retaining exact altitude extrema. */
export function nightAltitudeSamples(ra:number,dec:number,lat:number,lon:number,night:VisibilityWindow) {
  if(!night.ok)return [];
  return night.segments.map(segment=>{
    const count=Math.max(1,Math.ceil((+segment.end-+segment.start)/(15*60000)));
    const times=new Set(Array.from({length:count+1},(_,i)=>+segment.start+(+segment.end-+segment.start)*i/count));
    for(const angle of [0,180])for(const at of hourAngleEvents(ra,lon,angle,segment.start,segment.end,dec))times.add(+at);
    return {...segment,samples:Array.from(times).sort((a,b)=>a-b).map(ms=>{const pos=eqToHorizontal(ra,dec,lat,lon,new Date(ms));return {date:new Date(ms),alt:pos.alt,az:pos.az};})};
  });
}

// ───────────────────────────── local skyline ─────────────────────────────

const raisedCache=new WeakMap<object,Map<number,CompactHorizon>>();
/**
 * The local skyline combined with a minimum altitude: each azimuth needs max(minimum, skyline). Null when no horizon is
 * known (callers then keep their flat `alt >= minimum` rule). Cached per horizon object and minimum.
 */
export function skylineWithMinimum(horizon:HorizonInput,minimum:number):CompactHorizon|null {
  if(!horizon||!horizonLookup(horizon))return null;
  let byMinimum=raisedCache.get(horizon);
  if(!byMinimum){byMinimum=new Map();raisedCache.set(horizon,byMinimum);}
  let raised=byMinimum.get(minimum);
  if(!raised){const compact=compactHorizon(horizon)!;raised={kind:"geometric",stepDeg:compact.stepDeg,alt:compact.alt.map(a=>Math.max(minimum,a))};byMinimum.set(minimum,raised);}
  return raised;
}

export interface SkylineEvents {
  /** Spans clear of the local skyline (and above `minimum`), clipped to the searched interval. */
  intervals:{start:Date;end:Date}[];
  /** Times it climbs clear of the skyline / goes behind it, inside the interval (minute accuracy). */
  clears:Date[];
  hides:Date[];
  clear:Date|null;
  hide:Date|null;
  alwaysClear:boolean;
  neverClear:boolean;
}
/** Bisection tolerance for skyline crossings (1 s, as upcoming-nights): every view rounds the same instant to the
 *  same HH:mm, whatever its sampling grid. */
const SKYLINE_TOLERANCE_MS=1000;
/**
 * "Clears your skyline" / "goes behind your skyline" times of a fixed target between `start` and `end`, from the
 * local horizon. Null when no horizon is known (show the plain geometric rise/set). Samples every `stepMinutes` and
 * refines each crossing by bisection on the exact position (about 1 s).
 */
export function targetSkylineEvents(ra:number,dec:number,lat:number,lon:number,start:Date,end:Date,horizon:HorizonInput,{minimum=0,stepMinutes=5}:{minimum?:number;stepMinutes?:number}={}):SkylineEvents|null {
  const skyline=minimum>0?skylineWithMinimum(horizon,minimum):horizon&&horizonLookup(horizon)?horizon:null;
  if(!skyline||!(+end>+start))return null;
  const position=(t:number)=>eqToHorizontal(ra,dec,lat,lon,new Date(t));
  const count=Math.max(1,Math.ceil((+end-+start)/(stepMinutes*60_000)));
  const samples=Array.from({length:count+1},(_,i)=>{const t=+start+(+end-+start)*i/count;return {t,...position(t)};});
  const intervals=clearIntervals(samples,skyline,{position,tolerance:SKYLINE_TOLERANCE_MS}).map(i=>({start:new Date(i.start),end:new Date(i.end)}));
  const clears=intervals.filter(i=>+i.start>+start).map(i=>i.start),hides=intervals.filter(i=>+i.end<+end).map(i=>i.end);
  return {intervals,clears,hides,clear:clears[0]??null,hide:hides[0]??null,
    alwaysClear:intervals.length===1&&!clears.length&&!hides.length,neverClear:!intervals.length};
}

/**
 * End of the dark window `at` falls in (or of the next one, from daylight): astronomical dawn, when the Sun climbs
 * back to −18°. Without such a dawn within a day: 24 h on in a polar night, 12 h on when it never gets dark.
 */
export function darkWindowEnd(lat:number,lon:number,at:Date):Date {
  const observer=new Astro.Observer(lat,lon,0);
  const dawn=Astro.SearchAltitude(Astro.Body.Sun,observer,1,at,1,-18)?.date;
  if(dawn)return dawn;
  const eq=Astro.Equator(Astro.Body.Sun,at,observer,true,true);
  return new Date(+at+(Astro.Horizon(at,observer,eq.ra,eq.dec).altitude<-18?24:12)*3600_000);
}
/**
 * When a target that is behind the local skyline at `at` next climbs clear of it within the current dark window
 * (`until`, by default astronomical dawn: darkWindowEnd). 'after-dawn' when it stays hidden until then; `at` itself
 * when it is already clear; null without a known skyline. Same sampling and bisection as targetSkylineEvents, so the
 * time agrees with the other views.
 */
export function nextSkylineClear(ra:number,dec:number,lat:number,lon:number,at:Date,horizon:HorizonInput,until:Date=darkWindowEnd(lat,lon,at)):Date|'after-dawn'|null {
  const events=targetSkylineEvents(ra,dec,lat,lon,at,until,horizon);
  if(!events)return null;
  if(events.intervals.length&&+events.intervals[0].start===+at)return at;
  return events.clear??'after-dawn';
}
