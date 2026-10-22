import { describe, expect, it } from 'vitest';
import { angularDistance } from '../astronomy';
import { projectChartPoint } from '../chart-view';
import { angularEllipse, angularField, skyOffset, unprojectChartPoint } from '../optical-geometry';

describe('true angular optics geometry',()=>{
  it('keeps a 3.7° field accurate at RA wrap, the pole and an off-axis chart location',()=>{
    for(const center of [{ra:359.9,dec:0},{ra:42,dec:89.8},{ra:10.68,dec:41.27}]){
      for(const p of angularField(center,3.7,3.7,'circle'))expect(angularDistance(center.ra,center.dec,p.ra,p.dec)).toBeCloseTo(1.85,7);
    }
  });
  it('recovers the sky beneath the center after panning a wide chart',()=>{
    for(const frame of [{ra:355,dec:37.77},{ra:40,dec:89.9}])for(const east of [-25,0,25]){
      const focus=skyOffset(frame,5,-3),point=skyOffset(frame,-10,east),p=projectChartPoint(point,frame,focus,2.7)!;
      const back=unprojectChartPoint(p,frame,focus,2.7);
      expect(angularDistance(point.ra,point.dec,back.ra,back.dec)).toBeLessThan(.00001);
    }
  });
  it('uses full major/minor diameters and PA east of north, without cosine-of-dec errors',()=>{
    const c={ra:10.6847,dec:41.2689},major=177.83/60,minor=69.66/60;
    const p=angularEllipse(c,major,minor,35);
    expect(angularDistance(p[0].ra,p[0].dec,p[32].ra,p[32].dec)).toBeCloseTo(major,7);
    expect(angularDistance(p[16].ra,p[16].dec,p[48].ra,p[48].dec)).toBeCloseTo(minor,7);
    const northEllipse=angularEllipse(c,2,1,0),eastEllipse=angularEllipse(c,2,1,90);
    expect(northEllipse[0].dec).toBeCloseTo(c.dec+1,6);
    expect(eastEllipse[0].ra).toBeGreaterThan(c.ra);
  });
  it('rectangular field edges have specified central angular spans',()=>{
    const c={ra:359.9,dec:65},p=angularField(c,4,2,'rectangle');
    expect(angularDistance(p[8].ra,p[8].dec,p[40].ra,p[40].dec)).toBeCloseTo(2,7);
    expect(angularDistance(p[24].ra,p[24].dec,p[56].ra,p[56].dec)).toBeCloseTo(4,7);
  });
});
