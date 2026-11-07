/**
 * Sky positions for the scene: Sun, Moon and catalogue stars (the app's bsc5-short.json) as APPARENT azimuth/altitude
 * (astronomy-engine, 'normal' refraction), which is what a camera sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './common';

// CommonJS package: load it through require so tsx's ESM interop does not hide the named exports.
const Astro = createRequire(import.meta.url)('astronomy-engine') as typeof import('astronomy-engine');

export interface SkyBody {
  az: number;
  /** Apparent altitude (refraction included). */
  alt: number;
  /** Geometric altitude. */
  geoAlt: number;
  /** Angular radius, degrees. */
  radiusDeg: number;
  /** Illuminated fraction (Moon), 1 for the Sun. */
  phase: number;
}

export function bodyPosition(body: 'Sun' | 'Moon', date: Date, lat: number, lon: number, heightM = 0): SkyBody {
  const obs = new Astro.Observer(lat, lon, heightM);
  const b = body === 'Sun' ? Astro.Body.Sun : Astro.Body.Moon;
  const eq = Astro.Equator(b, date, obs, true, true);
  const app = Astro.Horizon(date, obs, eq.ra, eq.dec, 'normal');
  const geo = Astro.Horizon(date, obs, eq.ra, eq.dec);
  const distKm = eq.dist * Astro.KM_PER_AU;
  const radiusKm = body === 'Sun' ? 695700 : 1737.4;
  const phase = body === 'Moon' ? Astro.Illumination(Astro.Body.Moon, date).phase_fraction : 1;
  return { az: app.azimuth, alt: app.altitude, geoAlt: geo.altitude, radiusDeg: Math.asin(radiusKm / distKm) * (180 / Math.PI), phase };
}

function parseRA(s: string): number {
  const m = s.match(/(\d+)h\s*(\d+(?:\.\d+)?)m?\s*(\d+(?:\.\d+)?)?s?/);
  return m ? (parseFloat(m[1]) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) : 0) / 3600) * 15 : 0;
}
function parseDec(s: string): number {
  const m = s.match(/([+-]?\d+)°\s*(\d+)[′']\s*(\d+(?:\.\d+)?)?[″"]?/);
  if (!m) return 0;
  const sign = s.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(parseFloat(m[1])) + parseFloat(m[2]) / 60 + (m[3] ? parseFloat(m[3]) : 0) / 3600);
}

export interface SkyStar { az: number; alt: number; mag: number; hr: string }

/** Catalogue stars brighter than `maxMag` above `minAlt`, apparent positions at the scene time and place. */
export function starsAt(date: Date, lat: number, lon: number, maxMag = 6, minAlt = -5): SkyStar[] {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'client/public/data/bsc5-short.json'), 'utf8')) as Array<Record<string, string>>;
  const obs = new Astro.Observer(lat, lon, 0);
  const rot = Astro.Rotation_EQJ_HOR(date, obs);
  const out: SkyStar[] = [];
  for (const s of raw) {
    const mag = parseFloat(s.V);
    if (!(mag <= maxMag)) continue;
    const vec = Astro.VectorFromSphere(new Astro.Spherical(parseDec(s.Dec), parseRA(s.RA), 1), date);
    const hor = Astro.HorizonFromVector(Astro.RotateVector(rot, vec), 'normal');
    if (hor.lat < minAlt) continue;
    out.push({ az: ((hor.lon % 360) + 360) % 360, alt: hor.lat, mag, hr: s.HR });
  }
  return out;
}

export function lightFor(sunGeoAlt: number): 'day' | 'twilight' | 'night' {
  return sunGeoAlt > -0.833 ? 'day' : sunGeoAlt > -12 ? 'twilight' : 'night';
}
