import { forecastAge, WEATHER_HOUR, type WeatherForecast } from './weather';
import type { UpcomingNight } from './upcoming-nights';

export interface NightWeather { available:boolean; label:string; reason:string; score:number|null; cloud:number|null; }
/** Forecasts only affect rank when every astronomical dark hour has essential data. */
export function nightWeather(night:UpcomingNight,forecast:WeatherForecast|undefined,state:{now:number;online:boolean;loading:boolean;error:string}):NightWeather {
  const missing=(reason:string):NightWeather=>({available:false,label:'Weather unavailable',reason,score:null,cloud:null});
  if(!forecast)return missing(!state.online?'Offline; no saved forecast for this location.':state.loading?'Fetching the forecast for this location.':state.error||'No forecast has been received for this location yet.');
  if(!night.darkHours)return missing('There is no astronomical darkness on this night.');
  if(forecastAge(forecast,state.now)==='expired')return missing('The saved forecast has expired; reconnect to refresh it.');
  const start=forecast.hours[0].time,end=forecast.hours.at(-1)!.time+WEATHER_HOUR;
  if(+night.start>=end)return missing('This night is beyond the forecast range (about 7 days).');
  if(+night.end<=start)return missing('This night is earlier than the saved forecast coverage.');
  if(night.darkWindows.some(segment=>start>+segment.start||end<+segment.end))return missing('The forecast covers only part of the astronomical dark hours.');
  const weighted=forecast.hours.map(hour=>({hour,weight:night.darkWindows.reduce((sum,segment)=>sum+Math.max(0,Math.min(hour.time+WEATHER_HOUR,+segment.end)-Math.max(hour.time,+segment.start)),0)})).filter(item=>item.weight>0);
  const hours=weighted.map(item=>item.hour);
  if(!hours.length||hours.some(hour=>hour.cloud===null||hour.wind===null||hour.rain===null||hour.rainChance===null))return missing('Cloud, wind or precipitation data is missing for some dark hours.');
  const total=weighted.reduce((sum,item)=>sum+item.weight,0);
  const cloud=weighted.reduce((sum,item)=>sum+item.hour.cloud!*item.weight,0)/total;
  const wind=weighted.reduce((sum,item)=>sum+item.hour.wind!*item.weight,0)/total;
  const rain=hours.some(hour=>hour.rain!>=.1||hour.rainChance!>=50);
  const score=Math.round(Math.max(0,Math.min(rain?10:100,100-cloud-wind*.6)));
  const age=forecastAge(forecast,state.now);
  return {available:true,score,cloud,label:`Weather ${score}/100 · ${Math.round(cloud)}% cloud`,reason:`Dark-hour average · ${rain?'precipitation likely · ':''}${state.online?'saved forecast':'offline cache'}${age==='stale'?' · older report':''}`,};
}

/** Unknown weather is neutral. Forecast quality adjusts geometric merit rather than
 * granting every covered night priority over the rest of the month. */
export function rankWeatherNights(nights:UpcomingNight[],reports:Map<string,NightWeather>):UpcomingNight[] {
  const maximum=Math.max(1,...nights.map(night=>night.geometryScore));
  const merit=(night:UpcomingNight)=>{
    const score=reports.get(night.date)?.score;
    const geometry=night.geometryScore/maximum*100;
    // Do not turn missing forecasts into a prediction of either clear or cloudy skies.
    return geometry+(score==null?0:(score-50)*.8);
  };
  const poorForecast=(night:UpcomingNight)=>{const score=reports.get(night.date)?.score;return score!=null&&score<=10;};
  return [...nights].sort((a,b)=>Number(poorForecast(a))-Number(poorForecast(b))||Number(b.moonFreeDarkHours>=1)-Number(a.moonFreeDarkHours>=1)||merit(b)-merit(a)||a.date.localeCompare(b.date));
}
