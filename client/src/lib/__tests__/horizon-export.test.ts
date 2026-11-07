import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  combinedApparentSkyline, parseAzAltText, toAzAltText, toNinaHrz, toStellariumZip,
} from '@/lib/horizon/export';
import { horizonAltitudeAt } from '@/lib/horizon/profile';
import type { HorizonProfile, LocalHorizon } from '@/lib/horizon/types';

const SITE = { lat: 46.02, lon: 7.75 };
const terrain: HorizonProfile = {
  kind: 'terrain', stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => Math.round((4 + 3 * Math.sin((i * Math.PI) / 180)) * 10) / 10),
  distanceKm: new Array(360).fill(12), ...SITE, groundM: 1620, computedAt: '2026-11-06T00:00:00Z', source: 'Mapterhorn',
};
const photo: HorizonProfile = {
  kind: 'photo', stepDeg: 0.25, alt: Array.from({ length: 1440 }, (_, i) => (i >= 800 && i < 1000 ? 24 : 0)),
  lat: 46.0201, lon: 7.7502, computedAt: '2026-11-06T00:00:00Z', source: 'Photo', uncertaintyDeg: 0.5,
};
const both: LocalHorizon = { terrain, photo };
const pairs = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' ').map(Number));
/** Largest difference between a parsed profile and the combined skyline, over every 0.25° bin. */
function maxError(p: HorizonProfile, h: LocalHorizon) {
  let worst = 0;
  p.alt.forEach((a, i) => { worst = Math.max(worst, Math.abs(a - horizonAltitudeAt(h, i * p.stepDeg)!)); });
  return worst;
}

describe('horizon exports', () => {
  it('combines layers at the finest step (max over layers, apparent)', () => {
    const sky = combinedApparentSkyline(both)!;
    expect(sky.stepDeg).toBe(0.25);
    expect(sky.alt).toHaveLength(1440);
    expect(sky.alt[900]).toBe(24); // 225°: photo wins
    expect(sky.alt[360]).toBeCloseTo(7, 6); // 90°: terrain wins
    expect(combinedApparentSkyline(null)).toBeNull();
  });

  it('writes NINA .hrz as "az alt" pairs, azimuth ascending from 0 to 360', () => {
    const text = toNinaHrz(both);
    expect(text.startsWith('# StarHop horizon for 46.020, 7.750')).toBe(true);
    const p = pairs(text);
    expect(p).toHaveLength(1441);
    expect(p[0]).toEqual([0, 4]);
    expect(p[p.length - 1]).toEqual([360, 4]);
    expect(p[1]).toEqual([0.25, 4]);
    expect(p[900]).toEqual([225, 24]);
    for (let i = 1; i < p.length; i++) expect(p[i][0]).toBeGreaterThan(p[i - 1][0]);
    expect(toNinaHrz({})).toContain('0 0\n360 0');
  });

  it('writes our az-alt text with a short header', () => {
    const text = toAzAltText({ terrain });
    expect(text.split('\n')[0]).toBe('# StarHop horizon for 46.020, 7.750 — azimuth altitude in degrees');
    expect(pairs(text)).toHaveLength(361);
  });

  it('packs a polygonal Stellarium landscape', () => {
    const files = unzipSync(toStellariumZip(both, 'Zermatt garden'));
    expect(Object.keys(files).filter((k) => !k.endsWith('/')).sort()).toEqual(['Zermatt_garden/horizon.txt', 'Zermatt_garden/landscape.ini']);
    const ini = strFromU8(files['Zermatt_garden/landscape.ini']);
    expect(ini).toContain('[landscape]\nname = Zermatt garden\n');
    expect(ini).toContain('type = polygonal\n');
    expect(ini).toContain('polygonal_horizon_list = horizon.txt\n');
    expect(ini).toContain('polygonal_angle_rotatez = 0\n');
    expect(ini).toMatch(/ground_color = [\d.,]+\n/);
    expect(ini).toMatch(/horizon_line_color = [\d.,]+\n/);
    expect(ini).toContain('[location]\nplanet = Earth\n');
    expect(ini).toContain(`latitude = +46d01'12.4"\n`); // 46.0201°
    expect(ini).toContain(`longitude = +7d45'00.7"\n`); // 7.7502°
    expect(ini).toContain('altitude = 1620\n');
    const horizon = strFromU8(files['Zermatt_garden/horizon.txt']);
    const p = pairs(horizon);
    expect(p).toHaveLength(1440);
    // No vertex exactly on a cardinal azimuth (the polygon can vanish in Stellarium).
    expect(p.some(([az]) => az % 90 === 0)).toBe(false);
    expect(p[0]).toEqual([0.001, 4]);
    const west = unzipSync(toStellariumZip({ terrain: { ...terrain, lat: -33.5, lon: -70.25 } }, '  '));
    const westIni = strFromU8(west['starhop_horizon/landscape.ini']);
    expect(westIni).toContain(`latitude = -33d30'00.0"`);
    expect(westIni).toContain(`longitude = -70d15'00.0"`);
  });

  it('round-trips every export through parseAzAltText', () => {
    for (const text of [toNinaHrz(both), toAzAltText(both), strFromU8(unzipSync(toStellariumZip(both, 'x'))['x/horizon.txt'])]) {
      const r = parseAzAltText(text, SITE);
      if ('error' in r) throw new Error(r.error);
      expect(r.profile).toMatchObject({ kind: 'photo', stepDeg: 0.25, lat: 46.02, lon: 7.75, source: 'Imported file' });
      expect(r.profile.alt).toHaveLength(1440);
      expect(maxError(r.profile, both)).toBeLessThan(0.06);
    }
  });
});

describe('parseAzAltText', () => {
  it('interpolates sparse points with wrap-around', () => {
    const r = parseAzAltText('# my trees\n90 10\n270 20\n', SITE);
    if ('error' in r) throw new Error(r.error);
    const at = (az: number) => r.profile.alt[Math.round(az / 0.25)];
    expect(at(90)).toBe(10);
    expect(at(180)).toBe(15);
    expect(at(270)).toBe(20);
    expect(at(0)).toBe(15); // halfway from 270 to 450
    expect(at(315)).toBe(17.5);
    expect(at(45)).toBe(12.5);
  });

  it('accepts commas, tabs, semicolons, headers, CRLF, comments and a Stellarium ini', () => {
    const variants = [
      'Az, El\r\n0, 5\r\n180, 7\r\n',
      'az\talt\n0\t5\n180\t7\n',
      '2\n0;5\n180;7 ; trailing\n',
      '// exported\n0 5 extra columns\n180 7 // south\n360 5\n',
      '[landscape]\nname = x\npolygonal_horizon_list_mode = azDeg_altDeg\n0 5\n180 7\n',
    ];
    for (const v of variants) {
      const r = parseAzAltText(v, SITE);
      if ('error' in r) throw new Error(`${JSON.stringify(v)}: ${r.error}`);
      expect(r.profile.alt[0]).toBe(5);
      expect(r.profile.alt[720]).toBe(7);
      expect(r.profile.alt[360]).toBe(6);
    }
  });

  it('explains problems in plain words', () => {
    expect(parseAzAltText('', SITE)).toEqual({ error: 'The file is empty.' });
    expect(parseAzAltText('hello\nworld', SITE)).toMatchObject({ error: expect.stringMatching(/No azimuth and altitude pairs/) });
    expect(parseAzAltText('10 5\n10 6', SITE)).toMatchObject({ error: expect.stringMatching(/at least two points/) });
    expect(parseAzAltText('0 5\n90 120', SITE)).toEqual({ error: 'Line 2: the altitude 120 is not between −90° and 90°.' });
    expect(parseAzAltText('0 5\n900 1', SITE)).toMatchObject({ error: expect.stringMatching(/^Line 2: the azimuth 900/) });
    expect(parseAzAltText('polygonal_horizon_list_mode = azDeg_zdDeg\n0 85\n180 80', SITE)).toMatchObject({ error: expect.stringMatching(/other than azimuth and altitude/) });
    expect(parseAzAltText('0 5\n180 7', { lat: NaN, lon: 7 })).toMatchObject({ error: expect.stringMatching(/valid location/) });
  });
});
