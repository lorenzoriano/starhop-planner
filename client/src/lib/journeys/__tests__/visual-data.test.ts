import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from '../__fixtures__/fixture-kb';
import type { KbObject, NarrationBank } from '../types';
import {
  ORBITS_RSUN, SUN, VISUAL_REFERENCES, ageBarModel, agePosition, binHrBackground, blackbodyRgb, builtinHrGrid, bvFromTeff,
  cardSources, compareWithPrevious, compass8, distanceLadderModel, fmtSig, formatCalendarYear, formatFactDisplay,
  formatFactRange, formatMarbleLength, formatSunDay, hrMarkers, hrProject, HR_DOMAIN, ladderPosition, lightCurveModel,
  lightCurveShapeFor, lightCurveValue, lightLeft, MARBLE_KM_PER_LY, objectAbsMag, relatableLine, roundSig,
  sizeComparisonModel, cloudSizeModel, stopYear, teffFromBV, temperatureBarPosition, temperatureWord, visualReferenceIds, visualsFor,
} from '../visual-data';

const obj = (id: string) => {
  const o = FIXTURE_KB.objects.find((x) => x.id === id);
  if (!o) throw new Error(`fixture object ${id} missing`);
  return o;
};

describe('number formatting', () => {
  it('rounds to two significant figures', () => {
    expect(roundSig(764)).toBe(760);
    expect(roundSig(1350)).toBe(1400);
    expect(roundSig(2.57)).toBe(2.6);
    expect(roundSig(0.00917)).toBe(0.0092);
    expect(fmtSig(12100)).toBe('12,000');
    expect(fmtSig(42.8)).toBe('43');
    expect(fmtSig(0.0092)).toBe('0.0092');
  });
  it('formats facts with ≈ and units, and ranges on tap', () => {
    const b = obj('STAR-Betelgeuse');
    expect(formatFactDisplay('radiusRsun', b.facts.radiusRsun!)).toBe("≈ 760 × the Sun's radius");
    expect(formatFactDisplay('teffK', b.facts.teffK!)).toBe('≈ 3,600 K');
    expect(formatFactDisplay('distanceLy', b.facts.distanceLy!)).toBe('≈ 550 light-years');
    expect(formatFactRange('radiusRsun', b.facts.radiusRsun!)).toBe("700–880 × the Sun's radius");
    expect(formatFactRange('distanceLy', b.facts.distanceLy!)).toBe('500–640 light-years');
    expect(formatFactDisplay('ageMyr', { value: 4568, unit: 'Myr', sourceId: 'x', method: 'literature' })).toBe('≈ 4.6 billion years');
    expect(formatFactDisplay('ageMyr', { value: 0.3, unit: 'Myr', sourceId: 'x', method: 'literature' })).toBe('≈ 300,000 years');
  });
  it('writes calendar years with era labels', () => {
    expect(formatCalendarYear(1470)).toBe('1470');
    expect(formatCalendarYear(680)).toBe('680 CE');
    expect(formatCalendarYear(-5499)).toBe('5500 BCE');
  });
});

describe('light left (doc 06 §7.1, MC5 honesty rule)', () => {
  it('rounds to the decade above 100 ly and the century above 1,000 ly', () => {
    expect(lightLeft(66.6, 2027, 0.02).year).toBe('1960');
    expect(lightLeft(548, 2027, 0.05).year).toBe('1480');
    expect(lightLeft(1350, 2027, 0.02).year).toBe('700 CE'); // 677 rounded to the century
    expect(lightLeft(6500, 2027, null).year).toBe('4500 BCE');
  });
  it('drops the calendar year when the distance is too uncertain', () => {
    const ll = lightLeft(548, 2027, 0.25);
    expect(ll.year).toBe('the 1400s');
  });
  it('switches to a duration beyond 12,000 ly', () => {
    const ll = lightLeft(2.5e6, 2027);
    expect(ll.year).toBeNull();
    expect(ll.ago).toBe('2.5 million years');
    expect(ll.short).toContain('2.5 million years ago');
  });
});

describe('shared marble scale', () => {
  it('puts Earth about 1.1 m from a 1 cm Sun and a light-year at about 68 km', () => {
    expect(ORBITS_RSUN[0].radiusRsun / 2 / 100).toBeCloseTo(1.075, 2); // m, in units of the 1 cm diameter
    expect(MARBLE_KM_PER_LY).toBeGreaterThan(67);
    expect(MARBLE_KM_PER_LY).toBeLessThan(69);
  });
  it('formats lengths with sensible units', () => {
    expect(formatMarbleLength(764)).toBe('7.6 m'); // doc 06 §7.1: Betelgeuse ~7.6 m
    expect(formatMarbleLength(1)).toBe('1 cm');
    expect(formatMarbleLength(0.0092)).toBe('0.092 mm');
  });
  it('maps ages onto the Sun-day clock', () => {
    expect(formatSunDay(100)).toBe('31 minutes');
    expect(formatSunDay(4600)).toBe('24 hours');
    expect(formatSunDay(1)).toBe('19 seconds');
  });
  it('orbit radii follow the NASA fact sheet and IAU R☉', () => {
    expect(ORBITS_RSUN.map((o) => Math.round(o.radiusRsun))).toEqual([215, 328, 1119]);
  });
});

describe('relatable lines', () => {
  const bank: NarrationBank = {
    version: 't',
    variants: {
      'compare.size.marble.s328': ['If the Sun were a 1 cm marble, {name} would be about {scaled} across, past Mars.'],
      'compare.size.marble': ['generic {name} {scaled}'],
      'compare.distance.light-left.b416': ['The light left {name} around {year}.'],
      'compare.temperature.sun.t10k': ['About {value}, {ratioPhrase}: a blue-white star.'],
    },
    bands: {
      'compare.size.marble': [{ suffix: 's10', min: 10, max: 328 }, { suffix: 's328', min: 328, max: 1119 }],
      'compare.distance.light-left': [{ suffix: 'b190', min: 190, max: 416, fact: 'distanceLy' }, { suffix: 'b416', min: 416, max: 600, fact: 'distanceLy' }],
      'compare.temperature.sun': [{ suffix: 't10k', min: 10000 }],
    },
  };
  const ctx = { refYear: 2027 };
  it('picks the banded narration variant and fills the shared-scale placeholders', () => {
    const b = obj('STAR-Betelgeuse');
    expect(relatableLine(b, 'radiusRsun', 'size.marble', bank, ctx)).toBe('If the Sun were a 1 cm marble, Betelgeuse would be about 7.6 m across, past Mars.');
    expect(relatableLine(b, 'distanceLy', 'distance.light-left', bank, ctx)).toBe('The light left Betelgeuse around 1480.');
    expect(relatableLine(obj('HR1713'), 'teffK', 'temperature.sun', bank, ctx)).toBe('About 12,000 K, about 2.1 times hotter than the Sun: a blue-white star.');
  });
  it('falls back to built-in templates and never returns a bare number', () => {
    const b = obj('STAR-Betelgeuse');
    expect(relatableLine(b, 'massMsun', 'mass.supernova-limit', undefined, ctx)).toMatch(/8 Suns/);
    for (const o of FIXTURE_KB.objects) for (const n of o.card.numbers) {
      const line = relatableLine(o, n.factRef, n.comparisonKey, FIXTURE_KB.narration, ctx);
      expect(line.length, `${o.id}.${n.factRef}`).toBeGreaterThan(10);
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });
  it('is deterministic per object', () => {
    const a = relatableLine(obj('M45'), 'distanceLy', undefined, FIXTURE_KB.narration, ctx);
    expect(relatableLine(obj('M45'), 'distanceLy', undefined, FIXTURE_KB.narration, ctx)).toBe(a);
  });
  it('fills every compare.* variant of the shipped narration bank when present', () => {
    const p = resolve(__dirname, '../../../../public/data/journeys/narration.json');
    const alt = resolve(__dirname, '../../../../public/data/journeys/src/narration.json');
    const file = existsSync(p) ? p : existsSync(alt) ? alt : null;
    if (!file) return;
    const real = JSON.parse(readFileSync(file, 'utf8')) as NarrationBank;
    for (const o of FIXTURE_KB.objects) for (const n of o.card.numbers) {
      const line = relatableLine(o, n.factRef, n.comparisonKey, real, ctx);
      expect(line, `${o.id}.${n.factRef}`).not.toMatch(/\{\w+\}|undefined|NaN/);
    }
  });
  it('accumulates comparisons with earlier stops', () => {
    const line = compareWithPrevious('radiusRsun', obj('STAR-Betelgeuse'), [{ obj: obj('STAR-Aldebaran'), stopNumber: 2 }]);
    expect(line).toBe('About 17 times larger than Aldebaran (stop 2).');
    expect(compareWithPrevious('teffK', obj('STAR-Betelgeuse'), [{ obj: obj('HR1713'), stopNumber: 1 }])).toBe('Rigel (stop 1) is about 3.4 times hotter.');
    expect(compareWithPrevious('teffK', obj('STAR-Betelgeuse'), [])).toBeNull();
  });
});

describe('blackbody colour', () => {
  // Mitchell Charity's blackbody table (2° CMF, sRGB): http://www.vendian.org/mncharity/dir3/blackbody/
  const charity: [number, [number, number, number]][] = [
    [3000, [255, 185, 105]], [3600, [255, 203, 141]], [4000, [255, 213, 161]], [5000, [255, 231, 204]],
    [5800, [255, 241, 231]], [6600, [255, 249, 253]], [10_000, [207, 218, 255]], [20_000, [173, 193, 255]], [30_000, [165, 186, 255]],
  ];
  it.each(charity)('%i K matches the published sRGB colour within 10/255', (t, ref) => {
    const rgb = blackbodyRgb(t);
    rgb.forEach((c, k) => expect(Math.abs(c - ref[k]), `${t} K channel ${k}: ${rgb} vs ${ref}`).toBeLessThanOrEqual(10));
  });
  it('labels colours in words (red-light safe) with the narration bands', () => {
    expect(temperatureWord(3600)).toBe('orange-red');
    expect(temperatureWord(3927)).toBe('orange');
    expect(temperatureWord(SUN.teffK)).toBe('yellow-white');
    expect(temperatureWord(12_100)).toBe('blue-white');
  });
  it('places hot on the left of the log bar', () => {
    expect(temperatureBarPosition(40_000)).toBe(0);
    expect(temperatureBarPosition(2500)).toBe(1);
    expect(temperatureBarPosition(12_000)).toBeLessThan(temperatureBarPosition(SUN.teffK));
  });
  it('inverts the Ballesteros relation', () => {
    for (const bv of [-0.2, 0.0, 0.65, 1.2, 1.85]) expect(bvFromTeff(teffFromBV(bv))).toBeCloseTo(bv, 2);
  });
});

describe('HR diagram', () => {
  it('uses the shipped background when present and a matching built-in fallback otherwise', () => {
    const fallback = builtinHrGrid();
    expect(fallback.source).toBe('builtin');
    expect(fallback.cells.length).toBeGreaterThan(100);
    const p = resolve(__dirname, '../../../../public/data/journeys/hr-background.json');
    if (!existsSync(p)) return;
    const grid = binHrBackground(JSON.parse(readFileSync(p, 'utf8')));
    expect(grid.cells.length).toBeGreaterThan(100);
    // The fallback is this same file binned; most cells must agree.
    const key = (c: { i: number; j: number }) => `${c.i},${c.j}`;
    const fileKeys = new Set(grid.cells.map(key));
    const overlap = fallback.cells.filter((c) => fileKeys.has(key(c))).length / fallback.cells.length;
    expect(overlap).toBeGreaterThan(0.9);
  });
  it('projects hot/luminous to the top-left and clamps out-of-range values', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const hot = hrProject(-0.3, -6, box), cool = hrProject(1.8, 10, box);
    expect(hot.x).toBeLessThan(cool.x);
    expect(hot.y).toBeLessThan(cool.y);
    expect(hrProject(5, 30, box)).toMatchObject({ x: 100, y: 100, clamped: true });
    expect(HR_DOMAIN.mvMin).toBeLessThan(-8);
  });
  it('derives absolute magnitude from apparent magnitude and distance', () => {
    // Betelgeuse V 0.5 at 168 pc → M_V ≈ −5.6
    expect(objectAbsMag(obj('STAR-Betelgeuse'))!).toBeCloseTo(-5.6, 1);
  });
  it('numbers earlier star stops and highlights the current one', () => {
    const m = hrMarkers(obj('STAR-Betelgeuse'), [{ obj: obj('M42'), stopNumber: 1 }, { obj: obj('STAR-Aldebaran'), stopNumber: 2 }], 3);
    expect(m.map((x) => [x.id, x.stopNumber, x.current])).toEqual([['STAR-Aldebaran', 2, false], ['STAR-Betelgeuse', 3, true]]);
    // Betelgeuse is redder and more luminous than Aldebaran.
    expect(m[1].bv).toBeGreaterThan(m[0].bv);
    expect(m[1].mv).toBeLessThan(m[0].mv);
  });
});

describe('size comparison', () => {
  it('draws giants inside planetary orbit rings up to the first ring outside the star', () => {
    const m = sizeComparisonModel({ id: 'b', name: 'Betelgeuse', radiusRsun: 764 }, { id: 'a', name: 'Aldebaran', radiusRsun: 45 });
    expect(m.mode).toBe('nested');
    expect(m.rings.map((r) => r.id)).toEqual(['earth', 'mars', 'jupiter']);
    expect(Math.max(...m.rings.map((r) => r.rPx), ...m.circles.map((c) => c.rPx))).toBeCloseTo(70, 5);
    expect(m.marbleSentence).toBe('If the Sun were a 1 cm marble, Betelgeuse would be about 7.6 m across.');
    expect(m.circles.find((c) => c.kind === 'sun')!.marble).toBe('1 cm');
    const sun = m.circles.find((c) => c.kind === 'sun')!, bet = m.circles.find((c) => c.kind === 'object')!;
    expect(bet.rPx / sun.rPx).toBeCloseTo(764, 3);
  });
  it('keeps small stars nested with the Sun on a linear scale', () => {
    const m = sizeComparisonModel({ id: 'c', name: 'Capella Aa', radiusRsun: 12 }, null);
    expect(m.rings).toEqual([]);
    expect(m.circles.map((c) => c.kind)).toEqual(['sun', 'object']);
  });
  it('compares white dwarfs with Earth and Jupiter', () => {
    const m = sizeComparisonModel({ id: 'wd', name: 'Sirius B', radiusRsun: 0.0081 }, null);
    expect(m.circles.map((c) => c.id)).toEqual(['jupiter', 'earth', 'wd']);
  });
  it('compares nebula sizes with the gap to the nearest star', () => {
    const m = cloudSizeModel({ name: 'M42', sizeLy: 24 }, null);
    expect(m.items[0].label).toMatch(/nearest star/);
    expect(m.items[1].frac).toBe(1);
  });
});

describe('light curve', () => {
  it('maps variability classes to schematic shapes', () => {
    expect(lightCurveShapeFor('eclipsing-algol')).toBe('eclipsing');
    expect(lightCurveShapeFor('cepheid')).toBe('pulsating');
    expect(lightCurveShapeFor('mira')).toBe('mira');
    expect(lightCurveShapeFor('semiregular')).toBe('irregular');
    expect(lightCurveShapeFor('none-detectable')).toBeNull();
  });
  it('Algol type: flat outside a ~14 % eclipse window, faintest at phase 0', () => {
    expect(lightCurveValue('eclipsing', 0)).toBe(0);
    expect(lightCurveValue('eclipsing', 0.5)).toBe(1);
    expect(lightCurveValue('eclipsing', 0.08)).toBe(1);
    expect(lightCurveValue('eclipsing', 0.04)).toBeGreaterThan(0);
  });
  it('Cepheid: rises in a quarter of the cycle, then declines slowly', () => {
    expect(lightCurveValue('pulsating', 0)).toBeCloseTo(0, 6);
    expect(lightCurveValue('pulsating', 0.25)).toBeCloseTo(1, 6);
    expect(lightCurveValue('pulsating', 0.6)).toBeGreaterThan(lightCurveValue('pulsating', 0.9));
  });
  it('β Lyrae: primary minimum deeper than the secondary', () => {
    expect(lightCurveValue('eclipsing', 0, { betaLyrae: true })).toBeLessThan(lightCurveValue('eclipsing', 0.5, { betaLyrae: true }));
  });
  it('builds an SVG path inside its box with honest labels', () => {
    const box = { x: 10, y: 5, width: 200, height: 80 };
    const m = lightCurveModel('pulsating', { vMax: 3.48, vMin: 4.37, periodDays: 5.366 }, box);
    for (const p of m.points) { expect(p.x).toBeGreaterThanOrEqual(10); expect(p.x).toBeLessThanOrEqual(210); expect(p.y).toBeGreaterThanOrEqual(5); expect(p.y).toBeLessThanOrEqual(85); }
    expect(m.yTop).toBe('brighter · mag 3.5');
    expect(m.xLabel).toContain('5.37 days');
    expect(m.caption).toMatch(/not a forecast/);
    const irr = lightCurveModel('irregular', { seed: 7 }, box);
    expect(irr.d).toBe(lightCurveModel('irregular', { seed: 7 }, box).d);
  });
});

describe('distance ladder and age bar', () => {
  const j = MOCK_JOURNEY_RESULT.journeys[0];
  const stops = j.stops.map((s) => ({ obj: obj(s.objectId), stopNumber: s.index + 1 }));
  it('places journey stops on a log light-year axis with light-left labels', () => {
    const m = distanceLadderModel(stops, 2027, 4);
    expect(m.stops.length).toBeGreaterThanOrEqual(4);
    expect(ladderPosition(10)).toBeCloseTo(1 / 7, 6);
    const bet = m.stops.find((s) => s.id === 'STAR-Betelgeuse')!;
    expect(bet.current).toBe(true);
    expect(bet.lightLeft).toBe('light left ~1480');
    expect(m.landmarks.map((l) => l.label)).toEqual(['Sirius', 'Galactic center', 'Andromeda']);
    // Close stops are staggered into rows.
    const m42 = m.stops.find((s) => s.id === 'M42')!, ngc = m.stops.find((s) => s.id === 'NGC1981')!;
    if (Math.abs(m42.pos - ngc.pos) < 0.12) expect(m42.row).not.toBe(ngc.row);
  });
  it('places cluster ages on a log axis with ranges and landmarks', () => {
    const m = ageBarModel([{ obj: obj('M45'), stopNumber: 1 }, { obj: obj('AST-Hyades'), stopNumber: 2 }], 2);
    expect(m.markers.map((x) => x.id)).toEqual(['M45', 'AST-Hyades']);
    expect(m.markers[1].current).toBe(true);
    expect(m.markers[0].pos).toBeLessThan(m.markers[1].pos);
    expect(m.sunDay).toMatch(/hours|minutes/);
    expect(agePosition(13_787)).toBeCloseTo(1, 6);
  });
});

describe('card helpers', () => {
  it('chooses visuals by object kind and facts', () => {
    expect(visualsFor(obj('STAR-Betelgeuse'))).toEqual(['temperature-swatch', 'hr-diagram', 'size-comparison', 'light-curve', 'distance-ladder']);
    const m42 = visualsFor(obj('M42'));
    expect(m42).not.toContain('hr-diagram');
    expect(m42).toContain('distance-ladder');
  });
  it('resolves every cited source and visual reference to a URL', () => {
    for (const o of FIXTURE_KB.objects as KbObject[]) {
      const refs = visualReferenceIds(visualsFor(o));
      for (const id of refs) expect(VISUAL_REFERENCES[id], id).toBeDefined();
      const list = cardSources(o, FIXTURE_KB.sources, refs);
      for (const f of Object.values(o.facts)) expect(list.some((s) => s.id === f!.sourceId), `${o.id} ${f!.sourceId}`).toBe(true);
      for (const s of list) expect(s.url).toMatch(/^https?:\/\//);
    }
  });
  it('derives year and compass direction without the wall clock', () => {
    expect(stopYear('2027-01-15T04:30:00Z')).toBe(2027);
    expect(compass8(146.9)).toBe('SE');
    expect(compass8(359)).toBe('N');
  });
});
