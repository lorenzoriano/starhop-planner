import * as Astro from "astronomy-engine";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { angularDistance, eqToHorizontal, type UnifiedTarget } from "./astronomy";
import features from "./lunar-features.json";

export const lunarFeatures = features;
export type LunarFeature = typeof features[number];
export type Vec3 = [number, number, number];
const rad = Math.PI / 180;
export const dot = (a: Vec3, b: Vec3) => a.reduce((v, n, i) => v + n * b[i], 0);
const scale = (a: Vec3, s: number): Vec3 => a.map(n => n * s) as Vec3;
const add = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n + b[i]) as Vec3;
const unit = (v: Vec3) => scale(v, 1 / Math.hypot(...v));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vec = (v: Astro.Vector): Vec3 => [v.x, v.y, v.z];

export function moonState(lat: number, lon: number, date: Date) {
  const observer = new Astro.Observer(lat, lon, 0);
  const eq = Astro.Equator(Astro.Body.Moon, date, observer, true, true);
  const eqJ = Astro.Equator(Astro.Body.Moon, date, observer, false, true);
  const horizon = Astro.Horizon(date, observer, eq.ra, eq.dec, "normal");
  const light = Astro.Illumination(Astro.Body.Moon, date);
  const solarEq = Astro.Equator(Astro.Body.Sun, date, observer, true, true);
  const sunAlt = Astro.Horizon(date, observer, solarEq.ra, solarEq.dec).altitude;
  const phase = Astro.MoonPhase(date);
  const phaseName = phase < 22.5 || phase >= 337.5 ? "New Moon" : phase < 67.5 ? "Waxing crescent" : phase < 112.5 ? "First quarter" : phase < 157.5 ? "Waxing gibbous" : phase < 202.5 ? "Full Moon" : phase < 247.5 ? "Waning gibbous" : phase < 292.5 ? "Last quarter" : "Waning crescent";
  const distanceKm = eq.dist * Astro.KM_PER_AU;
  return { alt: horizon.altitude, az: horizon.azimuth, ra: eqJ.ra * 15, dec: eqJ.dec,
    illumination: light.phase_fraction, phaseAngle: light.phase_angle, phase, phaseName,
    magnitude: light.mag, sunSeparation: Astro.AngleFromSun(Astro.Body.Moon, date), distanceKm, diameter: 2 * Math.asin(1737.4 / distanceKm) / rad, sunAlt };
}
export type MoonState = ReturnType<typeof moonState>;

// IAU body-fixed frame: ascending node, its perpendicular, and spin about the pole.
// Uses the topocentric observer, so the texture and feature markers include parallax/libration.
export function lunarFrame(lat: number, lon: number, date: Date) {
  const axis = Astro.RotationAxis(Astro.Body.Moon, date);
  const ra = axis.ra * 15 * rad, dec = axis.dec * rad, spin = axis.spin * rad;
  const node: Vec3 = [-Math.sin(ra), Math.cos(ra), 0];
  const perpendicular: Vec3 = [-Math.sin(dec)*Math.cos(ra), -Math.sin(dec)*Math.sin(ra), Math.cos(dec)];
  const x = add(scale(node, Math.cos(spin)), scale(perpendicular, Math.sin(spin)));
  const y = add(scale(node, -Math.sin(spin)), scale(perpendicular, Math.cos(spin)));
  const north = vec(axis.north);
  const bodyFixed = (v: Vec3): Vec3 => [dot(v, x), dot(v, y), dot(v, north)];
  const moon = vec(Astro.GeoMoon(date));
  const earthObserver = vec(Astro.ObserverVector(date, new Astro.Observer(lat, lon, 0), false));
  const observer = unit(bodyFixed(add(earthObserver, scale(moon, -1))));
  const sun = unit(bodyFixed(add(vec(Astro.GeoVector(Astro.Body.Sun, date, true)), scale(moon, -1))));
  const up = unit(add([0, 0, 1], scale(observer, -observer[2])));
  const right = cross(up, observer);
  return { observer, sun, up, right };
}
export type LunarFrame = ReturnType<typeof lunarFrame>;
export function surfaceNormal(lat: number, lon: number): Vec3 {
  return [Math.cos(lat*rad)*Math.cos(lon*rad), Math.cos(lat*rad)*Math.sin(lon*rad), Math.sin(lat*rad)];
}
export function projectLunarFeature(feature: LunarFeature, frame: LunarFrame) {
  const normal = surfaceNormal(feature.lat, feature.lon);
  const depth = dot(normal, frame.observer);
  const sunlight = dot(normal, frame.sun);
  return { x: dot(normal, frame.right), y: -dot(normal, frame.up), depth, sunlight,
    sunAltitude: Math.asin(Math.max(-1, Math.min(1, sunlight))) / rad,
    visible: depth > 0.08, lit: sunlight > 0,
    // Low Sun favors relief, high Sun favors albedo and rays.
    favored: feature.rays ? sunlight > 0.6 : feature.kind === "crater" ? sunlight > 0 && sunlight < 0.5 : sunlight > 0.1 };
}

export function binocularResolution(magnification: number, aperture: number) {
  // Rayleigh diffraction limit at 550 nm; one arcminute nominal eye resolution.
  return Math.max(138 / aperture, 60 / magnification);
}
export function featureAngularSize(feature: LunarFeature, state: MoonState, frame: LunarFrame) {
  const p = projectLunarFeature(feature, frame);
  // Conservative projected minor dimension of a surface feature (km -> arcsec).
  return feature.diameterKm / state.distanceKm / rad * 3600 * Math.max(0, p.depth);
}

export function lunarDayBounds(date: Date, timezone: string) {
  const label = formatInTimeZone(date, timezone, "yyyy-MM-dd");
  const next = new Date(`${label}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextLabel = next.toISOString().slice(0, 10);
  return { start: fromZonedTime(`${label}T00:00:00`, timezone), end: fromZonedTime(`${nextLabel}T00:00:00`, timezone) };
}
export function moonDay(lat: number, lon: number, date: Date, timezone: string) {
  const observer = new Astro.Observer(lat, lon, 0);
  const { start, end } = lunarDayBounds(date, timezone);
  const duration = (end.getTime() - start.getTime()) / 86_400_000;
  const rise = Astro.SearchRiseSet(Astro.Body.Moon, observer, 1, start, duration);
  const set = Astro.SearchRiseSet(Astro.Body.Moon, observer, -1, start, duration);
  const transit = Astro.SearchHourAngle(Astro.Body.Moon, observer, 0, start);
  const inDay = (event: Astro.AstroTime | null) => event && event.date < end ? event.date : null;
  const nextRise = Astro.SearchRiseSet(Astro.Body.Moon, observer, 1, date, 31)?.date ?? null;
  const nextSet = Astro.SearchRiseSet(Astro.Body.Moon, observer, -1, date, 31)?.date ?? null;
  const samples = Array.from({ length: 97 }, (_, i) => {
    const at = new Date(start.getTime() + (end.getTime() - start.getTime()) * i / 96);
    return { date: at, ...moonState(lat, lon, at) };
  });
  const futureEnd=new Date(date.getTime()+86_400_000);
  const crossings=[date,futureEnd];
  for(const direction of [-1,1] as const){
    const solar=Astro.SearchAltitude(Astro.Body.Sun,observer,direction,date,1,-18)?.date;
    const lunar=Astro.SearchRiseSet(Astro.Body.Moon,observer,direction,date,1)?.date;
    for(const crossing of [solar,lunar])if(crossing&&crossing>date&&crossing<futureEnd)crossings.push(crossing);
  }
  crossings.sort((a,b)=>a.getTime()-b.getTime());
  const windows: { start: Date; end: Date }[] = [];
  for(let i=1;i<crossings.length;i++){
    const intervalStart=crossings[i-1],intervalEnd=crossings[i];
    const p=moonState(lat,lon,new Date((intervalStart.getTime()+intervalEnd.getTime())/2));
    if(p.sunAlt>-18||p.alt>-p.diameter/2)continue;
    const previous = windows[windows.length - 1];
    if(previous&&previous.end.getTime()===intervalStart.getTime())previous.end=intervalEnd;
    else windows.push({start:intervalStart,end:intervalEnd});
  }
  return { start, end, rise:inDay(rise), set:inDay(set), transit:inDay(transit.time), nextRise, nextSet, samples, windows:windows.filter(w => w.end>w.start) };
}

export const MOONLIGHT_SOURCE = "https://articles.adsabs.harvard.edu/pdf/1991PASP..103.1033K";
export function scatteredMoonlight(moon: MoonState, targetAlt: number, separation: number, skyBrightness = 21.6, extinction = 0.172) {
  if (moon.alt <= -moon.diameter/2 || targetAlt <= 0) return { brightening: 0, skyBrightness, moonBrightness: 0 };
  const airmass = (alt: number) => 1 / Math.sqrt(1 - 0.96 * Math.cos(Math.max(0, alt)*rad)**2);
  const alpha = moon.phaseAngle;
  const intensity = 10 ** (-0.4*(3.84 + 0.026*alpha + 4e-9*alpha**4))
    * (384400 / moon.distanceKm)**2 * (alpha < 7 ? 1.35 - 0.05*alpha : 1);
  const rho = Math.max(1, separation); // Model undefined inside the lunar disk; flagged in UI.
  const mie = rho < 10 ? 6.2e7 / rho**2 : 10**(6.15-rho/40);
  const scattering = 10**5.36*(1.06+Math.cos(rho*rad)**2) + mie;
  const xt = airmass(targetAlt), xm = airmass(moon.alt);
  const moonBrightness = scattering * intensity * 10**(-0.4*extinction*xm) * (1-10**(-0.4*extinction*xt));
  const background = 34.08*Math.exp(20.7233-0.92104*skyBrightness) * xt * 10**(-0.4*extinction*(xt-1));
  const brightening = 2.5 * Math.log10(1 + moonBrightness/background);
  const baseline = (20.7233-Math.log(background/34.08))/0.92104;
  return { brightening, skyBrightness: baseline-brightening, moonBrightness };
}
export function targetMoonlight(target: UnifiedTarget, lat: number, lon: number, date: Date, skyBrightness = 21.6) {
  const moon = moonState(lat, lon, date);
  const position = eqToHorizontal(target.ra, target.dec, lat, lon, date);
  const separation = angularDistance(target.ra, target.dec, moon.ra, moon.dec);
  const model = scatteredMoonlight(moon, position.alt, separation, skyBrightness);
  const diffuse = /galaxy|nebula|cloud/i.test(target.category);
  const stars = /star|asterism/i.test(target.category);
  const level = moon.alt <= -moon.diameter/2 ? "Moon below horizon" : model.brightening < 0.3 ? "Little moonlight" : model.brightening < 1 ? "Some moonlight" : model.brightening < 2 ? "Brightened sky" : "Strong moonlight";
  const advice = moon.sunAlt >= 0 ? "Daylight at your selected time. Plan after dark to find stars and deep-sky targets." : position.alt <= 0 ? "This target is below the horizon at this time." : moon.sunAlt > -18 ? "Twilight also brightens the sky. Wait for astronomical darkness for faint targets." : moon.alt <= -moon.diameter/2 ? "The Moon is down. Local light pollution and transparency still matter." : diffuse ? "Diffuse detail loses contrast. A bright core may remain visible; try a darker window for the outer glow." : stars ? target.mag > 6 ? "This is a faint stellar target. Moonlight makes identification harder; choose a darker window and use steady support." : "Bright stars and wide pairs tolerate moonlight. Faint companions and subtle colors become harder." : "Bright cluster members may remain visible; the faint stars and unresolved glow lose contrast.";
  return { moon, ...model, separation, targetAlt: position.alt, targetAz: position.az, level, advice, diffuse, stars, reliable: moon.sunAlt <= -18 && position.alt >= 10 && moon.alt >= 5 && separation >= 10 && separation <= 120 };
}
