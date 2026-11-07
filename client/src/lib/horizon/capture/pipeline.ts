/**
 * From the captured sweep to a true-north sky grid and panorama (docs/local-horizon-design.md, sections 7 and 8):
 * lens → compass → taps → sky segmentation → relative grid → terrain match → chosen north → final grid + panorama.
 * Saving is the UI's job (photo-store's savePhotoHorizon) after the user has reviewed and fixed the result.
 *
 * Runs on the main thread with a yield between frames so the progress UI stays live. The heavy parts are the
 * per-frame segmentation (the model already runs in its own worker), projectToGrid and composePanorama; moving the
 * last two into a worker would keep a slow phone responsive (frames are plain RgbaImage objects, so they transfer).
 */
import * as Astro from 'astronomy-engine';
import { azAltToPixel, type CameraIntrinsics, type CameraPose } from '../calibrate/camera';
import { readCameraCalibration, updateCameraCalibration } from '../calibrate/calibration-store';
import { solveFov } from '../calibrate/fov';
import { applyYaw, type Quat } from '../calibrate/quat';
import type { TapTarget } from '../calibrate/tap-targets';
import { terrainMatchFix } from '../calibrate/terrain-match';
import { celestialFix, chooseYaw, compassFix } from '../calibrate/yaw';
import {
  GRID_ALT_MIN, type CapturedFrame, type GrayImage, type PhotoCaptureRecord, type RgbaImage,
  type SegmentationMethod, type SkyGrid, type YawChoice, type YawFix,
} from '../photo-types';
import { seasonFor } from '../season';
import { emptyGrid, projectToGrid, relativeSkyline, type ExcludedDisc } from '../segment/grid';
import { composePanorama } from '../segment/panorama';
import { segmentFrame } from '../segment/segment-frame';
import type { HorizonProfile } from '../types';

export interface CaptureTap {
  /** Relative orientation while the body was centred in the reticle (averaged over the hold). */
  qRel: Quat;
  screenAngle: number;
  target: TapTarget;
}

export interface CaptureInput {
  frames: CapturedFrame[];
  taps: CaptureTap[];
  lat: number;
  lon: number;
  date: Date;
  /** The site's terrain horizon, for the automatic terrain match; null when not known. */
  terrain: HorizonProfile | null;
  cameraKey: string;
  /** Stream size and a field-of-view guess for this phone. */
  deviceGuess: { width: number; height: number; hfovDeg: number };
  /** Use the sky model (default true); false runs the classical segmentation only. */
  useModel?: boolean;
  /** Stops the run between steps (the user closed the capture): processCapture then rejects with an AbortError. */
  signal?: AbortSignal;
}

export type LightLevel = 'day' | 'twilight' | 'night';

export interface CaptureResult {
  /** Sky grid in true-north coordinates (all unknown when `needsTrace`). */
  grid: SkyGrid;
  /** Equirectangular panorama, true north at x = 0 (brightened when the frames were dark). */
  panorama: RgbaImage;
  record: PhotoCaptureRecord;
  yaw: YawChoice;
  light: LightLevel;
  /** Sun's apparent altitude at capture, degrees. */
  sunAltDeg: number;
  /** Too dark to find the sky automatically: the user traces the skyline instead. */
  needsTrace: boolean;
  /** Lens model used for every frame. */
  cam: CameraIntrinsics;
  /** Whether the lens was measured from this sweep (false: stored calibration or the device guess). */
  fovSolved: boolean;
  /** Plain sentences worth showing on the review screen. */
  notes: string[];
}

export type CaptureProgress = (fraction: number, message: string) => void;

/** Frames darker than this mean grey level (0–255) cannot be segmented automatically. */
const DARK_MEAN_LEVEL = 28;
/** A stored lens calibration is replaced (averaged) only by a solution from at least this many frame pairs. */
const MIN_FOV_PAIRS_TO_REPLACE = 4;
/** Field-of-view uncertainty of the device guess (about 3%), degrees. */
const GUESS_FOV_SIGMA_DEG = 2;
export const LENS_NOT_MEASURED = 'Lens not measured yet — any daytime sweep, anywhere, measures it once for this phone.';

/** Review line when only the compass found north. */
export function compassOnlyNote(sigmaDeg: number, light: LightLevel): string {
  const later = light === 'day' ? 'Fix it later with "Line up" in Look around.' : 'Fix it later with "Line up" in Look around, or repeat the sweep in daylight.';
  return `North comes from the compass, so the alignment is approximate (±${Math.round(sigmaDeg)}°). ${later}`;
}

/** Compass fixes looser than this suggest magnetic interference. */
const COMPASS_UNSETTLED_SIGMA = 10;
/** Alignment used when nothing at all could find north: the user lines it up later. */
const UNALIGNED_FIX: YawFix = { source: 'manual', offsetDeg: 0, sigmaDeg: 180, label: 'nothing yet' };

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Sun's apparent altitude and azimuth (degrees) and the light level: day above −1°, twilight down to −12°, then night. */
export function lightAt(lat: number, lon: number, date: Date): { sunAltDeg: number; sunAzDeg: number; light: LightLevel } {
  const observer = new Astro.Observer(lat, lon, 0);
  const eq = Astro.Equator(Astro.Body.Sun, date, observer, true, true);
  const h = Astro.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  const sunAltDeg = h.altitude;
  return { sunAltDeg, sunAzDeg: h.azimuth, light: sunAltDeg > -1 ? 'day' : sunAltDeg > -12 ? 'twilight' : 'night' };
}

/** Radius around the Sun left out of the sky map (glare, flare and blooming), degrees. */
export const SUN_DISC_DEG = 4;
/** At most this much is added to the disc for the uncertainty of where north is, degrees. */
const SUN_DISC_MARGIN_MAX_DEG = 6;
export const SUN_LEFT_OUT = 'The area around the Sun is left out because of its glare.';

/**
 * The disc around the Sun that the frames must not contribute to the sky map, in the poses' azimuth frame
 * (trueAz = poseAz + offsetDeg): SUN_DISC_DEG widened by the alignment's uncertainty (at most 6° more). None while
 * north is unknown or the Sun is too low to reach the map.
 */
export function sunDiscs(sun: { az: number; alt: number }, offsetDeg: number, sigmaDeg: number): ExcludedDisc[] {
  const radiusDeg = SUN_DISC_DEG + Math.min(SUN_DISC_MARGIN_MAX_DEG, Math.max(0, sigmaDeg));
  if (!(sigmaDeg < 90) || sun.alt < GRID_ALT_MIN - radiusDeg) return [];
  return [{ az: sun.az - offsetDeg, alt: sun.alt, radiusDeg }];
}

/** True when the Sun's centre falls inside at least one frame. */
function sunInFrames(poses: CameraPose[], cam: CameraIntrinsics, sun: { az: number; alt: number }): boolean {
  return poses.some(pose => {
    const p = azAltToPixel(pose, cam, sun.az, sun.alt);
    return !!p && p.u >= 0 && p.u <= cam.width && p.v >= 0 && p.v <= cam.height;
  });
}

/** Mean grey level of an image (0–255), sampled. */
export function meanLevel(img: RgbaImage): number {
  const { data } = img;
  const px = data.length / 4, stride = Math.max(1, Math.floor(px / 20000));
  let s = 0, n = 0;
  for (let i = 0; i < px; i += stride) {
    const o = i * 4;
    s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    n++;
  }
  return n ? s / n : 0;
}

/** Gain and gamma so a dark frame's mean comes up to about `target` (night trace view). */
export function brighten(img: RgbaImage, target = 90): RgbaImage {
  const mean = Math.max(1, meanLevel(img));
  if (mean >= target) return img;
  // Gamma lifts the shadows; the gain finishes the job.
  const gamma = Math.max(0.45, Math.log(target / 255) / Math.log(Math.min(0.99, mean / 255)));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gamma));
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = lut[img.data[i]];
    out[i + 1] = lut[img.data[i + 1]];
    out[i + 2] = lut[img.data[i + 2]];
    out[i + 3] = img.data[i + 3];
  }
  let res: RgbaImage = { width: img.width, height: img.height, data: out };
  const m2 = meanLevel(res);
  if (m2 > 0 && m2 < target * 0.9) {
    const g = Math.min(8, target / m2);
    for (let i = 0; i < out.length; i += 4) { out[i] *= g; out[i + 1] *= g; out[i + 2] *= g; }
    res = { width: img.width, height: img.height, data: out };
  }
  return res;
}


function lensFor(input: CaptureInput, cam0: { width: number; height: number }, dark: boolean) {
  const stored = readCameraCalibration(input.cameraKey);
  // A stored calibration always beats solving on dark, textureless frames; it is only refined by a sweep with light.
  const solution = stored && dark ? null : solveFov(input.frames.map(f => ({ image: f.image, q: f.qRel, screenAngle: f.screenAngle })), {
    width: cam0.width, height: cam0.height, hfovDeg: stored?.hfovDeg ?? input.deviceGuess.hfovDeg,
  }, { solveK1: true }); // k1 trades off against the FOV: without it a barrel lens reads ~2% wide (simulation, k1 −0.08)
  if (solution && (!stored || solution.pairs >= MIN_FOV_PAIRS_TO_REPLACE)) {
    const cal = updateCameraCalibration(input.cameraKey, solution);
    return { cam: { ...cam0, hfovDeg: cal.hfovDeg, k1: cal.k1 }, sigmaDeg: cal.sigmaDeg, solved: true, stored: !!stored };
  }
  if (stored) return { cam: { ...cam0, hfovDeg: stored.hfovDeg, k1: stored.k1 }, sigmaDeg: stored.sigmaDeg, solved: false, stored: true };
  // Nothing measured yet: the device guess, about 3% uncertain.
  return { cam: { ...cam0, hfovDeg: input.deviceGuess.hfovDeg }, sigmaDeg: GUESS_FOV_SIGMA_DEG, solved: false, stored: false };
}

/** Run the whole capture pipeline. Throws only when there are no frames or the run was cancelled (`signal`). */
export async function processCapture(input: CaptureInput, onProgress: CaptureProgress = () => {}): Promise<CaptureResult> {
  const { frames, lat, lon, date } = input;
  if (!frames.length) throw new Error('No frames were captured.');
  // Yield to the UI between steps, and stop there when cancelled.
  const tick = async () => {
    await yieldToUi();
    if (input.signal?.aborted) throw new DOMException('The capture was closed.', 'AbortError');
  };
  const notes: string[] = [];
  const cam0 = { width: frames[0].image.width, height: frames[0].image.height };

  // 1. Lens: measured from the overlaps, with the stored calibration (or the device guess) as the prior.
  onProgress(0.02, 'Measuring the camera lens…');
  await tick();
  const { sunAltDeg, sunAzDeg, light } = lightAt(lat, lon, date);
  const sun = { az: sunAzDeg, alt: sunAltDeg };
  const darkFrames = frames.filter(f => meanLevel(f.image) < DARK_MEAN_LEVEL).length;
  const needsTrace = light === 'night' || darkFrames > frames.length / 2;
  const lens = lensFor(input, cam0, needsTrace);
  const cam: CameraIntrinsics = lens.cam;
  if (!lens.solved && !lens.stored) notes.push(LENS_NOT_MEASURED);

  // 2. North seeds: the compass and any taps on the Sun, Moon, a planet or a star.
  onProgress(0.1, 'Finding north…');
  await tick();
  const fixes: YawFix[] = [];
  const compass = compassFix(frames, lat, lon, date);
  if (compass) {
    fixes.push(compass);
    if (compass.sigmaDeg > COMPASS_UNSETTLED_SIGMA) notes.push('The compass was unsettled during the sweep (metal or a car nearby?).');
  }
  for (const tap of input.taps) {
    const { fix, pitchErrorDeg } = celestialFix({ qRel: tap.qRel, screenAngle: tap.screenAngle }, tap.target);
    fixes.push(fix);
    if (Math.abs(pitchErrorDeg) > 3) notes.push(`The phone's tilt reading was off by ${Math.round(Math.abs(pitchErrorDeg))}° when you centred ${fix.label}.`);
  }

  // 3. Sky segmentation per frame (night or very dark frames: the user traces the skyline instead).
  const alphas: GrayImage[] = [];
  const methods = new Set<SegmentationMethod>();
  if (!needsTrace) {
    for (let i = 0; i < frames.length; i++) {
      const base = 0.15 + (0.6 * i) / frames.length, span = 0.6 / frames.length;
      onProgress(base, `Finding the sky in photo ${i + 1} of ${frames.length}…`);
      await tick();
      const { alpha, method } = await segmentFrame(frames[i].image, {
        useModel: input.useModel ?? true,
        onProgress: p => onProgress(base + span * Math.max(0, Math.min(1, p)), `Finding the sky in photo ${i + 1} of ${frames.length}…`),
      });
      alphas.push(alpha);
      methods.add(method);
    }
  }
  const segmentation: SegmentationMethod = needsTrace ? 'trace' : methods.size === 1 && methods.has('segformer-b0-ade') ? 'segformer-b0-ade' : 'classical';

  // 4. Terrain match: the photo skyline in the relative frame against the terrain horizon (hills far away). The Sun's
  //    glare is left out, placed with the best north known so far (compass or tap).
  onProgress(0.78, 'Matching the skyline with the hills…');
  await tick();
  if (!needsTrace && input.terrain) {
    const seed = chooseYaw(fixes)?.chosen;
    const exclude = seed ? sunDiscs(sun, seed.offsetDeg, seed.sigmaDeg) : [];
    const relGrid = projectToGrid(frames.map((f, i) => ({ alpha: alphas[i], pose: { q: f.qRel, screenAngle: f.screenAngle }, cam, exclude })));
    await tick();
    const match = terrainMatchFix(relativeSkyline(relGrid), input.terrain, compass?.offsetDeg ?? 0, compass ? undefined : { searchDeg: 180 });
    if (match) fixes.push(match);
  }

  // 5. Choose north and build the true-north grid and panorama.
  const yaw: YawChoice = chooseYaw(fixes) ?? { chosen: UNALIGNED_FIX, fixes: [] };
  if (yaw.chosen.source === 'compass') notes.push(compassOnlyNote(yaw.chosen.sigmaDeg, light));
  const poses = frames.map(f => ({ q: applyYaw(f.qRel, yaw.chosen.offsetDeg), screenAngle: f.screenAngle }));
  onProgress(0.85, 'Building the sky map…');
  await tick();
  // Poses are true-north now: the Sun's disc goes where the Sun is (none while north is unknown).
  const exclude = sunDiscs(sun, 0, yaw.chosen.sigmaDeg);
  const grid = needsTrace ? emptyGrid() : projectToGrid(frames.map((_, i) => ({ alpha: alphas[i], pose: poses[i], cam, exclude })));
  if (!needsTrace && exclude.length && sunInFrames(poses, cam, sun)) notes.push(SUN_LEFT_OUT);
  onProgress(0.92, 'Stitching the panorama…');
  await tick();
  const panorama = composePanorama(frames.map((f, i) => ({ image: needsTrace ? brighten(f.image) : f.image, pose: poses[i], cam })));
  onProgress(1, 'Done');

  const record: PhotoCaptureRecord = {
    version: 1,
    capturedAt: date.toISOString(),
    lat,
    lon,
    season: seasonFor(date, lat),
    camera: { width: cam.width, height: cam.height, hfovDeg: cam.hfovDeg, ...(cam.k1 ? { k1: cam.k1 } : {}), cameraKey: input.cameraKey, sigmaDeg: lens.sigmaDeg },
    yaw,
    segmentation,
    frames: frames.length,
    rings: new Set(frames.filter(f => f.ring === 0 || f.ring === 1).map(f => f.ring)).size,
    light,
  };
  return { grid, panorama, record, yaw, light, sunAltDeg, needsTrace, cam, fovSolved: lens.solved, notes };
}
