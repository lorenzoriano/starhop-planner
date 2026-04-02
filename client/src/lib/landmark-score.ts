import { angularDistance } from './astronomy';
import type { SkyNode, ConstellationLine } from './astronomy';

/**
 * Precompute how many constellation line segments pass through each star.
 * Matches each constellation vertex to the nearest BSC star within 0.5°.
 */
export function buildConstellationSegmentCounts(
  constellations: ConstellationLine[],
  stars: SkyNode[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const constellation of constellations) {
    for (const segment of constellation.points) {
      for (const [ra, dec] of segment) {
        let bestId: string | null = null;
        let bestDist = 0.5;
        for (const star of stars) {
          if (star.type !== 'star' && star.type !== 'planet') continue;
          const d = angularDistance(ra, dec, star.ra, star.dec);
          if (d < bestDist) {
            bestDist = d;
            bestId = star.id;
          }
        }
        if (bestId) {
          counts.set(bestId, (counts.get(bestId) ?? 0) + 1);
        }
      }
    }
  }

  return counts;
}

/**
 * Compute a navigational quality score for a star.
 * Higher = easier to identify and navigate to.
 */
export function landmarkScore(
  node: SkyNode,
  constellationSegmentCounts: Map<string, number>,
): number {
  const brightnessTerm = Math.pow(Math.max(0, (6.0 - node.mag) / 5.0), 1.5);

  const segCount = constellationSegmentCounts.get(node.id) ?? 0;
  const patternTerm = Math.min(1.5, segCount * 0.5);

  const hasProperName = !!node.name && node.name.length > 2 && !node.name.startsWith('HR');
  const hasBayer = !!(node as any).bayer;
  const hasFlamsteed = !!(node as any).flamsteed;
  const nameTerm = hasProperName ? 1.0 : (hasBayer ? 0.6 : (hasFlamsteed ? 0.3 : 0));

  return brightnessTerm + patternTerm + nameTerm;
}
