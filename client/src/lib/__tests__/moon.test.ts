import { describe, expect, it } from "vitest";
import * as Astro from "astronomy-engine";
import { lunarFeatures, lunarFrame, projectLunarFeature, moonState, lunarDayBounds, moonDay, scatteredMoonlight, targetMoonlight, dot, binocularResolution, featureAngularSize } from "../moon";
import { settingsSchema, defaultSettings, resolveLocalMoment, resolvePlannedMoment } from "../session";
import type { UnifiedTarget } from "../astronomy";
const location = [37.77,-122.42] as const;
const date = new Date("2026-10-26T04:00:00Z");
const target: UnifiedTarget = { id:"M31", name:"Andromeda", displayName:"Andromeda", ra:10.68, dec:41.27, con:"And", mag:3.4, category:"Spiral Galaxy", categoryShort:"Galaxy", source:"messier" };

describe("offline Moon observatory", () => {
  it("matches known new/full Moon epochs and topocentric angular size", () => {
    expect(moonState(...location,new Date("2024-04-08T18:21:00Z")).illumination).toBeLessThan(.001);
    const full=moonState(...location,new Date("2024-03-25T07:00:00Z"));
    expect(full.illumination).toBeGreaterThan(.999);
    expect(full.diameter).toBeGreaterThan(.48); expect(full.diameter).toBeLessThan(.57);
    expect(full.distanceKm).toBeGreaterThan(350000); expect(full.distanceKm).toBeLessThan(420000);
    const oppositeObserver=moonState(-37.77,57.58,new Date("2024-03-25T07:00:00Z"));
    expect(Math.abs(full.distanceKm-oppositeObserver.distanceKm)).toBeGreaterThan(1000);
  });
  it("uses an orthonormal lunar frame and projects coordinates consistently with libration", () => {
    const frame=lunarFrame(...location,date), lib=Astro.Libration(date);
    for(const v of [frame.observer,frame.up,frame.right,frame.sun]) expect(dot(v,v)).toBeCloseTo(1,9);
    expect(dot(frame.observer,frame.up)).toBeCloseTo(0,9); expect(dot(frame.right,frame.up)).toBeCloseTo(0,9);
    const lon=Math.atan2(frame.observer[1],frame.observer[0])*180/Math.PI;
    const lat=Math.asin(frame.observer[2])*180/Math.PI;
    expect(Math.abs(lon-lib.elon)).toBeLessThan(1.2); expect(Math.abs(lat-lib.elat)).toBeLessThan(1.2);
    expect((1+dot(frame.observer,frame.sun))/2).toBeCloseTo(moonState(...location,date).illumination,2);
    const center={...lunarFeatures[0],lat,lon};
    const p=projectLunarFeature(center,frame); expect(p.x).toBeCloseTo(0,8); expect(p.y).toBeCloseTo(0,8); expect(p.depth).toBeCloseTo(1,8);
    const east=projectLunarFeature({...center,lon:lon+10},frame); expect(east.x).toBeGreaterThan(0);
  });
  it("moves the terminator between waxing and waning rather than using a fixed texture", () => {
    const crisium=lunarFeatures.find(f=>f.name==="Mare Crisium")!;
    const waxing=Astro.SearchMoonPhase(90,new Date("2026-10-01"),30)!.date;
    const waning=Astro.SearchMoonPhase(270,new Date("2026-10-01"),30)!.date;
    expect(projectLunarFeature(crisium,lunarFrame(...location,waxing)).lit).toBe(true);
    expect(projectLunarFeature(crisium,lunarFrame(...location,waning)).lit).toBe(false);
  });
  it("uses 23/25-hour civil days across daylight saving and contains only same-day events", () => {
    const spring=lunarDayBounds(new Date("2026-03-08T12:00:00Z"),"America/Los_Angeles");
    const autumn=lunarDayBounds(new Date("2026-11-01T12:00:00Z"),"America/Los_Angeles");
    expect((spring.end.getTime()-spring.start.getTime())/3600000).toBe(23);
    expect((autumn.end.getTime()-autumn.start.getTime())/3600000).toBe(25);
    const day=moonDay(...location,date,"America/Los_Angeles");
    for(const event of [day.rise,day.set,day.transit]) if(event) { expect(event>=day.start).toBe(true); expect(event<day.end).toBe(true); }
    expect(day.nextSet! >=date).toBe(true);
    if(day.rise) expect(moonState(...location,new Date(day.rise.getTime()+15*60000)).alt).toBeGreaterThan(moonState(...location,new Date(day.rise.getTime()-15*60000)).alt);
    if(day.set) expect(moonState(...location,new Date(day.set.getTime()+15*60000)).alt).toBeLessThan(moonState(...location,new Date(day.set.getTime()-15*60000)).alt);
    for(const w of day.windows) { expect(w.end>w.start).toBe(true); expect(w.start>=date).toBe(true); expect(w.end.getTime()-date.getTime()).toBeLessThanOrEqual(86400000); }
  });
  it("offers future dark windows, not the morning before the chosen evening", () => {
    const at = new Date("2026-10-19T04:00:00Z"); // Oct 18, 21:00 SF
    const day = moonDay(...location,at,"America/Los_Angeles");
    expect(day.windows.length).toBeGreaterThan(0);
    for(const window of day.windows) {
      expect(window.start>=at).toBe(true);
      expect(window.start.toISOString()).toMatch(/^2026-10-19T/);
      const mid = moonState(...location,new Date((window.start.getTime()+window.end.getTime())/2));
      expect(mid.sunAlt).toBeLessThanOrEqual(-18); expect(mid.alt).toBeLessThan(0);
    }
  });
  it("handles polar dates with no rise or set without fabricating events", () => {
    const day=moonDay(89,0,date,"Etc/UTC");
    expect(day.rise).toBeNull(); expect(day.set).toBeNull();
    expect(day.samples.every(p=>Number.isFinite(p.alt)&&Number.isFinite(p.az))).toBe(true);
  });
  it("reproduces the published Table 2 quarter-Moon example within rounding", () => {
    const moon={...moonState(...location,date),alt:30,phaseAngle:90,distanceKm:384400};
    // KS91 Table 2: phase 90°, Moon Z=60°, separation 60°, target at zenith, k=.172.
    const model=scatteredMoonlight(moon,90,60,21.587);
    expect(model.moonBrightness).toBeCloseTo(99,0);
    expect(model.brightening).toBeCloseTo(.88,1);
  });
  it("gives no direct lunar penalty when down; responds to phase, separation and sky background", () => {
    const full={...moonState(...location,date),alt:50,phaseAngle:0,distanceKm:384400};
    expect(scatteredMoonlight({...full,alt:-10},60,30).brightening).toBe(0);
    expect(scatteredMoonlight(full,-10,30).brightening).toBe(0);
    expect(scatteredMoonlight(full,60,30).brightening).toBeGreaterThan(scatteredMoonlight({...full,phaseAngle:120},60,30).brightening);
    expect(scatteredMoonlight(full,60,20).brightening).toBeGreaterThan(scatteredMoonlight(full,60,90).brightening);
    expect(scatteredMoonlight(full,60,90,21.6).brightening).toBeGreaterThan(scatteredMoonlight(full,60,90,18).brightening);
    expect(Number.isFinite(scatteredMoonlight(full,60,0).brightening)).toBe(true);
    const galaxy=targetMoonlight(target,...location,date);
    expect(galaxy.diffuse).toBe(true); expect(galaxy.separation).toBeGreaterThanOrEqual(0); expect(galaxy.separation).toBeLessThanOrEqual(180);
    expect(targetMoonlight({...target,category:"Double Star"},...location,date).stars).toBe(true);
  });
  it("limits preview detail by both aperture and magnification; preserves old settings", () => {
    expect(binocularResolution(10,50)).toBe(6);
    expect(binocularResolution(40,20)).toBeCloseTo(6.9);
    expect(binocularResolution(20,100)).toBeLessThan(binocularResolution(10,50));
    const f=lunarFeatures.find(f=>f.name==="Mare Crisium")!;
    expect(featureAngularSize(f,moonState(...location,date),lunarFrame(...location,date))).toBeGreaterThan(0);
    const {binocularMagnification,binocularAperture,skyBrightness,...old}=defaultSettings;
    expect(settingsSchema.parse(old).binocularMagnification).toBe(14);
    expect(settingsSchema.parse(old).binocularAperture).toBe(50);
    expect(settingsSchema.parse(old).skyBrightness).toBe(21.6);
  });
  it("rejects a nonexistent local observing time at the daylight-saving jump", () => {
    expect(resolveLocalMoment("2026-03-08","02:30","America/Los_Angeles")).toBeNull();
    expect(resolveLocalMoment("2026-03-08","03:30","America/Los_Angeles")?.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(resolveLocalMoment("2026-10-25","21:00","America/Los_Angeles")?.toISOString()).toBe("2026-10-26T04:00:00.000Z");
  });
  it("preserves either occurrence of a repeated hour selected on the Moon chart", () => {
    const first=resolvePlannedMoment("2026-11-01","01:30","America/Los_Angeles","2026-11-01T08:30:00.000Z");
    const second=resolvePlannedMoment("2026-11-01","01:30","America/Los_Angeles","2026-11-01T09:30:00.000Z");
    expect(second.getTime()-first.getTime()).toBe(3600000);
    expect(resolvePlannedMoment("2026-11-01","03:00","America/Los_Angeles",second.toISOString()).toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });
  it("contains unique sourced features with valid lunar positions", () => {
    expect(lunarFeatures).toHaveLength(55); expect(new Set(lunarFeatures.map(f=>f.id)).size).toBe(55);
    for(const f of lunarFeatures) { expect(f.lat).toBeGreaterThanOrEqual(-90); expect(f.lat).toBeLessThanOrEqual(90); expect(f.lon).toBeGreaterThanOrEqual(-180); expect(f.lon).toBeLessThanOrEqual(180); expect(f.diameterKm).toBeGreaterThan(0); expect(f.source).toBe(`https://planetarynames.wr.usgs.gov/Feature/${f.id}`); }
  });
});
