import { describe, expect, it } from 'vitest';
import { solveFov } from '../horizon/calibrate/fov';
import { cameraPointing } from '../horizon/calibrate/camera';
import { quatFromAxisAngle, quatMultiply, type Quat } from '../horizon/calibrate/quat';
import type { RgbaImage } from '../horizon/photo-types';
import { poseFor, renderFrame, rng, texturedWorld, type World } from './horizon-calibrate-synth';

let world: World | null = null;
const getWorld = () => (world ??= texturedWorld(3));

interface SweepOpts {
  width?: number;
  height?: number;
  screenAngle?: number;
  pitch?: number;
  count?: number;
  stepDeg?: number;
  /** One-sigma gyro error per frame, degrees (random small rotation applied to the reported pose only). */
  gyroNoiseDeg?: number;
  ring1?: boolean;
}

function sweep(hfovDeg: number, k1: number, o: SweepOpts = {}) {
  const screenAngle = o.screenAngle ?? 90;
  const cam = { width: o.width ?? 1280, height: o.height ?? 960, hfovDeg, k1 };
  const r = rng(99);
  const poses: Array<{ az: number; alt: number }> = [];
  const count = o.count ?? 8, step = o.stepDeg ?? 360 / count;
  for (let i = 0; i < count; i++) poses.push({ az: 10 + step * i, alt: o.pitch ?? 18 });
  if (o.ring1) for (let i = 0; i < 6; i++) poses.push({ az: 30 + 60 * i, alt: 55 });
  return poses.map(({ az, alt }, i) => {
    const q = poseFor(az, alt, 0, screenAngle);
    const image = renderFrame(getWorld(), q, screenAngle, cam, { gain: 1 + 0.1 * Math.sin(i), offset: 5 * Math.cos(i), noise: 2, seed: i });
    let reported: Quat = q;
    if (o.gyroNoiseDeg) {
      const axis: [number, number, number] = [r() - 0.5, r() - 0.5, r() - 0.5];
      reported = quatMultiply(quatFromAxisAngle(axis, o.gyroNoiseDeg * (r() * 2 - 1) * 1.7), q);
    }
    return { image, q: reported, screenAngle };
  });
}

const relErr = (v: number, truth: number) => Math.abs(v - truth) / truth;

describe('solveFov: lens self-calibration from overlapping frames', () => {
  it('the synthetic poses point where intended', () => {
    const p = cameraPointing({ q: poseFor(100, 18), screenAngle: 90 });
    expect(p.az).toBeCloseTo(100, 6);
    expect(p.alt).toBeCloseTo(18, 6);
    expect(p.roll).toBeCloseTo(0, 6);
  });

  it('recovers hfov within 1% and k1 within 0.02 from an 8-frame 1280×960 sweep, quickly', () => {
    const frames = sweep(63.4, -0.08);
    const t0 = performance.now();
    const s = solveFov(frames, { width: 1280, height: 960, hfovDeg: 60 }, { solveK1: true });
    const ms = performance.now() - t0;
    expect(s).not.toBeNull();
    expect(relErr(s!.hfovDeg, 63.4)).toBeLessThan(0.01);
    expect(Math.abs(s!.k1! - -0.08)).toBeLessThan(0.02);
    expect(s!.pairs).toBe(8);
    expect(s!.sigmaDeg).toBeGreaterThan(0);
    expect(s!.sigmaDeg).toBeLessThan(0.5);
    expect(ms).toBeLessThan(5000); // ≈ 0.5 s on a desktop when run alone; generous for a loaded CI machine
  }, 60000);

  it('without k1: no k1 in the answer, hfov still found from a wrong guess', () => {
    const frames = sweep(63.4, 0, { width: 640, height: 480 });
    const s = solveFov(frames, { width: 640, height: 480, hfovDeg: 75 });
    expect(s).not.toBeNull();
    expect(s!.k1).toBeUndefined();
    expect(relErr(s!.hfovDeg, 63.4)).toBeLessThan(0.01);
  }, 30000);

  it('pincushion lens and a wider camera', () => {
    const frames = sweep(74, 0.05, { width: 640, height: 480, count: 7 });
    const s = solveFov(frames, { width: 640, height: 480, hfovDeg: 65 }, { solveK1: true });
    expect(s).not.toBeNull();
    expect(relErr(s!.hfovDeg, 74)).toBeLessThan(0.01);
    expect(Math.abs(s!.k1! - 0.05)).toBeLessThan(0.02);
  }, 30000);

  it('a distortion-free lens solves to k1 ≈ 0', () => {
    const frames = sweep(58, 0, { width: 640, height: 480, count: 9 });
    const s = solveFov(frames, { width: 640, height: 480, hfovDeg: 60 }, { solveK1: true });
    expect(relErr(s!.hfovDeg, 58)).toBeLessThan(0.01);
    expect(Math.abs(s!.k1!)).toBeLessThan(0.02);
  }, 30000);

  it('portrait frames (screen angle 0) and a second ring', () => {
    const frames = sweep(48, 0, { width: 480, height: 640, screenAngle: 0, count: 10, pitch: 20, ring1: true });
    const s = solveFov(frames, { width: 480, height: 640, hfovDeg: 50 });
    expect(s).not.toBeNull();
    expect(relErr(s!.hfovDeg, 48)).toBeLessThan(0.01);
    expect(s!.pairs).toBeGreaterThan(10);
  }, 30000);

  it('tolerates realistic gyro noise (0.15° per frame) to about 1%', () => {
    const frames = sweep(63.4, 0, { width: 640, height: 480, gyroNoiseDeg: 0.15 });
    const s = solveFov(frames, { width: 640, height: 480, hfovDeg: 65 });
    expect(s).not.toBeNull();
    expect(relErr(s!.hfovDeg, 63.4)).toBeLessThan(0.012);
  }, 30000);

  it('ignores a frame whose orientation is badly wrong', () => {
    const frames = sweep(63.4, 0, { width: 640, height: 480, count: 9 });
    frames[4] = { ...frames[4], q: quatMultiply(quatFromAxisAngle([0, 0, 1], 6), frames[4].q) };
    const s = solveFov(frames, { width: 640, height: 480, hfovDeg: 65 });
    expect(s).not.toBeNull();
    expect(relErr(s!.hfovDeg, 63.4)).toBeLessThan(0.01);
  }, 30000);

  it('returns null without texture, without overlap, or with too few frames', () => {
    const flat = (w: number, h: number): RgbaImage => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) });
    const frames = sweep(63.4, 0, { width: 320, height: 240 });
    expect(solveFov(frames.map((f) => ({ ...f, image: flat(320, 240) })), { width: 320, height: 240, hfovDeg: 63 })).toBeNull();
    // Three frames 120° apart never overlap.
    const apart = sweep(63.4, 0, { width: 320, height: 240, count: 3 });
    expect(solveFov(apart, { width: 320, height: 240, hfovDeg: 63 })).toBeNull();
    expect(solveFov(frames.slice(0, 1), { width: 320, height: 240, hfovDeg: 63 })).toBeNull();
    expect(solveFov([], { width: 320, height: 240, hfovDeg: 63 })).toBeNull();
  }, 30000);
});
