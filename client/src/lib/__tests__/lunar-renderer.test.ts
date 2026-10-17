import { describe,it,expect } from "vitest";
import { renderLunarViewport,separationScale } from "../lunar-renderer";
import type { LunarFrame } from "../moon";
const frame:LunarFrame={observer:[1,0,0],right:[0,1,0],up:[0,0,1],sun:[1,0,0]};
// Coordinate-coded real map geometry: western hemisphere dark, eastern hemisphere light.
const texture={width:360,height:180,data:new Uint8ClampedArray(360*180*4)} as ImageData;
for(let y=0;y<180;y++)for(let x=0;x<360;x++){const i=(y*360+x)*4;texture.data[i]=texture.data[i+1]=texture.data[i+2]=x<180?30:220;texture.data[i+3]=255;}
describe("lunar viewport",()=>{
  it("keeps surface coordinates attached under pan, zoom, rotation and mirror",()=>{
    const draw=(pan={x:0,y:0},rotation=0,mirrored=false,radius=40)=>renderLunarViewport(texture,frame,101,101,1,radius,pan,rotation,mirrored,true);
    const at=(p:Uint8ClampedArray,x:number,y:number)=>p[(y*101+x)*4];
    const base=draw();expect(at(base,40,50)).toBe(30);expect(at(base,60,50)).toBe(220);expect(base[3]).toBe(0);
    const pan=draw({x:10,y:0});expect(at(pan,50,50)).toBe(at(base,40,50));
    const mirror=draw({x:0,y:0},0,true);expect(at(mirror,40,50)).toBe(at(base,60,50));
    const rotated=draw({x:0,y:0},90);expect(at(rotated,50,40)).toBe(at(base,40,50));
    const zoom=draw({x:0,y:0},0,false,80);expect(at(zoom,30,50)).toBe(at(base,40,50));expect(zoom[3]).toBe(255);
  });
  it("preserves the reference mosaic and darkens the unlit side only in calculated lighting",()=>{
    const reference=renderLunarViewport(texture,frame,101,101,1,40,{x:0,y:0},0,false,true);
    const dark=renderLunarViewport(texture,{...frame,sun:[-1,0,0]},101,101,1,40,{x:0,y:0},0,false,false);
    expect(reference[(50*101+60)*4]).toBe(220);expect(dark[(50*101+60)*4]).toBeLessThan(10);
  });
  it("shows a labeled detail scale that contains the real range, even at conjunction/opposition",()=>{
    for(const values of [[59,64],[0,.1],[179.8,180],[63,63]]){const s=separationScale(values);expect(s.min).toBeLessThanOrEqual(Math.min(...values));expect(s.max).toBeGreaterThanOrEqual(Math.max(...values));expect(s.max-s.min).toBeGreaterThanOrEqual(10);expect(s.min).toBeGreaterThanOrEqual(0);expect(s.max).toBeLessThanOrEqual(180);}
    expect(separationScale([59,64],true)).toEqual({min:0,max:180});
  });
});
