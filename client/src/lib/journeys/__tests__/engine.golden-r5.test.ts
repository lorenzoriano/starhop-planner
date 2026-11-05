/**
 * Golden engine outputs (r5, WS-E): the shared sky model (lib/sky-feasibility.ts) and the new optional request
 * fields (boostIds, mustInclude, observedIds) must leave every journey exactly as it was when they are absent.
 * The fixture was captured from the engine BEFORE the refactor; regenerate it only for an intended engine change:
 *   UPDATE_GOLDEN=1 npx vitest run client/src/lib/journeys/__tests__/engine.golden-r5.test.ts
 * Real-KB cases are skipped when the KB files are missing or carry another version than the fixture (the KB is
 * rebuilt independently of the engine).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate, rebuildJourney } from '../assemble';
import { knowledgeBaseFromFiles } from '../kb-schema';
import type { GbdtModel, JourneyRequest, JourneyResult, KnowledgeBase } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { request } from './engine-helpers';

const GOLDEN = new URL('../__fixtures__/engine-golden-r5.json', import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const gbdt = JSON.parse(readFileSync(new URL('../__fixtures__/scorer-toy-gbdt.json', import.meta.url), 'utf8')) as GbdtModel;

const dir = new URL('../../../../public/data/journeys/', import.meta.url);
const FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const realKb: KnowledgeBase | null = present
  ? knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(new URL('lenses.json', dir)) ? read('lenses.json') : undefined })
  : null;

/** Everything a user (or the next stage) can observe of a result, without timings. */
function digest(r: JourneyResult) {
  return {
    journeys: r.journeys.map((j) => ({
      key: j.key, templateId: j.templateId, score: j.score, title: j.title,
      stops: j.stops.map((s) => [s.objectId, s.arc, Math.round(s.altAtStart * 1000) / 1000]),
      bestWindow: j.bestWindow ?? null, closestMoonDeg: j.conditions?.closestMoonDeg ?? null,
    })),
    diagnostics: { message: r.diagnostics.message, limitingFactors: r.diagnostics.limitingFactors, relaxed: r.diagnostics.relaxed ?? [], candidates: r.diagnostics.candidates, validated: r.diagnostics.validated },
    conditions: r.conditions,
  };
}

const realReq = (instant: string, lat: number, lon: number, sky = 19, extra: Partial<JourneyRequest> = {}): JourneyRequest => ({
  instant, lat, lon, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: sky, length: 5, includeChallenge: true, limit: 3, ...extra,
});

const FIXTURE_CASES: [string, JourneyRequest, { model?: GbdtModel }?][] = [
  ['dark', request('2027-01-09T05:00:00Z')],
  ['dark gbdt', request('2027-01-09T05:00:00Z'), { model: gbdt }],
  ['moonlit', request('2027-01-22T07:00:00Z')],
  ['twilight', request('2027-01-09T01:50:00Z')],
  ['shuffle + seen', request('2027-01-09T05:00:00Z', { shuffle: 2, seenObjectIds: ['M45', 'M42'] })],
];
const REAL_CASES: [string, JourneyRequest][] = [
  ['SF January dark', realReq('2027-01-08T04:15:00Z', 37.77, -122.42)],
  ['SF full Moon', realReq('2027-01-22T07:00:00Z', 37.77, -122.42)],
  ['Colorado July', realReq('2027-07-05T05:30:00Z', 38.8, -104.5, 21.5)],
  ['Sydney July', realReq('2027-07-05T09:30:00Z', -33.9, 151.2)],
  ['SF 2026-11-04 tonight', realReq('2026-11-04T04:30:00Z', 37.77, -122.42, 20.5, { timezone: 'America/Los_Angeles', seenObjectIds: ['M31'] })],
];

type Golden = { kbVersion: string | null; fixture: Record<string, unknown>; real: Record<string, unknown>; rebuild: Record<string, unknown> };
const stored: Golden | null = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : null;
const fresh: Golden = { kbVersion: realKb?.version ?? null, fixture: {}, real: {}, rebuild: {} };
const realOk = !!realKb && (UPDATE || stored?.kbVersion === realKb.version);

describe('engine golden values (r5)', () => {
  it.each(FIXTURE_CASES)('fixture KB: %s', (label, req, opts) => {
    const d = digest(generate(FIXTURE_KB, req, opts ?? {}));
    fresh.fixture[label] = d;
    if (!UPDATE) expect(JSON.parse(JSON.stringify(d))).toEqual(stored!.fixture[label]);
  });

  it.skipIf(!realOk).each(REAL_CASES)('real KB: %s', (label, req) => {
    const r = generate(realKb!, req);
    const d = digest(r);
    fresh.real[label] = d;
    if (!UPDATE) expect(JSON.parse(JSON.stringify(d))).toEqual(stored!.real[label]);
    if (r.journeys[0]) {
      const rb = rebuildJourney(realKb!, r.journeys[0].key, req);
      const rd = { valid: rb.valid, stops: rb.journey?.stops.map((s) => s.objectId) ?? null, problems: rb.problems, codes: rb.codes };
      fresh.rebuild[label] = rd;
      if (!UPDATE) expect(JSON.parse(JSON.stringify(rd))).toEqual(stored!.rebuild[label]);
    }
  });

  it('writes the fixture when UPDATE_GOLDEN=1', () => {
    if (UPDATE) writeFileSync(GOLDEN, JSON.stringify(fresh, null, 1) + '\n');
    expect(UPDATE || stored !== null).toBe(true);
  });
});
