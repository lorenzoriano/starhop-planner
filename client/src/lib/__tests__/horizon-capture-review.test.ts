import { describe, expect, it } from 'vitest';
import {
  azAltToStrip, chooseLandmark, gridRectInStrip, maskTint, orderTrace, parseLatLon, stripToAzAlt, tapInstruction, traceCoverage,
  traceTerrainFix, visibleTapTargets, yawSentence,
} from '../horizon/capture/review';
import { gridFromTrace, relativeSkyline, shiftGrid } from '../horizon/segment/grid';
import type { HorizonProfile } from '../horizon/types';
import type { TapTarget } from '../horizon/calibrate/tap-targets';
import type { SkyGrid, YawChoice, YawFix } from '../horizon/photo-types';

const fix = (source: YawFix['source'], offsetDeg: number, sigmaDeg: number, label: string): YawFix => ({ source, offsetDeg, sigmaDeg, label });

describe('capture review helpers', () => {
  it('says how north was found, with its ± in plain words', () => {
    expect(yawSentence({ chosen: fix('sun', 12, 0.5, 'the Sun'), fixes: [] })).toBe('Lined up using the Sun (±0.5°)');
    expect(yawSentence({ chosen: fix('compass', 3, 7.6, 'the compass'), fixes: [] })).toBe('Lined up using the compass (±8°)');
    expect(yawSentence({ chosen: fix('manual', 0, 180, 'nothing yet'), fixes: [] })).toMatch(/^Not lined up with north yet/);
  });

  it('tap instructions name the direction and height', () => {
    const sun: TapTarget = { source: 'sun', label: 'the Sun', az: 225, alt: 24.4, mag: -26.7 };
    expect(tapInstruction(sun)).toBe('The Sun is to your southwest, 24° up. Centre it in the circle and press Tap when centred.');
    expect(tapInstruction({ source: 'planet', label: 'Jupiter', az: 92, alt: 6, mag: -2.5 })).toMatch(/^Jupiter is to your east, low\./);
  });

  it('offers only objects bright enough to see on the preview', () => {
    const t: TapTarget[] = [
      { source: 'sun', label: 'the Sun', az: 200, alt: 20, mag: -26.7 },
      { source: 'moon', label: 'the Moon', az: 100, alt: 30, mag: -11 },
      { source: 'planet', label: 'Venus', az: 250, alt: 15, mag: -4.2 },
      { source: 'planet', label: 'Saturn', az: 150, alt: 30, mag: 0.8 },
      { source: 'star', label: 'Deneb', az: 60, alt: 50, mag: 1.25 },
    ];
    expect(visibleTapTargets(t, 'day').map(x => x.label)).toEqual(['the Sun', 'the Moon', 'Venus']);
    expect(visibleTapTargets(t, 'night').map(x => x.label)).toEqual(['the Moon', 'Venus', 'Saturn']);
  });

  it('strip geometry round-trips and places the grid inside the panorama strip', () => {
    const p = azAltToStrip(270, 10, 2048, 512);
    expect(p.x).toBeCloseTo(1536);
    expect(p.y).toBeCloseTo((70 / 90) * 512);
    const back = stripToAzAlt(p.x, p.y, 2048, 512);
    expect(back.az).toBeCloseTo(270);
    expect(back.alt).toBeCloseTo(10);
    const grid = { altMinDeg: -10, altMaxDeg: 70 } as SkyGrid;
    const r = gridRectInStrip(grid, 2048, 512);
    expect(r.y).toBeCloseTo((10 / 90) * 512);
    expect(r.y + r.h).toBeCloseTo(512);
  });

  it('tints sky blue by its alpha and greys unseen cells', () => {
    const grid: SkyGrid = { stepDeg: 1, altMinDeg: 0, altMaxDeg: 1, width: 3, height: 1, alpha: Uint8Array.from([255, 0, 255]), known: Uint8Array.from([1, 1, 0]) };
    const t = maskTint(grid);
    expect(t[3]).toBe(Math.round(255 * 0.45));
    expect(t[7]).toBe(0);
    expect(t[11]).toBe(150);
  });

  it('trace coverage is the complement of the largest gap, across north too', () => {
    expect(traceCoverage([{ az: 10 }, { az: 50 }, { az: 90 }])).toEqual({ fromAz: 10, toAz: 90 });
    expect(traceCoverage([{ az: 350 }, { az: 5 }, { az: 20 }])).toEqual({ fromAz: 350, toAz: 20 });
    const round = Array.from({ length: 120 }, (_, i) => ({ az: i * 3 }));
    expect(traceCoverage(round)).toBeUndefined();
    expect(orderTrace([{ az: 20 }, { az: 350 }, { az: 5 }]).map(p => p.az)).toEqual([350, 5, 20]);
  });

  it('a landmark wins and reports a big disagreement plainly', () => {
    const prev: YawChoice = { chosen: fix('compass', 10, 5, 'the compass'), fixes: [fix('compass', 10, 5, 'the compass')] };
    const { choice, deltaDeg } = chooseLandmark(prev, fix('landmark', 40, 1, 'the landmark'));
    expect(deltaDeg).toBeCloseTo(30);
    expect(choice.chosen.source).toBe('landmark');
    expect(choice.fixes).toHaveLength(2);
    expect(choice.disagreement).toBe('The landmark disagrees with the compass by 30°; using the landmark.');
    const close = chooseLandmark(prev, fix('landmark', 12, 1, 'the landmark'));
    expect(close.choice.disagreement).toBeUndefined();
    expect(close.deltaDeg).toBeCloseTo(2);
    // Wraps across north.
    expect(chooseLandmark({ chosen: fix('sun', 355, 0.5, 'the Sun'), fixes: [] }, fix('landmark', 3, 0.5, 'the landmark')).deltaDeg).toBeCloseTo(8);
  });

  it('parses a typed landmark position', () => {
    expect(parseLatLon('45.97, 7.65')).toEqual({ lat: 45.97, lon: 7.65 });
    expect(parseLatLon('-33.9 151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(parseLatLon('214')).toBeNull();
    expect(parseLatLon('95, 10')).toBeNull();
  });

  describe('traceTerrainFix (night trace against the hills)', () => {
    const RAD = Math.PI / 180;
    const hills = (az: number) => 2 + 3 * Math.sin(2 * az * RAD) + 1.5 * Math.sin((5 * az + 40) * RAD) + 0.8 * Math.sin((11 * az + 10) * RAD);
    const terrain: HorizonProfile = {
      kind: 'terrain', stepDeg: 0.5, lat: 46, lon: 7.7, computedAt: '2026-11-06T00:00:00Z', source: 'test',
      alt: Array.from({ length: 720 }, (_, i) => hills(i * 0.5)), distanceKm: Array.from({ length: 720 }, () => 12),
    };
    const compass = fix('compass', 40, 6, 'the compass');
    /** The user's trace in the review's frame, which the compass left `error`° short of true north. */
    const traceWith = (error: number) => Array.from({ length: 360 }, (_, a) => ({ az: a, alt: hills(a + error) }));

    it('finds the compass error from the hills and switches north to them', () => {
      const traced = gridFromTrace(traceWith(6.3));
      const r = traceTerrainFix({ chosen: compass, fixes: [compass] }, traced, terrain)!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.deltaDeg - 6.3)).toBeLessThan(0.2);
      expect(r.choice.chosen).toMatchObject({ source: 'terrain', label: 'the hills', sigmaDeg: 1 });
      expect(Math.abs(r.choice.chosen.offsetDeg - 46.3)).toBeLessThan(0.2);
      expect(r.choice.fixes.map(f => f.source).sort()).toEqual(['compass', 'terrain']);
      expect(yawSentence(r.choice)).toBe('Lined up using the hills (±1°)');
      // Shifting the traced grid by deltaDeg puts it on the terrain.
      const s = relativeSkyline(shiftGrid(traced, r.deltaDeg));
      for (const az of [10, 95, 200, 300]) expect(Math.abs(s(az)! - hills(az))).toBeLessThan(0.3);
    });

    it('changes nothing without terrain, when north is not from the compass, or when the trace does not fit', () => {
      const traced = gridFromTrace(traceWith(6.3));
      expect(traceTerrainFix({ chosen: compass, fixes: [compass] }, traced, null)).toBeNull();
      const sun = fix('sun', 46.3, 0.5, 'the Sun');
      expect(traceTerrainFix({ chosen: sun, fixes: [compass, sun] }, traced, terrain)).toBeNull();
      const flat = gridFromTrace(Array.from({ length: 360 }, (_, a) => ({ az: a, alt: 1 })));
      expect(traceTerrainFix({ chosen: compass, fixes: [compass] }, flat, terrain)).toBeNull();
    });
  });
});
