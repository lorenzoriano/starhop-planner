/**
 * View maths for the 360° horizon viewer (docs/local-horizon-design.md, phase 3). Pure functions.
 *
 * The viewer is a rectilinear (pinhole) camera standing at the site with no roll: `yaw` is the azimuth of the screen
 * centre (from north through east), `pitch` its altitude, and `fovDeg` the field of view across the LONGER side of the
 * screen (so a phone in portrait shows `fovDeg` top to bottom). World frame as calibrate/quat.ts: x = east, y = north,
 * z = up. Screen pixels: x to the right, y down, origin at the top-left corner.
 * A rectilinear view maps great circles to straight lines, so constellation segments can be drawn as straight lines.
 */
import { azAltFromVec, vecFromAzAlt, type Vec3 } from '../calibrate/quat';

const RAD = Math.PI / 180;

const FOV_MIN = 30;
const FOV_MAX = 100;
const PITCH_MIN = -45;
const PITCH_MAX = 89;

export interface ViewState {
  yaw: number;
  pitch: number;
  fovDeg: number;
  /** Screen size in CSS pixels. */
  width: number;
  height: number;
}

/** Camera basis in world coordinates and the focal length in pixels. */
export interface ViewBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  focal: number;
}

export const clampFov = (fov: number) => Math.min(FOV_MAX, Math.max(FOV_MIN, fov));
export const clampPitch = (pitch: number) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
export const normAz = (az: number) => ((az % 360) + 360) % 360;

/** Focal length in pixels: the longer side spans `fovDeg`. */
const focalLength = (v: Pick<ViewState, 'fovDeg' | 'width' | 'height'>) =>
  Math.max(v.width, v.height, 1) / 2 / Math.tan((clampFov(v.fovDeg) * RAD) / 2);

export function viewBasis(v: ViewState): ViewBasis {
  const forward = vecFromAzAlt(v.yaw, v.pitch);
  const a = v.yaw * RAD;
  // Horizontal "right" (east when looking north); up = right × forward keeps the horizon level.
  const right: Vec3 = [Math.cos(a), -Math.sin(a), 0];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up, focal: focalLength(v) };
}

/** World unit vector seen at a screen point. */
export function screenToVec(v: ViewState, x: number, y: number, basis = viewBasis(v)): Vec3 {
  const { forward: f, right: r, up: u, focal } = basis;
  const sx = (x - v.width / 2) / focal, sy = (v.height / 2 - y) / focal;
  const d: Vec3 = [f[0] + sx * r[0] + sy * u[0], f[1] + sx * r[1] + sy * u[1], f[2] + sx * r[2] + sy * u[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

/** Azimuth and altitude seen at a screen point, degrees. */
export function screenToAzAlt(v: ViewState, x: number, y: number, basis = viewBasis(v)): { az: number; alt: number } {
  return azAltFromVec(screenToVec(v, x, y, basis));
}

/** Screen point of a world direction, or null when it is behind the viewer (or within ~3° of the side plane). */
export function vecToScreen(v: ViewState, w: Vec3, basis = viewBasis(v)): { x: number; y: number } | null {
  const { forward: f, right: r, up: u, focal } = basis;
  const z = w[0] * f[0] + w[1] * f[1] + w[2] * f[2];
  if (z <= 0.05) return null;
  return {
    x: v.width / 2 + (focal * (w[0] * r[0] + w[1] * r[1] + w[2] * r[2])) / z,
    y: v.height / 2 - (focal * (w[0] * u[0] + w[1] * u[1] + w[2] * u[2])) / z,
  };
}

export function azAltToScreen(v: ViewState, az: number, alt: number, basis = viewBasis(v)): { x: number; y: number } | null {
  return vecToScreen(v, vecFromAzAlt(az, alt), basis);
}

/** Degrees of sky per screen pixel at the centre (for drag-to-look and drag-to-align). */
export const degPerPixel = (v: ViewState) => 1 / (focalLength(v) * RAD);

/** The view after dragging the scene by (dx, dy) screen pixels: the sky follows the finger. */
export function dragView(v: ViewState, dx: number, dy: number): ViewState {
  const k = degPerPixel(v);
  return { ...v, yaw: normAz(v.yaw - dx * k), pitch: clampPitch(v.pitch + dy * k) };
}

/** The view after a pinch or wheel zoom by `factor` (> 1 zooms in). */
export function zoomView(v: ViewState, factor: number): ViewState {
  return factor > 0 && Number.isFinite(factor) ? { ...v, fovDeg: clampFov(v.fovDeg / factor) } : v;
}

// ───────────────────────────── panorama geometry ─────────────────────────────

/**
 * Texture coordinates (0…1, v down from the top) of a direction on the equirectangular panorama (true north at u = 0,
 * azimuth increasing to the right, altMax at the top), or null outside its altitude band. `shiftDeg` moves the photo
 * to larger azimuths (what drag-to-align previews before saving).
 */
export function panoramaUv(az: number, alt: number, altMin: number, altMax: number, shiftDeg = 0): { u: number; v: number } | null {
  if (alt < altMin || alt > altMax) return null;
  return { u: normAz(az - shiftDeg) / 360, v: (altMax - alt) / (altMax - altMin) };
}

/** Panorama texture size that fits the GPU limit, keeping the aspect ratio (phones may cap textures at 2048 or 4096). */
export function fitTextureSize(width: number, height: number, maxSize: number): { width: number; height: number } {
  const s = Math.min(1, maxSize / Math.max(width, height, 1));
  return { width: Math.max(1, Math.floor(width * s)), height: Math.max(1, Math.floor(height * s)) };
}

// ───────────────────────────── sky and ground colours ─────────────────────────────

/** How light the sky is, 0 (night) … 1 (day), from the Sun's apparent altitude (dark below −12°). */
export function skyLight(sunAltDeg: number): number {
  return Math.min(1, Math.max(0, (sunAltDeg + 12) / 16));
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const NIGHT_ZENITH = [6, 10, 22], NIGHT_HORIZON = [22, 34, 56];
const DAY_ZENITH = [62, 118, 190], DAY_HORIZON = [170, 200, 225];
export const GROUND_RGB: readonly [number, number, number] = [10, 12, 14];

/**
 * Background colour at a direction: a sky gradient (lighter towards the horizon, brighter in twilight) above the
 * skyline and a dark ground below it. The WebGL shader computes the same thing; this is the 2D fallback.
 */
export function backgroundRgb(alt: number, skylineAlt: number, light: number): [number, number, number] {
  if (alt < skylineAlt) return [GROUND_RGB[0], GROUND_RGB[1], GROUND_RGB[2]];
  const t = Math.pow(Math.min(1, Math.max(0, alt / 90)), 0.5);
  return [0, 1, 2].map((i) => Math.round(mix(
    mix(NIGHT_HORIZON[i], DAY_HORIZON[i], light),
    mix(NIGHT_ZENITH[i], DAY_ZENITH[i], light),
    t,
  ))) as [number, number, number];
}

/** Shared with the shader so both paths draw the same sky. */
export const SKY_COLOURS = { NIGHT_ZENITH, NIGHT_HORIZON, DAY_ZENITH, DAY_HORIZON, GROUND: GROUND_RGB };
