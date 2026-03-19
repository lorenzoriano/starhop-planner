import { describe, it, expect, beforeAll } from 'vitest';
import { angularDistance } from '../astronomy';
import {
  maxReach,
  edgeCost,
  directionAngle,
  compressInstructions,
  variableReachAStar,
  planRoute,
  DIFFICULTY_PRESETS,
  type DifficultyLevel,
  type DifficultyParams,
  type PathNode,
} from '../route-planner';
import {
  loadTestCatalogs,
  findStar,
  findTarget,
} from './test-helpers';
import type { SkyNode } from '../astronomy';

// ─── Phase 2: Unit Tests for Pure Functions ─────────────────

describe('maxReach', () => {
  const fov = 5; // degrees

  it('gives large reach for very bright stars (Vega, mag ~0)', () => {
    const reach = maxReach(0.0, fov, true);
    // fov * (0.7 + max(0, (7-0)/2.2)) = 5 * (0.7 + 3.18) = 5 * 3.88 ≈ 19.1
    expect(reach).toBeCloseTo(19.1, 0);
  });

  it('gives enough reach for Sulafat (mag 3.24) to cover 7.6° from Vega', () => {
    const reach = maxReach(3.24, fov, true);
    // fov * (0.7 + max(0, (7-3.24)/2.2)) = 5 * (0.7 + 1.709) = 5 * 2.409 ≈ 12.05
    expect(reach).toBeGreaterThan(7.6); // critical: must reach Vega→Sulafat distance
    expect(reach).toBeCloseTo(12.0, 0);
  });

  it('gives small reach for dim unnamed stars', () => {
    const reach = maxReach(7.0, fov, false);
    // fov * (0.7 + max(0, (7-7)/2.2)) * 0.7 = 5 * 0.7 * 0.7 = 2.45
    expect(reach).toBeCloseTo(2.45, 1);
  });

  it('gives reduced reach for unnamed stars (0.7× penalty)', () => {
    const named = maxReach(4.0, fov, true);
    const unnamed = maxReach(4.0, fov, false);
    expect(unnamed).toBeCloseTo(named * 0.7, 1);
  });

  it('never returns negative reach', () => {
    // Mag > 7 means the (7-mag)/2.2 term is negative, but clamped to 0
    const reach = maxReach(9.0, fov, true);
    expect(reach).toBeGreaterThan(0);
    expect(reach).toBeCloseTo(fov * 0.7, 1);
  });
});

describe('edgeCost', () => {
  const fov = 5;

  it('returns base cost ~1.0 for bright named star at moderate distance', () => {
    const cost = edgeCost(3.0, 1.0, true, fov);
    expect(cost).toBeGreaterThanOrEqual(1.0);
    expect(cost).toBeLessThan(1.5);
  });

  it('penalizes dim destination stars', () => {
    const costBright = edgeCost(3.0, 1.0, true, fov);
    const costDim = edgeCost(3.0, 5.0, true, fov);
    expect(costDim).toBeGreaterThan(costBright);
  });

  it('penalizes unnamed destination stars', () => {
    const costNamed = edgeCost(3.0, 3.0, true, fov);
    const costUnnamed = edgeCost(3.0, 3.0, false, fov);
    expect(costUnnamed).toBeGreaterThan(costNamed);
  });

  it('penalizes hops near maximum reach', () => {
    const costSafe = edgeCost(5.0, 2.0, true, fov);
    const costEdge = edgeCost(12.0, 2.0, true, fov);
    expect(costEdge).toBeGreaterThan(costSafe);
  });

  it('is always positive', () => {
    expect(edgeCost(0.1, 0.0, true, fov)).toBeGreaterThan(0);
  });
});

describe('directionAngle', () => {
  it('returns ~0° for due north (same RA, increasing Dec)', () => {
    const angle = directionAngle(180, 30, 180, 40);
    expect(angle).toBeCloseTo(0, 0);
  });

  it('returns ~90° for due east (increasing RA, same Dec)', () => {
    // At dec 30°, 5° RA ≈ 88.7° bearing due to spherical geometry — within 2°
    const angle = directionAngle(180, 30, 185, 30);
    expect(Math.abs(angle - 90)).toBeLessThan(2);
  });

  it('returns ~180° for due south', () => {
    const angle = directionAngle(180, 30, 180, 20);
    expect(angle).toBeCloseTo(180, 0);
  });

  it('returns ~270° for due west', () => {
    // Same spherical effect: ~271.25° instead of exactly 270°
    const angle = directionAngle(180, 30, 175, 30);
    expect(Math.abs(angle - 270)).toBeLessThan(2);
  });

  it('handles RA wrapping around 360°', () => {
    const angle = directionAngle(359, 30, 1, 30);
    // Should be ~90° (east), not ~270°
    expect(Math.abs(angle - 90)).toBeLessThan(2);
  });
});

describe('compressInstructions', () => {
  const diffParams = DIFFICULTY_PRESETS.expert;

  // Create simple path nodes going in the same direction (northeast)
  function makePathNodes(count: number): PathNode[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `star-${i}`,
      ra: 180 + i * 2,
      dec: 30 + i * 2,
      mag: 2.0,
      name: `Star ${i}`,
      named: true,
    }));
  }

  it('merges direction-consistent hops into fewer instructions', () => {
    const nodes = makePathNodes(4); // 3 hops, all same direction
    const compressed = compressInstructions(nodes, diffParams, 5);
    expect(compressed.length).toBeLessThan(3);
  });

  it('does not merge hops with direction change beyond tolerance', () => {
    // Path that turns sharply
    const nodes: PathNode[] = [
      { id: 's0', ra: 180, dec: 30, mag: 2.0, name: 'A', named: true },
      { id: 's1', ra: 185, dec: 30, mag: 2.0, name: 'B', named: true },
      { id: 's2', ra: 185, dec: 40, mag: 2.0, name: 'C', named: true }, // sharp turn north
    ];
    const compressed = compressInstructions(nodes, diffParams, 5);
    expect(compressed.length).toBe(2); // both hops kept
  });

  it('beginner mode produces more stops than expert', () => {
    const nodes = makePathNodes(5); // 4 hops same direction
    const beginnerResult = compressInstructions(nodes, DIFFICULTY_PRESETS.beginner, 5);
    const expertResult = compressInstructions(nodes, DIFFICULTY_PRESETS.expert, 5);
    expect(beginnerResult.length).toBeGreaterThanOrEqual(expertResult.length);
  });
});

describe('DIFFICULTY_PRESETS', () => {
  it('has exactly 3 levels: beginner, intermediate, expert', () => {
    expect(Object.keys(DIFFICULTY_PRESETS)).toHaveLength(3);
    expect(DIFFICULTY_PRESETS.beginner).toBeDefined();
    expect(DIFFICULTY_PRESETS.intermediate).toBeDefined();
    expect(DIFFICULTY_PRESETS.expert).toBeDefined();
  });

  it('beginner has smallest reach multiplier', () => {
    expect(DIFFICULTY_PRESETS.beginner.reachMultiplier)
      .toBeLessThan(DIFFICULTY_PRESETS.intermediate.reachMultiplier);
    expect(DIFFICULTY_PRESETS.intermediate.reachMultiplier)
      .toBeLessThan(DIFFICULTY_PRESETS.expert.reachMultiplier);
  });

  it('beginner has tightest direction tolerance', () => {
    expect(DIFFICULTY_PRESETS.beginner.directionTolerance)
      .toBeLessThan(DIFFICULTY_PRESETS.intermediate.directionTolerance);
    expect(DIFFICULTY_PRESETS.intermediate.directionTolerance)
      .toBeLessThan(DIFFICULTY_PRESETS.expert.directionTolerance);
  });

  it('beginner requires brighter waypoints', () => {
    expect(DIFFICULTY_PRESETS.beginner.minWaypointMag)
      .toBeLessThan(DIFFICULTY_PRESETS.intermediate.minWaypointMag);
  });
});

// ─── Phase 4: Integration Tests with Real Catalog Data ──────

describe('integration: route planning with real catalogs', () => {
  let stars: SkyNode[];
  let targets: SkyNode[];

  beforeAll(() => {
    const catalogs = loadTestCatalogs();
    stars = catalogs.stars;
    targets = catalogs.targets;
  });

  it('loads catalogs successfully', () => {
    expect(stars.length).toBeGreaterThan(9000);
    expect(targets.length).toBeGreaterThan(100);
  });

  it('finds well-known stars by name', () => {
    const vega = findStar(stars, 'Vega');
    expect(vega.mag).toBeCloseTo(0.03, 1);
    expect(vega.ra).toBeCloseTo(279.2, 0);

    const altair = findStar(stars, 'Altair');
    expect(altair.mag).toBeCloseTo(0.77, 1);
  });

  // ─── Raw A* path tests (same path for all difficulties) ──

  describe('raw A* paths', () => {
    it('Vega → Albireo (3.7° FOV): finds short path through Lyra', () => {
      const vega = findStar(stars, 'Vega');
      const albireo = findTarget(targets, 'DS-Albireo');
      const path = variableReachAStar(vega, albireo, stars, 3.7, 'expert');
      expect(path).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(5); // much fewer than old algorithm's 9
    });

    it('Vega → M57 (5° FOV): direct or 1 hop', () => {
      const vega = findStar(stars, 'Vega');
      const m57 = findTarget(targets, 'M57');
      const path = variableReachAStar(vega, m57, stars, 5, 'expert');
      expect(path).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(3);
    });

    it('Alpheratz → M31 (5° FOV): short path', () => {
      const alpheratz = findStar(stars, 'Alpheratz');
      const m31 = findTarget(targets, 'M31');
      const path = variableReachAStar(alpheratz, m31, stars, 5, 'expert');
      expect(path).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(4);
    });

    it('Vega → M13 (5° FOV): finds route', () => {
      const vega = findStar(stars, 'Vega');
      const m13 = findTarget(targets, 'M13');
      const path = variableReachAStar(vega, m13, stars, 5, 'expert');
      expect(path).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(5);
    });

    it('Altair → M27 (5° FOV): direct', () => {
      const altair = findStar(stars, 'Altair');
      const m27 = findTarget(targets, 'M27');
      const path = variableReachAStar(altair, m27, stars, 5, 'expert');
      expect(path).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── planRoute with difficulty levels ─────────────────────

  describe('planRoute: Vega → Albireo (3.7° FOV)', () => {
    it('beginner produces strictly more waypoints than expert', () => {
      const vega = findStar(stars, 'Vega');
      const albireo = findTarget(targets, 'DS-Albireo');
      const fov = 3.7;

      const expert = planRoute(vega, albireo, stars, fov, 'expert');
      const beginner = planRoute(vega, albireo, stars, fov, 'beginner');

      expect(expert).not.toBeNull();
      expect(beginner).not.toBeNull();
      // Beginner routes through more intermediate waypoints (e.g. Sheliak)
      // Expert takes the shorter path (e.g. Vega → Sulafat → Albireo)
      expect(beginner!.path.length).toBeGreaterThan(expert!.path.length);
    });
  });

  describe('planRoute: Vega → M57 (5° FOV)', () => {
    it('expert: 1-2 waypoints', () => {
      const vega = findStar(stars, 'Vega');
      const m57 = findTarget(targets, 'M57');
      const result = planRoute(vega, m57, stars, 5, 'expert');
      expect(result).not.toBeNull();
      expect(result!.path.length).toBeLessThanOrEqual(3);
    });
  });

  describe('planRoute: Alpheratz → M31 (5° FOV)', () => {
    it('expert: short route', () => {
      const alpheratz = findStar(stars, 'Alpheratz');
      const m31 = findTarget(targets, 'M31');
      const result = planRoute(alpheratz, m31, stars, 5, 'expert');
      expect(result).not.toBeNull();
      expect(result!.path.length).toBeLessThanOrEqual(3);
    });
  });

  describe('planRoute: Vega → M13 (5° FOV)', () => {
    it('expert: short route', () => {
      const vega = findStar(stars, 'Vega');
      const m13 = findTarget(targets, 'M13');
      const result = planRoute(vega, m13, stars, 5, 'expert');
      expect(result).not.toBeNull();
      expect(result!.path.length).toBeLessThanOrEqual(4);
    });

    it('beginner has more waypoints than expert', () => {
      const vega = findStar(stars, 'Vega');
      const m13 = findTarget(targets, 'M13');
      const fov = 5;

      const expert = planRoute(vega, m13, stars, fov, 'expert');
      const beginner = planRoute(vega, m13, stars, fov, 'beginner');

      expect(expert).not.toBeNull();
      expect(beginner).not.toBeNull();
      expect(expert!.path.length).toBeLessThanOrEqual(beginner!.path.length);
    });
  });

  describe('planRoute: Altair → M27 (5° FOV)', () => {
    it('expert: direct or 1 hop', () => {
      const altair = findStar(stars, 'Altair');
      const m27 = findTarget(targets, 'M27');
      const result = planRoute(altair, m27, stars, 5, 'expert');
      expect(result).not.toBeNull();
      expect(result!.path.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── Difficulty-aware A*: beginner prefers shorter hops ──
  describe('difficulty-aware A*: beginner routes through more intermediates', () => {
    it('Altair → M27: beginner finds longer path than expert', () => {
      const altair = findStar(stars, 'Altair');
      const m27 = findTarget(targets, 'M27');
      const fov = 5;

      const expertPath = variableReachAStar(altair, m27, stars, fov, 'expert');
      const beginnerPath = variableReachAStar(altair, m27, stars, fov, 'beginner');

      expect(expertPath).not.toBeNull();
      expect(beginnerPath).not.toBeNull();
      // Expert goes direct; beginner routes through bright intermediates
      expect(beginnerPath!.length).toBeGreaterThan(expertPath!.length);
    });

    it('Alpheratz → M31: beginner finds longer path than expert', () => {
      const alpheratz = findStar(stars, 'Alpheratz');
      const m31 = findTarget(targets, 'M31');
      const fov = 5;

      const expertPath = variableReachAStar(alpheratz, m31, stars, fov, 'expert');
      const beginnerPath = variableReachAStar(alpheratz, m31, stars, fov, 'beginner');

      expect(expertPath).not.toBeNull();
      expect(beginnerPath).not.toBeNull();
      expect(beginnerPath!.length).toBeGreaterThan(expertPath!.length);
    });
  });

  // ─── Cross-difficulty invariants ────────────────────────
  describe('difficulty invariants', () => {
    it('all difficulty levels find a route for every test case', () => {
      const routes = [
        { start: findStar(stars, 'Vega'), goal: findTarget(targets, 'DS-Albireo'), fov: 3.7 },
        { start: findStar(stars, 'Vega'), goal: findTarget(targets, 'M57'), fov: 5 },
        { start: findStar(stars, 'Alpheratz'), goal: findTarget(targets, 'M31'), fov: 5 },
        { start: findStar(stars, 'Vega'), goal: findTarget(targets, 'M13'), fov: 5 },
        { start: findStar(stars, 'Altair'), goal: findTarget(targets, 'M27'), fov: 5 },
      ];

      for (const { start, goal, fov } of routes) {
        for (const level of ['beginner', 'intermediate', 'expert'] as DifficultyLevel[]) {
          const result = planRoute(start, goal, stars, fov, level);
          expect(result, `${level}: ${start.name}→${goal.name} should find route`).not.toBeNull();
        }
      }
    });

    it('expert always produces fewer or equal waypoints than beginner', () => {
      const routes = [
        { start: findStar(stars, 'Vega'), goal: findTarget(targets, 'DS-Albireo'), fov: 3.7 },
        { start: findStar(stars, 'Vega'), goal: findTarget(targets, 'M13'), fov: 5 },
        { start: findStar(stars, 'Altair'), goal: findTarget(targets, 'M27'), fov: 5 },
      ];

      for (const { start, goal, fov } of routes) {
        const expert = planRoute(start, goal, stars, fov, 'expert');
        const beginner = planRoute(start, goal, stars, fov, 'beginner');
        expect(expert).not.toBeNull();
        expect(beginner).not.toBeNull();
        expect(expert!.path.length).toBeLessThanOrEqual(beginner!.path.length);
      }
    });
  });
});
