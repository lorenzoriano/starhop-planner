/**
 * Story-grammar data (client/public/data/journeys/src/{concepts,templates,narration}.json):
 * zod shape, referential integrity, and the authoring rules from docs 04/05/06.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import {
  ConceptsJsonFileSchema, NarrationBankSchema, TemplatesJsonFileSchema, knowledgeBaseFromFiles, validateKnowledgeBaseRefs,
} from '../kb-schema';
import { EDGE_TYPES, type Concept, type KnowledgeBase, type NarrationBank, type Template } from '../types';

const SRC = resolve(__dirname, '../../../../public/data/journeys/src');
const ROOT = resolve(__dirname, '../../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const concepts: Concept[] = ConceptsJsonFileSchema.parse(readJson(resolve(SRC, 'concepts.json'))).concepts as Concept[];
const templates: Template[] = TemplatesJsonFileSchema.parse(readJson(resolve(SRC, 'templates.json'))).templates as Template[];
const narration: NarrationBank = NarrationBankSchema.parse(readJson(resolve(SRC, 'narration.json'))) as NarrationBank;
const objectListIds = new Set(
  (readJson(resolve(ROOT, 'script/journeys/object-list.json')) as { objects: { id: string }[] }).objects.map((o) => o.id),
);
const conceptIds = new Set(concepts.map((c) => c.id));
const keys = new Set(Object.keys(narration.variants));

/** doc 04 §2.2 (28 coarse concepts). */
const DOC04 = [
  'PERC.night-eyes', 'PERC.binoculars', 'SKY.projection', 'LIGHT.brightness', 'DIST.light-year', 'LIGHT.color-temp',
  'DIST.lum-vs-app', 'TIME.lookback', 'STAR.fusion', 'STAR.size', 'STAR.mass-fate', 'LIFE.nursery', 'LIFE.cluster-birth',
  'LIFE.cluster-age', 'MW.families', 'LIFE.giant', 'LIFE.pn-wd', 'LIFE.supernova', 'LIFE.recycling', 'MULT.doubles',
  'MULT.weighing', 'VAR.pulsating', 'VAR.eclipsing', 'DIST.standard-candle', 'MW.disk', 'MW.halo', 'GAL.other', 'SCALE.cosmic',
];
/** doc 02 §2.4 fine concepts → parent. */
const DOC02: Record<string, string> = {
  'STAR.spectral-sequence': 'LIGHT.color-temp', 'STAR.luminosity-class': 'STAR.size', 'STAR.mass-luminosity': 'STAR.mass-fate',
  'STAR.rotation': 'STAR.fusion', 'STAR.be-disk': 'STAR.rotation', 'STAR.red-clump': 'LIFE.giant',
  'STAR.agb-massloss': 'LIFE.giant', 'STAR.carbon-dredge-up': 'LIFE.recycling', 'STAR.s-process': 'LIFE.recycling',
  'STAR.supergiant-fate': 'LIFE.supernova', 'STAR.white-dwarf': 'LIFE.pn-wd', 'STAR.black-hole-binary': 'LIFE.supernova',
  'STAR.mass-transfer': 'VAR.eclipsing', 'VAR.mira': 'VAR.pulsating', 'VAR.cepheid': 'DIST.standard-candle',
  'VAR.rr-lyrae': 'DIST.standard-candle', 'VAR.dust-fading': 'VAR.pulsating', 'VAR.nova': 'MULT.doubles',
  'KIN.moving-group': 'MW.families', 'KIN.runaway': 'MW.families', 'KIN.halo-star': 'MW.halo',
  'KIN.proper-motion': 'DIST.light-year', 'NEAR.neighborhood': 'DIST.light-year', 'PLAN.host': 'LIFE.recycling',
  'PLAN.debris-disk': 'PLAN.host', 'PLAN.solar-twin': 'STAR.fusion', 'PERC.purkinje': 'PERC.night-eyes',
  'OBS.extinction': 'MW.disk',
};

const PLACEHOLDER = /\{([^{}]*)\}/g;
const placeholdersOf = (s: string) => Array.from(s.matchAll(PLACEHOLDER), (m) => m[1]);

describe('concepts.json', () => {
  it('contains every doc 04 coarse concept and every doc 02 fine concept with its parent', () => {
    for (const id of DOC04) expect(conceptIds, id).toContain(id);
    for (const [id, parent] of Object.entries(DOC02)) {
      expect(concepts.find((c) => c.id === id)?.parent, id).toBe(parent);
    }
  });

  it('has unique ids, resolvable prereqs/parents, and an acyclic prerequisite graph', () => {
    expect(conceptIds.size).toBe(concepts.length);
    for (const c of concepts) {
      for (const p of c.prereqs) expect(conceptIds, `${c.id} prereq ${p}`).toContain(p);
      if (c.parent) expect(conceptIds, `${c.id} parent`).toContain(c.parent);
    }
    const byId = new Map(concepts.map((c) => [c.id, c] as const));
    const state = new Map<string, 1 | 2>();
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new Error(`prereq cycle: ${[...path, id].join(' → ')}`);
      state.set(id, 1);
      for (const p of byId.get(id)?.prereqs ?? []) visit(p, [...path, id]);
      state.set(id, 2);
    };
    for (const c of concepts) visit(c.id, []);
  });

  it('gives every concept a one-sentence big idea and bridge, ≤2 terms, and real evidence objects', () => {
    for (const c of concepts) {
      expect(c.bridge, c.id).toBeTruthy();
      for (const s of [c.bigIdea, c.bridge!]) {
        expect(s.length, `${c.id}: ${s}`).toBeLessThanOrEqual(170);
        expect(s.trim().endsWith('.'), `${c.id} ends with a period`).toBe(true);
      }
      expect(c.terms.length, c.id).toBeLessThanOrEqual(3);
      for (const e of c.evidenceIds ?? []) expect(objectListIds, `${c.id} evidence ${e}`).toContain(e);
    }
  });

  it('covers every concept id the fixture KB teaches', () => {
    for (const o of FIXTURE_KB.objects) for (const t of o.teaches) expect(conceptIds, `${o.id}`).toContain(t.conceptId);
  });
});

describe('templates.json', () => {
  it('has the 12 doc 04 archetypes with stable ids', () => {
    expect(templates.map((t) => t.archetype)).toEqual(Array.from({ length: 12 }, (_, i) => `A${i + 1}`));
    expect(new Set(templates.map((t) => t.id)).size).toBe(12);
    // fixture/mock journeys reference these ids
    for (const t of FIXTURE_KB.templates) expect(templates.map((x) => x.id)).toContain(t.id);
  });

  it('follows the arc grammar: hook first, exactly one required payoff, at most one coda last', () => {
    for (const t of templates) {
      expect(t.slots[0].arc, t.id).toBe('hook');
      expect(t.slots[0].optional ?? false, t.id).toBe(false);
      const payoffs = t.slots.filter((s) => s.arc === 'payoff');
      expect(payoffs.length, t.id).toBe(1);
      expect(payoffs[0].optional ?? false, t.id).toBe(false);
      const codaIdx = t.slots.findIndex((s) => s.arc === 'coda');
      if (codaIdx >= 0) expect(codaIdx, t.id).toBe(t.slots.length - 1);
      for (const s of t.slots) expect(s.label.split(/\s+/).length, `${t.id} ${s.label}`).toBeLessThanOrEqual(3);
    }
  });

  it('can fill its declared length range from its slots', () => {
    for (const t of templates) {
      const min = t.slots.reduce((n, s) => n + (s.optional ? 0 : (s.repeat?.[0] ?? 1)), 0);
      const max = t.slots.reduce((n, s) => n + (s.repeat?.[1] ?? 1), 0);
      expect(min, `${t.id} required slots`).toBeLessThanOrEqual(t.length[0]);
      expect(max, `${t.id} max fill`).toBeGreaterThanOrEqual(t.length[1]);
      expect(t.defaultLength).toBeGreaterThanOrEqual(t.length[0]);
      expect(t.defaultLength).toBeLessThanOrEqual(t.length[1]);
    }
  });

  it('keeps the cognitive-load and story rules (≤4 core concepts, one switch rule, hook lines ≤90 chars)', () => {
    for (const t of templates) {
      expect(t.coreConcepts.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.coreConcepts.length, t.id).toBeLessThanOrEqual(4);
      // At most one switch rule; retired targets (A4, A10) left A3, A9 and A11 without one (owner feedback r2).
      if (t.switchRule) expect(t.chainTo ?? [], t.id).toEqual(expect.arrayContaining(t.switchRule.to));
      expect(t.edges, `${t.id}: NEIGHBOR never justifies a step`).not.toContain('NEIGHBOR');
      expect(t.moonSuitability, t.id).toBeDefined();
      expect(t.moonFriendly, t.id).toBe(t.moonSuitability === 'bright-ok');
      for (const k of [...(t.hookKeys ?? [])]) for (const v of narration.variants[k] ?? []) expect(v.length, v).toBeLessThanOrEqual(90);
      for (const k of [...t.titleKeys, ...(t.questionKeys ?? []), ...(t.hookKeys ?? []), ...(t.payoffKeys ?? [])]) {
        expect(narration.variants[k]?.length ?? 0, k).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('narration.json', () => {
  const declared = new Set(Object.keys(narration.placeholders ?? {}));

  it('only uses declared placeholders and keeps lines short', () => {
    for (const [k, vs] of Object.entries(narration.variants)) {
      expect(new Set(vs).size, `${k} has duplicate variants`).toBe(vs.length);
      for (const v of vs) {
        for (const p of placeholdersOf(v)) expect(declared, `${k}: {${p}}`).toContain(p);
        expect(v.replace(PLACEHOLDER, ''), `${k}: stray brace`).not.toMatch(/[{}]/);
        expect(v.length, `${k}: ${v}`).toBeLessThanOrEqual(230);
        expect(v, k).not.toMatch(/\b(simply|obviously)\b/i);
      }
    }
  });

  it('has a generic transition bank for every edge type (≥4 variants for story types)', () => {
    for (const t of EDGE_TYPES) {
      expect(keys, t).toContain(t);
      if (t !== 'NEIGHBOR') expect(narration.variants[t].length, t).toBeGreaterThanOrEqual(4);
    }
    for (const k of ['skip', 'skip.bridge', 'bridge.prereq', 'coda.callback', 'direction.same-field', 'direction.sweep',
      'direction.sweep.one', 'direction.naked-eye-hop', 'direction.after-skip']) {
      expect(keys, k).toContain(k);
    }
  });

  it('defines contiguous value bands whose keys all exist, plus a base fallback key', () => {
    for (const [base, bands] of Object.entries(narration.bands ?? {})) {
      expect(keys, `${base} fallback`).toContain(base);
      expect(bands[0].min, `${base} first band open below`).toBeUndefined();
      expect(bands[bands.length - 1].max, `${base} last band open above`).toBeUndefined();
      bands.forEach((b, i) => {
        expect(keys, `${base}.${b.suffix}`).toContain(`${base}.${b.suffix}`);
        if (i > 0) expect(b.min, `${base}.${b.suffix} contiguous`).toBe(bands[i - 1].max);
      });
    }
  });

  it('covers every comparisonKey used by fixture cards', () => {
    for (const o of FIXTURE_KB.objects) {
      for (const n of o.card.numbers) if (n.comparisonKey) expect(keys, n.comparisonKey).toContain(`compare.${n.comparisonKey}`);
    }
  });

  it('is written in the house voice (docs/sky-journeys/voice.md)', () => {
    const banned = /raises the question|we['’]ll answer|one thing first|before we go on|quick background|short reminder before|next piece of the story|high point of the journey|one more example|same species|\blet['’]s\b|here the story turns|next idea you need|answers tonight|match it in one way|break with it in another|won['’]t believe|minutes you visit|next question:|change of theme|!/i;
    for (const [k, vs] of Object.entries(narration.variants)) for (const v of vs) expect(v, k).not.toMatch(banned);
    // First stop: every template has its own opener that ties the stop to the thread, and no why-here line repeats
    // the driving question (the UI already shows it). The payoff stop has its own thread line, never the answer.
    for (const t of templates) {
      expect(keys, `why.hook.${t.id}`).toContain(`why.hook.${t.id}`);
      expect(narration.variants[`why.payoff.${t.id}`]?.length ?? 0, `why.payoff.${t.id}`).toBeGreaterThanOrEqual(2);
    }
    for (const k of Array.from(keys).filter((x) => x.startsWith('why.'))) {
      for (const v of narration.variants[k]) expect(v, `${k}: ${v}`).not.toContain('{question}');
    }
    // Story overviews: 2–3 flowing sentences of prose (no stop count, minutes or numbers), with at least one variant
    // that needs neither {name} (left empty after a switch) nor {region}.
    for (const t of templates) {
      const vs = narration.variants[`story.${t.id}`] ?? [];
      expect(vs.length, `story.${t.id}`).toBeGreaterThanOrEqual(3);
      expect(vs.some((v) => !/\{(name|region)\}/.test(v)), `story.${t.id} name-free variant`).toBe(true);
      for (const v of vs) {
        const n = v.split(/(?<=[.!?])\s+/).length;
        expect(n, v).toBeGreaterThanOrEqual(2);
        expect(n, v).toBeLessThanOrEqual(3);
        expect(v, v).not.toMatch(/\d|\{(count|minutes)\}/);
      }
    }
    // Titles read like chapter titles, not one headline formula: at most a quarter of them per pattern, few colons.
    const pattern = (x: string) => (x.includes('?') ? 'question' : x.includes(':') ? 'colon' : /^\{region\}['’]s/.test(x) ? 'possessive'
      : x.startsWith('{region}') ? 'region-first' : x.endsWith('{region}') ? 'region-last' : 'region-middle');
    const titles = templates.flatMap((t) => t.titleKeys.flatMap((k) => narration.variants[k] ?? []));
    const counts = new Map<string, number>();
    for (const x of titles) {
      expect(x, x).toContain('{region}');
      counts.set(pattern(x), (counts.get(pattern(x)) ?? 0) + 1);
    }
    for (const [p, c] of Array.from(counts)) expect(c / titles.length, `${p}: ${c}/${titles.length}`).toBeLessThanOrEqual(0.25);
    expect(counts.get('colon') ?? 0).toBeLessThanOrEqual(titles.length / 10);
    // A switch states the new question; get-there moves use the selected binoculars' field ({span}).
    for (const t of templates) for (const v of narration.variants[`switch.${t.id}`]) expect(v, `switch.${t.id}`).toContain('{themeQuestion}');
    for (const k of ['direction.sweep', 'direction.sweep.one', 'direction.naked-eye-hop']) {
      for (const v of narration.variants[k]) expect(v, k).toContain('{span}');
    }
    // Payoff lines answer every wording of the question, so none of them opens with "Yes"/"No" or asks again.
    for (const t of templates) for (const v of narration.variants[`payoff.${t.id}`]) expect(v, `payoff.${t.id}`).not.toMatch(/^(Yes|No)\b|\?/);
  });

  it('has a glossary next to it (glossary.json, plain-language.ts)', () => {
    const g = readJson(resolve(SRC, '../glossary.json')) as { terms: { id: string; term: string; short: string }[] };
    expect(g.terms.length).toBeGreaterThanOrEqual(60);
    for (const e of g.terms) expect(e.short.length, e.id).toBeGreaterThan(10);
  });

  it('cites only keys (or key prefixes) that exist', () => {
    const all = Array.from(keys);
    for (const k of Object.keys(narration.citations ?? {})) {
      expect(k.endsWith('.') ? all.some((x) => x.startsWith(k)) : keys.has(k), k).toBe(true);
    }
  });
});

describe('story data inside a whole knowledge base', () => {
  it('validates with the fixture objects, edges and sources (no reference issues)', () => {
    const merged: NarrationBank = { ...narration, variants: { ...FIXTURE_KB.narration.variants, ...narration.variants } };
    const kb: KnowledgeBase = knowledgeBaseFromFiles({
      kb: { version: 'story-test', objects: FIXTURE_KB.objects, contexts: FIXTURE_KB.contexts, sources: FIXTURE_KB.sources },
      concepts: { version: 'c', concepts },
      edges: { version: 'e', edges: FIXTURE_KB.edges },
      templates: { version: 't', templates },
      narration: merged,
    });
    expect(validateKnowledgeBaseRefs(kb)).toEqual([]);
  });
});
