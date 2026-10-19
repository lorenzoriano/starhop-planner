import { forecastAge, parseWeather, weatherForecastSchema, weatherLocation, weatherUrl, type WeatherForecast } from './weather';

const CACHE_KEY='starhop-weather-v1',LIMIT=50;
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const memory=new Map<string,WeatherForecast>();
function deviceStorage():StorageLike|undefined {try{return localStorage;}catch{return undefined;}}
function readEntries(storage:StorageLike|undefined) {
  try {const raw=JSON.parse(storage?.getItem(CACHE_KEY)??'[]');if(!Array.isArray(raw))return [];
    return raw.slice(0,LIMIT).flatMap(value=>{const parsed=weatherForecastSchema.safeParse(value);if(!parsed.success)return [];const f=parsed.data;return f.key===weatherLocation(f.lat,f.lon).key&&f.hours.every((h,i)=>!i||h.time-f.hours[i-1].time===3600000)?[f]:[];});
  }catch{return [];}
}
export function readWeather(lat:number,lon:number,storage=deviceStorage()) {
  const key=weatherLocation(lat,lon).key;
  const stored=readEntries(storage).find(f=>f.key===key),cached=memory.get(key);
  return stored&&(!cached||stored.fetchedAt>cached.fetchedAt)?stored:cached;
}
/** Last successful report survives failed refreshes and app/service-worker updates. */
export function isWeatherSaved(forecast:WeatherForecast) {return readEntries(deviceStorage()).some(f=>f.key===forecast.key&&f.fetchedAt===forecast.fetchedAt);}
export function saveWeather(forecast:WeatherForecast,storage=deviceStorage()) {
  memory.delete(forecast.key);memory.set(forecast.key,forecast);
  if(memory.size>LIMIT)memory.delete(memory.keys().next().value!);
  const entries=[forecast,...readEntries(storage).filter(f=>f.key!==forecast.key)].slice(0,LIMIT);
  try {if(!storage)return false;storage.setItem(CACHE_KEY,JSON.stringify(entries));return true;}catch{return false;}
}
const pending=new Map<string,Promise<{forecast:WeatherForecast;saved:boolean}>>();
const lastAttempts=new Map<string,number>();
export async function fetchWeather(lat:number,lon:number,force=false) {
  const site=weatherLocation(lat,lon),existing=pending.get(site.key);
  if(existing)return existing;
  const previous=readWeather(lat,lon);
  if(!force&&previous&&forecastAge(previous)==='fresh')return {forecast:previous,saved:isWeatherSaved(previous)};
  if(Date.now()-(lastAttempts.get(site.key)??0)<(force?60000:300000))throw Error('Please wait a few minutes before retrying this location.');
  lastAttempts.set(site.key,Date.now());
  const task=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(weatherUrl(lat,lon),{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw Error(response.status===429?'Weather service is busy. Try again later.':'Weather service could not provide a forecast.');
      let forecast:WeatherForecast;
      try {forecast=parseWeather(await response.json(),lat,lon);}
      catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw Error('The weather service returned an incomplete forecast. Please try again later.');}
      return {forecast,saved:saveWeather(forecast)};
    }finally{clearTimeout(timer);}
  })();
  pending.set(site.key,task);
  try{return await task;}finally{pending.delete(site.key);}
}
