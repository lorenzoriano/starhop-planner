import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";

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
  mode: z.enum(["binocular", "telescope"]),
  fov: z.number().min(0.2).max(15),
  fovHeight: z.number().min(0.2).max(15),
  shape: z.enum(["circle", "rectangle"]),
  limitingMag: z.number().min(3).max(12),
  difficulty: z.enum(["beginner", "intermediate", "expert"]),
  targetId: z.string(),
  redLight: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  lat: 37.77,
  lon: -122.42,
  date: formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
  time: "21:00",
  mode: "binocular",
  fov: 7,
  fovHeight: 7,
  shape: "circle",
  limitingMag: 6.5,
  difficulty: "beginner",
  targetId: "M31",
  redLight: false,
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
  .max(1000);
export type NightItem = z.infer<typeof nightListSchema>[number];
