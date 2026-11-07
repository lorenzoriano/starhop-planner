/**
 * Camera and motion script (design 10.2 step 2): a trajectory that follows the capture guide, rendered from the
 * scene's world image with the app's camera model.
 *
 *   npx tsx script/horizon-sim/make-video.ts --scenario day-sun-hills [--snapshots]
 *
 * Trajectory (true azimuths; the guide's dots are relative to the first heading, so they coincide up to gyro drift):
 *   start hold at dot 0 (+18°, the scenario's start heading) → ring 0: dots every 45° (move at 60°/s, hold 1.5 s; dot 0
 *   closes the loop) → optional ring 1 (6 dots at +55°) → alignment pose on the Sun/Moon (hold) →
 *   back to the start pose, so the looping fake camera stays continuous.
 * Camera: landscape (screen angle 90), 1280 × 948 logical image + a 12-px barcode strip = 1280 × 960 video, 30 fps,
 * pinhole + k1 (camera.ts). Optional stabilisation-crop model shifts the principal point with angular speed.
 *
 * Writes scene.y4m (streamed) and poses.json (true pose per frame, phases and tap window) to the scenario folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { focalPx, pixelToWorld } from '../../client/src/lib/horizon/calibrate/camera';
import { angleDiffDeg, IDENTITY, quatAngleDeg, type Quat } from '../../client/src/lib/horizon/calibrate/quat';
import { args, BARCODE, barcodeCells, encodePng, matrixFromQuat, poseQuat, RAD, rng, writeJson, Y4mWriter } from './lib/common';
import { CAMERA, loadTruth, loadWorld, sceneDir, type Truth } from './make-scene';
import { scenario } from './scenarios';

export interface FramePose {
  i: number;
  t: number;
  az: number;
  alt: number;
  roll: number;
  q: Quat;
  /** Angular speed of the camera, °/s. */
  speed: number;
  phase: string;
  /** Guide dot being held (ring 0: 0–7, ring 1: 10–15), or −1 while moving. */
  dot: number;
}

export interface PosesFile {
  fps: number;
  frames: FramePose[];
  screenAngle: number;
  /** Frame windows (inclusive) of the holds, by phase name. */
  windows: Record<string, [number, number]>;
  durationSec: number;
}

interface Key { az: number; alt: number; roll: number; hold: number; phase: string; dot: number }

const SPEED = 60, HOLD = 1.5;

function keyframes(truth: Truth): Key[] {
  const s = truth.scenario, r = rng(s.seed * 31 + 5);
  const roll = () => (r() - 0.5) * 3;
  const keys: Key[] = [{ az: s.startAzDeg, alt: 18, roll: roll(), hold: 2.5, phase: 'start', dot: 0 }];
  for (let k = 1; k < 8; k++) keys.push({ az: s.startAzDeg + 45 * k, alt: 18, roll: roll(), hold: HOLD, phase: `ring0-${k}`, dot: k });
  // The guide closes the loop with dot 0 (taken at the start), so the sweep goes straight on.
  if (s.ring1) for (let k = 0; k < 6; k++) keys.push({ az: s.startAzDeg + 360 + 60 * k, alt: 55, roll: roll(), hold: HOLD, phase: `ring1-${k}`, dot: 10 + k });
  if (truth.tapTarget) keys.push({ az: truth.tapTarget.az, alt: truth.tapTarget.alt, roll: roll(), hold: 3.5, phase: 'align', dot: -1 });
  else keys.push({ az: s.startAzDeg + 20, alt: 18, roll: roll(), hold: 2.5, phase: 'align', dot: -1 });
  keys.push({ az: s.startAzDeg, alt: 18, roll: keys[0].roll, hold: 1, phase: 'return', dot: 0 });
  return keys;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function buildTrajectory(truth: Truth, fps = CAMERA.fps): PosesFile {
  const keys = keyframes(truth);
  // Segments: hold at key i, then move to key i+1.
  type Seg = { t0: number; t1: number; from: Key; to: Key; move: boolean };
  const segs: Seg[] = [];
  let t = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    segs.push({ t0: t, t1: t + k.hold, from: k, to: k, move: false });
    t += k.hold;
    const next = keys[i + 1];
    if (next) {
      const dAz = angleDiffDeg(next.az, k.az), dAlt = next.alt - k.alt;
      const ang = Math.hypot(dAz * Math.cos(((k.alt + next.alt) / 2) * RAD), dAlt);
      const dur = Math.max(0.3, ang / SPEED);
      segs.push({ t0: t, t1: t + dur, from: k, to: next, move: true });
      t += dur;
    }
  }
  const duration = t, n = Math.round(duration * fps);
  const frames: FramePose[] = [];
  const windows: Record<string, [number, number]> = {};
  let si = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / fps;
    while (si < segs.length - 1 && tt >= segs[si].t1) si++;
    const sg = segs[si];
    let az: number, alt: number, roll: number;
    if (sg.move) {
      const u = smooth((tt - sg.t0) / (sg.t1 - sg.t0));
      az = sg.from.az + angleDiffDeg(sg.to.az, sg.from.az) * u;
      alt = sg.from.alt + (sg.to.alt - sg.from.alt) * u;
      roll = sg.from.roll + (sg.to.roll - sg.from.roll) * u;
    } else {
      // A steady hand: tremor of a few hundredths of a degree.
      az = sg.from.az + 0.015 * Math.sin(2 * Math.PI * 1.3 * tt) / Math.cos(sg.from.alt * RAD);
      alt = sg.from.alt + 0.012 * Math.sin(2 * Math.PI * 2.1 * tt + 1);
      roll = sg.from.roll;
      const w = windows[sg.from.phase];
      windows[sg.from.phase] = w ? [w[0], i] : [i, i];
    }
    az = ((az % 360) + 360) % 360;
    frames.push({ i, t: tt, az, alt, roll, q: poseQuat(az, alt, roll, 90), speed: 0, phase: sg.move ? 'move' : sg.from.phase, dot: sg.move ? -1 : sg.from.dot });
  }
  for (let i = 0; i < n; i++) {
    const a = frames[Math.max(0, i - 1)], b = frames[Math.min(n - 1, i + 1)];
    frames[i].speed = (quatAngleDeg(a.q, b.q) * fps) / Math.max(1, b.i - a.i);
  }
  return { fps, frames, screenAngle: 90, windows, durationSec: duration };
}

/** Render one frame (RGB, 1280 × 960 including the barcode strip). */
function renderFrame(
  out: Uint8Array, world: Uint8Array, WW: number, WH: number, q: Quat, rays: Float32Array | null,
  cam: { width: number; height: number; hfovDeg: number; k1: number }, shift: [number, number], frameNo: number,
) {
  const W = cam.width, H = cam.height, VH = CAMERA.videoHeight;
  const M = matrixFromQuat(q);
  const f = focalPx(cam);
  const sx = WW / 360, sy = WH / 180;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      let x: number, y: number;
      if (rays) { const k = (v * W + u) * 2; x = rays[k]; y = rays[k + 1]; }
      else { x = (u + 0.5 + shift[0] - W / 2) / f; y = (H / 2 - (v + 0.5 + shift[1])) / f; }
      // Landscape (screen angle 90): right = (0, −1, 0), up = (1, 0, 0), forward = (0, 0, −1) in device coordinates.
      const dx = y, dy = -x, dz = -1;
      const wx = M[0][0] * dx + M[0][1] * dy + M[0][2] * dz;
      const wy = M[1][0] * dx + M[1][1] * dy + M[1][2] * dz;
      const wz = M[2][0] * dx + M[2][1] * dy + M[2][2] * dz;
      const az = Math.atan2(wx, wy) / RAD, alt = Math.asin(wz / Math.sqrt(wx * wx + wy * wy + wz * wz)) / RAD;
      // Bilinear sample of the equirect (pixel centres at +0.5).
      let fx = (az < 0 ? az + 360 : az) * sx - 0.5, fy = (90 - alt) * sy - 0.5;
      if (fy < 0) fy = 0; else if (fy > WH - 1.001) fy = WH - 1.001;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const xa = ((x0 % WW) + WW) % WW, xb = (xa + 1) % WW;
      const i00 = (y0 * WW + xa) * 3, i10 = (y0 * WW + xb) * 3, i01 = ((y0 + 1) * WW + xa) * 3, i11 = ((y0 + 1) * WW + xb) * 3;
      const o = (v * W + u) * 3;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (world[i00 + c] * (1 - ax) + world[i10 + c] * ax) * (1 - ay) + (world[i01 + c] * (1 - ax) + world[i11 + c] * ax) * ay + 0.5;
      }
    }
  }
  const cells = barcodeCells(frameNo), cw = W / BARCODE.cells;
  for (let v = H; v < VH; v++) for (let u = 0; u < W; u++) {
    const val = cells[Math.floor(u / cw)] ? 235 : 20, o = (v * W + u) * 3;
    out[o] = out[o + 1] = out[o + 2] = val;
  }
}

export function makeVideo(name: string, opts: { snapshots?: boolean } = {}) {
  const truth = loadTruth(name);
  const world = loadWorld(truth);
  const dir = sceneDir(name);
  const traj = buildTrajectory(truth);
  const cam = { width: CAMERA.width, height: CAMERA.height, hfovDeg: truth.camera.hfovDeg, k1: truth.camera.k1 };
  // Undistorted normalised coordinates per pixel when k1 ≠ 0 (Newton inside pixelToWorld; pose-independent).
  let rays: Float32Array | null = null;
  if (cam.k1) {
    rays = new Float32Array(cam.width * cam.height * 2);
    for (let v = 0; v < cam.height; v++) for (let u = 0; u < cam.width; u++) {
      const d = pixelToWorld({ q: IDENTITY, screenAngle: 90 }, cam, u + 0.5, v + 0.5);
      // Device d = (y, −x, −1)/n → x = −d.y/−d.z… solve back to the normalised (x, y).
      rays[(v * cam.width + u) * 2] = d[1] / d[2];
      rays[(v * cam.width + u) * 2 + 1] = -d[0] / d[2];
    }
    if (truth.scenario.stabPxPerDegPerSec) console.warn('stabilisation crop is ignored when k1 ≠ 0');
  }
  const file = path.join(dir, 'scene.y4m');
  const y4m = new Y4mWriter(file, cam.width, CAMERA.videoHeight, traj.fps);
  const rgb = new Uint8Array(cam.width * CAMERA.videoHeight * 3);
  const snaps = new Set<number>();
  if (opts.snapshots) for (const [phase, w] of Object.entries(traj.windows)) if (/start|align|ring0-2|ring1-0/.test(phase)) snaps.add(Math.round((w[0] + w[1]) / 2));
  const t0 = Date.now();
  const stab = truth.scenario.stabPxPerDegPerSec;
  for (const fr of traj.frames) {
    let shift: [number, number] = [0, 0];
    if (stab && !rays) {
      const prev = traj.frames[Math.max(0, fr.i - 1)];
      const yawRate = angleDiffDeg(fr.az, prev.az) * traj.fps * Math.cos(fr.alt * RAD), pitchRate = (fr.alt - prev.alt) * traj.fps;
      // The stabiliser lags the motion: the crop window slides against the rotation.
      shift = [-stab * yawRate, stab * pitchRate];
    }
    renderFrame(rgb, world, truth.world.width, truth.world.height, fr.q, rays, cam, shift, fr.i);
    y4m.write(rgb);
    if (snaps.has(fr.i)) fs.writeFileSync(path.join(dir, `frame-${fr.i}-${fr.phase}.png`), encodePng(cam.width, CAMERA.videoHeight, rgb, 3));
    if (fr.i % 100 === 0) process.stdout.write(`\rframe ${fr.i}/${traj.frames.length}`);
  }
  y4m.close();
  console.log(`\n${traj.frames.length} frames (${traj.durationSec.toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file} (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);
  writeJson(path.join(dir, 'poses.json'), traj);
  return traj;
}

if (process.argv[1]?.endsWith('make-video.ts')) {
  const a = args();
  makeVideo(scenario(a.scenario).name, { snapshots: a.snapshots === 'true' });
}
