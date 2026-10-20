import {useWeather} from "@/hooks/use-weather";
import {observingWeather,meanWeather,forecastAge} from "@/lib/weather";
import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { UnifiedTarget } from "@/lib/astronomy";
import { bestUpcomingNights, upcomingNightDateLabel, upcomingNights, type UpcomingNight } from "@/lib/upcoming-nights";
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
  const weatherLabel=(night:UpcomingNight)=>{if(!weather.forecast)return "Weather unknown";const report=observingWeather(weather.forecast,night.start,timezone);if(!report.darkCovered)return "Weather not yet available for all dark hours";const covered=report.night.ok?report.hours.filter(hour=>report.night.ok&&report.night.segments.some(segment=>hour.time<+segment.end&&hour.time+3600000>+segment.start)):[];const cloud=meanWeather(covered,"cloud");return cloud===null?"Cloud forecast unavailable":`${Math.round(cloud)}% cloud · dark-hour average${weather.online?"":" · offline cache"}${forecastAge(weather.forecast,weather.now)==="fresh"?"":` · ${forecastAge(weather.forecast,weather.now)} forecast`}`;};
  const nights = useMemo(() => upcomingNights({ lat, lon, timezone, date, days: 7, targets, selected }), [lat, lon, timezone, +date, targets, selected]);
  const best = useMemo(() => bestUpcomingNights({ lat, lon, timezone, date, targets, selected }), [lat, lon, timezone, +date, targets, selected]);
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
      </button>)}</div> : <span className="upcoming-best-empty">No target-friendly moon-free night found in the next 30 nights.</span>}
      <small>Ranked by Moon-free darkness and target altitude; weather is not included.</small>
    </div>
  </section>;
}
