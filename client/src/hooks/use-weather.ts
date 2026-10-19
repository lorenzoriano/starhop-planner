import { useEffect, useState, useRef } from 'react';
import { fetchWeather, readWeather, isWeatherSaved } from '@/lib/weather-cache';
import { forecastAge, weatherLocation, type WeatherForecast } from '@/lib/weather';

export function useWeather(lat:number,lon:number) {
  let key='';try{key=weatherLocation(lat,lon).key;}catch{}
  const [state,setState]=useState<{key:string;forecast?:WeatherForecast;loading:boolean;error:string;saved:boolean}>({key:'',loading:false,error:'',saved:true});
  const [revision,setRevision]=useState(0),[online,setOnline]=useState(navigator.onLine),[now,setNow]=useState(Date.now());
  const attempted=useRef(0);
  useEffect(()=>{const tick=()=>setNow(Date.now()),connection=()=>{setOnline(navigator.onLine);tick();};const timer=window.setInterval(tick,60000);window.addEventListener('online',connection);window.addEventListener('offline',connection);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);window.removeEventListener('focus',tick);};},[]);
  useEffect(()=>{
    if(!key)return;
    let active=true;const cached=readWeather(lat,lon);
    const force=revision!==attempted.current;attempted.current=revision;
    setState({key,forecast:cached,loading:false,error:'',saved:!cached||isWeatherSaved(cached)});
    if(!online||!force&&cached&&forecastAge(cached,now)==='fresh')return;
    // Debounce coordinate entry; late results are cached for their own site only.
    const timer=setTimeout(()=>{setState(s=>({...s,loading:true}));void fetchWeather(lat,lon,force).then(({forecast,saved})=>{if(active)setState({key,forecast,loading:false,error:'',saved});}).catch(error=>{if(active)setState(s=>({...s,loading:false,error:error instanceof Error&&error.name!=='AbortError'?error.message:'Could not update the forecast. Your saved report is unchanged.'}));});},700);
    return()=>{active=false;clearTimeout(timer);};
  },[key,online,revision,Math.floor(now/60000)]);
  const shown=state.key===key?state:{key,forecast:key?readWeather(lat,lon):undefined,loading:false,error:'',saved:!key||!readWeather(lat,lon)||isWeatherSaved(readWeather(lat,lon)!)};
  return {...shown,online,now,refresh:()=>setRevision(n=>n+1)};
}
