import { modelAt, type ForecastModels } from './forecast-models';
import type { WeatherHour } from './weather';

/**
 * Data shaping for the hourly stargazing chart (WeatherPanel). Pure functions only, so the chart's
 * geometry is testable: sky shade from the Sun's altitude, Sun/Moon-above-horizon spans, the
 * ECMWF/GFS cloud range for each hour and which hour sits under the pointer.
 */

/** One sample along the chart's time axis. `moonAlt` is the altitude of the Moon's upper limb. */
export interface SkySample { time:number; sunAlt:number; moonAlt:number; illumination:number }

/** 0 = daylight, 1 = astronomical darkness (Sun below -18°); twilight ramps between. */
export function skyShade(sunAlt:number) {
  if(sunAlt>=0)return 0;
  if(sunAlt<=-18)return 1;
  return -sunAlt/18;
}

/** Twilight never reaches the darkness tone, so the step into astronomical darkness stays visible. */
export const TWILIGHT_MAX=.6;
/**
 * Gradient stops (offset 0..1 across [start, end]) for the twilight ramp drawn behind the chart.
 * Shade follows the Sun's altitude, capped at TWILIGHT_MAX; astronomical darkness itself is a
 * separate solid zone with hard edges at dusk and dawn. Runs of equal shade collapse to their
 * first and last stop.
 */
export function twilightStops(samples:Pick<SkySample,'time'|'sunAlt'>[],start:number,end:number) {
  const stops:{offset:number;shade:number}[]=[];
  for(const sample of samples){
    const offset=Math.max(0,Math.min(1,(sample.time-start)/(end-start))),shade=Math.min(TWILIGHT_MAX,skyShade(sample.sunAlt));
    const last=stops.at(-1),before=stops.at(-2);
    if(last&&before&&last.shade===shade&&before.shade===shade)last.offset=offset;
    else stops.push({offset,shade});
  }
  return stops;
}

export interface Span { start:number; end:number; /** a real rise inside the samples (not the chart's left edge) */ rises:boolean; /** a real set inside the samples */ sets:boolean }
/** Contiguous spans where value(sample) > 0, with linearly interpolated crossing times. */
export function spansAbove<T extends {time:number}>(samples:T[],value:(sample:T)=>number):Span[] {
  const spans:Span[]=[];
  const cross=(a:T,b:T)=>{const va=value(a),vb=value(b),f=va===vb?.5:-va/(vb-va);return a.time+Math.max(0,Math.min(1,f))*(b.time-a.time);};
  let open:Span|null=null;
  samples.forEach((sample,i)=>{
    const up=value(sample)>0,previous=samples[i-1];
    if(up&&!open){open={start:previous?cross(previous,sample):sample.time,end:sample.time,rises:!!previous,sets:false};spans.push(open);}
    else if(!up&&open){open.end=cross(previous,sample);open.sets=true;open=null;}
    else if(up&&open)open.end=sample.time;
  });
  return spans;
}
/** Moon-above-horizon spans with the brightest illumination reached while up. */
export function moonSpans(samples:SkySample[]) {
  return spansAbove(samples,s=>s.moonAlt).map(span=>{
    const inside=samples.filter(s=>s.time>=span.start&&s.time<=span.end&&s.moonAlt>0);
    return {...span,illumination:Math.max(0,...inside.map(s=>s.illumination)),peakAlt:Math.max(0,...inside.map(s=>s.moonAlt))};
  });
}
export const daylightSpans=(samples:SkySample[])=>spansAbove(samples,s=>s.sunAlt);
/** Moon state at an instant from the samples (nearest sample at or before it). */
export function moonAtTime(samples:SkySample[],time:number) {
  let found=samples[0];
  for(const s of samples){if(s.time<=time)found=s;else break;}
  return found;
}

/** ECMWF↔GFS cloud range for an hour, or null when either model is missing. */
export function modelRange(models:ForecastModels|undefined,time:number) {
  const hour=modelAt(models,time);
  if(!hour||hour.ecmwf===null||hour.gfs===null)return null;
  return {min:Math.min(hour.ecmwf,hour.gfs),max:Math.max(hour.ecmwf,hour.gfs),spread:Math.abs(hour.ecmwf-hour.gfs),ecmwf:hour.ecmwf,gfs:hour.gfs};
}

/** Hour columns: index i spans [hours[i].time, +1 h). The hour under a 0..1 ratio across the plot. */
export function hourAt<T extends Pick<WeatherHour,'time'>>(hours:T[],ratio:number) {
  const r=Math.max(0,Math.min(.999999,Number.isFinite(ratio)?ratio:0));
  return hours[Math.floor(r*hours.length)];
}

export const SKY_STEP=10*60_000;
/** Sample times every `step` across [start, end], both ends included. */
export function sampleTimes(start:number,end:number,step=SKY_STEP) {
  const times:number[]=[];
  for(let t=start;t<end;t+=step)times.push(t);
  times.push(end);
  return times;
}

/** Local peaks of rain chance at or above `min` (first hour of a plateau), for direct labels. */
export function rainPeaks<T extends WeatherHour>(hours:T[],min=30) {
  return hours.filter((h,i)=>{
    const v=h.rainChance;if(v===null||v<min)return false;
    const before=hours[i-1]?.rainChance??-1,after=hours[i+1]?.rainChance??-1;
    return v>before&&v>=after;
  });
}
