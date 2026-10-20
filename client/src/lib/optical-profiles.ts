import type { FinderReticle } from "./finder-view";
import { z } from "zod";

export type OpticalStage = "finder" | "eyepiece";
export interface OpticalProfile {
  id: string;
  name: string;
  /** Measured or estimated apparent field width, in degrees. */
  fov: number;
  mirrored: boolean;
  rotation: 0 | 90 | 180 | 270;
  reticle: FinderReticle;
  /** Preset fields are starting estimates; user values can be marked measured. */
  fovSource?: "estimate" | "measured";
  builtIn?: boolean;
}

const preset = (id: string, name: string, fov: number, mirrored = false, rotation: OpticalProfile["rotation"] = 0, reticle: FinderReticle = "field"): OpticalProfile => ({ id, name, fov, mirrored, rotation, reticle, fovSource: "estimate", builtIn: true });

/** Common reference setups. Finder and eyepiece fields vary by the actual equipment. */
export const OPTICAL_PROFILE_PRESETS: readonly OpticalProfile[] = [
  preset("nakedeye", "Naked eye · North up, East left", 60),
  preset("binocularnormalKITE14x50", "Binoculars · KITE APC 14×50", 3.7),
  preset("straightthroughfinder", "Straight-through finder · estimate", 5, false, 0, "crosshair"),
  preset("RACI", "RACI finder · estimate", 5, false, 0, "crosshair"),
  preset("refractor-diagonal", "Refractor / SCT · 90° diagonal", 1, true),
  preset("Newtonian", "Newtonian / Dobsonian · 180°", 1, false, 180),
];

export const DEFAULT_OPTICAL_PROFILES: Record<OpticalStage, OpticalProfile> = {
  finder: { ...OPTICAL_PROFILE_PRESETS[3] },
  eyepiece: { ...OPTICAL_PROFILE_PRESETS[5] },
};

export const OPTICAL_PROFILES_STORAGE_KEY = "starhop-optical-profiles-v1";
export const OPTICAL_SELECTION_STORAGE_KEY = "starhop-optical-selection-v1";

const opticalProfileSchema = z.object({
  id: z.string(), name: z.string(), fov: z.number().finite().gt(0).max(180), mirrored: z.boolean(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  reticle: z.enum(["field", "telrad", "rigel", "crosshair"]),
  fovSource: z.enum(["estimate", "measured"]).optional(), builtIn: z.boolean().optional(),
});
export const opticalProfileSelectionSchema = z.object({
  stage: z.enum(["finder", "eyepiece"]),
  profiles: z.object({ finder: opticalProfileSchema, eyepiece: opticalProfileSchema }),
});
export type OpticalProfileSelection = z.infer<typeof opticalProfileSelectionSchema>;

export function defaultOpticalProfileSelection(): OpticalProfileSelection {
  return { stage: "finder", profiles: { finder: { ...DEFAULT_OPTICAL_PROFILES.finder }, eyepiece: { ...DEFAULT_OPTICAL_PROFILES.eyepiece } } };
}

export function loadOpticalProfileSelection(storage?: Pick<Storage, "getItem">): OpticalProfileSelection {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(OPTICAL_SELECTION_STORAGE_KEY);
    if (!raw) return defaultOpticalProfileSelection();
    const parsed = opticalProfileSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultOpticalProfileSelection();
  } catch {
    return defaultOpticalProfileSelection();
  }
}

export function saveOpticalProfileSelection(selection: OpticalProfileSelection, storage?: Pick<Storage, "setItem">): void {
  try {
    const parsed = opticalProfileSelectionSchema.safeParse(selection);
    if (parsed.success) (storage ?? globalThis.localStorage)?.setItem(OPTICAL_SELECTION_STORAGE_KEY, JSON.stringify(parsed.data));
  } catch {
    // Keep the current selection usable when browser storage is unavailable or full.
  }
}

export function isOpticalProfile(value: unknown): value is OpticalProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<OpticalProfile>;
  return typeof profile.id === "string" && typeof profile.name === "string" &&
    typeof profile.fov === "number" && Number.isFinite(profile.fov) && profile.fov > 0 && profile.fov <= 180 &&
    typeof profile.mirrored === "boolean" && [0, 90, 180, 270].includes(profile.rotation as number) &&
    ["field", "telrad", "rigel", "crosshair"].includes(profile.reticle as string);
}

export function loadUserOpticalProfiles(storage?: Pick<Storage, "getItem">): OpticalProfile[] {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(OPTICAL_PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOpticalProfile).map(profile => ({ ...profile, builtIn: false })) : [];
  } catch {
    return [];
  }
}

export function saveUserOpticalProfiles(profiles: OpticalProfile[], storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(OPTICAL_PROFILES_STORAGE_KEY, JSON.stringify(profiles.filter(profile => !profile.builtIn)));
  } catch {
    // Profiles remain usable for this session if storage is unavailable or full.
  }
}

export function cloneOpticalProfile(profile: OpticalProfile, changes: Partial<OpticalProfile> = {}): OpticalProfile {
  return { ...profile, ...changes, fovSource: changes.fovSource ?? profile.fovSource ?? "estimate" };
}
