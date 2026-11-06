import { useEffect, useState } from 'react';
import { airQualityAge, fetchAirQuality, readAirQuality, type AirQualityForecast } from '@/lib/air-quality';
import { weatherLocation } from '@/lib/weather';

/**
 * Aerosol optical depth for the site (lib/air-quality.ts). Cached for offline use; failures are silent, so callers
 * simply get `undefined` and fall back to the weather forecast.
 */
export function useAirQuality(lat: number, lon: number): AirQualityForecast | undefined {
  let key = ''; try { key = weatherLocation(lat, lon).key; } catch { /* invalid coordinates: no data */ }
  const [state, setState] = useState<{ key: string; data?: AirQualityForecast }>({ key: '' });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const cached = readAirQuality(lat, lon);
    setState({ key, data: cached });
    if (!online || (cached && airQualityAge(cached) === 'fresh')) return;
    // Debounce coordinate entry, like useWeather.
    const timer = setTimeout(() => { void fetchAirQuality(lat, lon).then((data) => { if (active && data) setState({ key, data }); }); }, 900);
    return () => { active = false; clearTimeout(timer); };
    // lat/lon are captured through `key` (rounded site).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online]);
  return state.key === key ? state.data : key ? readAirQuality(lat, lon) : undefined;
}
