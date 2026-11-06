import { z } from "zod";
import * as Astro from "astronomy-engine";
import tzLookup from "tz-lookup";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nightListSchema, stripStaleJourneyTags, type NightItem } from "./session";
import { starSearchAliases } from "./stellar-search";
import { eqToHorizontal, angularDistance, type UnifiedTarget, type Star } from "./astronomy";
import { moonState, lunarFeatures, lunarFrame, projectLunarFeature } from "./moon";
import { compassWord, geometricFromApparent, horizonLookup, type HorizonInput } from "./horizon/profile";
import { MIN_ALT, darkEnough, isStellarCategory, moonCategoryOfCategory, moonVerdict, plannerMoonWeight } from "./sky-feasibility";

/** The Planner schedules by the shared sky model's "possible" rule (lib/sky-feasibility.ts): 15° up, bright stars from civil dusk. */
export const PLANNER_RULE = "possible" as const;
const minimumFor = (lunar: boolean) => lunar ? MIN_ALT.lunar : MIN_ALT[PLANNER_RULE];

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
/** Every journey key the Planner's nights carry (sorted, deduplicated). */
export const plannerJourneyKeys=(store:PlannerStore)=>Array.from(new Set(store.sessions.flatMap(s=>s.items.flatMap(i=>i.journeyKey?[i.journeyKey]:[])))).sort();
/** stripStaleJourneyTags over every night; returns `store` itself when every journey tag still resolves. */
export function stripStalePlannerJourneyTags(store:PlannerStore,resolves:(key:string)=>boolean):PlannerStore {
  let changed=false;
  const sessions=store.sessions.map(session=>{const items=stripStaleJourneyTags(session.items,resolves);if(items===session.items)return session;changed=true;return {...session,items};});
  return changed?{...store,sessions}:store;
}
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

type Candidate = { id:string;name:string;date:Date;alt:number;az:number;separation:number|null;moonlight:number;lunar:boolean;usable:boolean;score:number;minimum:number;darkEnough:boolean;
  /** Above the minimum altitude but behind the local skyline (false when no horizon is known). */
  blocked:boolean };
export type SequenceStep = { id:string; name:string; date:Date|null; alt:number; az:number; separation:number|null; moonlight:number; reason:string; lunar:boolean;
  /** Slot length in minutes when it differs from the session's minutes per target (journey stops keep the journey's pace). */
  minutes?:number;
  /** Set on journey items held at the journey's own time (one locked block per journey, in stop order). */
  journey?:{key:string;stop?:number;plannedAt:Date};
};
/** Slot length of a scheduled step in minutes. */
export const stepMinutes=(step:Pick<SequenceStep,"minutes">,session:Pick<ObservingSession,"minutesPerTarget">)=>step.minutes??session.minutesPerTarget;

type JourneySlot={id:string;key:string;stop?:number;plannedAt:Date;minutes:number;inSession:boolean};
/**
 * Journey items the Planner holds at the journey's own times: items with a journeyKey and a plannedAt (added with
 * "Add all stops to tonight's plan"). Each journey is one locked block in stop order; a stop lasts until the next stop
 * of its journey (never longer than the session's minutes per target), the last one as long as the block's typical stop.
 * `inSession` is false when the stop's time falls outside the session (it is then listed as not fitting, never moved).
 */
export function journeySlots(session:Pick<ObservingSession,"startAt"|"durationMinutes"|"minutesPerTarget"|"items">):JourneySlot[] {
  const start=+new Date(session.startAt),end=start+session.durationMinutes*60_000;
  const groups=new Map<string,{id:string;stop?:number;at:number;index:number}[]>();
  session.items.forEach((item,index)=>{
    if(item.observedAt||!item.journeyKey||!item.plannedAt)return;
    const at=Date.parse(item.plannedAt);if(!Number.isFinite(at))return;
    const list=groups.get(item.journeyKey)??[];list.push({id:item.id,stop:item.journeyStop,at,index});groups.set(item.journeyKey,list);
  });
  const slots:JourneySlot[]=[];
  for(const [key,list] of Array.from(groups)){
    // Story order first; times never run backwards inside a block.
    list.sort((a,b)=>(a.stop??Infinity)-(b.stop??Infinity)||a.at-b.at||a.index-b.index);
    for(let i=1;i<list.length;i++)if(list[i].at<list[i-1].at)list[i]={...list[i],at:list[i-1].at};
    const gaps=list.slice(1).map((entry,i)=>(entry.at-list[i].at)/60_000).filter(gap=>gap>0).sort((a,b)=>a-b);
    const typical=gaps.length?gaps[Math.floor(gaps.length/2)]:session.minutesPerTarget;
    list.forEach((entry,i)=>{
      const gap=i+1<list.length?(list[i+1].at-entry.at)/60_000:typical;
      const minutes=Math.max(1,Math.min(session.minutesPerTarget,Math.round(gap)||1));
      slots.push({id:entry.id,key,stop:entry.stop,plannedAt:new Date(entry.at),minutes,inSession:entry.at>=start&&entry.at<end});
    });
  }
  return slots;
}
/** A session's longest span (plannerStoreSchema durationMinutes max). */
export const MAX_SESSION_MINUTES=720;
/**
 * The session times that hold journey `key`'s whole block (every timed stop, first to last slot end), so moving or
 * extending the session for one stop never pushes the journey's other stops out. The session's own span is kept when
 * it fits; past MAX_SESSION_MINUTES the start moves later just enough to hold the block (never after its first stop),
 * and `clamped` says the journey's last stops still fall outside. Null when the session holds no timed stop of `key`.
 */
export function journeyBlockFit(session:Pick<ObservingSession,"startAt"|"durationMinutes"|"minutesPerTarget"|"items">,key:string):{startAt:Date;durationMinutes:number;clamped:boolean}|null {
  const slots=journeySlots(session).filter(slot=>slot.key===key);
  if(!slots.length)return null;
  const start=+new Date(session.startAt),end=start+session.durationMinutes*60_000,max=MAX_SESSION_MINUTES*60_000;
  const first=Math.min(...slots.map(slot=>+slot.plannedAt)),last=Math.max(...slots.map(slot=>+slot.plannedAt+slot.minutes*60_000));
  let nextStart=Math.min(start,first);
  const nextEnd=Math.max(end,last);
  if(nextEnd-nextStart>max)nextStart=Math.min(first,Math.max(nextStart,last-max));
  const minutes=Math.ceil((Math.min(nextEnd,nextStart+max)-nextStart)/60_000);
  return {startAt:new Date(nextStart),durationMinutes:Math.max(30,Math.min(MAX_SESSION_MINUTES,minutes)),clamped:last-nextStart>max};
}
/** Keep the legend, colour assignment and numbered slots in scheduled order. */
export function sessionTimelineItems(items:NightItem[],steps:SequenceStep[]):NightItem[] {
  const scheduled=steps.filter(step=>step.date).slice().sort((a,b)=>+a.date!-+b.date!).map(step=>items.find(item=>item.id===step.id)).filter((item):item is NightItem=>!!item);
  return [...scheduled,...items.filter(item=>!scheduled.some(placed=>placed.id===item.id))];
}
/** Position of a session item: `alt` as the Planner compares it with its minimum (lunar items use the Moon's apparent
 *  altitude, as suggestSequence does) and `geometric` for comparisons with the skyline. */
function itemPosition(session:Pick<ObservingSession,"lat"|"lon">,target:Pick<UnifiedTarget,"ra"|"dec">|undefined) {
  return (ms:number)=>{
    if(target){const p=eqToHorizontal(target.ra,target.dec,session.lat,session.lon,new Date(ms));return {...p,geometric:p.alt};}
    const moon=moonState(session.lat,session.lon,new Date(ms));
    return {alt:moon.alt,az:moon.az,geometric:geometricFromApparent(moon.alt)};
  };
}
/**
 * Plain-words reason when the local skyline is what hides an item between `from` and `to`: it is above its minimum
 * altitude (15°, Moon 5°) but behind the hills. "Behind the hills to the west until 23:10" names when it clears
 * (minute accuracy, possibly after `to`); "Stays behind the hills to the west tonight" when it drops below the minimum
 * first. Null when no horizon is known or the skyline never hides it in that span.
 */
export function skylineHoldReason(session:Pick<ObservingSession,"lat"|"lon">,id:string,target:Pick<UnifiedTarget,"ra"|"dec">|undefined,horizon:HorizonInput,from:Date,to:Date):string|null {
  const skyline=horizonLookup(horizon);
  if(!skyline||(!target&&!id.startsWith("moon:")))return null;
  const position=itemPosition(session,target),minimum=minimumFor(id.startsWith("moon:"));
  const step=5*60_000;
  let blockedAt:number|null=null,az=0;
  for(let ms=+from;ms<=+to;ms+=step){const p=position(ms);if(p.alt>=minimum&&p.geometric<skyline(p.az)){blockedAt=ms;az=p.az;break;}}
  if(blockedAt===null)return null;
  const where=`the hills to the ${compassWord(az)}`;
  const clear=(ms:number)=>{const p=position(ms);return p.alt>=minimum&&p.geometric>=skyline(p.az);};
  for(let ms=blockedAt+step;ms<=blockedAt+16*3600_000;ms+=step){
    if(clear(ms)){
      let lo=ms-step,hi=ms;
      while(hi-lo>30_000){const mid=(lo+hi)/2;if(clear(mid))hi=mid;else lo=mid;}
      return `Behind ${where} until ${formatInTimeZone(new Date(Math.ceil(hi/60_000)*60_000),sessionTimezone(session),"HH:mm")}`;
    }
    if(position(ms).alt<minimum)break;
  }
  return `Stays behind ${where} tonight`;
}
/**
 * Best order and times for a night's targets. `horizon` is the session site's local horizon: a target is then usable
 * only when it is also clear of the skyline (alt ≥ max(minimum, skyline at its azimuth)); omitted keeps the flat rule.
 */
export function suggestSequence(session:ObservingSession,targets:UnifiedTarget[],skyBrightness=21.6,horizon?:HorizonInput):SequenceStep[] {
  const start=new Date(session.startAt),end=new Date(start.getTime()+session.durationMinutes*60_000);
  // Journey stops added with their times stay at those times, in story order, as one block per journey.
  const locked=journeySlots(session),lockedIds=new Set(locked.map(slot=>slot.id));
  const remaining=session.items.filter(i=>!i.observedAt&&!lockedIds.has(i.id)).map(i=>i.id);
  const steps:SequenceStep[]=[];
  const moonCache=new Map<number,ReturnType<typeof moonState>>();
  const frameCache=new Map<number,ReturnType<typeof lunarFrame>>();
  const targetCache=new Map<string,Candidate>();
  const targetMap=new Map(targets.map(t=>[t.id,t]));
  const skyline=horizonLookup(horizon);
  const atTarget=(id:string,at:Date):Candidate|null => {
    const key=`${id}:${at.getTime()}`; if(targetCache.has(key))return targetCache.get(key)!;
    let moon=moonCache.get(at.getTime()); if(!moon){moon=moonState(session.lat,session.lon,at);moonCache.set(at.getTime(),moon);}
    const lunar=id.startsWith("moon:"), feature=lunarFeatures.find(f=>`moon:${f.id}`===id),target=targetMap.get(id);
    if(!feature&&!target)return null;
    const pos=lunar?{alt:moon.alt,az:moon.az}:eqToHorizontal(target!.ra,target!.dec,session.lat,session.lon,at);
    const minimum=minimumFor(lunar);
    let lunarVisible=true;
    if(feature){let frame=frameCache.get(at.getTime());if(!frame){frame=lunarFrame(session.lat,session.lon,at);frameCache.set(at.getTime(),frame);}const p=projectLunarFeature(feature,frame);lunarVisible=p.visible&&p.lit;}
    const dark=lunar?moon.sunSeparation>=20&&lunarVisible:darkEnough(moon.sunAlt,{stellar:isStellarCategory(target!.category),mag:target!.mag},PLANNER_RULE);
    const separation=target?angularDistance(target.ra,target.dec,moon.ra,moon.dec):null;
    // Site-sky K–S brightening from the shared Moon verdict (the Planner weighs it rather than rejecting).
    const brightening=target?moonVerdict({alt:pos.alt,separation:separation!,category:moonCategoryOfCategory(target.category)},moon,skyBrightness).brightening:0;
    // The skyline compares geometric altitudes; the Moon's altitude from moonState is apparent.
    const blocked=!!skyline&&pos.alt>=minimum&&(lunar?geometricFromApparent(pos.alt):pos.alt)<skyline(pos.az);
    const usable=pos.alt>=minimum&&dark&&!blocked;
    const score=pos.alt-brightening*(target?plannerMoonWeight(target.category,target.mag):6);
    const point={id,name:feature?.name??target!.displayName,date:at,alt:pos.alt,az:pos.az,separation:separation,moonlight:brightening,lunar,usable,score,minimum,darkEnough:dark,blocked};
    targetCache.set(key,point); return point;
  };
  const duration=session.minutesPerTarget*60_000,quantum=5*60_000;
  // Compute real descending altitude crossings beyond the session, rather than
  // mistaking the session cutoff for a setting deadline.
  // With a local horizon the window also closes when the target goes behind the skyline.
  const closes=new Map<string,number>(),closesBehind=new Map<string,number>();
  for(const id of remaining){
    const target=targetMap.get(id),lunar=id.startsWith('moon:');
    const position=itemPosition(session,target);
    const minimum=minimumFor(lunar);
    const up=(ms:number)=>{const p=position(ms);return p.alt>=minimum&&(!skyline||p.geometric>=skyline(p.az));};
    let previous=up(+start),closing=Infinity;
    for(let ms=+start+15*60_000;ms<=+start+26*3600_000;ms+=15*60_000){
      const next=up(ms);
      if(previous&&!next){let lo=ms-15*60_000,hi=ms;for(let n=0;n<12;n++){const mid=(lo+hi)/2;if(up(mid))lo=mid;else hi=mid;}closing=hi;break;}
      previous=next;
    }
    closes.set(id,closing);
    if(skyline&&Number.isFinite(closing)){const p=position(closing);if(p.alt>=minimum)closesBehind.set(id,p.az);}
  }
  const ids=remaining.slice().sort((a,b)=>closes.get(a)!-closes.get(b)!||a.localeCompare(b));
  // Free targets fit around the journey blocks.
  const busy=locked.filter(slot=>slot.inSession).map(slot=>({start:+slot.plannedAt,end:+slot.plannedAt+slot.minutes*60_000}));
  const overlapsBusy=(from:number,to:number)=>busy.some(b=>from<b.end&&to>b.start);
  // Journey items without a time (older data) still keep story order: a stop waits for the earlier stops of its journey
  // that can be scheduled at all.
  const itemOf=new Map(session.items.map(item=>[item.id,item]));
  const usableSomewhere=(id:string)=>{for(let ms=+start;ms+duration<=+end;ms+=quantum){if(atTarget(id,new Date(ms))?.usable&&atTarget(id,new Date(ms+duration))?.usable)return true;}return false;};
  const before=ids.map((id,i)=>{
    const item=itemOf.get(id);if(!item?.journeyKey)return BigInt(0);
    let mask=BigInt(0);
    ids.forEach((other,j)=>{
      const o=itemOf.get(other);
      if(j===i||!o?.journeyKey||o.journeyKey!==item.journeyKey)return;
      const earlier=(o.journeyStop??Infinity)<(item.journeyStop??Infinity)||(o.journeyStop===item.journeyStop&&session.items.indexOf(o)<session.items.indexOf(item));
      if(earlier&&usableSomewhere(other))mask|=BigInt(1)<<BigInt(j);
    });
    return mask;
  });
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
        if((plan.mask&before[i])!==before[i]||overlapsBusy(ms,ms+duration))continue;
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
    const target=targetMap.get(candidate.id);
    // Waited for the target to climb out from behind the hills.
    const heldBySkyline=skyline&&+candidate.date>+start&&atTarget(candidate.id,start)?.blocked?skylineHoldReason(session,candidate.id,target,horizon,start,candidate.date):null;
    const behindAz=closesBehind.get(candidate.id);
    const reason=heldBySkyline?heldBySkyline:!rising&&realClosing&&behindAz!==undefined?`Observe before it goes behind the hills to the ${compassWord(behindAz)}`:rising&&nearEnd?'Rising target · later for altitude; session ends soon':rising&&+candidate.date>+start+30*60_000?'Later in the session to catch this rising target higher':!rising&&realClosing?'Observe before its usable window closes':candidate.moonlight>=1?'Moonlit sky: prioritize bright detail':candidate.lunar?'Moon is up and safely separated from the Sun':'Well placed at this time';
    steps.push({...candidate,reason});remaining.splice(remaining.indexOf(candidate.id),1);
  }
  for(const slot of locked){
    const p=atTarget(slot.id,slot.plannedAt),journey={key:slot.key,...(slot.stop?{stop:slot.stop}:{}),plannedAt:slot.plannedAt};
    if(!p){steps.push({id:slot.id,name:slot.id,date:null,alt:-90,az:0,separation:null,moonlight:0,lunar:slot.id.startsWith("moon:"),reason:"Catalog entry unavailable",journey});continue;}
    steps.push({id:p.id,name:p.name,date:slot.inSession?slot.plannedAt:null,alt:p.alt,az:p.az,separation:p.separation,moonlight:p.moonlight,lunar:p.lunar,minutes:slot.minutes,journey,
      reason:slot.inSession?"At the journey’s time":"The journey visits it outside this session"});
  }
  for(const id of remaining){const p=atTarget(id,start);steps.push({id,name:p?.name??id,date:null,alt:p?.alt??-90,az:p?.az??0,separation:p?.separation??null,moonlight:p?.moonlight??0,lunar:id.startsWith("moon:"),reason:!p?"Catalog entry unavailable":steps.length*session.minutesPerTarget>=session.durationMinutes?"Not enough time: lengthen this session":(skyline?skylineHoldReason(session,id,targetMap.get(id),horizon,start,end):null)??`No usable slot: needs ${p.minimum}° altitude and ${p.lunar?"distance from the Sun":"a darker sky"}`});}
  // Scheduled steps in time order (journey blocks interleave with free targets), then the ones that do not fit.
  const scheduledSteps=steps.filter(step=>step.date).sort((a,b)=>+a.date!-+b.date!||(a.journey?.stop??0)-(b.journey?.stop??0));
  return [...scheduledSteps,...steps.filter(step=>!step.date)];
}

/** Idle spans are explicit; they are time available to rest, adapt or observe freely. */
export function sessionFreeGaps(session:ObservingSession,steps:SequenceStep[]){
 const gaps:Array<{start:Date;end:Date}>=[],end=+new Date(session.startAt)+session.durationMinutes*60_000;
 let cursor=+new Date(session.startAt);
 for(const step of steps.filter(s=>s.date).slice().sort((a,b)=>+a.date!-+b.date!)){
  if(+step.date!-cursor>=5*60_000)gaps.push({start:new Date(cursor),end:step.date!});
  cursor=Math.max(cursor,+step.date!+stepMinutes(step,session)*60_000);
 }
 if(end-cursor>=5*60_000)gaps.push({start:new Date(cursor),end:new Date(end)});
 return gaps;
}

export function starPlanningTarget(star:Star):UnifiedTarget {
  const name=star.name||`${star.bayer||star.flamsteed||star.id}${star.constellation?` ${star.constellation}`:""}`;
  return {id:`star:${star.id}`,name,displayName:name,aliases:starSearchAliases(star),mag:star.mag,ra:star.ra,dec:star.dec,con:star.constellation||"",category:"Star",categoryShort:"Star",source:"binocular",desc:star.magnitudeNote??"Position and magnitude from the bundled Bright Star Catalogue. Individual stellar brightness can vary."};
}
