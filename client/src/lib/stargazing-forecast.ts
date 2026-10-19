import { moonState,scatteredMoonlight,type MoonState } from './moon';
import { modelAgreement,type ModelHour } from './forecast-models';
import { type WeatherHour } from './weather';

export type StargazingProfile='binocular'|'deep-sky'|'lunar';
/** A disclosed planning heuristic, not a measured seeing value or visibility probability. */
export function stargazingOutlook(hour:WeatherHour,moon:MoonState,profile:StargazingProfile,models?:ModelHour,skyBrightness=21.6) {
  const dark=moon.sunAlt<=-18,moonDown=moon.alt<=-moon.diameter/2;
  const glow=moonDown||!dark?0:scatteredMoonlight(moon,90,90-moon.alt,skyBrightness).brightening;
  const jets=models?[models.ecmwfJet,models.gfsJet].filter((v):v is number=>v!==null):[];
  const jet=jets.length?jets.reduce((a,b)=>a+b,0)/jets.length:null;
  const agreement=modelAgreement(models);
  const essential=[hour.cloud,hour.wind,hour.gust,hour.rain,hour.rainChance,hour.temp,hour.dew,hour.visibility];
  const withCloud=(cloud:number):number=>{
    let score=100*Math.pow(1-cloud/100,1.3);
    score-=Math.min(20,hour.wind!/2)+(hour.gust!>30?10:0);
    score-=hour.temp!-hour.dew!<=2?12:hour.temp!-hour.dew!<=4?5:0;
    score-=hour.visibility!<10000?25:hour.visibility!<20000?10:0;
    score-=Math.min(60,(Math.max(0,21.6-skyBrightness)+glow)*12)*(profile==='deep-sky'?1:profile==='binocular'?.55:0);
    if(jet!==null)score-=(jet>150?18:jet>80?9:0)*(profile==='lunar'?1:.2);
    if(hour.rain!>=.1||hour.rainChance!>=60)score=Math.min(score,5);
    else if(hour.rainChance!>=30)score=Math.min(score,35);
    if(cloud>80)score=Math.min(score,15);
    if(profile!=='lunar'&&!dark)score=0;
    if(profile==='lunar'&&moon.sunAlt>0)score=Math.min(score,40);
    return Math.round(Math.max(0,Math.min(100,score)));
  };
  const score=essential.every(v=>v!==null)?withCloud(hour.cloud!):null;
  const alternatives=score!==null&&models&&models.ecmwf!==null&&models.gfs!==null?[score,withCloud(models.ecmwf),withCloud(models.gfs)]:[];
  const cloudRange=alternatives.length?{min:Math.min(...alternatives),max:Math.max(...alternatives)}:null;
  const label=profile!=='lunar'&&!dark?'Daylight / twilight':score===null?'Incomplete forecast':cloudRange&&cloudRange.max-cloudRange.min>=20?'Uncertain forecast':score>=70?'Promising':score>=45?'Mixed conditions':'Poor conditions';
  const reasons:string[]=[];
  if(hour.cloud===null)reasons.push('Cloud forecast missing');else if(hour.cloud>80)reasons.push('Heavy cloud blocks most of the sky');else if((hour.high??0)>=30&&(hour.low??0)<15&&(hour.mid??0)<15)reasons.push('High cloud can wash out faint detail');else if(hour.cloud<=20)reasons.push('Little cloud forecast');
  if(hour.rain!==null&&hour.rain>=.1||hour.rainChance!==null&&hour.rainChance>=30)reasons.push('Precipitation may interrupt observing');
  if(hour.temp!==null&&hour.dew!==null&&hour.temp-hour.dew<=2)reasons.push('Optics may dew over');
  if(!moonDown&&glow>=1&&profile!=='lunar')reasons.push(profile==='deep-sky'?'Moonlight reduces faint-object contrast':'Favor bright clusters, stars and doubles');
  if(moonDown&&dark)reasons.push('Moon below the horizon');
  if(jet!==null&&jet>150&&profile==='lunar')reasons.push('Strong upper-air wind may soften fine detail');
  if(agreement.spread!==null&&agreement.spread>30)reasons.push('Cloud models disagree; the outlook is uncertain');
  return {score,cloudRange,label,dark,moonDown,glow,moon,jet,agreement,reasons};
}
export function stargazingHours(hours:WeatherHour[],lat:number,lon:number,profile:StargazingProfile,models:ModelHour[]=[],skyBrightness=21.6) {
  const byTime=new Map(models.map(h=>[h.time,h]));
  return hours.map(hour=>({time:hour.time,...stargazingOutlook(hour,moonState(lat,lon,new Date(hour.time)),profile,byTime.get(hour.time),skyBrightness)}));
}
