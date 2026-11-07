/**
 * The 0.25° sky grid (photo-types.ts SkyGrid): projection of per-frame sky alpha into it, the derived photo
 * HorizonProfile, azimuth shifts, brush painting, the night finger trace and the relative skyline used for terrain
 * matching. Pure functions; grids are never mutated in place.
 *
 * Geometry: column i is centred on azimuth i·step (like HorizonProfile bins); row r spans altitudes
 * [altMax − (r+1)·step, altMax − r·step], so row 0 is the top.
 */
import type { CameraIntrinsics, CameraPose } from '../calibrate/camera';
import { GRID_ALT_MAX, GRID_ALT_MIN, GRID_STEP_DEG, type GrayImage, type SkyGrid } from '../photo-types';
import type { HorizonProfile } from '../types';
import { sampleFloat } from './image-ops';
import { FrameProjector } from './projector';

const RAD = Math.PI / 180;
const CLEAR = 128;
const PHOTO_PROFILE_SOURCE = 'Photo sweep';

const wrap360 = (az: number) => ((az % 360) + 360) % 360;
const round1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};

/** An all-unknown grid with the standard geometry. */
export function emptyGrid(): SkyGrid {
  const width = Math.round(360 / GRID_STEP_DEG), height = Math.round((GRID_ALT_MAX - GRID_ALT_MIN) / GRID_STEP_DEG);
  return {
    stepDeg: GRID_STEP_DEG, altMinDeg: GRID_ALT_MIN, altMaxDeg: GRID_ALT_MAX, width, height,
    alpha: new Uint8Array(width * height), known: new Uint8Array(width * height),
  };
}

const cloneGrid = (g: SkyGrid): SkyGrid => ({ ...g, alpha: g.alpha.slice(), known: g.known.slice() });

/** Pixels ignored at each frame edge (vignetting, stabilisation crop, resampling). */
const EDGE_MARGIN_PX = 2;

/** A disc of directions (same azimuth frame as the poses) whose pixels a frame must not contribute, e.g. Sun glare. */
export interface ExcludedDisc {
  az: number;
  alt: number;
  radiusDeg: number;
}

/**
 * Project per-frame sky alpha (frame pixels) into the grid. Each cell centre is sampled bilinearly in every frame
 * that sees it; frames are blended with a cosine feather that favours the frame centre. known = 255 where at least
 * one frame covered the cell. A frame's optional `exclude` discs carry no weight: a cell no other frame sees there
 * stays unknown.
 */
export function projectToGrid(frames: Array<{ alpha: GrayImage; pose: CameraPose; cam: CameraIntrinsics; exclude?: readonly ExcludedDisc[] }>): SkyGrid {
  const grid = emptyGrid();
  const { width: W, height: H, stepDeg: step } = grid;
  const projectors = frames.map((f) => new FrameProjector(f.pose, f.cam));
  // Excluded discs as [x, y, z, cos(radius)] per frame (world unit vectors, x east, y north, z up).
  const discs = frames.map((f) => (f.exclude ?? []).map((d) => {
    const a = d.az * RAD, h = d.alt * RAD;
    return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h), Math.cos(d.radiusDeg * RAD)];
  }));
  const excluded = (k: number, dx: number, dy: number, dz: number) => {
    for (const [x, y, z, c] of discs[k]) if (dx * x + dy * y + dz * z > c) return true;
    return false;
  };
  const active = new Int32Array(frames.length);
  const sinAz = new Float64Array(W), cosAz = new Float64Array(W);
  for (let c = 0; c < W; c++) {
    sinAz[c] = Math.sin(c * step * RAD);
    cosAz[c] = Math.cos(c * step * RAD);
  }
  for (let r = 0; r < H; r++) {
    const alt = (grid.altMaxDeg - (r + 0.5) * step) * RAD, ch = Math.cos(alt), dz = Math.sin(alt);
    let nActive = 0;
    for (let k = 0; k < projectors.length; k++) if (projectors[k].reachesAltitude(alt)) active[nActive++] = k;
    if (!nActive) continue;
    for (let c = 0; c < W; c++) {
      const dx = ch * sinAz[c], dy = ch * cosAz[c];
      let acc = 0, wsum = 0;
      for (let j = 0; j < nActive; j++) {
        const k = active[j], p = projectors[k];
        if (!p.project(dx, dy, dz)) continue;
        if (discs[k].length && excluded(k, dx, dy, dz)) continue;
        const { u, v } = p, m = EDGE_MARGIN_PX;
        if (u < m || v < m || u > p.width - m || v > p.height - m) continue;
        // Feather: 1 at the centre, falling to ~0 at the margins.
        const w = Math.sin((Math.PI * (u - m)) / (p.width - 2 * m)) * Math.sin((Math.PI * (v - m)) / (p.height - 2 * m)) + 1e-3;
        const a = frames[k].alpha;
        // Alpha may be stored at a different size than the frame: scale the pixel coordinates.
        const ax = (u * a.width) / p.width - 0.5, ay = (v * a.height) / p.height - 0.5;
        acc += w * sampleFloat(a.data, a.width, a.height, ax, ay);
        wsum += w;
      }
      if (wsum > 0) {
        const i = r * W + c;
        grid.alpha[i] = Math.round(acc / wsum);
        grid.known[i] = 255;
      }
    }
  }
  return grid;
}

// ───────────────────────────── skyline per column ─────────────────────────────

type ColumnSkyline =
  | { kind: 'measured'; alt: number }
  /** Obstructed up to the top of the covered region: the skyline is at least `alt`. */
  | { kind: 'above'; alt: number }
  /** Covered, but clear down to the bottom of the covered region. */
  | { kind: 'below' }
  | { kind: 'unknown' };

/** Vertical median window (cells) and the shortest obstructed run that counts (cells). */
const MEDIAN_HALF = 2;
const MIN_RUN = 2;
/** Fraction of the covered cells below a candidate that must be obstructed. */
const BELOW_FRACTION = 0.5;

function columnSkyline(grid: SkyGrid, c: number, scratch: { med: Float32Array; obsBelow: Int32Array; knownBelow: Int32Array }): ColumnSkyline {
  const { width: W, height: H, stepDeg: step, alpha, known } = grid;
  let top = -1, bottom = -1;
  for (let r = 0; r < H; r++) {
    if (known[r * W + c]) {
      if (top < 0) top = r;
      bottom = r;
    }
  }
  if (top < 0) return { kind: 'unknown' };
  const { med, obsBelow, knownBelow } = scratch;
  const window: number[] = [];
  for (let r = top; r <= bottom; r++) {
    window.length = 0;
    for (let k = Math.max(top, r - MEDIAN_HALF); k <= Math.min(bottom, r + MEDIAN_HALF); k++) {
      if (known[k * W + c]) window.push(alpha[k * W + c]);
    }
    window.sort((a, b) => a - b);
    med[r] = window.length ? window[window.length >> 1] : 255;
  }
  const isObs = (r: number) => r >= top && r <= bottom && known[r * W + c] !== 0 && med[r] < CLEAR;
  obsBelow[bottom + 1] = 0;
  knownBelow[bottom + 1] = 0;
  for (let r = bottom; r >= top; r--) {
    const kn = known[r * W + c] !== 0;
    knownBelow[r] = knownBelow[r + 1] + (kn ? 1 : 0);
    obsBelow[r] = obsBelow[r + 1] + (kn && med[r] < CLEAR ? 1 : 0);
  }
  for (let r = top; r <= bottom; r++) {
    if (!isObs(r) || isObs(r - 1)) continue; // only the top cell of an obstructed run
    let run = 0;
    while (isObs(r + run)) run++;
    if (run < MIN_RUN && r + run <= bottom) continue;
    if (obsBelow[r] < BELOW_FRACTION * knownBelow[r]) continue;
    const topEdge = grid.altMaxDeg - r * step;
    if (r === top || !known[(r - 1) * W + c]) return { kind: 'above', alt: topEdge };
    // Sub-cell position of the 50% crossing between the clear cell above and this one.
    const aAbove = med[r - 1], aHere = med[r];
    const frac = aAbove > aHere ? Math.min(1, Math.max(0, (CLEAR - aHere) / (aAbove - aHere))) : 0.5;
    return { kind: 'measured', alt: topEdge - step / 2 + frac * step };
  }
  return { kind: 'below' };
}

function allColumnSkylines(grid: SkyGrid): ColumnSkyline[] {
  const scratch = {
    med: new Float32Array(grid.height), obsBelow: new Int32Array(grid.height + 1), knownBelow: new Int32Array(grid.height + 1),
  };
  return Array.from({ length: grid.width }, (_, c) => columnSkyline(grid, c, scratch));
}

/**
 * The photo layer's HorizonProfile: per column, the apparent altitude of the top of the obstruction rising from the
 * bottom of the covered region (isolated wrong cells and small floating blobs are ignored). Columns never covered, or
 * clear down to the bottom of the coverage, get GRID_ALT_MIN (no constraint); a column still obstructed at the top of
 * the coverage gets the top of the covered region.
 */
export function gridToProfile(
  grid: SkyGrid,
  site: { lat: number; lon: number },
  uncertaintyDeg: number,
  computedAt: string = new Date().toISOString(),
): HorizonProfile {
  const alt = allColumnSkylines(grid).map((s) =>
    s.kind === 'measured' || s.kind === 'above' ? round1(s.alt) : GRID_ALT_MIN,
  );
  return {
    kind: 'photo',
    stepDeg: grid.stepDeg,
    alt,
    lat: site.lat,
    lon: site.lon,
    computedAt,
    source: PHOTO_PROFILE_SOURCE,
    uncertaintyDeg: Math.round(uncertaintyDeg * 100) / 100,
  };
}

/**
 * Measured skyline per azimuth (degrees, linear between columns) for terrain matching; null where the skyline was
 * not seen (never covered, clear to the bottom of the coverage, or obstructed to its top).
 */
export function relativeSkyline(grid: SkyGrid): (azDeg: number) => number | null {
  const values = allColumnSkylines(grid).map((s) => (s.kind === 'measured' ? s.alt : null));
  const n = values.length, step = grid.stepDeg;
  return (azDeg: number) => {
    const x = wrap360(azDeg) / step;
    const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
    const a = values[i0], b = values[i1];
    if (a !== null && b !== null) return a + (b - a) * f;
    if (a !== null && f <= 0.5) return a;
    if (b !== null && f >= 0.5) return b;
    return null;
  };
}

// ───────────────────────────── edits ─────────────────────────────

/** Rotate the grid in azimuth: the content at true azimuth a moves to a + deltaDeg (linear for fractional shifts). */
export function shiftGrid(grid: SkyGrid, deltaDeg: number): SkyGrid {
  const out = cloneGrid(grid);
  const { width: W, height: H } = grid;
  const s = deltaDeg / grid.stepDeg, whole = Math.floor(s), f = s - whole;
  for (let c = 0; c < W; c++) {
    // New column c samples old position c − s, between old columns c − whole − 1 and c − whole.
    const c0 = (((c - whole - 1) % W) + W) % W, c1 = (((c - whole) % W) + W) % W;
    for (let r = 0; r < H; r++) {
      const i = r * W + c, i0 = r * W + c0, i1 = r * W + c1;
      const k0 = grid.known[i0] ? 1 : 0, k1 = grid.known[i1] ? 1 : 0;
      const w0 = f * k0, w1 = (1 - f) * k1;
      const kn = f * k0 + (1 - f) * k1;
      if (kn >= 0.5) {
        out.known[i] = 255;
        out.alpha[i] = Math.round((w0 * grid.alpha[i0] + w1 * grid.alpha[i1]) / (w0 + w1));
      } else {
        out.known[i] = 0;
        out.alpha[i] = 0;
      }
    }
  }
  return out;
}

/** Visit grid cells within `radiusDeg` (angular, azimuth scaled by cos(alt)) of a stroke (points joined by segments). */
function forEachCellNearStroke(grid: SkyGrid, stroke: Array<{ az: number; alt: number }>, radiusDeg: number, visit: (i: number) => void) {
  if (!stroke.length) return;
  const { width: W, height: H, stepDeg: step } = grid;
  const pts: Array<{ az: number; alt: number }> = [];
  // Densify so consecutive stamps overlap; azimuth steps take the short way round.
  for (let k = 0; k < stroke.length; k++) {
    const p = stroke[k];
    if (k === 0) {
      pts.push(p);
      continue;
    }
    const q = stroke[k - 1];
    const dAz = ((p.az - q.az + 540) % 360) - 180, dAlt = p.alt - q.alt;
    const len = Math.hypot(dAz * Math.cos(((p.alt + q.alt) / 2) * RAD), dAlt);
    const n = Math.max(1, Math.ceil(len / Math.max(step, radiusDeg / 2)));
    for (let j = 1; j <= n; j++) pts.push({ az: q.az + (dAz * j) / n, alt: q.alt + (dAlt * j) / n });
  }
  const seen = new Uint8Array(W * H);
  for (const p of pts) {
    const r0 = Math.max(0, Math.floor((grid.altMaxDeg - p.alt - radiusDeg) / step));
    const r1 = Math.min(H - 1, Math.floor((grid.altMaxDeg - p.alt + radiusDeg) / step));
    const cosAlt = Math.max(0.05, Math.cos(p.alt * RAD));
    const azR = radiusDeg / cosAlt;
    const c0 = Math.floor((p.az - azR) / step), c1 = Math.ceil((p.az + azR) / step);
    for (let r = r0; r <= r1; r++) {
      const cellAlt = grid.altMaxDeg - (r + 0.5) * step;
      for (let cc = c0; cc <= c1; cc++) {
        const dAz = ((cc * step - p.az + 540) % 360) - 180;
        if (Math.hypot(dAz * cosAlt, cellAlt - p.alt) > radiusDeg) continue;
        const i = r * W + ((cc % W) + W) % W;
        if (seen[i]) continue;
        seen[i] = 1;
        visit(i);
      }
    }
  }
}

/** Brush fix: cells within `radiusDeg` of the stroke become clear sky (sky = true) or obstruction, and known. */
export function paintGrid(grid: SkyGrid, stroke: Array<{ az: number; alt: number }>, radiusDeg: number, sky: boolean): SkyGrid {
  const out = cloneGrid(grid);
  forEachCellNearStroke(out, stroke, radiusDeg, (i) => {
    out.alpha[i] = sky ? 255 : 0;
    out.known[i] = 255;
  });
  return out;
}

/**
 * Night: a grid from the user's finger trace of the skyline. Below the trace is obstruction, above it sky; the cell
 * the trace crosses gets its clear fraction. Only the traced azimuth range is known (or `covered`, clockwise from
 * fromAz to toAz); a trace spanning ≥ 359° covers the whole circle.
 */
export function gridFromTrace(trace: Array<{ az: number; alt: number }>, covered?: { fromAz: number; toAz: number }): SkyGrid {
  const grid = emptyGrid();
  if (trace.length === 0) return grid;
  const { width: W, height: H, stepDeg: step } = grid;
  // Unwrap the azimuths along the stroke, then order them.
  const pts: Array<{ az: number; alt: number }> = [];
  for (const p of trace) {
    if (!pts.length) pts.push({ az: wrap360(p.az), alt: p.alt });
    else {
      const prev = pts[pts.length - 1];
      pts.push({ az: prev.az + (((p.az - prev.az) % 360) + 540) % 360 - 180, alt: p.alt });
    }
  }
  pts.sort((a, b) => a.az - b.az);
  const lo = pts[0].az, hi = pts[pts.length - 1].az;
  const full = hi - lo >= 359;
  const skylineAt = (az: number): number | null => {
    // Find the unwrapped azimuth inside [lo, hi] (or the circle for a full trace).
    let x = lo + wrap360(az - lo);
    if (x > hi) {
      if (!full) return null;
      // Gap between the end and the start of a full-circle trace: interpolate across it.
      const span = lo + 360 - hi, t = span > 0 ? (x - hi) / span : 0;
      return pts[pts.length - 1].alt + (pts[0].alt - pts[pts.length - 1].alt) * t;
    }
    let j = 1;
    while (j < pts.length && pts[j].az < x) j++;
    if (j >= pts.length) return pts[pts.length - 1].alt;
    const a = pts[j - 1], b = pts[j];
    if (b.az === a.az) return Math.max(a.alt, b.alt);
    x = Math.max(a.az, Math.min(b.az, x));
    return a.alt + ((b.alt - a.alt) * (x - a.az)) / (b.az - a.az);
  };
  const inCovered = (az: number) => {
    if (!covered) return true;
    const span = wrap360(covered.toAz - covered.fromAz);
    return span === 0 || wrap360(az - covered.fromAz) <= span;
  };
  for (let c = 0; c < W; c++) {
    const az = c * step;
    if (!inCovered(az)) continue;
    const sky = skylineAt(az);
    if (sky === null) continue;
    for (let r = 0; r < H; r++) {
      const i = r * W + c, cellTop = grid.altMaxDeg - r * step;
      const clear = Math.min(1, Math.max(0, (cellTop - sky) / step));
      grid.alpha[i] = Math.round(clear * 255);
      grid.known[i] = 255;
    }
  }
  return grid;
}
