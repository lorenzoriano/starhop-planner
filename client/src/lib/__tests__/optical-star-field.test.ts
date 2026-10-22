import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DenseStar } from '../astronomy';
import { angularDistance } from '../astronomy';
import { skyOffset } from '../optical-geometry';
import { eyepieceStarRadius, opticalFieldStars } from '../optical-star-field';

describe('binocular identification field',()=>{
  it('clips stars by true circular field angle and magnitude, never a square crop',()=>{
    const c={ra:359.9,dec:45},samples=[[0,0,4],[0,1.84,7],[0,1.86,7],[1.5,1.5,7],[0,.5,9]].map(([n,e,m])=>{const p=skyOffset(c,n,e);return[p.ra,p.dec,m,.5] as DenseStar;});
    const stars=opticalFieldStars(samples,c,3.7,3.7,'circle',8);
    expect(stars).toHaveLength(2);expect(stars.every(s=>angularDistance(c.ra,c.dec,s.ra,s.dec)<=1.85)).toBe(true);
    expect(opticalFieldStars(samples,c,3.7,3.7,'circle',10)).toHaveLength(3);
  });
  it('retains real color and brightness rather than inventing white points',()=>{
    const stars=opticalFieldStars([[0,0,2,1.5],[.01,0,6,-.2]],{ra:0,dec:0},3.7,3.7,'circle',8),red=stars.find(s=>s.mag===2)!,blue=stars.find(s=>s.mag===6)!;
    expect(red.radius).toBeGreaterThan(blue.radius);expect(red.opacity).toBeGreaterThan(blue.opacity);expect(red.color).not.toBe(blue.color);
    const r=red.color.match(/\d+/g)!.map(Number),b=blue.color.match(/\d+/g)!.map(Number);expect(r[0]).toBeGreaterThan(r[2]);expect(b[2]).toBeGreaterThan(b[0]);
    expect(blue.x).toBeLessThan(0);expect(red.x).toBeCloseTo(0);
  });
  it('keeps faint reference stars legible and distinguishes their catalog magnitudes',()=>{
    const radii=[2,4,6,8,9,10.5].map(eyepieceStarRadius);
    expect(radii.at(-1)).toBeGreaterThan(1); // More than two CSS pixels across, even at the deepest setting.
    for(let i=1;i<radii.length;i++)expect(radii[i]).toBeLessThan(radii[i-1]);
    expect(eyepieceStarRadius(-1.46)).toBeLessThanOrEqual(6);
  });
  it('handles polar/wrapped fields and a rotated rectangular telescope opening',()=>{
    expect(opticalFieldStars([[170,89.8,5,.5]],{ra:350,dec:89.8},3.7,3.7,'circle',8)).toHaveLength(1);
    const star: DenseStar=[1,0,5,.5],c={ra:0,dec:0};
    expect(opticalFieldStars([star],c,1,3,'rectangle',8)).toHaveLength(0);
    expect(opticalFieldStars([star],c,1,3,'rectangle',8,90)).toHaveLength(1);
  });
  it('renders the real M31 and M45 catalogs with deeper reference stars and stable stellar positions',()=>{
    const dense=JSON.parse(readFileSync('client/public/data/stars-dense.json','utf8')) as DenseStar[];
    for(const [id,ra,dec] of [['M31',10.675,41.266667],['M45',56.75,24.116667]] as const){
      const detailed=JSON.parse(readFileSync(`client/public/data/finder-stars/${id}.json`,'utf8')) as DenseStar[],c={ra,dec};
      const bright=opticalFieldStars(dense,c,7,7,'circle',8),deep=opticalFieldStars([...dense,...detailed.filter(s=>s[2]>8)],c,7,7,'circle',10.5);
      expect(bright.length).toBeGreaterThan(20);expect(deep.length).toBeGreaterThan(bright.length*2);
      expect(new Set(deep.map(s=>s.color)).size).toBeGreaterThan(10);
      for(const s of bright)expect(deep.some(d=>d.ra===s.ra&&d.dec===s.dec&&d.x===s.x&&d.y===s.y)).toBe(true);
    }
  });
});
