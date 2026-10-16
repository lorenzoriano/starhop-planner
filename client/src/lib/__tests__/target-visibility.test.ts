import * as Astro from "astronomy-engine";
import { describe,it,expect } from "vitest";
import { eqToHorizontal } from "../astronomy";
import { targetDayEvents, visibilityWindow, targetWindow } from "../target-visibility";
const lat=37.77,lon=-122.42,zone="America/Los_Angeles",date=new Date("2026-10-16T20:00:00Z");
describe("target rise/transit/set and observing windows",()=>{
  it("finds actual horizon crossings and upper transit within the selected local day",()=>{
    const day=targetDayEvents(83.8,-5.4,lat,lon,date,zone);expect(day.rise).not.toBeNull();expect(day.set).not.toBeNull();expect(day.transit).not.toBeNull();
    for(const event of [day.rise,day.set,day.transit]){expect(event!>=day.start).toBe(true);expect(event!<day.end).toBe(true);}
    for(const [event,direction] of [[day.rise!,1],[day.set!,-1]] as const){expect(Math.abs(eqToHorizontal(83.8,-5.4,lat,lon,event).alt)).toBeLessThan(.001);expect((eqToHorizontal(83.8,-5.4,lat,lon,new Date(+event+60000)).alt-eqToHorizontal(83.8,-5.4,lat,lon,new Date(+event-60000)).alt)*direction).toBeGreaterThan(0);}
    expect(eqToHorizontal(83.8,-5.4,lat,lon,day.transit!).alt).toBeCloseTo(90-Math.abs(lat+5.4),4);
  });
  it("labels circumpolar and never-rising targets without invented rise/set times",()=>{
    const up=targetDayEvents(38,89,lat,lon,date,zone),down=targetDayEvents(38,-80,lat,lon,date,zone);expect(up.alwaysUp).toBe(true);expect(up.rise).toBeNull();expect(up.set).toBeNull();expect(down.neverUp).toBe(true);expect(down.rise).toBeNull();
  });
  it("uses local DST day boundaries and overnight custom ranges",()=>{
    const day=targetDayEvents(83,12,lat,lon,new Date("2026-11-01T20:00Z"),zone);expect((+day.end-+day.start)/3600000).toBe(25);
    const window=visibilityWindow("2026-10-16","22:00","02:00","range",zone,lat,lon);expect(window.ok).toBe(true);if(window.ok)expect((+window.end-+window.start)/3600000).toBe(4);
    expect(visibilityWindow("2026-03-08","02:30","04:00","range",zone,lat,lon).ok).toBe(false);
    expect(visibilityWindow("2026-02-30","20:00","22:00","range",zone,lat,lon).ok).toBe(false);
  });
  it("detects short altitude peaks and distinguishes any time from the whole window",()=>{
    const day=targetDayEvents(83,12,lat,lon,date,zone),transit=day.transit!;
    const window={ok:true as const,start:new Date(+transit-3600000),end:new Date(+transit+3600000),segments:[{start:new Date(+transit-3600000),end:new Date(+transit+3600000)}]};
    const result=targetWindow(83,12,lat,lon,window);expect(result.max).toBeCloseTo(64.23,3);expect(result.min).toBeLessThan(result.max-2);expect(Math.abs(+result.bestAt-+transit)).toBeLessThan(1000);
  });
  it("selects real night darkness and handles polar summer and winter",()=>{
    for(const [latitude,dateLabel,hasNight] of [[lat,"2026-10-16",true],[89,"2026-06-21",false],[89,"2026-12-21",true]] as const){const window=visibilityWindow(dateLabel,"20:00","22:00","night","Etc/UTC",latitude,0);expect(window.ok).toBe(true);if(window.ok)expect(window.segments.length>0).toBe(hasNight);}
  });
  it("uses astronomical dusk and dawn, excluding nights with only nautical twilight",()=>{
    const window=visibilityWindow("2026-10-16","20:00","22:00","night",zone,lat,lon);
    expect(window.ok).toBe(true);if(!window.ok)return;
    expect(window.segments).toHaveLength(1);
    const observer=new Astro.Observer(lat,lon,0);
    const sunAltitude=(at:Date)=>{const eq=Astro.Equator(Astro.Body.Sun,at,observer,true,true);return Astro.Horizon(at,observer,eq.ra,eq.dec).altitude;};
    for(const segment of window.segments){expect(sunAltitude(segment.start)).toBeCloseTo(-18,2);expect(sunAltitude(segment.end)).toBeCloseTo(-18,2);expect(sunAltitude(new Date((+segment.start + +segment.end)/2))).toBeLessThan(-18);}
    // At 50°N in midsummer the Sun falls below −12° but never reaches −18°.
    const twilightOnly=visibilityWindow("2026-06-21","20:00","22:00","night","Etc/UTC",50,0);
    expect(twilightOnly.ok).toBe(true);if(twilightOnly.ok)expect(twilightOnly.segments).toHaveLength(0);
  });

});
