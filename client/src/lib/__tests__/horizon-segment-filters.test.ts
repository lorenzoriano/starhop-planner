import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics } from '../horizon/calibrate/camera';
import type { GrayImage, RgbaImage } from '../horizon/photo-types';
import { classicalSky, isTooDarkToSegment, UNKNOWN_ALPHA } from '../horizon/segment/classical';
import { guidedFilter } from '../horizon/segment/guided-filter';
import { boxMean, resizeFloat } from '../horizon/segment/image-ops';
import { makeWorld, poseFor, renderFrame, skylineWorld } from './horizon-sim-helpers';

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function rgba(width: number, height: number, fn: (x: number, y: number) => readonly number[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = fn(x, y), i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('boxMean', () => {
  it('equals a brute-force clamped window mean', () => {
    const w = 23, h = 17, r = 3, rand = rng(1);
    const src = Float32Array.from({ length: w * h }, () => rand());
    const out = boxMean(src, w, h, r);
    for (const [x, y] of [[0, 0], [5, 5], [22, 16], [11, 0], [3, 14]]) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          s += src[yy * w + xx];
          n++;
        }
      }
      expect(out[y * w + x]).toBeCloseTo(s / n, 5);
    }
  });

  it('resizeFloat keeps a constant field constant', () => {
    const out = resizeFloat(new Float32Array(16 * 16).fill(0.3), 16, 16, 40, 30);
    expect(Math.max(...out)).toBeCloseTo(0.3, 6);
    expect(Math.min(...out)).toBeCloseTo(0.3, 6);
  });
});

describe('guidedFilter', () => {
  const W = 120, H = 60, EDGE = 60;

  it('preserves a sharp edge of the guide (no blur across it despite the large window)', () => {
    const rand = rng(3);
    const guide = rgba(W, H, (x) => (x < EDGE ? [20, 30, 20] : [200, 220, 250]));
    const p: GrayImage = { width: W, height: H, data: new Uint8Array(W * H) };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) p.data[y * W + x] = Math.round(Math.min(255, Math.max(0, (x < EDGE ? 20 : 235) + (rand() - 0.5) * 40)));
    }
    const q = guidedFilter(guide, p, 8, 1e-4);
    const row = 30 * W;
    expect(Math.abs(q.data[row + EDGE - 1] - 20)).toBeLessThan(12);
    expect(Math.abs(q.data[row + EDGE] - 235)).toBeLessThan(12);
  });

  it('pulls a blurry p (upsampled model output) towards the guide edge', () => {
    const guide = rgba(W, H, (x) => (x < EDGE ? [20, 30, 20] : [200, 220, 250]));
    const p: GrayImage = { width: W, height: H, data: new Uint8Array(W * H) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p.data[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, (x - EDGE + 12) / 24)));
    const q = guidedFilter(guide, p, 8, 1e-4);
    const row = 30 * W;
    const stepP = p.data[row + EDGE] - p.data[row + EDGE - 1];
    const stepQ = q.data[row + EDGE] - q.data[row + EDGE - 1];
    expect(stepQ).toBeGreaterThan(8 * stepP);
    expect(q.data[row + 5]).toBeLessThan(5);
    expect(q.data[row + W - 5]).toBeGreaterThan(250);
  });

  it('smooths noise where the guide is flat', () => {
    const rand = rng(7);
    const guide = rgba(W, H, () => [128, 128, 128]);
    const p: GrayImage = { width: W, height: H, data: Uint8Array.from({ length: W * H }, () => Math.round(128 + (rand() - 0.5) * 120)) };
    const q = guidedFilter(guide, p, 4, 1e-3);
    const sd = (d: Uint8Array) => {
      const m = d.reduce((a, b) => a + b, 0) / d.length;
      return Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
    };
    expect(sd(q.data)).toBeLessThan(sd(p.data) / 4);
    const mean = q.data.reduce((a, b) => a + b, 0) / q.data.length;
    expect(mean).toBeGreaterThan(120);
    expect(mean).toBeLessThan(136);
  });

  it('accepts p at a lower resolution than the guide', () => {
    const guide = rgba(W, H, (x) => (x < EDGE ? [0, 0, 0] : [255, 255, 255]));
    const p: GrayImage = { width: 12, height: 6, data: new Uint8Array(72).map((_, i) => (i % 12 < 6 ? 0 : 255)) };
    const q = guidedFilter(guide, p, 6, 1e-4);
    expect(q.width).toBe(W);
    expect(q.data[30 * W + 10]).toBeLessThan(10);
    expect(q.data[30 * W + 110]).toBeGreaterThan(245);
  });
});

describe('classicalSky', () => {
  const CAM: CameraIntrinsics = { width: 320, height: 240, hfovDeg: 64 };
  const skyline = (az: number) => 8 + 6 * Math.sin((az * Math.PI) / 15) + (az % 40 < 6 ? 10 : 0);

  /** Fraction of pixels whose classification (alpha ≥ 128) matches the truth, ignoring 1.5 px around the skyline. */
  function accuracy(alpha: GrayImage, pose: ReturnType<typeof poseFor>, sky: (az: number) => number): number {
    let ok = 0, n = 0;
    // Recover each pixel's az/alt by rendering a world that encodes them is overkill: use camera maths directly.
    const truth = renderFrame(makeWorld(1440, 720, (az, alt) => {
      const d = alt - sky(az);
      return [d > 0.4 ? 255 : d < -0.4 ? 0 : 128, 0, 0];
    }), pose, CAM);
    for (let i = 0; i < alpha.data.length; i++) {
      const t = truth.data[i * 4];
      if (t === 128 || (t > 0 && t < 255)) continue;
      n++;
      if ((alpha.data[i] >= 128) === (t === 255)) ok++;
    }
    return ok / n;
  }

  it('separates a blue sky from dark textured ground along an irregular skyline', () => {
    const world = skylineWorld(skyline, { width: 2880, height: 1440 });
    for (const az of [0, 100, 250]) {
      const pose = poseFor(az, 15);
      const alpha = classicalSky(renderFrame(world, pose, CAM));
      expect(accuracy(alpha, pose, skyline)).toBeGreaterThan(0.97);
    }
  });

  it('keeps bright gaps in a canopy below the border as sky, dark blobs above it as obstruction', () => {
    // Top: sky. Below row 120: dark foliage with bright holes (sky through leaves).
    const img = rgba(200, 200, (x, y) => {
      if (y < 120) return [150, 190, 240];
      const hole = (x - 100) ** 2 + (y - 160) ** 2 < 64;
      return hole ? [150, 190, 240] : [25 + ((x * 7 + y * 13) % 30), 40, 20];
    });
    const a = classicalSky(img);
    expect(a.data[60 * 200 + 50]).toBeGreaterThan(200);
    expect(a.data[160 * 200 + 100]).toBeGreaterThan(150);
    expect(a.data[160 * 200 + 40]).toBeLessThan(30);
  });

  it('night frames: too dark to segment, alpha unknown everywhere', () => {
    const world = skylineWorld(skyline, { width: 1440, height: 720, sky: 'night' });
    const img = renderFrame(world, poseFor(30, 15), CAM);
    expect(isTooDarkToSegment(img)).toBe(true);
    const a = classicalSky(img);
    expect(a.data.every((v) => v === UNKNOWN_ALPHA)).toBe(true);
    const day = renderFrame(skylineWorld(skyline, { width: 1440, height: 720 }), poseFor(30, 15), CAM);
    expect(isTooDarkToSegment(day)).toBe(false);
  });

  it('twilight silhouette (orange sky, black trees) still separates', () => {
    const img = rgba(160, 120, (x, y) => (y < 50 + 20 * Math.sin(x / 10) ? [220, 140, 80] : [10, 8, 8]));
    const a = classicalSky(img);
    expect(a.data[10 * 160 + 80]).toBeGreaterThan(200);
    expect(a.data[110 * 160 + 80]).toBeLessThan(30);
  });
});
