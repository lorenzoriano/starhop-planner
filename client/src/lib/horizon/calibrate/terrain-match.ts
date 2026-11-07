/**
 * Yaw fix from the terrain (docs/local-horizon-design.md, section 7, "Terrain skyline match").
 *
 * Where distant hills form the skyline, the skyline measured in the photos must line up with the terrain profile
 * computed from elevation data. Level is already known from gravity, so this is a 1-D search: shift the photo skyline
 * (relative azimuths) by a candidate offset, allow a small vertical offset for pitch bias, and score with a robust
 * (Huber, truncated) cost over azimuths where the terrain ridge is more than 2 km away. Trees and roofs in front of the
 * hills sit well above the terrain line and fall into the flat, truncated part of the cost.
 *
 * The fix is accepted only when the minimum is a clear convex bowl (fitted over ±0.5°, widened up to ±2° when sampling
 * ripple hides it) and unique, fits well (inlier residual < 0.5°) and is backed by
 * enough azimuth (≥ 60°). Flat sites (nothing to lock onto) and backyards (trees everywhere) return null. Its sigma
 * never goes below 1° (the elevation model's own accuracy).
 */
import type { YawFix } from '../photo-types';
import type { HorizonProfile } from '../types';
import { angleDiffDeg } from './quat';

/** Azimuth sampling of the terrain, degrees. */
const SAMPLE_DEG = 0.5;
/** Offset search step and the photo lookup grid, degrees. */
const STEP_DEG = 0.1;
const DEFAULT_SEARCH_DEG = 20;
/** Vertical (pitch) offset allowed between photo and terrain, degrees, and its step. */
const V_MAX = 1;
const V_STEP = 0.1;
/** Only ridges farther than this are trusted (near slopes suffer from DEM resolution and observer height). */
const MIN_RIDGE_KM = 2;
/** Huber threshold and truncation ("close to the terrain"), degrees. */
const HUBER_DEG = 0.3;
const GATE_DEG = 2.5;
/** A sample counts as matching the terrain within this, degrees. */
const INLIER_DEG = 1;
const MAX_RESIDUAL_DEG = 0.5;
const MIN_COVERAGE_DEG = 60;
/** Skyline errors are correlated over a few degrees: samples per independent measurement. */
const CORRELATION_DEG = 5;
/**
 * Reported sigma is clamped to [1°, 3°]. The floor is not the fit's precision (often 0.1–0.3° on clean hills) but the
 * terrain model's: elevation data and the observer's height agree with the real skyline only to about 0.15–0.7°
 * (design section 6), and a near-perfect fit cannot be better than the map it fits. So a centred Sun or Moon (≈0.5°)
 * wins over the hills, which stay the best automatic fix.
 */
const SIGMA_MIN = 1;
const SIGMA_MAX = 3;
/** Half-widths (in offset steps) of the parabola fits around the minimum, narrowest first: ±0.5°, ±1°, ±1.5°, ±2°. */
const FIT_HALF_STEPS = [5, 10, 15, 20] as const;

function huber(r: number): number {
  const a = Math.min(Math.abs(r), GATE_DEG);
  return a <= HUBER_DEG ? 0.5 * a * a : HUBER_DEG * (a - 0.5 * HUBER_DEG);
}

/**
 * Least-squares parabola cost(x) − cost(kBest) ≈ a·x² + b·x + c over kBest ± halfSteps (x in degrees); null when
 * singular. Offsets outside a non-circular search window are skipped.
 */
function fitParabola(cost: Float64Array, kBest: number, halfSteps: number, count: number, circular: boolean): { a: number; b: number } | null {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let d = -halfSteps; d <= halfSteps; d++) {
    const k = circular ? (kBest + d + count) % count : kBest + d;
    if (k < 0 || k >= count || !Number.isFinite(cost[k])) continue;
    const x = d * STEP_DEG, y = cost[k] - cost[kBest];
    s0++;
    s1 += x;
    s2 += x * x;
    s3 += x * x * x;
    s4 += x * x * x * x;
    t0 += y;
    t1 += x * y;
    t2 += x * x * y;
  }
  // Solve [s4 s3 s2; s3 s2 s1; s2 s1 s0]·[a b c] = [t2 t1 t0].
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det3([s4, s3, s2, s3, s2, s1, s2, s1, s0]);
  if (!(Math.abs(D) > 1e-12)) return null;
  return { a: det3([t2, s3, s2, t1, s2, s1, t0, s1, s0]) / D, b: det3([s4, t2, s2, s3, t1, s1, s2, t0, s0]) / D };
}

/** Terrain altitude (linear) and ridge distance (the nearer of the two neighbouring bins) at an azimuth. */
function terrainAt(p: HorizonProfile, az: number): { alt: number; km: number } {
  const n = p.alt.length, step = 360 / n;
  const x = (((az % 360) + 360) % 360) / step;
  const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
  const alt = p.alt[i0] * (1 - f) + p.alt[i1] * f;
  const km = p.distanceKm ? Math.min(p.distanceKm[i0], p.distanceKm[i1]) : Infinity;
  return { alt, km };
}

/**
 * Offset (trueAz = relAz + offset) that lines the photo skyline up with the terrain, searched over seed ± searchDeg
 * (default 20°; 180 searches the whole circle) in 0.1° steps. `photoSkyline(relAz)` is the measured apparent skyline
 * altitude, null where unknown.
 */
export function terrainMatchFix(
  photoSkyline: (relAzDeg: number) => number | null,
  terrain: HorizonProfile,
  seedOffsetDeg: number,
  opts: { searchDeg?: number } = {},
): YawFix | null {
  if (!terrain || !Array.isArray(terrain.alt) || terrain.alt.length < 8 || !Number.isFinite(seedOffsetDeg)) return null;
  const search = Math.max(1, Math.min(180, opts.searchDeg ?? DEFAULT_SEARCH_DEG));
  // ±180° (no usable compass) covers the whole circle: no window edges, distances wrap.

  // Usable terrain samples: distant ridges only.
  const azs: number[] = [], terr: number[] = [];
  for (let az = 0; az < 360 - 1e-9; az += SAMPLE_DEG) {
    const t = terrainAt(terrain, az);
    if (t.km > MIN_RIDGE_KM && Number.isFinite(t.alt)) {
      azs.push(az);
      terr.push(t.alt);
    }
  }
  if (azs.length * SAMPLE_DEG < MIN_COVERAGE_DEG) return null;

  // Photo skyline on a 0.1° grid of relative azimuth (NaN where unknown).
  const gridN = Math.round(360 / STEP_DEG);
  const photo = new Float64Array(gridN);
  for (let j = 0; j < gridN; j++) {
    const v = photoSkyline(j * STEP_DEG);
    photo[j] = v === null || !Number.isFinite(v) ? NaN : v;
  }

  // Offsets on the same 0.1° lattice, so trueAz − offset lands exactly on the photo grid.
  const start = Math.round((seedOffsetDeg - search) / STEP_DEG);
  const circular = Math.round((2 * search) / STEP_DEG) >= gridN;
  const count = circular ? gridN : Math.round((2 * search) / STEP_DEG) + 1;
  const kDist = (a: number, b: number) => (circular ? Math.min(Math.abs(a - b), count - Math.abs(a - b)) : Math.abs(a - b));
  const vCount = Math.round((2 * V_MAX) / V_STEP) + 1;
  const sampleIdx = azs.map((az) => Math.round(az / STEP_DEG));
  const cost = new Float64Array(count), bestV = new Float64Array(count), known = new Int32Array(count);
  const res = new Float64Array(azs.length);
  for (let k = 0; k < count; k++) {
    const o = start + k;
    let n = 0;
    for (let i = 0; i < azs.length; i++) {
      const j = (((sampleIdx[i] - o) % gridN) + gridN) % gridN;
      const p = photo[j];
      if (Number.isNaN(p)) continue;
      res[n++] = p - terr[i];
    }
    known[k] = n;
    let best = Infinity, bv = 0;
    for (let vi = 0; vi < vCount; vi++) {
      const v = -V_MAX + vi * V_STEP;
      let s = 0;
      for (let i = 0; i < n; i++) s += huber(res[i] - v);
      if (s < best) {
        best = s;
        bv = v;
      }
    }
    // Unknown photo samples cost as much as outliers, so gaps never look attractive.
    cost[k] = n ? best + (azs.length - n) * huber(GATE_DEG) : Infinity;
    bestV[k] = bv;
  }

  let kBest = 0;
  for (let k = 1; k < count; k++) if (cost[k] < cost[kBest]) kBest = k;
  const edge = Math.round(1 / STEP_DEG);
  if (!Number.isFinite(cost[kBest]) || (!circular && (kBest < edge || kBest > count - 1 - edge))) return null;

  // Fit quality at the best offset: inliers, their residual after the vertical offset, and the azimuth they cover.
  const oBest = (start + kBest) * STEP_DEG, v = bestV[kBest];
  let inliers = 0, sq = 0;
  for (let i = 0; i < azs.length; i++) {
    const j = (((sampleIdx[i] - (start + kBest)) % gridN) + gridN) % gridN;
    if (Number.isNaN(photo[j])) continue;
    const r = photo[j] - terr[i] - v;
    if (Math.abs(r) <= INLIER_DEG) {
      inliers++;
      sq += r * r;
    }
  }
  const coverage = inliers * SAMPLE_DEG;
  const rms = inliers ? Math.sqrt(sq / inliers) : Infinity;
  if (coverage < MIN_COVERAGE_DEG || rms >= MAX_RESIDUAL_DEG) return null;

  // Curvature of the cost near the minimum and the sub-step vertex: a least-squares parabola over ±0.5°. Sampling the
  // terrain every 0.5° against a 0.1° offset lattice puts a ripple of a few cost units on the bowl, so a clear minimum
  // can look flat or even concave over ±0.5°; then the window widens (±1°, ±1.5°, ±2°) until the bowl shows. A cost
  // that is still not convex over ±2° has no usable minimum.
  let fit: { a: number; b: number; halfDeg: number } | null = null;
  for (const halfSteps of FIT_HALF_STEPS) {
    const f = fitParabola(cost, kBest, halfSteps, count, circular);
    if (f && f.a > 0) {
      fit = { ...f, halfDeg: halfSteps * STEP_DEG };
      break;
    }
  }
  if (!fit) return null;
  const { a, b } = fit;
  // The narrow fit only refines within one step; a widened fit may move the vertex off a ripple dip, by up to half
  // its window.
  const vMax = fit.halfDeg <= FIT_HALF_STEPS[0] * STEP_DEG ? STEP_DEG : fit.halfDeg / 2;
  const vertex = Math.max(-vMax, Math.min(vMax, -b / (2 * a)));

  // Sigma: cost ≈ Σ r²/2 near the minimum, so with residual noise σr and correlated samples
  // σ_offset = σr / √(2·a·(SAMPLE/CORRELATION)).
  const sigmaR = Math.max(0.1, rms);
  const sigmaRaw = sigmaR / Math.sqrt(2 * a * (SAMPLE_DEG / CORRELATION_DEG));
  if (!(sigmaRaw <= SIGMA_MAX)) return null;

  // Unique: every offset more than 2° away must cost clearly more (≥ 3σ worth in the same likelihood units).
  let second = Infinity;
  for (let k = 0; k < count; k++) if (kDist(k, kBest) * STEP_DEG > 2) second = Math.min(second, cost[k]);
  const gain = ((second - cost[kBest]) * (SAMPLE_DEG / CORRELATION_DEG)) / (sigmaR * sigmaR);
  if (Number.isFinite(second) && gain < 4.5) return null;

  const offset = angleDiffDeg(oBest + vertex, 0);
  return {
    source: 'terrain',
    offsetDeg: Math.round(offset * 100) / 100,
    sigmaDeg: Math.round(Math.max(SIGMA_MIN, Math.min(SIGMA_MAX, sigmaRaw)) * 100) / 100,
    label: 'the hills',
  };
}
