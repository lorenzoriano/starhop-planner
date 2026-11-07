import { describe, expect, it } from 'vitest';
import * as Astro from 'astronomy-engine';
import { MIN_TAP_ALT_DEG, tapTargets, type TapTarget } from '../horizon/calibrate/tap-targets';
import { angleDiffDeg } from '../horizon/calibrate/quat';
import { refractionDeg } from '../horizon/profile';
import type { HorizonProfile, LocalHorizon } from '../horizon/types';

const TURIN = { lat: 45.07, lon: 7.69 };
const NIGHT = new Date('2026-11-06T21:00:00Z');
const DAY = new Date('2026-06-21T10:00:00Z');

function photoLayer(alt: (az: number) => number): LocalHorizon {
  const p: HorizonProfile = {
    kind: 'photo', stepDeg: 0.25, alt: Array.from({ length: 1440 }, (_, i) => alt(i * 0.25)),
    lat: TURIN.lat, lon: TURIN.lon, computedAt: '2026-11-06T12:00:00.000Z', source: 'test',
  };
  return { photo: p };
}

describe('tapTargets', () => {
  it('at night: bright stars and planets, all ≥ 5° up, brightest first, with apparent altitudes', () => {
    const list = tapTargets(TURIN.lat, TURIN.lon, NIGHT);
    expect(list.length).toBeGreaterThan(5);
    expect(list.every((t) => t.alt >= MIN_TAP_ALT_DEG)).toBe(true);
    expect(list.some((t) => t.source === 'sun')).toBe(false);
    const rest = list.filter((t) => t.source === 'planet' || t.source === 'star');
    for (let i = 1; i < rest.length; i++) expect(rest[i].mag).toBeGreaterThanOrEqual(rest[i - 1].mag);
    expect(list.map((t) => t.label)).toContain('Capella');
    // Southern-sky stars never rise at Turin.
    expect(list.map((t) => t.label)).not.toContain('Acrux');
  });

  it('star positions match astronomy-engine (precession, refraction) within 0.01°', () => {
    const list = tapTargets(TURIN.lat, TURIN.lon, NIGHT);
    const capella = list.find((t) => t.label === 'Capella')!;
    Astro.DefineStar(Astro.Body.Star1, 79.1723 / 15, 45.998, 1000);
    const observer = new Astro.Observer(TURIN.lat, TURIN.lon, 0);
    const eq = Astro.Equator(Astro.Body.Star1, NIGHT, observer, true, false);
    const hor = Astro.Horizon(NIGHT, observer, eq.ra, eq.dec, 'normal');
    expect(Math.abs(angleDiffDeg(capella.az, hor.azimuth))).toBeLessThan(0.01);
    expect(capella.alt).toBeCloseTo(hor.altitude, 2);
  });

  it('planets carry their name and apparent position', () => {
    const list = tapTargets(TURIN.lat, TURIN.lon, NIGHT);
    for (const p of list.filter((t) => t.source === 'planet')) {
      expect(['Venus', 'Jupiter', 'Mars', 'Saturn', 'Mercury']).toContain(p.label);
      const body = Astro.Body[p.label as keyof typeof Astro.Body];
      const observer = new Astro.Observer(TURIN.lat, TURIN.lon, 0);
      const eq = Astro.Equator(body, NIGHT, observer, true, true);
      const hor = Astro.Horizon(NIGHT, observer, eq.ra, eq.dec, 'normal');
      expect(p.alt).toBeCloseTo(hor.altitude, 2);
    }
  });

  it('by day: the Sun first (and the Moon if up), never stars or planets', () => {
    const list = tapTargets(TURIN.lat, TURIN.lon, DAY);
    expect(list[0]).toMatchObject({ source: 'sun', label: 'the Sun' });
    expect(list.every((t) => t.source === 'sun' || t.source === 'moon')).toBe(true);
    const sun = Astro.Horizon(DAY, new Astro.Observer(TURIN.lat, TURIN.lon, 0), Astro.Equator(Astro.Body.Sun, DAY, new Astro.Observer(TURIN.lat, TURIN.lon, 0), true, true).ra, Astro.Equator(Astro.Body.Sun, DAY, new Astro.Observer(TURIN.lat, TURIN.lon, 0), true, true).dec, 'normal');
    expect(list[0].alt).toBeCloseTo(sun.altitude, 2);
    expect(Math.abs(angleDiffDeg(list[0].az, sun.azimuth))).toBeLessThan(0.01);
  });

  it('the Moon comes right after the Sun when both are up', () => {
    // Search a month of daytimes for one with Sun and Moon both offered.
    let found: TapTarget[] | null = null;
    for (let d = 0; d < 30 && !found; d++) {
      const list = tapTargets(TURIN.lat, TURIN.lon, new Date(Date.UTC(2026, 9, 1 + d, 9)));
      if (list.length >= 2 && list[0].source === 'sun' && list[1].source === 'moon') found = list;
    }
    expect(found).not.toBeNull();
  });

  it('twilight offers only the brightest objects', () => {
    // Find a time in the evening when the Sun is between −6° and −1°.
    const observer = new Astro.Observer(TURIN.lat, TURIN.lon, 0);
    let t = new Date('2026-11-06T15:30:00Z');
    for (let i = 0; i < 200; i++) {
      const eq = Astro.Equator(Astro.Body.Sun, t, observer, true, true);
      const alt = Astro.Horizon(t, observer, eq.ra, eq.dec, 'normal').altitude;
      if (alt < -2 && alt > -5) break;
      t = new Date(t.getTime() + 60000);
    }
    const list = tapTargets(TURIN.lat, TURIN.lon, t);
    expect(list.filter((x) => x.source === 'star' || x.source === 'planet').every((x) => x.mag <= 0)).toBe(true);
  });

  it('drops bodies behind the local skyline', () => {
    const wall = photoLayer(() => 80);
    expect(tapTargets(TURIN.lat, TURIN.lon, NIGHT, wall)).toEqual([]);
    expect(tapTargets(TURIN.lat, TURIN.lon, DAY, wall)).toEqual([]);
  });

  it('compares the skyline correctly: apparent skyline vs the body through its geometric altitude', () => {
    const all = tapTargets(TURIN.lat, TURIN.lon, NIGHT);
    // A low target: the skyline at its azimuth is 0.95° (apparent) below it, inside the 1° margin, so it is dropped;
    // 1.1° below, it is kept. A comparison with the apparent altitude against a geometric threshold would keep both.
    const low = all.filter((t) => t.alt < 20).sort((a, b) => a.alt - b.alt)[0];
    expect(low).toBeDefined();
    const around = (gap: number) => photoLayer((az) => (Math.abs(angleDiffDeg(az, low.az)) < 2 ? low.alt - gap : 0));
    expect(refractionDeg(low.alt)).toBeGreaterThan(0.04);
    expect(tapTargets(TURIN.lat, TURIN.lon, NIGHT, around(0.95)).map((t) => t.label)).not.toContain(low.label);
    expect(tapTargets(TURIN.lat, TURIN.lon, NIGHT, around(1.1)).map((t) => t.label)).toContain(low.label);
  });

  it('the southern hemisphere gets its own stars', () => {
    const list = tapTargets(-33.87, 151.21, new Date('2026-05-01T11:00:00Z'));
    expect(list.map((t) => t.label)).toEqual(expect.arrayContaining(['Acrux']));
  });
});
