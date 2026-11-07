/**
 * Quaternion and vector helpers for the photo horizon (docs/local-horizon-design.md, phase 2). Pure functions.
 *
 * Frames (W3C Orientation Sensor convention, which Chrome's sensors and DevTools overrides use):
 * - WORLD: x = east, y = north, z = up (ENU). Azimuth is measured from north through east; altitude up from the horizon.
 * - DEVICE: x = right edge of the phone held upright (portrait), y = top edge, z = out of the screen towards the user.
 * - A sensor quaternion q = [x, y, z, w] rotates DEVICE vectors into WORLD vectors: v_world = q · v_device · q⁻¹.
 *   A phone lying flat, screen up, top edge pointing north, reads the identity.
 *   RelativeOrientationSensor's world has an arbitrary azimuth origin; AbsoluteOrientationSensor's is MAGNETIC north.
 */

export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

const RAD = Math.PI / 180;

export const IDENTITY: Quat = [0, 0, 0, 1];

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatConjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation by `angleDeg` about a unit axis (right-handed: counter-clockwise looking down the axis). */
export function quatFromAxisAngle(axis: Vec3, angleDeg: number): Quat {
  const h = (angleDeg * RAD) / 2, s = Math.sin(h);
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [(axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s, Math.cos(h)];
}

/** v' = q · v · q⁻¹ for a unit quaternion. */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Angle of the rotation between two orientations, degrees (0…180). */
export function quatAngleDeg(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, d))) / RAD;
}

/** World unit vector for an azimuth (from north through east) and altitude, degrees. */
export function vecFromAzAlt(azDeg: number, altDeg: number): Vec3 {
  const a = azDeg * RAD, h = altDeg * RAD, c = Math.cos(h);
  return [c * Math.sin(a), c * Math.cos(a), Math.sin(h)];
}

/** Azimuth (0…360) and altitude of a world vector, degrees. */
export function azAltFromVec(v: Vec3): { az: number; alt: number } {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  const alt = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / RAD;
  const az = ((Math.atan2(v[0], v[1]) / RAD) % 360 + 360) % 360;
  return { az, alt };
}

/**
 * Re-reference an orientation by a world yaw offset: if the sensor's azimuths are `offsetDeg` short of the truth
 * (true az = sensor az + offsetDeg), the corrected orientation is Rz(−offsetDeg) · q.
 * (A positive rotation about world +z turns east towards north, i.e. decreases azimuth.)
 */
export function applyYaw(q: Quat, offsetDeg: number): Quat {
  return quatMultiply(quatFromAxisAngle([0, 0, 1], -offsetDeg), q);
}

/** Signed difference a − b of two angles, wrapped to (−180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** Circular mean of angles in degrees (0…360); NaN for an empty list. */
export function circularMeanDeg(angles: readonly number[], weights?: readonly number[]): number {
  let s = 0, c = 0;
  angles.forEach((a, i) => {
    const w = weights?.[i] ?? 1;
    s += w * Math.sin(a * RAD);
    c += w * Math.cos(a * RAD);
  });
  if (!angles.length) return NaN;
  return ((Math.atan2(s, c) / RAD) % 360 + 360) % 360;
}

/** Circular median (the sample minimising the summed absolute angular distance), degrees. NaN for an empty list. */
export function circularMedianDeg(angles: readonly number[]): number {
  if (!angles.length) return NaN;
  let best = angles[0], bestCost = Infinity;
  for (const a of angles) {
    let cost = 0;
    for (const b of angles) cost += Math.abs(angleDiffDeg(a, b));
    if (cost < bestCost) { bestCost = cost; best = a; }
  }
  return ((best % 360) + 360) % 360;
}
