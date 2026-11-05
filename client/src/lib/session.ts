import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { canonicalTargetId } from "./catalog-identifiers";

export const settingsSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T12:00:00Z`);
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    }),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeMode: z.enum(["live", "planned"]).default("live"),
  plannedAt: z.string().datetime().optional(),
  mode: z.enum(["binocular", "telescope"]),
  instrumentSelected: z.boolean().default(false),
  fov: z.number().min(0.2).max(15),
  fovHeight: z.number().min(0.2).max(15),
  shape: z.enum(["circle", "rectangle"]),
  limitingMag: z.number().min(3).max(12),
  difficulty: z.enum(["beginner", "intermediate", "expert"]),
  targetId: z.string(),
  startStarId: z.string().regex(/^HR\d+$/).optional(),
  waypointIds:z.array(z.string().regex(/^HR\d+$/)).max(8).optional(),
  redLight: z.boolean(),
  binocularMagnification: z.number().min(5).max(40).default(14),
  binocularFov:z.number().min(.2).max(15).optional(),
  binocularAperture: z.number().min(20).max(150).default(50),
  binocularStabilized:z.boolean().default(true),
  binocularTransmission:z.number().min(.3).max(1).default(.86),
  binocularProfileVersion:z.literal(1).optional(),
  skyBrightness: z.number().min(17).max(22).default(19.0),
}).transform((settings) => {
  settings={...settings,targetId:canonicalTargetId(settings.targetId)};
  // The owner explicitly chose the KITE 14×50 as the app's default profile.
  // Migrate the old implicit / 10×50 default once; retain custom instruments.
  if(!settings.binocularProfileVersion&&(!settings.instrumentSelected||settings.mode==="binocular"&&settings.binocularMagnification===10&&settings.binocularAperture===50&&settings.fov===7))return {...settings,mode:"binocular" as const,instrumentSelected:true,binocularMagnification:14,binocularAperture:50,binocularFov:3.7,fov:3.7,fovHeight:3.7,shape:"circle" as const,binocularProfileVersion:1 as const};
  return {...settings,binocularFov:settings.binocularFov??(settings.mode==="binocular"?settings.fov:3.7),binocularProfileVersion:1 as const};
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  lat: 37.77,
  lon: -122.42,
  date: formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
  time: formatInTimeZone(new Date(), "America/Los_Angeles", "HH:mm"),
  timeMode: "live",
  mode: "binocular",
  instrumentSelected: true,
  fov: 3.7,
  fovHeight: 3.7,
  shape: "circle",
  limitingMag: 8,
  difficulty: "beginner",
  targetId: "",
  redLight: false,
  binocularMagnification: 14,
  binocularAperture: 50,
  binocularFov:3.7,
  binocularStabilized:true,
  binocularTransmission:.86,
  binocularProfileVersion:1,
  skyBrightness: 19.0,
};
/** The journey fields of a night item (Planner "Journey · stop n" badge and the stop's own planned time). */
export interface JourneyTag { journeyKey?: string; journeyStop?: number; plannedAt?: string }
/** Only the journey fields of an item (no undefined keys), to spread over a merged item. */
export const journeyTagOf = (item: JourneyTag): JourneyTag => ({
  ...(item.journeyKey ? { journeyKey: item.journeyKey } : {}), ...(item.journeyStop ? { journeyStop: item.journeyStop } : {}), ...(item.plannedAt ? { plannedAt: item.plannedAt } : {}),
});
/**
 * One merge rule for a night item's journey tag (appendNightItems, the stored-list dedupe, backup merge):
 * - an untagged item takes the incoming journey, its stop and its planned time;
 * - the same journey and stop (or a stop on only one side) fills what is missing: the stop number and, when the item
 *   has no planned time yet, the incoming one (`preferIncomingTime`: the incoming time wins when present, as a backup
 *   restore does);
 * - another journey's tag never changes an item.
 * Returns `previous` itself when nothing changes.
 */
export function mergeJourneyTag<T extends JourneyTag>(previous: T, incoming: JourneyTag, o: { preferIncomingTime?: boolean } = {}): T {
  if (!incoming.journeyKey) return previous;
  const adopt = !previous.journeyKey;
  const same = previous.journeyKey === incoming.journeyKey && (!previous.journeyStop || !incoming.journeyStop || previous.journeyStop === incoming.journeyStop);
  if (!adopt && !same) return previous;
  const journeyStop = adopt ? incoming.journeyStop : previous.journeyStop ?? incoming.journeyStop;
  const plannedAt = o.preferIncomingTime ? incoming.plannedAt ?? previous.plannedAt : previous.plannedAt ?? incoming.plannedAt;
  if (!adopt && journeyStop === previous.journeyStop && plannedAt === previous.plannedAt) return previous;
  const { journeyKey: _k, journeyStop: _s, plannedAt: _p, ...rest } = previous;
  return { ...rest, journeyKey: incoming.journeyKey, ...(journeyStop ? { journeyStop } : {}), ...(plannedAt ? { plannedAt } : {}) } as T;
}
/**
 * Drop the journey tag (journeyKey, journeyStop) of items whose journey no longer resolves (`resolves`, e.g.
 * journeys/journey-key.ts journeyKeyResolver(kb) after a KB rebuild). The items stay planned, with their planned
 * time. Returns `items` itself when every tag still resolves.
 */
export function stripStaleJourneyTags<T extends JourneyTag>(items: T[], resolves: (key: string) => boolean): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (!item.journeyKey || resolves(item.journeyKey)) return item;
    changed = true;
    const { journeyKey: _k, journeyStop: _s, ...rest } = item;
    return rest as T;
  });
  return changed ? next : items;
}
export const nightListSchema = z
  .array(
    z.object({
      id: z.string(),
      addedAt: z.string().datetime(),
      observedAt: z.string().datetime().optional(),
      observations:z.array(z.object({at:z.string().datetime(),notes:z.string().default(""),instrument:z.string().optional()})).max(2000).optional(),
      notes: z.string(),
      /** Journey this item was added from (Planner "Journey · stop n" badge); optional, older data has none. */
      journeyKey:z.string().max(500).optional(),
      /** 1-based stop number in that journey. */
      journeyStop:z.number().int().min(1).max(99).optional(),
      /** Planned start of this item (ISO), e.g. a journey stop's own time; the Planner keeps it instead of re-timing the item. Optional, older data has none. */
      plannedAt:z.string().datetime().optional(),
    }),
  )
  .max(1000).transform(items=>{
    const merged=new Map<string,typeof items[number]>();
    for(const item of items){
      const id=canonicalTargetId(item.id),previous=merged.get(id);
      if(!previous){merged.set(id,{...item,id});continue;}
      merged.set(id,{...previous,addedAt:previous.addedAt<item.addedAt?previous.addedAt:item.addedAt,
        observations:Array.from(new Map([...(previous.observations??[]),...(item.observations??[])].map(entry=>[`${entry.at}/${entry.notes}`,entry])).values()),
        notes:previous.notes&&item.notes&&previous.notes!==item.notes?`${previous.notes}\n\n${item.notes}`:previous.notes||item.notes,
        observedAt:previous.observedAt&&item.observedAt?(previous.observedAt>item.observedAt?previous.observedAt:item.observedAt):previous.observedAt??item.observedAt,
        ...journeyTagOf(mergeJourneyTag(previous,item))});
    }
    return Array.from(merged.values());
  });
export type NightItem = z.infer<typeof nightListSchema>[number];

// Reject civil times skipped by a daylight-saving change instead of displaying
// one time while calculating a different instant. A repeated fall-back hour uses
// date-fns-tz's default occurrence; the full zone is always shown in the UI.
export function resolveLocalMoment(localDate: string, localTime: string, timezone: string): Date | null {
  const local = `${localDate}T${localTime}:00`;
  const at = fromZonedTime(local, timezone);
  return Number.isFinite(at.getTime()) && formatInTimeZone(at,timezone,"yyyy-MM-dd'T'HH:mm:ss") === local ? at : null;
}

// Preserve an explicitly selected instant during a repeated fall-back hour.
// Changing the civil date/time or location invalidates this hint automatically.
export function resolvePlannedMoment(localDate: string, localTime: string, timezone: string, storedInstant?: string): Date {
  if (storedInstant) {
    const at = new Date(storedInstant);
    if (Number.isFinite(at.getTime()) && formatInTimeZone(at,timezone,"yyyy-MM-dd'T'HH:mm") === `${localDate}T${localTime}`) return at;
  }
  return fromZonedTime(`${localDate}T${localTime}:00`, timezone);
}
