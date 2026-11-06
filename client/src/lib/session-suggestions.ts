import { binocularAssessment, type BinocularProfile } from './binocular-assessment';
import type { Observer, SkyInputs } from './visibility/types';
import { eqToHorizontal, type UnifiedTarget } from './astronomy';
import { moonState } from './moon';
import type { ObservingSession } from './session-planner';

export type SessionSuggestion = {
  target:UnifiedTarget; at:Date; alt:number; fit:number; curated:number; dark:boolean;
  visualScale:number; brightnessMargin:number; glow:number;
};

/** Full conditions for the session site, when the caller has them (the Planner's useVisibilityConditions). */
export interface SuggestionConditions { skyAt?:(at:Date)=>SkyInputs; observer?:Observer }
/**
 * Rank the visual reward for normal binoculars. Everything comfortably visible tonight (Excellent, Good or Fair:
 * fit ≤ 1) counts as one tier, ordered by the curated level and how much of the field it fills; altitude breaks
 * otherwise equal picks. Without `conditions.skyAt` the sky is `skyBrightness` with the sampled Moon.
 */
export function sessionBinocularSuggestions(session:ObservingSession, targets:UnifiedTarget[], profile:BinocularProfile, skyBrightness=19.0, moonAt=(at:Date)=>moonState(session.lat,session.lon,at), conditions:SuggestionConditions={}):SessionSuggestion[] {
  const start=+new Date(session.startAt),end=start+session.durationMinutes*60_000;
  const samples:Array<{at:Date;moon:ReturnType<typeof moonState>}>=[];
  for(let ms=start;ms<=end;ms+=15*60_000){const at=new Date(ms);samples.push({at,moon:moonAt(at)});}
  const tier=(s:SessionSuggestion)=>Math.max(1,s.fit);
  const compare=(a:SessionSuggestion,b:SessionSuggestion)=>tier(a)-tier(b)||Number(b.dark)-Number(a.dark)||a.curated-b.curated||b.visualScale-a.visualScale||b.brightnessMargin-a.brightnessMargin||a.glow-b.glow||b.alt-a.alt||a.target.name.localeCompare(b.target.name);
  const picks:SessionSuggestion[]=[];
  for(const target of targets){
    if(target.id.startsWith('star:')||target.mag>9||session.items.some(item=>item.id===target.id))continue;
    let best:SessionSuggestion|undefined;
    for(const {at,moon} of samples){
      const alt=eqToHorizontal(target.ra,target.dec,session.lat,session.lon,at).alt;
      if(alt<15)continue;
      // The fit model describes optics separately from daylight. Never suggest a
      // deep-sky target in daylight just because its optical score looks good.
      const brightStellar=/star|asterism/i.test(target.category)&&target.mag<=5;
      if(moon.sunAlt>(brightStellar?-6:-18))continue;
      const assessment=binocularAssessment(target,profile,conditions.skyAt?{alt,sky:conditions.skyAt(at),observer:conditions.observer}:{alt,moon,skyBrightness,observer:conditions.observer});
      const level=assessment.entry?.level,curated=level==='easy'?0:level==='dark'||level==='steady'?1:level==='challenge'?2:3;
      const dimensions=assessment.dimensions;
      // Patterns large enough to inspect at this power, within one field, are
      // more rewarding than a tiny unresolved glow with the same coarse rating.
      const framing=dimensions&&/cluster/i.test(target.category)?Math.min(1,profile.fov*60*.7/dimensions.major):1;
      // Clusters need surrounding field to show their boundary; bright stellar
      // patterns can use the full field because the pattern supplies its guides.
      const visualScale=dimensions?framing*Math.min(1,dimensions.major*profile.magnification/360)/Math.max(1,dimensions.major/(profile.fov*60)):0;
      const pick:SessionSuggestion={target,at,alt,fit:assessment.rating,curated,dark:moon.sunAlt<=-18,visualScale,brightnessMargin:assessment.pointLimit-target.mag,glow:assessment.glow};
      if(!best||compare(pick,best)<0)best=pick;
    }
    if(best)picks.push(best);
  }
  return picks.sort(compare);
}
