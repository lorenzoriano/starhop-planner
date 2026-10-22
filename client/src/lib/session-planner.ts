import { z } from "zod";
import * as Astro from "astronomy-engine";
import tzLookup from "tz-lookup";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nightListSchema, type NightItem } from "./session";
import { starSearchAliases } from "./stellar-search";
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
/** Keep the legend, colour assignment and numbered slots in scheduled order. */
export function sessionTimelineItems(items:NightItem[],steps:SequenceStep[]):NightItem[] {
  const scheduled=steps.filter(step=>step.date).slice().sort((a,b)=>+a.date!-+b.date!).map(step=>items.find(item=>item.id===step.id)).filter((item):item is NightItem=>!!item);
  return [...scheduled,...items.filter(item=>!scheduled.some(placed=>placed.id===item.id))];
}
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
  const duration=session.minutesPerTarget*60_000,quantum=5*60_000;
  // Compute real descending altitude crossings beyond the session, rather than
  // mistaking the session cutoff for a setting deadline.
  const closes=new Map<string,number>();
  for(const id of remaining){
    const target=targetMap.get(id);
    const altitude=(ms:number)=>target?eqToHorizontal(target.ra,target.dec,session.lat,session.lon,new Date(ms)).alt:moonState(session.lat,session.lon,new Date(ms)).alt;
    const minimum=id.startsWith('moon:')?5:15;
    let previous=altitude(+start),closing=Infinity;
    for(let ms=+start+15*60_000;ms<=+start+26*3600_000;ms+=15*60_000){
      const next=altitude(ms);
      if(previous>=minimum&&next<minimum){let lo=ms-15*60_000,hi=ms;for(let n=0;n<12;n++){const mid=(lo+hi)/2;if(altitude(mid)>=minimum)lo=mid;else hi=mid;}closing=hi;break;}
      previous=next;
    }
    closes.set(id,closing);
  }
  const ids=remaining.slice().sort((a,b)=>closes.get(a)!-closes.get(b)!||a.localeCompare(b));
  type Plan={mask:bigint;score:number;slots:Candidate[]};
  // Joint time/order search. Waiting is a real alternative, so packed sessions
  // can reorder rising objects and long sessions can use higher later slots.
  // Small sessions are exact; large lists use a bounded beam to keep UI work finite.
  const beam=ids.length<=10?2**ids.length:128;
  const grid=Array.from({length:Math.floor(session.durationMinutes/5)+1},()=>new Map<bigint,Plan>());
  grid[0].set(BigInt(0),{mask:BigInt(0),score:0,slots:[]});
  let best:Plan=grid[0].get(BigInt(0))!;
  const put=(index:number,plan:Plan)=>{if(index>=grid.length)return;const previous=grid[index].get(plan.mask);if(!previous||plan.score>previous.score)grid[index].set(plan.mask,plan);};
  for(let tick=0;tick<grid.length;tick++){
    let states=Array.from(grid[tick].values());if(states.length>beam)states=states.sort((a,b)=>b.score-a.score).slice(0,beam);
    const ms=+start+tick*quantum;
    for(const plan of states){
      if(plan.score>best.score)best=plan;
      if(tick+1<grid.length)put(tick+1,plan);
      if(ms+duration>+end)continue;
      for(let i=0;i<ids.length;i++){
        const bit=BigInt(1)<<BigInt(i);if(plan.mask&bit)continue;
        const candidate=atTarget(ids[i],new Date(ms));
        if(!candidate?.usable||!atTarget(ids[i],new Date(ms+duration))?.usable)continue;
        const finishTick=Math.ceil((ms+duration-+start)/quantum);
        const lowPenalty=Math.max(0,20-candidate.alt)*5;
        const settingBonus=closes.get(ids[i])!<=+end+duration?5:0;
        const score=plan.score+10000+candidate.alt-candidate.moonlight*.5-lowPenalty+settingBonus;
        put(finishTick,{mask:plan.mask|bit,score,slots:[...plan.slots,candidate]});
      }
    }
    // Earlier maps no longer participate in the search.
    grid[tick].clear();
  }
  for(const candidate of best.slots){
    const later=atTarget(candidate.id,new Date(+candidate.date+10*60_000));
    const rising=!!later&&later.alt>candidate.alt+.2;
    const nearEnd=+end-(+candidate.date+duration)<30*60_000;
    const realClosing=closes.get(candidate.id)!-(+candidate.date+duration)<45*60_000;
    const reason=rising&&nearEnd?'Rising target · later for altitude; session ends soon':rising&&+candidate.date>+start+30*60_000?'Later in the session to catch this rising target higher':!rising&&realClosing?'Observe before its usable window closes':candidate.moonlight>=1?'Moonlit sky: prioritize bright detail':candidate.lunar?'Moon is up and safely separated from the Sun':'Well placed at this time';
    steps.push({...candidate,reason});remaining.splice(remaining.indexOf(candidate.id),1);
  }
  for(const id of remaining){const p=atTarget(id,start);steps.push({id,name:p?.name??id,date:null,alt:p?.alt??-90,az:p?.az??0,separation:p?.separation??null,moonlight:p?.moonlight??0,lunar:id.startsWith("moon:"),reason:!p?"Catalog entry unavailable":steps.length*session.minutesPerTarget>=session.durationMinutes?"Not enough time: lengthen this session":`No usable slot: needs ${p.minimum}° altitude and ${p.lunar?"distance from the Sun":"a darker sky"}`});}
  return steps;
}

/** Idle spans are explicit; they are time available to rest, adapt or observe freely. */
export function sessionFreeGaps(session:ObservingSession,steps:SequenceStep[]){
 const gaps:Array<{start:Date;end:Date}>=[],end=+new Date(session.startAt)+session.durationMinutes*60_000;
 let cursor=+new Date(session.startAt);
 for(const step of steps.filter(s=>s.date).slice().sort((a,b)=>+a.date!-+b.date!)){
  if(+step.date!-cursor>=5*60_000)gaps.push({start:new Date(cursor),end:step.date!});
  cursor=+step.date!+session.minutesPerTarget*60_000;
 }
 if(end-cursor>=5*60_000)gaps.push({start:new Date(cursor),end:new Date(end)});
 return gaps;
}

export function starPlanningTarget(star:Star):UnifiedTarget {
  const name=star.name||`${star.bayer||star.flamsteed||star.id}${star.constellation?` ${star.constellation}`:""}`;
  return {id:`star:${star.id}`,name,displayName:name,aliases:starSearchAliases(star),mag:star.mag,ra:star.ra,dec:star.dec,con:star.constellation||"",category:"Star",categoryShort:"Star",source:"binocular",desc:star.magnitudeNote??"Position and magnitude from the bundled Bright Star Catalogue. Individual stellar brightness can vary."};
}
