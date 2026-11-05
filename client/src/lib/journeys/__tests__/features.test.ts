import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { angularDistance } from '../../astronomy';
import { generatePool } from '../assemble';
import {
  FEATURE_RANGES, MONOTONE_CONSTRAINTS, computeCriteria, computeFeatures, featureInputFromScoring, featureRecord,
  featuresHash, kendallTau, monotoneVector, progressionRho, spearmanRho, type FeatureInput, type FeatureStopInput,
} from '../features';
import { featureCapturingScorer } from '../score';
import { mulberry32 } from '../seed';
import { EDGE_TYPES, FEATURE_NAMES, type KbObject } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';

const byId = new Map(FIXTURE_KB.objects.map((o) => [o.id, o] as const));
const obj = (id: string) => byId.get(id)!;

function stop(o: KbObject, extra: Partial<FeatureStopInput> = {}): FeatureStopInput {
  return { object: o, alt: 50, minAlt: 48, glow: 0, moonSep: null, rating: 0, sunAlt: -30, minutesLeft: 120, minutesToSet: 200, link: null, ...extra };
}

function input(stops: FeatureStopInput[], extra: Partial<FeatureInput> = {}): FeatureInput {
  return { stops, radius: 30, fovDeg: 6.5, moonIllumination: 0, skyBrightness: 21.3, concepts: FIXTURE_KB.concepts, ...extra };
}

/** Seeded random valid-looking inputs over fixture objects, including hostile numbers. */
function randomInput(seed: number): FeatureInput {
  const rng = mulberry32(seed);
  const n = 3 + Math.floor(rng() * 8);
  const pool = FIXTURE_KB.objects.slice();
  const stops: FeatureStopInput[] = [];
  for (let i = 0; i < n; i++) {
    const o = pool[Math.floor(rng() * pool.length)];
    const hostile = rng() < 0.1;
    stops.push(stop(o, {
      alt: hostile ? NaN : 20 + rng() * 70,
      minAlt: hostile ? -Infinity : 20 + rng() * 60,
      glow: hostile ? Infinity : rng() * 3,
      moonSep: rng() < 0.5 ? null : rng() * 180,
      rating: Math.floor(rng() * 3),
      sunAlt: -40 + rng() * 30,
      minutesLeft: rng() * 900,
      minutesToSet: rng() * 900,
      link: i === 0 ? null : { type: EDGE_TYPES[Math.floor(rng() * EDGE_TYPES.length)], strength: 0.2 + rng() * 0.8, curated: rng() < 0.5 },
    }));
  }
  return input(stops, { moonIllumination: rng(), skyBrightness: 15 + rng() * 9, radius: 20 + rng() * 20, fovDeg: 3 + rng() * 5, template: FIXTURE_KB.templates[seed % 2] });
}

describe('features: shape, ranges, determinism', () => {
  it('returns 36 finite values inside FEATURE_RANGES for 300 random inputs (incl. NaN/Infinity)', () => {
    for (let s = 1; s <= 300; s++) {
      const x = computeFeatures(randomInput(s));
      expect(x).toHaveLength(36);
      x.forEach((v, i) => {
        const [lo, hi] = FEATURE_RANGES[FEATURE_NAMES[i]];
        expect(Number.isFinite(v), `${FEATURE_NAMES[i]} seed ${s}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      });
    }
  });

  it('is deterministic and independent of object identity', () => {
    for (let s = 1; s <= 30; s++) {
      const a = computeFeatures(randomInput(s));
      const b = computeFeatures(structuredClone(randomInput(s)));
      expect(b).toEqual(a);
    }
  });

  it('matches hand-computed values on a three-stop journey', () => {
    const [m42, belt, betel] = [obj('M42'), obj('AST-OrionBelt'), obj('STAR-Betelgeuse')];
    const x = featureRecord(computeFeatures(input([
      stop(m42, { alt: 40, minAlt: 39, minutesToSet: 100, minutesLeft: 90 }),
      stop(belt, { alt: 44, minAlt: 43, glow: 0.4, moonSep: 70, minutesToSet: 150, link: { type: 'SIBLING', strength: 0.8, curated: true } }),
      stop(betel, { alt: 51, minAlt: 50, rating: 2, sunAlt: -15, moonSep: 60, minutesToSet: 300, link: { type: 'LIFE_NEXT', strength: 0.6, curated: false } }),
    ])));
    const h1 = angularDistance(m42.ra, m42.dec, belt.ra, belt.dec);
    const h2 = angularDistance(belt.ra, belt.dec, betel.ra, betel.dec);
    expect(x.n_stops).toBe(3);
    expect(x.mean_hop_deg).toBeCloseTo((h1 + h2) / 2, 6);
    expect(x.max_hop_deg).toBeCloseTo(Math.max(h1, h2), 6);
    expect(x.path_over_cap).toBeCloseTo((h1 + h2) / 30, 6);
    expect(x.log_hop_fields).toBeCloseTo((Math.log2(1 + h1 / 6.5) + Math.log2(1 + h2 / 6.5)) / 2, 6);
    expect(x.min_alt).toBe(39);
    expect(x.mean_alt).toBeCloseTo(45, 9);
    expect(x.max_glow).toBeCloseTo(0.4, 9);
    expect(x.min_moon_sep).toBe(60);
    expect(x.mean_rating).toBeCloseTo(2 / 3, 9);
    expect(x.has_challenge).toBe(1);
    expect(x.min_margin_min).toBe(90);
    expect(x.twilight_stops).toBe(1);
    expect(x.setting_first).toBe(1);
    expect(x.edge_strength_mean).toBeCloseTo(0.7, 9);
    expect(x.edge_strength_min).toBeCloseTo(0.6, 9);
    expect(x.curated_edge_frac).toBe(0.5);
    expect(x.edge_type_count).toBe(2);
    expect(x.interest_mean).toBeCloseTo((m42.interest + belt.interest + betel.interest) / 3, 9);
    expect(x.interest_max).toBe(Math.max(m42.interest, belt.interest, betel.interest));
    expect(x.opener_showpiece).toBe(m42.showpiece || belt.showpiece ? 1 : 0);
    expect(x.finale_lift).toBeCloseTo(betel.interest - x.interest_mean, 9);
    expect(x.image_coverage).toBeCloseTo([m42, belt, betel].filter((o) => o.media.images.length).length / 3, 9);
    expect(x.moon_illum).toBe(0);
    expect(x.sky_brightness).toBe(21.3);
    expect(x.progression_rho).toBe(0); // no template
  });

  it('min_moon_sep is 180 when the Moon is down at every stop and theme_drift is 0 for identical concepts', () => {
    const o = obj('M35');
    const x = featureRecord(computeFeatures(input([stop(o), stop(o), stop(o)])));
    expect(x.min_moon_sep).toBe(180);
    expect(x.theme_drift).toBe(0);
    expect(x.kind_count).toBe(1);
  });
});

describe('rank statistics and progression', () => {
  it('Kendall τ and Spearman ρ behave on simple sequences', () => {
    expect(kendallTau([0, 1, 2, 3], [1, 2, 3, 4])).toBe(1);
    expect(kendallTau([0, 1, 2, 3], [4, 3, 2, 1])).toBe(-1);
    expect(spearmanRho([0, 1, 2], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearmanRho([0, 1, 2], [5, 5, 5])).toBe(0);
  });

  it('progressionRho follows up / down / arc', () => {
    const asc = ['M42', 'NGC1981', 'M45', 'AST-Hyades'].map(obj); // ageMyr ascending
    expect(progressionRho(asc, { property: 'ageMyr', direction: 'up' })).toBeCloseTo(1, 9);
    expect(progressionRho(asc, { property: 'ageMyr', direction: 'down' })).toBeCloseTo(-1, 9);
    const arc = ['M42', 'M45', 'AST-Hyades', 'M45'].map(obj);
    expect(progressionRho(arc, { property: 'ageMyr', direction: 'arc' })).toBeGreaterThan(0.6);
  });
});

describe('engine integration', () => {
  const req = { instant: '2027-01-15T04:30:00Z', lat: 37.77, lon: -122.42, instrument: { fovDeg: 6.5, aperture: 50, magnification: 10 }, skyBrightness: 21.3 };

  it('attaches the same finite 36-vector the adapter computes, deterministically', () => {
    let seen = 0;
    const scorer: typeof featureCapturingScorer = (x) => {
      const out = featureCapturingScorer(x);
      expect(out.features).toEqual(computeFeatures(featureInputFromScoring(x)));
      seen++;
      return out;
    };
    const a = generatePool(FIXTURE_KB, req, { explore: true, scorer });
    const b = generatePool(FIXTURE_KB, req, { explore: true, scorer: featureCapturingScorer });
    expect(seen).toBeGreaterThan(0);
    expect(a.journeys.length).toBeGreaterThan(0);
    for (const j of a.journeys) {
      expect(j.features).toHaveLength(36);
      expect(j.features!.every(Number.isFinite)).toBe(true);
    }
    expect(b.journeys.map((j) => j.features)).toEqual(a.journeys.map((j) => j.features));
  });
});

describe('doc 04 criteria', () => {
  it('are finite and respect seen objects (F20) and template theme (F1)', () => {
    for (let s = 1; s <= 50; s++) {
      const inp = randomInput(s);
      const c = computeCriteria(inp, { seenObjectIds: [inp.stops[0].object.id] });
      for (const [k, v] of Object.entries(c)) expect(Number.isFinite(v), k).toBe(true);
      expect(c.F20_novelty).toBeLessThan(1);
      expect(c.F1_themeCoverage).toBeGreaterThanOrEqual(0);
      expect(c.F1_themeCoverage).toBeLessThanOrEqual(1);
    }
  });
});

describe('feature-meta.json (train.py input) is in sync with features.ts', () => {
  it('names, monotone constraints and hash match', () => {
    const meta = JSON.parse(readFileSync(new URL('../../../../../script/journeys/train/feature-meta.json', import.meta.url), 'utf8'));
    expect(meta.featureNames).toEqual([...FEATURE_NAMES]);
    expect(meta.monotone).toEqual(monotoneVector());
    expect(meta.monotoneByName).toEqual(MONOTONE_CONSTRAINTS);
    expect(meta.featuresHash).toBe(featuresHash());
    expect(meta.ranges).toEqual(FEATURE_NAMES.map((n) => FEATURE_RANGES[n].slice(0, 2)));
  });
});
