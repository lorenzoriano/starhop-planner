import { Binoculars } from 'lucide-react';
import { binocularAssessment, profileName, KITE_SOURCE, type BinocularProfile } from '@/lib/binocular-assessment';
import type { UnifiedTarget } from '@/lib/astronomy';
import type { MoonState } from '@/lib/moon';
import type { Settings } from '@/lib/session';

export function profileFromSettings(settings:Settings):BinocularProfile {
  return {magnification:settings.binocularMagnification,aperture:settings.binocularAperture,fov:settings.binocularFov,stabilized:settings.binocularStabilized,transmission:settings.binocularTransmission};
}
export function BinocularProfileControls({settings,update}:{settings:Settings;update:(patch:Partial<Settings>)=>void}) {
  const profile=profileFromSettings(settings);
  return <details className="binocular-profile"><summary><Binoculars size={17}/><span>{profileName(profile)}</span><small>{profile.fov}° field · {profile.stabilized?'stabilized':'supported / handheld'}</small><span className="profile-edit">Edit optics</span></summary>
    <div className="profile-fields">
      <label>Magnification<input aria-label="Binocular magnification" type="number" min="5" max="40" value={profile.magnification} onChange={e=>{const v=Number(e.target.value);if(v>=5&&v<=40)update({binocularMagnification:v});}}/></label>
      <label>Aperture · mm<input aria-label="Binocular aperture" type="number" min="20" max="150" value={profile.aperture} onChange={e=>{const v=Number(e.target.value);if(v>=20&&v<=150)update({binocularAperture:v});}}/></label>
      <label>True field · °<input aria-label="Binocular true field" type="number" min=".2" max="15" step=".1" value={profile.fov} onChange={e=>{const v=Number(e.target.value);if(v>=.2&&v<=15)update({binocularFov:v,...(settings.mode==='binocular'?{fov:v,fovHeight:v}:{})});}}/></label>
      <label>Transmission · %<input aria-label="Binocular transmission" type="number" min="30" max="100" value={Math.round(profile.transmission*100)} onChange={e=>{const v=Number(e.target.value);if(v>=30&&v<=100)update({binocularTransmission:v/100});}}/></label>
      <label>Moonless sky<select aria-label="Binocular sky brightness" value={settings.skyBrightness} onChange={e=>update({skyBrightness:Number(e.target.value)})}><option value="21.6">Dark site · 21.6</option><option value="20.5">Rural / outer suburbs · 20.5</option><option value="19">Suburban · 19.0</option><option value="17.5">Bright city · 17.5</option>{![21.6,20.5,19,17.5].includes(settings.skyBrightness)&&<option value={settings.skyBrightness}>{settings.skyBrightness.toFixed(1)} mag/arcsec²</option>}</select></label>
      <label className="profile-check"><input type="checkbox" checked={profile.stabilized} onChange={e=>update({binocularStabilized:e.target.checked})}/>Image stabilization</label>
    </div><p>Sky brightness is your assumption, not a live measurement. Exit pupil {(profile.aperture/profile.magnification).toFixed(2)} mm. Advice changes with your optics, altitude and moonlight.</p>
    <button className="text-action" onClick={()=>update({mode:'binocular',instrumentSelected:true,binocularMagnification:14,binocularAperture:50,binocularStabilized:true,binocularTransmission:.86,binocularFov:3.7,fov:3.7,fovHeight:3.7,shape:'circle',binocularProfileVersion:1})}>Use KITE APC 14×50 ED defaults</button><a href={KITE_SOURCE} target="_blank" rel="noreferrer">Manufacturer specifications ↗</a>
  </details>;
}
export function BinocularAssessment({target,profile,alt,moon,skyBrightness,compact=false}:{target:UnifiedTarget;profile:BinocularProfile;alt:number;moon:MoonState;skyBrightness:number;compact?:boolean}) {
  const result=binocularAssessment(target,profile,{alt,moon,skyBrightness});
  return <section className={`binocular-assessment fit-${result.rating} ${compact?'compact':''}`} aria-label={`Binocular assessment for ${target.name}`}>
    <span className="fit-label"><Binoculars size={14}/>{result.label}</span>
    <p>{result.view}</p>
    <small>{profileName(profile)} · {result.availability}</small>
    <details><summary>Why this recommendation</summary><ul>{result.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><p>Visual guidance is an estimate, not a promise of detection. The model uses catalog magnitude, apparent size, observing notes, a 6 mm eye pupil and estimated Moon sky glow. Compact cores and individual stars can differ greatly from an object’s average brightness. Weather forecasts are shown separately; eyesight and local obstructions are not measured.</p><p>Estimated stellar limit ≈{result.pointLimit.toFixed(1)} mag; exit pupil {result.exitPupil.toFixed(2)} mm. Brightness and contrast rules are conservative heuristics, not a full human-vision threshold simulation.</p></details>
  </section>;
}
