import { describe, expect, it } from 'vitest';
import type { PhotoCaptureRecord, Season } from '@/lib/horizon/photo-types';
import { recaptureAdvice, seasonFor } from '@/lib/horizon/season';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const record = (season: Season, lat = 46): PhotoCaptureRecord => ({
  version: 1, capturedAt: '2026-01-10T10:00:00Z', lat, lon: 7, season,
  camera: { width: 1280, height: 960, hfovDeg: 66, cameraKey: 'c', sigmaDeg: 0.3 },
  yaw: { chosen: { source: 'compass', offsetDeg: 0, sigmaDeg: 5, label: 'the compass' }, fixes: [] },
  segmentation: 'classical', frames: 8, rings: 1, light: 'day',
});

describe('leaf seasons', () => {
  it('northern: leaf-on 1 May – 31 October', () => {
    expect(seasonFor(d('2026-04-30'), 46)).toBe('leaf-off');
    expect(seasonFor(d('2026-05-01'), 46)).toBe('leaf-on');
    expect(seasonFor(d('2026-10-31'), 46)).toBe('leaf-on');
    expect(seasonFor(d('2026-11-01'), 46)).toBe('leaf-off');
    expect(seasonFor(d('2026-01-15'), 60)).toBe('leaf-off');
  });
  it('southern is mirrored; the tropics are unknown', () => {
    expect(seasonFor(d('2026-01-15'), -35)).toBe('leaf-on');
    expect(seasonFor(d('2026-07-15'), -35)).toBe('leaf-off');
    expect(seasonFor(d('2026-11-01'), -35)).toBe('leaf-on');
    expect(seasonFor(d('2026-07-15'), 10)).toBe('unknown');
    expect(seasonFor(d('2026-07-15'), -23.4)).toBe('unknown');
    expect(seasonFor(d('2026-07-15'), 23.5)).toBe('leaf-on');
    expect(seasonFor(new Date(NaN), 46)).toBe('unknown');
  });
});

describe('recapture advice', () => {
  it('asks for a summer capture when the photo had bare trees', () => {
    expect(recaptureAdvice(record('leaf-off'), d('2026-06-20'))).toBe(
      'Your photo horizon was taken with bare trees; leaves may block more now. Capture again for summer.',
    );
    expect(recaptureAdvice(record('leaf-on'), d('2026-12-20'))).toMatch(/leaves on the trees.*Capture again for winter\./);
    expect(recaptureAdvice(record('leaf-off', -35), d('2026-12-20'))).toMatch(/Capture again for summer/);
  });
  it('stays quiet when the season matches or is unknown', () => {
    expect(recaptureAdvice(record('leaf-off'), d('2026-12-20'))).toBeNull();
    expect(recaptureAdvice(record('unknown'), d('2026-06-20'))).toBeNull();
    expect(recaptureAdvice(record('leaf-off', 5), d('2026-06-20'))).toBeNull();
  });
});
