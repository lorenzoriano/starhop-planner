import { getConstellationName, type UnifiedTarget } from "./astronomy";
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

type SearchQuery = { text: string; tokens: string[] };
type SearchDocument = {
  ids: string[]; names: string[]; aliases: string[]; identity: string[];
  context: string; targetTokens: Set<string>; identityTokens: string[];
  scores: Map<string, number>;
};
const documents = new WeakMap<UnifiedTarget, Map<string, SearchDocument>>();
const queries = new Map<string, SearchQuery>();
function tokens(value: string) { return value.split(/[^a-z0-9α-ω]+/i).filter(Boolean); }
function searchQuery(query: string): SearchQuery {
  let cached=queries.get(query);
  if(cached)return cached;
  const text=normalizedSearch(query);
  cached={text,tokens:tokens(text)};
  if(queries.size>=64)queries.delete(queries.keys().next().value!);
  queries.set(query,cached);
  return cached;
}
function searchDocument(target: UnifiedTarget, extra = ""): SearchDocument {
  // Catalog rows are immutable. Normalize each row/context once, rather than
  // rebuilding aliases and fuzzy token lists for every character and sort call.
  const constellation=getConstellationName(target.con);
  const contextExtra=extra===constellation?"":extra;
  let variants=documents.get(target);
  if(!variants){variants=new Map();documents.set(target,variants);}
  const cached=variants.get(contextExtra);
  if(cached)return cached;
  const ids=[target.id,...(target.aliases??[])].map(normalizedSearch);
  const names=[target.name,target.displayName].map(normalizedSearch);
  const aliases=[...(target.aliases??[]),...(commonAliases[target.id]??[])].map(normalizedSearch);
  const identity=[...ids,...names,...aliases];
  const context=normalizedSearch(`${target.category} ${constellation} ${contextExtra}`);
  const document={ids,names,aliases,identity,context,
    targetTokens:new Set(tokens([...identity,context].join(" "))),
    identityTokens:Array.from(new Set(tokens((target.category==="Star"?names:identity).join(" ")))),scores:new Map<string,number>()};
  variants.set(contextExtra,document);
  return document;
}

/** Optional idle-time preparation for a collection that will be searched soon. */
export function prepareCatalogSearch(targets: readonly UnifiedTarget[]) {
  for(const target of targets)searchDocument(target);
}

/** Exact identifiers win; cached normalized rows keep repeated filtering cheap. */
export function catalogSearchScore(target: UnifiedTarget, query: string, extra = "") {
  const parsed=searchQuery(query),q=parsed.text;
  if(!q)return 0;
  const document=searchDocument(target,extra),cached=document.scores.get(q);
  if(cached!==undefined)return cached;
  const {ids,names,aliases,identity,context,targetTokens,identityTokens}=document;
  let score=Infinity;
  if(ids.includes(q))score=0;
  else if(planets.has(q))score=Infinity;
  else if(names.includes(q)||aliases.includes(q))score=1;
  else if(ids.some(value=>value.startsWith(q)))score=2;
  else if([...names,...aliases].some(value=>value.startsWith(q)))score=3;
  else if(identity.some(value=>value.includes(q)))score=4;
  else if(context.includes(q))score=5;
  else if(parsed.tokens.length){
    // Stellar typo matching deliberately excludes constellation aliases.
    let distance=0;
    for(const token of parsed.tokens){
      let best=Infinity;
      for(const candidate of identityTokens){
        const value=token===candidate?0:token.length>=5&&candidate.length>=5?editDistanceAtMostTwo(token,candidate):Infinity;
        if(value<best)best=value;
        if(best===0)break;
      }
      if(!Number.isFinite(best)){distance=Infinity;break;}
      distance+=best;
    }
    if(Number.isFinite(distance))score=5+distance/100;
    else if(parsed.tokens.every(token=>targetTokens.has(token)))score=6;
  }
  if(document.scores.size>=16)document.scores.delete(document.scores.keys().next().value!);
  document.scores.set(q,score);
  return score;
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
export function deduplicateCatalogMatches(matches: readonly CatalogSearchMatch[], limit = Infinity) {
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
      if(unique.length>=limit)break;
      currentBucket.push({ vector, match });
      categoryBuckets.set(bucketKey, currentBucket);
    }
  }
  return unique;
}

const rankedCollections = new WeakMap<readonly UnifiedTarget[], Map<string, CatalogSearchMatch[]>>();
/** One ranked, deduplicated search shared by suggestions and diagnostics. */
export function searchCatalog(targets: readonly UnifiedTarget[], query: string, limit = Infinity): CatalogSearchMatch[] {
  const q=searchQuery(query).text;
  if(!q)return [];
  let cache=rankedCollections.get(targets);
  if(!cache){cache=new Map();rankedCollections.set(targets,cache);}
  const cacheKey=`${limit}:${q}`;
  const cached=cache.get(cacheKey);
  if(cached)return cached;
  const matches=deduplicateCatalogMatches(targets.map(target=>({target,score:catalogSearchScore(target,query)}))
    .filter(match=>Number.isFinite(match.score))
    .sort((a,b)=>a.score-b.score||a.target.name.localeCompare(b.target.name)),limit);
  if(cache.size>=8)cache.delete(cache.keys().next().value!);
  cache.set(cacheKey,matches);
  return matches;
}

/** Explain the same scored results without searching the collection again. */
export function catalogSearchDiagnosticsFromMatches(
  query: string,
  matches: CatalogSearchMatch[],
  visibleTargets?: readonly UnifiedTarget[],
): CatalogSearchDiagnostics {
  if(!query.trim())return {kind:"no-match",matches:[],visibleMatches:[],message:"Enter a name or catalog designation to search."};
  const visibleIds=visibleTargets?new Set(visibleTargets.map(target=>target.id)):null;
  // Exact names/identifiers hidden by a filter must not be masked by weaker
  // constellation/category matches that happen to remain visible.
  const relevant=matches[0]?.score<=1?matches.filter(match=>match.score<=1):matches;
  const visibleMatches=visibleIds?relevant.filter(match=>visibleIds.has(match.target.id)):relevant;
  if(visibleMatches.length)return {kind:"matches",matches,visibleMatches,message:`${visibleMatches.length} matching ${visibleMatches.length===1?"object":"objects"}.`};
  if(matches.length)return {kind:"filtered",matches,visibleMatches,message:`${matches[0].target.name} matches your search but is hidden by the current filters.`};
  const planet=unsupportedPlanetMessage(query);
  if(planet)return {kind:"unsupported-planet",matches,visibleMatches,message:planet};
  const lunar=lunarSearchHint(query);
  if(lunar)return {kind:"lunar",matches,visibleMatches,message:lunar};
  return {kind:"no-match",matches,visibleMatches,message:`No catalog object matches “${query.trim()}”. Try another name or designation.`};
}

/** Search the full collection and explain whether active filters hid a match. */
export function catalogSearchDiagnostics(query: string, allTargets: readonly UnifiedTarget[], visibleTargets?: readonly UnifiedTarget[]): CatalogSearchDiagnostics {
  return catalogSearchDiagnosticsFromMatches(query,searchCatalog(allTargets,query),visibleTargets);
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
