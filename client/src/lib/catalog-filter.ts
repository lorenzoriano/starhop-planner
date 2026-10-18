import { SiderealTime } from 'astronomy-engine';
import { angularDistance, eqToHorizontal, type UnifiedTarget } from './astronomy';
import { binocularAssessment, type BinocularProfile } from './binocular-assessment';
import { createMoonSampler } from './observing-profile';
import { nightAltitudeSamples, type VisibilityWindow } from './target-visibility';

export interface CatalogConstraints { minAltitude:number; minMoonDistance:number; transitHours:number|null; maxRating:number; }
export function hoursFromTransit(ra:number,lon:number,date:Date) {
  const angle=((SiderealTime(date)*15+lon-ra+180)%360+360)%360-180;
  return Math.abs(angle)/15;
}
/** All constraints must hold at the same moment. Five-minute samples plus exact culminations. */
export function catalogMatches(target:UnifiedTarget,lat:number,lon:number,window:VisibilityWindow,constraints:CatalogConstraints,profile:BinocularProfile,skyBrightness:number,moonAt=createMoonSampler(lat,lon)) {
  if(!window.ok||!window.segments.length)return null;
  const candidates=nightAltitudeSamples(target.ra,target.dec,lat,lon,window).flatMap(segment=>{
    const count=Math.max(1,Math.ceil((+segment.end-+segment.start)/300000));
    const times=new Set([...segment.samples.map(s=>+s.date),...Array.from({length:count+1},(_,i)=>+segment.start+(+segment.end-+segment.start)*i/count)]);
    return Array.from(times).map(ms=>new Date(ms));
  });
  let best:ReturnType<typeof evaluate>|null=null;
  function evaluate(at:Date) {
    const {alt,az}=eqToHorizontal(target.ra,target.dec,lat,lon,at),moon=moonAt(at),separation=angularDistance(target.ra,target.dec,moon.ra,moon.dec);
    const transitDistance=hoursFromTransit(target.ra,lon,at),assessment=binocularAssessment(target,profile,{alt,moon,skyBrightness});
    return {target,at,alt,az,moon,separation,transitDistance,assessment,score:alt-assessment.glow*(/galaxy|nebula/i.test(target.category)?14:6)};
  }
  for(const at of candidates){
    const row=evaluate(at);
    if(row.alt<constraints.minAltitude||row.separation<constraints.minMoonDistance||constraints.transitHours!==null&&row.transitDistance>constraints.transitHours||row.assessment.rating>constraints.maxRating)continue;
    if(!best||row.score>best.score)best=row;
  }
  return best;
}
