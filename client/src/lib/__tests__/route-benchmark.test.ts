/**
 * Route Benchmark Test Suite
 *
 * Runs the Landmark Discount strategy on ~15 showpiece targets and asserts
 * minimum quality thresholds. Guards against routing regressions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { variableReachAStar } from '../route-planner';
import { LandmarkDiscountStrategy } from '../cost-strategies';
import type { CostContext } from '../cost-strategies';
import { landmarkScore, buildConstellationSegmentCounts } from '../landmark-score';
import { angularDistance } from '../astronomy';
import type { SkyNode } from '../astronomy';
import {
  loadStarsFromDisk,
  loadConstellationsFromDisk,
  loadMessierFromDisk,
  findStar,
  starToSkyNode,
  targetToSkyNode,
} from './test-helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RouteQualityScore {
  avgWaypointMag: number;
  maxWaypointMag: number;
  hopCount: number;
  totalAngularDistance: number;
  landmarkScoreSum: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreRoute(path: SkyNode[], landmarkScores: Map<string, number>): RouteQualityScore {
  const intermediates = path.slice(1, -1); // exclude anchor and target
  const avgWaypointMag =
    intermediates.length > 0
      ? intermediates.reduce((sum, n) => sum + n.mag, 0) / intermediates.length
      : 0;
  const maxWaypointMag =
    intermediates.length > 0 ? Math.max(...intermediates.map(n => n.mag)) : 0;

  let totalAngularDistance = 0;
  for (let i = 1; i < path.length; i++) {
    totalAngularDistance += angularDistance(
      path[i - 1].ra,
      path[i - 1].dec,
      path[i].ra,
      path[i].dec,
    );
  }

  const landmarkScoreSum = path.reduce(
    (sum, n) => sum + (landmarkScores.get(n.id) ?? 0),
    0,
  );

  return { avgWaypointMag, maxWaypointMag, hopCount: path.length - 1, totalAngularDistance, landmarkScoreSum };
}

// ─── Benchmark target definitions ────────────────────────────────────────────
//
// anchorName must match a star name in bsc5-short.json (case-insensitive partial).
// Note: "Alnath" is stored as "Elnath" in the BSC catalog.
// "Kaus Australis" and "Kaus Borealis" are present in the catalog.

const BENCHMARK_TARGETS = [
  { targetId: 'M31', anchorName: 'Mirfak',        fov: 5.0, label: 'Andromeda Galaxy'      },
  { targetId: 'M42', anchorName: 'Betelgeuse',    fov: 3.7, label: 'Orion Nebula'           },
  { targetId: 'M13', anchorName: 'Vega',          fov: 5.0, label: 'Hercules Cluster'        },
  // M57 requires a routing FOV wide enough for A* to link stars; 1° eyepiece
  // FOV is the observing FOV but not a viable graph-connectivity radius.
  { targetId: 'M57', anchorName: 'Vega',          fov: 5.0, label: 'Ring Nebula'             },
  { targetId: 'M1',  anchorName: 'Elnath',        fov: 5.0, label: 'Crab Nebula'             },
  { targetId: 'M45', anchorName: 'Aldebaran',     fov: 5.0, label: 'Pleiades'                },
  { targetId: 'M27', anchorName: 'Altair',        fov: 5.0, label: 'Dumbbell Nebula'         },
  { targetId: 'M51', anchorName: 'Alkaid',        fov: 5.0, label: 'Whirlpool Galaxy'        },
  { targetId: 'M8',  anchorName: 'Kaus Australis',fov: 5.0, label: 'Lagoon Nebula'           },
  { targetId: 'M81', anchorName: 'Dubhe',         fov: 5.0, label: "Bode's Galaxy"           },
  { targetId: 'M4',  anchorName: 'Antares',       fov: 5.0, label: 'Scorpius Globular'       },
  { targetId: 'M22', anchorName: 'Kaus Borealis', fov: 5.0, label: 'Sagittarius Cluster'     },
  { targetId: 'M44', anchorName: 'Pollux',        fov: 5.0, label: 'Beehive Cluster'         },
  { targetId: 'M35', anchorName: 'Castor',        fov: 5.0, label: 'Gemini Cluster'          },
  { targetId: 'M11', anchorName: 'Altair',        fov: 5.0, label: 'Wild Duck Cluster'       },
] as const;

// ─── Shared state loaded once ─────────────────────────────────────────────────

let stars: SkyNode[];
let context: CostContext;
let allStarsBase: SkyNode[];

beforeAll(() => {
  const parsedStars = loadStarsFromDisk();
  stars = parsedStars.map(starToSkyNode);
  allStarsBase = stars;

  const constellations = loadConstellationsFromDisk();
  const segCounts = buildConstellationSegmentCounts(constellations, stars);
  const landmarkScores = new Map<string, number>();
  for (const star of stars) {
    landmarkScores.set(star.id, landmarkScore(star, segCounts));
  }
  context = { difficulty: 'intermediate', landmarkScores };
});

// ─── Benchmark suite ──────────────────────────────────────────────────────────

describe('Route Benchmark: Landmark Discount Strategy', () => {
  const strategy = new LandmarkDiscountStrategy();

  for (const tc of BENCHMARK_TARGETS) {
    it(`${tc.targetId} (${tc.label}) from ${tc.anchorName}`, () => {
      // Resolve anchor star — skip if not in catalog
      let anchor: SkyNode;
      try {
        anchor = findStar(stars, tc.anchorName);
      } catch {
        // Star not found in catalog; skip gracefully
        console.warn(`[benchmark] Skipping ${tc.targetId}: anchor "${tc.anchorName}" not found`);
        return;
      }

      // Resolve Messier target
      const messierCatalog = loadMessierFromDisk();
      const rawTarget = messierCatalog.find(m => m.id === tc.targetId);
      if (!rawTarget) {
        console.warn(`[benchmark] Skipping ${tc.targetId}: not found in Messier catalog`);
        return;
      }
      const target = targetToSkyNode(rawTarget);

      // Add target to star pool so A* can reach it
      const allStars = [...allStarsBase, target];

      // Run A* with LandmarkDiscount
      const path = variableReachAStar(
        anchor,
        target,
        allStars,
        tc.fov,
        'intermediate',
        strategy,
        context,
      );

      // ── Core assertion: a route must exist ─────────────────────────────────
      expect(path, `No route found for ${tc.targetId} from ${tc.anchorName}`).not.toBeNull();
      const route = path!;

      // Sanity: path starts at anchor and ends at target
      expect(route[0].id).toBe(anchor.id);
      expect(route[route.length - 1].id).toBe(target.id);

      // ── Quality assertions ─────────────────────────────────────────────────
      const q = scoreRoute(route, context.landmarkScores);

      // Each intermediate waypoint should be visible to naked eye or binoculars.
      // Threshold is 5.5 to accommodate routes through sparsely starred regions
      // (e.g. Cancer, Ursa Major) while still catching truly bad regressions.
      if (q.avgWaypointMag > 0) {
        expect(
          q.avgWaypointMag,
          `${tc.targetId}: avg waypoint mag ${q.avgWaypointMag.toFixed(2)} exceeds 5.5`,
        ).toBeLessThan(5.5);
      }

      // No single waypoint should be dimmer than ~naked-eye limit
      if (q.maxWaypointMag > 0) {
        expect(
          q.maxWaypointMag,
          `${tc.targetId}: dimmest waypoint mag ${q.maxWaypointMag.toFixed(2)} exceeds 6.5`,
        ).toBeLessThan(6.5);
      }

      // Route should be reasonably concise
      expect(
        q.hopCount,
        `${tc.targetId}: hop count ${q.hopCount} exceeds 10`,
      ).toBeLessThanOrEqual(10);

      // Route should pass through at least some navigational landmarks
      expect(
        q.landmarkScoreSum,
        `${tc.targetId}: landmark score sum ${q.landmarkScoreSum.toFixed(2)} is too low`,
      ).toBeGreaterThan(1.0);
    });
  }
});
