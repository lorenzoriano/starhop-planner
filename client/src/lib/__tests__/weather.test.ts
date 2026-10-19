import { describe,it,expect,vi,afterEach } from 'vitest';
import { weatherLocation,weatherUrl,parseWeather,forecastAge,weatherVerdict,observingWeather,WEATHER_VARIABLES,WEATHER_HOUR,type WeatherForecast } from '../weather';
import { readWeather,saveWeather,fetchWeather } from '../weather-cache';

const at=Date.parse('2026-10-24T12:00:00Z');
function response(count=96,start=at) {
  const hourly:Record<string,(number|null)[]>={time:Array.from({length:count},(_,i)=>(start+i*WEATHER_HOUR)/1000)};
  const values={cloud:10,low:5,mid:3,high:4,temp:12,dew:5,humidity:65,rainChance:5,rain:0,wind:8,gust:12,visibility:25000};
  const units={cloud:'%',low:'%',mid:'%',high:'%',temp:'°C',dew:'°C',humidity:'%',rainChance:'%',rain:'mm',wind:'km/h',gust:'km/h',visibility:'m'};
  return {hourly:Object.assign(hourly,Object.fromEntries(Object.entries(WEATHER_VARIABLES).map(([key,name])=>[name,Array(count).fill(values[key as keyof typeof values])]))),hourly_units:Object.fromEntries(Object.entries(WEATHER_VARIABLES).map(([key,name])=>[name,units[key as keyof typeof units]]))};
}
function storage() {const items=new Map<string,string>();return {getItem:(key:string)=>items.get(key)??null,setItem:(key:string,v:string)=>{items.set(key,v);}};}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('location forecasts and observing-night interpretation',()=>{
  it('rounds coordinates consistently, separates sites and requests documented UTC units',()=>{
    expect(weatherLocation(37.77491,-122.41939).key).toBe(weatherLocation(37.7749,-122.4194).key);
    expect(weatherLocation(-33.86,151.21).key).not.toBe(weatherLocation(37.77,-122.42).key);
    expect(()=>weatherLocation(91,0)).toThrow();expect(()=>weatherLocation(0,Infinity)).toThrow();
    const url=new URL(weatherUrl(37.77,-122.42));expect(url.searchParams.get('timeformat')).toBe('unixtime');expect(url.searchParams.get('timezone')).toBe('GMT');expect(url.searchParams.get('forecast_days')).toBe('7');expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
  });
  it('keeps nulls unknown, validates units and rejects truncated or irregular timelines',()=>{
    const raw=response();raw.hourly.cloud_cover[0]=null;const forecast=parseWeather(raw,37.77,-122.42,at);
    raw.hourly.precipitation[1]=2;const aligned=parseWeather(raw,37.77,-122.42,at);expect(aligned.hours[0].rain).toBe(2);expect(aligned.hours.at(-1)!.rain).toBeNull();
    expect(forecast.hours[0].time).toBe(at);expect(forecast.hours[0].cloud).toBeNull();expect(weatherVerdict(forecast.hours[0]).tone).toBe('unknown');
    raw.hourly_units.wind_speed_10m='mph';expect(()=>parseWeather(raw,37.77,-122.42)).toThrow();
    const truncated=response();truncated.hourly.visibility.pop();expect(()=>parseWeather(truncated,37.77,-122.42)).toThrow();
    const irregular=response();irregular.hourly.time[1]!+=100;expect(()=>parseWeather(irregular,37.77,-122.42)).toThrow();
  });
  it('distinguishes age from forecast validity and retains an expired report',()=>{
    const forecast=parseWeather(response(),37.77,-122.42,at);
    expect(forecastAge(forecast,at+WEATHER_HOUR-1)).toBe('fresh');expect(forecastAge(forecast,at+WEATHER_HOUR)).toBe('stale');expect(forecastAge(forecast,at+97*WEATHER_HOUR)).toBe('expired');
    const disk=storage();expect(saveWeather(forecast,disk)).toBe(true);expect(readWeather(37.77,-122.42,disk)?.hours).toEqual(forecast.hours);
    expect(readWeather(-33.86,151.21,disk)).toBeUndefined();
  });
  it('finds dry windows only inside astronomical darkness, including DST and southern sites',()=>{
    for(const [lat,lon,zone,day] of [[37.77,-122.42,'America/Los_Angeles','2026-11-01'],[-33.86,151.21,'Australia/Sydney','2026-10-24']] as const){
      const start=Date.parse(`${day}T00:00:00Z`),f=parseWeather(response(96,start),lat,lon,start),r=observingWeather(f,new Date(start+12*WEATHER_HOUR),zone);
      expect(r.best).not.toBeNull();expect(r.night.ok).toBe(true);
      if(r.night.ok)expect(r.night.segments.some(s=>r.best!.start>=+s.start&&r.best!.end<=+s.end)).toBe(true);
      expect(r.best!.end-r.best!.start).toBe(2*WEATHER_HOUR);
    }
  });
  it('does not recommend cloudy, wet, gusty, foggy or missing-data hours',()=>{
    const f=parseWeather(response(),37.77,-122.42,at),date=new Date('2026-10-24T22:00Z');
    for(const patch of [{cloud:90},{rain:1},{rainChance:70},{gust:50},{visibility:500},{wind:null}]){
      const bad={...f,hours:f.hours.map(h=>({...h,...patch}))};expect(observingWeather(bad,date,'America/Los_Angeles').best).toBeNull();
    }
    expect(weatherVerdict({...f.hours[0],rain:1}).tone).toBe('poor');expect(weatherVerdict({...f.hours[0],visibility:500}).label).toContain('Fog');
  });
  it('does not extend a forecast into a distant planning date or invent polar darkness',()=>{
    const f=parseWeather(response(),37.77,-122.42,at);expect(observingWeather(f,new Date('2027-01-01T22:00Z'),'America/Los_Angeles').hours).toEqual([]);expect(observingWeather(f,new Date('2026-10-24T22:00Z'),'America/Los_Angeles',at+96*WEATHER_HOUR).best).toBeNull();
    const north=parseWeather(response(96,Date.parse('2026-06-21T00:00Z')),69.65,18.96,at);expect(observingWeather(north,new Date('2026-06-21T20:00Z'),'Europe/Oslo').best).toBeNull();
  });
});
describe('durable weather cache and networking',()=>{
  it('retains reports for distinct locations and keeps the newest successful report per location',()=>{
    const disk=storage(),a=parseWeather(response(),10,20,at),b=parseWeather(response(),20,10,at);
    saveWeather(a,disk);saveWeather(b,disk);const updated={...a,fetchedAt:at+1000};saveWeather(updated,disk);
    expect(readWeather(10,20,disk)?.fetchedAt).toBe(at+1000);expect(readWeather(20,10,disk)?.key).toBe(b.key);
    expect(JSON.parse(disk.getItem('starhop-weather-v1')!).length).toBe(2);
  });
  it('reports quota failure and ignores malformed persisted data',()=>{
    const broken={getItem:()=>'{broken',setItem:()=>{throw Error('quota');}},f=parseWeather(response(),11,21,at);
    expect(saveWeather(f,broken)).toBe(false);expect(readWeather(12,22,broken)).toBeUndefined();expect(readWeather(11,21,broken)?.key).toBe(f.key);
  });
  it('deduplicates concurrent requests, reuses a fresh cache and preserves data after network failure',async()=>{
    vi.useFakeTimers();vi.setSystemTime(at);vi.stubGlobal('localStorage',storage());
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(response()),{status:200}));vi.stubGlobal('fetch',fetcher);
    const [a,b]=await Promise.all([fetchWeather(13,23),fetchWeather(13,23)]);expect(fetcher).toHaveBeenCalledTimes(1);expect(a.forecast).toEqual(b.forecast);expect(a.saved).toBe(true);
    await fetchWeather(13,23);expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(at+2*WEATHER_HOUR);fetcher.mockRejectedValueOnce(Error('network down'));
    await expect(fetchWeather(13,23)).rejects.toThrow('network down');expect(readWeather(13,23)?.fetchedAt).toBe(at);
    vi.setSystemTime(at+3*WEATHER_HOUR);fetcher.mockResolvedValueOnce(new Response('{"hourly":{}}',{status:200}));
    await expect(fetchWeather(13,23)).rejects.toThrow('incomplete forecast');expect(readWeather(13,23)?.fetchedAt).toBe(at);
  });
});
