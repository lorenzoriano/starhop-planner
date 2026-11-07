import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_CALIBRATION_KEY, cameraKey, readCameraCalibration, updateCameraCalibration,
} from '../horizon/calibrate/calibration-store';

function storage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, v: string) => { items.set(key, v); } };
}
afterEach(() => vi.unstubAllGlobals());

const KEY = cameraKey('camera2 0, facing back', 1280, 960);
const T0 = new Date('2026-11-06T20:00:00Z');

describe('camera calibration store', () => {
  it('keys by label and delivered size', () => {
    expect(KEY).toBe('camera2 0, facing back|1280x960');
    expect(cameraKey('  camera2   0, facing back ', 960, 1280)).toBe('camera2 0, facing back|960x1280');
    expect(cameraKey('', 640, 480)).toBe('camera|640x480');
  });

  it('first sweep is stored as is; nothing stored reads null', () => {
    const s = storage();
    expect(readCameraCalibration(KEY, s)).toBeNull();
    const c = updateCameraCalibration(KEY, { hfovDeg: 63.4, k1: -0.08, sigmaDeg: 0.2, pairs: 8 }, s, T0);
    expect(c).toEqual({ hfovDeg: 63.4, k1: -0.08, sigmaDeg: 0.2, pairs: 8, cameraKey: KEY, samples: 1, updatedAt: T0.toISOString() });
    expect(readCameraCalibration(KEY, s)).toEqual(c);
    expect(JSON.parse(s.items.get(CAMERA_CALIBRATION_KEY)!)[KEY].hfovDeg).toBe(63.4);
  });

  it('later sweeps refine an inverse-variance weighted mean', () => {
    const s = storage();
    updateCameraCalibration(KEY, { hfovDeg: 63.0, sigmaDeg: 0.2, pairs: 8 }, s, T0);
    const c = updateCameraCalibration(KEY, { hfovDeg: 64.0, k1: -0.05, sigmaDeg: 0.4, pairs: 6 }, s, new Date(T0.getTime() + 1000));
    // Weights 25 and 6.25 → 63.2.
    expect(c.hfovDeg).toBeCloseTo(63.2, 6);
    expect(c.sigmaDeg).toBeCloseTo(1 / Math.sqrt(31.25), 3);
    expect(c.k1).toBe(-0.05);
    expect(c.samples).toBe(2);
    expect(c.pairs).toBe(14);
    const d = updateCameraCalibration(KEY, { hfovDeg: 63.2, k1: -0.07, sigmaDeg: 0.2, pairs: 8 }, s);
    expect(d.k1).toBeLessThan(-0.05);
    expect(d.k1).toBeGreaterThan(-0.07);
    expect(d.samples).toBe(3);
  });

  it('a jump of more than 3% replaces instead of averaging', () => {
    const s = storage();
    updateCameraCalibration(KEY, { hfovDeg: 63.0, sigmaDeg: 0.1, pairs: 8 }, s, T0);
    updateCameraCalibration(KEY, { hfovDeg: 63.5, sigmaDeg: 0.1, pairs: 8 }, s, T0);
    const c = updateCameraCalibration(KEY, { hfovDeg: 70.0, sigmaDeg: 0.3, pairs: 5 }, s, T0);
    expect(c).toMatchObject({ hfovDeg: 70, sigmaDeg: 0.3, samples: 1, pairs: 5 });
  });

  it('sigma never shrinks below a floor however many sweeps', () => {
    const s = storage();
    let c = updateCameraCalibration(KEY, { hfovDeg: 63, sigmaDeg: 0.06, pairs: 8 }, s);
    for (let i = 0; i < 20; i++) c = updateCameraCalibration(KEY, { hfovDeg: 63, sigmaDeg: 0.06, pairs: 8 }, s);
    expect(c.sigmaDeg).toBeGreaterThanOrEqual(0.05);
  });

  it('keeps cameras apart and survives corrupt or missing storage', () => {
    const s = storage();
    const other = cameraKey('camera2 2, facing back', 1280, 960);
    updateCameraCalibration(KEY, { hfovDeg: 63, sigmaDeg: 0.2, pairs: 8 }, s);
    updateCameraCalibration(other, { hfovDeg: 98, sigmaDeg: 0.5, pairs: 8 }, s);
    expect(readCameraCalibration(KEY, s)!.hfovDeg).toBe(63);
    expect(readCameraCalibration(other, s)!.hfovDeg).toBe(98);

    s.items.set(CAMERA_CALIBRATION_KEY, '{not json');
    expect(readCameraCalibration(KEY, s)).toBeNull();
    s.items.set(CAMERA_CALIBRATION_KEY, JSON.stringify({ [KEY]: { hfovDeg: 'wide' }, [other]: { hfovDeg: 98, sigmaDeg: 0.5, pairs: 8, samples: 1, updatedAt: 'x' } }));
    expect(readCameraCalibration(KEY, s)).toBeNull();
    expect(readCameraCalibration(other, s)!.hfovDeg).toBe(98);

    // No storage at all (Node): still returns the merged value.
    expect(updateCameraCalibration(KEY, { hfovDeg: 60, sigmaDeg: 0.2, pairs: 4 }, undefined).hfovDeg).toBe(60);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(updateCameraCalibration(KEY, { hfovDeg: 60, sigmaDeg: 0.2, pairs: 4 }, full).samples).toBe(1);
  });

  it('uses window.localStorage by default', () => {
    const s = storage();
    vi.stubGlobal('localStorage', s);
    updateCameraCalibration(KEY, { hfovDeg: 61, sigmaDeg: 0.2, pairs: 8 });
    expect(readCameraCalibration(KEY)!.hfovDeg).toBe(61);
  });
});
