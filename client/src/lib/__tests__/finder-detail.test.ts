import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { catalogDiameter } from "../finder-detail";
import { angularDistance } from "../astronomy";
import fields from "../finder-fields.json";
describe('detailed reference finder',()=>{
  it('preserves real angular units rather than drawing arbitrary target extents',()=>{
    expect(catalogDiameter('25.0′')).toBeCloseTo(25/60);expect(catalogDiameter('1.5°')).toBe(1.5);expect(catalogDiameter('60″')).toBeCloseTo(1/60);expect(catalogDiameter('13x6.5')).toBeCloseTo(13/60);expect(catalogDiameter('unknown')).toBeNull();expect(catalogDiameter(undefined)).toBeNull();
  });
  it('ships complete finite catalog fields and preserves the NGC7209 field coordinates',()=>{
    expect(Object.keys(fields)).toHaveLength(297);
    for(const [id,field] of Object.entries(fields)){
      const stars=JSON.parse(readFileSync(`client/public/data/finder-stars/${id}.json`,'utf8')) as number[][];
      // Rounding source VT=8.001 to 0.01 may yield 8.00.
      expect(stars.length).toBe(field.count);expect(stars.every(s=>s.length===4&&s.every(Number.isFinite)&&s[0]>=0&&s[0]<360&&s[1]>=-90&&s[1]<=90&&s[2]>=8&&s[2]<=10.5)).toBe(true);
    }
    const cluster=JSON.parse(readFileSync('client/public/data/finder-stars/NGC7209.json','utf8')) as number[][];
    expect(cluster.length).toBeGreaterThan(1000);expect(cluster.every(s=>angularDistance(s[0],s[1],331.3,46.5)<=8.001)).toBe(true);
  });
});
