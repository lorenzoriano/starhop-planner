import { useMemo,useState,useId } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { CloudMoon,Cloud,CloudRain,ArrowUpRight,ChevronDown,RefreshCw,Wind,Droplets,Eye,Thermometer } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWeather } from '@/hooks/use-weather';
import { forecastAge,meanWeather,observingWeather,weatherVerdict,WEATHER_HOUR,type WeatherHour } from '@/lib/weather';

const value=(n:number|null|undefined,suffix='',digits=0)=>n==null?'Unavailable':`${n.toFixed(digits)}${suffix}`;
export function WeatherPanel({lat,lon,date,timezone,locationName,onTime}:{lat:number;lon:number;date:Date;timezone:string;locationName:string;onTime?:(at:Date)=>void}) {
  const weather=useWeather(lat,lon),forecast=weather.forecast;
  const report=useMemo(()=>forecast?observingWeather(forecast,date,timezone):null,[forecast,+date,timezone]);
  const [inspected,setInspected]=useState<{key:string;time:number}|null>(null);
  const profileKey=`${forecast?.key}:${report?.night.ok?+report.night.start:''}`;
  const hours=report?.hours??[];
  const current=inspected?.key===profileKey?hours.find(h=>h.time===inspected.time):undefined;
  const selected=current??hours.find(h=>h.time<=+date&&h.time+WEATHER_HOUR>+date)??hours.find(h=>h.time===report?.best?.start)??hours[0];
  const age=forecast?forecastAge(forecast,weather.now):null;
  const darkHours=hours.filter(h=>report?.night.ok&&report.night.segments.some(s=>h.time>=+s.start&&h.time+WEATHER_HOUR<=+s.end));
  const cloud=meanWeather(darkHours,'cloud');
  const verdict=cloud===null?{label:hours.length?'Hourly forecast':'Outside forecast range',tone:'unknown'}:weatherVerdict({cloud,rain:darkHours.every(h=>h.rain!==null)?Math.max(...darkHours.map(h=>h.rain!)):null,rainChance:darkHours.every(h=>h.rainChance!==null)?Math.max(...darkHours.map(h=>h.rainChance!)):null,visibility:darkHours.every(h=>h.visibility!==null)?Math.min(...darkHours.map(h=>h.visibility!)):null});
  const Icon=verdict.tone==='good'?CloudMoon:verdict.label==='Rain or snow likely'?CloudRain:Cloud;
  const time=(ms:number,pattern='HH:mm')=>formatInTimeZone(ms,timezone,pattern);
  const cacheLabel=!weather.online?age==='expired'?'Offline · expired forecast':age==='stale'?'Offline · older forecast':'Offline · saved forecast':weather.loading?'Updating…':age==='expired'?'Expired forecast':age==='stale'?'Older forecast':forecast?'Cached on this device':'Forecast';
  return <details className={`weather-panel weather-${verdict.tone}`} data-testid="weather-panel">
    <summary><span className="weather-site"><Icon size={19}/><span><strong>Observing weather</strong><small>{locationName}</small></span></span><span className="weather-glance"><strong>{forecast?verdict.label:weather.loading?'Fetching forecast…':weather.online?weather.error?'Weather unavailable':'Local forecast':'No saved forecast'}</strong><small>{cloud!==null?`${Math.round(cloud)}% cloud · `:''}Night {formatInTimeZone(date,timezone,'MMM d')}{age==='stale'||age==='expired'||!weather.online?` · ${cacheLabel}`:''}</small></span><ChevronDown className="weather-chevron" size={16}/></summary>
    <div className="weather-content">
      <div className="weather-update"><span>{forecast?`${cacheLabel} · Retrieved ${time(forecast.fetchedAt,'MMM d, HH:mm')}`:weather.online?'Connect once at each location to keep a forecast offline.':'This location has no saved forecast. Connect to fetch one.'}</span><button className="text-action" disabled={!weather.online||weather.loading} onClick={()=>weather.refresh()} aria-label="Refresh weather"><RefreshCw size={12} className={weather.loading?'animate-spin':''}/>{weather.loading?'Updating':'Refresh'}</button></div>
      {weather.error&&<p className="weather-message" role="status">{weather.error}{forecast?' Showing the last successful report.':''}</p>}
      {!weather.saved&&<p className="weather-message">Device storage is full or unavailable. This report will not survive closing the app.</p>}
      {age==='expired'&&<p className="weather-message">This forecast has expired. Its saved predictions are shown for reference, not as current conditions.</p>}
      {forecast&&!hours.length&&<p className="weather-message">No forecast for this observing night. This report covers {time(forecast.hours[0].time,'MMM d')}–{time(forecast.hours.at(-1)!.time,'MMM d, HH:mm')}. Forecasts extend about seven days ahead.</p>}
      {report?.night.ok&&!report.night.segments.length&&<p className="weather-message">No astronomical darkness on this date. The hourly weather is still available below.</p>}
      {hours.length>0&&selected&&<>
        <div className="weather-chart-heading"><span><i/>Cloud cover</span><span><i/>Precipitation chance</span><small>Shaded = astronomical darkness</small></div>
        <WeatherChart hours={hours} timezone={timezone} dark={report?.night.ok?report.night.segments:[]} selected={selected} onInspect={time=>setInspected({key:profileKey,time})}/>
        <div className="weather-at"><strong>{time(selected.time,'EEE, MMM d · HH:mm')} · {weatherVerdict(selected).label}</strong>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(selected.time))}>Use this observing time <ArrowUpRight size={12}/></button>}</div>
        <div className="weather-metrics">
          <div><Cloud size={15}/><span>Cloud cover<strong>{value(selected.cloud,'%')}</strong><small>Low {value(selected.low,'%')} · mid {value(selected.mid,'%')} · high {value(selected.high,'%')}</small></span></div>
          <div><Wind size={15}/><span>Wind<strong>{value(selected.wind,' km/h')}</strong><small>Gusts {value(selected.gust,' km/h')}</small></span></div>
          <div><Thermometer size={15}/><span>Temperature<strong>{value(selected.temp,'°C',1)}</strong><small>Dew point {value(selected.dew,'°C',1)}</small></span></div>
          <div><Droplets size={15}/><span>Humidity<strong>{value(selected.humidity,'%')}</strong><small>{selected.temp!==null&&selected.dew!==null?selected.temp-selected.dew<=2?'Increased dew risk':'Lower dew risk':'Dew risk unavailable'}</small></span></div>
          <div><CloudRain size={15}/><span>Rain / snow chance<strong>{value(selected.rainChance,'%')}</strong><small>{value(selected.rain,' mm',1)} in following hour</small></span></div>
          <div><Eye size={15}/><span>Weather visibility<strong>{selected.visibility===null?'Unavailable':`${(selected.visibility/1000).toFixed(1)} km`}</strong><small>Horizontal viewing distance</small></span></div>
        </div>
        <div className="weather-window">{report?.best?<><CloudMoon size={17}/><span><strong>Suggested weather window · {time(report.best.start,'MMM d, HH:mm')}–{time(report.best.end,time(report.best.end,'yyyy-MM-dd')===time(report.best.start,'yyyy-MM-dd')?'HH:mm':'MMM d, HH:mm')}</strong><small>{Math.round(report.best.cloud)}% average cloud · {Math.round(report.best.wind)} km/h wind · during astronomical darkness</small></span>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(report.best!.start))}>Plan <ArrowUpRight size={12}/></button>}</>:<span>No two-hour clear, dry window found in the available astronomical darkness.</span>}</div>
        {report?.partial&&<p className="weather-message">Only part of this noon-to-noon observing night is covered by the saved forecast.</p>}
      </>}
      <p className="weather-source">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Times in {timezone.replaceAll('_',' ')}.</p>
      <p className="weather-method">Weather visibility is not astronomical seeing or transparency. Cloud layers, dew and wind help plan a binocular session; Moon interference remains on each object’s graph. Forecasts are refreshed hourly while online and saved separately for each location.</p>
    </div>
  </details>;
}
function WeatherChart({hours,timezone,dark,selected,onInspect}:{hours:WeatherHour[];timezone:string;dark:{start:Date;end:Date}[];selected:WeatherHour;onInspect:(time:number)=>void}) {
  const mobile=useIsMobile(),width=mobile?360:650,left=34,right=width-14,plot=right-left;
  const id=`weather-${useId().replaceAll(':','')}`,start=hours[0].time,end=hours.at(-1)!.time+WEATHER_HOUR;
  const x=(ms:number)=>left+(ms-start)/(end-start)*plot,y=(percent:number)=>106-percent*.86;
  const paths=(key:'cloud'|'rainChance')=>{let path='',connected=false;for(const hour of hours){if(hour[key]===null){connected=false;continue;}path+=`${connected?'L':'M'}${x(hour.time).toFixed(2)},${y(hour[key]!).toFixed(2)} `;connected=true;}return path;};
  const choose=(px:number)=>{const ratio=Math.max(0,Math.min(.999999,px));onInspect(hours[Math.floor(ratio*hours.length)].time);};
  const hover=(e:React.PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();choose(((e.clientX-box.left)/box.width*width-left)/plot);};
  return <svg className="weather-chart" viewBox={`0 0 ${width} 142`} role="slider" tabIndex={0} aria-label="Hourly observing weather. Cloud cover and precipitation chance, both 0 to 100 percent." aria-valuemin={0} aria-valuemax={hours.length-1} aria-valuenow={hours.indexOf(selected)} aria-valuetext={`${formatInTimeZone(selected.time,timezone,'MMM d, HH:mm xxx')}, cloud ${value(selected.cloud,'%')}, precipitation chance ${value(selected.rainChance,'%')}`} onPointerMove={hover} onPointerDown={e=>{e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);hover(e);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onInspect(hours[e.key==='Home'?0:e.key==='End'?hours.length-1:Math.max(0,Math.min(hours.length-1,hours.indexOf(selected)+(e.key==='ArrowLeft'?-1:1)))].time);}}>
    <defs><clipPath id={id}><rect x={left} y="20" width={plot} height="86"/></clipPath></defs>
    <g clipPath={`url(#${id})`}>{dark.map(s=><rect key={+s.start} x={x(+s.start)} y="20" width={x(+s.end)-x(+s.start)} height="86" fill="#9bbfb2" opacity=".10"/>)}{hours.map(h=>h.cloud===null?null:<rect key={h.time} x={x(h.time)} y={y(h.cloud)} width={plot/hours.length+.3} height={106-y(h.cloud)} fill="#8eb9cf" opacity=".18"/>)}</g>
    {[0,50,100].map(n=><g key={n}><line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#2b4350" strokeDasharray="3 5"/><text x="25" y={y(n)+3} textAnchor="end" fill="#91aab5" fontSize="10">{n}%</text></g>)}
    <g clipPath={`url(#${id})`}><path d={paths('cloud')} fill="none" stroke="#a6cbdc" strokeWidth="2"/><path d={paths('rainChance')} fill="none" stroke="#d9bb7f" strokeWidth="1.8" strokeDasharray="5 4"/><line x1={x(selected.time)} x2={x(selected.time)} y1="20" y2="106" stroke="#e1e8da" strokeDasharray="2 3"/>{selected.cloud!==null&&<circle cx={x(selected.time)} cy={y(selected.cloud)} r="3" fill="#a6cbdc"/>}</g>
    {(mobile?[0,.5,1]:[0,.25,.5,.75,1]).map((part,i)=>{const at=start+(end-start)*part;return <text key={part} x={x(at)} y="126" textAnchor={i===0?'start':i===(mobile?2:4)?'end':'middle'} fill="#9ab0b7" fontSize="10">{formatInTimeZone(at,timezone,'HH:mm')}{formatInTimeZone(at,timezone,'dd')!==formatInTimeZone(start,timezone,'dd')?' +1d':''}</text>;})}
  </svg>;
}
