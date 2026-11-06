import { parseRA,parseDec } from './test-helpers';
import { describe,it,expect } from 'vitest';
import messier from '../../../public/data/messier.json';
import binocular from '../../../public/data/binocular-catalog.json';
import { buildUnifiedTargets, type BinocularTarget, type UnifiedTarget } from '../astronomy';
import { angularDimensions, averageSurfaceBrightness, binocularAssessment, heldBack, improvements, KITE_14X50, levelWord, limitShort, ratingOfLevel, skyInputsFrom, supportOf } from '../binocular-assessment';
import { moonState } from '../moon';
import { defaultSettings,settingsSchema } from '../session';

export const targets=buildUnifiedTargets(messier.map(m=>({id:m.M,m:m.M,ngc:m.NGC,type:m.T,mag:Number(m.V),ra:parseRA(m.RA),dec:parseDec(m.Dec),constellation:m.Con,name:m.N,size:m.S})),binocular.map(t=>({...t,cat:t.cat as BinocularTarget['cat'],ra:parseRA(t.ra),dec:parseDec(t.dec)})));
const target=(id:string)=>targets.find(t=>t.id===id)!;
describe('portable binocular recommendations',()=>{
  it('retains physical dimensions and the components of close doubles',()=>{
    expect(angularDimensions('1.5°')).toMatchObject({major:90,minor:90});
    expect(angularDimensions('60″')).toMatchObject({major:1,minor:1});
    expect(angularDimensions('8x5.7′')).toMatchObject({major:8,minor:5.7});
    expect(angularDimensions('unknown')).toBeNull();expect(angularDimensions('10x0')).toBeNull();
    expect(target('DS-Albireo')).toMatchObject({sep:34.4,mag2:5.1});
    expect(averageSurfaceBrightness(8,10,5)).toBeCloseTo(20.875,2);
  });
  it('is the visibility model underneath: rating follows the level, pointLimit the limiting magnitude',()=>{
    for(const id of ['M45','M31','M57','M101','DS-AlmaakDS']){
      const a=binocularAssessment(target(id),KITE_14X50);
      expect(a.rating,id).toBe(ratingOfLevel(a.visibility.level));
      expect(a.pointLimit,id).toBe(a.visibility.limitingMag);
    }
    expect([0,1,2,3,4].map(l=>ratingOfLevel(l as 0|1|2|3|4))).toEqual([0,1,1,2,3]);
    expect(supportOf(KITE_14X50)).toBe('stabilized');
    expect(supportOf({...KITE_14X50,stabilized:false})).toBe('handheld');
    expect(supportOf({...KITE_14X50,support:'tripod'})).toBe('tripod');
  });
  it('distinguishes wide views, unresolved clusters, tiny nebulae and diffuse galaxies under a dark sky',()=>{
    expect(binocularAssessment(target('M45'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('M42'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('M31'),KITE_14X50).view).toMatch(/glow|core|galaxy|oval/i);
    const m13=binocularAssessment(target('M13'),KITE_14X50);
    expect(m13.visibility.appearance).toMatch(/separate stars are too faint|soft glow/i);
    expect(m13.reasons.join(' ')).toMatch(/too faint to pick out|only a few sparkle/);
    // M57: a tiny spot — visible, but never better than Good at 14×.
    expect(binocularAssessment(target('M57'),KITE_14X50).visibility.level).toBeGreaterThanOrEqual(1);
    const m101=binocularAssessment(target('M101'),KITE_14X50);
    expect(m101.rating).toBeGreaterThanOrEqual(2);
    expect(m101.surfaceBrightness).toBeGreaterThan(22);
    expect(m101.visibility.limits.some(l=>l.factor==='low-surface-brightness')).toBe(true);
  });
  it('separates a visible wide pair from pairs that need more magnification',()=>{
    expect(binocularAssessment(target('DS-MizarAlcor'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('DS-DoubleDbl'),KITE_14X50).view).toMatch(/sub-pair|close pair|telescope/i);
    const almach=binocularAssessment(target('DS-AlmaakDS'),KITE_14X50);
    expect(almach.rating).toBe(3);
    expect(levelWord(almach)).toBe('Won’t split at 14×');
    expect(binocularAssessment(target('DS-Albireo'),KITE_14X50).rating).toBeLessThan(3);
  });
  it('penalizes moonlight and low altitude and labels the conditions that hold it back',()=>{
    const moon={...moonState(37.77,-122.42,new Date('2026-10-25T05:00Z')),sunAlt:-30,alt:60,illumination:1,phaseAngle:0};
    const close={...target('M101'),ra:moon.ra+20,dec:moon.dec};
    const dark=binocularAssessment(close,KITE_14X50,{alt:60,moon:{...moon,alt:-20}}),bright=binocularAssessment(close,KITE_14X50,{alt:60,moon});
    expect(bright.glow).toBeGreaterThan(1);expect(bright.pointLimit).toBeLessThan(dark.pointLimit);expect(bright.rating).toBeGreaterThanOrEqual(dark.rating);
    expect(dark.glow).toBe(0);
    const m31=binocularAssessment({...target('M31'),ra:moon.ra+20,dec:moon.dec},KITE_14X50,{alt:60,moon});
    expect(m31.label).toBe('Better under a darker Moon');
    expect(m31.visibility.limits[0].factor).toBe('moon');
    expect(limitShort(heldBack(m31)!,m31)).toBe('Moon 100% lit, 20° away');
    // Taking the Moon away is what would help, and it changes the level.
    const help=improvements(m31);
    expect(help[0]).toMatchObject({kind:'moon'});
    expect(help[0].estimate.level).toBeLessThan(m31.visibility.level);
    expect(binocularAssessment(target('M31'),KITE_14X50,{alt:10}).label).toBe('Better when higher in the sky');
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:60,moon:{...moon,sunAlt:25}}).availability).toContain('Daylight');
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:60,moon:{...moon,sunAlt:25}}).rating).toBe(3);
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:-20}).availability).toContain('Below');
  });
  it('uses full conditions when given: haze, elevation, steadiness and the observer change the estimate',()=>{
    const base=skyInputsFrom(20.5);
    const m33=(o:Parameters<typeof binocularAssessment>[2])=>binocularAssessment(target('M33'),KITE_14X50,o).visibility.margin;
    const normal=m33({alt:50,sky:base});
    expect(m33({alt:50,sky:{...base,extinctionK:.6}})).toBeLessThan(normal);
    expect(m33({alt:50,sky:{...base,zenithSqm:21.8}})).toBeGreaterThan(normal);
    // The observer is passed through to the model (pupil from the age bracket). A pupil larger than the 3.6 mm exit
    // pupil changes nothing; a smaller one clips the beam and can only make things worse.
    expect(m33({alt:50,sky:base,observer:{pupil:5,fieldFactor:2}})).toBeCloseTo(normal,6);
    expect(m33({alt:50,sky:base,observer:{pupil:3,fieldFactor:2}})).toBeLessThan(normal);
    expect(m33({alt:50,sky:base,observer:{pupil:6.5,fieldFactor:2.4}})).toBeLessThan(normal);
    const pair=(support:'handheld'|'tripod')=>binocularAssessment(target('DS-Albireo'),{...KITE_14X50,support},{alt:50,sky:base}).visibility.margin;
    expect(pair('tripod')).toBeGreaterThan(pair('handheld'));
    // Without `sky` the legacy inputs build the same SkyInputs.
    expect(binocularAssessment(target('M33'),KITE_14X50,{alt:50,skyBrightness:20.5}).visibility.margin).toBeCloseTo(normal,9);
  });
  it('assesses every catalog entry with finite values and at least one reason',()=>{
    expect(targets).toHaveLength(297);
    for(const t of targets){const a=binocularAssessment(t,KITE_14X50);expect(Number.isFinite(a.pointLimit),t.id).toBe(true);expect(a.reasons.length,t.id).toBeGreaterThan(0);expect(a.view.length,t.id).toBeGreaterThan(15);if(a.surfaceBrightness!==null)expect(Number.isFinite(a.surfaceBrightness),t.id).toBe(true);expect(a.rating,t.id).toBeGreaterThanOrEqual(0);expect(a.rating,t.id).toBeLessThanOrEqual(3);expect(a.visibility.score,t.id).toBeGreaterThanOrEqual(0);}
  });
});
describe('KITE profile defaults and migration',()=>{
  it('starts at 14×50 with a 3.7 degree field and retains deliberate instrument choices',()=>{
    expect(defaultSettings).toMatchObject({mode:'binocular',binocularMagnification:14,binocularAperture:50,fov:3.7,binocularStabilized:true});
    const {binocularProfileVersion,...old}=defaultSettings;
    expect(settingsSchema.parse({...old,mode:'binocular',fov:7,binocularMagnification:10})).toMatchObject({binocularMagnification:14,fov:3.7});
    expect(settingsSchema.parse({...old,mode:'telescope',fov:5,binocularMagnification:10})).toMatchObject({mode:'telescope',fov:5});
    expect(settingsSchema.parse({...old,binocularMagnification:8,fov:8})).toMatchObject({binocularMagnification:8,fov:8});
    expect(settingsSchema.parse({...defaultSettings,binocularMagnification:10,fov:7})).toMatchObject({binocularMagnification:10,fov:7});
    expect(settingsSchema.parse({...defaultSettings,mode:'telescope',fov:5})).toMatchObject({binocularFov:3.7,fov:5});
  });
});
