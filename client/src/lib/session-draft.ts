import { formatInTimeZone } from "date-fns-tz";
import tzLookup from "tz-lookup";
import { resolveLocalMoment, resolvePlannedMoment, type NightItem } from "./session";
import type { ObservingSession } from "./session-planner";

export type SessionDraft = {
  name:string; date:string; time:string; lat:string; lon:string;
  place:string; duration:string; perTarget:string;
};
export function sessionDraft(session:ObservingSession):SessionDraft {
  const zone=tzLookup(session.lat,session.lon),at=new Date(session.startAt);
  return {name:session.name,date:formatInTimeZone(at,zone,"yyyy-MM-dd"),time:formatInTimeZone(at,zone,"HH:mm"),lat:String(session.lat),lon:String(session.lon),place:session.locationName,duration:String(session.durationMinutes),perTarget:String(session.minutesPerTarget)};
}
export function resolveSessionDraft(draft:SessionDraft,previous?:ObservingSession) {
  const lat=Number(draft.lat),lon=Number(draft.lon),durationMinutes=Number(draft.duration),minutesPerTarget=Number(draft.perTarget);
  if (!draft.name.trim() || draft.name.trim().length>100 || draft.place.trim().length>100 || !draft.lat.trim() || !draft.lon.trim() || !Number.isFinite(lat) || Math.abs(lat)>90 || !Number.isFinite(lon) || Math.abs(lon)>180 || !Number.isInteger(durationMinutes) || durationMinutes<30 || durationMinutes>720 || !Number.isInteger(minutesPerTarget) || minutesPerTarget<5 || minutesPerTarget>60) return {ok:false as const,error:"Enter a name, valid coordinates, a 30–720 minute night and 5–60 minutes per target. Changes have not been saved."};
  const zone=tzLookup(lat,lon);
  if (!resolveLocalMoment(draft.date,draft.time,zone)) return {ok:false as const,error:"Choose a valid local date and time. That time may be skipped by the daylight-saving clock change. Changes have not been saved."};
  const at=resolvePlannedMoment(draft.date,draft.time,zone,previous?.startAt);
  return {ok:true as const,value:{name:draft.name.trim(),startAt:at.toISOString(),lat,lon,locationName:draft.place.trim(),durationMinutes,minutesPerTarget}};
}
/** Reusing a saved night's targets starts fresh; migrating unscheduled notes keeps records. */
export function reuseNightItems(items:NightItem[],keepRecords:boolean,now=new Date()):NightItem[] {
  return items.map(item=>keepRecords?{...item}:{id:item.id,addedAt:now.toISOString(),notes:""});
}
