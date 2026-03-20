import { describe, it, expect } from 'vitest';
import { findBestObservingTime } from '../astronomy';

describe('findBestObservingTime', () => {
  it('returns a future date/time when M31 reaches 30°+ during astronomical darkness', () => {
    // M31: RA 10.45°, Dec +41.27°. From lat 40°N in mid-May, M31 is below the
    // horizon or below 30° during astronomical darkness. The function must find a
    // qualifying night within 365 days (autumn 2026 is the target window).
    const startDate = new Date('2026-05-15T12:00:00Z');
    const result = findBestObservingTime(10.45, 41.27, 40, 0, startDate);

    expect(result).not.toBeNull();
    expect(result!.alt).toBeGreaterThanOrEqual(30);
    expect(result!.date.getTime()).toBeGreaterThan(startDate.getTime());
  });

  it('returns null when the object is geometrically unreachable from the observer latitude', () => {
    // Object at dec −80°, observer at lat 70°N.
    // Max achievable altitude = 90 − 70 − 80 = −60° — never reaches 30°.
    const startDate = new Date('2026-03-20T12:00:00Z');
    const result = findBestObservingTime(0, -80, 70, 0, startDate);

    expect(result).toBeNull();
  });
});
