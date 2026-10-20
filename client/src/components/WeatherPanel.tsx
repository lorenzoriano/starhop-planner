import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import { useMemo,useState,useId } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { CloudMoon,Cloud,CloudRain,ArrowUpRight,ChevronDown,RefreshCw,Wind,Droplets,Eye,Thermometer } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { z } from 'zod';
import { useLocalState } from '@/hooks/use-local-state';
import { useForecastModels } from '@/hooks/use-forecast-models';
import { modelAt,modelAge,modelAgreement,type ForecastModels } from '@/lib/forecast-models';
import { stargazingHours,type StargazingProfile } from '@/lib/stargazing-forecast';
import { useWeather } from '@/hooks/use-weather';
import { forecastAge,meanWeather,observingWeather,weatherVerdict,WEATHER_HOUR,type WeatherHour } from '@/lib/weather';

const value=(n:number|null|undefined,suffix='',digits=0)=>n==null?'Unavailable':`${n.toFixed(digits)}${suffix}`;
export function WeatherPanel({lat,lon,date,timezone,locationName,onTime,skyBrightness=21.6}:{lat:number;lon:number;date:Date;timezone:string;locationName:string;skyBrightness?:number;onTime?:(at:Date)=>void}) {
  const weather=useWeather(lat,lon),forecast=weather.forecast;
  const [profile,setProfile]=useLocalState<StargazingProfile>('starhop-stargazing-profile-v1','binocular',z.enum(['binocular','deep-sky','lunar']));
  const [modelRevision,setModelRevision]=useState(0);
  const comparison=useForecastModels(lat,lon,weather.online,weather.now,modelRevision);
  const baseReport=useMemo(()=>forecast?observingWeather(forecast,date,timezone):null,[forecast,+date,timezone]);
  const outlooks=useMemo(()=>stargazingHours(baseReport?.hours??[],lat,lon,profile,comparison.forecast?.hours,skyBrightness),[baseReport,lat,lon,profile,comparison.forecast,skyBrightness]);
  const report=useMemo(()=>forecast?observingWeather(forecast,date,timezone,weather.now,pair=>{
    const values=pair.map(h=>outlooks.find(o=>o.time===h.time)?.score);
    return values.every((v):v is number=>v!==null&&v!==undefined)?100-values.reduce((a,b)=>a+b,0)/values.length:Infinity;
  }):null,[forecast,+date,timezone,weather.now,outlooks]);
  const [inspected,setInspected]=useState<{key:string;time:number}|null>(null);
  const profileKey=`${forecast?.key}:${report?.night.ok?+report.night.start:''}`;
  const hours=report?.hours??[];
  const current=inspected?.key===profileKey?hours.find(h=>h.time===inspected.time):undefined;
  const selected=current??hours.find(h=>h.time<=+date&&h.time+WEATHER_HOUR>+date)??hours.find(h=>h.time===report?.best?.start)??hours[0];
  const outlook=outlooks.find(o=>o.time===selected?.time);
  const selectedModels=selected?modelAt(comparison.forecast,selected.time):undefined;
  const comparisonAge=comparison.forecast?modelAge(comparison.forecast,weather.now):null;
  const tentative=report?.best?[report.best.start,report.best.start+WEATHER_HOUR].some(t=>(modelAgreement(modelAt(comparison.forecast,t)).spread??0)>30):false;
  const age=forecast?forecastAge(forecast,weather.now):null;
  const darkHours=hours.filter(h=>report?.night.ok&&report.night.segments.some(s=>h.time>=+s.start&&h.time+WEATHER_HOUR<=+s.end));
  const cloud=meanWeather(darkHours,'cloud');
  const verdict=cloud===null?{label:hours.length?'Hourly forecast':'Outside forecast range',tone:'unknown'}:weatherVerdict({cloud,rain:darkHours.every(h=>h.rain!==null)?Math.max(...darkHours.map(h=>h.rain!)):null,rainChance:darkHours.every(h=>h.rainChance!==null)?Math.max(...darkHours.map(h=>h.rainChance!)):null,visibility:darkHours.every(h=>h.visibility!==null)?Math.min(...darkHours.map(h=>h.visibility!)):null});
  const Icon=verdict.tone==='good'?CloudMoon:verdict.label==='Rain or snow likely'?CloudRain:Cloud;
  const time=(ms:number,pattern='HH:mm')=>formatInTimeZone(ms,timezone,pattern);
  const cacheLabel=!weather.online?age==='expired'?'Offline · expired forecast':age==='stale'?'Offline · older forecast':'Offline · saved forecast':weather.loading?'Updating…':age==='expired'?'Expired forecast':age==='stale'?'Older forecast':forecast?'Cached on this device':'Forecast';
  return <details className={`weather-panel weather-${verdict.tone}`} data-testid="weather-panel">
    <summary><span className="weather-site"><Icon size={19}/><span><strong>Stargazing forecast</strong><small>{locationName}</small></span></span><span className="weather-glance"><strong>{forecast?verdict.label:weather.loading?'Fetching forecast…':weather.online?weather.error?'Weather unavailable':'Local forecast':'No saved forecast'}</strong><small>{cloud!==null?`${Math.round(cloud)}% cloud · `:''}Night {formatInTimeZone(date,timezone,'MMM d')}{age==='stale'||age==='expired'||!weather.online?` · ${cacheLabel}`:''}</small></span><ChevronDown className="weather-chevron" size={16}/></summary>
    <div className="weather-content"><div className="context-actions"><ContextDateButton value={date} timezone={timezone} onChange={onTime}/><ContextLocationButton>{locationName}</ContextLocationButton></div>
      <div className="weather-update"><span>{forecast?`${cacheLabel} · Retrieved ${time(forecast.fetchedAt,'MMM d, HH:mm')}`:weather.online?'Connect once at each location to keep a forecast offline.':'This location has no saved forecast. Connect to fetch one.'}</span><button className="text-action" disabled={!weather.online||weather.loading} onClick={()=>{weather.refresh();setModelRevision(n=>n+1);}} aria-label="Refresh weather"><RefreshCw size={12} className={weather.loading?'animate-spin':''}/>{weather.loading?'Updating':'Refresh'}</button></div>
      {weather.error&&<p className="weather-message" role="status">{weather.error}{forecast?' Showing the last successful report.':''}</p>}
      {!weather.saved&&<p className="weather-message">Device storage is full or unavailable. This report will not survive closing the app.</p>}
      {age==='expired'&&<p className="weather-message">This forecast has expired. Its saved predictions are shown for reference, not as current conditions.</p>}
      {forecast&&!hours.length&&<p className="weather-message">No forecast for this observing night. This report covers {time(forecast.hours[0].time,'MMM d')}–{time(forecast.hours.at(-1)!.time,'MMM d, HH:mm')}. Forecasts extend about seven days ahead.</p>}
      {report?.night.ok&&!report.night.segments.length&&<p className="weather-message">No astronomical darkness on this date. The hourly weather is still available below.</p>}
      {hours.length>0&&selected&&<>
        <div className="stargazing-controls"><label>Observing <select aria-label="Stargazing forecast profile" value={profile} onChange={e=>setProfile(e.target.value as StargazingProfile)}><option value="binocular">Binocular sky</option><option value="deep-sky">Faint deep sky</option><option value="lunar">Moon & planets</option></select></label><span>Inspect the chart to compare each hour</span></div>
        {outlook&&<section className={`stargazing-outlook outlook-${outlook.score===null?'unknown':outlook.score>=70?'good':outlook.score>=45?'mixed':'poor'}`} aria-label="Astronomy observing outlook">
          <div className="stargazing-score"><strong>{outlook.score??'—'}<small>/100</small></strong><span>{outlook.label}<small>{outlook.cloudRange?`Cloud-model range ${outlook.cloudRange.min}–${outlook.cloudRange.max} · planning estimate`:'Planning estimate'}</small></span></div>
          <p>{outlook.reasons.slice(0,3).join(' · ')||'Check cloud, wind and Moon conditions together.'}</p>
          <div className="stargazing-factors"><span>Moon <strong>{Math.round(outlook.moon.illumination*100)}% lit · {outlook.moonDown?'below horizon':`${Math.round(outlook.moon.alt)}° high`}</strong><small>{profile==='lunar'?'No moonlight penalty for Moon/planet work':!outlook.dark?'Daylight / twilight dominates sky brightness':`≈${outlook.glow.toFixed(1)} mag zenith sky brightening`}</small></span><span>Cloud models <strong>{modelAgreement(selectedModels).label}</strong><small>ECMWF {value(selectedModels?.ecmwf,'%')} · GFS {value(selectedModels?.gfs,'%')}</small></span><span>Jet stream <strong>{value(outlook.jet,' km/h')}</strong><small>{outlook.jet===null?'Upper-air forecast unavailable':outlook.jet>150?'Strong flow · fine detail may soften':outlook.jet>80?'Moderate upper-air flow':'Lighter upper-air flow'} · 250 hPa</small></span></div>
        </section>}
        <div className="weather-chart-heading"><span><i/>Cloud cover</span><span><i/>Precipitation chance</span><small>Band = ECMWF↔GFS cloud range · shaded = darkness</small></div>
        <WeatherChart models={comparison.forecast} hours={hours} timezone={timezone} dark={report?.night.ok?report.night.segments:[]} selected={selected} onInspect={time=>setInspected({key:profileKey,time})}/>
        <div className="weather-at"><strong>{time(selected.time,'EEE, MMM d · HH:mm')} · {weatherVerdict(selected).label}</strong>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(selected.time))}>Use this observing time <ArrowUpRight size={12}/></button>}</div>
        <div className="weather-metrics">
          <div><Cloud size={15}/><span>Cloud cover<strong>{value(selected.cloud,'%')}</strong><small>Low {value(selected.low,'%')} · mid {value(selected.mid,'%')} · high {value(selected.high,'%')}</small></span></div>
          <div><Wind size={15}/><span>Wind<strong>{value(selected.wind,' km/h')}</strong><small>Gusts {value(selected.gust,' km/h')}</small></span></div>
          <div><Thermometer size={15}/><span>Temperature<strong>{value(selected.temp,'°C',1)}</strong><small>Dew point {value(selected.dew,'°C',1)}</small></span></div>
          <div><Droplets size={15}/><span>Humidity<strong>{value(selected.humidity,'%')}</strong><small>{selected.temp!==null&&selected.dew!==null?selected.temp-selected.dew<=2?'Increased dew risk':'Lower dew risk':'Dew risk unavailable'}</small></span></div>
          <div><CloudRain size={15}/><span>Rain / snow chance<strong>{value(selected.rainChance,'%')}</strong><small>{value(selected.rain,' mm',1)} in following hour</small></span></div>
          <div><Eye size={15}/><span>Weather visibility<strong>{selected.visibility===null?'Unavailable':`${(selected.visibility/1000).toFixed(1)} km`}</strong><small>Horizontal viewing distance</small></span></div>
        </div>
        <div className="weather-window">{report?.best?<><CloudMoon size={17}/><span><strong>{tentative?'Tentative':'Suggested'} stargazing window · {time(report.best.start,'MMM d, HH:mm')}–{time(report.best.end,time(report.best.end,'yyyy-MM-dd')===time(report.best.start,'yyyy-MM-dd')?'HH:mm':'MMM d, HH:mm')}</strong><small>{Math.round(report.best.cloud)}% average cloud · {Math.round(report.best.wind)} km/h wind · during astronomical darkness{tentative?' · Cloud forecasts disagree; check again before going.':''}</small></span>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(report.best!.start))}>Plan <ArrowUpRight size={12}/></button>}</>:<span>No two-hour clear, dry window found in the available astronomical darkness.</span>}</div>
        {report?.partial&&<p className="weather-message">Only part of this noon-to-noon observing night is covered by the saved forecast.</p>}
      </>}
      <div className="stargazing-model-status">{comparison.forecast?<>ECMWF IFS 0.25° + NOAA GFS · {weather.online?'Cached':'Offline cache'} · Retrieved {time(comparison.forecast.fetchedAt,'MMM d, HH:mm')}{comparisonAge!=='fresh'?` · ${comparisonAge==='expired'?'Expired comparison':'Older comparison'}`:''}</>:comparison.loading?'Fetching ECMWF / GFS comparison…':comparison.error||'No saved model comparison for this location.'}{comparison.forecast&&comparison.error&&<span> {comparison.error}</span>}{!comparison.saved&&<span> Model comparison could not be saved on this device.</span>}</div>
      <div className="stargazing-compare"><span>Compare this location</span><a href={`https://clearoutside.com/forecast/${lat.toFixed(3)}/${lon.toFixed(3)}`} target="_blank" rel="noreferrer">Clear Outside <ArrowUpRight size={12}/></a><a href={`https://www.astrospheric.com/?Latitude=${lat}&Longitude=${lon}&Loc=Forecast`} target="_blank" rel="noreferrer">Astrospheric <ArrowUpRight size={12}/></a></div>
      <p className="weather-source">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Times in {timezone.replaceAll('_',' ')}.</p>
      <p className="weather-method">The outlook combines cloud, dew, wind, haze risk, astronomical darkness and modeled Moon sky glow and your assumed moonless sky brightness. Binocular and faint-object profiles respond differently to moonlight; Moon/planet work does not get a Moon penalty. Jet-stream wind is a rough steadiness indicator, not a seeing measurement in arcseconds. Weather visibility is horizontal distance, not astronomical transparency. Object altitude and Moon distance remain on each object’s graph.</p>
    </div>
  </details>;
}
function WeatherChart({hours,timezone,dark,selected,onInspect,models}:{models?:ForecastModels;hours:WeatherHour[];timezone:string;dark:{start:Date;end:Date}[];selected:WeatherHour;onInspect:(time:number)=>void}) {
  const mobile=useIsMobile(),width=mobile?360:650,left=34,right=width-14,plot=right-left;
  const id=`weather-${useId().replaceAll(':','')}`,start=hours[0].time,end=hours.at(-1)!.time+WEATHER_HOUR;
  const x=(ms:number)=>left+(ms-start)/(end-start)*plot,y=(percent:number)=>106-percent*.86;
  const paths=(key:'cloud'|'rainChance')=>{let path='',connected=false;for(const hour of hours){if(hour[key]===null){connected=false;continue;}path+=`${connected?'L':'M'}${x(hour.time).toFixed(2)},${y(hour[key]!).toFixed(2)} `;connected=true;}return path;};
  const choose=(px:number)=>{const ratio=Math.max(0,Math.min(.999999,px));onInspect(hours[Math.floor(ratio*hours.length)].time);};
  const hover=(e:React.PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();choose(((e.clientX-box.left)/box.width*width-left)/plot);};
  return <svg className="weather-chart" viewBox={`0 0 ${width} 142`} role="slider" tabIndex={0} aria-label="Hourly observing weather. Cloud cover and precipitation chance, both 0 to 100 percent. The band spans ECMWF and GFS cloud forecasts, not a statistical confidence interval." aria-valuemin={0} aria-valuemax={hours.length-1} aria-valuenow={hours.indexOf(selected)} aria-valuetext={`${formatInTimeZone(selected.time,timezone,'MMM d, HH:mm xxx')}, cloud ${value(selected.cloud,'%')}, precipitation chance ${value(selected.rainChance,'%')}`} onPointerMove={hover} onPointerDown={e=>{e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);hover(e);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onInspect(hours[e.key==='Home'?0:e.key==='End'?hours.length-1:Math.max(0,Math.min(hours.length-1,hours.indexOf(selected)+(e.key==='ArrowLeft'?-1:1)))].time);}}>
    <defs><clipPath id={id}><rect x={left} y="20" width={plot} height="86"/></clipPath></defs>
    <g clipPath={`url(#${id})`}>{dark.map(s=><rect key={+s.start} x={x(+s.start)} y="20" width={x(+s.end)-x(+s.start)} height="86" fill="#9bbfb2" opacity=".10"/>)}{hours.map(h=>h.cloud===null?null:<rect key={h.time} x={x(h.time)} y={y(h.cloud)} width={plot/hours.length+.3} height={106-y(h.cloud)} fill="#8eb9cf" opacity=".18"/>)}</g>
    {[0,50,100].map(n=><g key={n}><line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#2b4350" strokeDasharray="3 5"/><text x="25" y={y(n)+3} textAnchor="end" fill="#91aab5" fontSize="10">{n}%</text></g>)}
    <g clipPath={`url(#${id})`}>{(()=>{
      const groups:{time:number;a:number;b:number}[][]=[];let group:{time:number;a:number;b:number}[]=[];
      for(const h of hours){const m=modelAt(models,h.time);if(m&&m.ecmwf!==null&&m.gfs!==null)group.push({time:h.time,a:m.ecmwf,b:m.gfs});else if(group.length){groups.push(group);group=[];}}if(group.length)groups.push(group);
      return groups.map((g,i)=><path key={i} data-model-cloud-band="true" d={`${g.map((p,j)=>`${j?'L':'M'}${x(p.time)},${y(p.a)}`).join(' ')} ${g.slice().reverse().map(p=>`L${x(p.time)},${y(p.b)}`).join(' ')} Z`} fill="#c3add8" opacity=".25"/>);
    })()}<path d={paths('cloud')} fill="none" stroke="#a6cbdc" strokeWidth="2"/><path d={paths('rainChance')} fill="none" stroke="#d9bb7f" strokeWidth="1.8" strokeDasharray="5 4"/><line x1={x(selected.time)} x2={x(selected.time)} y1="20" y2="106" stroke="#e1e8da" strokeDasharray="2 3"/>{selected.cloud!==null&&<circle cx={x(selected.time)} cy={y(selected.cloud)} r="3" fill="#a6cbdc"/>}</g>
    {(mobile?[0,.5,1]:[0,.25,.5,.75,1]).map((part,i)=>{const at=start+(end-start)*part;return <text key={part} x={x(at)} y="126" textAnchor={i===0?'start':i===(mobile?2:4)?'end':'middle'} fill="#9ab0b7" fontSize="10">{formatInTimeZone(at,timezone,'HH:mm')}{formatInTimeZone(at,timezone,'dd')!==formatInTimeZone(start,timezone,'dd')?' +1d':''}</text>;})}
  </svg>;
}
