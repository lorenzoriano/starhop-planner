/**
 * Shared contract for the photo horizon (docs/local-horizon-design.md, phases 2–4): capture, calibration,
 * segmentation, the stored photo data and the viewer. Orientation and camera conventions live in
 * calibrate/quat.ts and calibrate/camera.ts.
 */
import type { CameraIntrinsics } from './calibrate/camera';
import type { Quat } from './calibrate/quat';

/** An RGBA image in memory (ImageData-compatible; plain object so workers and Node tests can use it). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A single-channel image, 0…255 (sky probability/alpha, grey levels). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** One still frame of the guided sweep, with the sensor readings taken while it was still. */
export interface CapturedFrame {
  id: number;
  /** Downscaled frame (longest side ≤ 1280 px). */
  image: RgbaImage;
  /** RelativeOrientationSensor (gyro + accelerometer; arbitrary azimuth origin), averaged over the still period. */
  qRel: Quat;
  /** AbsoluteOrientationSensor (magnetic north), averaged; null when the device has no magnetometer reading. */
  qAbs: Quat | null;
  /** screen.orientation.angle at capture (0, 90, 180, 270). */
  screenAngle: number;
  /** ms since the sweep started. */
  t: number;
  /** Which guide ring: 0 = low ring (pitch ≈ +18°), 1 = high ring (≈ +55°). */
  ring: number;
  /** Mean angular speed during the still period, °/s. */
  stillDegPerSec: number;
}

/** Ways of finding true north. Every fix says how much to ADD to relative-sensor azimuths: trueAz = relAz + offsetDeg. */
export type YawSource = 'compass' | 'sun' | 'moon' | 'planet' | 'star' | 'terrain' | 'landmark' | 'manual';

export interface YawFix {
  source: YawSource;
  offsetDeg: number;
  /** One-sigma uncertainty, degrees. */
  sigmaDeg: number;
  /** Plain words for the UI, e.g. "the Sun", "Jupiter", "the compass", "the hills". */
  label: string;
}

/** The chosen alignment and any disagreement worth telling the user about. */
export interface YawChoice {
  chosen: YawFix;
  fixes: YawFix[];
  /** Plain sentence when two fixes disagree by more than max(3°, 2 combined sigma), e.g. "The compass disagrees with the Sun by 14°; using the Sun." */
  disagreement?: string;
}

/** Lens calibration result for one camera mode. */
export interface FovSolution {
  hfovDeg: number;
  k1?: number;
  /** One-sigma uncertainty of hfovDeg, degrees. */
  sigmaDeg: number;
  /** Number of frame pairs that contributed. */
  pairs: number;
}

/** Stored per camera mode (localStorage `starhop-camera-calibration-v1`). */
export interface CameraCalibration extends FovSolution {
  /** Track label + resolution + aspect, e.g. "camera2 0, facing back|1280x960". */
  cameraKey: string;
  samples: number;
  updatedAt: string;
}

/**
 * Sky/obstruction grid in true-north coordinates, the source of truth for the photo layer.
 * Column i covers azimuth i·stepDeg (i = 0 is north); row 0 is the TOP (altitude altMaxDeg − stepDeg/2 centre).
 * alpha: 255 = clear sky, 0 = obstruction, between = partly clear (foliage). known: 0 = never seen by any frame.
 */
export interface SkyGrid {
  stepDeg: number; // 0.25
  altMinDeg: number; // −10
  altMaxDeg: number; // +70
  width: number; // 1440
  height: number; // 320
  alpha: Uint8Array;
  known: Uint8Array;
}

export type SegmentationMethod = 'segformer-b0-ade' | 'classical' | 'trace';
export type Season = 'leaf-on' | 'leaf-off' | 'unknown';

/** What a capture used and decided; small JSON stored with the photo data. */
export interface PhotoCaptureRecord {
  version: 1;
  capturedAt: string;
  lat: number;
  lon: number;
  season: Season;
  camera: CameraIntrinsics & { cameraKey: string; sigmaDeg: number };
  yaw: YawChoice;
  segmentation: SegmentationMethod;
  frames: number;
  rings: number;
  /** Day, twilight or night, from the Sun's altitude at capture. */
  light: 'day' | 'twilight' | 'night';
  /** Manual drags applied after saving, degrees (already included in the stored grid and panorama). */
  manualYawDeg?: number;
}

/** Everything about a site's photo horizon kept in IndexedDB (database `starhop-horizon`, store `sites`). */
export interface PhotoSiteData {
  siteKey: string;
  lat: number;
  lon: number;
  record: PhotoCaptureRecord;
  /** Sky grid (alpha + known) as stored. */
  grid: SkyGrid;
  /** Equirectangular panorama, true north at x = 0, azimuth increasing to the right, altitude PANORAMA_ALT_MAX at the top. */
  panorama: Blob | null;
  updatedAt: string;
}

/** Panorama geometry (design 5.3). */
export const PANORAMA_WIDTH = 4096;
export const PANORAMA_HEIGHT = 1024;
export const PANORAMA_ALT_MIN = -10;
export const PANORAMA_ALT_MAX = 80;

/** Sky grid geometry (design 5.3). */
export const GRID_STEP_DEG = 0.25;
export const GRID_ALT_MIN = -10;
export const GRID_ALT_MAX = 70;

/** `source` of a photo layer imported from a horizon file (export.ts parseAzAltText) rather than measured by a sweep. */
export const IMPORT_SOURCE = 'Imported file';

/** Uncertainty-aware answer for one direction (design 4.4). */
export type HorizonVerdict = 'clear' | 'marginal' | 'blocked';
