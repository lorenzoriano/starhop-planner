import type { UnifiedTarget } from "./astronomy";
import { normalizeStellarWords } from "./stellar-search";

const commonAliases: Record<string, string[]> = {
  M31: ["Andromeda Galaxy", "Great Andromeda Galaxy"],
  M42: ["Orion Nebula", "Great Orion Nebula", "Great Nebula in Orion"],
  M44: ["Beehive Cluster", "Praesepe"],
  M8: ["Lagoon Nebula"],
  M17: ["Swan Nebula", "Omega Nebula"],
  M20: ["Trifid Nebula"],
  M27: ["Dumbbell Nebula"],
  M57: ["Ring Nebula"],
  M13: ["Hercules Cluster"],
  NGC457: ["Owl Cluster", "ET Cluster", "E.T. Cluster", "Phi Cassiopeiae Cluster", "Caldwell 13", "C 13"],
  "AST-Coathanger": ["Brocchi", "Brocchi's Cluster", "Collinder 399", "Cr 399"],
  NGC869: ["h Persei"],
  NGC884: ["chi Persei"],
  M45: ["Seven Sisters", "Pleiades"],
};

const planets = new Set(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]);

export function normalizedSearch(value: string) {
  return normalizeStellarWords(value.trim().toLowerCase())
    .replace(/\bmessier\s*(\d+)/g, "m$1")
    .replace(/\b(m|ngc|ic|hr|cr)\s+(\d+)/g, "$1$2")
    .replace(/\s+/g, " ");
}

function editDistanceAtMostTwo(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return Infinity;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > 2) return Infinity;
    previous = current;
  }
  return previous[b.length] <= 2 ? previous[b.length] : Infinity;
}

function aliasesFor(target: UnifiedTarget) {
  return [...(target.aliases ?? []), ...(commonAliases[target.id] ?? [])].map(normalizedSearch);
}

/** Exact catalog identifiers win; fuzzy spelling is kept below names and aliases. */
export function catalogSearchScore(target: UnifiedTarget, query: string, extra = "") {
  const q = normalizedSearch(query);
  if (!q) return 0;
  const id = normalizedSearch(target.id);
  const ids = [id, ...(target.aliases ?? []).map(normalizedSearch)];
  const names = [target.name, target.displayName].map(normalizedSearch);
  const aliases = aliasesFor(target);

  if (ids.includes(q)) return 0;
  // A bare planet name is an exact request for a planet, so avoid returning a
  // deep-sky object whose name merely begins with that word.
  if (planets.has(q)) return Infinity;
  if (names.includes(q) || aliases.includes(q)) return 1;
  if (ids.some(value => value.startsWith(q))) return 2;
  if ([...names, ...aliases].some(value => value.startsWith(q))) return 3;

  const identity = [...ids, ...names, ...aliases];
  const haystack = [...identity, normalizedSearch(`${target.category} ${extra}`)];
  if (identity.some(value => value.includes(q))) return 4;
  if (haystack.some(value => value.includes(q))) return 5;

  const queryTokens = q.split(/[^a-z0-9α-ω]+/i).filter(Boolean);
  const targetTokens = Array.from(new Set(haystack.join(" ").split(/[^a-z0-9α-ω]+/i).filter(Boolean)));
  // Stellar aliases include expanded constellation genitives (for example,
  // `10 Andromedae`). Fuzzy matching those makes a misspelled object name
  // return every star in that constellation. Keep stellar typo matching on
  // the displayed name; exact aliases and designations still work above.
  const fuzzyIdentity = target.category === "Star" ? names : identity;
  const identityTokens = Array.from(new Set(fuzzyIdentity.join(" ").split(/[^a-z0-9α-ω]+/i).filter(Boolean)));
  if (queryTokens.length) {
    const distances = queryTokens.map(token => Math.min(...identityTokens.map(candidate =>
      token === candidate ? 0 : token.length >= 5 && candidate.length >= 5 ? editDistanceAtMostTwo(token, candidate) : Infinity)));
    if (distances.every(Number.isFinite)) return 5 + distances.reduce((sum, value) => sum + value, 0) / 100;
  }
  // Constellation context may help an exact search, but should not turn a typo
  // for an object name into a list of unrelated stars in that constellation.
  if (queryTokens.length && queryTokens.every(token => targetTokens.some(candidate => token === candidate))) return 6;
  return Infinity;
}

export type CatalogSearchMatch = { target: UnifiedTarget; score: number };
export type CatalogSearchDiagnostics = {
  kind: "matches" | "filtered" | "unsupported-planet" | "lunar" | "no-match";
  matches: CatalogSearchMatch[];
  visibleMatches: CatalogSearchMatch[];
  message: string;
};

type SkyVector = readonly [number, number, number];
function skyVector(target: UnifiedTarget): SkyVector {
  const radians = Math.PI / 180, dec = target.dec * radians, ra = target.ra * radians;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}
function skyBucket(vector: SkyVector, size: number) {
  return vector.map(value => Math.floor(value / size)).join(":");
}
function skyBucketKey(x: number, y: number, z: number) { return `${x}:${y}:${z}`; }

const radiansPerDegree = Math.PI / 180;
const starChord = 2 * Math.sin((0.02 * radiansPerDegree) / 2);
const catalogChord = 2 * Math.sin((0.002 * radiansPerDegree) / 2);

function withinChord(a: SkyVector, b: SkyVector, limit: number) {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z < limit * limit;
}

function neighboringMatches<T>(buckets: Map<string, T[]>, vector: SkyVector, cellSize: number) {
  const x = Math.floor(vector[0] / cellSize), y = Math.floor(vector[1] / cellSize), z = Math.floor(vector[2] / cellSize);
  const neighbors: T[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const bucket = buckets.get(skyBucketKey(x + dx, y + dy, z + dz));
    if (bucket) neighbors.push(...bucket);
  }
  return neighbors;
}

/** Collapse multiple catalog rows that describe the same physical target. */
export function deduplicateCatalogMatches(matches: readonly CatalogSearchMatch[]) {
  const unique: CatalogSearchMatch[] = [];
  type IndexedMatch = { vector: SkyVector; match: CatalogSearchMatch };
  const stars = new Map<string, Map<string, IndexedMatch[]>>();
  const objects = new Map<string, Map<string, IndexedMatch[]>>();
  for (const match of matches) {
    const star = match.target.category === "Star";
    const vector = skyVector(match.target), cellSize = star ? starChord : catalogChord;
    const buckets = star ? stars : objects;
    const categoryKey = star ? "Star" : match.target.category;
    let categoryBuckets = buckets.get(categoryKey);
    if (!categoryBuckets) { categoryBuckets = new Map(); buckets.set(categoryKey, categoryBuckets); }
    const bucketKey = skyBucket(vector, cellSize);
    const currentBucket = categoryBuckets.get(bucketKey) ?? [];
    const candidates = neighboringMatches(categoryBuckets, vector, cellSize);
    const names=new Set([match.target.name,...(match.target.aliases??[])].map(normalizedSearch));
    const duplicateStar = star && candidates.some(other => withinChord(vector, other.vector, starChord)
      && (match.target.id===other.match.target.id||[other.match.target.name,...(other.match.target.aliases??[])].some(name=>names.has(normalizedSearch(name)))));
    const aliases = new Set(match.target.aliases ?? []);
    const duplicateCatalogObject = !star && candidates.some(other => withinChord(vector, other.vector, catalogChord)
      && (other.match.target.aliases ?? []).some(alias => aliases.has(alias)));
    if (!duplicateStar && !duplicateCatalogObject) {
      unique.push(match);
      currentBucket.push({ vector, match });
      categoryBuckets.set(bucketKey, currentBucket);
    }
  }
  return unique;
}

/** Search the full collection and explain whether active filters hid a match. */
export function catalogSearchDiagnostics(
  query: string,
  allTargets: readonly UnifiedTarget[],
  visibleTargets: readonly UnifiedTarget[] = allTargets,
): CatalogSearchDiagnostics {
  const q = query.trim();
  if (!q) return { kind: "no-match", matches: [], visibleMatches: [], message: "Enter a name or catalog designation to search." };
  const ranked = (targets: readonly UnifiedTarget[]) => deduplicateCatalogMatches(targets
    .map(target => ({ target, score: catalogSearchScore(target, query) }))
    .filter(match => Number.isFinite(match.score))
    .sort((a, b) => a.score - b.score || a.target.name.localeCompare(b.target.name)));
  const matches = ranked(allTargets);
  const visibleMatches = ranked(visibleTargets);
  if (visibleMatches.length) return { kind: "matches", matches, visibleMatches, message: `${visibleMatches.length} matching ${visibleMatches.length === 1 ? "object" : "objects"}.` };
  if (matches.length) return { kind: "filtered", matches, visibleMatches, message: `${matches[0].target.name} matches your search but is hidden by the current filters.` };
  const planet = unsupportedPlanetMessage(query);
  if (planet) return { kind: "unsupported-planet", matches, visibleMatches, message: planet };
  const lunar = lunarSearchHint(query);
  if (lunar) return { kind: "lunar", matches, visibleMatches, message: lunar };
  return { kind: "no-match", matches, visibleMatches, message: `No catalog object matches “${query.trim()}”. Try another name or designation.` };
}

/** Message shown when a user searches for a planet that the deep-sky catalog does not contain. */
export function unsupportedPlanetMessage(query: string) {
  const q = normalizedSearch(query);
  return planets.has(q) ? `${q[0].toUpperCase()}${q.slice(1)} is a planet and is not included in this deep-sky catalog.` : undefined;
}

/** Lunar landmarks are browsed in the Moon view rather than among deep-sky targets. */
export function lunarSearchHint(query: string) {
  return /\b(moon|lunar|mare|crater|apollo|tycho|copernicus|clavius|kepler)\b/i.test(query)
    ? "Lunar landmarks are listed separately from deep-sky objects."
    : undefined;
}
