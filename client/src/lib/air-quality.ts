import { z } from 'zod';
import { WEATHER_HOUR, weatherLocation } from './weather';

/**
 * CAMS aerosol optical depth (550 nm) from the Open-Meteo Air-Quality API, for the haze part of the binocular
 * visibility model (docs/binocular-visibility-research.md §4.2). Optional data: every failure is silent and the
 * model falls back to the weather forecast's visibility and humidity.
 */
export const AIR_QUALITY_FRESH = 3 * WEATHER_HOUR;
const CACHE_KEY = 'starhop-air-quality-v1', LIMIT = 20;

export const airQualityHourSchema = z.object({
  time: z.number().finite(),
  aod: z.number().min(0).max(10).nullable(),
  dust: z.number().min(0).nullable(),
});
export type AirQualityHour = z.infer<typeof airQualityHourSchema>;
export const airQualitySchema = z.object({
  version: z.literal(1), key: z.string(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  fetchedAt: z.number().finite(), elevation: z.number().finite().nullable(),
  hours: z.array(airQualityHourSchema).min(1).max(240),
});
export type AirQualityForecast = z.infer<typeof airQualitySchema>;

export function airQualityUrl(lat: number, lon: number) {
  const site = weatherLocation(lat, lon);
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${new URLSearchParams({
    latitude: String(site.lat), longitude: String(site.lon), hourly: 'aerosol_optical_depth,dust',
    forecast_days: '5', past_days: '1', timeformat: 'unixtime', timezone: 'GMT',
  })}`;
}

/** Validate the provider response (UTC unixtime hours). Throws on anything unexpected. */
export function parseAirQuality(raw: unknown, lat: number, lon: number, now = Date.now()): AirQualityForecast {
  const data = z.object({
    elevation: z.unknown(),
    hourly: z.object({
      time: z.array(z.number().finite()).min(1).max(240),
      aerosol_optical_depth: z.array(z.number().finite().nullable()),
      dust: z.array(z.number().finite().nullable()).optional(),
    }),
  }).parse(raw);
  const { time, aerosol_optical_depth: aod, dust } = data.hourly;
  if (aod.length !== time.length || (dust && dust.length !== time.length)) throw Error('Incomplete air-quality response.');
  const hours = time.map((t, i) => ({ time: t * 1000, aod: aod[i] ?? null, dust: dust?.[i] ?? null }));
  if (hours.some((h, i) => i > 0 && h.time - hours[i - 1].time !== WEATHER_HOUR)) throw Error('Irregular air-quality timeline.');
  const elevation = typeof data.elevation === 'number' && Number.isFinite(data.elevation) && data.elevation >= -500 && data.elevation <= 9000 ? data.elevation : null;
  return airQualitySchema.parse({ version: 1, ...weatherLocation(lat, lon), fetchedAt: now, elevation, hours });
}

export function airQualityAge(f: AirQualityForecast, now = Date.now()): 'fresh' | 'stale' | 'expired' {
  if (now >= f.hours.at(-1)!.time + WEATHER_HOUR) return 'expired';
  return now - f.fetchedAt >= AIR_QUALITY_FRESH || f.fetchedAt - now > 300000 ? 'stale' : 'fresh';
}

// ───────────────────────────── offline cache (like weather-cache.ts) ─────────────────────────────

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const memory = new Map<string, AirQualityForecast>();
function deviceStorage(): StorageLike | undefined { try { return localStorage; } catch { return undefined; } }
function readEntries(storage: StorageLike | undefined): AirQualityForecast[] {
  try {
    const raw = JSON.parse(storage?.getItem(CACHE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, LIMIT).flatMap((value) => {
      const parsed = airQualitySchema.safeParse(value);
      return parsed.success && parsed.data.key === weatherLocation(parsed.data.lat, parsed.data.lon).key ? [parsed.data] : [];
    });
  } catch { return []; }
}
export function readAirQuality(lat: number, lon: number, storage = deviceStorage()): AirQualityForecast | undefined {
  const key = weatherLocation(lat, lon).key;
  const stored = readEntries(storage).find((f) => f.key === key), cached = memory.get(key);
  return stored && (!cached || stored.fetchedAt > cached.fetchedAt) ? stored : cached;
}
export function saveAirQuality(f: AirQualityForecast, storage = deviceStorage()): boolean {
  memory.delete(f.key); memory.set(f.key, f);
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value!);
  const entries = [f, ...readEntries(storage).filter((e) => e.key !== f.key)].slice(0, LIMIT);
  try { if (!storage) return false; storage.setItem(CACHE_KEY, JSON.stringify(entries)); return true; } catch { return false; }
}

const pending = new Map<string, Promise<AirQualityForecast | undefined>>();
const lastAttempts = new Map<string, number>();
/**
 * Fresh cached data, or one network attempt (at most every 10 minutes per site). Never throws: returns the cached
 * report (possibly stale) or undefined when the service is unreachable.
 */
export async function fetchAirQuality(lat: number, lon: number, fetcher: typeof fetch = fetch): Promise<AirQualityForecast | undefined> {
  let site: ReturnType<typeof weatherLocation>;
  try { site = weatherLocation(lat, lon); } catch { return undefined; }
  const existing = pending.get(site.key);
  if (existing) return existing;
  const previous = readAirQuality(lat, lon);
  if (previous && airQualityAge(previous) === 'fresh') return previous;
  if (Date.now() - (lastAttempts.get(site.key) ?? 0) < 600000) return previous;
  lastAttempts.set(site.key, Date.now());
  const task = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(airQualityUrl(lat, lon), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return previous;
      const forecast = parseAirQuality(await response.json(), lat, lon);
      saveAirQuality(forecast);
      return forecast;
    } catch { return previous; } finally { clearTimeout(timer); }
  })();
  pending.set(site.key, task);
  try { return await task; } finally { pending.delete(site.key); }
}

/** The hour containing `at`, or undefined. */
export function airQualityHourAt(f: AirQualityForecast | undefined, at: number): AirQualityHour | undefined {
  if (!f) return undefined;
  const i = Math.floor((at - f.hours[0].time) / WEATHER_HOUR);
  return i >= 0 && i < f.hours.length ? f.hours[i] : undefined;
}
