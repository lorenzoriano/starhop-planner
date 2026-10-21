import type { UnifiedTarget } from './astronomy';
import { BINOCULAR_ENTRIES } from './binocular-guide';
import type { MoonState } from './moon';
import { angularDistance } from './astronomy';
import { scatteredMoonlight } from './moon';

export const KITE_SOURCE='https://kiteoptics.com/en/apc-stabilized-14x50-ed-li-ion-k280048';
export const VISIBILITY_SOURCE='https://academic.oup.com/mnras/article/442/3/2600/1052389';
export const NELM_SOURCE='https://unihedron.com/projects/darksky/NELM2BCalc.html';
export interface BinocularProfile {magnification:number;aperture:number;fov:number;stabilized:boolean;transmission:number;}
export const KITE_14X50:BinocularProfile={magnification:14,aperture:50,fov:3.7,stabilized:true,transmission:.86};
export const FIT_LABELS=['Excellent binocular target','Worthwhile in binoculars','Challenging in binoculars','Telescope more rewarding'] as const;
export type FitRating=0|1|2|3;
export interface BinocularResult {rating:FitRating;label:string;reasons:string[];view:string;availability:string;exitPupil:number;pointLimit:number;surfaceBrightness:number|null;contrast:number|null;glow:number;dimensions:ReturnType<typeof angularDimensions>;entry:typeof BINOCULAR_ENTRIES[number]|undefined;}
const entries=new Map(BINOCULAR_ENTRIES.map(e=>[e.targetId,e]));
export function angularDimensions(size?:string) {
  if(!size)return null;const values=size.match(/\d+(?:\.\d+)?/g)?.map(Number);if(!values?.length||values[0]<=0||(values[1]??values[0])<=0)return null;
  const unit=/°|deg/i.test(size)?60:/″|arcsec|"/.test(size)?1/60:1;
  return {major:values[0]*unit,minor:(values[1]??values[0])*unit,circular:values.length===1};
}
export function averageSurfaceBrightness(mag:number,majorArcmin:number,minorArcmin:number) {
  return mag+2.5*Math.log10(Math.PI/4*majorArcmin*minorArcmin*3600);
}
export function nakedEyeLimit(sky:number) {return 7.93-5*Math.log10(Math.pow(10,4.316-sky/5)+1);}
export function profileName(p:BinocularProfile) {return p.magnification===14&&p.aperture===50&&Math.abs(p.fov-3.7)<.02&&p.stabilized?'KITE APC 14×50 ED':`${p.magnification}×${p.aperture} binoculars`;}
export function binocularAssessment(target:UnifiedTarget,p:BinocularProfile,context:{alt?:number;moon?:MoonState;skyBrightness?:number}={}):BinocularResult {
  const entry=entries.get(target.id),dims=angularDimensions(target.size),category=target.category.toLowerCase();
  const isDouble=category.includes('double'),stellar=category==='star'||isDouble;
  const diffuse=/galaxy|nebula|remnant/.test(category),globular=category.includes('globular');
  const alt=context.alt??60,sky=context.skyBrightness??21.6,moon=context.moon;
  const separation=moon?angularDistance(target.ra,target.dec,moon.ra,moon.dec):180;
  const dark=!moon||moon.sunAlt<=-18;
  const glow=moon&&dark&&alt>0?scatteredMoonlight(moon,alt,separation,sky).brightening:0;
  const effectiveSky=sky-glow,exitPupil=p.aperture/p.magnification,eyePupil=6;
  const effectiveAperture=Math.min(p.aperture,p.magnification*eyePupil);
  const extinction=alt>0?.172*(1/Math.sqrt(1-.96*Math.cos(Math.max(0,alt)*Math.PI/180)**2)-1):0;
  const pointLimit=nakedEyeLimit(effectiveSky)+5*Math.log10(effectiveAperture/eyePupil)+2.5*Math.log10(p.transmission)-extinction;
  const sb=dims&&diffuse?averageSurfaceBrightness(target.mag,dims.major,dims.minor):null;
  const contrast=sb===null?null:Math.pow(10,.4*(effectiveSky-sb));
  let rating:number=target.mag<pointLimit-3?0:target.mag<pointLimit-1.5?1:target.mag<pointLimit?2:3;
  const reasons:string[]=[];
  let view=entry?.impression??target.binoTip??(stellar?'A point of starlight; look for color and nearby patterns.':globular?'A small round glow; its individual stars usually need a telescope.':'Look for the overall shape and brightness; expect much less detail than the survey photograph.');
  if(!stellar){
    if(entry?.level==='easy')rating=Math.min(rating,1);
    if(entry?.level==='dark'||entry?.level==='steady')rating=Math.max(rating,1);
    if(entry?.level==='challenge')rating=Math.max(rating,2);
    if((entry?.minAperture??0)>p.aperture*1.3){rating=Math.max(rating,3);reasons.push(`The observing guide places this in its ${entry!.minAperture} mm aperture tier; a ${p.aperture} mm view is substantially harder.`);}
    if(diffuse&&contrast!==null){rating=Math.max(rating,contrast<.08?3:contrast<.25?2:contrast<.7?1:0);reasons.push(`Mean surface brightness ≈${sb!.toFixed(1)} mag/arcsec², compared with an estimated ${effectiveSky.toFixed(1)} mag/arcsec² sky.`);}
    if(dims){const fieldFraction=dims.major/(p.fov*60);reasons.push(`${dims.major.toFixed(1)}′ across · ${(dims.major*p.magnification/60).toFixed(1)}° apparent at ${p.magnification}× · ${Math.round(fieldFraction*100)}% of your field width.`);if(fieldFraction>1.05){rating=Math.max(rating,1);reasons.push('It extends beyond one field: sweep across it or use lower magnification.');}}
    else reasons.push('Catalog angular dimensions are missing; the size assessment is uncertain.');
    if(/planetary/.test(category)&&dims&&dims.major<3){rating=Math.max(rating,3);view='You may detect a tiny star-like spot. The disk or ring shape is a telescope goal; binoculars are mainly useful for locating the field.';}
    if(globular)reasons.push('Integrated magnitude describes the whole cluster, not the brightness of its individual stars.');
    if(category.includes('open')||category.includes('asterism'))reasons.push('The pattern and its brighter members matter more than the combined catalog magnitude.');
    if(category.includes('asterism')&&dims&&dims.major*p.magnification<60&&target.mag>=8){rating=Math.max(rating,2);reasons.push('This is a tiny, faint pattern: its members can be much fainter than the combined magnitude. Do not expect a clear star pattern at this power.');}
  }
  if(isDouble){
    if(target.sep){const apparent=target.sep*p.magnification,delta=Math.abs((target.mag2??target.mag)-target.mag),threshold=180+90*delta;
      rating=apparent>threshold*1.8?0:apparent>threshold*1.3?1:apparent>=threshold?2:3;
      if(!p.stabilized)rating=Math.min(3,rating+1);
      reasons.push(`${target.sep.toFixed(1)}″ separation becomes ${(apparent/60).toFixed(1)}′ apparent; ${delta.toFixed(1)} mag component difference. ${p.stabilized?'Stabilization helps hold the pair steady.':'Brace or mount the binoculars to try the split.'}`);
      if(target.mag2!==undefined&&target.mag2>pointLimit-.5){rating=Math.max(rating,2);reasons.push('The fainter component is near or beyond the estimated stellar limit.');}
      view=rating===3?'Enjoy the primary star and surrounding field; splitting this pair is a telescope task.':rating===2?'Try separating the pair with stabilization engaged and careful focus; the split is not assured.':entry?.impression??'A separated pair of stars; compare their brightness and colors.';
    }else{rating=Math.max(rating,2);reasons.push('Component separation is missing, so a reliable split recommendation is unavailable.');}
  }
  // A whole-disk average badly underestimates centrally concentrated bright
  // galaxies. This predicts seeing the central glow, not the low-contrast disk.
  const brightGalaxyCore=category.includes('galaxy')&&dims&&dims.major>=60&&target.mag<=4.5&&pointLimit-target.mag>=3&&effectiveSky>=18.5;
  if(brightGalaxyCore){rating=0;reasons.push('Its bright central glow is a rewarding binocular target even under a suburban sky. The outer disk is much fainter than the core and needs darker skies.');}
  if(['M31','M42','M45','NGC869','AST-Coathanger'].includes(target.id)&&sky>=20.5&&glow<.5){rating=0;if(target.id==='M31')reasons.push('The bright central glow is easier than the whole-disk average; its outer disk still needs dark skies.');}
  if(diffuse&&glow>=1){rating=Math.max(rating,2);reasons.push(`Moonlight adds ≈${glow.toFixed(1)} mag of sky glow here; look again after moonset or under a darker Moon.`);}
  if(alt>0&&alt<20){rating=Math.max(rating,2);reasons.push('Low altitude adds extinction and haze. Wait for it to climb if possible.');}
  if(!p.stabilized&&p.magnification>12&&target.mag>6){rating=Math.max(rating,2);reasons.push('At this magnification, hand shake can hide faint stars; use support.');}
  if(entry?.variable)reasons.push('Brightness varies; the catalog magnitude is not a live measurement.');
  if(stellar&&!isDouble)reasons.push(`Catalog magnitude ${target.mag.toFixed(1)}; estimated stellar limit ≈${pointLimit.toFixed(1)} under these assumptions.`);
  if(!reasons.length)reasons.push('A broad visual estimate from catalog magnitude, object class and the observing guide.');
  const availability=alt<=0?'Below the horizon':moon&&moon.sunAlt>=0?'Daylight — plan after dark':moon&&moon.sunAlt>-18?'Twilight — faint detail is harder':alt<15?'Very low in the sky':'Above the horizon in darkness';
  // Keep optical limitations distinct from temporary observing conditions.
  const baseline=moon||alt<20||sky<21.6?binocularAssessment(target,p,{alt:60,skyBrightness:21.6}).rating:rating;
  const conditionsWorse=rating>baseline&&rating>=2;
  const label=conditionsWorse&&glow>=1?'Better under a darker Moon':conditionsWorse&&alt>0&&alt<20?'Better when higher in the sky':conditionsWorse&&sky<20.5?'Dark skies strongly recommended':FIT_LABELS[Math.max(0,Math.min(3,rating)) as FitRating];
  return {rating:Math.max(0,Math.min(3,rating)) as FitRating,label,reasons,view,availability,exitPupil,pointLimit,surfaceBrightness:sb,contrast,glow,dimensions:dims,entry};
}
