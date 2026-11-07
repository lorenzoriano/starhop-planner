import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics } from '../horizon/calibrate/camera';
import { PANORAMA_ALT_MAX, PANORAMA_ALT_MIN, type RgbaImage } from '../horizon/photo-types';
import { azAltToPanoramaPixel, composePanorama, panoramaPixelToAzAlt, shiftPanorama } from '../horizon/segment/panorama';
import { snapTraceToEdges } from '../horizon/segment/trace';
import { makeWorld, poseFor, renderFrame, ringPoses, sampleWorld } from './horizon-sim-helpers';

const CAM: CameraIntrinsics = { width: 240, height: 180, hfovDeg: 64 };

/** Smooth, structured colour world (no aliasing trouble at test resolutions). */
const world = makeWorld(1440, 720, (az, alt) => [
  128 + 100 * Math.sin((az * Math.PI) / 30),
  128 + 100 * Math.cos((alt * Math.PI) / 20),
  128 + 60 * Math.sin(((az + alt) * Math.PI) / 45),
]);

describe('composePanorama', () => {
  const PW = 720, PH = 180;
  const poses = [...ringPoses(10, 20), ...ringPoses(6, 50, 20)];
  const frames = poses.map((pose) => ({ image: renderFrame(world, pose, CAM), pose, cam: CAM }));
  const pano = composePanorama(frames, PW, PH);

  it('round-trips a known world where covered, transparent elsewhere', () => {
    let err = 0, n = 0, transparentLow = 0;
    const px = [0, 0, 0, 0];
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const i = (y * PW + x) * 4;
        const { az, alt } = panoramaPixelToAzAlt(PW, PH, x + 0.5, y + 0.5);
        if (pano.data[i + 3] === 0) {
          if (alt < 0) transparentLow++;
          continue;
        }
        sampleWorld(world, az, alt, px);
        for (let c = 0; c < 3; c++) err += Math.abs(pano.data[i + c] - px[c]);
        n += 3;
      }
    }
    expect(n / 3).toBeGreaterThan(PW * PH * 0.6);
    expect(err / n).toBeLessThan(3);
    // The ring at +20° with a 50° vertical field reaches down to about −5°; the band below is never seen.
    const bottom = (PH - 1) * PW * 4;
    expect(pano.data[bottom + 3]).toBe(0);
    expect(transparentLow).toBeGreaterThan(0);
    // The top (alt 80°) is above the upper ring's reach (50 + 25).
    expect(pano.data[3]).toBe(0);
  });

  it('pixel geometry helpers are inverse', () => {
    const { x, y } = azAltToPanoramaPixel(4096, 1024, 123.4, 21.5);
    const back = panoramaPixelToAzAlt(4096, 1024, x, y);
    expect(back.az).toBeCloseTo(123.4, 9);
    expect(back.alt).toBeCloseTo(21.5, 9);
    expect(azAltToPanoramaPixel(4096, 1024, 0, PANORAMA_ALT_MAX)).toEqual({ x: 0, y: 0 });
    expect(azAltToPanoramaPixel(4096, 1024, 0, PANORAMA_ALT_MIN).y).toBe(1024);
  });

  it('full size from 14 frames of 1280×960 finishes in reasonable time', () => {
    const big: CameraIntrinsics = { width: 1280, height: 960, hfovDeg: 64 };
    const img: RgbaImage = { width: 1280, height: 960, data: new Uint8ClampedArray(1280 * 960 * 4).fill(200) };
    const ps = [...ringPoses(8, 18), ...ringPoses(6, 55)];
    const t0 = performance.now();
    const out = composePanorama(ps.map((pose) => ({ image: img, pose, cam: big })));
    const ms = performance.now() - t0;
    expect(out.width).toBe(4096);
    expect(out.height).toBe(1024);
    // Generous bound for CI; a desktop does this in well under a second.
    expect(ms).toBeLessThan(8000);
  });
});

describe('shiftPanorama', () => {
  const W = 360, H = 4;
  const img: RgbaImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = x % 256;
      img.data[i + 3] = x >= 100 && x < 200 ? 255 : 0; // only 100–199 filled
    }
  }

  it('moves content to az + delta with wrap', () => {
    const s = shiftPanorama(img, 300);
    // Old x = 150 (red 150) now at (150 + 300) % 360 = 90.
    expect(s.data[90 * 4]).toBe(150);
    expect(s.data[90 * 4 + 3]).toBe(255);
    expect(s.data[20 * 4 + 3]).toBe(0);
  });

  it('fractional shift interpolates colours without darkening at the transparent border', () => {
    const s = shiftPanorama(img, 0.5);
    expect(s.data[150 * 4]).toBeCloseTo(149.5, -0.5);
    // First filled column: half covered → half alpha, colour of the filled neighbour (not mixed with black).
    expect(s.data[100 * 4 + 3]).toBeGreaterThan(120);
    expect(s.data[100 * 4 + 3]).toBeLessThan(135);
    expect(s.data[100 * 4]).toBe(100);
  });
});

describe('snapTraceToEdges', () => {
  const PW = 1440, PH = 360;
  const skyline = (az: number) => 10 + 5 * Math.sin((az * Math.PI) / 60);
  // Night panorama: faint sky glow above, black trees below; unfilled beyond 300°.
  const pano: RgbaImage = { width: PW, height: PH, data: new Uint8ClampedArray(PW * PH * 4) };
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const { az, alt } = panoramaPixelToAzAlt(PW, PH, x + 0.5, y + 0.5);
      const i = (y * PW + x) * 4;
      if (az > 300) continue;
      const v = alt > skyline(az) ? 60 : 5;
      pano.data[i] = pano.data[i + 1] = pano.data[i + 2] = v;
      pano.data[i + 3] = 255;
    }
  }
  const degPerPx = (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN) / PH;

  it('moves a sloppy trace onto the skyline edge', () => {
    const trace = Array.from({ length: 50 }, (_, i) => {
      const az = i * 5 + 1;
      return { az, alt: skyline(az) + (i % 2 ? 0.8 : -0.9) };
    });
    const snapped = snapTraceToEdges(pano, trace, 1.5);
    snapped.forEach((p, i) => {
      expect(p.az).toBe(trace[i].az);
      expect(Math.abs(p.alt - skyline(p.az))).toBeLessThanOrEqual(degPerPx + 1e-9);
    });
  });

  it('keeps points with no edge nearby or over unfilled panorama', () => {
    const far = { az: 50, alt: 40 };
    const blank = { az: 320, alt: 12 };
    expect(snapTraceToEdges(pano, [far, blank], 1.5)).toEqual([far, blank]);
  });
});

describe('sim helpers: renderFrame', () => {
  it('the image centre shows the world at the pointing direction', () => {
    const pose = poseFor(80, 20);
    const img = renderFrame(world, pose, CAM);
    const px = [0, 0, 0, 0];
    sampleWorld(world, 80, 20, px);
    // The centre lies between four pixels; average them.
    const at = (u: number, v: number, c: number) => img.data[(v * CAM.width + u) * 4 + c];
    for (let c = 0; c < 3; c++) {
      const centre = (at(119, 89, c) + at(120, 89, c) + at(119, 90, c) + at(120, 90, c)) / 4;
      expect(Math.abs(centre - px[c])).toBeLessThan(3);
    }
  });
});
