import { equatorialOfDate } from "../fixed-equatorial";
import { describe,it,expect } from 'vitest';
import { skyObjectKind,altitudeRingFraction,isDeepSky,overheadOffset,skylineSilhouettePath,skylineRidgePath,skylinePeakDeg } from '../planetarium';
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
describe('local skyline silhouette on the overhead chart',()=>{
  const noTurn=(p:{x:number;y:number})=>p;
  const vertices=(d:string)=>d.split('Z').filter(Boolean).map(ring=>ring.slice(1).split('L').map(v=>v.split(',').map(Number)));
  it('places directions like the chart cardinals: north up, east left',()=>{
    const n=overheadOffset(0,280),e=overheadOffset(90,280),s=overheadOffset(180,280),w=overheadOffset(270,280);
    expect(n.x).toBeCloseTo(0,9);expect(n.y).toBeCloseTo(-280,9);
    expect(e.x).toBeCloseTo(-280,9);expect(e.y).toBeCloseTo(0,9);
    expect(s.x).toBeCloseTo(0,9);expect(s.y).toBeCloseTo(280,9);
    expect(w.x).toBeCloseTo(280,9);expect(w.y).toBeCloseTo(0,9);
  });
  it('leaves no band where the skyline is at or below 0° and rises to the skyline ring behind a wall',()=>{
    const flat=vertices(skylineSilhouettePath(()=>-2,noTurn,300,300));
    expect(flat).toHaveLength(2);expect(flat[0]).toHaveLength(360);
    expect(flat[1]).toEqual(flat[0]);
    const wall=(az:number)=>az>=170&&az<=190?20:-90;
    const [outer,inner]=vertices(skylineSilhouettePath(wall,noTurn,300,300));
    // Due south (bin 180): the skyline at 20° sits at r = 260·altitudeRingFraction(20), straight down from the centre.
    expect(outer[180][0]).toBeCloseTo(300,1);expect(outer[180][1]).toBeCloseTo(560,1);
    expect(inner[180][0]).toBeCloseTo(300,1);expect(inner[180][1]).toBeCloseTo(300+260*altitudeRingFraction(20),1);
    expect(inner[90]).toEqual(outer[90]);
  });
  it('follows the chart orientation (mirror and rotation) it is given',()=>{
    const wall=(az:number)=>az>=80&&az<=100?30:0;
    const mirrored=vertices(skylineSilhouettePath(wall,p=>({x:-p.x,y:p.y}),0,0))[1];
    // Mirrored, the eastern wall is drawn on the right.
    expect(mirrored[90][0]).toBeCloseTo(260*altitudeRingFraction(30),1);
  });
  it('draws the ridge alone as the silhouette\'s inner edge and reports the skyline\'s peak',()=>{
    const wall=(az:number)=>az>=200&&az<=260?20:-1;
    const silhouette=skylineSilhouettePath(wall,noTurn,300,300),ridge=skylineRidgePath(wall,noTurn,300,300);
    expect(silhouette.endsWith(ridge)).toBe(true);
    expect(vertices(ridge)).toEqual([vertices(silhouette)[1]]);
    expect(skylinePeakDeg(wall)).toBe(20);
    // A flat site (skyline just below 0°, like the open polder) has no meaningful peak.
    expect(skylinePeakDeg(()=>-0.35)).toBeLessThan(1);
  });
});
