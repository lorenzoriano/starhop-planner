import { describe, expect, it } from 'vitest';
import { CaptureGuide, separationDeg, type GuideSample, type GuideView } from '../horizon/capture/guide';
import { averageQuats, OrientationBuffer, quatFromDeviceOrientation } from '../horizon/capture/sensors';
import { cameraPointing, type CameraIntrinsics } from '../horizon/calibrate/camera';
import { angleDiffDeg, quatAngleDeg, quatFromAxisAngle, quatMultiply, rotateVec, type Quat } from '../horizon/calibrate/quat';

const CAM: CameraIntrinsics = { width: 1280, height: 960, hfovDeg: 64 };
// Phone upright facing north, turned counter-clockwise into landscape (screen.orientation.angle 90).
const LANDSCAPE_NORTH = quatMultiply(quatFromAxisAngle([1, 0, 0], 90), quatFromAxisAngle([0, 0, 1], 90));

/** Landscape phone whose camera looks at (az, alt), turned clockwise by `roll` (relative frame). */
function pose(az: number, alt: number, roll = 0): Quat {
  const level = quatMultiply(quatFromAxisAngle([0, 0, 1], -az), quatMultiply(quatFromAxisAngle([1, 0, 0], alt), LANDSCAPE_NORTH));
  return quatMultiply(level, quatFromAxisAngle([0, 0, 1], -roll));
}

/** Deterministic small noise. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; };
}

/** A person turning between dots at `speed` °/s and holding each for `holdMs`, sampled at 60 Hz. */
function sweep(stops: Array<{ az: number; alt: number }>, opts: { speed?: number; holdMs?: number; jitter?: number; start?: number; absOffset?: number; screenAngle?: number } = {}): GuideSample[] {
  const { speed = 40, holdMs = 450, jitter = 0.05, absOffset = 25, screenAngle = 90 } = opts;
  const noise = rng(7);
  const out: GuideSample[] = [];
  let t = opts.start ?? 0;
  const push = (az: number, alt: number) => {
    const q = pose(az + noise() * jitter, alt + noise() * jitter);
    out.push({ qRel: q, qAbs: quatMultiply(quatFromAxisAngle([0, 0, 1], -absOffset), q), t, screenAngle });
    t += 1000 / 60;
  };
  let cur = stops[0];
  for (const stop of stops) {
    const dAz = angleDiffDeg(stop.az, cur.az), dAlt = stop.alt - cur.alt;
    const n = Math.ceil((Math.hypot(dAz, dAlt) / speed) * 60);
    for (let i = 1; i <= n; i++) push(cur.az + (dAz * i) / n, cur.alt + (dAlt * i) / n);
    for (let i = 0; i < (holdMs / 1000) * 60; i++) push(stop.az, stop.alt);
    cur = stop;
  }
  return out;
}

function run(guide: CaptureGuide, samples: GuideSample[]) {
  const views: GuideView[] = [];
  for (const s of samples) views.push(guide.update(s));
  return { views, captures: views.flatMap(v => (v.capture ? [v.capture] : [])), last: views[views.length - 1] };
}

describe('test pose helper', () => {
  it('points the camera where asked, in landscape', () => {
    const p = cameraPointing({ q: pose(123, 18, 4), screenAngle: 90 });
    expect(p.az).toBeCloseTo(123, 9);
    expect(p.alt).toBeCloseTo(18, 9);
    expect(p.roll).toBeCloseTo(4, 9);
  });
});

describe('CaptureGuide', () => {
  it('places ring 0 from the first heading and steers up, then left/right to the nearest dot', () => {
    const g = new CaptureGuide({ cam: CAM });
    const v = g.update({ qRel: pose(37, 5), qAbs: null, t: 0, screenAngle: 90 });
    expect(g.origin).toBeCloseTo(37, 6);
    expect(v.dots.map(d => Math.round(d.az))).toEqual([37, 82, 127, 172, 217, 262, 307, 352]);
    expect(v.dots.every(d => d.alt === 18 && d.ring === 0)).toBe(true);
    expect(v.target?.id).toBe(0);
    expect(v.hint).toBe('Tilt up');
    expect(v.ring0).toEqual({ done: 0, total: 8 });
    expect(v.canFinish).toBe(false);
    const left = g.update({ qRel: pose(0, 18), qAbs: null, t: 1000, screenAngle: 90 });
    expect(left.target?.az).toBeCloseTo(352, 6);
    expect(left.hint).toBe('Turn left');
    const right = g.update({ qRel: pose(65, 18), qAbs: null, t: 2000, screenAngle: 90 });
    expect(right.target?.az).toBeCloseTo(82, 6);
    expect(right.hint).toBe('Turn right');
  });

  it('projects dots into the preview: the target under the reticle is at the image centre', () => {
    const g = new CaptureGuide({ cam: CAM });
    g.update({ qRel: pose(100, 18), qAbs: null, t: 0, screenAngle: 90 });
    const v = g.update({ qRel: pose(100, 18), qAbs: null, t: 10, screenAngle: 90 });
    const d0 = v.dots[0];
    expect(d0.u).toBeCloseTo(640, 6);
    expect(d0.v).toBeCloseTo(480, 6);
    expect(d0.visible).toBe(true);
    expect(v.dots[1].visible).toBe(false); // 45° to the right, outside a 64° view
    const off = g.update({ qRel: pose(80, 10), qAbs: null, t: 20, screenAngle: 90 });
    expect(off.dots[0].u!).toBeGreaterThan(640); // dot is to the right of the reticle…
    expect(off.dots[0].v!).toBeLessThan(480); // …and above it
  });

  it('takes a frame after holding still on a dot for 300 ms, with the averaged orientation', () => {
    const g = new CaptureGuide({ cam: CAM });
    const samples = sweep([{ az: 50, alt: 18 }], { holdMs: 600, jitter: 0.1 });
    const { captures, views } = run(g, samples);
    expect(captures).toHaveLength(1);
    const c = captures[0];
    expect(c.dotId).toBe(0);
    expect(c.ring).toBe(0);
    expect(c.t - samples[0].t).toBeGreaterThanOrEqual(300);
    expect(c.t - samples[0].t).toBeLessThan(400);
    expect(quatAngleDeg(c.qRel, pose(50, 18))).toBeLessThan(0.1);
    expect(c.qAbs).not.toBeNull();
    expect(cameraPointing({ q: c.qAbs!, screenAngle: 90 }).az).toBeCloseTo(75, 0);
    expect(c.stillDegPerSec).toBeLessThan(2);
    expect(views.some(v => v.holding > 0 && v.holding < 1)).toBe(true);
    expect(views[views.length - 1].dots[0].done).toBe(true);
  });

  it('does not take a frame while turning, off the dot, or in portrait', () => {
    // Swinging through the dot at 10°/s never holds still.
    const g1 = new CaptureGuide({ cam: CAM });
    g1.update({ qRel: pose(0, 18), qAbs: null, t: 0, screenAngle: 90 });
    const pass = sweep([{ az: 330, alt: 18 }, { az: 30, alt: 18 }], { speed: 10, holdMs: 0, start: 1 });
    expect(run(g1, pass.slice(1)).captures).toHaveLength(0);
    // Holding still 3.5° above the dot.
    const g2 = new CaptureGuide({ cam: CAM });
    g2.update({ qRel: pose(0, 18), qAbs: null, t: 0, screenAngle: 90 });
    const off = run(g2, sweep([{ az: 0, alt: 21.5 }], { holdMs: 800, start: 1 }));
    expect(off.captures).toHaveLength(0);
    expect(off.last.hint).toBe('Tilt down');
    // Portrait: never captures, asks for landscape.
    const g3 = new CaptureGuide({ cam: CAM });
    const portrait = run(g3, sweep([{ az: 0, alt: 18 }], { holdMs: 800, screenAngle: 0 }));
    expect(portrait.captures).toHaveLength(0);
    expect(portrait.last.hint).toBe('Turn the phone sideways (landscape)');
  });

  it('takes frames only in landscape (90 or 270): a portrait start asks to turn the phone, then captures once turned', () => {
    const g = new CaptureGuide({ cam: CAM });
    const portrait = run(g, sweep([{ az: 40, alt: 18 }], { holdMs: 900, screenAngle: 0 }));
    expect(portrait.captures).toHaveLength(0);
    expect(portrait.views.every(v => v.hint === 'Turn the phone sideways (landscape)')).toBe(true);
    // The dots were placed from the first heading even in portrait.
    expect(g.origin).toBeCloseTo(40, 0);
    const upsideDown = run(g, sweep([{ az: 40, alt: 18 }], { holdMs: 900, screenAngle: 180, start: 2000 }));
    expect(upsideDown.captures).toHaveLength(0);
    const turned = run(g, sweep([{ az: 40, alt: 18 }], { holdMs: 900, screenAngle: 270, start: 4000 }));
    expect(turned.captures.map(c => c.dotId)).toEqual([0]);
    expect(turned.captures[0].screenAngle).toBe(270);
  });

  it('a full ring: 8 frames, loop closed, then the optional tall-tree ring completes the sweep', () => {
    const g = new CaptureGuide({ cam: CAM });
    const start = 211;
    const ring0 = Array.from({ length: 8 }, (_, k) => ({ az: start + 45 * k, alt: 18 }));
    const r0 = run(g, sweep([{ az: start, alt: 0 }, ...ring0], { jitter: 0.08 }));
    expect(r0.captures.map(c => c.dotId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r0.last.ring0).toEqual({ done: 8, total: 8 });
    expect(r0.last.phase).toBe('ring0-done');
    expect(r0.last.canFinish).toBe(true);
    expect(r0.last.complete).toBe(false);
    for (const [k, c] of r0.captures.entries()) {
      const p = cameraPointing({ q: c.qRel, screenAngle: c.screenAngle });
      expect(Math.abs(angleDiffDeg(p.az, start + 45 * k))).toBeLessThan(2.5);
      expect(Math.abs(p.alt - 18)).toBeLessThan(2.5);
    }
    // The last frame (315° from the first) overlaps the first with a 64° view: the loop closes.
    expect(separationDeg(start, 18, start + 315, 18)).toBeLessThan(CAM.hfovDeg);

    g.addRing1();
    const t0 = r0.views.length * (1000 / 60) + 100;
    const ring1 = Array.from({ length: 6 }, (_, k) => ({ az: start + 60 * k, alt: 55 }));
    const r1 = run(g, sweep([{ az: start + 315, alt: 18 }, ...ring1], { start: t0, jitter: 0.08 }));
    expect(r1.captures.map(c => c.ring)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(r1.last.ring1).toEqual({ done: 6, total: 6 });
    expect(r1.last.complete).toBe(true);
    expect(r1.last.phase).toBe('complete');
  });

  it('a dot can be retaken after forget()', () => {
    const g = new CaptureGuide({ cam: CAM });
    const first = run(g, sweep([{ az: 10, alt: 18 }], { holdMs: 500 }));
    expect(first.captures).toHaveLength(1);
    g.forget(0);
    const again = run(g, sweep([{ az: 10, alt: 18 }], { holdMs: 500, start: 10_000 }));
    expect(again.captures.map(c => c.dotId)).toEqual([0]);
  });
});

describe('orientation helpers', () => {
  it('W3C Euler angles: alpha turns the top edge from north towards west; beta tilts it up', () => {
    const near = (a: readonly number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    near(rotateVec(quatFromDeviceOrientation(0, 0, 0), [0, 1, 0]), [0, 1, 0]);
    near(rotateVec(quatFromDeviceOrientation(90, 0, 0), [0, 1, 0]), [-1, 0, 0]);
    near(rotateVec(quatFromDeviceOrientation(0, 90, 0), [0, 1, 0]), [0, 0, 1]);
    // Upright portrait facing north equals the Generic Sensor convention.
    expect(quatAngleDeg(quatFromDeviceOrientation(0, 90, 0), quatFromAxisAngle([1, 0, 0], 90))).toBeCloseTo(0, 6);
    // Gamma rolls about the device y axis: right edge goes down for positive gamma.
    near(rotateVec(quatFromDeviceOrientation(0, 0, 90), [1, 0, 0]), [0, 0, -1]);
  });

  it('averages sign-flipped quaternions and measures angular speed', () => {
    const q = pose(30, 18);
    const avg = averageQuats([q, [-q[0], -q[1], -q[2], -q[3]], pose(31, 18)])!;
    expect(cameraPointing({ q: avg, screenAngle: 90 }).az).toBeCloseTo(30.33, 1);
    const b = new OrientationBuffer();
    for (let i = 0; i <= 30; i++) b.push(pose(i * 0.5, 18), i * (1000 / 60)); // 30 °/s
    expect(b.angularSpeed()).toBeCloseTo(30, 0);
    const held = b.recent(100)!;
    expect(cameraPointing({ q: held.qRel, screenAngle: 90 }).az).toBeGreaterThan(13);
  });
});
