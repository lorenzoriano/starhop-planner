import { useEffect,useRef,useState } from 'react';
import { weatherLocation } from '@/lib/weather';
import { readForecastModels,fetchForecastModels,modelAge,modelsSaved,type ForecastModels } from '@/lib/forecast-models';
export function useForecastModels(lat:number,lon:number,online:boolean,now:number,revision:number) {
  const key=weatherLocation(lat,lon).key,attempted=useRef(revision);
  const [state,setState]=useState<{key:string;forecast?:ForecastModels;loading:boolean;error:string;saved:boolean}>({key:'',loading:false,error:'',saved:true});
  useEffect(()=>{
    let active=true;const cached=readForecastModels(lat,lon),force=revision!==attempted.current;attempted.current=revision;
    setState({key,forecast:cached,loading:false,error:'',saved:!cached||modelsSaved(cached)});
    if(!online||!force&&cached&&modelAge(cached,now)==='fresh')return;
    const timer=setTimeout(()=>{setState(s=>({...s,loading:true}));void fetchForecastModels(lat,lon,force).then(({forecast,saved})=>{if(active)setState({key,forecast,loading:false,error:'',saved});}).catch(()=>{if(active)setState(s=>({...s,loading:false,error:'Model comparison unavailable. Showing saved data where available.'}));});},750);
    return()=>{active=false;clearTimeout(timer);};
  },[key,online,Math.floor(now/60000),revision]);
  return state.key===key?state:{key,forecast:readForecastModels(lat,lon),loading:false,error:'',saved:true};
}
