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
  redLight: z.boolean(),
  binocularMagnification: z.number().min(5).max(40).default(10),
  binocularAperture: z.number().min(20).max(150).default(50),
  skyBrightness: z.number().min(17).max(22).default(21.6),
}).transform((settings) => {
  settings={...settings,targetId:canonicalTargetId(settings.targetId)};
  // Older releases defaulted new installs to binoculars without asking.
  // Move that implicit choice to a telescope profile once; keep later choices.
  if (!settings.instrumentSelected && settings.mode === "binocular") {
    return {
      ...settings,
      mode: "telescope" as const,
      instrumentSelected: false,
      fov: 5,
      fovHeight: 5,
      limitingMag: 8,
    };
  }
  return settings;
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  lat: 37.77,
  lon: -122.42,
  date: formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
  time: formatInTimeZone(new Date(), "America/Los_Angeles", "HH:mm"),
  timeMode: "live",
  mode: "telescope",
  instrumentSelected: false,
  fov: 5,
  fovHeight: 5,
  shape: "circle",
  limitingMag: 8,
  difficulty: "beginner",
  targetId: "M31",
  redLight: false,
  binocularMagnification: 10,
  binocularAperture: 50,
  skyBrightness: 21.6,
};
export const nightListSchema = z
  .array(
    z.object({
      id: z.string(),
      addedAt: z.string().datetime(),
      observedAt: z.string().datetime().optional(),
      notes: z.string(),
    }),
  )
  .max(1000).transform(items=>{
    const merged=new Map<string,typeof items[number]>();
    for(const item of items){
      const id=canonicalTargetId(item.id),previous=merged.get(id);
      if(!previous){merged.set(id,{...item,id});continue;}
      merged.set(id,{...previous,addedAt:previous.addedAt<item.addedAt?previous.addedAt:item.addedAt,
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
