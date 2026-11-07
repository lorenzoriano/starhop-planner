import { describe, expect, it } from 'vitest';
import { azAltToPixel, type CameraIntrinsics } from '../horizon/calibrate/camera';
import { GRID_ALT_MIN, type GrayImage, type SkyGrid } from '../horizon/photo-types';
import {
  emptyGrid, gridFromTrace, gridToProfile, paintGrid, projectToGrid, relativeSkyline, shiftGrid,
} from '../horizon/segment/grid';
import { FrameProjector } from '../horizon/segment/projector';
import { alphaWorld, channel, pointing, poseFor, renderFrame, ringPoses } from './horizon-sim-helpers';

const CAM: CameraIntrinsics = { width: 240, height: 180, hfovDeg: 64 };
const SITE = { lat: 45, lon: 7 };

/** A skyline with hills and a sharp-edged "building". */
const trueSkyline = (az: number) => {
  const a = ((az % 360) + 360) % 360;
  let s = 3 + 4 * Math.sin((a * Math.PI) / 90) + 2 * Math.cos((a * Math.PI) / 36);
  if (a > 100 && a < 130) s = 25;
  return s;
};

function gridFrom(fn: (az: number, alt: number) => number | null): SkyGrid {
  const g = emptyGrid();
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const v = fn(c * g.stepDeg, g.altMaxDeg - (r + 0.5) * g.stepDeg);
      if (v === null) continue;
      g.alpha[r * g.width + c] = v;
      g.known[r * g.width + c] = 255;
    }
  }
  return g;
}

describe('sim helpers', () => {
  it('poseFor points the camera where asked, roll included', () => {
    for (const [az, alt, roll] of [[0, 0, 0], [123, 18, 0], [300, 55, 0], [45, 10, 5], [200, 20, -8]]) {
      const p = pointing(poseFor(az, alt, roll));
      expect(Math.abs(((p.az - az + 540) % 360) - 180)).toBeLessThan(1e-9);
      expect(p.alt).toBeCloseTo(alt, 9);
      expect(p.roll).toBeCloseTo(roll, 6);
    }
  });
});

describe('FrameProjector', () => {
  it('matches camera.ts azAltToPixel, with and without distortion', () => {
    for (const cam of [CAM, { ...CAM, k1: -0.08 }]) {
      const pose = poseFor(77, 20, 4);
      const proj = new FrameProjector(pose, cam);
      for (const [az, alt] of [[77, 20], [60, 5], [95, 35], [80, 30]]) {
        const ref = azAltToPixel(pose, cam, az, alt)!;
        const a = (az * Math.PI) / 180, h = (alt * Math.PI) / 180;
        expect(proj.project(Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h))).toBe(true);
        expect(proj.u).toBeCloseTo(ref.u, 6);
        expect(proj.v).toBeCloseTo(ref.v, 6);
      }
      // Behind the camera.
      expect(proj.project(0, -1, 0)).toBe(false);
    }
  });
});

describe('projectToGrid + gridToProfile', () => {
  const world = alphaWorld(trueSkyline);
  const poses = ringPoses(10, 12);
  const frames = poses.map((pose) => ({ alpha: channel(renderFrame(world, pose, CAM)), pose, cam: CAM }));
  const grid = projectToGrid(frames);

  it('covers the ring and recovers the skyline within a fraction of a degree', () => {
    const profile = gridToProfile(grid, SITE, 1.5, '2026-11-06T00:00:00Z');
    expect(profile.kind).toBe('photo');
    expect(profile.stepDeg).toBe(0.25);
    expect(profile.alt).toHaveLength(1440);
    expect(profile.source).toBe('Photo sweep');
    expect(profile.uncertaintyDeg).toBe(1.5);
    let sum = 0, worst = 0, n = 0;
    profile.alt.forEach((alt, i) => {
      const az = i * 0.25;
      // Skip the building's vertical walls (the column's skyline is ambiguous there).
      if (Math.abs(az - 100) < 0.6 || Math.abs(az - 130) < 0.6) return;
      const e = Math.abs(alt - trueSkyline(az));
      sum += e;
      worst = Math.max(worst, e);
      n++;
    });
    expect(sum / n).toBeLessThan(0.15);
    expect(worst).toBeLessThan(0.5);
    for (const v of profile.alt) expect(Math.round(v * 10) / 10).toBe(v);
  });

  it('marks coverage: known near the ring, unknown at the zenith side', () => {
    const top = grid.known.subarray(0, grid.width); // alt 69.9°: frames at +12° with 49° vfov cannot see it
    expect(top.every((k) => k === 0)).toBe(true);
    const row = Math.round((grid.altMaxDeg - 10) / grid.stepDeg);
    expect(grid.known.subarray(row * grid.width, (row + 1) * grid.width).every((k) => k === 255)).toBe(true);
  });

  it('soft alpha survives projection (partial sky stays partial)', () => {
    const half: GrayImage = { width: CAM.width, height: CAM.height, data: new Uint8Array(CAM.width * CAM.height).fill(140) };
    const g = projectToGrid([{ alpha: half, pose: poses[0], cam: CAM }]);
    const centreRow = Math.round((g.altMaxDeg - 12) / g.stepDeg);
    expect(g.alpha[centreRow * g.width]).toBe(140);
  });
});

describe('gridToProfile edge cases', () => {
  it('uncovered columns get GRID_ALT_MIN; columns obstructed to the top of coverage get the top', () => {
    // Covered only between alt 0 and 30 at azimuths 0–90; obstructed everywhere covered at 45–90 (a tall tree).
    const g = gridFrom((az, alt) => {
      if (az > 90 || alt < 0 || alt > 30) return null;
      if (az >= 45) return 0;
      return alt > 10 ? 255 : 0;
    });
    const p = gridToProfile(g, SITE, 1);
    expect(p.alt[Math.round(20 / 0.25)]).toBeCloseTo(10, 1);
    expect(p.alt[Math.round(60 / 0.25)]).toBeCloseTo(30, 1);
    expect(p.alt[Math.round(200 / 0.25)]).toBe(GRID_ALT_MIN);
    // Clear all the way down to the bottom of the coverage: no constraint.
    const clear = gridFrom((_az, alt) => (alt < 0 ? null : 255));
    expect(gridToProfile(clear, SITE, 1).alt[10]).toBe(GRID_ALT_MIN);
  });

  it('ignores isolated wrong cells and small floating blobs in the sky', () => {
    const g = gridFrom((az, alt) => {
      if (alt < -10 || alt > 60) return null;
      if (alt <= 8) return 0;
      // Speckle in the sky, and a 2° "cloud" misread as obstruction at 40–42° in some columns.
      if (Math.abs(alt - 25.125) < 0.01 && Math.round(az * 4) % 7 === 0) return 0;
      if (alt > 40 && alt < 42 && az < 30) return 0;
      // A clear speckle inside the obstruction.
      return 255;
    });
    const p = gridToProfile(g, SITE, 1);
    for (const az of [0, 7, 14, 21, 100, 300]) expect(p.alt[az * 4]).toBeCloseTo(8, 1);
  });

  it('keeps a crown above a gap when most of what is below is obstructed', () => {
    const g = gridFrom((_az, alt) => (alt <= 5 || (alt >= 15 && alt <= 40) ? 0 : 255));
    expect(gridToProfile(g, SITE, 1).alt[0]).toBeCloseTo(40, 1);
  });
});

describe('shiftGrid', () => {
  const base = gridFrom((az, alt) => (alt < 10 + 10 * Math.sin((az * Math.PI) / 180) ? 0 : 255));

  it('integer shift moves content to az + delta', () => {
    const s = shiftGrid(base, 10);
    const pb = gridToProfile(base, SITE, 1), ps = gridToProfile(s, SITE, 1);
    for (const az of [0, 37, 90, 355]) expect(ps.alt[(((az + 10) % 360) * 4)]).toBeCloseTo(pb.alt[az * 4], 6);
  });

  it('fractional shifts compose and round-trip', () => {
    const back = shiftGrid(shiftGrid(base, 3.1), -3.1);
    const pb = gridToProfile(base, SITE, 1), pr = gridToProfile(back, SITE, 1);
    let worst = 0;
    pb.alt.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - pr.alt[i]))));
    expect(worst).toBeLessThan(0.15);
    const half = gridToProfile(shiftGrid(base, 0.125), SITE, 1);
    // Halfway between columns: the skyline at column i is the mean of the neighbours.
    const i = 200;
    expect(half.alt[i]).toBeCloseTo((pb.alt[i] + pb.alt[i - 1]) / 2, 0);
  });

  it('unknown areas move too', () => {
    const g = gridFrom((az) => (az < 10 ? 255 : null));
    const s = shiftGrid(g, 20);
    expect(s.known[25 * 4]).toBe(255);
    expect(s.known[5 * 4]).toBe(0);
  });
});

describe('paintGrid', () => {
  it('paints obstruction and sky within the brush radius, across north', () => {
    const g = gridFrom(() => 255);
    const painted = paintGrid(g, [{ az: 358, alt: 20 }, { az: 2, alt: 20 }], 1, false);
    const at = (gr: SkyGrid, az: number, alt: number) => gr.alpha[Math.floor((gr.altMaxDeg - alt) / 0.25) * gr.width + Math.round(az / 0.25) % gr.width];
    expect(at(painted, 0, 20)).toBe(0);
    expect(at(painted, 359, 20.4)).toBe(0);
    expect(at(painted, 0, 22)).toBe(255);
    expect(at(painted, 5, 20)).toBe(255);
    expect(at(g, 0, 20)).toBe(255); // input untouched
    const back = paintGrid(painted, [{ az: 0, alt: 20 }], 3, true);
    expect(at(back, 0, 20)).toBe(255);
  });

  it('marks painted cells as known', () => {
    const painted = paintGrid(emptyGrid(), [{ az: 90, alt: 0 }], 0.5, false);
    expect(painted.known.some((k) => k === 255)).toBe(true);
  });
});

describe('gridFromTrace', () => {
  it('builds a grid whose profile follows the trace (full circle)', () => {
    const trace = Array.from({ length: 721 }, (_, i) => ({ az: (i * 0.5) % 360, alt: trueSkyline(i * 0.5) }));
    const g = gridFromTrace(trace);
    expect(g.known.every((k) => k === 255)).toBe(true);
    const p = gridToProfile(g, SITE, 1);
    let worst = 0;
    p.alt.forEach((v, i) => {
      const az = i * 0.25;
      if (Math.abs(az - 100) < 1 || Math.abs(az - 130) < 1) return;
      worst = Math.max(worst, Math.abs(v - trueSkyline(az)));
    });
    expect(worst).toBeLessThan(0.1);
  });

  it('a partial trace leaves the rest unknown, also across north', () => {
    const trace = [{ az: 350, alt: 5 }, { az: 355, alt: 6 }, { az: 0, alt: 7 }, { az: 10, alt: 9 }];
    const g = gridFromTrace(trace);
    const p = gridToProfile(g, SITE, 1);
    expect(p.alt[0]).toBeCloseTo(7, 1);
    expect(p.alt[352 * 4]).toBeCloseTo(5.4, 1);
    expect(p.alt[5 * 4]).toBeCloseTo(8, 1);
    expect(p.alt[90 * 4]).toBe(GRID_ALT_MIN);
    expect(g.known[90 * 4]).toBe(0);
    const narrowed = gridFromTrace(trace, { fromAz: 355, toAz: 5 });
    expect(narrowed.known[352 * 4]).toBe(0);
    expect(narrowed.known[2 * 4]).toBe(255);
  });
});

describe('relativeSkyline', () => {
  it('returns the measured skyline and null where it was not seen', () => {
    const g = gridFrom((az, alt) => {
      if (az > 180) return null;
      if (az > 90 && az < 120) return alt > 50 ? null : 0; // obstructed to the top of coverage
      return alt > 12 ? 255 : 0;
    });
    const sky = relativeSkyline(g);
    expect(sky(45)).toBeCloseTo(12, 1);
    expect(sky(45.1)).toBeCloseTo(12, 1);
    expect(sky(100)).toBeNull();
    expect(sky(270)).toBeNull();
    expect(sky(-315)).toBeCloseTo(12, 1);
  });
});
