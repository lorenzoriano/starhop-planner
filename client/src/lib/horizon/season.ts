/**
 * Leaf seasons for the photo horizon (docs/local-horizon-design.md, phase 4). Kept deliberately simple:
 * - northern hemisphere: leaf-on from 1 May to 31 October, leaf-off otherwise;
 * - southern hemisphere: mirrored (leaf-on from 1 November to 30 April);
 * - tropics (|lat| < 23.5°): 'unknown' — evergreen or rainy-season foliage does not follow the calendar.
 * Months are taken in UTC; a day either side of a boundary does not matter for trees.
 */
import type { PhotoCaptureRecord, Season } from './photo-types';

const TROPICS_DEG = 23.5;

/** Leaf season at a latitude on a date. */
export function seasonFor(date: Date, lat: number): Season {
  if (!Number.isFinite(lat) || Math.abs(lat) < TROPICS_DEG || Number.isNaN(date.getTime())) return 'unknown';
  const month = date.getUTCMonth(); // 0 = January
  const northSummer = month >= 4 && month <= 9; // May … October
  return (lat > 0 ? northSummer : !northSummer) ? 'leaf-on' : 'leaf-off';
}

/**
 * Plain advice when the capture in use was taken in the other leaf season, or null. Pass the capture the app is using
 * now (photo-store's readPhotoSite without a season): it is the current season's capture whenever one exists, so a
 * mismatch means there is none for this season. 'unknown' on either side never asks for a new capture.
 */
export function recaptureAdvice(record: PhotoCaptureRecord, now: Date): string | null {
  const then = record.season;
  const current = seasonFor(now, record.lat);
  if (then === 'unknown' || current === 'unknown' || then === current) return null;
  return then === 'leaf-off'
    ? 'Your photo horizon was taken with bare trees; leaves may block more now. Capture again for summer.'
    : 'Your photo horizon was taken with leaves on the trees; bare branches may show more sky now. Capture again for winter.';
}
