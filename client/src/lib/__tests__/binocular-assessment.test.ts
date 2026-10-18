import { parseRA,parseDec } from './test-helpers';
import { describe,it,expect } from 'vitest';
import messier from '../../../public/data/messier.json';
import binocular from '../../../public/data/binocular-catalog.json';
import { buildUnifiedTargets, type BinocularTarget, type UnifiedTarget } from '../astronomy';
import { angularDimensions, averageSurfaceBrightness, binocularAssessment, KITE_14X50, nakedEyeLimit } from '../binocular-assessment';
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
    expect(nakedEyeLimit(21.6)).toBeGreaterThan(nakedEyeLimit(19));
  });
  it('distinguishes wide views, unresolved clusters, tiny nebulae and diffuse galaxies',()=>{
    expect(binocularAssessment(target('M45'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('M42'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('M31'),KITE_14X50).view).toMatch(/glow|core|galaxy|oval/i);
    expect(binocularAssessment(target('M13'),KITE_14X50).reasons.join(' ')).toContain('individual stars');
    expect(binocularAssessment(target('M57'),KITE_14X50)).toMatchObject({rating:3});
    expect(binocularAssessment(target('M101'),KITE_14X50).rating).toBeGreaterThanOrEqual(2);
    expect(binocularAssessment(target('M101'),KITE_14X50).surfaceBrightness).toBeGreaterThan(22);
  });
  it('separates a visible wide pair from subpairs that require a telescope',()=>{
    expect(binocularAssessment(target('DS-MizarAlcor'),KITE_14X50).rating).toBe(0);
    expect(binocularAssessment(target('DS-DoubleDbl'),KITE_14X50).view).toMatch(/sub-pair|close pair|telescope/i);
    expect(binocularAssessment(target('DS-AlmaakDS'),KITE_14X50).rating).toBe(3);
    expect(binocularAssessment(target('DS-Albireo'),KITE_14X50).rating).toBeLessThan(3);
  });
  it('penalizes sky glow and low altitude without claiming daylight detection',()=>{
    const moon={...moonState(37.77,-122.42,new Date('2026-10-25T05:00Z')),sunAlt:-30,alt:60,illumination:1,phaseAngle:0};
    const close={...target('M101'),ra:moon.ra+20,dec:moon.dec};
    const dark=binocularAssessment(close,KITE_14X50,{alt:60,moon:{...moon,alt:-20}}),bright=binocularAssessment(close,KITE_14X50,{alt:60,moon});
    expect(bright.glow).toBeGreaterThan(1);expect(bright.pointLimit).toBeLessThan(dark.pointLimit);expect(bright.rating).toBeGreaterThanOrEqual(dark.rating);
    expect(dark.glow).toBe(0);
    const a=binocularAssessment({...target('M31'),ra:moon.ra+20,dec:moon.dec},KITE_14X50,{alt:60,moon});
    expect(a.label).toBe('Better under a darker Moon');
    expect(binocularAssessment({...target('M57'),ra:moon.ra+20,dec:moon.dec},KITE_14X50,{alt:60,moon}).label).toBe('Telescope more rewarding');
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:10}).rating).toBeGreaterThanOrEqual(2);
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:60,moon:{...moon,sunAlt:25}}).availability).toContain('Daylight');
    expect(binocularAssessment(target('M45'),KITE_14X50,{alt:-20}).availability).toContain('Below');
  });
  it('assesses every catalog entry with finite values and honest missing-data notes',()=>{
    expect(targets).toHaveLength(297);
    for(const t of targets){const a=binocularAssessment(t,KITE_14X50);expect(Number.isFinite(a.pointLimit),t.id).toBe(true);expect(a.reasons.length,t.id).toBeGreaterThan(0);expect(a.view.length,t.id).toBeGreaterThan(15);if(a.surfaceBrightness!==null)expect(Number.isFinite(a.surfaceBrightness),t.id).toBe(true);expect(a.rating,t.id).toBeGreaterThanOrEqual(0);expect(a.rating,t.id).toBeLessThanOrEqual(3);}
    const unknown={...target('M101'),size:undefined} as UnifiedTarget;
    expect(binocularAssessment(unknown,KITE_14X50).reasons.join(' ')).toContain('missing');
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
