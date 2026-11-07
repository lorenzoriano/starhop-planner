import { describe, expect, it } from 'vitest';
import { bearingDeg, celestialFix, chooseYaw, compassFix, compassInterference, landmarkFix, fixesDisagree } from '../horizon/calibrate/yaw';
import { magneticDeclinationDeg } from '../horizon/calibrate/declination';
import { cameraPointing } from '../horizon/calibrate/camera';
import { angleDiffDeg, applyYaw } from '../horizon/calibrate/quat';
import type { TapTarget } from '../horizon/calibrate/tap-targets';
import type { YawFix } from '../horizon/photo-types';
import { poseFor } from './horizon-calibrate-synth';

const DATE = new Date('2026-11-06T20:00:00Z');
const TURIN = { lat: 45.07, lon: 7.69 };

/** Sweep frames whose compass reads `magOffset` (+ per-frame errors) more than the relative sensor. */
function frames(magOffset: number, errors: number[], screenAngle = 90) {
  return errors.map((e, i) => {
    const qRel = poseFor(15 + 45 * i, 18, 0, screenAngle);
    return { qRel, qAbs: applyYaw(qRel, magOffset + e), screenAngle };
  });
}

describe('compassFix', () => {
  it('median of (absolute − relative) azimuth plus the declination, sigma at least 5°', () => {
    const decl = magneticDeclinationDeg(TURIN.lat, TURIN.lon, DATE);
    const fix = compassFix(frames(-73, [0.3, -0.2, 0.1, 0, -0.4, 0.2, 0.1, -0.1]), TURIN.lat, TURIN.lon, DATE)!;
    expect(fix.source).toBe('compass');
    expect(fix.label).toBe('the compass');
    expect(fix.offsetDeg).toBeCloseTo(-73 + decl, 0);
    expect(Math.abs(fix.offsetDeg - (-73 + decl))).toBeLessThan(0.3);
    expect(fix.sigmaDeg).toBe(5);
  });

  it('is robust to a few disturbed frames and wraps around ±180°', () => {
    const decl = magneticDeclinationDeg(-33.87, 151.21, DATE);
    const fix = compassFix(frames(175, [0, 1, -1, 0.5, 40, -0.5, 30, 0]), -33.87, 151.21, DATE)!;
    expect(Math.abs(angleDiffDeg(fix.offsetDeg, 175 + decl))).toBeLessThan(1);
    expect(fix.offsetDeg).toBeGreaterThan(-180);
    expect(fix.offsetDeg).toBeLessThanOrEqual(180);
  });

  it('a large spread widens sigma and flags interference', () => {
    const noisy = frames(20, [0, 9, -8, 12, -11, 7, -6, 10]);
    const fix = compassFix(noisy, TURIN.lat, TURIN.lon, DATE)!;
    expect(fix.sigmaDeg).toBeGreaterThan(5);
    expect(fix.label).toBe('the compass');
    expect(compassInterference(noisy)).toBe(true);
    expect(compassInterference(frames(20, [0, 0.5, -0.5, 1, -1, 0.2, 0, 0.3]))).toBe(false);
  });

  it('skips frames without a compass reading; null when there are none', () => {
    const f = frames(10, [0, 0, 0]);
    const some = [{ ...f[0], qAbs: null }, f[1], f[2]];
    expect(compassFix(some, TURIN.lat, TURIN.lon, DATE)).not.toBeNull();
    expect(compassFix(f.map((x) => ({ ...x, qAbs: null })), TURIN.lat, TURIN.lon, DATE)).toBeNull();
    expect(compassInterference([])).toBe(false);
  });

  it('works in portrait as well', () => {
    const decl = magneticDeclinationDeg(TURIN.lat, TURIN.lon, DATE);
    const fix = compassFix(frames(33, [0, 0, 0, 0], 0), TURIN.lat, TURIN.lon, DATE)!;
    expect(fix.offsetDeg).toBeCloseTo(33 + decl, 1);
  });
});

describe('celestialFix', () => {
  const target = (source: TapTarget['source'], label: string, az: number, alt: number): TapTarget => ({ source, label, az, alt, mag: 0 });

  it('offset from the body centred in the reticle, plus the pitch error', () => {
    // The relative frame is 40° short of true north; the phone points 0.3° too high.
    const qRel = poseFor(200 - 40, 25.3);
    const { fix, pitchErrorDeg } = celestialFix({ qRel, screenAngle: 90 }, target('sun', 'the Sun', 200, 25));
    expect(fix.offsetDeg).toBeCloseTo(40, 6);
    expect(pitchErrorDeg).toBeCloseTo(0.3, 6);
    expect(fix).toMatchObject({ source: 'sun', label: 'the Sun' });
    expect(fix.sigmaDeg).toBeGreaterThanOrEqual(0.5);
    expect(fix.sigmaDeg).toBeLessThan(0.6);
    // Applying the fix makes the camera point at the body.
    expect(cameraPointing({ q: applyYaw(qRel, fix.offsetDeg), screenAngle: 90 }).az).toBeCloseTo(200, 6);
  });

  it('sigma: Moon 0.5°, planets and stars 0.7°, wider for high bodies', () => {
    const q = poseFor(10, 10, 0, 0);
    expect(celestialFix({ qRel: q, screenAngle: 0 }, target('moon', 'the Moon', 10, 10)).fix.sigmaDeg).toBeCloseTo(0.51, 2);
    expect(celestialFix({ qRel: q, screenAngle: 0 }, target('planet', 'Jupiter', 10, 10)).fix).toMatchObject({ source: 'planet', label: 'Jupiter' });
    expect(celestialFix({ qRel: q, screenAngle: 0 }, target('star', 'Vega', 10, 10)).fix.sigmaDeg).toBeCloseTo(0.71, 2);
    expect(celestialFix({ qRel: poseFor(10, 70), screenAngle: 90 }, target('star', 'Vega', 10, 70)).fix.sigmaDeg).toBeGreaterThan(1.5);
  });

  it('wraps across north', () => {
    const { fix } = celestialFix({ qRel: poseFor(350, 20), screenAngle: 90 }, target('star', 'Capella', 5, 20));
    expect(fix.offsetDeg).toBeCloseTo(15, 6);
  });
});

describe('landmarks and bearings', () => {
  it('bearingDeg: cardinal directions and a known pair', () => {
    expect(bearingDeg(45, 7, 46, 7)).toBeCloseTo(0, 6);
    expect(bearingDeg(45, 7, 44, 7)).toBeCloseTo(180, 6);
    expect(bearingDeg(0, 7, 0, 8)).toBeCloseTo(90, 6);
    expect(bearingDeg(0, 8, 0, 7)).toBeCloseTo(270, 6);
    // Turin → Monte Rosa (Dufourspitze): roughly north-north-east.
    const b = bearingDeg(45.07, 7.69, 45.9369, 7.8668);
    expect(b).toBeGreaterThan(5);
    expect(b).toBeLessThan(15);
  });

  it('landmarkFix: true bearing minus relative azimuth', () => {
    expect(landmarkFix(100, 130)).toEqual({ source: 'landmark', offsetDeg: 30, sigmaDeg: 1, label: 'the landmark' });
    expect(landmarkFix(350, 10, 0.5).offsetDeg).toBeCloseTo(20, 9);
    expect(landmarkFix(10, 350).offsetDeg).toBeCloseTo(-20, 9);
  });
});

describe('chooseYaw', () => {
  const compass: YawFix = { source: 'compass', offsetDeg: 54, sigmaDeg: 5, label: 'the compass' };
  const sun: YawFix = { source: 'sun', offsetDeg: 40, sigmaDeg: 0.5, label: 'the Sun' };
  const hills: YawFix = { source: 'terrain', offsetDeg: 40.6, sigmaDeg: 1, label: 'the hills' };

  it('null without fixes; one fix is chosen without comment', () => {
    expect(chooseYaw([])).toBeNull();
    expect(chooseYaw([compass])).toEqual({ chosen: compass, fixes: [compass] });
  });

  it('smallest sigma wins and a big disagreement is worded plainly', () => {
    // 8° is within 2 combined sigma of a 5° compass: no comment; 14° is not.
    expect(chooseYaw([{ ...compass, offsetDeg: 48 }, sun])!.disagreement).toBeUndefined();
    expect(chooseYaw([compass, sun])!.disagreement).toBe('The compass disagrees with the Sun by 14°; using the Sun.');
    const c = chooseYaw([{ ...compass, offsetDeg: 56, sigmaDeg: 4 }, sun])!;
    expect(c.chosen).toBe(sun);
    expect(c.fixes).toHaveLength(2);
    expect(c.disagreement).toBe('The compass disagrees with the Sun by 16°; using the Sun.');
  });

  it('agreement within 2 combined sigma says nothing', () => {
    const c = chooseYaw([{ ...compass, offsetDeg: 48 }, sun, hills])!;
    expect(c.chosen).toBe(sun);
    expect(c.disagreement).toBeUndefined();
  });

  it('reports the worst disagreement, small ones with a decimal', () => {
    const c = chooseYaw([hills, sun, { ...compass, offsetDeg: 80 }])!;
    expect(c.disagreement).toBe('The compass disagrees with the Sun by 40°; using the Sun.');
    const d = chooseYaw([sun, { ...hills, offsetDeg: 43.6 }])!;
    expect(d.disagreement).toBe('The hills disagree with the Sun by 3.6°; using the Sun.');
    const e = chooseYaw([{ ...sun, offsetDeg: 37 }, hills])!;
    expect(e.disagreement).toBe('The hills disagree with the Sun by 3.6°; using the Sun.');
  });

  it('flags a biased compass whose own spread is large (25° bias + 8° deviation, as in the simulation)', () => {
    const c = chooseYaw([{ source: 'compass', offsetDeg: 114.87, sigmaDeg: 7.73, label: 'the compass' }, { ...sun, offsetDeg: 137.42, sigmaDeg: 0.56 }])!;
    expect(c.chosen.source).toBe('sun');
    expect(c.disagreement).toBe('The compass disagrees with the Sun by 23°; using the Sun.');
  });

  it('fixesDisagree: more than max(3°, 2 combined sigma)', () => {
    expect(fixesDisagree(10, 5, 0.5)).toBe(false); // 2σ = 10.05
    expect(fixesDisagree(10.1, 5, 0.5)).toBe(true);
    expect(fixesDisagree(-2.9, 0.3, 0.3)).toBe(false); // the 3° floor
    expect(fixesDisagree(-3.1, 0.3, 0.3)).toBe(true);
  });

  it('never comments on differences under 3°, however small the sigmas', () => {
    const moon: YawFix = { source: 'moon', offsetDeg: 42.5, sigmaDeg: 0.5, label: 'the Moon' };
    expect(chooseYaw([sun, moon])!.disagreement).toBeUndefined();
    expect(chooseYaw([sun, { ...moon, offsetDeg: 43.2 }])!.disagreement).toBe('The Moon disagrees with the Sun by 3.2°; using the Sun.');
  });

  it('wraps around ±180° when comparing', () => {
    const c = chooseYaw([{ ...compass, offsetDeg: -178 }, { ...sun, offsetDeg: 179 }])!;
    expect(c.disagreement).toBeUndefined();
  });

  it('ignores fixes with invalid numbers', () => {
    const c = chooseYaw([{ ...sun, sigmaDeg: NaN }, compass])!;
    expect(c.chosen).toBe(compass);
    expect(c.fixes).toEqual([compass]);
  });
});
