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
  const equalGeometry=nights.map(n=>({...n,geometryScore:10,moonFreeDarkHours:5}));
  const ranked=rankWeatherNights(equalGeometry,reports).map(n=>n.date);expect(ranked).toEqual([nights[1].date,nights[2].date,nights[0].date]);
 });
 it('keeps dark November M31 nights ahead of the reported cloudy and rainy October nights',()=>{
  const m31:UnifiedTarget={...target,id:'M31',name:'Andromeda Galaxy',ra:10.6847,dec:41.269,mag:3.4,category:'Spiral Galaxy',categoryShort:'Galaxy'};
  const month=upcomingNights({...site,date:new Date('2026-10-21T04:00:00Z'),days:30,selected:m31});
  const reports=new Map(month.map(n=>[n.date,{available:false,label:'Weather unavailable',reason:'Beyond range',score:null,cloud:null} as import('../night-weather').NightWeather]));
  for(const [date,score,cloud] of [['2026-10-20',0,100],['2026-10-21',59,35],['2026-10-22',1,95]] as const)reports.set(date,{available:true,label:`Weather ${score}/100`,reason:date==='2026-10-22'?'precipitation likely':'saved forecast',score,cloud});
  const best=rankWeatherNights(month.filter(n=>(n.selectedTarget?.goodAltitudeHours??0)>0),reports).slice(0,3);
  expect(best.some(n=>n.date>='2026-11-08'&&n.date<='2026-11-12')).toBe(true);
  expect(best.map(n=>n.date)).not.toContain('2026-10-20');expect(best.map(n=>n.date)).not.toContain('2026-10-22');
  expect(best.every(n=>n.moonFreeDarkHours>=1)).toBe(true);
 });
 it('rejects the one-minute Lagoon window and chooses the highest point of the nearest M31 window',()=>{
  const lagoon={...target,id:'M8',name:'Lagoon Nebula',ra:270.925,dec:-24.375};
  const options={...site,date:new Date('2026-10-21T04:00:00Z'),target:lagoon,minAltitude:15 as const};
  const windows=moonFreeTargetWindows(options);
  expect(windows.every(w=>+w.end-+w.start>=30*60000)).toBe(true);
  expect(windows.some(w=>w.date==='2026-10-28')).toBe(false);
  const m31={...target,id:'M31',ra:10.6847,dec:41.269};
  const at=nearestMoonFreeTargetTime({...options,target:m31})!;
  const first=moonFreeTargetWindows({...options,target:m31})[0];
  const midpoint=new Date((+first.start+ +first.end)/2);
  expect(eqToHorizontal(m31.ra,m31.dec,site.lat,site.lon,at).alt).toBeGreaterThanOrEqual(eqToHorizontal(m31.ra,m31.dec,site.lat,site.lon,midpoint).alt);
  expect(+at).toBeGreaterThan(+first.start);expect(+at).toBeLessThan(+first.end);
 });
 it.each(['2026-10-20T04:00:00Z','2026-10-20T22:39:00Z'])('finds the nearest future Moon-free M42 navigation window from %s',input=>{
  const from=new Date(input),options={...site,date:from,target,minAltitude:15 as const};const at=nearestMoonFreeTargetTime(options)!;
  const first=moonFreeTargetWindows(options).find(w=>+w.end-Math.max(+from,+w.start)>=30*60000)!;
  expect(at).not.toBeNull();expect(+at).toBeGreaterThanOrEqual(Math.max(+from,+first.start));expect(+at).toBeLessThan(+first.end);
  expect(+at-+from).toBeLessThan(86400000);
  const moon=moonState(site.lat,site.lon,at);expect(moon.alt).toBeLessThan(0);expect(moon.sunAlt).toBeLessThan(-18);expect(eqToHorizontal(target.ra,target.dec,site.lat,site.lon,at).alt).toBeGreaterThan(15);
 });
});
