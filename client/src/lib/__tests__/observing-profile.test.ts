import { describe,it,expect } from "vitest";
import { angularDistance, type UnifiedTarget } from "../astronomy";
import { moonState } from "../moon";
import { observationAt, profileCursorDate, sessionNightWindow, createMoonSampler, observationProfile, suggestedObservation, type ObservationSample } from "../observing-profile";
import { visibilityWindow } from "../target-visibility";
const lat=37.77,lon=-122.42,zone="America/Los_Angeles";
const target={id:"M31",name:"Andromeda",displayName:"Andromeda",ra:10.68,dec:41.27,mag:3.4,category:"Galaxy",categoryShort:"Galaxy",con:"And",source:"messier" as const} as UnifiedTarget;
describe("night Moon observation profiles",()=>{
  it("plots real angular separation and illumination with shared site-specific Moon samples",()=>{
    const night=visibilityWindow("2026-10-24","12:00","12:00","night",zone,lat,lon),moonAt=createMoonSampler(lat,lon);
    const profile=observationProfile(target,lat,lon,night,21.6,moonAt);expect(profile.length).toBeGreaterThan(0);
    for(const sample of profile.flatMap(s=>s.samples)){expect(sample.separation).toBeCloseTo(angularDistance(target.ra,target.dec,sample.moon.ra,sample.moon.dec),10);expect(sample.separation).toBeGreaterThanOrEqual(0);expect(sample.separation).toBeLessThanOrEqual(180);expect(sample.moon.illumination).toBeGreaterThanOrEqual(0);expect(sample.moon.illumination).toBeLessThanOrEqual(1);expect(moonAt(sample.date)).toBe(sample.moon);if(sample.moon.alt<=-sample.moon.diameter/2)expect(sample.moonlight).toBe(0);}
    expect(profile.flatMap(s=>s.samples).some(s=>s.moonlight>0)).toBe(true);
  });
  it("accounts for phase brightness and a Moon below the horizon in the shading",()=>{
    const night=visibilityWindow("2026-10-24","12:00","12:00","night",zone,lat,lon),base=moonState(lat,lon,new Date("2026-10-25T04:00Z"));
    const full=observationProfile(target,lat,lon,night,21.6,()=>({...base,alt:45,phaseAngle:0}));
    const crescent=observationProfile(target,lat,lon,night,21.6,()=>({...base,alt:45,phaseAngle:150}));
    const down=observationProfile(target,lat,lon,night,21.6,()=>({...base,alt:-10,phaseAngle:0}));
    expect(Math.max(...full.flatMap(s=>s.samples).map(s=>s.moonlight))).toBeGreaterThan(Math.max(...crescent.flatMap(s=>s.samples).map(s=>s.moonlight)));
    expect(down.flatMap(s=>s.samples).every(s=>s.moonlight===0)).toBe(true);
  });
  it("balances altitude and moonlight, stays inside a session and rejects below-horizon targets",()=>{
    const moon=moonState(lat,lon,new Date("2026-10-25T04:00Z")),early={date:new Date("2026-10-25T04:00Z"),alt:65,separation:30,moon,moonlight:3},late={date:new Date("2026-10-25T06:00Z"),alt:50,separation:80,moon:{...moon,alt:-10},moonlight:0};
    expect(suggestedObservation([early,late],target)).toBe(late);expect(suggestedObservation([early,late],{...target,category:"Star",mag:2})).toBe(early);
    expect(suggestedObservation([early,late],{...target,category:"Star",mag:8})).toBe(late);
    expect(suggestedObservation([early,late],target,{start:early.date,end:new Date("2026-10-25T05:00Z")})).toBe(early);
    expect(suggestedObservation([{...late,alt:-2}] as ObservationSample[],target)).toBeUndefined();
  });
  it("uses the preceding evening for a post-midnight session but the coming night for daylight",()=>{
    const morning=sessionNightWindow(new Date("2026-10-17T10:00Z"),new Date("2026-10-17T12:00Z"),zone,lat,lon);
    expect(morning.ok).toBe(true);if(morning.ok){expect(morning.start.toISOString()).toBe("2026-10-16T19:00:00.000Z");expect(morning.segments.some(s=>s.start<new Date("2026-10-17T10:00Z")&&s.end>new Date("2026-10-17T10:00Z"))).toBe(true);}
    const daylight=sessionNightWindow(new Date("2026-10-17T15:00Z"),new Date("2026-10-18T03:00Z"),zone,lat,lon);expect(daylight.ok).toBe(true);if(daylight.ok)expect(daylight.start.toISOString()).toBe("2026-10-17T19:00:00.000Z");
  });

  it("inspects exact cursor geometry and clamps outside/gap positions to dark intervals",()=>{
    const night=visibilityWindow("2026-10-24","12:00","12:00","night",zone,lat,lon);expect(night.ok).toBe(true);if(!night.ok)return;
    expect(profileCursorDate(night,-1)).toEqual(night.segments[0].start);expect(profileCursorDate(night,2)).toEqual(night.segments.at(-1)!.end);
    const date=profileCursorDate(night,.5)!,moonAt=createMoonSampler(lat,lon),point=observationAt(target,lat,lon,date,21.6,moonAt);
    expect(point.separation).toBeCloseTo(angularDistance(target.ra,target.dec,point.moon.ra,point.moon.dec),10);expect(point.moon).toBe(moonAt(date));
    const split={...night,segments:[{start:new Date("2026-10-25T02:00Z"),end:new Date("2026-10-25T03:00Z")},{start:new Date("2026-10-25T05:00Z"),end:new Date("2026-10-25T06:00Z")}]};
    expect([+split.segments[0].end,+split.segments[1].start]).toContain(+profileCursorDate(split,.5)!);
    expect(profileCursorDate({...night,segments:[]},.5)).toBeNull();expect(profileCursorDate(night,NaN)).toBeNull();
  });

});
