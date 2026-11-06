/**
 * Local horizon (lib/horizon) in Tonight / Best tonight, the binocular visibility model, the shared sky-feasibility
 * call, session suggestions and the catalog filter: (a) no horizon ⇒ identical results; (b) a synthetic skyline wall
 * blocks targets in its direction only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SiderealTime } from 'astronomy-engine';
import { buildUnifiedTargets, eqToHorizontal, loadBinocularTargets, loadMessier, type UnifiedTarget } from '../astronomy';
import { rankTargets, rankTonight } from '../observing';
import {
  appearanceLine, binocularAssessment, heldBack, improvements, isBehindSkyline, KITE_14X50, LIMIT_NAMES, levelWord, limitShort, visibilityLabel,
} from '../binocular-assessment';
import { estimateVisibility, terrainText } from '../visibility/model';
import { skyFeasibility } from '../sky-feasibility';
import { moonState } from '../moon';
import { sessionBinocularSuggestions } from '../session-suggestions';
import { makeSession } from '../session-planner';
import { catalogMatches, type CatalogConstraints } from '../catalog-filter';
import { equatorialOfDate } from '../fixed-equatorial';
import type { CompactHorizon } from '../horizon/profile';

vi.stubGlobal('fetch', async (input: string) => new Response(readFileSync(resolve(__dirname, '../../../public', input.replace(/^\.\//, '')), 'utf8'), { status: 200 }));
afterAll(() => vi.unstubAllGlobals());

/** Skyline `height`° (geometric) from azimuth `from` to `to` (inclusive, 1° bins), `base`° elsewhere. */
function wall(from: number, to: number, height: number, base = 0): CompactHorizon {
  return { kind: 'geometric', stepDeg: 1, alt: Array.from({ length: 360 }, (_, az) => (az >= from && az <= to ? height : base)) };
}
const LOW = wall(0, -1, 0, -5); // a skyline below every target above the flat horizon
const SW_WALL = wall(200, 260, 20);
const ALL_AROUND = wall(0, 359, 90);

const lat = 37.77, lon = -122.42, date = new Date('2026-11-09T05:00:00Z');
let targets: UnifiedTarget[];
beforeAll(async () => { targets = buildUnifiedTargets(await loadMessier(), await loadBinocularTargets()); });

describe('visibility model behind the skyline', () => {
  it('no skyline, or a skyline below the target, gives the identical estimate', () => {
    const m31 = targets.find((t) => t.id === 'M31')!;
    for (const alt of [-3, 4, 25, 60]) {
      const flat = binocularAssessment(m31, KITE_14X50, { alt });
      expect(binocularAssessment(m31, KITE_14X50, { alt, horizonAlt: alt - 0.5, horizonAz: 230 }).visibility).toEqual(flat.visibility);
      expect(binocularAssessment(m31, KITE_14X50, { alt, horizonAlt: undefined }).visibility).toEqual(flat.visibility);
      const { target, optics, sky, observer } = flat.inputs;
      expect(estimateVisibility(target, optics, sky, alt, observer, undefined)).toEqual(flat.visibility);
    }
  });
  it('above the flat horizon but below the skyline: Not visible, a terrain limitation, airmass on the true altitude', () => {
    const m31 = targets.find((t) => t.id === 'M31')!;
    const flat = binocularAssessment(m31, KITE_14X50, { alt: 4 });
    const r = binocularAssessment(m31, KITE_14X50, { alt: 4, horizonAlt: 6.2, horizonAz: 225 });
    expect(r.visibility.level).toBe(4);
    expect(r.visibility.label).toBe('Not visible');
    expect(r.visibility.limits).toEqual([{ factor: 'terrain', gain: 2, text: 'Behind the hills to the southwest — the skyline there is 6° high.' }]);
    expect(r.visibility.appearance).toBe('Hidden behind the hills to the southwest');
    // Airmass, extinction and sky brightness keep the true (geometric) altitude.
    expect(r.visibility.extinctionMag).toBeCloseTo(flat.visibility.extinctionMag, 9);
    expect(r.visibility.skyAtTarget).toBeCloseTo(flat.visibility.skyAtTarget, 9);
    expect(r.label).toBe('Behind the hills');
    expect(r.availability).toBe('Behind the hills to the southwest');
    expect(isBehindSkyline(r)).toBe(true);
    expect(levelWord(r)).toBe('Behind the hills');
    expect(visibilityLabel(r)).toBe('Behind the hills');
    expect(limitShort(r.visibility.limits[0], r)).toBe('Behind the hills to the southwest');
    expect(LIMIT_NAMES.terrain).toBeTruthy();
    // What would help: only waiting until it clears (estimated at the altitude it clears at, when known).
    const helps = improvements(r, { clearAlt: 25 });
    expect(helps.map((h) => h.kind)).toEqual(['skyline']);
    expect(helps[0].estimate.level).toBe(binocularAssessment(m31, KITE_14X50, { alt: 25 }).visibility.level);
    // Below the flat horizon stays "Below the horizon", whatever the skyline.
    expect(binocularAssessment(m31, KITE_14X50, { alt: -2, horizonAlt: 6 }).visibility.limits[0].factor).toBe('altitude');
    // The threshold is geometric; the wording shows where the skyline is seen (1.44° geometric ≈ 1.8° apparent).
    expect(terrainText({ alt: 1.44 })).toBe('Behind the hills — the skyline there is 1.8° high.');
  });
});

describe('binocular cards and hints behind the skyline', () => {
  it('says it once: no "held back by" line for the hills; the appearance carries the direction and when it clears', () => {
    const m31 = targets.find((t) => t.id === 'M31')!;
    const r = binocularAssessment(m31, KITE_14X50, { alt: 4, horizonAlt: 6.2, horizonAz: 90 });
    expect(levelWord(r)).toBe('Behind the hills');
    expect(heldBack(r)).toBeNull();
    expect(appearanceLine(r)).toBe('Hidden behind the hills to the east');
    expect(appearanceLine(r, '22:40')).toBe('Hidden behind the hills to the east until 22:40');
    expect(appearanceLine(r, null)).toBe('Hidden behind the hills to the east until after dawn');
    // Not behind the hills: the appearance and the held-back line are unchanged.
    const flat = binocularAssessment(m31, KITE_14X50, { alt: 25, sky: { ...binocularAssessment(m31, KITE_14X50).inputs.sky, zenithSqm: 18.5 } });
    expect(appearanceLine(flat, '22:40')).toBe(flat.visibility.appearance);
    expect(heldBack(flat)?.factor).not.toBe('terrain');
  });
  it('always offers "wait until it clears" when it clears tonight, rated with that moment\'s conditions', () => {
    const m31 = targets.find((t) => t.id === 'M31')!;
    const r = binocularAssessment(m31, KITE_14X50, { alt: 4, horizonAlt: 6.2, horizonAz: 225 });
    // Clearing into daylight: no better than now, yet the hint is still given (with the daylight rating).
    const day = { ...r.inputs.sky, sunAlt: 10 };
    const helps = improvements(r, { clearAlt: 25, clearSky: day });
    expect(helps.map((h) => h.kind)).toEqual(['skyline']);
    expect(helps[0].estimate.level).toBe(4);
    expect(helps[0].estimate).toEqual(binocularAssessment(m31, KITE_14X50, { alt: 25, sky: day }).visibility);
    // Clear time unknown: only when clear of the hills it would look better (as before).
    const hopeless = binocularAssessment(m31, KITE_14X50, { alt: 4, sky: day, horizonAlt: 6.2, horizonAz: 225 });
    expect(improvements(hopeless)).toEqual([]);
  });
});

describe('sky feasibility with a skyline', () => {
  it('combines the minimum altitude with the skyline; absent ⇒ unchanged', () => {
    const moon = moonState(lat, lon, date);
    const o = { alt: 20, stellar: false, mag: 4, category: 'cluster' as const, ra: 0, dec: 0 };
    const flat = skyFeasibility(o, moon, 21, 'possible');
    expect(flat.obstructed).toBe(false);
    expect(skyFeasibility({ ...o, horizonAlt: 10 }, moon, 21, 'possible')).toEqual(flat);
    const blocked = skyFeasibility({ ...o, horizonAlt: 22 }, moon, 21, 'possible');
    expect(blocked.obstructed).toBe(true);
    expect(blocked.altitudeOk).toBe(true);
    expect(blocked.ok).toBe(false);
  });
});

describe('Tonight ranking with a skyline', () => {
  const opts = { skyBrightness: 21, profile: KITE_14X50 };
  it('no horizon (absent or null) gives identical rankings', () => {
    const flat = rankTonight(targets, lat, lon, date, 'binocular', opts);
    expect(rankTonight(targets, lat, lon, date, 'binocular', { ...opts, horizon: null })).toEqual(flat);
    expect(rankTargets(targets, lat, lon, date, 'binocular', null)).toEqual(rankTargets(targets, lat, lon, date, 'binocular'));
    // A skyline below everything changes nothing but adds the obstructed/horizonAlt fields.
    const low = rankTonight(targets, lat, lon, date, 'binocular', { ...opts, horizon: LOW });
    expect(low.map((t) => [t.target.id, t.score, t.feasible, t.rating])).toEqual(flat.map((t) => [t.target.id, t.score, t.feasible, t.rating]));
  });
  it('a 20° wall to the southwest blocks only targets behind it', () => {
    const flat = new Map(rankTonight(targets, lat, lon, date, 'binocular', opts).map((t) => [t.target.id, t]));
    const walled = rankTonight(targets, lat, lon, date, 'binocular', { ...opts, horizon: SW_WALL });
    const behind = walled.filter((t) => t.az >= 201 && t.az <= 259 && t.alt > 0 && t.alt < 19.5);
    expect(behind.length).toBeGreaterThan(0);
    for (const t of behind) {
      expect(t.obstructed).toBe(true);
      expect(t.feasible).toBe(false);
      expect(t.rating).toBeNull();
    }
    // Clear of the wall: the same verdicts as with no horizon.
    const clear = walled.filter((t) => (t.az < 199 || t.az > 261) && t.alt > 0.5);
    expect(clear.length).toBeGreaterThan(0);
    for (const t of clear) {
      const f = flat.get(t.target.id)!;
      expect(t.obstructed).toBe(false);
      expect([t.feasible, t.rating, t.score]).toEqual([f.feasible, f.rating, f.score]);
    }
  });
});

describe('session suggestions with a skyline', () => {
  const session = { ...makeSession('Dark night', new Date('2026-11-09T05:00:00Z'), lat, lon), durationMinutes: 180 };
  it('no horizon ⇒ identical; a skyline all around ⇒ nothing to suggest; a wall ⇒ every pick clears it', () => {
    const flat = sessionBinocularSuggestions(session, targets, KITE_14X50);
    expect(sessionBinocularSuggestions(session, targets, KITE_14X50, 19, undefined, { horizon: null })).toEqual(flat);
    expect(sessionBinocularSuggestions(session, targets, KITE_14X50, 19, undefined, { horizon: LOW })).toEqual(flat);
    expect(sessionBinocularSuggestions(session, targets, KITE_14X50, 19, undefined, { horizon: ALL_AROUND })).toEqual([]);
    const walled = sessionBinocularSuggestions(session, targets, KITE_14X50, 19, undefined, { horizon: wall(0, 359, 45) });
    expect(walled.length).toBeGreaterThan(0);
    expect(walled.every((p) => p.alt >= 45)).toBe(true);
  });
});

describe('catalog filter with a skyline', () => {
  const start = new Date('2026-10-25T03:00Z'), end = new Date('2026-10-25T05:00Z');
  const range = { ok: true as const, start, end, segments: [{ start, end }] };
  const any: CatalogConstraints = { minAltitude: -90, minMoonDistance: 0, transitHours: null, maxRating: 3 };
  // A field 10° up to the southwest at the start of the range, sinking.
  const lst = SiderealTime(start) * 15 + lon;
  const field = (() => {
    for (let ha = 0; ha < 180; ha += 0.5) for (let dec = -60; dec < 30; dec += 0.5) {
      const ra = ((lst - ha) % 360 + 360) % 360, j = equatorialOfDate(ra, dec, start, true);
      const p = eqToHorizontal(j.ra, j.dec, lat, lon, start);
      if (Math.abs(p.alt - 10) < 0.5 && Math.abs(p.az - 230) < 1) return { ra: j.ra, dec: j.dec };
    }
    throw new Error('no field');
  })();
  // The Moon down, so the best moment is simply the highest one.
  const moonDown = (at: Date) => ({ ...moonState(lat, lon, at), alt: -30, sunAlt: -30 });
  const target: UnifiedTarget = { id: 'test', name: 'Test field', displayName: 'Test field', category: 'Open Cluster', categoryShort: 'Open Cl.', mag: 5, ...field, con: 'Sgr', source: 'binocular', size: '30′' };
  it('no horizon ⇒ identical rows', () => {
    const flat = catalogMatches(target, lat, lon, range, { ...any, minAltitude: 0 }, KITE_14X50, 21.6, moonDown);
    expect(flat).not.toBeNull();
    expect(catalogMatches(target, lat, lon, range, { ...any, minAltitude: 0, clearOfSkyline: true }, KITE_14X50, 21.6, moonDown, { horizon: null })).toEqual(flat);
  });
  it('a minimum altitude of 0° or more combines with the skyline; −90° only with clearOfSkyline', () => {
    expect(catalogMatches(target, lat, lon, range, { ...any, minAltitude: 0 }, KITE_14X50, 21.6, moonDown, { horizon: SW_WALL })).toBeNull();
    const shown = catalogMatches(target, lat, lon, range, any, KITE_14X50, 21.6, moonDown, { horizon: SW_WALL })!;
    expect(shown.alt).toBeGreaterThan(9);
    expect(shown.obstructed).toBe(true);
    expect(shown.assessment.label).toBe('Behind the hills');
    expect(catalogMatches(target, lat, lon, range, { ...any, clearOfSkyline: true }, KITE_14X50, 21.6, moonDown, { horizon: SW_WALL })).toBeNull();
    // A wall elsewhere does not touch it.
    const elsewhere = catalogMatches(target, lat, lon, range, { ...any, minAltitude: 0 }, KITE_14X50, 21.6, moonDown, { horizon: wall(20, 80, 30) })!;
    expect(elsewhere.obstructed).toBe(false);
    expect(elsewhere.alt).toBeCloseTo(catalogMatches(target, lat, lon, range, { ...any, minAltitude: 0 }, KITE_14X50, 21.6, moonDown)!.alt, 9);
  });
});
