import { z } from "zod";
import * as Astro from "astronomy-engine";
import tzLookup from "tz-lookup";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nightListSchema, type NightItem } from "./session";
import { eqToHorizontal, angularDistance, type UnifiedTarget, type Star } from "./astronomy";
import { moonState, lunarFeatures, lunarFrame, projectLunarFeature, scatteredMoonlight } from "./moon";

export const observingSessionSchema = z.object({
  id:z.string(), name:z.string().min(1).max(100), startAt:z.string().datetime(),
  lat:z.number().min(-90).max(90), lon:z.number().min(-180).max(180),
  locationName:z.string().max(100), durationMinutes:z.number().int().min(30).max(720),
  minutesPerTarget:z.number().int().min(5).max(60), items:nightListSchema,
  archived:z.boolean().default(false), createdAt:z.string().datetime(),
});
export type ObservingSession = z.infer<typeof observingSessionSchema>;
export const plannerStoreSchema = z.object({ sessions:z.array(observingSessionSchema).max(300), activeId:z.string().nullable() });
export type PlannerStore = z.infer<typeof plannerStoreSchema>;
export const emptyPlanner: PlannerStore = { sessions:[],activeId:null };
export const sessionTimezone = (s: Pick<ObservingSession,"lat"|"lon">) => tzLookup(s.lat,s.lon);

export function eveningOn(localDate:string,lat:number,lon:number) {
  const timezone=tzLookup(lat,lon);
  const noon=fromZonedTime(`${localDate}T12:00:00`,timezone);
  const darkness=Astro.SearchAltitude(Astro.Body.Sun,new Astro.Observer(lat,lon,0),-1,noon,1,-18)?.date;
  const fallback=fromZonedTime(`${localDate}T21:00:00`,timezone);
  return { date:darkness ? new Date(darkness.getTime()+15*60_000) : fallback, astronomicalDarkness:!!darkness };
}
export function planningShortcut(kind:"tonight"|"new-moon",lat:number,lon:number,now=new Date()) {
  const timezone=tzLookup(lat,lon);
  const phaseAt=kind==="new-moon" ? Astro.SearchMoonPhase(0,now,40)?.date : undefined;
  const localDate=formatInTimeZone(phaseAt??now,timezone,"yyyy-MM-dd");
  const evening=eveningOn(localDate,lat,lon);
  if(kind==="tonight" && evening.date<now && Number(formatInTimeZone(now,timezone,"H"))>=12) evening.date=new Date(Math.ceil(now.getTime()/900_000)*900_000);
  return {...evening,phaseAt};
}
export function makeSession(name:string,start:Date,lat:number,lon:number,items:NightItem[]=[],locationName=""):ObservingSession {
  return { id:crypto.randomUUID(),name,startAt:start.toISOString(),lat,lon,locationName,durationMinutes:180,minutesPerTarget:15,items,archived:false,createdAt:new Date().toISOString() };
}

type Candidate = { id:string;name:string;date:Date;alt:number;az:number;separation:number|null;moonlight:number;lunar:boolean;usable:boolean;score:number;minimum:number;darkEnough:boolean };
export type SequenceStep = { id:string; name:string; date:Date|null; alt:number; az:number; separation:number|null; moonlight:number; reason:string; lunar:boolean };
export function suggestSequence(session:ObservingSession,targets:UnifiedTarget[],skyBrightness=21.6):SequenceStep[] {
  const start=new Date(session.startAt),end=new Date(start.getTime()+session.durationMinutes*60_000);
  const remaining=session.items.filter(i=>!i.observedAt).map(i=>i.id);
  const steps:SequenceStep[]=[];
  const moonCache=new Map<number,ReturnType<typeof moonState>>();
  const frameCache=new Map<number,ReturnType<typeof lunarFrame>>();
  const targetCache=new Map<string,Candidate>();
  const targetMap=new Map(targets.map(t=>[t.id,t]));
  const atTarget=(id:string,at:Date):Candidate|null => {
    const key=`${id}:${at.getTime()}`; if(targetCache.has(key))return targetCache.get(key)!;
    let moon=moonCache.get(at.getTime()); if(!moon){moon=moonState(session.lat,session.lon,at);moonCache.set(at.getTime(),moon);}
    const lunar=id.startsWith("moon:"), feature=lunarFeatures.find(f=>`moon:${f.id}`===id),target=targetMap.get(id);
    if(!feature&&!target)return null;
    const pos=lunar?{alt:moon.alt,az:moon.az}:eqToHorizontal(target!.ra,target!.dec,session.lat,session.lon,at);
    const brightStellar=target && /star|asterism/i.test(target.category) && target.mag<=5;
    const minimum=lunar?5:15;
    let lunarVisible=true;
    if(feature){let frame=frameCache.get(at.getTime());if(!frame){frame=lunarFrame(session.lat,session.lon,at);frameCache.set(at.getTime(),frame);}const p=projectLunarFeature(feature,frame);lunarVisible=p.visible&&p.lit;}
    const darkEnough=lunar?moon.sunSeparation>=20&&lunarVisible:moon.sunAlt<=(brightStellar?-6:-18);
    const separation=target?angularDistance(target.ra,target.dec,moon.ra,moon.dec):null;
    const impact=target?{...scatteredMoonlight(moon,pos.alt,separation!,skyBrightness),diffuse:/galaxy|nebula|cloud/i.test(target.category)}:null;
    const usable=pos.alt>=minimum&&darkEnough;
    const score=pos.alt-(impact?.brightening??0)*(impact?.diffuse?14:brightStellar?2:6);
    const point={id,name:feature?.name??target!.displayName,date:at,alt:pos.alt,az:pos.az,separation:separation,moonlight:impact?.brightening??0,lunar,usable,score,minimum,darkEnough};
    targetCache.set(key,point); return point;
  };
  let current=start;
  while(remaining.length && current<end) {
    const options=remaining.map(id=> {
      const samples:NonNullable<ReturnType<typeof atTarget>>[]=[];
      for(let ms=current.getTime();ms+session.minutesPerTarget*60_000<=end.getTime();ms+=15*60_000){const p=atTarget(id,new Date(ms));if(p?.usable&&atTarget(id,new Date(ms+session.minutesPerTarget*60_000))?.usable)samples.push(p);}
      const first=samples[0];if(!first)return null;
      // Use the first continuous viewing window, not a later reappearance.
      const gap=samples.findIndex((p,i)=>i>0&&p.date.getTime()-samples[i-1].date.getTime()>15*60_000);
      const last=samples[gap<0?samples.length-1:gap-1];
      const urgency=last.date.getTime()-current.getTime()<45*60_000?55:0;
      return {...first,score:first.score,urgent:!!urgency,latestStart:last.date.getTime()};
    }).filter(Boolean) as (NonNullable<ReturnType<typeof atTarget>> & {urgent:boolean;latestStart:number})[];
    if(!options.length)break;
    options.sort((a,b)=>a.date.getTime()-b.date.getTime()||a.latestStart-b.latestStart||b.score-a.score);
    const best=options[0];
    steps.push({...best,reason:best.urgent?"Observe before its usable window closes":best.moonlight>=1?"Moonlit sky: prioritize bright detail":best.lunar?"Moon is up and safely separated from the Sun":"Well placed at this time"});
    remaining.splice(remaining.indexOf(best.id),1);
    current=new Date(best.date.getTime()+session.minutesPerTarget*60_000);
  }
  for(const id of remaining){const p=atTarget(id,start);steps.push({id,name:p?.name??id,date:null,alt:p?.alt??-90,az:p?.az??0,separation:p?.separation??null,moonlight:p?.moonlight??0,lunar:id.startsWith("moon:"),reason:!p?"Catalog entry unavailable":steps.length*session.minutesPerTarget>=session.durationMinutes?"Not enough time: lengthen this session":`No usable slot: needs ${p.minimum}° altitude and ${p.lunar?"distance from the Sun":"a darker sky"}`});}
  return steps;
}

export function starPlanningTarget(star:Star):UnifiedTarget {
  const name=star.name||`${star.bayer||star.flamsteed||star.id}${star.constellation?` ${star.constellation}`:""}`;
  return {id:`star:${star.id}`,name,displayName:name,mag:star.mag,ra:star.ra,dec:star.dec,con:star.constellation||"",category:"Star",categoryShort:"Star",source:"binocular",desc:star.magnitudeNote??"Position and magnitude from the bundled Bright Star Catalogue. Individual stellar brightness can vary."};
}
