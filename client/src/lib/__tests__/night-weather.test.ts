import {describe,it,expect} from 'vitest';
import {nightWeather,rankWeatherNights} from '../night-weather';
import {upcomingNights,nearestMoonFreeTargetTime,moonFreeTargetWindows} from '../upcoming-nights';
import {WEATHER_HOUR,weatherLocation,type WeatherForecast} from '../weather';
import {moonState} from '../moon';
import {eqToHorizontal,type UnifiedTarget} from '../astronomy';
const site={lat:37.77,lon:-122.42,timezone:'America/Los_Angeles'};
const date=new Date('2026-10-20T04:00:00Z');
const target:UnifiedTarget={id:'M42',name:'Orion Nebula',displayName:'M42',ra:83.82,dec:-5.39,mag:4,category:'Nebula',categoryShort:'Nebula',con:'Ori',source:'messier'};
const state={now:+date,online:true,loading:false,error:''};
const nights=upcomingNights({...site,date,days:3});
function forecast(cloud=10):WeatherForecast {
 const start=Math.floor(+nights[0].start/WEATHER_HOUR)*WEATHER_HOUR;
 return {version:1,...weatherLocation(site.lat,site.lon),fetchedAt:+date,hours:Array.from({length:96},(_,i)=>({time:start+i*WEATHER_HOUR,cloud,low:0,mid:0,high:0,temp:10,dew:0,humidity:30,rainChance:0,rain:0,wind:5,gust:8,visibility:25000}))};
}
describe('weather-aware upcoming nights',()=>{
 it('distinguishes unavailable reasons rather than inventing a weather score',()=>{
  expect(nightWeather(nights[0],undefined,{...state,online:false}).reason).toMatch(/Offline/);
  expect(nightWeather(nights[0],undefined,{...state,error:'Service busy'}).reason).toBe('Service busy');
  const later=upcomingNights({...site,date:new Date('2027-01-31T20:00:00Z'),days:1})[0];
  expect(nightWeather(later,forecast(),state).reason).toMatch(/beyond the forecast/);
  expect(nightWeather(nights[0],forecast(),{...state,now:+date+10*86400000}).reason).toMatch(/expired/);
 });
 it('uses covered dark hours; null and partial predictions remain unknown',()=>{
  const f=forecast();expect(nightWeather(nights[0],f,state).available).toBe(true);
  const dark=f.hours.find(h=>nights[0].darkWindows.some(s=>h.time<+s.end&&h.time+WEATHER_HOUR>+s.start))!;
  dark.cloud=null;expect(nightWeather(nights[0],f,state).score).toBeNull();
  const partial=forecast();partial.hours=partial.hours.slice(15);expect(nightWeather(nights[0],partial,state).available).toBe(false);
 });
 it('gives clearer covered nights higher weather rank without treating missing forecasts as clear',()=>{
  const reports=new Map(nights.map((n,i)=>[n.date,nightWeather(n,i===2?undefined:forecast(i===0?90:5),state)]));
  expect(rankWeatherNights(nights,reports).map(n=>n.date)).toEqual([nights[1].date,nights[0].date,nights[2].date]);
 });
 it('finds the nearest future Moon-free M42 window rather than the best night weeks later',()=>{
  const options={...site,date,target,minAltitude:15 as const};const at=nearestMoonFreeTargetTime(options)!;
  const first=moonFreeTargetWindows(options).find(w=>w.end>date)!;
  expect(at).not.toBeNull();expect(+at).toBeGreaterThanOrEqual(Math.max(+date,+first.start));expect(+at).toBeLessThan(+first.end);
  expect(+at-+date).toBeLessThan(86400000);
  const moon=moonState(site.lat,site.lon,at);expect(moon.alt).toBeLessThan(0);expect(moon.sunAlt).toBeLessThan(-18);expect(eqToHorizontal(target.ra,target.dec,site.lat,site.lon,at).alt).toBeGreaterThan(15);
 });
});
