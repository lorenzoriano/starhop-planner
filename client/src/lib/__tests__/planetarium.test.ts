import { equatorialOfDate } from "../fixed-equatorial";
import { describe,it,expect } from 'vitest';
import { skyObjectKind,altitudeRingFraction,isDeepSky } from '../planetarium';
import { eqToHorizontal,stereographicProject } from '../astronomy';
import { skyZenith } from '../chart-view';
import { defaultSettings,settingsSchema } from '../session';
describe('planetarium horizon and object semantics',()=>{
  it('maps altitude rings to the same stereographic geometry as the actual sky',()=>{
    const date=new Date('2026-10-25T03:45Z'),zenith=skyZenith(0,0,date);
    for(const alt of [0,30,60,90]){
      const star=equatorialOfDate(equatorialOfDate(zenith.ra,zenith.dec,date).ra,90-alt,date,true);
      const p=stereographicProject(star.ra,star.dec,zenith.ra,zenith.dec,1)!;
      const horizonPoint=equatorialOfDate(0,90,date,true);const horizon=stereographicProject(horizonPoint.ra,horizonPoint.dec,zenith.ra,zenith.dec,1)!;
      expect(eqToHorizontal(star.ra,star.dec,0,0,date).alt).toBeCloseTo(alt,1);
      expect(Math.hypot(p.x,p.y)/Math.hypot(horizon.x,horizon.y)).toBeCloseTo(altitudeRingFraction(alt),8);
    }
    expect(altitudeRingFraction(-10)).toBeGreaterThan(1);
  });
  it('distinguishes deep-sky classes from individual stars and doubles',()=>{
    expect(skyObjectKind('Open Cluster')).toBe('cluster');expect(skyObjectKind('Globular Cluster')).toBe('globular');expect(skyObjectKind('Spiral Galaxy')).toBe('galaxy');expect(skyObjectKind('Planetary Nebula')).toBe('nebula');expect(skyObjectKind('Supernova Remnant')).toBe('nebula');expect(skyObjectKind('Asterism')).toBe('field');
    expect(isDeepSky('Double Star')).toBe(false);expect(isDeepSky('Star')).toBe(false);expect(isDeepSky('Globular Cluster')).toBe(true);
  });
  it('starts without an arbitrary object and preserves a deliberate stored selection',()=>{
    expect(defaultSettings.targetId).toBe('');expect(settingsSchema.parse({...defaultSettings,targetId:'M2'}).targetId).toBe('M2');expect(settingsSchema.parse({...defaultSettings,targetId:''}).targetId).toBe('');
  });
});
