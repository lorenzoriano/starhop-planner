/**
 * Shared helpers for the horizon simulation harness (docs/local-horizon-design.md section 10.2): output paths,
 * a seeded random generator and value noise, camera poses, a minimal PNG encoder and a streaming YUV4MPEG2 writer.
 * Node only; not part of `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { quatNormalize, vecFromAzAlt, type Quat, type Vec3 } from '../../../client/src/lib/horizon/calibrate/quat';
import { screenAxes } from '../../../client/src/lib/horizon/calibrate/camera';

export const RAD = Math.PI / 180;
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
/** Outputs never go into the repo: scratch area of this session unless HORIZON_SIM_OUT says otherwise. */
export const OUT_ROOT = process.env.HORIZON_SIM_OUT
  ?? '/tmp/claude-1000/-home-lorenzo/a76ea45a-6288-458e-8dbf-3d4be7e47d24/scratchpad/horizon/sim';

export function outDir(name: string): string {
  const dir = path.join(OUT_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file: string, data: unknown) {
  fs.writeFileSync(file, JSON.stringify(data, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(5)) : v), 1));
}

/** `--key value` / `--flag` arguments. */
export function args(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = 'true';
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}

// ───────────────────────────── randomness ─────────────────────────────

/** mulberry32: small, fast, deterministic. */
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

export function gaussian(r: () => number): number {
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Hash of integer lattice coordinates → [0, 1). */
function hash3(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2-D value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash3(x0, y0, seed), b = hash3(x0 + 1, y0, seed), c = hash3(x0, y0 + 1, seed), d = hash3(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Fractal noise (octaves of value noise), roughly [0, 1). */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ───────────────────────────── poses ─────────────────────────────

/** Quaternion [x, y, z, w] of a 3×3 rotation matrix given by rows. */
export function quatFromMatrix(m: number[][]): Quat {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s; x = 0.25 * s; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = 0.25 * s; z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = 0.25 * s;
  }
  const q = quatNormalize([x, y, z, w]);
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

/** Rows of the rotation matrix of a unit quaternion (device → world). */
export function matrixFromQuat(q: Quat): number[][] {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Device orientation (device → world) for a camera pointing at (az, alt) with the image turned by `rollDeg`
 * (cameraPointing's sign: positive = image turned clockwise as seen by the user), for a screen orientation angle.
 */
export function poseQuat(azDeg: number, altDeg: number, rollDeg: number, screenAngle: number): Quat {
  const f = vecFromAzAlt(azDeg, altDeg);
  const a = azDeg * RAD;
  let r: Vec3 = [Math.cos(a), -Math.sin(a), 0];
  let u = cross(r, f);
  // Turn the image clockwise by roll about the viewing axis: right dips, up leans right.
  const c = Math.cos(rollDeg * RAD), s = Math.sin(rollDeg * RAD);
  const r2: Vec3 = [r[0] * c - u[0] * s, r[1] * c - u[1] * s, r[2] * c - u[2] * s];
  const u2: Vec3 = [u[0] * c + r[0] * s, u[1] * c + r[1] * s, u[2] * c + r[2] * s];
  r = r2; u = u2;
  const { right, up, forward } = screenAxes(screenAngle);
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const fb: Vec3 = [-f[0], -f[1], -f[2]];
  // R = W · Dᵀ with D = [right up back] (device) and W = [r u −f] (world), as columns.
  const m: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] = r[i] * right[j] + u[i] * up[j] + fb[i] * back[j];
  return quatFromMatrix(m);
}

// ───────────────────────────── images ─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG from 8-bit RGB (channels 3) or RGBA (channels 4) pixels. No colour profile chunks (Terrarium tiles need none). */
export function encodePng(width: number, height: number, pixels: Uint8Array | Uint8ClampedArray, channels: 3 | 4, level = 6): Buffer {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Streaming YUV4MPEG2 4:2:0 writer (BT.601 limited range, which Chrome assumes for untagged I420). */
export class Y4mWriter {
  private fd: number;
  private y: Uint8Array;
  private u: Uint8Array;
  private v: Uint8Array;
  frames = 0;
  constructor(file: string, readonly width: number, readonly height: number, fps: number) {
    if (width % 2 || height % 2) throw new Error('Y4M 4:2:0 needs even sizes');
    this.fd = fs.openSync(file, 'w');
    fs.writeSync(this.fd, `YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`);
    this.y = new Uint8Array(width * height);
    this.u = new Uint8Array((width / 2) * (height / 2));
    this.v = new Uint8Array((width / 2) * (height / 2));
  }
  /** Append one RGB frame (3 bytes per pixel). */
  write(rgb: Uint8Array) {
    const { width: W, height: H } = this;
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      this.y[i] = Math.round(16 + 0.257 * rgb[j] + 0.504 * rgb[j + 1] + 0.098 * rgb[j + 2]);
    }
    const W2 = W / 2;
    for (let cy = 0; cy < H / 2; cy++) {
      for (let cx = 0; cx < W2; cx++) {
        let r = 0, g = 0, b = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const j = ((cy * 2 + dy) * W + cx * 2 + dx) * 3;
          r += rgb[j]; g += rgb[j + 1]; b += rgb[j + 2];
        }
        r /= 4; g /= 4; b /= 4;
        this.u[cy * W2 + cx] = Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b);
        this.v[cy * W2 + cx] = Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b);
      }
    }
    fs.writeSync(this.fd, 'FRAME\n');
    fs.writeSync(this.fd, this.y);
    fs.writeSync(this.fd, this.u);
    fs.writeSync(this.fd, this.v);
    this.frames++;
  }
  close() {
    fs.closeSync(this.fd);
  }
}

// ───────────────────────────── frame barcode ─────────────────────────────

/** Barcode strip at the bottom of every video frame (cropped off before the app sees the image). */
export const BARCODE = {
  height: 12,
  cells: 32,
  /** Payload bits after the two sync cells (white, black). */
  bits: 20,
  /** Checksum bits (sum of set payload bits, mod 16). */
  check: 4,
} as const;

/** Cell values (0/1) for a frame number: [1, 0, payload MSB first, checksum], padded with 0. */
export function barcodeCells(n: number): number[] {
  const bits: number[] = [];
  for (let i = BARCODE.bits - 1; i >= 0; i--) bits.push((n >> i) & 1);
  const sum = bits.reduce((a, b) => a + b, 0) % 16;
  const check: number[] = [];
  for (let i = BARCODE.check - 1; i >= 0; i--) check.push((sum >> i) & 1);
  const cells = [1, 0, ...bits, ...check];
  while (cells.length < BARCODE.cells) cells.push(0);
  return cells;
}

/** Decode cell values (thresholded); null when sync or checksum fail. Mirrors the browser-side decoder in run.ts. */
export function decodeCells(cells: number[]): number | null {
  if (cells[0] !== 1 || cells[1] !== 0) return null;
  let n = 0, sum = 0, check = 0;
  for (let i = 0; i < BARCODE.bits; i++) { n = n * 2 + cells[2 + i]; sum += cells[2 + i]; }
  for (let i = 0; i < BARCODE.check; i++) check = check * 2 + cells[2 + BARCODE.bits + i];
  return sum % 16 === check ? n : null;
}
