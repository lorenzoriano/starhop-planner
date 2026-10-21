import {useWeather} from "@/hooks/use-weather";
import {nightWeather,rankWeatherNights} from "@/lib/night-weather";
import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { UnifiedTarget } from "@/lib/astronomy";
import { upcomingNightDateLabel, upcomingNights, type UpcomingNight } from "@/lib/upcoming-nights";
import { clockNightDate } from "@/lib/astronomical-clock";
import "./ObservingCalendar.css";

const glyphs = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const glyph = (phase: number) => glyphs[Math.round(phase / 45) % 8];
const clock = (date: Date, timezone: string) => formatInTimeZone(date, timezone, "HH:mm");
const duration = (hours: number) => `${hours.toFixed(1)} h`;

export interface UpcomingNightsProps {
  lat: number;
  lon: number;
  timezone: string;
  date: Date;
  onDate: (date: Date) => void;
  targets?: UnifiedTarget[];
  selected?: UnifiedTarget | null;
}

export function UpcomingNights({ lat, lon, timezone, date, onDate, targets = [], selected = null }: UpcomingNightsProps) {
  const weather=useWeather(lat,lon);
  const nightKey=clockNightDate(date,timezone);
  const targetKey=targets.map(target=>`${target.id}:${target.ra}:${target.dec}`).join("|");
  const allNights=useMemo(()=>upcomingNights({lat,lon,timezone,date,days:30,targets,selected}),[lat,lon,timezone,nightKey,targetKey,selected?.id,selected?.ra,selected?.dec]);
  const nights=allNights.slice(0,7);
  const reports=useMemo(()=>new Map(allNights.map(night=>[night.date,nightWeather(night,weather.forecast,weather)])),[allNights,weather.forecast,weather.now,weather.online,weather.loading,weather.error]);
  const eligible=allNights.filter(night=>night.moonFreeDarkHours>0&&(!selected||(night.selectedTarget?.goodAltitudeHours??0)>0));
  const best=rankWeatherNights(eligible,reports).slice(0,3);
  const hasWeather=eligible.some(night=>reports.get(night.date)?.available);
  const weatherLabel=(night:UpcomingNight)=>{const report=reports.get(night.date)!;return `${report.label} · ${report.reason}`;};
  const selectedDate = clockNightDate(date, timezone);
  const choose = (night: UpcomingNight) => onDate(night.chooseAt);

  return <section className="upcoming-nights" aria-label="Upcoming observing nights">
    <div className="upcoming-nights-heading"><div><strong>Next nights</strong><span>Compare moon-free dark time, target altitude and available forecast</span></div><small>Next 7 nights</small></div>
    <div className="upcoming-nights-strip">
      {nights.map((night) => {
        const targetCount = targets.length ? `${night.feasibleTargetCount} of ${targets.length} targets well placed` : null;
        const selectedResult = night.selectedTarget;
        return <button type="button" key={night.date} className={`upcoming-night${night.date === selectedDate ? " is-selected" : ""}`} aria-label={`${upcomingNightDateLabel(night, timezone)}. Open at ${clock(night.chooseAt, timezone)}, during darkness`} aria-pressed={night.date === selectedDate} onClick={() => choose(night)}>
          <strong>{upcomingNightDateLabel(night, timezone)}</strong>
          <span className="upcoming-night-moon"><span aria-hidden="true">{glyph(night.moonPhase)}</span> {night.moonLabel} · {Math.round(night.moonIllumination * 100)}%</span>
          <span>{duration(night.moonFreeDarkHours)} moon-free dark</span>
          <span>{targetCount ?? ""}</span>
          {selectedResult && <small>{duration(selectedResult.goodAltitudeHours)} target time ≥30°{selectedResult.bestAt ? ` · best ${clock(selectedResult.bestAt, timezone)}` : ""}</small>}
          <small>{weatherLabel(night)}</small>
        </button>;
      })}
    </div>
    <div className="upcoming-best">
      <strong>{selected ? `Best nights for ${selected.name} · next 30 nights` : "Best geometry · next 30 nights"}</strong>
      {best.length ? <div className="upcoming-best-list">{best.map((night, index) => <button type="button" key={night.date} onClick={() => choose(night)}>
        <span>{index + 1}. {upcomingNightDateLabel(night, timezone)}</span>
        <span>{glyph(night.moonPhase)} {Math.round(night.moonIllumination * 100)}% Moon · {duration(night.moonFreeDarkHours)} moon-free</span>
        {night.selectedTarget && <span>{duration(night.selectedTarget.goodAltitudeHours)} target above 30°{night.selectedTarget.bestAt ? ` · best ${clock(night.selectedTarget.bestAt, timezone)}` : ""}</span>}
        <small>{weatherLabel(night)}</small>
      </button>)}</div> : <span className="upcoming-best-empty">No target-friendly moon-free night found in the next 30 nights.</span>}
      <small>{hasWeather?'Forecast-covered nights first, combining weather (65%) with Moon-free darkness and target altitude (35%). Nights without a usable forecast are ranked by geometry only.':'Ranked by Moon-free darkness and target altitude. Weather is unavailable for these choices; the reason is shown on each night.'} Weather score is a planning estimate from cloud, wind and precipitation, not a visibility probability.</small>
      {weather.forecast&&<small>Open-Meteo · forecast retrieved {formatInTimeZone(weather.forecast.fetchedAt,timezone,'MMM d, HH:mm')}{weather.online?'':' · offline cache'}</small>}
    </div>
  </section>;
}
