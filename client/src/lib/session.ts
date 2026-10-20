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
export const nightListSchema = z
  .array(
    z.object({
      id: z.string(),
      addedAt: z.string().datetime(),
      observedAt: z.string().datetime().optional(),
      observations:z.array(z.object({at:z.string().datetime(),notes:z.string().default(""),instrument:z.string().optional()})).max(2000).optional(),
      notes: z.string(),
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
        observedAt:previous.observedAt&&item.observedAt?(previous.observedAt>item.observedAt?previous.observedAt:item.observedAt):previous.observedAt??item.observedAt});
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
