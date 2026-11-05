import { equatorialOfDate } from "./fixed-equatorial";
import * as Astro from "astronomy-engine";
import { stereographicProject } from "./astronomy";

export interface EquatorialPoint { ra: number; dec: number; }
/** Spherical means handle RA wrap and polar fields without arithmetic-RA jumps. */
export function chartFrame(points: EquatorialPoint[]): EquatorialPoint {
  if (!points.length) return { ra: 0, dec: 25 };
  const radians = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    x += Math.cos(p.dec * radians) * Math.cos(p.ra * radians);
    y += Math.cos(p.dec * radians) * Math.sin(p.ra * radians);
    z += Math.sin(p.dec * radians);
  }
  if (Math.hypot(x, y, z) < 1e-8) return points[0];
  return { ra: (Math.atan2(y, x) / radians + 360) % 360, dec: Math.atan2(z, Math.hypot(x, y)) / radians };
}
export function skyZenith(lat: number, lon: number, date: Date): EquatorialPoint {
  return equatorialOfDate(((Astro.SiderealTime(date)*15+lon)%360+360)%360,lat,date,true);
}
/**
 * Chart rotation (degrees, as orientChartPoint takes it) that puts the zenith straight up at `frame`, so the chart
 * matches what an observer facing that part of the sky sees: up = overhead, right = increasing azimuth. Sky Journeys
 * field mode gives its directions in that frame ("move left about two fields"), so its map must use it too
 * (design review r4). Null when the frame is within ~0.5° of the zenith (every direction is "up" there).
 */
export function observerUpRotation(frame: EquatorialPoint, zenith: EquatorialPoint, mirrored = false): number | null {
  const r = Math.PI / 180;
  const vec = (p: EquatorialPoint) => [Math.cos(p.dec * r) * Math.cos(p.ra * r), Math.cos(p.dec * r) * Math.sin(p.ra * r), Math.sin(p.dec * r)];
  const c = vec(frame), z = vec(zenith);
  const dot = c[0] * z[0] + c[1] * z[1] + c[2] * z[2];
  const u = [z[0] - dot * c[0], z[1] - dot * c[1], z[2] - dot * c[2]];
  const n = Math.hypot(u[0], u[1], u[2]);
  if (n < 0.01) return null;
  const step = 0.5 * r;
  const q = [0, 1, 2].map((k) => c[k] * Math.cos(step) + (u[k] / n) * Math.sin(step));
  const toward = { ra: ((Math.atan2(q[1], q[0]) / r) + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, q[2]))) / r };
  const a = stereographicProject(frame.ra, frame.dec, frame.ra, frame.dec, 100), b = stereographicProject(toward.ra, toward.dec, frame.ra, frame.dec, 100);
  if (!a || !b) return null;
  const vx = (mirrored ? -1 : 1) * (b.x - a.x), vy = b.y - a.y;
  if (Math.hypot(vx, vy) < 1e-9) return null;
  let deg = -90 - Math.atan2(vy, vx) / r;
  deg = ((deg % 360) + 540) % 360 - 180;
  return Math.round(deg);
}
/** Move the viewport on a fixed plane. Following a hop never turns the sky. */
export function projectChartPoint(point: EquatorialPoint, frame: EquatorialPoint, focus: EquatorialPoint, scale: number) {
  const projected = stereographicProject(point.ra, point.dec, frame.ra, frame.dec, scale);
  const offset = stereographicProject(focus.ra, focus.dec, frame.ra, frame.dec, scale);
  return projected && offset ? { x: projected.x - offset.x, y: projected.y - offset.y } : null;
}

/** Frame the active field with surrounding sky instead of opening on a distant route. */
export function fieldViewZoom(viewRadius: number, fieldWidth: number, fieldHeight = fieldWidth, fillRadius = 180, maxZoom = 200) {
  const radians = Math.PI / 180;
  const planeRadius = 2*Math.tan(viewRadius*radians/2)/radians;
  const fieldRadius = 2*Math.tan(Math.max(fieldWidth,fieldHeight)*radians/4)/radians;
  return Math.max(.5, Math.min(maxZoom, fillRadius/(fieldRadius*260/planeRadius)));
}
