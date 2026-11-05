import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIXTURE_KB, MOCK_EMPTY_RESULT, MOCK_JOURNEY_RESULT, createMockJourneyEngineClient,
} from '../__fixtures__/fixture-kb';
import {
  JourneyRequestSchema, JourneyResultSchema, KnowledgeBaseError, ScorerModelSchema,
  knowledgeBaseFromFiles, parseKnowledgeBase, validateKnowledgeBaseRefs,
} from '../kb-schema';
import { EDGE_TYPES, FEATURE_NAMES, type KnowledgeBase } from '../types';

const clone = (): KnowledgeBase => structuredClone(FIXTURE_KB);

describe('fixture knowledge base', () => {
  it('passes the zod schema and every referential check', () => {
    const kb = parseKnowledgeBase(FIXTURE_KB);
    expect(kb.objects).toHaveLength(15);
    expect(validateKnowledgeBaseRefs(kb)).toEqual([]);
  });

  it('round-trips through the runtime file layout', () => {
    const kb = knowledgeBaseFromFiles({
      kb: { version: FIXTURE_KB.version, objects: FIXTURE_KB.objects, contexts: FIXTURE_KB.contexts, sources: FIXTURE_KB.sources },
      concepts: { version: 'c', concepts: FIXTURE_KB.concepts },
      edges: { version: 'e', edges: FIXTURE_KB.edges },
      templates: { version: 't', templates: FIXTURE_KB.templates },
      narration: FIXTURE_KB.narration,
    });
    expect(kb).toEqual(FIXTURE_KB);
  });

  it('has a sourced fact behind every card number and covers both kinds', () => {
    for (const o of FIXTURE_KB.objects) {
      expect(Object.keys(o.facts).length, o.id).toBeGreaterThan(0);
      for (const n of o.card.numbers) expect(o.facts[n.factRef]?.sourceId, `${o.id}.${n.factRef}`).toBeTruthy();
    }
    expect(new Set(FIXTURE_KB.objects.map((o) => o.kind))).toEqual(new Set(['star', 'dso']));
  });

  it('uses ids that exist in the v1 master object list (spec decision 9)', () => {
    const list = JSON.parse(readFileSync(resolve(__dirname, '../../../../../script/journeys/object-list.json'), 'utf8')) as { objects: { id: string; hr?: number }[] };
    const byId = new Map(list.objects.map((o) => [o.id, o]));
    for (const o of FIXTURE_KB.objects) {
      expect(byId.has(o.id), o.id).toBe(true);
      if (o.hr) expect(byId.get(o.id)?.hr, o.id).toBe(o.hr);
    }
  });

  it('keeps edge types to the 10 spec types and LINE_OF_SIGHT edges to real distance contrasts', () => {
    const byId = new Map(FIXTURE_KB.objects.map((o) => [o.id, o]));
    for (const e of FIXTURE_KB.edges) {
      expect(EDGE_TYPES).toContain(e.type);
      if (e.type === 'LINE_OF_SIGHT') {
        const a = byId.get(e.from)!.facts.distanceLy!.value;
        const b = byId.get(e.to)!.facts.distanceLy!.value;
        expect(Math.max(a, b) / Math.min(a, b)).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('validation catches broken KBs', () => {
  it('rejects an unknown sourceId', () => {
    const kb = clone();
    kb.objects[0].facts.distanceLy!.sourceId = 'nope';
    expect(() => parseKnowledgeBase(kb)).toThrow(KnowledgeBaseError);
  });

  it('rejects a fact outside its range and a typo in card prose keys', () => {
    const kb = clone();
    kb.objects[0].facts.teffK!.min = 5000;
    expect(() => parseKnowledgeBase(kb)).toThrow(/min ≤ value ≤ max/);
    const kb2 = clone() as unknown as { objects: { card: Record<string, unknown> }[] };
    kb2.objects[0].card.understnad = 'typo';
    expect(() => parseKnowledgeBase(kb2)).toThrow(KnowledgeBaseError);
  });

  it('rejects dangling edge endpoints, missing narration keys and unknown concepts', () => {
    const kb = clone();
    kb.edges.push({ ...kb.edges[0], to: 'M999', reasonKey: 'edge.missing' });
    kb.objects[0].teaches.push({ conceptId: 'NOPE.concept', strength: 1 });
    const issues = validateKnowledgeBaseRefs(kb);
    expect(issues.some((i) => i.includes('unknown to'))).toBe(true);
    expect(issues.some((i) => i.includes('edge.missing'))).toBe(true);
    expect(issues.some((i) => i.includes('NOPE.concept'))).toBe(true);
  });

  it('rejects a card number that points at a missing fact', () => {
    const kb = clone();
    kb.objects[1].card.numbers.push({ label: 'Mass', factRef: 'massMsun' });
    expect(validateKnowledgeBaseRefs(kb).some((i) => i.includes('missing fact "massMsun"'))).toBe(true);
  });
});

describe('engine I/O contracts', () => {
  it('mock results satisfy the JourneyResult schema and reference fixture objects and edges', async () => {
    expect(JourneyResultSchema.parse(MOCK_JOURNEY_RESULT)).toBeTruthy();
    expect(JourneyResultSchema.parse(MOCK_EMPTY_RESULT)).toBeTruthy();
    const ids = new Set(FIXTURE_KB.objects.map((o) => o.id));
    const j = MOCK_JOURNEY_RESULT.journeys[0];
    expect(FIXTURE_KB.templates.map((t) => t.id)).toContain(j.templateId);
    j.stops.forEach((s, i) => {
      expect(ids.has(s.objectId), s.objectId).toBe(true);
      expect(s.index).toBe(i);
      if (i > 0) expect(s.link?.from).toBe(j.stops[i - 1].objectId);
    });
    const client = createMockJourneyEngineClient();
    const req = JourneyRequestSchema.parse({
      instant: '2027-01-15T04:30:00Z', lat: 37.77, lon: -122.42, skyBrightness: 20.5,
      instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 },
    });
    const res = await client.generate(req);
    expect(res).toEqual(MOCK_JOURNEY_RESULT);
    expect(res).not.toBe(MOCK_JOURNEY_RESULT);
    expect((await createMockJourneyEngineClient({ empty: true }).generate(req)).journeys).toHaveLength(0);
  });

  it('freezes 36 unique feature names and validates scorer model JSON forms', () => {
    expect(FEATURE_NAMES).toHaveLength(36);
    expect(new Set(FEATURE_NAMES).size).toBe(36);
    const features = [...FEATURE_NAMES];
    expect(ScorerModelSchema.parse({ type: 'heuristic', modelVersion: 'h', features }).type).toBe('heuristic');
    expect(ScorerModelSchema.parse({ type: 'linear', modelVersion: 'l', features, mean: [0], std: [1], w: [1], b: 0 }).type).toBe('linear');
    expect(ScorerModelSchema.parse({
      type: 'gbdt', modelVersion: 'g', features, base: 0,
      trees: [{ f: [11], t: [0.6], l: [-1], r: [-2], v: [-0.1, 0.2] }],
    }).type).toBe('gbdt');
  });
});
