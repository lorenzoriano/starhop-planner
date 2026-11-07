/** Feature detection for the camera sweep (no prompts, no heavy imports: the horizon panel uses it on first render). */

/** The browser can open a camera at all. */
export function hasCameraSupport(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** The browser has some way to read the phone's orientation. */
function hasOrientationSupport(): boolean {
  return typeof window !== 'undefined' && ('RelativeOrientationSensor' in window || 'DeviceOrientationEvent' in window);
}

/** Both: the guided sweep can run here. */
export const captureSupported = () => hasCameraSupport() && hasOrientationSupport();
