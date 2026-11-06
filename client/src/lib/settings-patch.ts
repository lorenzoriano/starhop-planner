import type { Settings } from "./session";

const has=(patch:object,key:string)=>Object.prototype.hasOwnProperty.call(patch,key);
/**
 * Apply a settings patch (planner `update()`). Changing `targetId` resets the start star and required guide stars
 * unless the same patch sets them explicitly (planBinocularHop passes the start star together with the new target);
 * in binocular mode a new `fov` also becomes the binocular field unless the patch sets `binocularFov` itself.
 * `binocularSupport` and the older `binocularStabilized` stay in step (stabilized = support !== "handheld"); a patch
 * with only `binocularStabilized` keeps a tripod as a tripod. Moving the site more than ~1 km drops a manual
 * `siteElevation` (it belonged to the old site) unless the patch sets it.
 */
export function applySettingsPatch(prev:Settings,patch:Partial<Settings>):Settings {
  const targetChanged=has(patch,"targetId")&&patch.targetId!==prev.targetId;
  const next={ ...prev, ...(targetChanged ? { startStarId: undefined, waypointIds: [] } : {}), ...patch, ...(patch.fov!==undefined&&(patch.mode??prev.mode)==="binocular"&&patch.binocularFov===undefined?{binocularFov:patch.fov}:{}) };
  if(patch.binocularSupport!==undefined)next.binocularStabilized=patch.binocularSupport!=="handheld";
  else if(patch.binocularStabilized!==undefined)next.binocularSupport=patch.binocularStabilized?(prev.binocularSupport==="tripod"?"tripod":"stabilized"):"handheld";
  const moved=Math.abs(next.lat-prev.lat)>.01||Math.abs(next.lon-prev.lon)>.01;
  if(moved&&!has(patch,"siteElevation")&&next.siteElevation!=null)next.siteElevation=null;
  return next;
}
