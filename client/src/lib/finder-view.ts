import { stereographicProject } from "./astronomy";
import type { EquatorialPoint } from "./chart-view";
import { orientChartPoint } from "./observing";

export type FinderReticle = "field" | "telrad" | "rigel";
/** Manufacturer ring sizes are diameters, in degrees. */
export const RETICLE_DIAMETERS: Record<FinderReticle, readonly number[]> = {
  field: [], telrad: [0.5, 2, 4], rigel: [0.5, 2],
};

/** Small circle on the celestial sphere, including RA wrap and polar fields. */
export function angularRing(center: EquatorialPoint, radiusDegrees: number, steps = 96): EquatorialPoint[] {
  const rad = Math.PI / 180, lat = center.dec * rad, lon = center.ra * rad, radius = radiusDegrees * rad;
  const origin = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const bearing = i * 2 * Math.PI / steps;
    const point = origin.map((value, axis) => value * Math.cos(radius) + (north[axis] * Math.cos(bearing) + east[axis] * Math.sin(bearing)) * Math.sin(radius));
    return { ra: ((Math.atan2(point[1], point[0]) / rad) % 360 + 360) % 360, dec: Math.atan2(point[2], Math.hypot(point[0], point[1])) / rad };
  });
}

/** Where the next field lies in the actual fixed chart plane, not mount motion. */
export function chartHopDirection(from: EquatorialPoint, to: EquatorialPoint, frame: EquatorialPoint, mirrored: boolean, rotation: number) {
  const a = stereographicProject(from.ra, from.dec, frame.ra, frame.dec, 1);
  const b = stereographicProject(to.ra, to.dec, frame.ra, frame.dec, 1);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1e-8) return null;
  const vector = orientChartPoint({ x: b.x - a.x, y: b.y - a.y }, mirrored, rotation);
  const angle = (Math.atan2(vector.x, -vector.y) * 180 / Math.PI + 360) % 360;
  const direction = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"][Math.round(angle / 45) % 8];
  return { direction, clock: Math.round(angle / 30) % 12 || 12 };
}
