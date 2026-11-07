/**
 * What the user can centre in the reticle to fix true north (docs/local-horizon-design.md, section 7): the Sun, the
 * Moon, bright planets and the brightest stars, with their APPARENT positions (refraction included, as the camera sees
 * them). Only bodies at least 5° up and clear of the local skyline are offered, best first: Sun, Moon, then by
 * brightness. In daylight only the Sun and Moon; in twilight only what is bright enough to see.
 * The UI must show its own warning before asking anyone to point a camera at the Sun.
 */
import * as Astro from 'astronomy-engine';
import { isAboveLocalHorizon } from '../profile';
import type { LocalHorizon } from '../types';

export interface TapTarget {
  source: 'sun' | 'moon' | 'planet' | 'star';
  /** Plain words: "the Sun", "the Moon", "Jupiter", "Vega". */
  label: string;
  az: number;
  /** Apparent altitude (refraction included), degrees. */
  alt: number;
  mag: number;
}

/** Lowest apparent altitude offered, degrees (low bodies are dimmed, refracted and often behind something). */
export const MIN_TAP_ALT_DEG = 5;
/** Clearance above a known skyline, degrees, so a body grazing a tree top is not offered. */
const SKYLINE_MARGIN_DEG = 1;

/** Stars brighter than magnitude 1.5: name, J2000 right ascension and declination (degrees), V magnitude. */
const BRIGHT_STARS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['Sirius', 101.2872, -16.7161, -1.46],
  ['Canopus', 95.9880, -52.6957, -0.74],
  ['Rigil Kentaurus', 219.9021, -60.8340, -0.27],
  ['Arcturus', 213.9153, 19.1824, -0.05],
  ['Vega', 279.2347, 38.7837, 0.03],
  ['Capella', 79.1723, 45.9980, 0.08],
  ['Rigel', 78.6345, -8.2016, 0.13],
  ['Procyon', 114.8255, 5.2250, 0.34],
  ['Achernar', 24.4285, -57.2368, 0.46],
  ['Betelgeuse', 88.7929, 7.4071, 0.5],
  ['Hadar', 210.9559, -60.3730, 0.61],
  ['Altair', 297.6958, 8.8683, 0.76],
  ['Acrux', 186.6496, -63.0991, 0.76],
  ['Aldebaran', 68.9802, 16.5093, 0.86],
  ['Antares', 247.3519, -26.4320, 0.96],
  ['Spica', 201.2982, -11.1613, 0.97],
  ['Pollux', 116.3290, 28.0262, 1.14],
  ['Fomalhaut', 344.4127, -29.6222, 1.16],
  ['Deneb', 310.3580, 45.2803, 1.25],
  ['Mimosa', 191.9303, -59.6888, 1.25],
  ['Regulus', 152.0930, 11.9672, 1.35],
];

const PLANETS: ReadonlyArray<readonly [Astro.Body, string, number]> = [
  // body, name, faintest magnitude at which it is offered (Mercury only when bright)
  [Astro.Body.Venus, 'Venus', 1.5],
  [Astro.Body.Jupiter, 'Jupiter', 1.5],
  [Astro.Body.Mars, 'Mars', 1.5],
  [Astro.Body.Saturn, 'Saturn', 1.5],
  [Astro.Body.Mercury, 'Mercury', 0],
];

/** Faintest magnitude worth offering for the Sun's (apparent) altitude: none by day, the brightest in twilight. */
function limitingMag(sunAlt: number): number {
  if (sunAlt > -1) return -Infinity;
  if (sunAlt > -6) return 0;
  if (sunAlt > -12) return 1;
  return 1.5;
}

/**
 * Bodies to tap for the alignment at a site and time, best first. `horizon` filters out bodies behind the local
 * skyline (compared, as everywhere in the app, through profile.ts with the GEOMETRIC altitude).
 */
export function tapTargets(lat: number, lon: number, date: Date, horizon?: LocalHorizon | null): TapTarget[] {
  const time = Astro.MakeTime(date);
  const observer = new Astro.Observer(lat, lon, 0);
  const out: TapTarget[] = [];
  const visible = (geoAlt: number, appAlt: number, az: number) =>
    appAlt >= MIN_TAP_ALT_DEG && isAboveLocalHorizon(horizon ?? null, geoAlt, az, SKYLINE_MARGIN_DEG);

  const bodyPosition = (body: Astro.Body) => {
    const eq = Astro.Equator(body, time, observer, true, true);
    const geo = Astro.Horizon(time, observer, eq.ra, eq.dec);
    const app = Astro.Horizon(time, observer, eq.ra, eq.dec, 'normal');
    return { az: app.azimuth, geoAlt: geo.altitude, alt: app.altitude };
  };

  const sun = bodyPosition(Astro.Body.Sun);
  if (visible(sun.geoAlt, sun.alt, sun.az)) out.push({ source: 'sun', label: 'the Sun', az: sun.az, alt: sun.alt, mag: -26.7 });

  const moon = bodyPosition(Astro.Body.Moon);
  const moonIllum = Astro.Illumination(Astro.Body.Moon, time);
  if (moonIllum.phase_fraction >= 0.03 && visible(moon.geoAlt, moon.alt, moon.az)) {
    out.push({ source: 'moon', label: 'the Moon', az: moon.az, alt: moon.alt, mag: moonIllum.mag });
  }

  const lim = limitingMag(sun.alt);
  const rest: TapTarget[] = [];
  for (const [body, name, faintest] of PLANETS) {
    const mag = Astro.Illumination(body, time).mag;
    if (mag > Math.min(faintest, lim)) continue;
    const p = bodyPosition(body);
    if (visible(p.geoAlt, p.alt, p.az)) rest.push({ source: 'planet', label: name, az: p.az, alt: p.alt, mag });
  }
  if (lim > -2) {
    // One rotation for all stars: J2000 equatorial → horizontal of date (precession and nutation included).
    const rot = Astro.Rotation_EQJ_HOR(time, observer);
    for (const [name, ra, dec, mag] of BRIGHT_STARS) {
      if (mag > lim) continue;
      const hor = Astro.HorizonFromVector(Astro.RotateVector(rot, Astro.VectorFromSphere(new Astro.Spherical(dec, ra, 1), time)), '');
      const geoAlt = hor.lat, az = hor.lon;
      if (geoAlt < MIN_TAP_ALT_DEG - 1) continue;
      const alt = geoAlt + Astro.Refraction('normal', geoAlt);
      if (visible(geoAlt, alt, az)) rest.push({ source: 'star', label: name, az, alt, mag });
    }
  }
  rest.sort((a, b) => a.mag - b.mag);
  const round = (t: TapTarget): TapTarget => ({ ...t, az: Math.round(t.az * 1000) / 1000, alt: Math.round(t.alt * 1000) / 1000, mag: Math.round(t.mag * 100) / 100 });
  return [...out, ...rest].map(round);
}
