/**
 * Engine targets on the REAL knowledge base (P4 engine evaluation, docs/sky-journeys/engine-eval.md). Skipped when
 * the KB build has not produced client/public/data/journeys/*.json. A small slice of the evaluation grid
 * (script/journeys/eval/run-grid.ts runs the full one): dark moonless nights in both hemispheres give three
 * distinct, valid journeys without lecturer vetoes; bright-Moon nights include a bright-Moon archetype.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate } from '../assemble';
import { PAYOFF_STAR_MAG, prepareKb } from '../candidates';
import { knowledgeBaseFromFiles } from '../kb-schema';
import type { JourneyRequest, KnowledgeBase } from '../types';
import { independentProblems, resultProblems } from './engine-helpers';

const dir = new URL('../../../../public/data/journeys/', import.meta.url);
const FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

const req = (instant: string, lat: number, lon: number, sky = 19): JourneyRequest => ({
  instant, lat, lon, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: sky, length: 5, includeChallenge: true, limit: 3,
});

// Dark moonless nights (new Moon 2027-01-07, 2027-07-04, 2027-10-29), ~1.5 h after astronomical dusk.
const DARK: [string, JourneyRequest][] = [
  ['San Francisco, January', req('2027-01-08T04:15:00Z', 37.77, -122.42)],
  ['Colorado dark site, July', req('2027-07-05T05:30:00Z', 38.8, -104.5, 21.5)],
  ['London, October', req('2027-10-29T20:00:00Z', 51.5, -0.1)],
  ['Sydney, July', req('2027-07-05T09:30:00Z', -33.9, 151.2)],
  ['Santiago, April', req('2027-04-07T00:00:00Z', -33.4, -70.7)],
];
// Bright Moon up (full Moon 2027-01-22, 2027-08-17).
const MOONLIT: [string, JourneyRequest][] = [
  ['San Francisco, full Moon', req('2027-01-22T07:00:00Z', 37.77, -122.42)],
  ['Sydney, full Moon', req('2027-08-17T11:00:00Z', -33.9, 151.2)],
];

describe.skipIf(!present)('engine on the real KB', () => {
  const kb: KnowledgeBase | null = present
    ? knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(new URL('lenses.json', dir)) ? read('lenses.json') : undefined })
    : null;

  it.each(DARK)('%s: three distinct valid journeys, no lecturer vetoes', (_label, r) => {
    const prep = prepareKb(kb!);
    const res = generate(kb!, r);
    expect(res.journeys).toHaveLength(3);
    // Three different archetypes whenever tonight's pool has three (a sparse sky may only support two).
    const poolTemplates = new Set(generate(kb!, r, { explore: true }).journeys.map((j) => j.templateId)).size;
    // The explore pool uses only strict tiers, so generate (which may fill from relaxed tiers) can find more themes, never fewer.
    expect(new Set(res.journeys.map((j) => j.templateId)).size).toBeGreaterThanOrEqual(Math.min(3, poolTemplates));
    for (const j of res.journeys) {
      expect(independentProblems(kb!, r, res, j)).toEqual([]);
      const ids = j.stops.map((s) => prep.index.get(s.objectId)!);
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) expect(prep.graph.pairOk(ids[a], ids[b])).toBe(true);
      const p = j.stops.findIndex((s) => s.arc === 'payoff');
      const payoff = prep.objects[ids[p]];
      // A lens theme's payoff is positional and a sure sight unless it sits on the theme's final or an end beat
      // (round 3: A8's violent ending at the Veil); a slot theme's payoff slot may ask for a hard object
      // (maxObsDifficulty ≥ 4).
      const set = kb!.lenses?.find((l) => l.archetype === kb!.templates.find((t) => t.id === j.templateId)?.archetype);
      const lensFinale = !!j.stops[p].lens && !!set && (j.stops[p].lens!.step === Math.max(...set.beats.map((x) => x.step)) || !!set.endSteps?.includes(j.stops[p].lens!.step));
      const slot = j.stops[p].lens ? undefined : kb!.templates.find((t) => t.id === j.templateId)!.slots.find((x) => x.label === j.stops[p].role);
      if ((slot?.match.maxObsDifficulty ?? 0) < 4 && !lensFinale) {
        expect(j.stops[p].challenge, `${j.title}: challenge payoff`).toBe(false);
        if (payoff.kind === 'star') expect(payoff.mag!, `${j.title}: faint payoff ${payoff.id}`).toBeLessThanOrEqual(PAYOFF_STAR_MAG);
      }
    }
    // No two suggestions share two or more stops.
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const A = new Set(res.journeys[a].stops.map((s) => s.objectId));
      expect(res.journeys[b].stops.filter((s) => A.has(s.objectId)).length).toBeLessThan(2);
    }
  }, 60_000);

  it.each(MOONLIT)('%s: a bright-Moon archetype is among the suggestions', (_label, r) => {
    const res = generate(kb!, r);
    expect(res.conditions!.moon.up).toBe(true);
    expect(res.journeys.length).toBeGreaterThan(0);
    const bright = new Set(kb!.templates.filter((t) => t.moonSuitability === 'bright-ok').map((t) => t.id));
    expect(res.journeys.some((j) => bright.has(j.templateId))).toBe(true);
    for (const j of res.journeys) expect(independentProblems(kb!, r, res, j)).toEqual([]);
  }, 60_000);

  // Round 3 engine rules on the real KB (owner simulator): whole stories told through the theme lenses.
  it('lens journeys never switch theme, and A1 opens at its nursery when the Orion Nebula is up (San Francisco, new Moon)', () => {
    for (const [, r] of [...DARK, ...MOONLIT]) for (const j of generate(kb!, r).journeys) expect(j.switch, j.title).toBeUndefined();
    const r = { ...req('2027-01-08T04:15:00Z', 37.77, -122.42), theme: 'A1-cradle-to-grave' };
    const res = generate(kb!, r);
    expect(res.journeys.length).toBeGreaterThan(0);
    const first = res.journeys[0];
    expect(first.stops[0].lens?.step, first.stops.map((x) => x.objectId).join(' > ')).toBe(1);
    for (const j of res.journeys) expect(independentProblems(kb!, r, res, j)).toEqual([]);
  });

  it('A8 at a dark site may close on a challenge stop on its final beat (Colorado, new Moon, July)', () => {
    const r = { ...req('2027-07-05T05:30:00Z', 38.8, -104.5, 21.5), theme: 'A8-how-stars-die' };
    let pool: readonly { stops: { lens?: { step: number }; challenge: boolean }[] }[] = [];
    const res = generate(kb!, r, { inspectPool: (p) => { pool = p; } });
    const set = kb!.lenses?.find((l) => l.archetype === 'A8');
    if (!set) return;
    const final = Math.max(...set.beats.map((b) => b.step));
    expect(pool.some((j) => j.stops[j.stops.length - 1].challenge && j.stops[j.stops.length - 1].lens?.step === final)).toBe(true);
    for (const j of res.journeys) expect(independentProblems(kb!, r, res, j)).toEqual([]);
  });

  it('a full Moon at a dark site does not empty the list (moonlight measured against a reference sky)', () => {
    const res = generate(kb!, req('2027-01-22T05:30:00Z', 38.8, -104.5, 21.5));
    expect(res.journeys.length).toBe(3);
  }, 60_000);

  it('a sky that supports only one kind of story says so', () => {
    // Santiago, late October, 22:30: Grus / Tucana / Phoenix; the southern KB holds only contrast tours there.
    const res = generate(kb!, req('2027-10-30T01:30:00Z', -33.4, -70.7));
    // Never two near-identical tours to make up the number, and at most one contrast tour (owner feedback round 1).
    expect(res.journeys.length).toBeGreaterThanOrEqual(1);
    expect(resultProblems(res)).toEqual([]);
    expect(res.journeys.filter((j) => j.templateId.startsWith('A6-')).length).toBeLessThanOrEqual(1);
    if (new Set(res.journeys.map((j) => j.templateId)).size === 1) {
      expect(res.diagnostics.message).toMatch(/Only “.*” stories fit this part of the sky/);
    }
  }, 60_000);

  it('stays within the runtime budget (spec 13: ≤ 300 ms desktop; loose CI bound)', () => {
    const ms: number[] = [];
    for (const [, r] of [...DARK, ...MOONLIT]) {
      for (const length of [5, 8]) {
        const t = performance.now();
        generate(kb!, { ...r, length });
        ms.push(performance.now() - t);
      }
    }
    const sorted = ms.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`[perf/real-kb] ${ms.length} requests: median ${median.toFixed(0)} ms, max ${sorted[sorted.length - 1].toFixed(0)} ms`);
    // The evaluation machine measures ~60 ms median / ≤ 300 ms worst case; CI machines are slower and shared.
    expect(median).toBeLessThan(600);
  }, 120_000);

  it('a forced dark-sky theme in a city explains why it is empty', () => {
    const res = generate(kb!, { ...req('2027-07-05T05:30:00Z', 37.77, -122.42, 19), theme: 'A11-inside-our-galaxy' });
    expect(res.journeys).toEqual([]);
    expect(res.diagnostics.message).toMatch(/needs a dark sky/);
  }, 60_000);
});
