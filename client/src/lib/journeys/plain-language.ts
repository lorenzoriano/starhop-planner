/**
 * Plain-language descriptions and the glossary (owner feedback round 1).
 *
 * - `plainClass(obj)`: the description line under a stop's name. Never a spectral class or catalog code:
 *   "white giant + orange giant", "red supergiant, slowly pulsating", "young open cluster", "planetary nebula".
 *   Built only from KB fields (spectral type and luminosity class, evolutionary stage, deep-sky class and traits,
 *   variability class, multiplicity components, evoStage / age for clusters). The raw classes stay in the card's
 *   expandable details.
 * - `plainKind(obj)`: the short noun phrase the narrator uses inside sentences ("an orange giant", "an open
 *   cluster"): the primary object only, without the variability or companion suffixes.
 * - `findGlossaryTerms(text, glossary)`: where the glossary terms occur in a text (first occurrence of each term,
 *   case-insensitive, whole words, simple plurals), so the UI can make them tappable.
 *
 * Data: client/public/data/journeys/glossary.json ({ version, terms: GlossaryEntry[] }).
 */
import type { DeepSkyClass, KbObject, StarObject, VariabilityClass } from './types';

// ───────────────────────────── stars ─────────────────────────────

const COLOR_BY_CLASS: Record<string, string> = {
  O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red',
};

type Size = 'hypergiant' | 'supergiant' | 'giant' | 'subgiant' | 'dwarf' | 'subdwarf';

/** Size from a Morgan–Keenan luminosity class ("Iab", "III-IV", "Ia-0", "IV-V"): the first (brightest) class wins. */
export function sizeFromLumClass(lum: string | undefined): Size | null {
  if (!lum) return null;
  const s = lum.trim();
  if (/^(0|Ia\+|Ia-?0)/.test(s)) return 'hypergiant';
  if (/^I(a|ab|b)?(?![IV])/.test(s)) return 'supergiant';
  if (/^II(?!I)/.test(s) || /^III/.test(s)) return 'giant';
  if (/^IV/.test(s)) return 'subgiant';
  if (/^VI/.test(s)) return 'subdwarf';
  if (/^V/.test(s)) return 'dwarf';
  return null;
}

/**
 * Temperature class and luminosity class from a published spectral type: "K1.5 III Fe−0.5" → K / III,
 * "A7 III (θ²)" → A / III, "F8pIa-0 to M3" → F / Ia-0, "gM0" → M / III, "DA white dwarf" → D.
 */
export function parseSpectralType(text: string | undefined): { cls: string | null; lum?: string } {
  if (!text) return { cls: null };
  const t = text.trim();
  if (/^D[ABOQZCX]?\b|white dwarf/i.test(t)) return { cls: 'D' };
  if (/^(C\d|C-|N\d|R\d|S\d)/.test(t) || /carbon star/i.test(t)) return { cls: 'C' };
  const giantPrefix = /^g(?=[OBAFGKM])/.test(t);
  const dwarfPrefix = /^d(?=[OBAFGKM])/.test(t);
  const m = /(?:^|[^A-Za-z])([OBAFGKMW])(?:[0-9.]+(?:[-/][0-9.]+)?)?[a-z]*\s*(?:[-/][OBAFGKM]?[0-9.]*\s*)?((?:Ia-?0|Ia\+|0|Iab|Ia|Ib|III|II|IV|VI|V|I)(?:[ab]|-?(?:Iab|Ia|Ib|III|II|IV|V))*)?/.exec(` ${t.replace(/^[gd](?=[OBAFGKM])/, '')}`);
  if (!m) return { cls: null };
  const lum = m[2] ?? (giantPrefix ? 'III' : dwarfPrefix ? 'V' : undefined);
  return { cls: m[1], ...(lum ? { lum } : {}) };
}

const STAGE_SIZE: Partial<Record<NonNullable<StarObject['evolutionaryStage']>, Size>> = {
  'red-supergiant': 'supergiant', 'blue-supergiant': 'supergiant', 'yellow-supergiant': 'supergiant',
  'yellow-hypergiant': 'hypergiant', lbv: 'hypergiant',
  'red-giant-branch': 'giant', 'red-clump': 'giant', 'horizontal-branch': 'giant', 'early-agb': 'giant', 'tp-agb': 'giant',
  subgiant: 'subgiant', 'main-sequence': 'dwarf', zams: 'dwarf', 'terminal-main-sequence': 'dwarf',
};
const STAGE_COLOR: Partial<Record<NonNullable<StarObject['evolutionaryStage']>, string>> = {
  'red-supergiant': 'red', 'blue-supergiant': 'blue-white', 'yellow-supergiant': 'yellow', 'yellow-hypergiant': 'yellow', lbv: 'blue-white',
};

/** "orange giant", "white star", "red dwarf", "yellow supergiant", "white dwarf", "carbon star". */
function starWords(cls: string | null, size: Size | null, stage?: StarObject['evolutionaryStage']): string {
  if (stage === 'white-dwarf' || cls === 'D') return 'white dwarf';
  if (stage === 'wolf-rayet' || cls === 'W') return 'Wolf-Rayet star';
  if (cls === 'C') return 'carbon star';
  // A named late stage (supergiant, hypergiant) outranks the luminosity class, which can lag the literature.
  const stageSize = stage ? STAGE_SIZE[stage] : undefined;
  const s: Size | null = stageSize === 'supergiant' || stageSize === 'hypergiant' ? stageSize : size ?? stageSize ?? null;
  // A K-type "red supergiant" (π Puppis, K3 Ib) looks orange; its card says so, and the description must agree.
  const stageColor = stage === 'red-supergiant' && cls === 'K' ? 'orange' : stage ? STAGE_COLOR[stage] : undefined;
  const color = stageColor ?? (cls ? COLOR_BY_CLASS[cls] : undefined);
  if (!color) return s && s !== 'dwarf' && s !== 'subdwarf' ? `${s} star`.replace(/giant star$/, 'giant') : 'star';
  switch (s) {
    case 'hypergiant': case 'supergiant': case 'giant': return `${color} ${s}`;
    // "subgiant" is worth saying only for stars that are visibly ageing (yellow, orange, red ones).
    case 'subgiant': return color === 'yellow' || color === 'orange' || color === 'red' ? `${color} subgiant` : `${color} star`;
    case 'dwarf': case 'subdwarf': return color === 'red' || color === 'orange' ? `${color} dwarf` : `${color} star`;
    default: return `${color} star`;
  }
}

/** Short plain words for the variability family (suffix after a comma). */
const VARIABILITY_WORDS: Partial<Record<VariabilityClass, string>> = {
  'eclipsing-algol': 'eclipsing binary', 'eclipsing-beta-lyrae': 'eclipsing binary', 'eclipsing-long-period': 'eclipsing binary',
  cepheid: 'pulsating Cepheid', 'rr-lyrae': 'pulsating', 'delta-scuti': 'pulsating', 'beta-cephei': 'pulsating',
  'rv-tauri': 'pulsating', mira: 'slowly pulsating Mira star', semiregular: 'slowly pulsating', irregular: 'varies irregularly',
  'gamma-cas-be': 'fast spinner with a gas disk', 'r-crb': 'fades behind clouds of soot', 'recurrent-nova': 'recurrent nova',
  'dwarf-nova': 'dwarf nova', 'alpha2-cvn': 'spotted, varies as it spins', rotational: 'varies as it spins',
  lbv: 'unstable, erupting', 'yellow-hypergiant': 'unstable', 'young-stellar-object': 'newborn, still settling',
};

const pluralize = (w: string) => w.replace(/(star|giant|dwarf|supergiant|hypergiant|subgiant)$/, '$1s');
const COUNT_WORDS = ['', 'one', 'two', 'three'];

/** "white giant + orange giant", "pair of orange dwarfs", "two white stars + red dwarf" (at most three components). */
function componentWords(obj: StarObject): string | null {
  const all = obj.multiplicity?.components ?? [];
  // A pair of pairs (the Double-Double, WDS pair "AB,CD"): four stars, not one.
  if (all.length === 4 && (obj.multiplicity?.pairs ?? []).some((p) => /^[A-Z]+,[A-Z]+$/.test(p.pair))) {
    const color = primaryStarWords(obj).match(/^(blue-white|yellow-white|blue|white|yellow|orange|red) star$/)?.[1];
    return `four ${color ? `${color} ` : ''}stars in two pairs`;
  }
  const comps = all.filter((c) => c.spType);
  if (comps.length < 2) return null;
  const words = comps.slice(0, 3).map((c, i) => {
    // The primary keeps the record's own (stage-aware) description, so a Cepheid stays a yellow supergiant.
    if (i === 0) return primaryStarWords(obj);
    const p = parseSpectralType(c.spType);
    return starWords(p.cls, sizeFromLumClass(p.lum));
  }).filter((w, i, all) => w !== 'star' || all.every((x) => x === 'star') || i === 0);
  if (words.length < 2) return null;
  if (words.every((w) => w === words[0])) return `${words.length === 2 ? 'pair of' : COUNT_WORDS[words.length]} ${pluralize(words[0])}`;
  const groups: { w: string; n: number }[] = [];
  for (const w of words) { const g = groups.find((x) => x.w === w); if (g) g.n++; else groups.push({ w, n: 1 }); }
  return groups.map((g) => (g.n > 1 ? `${COUNT_WORDS[g.n]} ${pluralize(g.w)}` : g.w)).join(' + ');
}

function primaryStarWords(obj: StarObject): string {
  const parsed = parseSpectralType(obj.spectral?.text);
  const cls = obj.spectral?.class && /^[OBAFGKMCSWD]$/.test(obj.spectral.class) ? (/[CS]/.test(obj.spectral.class) ? 'C' : obj.spectral.class) : parsed.cls;
  return starWords(cls, sizeFromLumClass(obj.spectral?.lumClass ?? parsed.lum), obj.evolutionaryStage);
}

// ───────────────────────────── deep sky ─────────────────────────────

const DSO_WORDS: Record<DeepSkyClass, string> = {
  'hii-region': 'glowing gas cloud where stars form',
  'reflection-nebula': 'dust cloud lit by starlight',
  'dark-nebula': 'dark cloud of dust',
  'nebula-complex': 'cloud complex where stars form',
  'embedded-cluster': 'newborn cluster still inside its cloud',
  'open-cluster': 'open cluster',
  'ob-association': 'loose family of young, hot stars',
  'moving-group': 'scattered star family',
  'globular-cluster': 'globular cluster',
  'star-cloud': 'Milky Way star cloud',
  asterism: 'star pattern',
  'planetary-nebula': 'planetary nebula',
  'supernova-remnant': 'supernova remnant',
  'wind-bubble': 'bubble blown by a star’s wind',
  'galaxy-spiral': 'spiral galaxy',
  'galaxy-barred-spiral': 'barred spiral galaxy',
  'galaxy-lenticular': 'lens-shaped galaxy',
  'galaxy-elliptical': 'elliptical galaxy',
  'galaxy-dwarf-elliptical': 'dwarf elliptical galaxy',
  'galaxy-irregular': 'irregular galaxy',
  'milky-way-field': 'Milky Way field',
};

/** "young open cluster" (evoStage ≤ 2 or under 200 million years), "old open cluster" (evoStage 4 or ≥ 2 billion years). */
function clusterAge(obj: KbObject): 'young' | 'old' | null {
  if (obj.evoStage !== null && obj.evoStage !== undefined) {
    if (obj.evoStage <= 2) return 'young';
    if (obj.evoStage === 4) return 'old';
    return null;
  }
  const age = obj.facts.ageMyr?.value;
  if (age === undefined) return null;
  return age < 200 ? 'young' : age >= 2000 ? 'old' : null;
}

function dsoWords(obj: Extract<KbObject, { kind: 'dso' }>): string {
  const base = DSO_WORDS[obj.dsoClass] ?? obj.dsoClass.replace(/-/g, ' ');
  if (obj.dsoClass === 'open-cluster') { const a = clusterAge(obj); return a ? `${a} ${base}` : base; }
  return base;
}

// ───────────────────────────── public API ─────────────────────────────

/**
 * Plain description of what an object is, for the line under its name: "white giant + orange giant",
 * "red supergiant, slowly pulsating", "young open cluster", "planetary nebula". Never a spectral class or catalog code.
 */
export function plainClass(obj: KbObject): string {
  if (obj.kind === 'dso') {
    const base = dsoWords(obj);
    const traits = obj.traits ?? [];
    if (/galaxy/.test(obj.dsoClass)) {
      if (traits.includes('edge-on')) return `${base}, seen edge-on`;
      if (traits.includes('interacting')) return `${base}, interacting with a neighbor`;
    }
    return base;
  }
  const base = componentWords(obj) ?? primaryStarWords(obj);
  const v = obj.variability ? VARIABILITY_WORDS[obj.variability.class] : undefined;
  if (!v) return base;
  const last = v.split(' ').at(-1)!;
  return base.includes(last) ? base : `${base}, ${v}`;
}

/** Short noun phrase for sentences, primary object only: "orange giant", "young open cluster", "planetary nebula". */
export function plainKind(obj: KbObject): string {
  return obj.kind === 'dso' ? dsoWords(obj) : primaryStarWords(obj);
}

/** "an orange giant", "a white star", "a Wolf-Rayet star". */
export function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

// ───────────────────────────── glossary ─────────────────────────────

export interface GlossaryEntry {
  /** Stable id, kebab-case ("light-year"). */
  id: string;
  /** Display form ("light-year"). */
  term: string;
  /** Other spellings and irregular plurals matched in text ("light-years" is matched automatically). */
  aliases: string[];
  /** Plain definition, at most 25 words. */
  short: string;
}

/** The glossary file shape (glossary.json), or a bare list of entries. */
export type Glossary = GlossaryEntry[] | { version?: string; terms: GlossaryEntry[] };

export interface GlossaryHit {
  /** Canonical term of the entry. */
  term: string;
  /** Character offsets of the occurrence in the text ([start, end)). */
  start: number;
  end: number;
  /** Entry id. */
  id: string;
  /** The text as it appears ("Cepheids"). */
  match: string;
  entry: GlossaryEntry;
}

export const glossaryEntries = (g: Glossary): GlossaryEntry[] => (Array.isArray(g) ? g : g.terms ?? []);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex source for one surface form plus simple plurals: s / es, y → ies, a → ae. */
function formPattern(form: string): string {
  const f = escapeRe(form);
  if (/[^aeiou]y$/i.test(form)) return `(?:${f}|${escapeRe(form.slice(0, -1))}ies)`;
  if (/a$/i.test(form)) return `${f}(?:e|s)?`;
  if (/(s|x|ch|sh)$/i.test(form)) return `${f}(?:es)?`;
  return `${f}s?`;
}

const patternCache = new WeakMap<object, { entry: GlossaryEntry; re: RegExp }[]>();

function patterns(entries: GlossaryEntry[]): { entry: GlossaryEntry; re: RegExp }[] {
  let p = patternCache.get(entries);
  if (!p) {
    p = entries
      .flatMap((entry) => [entry.term, ...(entry.aliases ?? [])].filter(Boolean).map((form) => ({ entry, form })))
      .sort((a, b) => b.form.length - a.form.length)
      .map(({ entry, form }) => ({ entry, re: new RegExp(`(?<![\\p{L}\\p{N}])${formPattern(form)}(?![\\p{L}\\p{N}])`, 'giu') }));
    patternCache.set(entries, p);
  }
  return p;
}

/**
 * The first occurrence of each glossary term in `text`: case-insensitive, whole words (a hyphen or letter next to
 * the match blocks it only on the letter side), simple plurals, longest form first, never overlapping. Sorted by
 * position.
 */
export function findGlossaryTerms(text: string, glossary: Glossary): GlossaryHit[] {
  const entries = glossaryEntries(glossary);
  if (!text || !entries.length) return [];
  const hits: GlossaryHit[] = [];
  for (const { entry, re } of patterns(entries)) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index, end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      // One hit per entry: the earliest (a shorter alias may find an earlier occurrence than a longer one did).
      const prev = hits.findIndex((h) => h.id === entry.id);
      if (prev >= 0) {
        if (hits[prev].start < start) break;
        hits.splice(prev, 1);
      }
      hits.push({ term: entry.term, start, end, id: entry.id, match: m[0], entry });
      break;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ───────────────────────────── names in sentences ─────────────────────────────

/** Common-noun endings that take "the" in running text ("the Andromeda Galaxy", "the Garnet Star", "the Hyades", "the Jewel Box"). */
const THE_ENDING = /\b(Galaxy|Cloud|Clouds|[Cc]luster|Nebula|Pleiades|Hyades|Star|Double|Double-Double|Ring|Triangle|Loop|Belt|Group|Association|Stream|Cocoon|Box|Beehive|Globular|Pinwheel|Rift|Minnow|Coathanger|Coalsack)$/;
const CATALOG_START = /^(NGC|IC|M\s?\d|Messier|Stock|Collinder|Cr\s?\d|Melotte|Mel\s?\d|Trumpler|Tr\s?\d|Barnard|B\s?\d|Sh2|HD|HR|HIP|Gliese|GJ|Kemble|Winnecke|Struve|Σ)/;

/**
 * A display name as it reads inside a sentence: "the Andromeda Galaxy", "the Garnet Star", "the Double Cluster
 * (h Persei)", but "Algol", "Stock 2 (Muscleman Cluster)", "Ptolemy’s Cluster", "NGC 6231". Sentence-initial
 * "the" is capitalized by the narrator's tidy pass.
 */
export function nameInSentence(display: string): string {
  const name = display.trim();
  if (/^the\s/i.test(name)) return name;
  const base = name.replace(/\s*\([^)]*\)\s*$/, '');
  if (/['’]s\b/.test(base) || CATALOG_START.test(base)) return name;
  return THE_ENDING.test(base) ? `the ${name}` : name;
}

/** Capitalize "the" at the start of the text and of each sentence ("the Hyades …" → "The Hyades …"). */
export function capitalizeSentences(text: string): string {
  return text.replace(/(^|[.!?]["”’)]?\s+)the\b/g, (_m, p: string) => `${p}The`);
}
