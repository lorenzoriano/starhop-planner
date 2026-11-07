/**
 * Per-camera lens calibration kept between sweeps (docs/local-horizon-design.md, section 5.2), in localStorage under
 * `starhop-camera-calibration-v1`: one entry per camera mode (track label + delivered resolution). Every sweep refines
 * it with an inverse-variance weighted running mean; a jump of more than 3% means a different camera mode (another
 * lens, a crop, a zoom), so the new value replaces the old instead of being averaged in.
 */
import type { CameraCalibration, FovSolution } from '../photo-types';

export const CAMERA_CALIBRATION_KEY = 'starhop-camera-calibration-v1';
/** Relative change of hfov treated as a different camera mode. */
const CALIBRATION_JUMP = 0.03;
/** Averaging never claims better than this, degrees (systematic errors do not average out). */
const MIN_SIGMA_DEG = 0.05;
const MAX_CAMERAS = 20;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type Store = Record<string, CameraCalibration>;

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** Key of a camera mode, e.g. "camera2 0, facing back|1280x960". Width × height as delivered (orientation matters:
 *  the field of view is measured across the width). */
export function cameraKey(label: string, width: number, height: number): string {
  const name = (label || 'camera').trim().replace(/\s+/g, ' ').slice(0, 120);
  return `${name}|${Math.round(width)}x${Math.round(height)}`;
}

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function parseEntry(key: string, v: unknown): CameraCalibration | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (!finite(e.hfovDeg, 1, 179) || !finite(e.sigmaDeg, 0, 90) || !finite(e.pairs, 0, 1e6) || !finite(e.samples, 1, 1e6)) return null;
  if (e.k1 !== undefined && !finite(e.k1, -1, 1)) return null;
  if (typeof e.updatedAt !== 'string') return null;
  return {
    hfovDeg: e.hfovDeg,
    ...(e.k1 !== undefined ? { k1: e.k1 } : {}),
    sigmaDeg: e.sigmaDeg,
    pairs: e.pairs,
    cameraKey: key,
    samples: e.samples,
    updatedAt: e.updatedAt,
  };
}

function readStore(storage: StorageLike | undefined): Store {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CAMERA_CALIBRATION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed)) {
      const e = parseEntry(k, v);
      if (e) out[k] = e;
    }
    return out;
  } catch {
    return {};
  }
}

/** Stored calibration for a camera mode, or null. */
export function readCameraCalibration(key: string, storage: StorageLike | undefined = defaultStorage()): CameraCalibration | null {
  return readStore(storage)[key] ?? null;
}

/**
 * Fold a new sweep's solution into the stored calibration and save it (best effort: the merged value is returned even
 * when storage is unavailable or full).
 */
export function updateCameraCalibration(
  key: string,
  s: FovSolution,
  storage: StorageLike | undefined = defaultStorage(),
  now: Date = new Date(),
): CameraCalibration {
  const store = readStore(storage);
  const old = store[key];
  const sigmaNew = Math.max(MIN_SIGMA_DEG, s.sigmaDeg);
  let next: CameraCalibration;
  if (!old || Math.abs(s.hfovDeg - old.hfovDeg) / old.hfovDeg > CALIBRATION_JUMP) {
    next = { hfovDeg: s.hfovDeg, ...(s.k1 !== undefined ? { k1: s.k1 } : {}), sigmaDeg: sigmaNew, pairs: s.pairs, cameraKey: key, samples: 1, updatedAt: now.toISOString() };
  } else {
    const wOld = 1 / Math.max(MIN_SIGMA_DEG, old.sigmaDeg) ** 2, wNew = 1 / sigmaNew ** 2;
    const mean = (a: number, b: number) => (a * wOld + b * wNew) / (wOld + wNew);
    const k1 = old.k1 !== undefined && s.k1 !== undefined ? mean(old.k1, s.k1) : (s.k1 ?? old.k1);
    next = {
      hfovDeg: Math.round(mean(old.hfovDeg, s.hfovDeg) * 1000) / 1000,
      ...(k1 !== undefined ? { k1: Math.round(k1 * 10000) / 10000 } : {}),
      sigmaDeg: Math.round(Math.max(MIN_SIGMA_DEG, 1 / Math.sqrt(wOld + wNew)) * 1000) / 1000,
      pairs: old.pairs + s.pairs,
      cameraKey: key,
      samples: old.samples + 1,
      updatedAt: now.toISOString(),
    };
  }
  store[key] = next;
  // Keep the most recently updated cameras only.
  const keys = Object.keys(store).sort((a, b) => store[b].updatedAt.localeCompare(store[a].updatedAt));
  for (const k of keys.slice(MAX_CAMERAS)) delete store[k];
  if (storage) {
    try {
      storage.setItem(CAMERA_CALIBRATION_KEY, JSON.stringify(store));
    } catch {
      // Storage full or blocked: the caller still gets the merged calibration for this session.
    }
  }
  return next;
}
