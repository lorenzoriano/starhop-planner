/**
 * Variable-Reach A* with Instruction Compression
 *
 * New star-hopping algorithm that produces human-like routes by:
 * 1. Using brightness-dependent reach (bright stars visible from further away)
 * 2. A* pathfinding with instruction-count cost model
 * 3. Post-process compression merging direction-consistent hops
 * 4. Three difficulty levels (beginner / intermediate / expert)
 */
import { angularDistance } from './astronomy';
import type { SkyNode } from './astronomy';
import type { CostStrategy, CostContext } from './cost-strategies';

// ─── Types ───────────────────────────────────────────────────

export type DifficultyLevel = 'beginner' | 'intermediate' | 'expert';

export interface DifficultyParams {
  /** Max sweep distance as multiple of FOV (for compression) */
  maxSweepFovRatio: number;
  /** Multiplier on maxReach — lower = shorter hops */
  reachMultiplier: number;
  /** Faintest magnitude allowed as waypoint */
  minWaypointMag: number;
  /** Max direction change (degrees) to merge hops */
  directionTolerance: number;
  /** Faintest mag for a compression endpoint star */
  compressEndpointMinMag: number;
}

export interface PathNode {
  id: string;
  ra: number;
  dec: number;
  mag: number;
  name: string;
  named: boolean;
}

export interface CompressedHop {
  from: PathNode;
  to: PathNode;
  intermediates: PathNode[];
  distanceDeg: number;
  direction: string;
}

// ─── Difficulty Presets ──────────────────────────────────────

export const DIFFICULTY_PRESETS: Record<DifficultyLevel, DifficultyParams> = {
  beginner: {
    maxSweepFovRatio: 1.5,
    reachMultiplier: 0.85,
    minWaypointMag: 5.0,
    directionTolerance: 25,
    compressEndpointMinMag: 4.5,  // break at bright landmarks (mag <= 4.5)
  },
  intermediate: {
    maxSweepFovRatio: 2.5,
    reachMultiplier: 1.0,
    minWaypointMag: 6.0,
    directionTolerance: 40,
    compressEndpointMinMag: 2.5,  // only break at very bright stars
  },
  expert: {
    maxSweepFovRatio: 3.5,
    reachMultiplier: 1.2,
    minWaypointMag: 7.0,
    directionTolerance: 55,
    compressEndpointMinMag: -1,   // never break at landmarks (compression only by direction/distance)
  },
};

// ─── Pure Functions ──────────────────────────────────────────

/**
 * Brightness-dependent maximum reach distance.
 * Bright stars can be found from further away because they're easier to spot.
 */
export function maxReach(mag: number, fov: number, named: boolean): number {
  const base = fov * (0.7 + Math.max(0, (7 - mag) / 2.2));
  return named ? base : base * 0.7;
}

/**
 * Edge cost based on instruction count model.
 * Each hop costs base ~1.0 plus penalties for difficulty.
 */
export function edgeCost(dist: number, destMag: number, destNamed: boolean, fov: number): number {
  let cost = 1.0;
  // Distance penalty relative to FOV
  cost += (dist / fov) * 0.12;
  // Dim destination penalty
  if (destMag > 3.5) cost += (destMag - 3.5) * 0.08;
  // Unnamed star penalty
  if (!destNamed) cost += 0.15;
  // Near-reach-edge penalty (risky hop)
  const reach = maxReach(destMag, fov, destNamed);
  if (reach > 0) {
    const reachRatio = dist / reach;
    if (reachRatio > 0.7) cost += (reachRatio - 0.7) * 0.8;
  }
  return cost;
}

/**
 * Bearing angle between two celestial positions in degrees.
 * 0° = north (increasing Dec), 90° = east (increasing RA),
 * 180° = south, 270° = west.
 */
export function directionAngle(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const d1 = dec1 * toRad;
  const d2 = dec2 * toRad;
  let dra = (ra2 - ra1) * toRad;
  // Normalize to [-π, π]
  while (dra > Math.PI) dra -= 2 * Math.PI;
  while (dra < -Math.PI) dra += 2 * Math.PI;

  // Position angle formula (like compass bearing on celestial sphere)
  const x = Math.sin(dra) * Math.cos(d2);
  const y = Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(dra);

  let angle = Math.atan2(x, y) / toRad; // atan2(east, north)
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Angular difference between two bearings, always 0-180°.
 */
function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Compass direction string from bearing angle.
 */
function bearingToDirection(angle: number): string {
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const idx = Math.round(angle / 45) % 8;
  return dirs[idx];
}

/**
 * Compress a path by merging consecutive direction-consistent hops.
 * Returns compressed hops (fewer instructions for the observer).
 */
export function compressInstructions(
  path: PathNode[],
  params: DifficultyParams,
  fov: number,
): CompressedHop[] {
  if (path.length < 2) return [];

  const hops: CompressedHop[] = [];
  let segStart = 0;

  for (let i = 1; i < path.length; i++) {
    const isLast = i === path.length - 1;

    // Check if we should break the segment here
    let shouldBreak = isLast;

    if (!shouldBreak && i + 1 < path.length) {
      // Direction of current hop vs next hop
      const dirCurr = directionAngle(path[i - 1].ra, path[i - 1].dec, path[i].ra, path[i].dec);
      const dirNext = directionAngle(path[i].ra, path[i].dec, path[i + 1].ra, path[i + 1].dec);
      const dirChange = angleDiff(dirCurr, dirNext);

      if (dirChange > params.directionTolerance) {
        shouldBreak = true;
      }

      // Check if total sweep distance exceeds max
      const sweepDist = angularDistance(path[segStart].ra, path[segStart].dec, path[i + 1].ra, path[i + 1].dec);
      if (sweepDist > fov * params.maxSweepFovRatio) {
        shouldBreak = true;
      }

      // In beginner mode, break at bright stars (they're good landmarks)
      if (path[i].mag <= params.compressEndpointMinMag && path[i].named) {
        shouldBreak = true;
      }
    }

    if (shouldBreak) {
      const from = path[segStart];
      const to = path[i];
      const intermediates = [];
      for (let j = segStart + 1; j < i; j++) {
        intermediates.push(path[j]);
      }
      hops.push({
        from,
        to,
        intermediates,
        distanceDeg: angularDistance(from.ra, from.dec, to.ra, to.dec),
        direction: bearingToDirection(directionAngle(from.ra, from.dec, to.ra, to.dec)),
      });
      segStart = i;
    }
  }

  return hops;
}

// ─── Spatial Index ───────────────────────────────────────────

const CELL_SIZE = 5; // degrees

interface SpatialGrid {
  cells: Map<string, SkyNode[]>;
}

function cellKey(ra: number, dec: number): string {
  const raBucket = Math.floor(ra / CELL_SIZE);
  const decBucket = Math.floor((dec + 90) / CELL_SIZE);
  return `${raBucket},${decBucket}`;
}

function buildSpatialGrid(stars: SkyNode[]): SpatialGrid {
  const cells = new Map<string, SkyNode[]>();
  for (const star of stars) {
    const key = cellKey(star.ra, star.dec);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(star);
  }
  return { cells };
}

function getNeighborCandidates(grid: SpatialGrid, ra: number, dec: number, radius: number): SkyNode[] {
  const candidates: SkyNode[] = [];
  const raBuckets = Math.ceil(radius / CELL_SIZE) + 1;
  const decBuckets = Math.ceil(radius / CELL_SIZE) + 1;
  const centerRaBucket = Math.floor(ra / CELL_SIZE);
  const centerDecBucket = Math.floor((dec + 90) / CELL_SIZE);

  for (let dr = -raBuckets; dr <= raBuckets; dr++) {
    for (let dd = -decBuckets; dd <= decBuckets; dd++) {
      let raBucket = centerRaBucket + dr;
      // RA wraps around
      const maxRaBucket = Math.ceil(360 / CELL_SIZE);
      if (raBucket < 0) raBucket += maxRaBucket;
      if (raBucket >= maxRaBucket) raBucket -= maxRaBucket;

      const decBucket = centerDecBucket + dd;
      if (decBucket < 0 || decBucket >= Math.ceil(180 / CELL_SIZE)) continue;

      const key = `${raBucket},${decBucket}`;
      const bucket = grid.cells.get(key);
      if (bucket) {
        candidates.push(...bucket);
      }
    }
  }

  return candidates;
}

// ─── A* Pathfinder ───────────────────────────────────────────

interface AStarNode {
  id: string;
  g: number;     // cost so far
  f: number;     // g + h (estimated total)
  parent: string | null;
}

/**
 * Variable-Reach A* pathfinding.
 * Returns array of SkyNodes from start to goal, or null if no path found.
 */
export function variableReachAStar(
  start: SkyNode,
  goal: SkyNode,
  stars: SkyNode[],
  fov: number,
  difficulty: DifficultyLevel,
  costStrategy?: CostStrategy,
  costContext?: CostContext,
): SkyNode[] | null {
  // Graph connectivity uses full reach so all difficulty levels can find a route.
  // Difficulty affects hop cost: beginners prefer shorter hops (soft penalty),
  // which makes A* route through more intermediate waypoints.
  const MAX_WAYPOINT_MAG = 7.0;
  const params = DIFFICULTY_PRESETS[difficulty];

  const allNodes = new Map<string, SkyNode>();
  for (const s of stars) {
    if (s.mag <= MAX_WAYPOINT_MAG || s.id === start.id || s.id === goal.id) {
      allNodes.set(s.id, s);
    }
  }
  allNodes.set(start.id, start);
  allNodes.set(goal.id, goal);

  // Remove stars that duplicate the goal (e.g., BSC Albireo vs DS-Albireo target)
  allNodes.forEach((node, id) => {
    if (id !== goal.id && id !== start.id &&
        angularDistance(node.ra, node.dec, goal.ra, goal.dec) < 0.05) {
      allNodes.delete(id);
    }
  });

  // Build spatial grid from eligible nodes
  const grid = buildSpatialGrid(Array.from(allNodes.values()));

  // Best possible reach (for admissible heuristic)
  const bestReach = maxReach(0, fov, true);

  // Heuristic: optimistic estimate of remaining hops
  function heuristic(node: SkyNode): number {
    if (costStrategy) {
      return costStrategy.heuristic(node, goal, fov);
    }
    const dist = angularDistance(node.ra, node.dec, goal.ra, goal.dec);
    return (dist / (bestReach * 1.2)) * 0.9;
  }

  // A* open set (using array as priority queue — good enough for ~9000 nodes)
  const open: AStarNode[] = [{ id: start.id, g: 0, f: heuristic(start), parent: null }];
  const closed = new Set<string>();
  const best = new Map<string, AStarNode>();
  best.set(start.id, open[0]);

  while (open.length > 0) {
    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open.splice(bestIdx, 1);

    if (current.id === goal.id) {
      // Reconstruct path
      const path: SkyNode[] = [];
      let nodeId: string | null = current.id;
      while (nodeId !== null) {
        path.unshift(allNodes.get(nodeId)!);
        nodeId = best.get(nodeId)?.parent ?? null;
      }
      return path;
    }

    if (closed.has(current.id)) continue;
    closed.add(current.id);

    const currentNode = allNodes.get(current.id)!;

    // Max reach from current position — depends on what we can see
    const searchRadius = bestReach;

    // Get neighbor candidates from spatial grid
    const candidates = getNeighborCandidates(grid, currentNode.ra, currentNode.dec, searchRadius);

    for (const neighbor of candidates) {
      if (neighbor.id === current.id) continue;
      if (closed.has(neighbor.id)) continue;

      const dist = angularDistance(currentNode.ra, currentNode.dec, neighbor.ra, neighbor.dec);
      const isNamed = neighbor.name !== '';
      const isGoal = neighbor.id === goal.id;

      // Reach check: for the goal (possibly dim DSO), use source-based reach
      // (you navigate to the area, then find the target relative to nearby stars)
      let reach: number;
      if (isGoal) {
        // Last-hop rule: can reach goal within current star's FOV reach or 2× FOV
        reach = Math.max(
          maxReach(currentNode.mag, fov, currentNode.name !== ''),
          fov * 2.0
        );
      } else {
        reach = maxReach(neighbor.mag, fov, isNamed);
      }

      if (dist > reach) continue;
      if (!isGoal && neighbor.mag > MAX_WAYPOINT_MAG) continue;

      let hopCost: number;
      if (costStrategy && costContext) {
        hopCost = costStrategy.edgeCost(currentNode, neighbor, dist, fov, costContext);
      } else {
        // Legacy cost function (backward compatible when no strategy provided)
        hopCost = isGoal
          ? edgeCost(dist, currentNode.mag, currentNode.name !== '', fov)
          : edgeCost(dist, neighbor.mag, isNamed, fov);

        const distFov = dist / fov;
        const comfortThreshold = 1.0 + (params.reachMultiplier - 0.7) * 3.0;
        if (distFov > comfortThreshold) {
          const excess = distFov - comfortThreshold;
          hopCost += excess * excess * 3.0;
        }

        if (!isGoal && neighbor.mag > params.minWaypointMag) {
          hopCost += (neighbor.mag - params.minWaypointMag) * 0.3;
        }
      }

      const g = current.g + hopCost;
      const existing = best.get(neighbor.id);

      if (!existing || g < existing.g) {
        const node: AStarNode = {
          id: neighbor.id,
          g,
          f: g + heuristic(neighbor),
          parent: current.id,
        };
        best.set(neighbor.id, node);
        open.push(node);
      }
    }
  }

  return null; // No path found
}

/**
 * Plan a complete route with difficulty-based compression.
 * Returns the waypoints the observer should stop at (compressed path).
 * This is the main entry point for route planning.
 */
export function planRoute(
  start: SkyNode,
  goal: SkyNode,
  stars: SkyNode[],
  fov: number,
  difficulty: DifficultyLevel,
  costStrategy?: CostStrategy,
  costContext?: CostContext,
): { path: SkyNode[]; compressed: CompressedHop[] } | null {
  const rawPath = variableReachAStar(start, goal, stars, fov, difficulty, costStrategy, costContext);
  if (!rawPath) return null;

  const params = DIFFICULTY_PRESETS[difficulty];

  // Convert SkyNodes to PathNodes for compression
  const pathNodes: PathNode[] = rawPath.map(n => ({
    id: n.id,
    ra: n.ra,
    dec: n.dec,
    mag: n.mag,
    name: n.name,
    named: n.name !== '',
  }));

  const compressed = compressInstructions(pathNodes, params, fov);

  // Extract the waypoints from compressed hops (start + each hop endpoint)
  const waypoints: SkyNode[] = [rawPath[0]];
  for (const hop of compressed) {
    const node = rawPath.find(n => n.id === hop.to.id);
    if (node) waypoints.push(node);
  }

  return { path: waypoints, compressed };
}
