/**
 * Lens self-calibration from the sweep (docs/local-horizon-design.md, section 7 and the FOV row of section 6).
 *
 * Neighbouring frames overlap and the gyro says how the phone turned between them. For a pure rotation R the image
 * motion is the homography K·R·K⁻¹, which depends on the focal length: only the right field of view lines the two
 * overlaps up. Per pair of overlapping frames we therefore warp frame B into frame A for candidate fields of view and
 * score the match by normalised cross-correlation of band-passed grey images (exposure changes cancel out; flat sky
 * contributes nothing). A coarse scan over 40–100° on small images finds the peak, a golden-section search on larger
 * images refines it, and the optional radial term k1 is solved jointly over all pairs. Pairs are combined robustly:
 * median, outliers dropped, sigma from the spread / √n.
 *
 * Pure functions on plain RGBA images, so the same code runs in a worker and in Node tests.
 */
import type { FovSolution, RgbaImage } from '../photo-types';
import { screenAxes } from './camera';
import { rotateVec, type Quat, type Vec3 } from './quat';

const RAD = Math.PI / 180;

const HFOV_MIN = 40;
const HFOV_MAX = 100;
const K1_MAX = 0.2;
/** Widths of the coarse and fine working images, pixels. */
const COARSE_WIDTH = 128;
const FINE_WIDTH = 320;
/** A pair must look apart by at least this (else the FOV barely changes the motion) and overlap. */
const MIN_PAIR_ANGLE = 8;
const MAX_PAIR_ANGLE = 85;
const MAX_PAIRS = 16;
/** Lowest correlation accepted at the coarse peak. */
const MIN_NCC = 0.3;

export interface FovFrame {
  image: RgbaImage;
  q: Quat;
  screenAngle: number;
}

/** Band-passed grey image (float), the working form of a frame. */
interface Level {
  w: number;
  h: number;
  data: Float32Array;
}

// ───────────────────────────── image preparation ─────────────────────────────

/** Area-averaged grey image of the given width. */
function downscaleGray(img: RgbaImage, width: number): Level {
  const w = Math.max(8, Math.min(width, img.width));
  const h = Math.max(6, Math.round((img.height * w) / img.width));
  const sx = img.width / w, sy = img.height / h;
  const out = new Float32Array(w * h);
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) {
        let k = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, k += 4) sum += 0.299 * src[k] + 0.587 * src[k + 1] + 0.114 * src[k + 2];
      }
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { w, h, data: out };
}

/** Box mean of radius r (clamped at the borders) via an integral image. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const s = integral[yb * W + xb] - integral[ya * W + xb] - integral[yb * W + xa] + integral[ya * W + xa];
      out[y * w + x] = s / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}

/** Grey, lightly smoothed, minus a wide local mean: keeps texture, removes sky gradients and exposure differences. */
function bandPass(img: RgbaImage, width: number): Level {
  const g = downscaleGray(img, width);
  const fine = boxBlur(g.data, g.w, g.h, 1);
  const coarse = boxBlur(g.data, g.w, g.h, Math.max(3, Math.round(g.w / 40)));
  for (let i = 0; i < fine.length; i++) fine[i] -= coarse[i];
  return { w: g.w, h: g.h, data: fine };
}

// ───────────────────────────── pair geometry ─────────────────────────────

/** Camera axes (right, up, forward) in WORLD coordinates. */
function cameraAxesWorld(q: Quat, screenAngle: number): [Vec3, Vec3, Vec3] {
  const { right, up, forward } = screenAxes(screenAngle);
  return [rotateVec(q, right), rotateVec(q, up), rotateVec(q, forward)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Pair {
  /** Camera-A coordinates (x right, y up, z forward) → camera-B coordinates, row-major 3×3. */
  m: Float64Array;
  angleDeg: number;
  a: number;
  b: number;
  /** Fine-level pixel indices of A worth sampling (inside the predicted overlap), set after the coarse scan. */
  overlap?: Int32Array;
  coarseHfov?: number;
  hfov?: number;
  score?: number;
}

function pairMatrix(a: FovFrame, b: FovFrame): { m: Float64Array; angleDeg: number } {
  const A = cameraAxesWorld(a.q, a.screenAngle), B = cameraAxesWorld(b.q, b.screenAngle);
  const m = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = dot(B[i], A[j]);
  const c = Math.max(-1, Math.min(1, dot(A[2], B[2])));
  return { m, angleDeg: Math.acos(c) / RAD };
}

// ───────────────────────────── scoring ─────────────────────────────

/** r_u / r_d for a distorted radius² r_d²: r·(1 + k1·r²) = r_d (series inversion plus two Newton steps; ≤ 1e-4 for
 *  |k1| ≤ 0.2 within the frame). */
function undistortScale(rd2: number, k1: number): number {
  const a = k1 * rd2;
  let s = 1 - a + 3 * a * a - 12 * a * a * a;
  if (!(s > 0.5 && s < 1.5)) s = 1;
  for (let i = 0; i < 2; i++) {
    const r2 = s * s * rd2;
    s -= (s * (1 + k1 * r2) - 1) / (1 + 3 * k1 * r2);
  }
  return s;
}

/**
 * Normalised cross-correlation between A and B warped into A, for one field of view and k1. Samples are A's pixels
 * (all of them, or `indices`) whose ray lands inside B. Returns −1 when the overlap is too small to judge.
 */
function pairNcc(la: Level, lb: Level, m: Float64Array, hfovDeg: number, k1: number, indices?: Int32Array, minSamples = 0): { ncc: number; n: number } {
  const { w, h } = la;
  const f = w / 2 / Math.tan((hfovDeg * RAD) / 2);
  const cx = w / 2, cy = h / 2;
  const a = la.data, b = lb.data;
  const maxU = lb.w - 1.001, maxV = lb.h - 1.001;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const count = indices ? indices.length : w * h;
  for (let t = 0; t < count; t++) {
    const idx = indices ? indices[t] : t;
    const py = (idx / w) | 0, px = idx - py * w;
    let x = (px + 0.5 - cx) / f, y = (cy - py - 0.5) / f;
    if (k1) {
      const s = undistortScale(x * x + y * y, k1);
      x *= s;
      y *= s;
    }
    const z = m[6] * x + m[7] * y + m[8];
    if (z <= 1e-6) continue;
    let xb = (m[0] * x + m[1] * y + m[2]) / z, yb = (m[3] * x + m[4] * y + m[5]) / z;
    if (k1) {
      const d = 1 + k1 * (xb * xb + yb * yb);
      xb *= d;
      yb *= d;
    }
    const u = cx + xb * f - 0.5, v = cy - yb * f - 0.5;
    if (!(u >= 0 && v >= 0 && u < maxU && v < maxV)) continue;
    const u0 = u | 0, v0 = v | 0, fu = u - u0, fv = v - v0;
    const k = v0 * lb.w + u0;
    const top = b[k] + (b[k + 1] - b[k]) * fu;
    const bottom = b[k + lb.w] + (b[k + lb.w + 1] - b[k + lb.w]) * fu;
    const vb = top + (bottom - top) * fv, va = a[idx];
    n++;
    sa += va;
    sb += vb;
    saa += va * va;
    sbb += vb * vb;
    sab += va * vb;
  }
  if (n < Math.max(64, minSamples)) return { ncc: -1, n };
  const cov = n * sab - sa * sb, varA = n * saa - sa * sa, varB = n * sbb - sb * sb;
  if (varA <= 1e-9 || varB <= 1e-9) return { ncc: -1, n };
  return { ncc: cov / Math.sqrt(varA * varB), n };
}

/** Maximise a unimodal function on [lo, hi] by golden-section search. */
function goldenMax(fn: (x: number) => number, lo: number, hi: number, tol: number): { x: number; value: number } {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = fn(c), fd = fn(d);
  while (b - a > tol) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = fn(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = fn(d);
    }
  }
  return fc > fd ? { x: c, value: fc } : { x: d, value: fd };
}

/** A's fine-level pixels that land inside B (with a margin) for fields of view near `hfov`. */
function overlapIndices(la: Level, m: Float64Array, hfovDeg: number): Int32Array {
  const { w, h } = la;
  const out: number[] = [];
  const marginX = 0.08 * w, marginY = 0.08 * h;
  for (const scale of [0.96, 1.04]) {
    const f = w / 2 / Math.tan((hfovDeg * scale * RAD) / 2);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // Generous: undistorted model, B expanded by a margin.
        const x = (px + 0.5 - w / 2) / f, y = (h / 2 - py - 0.5) / f;
        const z = m[6] * x + m[7] * y + m[8];
        if (z <= 1e-6) continue;
        const u = w / 2 + ((m[0] * x + m[1] * y + m[2]) / z) * f, v = h / 2 - ((m[3] * x + m[4] * y + m[5]) / z) * f;
        if (u >= -marginX && v >= -marginY && u <= w + marginX && v <= h + marginY) out.push(py * w + px);
      }
    }
  }
  return Int32Array.from(new Set(out)).sort();
}

// ───────────────────────────── solver ─────────────────────────────

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Horizontal field of view (and optionally k1) of the camera from overlapping frames of one sweep. `guess` gives the
 * camera mode (its hfov is only used to pick overlapping pairs); the result is for images of that aspect at any size.
 * Null when fewer than two pairs overlap with enough texture to be judged.
 */
export function solveFov(
  frames: Array<{ image: RgbaImage; q: Quat; screenAngle: number }>,
  guess: { width: number; height: number; hfovDeg: number },
  opts: { solveK1?: boolean } = {},
): FovSolution | null {
  // Same image size and orientation within a sweep (a rotated frame has a different hfov across its width).
  const first = frames[0];
  if (!first) return null;
  const usable = frames.filter((f) => f.image.width === first.image.width && f.image.height === first.image.height && f.screenAngle === first.screenAngle);
  if (usable.length < 2) return null;

  // Candidate pairs: views apart enough to measure, close enough to overlap; the closest MAX_PAIRS.
  const reach = Math.min(MAX_PAIR_ANGLE, Math.max(30, 0.95 * Math.min(HFOV_MAX, guess.hfovDeg * 1.25)));
  let pairs: Pair[] = [];
  for (let a = 0; a < usable.length; a++) {
    for (let b = a + 1; b < usable.length; b++) {
      const { m, angleDeg } = pairMatrix(usable[a], usable[b]);
      if (angleDeg >= MIN_PAIR_ANGLE && angleDeg <= reach) pairs.push({ m, angleDeg, a, b });
    }
  }
  if (!pairs.length) return null;
  pairs.sort((p, q) => p.angleDeg - q.angleDeg);
  pairs = pairs.slice(0, MAX_PAIRS);

  const needed = Array.from(new Set(pairs.flatMap((p) => [p.a, p.b])));
  const coarse = new Map<number, Level>(), fine = new Map<number, Level>();
  for (const i of needed) {
    coarse.set(i, bandPass(usable[i].image, COARSE_WIDTH));
    fine.set(i, bandPass(usable[i].image, FINE_WIDTH));
  }

  // 1. Coarse scan per pair (k1 = 0): the best-correlating field of view, if it is a clear interior peak.
  const kept: Pair[] = [];
  for (const p of pairs) {
    const la = coarse.get(p.a)!, lb = coarse.get(p.b)!;
    const minSamples = 0.04 * la.w * la.h;
    let best = -Infinity, bestH = NaN;
    for (let hf = HFOV_MIN; hf <= HFOV_MAX + 1e-9; hf += 1) {
      const { ncc } = pairNcc(la, lb, p.m, hf, 0, undefined, minSamples);
      if (ncc > best) {
        best = ncc;
        bestH = hf;
      }
    }
    if (best < MIN_NCC || bestH <= HFOV_MIN || bestH >= HFOV_MAX) continue;
    p.coarseHfov = bestH;
    p.overlap = overlapIndices(fine.get(p.a)!, p.m, bestH);
    kept.push(p);
  }
  if (kept.length < 2) return null;

  // 2. Fine refinement per pair at a given k1.
  const refinePairs = (list: Pair[], k1: number, centre: (p: Pair) => number, half: number) => {
    for (const p of list) {
      const la = fine.get(p.a)!, lb = fine.get(p.b)!;
      const c = centre(p);
      const r = goldenMax((hf) => pairNcc(la, lb, p.m, hf, k1, p.overlap).ncc, Math.max(HFOV_MIN, c - half), Math.min(HFOV_MAX, c + half), 0.01);
      p.hfov = r.x;
      p.score = r.value;
    }
  };
  refinePairs(kept, 0, (p) => p.coarseHfov!, 2);

  // Drop pairs that disagree wildly with the rest (repetitive texture, moving branches, a bad gyro reading).
  const robust = (list: Pair[]) => {
    const values = list.map((p) => p.hfov!);
    const med = median(values);
    const mad = 1.4826 * median(values.map((v) => Math.abs(v - med)));
    return list.filter((p) => Math.abs(p.hfov! - med) <= Math.max(3 * mad, 0.015 * med));
  };
  let good = robust(kept.filter((p) => (p.score ?? -1) >= MIN_NCC));
  if (good.length < 2) return null;

  // 3. Optional k1, solved jointly over all good pairs (on the mean correlation).
  let k1 = 0;
  if (opts.solveK1) {
    let hf = median(good.map((p) => p.hfov!));
    // Every other row and column of the overlap is plenty for the joint search (the final per-pair pass uses all).
    const sparse = new Map(good.map((p) => {
      const w = fine.get(p.a)!.w;
      return [p, p.overlap!.filter((i) => ((i / w) | 0) % 2 === 0 && (i % w) % 2 === 0)] as const;
    }));
    const total = (h: number, k: number) => {
      let s = 0;
      for (const p of good) s += pairNcc(fine.get(p.a)!, fine.get(p.b)!, p.m, h, k, sparse.get(p)).ncc;
      return s / good.length;
    };
    // In a narrow overlap strip k1 and the focal length trade off along a valley (more barrel ≈ a narrower FOV), so
    // search along the valley direction, measured locally, rather than one parameter at a time.
    hf = goldenMax((h) => total(h, 0), hf - 1, hf + 1, 0.01).x;
    let step = 0.05, span = K1_MAX;
    for (let round = 0; round < 2; round++) {
      const hStep = goldenMax((h) => total(h, k1 + step), hf - 2.5, hf + 2.5, 0.01).x;
      const slope = (hStep - hf) / step;
      const base = { h: hf, k: k1 };
      const t = goldenMax((dk) => total(base.h + slope * dk, base.k + dk), Math.max(-K1_MAX, base.k - span) - base.k, Math.min(K1_MAX, base.k + span) - base.k, 0.001).x;
      k1 = base.k + t;
      hf = goldenMax((h) => total(h, k1), base.h + slope * t - 0.5, base.h + slope * t + 0.5, 0.01).x;
      step = 0.02;
      span = 0.03;
    }
    refinePairs(good, k1, () => hf, 1);
    good = robust(good);
    if (good.length < 2) return null;
  }

  const values = good.map((p) => p.hfov!);
  const hfovDeg = median(values);
  const spread = 1.4826 * median(values.map((v) => Math.abs(v - hfovDeg)));
  // Median of n values: σ ≈ 1.25·s/√n. Floors: 0.1% of the FOV, and 1% with only a couple of pairs.
  let sigmaDeg = Math.max((1.2533 * spread) / Math.sqrt(values.length), 0.001 * hfovDeg);
  if (values.length < 3) sigmaDeg = Math.max(sigmaDeg, 0.01 * hfovDeg);
  return {
    hfovDeg: Math.round(hfovDeg * 1000) / 1000,
    ...(opts.solveK1 ? { k1: Math.round(k1 * 10000) / 10000 } : {}),
    sigmaDeg: Math.round(sigmaDeg * 1000) / 1000,
    pairs: good.length,
  };
}
