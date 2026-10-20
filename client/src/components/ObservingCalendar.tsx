import { useEffect, useMemo, useState } from "react";
import { addDays, addMonths, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { moonState } from "@/lib/moon";
import { meanWeather, WEATHER_HOUR, type WeatherForecast } from "@/lib/weather";
import { visibilityWindow } from "@/lib/target-visibility";
import { useWeather } from "@/hooks/use-weather";
import "./ObservingCalendar.css";

const phaseGlyphs = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

export interface ObservingCalendarProps {
  value: Date;
  onChange: (date: Date) => void;
  lat: number;
  lon: number;
  timezone: string;
  savedDates?: string[];
  month?: Date;
  onMonthChange?: (month: Date) => void;
  className?: string;
}

function fullDarkForecast(forecast: WeatherForecast | undefined, key: string, lat: number, lon: number, timezone: string) {
  if (!forecast) return null;
  const night = visibilityWindow(key, "12:00", "12:00", "night", timezone, lat, lon);
  if (!night.ok || !night.segments.length) return null;
  const first = forecast.hours[0], last = forecast.hours.at(-1)!;
  const covered = night.segments.every(segment => first.time <= +segment.start && last.time + WEATHER_HOUR >= +segment.end);
  if (!covered) return null;
  const darkHours = forecast.hours.filter(hour => night.segments.some(segment => hour.time >= +segment.start && hour.time + WEATHER_HOUR <= +segment.end));
  return meanWeather(darkHours, "cloud");
}

/** Date picker with lunar phase, saved-night and full-darkness forecast cues. */
export function ObservingCalendar({ value, onChange, lat, lon, timezone, savedDates = [], month: controlledMonth, onMonthChange, className = "" }: ObservingCalendarProps) {
  const [internalMonth, setInternalMonth] = useState(startOfMonth(value));
  const [focusKey, setFocusKey] = useState(formatInTimeZone(value, timezone, "yyyy-MM-dd"));
  const month = controlledMonth ?? internalMonth;
  const weather = useWeather(lat, lon);
  const saved = useMemo(() => new Set(savedDates), [savedDates]);
  const start = startOfWeek(startOfMonth(month));
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(start, index)), [+start]);
  const selectedKey = formatInTimeZone(value, timezone, "yyyy-MM-dd");
  const dateKey = (day: Date) => format(day, "yyyy-MM-dd");
  const rovingFocusKey = days.some(day => dateKey(day) === focusKey) ? focusKey : dateKey(days.find(day => isSameMonth(day, month)) ?? days[0]);
  const forecastByDate = useMemo(() => {
    const hints = new Map<string, number>();
    for (const day of days) {
      const key = dateKey(day);
      const cloud = fullDarkForecast(weather.forecast, key, lat, lon, timezone);
      if (cloud !== null) hints.set(key, cloud);
    }
    return hints;
  }, [days, weather.forecast, lat, lon, timezone]);
  const forecastEnd = weather.forecast ? formatInTimeZone(new Date(weather.forecast.hours.at(-1)!.time), timezone, "MMM d") : null;
  const moveMonth = (delta: number) => {
    const next = addMonths(month, delta);
    if (!controlledMonth) setInternalMonth(next);
    onMonthChange?.(next);
  };
  useEffect(() => { setFocusKey(selectedKey); }, [selectedKey]);
  const moveFocus = (day: Date, key: string) => {
    let next: Date;
    switch (key) {
      case "ArrowLeft": next = addDays(day, -1); break;
      case "ArrowRight": next = addDays(day, 1); break;
      case "ArrowUp": next = addDays(day, -7); break;
      case "ArrowDown": next = addDays(day, 7); break;
      case "Home": next = addDays(day, -day.getDay()); break;
      case "End": next = addDays(day, 6 - day.getDay()); break;
      case "PageUp": next = addMonths(day, -1); break;
      case "PageDown": next = addMonths(day, 1); break;
      default: return false;
    }
    const nextKey = dateKey(next);
    setFocusKey(nextKey);
    if (!isSameMonth(next, month)) {
      const nextMonth = startOfMonth(next);
      if (!controlledMonth) setInternalMonth(nextMonth);
      onMonthChange?.(nextMonth);
    }
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-observing-day="${nextKey}"]`)?.focus());
    return true;
  };

  return <section className={`observing-calendar ${className}`} aria-label="Observing calendar">
    <header className="observing-calendar-header">
      <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={16} /></button>
      <strong>{format(month, "MMMM yyyy")}</strong>
      <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={16} /></button>
    </header>
    <div className="observing-calendar-grid" role="grid" aria-label={format(month, "MMMM yyyy")}>
      <div className="observing-calendar-week" role="row">
        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, index) => <span className="observing-calendar-weekday" role="columnheader" key={name} aria-label={name}>{name.slice(0, 1)}</span>)}
      </div>
      {Array.from({ length: 6 }, (_, week) => <div className="observing-calendar-week" role="row" key={week}>
        {days.slice(week * 7, week * 7 + 7).map(day => {
          const key = dateKey(day);
          const at = fromZonedTime(`${key}T22:00:00`, timezone);
          const state = moonState(lat, lon, at);
          const cloud = forecastByDate.get(key) ?? null;
          const isSelected = selectedKey === key;
          const name = state.phaseName;
          const label = `${format(day, "EEEE, MMMM d")}: ${name}, ${Math.round(state.illumination * 100)}% illuminated${saved.has(key) ? ", saved observing night" : ""}${cloud === null ? ", full-night forecast unavailable" : `, ${Math.round(cloud)}% cloud during astronomical darkness`}`;
          return <button type="button" role="gridcell" key={key} data-observing-day={key} tabIndex={rovingFocusKey === key ? 0 : -1} aria-label={label} aria-pressed={isSelected} className={`observing-calendar-day${isSameMonth(day, month) ? "" : " outside-month"}${isSelected ? " selected" : ""}${saved.has(key) ? " has-saved-night" : ""}`} onClick={() => { setFocusKey(key); onChange(at); }} onKeyDown={event => { if (moveFocus(day, event.key)) event.preventDefault(); }}>
            <span className="observing-calendar-date">{format(day, "d")}</span>
            <span className="observing-calendar-phase" aria-hidden="true">{phaseGlyphs[Math.round(state.phase / 45) % 8]}</span>
            {saved.has(key) && <i className="observing-calendar-saved-dot" aria-hidden="true" />}
            <small>{cloud === null ? "—" : `${Math.round(cloud)}%`}</small>
          </button>;
        })}
      </div>)}
    </div>
    <p className="observing-calendar-hint"><Moon size={12} /> {`Phase at 22:00 local · ${weather.forecast ? `forecast available through ${forecastEnd}` : weather.loading ? "loading forecast" : "forecast unavailable"}. A dash means forecast is unavailable or does not cover all astronomical-dark hours.`}</p>
    <p className="observing-calendar-legend"><i /> Saved observing night <span>Cloud percentages appear only when all astronomical-dark hours are covered by forecast data.</span></p>
  </section>;
}
