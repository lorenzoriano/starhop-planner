/**
 * The shipped knowledge base (client/public/data/journeys/*.json, built by `npm run journeys:kb`):
 * zero validation issues plus the invariants the engine and the cards rely on.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { knowledgeBaseFromFiles, validateKnowledgeBaseRefs } from '../kb-schema';
import { isJourneyEligible } from '../candidates';
import type { KnowledgeBase } from '../types';

const ROOT = resolve(__dirname, '../../../../..');
const DATA = resolve(ROOT, 'client/public/data/journeys');
const PUBLIC = resolve(ROOT, 'client/public');
const readJson = <T = unknown>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

const files = {
  kb: readJson<{ version: string }>(resolve(DATA, 'kb.json')),
  concepts: readJson(resolve(DATA, 'concepts.json')),
  edges: readJson<{ version: string }>(resolve(DATA, 'edges.json')),
  templates: readJson(resolve(DATA, 'templates.json')),
  narration: readJson(resolve(DATA, 'narration.json')),
};
const kb: KnowledgeBase = knowledgeBaseFromFiles(files);
const objectList = readJson<{ objects: { id: string; kind: string; hr?: number; ra: number; dec: number; con: string; batch: string }[] }>(
  resolve(ROOT, 'script/journeys/object-list.json'),
).objects;
const fixes = readJson<{ objectFixes?: Record<string, { journeyIneligible?: string }> }>(resolve(ROOT, 'script/journeys/curated/_fixes.json'));
const canonical = readJson<{ aliases: Record<string, string> }>(resolve(ROOT, 'script/journeys/sources.canonical.json'));
const seeds = readJson<{ seeds: { id: string; stops: string[]; optional?: string[]; sourceIds: string[] }[] }>(resolve(DATA, 'story-seeds.json')).seeds;

const keys = new Set(Object.keys(kb.narration.variants));
const bands = kb.narration.bands ?? {};
const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
const ctxById = new Map(kb.contexts.map((c) => [c.id, c] as const));
const eligible = kb.objects.filter(isJourneyEligible);

describe('shipped KB files', () => {
  it('validate with zero issues', () => {
    expect(validateKnowledgeBaseRefs(kb)).toEqual([]);
    expect(files.edges.version).toBe(files.kb.version);
  });

  it('contain exactly the master list, at its positions, sorted by id', () => {
    expect(kb.objects.map((o) => o.id)).toEqual(objectList.map((o) => o.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const e of objectList) {
      const o = byId.get(e.id)!;
      expect(o.kind, e.id).toBe(e.kind);
      expect([o.ra, o.dec, o.con], e.id).toEqual([e.ra, e.dec, e.con]);
      expect(o.provenance?.batch, e.id).toBe(e.batch);
      if (e.hr) expect(o.hr, e.id).toBe(e.hr);
    }
  });

  it('keep only the deliberately excluded objects out of journeys', () => {
    const excluded = Object.entries(fixes.objectFixes ?? {}).filter(([, f]) => f.journeyIneligible).map(([id]) => id).sort();
    const ineligible = kb.objects.filter((o) => !isJourneyEligible(o)).map((o) => o.id).sort();
    expect(ineligible).toEqual(excluded);
    for (const id of excluded) {
      expect(byId.get(id)?.provenance?.status).toBe('seeded');
      expect(byId.get(id)?.provenance?.ineligibleReason).toBeTruthy();
    }
    expect(eligible.length).toBeGreaterThan(500);
  });

  it('give every eligible object a complete card whose numbers resolve', () => {
    for (const o of eligible) {
      for (const f of ['glance', 'whyHere', 'see', 'understand', 'photoCaption'] as const) {
        expect(o.card[f]?.trim(), `${o.id}.card.${f}`).toBeTruthy();
      }
      // wonder and connect are optional: one sentence, or empty when it would only repeat the card.
      for (const f of ['wonder', 'connect'] as const) expect(typeof o.card[f], `${o.id}.card.${f}`).toBe('string');
      expect(o.teaches.length, o.id).toBeGreaterThan(0);
      // Owner brief r1: every card opens with a genuine question and closes with its answer.
      expect(o.card.question?.trim().endsWith('?'), `${o.id}.card.question`).toBe(true);
      expect(o.card.question!.trim().split(/\s+/).length, `${o.id}.card.question length`).toBeLessThanOrEqual(16);
      expect(o.card.answer?.trim(), `${o.id}.card.answer`).toBeTruthy();
      // Brief r2: the answer resolves the question in 1–3 sentences (a three-sentence answer runs to ~50 words).
      expect(o.card.answer!.trim().split(/\s+/).length, `${o.id}.card.answer length`).toBeLessThanOrEqual(50);
      for (const n of o.card.numbers) expect(o.facts[n.factRef], `${o.id} card number ${n.label}`).toBeDefined();
      if (o.kind === 'dso') expect(o.view.basis, o.id).not.toBe('derived');
    }
  });

  it('cite only defined sources, with no alias ids left over', () => {
    const ids = new Set(kb.sources.map((s) => s.id));
    expect(ids.size).toBe(kb.sources.length);
    for (const alias of Object.keys(canonical.aliases)) expect(ids.has(alias), alias).toBe(false);
    const text = JSON.stringify({ o: kb.objects, c: kb.contexts, e: kb.edges, s: seeds });
    for (const alias of Object.keys(canonical.aliases)) expect(text.includes(`"${alias}"`), alias).toBe(false);
    for (const o of kb.objects) {
      for (const s of o.sources) expect(ids.has(s), `${o.id} source ${s}`).toBe(true);
      for (const f of Object.values(o.facts)) expect(o.sources, `${o.id} lists ${f!.sourceId}`).toContain(f!.sourceId);
    }
    for (const s of seeds) for (const x of s.sourceIds) expect(ids.has(x), `seed ${s.id} source ${x}`).toBe(true);
  });

  it('connect existing nodes with de-duplicated edges', () => {
    const seen = new Set<string>();
    for (const e of kb.edges) {
      expect(byId.has(e.from) || ctxById.has(e.from), `${e.from}`).toBe(true);
      expect(byId.has(e.to) || ctxById.has(e.to), `${e.to}`).toBe(true);
      expect(e.from).not.toBe(e.to);
      const k = `${e.from}>${e.to}|${e.type}`;
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      if (e.directed === false) expect(seen.has(`${e.to}>${e.from}|${e.type}`), `reversed duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it('keep context membership symmetric', () => {
    for (const c of kb.contexts) for (const m of c.memberIds) expect(byId.get(m)?.contextIds, `${c.id} ∋ ${m}`).toContain(c.id);
    for (const o of kb.objects) for (const c of o.contextIds) expect(ctxById.get(c)?.memberIds, `${o.id} ∈ ${c}`).toContain(o.id);
  });

  it('use no narration key that is missing, and ship no orphan edge keys', () => {
    const missing: string[] = [];
    const need = (k: string | undefined, where: string) => { if (k && !keys.has(k)) missing.push(`${where}: ${k}`); };
    for (const e of kb.edges) need(e.reasonKey, `edge ${e.from}>${e.to}`);
    for (const t of kb.templates) {
      for (const k of [...t.titleKeys, ...(t.questionKeys ?? []), ...(t.hookKeys ?? []), ...(t.payoffKeys ?? [])]) need(k, `template ${t.id}`);
      need(t.switchRule?.announceKey, `template ${t.id} switch`);
    }
    for (const o of kb.objects) {
      for (const n of o.card.numbers) {
        if (!n.comparisonKey) continue;
        const base = `compare.${n.comparisonKey}`;
        if (!keys.has(base) && !bands[base]) missing.push(`${o.id}: ${base}`);
        for (const b of bands[base] ?? []) need(`${base}.${b.suffix}`, `${o.id} band`);
        if (n.factRef === 'periodDays') expect(n.comparisonKey, `${o.id} period compared as an age`).not.toBe('time.sun-day');
      }
    }
    expect(missing).toEqual([]);
    const used = new Set(kb.edges.map((e) => e.reasonKey));
    expect(Array.from(keys).filter((k) => k.startsWith('edge.') && !used.has(k))).toEqual([]);
  });

  it('point images at files that exist and story seeds at KB objects', () => {
    for (const o of kb.objects) {
      for (const im of o.media.images) {
        if (im.large) expect(existsSync(resolve(PUBLIC, im.large)), `${o.id} large ${im.large}`).toBe(true);
        if (/^https?:/.test(im.src)) continue;
        expect(existsSync(resolve(PUBLIC, im.src)), `${o.id} ${im.src}`).toBe(true);
      }
    }
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) for (const id of [...s.stops, ...(s.optional ?? [])]) expect(byId.has(id), `seed ${s.id} stop ${id}`).toBe(true);
  });

  it('give every journey-eligible object at least one local, credited image (owner brief r1: a picture for every stop)', () => {
    const missing = eligible.filter((o) => !o.media.images.some((im) => !/^https?:/.test(im.src))).map((o) => o.id);
    expect(missing).toEqual([]);
    for (const o of eligible) {
      for (const im of o.media.images) {
        expect(im.credit.trim().length, `${o.id} ${im.src} credit`).toBeGreaterThan(0);
        expect(im.license.trim().length, `${o.id} ${im.src} license`).toBeGreaterThan(0);
        expect(im.caption.trim().length, `${o.id} ${im.src} caption`).toBeGreaterThan(0);
        if (im.variant === 'optical' && im.src.startsWith('data/journey-images/fields/')) expect(im.fieldDeg, `${o.id} fieldDeg`).toBeGreaterThan(0);
      }
    }
  });

  it('carry a large tap-to-enlarge copy for the downscaled licensed photographs', () => {
    const withLarge = kb.objects.flatMap((o) => o.media.images).filter((im) => im.large);
    expect(withLarge.length).toBeGreaterThan(0);
    for (const im of withLarge) expect(im.large).toMatch(/^data\/journey-images\/(licensed|photos)\/large\/[^/]+\.jpg$/);
  });

  it('carry the curator-flagged data fixes', () => {
    expect(byId.get('HR6165')?.names.display).not.toMatch(/Alniyat/);
    expect(byId.get('HR6084')?.names.display).toMatch(/Alniyat/);
    const coal = byId.get('DN-Coalsack')!;
    expect(coal.ra).toBeCloseTo(192.5, 1);
    expect(coal.dec).toBeCloseTo(-62.5, 1);
    const n2527 = byId.get('NGC2527')!;
    expect(n2527.ra).toBeCloseTo(121.246, 2);
    expect(n2527.dec).toBeCloseTo(-28.122, 2);
    const ic1396 = byId.get('IC1396')!;
    expect(ic1396.facts.massMsun).toBeUndefined();
    expect(ic1396.facts.memberCount).toBeUndefined();
    expect(ctxById.get('ctx:M81Group')?.memberIds).toContain('NGC2403');
    expect(byId.get('NGC2403')?.contextIds).toContain('ctx:M81Group');
    expect(byId.get('M13')?.contextIds).toContain('ctx:GalacticHalo');
  });
});
