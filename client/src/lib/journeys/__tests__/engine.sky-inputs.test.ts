/**
 * r5 engine inputs linking journeys to the rest of the app: observedIds (Planner observedAt ∪ seen), boostIds
 * (Tonight's Best top objects) and mustInclude (a journey from my night). Absent or empty they are exact no-ops;
 * they are part of the worker's result-cache key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOST_SCORE, MUST_INCLUDE_RANK, generate, generatePool } from '../assemble';
import { normalizeRequest } from '../conditions';
import { journeyRequestCacheKey } from '../journey-host';
import { knowledgeBaseFromFiles } from '../kb-schema';
import { kbIdsOf, plannerObservedIds, withSkyInputs } from '../request-inputs';
import { BOOST_STOP_BONUS, MUST_STOP_BONUS } from '../search';
import type { JourneyRequest, JourneyResult, KnowledgeBase } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { request } from './engine-helpers';

const DARK = '2027-01-09T05:00:00Z';
const strip = (r: JourneyResult) => JSON.parse(JSON.stringify({ ...r, diagnostics: { ...r.diagnostics, ms: undefined } }));

describe('no-op defaults', () => {
  const base = request(DARK);
  it('empty id sets give exactly the result of absent ones', () => {
    const plain = strip(generate(FIXTURE_KB, base));
    expect(strip(generate(FIXTURE_KB, { ...base, boostIds: [], mustInclude: [], observedIds: [] }))).toEqual(plain);
  });
  it('withSkyInputs without ids leaves the request byte-identical', () => {
    expect(JSON.stringify(withSkyInputs(base, {}))).toBe(JSON.stringify(base));
    expect(JSON.stringify(withSkyInputs(base, { observedIds: [], boostIds: ['moon:copernicus'], mustInclude: [''] }))).toBe(JSON.stringify(base));
  });
  it('bonuses are small next to the story terms and below one relaxation tier', () => {
    expect(BOOST_STOP_BONUS).toBeLessThan(0.5); // less than the "already seen" penalty
    expect(BOOST_SCORE).toBeLessThanOrEqual(0.5);
    expect(MUST_STOP_BONUS).toBeGreaterThan(BOOST_STOP_BONUS);
    expect(MUST_INCLUDE_RANK).toBeLessThan(1);
  });
});

describe('worker result-cache key', () => {
  const base = request(DARK);
  it('includes every new field', () => {
    const k0 = journeyRequestCacheKey(base);
    expect(journeyRequestCacheKey({ ...base, boostIds: ['M45'] })).not.toBe(k0);
    expect(journeyRequestCacheKey({ ...base, mustInclude: ['M45'] })).not.toBe(k0);
    expect(journeyRequestCacheKey({ ...base, observedIds: ['M45'] })).not.toBe(k0);
    expect(journeyRequestCacheKey({ ...base, boostIds: ['M45'] })).not.toBe(journeyRequestCacheKey({ ...base, mustInclude: ['M45'] }));
  });
  it('treats empty sets as absent and ignores order and duplicates', () => {
    expect(journeyRequestCacheKey({ ...base, boostIds: [], mustInclude: [], observedIds: [], seenObjectIds: [] })).toBe(journeyRequestCacheKey(base));
    expect(journeyRequestCacheKey({ ...base, boostIds: ['M45', 'M42', 'M45'] })).toBe(journeyRequestCacheKey({ ...base, boostIds: ['M42', 'M45'] }));
  });
});

describe('observedIds join "seen"', () => {
  it('normalises Planner ids and unions them with seenObjectIds', () => {
    const s = normalizeRequest({ ...request(DARK), seenObjectIds: ['M45'], observedIds: ['star:HR1387', 'M45', 'STAR-Algol'] });
    expect(Array.from(s.seen).sort()).toEqual(['HR1387', 'M45', 'STAR-Algol']);
  });
  it('observed in the Planner = seen in journeys (same journeys, same scores)', () => {
    const viaSeen = strip(generate(FIXTURE_KB, request(DARK, { seenObjectIds: ['M45', 'M42'] })));
    const viaPlanner = strip(generate(FIXTURE_KB, request(DARK, { observedIds: ['M42', 'M45'] })));
    expect(viaPlanner.journeys).toEqual(viaSeen.journeys);
  });
  it('plannerObservedIds takes observed items of every night, as KB ids', () => {
    const sessions = [
      { items: [{ id: 'M45', observedAt: '2026-11-04T05:00:00Z' }, { id: 'M42' }, { id: 'star:HR936', observedAt: '2026-11-04T05:10:00Z' }] },
      { items: [{ id: 'moon:copernicus', observedAt: '2026-11-04T05:20:00Z' }, { id: 'M45', observedAt: '2026-10-01T05:00:00Z' }] },
    ];
    expect(plannerObservedIds(sessions)).toEqual(['M45', 'STAR-Algol']);
    expect(kbIdsOf(['HR2061', 'STAR-Betelgeuse', 'star:HR2061'])).toEqual(['STAR-Betelgeuse']);
  });
});

const dir = new URL('../../../../public/data/journeys/', import.meta.url);
const FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

describe.skipIf(!present)('boost and must-include on the real KB', () => {
  const kb: KnowledgeBase | null = present
    ? knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(new URL('lenses.json', dir)) ? read('lenses.json') : undefined })
    : null;
  // San Francisco, Tue 3 Nov 2026 20:30 PST (the r5 review night).
  const req: JourneyRequest = {
    instant: '2026-11-04T04:30:00Z', lat: 37.77, lon: -122.42, timezone: 'America/Los_Angeles',
    instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 20.5, length: 5, includeChallenge: true, limit: 3,
  };

  it('a boosted stop raises the heuristic score of a journey by BOOST_STOP_BONUS per boosted stop', () => {
    const pool = generatePool(kb!, req).journeys;
    const target = pool[0].stops[1].objectId;
    const boosted = new Map(generatePool(kb!, { ...req, boostIds: [target] }).journeys.map((j) => [j.key, j]));
    let compared = 0;
    for (const j of pool) {
      const b = boosted.get(j.key);
      if (!b) continue;
      const n = j.stops.filter((s) => s.objectId === target).length;
      expect(b.score - j.score).toBeCloseTo(n * BOOST_STOP_BONUS, 5);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('mustInclude puts a feasible object into the first journey', () => {
    const plain = generate(kb!, req);
    const shown = new Set(plain.journeys.flatMap((j) => j.stops.map((s) => s.objectId)));
    const candidate = generatePool(kb!, req).journeys.flatMap((j) => j.stops.map((s) => s.objectId)).find((id) => !shown.has(id));
    expect(candidate).toBeTruthy();
    const withMust = generate(kb!, { ...req, mustInclude: [candidate!] });
    expect(withMust.journeys[0].stops.map((s) => s.objectId)).toContain(candidate);
  });

  it('an object that is not up tonight changes nothing', () => {
    // Omega Centauri (Dec −47°) never rises usefully from San Francisco on a November evening.
    const plain = strip(generate(kb!, req));
    expect(strip(generate(kb!, { ...req, mustInclude: ['NGC5139'] })).journeys).toEqual(plain.journeys);
  });
});
