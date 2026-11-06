import { equatorialOfDate } from "./fixed-equatorial";
import { SiderealTime } from 'astronomy-engine';
import { angularDistance, eqToHorizontal, type UnifiedTarget } from './astronomy';
import { binocularAssessment, type BinocularProfile } from './binocular-assessment';
import { createMoonSampler } from './observing-profile';
import type { SuggestionConditions } from './session-suggestions';
import { nightAltitudeSamples, type VisibilityWindow } from './target-visibility';
import { horizonLookup } from './horizon/profile';

export interface CatalogConstraints {
  minAltitude:number; minMoonDistance:number; transitHours:number|null; maxRating:number;
  /** Require the object to clear the local skyline (`conditions.horizon`) even when `minAltitude` is below 0°. A
   *  minimum altitude of 0° or more always combines with the skyline. No effect without a horizon. */
  clearOfSkyline?:boolean;
}
export function hoursFromTransit(ra:number,lon:number,date:Date,dec=0) {
  ra=equatorialOfDate(ra,dec,date).ra;
  const angle=((SiderealTime(date)*15+lon-ra+180)%360+360)%360-180;
  return Math.abs(angle)/15;
}
/** All constraints must hold at the same moment. Five-minute samples plus exact culminations. `conditions.skyAt`
 *  (the Planner's resolved sky: haze, elevation, Moon, Sun) replaces `skyBrightness` + `moonAt` for the rating.
 *  `conditions.horizon` (the site's local skyline): the minimum altitude combines with it (alt ≥ max(minimum, skyline))
 *  when the minimum is 0° or more or `clearOfSkyline` is set, and the rating says "Behind the hills" where it hides
 *  the object. Rows then carry `obstructed`. */
export function catalogMatches(target:UnifiedTarget,lat:number,lon:number,window:VisibilityWindow,constraints:CatalogConstraints,profile:BinocularProfile,skyBrightness:number,moonAt=createMoonSampler(lat,lon),conditions:SuggestionConditions={}) {
  if(!window.ok||!window.segments.length)return null;
  const candidates=nightAltitudeSamples(target.ra,target.dec,lat,lon,window).flatMap(segment=>{
    const count=Math.max(1,Math.ceil((+segment.end-+segment.start)/300000));
    const times=new Set([...segment.samples.map(s=>+s.date),...Array.from({length:count+1},(_,i)=>+segment.start+(+segment.end-+segment.start)*i/count)]);
    return Array.from(times).map(ms=>new Date(ms));
  });
  let best:ReturnType<typeof evaluate>|null=null;
  const threshold=horizonLookup(conditions.horizon);
  const needClear=!!threshold&&(constraints.clearOfSkyline||constraints.minAltitude>=0);
  function evaluate(at:Date) {
    const {alt,az}=eqToHorizontal(target.ra,target.dec,lat,lon,at),moon=moonAt(at),separation=angularDistance(target.ra,target.dec,moon.ra,moon.dec);
    const transitDistance=hoursFromTransit(target.ra,lon,at,target.dec);
    const horizonAlt=threshold?threshold(az):undefined;
    // The visibility model is the expensive part: only run it once the cheap geometric constraints hold.
    if(alt<constraints.minAltitude||needClear&&alt<horizonAlt!||separation<constraints.minMoonDistance||constraints.transitHours!==null&&transitDistance>constraints.transitHours)return null;
    const skyline=horizonAlt===undefined?{}:{horizonAlt,horizonAz:az};
    const assessment=binocularAssessment(target,profile,conditions.skyAt?{alt,sky:conditions.skyAt(at),observer:conditions.observer,...skyline}:{alt,moon,skyBrightness,observer:conditions.observer,...skyline});
    const extra:{obstructed?:boolean}=horizonAlt===undefined?{}:{obstructed:alt<horizonAlt};
    return {target,at,alt,az,moon,separation,transitDistance,assessment,score:alt-assessment.glow*(/galaxy|nebula/i.test(target.category)?14:6),...extra};
  }
  for(const at of candidates){
    const row=evaluate(at);
    if(!row||row.assessment.rating>constraints.maxRating)continue;
    if(!best||row.score>best.score)best=row;
  }
  return best;
}
