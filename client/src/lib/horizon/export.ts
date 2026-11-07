/**
 * Horizon exchange files (docs/local-horizon-design.md, phase 4). Every export writes the COMBINED apparent skyline
 * (max over the terrain and photo layers, at the finest layer step) as "azimuth altitude" pairs in degrees, azimuth from
 * true north through east — the de-facto interchange format read by NINA (.hrz), Stellarium (polygonal landscapes),
 * Cartes du Ciel, Telescopius and others. Import reads any of those back as a photo-equivalent layer.
 */
import { strToU8, zipSync } from 'fflate';
import { IMPORT_SOURCE } from './photo-types';
import { horizonAltitudeAt } from './profile';
import type { HorizonProfile, LocalHorizon } from './types';

/** Step of an imported profile (same as the photo layer). */
const IMPORT_STEP_DEG = 0.25;

/** Combined apparent skyline sampled at the finest layer step; null when no layer is known. */
export function combinedApparentSkyline(h: LocalHorizon | null | undefined): { stepDeg: number; alt: number[] } | null {
  const layers = [h?.terrain, h?.photo].filter((p): p is HorizonProfile => !!p && Array.isArray(p.alt) && p.alt.length >= 2);
  if (!layers.length) return null;
  const n = Math.max(...layers.map((p) => p.alt.length)), stepDeg = 360 / n;
  const alt = Array.from({ length: n }, (_, i) => horizonAltitudeAt(h, i * stepDeg) ?? 0);
  return { stepDeg, alt };
}

/** Shortest decimal for a value at `digits` places ("12.25", "3", "-0.4"). */
function num(v: number, digits: number): string {
  const r = Number(v.toFixed(digits));
  return String(Object.is(r, -0) ? 0 : r);
}

/** Azimuth/altitude rows, azimuth ascending from 0 to 360 inclusive (a flat 0° line when nothing is known). */
function rows(h: LocalHorizon | null | undefined): Array<[number, number]> {
  const sky = combinedApparentSkyline(h);
  if (!sky) return [[0, 0], [360, 0]];
  const out = sky.alt.map((a, i): [number, number] => [i * sky.stepDeg, a]);
  out.push([360, sky.alt[0]]);
  return out;
}

/** Site the file describes: where the photo was taken when there is one (the user stood there), else the terrain site. */
function siteOf(h: LocalHorizon | null | undefined): { lat: number; lon: number; groundM?: number } | null {
  const p = h?.photo ?? h?.terrain;
  return p ? { lat: p.lat, lon: p.lon, groundM: h?.terrain?.groundM ?? p.groundM } : null;
}

const pairLines = (r: Array<[number, number]>) => r.map(([az, alt]) => `${num(az, 2)} ${num(alt, 1)}`).join('\n');

/** NINA custom horizon (.hrz): "az alt" pairs separated by a space, `#` comments, azimuth 0…360 ascending. */
export function toNinaHrz(h: LocalHorizon): string {
  const site = siteOf(h);
  const header = site ? `# StarHop horizon for ${site.lat.toFixed(3)}, ${site.lon.toFixed(3)} (NINA custom horizon)` : '# StarHop horizon (NINA custom horizon)';
  return `${header}\n# azimuth altitude, degrees\n${pairLines(rows(h))}\n`;
}

/** Plain "az alt" text with a short header comment; what the import reads back. */
export function toAzAltText(h: LocalHorizon): string {
  const site = siteOf(h);
  const header = site
    ? `# StarHop horizon for ${site.lat.toFixed(3)}, ${site.lon.toFixed(3)} — azimuth altitude in degrees`
    : '# StarHop horizon — azimuth altitude in degrees';
  return `${header}\n${pairLines(rows(h))}\n`;
}

/** Degrees as Stellarium's documented sign-degrees-minutes-seconds form, e.g. +46d01'12.0". */
function stellariumAngle(deg: number): string {
  const sign = deg < 0 ? '-' : '+';
  let tenths = Math.round(Math.abs(deg) * 36000); // tenths of an arcsecond
  const d = Math.floor(tenths / 36000);
  tenths -= d * 36000;
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${sign}${d}d${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`;
}

/** Folder name Stellarium uses as the landscape id: letters, digits, dash and underscore only. */
function landscapeId(name: string): string {
  const id = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return (id || 'starhop_horizon').slice(0, 60);
}

/**
 * Stellarium landscape zip: one folder holding landscape.ini (type polygonal) and horizon.txt. The Stellarium guide warns
 * that a vertex exactly at 0°, 90°, 180° or 270° can make the polygon vanish, so those azimuths are nudged by 0.001°,
 * and the closing 360° vertex is left out (Stellarium closes the line itself).
 */
export function toStellariumZip(h: LocalHorizon, name: string): Uint8Array {
  const id = landscapeId(name);
  const site = siteOf(h);
  const cleanName = name.replace(/[\r\n]+/g, ' ').trim() || 'StarHop horizon';
  const vertices = rows(h).slice(0, -1).map(([az, alt]): [number, number] => [az % 90 === 0 ? az + 0.001 : az, alt]);
  const horizon = `# StarHop horizon${site ? ` for ${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}` : ''} — azimuth altitude in degrees\n`
    + `${vertices.map(([az, alt]) => `${num(az, 3)} ${num(alt, 1)}`).join('\n')}\n`;
  const ini = [
    '[landscape]',
    `name = ${cleanName}`,
    'author = StarHop Planner',
    `description = Measured horizon from StarHop Planner (terrain${h.photo ? ', trees and buildings' : ''}).`,
    'type = polygonal',
    'polygonal_horizon_list = horizon.txt',
    'polygonal_horizon_list_mode = azDeg_altDeg',
    'polygonal_angle_rotatez = 0',
    'ground_color = .15,.17,.13',
    'horizon_line_color = .75,.45,.45',
    'minimal_altitude = -2',
    ...(site
      ? [
        '',
        '[location]',
        'planet = Earth',
        `latitude = ${stellariumAngle(site.lat)}`,
        `longitude = ${stellariumAngle(site.lon)}`,
        `altitude = ${Math.round(site.groundM ?? 0)}`,
      ]
      : []),
    '',
  ].join('\n');
  return zipSync({ [id]: { 'landscape.ini': strToU8(ini), 'horizon.txt': strToU8(horizon) } });
}

// ───────────────────────────── import ─────────────────────────────

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Read "azimuth altitude" text: our own exports, NINA .hrz, a Stellarium polygonal horizon list, or plain lines with
 * spaces, tabs, commas or semicolons between the numbers. `#`, `;` and `//` start comments; header and section lines
 * without two numbers are skipped. The points are interpolated linearly (wrapping at 360°) into a 0.25° photo layer.
 */
export function parseAzAltText(text: string, site: { lat: number; lon: number }): { profile: HorizonProfile } | { error: string } {
  if (typeof text !== 'string' || !text.trim()) return { error: 'The file is empty.' };
  if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon) || Math.abs(site.lat) > 90 || Math.abs(site.lon) > 180) {
    return { error: 'Choose a valid location before importing a horizon.' };
  }
  if (/polygonal_horizon_list_mode\s*=\s*(?!azDeg_altDeg)\w+/i.test(text)) {
    return { error: 'This Stellarium file uses a horizon format other than azimuth and altitude in degrees. Export it as azimuth and altitude in degrees and try again.' };
  }
  const points = new Map<number, number>();
  const lines = text.split(/\r\n|\r|\n/);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].replace(/(#|\/\/).*$/, '').replace(/^\s*;.*$/, '').trim();
    if (!line || line.startsWith('[')) continue;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    if (parts.length < 2 || !NUMBER.test(parts[0]) || !NUMBER.test(parts[1])) continue; // header, count or key = value
    const az = Number(parts[0]), alt = Number(parts[1]);
    if (az < -360 || az > 720) return { error: `Line ${k + 1}: the azimuth ${parts[0]} is not between 0° and 360°.` };
    if (alt < -90 || alt > 90) return { error: `Line ${k + 1}: the altitude ${parts[1]} is not between −90° and 90°.` };
    const a = ((az % 360) + 360) % 360;
    // A repeated azimuth (0 and 360, or a vertical edge listed twice) keeps the higher altitude.
    points.set(a, Math.max(points.get(a) ?? -90, alt));
  }
  if (!points.size) return { error: 'No azimuth and altitude pairs were found. Each line should hold an azimuth and an altitude in degrees, like "180 12.5".' };
  if (points.size < 2) return { error: 'The file needs at least two points at different azimuths.' };
  const sorted = Array.from(points.entries()).sort((p, q) => p[0] - q[0]);
  const n = Math.round(360 / IMPORT_STEP_DEG);
  const alt = new Array<number>(n);
  let j = 0; // last vertex at or before the bin
  for (let i = 0; i < n; i++) {
    const az = i * IMPORT_STEP_DEG;
    while (j + 1 < sorted.length && sorted[j + 1][0] <= az) j++;
    // Bracketing vertices, wrapping past 360 and before the first vertex.
    let [a0, v0] = sorted[j], [a1, v1] = sorted[(j + 1) % sorted.length];
    if (az < sorted[0][0]) {
      [a0, v0] = sorted[sorted.length - 1];
      a0 -= 360;
      [a1, v1] = sorted[0];
    } else if (j === sorted.length - 1) a1 += 360;
    const f = a1 === a0 ? 0 : (az - a0) / (a1 - a0);
    alt[i] = Math.round((v0 + (v1 - v0) * f) * 100) / 100;
  }
  return {
    profile: {
      kind: 'photo',
      stepDeg: IMPORT_STEP_DEG,
      alt,
      lat: site.lat,
      lon: site.lon,
      computedAt: new Date().toISOString(),
      source: IMPORT_SOURCE,
    },
  };
}
