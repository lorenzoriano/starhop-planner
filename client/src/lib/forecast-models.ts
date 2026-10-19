import { z } from 'zod';
import { weatherLocation,WEATHER_HOUR } from './weather';

const percent=z.number().min(0).max(100).nullable(),wind=z.number().nonnegative().nullable();
const modelHourSchema=z.object({time:z.number().finite(),ecmwf:percent,gfs:percent,ecmwfJet:wind,gfsJet:wind});
export type ModelHour=z.infer<typeof modelHourSchema>;
export const forecastModelsSchema=z.object({version:z.literal(1),key:z.string(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),fetchedAt:z.number().finite(),hours:z.array(modelHourSchema).min(1).max(400)});
export type ForecastModels=z.infer<typeof forecastModelsSchema>;
export const MODEL_FRESH=6*WEATHER_HOUR;
export function modelForecastUrl(lat:number,lon:number) {
  const site=weatherLocation(lat,lon);
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({latitude:String(site.lat),longitude:String(site.lon),hourly:'cloud_cover,wind_speed_250hPa',models:'ecmwf_ifs025,gfs_seamless',forecast_days:'7',past_days:'1',timeformat:'unixtime',timezone:'GMT',wind_speed_unit:'kmh'})}`;
}
export function parseForecastModels(raw:unknown,lat:number,lon:number,now=Date.now()):ForecastModels {
  const data=z.object({hourly:z.object({time:z.array(z.number().finite()).min(1).max(400)}).passthrough(),hourly_units:z.record(z.string())}).parse(raw);
  const fields={ecmwf:'cloud_cover_ecmwf_ifs025',gfs:'cloud_cover_gfs_seamless',ecmwfJet:'wind_speed_250hPa_ecmwf_ifs025',gfsJet:'wind_speed_250hPa_gfs_seamless'};
  const values=Object.entries(fields).map(([key,name])=>{if(data.hourly_units[name]!==(/Jet/.test(key)?'km/h':'%'))throw Error('Unexpected forecast units.');const array=z.array(z.number().finite().nullable()).parse(data.hourly[name]);if(array.length!==data.hourly.time.length)throw Error('Incomplete model forecast.');return [key,array] as const;});
  const hours=data.hourly.time.map((t,i)=>({time:t*1000,...Object.fromEntries(values.map(([key,array])=>[key,array[i]]))}));
  if(hours.some((h,i)=>i>0&&h.time-hours[i-1].time!==WEATHER_HOUR))throw Error('Irregular model timeline.');
  return forecastModelsSchema.parse({version:1,...weatherLocation(lat,lon),fetchedAt:now,hours});
}
export function modelAt(models:ForecastModels|undefined,time:number) {
  // No nearest-sample extrapolation: an hour outside coverage is unknown.
  return models?.hours.find(h=>h.time===Math.floor(time/WEATHER_HOUR)*WEATHER_HOUR);
}
export function modelAgreement(hour:ModelHour|undefined) {
  if(!hour||hour.ecmwf===null||hour.gfs===null)return {label:'Comparison unavailable',spread:null};
  const spread=Math.abs(hour.ecmwf-hour.gfs);
  return {label:spread<=15?'Models agree':spread<=30?'Some disagreement':'Models disagree',spread};
}
const KEY='starhop-forecast-models-v1';
function stored() {
  try {const data=JSON.parse(localStorage.getItem(KEY)??'[]');if(!Array.isArray(data))return [];return data.slice(0,50).flatMap(value=>{const unpacked=value&&typeof value==='object'&&Array.isArray(value.hours)?{...value,hours:value.hours.map((h:unknown)=>Array.isArray(h)?{time:h[0],ecmwf:h[1],gfs:h[2],ecmwfJet:h[3],gfsJet:h[4]}:h)}:value;const result=forecastModelsSchema.safeParse(unpacked);if(!result.success)return [];const f=result.data;return weatherLocation(f.lat,f.lon).key===f.key&&f.hours.every((h,i)=>!i||h.time-f.hours[i-1].time===WEATHER_HOUR)?[f]:[];});}catch{return [];}
}
const memory=new Map<string,ForecastModels>();
export function readForecastModels(lat:number,lon:number) {const key=weatherLocation(lat,lon).key,a=memory.get(key),b=stored().find(f=>f.key===key);return b&&(!a||b.fetchedAt>a.fetchedAt)?b:a;}
export function modelsSaved(f:ForecastModels){return stored().some(s=>s.key===f.key&&s.fetchedAt===f.fetchedAt);}
export function saveForecastModels(f:ForecastModels) {
  memory.delete(f.key);memory.set(f.key,f);if(memory.size>50)memory.delete(memory.keys().next().value!);
  try{const packed=[f,...stored().filter(s=>s.key!==f.key)].slice(0,50).map(report=>({...report,hours:report.hours.map(h=>[h.time,h.ecmwf,h.gfs,h.ecmwfJet,h.gfsJet])}));localStorage.setItem(KEY,JSON.stringify(packed));return true;}catch{return false;}
}
export function modelAge(f:ForecastModels,now=Date.now()) {return now>=f.hours.at(-1)!.time+WEATHER_HOUR?'expired':now-f.fetchedAt>=MODEL_FRESH||f.fetchedAt>now+300000?'stale':'fresh';}
const pending=new Map<string,Promise<{forecast:ForecastModels;saved:boolean}>>(),attempts=new Map<string,number>();
export async function fetchForecastModels(lat:number,lon:number,force=false) {
  const key=weatherLocation(lat,lon).key,previous=readForecastModels(lat,lon),running=pending.get(key);
  if(running)return running;
  if(!force&&previous&&modelAge(previous)==='fresh')return {forecast:previous,saved:modelsSaved(previous)};
  if(Date.now()-(attempts.get(key)??0)<(force?60000:600000))throw Error('Model comparison will retry later.');
  attempts.set(key,Date.now());
  const task=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{
    const response=await fetch(modelForecastUrl(lat,lon),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('Model comparison is unavailable.');
    let forecast:ForecastModels;try{forecast=parseForecastModels(await response.json(),lat,lon);}catch{throw Error('The model comparison was incomplete. The saved report is unchanged.');}
    return {forecast,saved:saveForecastModels(forecast)};
  }finally{clearTimeout(timer);}})();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
