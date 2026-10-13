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
  return { ra: ((Astro.SiderealTime(date) * 15 + lon) % 360 + 360) % 360, dec: lat };
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
