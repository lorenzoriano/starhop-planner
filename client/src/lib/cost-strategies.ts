import { angularDistance } from './astronomy';
import type { SkyNode } from './astronomy';
import type { DifficultyLevel } from './route-planner';

export type CostStrategyId = 'landmark-discount' | 'confidence-decay' | 'focal-search' | 'landmark-magnet' | 'auto';

export interface CostContext {
  difficulty: DifficultyLevel;
  landmarkScores: Map<string, number>;
  confidence?: 'high' | 'medium' | 'low';
}

export interface CostStrategy {
  readonly name: string;
  readonly id: CostStrategyId;
  edgeCost(from: SkyNode, to: SkyNode, dist: number, fov: number, context: CostContext): number;
  heuristic(node: SkyNode, goal: SkyNode, fov: number): number;
}

/**
 * Option 1: Landmark-Discounted Distance (default).
 * cost = (dist / FOV) × obscurity(destination)
 * where obscurity = 1 / (1 + landmark_score)
 */
export class LandmarkDiscountStrategy implements CostStrategy {
  readonly name = 'Landmark Discount';
  readonly id = 'landmark-discount' as const;

  edgeCost(from: SkyNode, to: SkyNode, dist: number, fov: number, context: CostContext): number {
    const score = context.landmarkScores.get(to.id) ?? 0;
    const obscurity = 1 / (1 + score);
    const baseCost = dist / fov;
    return Math.max(0.05, baseCost * obscurity);
  }

  heuristic(node: SkyNode, goal: SkyNode, fov: number): number {
    const dist = angularDistance(node.ra, node.dec, goal.ra, goal.dec);
    return (dist / fov) * 0.05;
  }
}

const CONFIDENCE_MULT = { high: 1.0, medium: 1.5, low: 2.5 } as const;

export class ConfidenceDecayStrategy implements CostStrategy {
  readonly name = 'Confidence Decay';
  readonly id = 'confidence-decay' as const;

  edgeCost(from: SkyNode, to: SkyNode, dist: number, fov: number, context: CostContext): number {
    const score = context.landmarkScores.get(to.id) ?? 0;
    const obscurity = 1 / (1 + score);
    const baseCost = dist / fov;
    const conf = context.confidence ?? 'high';
    return Math.max(0.05, baseCost * obscurity * CONFIDENCE_MULT[conf]);
  }

  nextConfidence(toScore: number): 'high' | 'medium' | 'low' {
    if (toScore >= 2.0) return 'high';
    if (toScore >= 0.8) return 'medium';
    return 'low';
  }

  heuristic(node: SkyNode, goal: SkyNode, fov: number): number {
    const dist = angularDistance(node.ra, node.dec, goal.ra, goal.dec);
    return (dist / fov) * 0.05;
  }
}

export class FocalSearchStrategy implements CostStrategy {
  readonly name = 'Focal Search';
  readonly id = 'focal-search' as const;
  private wBound: number;

  constructor(difficulty: DifficultyLevel = 'intermediate') {
    this.wBound = difficulty === 'beginner' ? 1.5 : difficulty === 'expert' ? 1.15 : 1.3;
  }

  edgeCost(from: SkyNode, to: SkyNode, dist: number, fov: number, context: CostContext): number {
    const score = context.landmarkScores.get(to.id) ?? 0;
    const obscurity = 1 / (1 + score);
    return Math.max(0.05, (dist / fov) * obscurity);
  }

  heuristic(node: SkyNode, goal: SkyNode, fov: number): number {
    const dist = angularDistance(node.ra, node.dec, goal.ra, goal.dec);
    return (dist / fov) * 0.05;
  }

  getWBound(): number { return this.wBound; }
}

export class LandmarkMagnetStrategy implements CostStrategy {
  readonly name = 'Landmark Magnet';
  readonly id = 'landmark-magnet' as const;
  private fieldGrid: Map<string, number>;
  private cellSize = 2;

  constructor(landmarks: SkyNode[], scores: Map<string, number>, fov: number) {
    this.fieldGrid = new Map();
    const sigma = 1.5 * fov;
    const sigma2 = 2 * sigma * sigma;

    for (const lm of landmarks) {
      const lmScore = scores.get(lm.id) ?? 0;
      if (lmScore < 0.5) continue;
      const radius = Math.ceil(3 * sigma / this.cellSize);
      const cRa = Math.floor(lm.ra / this.cellSize);
      const cDec = Math.floor((lm.dec + 90) / this.cellSize);
      const maxRaBucket = Math.ceil(360 / this.cellSize);

      for (let dr = -radius; dr <= radius; dr++) {
        for (let dd = -radius; dd <= radius; dd++) {
          const raBucket = ((cRa + dr) % maxRaBucket + maxRaBucket) % maxRaBucket;
          const decBucket = cDec + dd;
          if (decBucket < 0 || decBucket >= Math.ceil(180 / this.cellSize)) continue;
          const cellRa = raBucket * this.cellSize;
          const cellDec = decBucket * this.cellSize - 90;
          const d = angularDistance(cellRa, cellDec, lm.ra, lm.dec);
          const field = lmScore * Math.exp(-(d * d) / sigma2);
          const key = `${raBucket},${decBucket}`;
          this.fieldGrid.set(key, (this.fieldGrid.get(key) ?? 0) + field);
        }
      }
    }
  }

  private getField(ra: number, dec: number): number {
    const raBucket = Math.floor(ra / this.cellSize);
    const decBucket = Math.floor((dec + 90) / this.cellSize);
    return this.fieldGrid.get(`${raBucket},${decBucket}`) ?? 0;
  }

  edgeCost(from: SkyNode, to: SkyNode, dist: number, fov: number, context: CostContext): number {
    const midRa = (from.ra + to.ra) / 2;
    const midDec = (from.dec + to.dec) / 2;
    const field = this.getField(midRa, midDec);
    return Math.max(0.05, (dist / fov) / (1 + 0.3 * field));
  }

  heuristic(node: SkyNode, goal: SkyNode, fov: number): number {
    const dist = angularDistance(node.ra, node.dec, goal.ra, goal.dec);
    return (dist / fov) * 0.03;
  }
}

// ─── Strategy Registry & Auto-Selection ─────────────────────

export const STRATEGIES = {
  'landmark-discount': new LandmarkDiscountStrategy(),
} as const;

export function selectStrategy(
  totalAngularDist: number,
  fov: number,
  difficulty: DifficultyLevel,
  skyNodeCount: number,
): CostStrategy {
  const hopEstimate = totalAngularDist / fov;
  if (hopEstimate <= 3) return STRATEGIES['landmark-discount'];
  if (skyNodeCount < 50 || difficulty === 'beginner') return new ConfidenceDecayStrategy();
  return STRATEGIES['landmark-discount'];
}

export function getStrategy(
  id: CostStrategyId,
  difficulty: DifficultyLevel,
  stars?: SkyNode[],
  scores?: Map<string, number>,
  fov?: number,
): CostStrategy {
  switch (id) {
    case 'landmark-discount': return STRATEGIES['landmark-discount'];
    case 'confidence-decay': return new ConfidenceDecayStrategy();
    case 'focal-search': return new FocalSearchStrategy(difficulty);
    case 'landmark-magnet':
      if (!stars || !scores || !fov) return STRATEGIES['landmark-discount'];
      return new LandmarkMagnetStrategy(stars.filter(s => s.mag < 3.0), scores, fov);
    case 'auto': return STRATEGIES['landmark-discount'];
    default: return STRATEGIES['landmark-discount'];
  }
}
