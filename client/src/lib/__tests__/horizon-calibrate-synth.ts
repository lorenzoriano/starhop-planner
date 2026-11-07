/**
 * Synthetic data for the calibration tests: a textured world (equirectangular grey map with a skyline, textured
 * ground and faint sky), sweep poses, and frames rendered through the camera model of calibrate/camera.ts.
 */
import { focalPx, pixelToWorld, screenAxes, type CameraIntrinsics } from '../horizon/calibrate/camera';
import { quatFromAxisAngle, quatMultiply, rotateVec, type Quat } from '../horizon/calibrate/quat';
import type { RgbaImage } from '../horizon/photo-types';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Phone upright in portrait facing north, then turned counter-clockwise into landscape (screen angle 90).
const PORTRAIT_NORTH = quatFromAxisAngle([1, 0, 0], 90);
export const LANDSCAPE_NORTH = quatMultiply(PORTRAIT_NORTH, quatFromAxisAngle([0, 0, 1], 90));

/** Device orientation for a landscape (screen angle 90) camera pointing at az/alt with a roll, degrees. */
export function poseFor(azDeg: number, altDeg: number, rollDeg = 0, screenAngle = 90): Quat {
  const base = screenAngle === 90 ? LANDSCAPE_NORTH : PORTRAIT_NORTH;
  // Roll about the camera axis (device z), then pitch up about world east, then turn to the azimuth.
  const rolled = quatMultiply(base, quatFromAxisAngle([0, 0, 1], -rollDeg));
  return quatMultiply(quatFromAxisAngle([0, 0, 1], -azDeg), quatMultiply(quatFromAxisAngle([1, 0, 0], altDeg), rolled));
}

export interface World {
  /** Grey level (0…255) seen in a world direction given as azimuth/altitude, degrees. */
  sample(azDeg: number, altDeg: number): number;
}

/** Value-noise world: skyline from hills, strong texture below it, faint texture in a bright sky above. */
export function texturedWorld(seed = 1): World {
  const res = 0.125; // degrees per map pixel
  const W = Math.round(360 / res), H = Math.round(180 / res);
  const map = new Float32Array(W * H);
  const r = rng(seed);
  const octaves = [
    { cell: 6, amp: 0.45 },
    { cell: 2, amp: 0.35 },
    { cell: 0.6, amp: 0.2 },
  ];
  const grids = octaves.map(({ cell }) => {
    const gw = Math.round(360 / cell), gh = Math.round(180 / cell) + 2;
    return { gw, gh, cell, v: Float32Array.from({ length: gw * gh }, () => r()) };
  });
  const skyline = (az: number) => 4 + 3 * Math.sin((az * 2 + 30) * (Math.PI / 180)) + 2 * Math.sin((az * 7) * (Math.PI / 180));
  for (let y = 0; y < H; y++) {
    const alt = 90 - (y + 0.5) * res;
    for (let x = 0; x < W; x++) {
      const az = (x + 0.5) * res;
      let n = 0;
      octaves.forEach(({ amp }, k) => {
        const g = grids[k];
        const gx = az / g.cell, gy = (90 - alt) / g.cell;
        const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const at = (i: number, j: number) => g.v[Math.min(g.gh - 1, j) * g.gw + (((i % g.gw) + g.gw) % g.gw)];
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        n += amp * (top + (bottom - top) * sy);
      });
      const ground = alt < skyline(az);
      map[y * W + x] = ground ? 30 + 160 * n : 200 + 0.15 * alt + 12 * n;
    }
  }
  return {
    sample(azDeg: number, altDeg: number) {
      const fx = (((azDeg % 360) + 360) % 360) / res - 0.5, fy = (90 - altDeg) / res - 0.5;
      const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy))), tx = fx - x0, ty = fy - y0;
      const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
      const top = map[y0 * W + xa] + (map[y0 * W + xb] - map[y0 * W + xa]) * tx;
      const bottom = map[(y0 + 1) * W + xa] + (map[(y0 + 1) * W + xb] - map[(y0 + 1) * W + xa]) * tx;
      return top + (bottom - top) * ty;
    },
  };
}

/**
 * Render a frame through the camera model (pixel centres at +0.5), with optional gain/offset and noise. Inlines
 * camera.ts's pixelToWorld for speed (the first and last pixels are checked against it).
 */
export function renderFrame(world: World, q: Quat, screenAngle: number, cam: CameraIntrinsics, opts: { gain?: number; offset?: number; noise?: number; seed?: number } = {}): RgbaImage {
  const { width, height } = cam;
  const data = new Uint8ClampedArray(width * height * 4);
  const gain = opts.gain ?? 1, offset = opts.offset ?? 0, noise = opts.noise ?? 0;
  const r = rng(opts.seed ?? 7);
  const { right, up, forward } = screenAxes(screenAngle);
  const R = rotateVec(q, right), U = rotateVec(q, up), F = rotateVec(q, forward);
  const f = focalPx(cam), k1 = cam.k1 ?? 0;
  const DEG = 180 / Math.PI;
  const direction = (u: number, v: number): [number, number, number] => {
    let x = (u - width / 2) / f, y = (height / 2 - v) / f;
    if (k1) {
      const rd = Math.hypot(x, y);
      let rr = rd;
      for (let i = 0; i < 8; i++) rr -= (rr * (1 + k1 * rr * rr) - rd) / (1 + 3 * k1 * rr * rr);
      if (rd > 0) {
        x *= rr / rd;
        y *= rr / rd;
      }
    }
    const dx = F[0] + x * R[0] + y * U[0], dy = F[1] + x * R[1] + y * U[1], dz = F[2] + x * R[2] + y * U[2];
    const n = Math.hypot(dx, dy, dz);
    return [dx / n, dy / n, dz / n];
  };
  for (const [u, v] of [[0.5, 0.5], [width - 0.5, height - 0.5]]) {
    const a = direction(u, v), b = pixelToWorld({ q, screenAngle }, cam, u, v);
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-9) throw new Error('renderFrame disagrees with camera.ts');
  }
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const d = direction(u + 0.5, v + 0.5);
      const alt = Math.asin(Math.max(-1, Math.min(1, d[2]))) * DEG;
      const az = Math.atan2(d[0], d[1]) * DEG;
      const g = world.sample(az, alt) * gain + offset + (noise ? (r() - 0.5) * 2 * noise : 0);
      const k = (v * width + u) * 4;
      // Slightly different channels so the grey conversion is exercised.
      data[k] = g * 0.95;
      data[k + 1] = g;
      data[k + 2] = g * 1.05;
      data[k + 3] = 255;
    }
  }
  return { width, height, data };
}
