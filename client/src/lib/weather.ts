import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { visibilityWindow } from './target-visibility';

export const WEATHER_HOUR=3600000;
export const WEATHER_FRESH=WEATHER_HOUR;
export const weatherHourSchema=z.object({
  time:z.number().finite(), cloud:z.number().min(0).max(100).nullable(),
  low:z.number().min(0).max(100).nullable(),mid:z.number().min(0).max(100).nullable(),high:z.number().min(0).max(100).nullable(),
  temp:z.number().finite().nullable(),dew:z.number().finite().nullable(),humidity:z.number().min(0).max(100).nullable(),
  rainChance:z.number().min(0).max(100).nullable(),rain:z.number().nonnegative().nullable(),
  wind:z.number().nonnegative().nullable(),gust:z.number().nonnegative().nullable(),visibility:z.number().nonnegative().nullable(),
});
export type WeatherHour=z.infer<typeof weatherHourSchema>;
export const weatherForecastSchema=z.object({version:z.literal(1),key:z.string(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),fetchedAt:z.number().finite(),hours:z.array(weatherHourSchema).min(1).max(400)});
export type WeatherForecast=z.infer<typeof weatherForecastSchema>;
export function weatherLocation(lat:number,lon:number) {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Choose valid coordinates for a forecast.');
  const latitude=Number(lat.toFixed(3)),longitude=Number(lon.toFixed(3));
  return {lat:latitude,lon:longitude,key:`${latitude.toFixed(3)},${longitude.toFixed(3)}`};
}
export const WEATHER_VARIABLES={cloud:'cloud_cover',low:'cloud_cover_low',mid:'cloud_cover_mid',high:'cloud_cover_high',temp:'temperature_2m',dew:'dew_point_2m',humidity:'relative_humidity_2m',rainChance:'precipitation_probability',rain:'precipitation',wind:'wind_speed_10m',gust:'wind_gusts_10m',visibility:'visibility'} as const;
export function weatherUrl(lat:number,lon:number) {
  const site=weatherLocation(lat,lon);
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({latitude:String(site.lat),longitude:String(site.lon),hourly:Object.values(WEATHER_VARIABLES).join(','),forecast_days:'7',past_days:'1',timeformat:'unixtime',timezone:'GMT',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'})}`;
}
/** Absolute UTC timestamps avoid browser/time-zone and DST ambiguities. Null never means clear. */
export function parseWeather(raw:unknown,lat:number,lon:number,now=Date.now()):WeatherForecast {
  const data=z.object({hourly:z.object({time:z.array(z.number().finite()).min(1).max(400)}).passthrough(),hourly_units:z.record(z.string())}).parse(raw);
  const units:Record<keyof typeof WEATHER_VARIABLES,string>={cloud:'%',low:'%',mid:'%',high:'%',temp:'°C',dew:'°C',humidity:'%',rainChance:'%',rain:'mm',wind:'km/h',gust:'km/h',visibility:'m'};
  const series=Object.entries(WEATHER_VARIABLES).map(([key,name])=>{
    if(data.hourly_units[name]!==units[key as keyof typeof units])throw Error('Unsupported weather units.');
    const values=z.array(z.number().finite().nullable()).parse(data.hourly[name]);
    if(values.length!==data.hourly.time.length)throw Error('Incomplete weather response.');
    return [key,values] as const;
  });
  const site=weatherLocation(lat,lon);
  // Provider precipitation/probability/gust values describe the preceding hour.
  // Shift them forward so each row consistently describes [time, time + 1 hour).
  const hours=data.hourly.time.map((time,index)=>({
    time:time*1000,
    ...Object.fromEntries(series.map(([key,values])=>{
      const position=['rain','rainChance','gust'].includes(key)?index+1:index;
      return [key,values[position]??null];
    })),
  }));
  if(hours.some((h,i)=>i>0&&h.time-hours[i-1].time!==WEATHER_HOUR))throw Error('Irregular weather timeline.');
  return weatherForecastSchema.parse({version:1,...site,fetchedAt:now,hours});
}
export function forecastAge(forecast:WeatherForecast,now=Date.now()) {
  if(now>=forecast.hours.at(-1)!.time+WEATHER_HOUR)return 'expired';
  return now-forecast.fetchedAt>=WEATHER_FRESH||forecast.fetchedAt-now>300000?'stale':'fresh';
}
export function meanWeather(hours:WeatherHour[],key:keyof Omit<WeatherHour,'time'>) {
  if(!hours.length||hours.some(h=>h[key]===null))return null;
  return hours.reduce((n,h)=>n+h[key]!,0)/hours.length;
}
export function weatherVerdict(hour:Pick<WeatherHour,'cloud'|'rain'|'rainChance'|'visibility'>) {
  if(hour.rain!==null&&hour.rain>=.1||hour.rainChance!==null&&hour.rainChance>=50)return {label:'Rain or snow likely',tone:'poor'};
  if(hour.visibility!==null&&hour.visibility<1000)return {label:'Fog or poor visibility',tone:'poor'};
  if(hour.cloud===null)return {label:'Cloud forecast unavailable',tone:'unknown'};
  return hour.cloud<=20?{label:'Mostly clear',tone:'good'}:hour.cloud<=50?{label:'Some cloud',tone:'mixed'}:hour.cloud<=80?{label:'Mostly cloudy',tone:'poor'}:{label:'Overcast',tone:'poor'};
}
export function observingWeather(forecast:WeatherForecast,date:Date,timezone:string,now=Date.now(),rank?:(hours:WeatherHour[])=>number) {
  const day=formatInTimeZone(date,timezone,'yyyy-MM-dd');
  const night=visibilityWindow(day,'12:00','12:00','night',timezone,forecast.lat,forecast.lon);
  if(!night.ok)return {hours:[] as WeatherHour[],night,best:null,partial:false};
  const hours=forecast.hours.filter(h=>h.time<+night.end&&h.time+WEATHER_HOUR>+night.start);
  const dark=hours.filter(h=>night.segments.some(s=>h.time>=+s.start&&h.time+WEATHER_HOUR<=+s.end));
  let best:{start:number;end:number;cloud:number;wind:number;score:number}|null=null;
  for(let i=0;i<dark.length-1;i++) {
    const a=dark[i],b=dark[i+1],pair=[a,b];
    if(a.time<now||b.time-a.time!==WEATHER_HOUR||pair.some(h=>h.cloud===null||h.cloud>50||h.rain===null||h.rain>=.1||h.rainChance===null||h.rainChance>=30||h.wind===null||h.wind>=25||h.gust===null||h.gust>=40||h.visibility===null||h.visibility<10000))continue;
    const cloud=meanWeather(pair,'cloud')!,wind=meanWeather(pair,'wind')!;
    const score=rank?rank(pair):cloud+wind*.6+pair.reduce((n,h)=>n+(h.temp!==null&&h.dew!==null&&h.temp-h.dew<=2?10:0),0);
    if(!Number.isFinite(score))continue;
    if(!best||score<best.score)best={start:a.time,end:b.time+WEATHER_HOUR,cloud,wind,score};
  }
  const partial=forecast.hours[0].time>+night.start||forecast.hours.at(-1)!.time+WEATHER_HOUR<+night.end;
  return {hours,night,best,partial};
}
