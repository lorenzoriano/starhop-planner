/**
 * Ring guide for the camera sweep (docs/local-horizon-design.md, section 9 phase 2). Pure: feed it orientation samples,
 * it says where the dots are on the preview, which way to turn, and when to take a frame. No DOM, no timers.
 *
 * - Dots are fixed in the RELATIVE sensor frame, placed from the camera's azimuth at the first sample:
 *   ring 0 = 8 dots at +18° every 45°; optional ring 1 = 6 dots at +55° every 60°. The last ring-0 frame overlaps the
 *   first, which closes the loop.
 * - A frame is due when the image centre (the reticle) is within 2.5° of a pending dot and the phone has turned slower
 *   than 2°/s for 300 ms. The capture carries the orientation averaged over that still period.
 * - The sweep is complete when ring 0 is done (and ring 1, once started). "Finish sweep" is allowed once ring 0 is done.
 */
import { azAltToPixel, cameraPointing, type CameraIntrinsics } from '../calibrate/camera';
import { angleDiffDeg, quatAngleDeg, vecFromAzAlt, type Quat } from '../calibrate/quat';
import { averageQuats } from './sensors';

const RAD = Math.PI / 180;

export interface GuideOptions {
  /** Preview camera (size as delivered and a field-of-view guess), for drawing the dots. */
  cam: CameraIntrinsics;
  ring0AltDeg?: number;
  ring0Count?: number;
  ring1AltDeg?: number;
  ring1Count?: number;
  /** Reticle-to-dot distance that counts as "on the dot", degrees. */
  toleranceDeg?: number;
  /** Turning slower than this counts as still, °/s. */
  stillDegPerSec?: number;
  /** How long to hold still before the frame is taken, ms. */
  holdMs?: number;
}

export interface GuideSample {
  qRel: Quat;
  qAbs: Quat | null;
  /** ms, any monotonic time base. */
  t: number;
  /** screen.orientation.angle. */
  screenAngle: number;
}

export interface GuideDot {
  id: number;
  ring: 0 | 1;
  /** Relative-frame azimuth and altitude of the dot, degrees. */
  az: number;
  alt: number;
  done: boolean;
}

export interface DotOnScreen extends GuideDot {
  /** Position in the camera image (pixels of `cam`), or null when behind the camera. */
  u: number | null;
  v: number | null;
  /** Inside the image (with a small margin). */
  visible: boolean;
  /** The dot the hint is steering to. */
  target: boolean;
}

/** A frame is due: grab the current camera frame and attach these readings. */
export interface GuideCapture {
  dotId: number;
  ring: 0 | 1;
  qRel: Quat;
  qAbs: Quat | null;
  screenAngle: number;
  t: number;
  /** Mean angular speed during the hold, °/s. */
  stillDegPerSec: number;
}

export type GuidePhase = 'ring0' | 'ring0-done' | 'ring1' | 'complete';

export interface GuideView {
  phase: GuidePhase;
  dots: DotOnScreen[];
  target: GuideDot | null;
  /** Short instruction for the user, or null when nothing to say. */
  hint: string | null;
  /** Captured / total dots per ring (ring 1 is null until started). */
  ring0: { done: number; total: number };
  ring1: { done: number; total: number } | null;
  /** 0…1 progress of the current still hold. */
  holding: number;
  /** Angular speed now, °/s. */
  speed: number;
  /** Where the reticle points in the relative frame. */
  pointing: { az: number; alt: number; roll: number } | null;
  canFinish: boolean;
  complete: boolean;
  /** Set once, on the update where a frame is due. */
  capture: GuideCapture | null;
}

/** Angle between two az/alt directions, degrees. */
export function separationDeg(az1: number, alt1: number, az2: number, alt2: number): number {
  const a = vecFromAzAlt(az1, alt1), b = vecFromAzAlt(az2, alt2);
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) / RAD;
}

const isLandscape = (screenAngle: number) => Math.abs(((screenAngle % 180) + 180) % 180 - 90) < 1;

/** Speed is measured over at least this baseline, so 0.1° sensor rounding does not look like motion. */
const SPEED_BASELINE_MS = 120;

export class CaptureGuide {
  private opts: Required<GuideOptions>;
  private dots: GuideDot[] = [];
  private originAz: number | null = null;
  private ring1Started = false;
  private recent: GuideSample[] = [];
  private hold: { dotId: number; since: number; samples: GuideSample[]; speeds: number[] } | null = null;

  constructor(opts: GuideOptions) {
    this.opts = {
      ring0AltDeg: 18, ring0Count: 8, ring1AltDeg: 55, ring1Count: 6, toleranceDeg: 2.5, stillDegPerSec: 2, holdMs: 300,
      ...opts,
    };
  }

  setCamera(cam: CameraIntrinsics) { this.opts.cam = cam; }

  /** Relative azimuth of the first dot (the first heading), or null before the first sample. */
  get origin(): number | null { return this.originAz; }

  /** Add the optional high ring (tall trees), starting from the same first heading. */
  addRing1() {
    if (this.ring1Started || this.originAz === null) return;
    this.ring1Started = true;
    const n = this.opts.ring1Count, base = this.dots.length;
    for (let k = 0; k < n; k++) {
      this.dots.push({ id: base + k, ring: 1, az: norm(this.originAz + (360 / n) * k), alt: this.opts.ring1AltDeg, done: false });
    }
  }

  /** Mark a dot pending again (the frame grab failed or the user wants to retake it). */
  forget(dotId: number) {
    const d = this.dots.find(x => x.id === dotId);
    if (d) d.done = false;
  }

  private ringDone(ring: 0 | 1) {
    const list = this.dots.filter(d => d.ring === ring);
    return list.length > 0 && list.every(d => d.done);
  }

  private phase(): GuidePhase {
    if (!this.ringDone(0)) return 'ring0';
    if (!this.ring1Started) return 'ring0-done';
    return this.ringDone(1) ? 'complete' : 'ring1';
  }

  private speedAt(sample: GuideSample): number {
    // Oldest sample within the baseline window (but not the sample itself).
    let ref: GuideSample | null = null;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const r = this.recent[i];
      if (r.t >= sample.t) continue;
      ref = r;
      if (sample.t - r.t >= SPEED_BASELINE_MS) break;
    }
    if (!ref) return 0;
    return quatAngleDeg(ref.qRel, sample.qRel) / ((sample.t - ref.t) / 1000);
  }

  update(sample: GuideSample): GuideView {
    const { cam, toleranceDeg, stillDegPerSec, holdMs } = this.opts;
    const pose = { q: sample.qRel, screenAngle: sample.screenAngle };
    const pointing = cameraPointing(pose);
    if (this.originAz === null) {
      this.originAz = pointing.az;
      const n = this.opts.ring0Count;
      for (let k = 0; k < n; k++) this.dots.push({ id: k, ring: 0, az: norm(pointing.az + (360 / n) * k), alt: this.opts.ring0AltDeg, done: false });
    }
    const speed = this.speedAt(sample);
    this.recent.push(sample);
    while (this.recent.length > 2 && sample.t - this.recent[0].t > 1000) this.recent.shift();

    const phase = this.phase();
    const activeRing: 0 | 1 = phase === 'ring0' ? 0 : 1;
    const pending = this.dots.filter(d => !d.done && (d.ring === 0 || this.ring1Started));
    const dist = (d: GuideDot) => separationDeg(pointing.az, pointing.alt, d.az, d.alt);
    // Steer to the nearest pending dot of the active ring (ring 0 first).
    const candidates = pending.filter(d => d.ring === activeRing);
    const target = (candidates.length ? candidates : pending).reduce<GuideDot | null>((best, d) => (!best || dist(d) < dist(best) ? d : best), null);
    // Any pending dot under the reticle can be taken, not only the target.
    const onDot = pending.find(d => dist(d) <= toleranceDeg) ?? null;
    const landscape = isLandscape(sample.screenAngle);

    let capture: GuideCapture | null = null;
    let holding = 0;
    if (onDot && landscape && speed < stillDegPerSec) {
      if (!this.hold || this.hold.dotId !== onDot.id) this.hold = { dotId: onDot.id, since: sample.t, samples: [], speeds: [] };
      this.hold.samples.push(sample);
      this.hold.speeds.push(speed);
      holding = Math.min(1, (sample.t - this.hold.since) / holdMs);
      if (sample.t - this.hold.since >= holdMs) {
        const qs = this.hold.samples.map(s => s.qRel);
        const abs = this.hold.samples.map(s => s.qAbs).filter((q): q is Quat => !!q);
        capture = {
          dotId: onDot.id,
          ring: onDot.ring,
          qRel: averageQuats(qs) ?? sample.qRel,
          qAbs: averageQuats(abs),
          screenAngle: sample.screenAngle,
          t: sample.t,
          stillDegPerSec: this.hold.speeds.reduce((a, b) => a + b, 0) / this.hold.speeds.length,
        };
        onDot.done = true;
        this.hold = null;
        holding = 0;
      }
    } else {
      this.hold = null;
    }

    const after = this.phase();
    const nextTarget = capture ? null : target;
    const hint = capture ? 'Got it' : this.hintFor(landscape, pointing, nextTarget, onDot, speed, after);
    const dots: DotOnScreen[] = this.dots
      .filter(d => d.ring === 0 || this.ring1Started)
      .map(d => {
        const p = azAltToPixel(pose, cam, d.az, d.alt);
        const margin = 0.05 * Math.max(cam.width, cam.height);
        const visible = !!p && p.u >= -margin && p.u <= cam.width + margin && p.v >= -margin && p.v <= cam.height + margin;
        return { ...d, u: p?.u ?? null, v: p?.v ?? null, visible, target: !!nextTarget && d.id === nextTarget.id };
      });
    const count = (ring: 0 | 1) => {
      const list = this.dots.filter(d => d.ring === ring);
      return { done: list.filter(d => d.done).length, total: list.length };
    };
    return {
      phase: after,
      dots,
      target: nextTarget,
      hint,
      ring0: count(0),
      ring1: this.ring1Started ? count(1) : null,
      holding,
      speed,
      pointing,
      canFinish: after !== 'ring0',
      complete: after === 'complete',
      capture,
    };
  }

  private hintFor(landscape: boolean, pointing: { az: number; alt: number; roll: number }, target: GuideDot | null, onDot: GuideDot | null, speed: number, phase: GuidePhase): string | null {
    if (!landscape) return 'Turn the phone sideways (landscape)';
    if (phase === 'ring0-done') return 'Low ring done. Add the tall-tree ring or finish the sweep.';
    if (phase === 'complete') return 'All done';
    if (onDot) return speed < this.opts.stillDegPerSec ? 'Hold still' : 'Slow down and hold still';
    if (!target) return null;
    const dAz = angleDiffDeg(target.az, pointing.az), dAlt = target.alt - pointing.alt;
    const tol = this.opts.toleranceDeg;
    // Big turns first, then height, then the last bit of turn.
    if (Math.abs(dAz) > 10 || (Math.abs(dAz) > tol && Math.abs(dAlt) <= tol)) return dAz > 0 ? 'Turn right' : 'Turn left';
    if (Math.abs(dAlt) > tol) return dAlt > 0 ? 'Tilt up' : 'Tilt down';
    if (Math.abs(pointing.roll) > 20) return 'Hold the phone level';
    return dAz > 0 ? 'Turn right' : 'Turn left';
  }
}

function norm(az: number) { return ((az % 360) + 360) % 360; }
