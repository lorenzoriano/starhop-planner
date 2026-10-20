import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTICAL_PROFILES,
  isOpticalProfile,
  loadOpticalProfileSelection,
  loadUserOpticalProfiles,
  OPTICAL_PROFILE_PRESETS,
  OPTICAL_PROFILES_STORAGE_KEY,
  OPTICAL_SELECTION_STORAGE_KEY,
  opticalProfileSelectionSchema,
  saveOpticalProfileSelection,
  saveUserOpticalProfiles,
} from "../optical-profiles";

describe("optical profiles", () => {
  it("provides separate finder and eyepiece defaults and named orientation presets", () => {
    expect(DEFAULT_OPTICAL_PROFILES.finder.fov).toBe(5);
    expect(DEFAULT_OPTICAL_PROFILES.eyepiece.rotation).toBe(180);
    expect(OPTICAL_PROFILE_PRESETS.find(profile => profile.id === "binocularnormalKITE14x50")?.fov).toBe(3.7);
    expect(OPTICAL_PROFILE_PRESETS.find(profile => profile.id === "refractor-diagonal")).toMatchObject({ mirrored: true, rotation: 0 });
    expect(OPTICAL_PROFILE_PRESETS.find(profile => profile.id === "Newtonian")).toMatchObject({ mirrored: false, rotation: 180 });
  });

  it("validates field and orientation values", () => {
    const valid = OPTICAL_PROFILE_PRESETS[0];
    expect(isOpticalProfile(valid)).toBe(true);
    expect(isOpticalProfile({ ...valid, fov: Infinity })).toBe(false);
    expect(isOpticalProfile({ ...valid, rotation: 45 })).toBe(false);
    expect(isOpticalProfile({ ...valid, reticle: "none" })).toBe(false);
  });

  it("loads only valid saved profiles and keeps user profiles through save/load", () => {
    let value = JSON.stringify([OPTICAL_PROFILE_PRESETS[0], { ...OPTICAL_PROFILE_PRESETS[1], id: "custom", name: "My finder" }, { name: "bad", fov: -1 }]);
    const storage = { getItem: (key: string) => key === OPTICAL_PROFILES_STORAGE_KEY ? value : null, setItem: (_key: string, next: string) => { value = next; } };
    expect(loadUserOpticalProfiles(storage)).toMatchObject([{ id: "nakedeye", builtIn: false }, { id: "custom", name: "My finder", builtIn: false }]);
    const custom = { ...OPTICAL_PROFILE_PRESETS[1], id: "custom", name: "My measured finder", fov: 4.4, fovSource: "measured" as const, builtIn: false };
    saveUserOpticalProfiles([OPTICAL_PROFILE_PRESETS[0], custom], storage);
    expect(loadUserOpticalProfiles(storage)).toEqual([custom]);
  });

  it("validates and persists the active stage and its separate finder and eyepiece profiles", () => {
    let value: string | null = null;
    const storage = {
      getItem: (key: string) => key === OPTICAL_SELECTION_STORAGE_KEY ? value : null,
      setItem: (key: string, next: string) => { if (key === OPTICAL_SELECTION_STORAGE_KEY) value = next; },
    };
    const selection = {
      stage: "eyepiece" as const,
      profiles: {
        finder: { ...DEFAULT_OPTICAL_PROFILES.finder, fov: 4.8 },
        eyepiece: { ...DEFAULT_OPTICAL_PROFILES.eyepiece, id: "my-eyepiece", name: "Wide field", fov: 0.8, mirrored: true, rotation: 0 as const },
      },
    };
    expect(opticalProfileSelectionSchema.safeParse(selection).success).toBe(true);
    saveOpticalProfileSelection(selection, storage);
    expect(loadOpticalProfileSelection(storage)).toEqual(selection);
    value = JSON.stringify({ ...selection, stage: "all-sky" });
    expect(opticalProfileSelectionSchema.safeParse(JSON.parse(value)).success).toBe(false);
    expect(loadOpticalProfileSelection(storage).stage).toBe("finder");
  });
});
