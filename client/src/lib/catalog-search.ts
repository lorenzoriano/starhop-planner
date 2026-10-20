import type { UnifiedTarget } from "./astronomy";
import { normalizeStellarWords } from "./stellar-search";

const commonAliases: Record<string, string[]> = {
  M42: ["Orion Nebula"],
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

function distanceAtMostTwo(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > 2) return false;
    previous = current;
  }
  return previous[b.length] <= 2;
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

  const haystack = [...ids, ...names, ...aliases, normalizedSearch(`${target.category} ${extra}`)];
  if (haystack.some(value => value.includes(q))) return 4;

  const queryTokens = q.split(/[^a-z0-9α-ω]+/i).filter(Boolean);
  const targetTokens = Array.from(new Set(haystack.join(" ").split(/[^a-z0-9α-ω]+/i).filter(Boolean)));
  if (queryTokens.length && queryTokens.every(token => targetTokens.some(candidate =>
    token === candidate || token.length >= 5 && candidate.length >= 5 && distanceAtMostTwo(token, candidate)))) return 5;
  return Infinity;
}

/** Message shown when a user searches for a planet that the deep-sky catalog does not contain. */
export function unsupportedPlanetMessage(query: string) {
  const q = normalizedSearch(query);
  return planets.has(q) ? `${q[0].toUpperCase()}${q.slice(1)} is a planet and is not included in this deep-sky catalog.` : undefined;
}

/** Lunar landmarks are browsed in the Moon view rather than among deep-sky targets. */
export function lunarSearchHint(query: string) {
  return /\b(moon|lunar|mare|crater|apollo|tycho|copernicus|clavius|kepler)\b/i.test(query)
    ? "Looking for lunar features? Browse the Moon tab."
    : undefined;
}
