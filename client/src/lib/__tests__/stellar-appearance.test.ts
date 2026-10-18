import { describe,it,expect } from 'vitest';
import { stellarColor,stellarRadius,temperatureFromBV } from '../stellar-appearance';
const rgb=(color:string)=>color.match(/\d+/g)!.map(Number);
describe('catalog-driven stellar appearance',()=>{
  it('makes measured cool stars warm and hot stars blue, regardless of brightness',()=>{
    const warm=rgb(stellarColor(3350)),hot=rgb(stellarColor(20000));
    expect(warm[0]).toBeGreaterThan(warm[2]);expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(temperatureFromBV(1.5)).toBeLessThan(temperatureFromBV(-.2));
    expect(rgb(stellarColor(undefined,1.5))[0]).toBeGreaterThan(rgb(stellarColor(undefined,1.5))[2]);
    expect(stellarColor()).toBe('#e4e7eb');expect(stellarColor(NaN,99)).toBe('#e4e7eb');
    expect(stellarColor(3350,-.3)).toBe(stellarColor(3350));
  });
  it('encodes catalog magnitude as marker size without pretending to resolve stellar disks',()=>{
    expect(stellarRadius(-1.46)).toBeGreaterThan(stellarRadius(0));
    expect(stellarRadius(0)).toBeGreaterThan(stellarRadius(3));
    expect(stellarRadius(3)).toBeGreaterThan(stellarRadius(8));
    expect(stellarRadius(10)).toBeGreaterThan(0);
    for(const t of [100,1800,40000,1e6])expect(rgb(stellarColor(t)).every(c=>c>=0&&c<=255)).toBe(true);
  });
});
