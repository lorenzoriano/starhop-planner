import { formatInTimeZone } from "date-fns-tz";
import { angularDistance, type UnifiedTarget } from "./astronomy";
import { moonState, scatteredMoonlight, type MoonState } from "./moon";
import { nightAltitudeSamples, visibilityWindow, type VisibilityWindow } from "./target-visibility";

/** One cache per site/night, shared by all visible object charts. */
export function createMoonSampler(lat:number,lon:number) {
  const cache=new Map<number,MoonState>();
  return (date:Date)=>{let moon=cache.get(+date);if(!moon){moon=moonState(lat,lon,date);cache.set(+date,moon);}return moon;};
}
export type ObservationSample={date:Date;alt:number;separation:number;moon:MoonState;moonlight:number};
export function observationProfile(target:UnifiedTarget,lat:number,lon:number,night:VisibilityWindow,skyBrightness:number,moonAt=createMoonSampler(lat,lon)) {
  return nightAltitudeSamples(target.ra,target.dec,lat,lon,night).map(segment=>({...segment,samples:segment.samples.map(sample=>{
    const moon=moonAt(sample.date),separation=angularDistance(target.ra,target.dec,moon.ra,moon.dec);
    return {...sample,moon,separation,moonlight:scatteredMoonlight(moon,sample.alt,separation,skyBrightness).brightening};
  })}));
}
/** Individual-target guidance; a multi-object schedule may allocate another slot. */
export function suggestedObservation(samples:ObservationSample[],target:Pick<UnifiedTarget,"category"|"mag">,range?:{start:Date;end:Date}) {
  const weight=/galaxy|nebula|cloud/i.test(target.category)?14:/star|asterism/i.test(target.category)&&target.mag<=5?2:6;
  const candidates=samples.filter(s=>s.alt>=15&&(!range||s.date>=range.start&&s.date<=range.end));
  return candidates.reduce<ObservationSample|undefined>((best,sample)=>!best||sample.alt-sample.moonlight*weight>best.alt-best.moonlight*weight?sample:best,undefined);
}

/** Early-morning sessions belong to the preceding evening if it overlaps more. */
export function sessionNightWindow(start:Date,end:Date,timezone:string,lat:number,lon:number) {
  const day=formatInTimeZone(start,timezone,"yyyy-MM-dd");
  const current=visibilityWindow(day,"12:00","12:00","night",timezone,lat,lon);
  if(Number(formatInTimeZone(start,timezone,"H"))>=12)return current;
  const previousDay=new Date(`${day}T12:00:00Z`);previousDay.setUTCDate(previousDay.getUTCDate()-1);
  const previous=visibilityWindow(previousDay.toISOString().slice(0,10),"12:00","12:00","night",timezone,lat,lon);
  const overlap=(night:VisibilityWindow)=>night.ok?night.segments.reduce((sum,s)=>sum+Math.max(0,Math.min(+s.end,+end)-Math.max(+s.start,+start)),0):0;
  return overlap(previous)>overlap(current)?previous:current;
}
