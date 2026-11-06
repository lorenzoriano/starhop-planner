import { afterEach, describe, expect, it, vi } from 'vitest';
import { locateDevice, locationErrorMessage } from '../geolocation';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36';

function stubGeolocation(outcomes: Array<{ code: number } | { lat: number; lon: number }>) {
  const calls: PositionOptions[] = [];
  vi.stubGlobal('navigator', {
    userAgent: MAC,
    geolocation: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback, options: PositionOptions) => {
        calls.push(options);
        const next = outcomes.shift()!;
        if ('code' in next) fail({ code: next.code } as GeolocationPositionError);
        else ok({ coords: { latitude: next.lat, longitude: next.lon } } as GeolocationPosition);
      },
    },
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('locationErrorMessage', () => {
  it('points a Mac user at macOS Location Services when the browser is allowed but gets no position', () => {
    expect(locationErrorMessage(2, MAC)).toMatch(/System Settings → Privacy & Security → Location Services/);
  });
  it('tells an Android user to turn on Location', () => {
    expect(locationErrorMessage(2, ANDROID)).toMatch(/Turn on Location/);
  });
  it('explains a blocked permission and a timeout differently', () => {
    expect(locationErrorMessage(1, MAC)).toMatch(/blocked/);
    expect(locationErrorMessage(3, MAC)).toMatch(/too long/);
  });
});

describe('locateDevice', () => {
  it('returns a rounded position from the first, coarse attempt', async () => {
    const calls = stubGeolocation([{ lat: 45.464211, lon: 9.190012 }]);
    expect(await locateDevice()).toEqual({ ok: true, position: { lat: 45.4642, lon: 9.19 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].enableHighAccuracy).toBe(false);
  });
  it('retries once with high accuracy when the coarse fix is unavailable', async () => {
    const calls = stubGeolocation([{ code: 2 }, { lat: 37.77, lon: -122.42 }]);
    expect(await locateDevice()).toEqual({ ok: true, position: { lat: 37.77, lon: -122.42 } });
    expect(calls.map(c => c.enableHighAccuracy)).toEqual([false, true]);
  });
  it('does not retry a denied permission', async () => {
    const calls = stubGeolocation([{ code: 1 }]);
    const result = await locateDevice();
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it('explains macOS Location Services after both attempts fail on a Mac', async () => {
    stubGeolocation([{ code: 2 }, { code: 2 }]);
    const result = await locateDevice();
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/macOS/);
  });
});
