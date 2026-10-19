import { describe,it,expect,vi,afterEach } from 'vitest';
import { moonState } from '../moon';
import { stargazingOutlook,stargazingHours } from '../stargazing-forecast';
import { parseForecastModels,modelAt,modelAge,modelAgreement,saveForecastModels,readForecastModels,fetchForecastModels,modelForecastUrl } from '../forecast-models';
import { observingWeather,WEATHER_HOUR,type WeatherHour,type WeatherForecast } from '../weather';
const at=Date.parse('2026-10-25T04:00:00Z');
const weather:WeatherHour={time:at,cloud:0,low:0,mid:0,high:0,temp:12,dew:3,humidity:50,rain:0,rainChance:0,wind:4,gust:8,visibility:30000};
const base=moonState(37.77,-122.42,new Date(at));
const full={...base,sunAlt:-40,alt:55,phaseAngle:0,illumination:1},down={...full,alt:-10};
function raw(){return {hourly:{time:[at/1000,at/1000+3600,at/1000+7200],cloud_cover_ecmwf_ifs025:[10,20,null],cloud_cover_gfs_seamless:[12,80,null],wind_speed_250hPa_ecmwf_ifs025:[50,160,null],wind_speed_250hPa_gfs_seamless:[70,180,null]},hourly_units:{cloud_cover_ecmwf_ifs025:'%',cloud_cover_gfs_seamless:'%',wind_speed_250hPa_ecmwf_ifs025:'km/h',wind_speed_250hPa_gfs_seamless:'km/h'}};}
function disk(){const map=new Map<string,string>();return {getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}};}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('astronomy-specific observing outlook',()=>{
 it('penalizes a bright raised Moon for deep sky, less for binoculars, and never for lunar work',()=>{
  const deep=stargazingOutlook(weather,full,'deep-sky'),bino=stargazingOutlook(weather,full,'binocular'),lunar=stargazingOutlook(weather,full,'lunar');
  expect(deep.score!).toBeLessThan(bino.score!);expect(bino.score!).toBeLessThan(lunar.score!);expect(deep.glow).toBeGreaterThan(1);
  expect(stargazingOutlook(weather,down,'deep-sky').score!).toBeGreaterThan(deep.score!);
  expect(stargazingOutlook(weather,down,'lunar').score).toBe(lunar.score);
 });
 it('requires astronomical darkness for faint targets and does not model daylight Moon glow',()=>{
  const twilight={...full,sunAlt:-17};expect(stargazingOutlook(weather,twilight,'deep-sky').score).toBe(0);expect(stargazingOutlook(weather,twilight,'binocular').label).toContain('twilight');expect(stargazingOutlook(weather,twilight,'binocular').glow).toBe(0);
  expect(stargazingOutlook(weather,twilight,'lunar').score!).toBeGreaterThan(0);
 });
 it('does not call opaque high cloud good or infer a score from missing essential weather',()=>{
  expect(stargazingOutlook({...weather,cloud:100,high:100},down,'binocular').score).toBe(0);
  expect(stargazingOutlook({...weather,rain:2},down,'binocular').score!).toBeLessThanOrEqual(5);
  expect(stargazingOutlook({...weather,temp:null},down,'binocular').score).toBeNull();
  const dry=stargazingOutlook(weather,down,'binocular'),dew=stargazingOutlook({...weather,dew:11},down,'binocular');expect(dew.score!).toBeLessThan(dry.score!);
 });
 it('treats upper-air wind as a limited indicator, not an arcsecond seeing forecast',()=>{
  const calm={time:at,ecmwf:10,gfs:15,ecmwfJet:30,gfsJet:40},strong={...calm,ecmwfJet:180,gfsJet:200};
  const a=stargazingOutlook(weather,down,'lunar',calm),b=stargazingOutlook(weather,down,'lunar',strong);
  expect(b.jet).toBe(190);expect(b.score!).toBeLessThan(a.score!);expect(b.reasons.join(' ')).toContain('fine detail');expect(b).not.toHaveProperty('seeingArcseconds');
 });
 it('shows a cloud-sensitive outlook range instead of presenting opposing model forecasts as certain',()=>{
  const out=stargazingOutlook(weather,down,'binocular',{time:at,ecmwf:100,gfs:0,ecmwfJet:50,gfsJet:50});
  expect(out.label).toBe('Uncertain forecast');expect(out.cloudRange?.min).toBe(0);expect(out.cloudRange?.max).toBe(out.score);expect(out.agreement.spread).toBe(100);
 });
 it('does not make an urban deep-sky outlook better merely because the Moon adds less relative glow',()=>{
  expect(stargazingOutlook(weather,full,'deep-sky',undefined,18).score!).toBeLessThanOrEqual(stargazingOutlook(weather,full,'deep-sky',undefined,21.6).score!);
 });
 it('samples real site-specific Moon geometry and refuses non-finite candidate rankings',()=>{
  const hours=Array.from({length:48},(_,i)=>({...weather,time:at+i*WEATHER_HOUR}));const a=stargazingHours(hours,37.77,-122.42,'binocular'),b=stargazingHours(hours,-33.87,151.21,'binocular');
  expect(a.some((h,i)=>Math.abs(h.moon.alt-b[i].moon.alt)>10)).toBe(true);expect(a.some(h=>h.dark&&h.score!==null&&h.score>0)).toBe(true);
  const forecast:WeatherForecast={version:1,key:'37.770,-122.420',lat:37.77,lon:-122.42,fetchedAt:at,hours};expect(observingWeather(forecast,new Date(at),'America/Los_Angeles',at,()=>Infinity).best).toBeNull();
 });
});
describe('independent model forecasts and cache',()=>{
 it('uses documented named models, explicit UTC/metric units and keeps nulls unknown',()=>{
  const url=new URL(modelForecastUrl(37.77,-122.42));expect(url.searchParams.get('models')).toBe('ecmwf_ifs025,gfs_seamless');expect(url.searchParams.get('hourly')).toContain('250hPa');
  const f=parseForecastModels(raw(),37.77,-122.42,at);expect(f.hours[0].time).toBe(at);expect(f.hours[2].ecmwf).toBeNull();expect(modelAt(f,at+24*WEATHER_HOUR)).toBeUndefined();
  const bad=raw();bad.hourly_units.wind_speed_250hPa_gfs_seamless='mph';expect(()=>parseForecastModels(bad,37.77,-122.42)).toThrow();
 });
 it('distinguishes agreement from disagreement without inventing confidence probabilities',()=>{
  const f=parseForecastModels(raw(),37.77,-122.42,at);expect(modelAgreement(f.hours[0]).label).toBe('Models agree');expect(modelAgreement(f.hours[1]).label).toBe('Models disagree');expect(modelAgreement(f.hours[1]).spread).toBe(60);expect(modelAgreement(f.hours[2]).spread).toBeNull();
 });
 it('keeps site/model reports separate from the existing offline weather cache and discloses expiry',async()=>{
  const store=disk();vi.stubGlobal('localStorage',store);store.setItem('starhop-weather-v1','preserved');const f=parseForecastModels(raw(),40,20,at),g=parseForecastModels(raw(),-30,150,at);saveForecastModels(f);saveForecastModels(g);
  expect(readForecastModels(40,20)?.hours).toEqual(f.hours);expect(readForecastModels(-30,150)?.key).toBe(g.key);expect(store.getItem('starhop-weather-v1')).toBe('preserved');expect(Array.isArray(JSON.parse(store.getItem('starhop-forecast-models-v1')!)[0].hours[0])).toBe(true);vi.resetModules();const reopened=await import('../forecast-models');expect(reopened.readForecastModels(40,20)?.hours).toEqual(f.hours);expect(modelAge(f,at+4*WEATHER_HOUR)).toBe('expired');
 });
 it('deduplicates requests, reuses a fresh model forecast, and preserves it after malformed updates',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at);vi.stubGlobal('localStorage',disk());const request=vi.fn(async()=>new Response(JSON.stringify(raw()),{status:200}));vi.stubGlobal('fetch',request);
  const [a,b]=await Promise.all([fetchForecastModels(42,22),fetchForecastModels(42,22)]);expect(a.forecast).toEqual(b.forecast);expect(request).toHaveBeenCalledTimes(1);await fetchForecastModels(42,22);expect(request).toHaveBeenCalledTimes(1);
  vi.setSystemTime(at+8*WEATHER_HOUR);request.mockResolvedValueOnce(new Response('{}',{status:200}));await expect(fetchForecastModels(42,22)).rejects.toThrow('incomplete');expect(readForecastModels(42,22)?.fetchedAt).toBe(at);
 });
});
