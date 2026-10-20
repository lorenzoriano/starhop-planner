import { equatorialOfDate } from "./fixed-equatorial";
import * as Astro from "astronomy-engine";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { eqToHorizontal } from "./astronomy";
import { resolveLocalMoment } from "./session";

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
export function targetDayEvents(ra:number,dec:number,lat:number,lon:number,date:Date,timezone:string) {
  const label=formatInTimeZone(date,timezone,"yyyy-MM-dd");
  const start=fromZonedTime(`${label}T00:00:00`,timezone),end=fromZonedTime(`${nextLocalDate(label)}T00:00:00`,timezone);
  const currentDec=equatorialOfDate(ra,dec,new Date((+start+ +end)/2)).dec;
  const center=Math.sin(lat*rad)*Math.sin(currentDec*rad),amplitude=Math.cos(lat*rad)*Math.cos(currentDec*rad);
  const alwaysUp=center-amplitude>0,neverUp=center+amplitude<=0;
  const angle=Math.acos(Math.max(-1,Math.min(1,-center/amplitude)))/rad;
  const crosses=!alwaysUp&&!neverUp&&amplitude>1e-12;
  return {start,end,alwaysUp,neverUp,rise:crosses?hourAngleEvents(ra,lon,-angle,start,end,dec)[0]??null:null,
    transit:hourAngleEvents(ra,lon,0,start,end,dec)[0]??null,set:crosses?hourAngleEvents(ra,lon,angle,start,end,dec)[0]??null:null};
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
    return {...segment,samples:Array.from(times).sort((a,b)=>a-b).map(ms=>({date:new Date(ms),alt:eqToHorizontal(ra,dec,lat,lon,new Date(ms)).alt}))};
  });
}
