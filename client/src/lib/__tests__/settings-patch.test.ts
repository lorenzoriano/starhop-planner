import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "../session";
import { applySettingsPatch } from "../settings-patch";

const prev: Settings = { ...defaultSettings, targetId: "M42", startStarId: "HR1903", waypointIds: ["HR1948"] };

describe("applySettingsPatch (planner update)", () => {
  it("resets the start star and guide stars when only the target changes", () => {
    const next = applySettingsPatch(prev, { targetId: "M45" });
    expect(next.targetId).toBe("M45");
    expect(next.startStarId).toBeUndefined();
    expect(next.waypointIds).toEqual([]);
  });
  it("keeps an explicit start star and guide stars set in the same patch as a new target (planBinocularHop)", () => {
    const next = applySettingsPatch(prev, { targetId: "M45", startStarId: "HR1165", waypointIds: [] });
    expect(next.targetId).toBe("M45");
    expect(next.startStarId).toBe("HR1165");
    expect(next.waypointIds).toEqual([]);
    expect(applySettingsPatch(prev, { targetId: "M45", waypointIds: ["HR1142"] }).waypointIds).toEqual(["HR1142"]);
  });
  it("honours an explicit undefined start star and leaves both alone when the target is unchanged", () => {
    expect(applySettingsPatch(prev, { targetId: "M45", startStarId: undefined }).startStarId).toBeUndefined();
    const same = applySettingsPatch(prev, { targetId: "M42" });
    expect(same.startStarId).toBe("HR1903");
    expect(same.waypointIds).toEqual(["HR1948"]);
    expect(applySettingsPatch(prev, { limitingMag: 7 })).toMatchObject({ startStarId: "HR1903", waypointIds: ["HR1948"], limitingMag: 7 });
  });
  it("copies a binocular fov into binocularFov unless the patch sets it", () => {
    expect(applySettingsPatch({ ...prev, mode: "binocular" }, { fov: 5 }).binocularFov).toBe(5);
    expect(applySettingsPatch({ ...prev, mode: "binocular" }, { fov: 5, binocularFov: 4 }).binocularFov).toBe(4);
    expect(applySettingsPatch({ ...prev, mode: "telescope", binocularFov: 3.7 }, { fov: 1 }).binocularFov).toBe(3.7);
    expect(applySettingsPatch({ ...prev, mode: "telescope", binocularFov: 3.7 }, { fov: 6, mode: "binocular" }).binocularFov).toBe(6);
  });
  it("planBinocularHop: the planned key matches the settings-derived key, so the result is not discarded", () => {
    // planner.tsx builds the request from `params` + {targetId, startStarId, waypointIds:[]} and discards the result
    // unless the settings after update() produce the same key (keyRef.current === key), else `computing` never clears.
    const patch: Partial<Settings> = { targetId: "M45", startStarId: "HR1165", waypointIds: [] };
    const next = applySettingsPatch(prev, patch);
    expect({ targetId: next.targetId, startStarId: next.startStarId, waypointIds: next.waypointIds }).toEqual(patch);
  });
});
