/**
 * Region geometry, compactness of generated journeys, exact re-ordering, slot grammar, story graph and
 * get-there guidance (doc 05 §12.3–12.5).
 */
import { describe, expect, it } from 'vitest';
import { angularDistance, eqToHorizontal } from '../../astronomy';
import { generate } from '../assemble';
import { buildCandidateTable, compileTemplate, lifeStageOf, nextSlots, prepareKb, slotSequenceValid } from '../candidates';
import { normalizeRequest, ofDateConverter, fastAltAz } from '../conditions';
import { buildGetThere, fieldsPhrase, getThereMode, screenBearing } from '../getthere';
import { heldKarpOrder, orderObjective } from '../order';
import { buildPatches, gnomonic, pathGeometry, principalAxis, turnAngleDeg } from '../region';
import { searchJourneys, selectTemplates } from '../search';
import { mulberry32 } from '../seed';
import { journeyViolations } from '../validate';
import { FIXTURE_KB, FIXTURE_TEMPLATES } from '../__fixtures__/fixture-kb';
import { request, syntheticKb } from './engine-helpers';
import type { Template } from '../types';

describe('flat projection and path metrics', () => {
  it('gnomonic projection is centred and symmetric, also across RA 0/360', () => {
    expect(gnomonic({ ra: 10, dec: 20 }, 10, 20)).toEqual([0, 0]);
    const [x1, y1] = gnomonic({ ra: 0, dec: 0 }, 5, 3);
    const [x2, y2] = gnomonic({ ra: 0, dec: 0 }, 355, -3);
    expect(x1).toBeCloseTo(-x2, 9);
    expect(y1).toBeCloseTo(-y2, 9);
    const [xw] = gnomonic({ ra: 359, dec: 0 }, 1, 0);
    expect(xw).toBeCloseTo((Math.tan(2 * Math.PI / 180) * 180) / Math.PI, 6);
  });

  it('turn angles on known triangles; tiny hops never count as turns', () => {
    expect(turnAngleDeg([0, 0], [10, 0], [20, 0], 10, 10)).toBeCloseTo(0, 9);
    expect(turnAngleDeg([0, 0], [10, 0], [10, 10], 10, 10)).toBeCloseTo(90, 9);
    expect(turnAngleDeg([0, 0], [10, 0], [0, 1], 10, 10)).toBeGreaterThan(170);
    expect(turnAngleDeg([0, 0], [10, 0], [9, 0], 10, 1)).toBe(0);
  });

  it('principal-axis reversals: sweep 0, zig-zag ≥ 2, one U-turn = 1 sharp turn', () => {
    const c = { ra: 90, dec: 0 };
    const sweep = [0, 6, 12, 18, 24].map((d) => ({ ra: 78 + d, dec: d * 0.2 }));
    expect(pathGeometry(sweep, c, 30)).toMatchObject({ reversals: 0, sharpTurns: 0 });
    const zig = [{ ra: 75, dec: 0 }, { ra: 90, dec: 1 }, { ra: 76, dec: 2 }, { ra: 91, dec: 3 }, { ra: 77, dec: 4 }];
    expect(pathGeometry(zig, c, 30).reversals).toBeGreaterThanOrEqual(2);
    const uturn = [{ ra: 80, dec: 0 }, { ra: 90, dec: 0 }, { ra: 100, dec: 0 }, { ra: 90, dec: 0.5 }];
    const g = pathGeometry(uturn, c, 30);
    expect(g.sharpTurns).toBe(1);
    expect(g.backtrackHops).toContain(2);
    // Small side-steps (< 0.15 R) are not reversals.
    const wiggle = [{ ra: 80, dec: 0 }, { ra: 90, dec: 0 }, { ra: 89, dec: 3 }, { ra: 100, dec: 3 }];
    expect(pathGeometry(wiggle, c, 30).reversals).toBe(0);
    expect(principalAxis([[0, 0], [1, 0], [2, 0]]).map((x) => Math.abs(x))).toEqual([1, 0]);
  });

  it('patches: members inside the cap, NMS spacing, near-pole and RA-wrap caps', () => {
    const objs = [
      { ra: 359, dec: 0 }, { ra: 1, dec: 1 }, { ra: 3, dec: -1 }, { ra: 357, dec: 2 },
      { ra: 0, dec: 88 }, { ra: 180, dec: 87 }, { ra: 90, dec: 86 },
    ].map((p, i) => ({ ...p, feasible: true, interest: 0.5 + i / 20, concepts: ['C'], con: 'Psc' }));
    const patches = buildPatches(objs, { radius: 20, minAlt: 30, altAz: () => ({ alt: 60, az: 180 }), moon: { up: false, ra: 0, dec: 0, illumination: 0 } });
    expect(patches.length).toBeGreaterThanOrEqual(2);
    for (const p of patches) for (const m of p.members) expect(angularDistance(p.ra, p.dec, objs[m].ra, objs[m].dec)).toBeLessThanOrEqual(20 + 1e-9);
    for (let a = 0; a < patches.length; a++) for (let b = a + 1; b < patches.length; b++) expect(angularDistance(patches[a].ra, patches[a].dec, patches[b].ra, patches[b].dec)).toBeGreaterThanOrEqual(15);
    expect(patches.some((p) => p.members.length === 4 && p.members.includes(0) && p.members.includes(1))).toBe(true);
    expect(patches.some((p) => p.members.includes(4) && p.members.includes(5))).toBe(true);
  });
});

describe('region compactness of generated journeys', () => {
  it('every journey stays in one cap and keeps the observer facing one part of the sky', () => {
    const kb = syntheticKb(24);
    let n = 0;
    for (const instant of ['2027-01-09T05:00:00Z', '2027-03-01T04:00:00Z', '2026-12-10T08:00:00Z', '2027-02-02T10:30:00Z']) {
      const req = request(instant);
      const res = generate(kb, req);
      for (const j of res.journeys) {
        n++;
        const objs = j.stops.map((st) => kb.objects.find((o) => o.id === st.objectId)!);
        const geo = pathGeometry(objs, j.regionCenter, j.regionRadius);
        expect(geo.maxFromCenter).toBeLessThanOrEqual(j.regionRadius + 1e-9);
        expect(geo.maxHopDeg).toBeLessThanOrEqual(20);
        expect(geo.pathDeg).toBeLessThanOrEqual(2.5 * j.regionRadius);
        expect(geo.reversals).toBeLessThanOrEqual(1);
        expect(geo.sharpTurns).toBeLessThanOrEqual(1);
        // Facing one part of the sky: stop azimuths at their windows span well under a half circle.
        const az = j.stops.map((st, i) => eqToHorizontal(objs[i].ra, objs[i].dec, req.lat, req.lon, new Date(st.windowStart)));
        const alts = az.map((x) => x.alt);
        const spread = Math.max(...az.map((a) => Math.max(...az.map((b) => Math.min(Math.abs(a.az - b.az), 360 - Math.abs(a.az - b.az))))));
        if (Math.min(...alts) < 70) expect(spread).toBeLessThan(150);
        expect(j.regionCenter.label.length).toBeGreaterThan(5);
      }
    }
    expect(n).toBeGreaterThan(4);
  });
});

describe('slot grammar', () => {
  const t = (order: Template['order'], swapGroups?: number[][]): Template => ({ ...FIXTURE_TEMPLATES[0], order, swapGroups });
  it('strict, partial (swap groups) and free orders', () => {
    const strict = compileTemplate(t('strict'));
    // A1 slots: 0 Nursery, 1 Young family ×1–3, 2 Impostor?, 3 Aging star?, 4 Doomed giant, 5 Shattered star?
    expect(slotSequenceValid(strict, [0, 1, 1, 4, 5])).toBe(true);
    expect(slotSequenceValid(strict, [0, 1, 3, 2, 4])).toBe(false);
    expect(slotSequenceValid(strict, [0, 4])).toBe(false); // required young family missing
    expect(slotSequenceValid(strict, [0, 1, 1, 1, 1, 4])).toBe(false); // repeat max 3
    const partial = compileTemplate(t('partial', [[2, 3]]));
    expect(slotSequenceValid(partial, [0, 1, 3, 2, 4])).toBe(true);
    expect(slotSequenceValid(partial, [0, 1, 2, 4, 3])).toBe(false);
    // Free order shuffles the middle of the arc only: the hook opens, the payoff and coda close (P4 evaluation).
    const free = compileTemplate(t('free'));
    expect(slotSequenceValid(free, [0, 3, 1, 4])).toBe(true);
    expect(slotSequenceValid(free, [0, 1, 3, 4])).toBe(true);
    expect(slotSequenceValid(free, [4, 1, 0])).toBe(false); // payoff first, hook last
    expect(slotSequenceValid(free, [1, 0, 4])).toBe(false); // hook not first
    expect(slotSequenceValid(free, [0, 1, 0, 4])).toBe(false); // a slot run cannot restart
    expect(nextSlots(strict, -1, 0, 0)).toEqual([0]);
  });

  it('derived life stage (spec decision 2)', () => {
    const by = (id: string) => FIXTURE_KB.objects.find((o) => o.id === id)!;
    expect(lifeStageOf(by('M42'))).toBe(0);
    expect(lifeStageOf(by('NGC1981'))).toBe(1);
    expect(lifeStageOf(by('M45'))).toBe(2);
    expect(lifeStageOf(by('STAR-Aldebaran'))).toBe(3);
    expect(lifeStageOf(by('STAR-Betelgeuse'))).toBe(4);
    expect(lifeStageOf(by('M1'))).toBe(6);
  });
});

describe('story graph', () => {
  const prep = prepareKb(FIXTURE_KB);
  const ix = (id: string) => prep.index.get(id)!;
  const all = new Set(['LIFE_NEXT', 'CAUSE', 'SIBLING', 'CONTRAST', 'SAME_FAMILY', 'SCALE', 'TIME_MACHINE', 'SAME_PHYSICS', 'NEIGHBOR', 'LINE_OF_SIGHT'] as const);
  it('curated edges win; direction respected; no self links; NEIGHBOR never justifies', () => {
    expect(prep.graph.best(ix('HR1895'), ix('M42'), all)).toMatchObject({ type: 'CAUSE', curated: true });
    expect(prep.graph.best(ix('M42'), ix('HR1895'), new Set(['CAUSE'] as const))).toBeNull();
    expect(prep.graph.best(ix('HR1713'), ix('STAR-Betelgeuse'), all)).toMatchObject({ type: 'CONTRAST', subtype: 'teffK', curated: true });
    expect(prep.graph.derivedEdges(ix('M42'), ix('M42'))).toEqual([]);
    expect(prep.graph.best(ix('M42'), ix('M43'), new Set(['NEIGHBOR'] as const))).toBeNull();
  });
  it('derived rules: life stage, contrast, siblings, line of sight', () => {
    const types = (a: string, b: string) => prep.graph.derivedEdges(ix(a), ix(b)).map((e) => `${e.type}:${e.subtype}`);
    expect(types('STAR-Betelgeuse', 'M1')).toContain('LIFE_NEXT:stage-4-6');
    expect(types('M42', 'NGC1981')).toContain('LIFE_NEXT:stage-0-1');
    expect(types('NGC1981', 'M42')).not.toContain('LIFE_NEXT:stage-0-1');
    expect(types('M42', 'HR1895')).toContain('SIBLING:same-context');
    expect(types('M35', 'NGC2158')).toContain('LINE_OF_SIGHT:line-of-sight');
    expect(types('M45', 'AST-Hyades')).toContain('CONTRAST:ageMyr');
    for (const e of prep.graph.derivedEdges(ix('M45'), ix('M35'))) {
      expect(e.strength).toBeGreaterThanOrEqual(0.2);
      expect(e.strength).toBeLessThanOrEqual(1);
      expect(e.curated).toBe(false);
    }
  });
});

describe('exact re-ordering (Held–Karp)', () => {
  const permutations = (n: number): number[][] => {
    if (n === 1) return [[0]];
    return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
  };
  it('equals brute force over all orders and respects time windows and the grammar', () => {
    const kb = syntheticKb(12);
    const prep = prepareKb(kb);
    const rng = mulberry32(5);
    let compared = 0;
    for (const instant of ['2027-01-09T05:00:00Z', '2027-02-15T05:00:00Z', '2026-12-05T09:00:00Z']) {
      for (const length of [4, 5, 6]) {
        const s = normalizeRequest(request(instant, { length }));
        const table = buildCandidateTable(prep, s, undefined, length);
        const g = table.grid, conv = ofDateConverter(g.times[g.midIndex]);
        const patches = buildPatches(prep.objects.map((o, i) => ({ ra: o.ra, dec: o.dec, feasible: table.feasibleMask[i] !== 0, interest: o.interest, concepts: [], con: o.con })), {
          radius: 30, minAlt: 30, altAz: (ra, dec) => { const p = conv.raDec(ra, dec); return fastAltAz(p.ra, p.dec, s.lat, s.lon, g.gastDeg[g.midIndex]); },
          moon: { up: false, ra: 0, dec: 0, illumination: 0 },
        });
        const { candidates } = searchJourneys(table, patches, selectTemplates(prep, null, s.sky), { lengthRange: [length, length] });
        for (const c of candidates.filter(() => rng() < 0.5).slice(0, 12)) {
          const n = c.plan.stops.length;
          const brute = Math.max(...permutations(n).map((p) => orderObjective(table, c.plan, p)));
          const hk = heldKarpOrder(table, c.plan);
          if (brute === -Infinity) { expect(hk).toBeNull(); continue; }
          expect(hk).not.toBeNull();
          const order = hk!.stops.map((st) => c.plan.stops.indexOf(st));
          expect(orderObjective(table, c.plan, order)).toBeCloseTo(brute, 9);
          // The DP order keeps every stop inside its time window and the template grammar.
          const v = journeyViolations(table, hk!).filter((x) => x.code !== 'geometry');
          expect(v.filter((x) => /not feasible|grammar|slot/.test(x.detail))).toEqual([]);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(5);
  });
});

describe('get there', () => {
  it('modes by distance in binocular fields', () => {
    expect(getThereMode(3, 6.5, false)).toBe('same-field');
    expect(getThereMode(10, 6.5, false)).toBe('sweep');
    expect(getThereMode(30, 6.5, false)).toBe('naked-eye-hop');
    expect(getThereMode(1, 6.5, true)).toBe('naked-eye-hop');
    expect(fieldsPhrase(0.3)).toBe('half a');
    expect(fieldsPhrase(1.5)).toBe('one and a half');
    expect(fieldsPhrase(2.2)).toBe('two');
  });

  it('bearing relative to the horizon: up = toward the zenith, right = increasing azimuth', () => {
    expect(screenBearing({ alt: 40, az: 180 }, { alt: 50, az: 180 })).toBeCloseTo(0, 6);
    // Same altitude circle: almost exactly sideways (the small circle bends slightly upward).
    expect(Math.abs(screenBearing({ alt: 40, az: 180 }, { alt: 40, az: 190 }) - 90)).toBeLessThan(5);
    expect(screenBearing({ alt: 40, az: 180 }, { alt: 30, az: 180 })).toBeCloseTo(180, 6);
    expect(Math.abs(screenBearing({ alt: 40, az: 10 }, { alt: 40, az: 350 }) - 270)).toBeLessThan(10);
  });

  it('texts for each mode, never with unfilled placeholders', () => {
    const rng = mulberry32(1);
    const prev = { id: 'M42', name: 'Orion Nebula', con: 'Ori', ra: 83.85, dec: -5.45, alt: 40, az: 150 };
    const near = { id: 'NGC1981', name: 'NGC 1981', con: 'Ori', ra: 83.8, dec: -4.43, alt: 41, az: 150.5 };
    const far = { id: 'M1', name: 'Crab Nebula', con: 'Tau', ra: 83.6, dec: 22, alt: 65, az: 140 };
    const same = buildGetThere({ prev, next: near, anchor: null, fovDeg: 6.5, distanceDeg: 1, anchorDistanceDeg: 0, bank: FIXTURE_KB.narration, rng });
    expect(same.mode).toBe('same-field');
    expect(same.bearingText).toMatch(/same view/);
    const hop = buildGetThere({ prev, next: far, anchor: { id: 'STAR-Aldebaran', name: 'Aldebaran', ra: 69, dec: 16.5, mag: 0.85, alt: 60, az: 160 }, fovDeg: 6.5, distanceDeg: 27.5, anchorDistanceDeg: 15, bank: FIXTURE_KB.narration, rng });
    expect(hop.mode).toBe('naked-eye-hop');
    expect(hop.anchorId).toBe('STAR-Aldebaran');
    const first = buildGetThere({ prev: null, next: { ...far, name: 'Betelgeuse', id: 'B' }, anchor: { id: 'B', name: 'Betelgeuse', ra: 0, dec: 0, mag: 0.5, alt: 65, az: 140 }, fovDeg: 6.5, distanceDeg: 0, anchorDistanceDeg: 0, rng });
    expect(first.bearingText).toMatch(/^Find Betelgeuse by eye/);
    for (const x of [same, hop, first]) expect(x.bearingText).not.toMatch(/\{|undefined|NaN/);
  });
});
