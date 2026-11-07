import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyYaw, angleDiffDeg, type Quat } from '../horizon/calibrate/quat';
import type { CameraIntrinsics } from '../horizon/calibrate/camera';
import { magneticDeclinationDeg } from '../horizon/calibrate/declination';
import type { TapTarget } from '../horizon/calibrate/tap-targets';
import {
  brighten, compassOnlyNote, LENS_NOT_MEASURED, lightAt, meanLevel, processCapture, SUN_DISC_DEG, SUN_LEFT_OUT, sunDiscs, type CaptureInput,
} from '../horizon/capture/pipeline';
import type { CapturedFrame } from '../horizon/photo-types';
import { projectToGrid, relativeSkyline } from '../horizon/segment/grid';
import type { HorizonProfile } from '../horizon/types';
import { poseFor, renderFrame, skylineWorld } from './horizon-sim-helpers';

// The sky model is not available in tests: the classical path runs.
vi.mock('../horizon/segment/segformer-client', () => ({
  segformerSky: () => Promise.reject(new Error('no model in tests')),
  resetSegformer: () => {},
  segformerDevice: null,
}));

// calibration-store keeps the lens in localStorage.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;

const LAT = 46.02, LON = 7.75;
const DAY = new Date('2026-06-21T11:00:00Z');
/** Evening: the Sun at azimuth ≈ 281.7°, ≈ 21.9° up, inside the low ring's frame at 285°. */
const EVENING = new Date('2026-06-21T17:00:00Z');
const NIGHT = new Date('2026-06-21T23:30:00Z');
/** The relative sensor frame is this far short of true north: trueAz = relAz + OFFSET. */
const OFFSET = 37;
/** The compass reads this much off (magnetic interference). */
const COMPASS_ERROR = 6;
const CAM: CameraIntrinsics = { width: 320, height: 240, hfovDeg: 64 };

// Distant hills (also in the terrain profile) plus a block of trees to the southeast that the terrain does not know.
const hills = (az: number) => 4 + 3 * Math.sin((az * Math.PI) / 90) + 2 * Math.cos((az * Math.PI) / 37);
const trees = (az: number) => (az > 110 && az < 150 ? 22 : 0);
const skyline = (az: number) => Math.max(hills(az), trees(az));
const terrain: HorizonProfile = {
  kind: 'terrain', stepDeg: 1, lat: LAT, lon: LON, computedAt: '2026-06-01T00:00:00Z', source: 'test',
  alt: Array.from({ length: 360 }, (_, az) => hills(az)), distanceKm: Array.from({ length: 360 }, () => 12),
};

function sweep(date: Date, night = false, cam: CameraIntrinsics = CAM): CapturedFrame[] {
  const world = skylineWorld(skyline, { width: 1440, height: 720, sky: night ? 'night' : 'day' });
  const decl = magneticDeclinationDeg(LAT, LON, date);
  return Array.from({ length: 8 }, (_, i) => {
    const pose = poseFor(15 + 45 * i, 18);
    // Relative frame: azimuths OFFSET short of the truth. Magnetic: (decl − error) short of the truth.
    const qRel: Quat = applyYaw(pose.q, -OFFSET);
    const qAbs: Quat = applyYaw(pose.q, -decl + COMPASS_ERROR);
    return { id: i, image: renderFrame(world, pose, cam), qRel, qAbs, screenAngle: 90, t: i * 4000, ring: 0, stillDegPerSec: 0.5 };
  });
}

const input = (over: Partial<CaptureInput>): CaptureInput => ({
  frames: [], taps: [], lat: LAT, lon: LON, date: DAY, terrain: null, cameraKey: 'test camera|320x240',
  deviceGuess: { width: 320, height: 240, hfovDeg: 64 }, useModel: false, ...over,
});

/** Mean |photo skyline − truth| over the azimuths the sweep saw well (low ring covers −3…+39°). */
function skylineError(grid: Parameters<typeof relativeSkyline>[0]): number {
  const s = relativeSkyline(grid);
  let sum = 0, n = 0;
  for (let az = 0; az < 360; az += 2) {
    const v = s(az);
    if (v === null) continue;
    sum += Math.abs(v - skyline(az));
    n++;
  }
  return n > 150 ? sum / n : Infinity;
}

describe('processCapture (synthetic sweep, classical segmentation)', () => {
  beforeEach(() => mem.clear());
  const frames = sweep(DAY);

  it('a Sun tap lines everything up to true north; grid, panorama and record are complete', async () => {
    const sun: TapTarget = { source: 'sun', label: 'the Sun', az: 200, alt: 30, mag: -26.7 };
    const tap = { qRel: applyYaw(poseFor(200, 30).q, -OFFSET), screenAngle: 90, target: sun };
    const progress: number[] = [];
    // The terrain match on these perfect synthetic hills claims no better than ±1° (the elevation model's accuracy), so
    // the centred Sun (±0.6°) wins.
    const r = await processCapture(input({ frames, taps: [tap], terrain }), f => progress.push(f));
    expect(r.light).toBe('day');
    expect(r.needsTrace).toBe(false);
    expect(r.yaw.chosen.source).toBe('sun');
    expect(Math.abs(angleDiffDeg(r.yaw.chosen.offsetDeg, OFFSET))).toBeLessThan(0.3);
    // The compass was 6° off and says so in the fix list.
    const compass = r.yaw.fixes.find(f => f.source === 'compass')!;
    expect(Math.abs(angleDiffDeg(compass.offsetDeg, OFFSET + COMPASS_ERROR))).toBeLessThan(1);
    // The hills agree with the Sun within their ±1°.
    const hills = r.yaw.fixes.find(f => f.source === 'terrain')!;
    expect(hills.sigmaDeg).toBe(1);
    expect(Math.abs(angleDiffDeg(hills.offsetDeg, OFFSET))).toBeLessThan(1);
    expect(r.yaw.disagreement).toBeUndefined();
    expect(skylineError(r.grid)).toBeLessThan(1.5);
    // Trees to the southeast block 20° up; the hills alone leave 10° clear elsewhere.
    const s = relativeSkyline(r.grid);
    expect(s(130)!).toBeGreaterThan(19);
    expect(s(300)!).toBeLessThan(9);
    expect(r.panorama.width).toBe(4096);
    expect(r.panorama.height).toBe(1024);
    expect(r.record).toMatchObject({ version: 1, lat: LAT, lon: LON, season: 'leaf-on', segmentation: 'classical', frames: 8, rings: 1, light: 'day' });
    expect(r.record.camera.cameraKey).toBe('test camera|320x240');
    expect(r.record.camera.width).toBe(320);
    expect(r.record.yaw.chosen.source).toBe('sun');
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1] - 1e-9)).toBe(true);
  });

  it('solves k1 with the field of view and keeps it in the record and the stored calibration', async () => {
    // A barrel lens: without k1 the FOV fit reads about 2% wide (seen in the simulation harness).
    const barrel = sweep(DAY, false, { ...CAM, k1: -0.08 });
    const r = await processCapture(input({ frames: barrel, terrain }));
    expect(r.record.camera.k1).toBeDefined();
    expect(r.record.camera.k1!).toBeLessThan(-0.03);
    expect(Math.abs(r.record.camera.hfovDeg / 64 - 1)).toBeLessThan(0.01);
    const stored = JSON.parse(mem.get('starhop-camera-calibration-v1') ?? '{}') as Record<string, { k1?: number }>;
    expect(stored['test camera|320x240']?.k1).toBe(r.record.camera.k1);
  });

  it('without a tap the hills line it up better than the compass', async () => {
    const r = await processCapture(input({ frames, terrain }));
    expect(r.yaw.chosen.source).toBe('terrain');
    expect(Math.abs(angleDiffDeg(r.yaw.chosen.offsetDeg, OFFSET))).toBeLessThan(1.5);
    expect(skylineError(r.grid)).toBeLessThan(2);
  });

  it('with only the compass the result is approximate and says so', async () => {
    const r = await processCapture(input({ frames }));
    expect(r.yaw.chosen.source).toBe('compass');
    expect(Math.abs(angleDiffDeg(r.yaw.chosen.offsetDeg, OFFSET + COMPASS_ERROR))).toBeLessThan(1);
    expect(r.notes).toContain(compassOnlyNote(r.yaw.chosen.sigmaDeg, 'day'));
  });

  it('at night: no automatic sky, the user traces; dark frames brightened; lens from the guess unless stored', async () => {
    const dark = sweep(NIGHT, true);
    expect(lightAt(LAT, LON, NIGHT).light).toBe('night');
    const r = await processCapture(input({ frames: dark, date: NIGHT, terrain }));
    expect(r.needsTrace).toBe(true);
    expect(r.record.segmentation).toBe('trace');
    expect(r.grid.known.every(v => v === 0)).toBe(true);
    expect(r.yaw.chosen.source).toBe('compass');
    expect(r.notes.some(n => n.includes('repeat the sweep in daylight'))).toBe(true);
    expect(meanLevel(r.panorama)).toBeGreaterThan(meanLevel(dark[0].image));
    if (!r.fovSolved) {
      expect(r.notes).toContain(LENS_NOT_MEASURED);
      expect(r.record.camera.hfovDeg).toBe(64);
      expect(r.record.camera.sigmaDeg).toBe(2);
    }
  });

  it('leaves a disc around the Sun out of the sky map, so glare cannot fake sky or trees', async () => {
    const { sunAzDeg: az, sunAltDeg: alt } = lightAt(LAT, LON, EVENING);
    expect(alt).toBeGreaterThan(15);
    expect(alt).toBeLessThan(30);
    const sun: TapTarget = { source: 'sun', label: 'the Sun', az, alt, mag: -26.7 };
    const tap = { qRel: applyYaw(poseFor(az, alt).q, -OFFSET), screenAngle: 90, target: sun };
    const r = await processCapture(input({ frames: sweep(EVENING), taps: [tap], date: EVENING }));
    expect(r.yaw.chosen.source).toBe('sun');
    const known = (dAz: number, dAlt: number) => {
      const g = r.grid, c = Math.round((((az + dAz) % 360) + 360) % 360 / g.stepDeg) % g.width;
      const row = Math.floor((g.altMaxDeg - (alt + dAlt)) / g.stepDeg);
      return g.known[row * g.width + c] !== 0;
    };
    // Inside the disc: unknown. Just outside it (and well away, the same frame): seen.
    expect(known(0, 0)).toBe(false);
    expect(known(SUN_DISC_DEG - 0.5, 0)).toBe(false);
    expect(known(0, -(SUN_DISC_DEG - 0.5))).toBe(false);
    expect(known(SUN_DISC_DEG + 2, 0)).toBe(true);
    expect(known(0, -(SUN_DISC_DEG + 2))).toBe(true);
    expect(r.notes).toContain(SUN_LEFT_OUT);
    // In daylight with the Sun high above the frames there is nothing to leave out and no note.
    const noon = await processCapture(input({ frames, taps: [] }));
    expect(noon.notes).not.toContain(SUN_LEFT_OUT);
  });

  it('throws only when nothing was captured, or when cancelled', async () => {
    await expect(processCapture(input({ frames: [] }))).rejects.toThrow('No frames');
    const controller = new AbortController();
    const run = processCapture(input({ frames, signal: controller.signal }), f => { if (f > 0.2) controller.abort(); });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('pipeline helpers', () => {
  it('sunDiscs: 4° widened by the alignment uncertainty, in the poses\' frame; none while north is unknown', () => {
    expect(sunDiscs({ az: 250, alt: 10 }, 0, 0.5)).toEqual([{ az: 250, alt: 10, radiusDeg: 4.5 }]);
    expect(sunDiscs({ az: 250, alt: 10 }, 37, 5)).toEqual([{ az: 213, alt: 10, radiusDeg: 9 }]);
    expect(sunDiscs({ az: 250, alt: 10 }, 0, 40)[0].radiusDeg).toBe(10);
    expect(sunDiscs({ az: 250, alt: 10 }, 0, 180)).toEqual([]);
    expect(sunDiscs({ az: 250, alt: -30 }, 0, 1)).toEqual([]);
  });

  it('projectToGrid leaves excluded discs unknown when no other frame sees them', () => {
    const alpha = { width: 32, height: 24, data: new Uint8Array(32 * 24).fill(0) };
    const pose = poseFor(100, 10), cam = { width: 32, height: 24, hfovDeg: 60 };
    const g = projectToGrid([{ alpha, pose, cam, exclude: [{ az: 100, alt: 10, radiusDeg: 4 }] }]);
    const at = (az: number, a: number) => Math.floor((g.altMaxDeg - a) / g.stepDeg) * g.width + Math.round(az / g.stepDeg);
    expect(g.known[at(100, 10)]).toBe(0);
    expect(g.known[at(102, 12)]).toBe(0);
    expect(g.known[at(107, 10)]).toBe(255);
    expect(g.alpha[at(107, 10)]).toBe(0);
    // Without the disc the same cell is seen (here: obstruction).
    const plain = projectToGrid([{ alpha, pose, cam }]);
    expect(plain.known[at(100, 10)]).toBe(255);
  });

  it('brightens a dark image towards the target mean and leaves bright ones alone', () => {
    const data = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 5 + (i % 8) * 2; data[i * 4 + 3] = 255; }
    const img = { width: 8, height: 8, data };
    const b = brighten(img, 90);
    expect(meanLevel(b)).toBeGreaterThan(60);
    const bright = { width: 1, height: 1, data: Uint8ClampedArray.from([200, 200, 200, 255]) };
    expect(brighten(bright)).toBe(bright);
  });

  it('light level from the Sun', () => {
    expect(lightAt(LAT, LON, DAY).light).toBe('day');
    expect(lightAt(LAT, LON, DAY).sunAltDeg).toBeGreaterThan(50);
  });
});
