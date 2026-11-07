import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSeasonalPhotoLayer } from '@/hooks/use-local-horizon';
import { IMPORT_SOURCE } from '@/lib/horizon/photo-types';
import type { HorizonProfile } from '@/lib/horizon/types';

const photo = (source: string): HorizonProfile => ({
  kind: 'photo', stepDeg: 0.25, alt: new Array(1440).fill(3), lat: 46.02, lon: 7.75, computedAt: '2026-07-01T10:00:00Z', source,
});

describe('checkSeasonalPhotoLayer (useLocalHorizon\'s seasonal switch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never runs without IndexedDB (Node, vitest), without a photo layer, or for an imported file', () => {
    const activate = vi.fn(() => Promise.resolve());
    const load = vi.fn(() => Promise.resolve({ activateSeasonalPhotoLayer: activate }));
    expect(typeof indexedDB).toBe('undefined');
    expect(checkSeasonalPhotoLayer('a', 46, 7, photo('Photo sweep'), new Date(), load)).toBe(false);
    vi.stubGlobal('indexedDB', {});
    expect(checkSeasonalPhotoLayer('a', 46, 7, null, new Date(), load)).toBe(false);
    expect(checkSeasonalPhotoLayer('a', 46, 7, undefined, new Date(), load)).toBe(false);
    expect(checkSeasonalPhotoLayer('a', 46, 7, photo(IMPORT_SOURCE), new Date(), load)).toBe(false);
    expect(checkSeasonalPhotoLayer('', 46, 7, photo('Photo sweep'), new Date(), load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('switches at most once per site and day, in the background', async () => {
    vi.stubGlobal('indexedDB', {});
    const activate = vi.fn(() => Promise.reject(new Error('blocked')));
    const load = vi.fn(() => Promise.resolve({ activateSeasonalPhotoLayer: activate }));
    const day1 = new Date(2026, 6, 1, 21, 0), later = new Date(2026, 6, 1, 23, 30), day2 = new Date(2026, 6, 2, 21, 0);
    expect(checkSeasonalPhotoLayer('site-b', 46.02, 7.75, photo('Photo sweep'), day1, load)).toBe(true);
    expect(checkSeasonalPhotoLayer('site-b', 46.02, 7.75, photo('Photo sweep'), later, load)).toBe(false);
    expect(checkSeasonalPhotoLayer('site-c', 45, 7, photo('Photo sweep'), later, load)).toBe(true);
    expect(checkSeasonalPhotoLayer('site-b', 46.02, 7.75, photo('Photo sweep'), day2, load)).toBe(true);
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(3));
    expect(activate).toHaveBeenNthCalledWith(1, 46.02, 7.75, day1);
  });
});
