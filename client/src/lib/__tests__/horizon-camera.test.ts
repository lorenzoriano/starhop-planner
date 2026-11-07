import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg, applyYaw, azAltFromVec, circularMeanDeg, circularMedianDeg, IDENTITY, quatAngleDeg, quatFromAxisAngle,
  quatMultiply, rotateVec, vecFromAzAlt,
} from '../horizon/calibrate/quat';
import { azAltToPixel, cameraPointing, pixelToAzAlt, screenAxes, vfovDeg, type CameraIntrinsics } from '../horizon/calibrate/camera';

// Phone upright in portrait, camera facing north and level: device y → up, device z (towards the user) → south.
const PORTRAIT_NORTH = quatFromAxisAngle([1, 0, 0], 90);
// The same, turned counter-clockwise into landscape (top edge to the left): screen.orientation.angle 90.
const LANDSCAPE_NORTH = quatMultiply(PORTRAIT_NORTH, quatFromAxisAngle([0, 0, 1], 90));
const CAM: CameraIntrinsics = { width: 1280, height: 960, hfovDeg: 64 };

describe('quaternion conventions', () => {
  it('identity: flat phone, top edge north, screen up', () => {
    expect(rotateVec(IDENTITY, [0, 1, 0])).toEqual([0, 1, 0]);
  });

  it('upright portrait facing north maps the device axes to east / up / south', () => {
    const near = (a: readonly number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
    near(rotateVec(PORTRAIT_NORTH, [1, 0, 0]), [1, 0, 0]);
    near(rotateVec(PORTRAIT_NORTH, [0, 1, 0]), [0, 0, 1]);
    near(rotateVec(PORTRAIT_NORTH, [0, 0, 1]), [0, -1, 0]);
    near(rotateVec(LANDSCAPE_NORTH, [0, 1, 0]), [-1, 0, 0]); // top edge points west
  });

  it('az/alt round-trip', () => {
    for (const [az, alt] of [[0, 0], [90, 10], [225, -5], [359.5, 45]]) {
      const r = azAltFromVec(vecFromAzAlt(az, alt));
      expect(angleDiffDeg(r.az, az)).toBeCloseTo(0, 9);
      expect(r.alt).toBeCloseTo(alt, 9);
    }
  });

  it('applyYaw adds the offset to every azimuth', () => {
    const q = applyYaw(PORTRAIT_NORTH, 30);
    expect(cameraPointing({ q, screenAngle: 0 }).az).toBeCloseTo(30, 9);
    expect(quatAngleDeg(q, PORTRAIT_NORTH)).toBeCloseTo(30, 9);
  });

  it('angle helpers wrap', () => {
    expect(angleDiffDeg(1, 359)).toBeCloseTo(2);
    expect(angleDiffDeg(359, 1)).toBeCloseTo(-2);
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0, 9);
    expect(circularMedianDeg([355, 2, 5, 120])).toBe(2);
  });
});

describe('camera model', () => {
  it('screen axes for portrait and both landscapes', () => {
    expect(screenAxes(0)).toMatchObject({ right: [1, 0, 0], up: [0, 1, 0] });
    expect(screenAxes(90)).toMatchObject({ right: [0, -1, 0], up: [1, 0, 0] });
    expect(screenAxes(270)).toMatchObject({ right: [0, 1, 0], up: [-1, 0, 0] });
  });

  for (const [name, q, screenAngle] of [['portrait', PORTRAIT_NORTH, 0], ['landscape', LANDSCAPE_NORTH, 90]] as const) {
    it(`${name}: centre looks north and level, right is east, up is higher`, () => {
      const pose = { q, screenAngle };
      const p = cameraPointing(pose);
      expect(p.az).toBeCloseTo(0, 9);
      expect(p.alt).toBeCloseTo(0, 9);
      expect(p.roll).toBeCloseTo(0, 9);
      const right = pixelToAzAlt(pose, CAM, CAM.width, CAM.height / 2);
      expect(right.az).toBeCloseTo(32, 9);
      expect(right.alt).toBeCloseTo(0, 9);
      const top = pixelToAzAlt(pose, CAM, CAM.width / 2, 0);
      expect(top.alt).toBeCloseTo(vfovDeg(CAM) / 2, 9);
    });
  }

  it('turning the phone clockwise gives a positive roll', () => {
    const q = quatMultiply(LANDSCAPE_NORTH, quatFromAxisAngle([0, 0, 1], -5)); // clockwise as seen by the user
    expect(cameraPointing({ q, screenAngle: 90 }).roll).toBeCloseTo(5, 9);
  });

  it('pixel ⇄ world round-trips with distortion, any pose', () => {
    const q = quatMultiply(quatFromAxisAngle([0, 0, 1], -137), quatMultiply(quatFromAxisAngle([1, 0, 0], 108), quatFromAxisAngle([0, 0, 1], 87)));
    for (const k1 of [0, -0.08, 0.05]) {
      const cam = { ...CAM, k1 };
      for (const [u, v] of [[0, 0], [640, 480], [1200, 100], [33, 900]]) {
        const { az, alt } = pixelToAzAlt({ q, screenAngle: 90 }, cam, u, v);
        const back = azAltToPixel({ q, screenAngle: 90 }, cam, az, alt)!;
        expect(back.u).toBeCloseTo(u, 6);
        expect(back.v).toBeCloseTo(v, 6);
      }
    }
  });

  it('directions behind the camera have no pixel', () => {
    expect(azAltToPixel({ q: PORTRAIT_NORTH, screenAngle: 0 }, CAM, 180, 0)).toBeNull();
  });
});
