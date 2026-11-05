import type { Settings } from "./session";

const has=(patch:object,key:string)=>Object.prototype.hasOwnProperty.call(patch,key);
/**
 * Apply a settings patch (planner `update()`). Changing `targetId` resets the start star and required guide stars
 * unless the same patch sets them explicitly (planBinocularHop passes the start star together with the new target);
 * in binocular mode a new `fov` also becomes the binocular field unless the patch sets `binocularFov` itself.
 */
export function applySettingsPatch(prev:Settings,patch:Partial<Settings>):Settings {
  const targetChanged=has(patch,"targetId")&&patch.targetId!==prev.targetId;
  return { ...prev, ...(targetChanged ? { startStarId: undefined, waypointIds: [] } : {}), ...patch, ...(patch.fov!==undefined&&(patch.mode??prev.mode)==="binocular"&&patch.binocularFov===undefined?{binocularFov:patch.fov}:{}) };
}
