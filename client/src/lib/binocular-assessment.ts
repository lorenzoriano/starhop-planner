import type { UnifiedTarget } from './astronomy';
import { BINOCULAR_ENTRIES } from './binocular-guide';
import type { MoonState } from './moon';
import { extinctionForTransparency, skyPresetFor } from './visibility/conditions';
import { DEFAULT_OBSERVER, estimateVisibility, extinctionCoefficient, skyBrightnessBreakdown, type SkyBreakdown } from './visibility/model';
import { angularDimensions, toVisibilityTarget } from './visibility/targets';
import type { LimitFactor, Limitation, Observer, Optics, SkyInputs, Support, VisibilityEstimate, VisibilityLevel, VisibilityTarget } from './visibility/types';

export { angularDimensions };

export const KITE_SOURCE='https://kiteoptics.com/en/apc-stabilized-14x50-ed-li-ion-k280048';
export interface BinocularProfile {
  magnification:number;aperture:number;fov:number;stabilized:boolean;transmission:number;
  /** How the binoculars are held; derived from `stabilized` when absent (stabilized → 'stabilized', else 'handheld'). */
  support?:Support;
}
export const KITE_14X50:BinocularProfile={magnification:14,aperture:50,fov:3.7,stabilized:true,transmission:.86};
export const FIT_LABELS=['Excellent binocular target','Worthwhile in binoculars','Challenging in binoculars','Telescope more rewarding'] as const;
export type FitRating=0|1|2|3;
export interface AssessmentContext {
  /** Target altitude, degrees (default 60). */
  alt?:number;
  /** Full conditions (sky darkness, haze, elevation, Moon, Sun). When present, `moon` and `skyBrightness` are ignored. */
  sky?:SkyInputs;
  observer?:Observer;
  /** Legacy inputs: Moon (and Sun altitude) at the time, and the moonless zenith sky (default 21.6). */
  moon?:MoonState;
  skyBrightness?:number;
}
export interface BinocularResult {
  /** 0 excellent … 3 telescope more rewarding / not visible (from visibility.level: 0→0, 1–2→1, 3→2, 4→3). */
  rating:FitRating;label:string;
  /** The model's limitations, largest first (or one positive line when nothing holds it back). */
  reasons:string[];
  /** Curated impression when the guide has one, else the model's appearance sentence. */
  view:string;availability:string;exitPupil:number;
  /** Faintest star tonight (= visibility.limitingMag). */
  pointLimit:number;
  /** Mean surface brightness, mag/arcsec², for extended objects with a size. */
  surfaceBrightness:number|null;
  /** Object / sky surface brightness ratio, for extended objects with a size. */
  contrast:number|null;
  /** Magnitudes the Moon brightens the sky toward the target. */
  glow:number;
  dimensions:ReturnType<typeof angularDimensions>;
  entry:typeof BINOCULAR_ENTRIES[number]|undefined;
  visibility:VisibilityEstimate;
  /** What the estimate used, for explanations and counterfactuals. */
  inputs:{target:VisibilityTarget;optics:Optics;sky:SkyInputs;observer:Observer;alt:number};
  skyBreakdown:SkyBreakdown;
}
const entries=new Map(BINOCULAR_ENTRIES.map(e=>[e.targetId,e]));
export function averageSurfaceBrightness(mag:number,majorArcmin:number,minorArcmin:number) {
  return mag+2.5*Math.log10(Math.PI/4*majorArcmin*minorArcmin*3600);
}
export function profileName(p:BinocularProfile) {return p.magnification===14&&p.aperture===50&&Math.abs(p.fov-3.7)<.02&&p.stabilized?'KITE APC 14×50 ED':`${p.magnification}×${p.aperture} binoculars`;}
export const supportOf=(p:BinocularProfile):Support=>p.support??(p.stabilized?'stabilized':'handheld');
export const opticsOf=(p:BinocularProfile):Optics=>({aperture:p.aperture,magnification:p.magnification,fov:p.fov,transmission:p.transmission,support:supportOf(p)});
/** SkyInputs for callers that only know the zenith sky and the Moon: sea level, a normal (average) night's haze. */
export function skyInputsFrom(skyBrightness=21.6,moon?:MoonState|null):SkyInputs {
  return {
    zenithSqm:skyBrightness,elevationM:0,extinctionK:extinctionForTransparency(3,0),extinctionSource:'default',
    ...(moon?{sunAlt:moon.sunAlt,moon:{alt:moon.alt,ra:moon.ra,dec:moon.dec,phaseAngle:moon.phaseAngle,illumination:moon.illumination}}:{moon:null}),
  };
}
/** visibility level → the 0..3 fit rating the rest of the app sorts and filters on. */
export const ratingOfLevel=(level:VisibilityLevel):FitRating=>([0,1,1,2,3] as const)[level];

const visibilityTargets=new WeakMap<UnifiedTarget,VisibilityTarget>();
function visibilityTargetOf(target:UnifiedTarget) {
  let t=visibilityTargets.get(target);
  if(!t){t=toVisibilityTarget(target);visibilityTargets.set(target,t);}
  return t;
}

/** Plain names for the limitation factors (text, never colour alone). */
export const LIMIT_NAMES:Record<LimitFactor,string>={
  moon:'Moonlight','light-pollution':'Light pollution',haze:'Haze',altitude:'Height in the sky',twilight:'Twilight',steadiness:'Shaky view',
  faint:'Too faint for these binoculars','low-surface-brightness':'Light spread thin','too-small':'Very small','too-close':'Stars close together',
  'unequal-pair':'One star much fainter','unresolved-stars':'Stars too faint to pick out','larger-than-field':'Bigger than your view',
};
const CONDITION_FACTORS:ReadonlySet<LimitFactor>=new Set<LimitFactor>(['moon','light-pollution','haze','altitude','twilight','steadiness']);
export const isConditionFactor=(f:LimitFactor)=>CONDITION_FACTORS.has(f);
const CONDITION_LABELS:Partial<Record<LimitFactor,string>>={
  moon:'Better under a darker Moon',altitude:'Better when higher in the sky','light-pollution':'Dark skies strongly recommended',
  twilight:'Better after dark',haze:'Better on a clearer night',steadiness:'Better on a tripod',
};
/** Card threshold: a limitation is worth one "held back by" line from this gain (margin units). */
export const HELD_BACK_GAIN=.2;

/**
 * The level word for chips: "Good", "Not visible tonight", or "Won't split at 14×" for a double whose primary is easy
 * but whose pair the model cannot split (its level is about the split, yet the star itself is plainly visible).
 */
export function levelWord(r:BinocularResult):string {
  const v=r.visibility,t=r.inputs.target;
  if(v.level<4)return v.label;
  if(t.kind==='double'&&r.inputs.alt>0&&.4*(v.limitingMag-Math.min(t.mag,t.mag2??t.mag))>-.15)return `Won’t split at ${r.inputs.optics.magnification}×`;
  return 'Not visible tonight';
}
/** "Good tonight" / "Not visible tonight": compact badges outside the Binoculars tab. */
export const visibilityLabel=(r:BinocularResult)=>r.visibility.level<4?`${r.visibility.label} tonight`:levelWord(r);

/** One short phrase for a limitation ("Moon 62% lit, 35° away"), for cards. */
export function limitShort(l:Limitation,r:BinocularResult):string {
  const {optics,sky,alt,target}=r.inputs;
  switch(l.factor){
    case 'moon':return `Moon ${Math.round((sky.moon?.illumination??0)*100)}% lit, ${Math.round(r.skyBreakdown.moonSeparation??0)}° away`;
    case 'light-pollution':return `Light pollution (${skyPresetFor(sky.zenithSqm).label.toLowerCase()} sky)`;
    case 'haze':return 'Hazy air dims it tonight';
    case 'altitude':return alt<=0?'Below the horizon':alt<30?`Low in the sky (${Math.round(alt)}°)`:`Only ${Math.round(alt)}° up — better when higher`;
    case 'twilight':return (sky.sunAlt??-90)>-.833?'Daylight':'Twilight still brightens the sky';
    case 'steadiness':return optics.support==='handheld'?`Hand-shake at ${optics.magnification}×`:'A little shake left';
    case 'faint':return target.kind==='double'?'The fainter star is hard to see':`Very faint for ${optics.aperture} mm binoculars`;
    case 'low-surface-brightness':return 'Its light is spread thin — a faint, wide glow';
    case 'too-small':return `Tiny at ${optics.magnification}× — looks like a star`;
    case 'too-close':return r.visibility.level<=2?`Tight pair at ${optics.magnification}× — needs a steady view`:`Too close to split at ${optics.magnification}×`;
    case 'unequal-pair':return `Fainter star lost in the glare at ${optics.magnification}×`;
    case 'unresolved-stars':return 'Its stars are too faint to pick out';
    case 'larger-than-field':return 'Bigger than your view';
  }
}
/** The one limitation worth a card line, or null when nothing holds it back much (never for an Excellent view). */
export function heldBack(r:BinocularResult):Limitation|null {
  const top=r.visibility.limits[0];
  return r.visibility.level>=1&&top&&top.gain>=HELD_BACK_GAIN?top:null;
}

export function binocularAssessment(target:UnifiedTarget,p:BinocularProfile,context:AssessmentContext={}):BinocularResult {
  const entry=entries.get(target.id),dims=angularDimensions(target.size);
  const alt=context.alt??60,sky=context.sky??skyInputsFrom(context.skyBrightness??21.6,context.moon);
  const observer=context.observer??DEFAULT_OBSERVER,optics=opticsOf(p),vt=visibilityTargetOf(target);
  const visibility=estimateVisibility(vt,optics,sky,alt,observer);
  const breakdown=skyBrightnessBreakdown(sky,Math.max(alt,0),vt);
  const rating=ratingOfLevel(visibility.level);
  const extended=vt.kind!=='star'&&vt.kind!=='double'&&vt.majorArcmin!==undefined&&!Number.isNaN(target.mag)&&target.mag<90;
  const sb=extended?averageSurfaceBrightness(target.mag,vt.majorArcmin!,vt.minorArcmin??vt.majorArcmin!):null;
  const contrast=sb===null?null:Math.pow(10,.4*(visibility.skyAtTarget-sb));
  const top=visibility.limits[0];
  const label=alt<=0?'Below the horizon'
    :rating>=2&&top&&top.gain>=HELD_BACK_GAIN&&CONDITION_LABELS[top.factor]?CONDITION_LABELS[top.factor]!
    :FIT_LABELS[rating];
  const reasons=visibility.limits.length?visibility.limits.map(l=>l.text):[`${visibility.appearance}. Nothing in tonight’s conditions holds it back much.`];
  const sunAlt=sky.sunAlt;
  const availability=alt<=0?'Below the horizon':sunAlt!==undefined&&sunAlt>=0?'Daylight — plan after dark':sunAlt!==undefined&&sunAlt>-18?'Twilight — faint detail is harder':alt<15?'Very low in the sky':'Above the horizon in darkness';
  const view=entry?.impression??target.binoTip??visibility.appearance;
  return {
    rating,label,reasons,view,availability,exitPupil:p.aperture/p.magnification,pointLimit:visibility.limitingMag,
    surfaceBrightness:sb,contrast,glow:breakdown.moonDelta,dimensions:dims,entry,visibility,
    inputs:{target:vt,optics,sky,observer,alt},skyBreakdown:breakdown,
  };
}

export type ImprovementKind='moon'|'support'|'higher'|'darker-site'|'clearer'|'darkness';
export interface Improvement {kind:ImprovementKind;estimate:VisibilityEstimate;}
/**
 * "What would help": the same estimate with one input improved — the Moon down, a tripod, the target at its highest
 * (`culminationAlt`), a dark-countryside sky, a crisp night, full darkness. Only changes that raise the level are kept.
 */
export function improvements(r:BinocularResult,opts:{culminationAlt?:number}={}):Improvement[] {
  const {target,optics,sky,observer,alt}=r.inputs,now=r.visibility.level;
  if(alt<=0)return [];
  const out:Improvement[]=[];
  const tryOne=(kind:ImprovementKind,o:Optics,s:SkyInputs,a:number)=>{
    const estimate=estimateVisibility(target,o,s,a,observer);
    if(estimate.level<now)out.push({kind,estimate});
  };
  if(sky.moon&&r.skyBreakdown.moonDelta>.05)tryOne('moon',optics,{...sky,moon:null},alt);
  if(sky.sunAlt!==undefined&&sky.sunAlt>-18)tryOne('darkness',optics,{...sky,sunAlt:undefined},alt);
  if(optics.support!=='tripod')tryOne('support',{...optics,support:'tripod'},sky,alt);
  if(opts.culminationAlt!==undefined&&opts.culminationAlt>alt+5)tryOne('higher',optics,sky,opts.culminationAlt);
  if(sky.zenithSqm<21.3)tryOne('darker-site',optics,{...sky,zenithSqm:21.3},alt);
  const crisp=extinctionCoefficient(sky.elevationM,.3);
  if(sky.extinctionK>crisp+.01)tryOne('clearer',optics,{...sky,extinctionK:crisp},alt);
  return out.sort((a,b)=>a.estimate.level-b.estimate.level);
}
