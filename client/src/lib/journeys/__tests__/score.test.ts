import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate } from '../assemble';
import { FEATURE_RANGES, MONOTONE_CONSTRAINTS } from '../features';
import { HEURISTIC_MODEL, HEURISTIC_WEIGHTS } from '../heuristic-weights';
import { createModelScorer, resolveModel, scoreGbdt, scoreJourney, scoreLinear, validateModel } from '../score';
import { mulberry32 } from '../seed';
import { FEATURE_NAMES, type GbdtModel, type LinearModel, type ScorerModel } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')) as T;
const gbdt = fixture<GbdtModel>('scorer-toy-gbdt.json');
const linear = fixture<LinearModel>('scorer-toy-linear.json');
const golden = fixture<{ featureNames: string[]; vectors: number[][]; gbdt: number[]; linear: number[] }>('scorer-toy-golden.json');

function randomVector(rng: () => number): number[] {
  return FEATURE_NAMES.map((n) => { const [lo, hi] = FEATURE_RANGES[n]; return lo + (hi - lo) * rng(); });
}

describe('GBDT / linear inference parity with the Python export (train.py toy)', () => {
  it('fixture models are valid and use FEATURE_NAMES', () => {
    expect(golden.featureNames).toEqual([...FEATURE_NAMES]);
    expect(validateModel(gbdt)).toEqual([]);
    expect(validateModel(linear)).toEqual([]);
    expect(gbdt.trees.length).toBeGreaterThan(0);
  });

  it('scoreGbdt equals LightGBM booster.predict(raw_score) within 1e-9, including split-threshold ties', () => {
    expect(golden.vectors.length).toBeGreaterThan(24);
    golden.vectors.forEach((x, i) => expect(Math.abs(scoreGbdt(gbdt, x) - golden.gbdt[i])).toBeLessThan(1e-9));
  });

  it('scoreLinear equals the Python linear prediction within 1e-9', () => {
    golden.vectors.forEach((x, i) => expect(Math.abs(scoreLinear(linear, x) - golden.linear[i])).toBeLessThan(1e-9));
  });
});

describe('monotone constraints hold for every scorer tier', () => {
  const models: [string, ScorerModel][] = [['gbdt', gbdt], ['linear', linear], ['heuristic', HEURISTIC_MODEL]];
  for (const [label, model] of models) {
    it(`${label}: raising a +1 feature never lowers the score, raising a −1 feature never raises it`, () => {
      const rng = mulberry32(42);
      for (let base = 0; base < 40; base++) {
        const x = randomVector(rng);
        for (const [name, dir] of Object.entries(MONOTONE_CONSTRAINTS)) {
          const i = FEATURE_NAMES.indexOf(name as (typeof FEATURE_NAMES)[number]);
          const [lo, hi] = FEATURE_RANGES[name as (typeof FEATURE_NAMES)[number]];
          let prev = -Infinity * dir!;
          for (let k = 0; k <= 20; k++) {
            const v = x.slice();
            v[i] = lo + ((hi - lo) * k) / 20;
            const s = scoreJourney(v, model);
            if (dir === 1) expect(s, `${label} ${name}`).toBeGreaterThanOrEqual(prev - 1e-9);
            else expect(s, `${label} ${name}`).toBeLessThanOrEqual(prev + 1e-9);
            prev = s;
          }
        }
      }
    });
  }

  it('hand-tuned weights have the constrained signs', () => {
    for (const [name, dir] of Object.entries(MONOTONE_CONSTRAINTS)) {
      expect(Math.sign(HEURISTIC_WEIGHTS[name as keyof typeof HEURISTIC_WEIGHTS]) * dir! >= 0, name).toBe(true);
    }
    expect(HEURISTIC_MODEL.weights).toHaveLength(36);
  });
});

describe('validation and fallback', () => {
  it('rejects wrong feature names, bad child indices and cycles; resolveModel falls back to the heuristic', () => {
    const renamed = { ...gbdt, features: [...gbdt.features].reverse() };
    expect(validateModel(renamed).length).toBeGreaterThan(0);
    const t0 = gbdt.trees.find((t) => t.f.length >= 2)!;
    const badChild: GbdtModel = { ...gbdt, trees: [{ ...t0, l: [99, ...t0.l.slice(1)] }] };
    expect(validateModel(badChild).join()).toMatch(/child index/);
    const cycle: GbdtModel = { ...gbdt, trees: [{ ...t0, l: [0, ...t0.l.slice(1)] }] };
    expect(validateModel(cycle).length).toBeGreaterThan(0);
    const badLinear: LinearModel = { ...linear, std: linear.std.map(() => 0) };
    expect(validateModel(badLinear).join()).toMatch(/std/);
    for (const m of [renamed, badChild, cycle, badLinear, null]) {
      const r = resolveModel(m);
      expect(r.model).toBe(HEURISTIC_MODEL);
      expect(r.fallbackReason).toBeTruthy();
    }
    expect(resolveModel(gbdt)).toEqual({ model: gbdt, fallbackReason: null });
  });

  it('scoreJourney quantises and rejects wrong lengths; weightless heuristic uses the engine h', () => {
    const x = randomVector(mulberry32(1));
    const s = scoreJourney(x, gbdt);
    expect(Math.round(s * 1e6) / 1e6).toBe(s);
    expect(() => scoreJourney(x.slice(1), gbdt)).toThrow();
    expect(scoreJourney(x, { type: 'heuristic', modelVersion: 'h', features: [...FEATURE_NAMES] }, { heuristic: 1.2345678 })).toBe(1.234568);
  });
});

describe('engine plug-in', () => {
  const req = { instant: '2027-01-15T04:30:00Z', lat: 37.77, lon: -122.42, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 21.3 };

  it('ranks with the given model and reports its tier; an invalid model degrades to the heuristic', () => {
    const r = generate(FIXTURE_KB, req, { model: gbdt, scorer: createModelScorer(gbdt) });
    expect(r.diagnostics.scorer).toBe('gbdt');
    expect(r.journeys.length).toBeGreaterThan(0);
    for (const j of r.journeys) {
      expect(j.features).toHaveLength(36);
      expect(j.score).toBe(scoreJourney(j.features!, gbdt));
    }
    const bad = generate(FIXTURE_KB, req, { scorer: createModelScorer({ ...gbdt, features: ['x'] }) });
    expect(bad.diagnostics.scorer).toBe('heuristic');
  });
});
