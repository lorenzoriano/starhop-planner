/**
 * Owner feedback round 1 (docs/sky-journeys/owner-feedback-r1.md; engine-eval.md "Round 1 owner feedback"):
 * 1. distance ladders climb strictly, in even-ish steps (no flat run then one giant leap);
 * 2. never two near-identical suggestions (≥ 2 shared stops, same archetype over the same region, same title);
 * 3. heuristic recalibration (A6 prior, clean progression, one challenge stop, weak derived links, star-only themes);
 * 4. the suggestions come from the top of the score distribution;
 * 5. second pass: at most one contrast tour (A6) per result, in a slot only by A6_MARGIN; the hook and payoff of a
 *    variable-star story swing by ≥ 0.3 mag.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { A6_MARGIN, PICK_WINDOW, generate, nearIdentical, selectWithShuffle, tellsCapped } from '../assemble';
import {
  EXTRAGALACTIC_LY, LADDER_LEAP_FROM_LY, LADDER_MAX_RATIO, LADDER_MIN_RATIO, LENS_LADDER_MIN_RATIO, VISIBLE_AMPLITUDE_MAG, buildCandidateTable, compileTemplate, ladderStepOk,
  prepareKb, variableStopOk,
} from '../candidates';
import { normalizeRequest } from '../conditions';
import { HEURISTIC_WEIGHTS } from '../heuristic-weights';
import { knowledgeBaseFromFiles } from '../kb-schema';
import {
  ARCHETYPE_PRIOR, CHALLENGE_BONUS, CLEAN_PROGRESSION_BONUS, WEAK_LINK_PENALTY, addStopTerms, archetypePrior, isWeakDerivedLink, progressionTerm,
} from '../search';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import type { Edge, JourneyRequest, KbObject, KnowledgeBase } from '../types';
import { independentProblems, request, resultProblems } from './engine-helpers';

const byId = (id: string) => FIXTURE_KB.objects.find((o) => o.id === id)!;
const at = (id: string, ly: number): KbObject => ({ ...structuredClone(byId(id)), facts: { ...byId(id).facts, distanceLy: { value: ly, unit: 'ly', sourceId: 'x', method: 'catalog' } } } as KbObject);

describe('distance ladders climb in even steps', () => {
  it('ladderStepOk: at least 2× and at most 15× per rung; the leap out of the galaxy only from a far rung', () => {
    const s = (a: number, b: number) => ladderStepOk(at('STAR-Aldebaran', a), at('STAR-Betelgeuse', b));
    expect(LADDER_MIN_RATIO).toBe(2);
    expect(LADDER_MAX_RATIO).toBe(15);
    expect(s(65, 548)).toBe(true);
    expect(s(548, 65)).toBe(false); // never closer
    expect(s(100, 180)).toBe(false); // < 2×: "four of them within the same range"
    expect(s(384, 24_201)).toBe(false); // cal-03 D: g Her → M13, a 63× leap after a flat run
    expect(s(2_300, 24_201)).toBe(true);
    expect(s(9_170, 2_482_000)).toBe(true); // cal-01 A (owner's favourite): the leap to Andromeda from far out
    expect(s(1_414, 2_482_000)).toBe(false); // leap from a rung closer than LADDER_LEAP_FROM_LY
    expect(s(LADDER_LEAP_FROM_LY, EXTRAGALACTIC_LY)).toBe(true);
    const noDistance = { ...structuredClone(byId('STAR-Betelgeuse')), facts: {} } as KbObject;
    expect(ladderStepOk(at('STAR-Aldebaran', 65), noDistance)).toBe(false);
  });

  it('the two bounds keep in-galaxy steps even: largest / smallest log-step ≤ log 15 / log 2', () => {
    // Any chain the rule accepts below EXTRAGALACTIC_LY has step ratios inside [2, 15].
    const chain = [25, 60, 400, 2_600, 24_201];
    for (let i = 1; i < chain.length; i++) expect(ladderStepOk(at('STAR-Aldebaran', chain[i - 1]), at('STAR-Betelgeuse', chain[i]))).toBe(true);
    const logs = chain.slice(1).map((d, i) => Math.log10(d / chain[i]));
    expect(Math.max(...logs) / Math.min(...logs)).toBeLessThanOrEqual(Math.log10(LADDER_MAX_RATIO) / Math.log10(LADDER_MIN_RATIO) + 1e-9);
  });

  it('templates with a distance-up progression are ladders; star-only themes are flagged', () => {
    const ladder = compileTemplate({ ...FIXTURE_KB.templates[1], id: 'T-far', progression: { property: 'distanceLy', direction: 'up' } });
    expect(ladder.ladder).toBe(true);
    expect(compileTemplate(FIXTURE_KB.templates[0]).ladder).toBe(false);
  });
});

const near = (o: Partial<Edge> = {}): Edge => ({ from: 'a', to: 'b', type: 'SAME_FAMILY', subtype: 'star:2', strength: 0.4, reasonKey: 'SAME_FAMILY', curated: false, ...o });

describe('heuristic recalibration (round 1)', () => {
  it('weak derived links, challenge stops, archetype priors', () => {
    expect(isWeakDerivedLink(near())).toBe(true);
    expect(isWeakDerivedLink(near({ curated: true }))).toBe(false);
    expect(isWeakDerivedLink(near({ strength: 0.45 }))).toBe(false);
    expect(isWeakDerivedLink(null)).toBe(false);
    expect(WEAK_LINK_PENALTY).toBeGreaterThan(0);
    expect(CHALLENGE_BONUS).toBeGreaterThan(0);
    // A6 (ranked low twice) below zero; the owner's progression favourite above. A4 and A10 are retired as
    // journeys (owner feedback r2), so they carry no prior.
    expect(ARCHETYPE_PRIOR.A6).toBeLessThan(0);
    expect(ARCHETYPE_PRIOR.A3).toBeGreaterThan(0);
    for (const a of ['A4', 'A10']) expect(ARCHETYPE_PRIOR[a]).toBeUndefined();
    // Moderate: no prior outweighs a whole stop's interest + link (≈ 1.0 + 0.8).
    for (const v of Object.values(ARCHETYPE_PRIOR)) expect(Math.abs(v)).toBeLessThanOrEqual(1.0);
    expect(archetypePrior(compileTemplate({ ...FIXTURE_KB.templates[0], archetype: 'A6' }))).toBe(ARCHETYPE_PRIOR.A6);
    expect(archetypePrior(compileTemplate({ ...FIXTURE_KB.templates[0], archetype: 'A99' }))).toBe(0);
    // The feature-tier baseline agrees: one challenge stop is a plus.
    expect(HEURISTIC_WEIGHTS.has_challenge).toBeGreaterThan(0);
  });

  it('a clean progression earns a bonus; one step back loses it', () => {
    const ct = compileTemplate({ ...FIXTURE_KB.templates[1], id: 'T-far', progression: { property: 'distanceLy', direction: 'up' } });
    const up = [10, 30, 100, 300].map((d) => at('STAR-Aldebaran', d));
    const back = [10, 30, 100, 50].map((d) => at('STAR-Aldebaran', d));
    expect(progressionTerm(up, ct)).toBeCloseTo(3 * 0.3 + CLEAN_PROGRESSION_BONUS, 9);
    expect(progressionTerm(back, ct)).toBeCloseTo(0.3 + 0.3 - 0.3, 9);
    // Two steps are not yet a progression worth a bonus.
    expect(progressionTerm(up.slice(0, 3), ct)).toBeCloseTo(0.6, 9);
  });

  it('weak links and a challenge stop change h by exactly their terms; star-only themes skip the kind-run cost', () => {
    const prep = prepareKb(FIXTURE_KB);
    const table = buildCandidateTable(prep, normalizeRequest(request('2027-01-09T05:00:00Z')), undefined, 4);
    const objs = ['STAR-Betelgeuse', 'HR1713', 'STAR-Aldebaran'].map((x) => prep.index.get(x)!);
    const strong = near({ strength: 0.9 });
    const x = (links: Edge[], kindFree?: boolean[]) => ({ objs, links, hops: [5, 5], turns: [30], arcs: ['hook', 'build', 'build'] as const, ...(kindFree ? { kindFree } : {}) });
    const sum = (inp: ReturnType<typeof x>) => [0, 1, 2].reduce((h, i) => addStopTerms(table, 30, { ...inp, arcs: [...inp.arcs] }, i, h), 0);
    const weakH = sum(x([near(), strong])), strongLinkH = sum(x([near({ strength: 0.4, curated: true }), strong]));
    // Same strength, one curated: only the weak-derived penalty differs.
    expect(strongLinkH - weakH).toBeCloseTo(WEAK_LINK_PENALTY, 9);
    const same = prep.kindKey[objs[0]] === prep.kindKey[objs[1]] && prep.kindKey[objs[1]] === prep.kindKey[objs[2]];
    if (same) expect(sum(x([strong, strong], [true, true, true])) - sum(x([strong, strong]))).toBeCloseTo(0.4, 9);
  });
});

type Mk = { journey: never; ids: string[]; ident: string; patch: never; plan: never; h: number; s: never; tier: number; centroid?: { ra: number; dec: number } };
const mk = (key: string, score: number, ids: string[], templateId: string, regionName?: string, centroid?: { ra: number; dec: number }): Mk => ({
  journey: { key, score, templateId, regionName, title: `${templateId} ${regionName ?? key}` } as never, ids, ident: key, patch: { id: key } as never, plan: {} as never, h: score, s: {} as never, tier: 0, ...(centroid ? { centroid } : {}),
});
const keys = (xs: { journey: unknown }[]) => xs.map((b) => (b.journey as { key: string }).key);

describe('never two near-identical suggestions', () => {
  it('same archetype over the same region, or two shared stops, is near-identical', () => {
    const a = mk('a', 1, ['a1', 'a2', 'a3'], 'A6', 'Ursa Major', { ra: 180, dec: 55 });
    expect(nearIdentical(a as never, mk('b', 1, ['b1', 'b2', 'b3'], 'A6', 'Ursa Major', { ra: 220, dec: 30 }) as never)).toBe(true);
    expect(nearIdentical(a as never, mk('c', 1, ['c1', 'c2', 'c3'], 'A6', 'Draco', { ra: 190, dec: 60 }) as never)).toBe(true); // centroids 7° apart
    expect(nearIdentical(a as never, mk('d', 1, ['d1', 'd2', 'd3'], 'A6', 'Leo', { ra: 160, dec: 15 }) as never)).toBe(false);
    expect(nearIdentical(a as never, mk('e', 1, ['a1', 'a2', 'e3'], 'A9', 'Leo') as never)).toBe(true);
    expect(nearIdentical(a as never, mk('f', 1, ['a1', 'f2', 'f3'], 'A9', 'Ursa Major') as never)).toBe(false);
  });

  it('cal-02: two A6 tours of Ursa Major never appear together, even when the pool runs short', () => {
    const pool = [
      mk('d', 1, ['AlpCVn', 'G1830', 'LaSup', 'Alkaid', 'Mizar'], 'A6', 'Ursa Major', { ra: 190, dec: 45 }),
      mk('c', 0.9, ['Dubhe', 'Merak', 'Megrez', 'Alioth', 'Alkaid2'], 'A6', 'Ursa Major', { ra: 175, dec: 55 }),
      mk('b', 0.5, ['dBoo', 'nuBoo', '16Dra', 'Alkalurops', 'Alphecca'], 'A9', 'Boötes', { ra: 230, dec: 40 }),
    ];
    for (const limit of [2, 3]) {
      const picked = keys(selectWithShuffle(pool, limit, 0, 'seed'));
      expect(picked).toContain('d');
      expect(picked).not.toContain('c');
    }
    for (let k = 1; k <= 3; k++) {
      const page = selectWithShuffle(pool, 3, k, 'seed');
      for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) expect(nearIdentical(page[i] as never, page[j] as never)).toBe(false);
    }
  });
});

describe('suggestions come from the top of the score distribution', () => {
  it('each pick is one of the PICK_WINDOW best journeys still eligible for it, whatever the night rotation', () => {
    // 100 journeys; the best 12 are mostly one archetype but hold three stories.
    const pool = Array.from({ length: 100 }, (_, i) => mk(`k${String(i).padStart(3, '0')}`, 1 - i * 0.005, [`s${i}`, `t${i}`, `u${i}`], i < 12 ? (i === 4 ? 'B' : i === 9 ? 'C' : 'A') : `T${i}`, `R${i}`));
    const rank = (k: string) => Number(k.slice(1));
    for (let night = 0; night < 30; night++) {
      const picked = keys(selectWithShuffle(pool, 3, 0, 'seed', `night-${night}`));
      expect(picked).toHaveLength(3);
      // 1st: among the best 5; 2nd and 3rd: among the best 5 not of an archetype already picked.
      expect(rank(picked[0])).toBeLessThan(PICK_WINDOW);
      for (const k of picked) expect(rank(k)).toBeLessThan(12 + PICK_WINDOW);
    }
  });

  it('a pick goes deeper only to find a story not shown yet', () => {
    // The best 45 all tell story A except one B (#30) and one C (#44): the picks are the best A, B and C.
    const pool = Array.from({ length: 100 }, (_, i) => mk(`k${String(i).padStart(3, '0')}`, 1 - i * 0.005, [`s${i}`, `t${i}`], i === 30 ? 'B' : i === 44 ? 'C' : i < 45 ? 'A' : `T${i}`, `R${i}`, { ra: (i * 37) % 360, dec: 0 }));
    expect(keys(selectWithShuffle(pool, 3, 0, 'seed'))).toEqual(['k000', 'k030', 'k044']);
  });
});

describe('theme balance: at most one contrast tour, and first only by a margin (round 1, second pass)', () => {
  const sel = (pool: Mk[], cap = true, limit = 3) => keys(selectWithShuffle(pool as never[], limit, 0, 'seed', undefined, undefined, cap));
  it('an A6 tour within A6_MARGIN of another story waits for a later slot; a second A6 tour never shows', () => {
    // Normalised: A6a 1, A6b 0.98, B 0.95, C 0: A6a leads B by 0.05 < A6_MARGIN.
    const pool = [
      mk('a6a', 1, ['a1', 'a2', 'a3'], 'A6-contrasts', 'Ursa Major', { ra: 180, dec: 55 }),
      mk('a6b', 0.98, ['b1', 'b2', 'b3'], 'A6-contrasts', 'Orion', { ra: 85, dec: 0 }),
      mk('b', 0.95, ['c1', 'c2', 'c3'], 'A9-seeing-double', 'Lyra', { ra: 280, dec: 35 }),
      mk('c', 0, ['d1', 'd2', 'd3'], 'A10-stars-that-change', 'Cepheus', { ra: 330, dec: 60 }),
    ];
    expect(A6_MARGIN).toBeGreaterThan(0.05);
    expect(sel(pool)).toEqual(['b', 'a6a', 'c']);
    // Without the cap (a forced A6 theme): the old order, and the second tour as a last resort.
    expect(sel(pool, false)).toEqual(['a6a', 'b', 'c']);
    expect(sel(pool, false, 4)).toEqual(['a6a', 'b', 'c', 'a6b']);
    expect(sel(pool, true, 4)).toEqual(['b', 'a6a', 'c']);
  });

  it('a clearly better A6 tour still leads; a sky of contrast tours only gets one', () => {
    const lead = [
      mk('a6', 1, ['a1', 'a2', 'a3'], 'A6-contrasts', 'Ursa Major'),
      mk('b', 0.6, ['c1', 'c2', 'c3'], 'A9-seeing-double', 'Lyra'),
      mk('c', 0, ['d1', 'd2', 'd3'], 'A10-stars-that-change', 'Cepheus'),
    ];
    expect(sel(lead)).toEqual(['a6', 'b', 'c']);
    const only = [mk('x', 1, ['a1', 'a2'], 'A6-contrasts', 'Grus'), mk('y', 0.9, ['b1', 'b2'], 'A6-contrasts', 'Tucana', { ra: 0, dec: -60 })];
    expect(sel(only)).toEqual(['x']);
    // Shuffled pages keep the cap too.
    for (let k = 1; k <= 3; k++) {
      const page = selectWithShuffle([...lead, ...only] as never[], 3, k, 'seed', undefined, undefined, true);
      expect(page.filter((b) => tellsCapped(b as never)).length, `shuffle ${k}`).toBeLessThanOrEqual(1);
    }
  });

  it('a journey that switches into A6 counts as a contrast tour', () => {
    expect(tellsCapped({ journey: { templateId: 'A7-record-breakers', switch: { toTemplateId: 'A6-contrasts' } } } as never)).toBe(true);
    expect(tellsCapped({ journey: { templateId: 'A7-record-breakers' } } as never)).toBe(false);
  });
});

describe('Stars That Change: the hook and payoff swing visibly', () => {
  const tpl = compileTemplate(FIXTURE_KB.templates[0]);
  const a10 = { ...tpl, t: { ...tpl.t, themeTags: ['variable-stars'] } };
  const star = (vMax: number, vMin: number | null): KbObject => {
    const o = structuredClone(FIXTURE_KB.objects.find((x) => x.kind === 'star')!) as KbObject & { variability?: unknown };
    if (vMin === null) delete o.variability;
    else o.variability = { class: 'beta-cephei', gcvsType: 'BCEP', vMax, vMin, binocularVisibleAtMin: true, volatile: false, sourceId: 'x' };
    return o;
  };
  it(`needs ≥ ${VISIBLE_AMPLITUDE_MAG} mag at the hook and payoff when known; microvariables only as supporting stops`, () => {
    expect(VISIBLE_AMPLITUDE_MAG).toBe(0.3);
    for (const arc of ['hook', 'payoff'] as const) {
      expect(variableStopOk(a10, { arc }, star(2.41, 2.42)), arc).toBe(false);
      expect(variableStopOk(a10, { arc }, star(2.91, 3.21)), arc).toBe(true);
      expect(variableStopOk(a10, { arc }, star(2.12, 3.39)), arc).toBe(true);
      expect(variableStopOk(a10, { arc }, star(1, null)), `${arc}, amplitude unknown`).toBe(true);
    }
    for (const arc of ['build', 'twist'] as const) expect(variableStopOk(a10, { arc }, star(2.41, 2.42)), arc).toBe(true);
    // Other themes are not affected.
    expect(variableStopOk({ ...tpl, t: { ...tpl.t, themeTags: ['double-stars'] } }, { arc: 'hook' }, star(2.41, 2.42))).toBe(true);
  });
});

const dir = new URL('../../../../public/data/journeys/', import.meta.url);
const FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const req = (instant: string, lat: number, lon: number, extra: Partial<JourneyRequest> = {}): JourneyRequest => ({
  instant, lat, lon, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 19, length: 5, includeChallenge: true, limit: 3, ...extra,
});
const CONTEXTS: [string, JourneyRequest][] = [
  ['San Francisco, January', req('2027-01-08T04:15:00Z', 37.77, -122.42)],
  ['San Francisco, April', req('2027-04-14T05:46:00Z', 37.77, -122.42, { instrument: { fovDeg: 7.1, aperture: 50, magnification: 7 } })],
  ['San Francisco, July', req('2027-07-18T06:30:00Z', 37.77, -122.42)],
  ['Colorado dark site, July', req('2027-07-05T05:30:00Z', 38.8, -104.5, { skyBrightness: 21.5 })],
  ['London, October', req('2027-10-29T20:00:00Z', 51.5, -0.1)],
  ['Sydney, July', req('2027-07-05T09:30:00Z', -33.9, 151.2)],
  ['Santiago, April', req('2027-04-07T00:00:00Z', -33.4, -70.7)],
];

describe.skipIf(!present)('owner feedback round 1 on the real KB', () => {
  const kb: KnowledgeBase | null = present
    ? knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(new URL('lenses.json', dir)) ? read('lenses.json') : undefined })
    : null;

  it('cal-03 D is no longer a ladder: g Herculis → M13 is a 63× leap, M13 → ζ Herculis steps back', () => {
    const o = (id: string) => kb!.objects.find((x) => x.id === id)!;
    if (!o('HR6146') || !o('M13') || !o('HR6212')) return;
    expect(ladderStepOk(o('HR6146'), o('M13'))).toBe(false);
    expect(ladderStepOk(o('M13'), o('HR6212'))).toBe(false);
  });

  it('real templates: A3/A11 are ladders; A2/A9 are star-only themes; A6/A1 are not; A4/A10 are retired', () => {
    const prep = prepareKb(kb!);
    const t = (a: string) => prep.templates.find((c) => c.t.archetype === a)!;
    for (const a of ['A3', 'A11']) expect(t(a).ladder, a).toBe(true);
    for (const a of ['A2', 'A9']) expect(t(a).oneKindTheme, a).toBe(true);
    for (const a of ['A1', 'A6']) expect(t(a).oneKindTheme, a).toBe(false);
    // Owner feedback r2: A4 (time machine) and A10 (stars that change) are no longer journeys.
    for (const a of ['A4', 'A10']) expect(t(a), a).toBeUndefined();
  });

  it.each(CONTEXTS)('%s: forced ladders climb; suggestions are distinct, near the top, with unique titles', (_label, r) => {
    // A lens ladder (owner feedback r2) climbs by LENS_LADDER_MIN_RATIO; its beats set the method at each rung.
    const minRatio = kb!.lenses?.some((l) => l.archetype === 'A3') ? LENS_LADDER_MIN_RATIO : LADDER_MIN_RATIO;
    for (const theme of ['A3-how-far']) {
      const res = generate(kb!, { ...r, theme });
      for (const j of res.journeys) {
        expect(independentProblems(kb!, { ...r, theme }, res, j)).toEqual([]);
        const objs = j.stops.map((s) => kb!.objects.find((o) => o.id === s.objectId)!);
        for (let i = 1; i < objs.length; i++) {
          if (i === 1 && objs[0].kind === 'dso' && (objs[0].dsoClass === 'star-cloud' || objs[0].dsoClass === 'milky-way-field')) continue;
          expect(objs[i].facts.distanceLy!.value / objs[i - 1].facts.distanceLy!.value).toBeGreaterThanOrEqual(minRatio);
        }
      }
    }
    let ranked: readonly string[] = [];
    let a6: readonly boolean[] = [];
    const res = generate(kb!, r, { inspectPool: (p) => { ranked = p.map((j) => j.key); a6 = p.map((j) => j.templateId.startsWith('A6-')); } });
    // With theme lenses (owner feedback r2) a theme uses only the objects its lens covers, so on the sparsest
    // nights (San Francisco in April: only doubles and contrasts can run at all) one suggestion fewer may survive
    // the distinctness rules; print-journeys.cts --availability tracks this as the lens content grows.
    expect(res.journeys.length).toBeGreaterThanOrEqual(kb!.lenses?.length ? 2 : 3);
    expect(resultProblems(res)).toEqual([]);
    for (const j of res.journeys) expect(independentProblems(kb!, r, res, j)).toEqual([]);
    // The first suggestion is one of the PICK_WINDOW best of the pool; before round 1 the three reached ranks
    // #35..#174. The others sit deeper only as far as a different story requires.
    const depth = res.journeys.map((j) => ranked.indexOf(j.key));
    console.log(`[owner-r1] ${_label}: pool ${ranked.length}, pick ranks ${depth.join(', ')}`);
    expect(depth[0]).toBeGreaterThanOrEqual(0);
    // Theme balance: the first pick may sit deeper only behind contrast tours it is within A6_MARGIN of.
    const above = depth[0] - a6.slice(0, depth[0]).filter(Boolean).length;
    expect(above).toBeLessThan(PICK_WINDOW);
    expect(res.journeys.filter((j) => j.templateId.startsWith('A6-')).length).toBeLessThanOrEqual(1);
  }, 60_000);
});
