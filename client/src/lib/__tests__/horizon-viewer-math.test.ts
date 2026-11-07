import { describe, expect, it } from 'vitest';
import { eqToHorizontal } from '@/lib/astronomy';
import { cameraPointing } from '@/lib/horizon/calibrate/camera';
import { quatFromDeviceOrientation } from '@/lib/horizon/capture/sensors';
import { angleDiffDeg, azAltFromVec } from '@/lib/horizon/calibrate/quat';
import { apparentFromGeometric } from '@/lib/horizon/profile';
import type { HorizonProfile } from '@/lib/horizon/types';
import {
  azAltToScreen, backgroundRgb, clampFov, degPerPixel, dragView, fitTextureSize, panoramaUv, screenToAzAlt, skyLight,
  zoomView, GROUND_RGB, type ViewState,
} from '@/lib/horizon/viewer/view';
import {
  altAzOf, bodyPoints, buildCatalogue, horizontalMatrix, packOfDate, rotatePacked,
  skyPoints, tonightWindow,
} from '@/lib/horizon/viewer/sky';
import { backgroundPixels, decodeSkylineBin, encodeSkyline, SKYLINE_BINS } from '@/lib/horizon/viewer/background';

const view = (o: Partial<ViewState> = {}): ViewState => ({ yaw: 0, pitch: 0, fovDeg: 70, width: 412, height: 915, ...o });

describe('viewer camera', () => {
  it('puts the view direction at the screen centre', () => {
    for (const v of [view(), view({ yaw: 123, pitch: 40 }), view({ yaw: 359, pitch: -20, width: 915, height: 412 })]) {
      const c = screenToAzAlt(v, v.width / 2, v.height / 2);
      expect(Math.abs(angleDiffDeg(c.az, v.yaw))).toBeLessThan(1e-9);
      expect(c.alt).toBeCloseTo(v.pitch, 9);
    }
  });

  it('spans the field of view across the longer side, east to the right when looking north', () => {
    const portrait = view({ fovDeg: 70 });
    expect(screenToAzAlt(portrait, portrait.width / 2, 0).alt).toBeCloseTo(35, 9);
    expect(screenToAzAlt(portrait, portrait.width / 2, portrait.height).alt).toBeCloseTo(-35, 9);
    const landscape = view({ fovDeg: 90, width: 915, height: 412 });
    const right = screenToAzAlt(landscape, landscape.width, landscape.height / 2);
    expect(right.az).toBeCloseTo(45, 9);
    expect(right.alt).toBeCloseTo(0, 9);
    expect(screenToAzAlt(landscape, 0, landscape.height / 2).az).toBeCloseTo(315, 9);
  });

  it('round-trips screen ⇄ (az, alt) and hides directions behind the viewer', () => {
    const v = view({ yaw: 210, pitch: 25, fovDeg: 85 });
    for (const [x, y] of [[0, 0], [412, 915], [100, 700], [206, 457.5], [380, 40]]) {
      const { az, alt } = screenToAzAlt(v, x, y);
      const p = azAltToScreen(v, az, alt)!;
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBeCloseTo(y, 6);
    }
    expect(azAltToScreen(v, 30, -25)).toBeNull(); // straight behind
  });

  it('drags the sky with the finger and clamps the zoom', () => {
    const v = view({ yaw: 10 });
    const k = degPerPixel(v);
    const moved = dragView(v, 100, 0);
    expect(moved.yaw).toBeCloseTo(10 - 100 * k, 9);
    // the point that was under the finger is still under it (at the centre row, to first order)
    const before = screenToAzAlt(v, 206, 457.5), after = azAltToScreen(moved, before.az, before.alt)!;
    expect(Math.abs(after.x - 306)).toBeLessThan(1.5);
    expect(dragView(v, 0, 1e6).pitch).toBe(89);
    expect(zoomView(v, 100).fovDeg).toBe(30);
    expect(zoomView(v, 0.01).fovDeg).toBe(100);
    expect(clampFov(65)).toBe(65);
  });
});

describe('viewer panorama and background', () => {
  it('maps directions to the equirectangular panorama with north at u = 0', () => {
    expect(panoramaUv(0, 80, -10, 80)).toEqual({ u: 0, v: 0 });
    expect(panoramaUv(90, -10, -10, 80)).toEqual({ u: 0.25, v: 1 });
    expect(panoramaUv(270, 35, -10, 80)!.v).toBeCloseTo(0.5, 12);
    expect(panoramaUv(10, -11, -10, 80)).toBeNull();
    // a photo moved 5° to the right shows at az 15 what was stored at az 10
    expect(panoramaUv(15, 0, -10, 80, 5)!.u).toBeCloseTo(10 / 360, 12);
  });

  it('downscales the panorama to the GPU texture limit', () => {
    expect(fitTextureSize(4096, 1024, 16384)).toEqual({ width: 4096, height: 1024 });
    expect(fitTextureSize(4096, 1024, 2048)).toEqual({ width: 2048, height: 512 });
  });

  it('encodes the skyline for the shader to a few thousandths of a degree', () => {
    const skyline = (az: number) => 5 + 10 * Math.sin((az * Math.PI) / 180);
    const bytes = encodeSkyline(skyline);
    expect(bytes.length).toBe(SKYLINE_BINS * 4);
    for (const i of [0, 360, 1000]) expect(decodeSkylineBin(bytes, i)).toBeCloseTo(skyline((i * 360) / SKYLINE_BINS), 2);
    expect(decodeSkylineBin(encodeSkyline(null), 7)).toBeCloseTo(0, 2);
  });

  it('draws ground below the skyline and a lighter sky towards the horizon (2D fallback)', () => {
    expect(backgroundRgb(4, 5, 0)).toEqual([...GROUND_RGB]);
    const low = backgroundRgb(1, 0, 0), high = backgroundRgb(80, 0, 0);
    expect(low[2]).toBeGreaterThan(high[2]);
    expect(backgroundRgb(30, 0, 1)[2]).toBeGreaterThan(backgroundRgb(30, 0, 0)[2]);
    expect(skyLight(-20)).toBe(0);
    expect(skyLight(10)).toBe(1);
    // A wall 20° high to the north: looking north, the lower half of the screen (below +20°) is ground.
    const px = backgroundPixels(view({ fovDeg: 90, width: 100, height: 100 }), 10, 10, () => 20, 0);
    const at = (i: number, j: number) => Array.from(px.slice((j * 10 + i) * 4, (j * 10 + i) * 4 + 3));
    expect(at(5, 9)).toEqual([...GROUND_RGB]);
    expect(at(5, 0)).not.toEqual([...GROUND_RGB]);
  });
});

describe('viewer sky: one rotation per tick', () => {
  const lat = 46.02, lon = 7.75, date = new Date('2026-11-06T21:30:00Z');
  const stars = [
    { ra: 279.2347, dec: 38.7837 }, // Vega
    { ra: 88.7929, dec: 7.4071 }, // Betelgeuse
    { ra: 37.9546, dec: 89.2641 }, // Polaris
    { ra: 101.2872, dec: -16.7161 }, // Sirius
    { ra: 10.8975, dec: 41.2692 }, // M31
  ];

  it('matches eqToHorizontal within 0.05° for a few stars over a whole night', () => {
    const packed = packOfDate(stars, date);
    for (const hours of [-4, 0, 3, 8]) {
      const t = new Date(+date + hours * 3600000), m = horizontalMatrix(lat, lon, t);
      stars.forEach((s, i) => {
        const v = rotatePacked(m, packed, i, [0, 0, 0]);
        const mine = altAzOf(v), ref = eqToHorizontal(s.ra, s.dec, lat, lon, t);
        expect(Math.abs(mine.alt - ref.alt)).toBeLessThan(0.05);
        if (Math.abs(ref.alt) < 85) expect(Math.abs(angleDiffDeg(mine.az, ref.az)) * Math.cos((ref.alt * Math.PI) / 180)).toBeLessThan(0.05);
      });
    }
  });

  it('adds refraction and dims what is behind the skyline (geometric comparison)', () => {
    const packed = packOfDate(stars, date), m = horizontalMatrix(lat, lon, date);
    const flat = skyPoints(packed, m, null);
    const wall: HorizonProfile = {
      kind: 'terrain', stepDeg: 1, alt: new Array(360).fill(85), lat, lon, computedAt: '2026-01-01', source: 'test',
    };
    const walled = skyPoints(packed, m, { terrain: wall });
    flat.forEach((p, i) => {
      if (!p) return;
      const geo = altAzOf(rotatePacked(m, packed, i, [0, 0, 0]));
      expect(p.alt).toBeCloseTo(apparentFromGeometric(geo.alt), 9);
      expect(p.hidden).toBe(geo.alt < 0);
      expect(walled[i]!.hidden).toBe(true);
    });
  });

  it('places the Sun, Moon and planets with apparent altitude', () => {
    const bodies = bodyPoints(lat, lon, date, null);
    expect(bodies.map((b) => b.name)).toEqual(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
    const sun = bodies[0];
    expect(sun.alt).toBeLessThan(-30); // 22:30 local in November
    expect(sun.hidden).toBe(true);
    expect(bodies[1].phase).toBeGreaterThanOrEqual(0);
  });

  it('builds the catalogue to magnitude 5 with constellation segments as vector pairs', () => {
    const cat = buildCatalogue(
      [{ ra: 279.23, dec: 38.78, mag: 0.03, name: 'Vega', temperature: 9600 }, { ra: 1, dec: 1, mag: 6.2 }],
      [{ points: [[[0, 0], [10, 0], [20, 5]]] }],
      [{ id: 'M31', name: 'Andromeda Galaxy', ra: 10.68, dec: 41.27 }, { id: 'x', name: 'bad', ra: NaN, dec: 0 }],
      date,
    );
    expect(cat.stars).toHaveLength(1);
    expect(cat.stars[0].name).toBe('Vega');
    expect(cat.lineVecs.length).toBe(4 * 3);
    expect(cat.targets.map((t) => t.id)).toEqual(['M31']);
  });
});

describe('viewer night and phone orientation', () => {
  it('covers sunset to sunrise of the night under way, and the afternoon before it', () => {
    const lat = 46.02, lon = 7.75;
    const late = tonightWindow(lat, lon, new Date('2026-11-07T01:00:00Z'));
    expect(+late.start).toBeLessThan(+new Date('2026-11-07T01:00:00Z'));
    expect(late.start.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(late.end.toISOString().slice(0, 10)).toBe('2026-11-07');
    const hours = (+late.end - +late.start) / 3600000;
    expect(hours).toBeGreaterThan(13);
    expect(hours).toBeLessThan(15);
    const afternoon = new Date('2026-11-06T13:00:00Z');
    const early = tonightWindow(lat, lon, afternoon);
    expect(+early.start).toBe(+afternoon);
    expect(+early.sunset!).toBe(+late.sunset!);
    // midnight sun: the whole day
    const polar = tonightWindow(78, 15, new Date('2026-06-21T12:00:00Z'));
    expect((+polar.end - +polar.start) / 3600000).toBeCloseTo(24, 0);
  });

  it('turns deviceorientation angles into a pose whose camera looks out of the back of the phone', () => {
    const look = (a: number, b: number, g: number) => cameraPointing({ q: quatFromDeviceOrientation(a, b, g), screenAngle: 0 });
    const north = look(0, 90, 0); // upright, screen towards the user, facing north
    expect(Math.abs(angleDiffDeg(north.az, 0))).toBeLessThan(1e-6);
    expect(north.alt).toBeCloseTo(0, 6);
    expect(look(90, 90, 0).az).toBeCloseTo(270, 6); // alpha turns counter-clockwise seen from above: west
    expect(look(0, 120, 0).alt).toBeCloseTo(30, 6); // tilted back: looking up
    expect(look(0, 0, 0).alt).toBeCloseTo(-90, 6); // flat, screen up: camera at the ground
    expect(azAltFromVec([0, 1, 0]).az).toBe(0);
  });
});
