/**
 * Phone orientation for the guided sweep (docs/local-horizon-design.md, phase 2). Browser-only.
 *
 * Preferred: the Generic Sensor API at 60 Hz in the DEVICE frame (calibrate/quat.ts conventions):
 * - RelativeOrientationSensor (gyro + accelerometer): smooth, arbitrary azimuth origin; places the frames.
 * - AbsoluteOrientationSensor (adds the magnetometer): MAGNETIC north; only a seed for true north.
 * Fallback (no Generic Sensor API, or blocked): `deviceorientation` (relative on Chrome) and `deviceorientationabsolute`
 * events, converted from W3C Euler angles (Z-X'-Y'') to quaternions.
 */
import { quatAngleDeg, quatFromAxisAngle, quatMultiply, quatNormalize, type Quat } from '../calibrate/quat';

export interface OrientationReading {
  /** Relative orientation (device → world, arbitrary azimuth origin). */
  qRel: Quat;
  /** Absolute orientation (device → world, magnetic north), null until the compass reports. */
  qAbs: Quat | null;
  /** performance.now() time base, ms. */
  t: number;
}

export interface OrientationSource {
  kind: 'generic-sensor' | 'deviceorientation';
  latest(): OrientationReading | null;
  /** Angular speed from consecutive relative readings, °/s (lightly smoothed). */
  angularSpeed(): number;
  /** Average of the readings of the last `ms` milliseconds (held-still tap), or the latest reading. */
  recent(ms: number): OrientationReading | null;
  stop(): void;
}

/** Plain-words failure the UI can show as is. */
class SensorError extends Error {
  constructor(message: string, readonly reason: 'denied' | 'unsupported' | 'no-readings') { super(message); }
}

// Minimal typings: the Generic Sensor API is not in TypeScript's DOM lib.
interface OrientationSensorLike extends EventTarget {
  quaternion: number[] | null;
  timestamp?: number;
  start(): void;
  stop(): void;
}
type OrientationSensorCtor = new (opts: { frequency: number; referenceFrame: 'device' | 'screen' }) => OrientationSensorLike;

const FREQUENCY = 60;
const FIRST_READING_TIMEOUT_MS = 1500;
const HISTORY_MS = 1500;

/** Quaternion of the W3C DeviceOrientationEvent angles: R = Rz(alpha) · Rx(beta) · Ry(gamma), device → earth. */
export function quatFromDeviceOrientation(alpha: number, beta: number, gamma: number): Quat {
  return quatNormalize(quatMultiply(quatMultiply(quatFromAxisAngle([0, 0, 1], alpha), quatFromAxisAngle([1, 0, 0], beta)), quatFromAxisAngle([0, 1, 0], gamma)));
}

/** Sign-aligned mean of nearby unit quaternions (good for the small spread of a held-still phone). */
export function averageQuats(qs: readonly Quat[]): Quat | null {
  if (!qs.length) return null;
  const ref = qs[0];
  const s = [0, 0, 0, 0];
  for (const q of qs) {
    const sign = q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) s[i] += sign * q[i];
  }
  return quatNormalize([s[0], s[1], s[2], s[3]]);
}

/** Keeps the recent readings and the smoothed angular speed; shared by both back ends. */
export class OrientationBuffer {
  private history: OrientationReading[] = [];
  private speed = 0;
  private abs: Quat | null = null;

  setAbsolute(q: Quat | null) { this.abs = q; }

  push(qRel: Quat, t: number) {
    const prev = this.history[this.history.length - 1];
    if (prev && t > prev.t) {
      const inst = quatAngleDeg(prev.qRel, qRel) / ((t - prev.t) / 1000);
      // Light smoothing: about three samples at 60 Hz.
      this.speed = this.history.length === 1 ? inst : this.speed + 0.35 * (inst - this.speed);
    }
    this.history.push({ qRel, qAbs: this.abs, t });
    while (this.history.length > 2 && t - this.history[0].t > HISTORY_MS) this.history.shift();
  }

  latest(): OrientationReading | null {
    const r = this.history[this.history.length - 1];
    return r ? { ...r, qAbs: this.abs } : null;
  }

  angularSpeed(): number { return this.speed; }

  recent(ms: number): OrientationReading | null {
    const last = this.history[this.history.length - 1];
    if (!last) return null;
    const window = this.history.filter(r => last.t - r.t <= ms);
    const absList = window.map(r => r.qAbs).filter((q): q is Quat => !!q);
    return { qRel: averageQuats(window.map(r => r.qRel)) ?? last.qRel, qAbs: averageQuats(absList) ?? this.abs, t: last.t };
  }
}

async function permissionDenied(names: string[]): Promise<boolean> {
  const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!permissions?.query) return false;
  const states = await Promise.all(names.map(name => permissions.query({ name: name as PermissionName }).then(s => s.state, () => 'prompt')));
  return states.includes('denied');
}

function waitForFirst(test: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => {
      if (test()) resolve(true);
      else if (performance.now() - t0 > timeoutMs) resolve(false);
      else setTimeout(tick, 30);
    };
    tick();
  });
}

async function startGenericSensors(): Promise<OrientationSource | null> {
  const w = window as unknown as { RelativeOrientationSensor?: OrientationSensorCtor; AbsoluteOrientationSensor?: OrientationSensorCtor };
  if (!w.RelativeOrientationSensor) return null;
  if (await permissionDenied(['accelerometer', 'gyroscope'])) {
    throw new SensorError('Motion sensors are blocked for this site. Allow "Motion sensors" in the browser\'s site settings and try again.', 'denied');
  }
  const buffer = new OrientationBuffer();
  let failed: string | null = null;
  let rel: OrientationSensorLike;
  try {
    rel = new w.RelativeOrientationSensor({ frequency: FREQUENCY, referenceFrame: 'device' });
  } catch {
    return null;
  }
  rel.addEventListener('reading', () => {
    const q = rel.quaternion;
    if (q) buffer.push(quatNormalize([q[0], q[1], q[2], q[3]]), rel.timestamp ?? performance.now());
  });
  rel.addEventListener('error', e => { failed = (e as Event & { error?: { name?: string } }).error?.name ?? 'error'; });
  rel.start();

  // The compass is optional: a missing magnetometer only loses the north seed.
  let abs: OrientationSensorLike | null = null;
  if (w.AbsoluteOrientationSensor && !(await permissionDenied(['magnetometer']))) {
    try {
      const sensor = new w.AbsoluteOrientationSensor({ frequency: FREQUENCY, referenceFrame: 'device' });
      sensor.addEventListener('reading', () => {
        const q = sensor.quaternion;
        if (q) buffer.setAbsolute(quatNormalize([q[0], q[1], q[2], q[3]]));
      });
      sensor.addEventListener('error', () => buffer.setAbsolute(null));
      sensor.start();
      abs = sensor;
    } catch {
      abs = null;
    }
  }
  const ok = await waitForFirst(() => !!buffer.latest() || failed !== null, FIRST_READING_TIMEOUT_MS);
  if (!ok || failed || !buffer.latest()) {
    rel.stop();
    abs?.stop();
    if (failed === 'NotAllowedError') {
      throw new SensorError('Motion sensors are blocked for this site. Allow "Motion sensors" in the browser\'s site settings and try again.', 'denied');
    }
    return null; // Try the event fallback.
  }
  return {
    kind: 'generic-sensor',
    latest: () => buffer.latest(),
    angularSpeed: () => buffer.angularSpeed(),
    recent: ms => buffer.recent(ms),
    stop: () => { rel.stop(); abs?.stop(); },
  };
}

async function startDeviceOrientation(): Promise<OrientationSource> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    throw new SensorError('This browser cannot read the phone\'s motion sensors, so the camera sweep is not possible here.', 'unsupported');
  }
  // iOS asks once, from a user gesture (the Start button).
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  if (typeof DOE.requestPermission === 'function') {
    const answer = await DOE.requestPermission().catch(() => 'denied' as const);
    if (answer !== 'granted') throw new SensorError('Motion sensors were not allowed. Allow motion access for this site and try again.', 'denied');
  }
  const buffer = new OrientationBuffer();
  const onRelative = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const q = quatFromDeviceOrientation(e.alpha, e.beta, e.gamma);
    // Some browsers only send absolute events through 'deviceorientation'; those still give a usable relative frame.
    if (e.absolute) buffer.setAbsolute(q);
    buffer.push(q, e.timeStamp || performance.now());
  };
  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    buffer.setAbsolute(quatFromDeviceOrientation(e.alpha, e.beta, e.gamma));
  };
  window.addEventListener('deviceorientation', onRelative);
  window.addEventListener('deviceorientationabsolute' as 'deviceorientation', onAbsolute);
  const stop = () => {
    window.removeEventListener('deviceorientation', onRelative);
    window.removeEventListener('deviceorientationabsolute' as 'deviceorientation', onAbsolute);
  };
  const ok = await waitForFirst(() => !!buffer.latest(), FIRST_READING_TIMEOUT_MS * 2);
  if (!ok) {
    stop();
    throw new SensorError('No motion readings arrived. This device may not have the sensors the sweep needs.', 'no-readings');
  }
  return {
    kind: 'deviceorientation',
    latest: () => buffer.latest(),
    angularSpeed: () => buffer.angularSpeed(),
    recent: ms => buffer.recent(ms),
    stop,
  };
}

/** Start the orientation sensors (call from a user gesture). Rejects with a SensorError in plain words. */
export async function startOrientation(): Promise<OrientationSource> {
  const generic = await startGenericSensors();
  return generic ?? startDeviceOrientation();
}
