import { useMemo, type ReactNode } from 'react';
import { Binoculars } from 'lucide-react';
import * as Astro from 'astronomy-engine';
import { formatInTimeZone } from 'date-fns-tz';
import {
  appearanceLine, binocularAssessment, heldBack, improvements, isBehindSkyline, isConditionFactor, levelWord, limitShort, profileName, supportOf as profileSupport,
  KITE_SOURCE, LIMIT_NAMES, type BinocularProfile, type BinocularResult, type ImprovementKind,
} from '@/lib/binocular-assessment';
import { eqToHorizontal, type UnifiedTarget } from '@/lib/astronomy';
import { horizonLookup } from '@/lib/horizon/profile';
import { nextSkylineClear } from '@/lib/target-visibility';
import { useLocalHorizon } from '@/hooks/use-local-horizon';
import type { MoonState } from '@/lib/moon';
import type { Settings } from '@/lib/session';
import { AGE_BRACKETS, TRANSPARENCY_OPTIONS, nelmFromSqm, skyPresetFor, type ResolvedSkyInputs } from '@/lib/visibility/conditions';
import { SkyDarknessSelect } from './SkyConditions';
import type { Observer, SkyInputs, Support, VisibilityLevel } from '@/lib/visibility/types';
import './BinocularVisibility.css';

export const SUPPORT_OPTIONS:readonly {value:Support;label:string;short:string;hint:string}[]=[
  {value:'handheld',label:'Hand-held',short:'hand-held',hint:'Hand shake hides the faintest stars and blurs close pairs, more so above 10×. Bracing your elbows helps.'},
  {value:'stabilized',label:'Image-stabilized',short:'stabilized',hint:'Stabilization removes most shake: nearly as steady as a tripod.'},
  {value:'tripod',label:'Tripod / mount',short:'on a tripod',hint:'Rock-steady: you see the faintest stars and closest pairs these binoculars can show.'},
];
const supportOf=(settings:Settings)=>SUPPORT_OPTIONS.find(o=>o.value===settings.binocularSupport)??SUPPORT_OPTIONS[settings.binocularStabilized?1:0];

export function profileFromSettings(settings:Settings):BinocularProfile {
  return {magnification:settings.binocularMagnification,aperture:settings.binocularAperture,fov:settings.binocularFov,stabilized:settings.binocularStabilized,transmission:settings.binocularTransmission,support:supportOf(settings).value};
}
export function BinocularProfileControls({settings,update}:{settings:Settings;update:(patch:Partial<Settings>)=>void}) {
  const profile=profileFromSettings(settings),support=supportOf(settings);
  return <details className="binocular-profile"><summary><Binoculars size={17}/><span>{profileName(profile)}</span><small>{profile.fov}° field · {support.short}</small><span className="profile-edit">Edit optics</span></summary>
    <div className="profile-fields">
      <label>Magnification<input aria-label="Binocular magnification" type="number" min="5" max="40" value={profile.magnification} onChange={e=>{const v=Number(e.target.value);if(v>=5&&v<=40)update({binocularMagnification:v});}}/></label>
      <label>Aperture · mm<input aria-label="Binocular aperture" type="number" min="20" max="150" value={profile.aperture} onChange={e=>{const v=Number(e.target.value);if(v>=20&&v<=150)update({binocularAperture:v});}}/></label>
      <label>True field · °<input aria-label="Binocular true field" type="number" min=".2" max="15" step=".1" value={profile.fov} onChange={e=>{const v=Number(e.target.value);if(v>=.2&&v<=15)update({binocularFov:v,...(settings.mode==='binocular'?{fov:v,fovHeight:v}:{})});}}/></label>
      <label>Transmission · %<input aria-label="Binocular transmission" type="number" min="30" max="100" value={Math.round(profile.transmission*100)} onChange={e=>{const v=Number(e.target.value);if(v>=30&&v<=100)update({binocularTransmission:v/100});}}/></label>
      <SkyDarknessSelect value={settings.skyBrightness} onChange={value=>update({skyBrightness:value})}/>
      <div className="profile-choice" role="group" aria-label="How do you hold them">How do you hold them?
        <div className="choice-segments">{SUPPORT_OPTIONS.map(o=><button key={o.value} type="button" aria-pressed={support.value===o.value} onClick={()=>update({binocularSupport:o.value,binocularStabilized:o.value!=='handheld'})}>{o.label}</button>)}</div>
        <small>{support.hint}</small>
      </div>
      <div className="profile-choice quiet" role="group" aria-label="Your eyes">Your eyes (optional) · age
        <div className="choice-chips">{AGE_BRACKETS.map(o=><button key={o.value} type="button" aria-pressed={settings.observerAge===o.value} onClick={()=>update({observerAge:o.value})}>{o.label}</button>)}</div>
        <small>Eye pupils open less with age, so faint glows look a little fainter.</small>
      </div>
    </div><p>Sky darkness is your estimate, not a live measurement; change it for each site under the location. Exit pupil {(profile.aperture/profile.magnification).toFixed(2)} mm. Advice changes with your optics, altitude and moonlight.</p>
    <button className="text-action" onClick={()=>update({mode:'binocular',instrumentSelected:true,binocularMagnification:14,binocularAperture:50,binocularStabilized:true,binocularSupport:'stabilized',binocularTransmission:.86,binocularFov:3.7,fov:3.7,fovHeight:3.7,shape:'circle',binocularProfileVersion:1})}>Use KITE APC 14×50 ED defaults</button><a href={KITE_SOURCE} target="_blank" rel="noreferrer">Manufacturer specifications ↗</a>
  </details>;
}
/** Read-only outside the single setup drawer. */
export function BinocularProfileSummary({settings,onEditSetup}:{settings:Settings;onEditSetup:()=>void}) {
 const p=profileFromSettings(settings);
 return <div className="binocular-profile-summary"><Binoculars size={18}/><span>{profileName(p)} · {p.fov.toFixed(1)}° field · {supportOf(settings).short}</span><button className="text-action" type="button" onClick={onEditSetup}>Edit setup</button></div>;
}

// ───────────────────────────── visibility tonight (lib/visibility/model.ts) ─────────────────────────────

/** 5-step meter + level word ("Good"); the word carries the meaning, the meter only repeats it. */
export function VisibilityChip({result,tonight=true}:{result:BinocularResult;tonight?:boolean}) {
  const v=result.visibility,steps=4-v.level;
  const word=tonight?levelWord(result):v.label;
  return <span className={`vis-chip vis-level-${v.level}`} aria-label={`Visibility${tonight?' tonight':''}: ${word} (score ${v.score} of 100)`}>
    <span className="vis-meter" aria-hidden="true">{[0,1,2,3].map(i=><i key={i} className={i<steps?'on':''}/>)}</span>
    <strong>{word}</strong>
  </span>;
}
/** Card block: chip, what you will see, and at most one "held back by" line. Behind the hills the appearance is the
 *  one sentence about them; `clears` adds when it clears them ("22:40", or null: not before dawn). */
export function VisibilitySummary({result,reward,clears}:{result:BinocularResult;reward?:ReactNode;clears?:string|null}) {
  const held=heldBack(result);
  return <div className="vis-summary">
    {reward?<div className="vis-dims"><span className="vis-dim"><span className="reward-dim-label">How rewarding</span>{reward}</span><span className="vis-dim"><span className="reward-dim-label">Tonight</span><VisibilityChip result={result}/></span></div>:<VisibilityChip result={result}/>}
    <p className="vis-appearance">{appearanceLine(result,clears)}</p>
    {held&&<p className="vis-held"><span>Held back by</span> {limitShort(held,result)}</p>}
  </div>;
}

/** "Haze: the air is murkier…" under a "Haze" heading → "The air is murkier…". */
function withoutLead(text:string,name:string) {
  const m=/^([A-Z][a-z]+(?: [a-z]+)?): (.)/.exec(text);
  return m&&(m[1]===name||['Moonlight','Light pollution','Haze','Twilight','Daylight'].includes(m[1]))?m[2].toUpperCase()+text.slice(m[0].length):text;
}
const LEVEL_SENTENCE:Record<VisibilityLevel,string>=['Excellent','Good','Fair','Difficult','Not visible'];
const resolved=(sky:SkyInputs):Partial<ResolvedSkyInputs>=>sky as Partial<ResolvedSkyInputs>;
/** "Suburb sky · Haze: Normal (forecast) · 14×50 stabilized · elevation 14 m" */
export function conditionsSummary(sky:SkyInputs,profile:BinocularProfile):string {
  const r=resolved(sky),haze=r.transparency?TRANSPARENCY_OPTIONS[r.transparency-1].label:'Normal';
  const source=sky.extinctionSource==='forecast'?'forecast':sky.extinctionSource==='manual'?'your choice':'assumed';
  const support=SUPPORT_OPTIONS.find(o=>o.value===profileSupport(profile))!.short;
  const elevation=r.elevationSource==='unknown'||(!r.elevationSource&&sky.elevationM===0)?'sea level assumed':`elevation ${Math.round(sky.elevationM).toLocaleString()} m`;
  return `${skyPresetFor(sky.zenithSqm).label} sky · Haze: ${haze} (${source}) · ${profile.magnification}×${profile.aperture} ${support} · ${elevation}`;
}

function moonsetAfter(lat:number,lon:number,at:Date):Date|null {
  try {return Astro.SearchRiseSet(Astro.Body.Moon,new Astro.Observer(lat,lon,0),-1,at,1)?.date??null;} catch {return null;}
}
const HELP_TEXT:Record<ImprovementKind,string>={moon:'With the Moon down',darkness:'In full darkness',support:'On a tripod',higher:'When higher',
  'darker-site':'From a dark countryside site',clearer:'On a crisp, clear night',skyline:'Wait until it clears your skyline'};

interface AssessmentProps {
  target:UnifiedTarget;profile:BinocularProfile;alt:number;
  /** Legacy inputs, used when `sky` is absent. */
  moon:MoonState;skyBrightness:number;
  /** Full conditions at this moment (useVisibilityConditions().at(date)). */
  sky?:SkyInputs;observer?:Observer;
  /** Conditions at any instant (useVisibilityConditions().at): rates "Wait until it clears your skyline at 22:40"
   *  with that moment's Moon, twilight and haze. Without it that hint carries no rating. */
  skyAt?:(date:Date)=>SkyInputs;
  /** Instant, site and zone: moonset time and the target's highest altitude in "What would help". */
  at?:Date;lat?:number;lon?:number;timezone?:string;
  onEditSetup?:()=>void;compact?:boolean;
  /** Precomputed assessment (the Binoculars tab memoises one per target). */
  result?:BinocularResult;
  /** Local skyline in the target's direction (GEOMETRIC threshold) and the target's azimuth, for callers without
   *  `at`/`lat`/`lon`. With those, the site's stored horizon is used automatically (useLocalHorizon). */
  horizonAlt?:number;horizonAz?:number;
}
/** "How it will look tonight": level and appearance, the numbers behind it, what holds it back and what would help. */
export function BinocularAssessment({target,profile,alt,moon,skyBrightness,sky,observer,skyAt,at,lat,lon,timezone,onEditSetup,compact=false,result:given,horizonAlt,horizonAz}:AssessmentProps) {
  const {horizon}=useLocalHorizon(lat??Number.NaN,lon??Number.NaN);
  const time=at?+at:undefined;
  // The skyline in the target's direction at `at` (nothing new without a stored horizon).
  const skyline=useMemo(()=>{
    if(horizonAlt!==undefined)return {horizonAlt,...(horizonAz!==undefined?{horizonAz}:{})};
    const lookup=horizonLookup(horizon);
    if(!lookup||time===undefined||lat===undefined||lon===undefined)return {};
    const {az}=eqToHorizontal(target.ra,target.dec,lat,lon,new Date(time));
    return {horizonAlt:lookup(az),horizonAz:az};
  },[horizonAlt,horizonAz,horizon,time,lat,lon,target.ra,target.dec]);
  const result=useMemo(()=>given??binocularAssessment(target,profile,sky?{alt,sky,observer,...skyline}:{alt,moon,skyBrightness,observer,...skyline}),[given,target,profile,alt,sky,observer,moon,skyBrightness,skyline]);
  const v=result.visibility,{optics,sky:used,target:vt}=result.inputs;
  const culminationAlt=lat!==undefined?90-Math.abs(lat-target.dec):undefined;
  const blocked=isBehindSkyline(result);
  // Behind the hills: when it next clears them before astronomical dawn (needs the site, the instant and the horizon).
  // undefined: unknown; 'after-dawn': it stays hidden all of tonight's dark hours.
  const clears=useMemo(()=>{
    if(!blocked||!horizon||time===undefined||lat===undefined||lon===undefined)return undefined;
    const t=nextSkylineClear(target.ra,target.dec,lat,lon,new Date(time),horizon);
    return t===null?undefined:t==='after-dawn'?t:{at:t,alt:eqToHorizontal(target.ra,target.dec,lat,lon,t).alt};
  },[blocked,horizon,time,lat,lon,target.ra,target.dec]);
  const clearSky=useMemo(()=>clears&&clears!=='after-dawn'&&skyAt?skyAt(clears.at):undefined,[clears,skyAt]);
  const helps=useMemo(()=>clears==='after-dawn'?[]:improvements(result,{culminationAlt,...(clears?{clearAlt:clears.alt,...(clearSky?{clearSky}:{})}:{})}),[result,culminationAlt,clears,clearSky]);
  const clearsAt=clears&&clears!=='after-dawn'&&timezone?formatInTimeZone(clears.at,timezone,'HH:mm'):undefined;
  const moonset=helps.some(h=>h.kind==='moon')&&at&&lat!==undefined&&lon!==undefined?moonsetAfter(lat,lon,at):null;
  const helpLabel=(kind:ImprovementKind)=>kind==='moon'&&moonset&&timezone?`${HELP_TEXT.moon} (it sets ${formatInTimeZone(moonset,timezone,'HH:mm')})`:kind==='higher'&&culminationAlt!==undefined?`${HELP_TEXT.higher} (up to ${Math.round(culminationAlt)}°)`
    :kind==='skyline'&&clearsAt?`Wait until it clears your skyline at ${clearsAt}`:HELP_TEXT[kind];
  // The rating at the moment it clears needs that moment's conditions; without them the hint stays unrated.
  const unrated=(kind:ImprovementKind)=>kind==='skyline'&&!!clears&&clears!=='after-dawn'&&!clearSky;
  const b=result.skyBreakdown,maxGain=Math.max(.01,...v.limits.map(l=>l.gain));
  const ratio=(dMag:number)=>{const f=10**(.4*Math.abs(dMag));return f<3?f.toFixed(1):String(Math.round(f));};
  const altText=`${Math.round(Math.max(alt,0))}° up`;
  // Plain words first; the astronomers' numbers stay in the small print.
  const nakedEye=nelmFromSqm(v.skyAtTarget),gainOverEye=v.limitingMag-nakedEye;
  const mu=v.skyAtTarget,skyWord=mu>=21.3?'Dark':mu>=20.5?'Fairly dark':mu>=19.5?'Some glow':mu>=18.5?'Bright glow':'Very bright';
  const skyNotes=[b.moonDelta>=.05?`moonlight makes it ${ratio(b.moonDelta)}× brighter`:'',b.twilightDelta>=.05?`twilight makes it ${ratio(b.twilightDelta)}× brighter`:'',`${mu.toFixed(1)} mag/arcsec² (site ${used.zenithSqm.toFixed(1)})`].filter(Boolean).join(' · ');
  const hazeLabel=resolved(used).transparency?TRANSPARENCY_OPTIONS[resolved(used).transparency!-1].label.toLowerCase():'normal';
  const lost=Math.round((1-10**(-.4*v.extinctionMag))*100);
  const rows:[string,string,string?][]=[
    ['Faintest star you can see',gainOverEye>.3?`Stars about ${ratio(gainOverEye)}× fainter than your eyes alone`:'About as faint as your eyes alone',`magnitude ${v.limitingMag.toFixed(1)} through these binoculars at ${altText}`],
    ['Sky glow here',skyWord,skyNotes],
    ['Dimmed by the air',lost<3?'Hardly at all':`About ${lost}% of its light lost`,`at ${altText} · ${hazeLabel} haze · ${v.extinctionMag.toFixed(1)} mag`],
  ];
  if(vt.kind==='double'&&vt.sepArcsec){
    const moons=vt.sepArcsec*optics.magnification/60/31;
    rows.push(['How far apart',moons>=.95?`About ${moons.toFixed(1)} Moon-widths apart at ${optics.magnification}×`:`About ${Math.max(1,Math.round(moons*100))}% of the Moon’s width apart at ${optics.magnification}×`,`${vt.sepArcsec.toFixed(1)}″ · magnitudes ${vt.mag.toFixed(1)} and ${(vt.mag2??vt.mag).toFixed(1)}`]);
  }
  else if(result.surfaceBrightness!==null&&vt.kind==='extended'){
    // The whole-extent average undersells objects with a bright centre (M42, M31): say so when the centre carries it.
    const sb=result.surfaceBrightness,cored=['galaxy','globular','emission','reflection'].includes(vt.objectClass??'')&&v.level<=2;
    rows.push(['How spread out it is',sb<=mu?'Concentrated — brighter per patch than the sky around it':cored?`Bright centre, faint edges — the outer glow is about ${ratio(sb-mu)}× fainter per patch than the sky`:`Spread thin — about ${ratio(sb-mu)}× fainter per patch than the sky around it`,`average over its whole size: ${sb.toFixed(1)} mag/arcsec²`]);
  }
  else if(vt.kind!=='cluster')rows.push(['Brightness',vt.kind==='star'?'A point of light':'Small and concentrated',`magnitude ${target.mag.toFixed(1)} (smaller numbers are brighter)`]);
  if(vt.majorArcmin)rows.push(['Fits in your view',vt.majorArcmin>optics.fov*60*.9?'Bigger than your view — sweep around it':`Fills about ${Math.max(1,Math.round(vt.majorArcmin/(optics.fov*60)*100))}% of the view`,`${vt.majorArcmin>=60?`${(vt.majorArcmin/60).toFixed(1)}°`:`${vt.majorArcmin.toFixed(vt.majorArcmin<10?1:0)}′`} across · ${optics.fov.toFixed(1)}° field of view`]);
  const report=<>
    <dl className="vis-table">{rows.map(([k,val,note])=><div key={k}><dt>{k}</dt><dd><strong>{val}</strong>{note&&<small>{note}</small>}</dd></div>)}</dl>
    <h4>What’s holding it back</h4>
    {v.limits.length?<ul className="vis-limits">{v.limits.map(l=><li key={l.factor}>
      <div className="vis-limit-head"><strong>{LIMIT_NAMES[l.factor]}</strong><small>{isConditionFactor(l.factor)?'tonight’s conditions':'the object itself'}</small></div>
      {l.gain>0&&<span className="vis-gain" aria-hidden="true"><i style={{width:`${Math.max(6,l.gain/maxGain*100)}%`}}/></span>}
      <p>{withoutLead(l.text,LIMIT_NAMES[l.factor])}</p>
    </li>)}</ul>:<p className="vis-none">Nothing much — conditions suit it tonight.</p>}
    {helps.length>0&&<><h4>What would help</h4><ul className="vis-helps">{helps.map(h=><li key={h.kind}>{unrated(h.kind)?helpLabel(h.kind):h.kind==='skyline'&&clearsAt&&h.estimate.level===4?`It clears your skyline at ${clearsAt}, but is still too faint to see then`:<>{helpLabel(h.kind)}: <strong>{LEVEL_SENTENCE[h.estimate.level]}</strong></>}</li>)}</ul></>}
    {clears==='after-dawn'&&<p className="vis-none">It stays behind the hills until after dawn.</p>}
    <p className="vis-conditions">{conditionsSummary(used,profile)}{onEditSetup&&<> · <button type="button" className="text-action" onClick={onEditSetup}>Edit</button></>}</p>
    <p className="vis-method">An estimate of how your eyes, these binoculars, the air and tonight’s sky work together — not a promise. Eyesight, nearby lights and clouds vary.</p>
  </>;
  return <section className={`binocular-assessment vis-report fit-${result.rating} ${compact?'compact':''}`} aria-label={`How ${target.name} will look tonight`}>
    <h3 className="vis-title"><Binoculars size={15}/> How it will look tonight</h3>
    <div className="vis-headline"><VisibilityChip result={result}/><p className="vis-appearance">{alt<=0?'Below the horizon at this time.':`${appearanceLine(result,clearsAt)}.`}</p></div>
    {compact?<details><summary>Why, and what would help</summary>{report}</details>:report}
  </section>;
}
