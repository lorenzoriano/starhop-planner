/**
 * Camera model for the photo horizon: pixel ⇄ world direction for the rear camera, given the device orientation
 * (calibrate/quat.ts conventions), the screen orientation angle and the lens intrinsics. Pure functions.
 *
 * - The rear camera looks along DEVICE −z.
 * - Camera frames are delivered upright for the current screen orientation (as Chrome on Android does), so image
 *   "right" and "up" follow the screen. `screenAngle` is `screen.orientation.angle`: 0 portrait; 90 landscape with the
 *   phone's top edge to the LEFT (turned counter-clockwise); 270 landscape with the top edge to the right; 180 upside down.
 *   Turning the phone counter-clockwise by θ about its z axis means: screen right = (cos θ, −sin θ, 0) and
 *   screen up = (sin θ, cos θ, 0) in device coordinates.
 * - Pixels: u to the right, v down, origin at the top-left corner of the image, principal point at the centre.
 * - Pinhole with one radial term: normalised undistorted coordinates (x, y) (x right, y up, at focal length 1) are
 *   imaged at (x, y)·(1 + k1·r²), r² = x² + y². The focal length in pixels is (width/2) / tan(hfov/2), so `hfovDeg` is the
 *   field of view of an UNDISTORTED image across its width.
 */
import { azAltFromVec, quatConjugate, rotateVec, vecFromAzAlt, type Quat, type Vec3 } from './quat';

const RAD = Math.PI / 180;

export interface CameraIntrinsics {
  /** Image size in pixels as delivered (after the browser's rotation for the screen orientation). */
  width: number;
  height: number;
  /** Horizontal field of view across `width`, degrees. */
  hfovDeg: number;
  /** Radial distortion (barrel < 0 < pincushion); 0 or undefined for none. */
  k1?: number;
}

export interface CameraPose {
  /** Device orientation (device → world), with any yaw correction already applied. */
  q: Quat;
  /** screen.orientation.angle when the frame was taken (0, 90, 180 or 270). */
  screenAngle: number;
}

export const focalPx = (c: CameraIntrinsics) => c.width / 2 / Math.tan((c.hfovDeg * RAD) / 2);

export const vfovDeg = (c: CameraIntrinsics) => (2 * Math.atan(c.height / 2 / focalPx(c))) / RAD;

/** Screen right and up vectors, and the camera's viewing direction, in DEVICE coordinates. */
export function screenAxes(screenAngle: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const t = screenAngle * RAD, c = Math.cos(t), s = Math.sin(t);
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return { right: [clean(c), clean(-s), 0], up: [clean(s), clean(c), 0], forward: [0, 0, -1] };
}

function distort(x: number, y: number, k1: number): [number, number] {
  const f = 1 + k1 * (x * x + y * y);
  return [x * f, y * f];
}

function undistort(xd: number, yd: number, k1: number): [number, number] {
  if (!k1) return [xd, yd];
  // Newton on the radius: r·(1 + k1·r²) = rd.
  const rd = Math.hypot(xd, yd);
  if (rd === 0) return [0, 0];
  let r = rd;
  for (let i = 0; i < 20; i++) {
    const step = (r * (1 + k1 * r * r) - rd) / (1 + 3 * k1 * r * r);
    r -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return [(xd * r) / rd, (yd * r) / rd];
}

/** World unit vector seen at pixel (u, v). */
export function pixelToWorld(pose: CameraPose, cam: CameraIntrinsics, u: number, v: number): Vec3 {
  const f = focalPx(cam);
  const [x, y] = undistort((u - cam.width / 2) / f, (cam.height / 2 - v) / f, cam.k1 ?? 0);
  const { right, up, forward } = screenAxes(pose.screenAngle);
  const d: Vec3 = [
    forward[0] + x * right[0] + y * up[0],
    forward[1] + x * right[1] + y * up[1],
    forward[2] + x * right[2] + y * up[2],
  ];
  const n = Math.hypot(d[0], d[1], d[2]);
  return rotateVec(pose.q, [d[0] / n, d[1] / n, d[2] / n]);
}

/** Azimuth/altitude seen at pixel (u, v), degrees. */
export function pixelToAzAlt(pose: CameraPose, cam: CameraIntrinsics, u: number, v: number): { az: number; alt: number } {
  return azAltFromVec(pixelToWorld(pose, cam, u, v));
}

/** Pixel where a world direction is imaged, or null when it is behind the camera. May fall outside the image. */
export function worldToPixel(pose: CameraPose, cam: CameraIntrinsics, w: Vec3): { u: number; v: number } | null {
  const d = rotateVec(quatConjugate(pose.q), w);
  const { right, up, forward } = screenAxes(pose.screenAngle);
  const z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
  if (z <= 1e-9) return null;
  const x = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z;
  const y = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z;
  const [xd, yd] = distort(x, y, cam.k1 ?? 0);
  const f = focalPx(cam);
  return { u: cam.width / 2 + xd * f, v: cam.height / 2 - yd * f };
}

export function azAltToPixel(pose: CameraPose, cam: CameraIntrinsics, azDeg: number, altDeg: number): { u: number; v: number } | null {
  return worldToPixel(pose, cam, vecFromAzAlt(azDeg, altDeg));
}

/**
 * Where the camera points: azimuth and altitude of the image centre, and roll (degrees) of the image about the
 * viewing axis — 0 when the image's "up" is as close to vertical as possible, positive when the image is turned
 * clockwise as seen by the user (the horizon appears to tilt counter-clockwise on screen).
 */
export function cameraPointing(pose: CameraPose): { az: number; alt: number; roll: number } {
  const { right, up, forward } = screenAxes(pose.screenAngle);
  const f = rotateVec(pose.q, forward), r = rotateVec(pose.q, right), u = rotateVec(pose.q, up);
  const { az, alt } = azAltFromVec(f);
  // Level reference: "right" should be horizontal; roll is the angle of image-right above the horizontal plane,
  // measured with the sign that makes a clockwise turn of the phone positive.
  const roll = Math.atan2(-r[2], u[2]) / RAD;
  return { az, alt, roll };
}
