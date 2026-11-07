import { describe, expect, it } from 'vitest';
import {
  compactHorizon, geometricFromApparent, horizonAltitudeAt, horizonLookup, horizonVerdict, isAboveLocalHorizon, layerSigmaAt,
  photoLayerSummary,
} from '@/lib/horizon/profile';
import { parseHorizonProfile, readLocalHorizon, saveHorizonLayer } from '@/lib/horizon/store';
import type { HorizonProfile } from '@/lib/horizon/types';

const terrain = (alt: (az: number) => number, distanceKm = 20): HorizonProfile => ({
  kind: 'terrain', stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => alt(i)),
  distanceKm: new Array(360).fill(distanceKm), lat: 46, lon: 7, computedAt: '2026-11-06T00:00:00Z', source: 'test',
});
const photo = (alt: (az: number) => number, uncertaintyDeg = 1): HorizonProfile => ({
  kind: 'photo', stepDeg: 0.25, alt: Array.from({ length: 1440 }, (_, i) => alt(i * 0.25)),
  lat: 46, lon: 7, computedAt: '2026-11-06T00:00:00Z', source: 'Photo', uncertaintyDeg,
});
const storage = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
};

describe('uncertainty-aware verdict (design 4.4)', () => {
  it('keeps the flat rule with no horizon', () => {
    expect(horizonVerdict(null, 0.1, 100)).toBe('clear');
    expect(horizonVerdict(undefined, -0.1, 100)).toBe('blocked');
    expect(horizonVerdict({}, 0, 100)).toBe('clear');
    expect(layerSigmaAt(null, 100)).toBe(0);
  });

  it('uses terrain sigma from the skyline distance', () => {
    const far = { terrain: terrain(() => 5, 20) };
    const t = geometricFromApparent(5);
    expect(layerSigmaAt(far, 90)).toBeCloseTo(0.2, 9);
    expect(horizonVerdict(far, t + 0.41, 90)).toBe('clear');
    expect(horizonVerdict(far, t + 0.39, 90)).toBe('marginal');
    expect(horizonVerdict(far, t - 0.39, 90)).toBe('marginal');
    expect(horizonVerdict(far, t - 0.41, 90)).toBe('blocked');
    expect(layerSigmaAt({ terrain: terrain(() => 5, 3) }, 90)).toBeCloseTo(1, 9);
    expect(layerSigmaAt({ terrain: terrain(() => 5, 0.5) }, 90)).toBeCloseTo(2, 9);
    // Terrain azimuths are exact: a steep terrain slope does not widen the margin.
    expect(layerSigmaAt({ terrain: terrain((az) => az * 0.5, 20) }, 90.5)).toBeCloseTo(0.2, 9);
  });

  it('takes the max over layers, with the sigma of the layer that wins', () => {
    const h = { terrain: terrain(() => 3, 20), photo: photo((az) => (az >= 180 && az < 200 ? 10 : 0), 0.5) };
    expect(horizonAltitudeAt(h, 90)).toBe(3);
    expect(horizonAltitudeAt(h, 190)).toBe(10);
    expect(layerSigmaAt(h, 90)).toBeCloseTo(0.2, 9); // terrain wins
    expect(layerSigmaAt(h, 190)).toBeCloseTo(0.5, 9); // photo wins, flat there
    expect(horizonVerdict(h, geometricFromApparent(10) + 1.01, 190)).toBe('clear');
    expect(horizonVerdict(h, geometricFromApparent(10) + 0.9, 190)).toBe('marginal');
    expect(horizonVerdict(h, 5, 190)).toBe('blocked');
    expect(horizonVerdict(h, 5, 90)).toBe('clear');
  });

  it('widens the margin on a steep photo edge (azimuth error → altitude error)', () => {
    // A roof edge: 0° up to 180°, then 30° — a 30° jump across one 0.25° bin.
    const h = { photo: photo((az) => (az < 180 ? 0 : 30), 1) };
    const slope = 30 / 0.25;
    expect(layerSigmaAt(h, 179.9)).toBeCloseTo(Math.hypot(1, slope * 1), 6);
    expect(layerSigmaAt(h, 90)).toBeCloseTo(1, 9);
    // 20° above the low side of the edge: clear far from the edge, only marginal right beside it.
    expect(horizonVerdict(h, 20, 90)).toBe('clear');
    expect(horizonVerdict(h, 20, 179.6)).toBe('marginal');
    // A sharper alignment narrows it again.
    const sharp = { photo: photo((az) => (az < 180 ? 0 : 30), 0.01) };
    expect(horizonVerdict(sharp, 20, 179.6)).toBe('clear');
  });

  it('defaults an imported photo layer without uncertainty to 1°', () => {
    const p = photo(() => 4);
    delete p.uncertaintyDeg;
    expect(layerSigmaAt({ photo: p }, 10)).toBeCloseTo(1, 9);
  });
});

describe('1440-bin photo layers in storage and the hot-loop lookup', () => {
  it('validates, rounds and stores a 0.25° photo layer next to the terrain, ~6 KB', () => {
    const s = storage();
    const t = terrain((az) => 2 + Math.sin(az / 20));
    const p = photo((az) => 5 * Math.abs(Math.sin(az / 7)) + 0.0123, 0.537);
    expect(parseHorizonProfile(p)).not.toBeNull();
    expect(saveHorizonLayer(t, s)).toBe(true);
    const sizeTerrain = s.items.get('starhop-local-horizon-v1')!.length;
    expect(saveHorizonLayer({ ...p, lat: 46.0005 }, s)).toBe(true); // captured ≈ 55 m away
    const photoBytes = s.items.get('starhop-local-horizon-v1')!.length - sizeTerrain;
    expect(photoBytes).toBeLessThan(8000);
    const read = readLocalHorizon(46, 7, {}, s)!;
    expect(read.terrain?.kind).toBe('terrain');
    expect(read.photo).toMatchObject({ kind: 'photo', stepDeg: 0.25, lat: 46.0005, uncertaintyDeg: 0.5 });
    expect(read.photo!.alt).toHaveLength(1440);
    expect(read.photo!.alt.every((a) => Math.abs(a * 10 - Math.round(a * 10)) < 1e-9)).toBe(true);
  });

  it('combines a 0.25° photo layer with 1° terrain at the finest step', () => {
    const h = { terrain: terrain(() => 3), photo: photo((az) => (az >= 100.25 && az <= 100.75 ? 12 : 0)) };
    const c = compactHorizon(h)!;
    expect(c.stepDeg).toBe(0.25);
    expect(c.alt).toHaveLength(1440);
    expect(c.alt[0]).toBeCloseTo(geometricFromApparent(3), 2);
    expect(c.alt[402]).toBeCloseTo(geometricFromApparent(12), 2); // 100.5°: a narrow pole survives
    const lookup = horizonLookup(h)!;
    expect(lookup(100.5)).toBeCloseTo(geometricFromApparent(12), 2);
    expect(lookup(100.125)).toBeCloseTo((geometricFromApparent(12) + geometricFromApparent(3)) / 2, 1);
    expect(isAboveLocalHorizon(h, 11, 100.5)).toBe(false);
    expect(isAboveLocalHorizon(h, 11, 102)).toBe(true);
  });

  it('keeps horizonLookup fast on a 1440-bin array', () => {
    const h = { terrain: terrain(() => 3), photo: photo((az) => 4 * Math.abs(Math.sin(az / 9))) };
    const lookup = horizonLookup(h)!;
    let sum = 0;
    const t0 = performance.now();
    for (let i = 0; i < 1_000_000; i++) sum += lookup((i * 0.137) % 360);
    const ms = performance.now() - t0;
    expect(Number.isFinite(sum)).toBe(true);
    expect(ms).toBeLessThan(500); // ~10–30 ms on a laptop
  });
});

describe('photoLayerSummary', () => {
  it('names the highest obstruction with the app compass words', () => {
    const p = photo((az) => (az >= 200 && az <= 250 ? (az === 225 ? 24 : 15) : az > 300 || az < 60 ? 0 : 3));
    expect(photoLayerSummary(p)).toBe('Trees and buildings block up to 24° to the southwest; open to the north.');
    expect(photoLayerSummary(photo((az) => (az >= 220 && az <= 230 ? 24 : 5)))).toBe('Trees and buildings block up to 24° to the southwest.');
    expect(photoLayerSummary(photo(() => 0.4))).toBe('Open sky all around in the photo; nothing nearby rises above 0.4°.');
  });
});
