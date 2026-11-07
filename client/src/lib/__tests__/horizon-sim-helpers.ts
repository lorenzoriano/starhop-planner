/**
 * Shared test helpers for the photo horizon: a synthetic equirectangular world, camera poses that point the rear camera
 * at a given azimuth/altitude, and frames rendered from the world with camera.ts (pinhole + k1), so segmentation,
 * projection, panorama and calibration tests can run on images with a known answer.
 *
 * World geometry: pixel (x, y) is centred on azimuth (x + ½)·360/width and altitude altMax − (y + ½)·(altMax − altMin)/height
 * (the panorama convention).
 */
import { cameraPointing, pixelToAzAlt, type CameraIntrinsics, type CameraPose } from '../horizon/calibrate/camera';
import { quatFromAxisAngle, quatMultiply, type Quat } from '../horizon/calibrate/quat';
import type { GrayImage, RgbaImage } from '../horizon/photo-types';

export interface EquirectWorld {
  image: RgbaImage;
  altMinDeg: number;
  altMaxDeg: number;
}

/** Build a world image from a colour function of (az, alt) in degrees; returns [r, g, b] or [r, g, b, a] (0…255). */
export function makeWorld(
  width: number,
  height: number,
  colour: (az: number, alt: number) => readonly number[],
  opts: { altMinDeg?: number; altMaxDeg?: number } = {},
): EquirectWorld {
  const altMinDeg = opts.altMinDeg ?? -90, altMaxDeg = opts.altMaxDeg ?? 90;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const alt = altMaxDeg - ((y + 0.5) * (altMaxDeg - altMinDeg)) / height;
    for (let x = 0; x < width; x++) {
      const c = colour(((x + 0.5) * 360) / width, alt), i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  return { image: { width, height, data }, altMinDeg, altMaxDeg };
}

/** Bilinear world sample at (az, alt), azimuth wrapping, altitude clamped; writes [r, g, b, a] into `out`. */
export function sampleWorld(world: EquirectWorld, az: number, alt: number, out: number[] | Float32Array): void {
  const { width: W, height: H, data } = world.image;
  const x = ((((az % 360) + 360) % 360) * W) / 360 - 0.5;
  const y = Math.min(H - 1, Math.max(0, ((world.altMaxDeg - alt) * H) / (world.altMaxDeg - world.altMinDeg) - 0.5));
  const x0 = Math.floor(x), fx = x - x0, y0 = Math.floor(y), fy = y - y0, y1 = Math.min(H - 1, y0 + 1);
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * W + xa) * 4 + c], b = data[(y0 * W + xb) * 4 + c];
    const d = data[(y1 * W + xa) * 4 + c], e = data[(y1 * W + xb) * 4 + c];
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
}

/** Render what the camera sees at `pose` (each pixel centre sampled from the world). */
export function renderFrame(world: EquirectWorld, pose: CameraPose, cam: CameraIntrinsics): RgbaImage {
  const data = new Uint8ClampedArray(cam.width * cam.height * 4), px = [0, 0, 0, 0];
  for (let v = 0; v < cam.height; v++) {
    for (let u = 0; u < cam.width; u++) {
      const { az, alt } = pixelToAzAlt(pose, cam, u + 0.5, v + 0.5);
      sampleWorld(world, az, alt, px);
      const i = (v * cam.width + u) * 4;
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = px[3];
    }
  }
  return { width: cam.width, height: cam.height, data };
}

/** One channel of an RGBA image as a GrayImage (e.g. a world whose red channel holds the true sky alpha). */
export function channel(img: RgbaImage, c = 0): GrayImage {
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4 + c];
  return { width: img.width, height: img.height, data };
}

/**
 * Device orientation that points the rear camera at (az, alt) with the given roll (degrees, cameraPointing's sign),
 * for a frame delivered at `screenAngle` (90 = landscape, top edge to the left, the capture guide's default).
 */
export function poseFor(az: number, alt: number, roll = 0, screenAngle = 90): CameraPose {
  // Portrait, upright, facing north: device y → up, device z → south (so the camera, −z, looks north).
  const portraitNorth = quatFromAxisAngle([1, 0, 0], 90);
  // Turn the phone counter-clockwise by screenAngle about its own z axis, plus the roll (clockwise positive).
  const turned = quatMultiply(portraitNorth, quatFromAxisAngle([0, 0, 1], screenAngle - roll));
  // Tilt up about world east, then turn to the azimuth (a positive turn about world +z decreases azimuth).
  const q: Quat = quatMultiply(quatFromAxisAngle([0, 0, 1], -az), quatMultiply(quatFromAxisAngle([1, 0, 0], alt), turned));
  return { q, screenAngle };
}

/** A ring of `n` poses at altitude `alt`, starting at `startAz`, evenly spaced. */
export function ringPoses(n: number, alt: number, startAz = 0, screenAngle = 90): CameraPose[] {
  return Array.from({ length: n }, (_, i) => poseFor(startAz + (i * 360) / n, alt, 0, screenAngle));
}

/** Skyline-based day world: blue sky gradient above `skyline(az)`, dark textured ground/trees below. Alpha 255. */
export function skylineWorld(
  skyline: (az: number) => number,
  opts: { width?: number; height?: number; sky?: 'day' | 'night' } = {},
): EquirectWorld {
  const night = opts.sky === 'night';
  return makeWorld(opts.width ?? 2048, opts.height ?? 1024, (az, alt) => {
    if (alt > skyline(az)) {
      if (night) return [8, 9, 14];
      const t = Math.min(1, Math.max(0, alt / 60));
      return [150 - 90 * t, 185 - 70 * t, 235 - 15 * t];
    }
    // Deterministic texture (foliage/ground).
    const n = Math.sin(az * 12.9898 + alt * 78.233) * 43758.5453;
    const tex = (n - Math.floor(n)) * 40;
    return night ? [3, 3, 3] : [30 + tex, 45 + tex, 25 + tex * 0.5];
  });
}

/** Sky-truth world (red channel = 255 above the skyline, 0 below), for projecting known alpha. */
export function alphaWorld(skyline: (az: number) => number, width = 2880, height = 1440): EquirectWorld {
  return makeWorld(width, height, (az, alt) => {
    const v = alt > skyline(az) ? 255 : 0;
    return [v, v, v];
  });
}

/** The pointing of a pose, re-exported for convenience in tests. */
export const pointing = cameraPointing;
