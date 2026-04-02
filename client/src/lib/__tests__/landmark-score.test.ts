import { describe, it, expect, beforeAll } from 'vitest';
import { landmarkScore, buildConstellationSegmentCounts } from '../landmark-score';
import { loadStarsFromDisk, loadConstellationsFromDisk, findStar, starToSkyNode } from './test-helpers';
import type { SkyNode } from '../astronomy';

let stars: SkyNode[];
let segCounts: Map<string, number>;

beforeAll(() => {
  const parsed = loadStarsFromDisk();
  stars = parsed.map(starToSkyNode);
  const constellations = loadConstellationsFromDisk();
  segCounts = buildConstellationSegmentCounts(constellations, stars);
});

describe('landmarkScore', () => {
  it('scores Alnilam (mag 1.7, Belt member, named) much higher than a dim unnamed star', () => {
    const alnilam = findStar(stars, 'Alnilam');
    const alnilamScore = landmarkScore(alnilam, segCounts);
    expect(alnilamScore).toBeGreaterThan(2.0);

    // Find a dim unnamed star for comparison
    const dim = stars.find(s => s.mag > 5.5 && !s.name && !s.bayer);
    expect(dim).toBeDefined();
    const dimScore = landmarkScore(dim!, segCounts);
    expect(dimScore).toBeLessThan(0.3);
    expect(alnilamScore).toBeGreaterThan(dimScore * 3);
  });

  it('scores Vega (mag 0.0, named) very high', () => {
    const vega = findStar(stars, 'Vega');
    const score = landmarkScore(vega, segCounts);
    expect(score).toBeGreaterThan(2.5);
  });
});

describe('buildConstellationSegmentCounts', () => {
  it('assigns nonzero counts to Belt stars', () => {
    const alnilam = findStar(stars, 'Alnilam');
    expect(segCounts.get(alnilam.id)).toBeGreaterThan(0);
  });
});
