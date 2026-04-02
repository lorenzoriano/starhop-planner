import { describe, it, expect, beforeAll } from 'vitest';
import { LandmarkDiscountStrategy, ConfidenceDecayStrategy, FocalSearchStrategy, LandmarkMagnetStrategy, selectStrategy, getStrategy } from '../cost-strategies';
import type { CostContext } from '../cost-strategies';
import { landmarkScore, buildConstellationSegmentCounts } from '../landmark-score';
import { loadStarsFromDisk, loadConstellationsFromDisk, findStar, starToSkyNode } from './test-helpers';
import { variableReachAStar } from '../route-planner';
import { angularDistance } from '../astronomy';
import type { SkyNode } from '../astronomy';

let stars: SkyNode[];
let context: CostContext;

beforeAll(() => {
  const parsed = loadStarsFromDisk();
  stars = parsed.map(starToSkyNode);
  const constellations = loadConstellationsFromDisk();
  const segCounts = buildConstellationSegmentCounts(constellations, stars);
  const landmarkScores = new Map<string, number>();
  for (const star of stars) {
    landmarkScores.set(star.id, landmarkScore(star, segCounts));
  }
  context = { difficulty: 'intermediate', landmarkScores };
});

describe('LandmarkDiscountStrategy', () => {
  const strategy = new LandmarkDiscountStrategy();
  const fov = 3.7;

  it('costs a hop to a bright named star less than to a dim anonymous star at shorter distance', () => {
    const betelgeuse = findStar(stars, 'Betelgeuse');
    const alnilam = findStar(stars, 'Alnilam');

    // Use actual angular distances
    const distAlnilam = angularDistance(betelgeuse.ra, betelgeuse.dec, alnilam.ra, alnilam.dec);

    // Find a dim star roughly between Betelgeuse and Alnilam
    const dimStar = stars.find(s => s.mag > 4.5 && s.mag < 5.5 && !s.name &&
      angularDistance(betelgeuse.ra, betelgeuse.dec, s.ra, s.dec) < distAlnilam * 0.7);

    if (!dimStar) return; // skip if no suitable dim star found

    const distDim = angularDistance(betelgeuse.ra, betelgeuse.dec, dimStar.ra, dimStar.dec);

    const costAlnilam = strategy.edgeCost(betelgeuse, alnilam, distAlnilam, fov, context);
    const costDim = strategy.edgeCost(betelgeuse, dimStar, distDim, fov, context);

    // Alnilam should cost less despite being farther
    expect(costAlnilam).toBeLessThan(costDim);
  });

  it('heuristic is positive and finite', () => {
    const vega = findStar(stars, 'Vega');
    const altair = findStar(stars, 'Altair');
    const h = strategy.heuristic(vega, altair, fov);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(100);
  });
});

describe('variableReachAStar with LandmarkDiscount', () => {
  it('finds a path from Betelgeuse toward Orion Nebula region', () => {
    const betelgeuse = findStar(stars, 'Betelgeuse');
    // Create M42 target node
    const m42: SkyNode = {
      id: 'M42', ra: 83.82, dec: -5.39, alt: 45, az: 180,
      mag: 4.0, name: 'Orion Nebula', type: 'messier', constellation: 'Ori',
    };
    const allStars = [...stars, m42];
    const strategy = new LandmarkDiscountStrategy();

    const path = variableReachAStar(betelgeuse, m42, allStars, 3.7, 'intermediate', strategy, context);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ConfidenceDecayStrategy', () => {
  const strategy = new ConfidenceDecayStrategy();
  const fov = 3.7;

  it('costs a hop from low confidence 2.5× more than from high confidence', () => {
    const betelgeuse = findStar(stars, 'Betelgeuse');
    const alnilam = findStar(stars, 'Alnilam');
    const dist = angularDistance(betelgeuse.ra, betelgeuse.dec, alnilam.ra, alnilam.dec);

    const costHigh = strategy.edgeCost(betelgeuse, alnilam, dist, fov, { ...context, confidence: 'high' });
    const costLow = strategy.edgeCost(betelgeuse, alnilam, dist, fov, { ...context, confidence: 'low' });

    expect(costLow / costHigh).toBeCloseTo(2.5, 1);
  });

  it('nextConfidence returns high for bright landmarks', () => {
    const alnilam = findStar(stars, 'Alnilam');
    const score = context.landmarkScores.get(alnilam.id) ?? 0;
    expect(strategy.nextConfidence(score)).toBe('high');
  });

  it('nextConfidence returns low for dim unnamed stars', () => {
    expect(strategy.nextConfidence(0.1)).toBe('low');
  });
});

describe('FocalSearchStrategy', () => {
  it('has w bound that varies by difficulty', () => {
    expect(new FocalSearchStrategy('beginner').getWBound()).toBe(1.5);
    expect(new FocalSearchStrategy('intermediate').getWBound()).toBe(1.3);
    expect(new FocalSearchStrategy('expert').getWBound()).toBe(1.15);
  });
});

describe('LandmarkMagnetStrategy', () => {
  it('costs a hop through Orion Belt region less than through empty sky', () => {
    const strategy = new LandmarkMagnetStrategy(stars.filter(s => s.mag < 3.0), context.landmarkScores, 3.7);
    const betelgeuse = findStar(stars, 'Betelgeuse');
    const alnilam = findStar(stars, 'Alnilam');

    const costBelt = strategy.edgeCost(betelgeuse, alnilam, 9.8, 3.7, context);
    const emptyStar: SkyNode = { id: 'empty', ra: 200, dec: 70, alt: 45, az: 0, mag: 5.0, name: '', type: 'star' };
    const costEmpty = strategy.edgeCost(betelgeuse, emptyStar, 9.8, 3.7, context);

    expect(costBelt).toBeLessThan(costEmpty);
  });
});

describe('selectStrategy', () => {
  it('returns landmark-discount for short routes', () => {
    const s = selectStrategy(10, 5, 'intermediate', 200);
    expect(s.id).toBe('landmark-discount');
  });

  it('returns confidence-decay for beginners on long routes', () => {
    const s = selectStrategy(30, 5, 'beginner', 200);
    expect(s.id).toBe('confidence-decay');
  });
});

describe('getStrategy', () => {
  it('returns correct strategy by ID', () => {
    expect(getStrategy('landmark-discount', 'intermediate').id).toBe('landmark-discount');
    expect(getStrategy('confidence-decay', 'intermediate').id).toBe('confidence-decay');
    expect(getStrategy('focal-search', 'intermediate').id).toBe('focal-search');
  });
});

describe('Integration: Betelgeuse → M42 with LandmarkDiscount', () => {
  it('routes through bright Belt stars, not dim anonymous stars', () => {
    const betelgeuse = findStar(stars, 'Betelgeuse');
    const m42: SkyNode = {
      id: 'M42', ra: 83.82, dec: -5.39, alt: 45, az: 180,
      mag: 4.0, name: 'Orion Nebula', type: 'messier', constellation: 'Ori',
    };
    const allStars = [...stars, m42];
    const strategy = new LandmarkDiscountStrategy();

    const path = variableReachAStar(betelgeuse, m42, allStars, 3.7, 'intermediate', strategy, context);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);

    // All intermediate waypoints should be reasonably bright (mag < 4.0)
    const intermediates = path!.slice(1, -1); // exclude start and goal
    for (const wp of intermediates) {
      expect(wp.mag).toBeLessThan(4.0);
    }
  });
});
