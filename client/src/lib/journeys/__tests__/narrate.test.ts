import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePool } from '../assemble';
import { NarrationBankSchema } from '../kb-schema';
import {
  agoPhrase, allLines, applyNarration, compareFacts, formatFactValue, narrateJourney, narrationProblems, ratioPhrase, yearPhrase,
} from '../narrate';
import { mulberry32 } from '../seed';
import type { ArcRole, Edge, Journey, JourneyStop, KnowledgeBase, NarrationBank } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';

/** The shipped bank (or its source while the KB is being built); null when neither exists yet. */
function shippedBank(): NarrationBank | null {
  for (const rel of ['../../../../public/data/journeys/narration.json', '../../../../public/data/journeys/src/narration.json']) {
    const url = new URL(rel, import.meta.url);
    if (!existsSync(url)) continue;
    const parsed = NarrationBankSchema.safeParse(JSON.parse(readFileSync(url, 'utf8')));
    if (parsed.success) return parsed.data as NarrationBank;
  }
  return null;
}
const SHIPPED = shippedBank();
const KBS: [string, KnowledgeBase][] = [['fixture bank', FIXTURE_KB], ...(SHIPPED ? [['shipped bank', { ...FIXTURE_KB, narration: SHIPPED }] as [string, KnowledgeBase]] : [])];

const ARCS: ArcRole[] = ['hook', 'build', 'build', 'twist', 'payoff', 'coda'];
const SUBTYPES: Record<Edge['type'], string[]> = {
  LIFE_NEXT: ['older-analog', 'stage-2-3', 'fate-high-mass', 'x'], CAUSE: ['ionizes', 'illuminates', 'x'],
  SIBLING: ['same-association', 'same-context'], CONTRAST: ['teffK', 'distanceLy', 'ageMyr', 'radiusRsun', 'massMsun', 'lumLsun', 'same-age-different-distance'],
  SAME_FAMILY: ['twin', 'open-cluster'], SCALE: ['distanceLy-up', 'sizeLy-down', 'radiusRsun-up'], TIME_MACHINE: ['farther', 'nearer'],
  SAME_PHYSICS: ['shared-concept', 'giants'], NEIGHBOR: ['within-300-ly'], LINE_OF_SIGHT: ['line-of-sight', 'background-cluster'],
};

/** Random structurally valid journeys over fixture objects with curated and derived-style links. */
function randomJourney(seed: number): Journey {
  const rng = mulberry32(seed);
  const n = 3 + Math.floor(rng() * 6);
  const ids = FIXTURE_KB.objects.map((o) => o.id);
  const picked: string[] = [];
  while (picked.length < n) {
    const id = ids[Math.floor(rng() * ids.length)];
    if (!picked.includes(id)) picked.push(id);
  }
  const types = Object.keys(SUBTYPES) as Edge['type'][];
  const stops: JourneyStop[] = picked.map((id, i) => {
    const curated = i > 0 ? FIXTURE_KB.edges.find((e) => e.from === picked[i - 1] && e.to === id) : undefined;
    const type = curated?.type ?? types[Math.floor(rng() * types.length)];
    const subtype = curated?.subtype ?? SUBTYPES[type][Math.floor(rng() * SUBTYPES[type].length)];
    const arc = i === 0 ? 'hook' : i === n - 1 ? (rng() < 0.5 ? 'coda' : 'payoff') : ARCS[1 + Math.floor(rng() * 3)];
    return {
      index: i, objectId: id, role: arc, arc,
      link: i === 0 ? null : { from: picked[i - 1], type, subtype, strength: 0.5, reasonKey: curated?.reasonKey ?? `${type}.${subtype}`, curated: !!curated },
      windowStart: new Date(Date.UTC(2027, 0, 15, 4, 30 + 8 * i)).toISOString(),
      windowEnd: new Date(Date.UTC(2027, 0, 15, 4, 38 + 8 * i)).toISOString(),
      altAtStart: 45, azAtStart: 150, moonSepDeg: null, challenge: i >= 2 && rng() < 0.15, transitionText: null,
      getThere: { mode: 'sweep', fields: 1, distanceDeg: 6.5, bearingText: 'Sweep up.' },
    };
  });
  return {
    key: `test-${seed}`, templateId: FIXTURE_KB.templates[seed % 2].id, title: 'x', drivingQuestion: 'x', hook: 'x', stops,
    regionCenter: { ra: 85, dec: 5, altDeg: 50, azDeg: 150, label: 'Orion' }, regionRadius: 30, totalPathDeg: 30, durationMin: 8 * n,
    difficulty: 'easy', score: 0,
  };
}

describe('narration: number formatting', () => {
  it('ratio, year and light-travel phrases', () => {
    expect(ratioPhrase('teffK', 3600, 12100)).toBe('about 3 times hotter');
    expect(ratioPhrase('distanceLy', 400, 9000)).toBe('about 20 times farther');
    expect(ratioPhrase('ageMyr', 600, 100)).toBe('about 6 times younger');
    expect(ratioPhrase('teffK', 5000, 5500)).toBe('a little hotter');
    expect(ratioPhrase('teffK', 0, 5500)).toBeUndefined();
    expect(ratioPhrase('teffK', 5800, 20000, 'than the Sun')).toBe('about 3 times hotter than the Sun');
    // Two significant figures from 100 up: Caph (55 ly) against ρ Cas (9,170 ly) is 168, not "200".
    expect(ratioPhrase('distanceLy', 9170, 54.7)).toBe('about 170 times closer');
    expect(yearPhrase(548, 2027)).toBe('1480');
    expect(yearPhrase(1350, 2027)).toBe('700 CE');
    expect(yearPhrase(6500, 2027)).toBe('4500 BCE');
    expect(yearPhrase(14000, 2027)).toBe('12,000 BCE');
    expect(yearPhrase(25000, 2027)).toBeUndefined();
    expect(agoPhrase(25600)).toBe('26,000 years');
    expect(agoPhrase(2.5e6)).toBe('2.5 million years');
  });

  it('formats sourced values with units and wide ranges', () => {
    const f = (value: number, min?: number, max?: number) => ({ value, min, max, unit: 'x', sourceId: 's', method: 'literature' as const });
    expect(formatFactValue('teffK', f(3590))).toBe('3,600 K');
    expect(formatFactValue('distanceLy', f(548, 500, 640))).toBe('500–640 light-years');
    expect(formatFactValue('distanceLy', f(1350, 1328, 1373))).toBe('1,350 light-years');
    expect(formatFactValue('ageMyr', f(625))).toBe('625 million years');
    expect(formatFactValue('ageMyr', f(12000))).toBe('12 billion years');
    expect(formatFactValue('ageMyr', f(0.00097))).toBe('970 years');
    expect(formatFactValue('massMsun', f(1))).toBe('1 solar mass');
  });
});

describe('narration over generated journeys', () => {
  for (const [label, kb] of KBS) {
    it(`${label}: 200 random journeys have no unresolved placeholders, bad values or untraced numbers`, () => {
      for (let s = 1; s <= 200; s++) {
        const j = randomJourney(s);
        const nar = narrateJourney(j, kb, { seedKey: `seed-${s}`, region: 'Orion', moonIllumination: s % 3 === 0 ? 0.8 : 0 });
        expect(narrationProblems(nar, kb), `seed ${s}`).toEqual([]);
        expect(nar.stops).toHaveLength(j.stops.length);
        expect(nar.stops[0].transition).toBeNull();
        nar.stops.slice(1).forEach((st) => expect(st.transition?.text.length).toBeGreaterThan(0));
        nar.stops.slice(0, -1).forEach((st) => expect(st.skip?.text.length).toBeGreaterThan(0));
        expect(nar.stops[nar.stops.length - 1].skip).toBeNull();
        for (const l of allLines(nar)) {
          // Every rendered fact number must be traced to the object's own sourced FactValue.
          for (const num of l.numbers) {
            const o = kb.objects.find((x) => x.id === num.objectId)!;
            expect(o.facts[num.fact]?.value).toBe(num.value);
            expect(o.facts[num.fact]?.sourceId).toBe(num.sourceId);
          }
        }
      }
    });
  }

  it('prevVal/nextVal transitions carry both sourced numbers', () => {
    const j = randomJourney(1);
    j.stops = j.stops.slice(0, 2);
    j.stops[0] = { ...j.stops[0], objectId: 'STAR-Betelgeuse' };
    j.stops[1] = { ...j.stops[1], objectId: 'HR1713', link: { from: 'STAR-Betelgeuse', type: 'CONTRAST', subtype: 'teffK', strength: 1, reasonKey: 'edge.STAR-Betelgeuse>HR1713', curated: true } };
    const nar = narrateJourney(j, FIXTURE_KB, { seedKey: 'k' });
    const t = nar.stops[1].transition!;
    expect(t.text).toMatch(/3,600 K/);
    expect(t.numbers.map((x) => `${x.objectId}.${x.fact}`).sort()).toEqual(['HR1713.teffK', 'STAR-Betelgeuse.teffK']);
  });

  it('is deterministic per seed, varies across seeds and avoids reusing a variant inside a journey', () => {
    const kb = KBS[KBS.length - 1][1];
    const j = randomJourney(7);
    expect(narrateJourney(j, kb, { seedKey: 'a' })).toEqual(narrateJourney(j, kb, { seedKey: 'a' }));
    const texts = new Set<string>();
    for (let s = 0; s < 12; s++) texts.add(allLines(narrateJourney(j, kb, { seedKey: `s${s}` })).map((l) => l.text).join('|'));
    if ((kb.narration.variants['why.build']?.length ?? 0) > 1) expect(texts.size).toBeGreaterThan(1);
    // Same key used at several stops: distinct texts while the bank has enough variants.
    const many: Journey = { ...j, stops: j.stops.map((s, i) => ({ ...s, arc: i === 0 ? 'hook' : 'build', challenge: false })) };
    const nar = narrateJourney(many, kb, { seedKey: 'x' });
    const builds = nar.stops.filter((s) => s.whyHere.key === 'why.build').map((s) => s.whyHere.text);
    const variants = kb.narration.variants['why.build']?.length ?? 0;
    if (variants >= 2) expect(new Set(builds).size).toBe(Math.min(builds.length, variants));
  });
});

describe('narration over engine output', () => {
  const req = { instant: '2027-01-15T04:30:00Z', lat: 37.77, lon: -122.42, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 21.3 };
  it('narrates and applies texts to real engine journeys', () => {
    const pool = generatePool(FIXTURE_KB, req, { explore: true });
    expect(pool.journeys.length).toBeGreaterThan(0);
    for (const [, kb] of KBS) {
      for (const j of pool.journeys) {
        const nar = narrateJourney(j, kb, { seedKey: pool.seedKey, region: 'Orion', moonIllumination: pool.night.moon.up ? pool.night.moon.illumination : 0 });
        expect(narrationProblems(nar, kb)).toEqual([]);
        const applied = applyNarration(j, nar);
        expect(applied.title).toBe(nar.title.text);
        expect(applied.drivingQuestion).toBe(nar.drivingQuestion.text);
        applied.stops.forEach((s, i) => {
          expect(s.whyHereText).toBeTruthy();
          if (i > 0) expect(s.transitionText).toBe(nar.stops[i].transition!.text);
        });
        expect(nar.payoff ?? nar.coda ?? true).toBeTruthy();
      }
    }
  });
});

describe('narration: direction guards (review panel, A/B round 1)', () => {
  it('treats overlapping published ranges as "about the same", never "older"', () => {
    const f = (value: number, min?: number, max?: number) => ({ value, min, max, unit: 'Myr', sourceId: 'x', method: 'model' as const });
    // NGC 1342 (92–257 Myr) against the Pleiades (117–133 Myr): no direction may be claimed.
    expect(compareFacts(f(160, 92, 257), f(125, 117, 133))).toEqual({ overlap: true, clear: false, up: false });
    // NGC 6871 (5.1–11 Myr) against the East Veil (0.01–0.021 Myr): clearly younger, so "one old, one young".
    expect(compareFacts(f(7.8, 5.1, 11), f(0.02, 0.01, 0.021))).toEqual({ overlap: false, clear: true, up: false });
    expect(compareFacts(f(46, 41, 52), f(300))).toMatchObject({ clear: true, up: true });
  });
});
