/**
 * "Move the phone" for the horizon viewer: the phone's absolute orientation (magnetic north) as a quaternion, from
 * AbsoluteOrientationSensor, else the deviceorientationabsolute event, else an absolute deviceorientation event.
 * The caller corrects magnetic to true north (calibrate/declination.ts) and turns the pose into a view direction with
 * calibrate/camera.ts cameraPointing (the view looks out of the back of the phone, like the camera).
 */
import type { Quat } from '../calibrate/quat';
import { quatFromDeviceOrientation } from '../capture/sensors';

export type PoseListener = (q: Quat, screenAngle: number) => void;

interface SensorLike extends EventTarget {
  quaternion?: number[] | null;
  start(): void;
  stop(): void;
}
type SensorCtor = new (opts: { frequency: number; referenceFrame?: 'device' | 'screen' }) => SensorLike;

/** How long to wait for a first reading before giving up, ms. */
const FIRST_READING_MS = 1500;
const NO_DIRECTION = 'This device cannot tell which way it is pointing.';

const screenAngle = () => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0) || 0;

/**
 * Absolute orientation events. Resolves to a stop function once the first usable (absolute) event arrives, or null
 * when none comes in time (desktops have the event but no sensor; iPhones send only relative events).
 */
function startEvents(onPose: PoseListener): Promise<(() => void) | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'ondeviceorientation' in window ? 'deviceorientation' : null;
  if (!type) return Promise.resolve(null);
  return new Promise((resolve) => {
    let first = true;
    const stop = () => window.removeEventListener(type, handler);
    const timer = setTimeout(() => { stop(); resolve(null); }, FIRST_READING_MS);
    function handler(e: Event) {
      const o = e as DeviceOrientationEvent;
      if (o.type === 'deviceorientation' && !o.absolute) return;
      if (o.alpha === null || o.beta === null || o.gamma === null) return;
      onPose(quatFromDeviceOrientation(o.alpha, o.beta, o.gamma), screenAngle());
      if (first) {
        first = false;
        clearTimeout(timer);
        resolve(stop);
      }
    }
    window.addEventListener(type, handler);
  });
}

/**
 * Starts listening; resolves to a stop function, or rejects with a plain sentence when the phone cannot tell where it
 * points.
 */
export async function startPhoneOrientation(onPose: PoseListener): Promise<() => void> {
  // iOS asks for permission before sending orientation events.
  const DOE = (typeof window !== 'undefined' ? (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent : undefined);
  if (DOE?.requestPermission) {
    const answer = await DOE.requestPermission().catch(() => 'denied');
    if (answer !== 'granted') throw new Error('Motion access was not allowed.');
  }
  const Ctor = (globalThis as unknown as { AbsoluteOrientationSensor?: SensorCtor }).AbsoluteOrientationSensor;
  if (Ctor) {
    try {
      const sensor = new Ctor({ frequency: 60, referenceFrame: 'device' });
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), FIRST_READING_MS);
        sensor.addEventListener('reading', () => {
          const q = sensor.quaternion;
          if (q && q.length === 4) onPose([q[0], q[1], q[2], q[3]], screenAngle());
          clearTimeout(timer);
          resolve(true);
        });
        sensor.addEventListener('error', () => { clearTimeout(timer); resolve(false); });
        sensor.start();
      });
      if (ok) return () => sensor.stop();
      sensor.stop();
    } catch {
      // Blocked by permissions policy or not supported: try the events.
    }
  }
  const stop = await startEvents(onPose);
  if (!stop) throw new Error(NO_DIRECTION);
  return stop;
}
