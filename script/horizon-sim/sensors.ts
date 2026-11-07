/**
 * Sensor model (design 10.2 step 3): per video frame, what the phone's sensors report for the true pose.
 *
 *   npx tsx script/horizon-sim/sensors.ts --scenario day-sun-hills
 *
 * - relative-orientation = Rz(northOffset + drift(t)) · truth. Gyro drift about the vertical: bias (°/s) plus a random
 *   walk. With applyYaw's convention: true az = relative az + northOffset + drift(t).
 * - absolute-orientation (MAGNETIC north) = Rz(declination + compass bias + deviation·sin(heading + phase) + noise) ·
 *   truth: true az = magnetic az + declination + compass error.
 * - accelerometer (m/s², device frame, gravity only + noise) and gyroscope (rad/s, device frame) from the pose sequence.
 * - Quaternions are quantised (components to 0.001, ≈ 0.1°) like Chrome's privacy rounding.
 * Writes sensors.json next to poses.json.
 */
import path from 'node:path';
import fs from 'node:fs';
import { cameraPointing } from '../../client/src/lib/horizon/calibrate/camera';
import {
  angleDiffDeg, quatConjugate, quatFromAxisAngle, quatMultiply, quatNormalize, rotateVec, type Quat,
} from '../../client/src/lib/horizon/calibrate/quat';
import { args, gaussian, rng, writeJson } from './lib/common';
import { loadTruth, sceneDir, type Truth } from './make-scene';
import type { PosesFile } from './make-video';
import { scenario } from './scenarios';

export interface SensorFrame {
  rel: Quat;
  abs: Quat;
  acc: [number, number, number];
  gyro: [number, number, number];
  /** Truth bookkeeping: drift (°) and compass error (°, excluding declination) at this frame. */
  driftDeg: number;
  compassErrDeg: number;
}

const G = 9.80665;

function quantise(q: Quat): Quat {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const n = quatNormalize([r(q[0]), r(q[1]), r(q[2]), r(q[3])]);
  return n[3] < 0 ? [-n[0], -n[1], -n[2], -n[3]] : n;
}

export function simulateSensors(truth: Truth, poses: PosesFile): SensorFrame[] {
  const s = truth.scenario, r = rng(s.seed * 7 + 99);
  const dt = 1 / poses.fps;
  let walk = 0;
  const out: SensorFrame[] = [];
  const zAxis = [0, 0, 1] as const;
  for (const f of poses.frames) {
    if (f.i > 0) walk += gaussian(r) * truth.gyro.walkDegPerRootSec * Math.sqrt(dt);
    const drift = truth.gyro.biasDegPerSec * f.t + walk;
    const rel = quatMultiply(quatFromAxisAngle(zAxis, truth.northOffsetDeg + drift), f.q);
    const compassErr = truth.compass.biasDeg + truth.compass.deviationDeg * Math.sin(((f.az + truth.compass.deviationPhaseDeg) * Math.PI) / 180) +
      gaussian(r) * truth.compass.noiseDeg;
    const abs = quatMultiply(quatFromAxisAngle(zAxis, truth.declinationDeg + compassErr), f.q);
    const g = rotateVec(quatConjugate(f.q), [0, 0, G]);
    const next = poses.frames[Math.min(poses.frames.length - 1, f.i + 1)];
    const dq = quatMultiply(quatConjugate(f.q), next.q);
    const sign = dq[3] < 0 ? -1 : 1;
    const vn = Math.hypot(dq[0], dq[1], dq[2]);
    const angle = 2 * Math.atan2(vn, Math.abs(dq[3]));
    const k = vn > 1e-12 ? (sign * angle) / vn / dt : 0;
    const noise = () => gaussian(r);
    out.push({
      rel: quantise(rel),
      abs: quantise(abs),
      acc: [g[0] + 0.02 * noise(), g[1] + 0.02 * noise(), g[2] + 0.02 * noise()],
      gyro: [dq[0] * k + 0.002 * noise(), dq[1] * k + 0.002 * noise(), dq[2] * k + 0.002 * noise()],
      driftDeg: drift,
      compassErrDeg: compassErr,
    });
  }
  return out;
}

export function loadPoses(name: string): PosesFile {
  return JSON.parse(fs.readFileSync(path.join(sceneDir(name), 'poses.json'), 'utf8')) as PosesFile;
}

export function loadSensors(name: string): SensorFrame[] {
  return JSON.parse(fs.readFileSync(path.join(sceneDir(name), 'sensors.json'), 'utf8')) as SensorFrame[];
}

if (process.argv[1]?.endsWith('sensors.ts')) {
  const name = scenario(args().scenario).name;
  const truth = loadTruth(name), poses = loadPoses(name);
  const frames = simulateSensors(truth, poses);
  writeJson(path.join(sceneDir(name), 'sensors.json'), frames);
  // Self-check: recover the truth from the readings with the app's camera model.
  let relErr = 0, absErr = 0, altErr = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = poses.frames[i], s = frames[i];
    const pr = cameraPointing({ q: s.rel, screenAngle: 90 }), pa = cameraPointing({ q: s.abs, screenAngle: 90 });
    relErr = Math.max(relErr, Math.abs(angleDiffDeg(pr.az + truth.northOffsetDeg + s.driftDeg, f.az)));
    absErr = Math.max(absErr, Math.abs(angleDiffDeg(pa.az + truth.declinationDeg + s.compassErrDeg, f.az)));
    altErr = Math.max(altErr, Math.abs(pr.alt - f.alt));
  }
  const last = frames[frames.length - 1];
  console.log(`${frames.length} frames; max |rel az + offset + drift − true| = ${relErr.toFixed(3)}°, ` +
    `max |abs az + decl + err − true| = ${absErr.toFixed(3)}°, max pitch err ${altErr.toFixed(3)}°, final drift ${last.driftDeg.toFixed(3)}°`);
}
