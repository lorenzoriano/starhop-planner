import { useSvgWidth } from '@/hooks/use-svg-width';
import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import { useMemo,useState,useId } from 'react';
import { formatInTimeZone,fromZonedTime } from 'date-fns-tz';
import { CloudMoon,Cloud,CloudRain,ArrowUpRight,ChevronDown,RefreshCw,Wind,Droplets,Eye,Thermometer } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { z } from 'zod';
import { useLocalState } from '@/hooks/use-local-state';
import { useForecastModels } from '@/hooks/use-forecast-models';
import { modelAt,modelAge,modelAgreement,type ForecastModels } from '@/lib/forecast-models';
import { daylightSpans,hourAt,modelRange,moonAtTime,moonSpans,rainPeaks,sampleTimes,twilightStops,type SkySample } from '@/lib/weather-chart';
import { stargazingHours,type StargazingProfile } from '@/lib/stargazing-forecast';
import { useWeather } from '@/hooks/use-weather';
import { forecastAge,meanWeather,observingWeather,weatherVerdict,WEATHER_HOUR,type WeatherHour } from '@/lib/weather';
import { moonDay,moonState } from '@/lib/moon';
import { clockNightDate } from '@/lib/astronomical-clock';
import { visibilityWindow } from '@/lib/target-visibility';
import './WeatherOverview.css';

const value=(n:number|null|undefined,suffix='',digits=0)=>n==null?'Unavailable':`${n.toFixed(digits)}${suffix}`;
export function WeatherPanel({lat,lon,date,timezone,locationName,onTime,skyBrightness=21.6,overview=false,onPlanNight}:{lat:number;lon:number;date:Date;timezone:string;locationName:string;skyBrightness?:number;onTime?:(at:Date)=>void;overview?:boolean;onPlanNight?:(at:Date)=>void}) {
  const mobile=useIsMobile();
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
  const nightDate=clockNightDate(date,timezone);
  const astronomicalNight=useMemo(()=>visibilityWindow(nightDate,'12:00','12:00','night',timezone,lat,lon),[nightDate,timezone,lat,lon]);
  const chosenMoon=useMemo(()=>moonState(lat,lon,date),[lat,lon,+date]);
  const lunarEvents=useMemo(()=>moonDay(lat,lon,date,timezone),[lat,lon,+date,timezone]);
  const [inspected,setInspected]=useState<{key:string;time:number}|null>(null);
  const profileKey=`${forecast?.key}:${report?.night.ok?+report.night.start:''}`;
  const hours=report?.hours??[];
  const current=inspected?.key===profileKey?hours.find(h=>h.time===inspected.time):undefined;
  const selected=current??hours.find(h=>h.time<=+date&&h.time+WEATHER_HOUR>+date);
  const reportHours=report?.hours;
  const sky=useMemo<SkySample[]>(()=>reportHours?.length?sampleTimes(reportHours[0].time,reportHours.at(-1)!.time+WEATHER_HOUR).map(t=>{const m=moonState(lat,lon,new Date(t));return {time:t,sunAlt:m.sunAlt,moonAlt:m.alt+m.diameter/2,illumination:m.illumination};}):[],[reportHours,lat,lon]);
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
  const darkSegments=astronomicalNight.ok?astronomicalNight.segments:[];
  const dusk=darkSegments[0]?.start??null,dawn=darkSegments.at(-1)?.end??null;
  const planAt=report?.best?new Date(report.best.start):dusk?new Date(+dusk+15*60_000):null;
  const overviewForecast=!forecast?(weather.loading?'Fetching forecast…':weather.online?'Forecast unavailable':'No saved forecast'):!report?'Forecast unavailable':!report.darkCovered?'Forecast does not cover all dark hours':cloud===null?'Cloud forecast unavailable':verdict.label;
  const overviewWindow=!astronomicalNight.ok||!darkSegments.length?'No astronomical darkness on this night':report?.best?`Best covered 2-hour window · ${time(report.best.start,'HH:mm')}–${time(report.best.end,time(report.best.start,'yyyy-MM-dd')===time(report.best.end,'yyyy-MM-dd')?'HH:mm':'MMM d, HH:mm')}`:report?.darkCovered?'No qualifying 2-hour window in the covered forecast':'Not enough forecast coverage to judge a 2-hour window';
  const moonEvent=(at:Date|null)=>at?time(+at,'MMM d, HH:mm'):'None this night';
  const cacheLabel=!weather.online?age==='expired'?'Offline · expired forecast':age==='stale'?'Offline · older forecast':'Offline · saved forecast':weather.loading?'Updating…':age==='expired'?'Expired forecast':age==='stale'?'Older forecast':'Forecast';
  return <>{overview&&<section className={`weather-overview weather-overview-${report?.darkCovered&&cloud!==null?verdict.tone:'unknown'}`} aria-label="Observing night weather and sky conditions">
    <div className="weather-overview-heading"><div><span className="eyebrow">OBSERVING NIGHT · {formatInTimeZone(astronomicalNight.ok?astronomicalNight.start:date,timezone,'EEE, MMM d')} <span className="weather-overview-location">· {locationName}</span></span><strong>{overviewForecast}</strong><small>{!report?.darkCovered&&report?.best?'Some forecasted hours are available; the full night is not covered.':cloud!==null&&report?.darkCovered?`Night average: ${Math.round(cloud)}% cloud`:weather.error||'Missing forecast data remains unknown.'}</small></div><span className="weather-overview-cache">{cacheLabel}</span></div>
    <div className="weather-overview-dark"><span>Astronomical darkness</span><strong>{dusk&&dawn?`${time(+dusk,'HH:mm')} – ${time(+dawn,time(+dusk,'yyyy-MM-dd')===time(+dawn,'yyyy-MM-dd')?'HH:mm':'MMM d, HH:mm')}`:'No dusk or dawn this night'}</strong></div>
    {mobile?<details className="weather-overview-more"><summary>The Moon is {Math.round(chosenMoon.illumination*100)}% lit and {chosenMoon.alt>0?`${Math.round(chosenMoon.alt)}° high`:"below the horizon"}. Show sky and forecast details.</summary><div className="weather-overview-facts"><div><span>Moonrise · moonset</span><strong>{moonEvent(lunarEvents.rise)} · {moonEvent(lunarEvents.set)}</strong><small>At chosen time: Moon {Math.round(chosenMoon.illumination*100)}% lit · {chosenMoon.alt>0?`${Math.round(chosenMoon.alt)}° high`:"below horizon"}</small></div><div><span>Forecast window</span><strong>{overviewWindow}</strong><small>{report?.best?`${Math.round(report.best.cloud)}% average cloud · ${Math.round(report.best.wind)} km/h wind`:overviewWindow.includes('Not enough')?'Uncovered hours are not treated as poor conditions':'Based on the available forecast'}</small></div></div></details>:<div className="weather-overview-facts"><div><span>Moonrise · moonset</span><strong>{moonEvent(lunarEvents.rise)} · {moonEvent(lunarEvents.set)}</strong><small>At chosen time: Moon {Math.round(chosenMoon.illumination*100)}% lit · {chosenMoon.alt>0?`${Math.round(chosenMoon.alt)}° high`:"below horizon"}</small></div><div><span>Forecast window</span><strong>{overviewWindow}</strong><small>{report?.best?`${Math.round(report.best.cloud)}% average cloud · ${Math.round(report.best.wind)} km/h wind`:overviewWindow.includes('Not enough')?'Uncovered hours are not treated as poor conditions':'Based on the available forecast'}</small></div></div>}
    <div className="weather-overview-actions">{onPlanNight&&<button type="button" disabled={!planAt} onClick={()=>planAt&&onPlanNight(planAt)}>{planAt?'Plan this night':'No dark window to plan'}</button>}{onTime&&<button type="button" className="weather-overview-details" onClick={()=>{const panel=document.querySelector<HTMLDetailsElement>('[data-testid="weather-panel"]');if(panel)panel.open=true;panel?.scrollIntoView({behavior:'smooth',block:'center'});}}>Hourly forecast</button>}</div>
  </section>}<details className={`weather-panel weather-${verdict.tone}`} data-testid="weather-panel">
    <summary><span className="weather-site"><Icon size={19}/><span><strong>Stargazing forecast</strong><small>{locationName}</small></span></span><span className="weather-glance"><strong>{forecast?verdict.label:weather.loading?'Fetching forecast…':weather.online?weather.error?'Weather unavailable':'Local forecast':'No saved forecast'}</strong><small>{cloud!==null?`Night average: ${Math.round(cloud)}% cloud · `:''}Night {report?.night.ok?formatInTimeZone(report.night.start,timezone,'MMM d'):formatInTimeZone(date,timezone,'MMM d')}{age==='stale'||age==='expired'||!weather.online?` · ${cacheLabel}`:''}</small></span><ChevronDown className="weather-chevron" size={16}/></summary>
    <div className="weather-content"><div className="context-actions"><ContextDateButton value={date} timezone={timezone} onChange={onTime}/><ContextLocationButton>{locationName}</ContextLocationButton></div>
      <div className="weather-update"><span>{forecast?`${cacheLabel} · Retrieved ${time(forecast.fetchedAt,'MMM d, HH:mm')}`:weather.online?'Connect once at each location to keep a forecast offline.':'This location has no saved forecast. Connect to fetch one.'}</span><button className="text-action" disabled={!weather.online||weather.loading} onClick={()=>{weather.refresh();setModelRevision(n=>n+1);}} aria-label="Refresh weather"><RefreshCw size={12} className={weather.loading?'animate-spin':''}/>{weather.loading?'Updating':'Refresh'}</button></div>
      {weather.error&&<p className="weather-message" role="status">{weather.error}{forecast?' Showing the last successful report.':''}</p>}
      {!weather.saved&&<p className="weather-message">Device storage is full or unavailable. This report will not survive closing the app.</p>}
      {age==='expired'&&<p className="weather-message">This forecast has expired. Its predictions are shown for reference, not as current conditions.</p>}
      {forecast&&!hours.length&&<p className="weather-message">No forecast for this observing night. This report covers {time(forecast.hours[0].time,'MMM d')}–{time(forecast.hours.at(-1)!.time,'MMM d, HH:mm')}. Forecasts extend about seven days ahead.</p>}
      {report?.night.ok&&!report.night.segments.length&&<p className="weather-message">No astronomical darkness on this date. The hourly weather is still available below.</p>}
      {!selected&&<p className="weather-message" role="status">{hours.length?`The selected time is outside the available forecast (${time(hours[0].time,'MMM d, HH:mm')}–${time(hours.at(-1)!.time+WEATHER_HOUR,'MMM d, HH:mm')}). ${report?.darkCovered?"Choose a time within that range.":"The dark hours of this night are not fully forecast yet. Missing data does not mean bad weather."}`:"No hourly forecast overlaps this observing night. Missing data does not mean bad weather."}</p>}
      {hours.length>0&&selected&&<>
        <div className="stargazing-controls"><label>Observing <select aria-label="Stargazing forecast profile" value={profile} onChange={e=>setProfile(e.target.value as StargazingProfile)}><option value="binocular">Binocular sky</option><option value="deep-sky">Faint deep sky</option><option value="lunar">Moon & planets</option></select></label><span>Inspect the chart to compare each hour</span></div>
        {outlook&&<section className={`stargazing-outlook outlook-${outlook.score===null?'unknown':outlook.score>=70?'good':outlook.score>=45?'mixed':'poor'}`} aria-label="Astronomy observing outlook">
          <div className="stargazing-score"><strong>{outlook.score??'—'}<small>/100</small></strong><span>{outlook.label}<small>{outlook.cloudRange?`Score across models: ${outlook.cloudRange.min}–${outlook.cloudRange.max} · planning estimate`:'Planning estimate'}</small></span></div>
          <p>{[...(outlook.dark&&!outlook.moonDown&&outlook.glow>.7&&profile!=='lunar'?[`Bright Moon: ${Math.round(outlook.moon.illumination*100)}% lit, ${Math.round(outlook.moon.alt)}° high`]:[]),...outlook.reasons].slice(0,3).join(' · ')||'Check cloud, wind and Moon conditions together.'}</p>
          <div className="stargazing-factors"><span>Moon <strong>{Math.round(outlook.moon.illumination*100)}% lit · {outlook.moonDown?'below horizon':`${Math.round(outlook.moon.alt)}° high`}</strong><small>{profile==='lunar'?'No moonlight penalty for Moon/planet work':!outlook.dark?'Daylight / twilight dominates sky brightness':`≈${outlook.glow.toFixed(1)} mag zenith sky brightening`}</small></span><span>Cloud models <strong>{modelAgreement(selectedModels).label}</strong><small>ECMWF {value(selectedModels?.ecmwf,'%')} · GFS {value(selectedModels?.gfs,'%')}</small></span><span>Jet stream <strong>{value(outlook.jet,' km/h')}</strong><small>{outlook.jet===null?'Upper-air forecast unavailable':outlook.jet>150?'Strong flow · fine detail may soften':outlook.jet>80?'Moderate upper-air flow':'Lighter upper-air flow'} · 250 hPa</small></span></div>
        </section>}
        <div className="weather-chart-heading" aria-hidden="true"><span><i className="key-sky"/>Day · twilight · <b>dark</b></span><span><i className="key-cloud"/>Cloud cover</span><span><i className="key-range"/>ECMWF–GFS range</span><span><i className="key-rain"/>Rain chance</span><span><i className="key-moon"/>Moon up</span><span><i className="key-selected"/>Selected hour</span></div>
        <WeatherChart models={comparison.forecast} hours={hours} timezone={timezone} sky={sky} dark={report?.night.ok?report.night.segments:[]} selected={selected} onInspect={time=>setInspected({key:profileKey,time})}/>
        <div className="weather-at"><div><strong>{time(selected.time,'EEE, MMM d · HH:mm')}–{time(selected.time+WEATHER_HOUR)} · {weatherVerdict(selected).label}</strong><HourReadout hour={selected} models={comparison.forecast} sky={sky} dark={report?.night.ok?report.night.segments:[]}/></div>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(selected.time))}>Use this observing time</button>}</div>
        <div className="weather-metrics">
          <div><Cloud size={15}/><span>Cloud cover<strong>{value(selected.cloud,'%')}</strong><small>Low {value(selected.low,'%')} · mid {value(selected.mid,'%')} · high {value(selected.high,'%')}</small></span></div>
          <div><Wind size={15}/><span>Wind<strong>{value(selected.wind,' km/h')}</strong><small>Gusts {value(selected.gust!==null&&selected.wind!==null&&selected.gust<selected.wind?null:selected.gust,' km/h')}</small></span></div>
          <div><Thermometer size={15}/><span>Temperature<strong>{value(selected.temp,'°C',1)}</strong><small>Dew point {value(selected.dew,'°C',1)}</small></span></div>
          <div><Droplets size={15}/><span>Humidity<strong>{value(selected.humidity,'%')}</strong><small>{selected.temp!==null&&selected.dew!==null?selected.temp-selected.dew<=2?'Increased dew risk':'Lower dew risk':'Dew risk unavailable'}</small></span></div>
          <div><CloudRain size={15}/><span>Rain / snow chance<strong>{value(selected.rainChance,'%')}</strong><small>{value(selected.rain,' mm',1)} in following hour</small></span></div>
          <div><Eye size={15}/><span>Weather visibility<strong>{selected.visibility===null?'Unavailable':`${(selected.visibility/1000).toFixed(1)} km`}</strong><small>Horizontal viewing distance</small></span></div>
        </div>
        <div className="weather-window">{report?.best?<><CloudMoon size={17}/><span><strong>{tentative?'Tentative':'Suggested'} stargazing window · {time(report.best.start,'MMM d, HH:mm')}–{time(report.best.end,time(report.best.end,'yyyy-MM-dd')===time(report.best.start,'yyyy-MM-dd')?'HH:mm':'MMM d, HH:mm')}</strong><small>{Math.round(report.best.cloud)}% average cloud · {Math.round(report.best.wind)} km/h wind · during astronomical darkness{tentative?' · Cloud forecasts disagree; check again before going.':''}</small></span>{onTime&&<button className="text-action" onClick={()=>onTime(new Date(report.best!.start))}>Plan</button>}</>:<span>{report?.night.ok&&!report.night.segments.length?"No astronomical darkness on this date, so no dark-sky window is assessed.":report?.darkCovered?"No two-hour clear, dry window found in this night’s astronomical darkness.":"Not enough forecast coverage of the dark hours to judge a clear window."}</span>}</div>
        {report?.partial&&<p className="weather-message">Only part of this noon-to-noon observing night is covered by the {weather.online?'available':'offline'} forecast.</p>}
      </>}
    <div className="stargazing-model-status">{comparison.forecast?<>ECMWF IFS 0.25° + NOAA GFS · {weather.online?'Live':'Offline cache'} · Retrieved {time(comparison.forecast.fetchedAt,'MMM d, HH:mm')}{comparisonAge!=='fresh'?` · ${comparisonAge==='expired'?'Expired comparison':'Older comparison'}`:''}</>:comparison.loading?'Fetching ECMWF / GFS comparison…':comparison.error||'No model comparison for this location.'}{comparison.forecast&&comparison.error&&<span> {comparison.error}</span>}{!comparison.saved&&<span> Model comparison could not be saved on this device.</span>}</div>
      <div className="stargazing-compare"><span>Compare this location</span><a href={`https://clearoutside.com/forecast/${lat.toFixed(3)}/${lon.toFixed(3)}`} target="_blank" rel="noreferrer">Clear Outside <ArrowUpRight size={12}/></a><a href={`https://www.astrospheric.com/?Latitude=${lat}&Longitude=${lon}&Loc=Forecast`} target="_blank" rel="noreferrer">Astrospheric <ArrowUpRight size={12}/></a></div>
      <p className="weather-source">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Times in {timezone.replaceAll('_',' ')}.</p>
      <p className="weather-method">The outlook combines cloud, dew, wind, haze risk, astronomical darkness and modeled Moon sky glow and your assumed moonless sky brightness. Binocular and faint-object profiles respond differently to moonlight; Moon/planet work does not get a Moon penalty. Jet-stream wind is a rough steadiness indicator, not a seeing measurement in arcseconds. Weather visibility is horizontal distance, not astronomical transparency. Object altitude and Moon distance remain on each object’s graph.</p>
    </div>
  </details></>;
}
/** Chart palette. Hues stay apart (blue-white cloud, amber rain, cream Moon) and so do luminances, because red light folds everything into one red. */
const SKY={day:'#2b5366',dark:'#02050a',edge:'#8fb3c7'},CLOUD='#dbe8ef',RANGE='#7cc4ff',RAIN='#f0a640',MOON='#f4e7b8',INK='#06121a';
function WeatherChart({hours,timezone,dark,selected,onInspect,models,sky}:{models?:ForecastModels;hours:WeatherHour[];timezone:string;dark:{start:Date;end:Date}[];selected:WeatherHour;onInspect:(time:number)=>void;sky:SkySample[]}) {
  const {ref:chartRef,width}=useSvgWidth(850);
  const narrow=width<560;
  const left=narrow?40:48,right=width-(narrow?6:12),plot=right-left;
  const id=`weather-${useId().replaceAll(':','')}`,start=hours[0].time,end=hours.at(-1)!.time+WEATHER_HOUR;
  // Rows (SVG units = CSS px): selected label · sky strip · cloud % · rain chance · Moon · time axis.
  const SKY_TOP=20,SKY_H=18,CLOUD_TOP=SKY_TOP+SKY_H+2,CLOUD_H=90,RAIN_TOP=CLOUD_TOP+CLOUD_H+6,RAIN_H=30,MOON_TOP=RAIN_TOP+RAIN_H+6,MOON_H=30,BODY_END=MOON_TOP+MOON_H,HEIGHT=BODY_END+26;
  const x=(ms:number)=>left+(ms-start)/(end-start)*plot,y=(percent:number)=>CLOUD_TOP+CLOUD_H-percent/100*CLOUD_H;
  const colW=plot/hours.length,gap=colW>8?1:0;
  const time=(ms:number)=>formatInTimeZone(ms,timezone,'HH:mm');
  const stops=useMemo(()=>twilightStops(sky,start,end),[sky,start,end]);
  const moon=useMemo(()=>moonSpans(sky),[sky]);
  const days=useMemo(()=>daylightSpans(sky),[sky]);
  const rainLabels=rainPeaks(hours,30).filter(h=>h.time!==selected.time);
  const localDate=(ms:number)=>formatInTimeZone(ms,timezone,'yyyy-MM-dd');
  const ticks=useMemo(()=>{
    const tickList:{time:number;label:string;key:string}[]=[];
    const day=new Date(`${localDate(start)}T12:00:00Z`),lastDate=localDate(end);
    for(let dayCount=0;dayCount<4;dayCount++,day.setUTCDate(day.getUTCDate()+1)){
      const label=formatInTimeZone(day, 'UTC', 'yyyy-MM-dd');
      if(label>lastDate)break;
      for(let hour=0;hour<24;hour++){
        const at=fromZonedTime(`${label}T${String(hour).padStart(2,'0')}:00:00`,timezone).getTime();
        if(at<start||at>end||Number(formatInTimeZone(at,timezone,'H'))!==hour)continue;
        tickList.push({time:at,label:narrow?`${String(hour).padStart(2,'0')}h`:`${String(hour).padStart(2,'0')}:00${label!==localDate(start)&&hour===0?' +1d':''}`,key:`${label}-${hour}`});
      }
    }
    // Hourly candidates thinned to a clock-friendly step (every 1, 2, 3, 4, 6 or 12 hours).
    const needed=tickList.length/Math.max(1,plot/(narrow?36:80)),step=[1,2,3,4,6,12].find(n=>n>=needed)??12;
    return tickList.filter(tick=>Number(formatInTimeZone(tick.time,timezone,'H'))%step===0 && x(tick.time)<right-20);
  },[start,end,timezone,width]);
  const hover=(e:React.PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();onInspect(hourAt(hours,((e.clientX-box.left)/box.width*width-left)/plot).time);};
  const selectedX=x(selected.time),selectedMid=selectedX+colW/2,labelAnchor=selectedMid>right-110?'end':selectedMid<left+110?'start':'middle';
  const labelX=labelAnchor==='end'?Math.min(right,selectedX+colW):labelAnchor==='start'?Math.max(left,selectedX):selectedMid;
  const halo={paintOrder:'stroke' as const,stroke:INK,strokeWidth:3,strokeLinejoin:'round' as const};
  const darkLabel=(segment:{start:Date;end:Date})=>{const w=x(+segment.end)-x(+segment.start),text=`${time(+segment.start)}–${time(+segment.end)}`;return w>230?`Astronomical darkness ${text}`:w>110?`Dark ${text}`:w>70?text:'';};
  // Moon labels (rise/set time, % lit) sit above the Moon bar, never on it, so they stay legible in red light.
  // Rises are placed first; a label that would collide with one already placed is dropped.
  const moonLabels=useMemo(()=>{
    const charW=narrow?7.2:6.8,placed:{key:string;x:number;anchor:'start'|'end';text:string;from:number;to:number}[]=[];
    const ordered=[...moon].sort((a,b)=>Number(b.rises)-Number(a.rises));
    for(const span of ordered){
      const a=x(span.start),b=x(span.end),pct=`${Math.round(span.illumination*100)}% lit`;
      const text=span.rises?`${narrow?'↑':'Moonrise'} ${time(span.start)} · ${pct}`:span.sets?`${pct} · ${narrow?'↓':'sets'} ${time(span.end)}`:`Up all period · ${pct}`;
      const w=text.length*charW;
      const from=span.rises||!span.sets?Math.max(left+2,Math.min(a,right-w)):Math.max(left+2,Math.min(b-w,right-w));
      if(placed.every(p=>from+w<p.from-10||from>p.to+10))placed.push({key:`moon-label-${span.start}`,text,x:from,anchor:'start',from,to:from+w});
    }
    return placed;
  },[moon,width,narrow,timezone,start,end]);
  return <svg ref={chartRef} className="weather-chart" style={{height:HEIGHT,width:'100%',maxWidth:'none',margin:'8px 0 0'}} viewBox={`0 0 ${width} ${HEIGHT}`} role="slider" tabIndex={0} aria-label="Hourly observing weather. Background: light is daylight, the gradient is twilight and black is astronomical darkness. Light columns show hourly cloud cover (best-match forecast) with whiskers for the ECMWF to GFS range; the hatched amber row shows precipitation chance and the bottom row shows when the Moon is up, with rise and set times and how much of it is lit." aria-valuemin={0} aria-valuemax={hours.length-1} aria-valuenow={hours.indexOf(selected)} aria-valuetext={`${formatInTimeZone(selected.time,timezone,'MMM d, HH:mm xxx')}, selected time, cloud ${value(selected.cloud,'%')}, precipitation chance ${value(selected.rainChance,'%')}`} onPointerMove={hover} onPointerDown={e=>{e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);hover(e);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onInspect(hours[e.key==='Home'?0:e.key==='End'?hours.length-1:Math.max(0,Math.min(hours.length-1,hours.indexOf(selected)+(e.key==='ArrowLeft'?-1:1)))].time);}}>
    <defs>
      <clipPath id={`${id}-body`}><rect x={left} y={SKY_TOP} width={plot} height={BODY_END-SKY_TOP}/></clipPath>
      <pattern id={`${id}-rain`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill={RAIN} opacity=".28"/><rect width="2.5" height="5" fill={RAIN}/></pattern>
      <linearGradient id={`${id}-twilight`} gradientUnits="userSpaceOnUse" x1={left} x2={right} y1="0" y2="0">{stops.map((s,i)=><stop key={i} offset={s.offset} stopColor={SKY.dark} stopOpacity={s.shade}/>)}</linearGradient>
    </defs>
    {/* Sky background: daylight, twilight ramp, then a solid astronomical-darkness zone with hard edges. */}
    <g clipPath={`url(#${id}-body)`}>
      <rect x={left} y={SKY_TOP} width={plot} height={BODY_END-SKY_TOP} fill={SKY.day}/>
      <rect x={left} y={SKY_TOP} width={plot} height={BODY_END-SKY_TOP} fill={`url(#${id}-twilight)`}/>
      {dark.map(segment=><rect key={`dark-${+segment.start}`} data-sky="dark" x={x(+segment.start)} y={SKY_TOP} width={x(+segment.end)-x(+segment.start)} height={BODY_END-SKY_TOP} fill={SKY.dark}/>)}
      {/* lane wells: a faint floor under the rain and Moon rows */}
      {[[RAIN_TOP,RAIN_H],[MOON_TOP,MOON_H]].map(([top,h])=><rect key={`well-${top}`} x={left} y={top} width={plot} height={h} fill={INK} opacity=".45"/>)}
      <line x1={left} x2={right} y1={RAIN_TOP+RAIN_H/2} y2={RAIN_TOP+RAIN_H/2} stroke="#7a95a5" strokeOpacity=".35" strokeDasharray="2 4"/>
      {[50,100].map(n=><line key={`grid-${n}`} x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#7a95a5" strokeOpacity=".35" strokeDasharray="2 4"/>)}
      {/* Clouds: one light column per hour; ECMWF↔GFS range as a whisker. */}
      {hours.map(h=>h.cloud===null?null:<rect key={`cloud-${h.time}`} data-cloud-column="true" x={x(h.time)+gap/2} y={y(h.cloud)} width={Math.max(.5,colW-gap)} height={y(0)-y(h.cloud)} fill={CLOUD} opacity=".9"/>)}
      {hours.map(h=>{const r=modelRange(models,h.time);if(!r)return null;const cx=x(h.time)+colW/2,cap=Math.max(2,Math.min(6,colW*.3)),top=y(r.max),bottom=y(r.min);
        return <g key={`range-${h.time}`} data-model-cloud-band="true"><path d={`M${cx-cap},${top}H${cx+cap}M${cx},${top}V${bottom}M${cx-cap},${bottom}H${cx+cap}`} stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none"/><path d={`M${cx-cap},${top}H${cx+cap}M${cx},${top}V${bottom}M${cx-cap},${bottom}H${cx+cap}`} stroke={RANGE} strokeWidth="2.4" strokeLinecap="round" fill="none"/></g>;})}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#8fa6b3" strokeOpacity=".7"/>
      {/* Rain chance: its own row, hatched amber bars scaled 0–100 % (hatching keeps them distinct from cloud in red light). */}
      {hours.map(h=>{if(!h.rainChance)return null;const top=RAIN_TOP+RAIN_H-h.rainChance/100*RAIN_H,bx=x(h.time)+gap/2,bw=Math.max(.5,colW-gap);
        return <g key={`rain-${h.time}`} data-rain-bar="true"><rect x={bx} y={top} width={bw} height={RAIN_TOP+RAIN_H-top} fill={`url(#${id}-rain)`}/><line x1={bx} x2={bx+bw} y1={top+1} y2={top+1} stroke={RAIN} strokeWidth="2"/></g>;})}
      {/* Moon: its own row; the label gives rise/set and how much of the disc is lit. */}
      {moon.map(span=><rect key={`moon-${span.start}`} data-moon-up="true" x={x(span.start)+1} y={MOON_TOP+MOON_H-11} width={Math.max(1,x(span.end)-x(span.start)-2)} height="8" rx="4" fill={MOON} fillOpacity={.25+.6*span.illumination} stroke={MOON} strokeWidth="1.5"/>)}
      {/* dusk / dawn edges run through every row */}
      {dark.flatMap(segment=>[+segment.start,+segment.end]).filter(t=>t>start&&t<end).map(t=><line key={`edge-${t}`} x1={x(t)} x2={x(t)} y1={SKY_TOP} y2={BODY_END} stroke={SKY.edge} strokeOpacity=".75" strokeDasharray="3 3"/>)}
    </g>
    {/* Selected hour: solid outlined column over the cloud and rain rows (the Moon row keeps its labels clear) + label above. */}
    <rect x={selectedX} y={CLOUD_TOP} width={colW} height={RAIN_TOP+RAIN_H-CLOUD_TOP} fill="none" stroke={INK} strokeWidth="5"/>
    <rect x={selectedX} y={CLOUD_TOP} width={colW} height={RAIN_TOP+RAIN_H-CLOUD_TOP} fill="none" stroke="#fff4cf" strokeWidth="2.5"/>
    <path d={`M${selectedMid-5},${BODY_END}l5,-6l5,6z`} fill="#fff4cf" stroke={INK} strokeWidth="1"/>
    {/* Row labels and direct labels */}
    {days.map(span=>{const w=x(span.end)-x(span.start);return w>64?<text key={`day-${span.start}`} x={(x(span.start)+x(span.end))/2} y={SKY_TOP+13} textAnchor="middle" fill="#e6eef2" style={halo}>Daylight</text>:null;})}
    {dark.map(segment=>{const label=darkLabel(segment);return label?<text key={`dark-label-${+segment.start}`} x={(Math.max(left,x(+segment.start))+Math.min(right,x(+segment.end)))/2} y={SKY_TOP+13} textAnchor="middle" fill="#e6eef2">{label}</text>:null;})}
    {[0,50,100].map(n=><text key={`axis-${n}`} x={left-6} y={y(n)+4} textAnchor="end" fill="#b9cad3">{n}%</text>)}
    <text x={left-6} y={SKY_TOP+13} textAnchor="end" fill="#b9cad3">Sky</text>
    <text x={left-6} y={RAIN_TOP+RAIN_H/2+4} textAnchor="end" fill={RAIN}>Rain</text>
    <text x={left-6} y={MOON_TOP+MOON_H/2+4} textAnchor="end" fill={MOON}>Moon</text>
    {rainLabels.map(h=><text key={`rain-label-${h.time}`} x={Math.min(right-4,Math.max(left+4,x(h.time)+colW/2))} y={RAIN_TOP+12} textAnchor={x(h.time)>right-40?'end':x(h.time)<left+40?'start':'middle'} fill="#fff1d6" style={halo}>{h.rainChance}%</text>)}
    {moon.length?moonLabels.map(label=><text key={label.key} x={label.x} y={MOON_TOP+12} textAnchor={label.anchor} fill={MOON} style={halo}>{label.text}</text>)
      :<text x={(left+right)/2} y={MOON_TOP+MOON_H/2+4} textAnchor="middle" fill="#b9cad3">Below the horizon all period</text>}
    {ticks.map(tick=><text key={tick.key} x={x(tick.time)} y={HEIGHT-8} textAnchor={tick.time<=start+1?'start':'middle'} fill="#b9cad3">{tick.label}</text>)}
    <text x={labelX} y="14" textAnchor={labelAnchor} fill="#fff4cf" style={{fontWeight:600}}>Selected · {time(selected.time)}</text>
  </svg>;
}
/** One line per hovered hour answering the chart's four questions: dark? clouds (and how sure)? Moon? rain? */
function HourReadout({hour,models,sky,dark}:{hour:WeatherHour;models?:ForecastModels;sky:SkySample[];dark:{start:Date;end:Date}[]}) {
  const mid=hour.time+WEATHER_HOUR/2,range=modelRange(models,hour.time),s=sky.length?moonAtTime(sky,mid):undefined;
  const darkness=dark.some(d=>mid>=+d.start&&mid<+d.end)?'Dark':s&&s.sunAlt>=0?'Daylight':'Twilight';
  const moon=!s?'Moon unknown':s.moonAlt>0?`Moon up · ${Math.round(s.illumination*100)}% lit`:'Moon down';
  const cloud=`Cloud ${value(hour.cloud,'%')} (best match)${range?` · ECMWF ${range.ecmwf}%, GFS ${range.gfs}% · ${modelAgreement(modelAt(models,hour.time)).label.toLowerCase()}${range.spread?` (${range.spread}-pt gap)`:''}`:''}`;
  return <span className="weather-readout" data-testid="weather-readout"><b>{darkness}</b> · {cloud} · Rain {value(hour.rainChance,'%')} · {moon}</span>;
}
