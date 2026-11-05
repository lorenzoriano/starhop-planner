/**
 * Determinism and variety (doc 05 §9, §12.6; spec decision 5): same request ⇒ same result; requests in the
 * same 15-minute slot ⇒ same journeys; KB array order does not matter; shuffles are deterministic and varied.
 */
import { describe, expect, it } from 'vitest';
import { generate, selectWithShuffle } from '../assemble';
import { buildSeedKey, fnv1a53, gumbel, hashHex, localNightDate, mulberry32, rngFor, seededShuffle, slotStartMs } from '../seed';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { request, resultProblems, stripMs, syntheticKb } from './engine-helpers';
import type { KnowledgeBase } from '../types';

const DARK = '2027-01-09T05:00:00Z'; // SF 21:00 PST, Moon down
const keys = (r: ReturnType<typeof generate>) => r.journeys.map((j) => j.key);

describe('seed utilities', () => {
  it('hashes and PRNG streams are stable', () => {
    expect(fnv1a53('sky')).toBe(fnv1a53('sky'));
    expect(fnv1a53('sky')).not.toBe(fnv1a53('skz'));
    expect(Number.isSafeInteger(fnv1a53('x'.repeat(1000)))).toBe(true);
    expect(hashHex('a')).toHaveLength(14);
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rngFor('k', 1)()).toBe(rngFor('k', 1)());
    expect(rngFor('k', 1)()).not.toBe(rngFor('k', 2)());
    expect(Number.isFinite(gumbel(() => 0))).toBe(true);
    const shuffled = seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(7));
    expect(shuffled.slice().sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(7))).toEqual(shuffled);
  });

  it('slots and night dates', () => {
    expect(new Date(slotStartMs(Date.parse('2027-01-09T05:13:59Z'))).toISOString()).toBe('2027-01-09T05:00:00.000Z');
    // 21:00 and 03:00 local mean time at SF belong to the same night.
    expect(localNightDate(Date.parse('2027-01-09T05:09:00Z'), -122.42)).toBe(localNightDate(Date.parse('2027-01-09T11:09:00Z'), -122.42));
    const k1 = buildSeedKey(request('2027-01-09T05:02:00Z'), 'v', 'm');
    expect(buildSeedKey(request('2027-01-09T05:13:00Z'), 'v', 'm')).toBe(k1);
    expect(buildSeedKey(request('2027-01-09T05:16:00Z'), 'v', 'm')).not.toBe(k1);
    expect(buildSeedKey(request('2027-01-09T05:02:00Z', { lat: 37.771 }), 'v', 'm')).toBe(k1);
    expect(buildSeedKey(request('2027-01-09T05:02:00Z', { theme: 'star-colours' }), 'v', 'm')).not.toBe(k1);
    expect(buildSeedKey(request('2027-01-09T05:02:00Z', { shuffle: 3 }), 'v', 'm')).toBe(k1);
  });
});

describe('engine determinism', () => {
  it('same request twice ⇒ deep-equal result', () => {
    const a = generate(FIXTURE_KB, request(DARK));
    const b = generate(FIXTURE_KB, request(DARK));
    expect(a.journeys.length).toBeGreaterThan(0);
    expect(stripMs(b)).toEqual(stripMs(a));
    // A fresh KB object (no memo reuse) gives the same answer.
    expect(stripMs(generate(structuredClone(FIXTURE_KB), request(DARK)))).toEqual(stripMs(a));
  });

  it('same 15-minute slot ⇒ same journeys (live mode does not reshuffle)', () => {
    const a = generate(FIXTURE_KB, request('2027-01-09T05:02:00Z'));
    const b = generate(FIXTURE_KB, request('2027-01-09T05:13:00Z'));
    expect(keys(a).length).toBeGreaterThan(0);
    expect(keys(b)).toEqual(keys(a));
    expect(b.journeys.map((j) => j.title)).toEqual(a.journeys.map((j) => j.title));
    // Displayed windows follow the real instant.
    expect(b.journeys[0].stops[0].windowStart).toBe('2027-01-09T05:13:00.000Z');
  });

  it('independent of KB array order', () => {
    const rng = mulberry32(99);
    const kb = syntheticKb(12);
    const shuffled: KnowledgeBase = {
      ...kb,
      objects: seededShuffle(kb.objects, rng),
      edges: seededShuffle(kb.edges, rng),
      contexts: seededShuffle(kb.contexts, rng),
      templates: seededShuffle(kb.templates, rng),
    };
    for (const instant of [DARK, '2027-02-20T06:00:00Z', '2026-12-01T09:00:00Z']) {
      const a = generate(kb, request(instant));
      const b = generate(shuffled, request(instant));
      expect(stripMs(b)).toEqual(stripMs(a));
    }
  });
});

describe('shuffle variety', () => {
  it('fixture: shuffles are deterministic and fall back gracefully when the pool is small', () => {
    const r0 = generate(FIXTURE_KB, request(DARK, { limit: 1 }));
    const r1 = generate(FIXTURE_KB, request(DARK, { limit: 1, shuffle: 1 }));
    expect(keys(r0)).toHaveLength(1);
    expect(keys(r1)).toHaveLength(1);
    if ((r0.diagnostics.validated ?? 0) > 1) expect(keys(r1)).not.toEqual(keys(r0));
    expect(keys(generate(FIXTURE_KB, request(DARK, { limit: 1, shuffle: 1 })))).toEqual(keys(r1));
    expect(r1.seedKey).toBe(r0.seedKey);
  });

  it('synthetic KB: successive shuffles show new journeys while the pool lasts', () => {
    const kb = syntheticKb(24);
    const base = generate(kb, request(DARK));
    expect(base.journeys.length).toBe(3);
    expect(resultProblems(base)).toEqual([]);
    const pool = base.diagnostics.validated ?? 0;
    const seen = new Set(keys(base));
    let fresh = 0;
    for (let k = 1; k <= 3; k++) {
      const r = generate(kb, request(DARK, { shuffle: k }));
      // A page never pads itself with near-identical journeys (owner feedback round 1), so a small pool may give
      // fewer than three.
      expect(r.journeys.length).toBeGreaterThanOrEqual(1);
      expect(resultProblems(r)).toEqual([]);
      expect(keys(generate(kb, request(DARK, { shuffle: k })))).toEqual(keys(r));
      for (const key of keys(r)) if (!seen.has(key)) { fresh++; seen.add(key); }
    }
    console.log(`[shuffle] pool=${pool} distinct shown over 4 pages=${seen.size}`);
    expect(fresh).toBeGreaterThanOrEqual(Math.min(3, pool - 3));
  });

  it('selectWithShuffle: MMR prefers diverse sets', () => {
    const mk = (key: string, score: number, ids: string[], templateId = 'T', patch = 'P0') => ({
      journey: { key, score, templateId } as never, ids, patch: { id: patch } as never, plan: {} as never, h: score, s: {} as never, tier: 0,
    });
    // a and b share two of three stops, template and patch; c is different and still good.
    const pool = [mk('a', 1, ['x', 'y', 'z']), mk('b', 0.99, ['x', 'y', 'w']), mk('c', 0.6, ['p', 'q', 'r'], 'U', 'P1'), mk('d', 0, ['s', 't', 'u'], 'V', 'P2')];
    const picked = selectWithShuffle(pool, 2, 0, 'seed').map((b) => (b.journey as { key: string }).key);
    expect(picked).toEqual(['a', 'c']);
  });
});
