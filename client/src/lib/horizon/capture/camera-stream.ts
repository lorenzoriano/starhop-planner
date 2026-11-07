/**
 * Rear camera for the guided sweep (docs/local-horizon-design.md, phase 2). Browser-only.
 * Asks for 4:3 at about 1280×960 so the 16:9 crop does not narrow the field of view; frames are grabbed from the live
 * video (no takePhoto: it pauses the stream) and downscaled so the longest side is at most 1280 px.
 */
import { cameraKey as calibrationKey } from '../calibrate/calibration-store';
import type { RgbaImage } from '../photo-types';
import { hasCameraSupport } from './support';

const MAX_FRAME_SIDE = 1280;

export type CameraErrorReason = 'denied' | 'missing' | 'busy' | 'insecure' | 'unsupported' | 'other';

/** Plain-words failure the UI can show as is. */
class CameraError extends Error {
  constructor(message: string, readonly reason: CameraErrorReason) { super(message); }
}

export interface CameraStream {
  video: HTMLVideoElement;
  /** Size of the frames as delivered (after the browser's rotation for the screen orientation). */
  width: number;
  height: number;
  /** Calibration key for this camera mode (calibrate/calibration-store.ts). */
  cameraKey: string;
  label: string;
  /** The current video frame as an RGBA image, longest side ≤ 1280 px. */
  grabFrame(): RgbaImage;
  stop(): void;
}


/** Turn a getUserMedia failure into a sentence for the user. */
function cameraErrorFrom(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('Camera access was not allowed. Allow the camera for this site in the browser settings and try again.', 'denied');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('No rear camera was found on this device.', 'missing');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('The camera is busy. Close other apps that use the camera and try again.', 'busy');
    default:
      return new CameraError('The camera could not be started.', 'other');
  }
}

/** Downscaled size with the longest side at most `max`. */
function scaledSize(width: number, height: number, max = MAX_FRAME_SIDE): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Open the rear camera into `video` (call from a user gesture). Rejects with a CameraError in plain words. */
export async function openCamera(video: HTMLVideoElement): Promise<CameraStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError('The camera only works on a secure (https) page.', 'insecure');
  }
  if (!hasCameraSupport()) throw new CameraError('This browser cannot use the camera.', 'unsupported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 } },
    });
  } catch (err) {
    throw cameraErrorFrom(err);
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach(t => t.stop());
    throw new CameraError('No rear camera was found on this device.', 'missing');
  }
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // Autoplay of a muted inline stream is allowed; a failure here usually means the element was removed.
  }
  if (!video.videoWidth) {
    await new Promise<void>(resolve => {
      const done = () => { video.removeEventListener('loadedmetadata', done); resolve(); };
      video.addEventListener('loadedmetadata', done);
      setTimeout(done, 3000);
    });
  }
  const label = track.label || 'camera';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    stream.getTracks().forEach(t => t.stop());
    throw new CameraError('This browser cannot read camera frames.', 'unsupported');
  }
  const settings = track.getSettings();
  // The key uses the delivered size (landscape during the sweep), matching the intrinsics the frames are solved with.
  const deliveredW = video.videoWidth || settings.width || 1280, deliveredH = video.videoHeight || settings.height || 960;
  const result: CameraStream = {
    video,
    get width() { return video.videoWidth || deliveredW; },
    get height() { return video.videoHeight || deliveredH; },
    cameraKey: calibrationKey(label, Math.max(deliveredW, deliveredH), Math.min(deliveredW, deliveredH)),
    label,
    grabFrame() {
      const { width, height } = scaledSize(video.videoWidth || deliveredW, video.videoHeight || deliveredH);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.drawImage(video, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height);
      return { width, height, data: img.data };
    },
    stop() {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
  };
  return result;
}
