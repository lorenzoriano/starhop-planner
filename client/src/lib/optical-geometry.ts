import { stereographicProject } from './astronomy';
import type { EquatorialPoint } from './chart-view';

const RAD = Math.PI / 180;

/** Great-circle displacement; north/east are angular distances, not RA offsets. */
export function skyOffset(center: EquatorialPoint, north: number, east: number): EquatorialPoint {
  const lon = center.ra * RAD, lat = center.dec * RAD;
  const radius = Math.hypot(north, east) * RAD;
  if (!radius) return { ...center };
  const n = north / Math.hypot(north, east), e = east / Math.hypot(north, east);
  const origin = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const tangent = [-n * Math.sin(lat) * Math.cos(lon) - e * Math.sin(lon), -n * Math.sin(lat) * Math.sin(lon) + e * Math.cos(lon), n * Math.cos(lat)];
  const p = origin.map((v, i) => v * Math.cos(radius) + tangent[i] * Math.sin(radius));
  return { ra: (Math.atan2(p[1], p[0]) / RAD + 360) % 360, dec: Math.atan2(p[2], Math.hypot(p[0], p[1])) / RAD };
}

/** Approximate catalogue boundary, with position angle east of celestial north. */
export function angularEllipse(center: EquatorialPoint, major: number, minor: number, positionAngle = 0, steps = 64): EquatorialPoint[] {
  const pa = positionAngle * RAD;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = 2 * Math.PI * i / steps, a = major / 2 * Math.cos(t), b = minor / 2 * Math.sin(t);
    return skyOffset(center, a * Math.cos(pa) - b * Math.sin(pa), a * Math.sin(pa) + b * Math.cos(pa));
  });
}

/** Inverse of the fixed stereographic chart plane, including its moving focus. */
export function unprojectChartPoint(point: {x:number;y:number}, frame: EquatorialPoint, focus: EquatorialPoint, scale: number): EquatorialPoint {
  const offset = stereographicProject(focus.ra, focus.dec, frame.ra, frame.dec, scale);
  const east = -(point.x + (offset?.x ?? 0)) / scale * RAD;
  const north = -(point.y + (offset?.y ?? 0)) / scale * RAD;
  const rho = Math.hypot(east, north);
  if (rho < 1e-12) return { ...frame };
  const c = 2 * Math.atan(rho / 2), lat = frame.dec * RAD;
  const dec = Math.asin(Math.cos(c) * Math.sin(lat) + north * Math.sin(c) * Math.cos(lat) / rho);
  const ra = frame.ra * RAD + Math.atan2(east * Math.sin(c), rho * Math.cos(lat) * Math.cos(c) - north * Math.sin(lat) * Math.sin(c));
  return { ra: (ra / RAD + 360) % 360, dec: dec / RAD };
}

/** Rectangular true field, with great-circle width and height through its centre. */
export function angularField(center: EquatorialPoint, width: number, height: number, shape: 'circle'|'rectangle') {
  if (shape === 'circle') return angularEllipse(center, width, width);
  const corners = [[-height/2,-width/2],[-height/2,width/2],[height/2,width/2],[height/2,-width/2],[-height/2,-width/2]];
  return corners.slice(0, -1).flatMap(([n,e], edge) => Array.from({length:16}, (_, i) => skyOffset(center,n+(corners[edge+1][0]-n)*i/16,e+(corners[edge+1][1]-e)*i/16))).concat([skyOffset(center,corners[0][0],corners[0][1])]);
}
