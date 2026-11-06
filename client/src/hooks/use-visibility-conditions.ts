import { useMemo } from 'react';
import { useWeather } from './use-weather';
import { useAirQuality } from './use-air-quality';
import { airQualityHourAt } from '@/lib/air-quality';
import { WEATHER_HOUR, type WeatherHour } from '@/lib/weather';
import { moonState } from '@/lib/moon';
import { getSiteSkyBrightness, suggestedSiteSkyBrightness } from '@/lib/site-sky-brightness';
import { resolveSkyInputs, transparencyFromForecast, type ConditionPrefs, type ResolvedSkyInputs } from '@/lib/visibility/conditions';
import type { Transparency } from '@/lib/visibility/types';

export interface VisibilityConditions {
  /** SkyInputs for an instant: sky darkness, elevation, extinction (forecast / manual / default), Moon and Sun. Memoised per minute. */
  at: (date: Date) => ResolvedSkyInputs;
  /** Elevation in effect, metres (0 when unknown). */
  elevationM: number;
  elevationSource: 'manual' | 'forecast' | 'unknown';
  /** Elevation the forecast service reports for the site, when known (shown next to a manual override). */
  forecastElevationM: number | null;
  /** The forecast's haze level for `date` (or now), for "Auto (forecast: Hazy)"; null without forecast data. */
  forecastHaze: (date?: Date) => { level: Transparency; label: string; basis: 'aod' | 'visibility' | 'humidity' } | null;
  /** True while there is weather or air-quality data for the site. */
  hasForecast: boolean;
}

/**
 * Tonight's conditions for the binocular visibility model at a site. Uses the cached weather and air-quality
 * forecasts (fetching them when stale and online) and the observer's settings (`prefs`; without them the site's
 * saved sky darkness and automatic haze are used). `timezone` is accepted for symmetry with other hooks; all
 * forecast hours are absolute UTC instants, so it is not needed.
 */
export function useVisibilityConditions(lat: number, lon: number, _timezone?: string, prefs?: Partial<ConditionPrefs>): VisibilityConditions {
  const { forecast } = useWeather(lat, lon);
  const air = useAirQuality(lat, lon);
  const skyBrightness = prefs?.skyBrightness ?? getSiteSkyBrightness(lat, lon) ?? suggestedSiteSkyBrightness(lat, lon);
  const transparencyMode = prefs?.transparencyMode ?? 'auto';
  const siteElevation = prefs?.siteElevation ?? null;
  return useMemo(() => {
    const forecastElevationM = forecast?.elevation ?? air?.elevation ?? null;
    const weatherHour = (t: number): WeatherHour | undefined => {
      if (!forecast) return undefined;
      const i = Math.floor((t - forecast.hours[0].time) / WEATHER_HOUR);
      return i >= 0 && i < forecast.hours.length ? forecast.hours[i] : undefined;
    };
    const cache = new Map<number, ResolvedSkyInputs>();
    const at = (date: Date) => {
      const minute = Math.floor(date.getTime() / 60000) * 60000;
      const hit = cache.get(minute);
      if (hit) return hit;
      const instant = new Date(minute), hour = weatherHour(minute), aq = airQualityHourAt(air, minute);
      const m = moonState(lat, lon, instant);
      const result = resolveSkyInputs({
        skyBrightness, transparencyMode, siteElevation, elevationM: forecastElevationM,
        forecastHour: hour ? { visibility: hour.visibility, humidity: hour.humidity } : null,
        airQualityHour: aq ? { aod: aq.aod } : null,
        moon: { alt: m.alt, ra: m.ra, dec: m.dec, phaseAngle: m.phaseAngle, illumination: m.illumination },
        sunAlt: m.sunAlt,
      });
      if (cache.size > 2000) cache.clear();
      cache.set(minute, result);
      return result;
    };
    const elevationSource: VisibilityConditions['elevationSource'] = siteElevation != null ? 'manual' : forecastElevationM != null ? 'forecast' : 'unknown';
    const elevationM = siteElevation ?? forecastElevationM ?? 0;
    const forecastHaze = (date = new Date()) => {
      const t = date.getTime(), hour = weatherHour(t), aq = airQualityHourAt(air, t);
      return transparencyFromForecast({ aod: aq?.aod, visibilityM: hour?.visibility, humidity: hour?.humidity }, elevationM);
    };
    return { at, elevationM, elevationSource, forecastElevationM, forecastHaze, hasForecast: !!forecast || !!air };
  }, [forecast, air, lat, lon, skyBrightness, transparencyMode, siteElevation]);
}
