/**
 * Sky Journeys narration without an LLM (doc 05 §8, doc 04 §6, spec decision 1).
 *
 * Renders, from the NarrationBank (narration.json) and KB facts:
 *   - the journey title ({region}; bank "title.<templateId>.end<lastStep>[.no<step>]" first, so a title never promises a beat
 *     the night does not reach), driving question and discovery hook line (template key families),
 *   - per stop: why-here line, an optional prerequisite bridge, the transition FROM THE LAST STOP,
 *     card numbers with relatable comparison lines (bands), notices (challenge, volatile, photo),
 *     and the skip-bridge shown when the observer skips that stop,
 *   - the payoff line answering the driving question (Journey.payoff, shown once: on the final card and the
 *     done screen; bank "payoff.<templateId>.end<lastStep>" for the beat the journey ends on, then the template's
 *     payoff keys and "payoff.<templateId>"; {tally} recaps the visited stops' lens verdicts, verdictTally) and the
 *     coda callback,
 *   - the archetype-switch announcement (switch.*, prefixed to the transition after the switch stop) and a
 *     2–3 sentence story overview (bank "story.<templateId>.end<lastStep>"/"story.<templateId>"/"story" when
 *     present, else composed). The overview
 *     is prose only: the stop count and minutes are shown by the UI, never written into the story.
 * {region} is a BARE name ("Orion"); the bank variants supply the preposition ("Cradle to Grave in {region}").
 * Rendered text passes `tidyText`, which repairs seams such as "about about" or "farther farther" where a
 * variant repeats words its placeholder already carries.
 * Voice (docs/sky-journeys/voice.md, owner brief r1: an author at the eyepiece, not a headline writer): no
 * meta-talk, no teasers. The driving question is shown by the UI (overview, and the first card's question box when
 * the object has no card.question), so no why-here line repeats it. The first stop's why-here connects the stop to
 * the journey's thread (why.hook.<template>); the payoff stop's why-here is a thread line (why.payoff.<template>)
 * plus the curated card line, never the answer, which lives once in Journey.payoff. Other stops use the curated
 * card.whyHere (concrete, object-specific) before any generic bank line. Transitions name the concrete link,
 * using plain kinds ("an orange giant", plain-language.ts) when no sourced number fits. At most one
 * prerequisite bridge per journey, rendered without a lead-in.
 * Variants are chosen with a seeded RNG (rngFor(seedKey, journey key, purpose)) and never repeat inside one
 * journey while an unused variant exists. A variant whose placeholders cannot all be filled from sourced
 * facts is skipped, so no text ever shows "{x}", "undefined" or "NaN". Every number rendered from a fact is
 * returned as a TracedNumber (object, fact, value, sourceId) next to the text, so the card can cite it.
 */
import { FATE_REASON_KEY, isLensLink } from './candidates';
import { fillTemplate } from './getthere';
import { conceptIndex } from './features';
import { capitalizeSentences, nameInSentence, plainKind, withArticle } from './plain-language';
import { rngFor } from './seed';
import { CATALOG_CODE } from './voice';
import {
  FACT_KEYS, type ArcRole, type CardNumber, type Edge, type FactKey, type FactValue, type Journey, type JourneyStop,
  type KbObject, type KnowledgeBase, type NarrationBank, type Template, type ThemeLensSet,
} from './types';

// ───────────────────────────── public shapes ─────────────────────────────

export interface TracedNumber {
  objectId: string;
  fact: FactKey;
  value: number;
  sourceId: string;
}

export interface NarrationLine {
  /** NarrationBank key the text came from ("builtin:…" for the code fallbacks). */
  key: string;
  text: string;
  /** Sourced numbers used in the text. */
  numbers: TracedNumber[];
}

export interface CardNumberLine {
  label: string;
  fact: FactKey;
  /** Formatted value, e.g. "3,600 K", "550–650 light-years". */
  value: string;
  sourceId: string;
  /** Relatable-scale line (compare.<comparisonKey>[.<band>]) or null. */
  comparison: NarrationLine | null;
}

export interface StopNarration {
  index: number;
  objectId: string;
  whyHere: NarrationLine;
  /** One-sentence bridge for a prerequisite no earlier stop taught (doc 04 §2.1). */
  bridge: NarrationLine | null;
  transition: NarrationLine | null;
  numbers: CardNumberLine[];
  notices: NarrationLine[];
  /** Text shown if THIS stop is skipped: bridges the previous stop to the next one (null for the last stop). */
  skip: NarrationLine | null;
}

export interface JourneyNarration {
  title: NarrationLine;
  drivingQuestion: NarrationLine;
  hook: NarrationLine;
  /** 2–3 sentence overview paragraph (Journey.story). */
  story: NarrationLine;
  payoff: NarrationLine | null;
  coda: NarrationLine | null;
  /** Announcement of the archetype switch (switch.*), already prefixed to the next stop's transition. */
  switchLine: NarrationLine | null;
  notices: NarrationLine[];
  stops: StopNarration[];
}

export interface NarrateOptions {
  seedKey: string;
  /**
   * Bare region name for {region}, e.g. "Orion" (titles read "Cradle to Grave in {region}"). Never a phrase
   * such as "· high in the south-east" or "around Orion": the bank supplies the preposition.
   */
  region?: string;
  /** Moon illumination 0..1 when the Moon is up (journey-level moonlit notice above 0.5). */
  moonIllumination?: number;
  /** Calendar year for {year}; default: the year of the first stop window (never the wall clock). */
  year?: number;
  /** Concepts this device already learned (no bridge needed). */
  learnedConcepts?: Iterable<string>;
  /** Observing-condition reasons per stop index. */
  conditions?: Partial<Record<number, 'sets-soon' | 'highest'>>;
}

// ───────────────────────────── number formatting ─────────────────────────────

const group = (n: number): string => {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toString().split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (frac ? `.${frac}` : '');
};
const sig = (v: number, d: number) => (v === 0 ? 0 : Number(v.toPrecision(d)));

/** Human rounding: 3 significant figures (2 below 100, one decimal below 10, 2 sig. figs below 1). */
export function niceNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return group(sig(v, 3));
  if (a >= 10) return group(sig(v, 2));
  if (a >= 1) return group(Math.round(v * 10) / 10);
  return group(sig(v, 2));
}

const plural = (v: number, one: string, many: string) => (Math.abs(v - 1) < 1e-9 ? one : many);

function unitText(key: FactKey, v: number, unit: string, num: (x: number) => string): string {
  switch (key) {
    case 'distanceLy': case 'sizeLy': return `${num(v)} ${plural(v, 'light-year', 'light-years')}`;
    case 'teffK': return `${group(v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v))} K`;
    case 'radiusRsun': return `${num(v)} times the Sun's radius`;
    case 'massMsun': return `${num(v)} ${plural(v, 'solar mass', 'solar masses')}`;
    case 'lumLsun': return `${num(v)} times the Sun's light`;
    case 'periodDays': return `${num(v)} ${plural(v, 'day', 'days')}`;
    case 'memberCount': return `${group(Math.round(v))} stars`;
    case 'angularSizeArcmin': return `${num(v)} arcminutes`;
    case 'bv': case 'absMagV': case 'vMax': case 'vMin': return `magnitude ${num(v)}`;
    default: return `${num(v)} ${unit}`.trim();
  }
}

function ageText(myr: number, num: (x: number) => string): string {
  if (myr >= 1000) return `${num(sig(myr / 1000, 2))} billion years`;
  if (myr >= 1) return `${num(myr)} million years`;
  const yr = myr * 1e6;
  return `${group(sig(yr, yr >= 100 ? 2 : 3))} years`;
}

/** Card/transition rendering of a sourced value; a wide published range renders as "550–650 light-years". */
export function formatFactValue(key: FactKey, f: FactValue): string {
  const { value: v, min, max } = f;
  const wide = min !== undefined && max !== undefined && v > 0 && min < max && (max - min) / v >= 0.2;
  if (key === 'ageMyr') {
    const regime = (x: number): [string, number] => (x >= 1000 ? ['billion years', 1e-3] : x >= 1 ? ['million years', 1] : ['years', 1e6]);
    if (wide && regime(min!)[0] === regime(max!)[0]) {
      const [unit, k] = regime(max!);
      return `${group(sig(min! * k, 2))}–${group(sig(max! * k, 2))} ${unit}`;
    }
    return ageText(v, niceNumber);
  }
  if (wide && key !== 'teffK' && key !== 'memberCount') {
    const two = (x: number) => group(sig(x, 2));
    const hiText = unitText(key, max!, f.unit, two);
    return `${two(min!)}–${hiText}`;
  }
  return unitText(key, v, f.unit, niceNumber);
}

const COMPARATIVE: Partial<Record<FactKey, [more: string, less: string]>> = {
  teffK: ['hotter', 'cooler'],
  distanceLy: ['farther', 'closer'],
  sizeLy: ['larger', 'smaller'],
  radiusRsun: ['larger', 'smaller'],
  ageMyr: ['older', 'younger'],
  lumLsun: ['more luminous', 'less luminous'],
  massMsun: ['heavier', 'lighter'],
  memberCount: ['richer', 'sparser'],
  periodDays: ['slower', 'faster'],
};

/** "about 3 times hotter" (1 significant figure below 10 rounds to the integer, else "about 20 times"). */
export function ratioPhrase(key: FactKey, from: number, to: number, tail = ''): string | undefined {
  if (!(from > 0) || !(to > 0)) return undefined;
  const [more, less] = COMPARATIVE[key] ?? ['larger', 'smaller'];
  const up = to >= from;
  const r = up ? to / from : from / to;
  const word = up ? more : less;
  const t = tail ? ` ${tail}` : '';
  if (r < 1.5) return `a little ${word}${t}`;
  // Two significant figures from 100 up ("about 170 times closer", not "about 200" for 168).
  const n = r < 10 ? Math.round(r) : r < 100 ? sig(r, 1) : sig(r, 2);
  return `about ${group(n)} times ${word}${t}`;
}

/** Light-travel time as a duration without "about": "25,000 years", "2.5 million years". */
export function agoPhrase(distanceLy: number): string {
  const d = distanceLy;
  if (d < 1000) return `${group(d < 100 ? Math.round(d) : Math.round(d / 10) * 10)} years`;
  if (d < 1e6) return `${group(sig(d, 2))} years`;
  if (d < 1e9) return `${group(sig(d / 1e6, 2))} million years`;
  return `${group(sig(d / 1e9, 2))} billion years`;
}

/** Calendar year the light left: "1470", "680 CE", "5500 BCE" (decade above 100 ly, century above 1,000 ly). */
export function yearPhrase(distanceLy: number, nowYear: number): string | undefined {
  if (!(distanceLy >= 0) || distanceLy > 15000) return undefined;
  const step = distanceLy >= 1000 ? 100 : distanceLy >= 100 ? 10 : 1;
  const y = Math.round((nowYear - distanceLy) / step) * step;
  if (y >= 1000) return String(y);
  if (y >= 1) return `${y} CE`;
  const bce = -y || 1;
  return `${bce >= 10000 ? group(bce) : bce} BCE`; // bank style: "5500 BCE", "12,000 BCE"
}

function lengthPhrase(cm: number): string {
  if (cm < 1) return `${niceNumber(cm * 10)} mm`;
  if (cm < 100) return `${niceNumber(cm)} cm`;
  if (cm < 100_000) return `${niceNumber(cm / 100)} m`;
  return `${niceNumber(cm / 100_000)} km`;
}

function durationPhrase(seconds: number): string {
  if (seconds < 0.1) return 'a split second';
  if (seconds < 60) return `${niceNumber(seconds)} ${plural(Math.round(seconds), 'second', 'seconds')}`;
  if (seconds < 3600) { const m = Math.round(seconds / 60); return `${m} ${plural(m, 'minute', 'minutes')}`; }
  if (seconds < 48 * 3600) return `${niceNumber(seconds / 3600)} hours`;
  return `${niceNumber(seconds / 86400)} days`;
}

/** Marble scale (Sun = 1 cm marble, Earth 1 m away ⇒ 1 light-year ≈ 68 km) and the Sun's-life-as-a-day clock. */
export const MARBLE_KM_PER_LY = 68;
export const SUN_AGE_MYR = 4600;
export const SUN_TEFF_K = 5800;

function scaledPhrase(base: string, key: FactKey, v: number): string | undefined {
  if (base === 'compare.size.marble' && key === 'radiusRsun') return lengthPhrase(v); // diameter in cm = R/R☉
  if (base === 'compare.distance.marble' && key === 'distanceLy') return lengthPhrase(v * MARBLE_KM_PER_LY * 100_000);
  if (base === 'compare.time.sun-day' && key === 'ageMyr') return durationPhrase((v / SUN_AGE_MYR) * 86400);
  return undefined;
}

const SUN_REFERENCE: Partial<Record<FactKey, number>> = { teffK: SUN_TEFF_K, lumLsun: 1, massMsun: 1, radiusRsun: 1 };

// ───────────────────────────── variant picker ─────────────────────────────

/** A placeholder value plus the sourced numbers behind it. */
interface Slot { text: string; numbers?: TracedNumber[] }
type Vars = Record<string, Slot | undefined>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Words that may legitimately repeat ("that that", "had had"); every other doubled word is a template seam. */
const DOUBLE_OK = new Set(['that', 'had']);
/**
 * Repairs seams between a bank variant and a placeholder that already carries its own words, e.g.
 * "about {ratioPhrase} farther" with ratioPhrase "about 3 times farther" → "about 3 times farther".
 */
export function tidyText(text: string): string {
  return capitalizeSentences(text)
    .replace(/\b([A-Za-z]{2,})(\s+\1\b)+/gi, (m, w: string) => (DOUBLE_OK.has(w.toLowerCase()) ? m : w))
    .replace(/\b(about|roughly|around|some) (?:about|roughly|around)\b/gi, '$1')
    // "{prevVal} of the Sun's light" where the value already carries the unit.
    .replace(/\b(times the Sun['’]s (light|radius|mass)) of the Sun['’]s \2\b/g, '$1')
    .replace(/\s{2,}/g, ' ');
}

class Picker {
  private used = new Set<string>();
  constructor(private bank: NarrationBank, private seedKey: string, private journeyKey: string) {}

  /** First key with a fully fillable variant; unused variants first; null when none fits. */
  line(keys: readonly (string | null | undefined)[], vars: Vars, purpose: (string | number)[]): NarrationLine | null {
    const flat: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) flat[k] = v?.text;
    for (const key of keys) {
      if (!key) continue;
      const variants = this.bank.variants[key];
      if (!variants?.length) continue;
      const filled = variants
        .map((tpl) => ({ tpl, text: fillTemplate(tpl, flat) }))
        .filter((x): x is { tpl: string; text: string } => x.text !== null);
      if (!filled.length) continue;
      const fresh = filled.filter((x) => !this.used.has(x.tpl));
      const pool = fresh.length ? fresh : filled;
      const rng = rngFor(this.seedKey, this.journeyKey, key, ...purpose);
      const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      this.used.add(pick.tpl);
      return { key, text: tidyText(pick.text), numbers: numbersIn(pick.tpl, vars) };
    }
    return null;
  }
}

function numbersIn(tpl: string, vars: Vars): TracedNumber[] {
  const out: TracedNumber[] = [];
  const seen = new Set<string>();
  for (const m of Array.from(tpl.matchAll(PLACEHOLDER))) {
    for (const n of vars[m[1]]?.numbers ?? []) {
      const k = `${n.objectId}|${n.fact}`;
      if (!seen.has(k)) { seen.add(k); out.push(n); }
    }
  }
  return out;
}

function builtin(key: string, tpl: string, vars: Vars): NarrationLine {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) flat[k] = v?.text;
  return { key: `builtin:${key}`, text: tidyText(fillTemplate(tpl, flat) ?? tpl.replace(PLACEHOLDER, '').replace(/\s{2,}/g, ' ').trim()), numbers: numbersIn(tpl, vars) };
}

// ───────────────────────────── fact helpers ─────────────────────────────

const FACT_KEY_SET: ReadonlySet<string> = new Set(FACT_KEYS);
const isFactKey = (x: string): x is FactKey => FACT_KEY_SET.has(x);

const traced = (o: KbObject, fact: FactKey): TracedNumber | null => {
  const f = o.facts[fact];
  return f && Number.isFinite(f.value) && f.sourceId ? { objectId: o.id, fact, value: f.value, sourceId: f.sourceId } : null;
};

function valueSlot(o: KbObject, fact: FactKey): Slot | undefined {
  const t = traced(o, fact);
  return t ? { text: formatFactValue(fact, o.facts[fact]!), numbers: [t] } : undefined;
}

/** The fact a transition compares: subtype if it is a FactKey (or "<fact>-up"), else the first usable factRef. */
export function edgeProperty(link: Pick<Edge, 'type' | 'subtype'> & { factRefs?: Edge['factRefs'] }, prev: KbObject, next: KbObject): FactKey | null {
  const head = link.subtype.split('-')[0];
  if (isFactKey(link.subtype)) return link.subtype;
  if (isFactKey(head)) return head;
  if (link.type === 'TIME_MACHINE' || link.type === 'LINE_OF_SIGHT') return 'distanceLy';
  const refs = link.factRefs ?? [];
  const both = refs.find((r) => prev.facts[r.fact] && next.facts[r.fact]);
  return both?.fact ?? refs[0]?.fact ?? null;
}

/**
 * How two sourced values compare: `overlap` when both published ranges overlap (or the values are within 20%),
 * `clear` when they differ by at least 1.5× with no overlap, `up` when the second is the larger.
 */
export function compareFacts(a: FactValue, b: FactValue): { overlap: boolean; clear: boolean; up: boolean } {
  const lo = (f: FactValue) => f.min ?? f.value, hi = (f: FactValue) => f.max ?? f.value;
  const r = a.value > 0 && b.value > 0 ? Math.max(a.value, b.value) / Math.min(a.value, b.value) : 1;
  const overlap = (lo(a) <= hi(b) && lo(b) <= hi(a)) || r < 1.2;
  return { overlap, clear: !overlap && r >= 1.5, up: b.value > a.value };
}

// ───────────────────────────── the narrator ─────────────────────────────

const GENERIC_TRANSITION: Record<Edge['type'], string> = {
  LIFE_NEXT: '{next} shows a later chapter of the same life that {prev} is living now.',
  CAUSE: 'What you saw in {prev} is the reason {next} looks the way it does.',
  SIBLING: '{next} was born into the same family of stars as {prev}.',
  CONTRAST: '{prev} and {next} share a patch of sky and very little else.',
  SAME_FAMILY: '{next} is the same kind of object as {prev}, so the two are easy to compare side by side.',
  SCALE: 'From {prev} to {next} the scale takes a big step outward.',
  TIME_MACHINE: 'The light from {next} set out at a very different time from the light you just saw from {prev}.',
  SAME_PHYSICS: '{next} runs on the same physics as {prev}, only in a different setting.',
  NEIGHBOR: '{next} is a true neighbor of {prev} in space, not just on the sky.',
  LINE_OF_SIGHT: '{next} looks close to {prev} on the sky, but the two lie at very different depths.',
};

/** A SCALE or TIME_MACHINE step that goes back down (nearer, smaller): the climbing bank lines would be false. */
export function isDownStep(link: Pick<Edge, 'type' | 'subtype'>): boolean {
  return (link.type === 'SCALE' && link.subtype.endsWith('-down')) || (link.type === 'TIME_MACHINE' && link.subtype === 'nearer');
}
const DOWN_TRANSITION = 'Coming back toward us, {next} is {ratioPhrase} than {prev}.';

/** The most telling concept two stops both teach (not a tier-0 sky-literacy one, and with a big idea to quote). */
function sharedIdea(
  a: KbObject, b: KbObject, cidx: Map<string, { id: string; tier: number; bigIdea: string; parent?: string }>, core: ReadonlySet<string>,
): { id: string; bigIdea: string } | null {
  const sa = new Map(a.teaches.map((t) => [t.conceptId, t.strength] as const));
  let best: { id: string; bigIdea: string; score: number } | null = null;
  for (const t of b.teaches) {
    const other = sa.get(t.conceptId);
    const c = cidx.get(t.conceptId);
    if (other === undefined || !c || c.tier === 0 || !c.bigIdea) continue;
    // Prefer the idea the journey is about (the archetype's core concepts or their children).
    const onTheme = core.has(c.id) || (c.parent !== undefined && core.has(c.parent));
    const score = other + t.strength + (onTheme ? 10 : 0);
    if (!best || score > best.score || (score === best.score && c.id < best.id)) best = { id: c.id, bigIdea: c.bigIdea, score };
  }
  return best;
}

function sharedIdeaLine(idea: { id: string; bigIdea: string }, vars: Vars): NarrationLine | null {
  const flat: Record<string, string | undefined> = { prev: vars.prev?.text, next: vars.next?.text };
  const text = fillTemplate(`Underneath, {prev} and {next} share one idea. ${endSentence(idea.bigIdea)}`, flat);
  return text ? { key: `concept:${idea.id}`, text: tidyText(text), numbers: [] } : null;
}

/**
 * Built-in text for the derived "mass decides the fate" contrast (candidates.ts FATE_REASON_KEY): stars below about
 * eight solar masses end by shedding a planetary nebula around a white dwarf; heavier stars explode as supernovae.
 */
function fateTransition(prev: KbObject, next: KbObject): string {
  const lightEnd = (o: KbObject) => o.roles.includes('pn') || o.roles.includes('wd');
  if (lightEnd(prev)) return 'A Sun-like star finishes the way {prev} has, as a puffed-off shell around a white dwarf, but a star as heavy as {next} is headed for a supernova, because mass decides the ending.';
  if (lightEnd(next)) return '{prev} belongs to the heavyweights that end in a supernova, while lighter stars finish quietly, like {next}, as a glowing shell around a white dwarf.';
  return 'Mass decides how a star dies, and {prev} and {next} show the two ways it can go.';
}

/** Last-resort why-here lines (the bank's why.<arc> keys normally win). None repeats the driving question. */
const WHY_FALLBACK: Record<ArcRole, string> = {
  hook: 'We begin with {name}, {kind}: bright, beautiful and at the heart of the story.',
  build: 'The trail leads on to {name}, {kind}.',
  twist: '{name}, {kind}, is less ordinary than it looks.',
  payoff: 'Everything so far leads to {name}, {kind}.',
  coda: 'A last look at {name} closes the night.',
};

// ───────────────────────────── theme lenses (owner feedback r2) ─────────────────────────────

/** Bank key of a lens pair transition ("lens:A2:1>2"): from beat `a` to beat `b` of archetype `arch`. */
export const lensPairKey = (arch: string, a: number, b: number) => `lens:${arch}:${a}>${b}`;
/** Bank key of a lens arrive transition ("lens:A2:arrive:3"): into beat `b` from any earlier beat. */
export const lensArriveKey = (arch: string, b: number) => `lens:${arch}:arrive:${b}`;

/** The lens set of an archetype (undefined when it has none). */
export function lensSetOf(kb: Pick<KnowledgeBase, 'lenses'>, archetype: string): ThemeLensSet | undefined {
  return kb.lenses?.find((l) => l.archetype === archetype);
}

/**
 * The narration bank with every lens set's transition table added under lens:* keys, so lens transitions are picked
 * like any other line (seeded, never repeated inside a journey, skipped when a placeholder cannot be filled).
 */
const lensBankMemo = new WeakMap<KnowledgeBase, NarrationBank>();
export function bankWithLenses(kb: KnowledgeBase): NarrationBank {
  if (!kb.lenses?.length) return kb.narration;
  const hit = lensBankMemo.get(kb);
  if (hit) return hit;
  const variants: Record<string, string[]> = { ...kb.narration.variants };
  for (const L of kb.lenses) {
    for (const [k, v] of Object.entries(L.transitions?.pairs ?? {})) {
      const [a, b] = k.split('>').map(Number);
      variants[lensPairKey(L.archetype, a, b)] = v;
    }
    for (const [k, v] of Object.entries(L.transitions?.arrive ?? {})) variants[lensArriveKey(L.archetype, Number(k))] = v;
  }
  const bank = { ...kb.narration, variants };
  lensBankMemo.set(kb, bank);
  return bank;
}

/** Built-in lens transition when the theme's table has no line for this step (the build reports such gaps). */
const LENS_FALLBACK_TRANSITION = 'From {prev} the story moves on to {next}.';

/** At most this many prerequisite bridges per journey (owner feedback r1: less talk between the stops). */
export const MAX_BRIDGES = 1;

/** Claims that read as a noun phrase after "{name} is …" ("the brightest …", "one of …", "prototype of …"). */
const NOUN_CLAIM = /^(the|one|a|an|among|prototype|brightest|nearest|farthest|largest|first|host|usually|by far|probably|briefly|often|second|third|third-largest|second-brightest)\b/i;

/**
 * Plain kinds of two consecutive stops: {sharedKind} when they match (or one is the other plus an adjective:
 * "young open cluster" and "open cluster" share "an open cluster"), else {prevKind} and {nextKind}.
 */
function kindSlots(prev: KbObject, next: KbObject): Vars {
  const a = plainKind(prev), b = plainKind(next);
  const shared = a === b ? a : a.endsWith(` ${b}`) ? b : b.endsWith(` ${a}`) ? a : null;
  return shared ? { sharedKind: { text: withArticle(shared) } } : { prevKind: { text: withArticle(a) }, nextKind: { text: withArticle(b) } };
}

function findEdge(kb: KnowledgeBase, link: JourneyStop['link'], to: string): Edge | undefined {
  if (!link) return undefined;
  return kb.edges.find((e) => e.type === link.type && e.subtype === link.subtype
    && ((e.from === link.from && e.to === to) || (e.directed === false && e.from === to && e.to === link.from)));
}

function primaryConcept(o: KbObject): string | undefined {
  return o.teaches.slice().sort((a, b) => b.strength - a.strength)[0]?.conceptId;
}

/** Narrate a whole journey. Pure and deterministic in (journey, kb, opts). */
export function narrateJourney(journey: Journey, kb: KnowledgeBase, opts: NarrateOptions): JourneyNarration {
  const bank = bankWithLenses(kb);
  const pick = new Picker(bank, opts.seedKey, journey.key);
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const objs = journey.stops.map((s) => {
    const o = byId.get(s.objectId);
    if (!o) throw new Error(`narrate: unknown object ${s.objectId}`);
    return o;
  });
  const n = objs.length;
  const template: Template | undefined = kb.templates.find((t) => t.id === journey.templateId);
  const tid = journey.templateId;
  const sw = journey.switch && journey.switch.atStop < n - 1 ? journey.switch : undefined;
  const target: Template | undefined = sw ? kb.templates.find((t) => t.id === sw.toTemplateId) : undefined;
  const name = (o: KbObject): Slot => ({ text: proseName(o.names.display) });
  const year = opts.year ?? (journey.stops[0] ? new Date(journey.stops[0].windowStart).getUTCFullYear() : 2026);
  const distanceSlots = (o: KbObject): Vars => {
    const t = traced(o, 'distanceLy');
    if (!t) return {};
    const y = yearPhrase(t.value, year);
    return { ago: { text: agoPhrase(t.value), numbers: [t] }, ...(y ? { year: { text: y, numbers: [t] } } : {}) };
  };

  // ── journey-level lines
  const region: Slot | undefined = opts.region ? { text: opts.region } : undefined;
  // Beat-aware titles first (round 4): title.<tid>.end<lastStep>, the beat the first theme ends on, so a night that
  // ends on a living star is never titled for a death it does not show; title.<tid>.end<lastStep>.no<step> before it,
  // so a night that skipped a beat is never titled for it (A9: proven partners).
  const steps = (t: Template | undefined): number[] => (t ? lensSetOf(kb, t.archetype)?.beats.map((b) => b.step) ?? [] : []);
  const titleLine = pick.line([...beatKeys('title', tid, journey, 0, sw ? sw.atStop : n - 1, steps(template)), ...(template?.titleKeys ?? []), `title.${tid}`], { region }, ['title'])
    ?? builtin('title', template?.title ?? journey.title, {});
  // Classical names ending in s take a bare apostrophe ("Perseus' Ladder", not "Perseus's").
  const title = region && /s$/i.test(region.text)
    ? { ...titleLine, text: titleLine.text.replace(new RegExp(`(${region.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})['’]s\\b`, 'i'), '$1\'') }
    : titleLine;
  const drivingQuestion = pick.line([...(template?.questionKeys ?? []), `question.${tid}`], {}, ['question'])
    ?? builtin('question', template?.drivingQuestion ?? journey.drivingQuestion, {});
  const hook = pick.line([...(template?.hookKeys ?? []), `hook.${tid}`], {}, ['hook'])
    ?? builtin('hook', template?.hookLine ?? journey.hook, {});
  const notices: NarrationLine[] = [];
  if ((opts.moonIllumination ?? 0) > 0.5) {
    const l = pick.line(['notice.moonlit'], {}, ['notice']);
    if (l) notices.push(l);
  }

  // ── payoff and coda (the payoff line is also the payoff stop's why-here: the question's answer)
  let payoffIdx = journey.stops.map((s) => s.arc).lastIndexOf('payoff');
  if (payoffIdx < 0) payoffIdx = journey.stops[n - 1]?.arc === 'coda' && n > 1 ? n - 2 : n - 1;
  // After a switch the last payoff answers the second theme's question.
  const payoffT = target ?? template;
  const payoffTid = target ? target.id : tid;
  // Beat-aware variants first (round 3 contract): payoff.<tid>.end<lastStep> answers for the beat the journey ends
  // on, so the payoff never promises a beat the journey did not visit (and payoff.<tid>.end<lastStep>.no<step> before
  // it, for a night that skipped that beat on the way).
  const payoffBeatKeys = beatKeys('payoff', payoffTid, journey, sw ? sw.atStop + 1 : 0, n - 1, steps(payoffT));
  // {tally}: the verdicts of the stops the payoff's theme actually visited tonight (owner feedback r4, rule 5: the
  // last card answers the driving question for THIS night's pairs, never a regional recap).
  const tally: Slot = {
    text: verdictTally(journey.stops.flatMap((s, i) => (i >= (sw ? sw.atStop + 1 : 0) && s.lens?.verdict ? [{ name: name(objs[i]).text, verdict: s.lens.verdict }] : []))),
  };
  const payoff = n
    ? pick.line([...payoffBeatKeys, ...(payoffT?.payoffKeys ?? []), `payoff.${payoffTid}`], { name: name(objs[payoffIdx]), hook: name(objs[0]), tally, ...distanceSlots(objs[payoffIdx]) }, ['payoff'])
    : null;
  const coda = n > 1 && journey.stops[n - 1].arc === 'coda' ? pick.line(['coda.callback'], { hook: name(objs[0]) }, ['coda']) : null;

  // ── per-stop lines
  const cidx = conceptIndex(kb.concepts);
  const taught = new Set<string>(opts.learnedConcepts ?? []);
  // Available to why.hook lines as {question}; the shipped bank does not repeat it (the UI shows it already).
  const question: Slot = { text: endSentence(drivingQuestion.text) };
  const core = new Set([...(template?.coreConcepts ?? []), ...(target?.coreConcepts ?? [])]);
  const onTheme = (id: string) => { const c = cidx.get(id); return core.has(id) || (!!c?.parent && core.has(c.parent)); };
  let bridges = 0;
  const usedIdeas = new Set<string>();
  let photoNoticeUsed = false;
  let switchLine: NarrationLine | null = null;
  const stops: StopNarration[] = journey.stops.map((st, i) => {
    const o = objs[i];
    const prev = i > 0 ? objs[i - 1] : null;
    const base: Vars = { name: name(o), next: name(o), hook: name(objs[0]), kind: { text: withArticle(plainKind(o)) }, ...(prev ? { prev: name(prev) } : {}) };

    // why here: the thread (first stop), the challenge, else the curated card line. The payoff stop gets a short
    // thread line before its own line; the answer itself stays in Journey.payoff (shown once, on the final card).
    let whyHere: NarrationLine | null = null;
    const sup = o.superlatives[0];
    const curated = o.card.whyHere?.trim();
    if (st.lens) {
      // A lens theme says why the object is in THIS story (owner feedback r2): the lens line, transition-free (the
      // transition is shown just before it), plus the short challenge note on a challenge stop.
      const own = endSentence(st.lens.why);
      const note = st.challenge ? pick.line(['why.challenge'], base, ['why', i]) : null;
      whyHere = { key: 'lens:why', text: tidyText(note ? `${own} ${note.text}` : own), numbers: [] };
    } else if (i === 0) {
      const claim: Slot | undefined = sup ? { text: sup.claim.trim().replace(/[.]$/, '') } : undefined;
      whyHere = pick.line([claim ? `why.hook.${tid}.claim` : null, `why.hook.${tid}`, 'why.hook'], { ...base, ...distanceSlots(o), question, ...(claim ? { claim } : {}) }, ['why', i]);
    } else {
      if (st.challenge) {
        // The object's own line first, then one short challenge note (owner r1: the boilerplate alone got old fast).
        const note = pick.line(['why.challenge'], base, ['why', i]);
        const own = curated ? endSentence(curated) : `${name(o).text} is the faint one tonight.`;
        whyHere = { key: note?.key ?? 'card:whyHere', text: tidyText(note ? `${own} ${note.text}` : own), numbers: [] };
      } else if (curated) whyHere = { key: 'card:whyHere', text: endSentence(curated), numbers: [] };
      else if (sup && st.arc !== 'coda') {
        // The scope stays in the card details; in a sentence it only breaks the flow.
        const claim = sup.claim.trim().replace(/[.]$/, '');
        whyHere = pick.line([NOUN_CLAIM.test(claim) ? 'why.superlative' : 'why.superlative.statement', 'why.superlative'], { ...base, claim: { text: claim } }, ['why', i]);
      }
      const thread = i === payoffIdx ? pick.line([`why.payoff.${payoffTid}`], base, ['why-thread', i]) : null;
      if (thread) {
        whyHere = whyHere
          ? { key: thread.key, text: tidyText(`${thread.text} ${pronounAfter(thread.text, whyHere.text, o.names.display)}`), numbers: [...thread.numbers, ...whyHere.numbers] }
          : thread;
      }
    }
    whyHere ??= pick.line([`why.${st.arc}`], base, ['why', i]) ?? builtin(`why.${st.arc}`, WHY_FALLBACK[st.arc], base);
    const cond = opts.conditions?.[i];
    if (cond) {
      const c = pick.line([`why.condition.${cond}`], base, ['cond', i]);
      if (c) whyHere = { key: whyHere.key, text: `${whyHere.text} ${c.text}`, numbers: whyHere.numbers };
    }

    // Prerequisite bridge: at most MAX_BRIDGES per journey, only for an idea the journey is about, never on the
    // opening stop (its line already carries the question) nor after the payoff's answer.
    let bridge: NarrationLine | null = null;
    const pc = primaryConcept(o);
    // A lens stop's why is the theme author's line alone (owner feedback r2), so no bridge is added to it.
    if (pc && bridges < MAX_BRIDGES && i > 0 && i !== payoffIdx && !st.lens) {
      const missing = (cidx.get(pc)?.prereqs ?? []).find((p) => !taught.has(p) && !!cidx.get(p)?.bridge && onTheme(p));
      if (missing) {
        bridge = pick.line(['bridge.prereq'], { bridge: { text: cidx.get(missing)!.bridge! } }, ['bridge', i]);
        if (bridge) { bridges++; taught.add(missing); }
      }
    }
    for (const t of o.teaches) taught.add(t.conceptId);

    // transition from the last stop. A lens theme's stop arrives through the theme's own transition table (a pair
    // line for the two beats, else an arrive line for this beat); a curated object-pair line (edge.<a>><b>) is added
    // after it only when it says something the lens line and the why-here do not. Other stops use the link's line.
    let transition: NarrationLine | null = null;
    if (prev && st.link) {
      const link = st.link;
      const edgeTransition = (): NarrationLine => {
        const st = { ...journey.stops[i], link };
        const edge = findEdge(kb, st.link, o.id);
        // The edge's own property, else the template's progression property (A2 temperature, A5 age, A3 distance) when
        // both stops carry it: a sourced number says more than a generic line.
        const stageT = sw && i > sw.atStop ? target : template;
        const progression = stageT?.progression?.property;
        const progProp = progression && progression !== 'evoStage' && prev.facts[progression] && o.facts[progression] ? progression : null;
        const prop = edgeProperty({ type: st.link.type, subtype: st.link.subtype, factRefs: edge?.factRefs }, prev, o) ?? progProp;
        const vars: Vars = { ...base, ...distanceSlots(o), ...kindSlots(prev, o) };
        if (prop) {
          const pv = valueSlot(prev, prop), nv = valueSlot(o, prop);
          if (pv) vars.prevVal = pv;
          if (nv) vars.nextVal = nv;
          if (pv && nv) {
            // Direction guards ({ifUp} …, empty text): a line that says "older" or "one young, one old" only when
            // the published ranges do not overlap (NGC 1342's 92–260 Myr is not "older" than the Pleiades' 125).
            const cmp = compareFacts(prev.facts[prop]!, o.facts[prop]!);
            const guard = { text: '' };
            if (cmp.clear) vars.ifClear = guard;
            if (cmp.clear && cmp.up) vars.ifUp = guard;
            if (cmp.clear && !cmp.up) vars.ifDown = guard;
            if (cmp.overlap) vars.ifSimilar = guard;
            const rp = cmp.overlap ? undefined : ratioPhrase(prop, prev.facts[prop]!.value, o.facts[prop]!.value);
            if (rp) vars.ratioPhrase = { text: rp, numbers: [...pv.numbers!, ...nv.numbers!] };
          }
        }
        const stageKey = st.link.type === 'LIFE_NEXT' && prev.evoStage !== null && o.evoStage !== null ? `LIFE_NEXT.${prev.evoStage}-${o.evoStage}` : null;
        const propKey = prop ? `${st.link.type}.${prop}` : null;
        // The bank's SCALE / TIME_MACHINE lines all climb ("Next rung", "Keep counting", "older light"). A derived step
        // back toward us (into a coda, or in an archetype without a progression) uses its own key if the bank has one,
        // else the direction-neutral CONTRAST line for the same fact.
        const down = isDownStep(st.link);
        const keys = down
          ? [st.link.curated ? st.link.reasonKey : null, `${st.link.type}.${st.link.subtype}`, prop ? `CONTRAST.${prop}` : null]
          // A derived link's reasonKey is its generic type key: the more specific keys (subtype, stage, property) go first.
          : st.link.curated
            ? [st.link.reasonKey, `${st.link.type}.${st.link.subtype}`, stageKey, propKey, st.link.type]
            : [`${st.link.type}.${st.link.subtype}`, stageKey, propKey, st.link.reasonKey, st.link.type];
        // A derived SAME_PHYSICS link knows which idea the two stops share: name it instead of the bank's generic
        // "same law of nature" lines (P4 evaluation: "What made X work also makes Y work" says nothing).
        // Each shared idea is quoted once per journey, and not at all when a sourced comparison line for the property fits.
        const numeric = !!(propKey && vars.ratioPhrase && bank.variants[propKey]?.length);
        const idea = st.link.type === 'SAME_PHYSICS' && !st.link.curated && !numeric ? sharedIdea(prev, o, cidx, core) : null;
        const shared = idea && !usedIdeas.has(idea.id) ? idea : null;
        if (shared) usedIdeas.add(shared.id);
        // The derived fate contrast uses the bank's own key when it has one, else its built-in text (never the
        // generic CONTRAST lines, which only say "spot the difference").
        const fate = st.link.reasonKey === FATE_REASON_KEY
          ? pick.line([FATE_REASON_KEY], vars, ['transition', i]) ?? { ...builtin('fate', fateTransition(prev, o), vars), key: `derived:${FATE_REASON_KEY}` }
          : null;
        // An undirected curated edge walked against its authored direction: its text names {prev} and {next} the way
        // the curator wrote it, so fill it with the two stops (and their values) swapped, never with one stop twice.
        const reversed = !!(st.link.curated && edge && edge.from !== st.link.from && edge.to === st.link.from);
        let authored: NarrationLine | null = null;
        if (reversed) {
          const sv: Vars = { ...vars, prev: vars.next, next: vars.prev, prevVal: vars.nextVal, nextVal: vars.prevVal, prevKind: vars.nextKind, nextKind: vars.prevKind };
          if (prop && vars.prevVal && vars.nextVal) {
            const rp = ratioPhrase(prop, o.facts[prop]!.value, prev.facts[prop]!.value);
            sv.ratioPhrase = rp ? { text: rp, numbers: vars.ratioPhrase?.numbers } : undefined;
          }
          authored = pick.line([st.link.reasonKey], sv, ['transition', i]);
        }
        return fate ?? (shared ? sharedIdeaLine(shared, vars) : null) ?? authored
          ?? pick.line(reversed ? keys.filter((k) => k !== st.link!.reasonKey) : keys, vars, ['transition', i])
          ?? (down && vars.ratioPhrase ? builtin('down', DOWN_TRANSITION, vars) : builtin(st.link.type, GENERIC_TRANSITION[st.link.type], vars));
      };
      const lensT = sw && i > sw.atStop ? target : template;
      const lensSet = st.lens && lensT ? lensSetOf(kb, lensT.archetype) : undefined;
      if (st.lens && lensSet) {
        const prevStep = lensSet.objects[prev.id]?.step;
        const lv: Vars = { ...base, ...distanceSlots(o), ...kindSlots(prev, o) };
        const line = pick.line([prevStep !== undefined ? lensPairKey(lensSet.archetype, prevStep, st.lens.step) : null, lensArriveKey(lensSet.archetype, st.lens.step)], lv, ['transition', i]);
        // The theme's own line alone: a curated object-pair line was written for another story and, appended here,
        // pulled the thread off-theme, contradicted the lens (Deneb "in calm middle age" in cradle to grave) or gave
        // the next card's question away (theme writers, owner feedback r2: transitions carry the theme's thread).
        if (line) transition = line;
        else transition = isLensLink(link) ? builtin('lens', LENS_FALLBACK_TRANSITION, lv) : edgeTransition();
      } else transition = isLensLink(link) ? builtin('lens', LENS_FALLBACK_TRANSITION, base) : edgeTransition();
      if (sw && i === sw.atStop + 1) {
        const theme: Slot = { text: sw.toTitle || target?.title || sw.toTemplateId };
        const tq = target?.drivingQuestion?.trim();
        const themeQuestion: Slot | undefined = tq ? { text: endSentence(tq) } : undefined;
        switchLine = pick.line([template?.switchRule?.announceKey, `switch.${tid}`], { ...base, theme, ...(themeQuestion ? { themeQuestion } : {}) }, ['switch'])
          ?? (themeQuestion ? builtin('switch', 'That opens a new question. {themeQuestion}', { themeQuestion }) : builtin('switch', 'From here the night turns to {theme}.', { theme }));
        transition = { key: transition.key, text: `${switchLine.text} ${transition.text}`, numbers: transition.numbers };
      }
    }

    // numbers + comparisons
    const numbers: CardNumberLine[] = [];
    for (const row of o.card.numbers as CardNumber[]) {
      const f = o.facts[row.factRef];
      const t = traced(o, row.factRef);
      if (!f || !t) continue;
      numbers.push({ label: row.label, fact: row.factRef, value: formatFactValue(row.factRef, f), sourceId: f.sourceId, comparison: comparisonLine(pick, bank, o, row, distanceSlots(o), i) });
    }

    // notices
    const stopNotices: NarrationLine[] = [];
    if (st.challenge) { const l = pick.line(['notice.challenge'], base, ['notice', i]); if (l) stopNotices.push(l); }
    if ((o.kind === 'star' && o.variability?.volatile) || o.eventDependent) {
      const l = pick.line(['notice.volatile'], base, ['notice', i]);
      if (l) stopNotices.push(l);
    }
    if (!photoNoticeUsed && o.kind === 'dso' && o.media.images.some((im) => im.variant !== 'illustration')) {
      const l = pick.line(['notice.photo'], base, ['notice', i]);
      if (l) { stopNotices.push(l); photoNoticeUsed = true; }
    }

    return { index: i, objectId: o.id, whyHere, bridge, transition, numbers, notices: stopNotices, skip: null };
  });

  // ── skip-bridges: if stop i is skipped, go from i−1 (or the start) to i+1
  for (let i = 0; i < n - 1; i++) {
    const skipped = objs[i], next = objs[i + 1];
    const prev = i > 0 ? objs[i - 1] : null;
    const vars: Vars = { skipped: name(skipped), next: name(next), ...(prev ? { prev: name(prev) } : {}) };
    const inType = journey.stops[i].link?.type ?? journey.stops[i + 1].link?.type;
    // Skipping the opening stop has no "previous" stop, so only the plain skip lines fit.
    const main = pick.line(prev ? [inType ? `skip.${inType}` : null, 'skip'] : ['skip'], vars, ['skip', i])
      ?? builtin('skip', prev ? 'If {skipped} won’t show tonight, go straight on from {prev} to {next}.' : 'Leave {skipped} for another night and begin at {next} instead.', vars);
    const pc = primaryConcept(skipped);
    // The catch-up line only for an idea the journey is about (otherwise the skip text stays one sentence).
    const br = pc && onTheme(pc) ? cidx.get(pc)?.bridge : undefined;
    const extra = br ? pick.line(['skip.bridge'], { ...vars, bridge: { text: br } }, ['skip-bridge', i]) : null;
    stops[i].skip = extra ? { key: main.key, text: `${main.text} ${extra.text}`, numbers: main.numbers } : main;
  }

  // ── story: a 2–3 sentence overview (bank "story.<templateId>" / "story" when present, else composed)
  const story = storyLine(pick, journey, objs, { hook, region, sw, template, tid, payoffIdx, beatSteps: steps(template) });

  return { title, drivingQuestion, hook, story, payoff, coda, switchLine, notices, stops };
}

/**
 * A stop's name as narration writes it inside a sentence (nameInSentence), without the display name's parenthesised
 * second name: "the Owl Cluster", "Cygnus X-1". When the main name is a catalog code and the second a common name,
 * the common name is used ("Stock 2 (Muscleman Cluster)" → "the Muscleman Cluster"; voice rule: no catalog codes in
 * prose when a common name exists). The card header keeps the full display name.
 */
export function proseName(display: string): string {
  const m = display.trim().match(/^(.+?)\s*\(([^)]+)\)$/);
  if (!m) return nameInSentence(display);
  const [, base, alt] = m;
  return nameInSentence(CATALOG_CODE.test(base) && !CATALOG_CODE.test(alt) && !/\d/.test(alt) ? alt : base);
}

/**
 * When the thread line already names the stop, a following line that opens with the same name continues with
 * "It" / "Its" instead ("δ Cephei is the last of tonight's changing stars. It gave its name to …"), so two
 * sentences in a row do not start with the same name.
 */
export function pronounAfter(lead: string, text: string, display: string): string {
  const full = nameInSentence(display);
  const prose = proseName(display);
  const named = [full, full.replace(/^the /, 'The '), prose, prose.replace(/^the /, 'The '), display].filter((x, k, a) => x && a.indexOf(x) === k);
  if (!named.some((n) => lead.includes(n.replace(/^The /, 'the ')) || lead.includes(n))) return text;
  for (const n of named) {
    if (!text.startsWith(n)) continue;
    const rest = text.slice(n.length);
    if (/^['’]s\s/.test(rest)) return `Its${rest.slice(2)}`;
    if (/^\s+(is|was|has|had|gave|lies|sits|shows|holds|marks|looks|shines|burns|pulses|swells|began|became|carries|keeps|turns)\b/.test(rest)) return `It${rest}`;
  }
  return text;
}

/**
 * The beat a stretch of the journey ends on: the lens step of the last lensed stop in stops[from..to] (stops run in
 * non-decreasing step order, so it is also the highest beat reached), or null when none of them has a lens.
 */
export function lastLensStep(journey: Pick<Journey, 'stops'>, from: number, to: number): number | null {
  for (let i = Math.min(to, journey.stops.length - 1); i >= Math.max(0, from); i--) {
    const step = journey.stops[i].lens?.step;
    if (step !== undefined) return step;
  }
  return null;
}

/**
 * Beat-aware bank keys for a stretch of a lens journey, most specific first: "<family>.<tid>.end<N>.no<S>" for each
 * beat S before the last beat N that the stretch did not visit (so a title or payoff that promises a beat, A9's proven
 * partners, is kept for nights that showed it), then "<family>.<tid>.end<N>". Empty when the stretch has no lens stop.
 */
export function beatKeys(
  family: string, tid: string, journey: Pick<Journey, 'stops'>, from: number, to: number, beatSteps: readonly number[],
): string[] {
  const end = lastLensStep(journey, from, to);
  if (end === null) return [];
  const seen = new Set<number>();
  for (let i = Math.max(0, from); i <= Math.min(to, journey.stops.length - 1); i++) {
    const step = journey.stops[i].lens?.step;
    if (step !== undefined) seen.add(step);
  }
  const missing = Array.from(new Set(beatSteps)).filter((st) => st < end && !seen.has(st)).sort((a, b) => a - b);
  return [...missing.map((st) => `${family}.${tid}.end${end}.no${st}`), `${family}.${tid}.end${end}`];
}

/** One visited stop's verdict for the payoff's {tally}: its name in prose and its lens verdict ("a real pair"). */
export interface TallyEntry { name: string; verdict: string }

/** Most verdicts one {tally} sentence carries, and its longest length (the validator's limit is 220 characters). */
export const TALLY_PER_SENTENCE = 3;
export const TALLY_MAX_CHARS = 210;

/**
 * The payoff's {tally}: the night's verdicts as flowing prose, in visiting order. "Tonight ζ Lyrae turned out to be a
 * real pair, δ Lyrae two strangers lined up by chance, and the Double-Double a family of four suns in two pairs."
 * Longer nights continue in a second (and third) sentence ("Further on, … emerged as …", "And last of all
 * … turned out to be …"), each at most TALLY_PER_SENTENCE verdicts and TALLY_MAX_CHARS characters. Stops without a
 * verdict are left out; with fewer than two verdicts there is nothing to tally (the last card already gave its own),
 * so it renders empty and the payoff variant, which places {tally} as a sentence of its own, still reads whole.
 */
export function verdictTally(entries: readonly TallyEntry[]): string {
  const xs = entries
    .map((e) => ({ name: e.name.trim(), verdict: e.verdict.trim().replace(/[.,;:!?]+$/, '') }))
    .filter((e) => e.name && e.verdict);
  if (xs.length < 2) return '';
  // Agreement-free frames (a stop can be plural, "Mizar and Alcor"); the later verdicts share the first one's verb.
  const frames: ((name: string, verdict: string) => string)[] = [
    (nm, v) => `Tonight ${nm} turned out to be ${v}`,
    (nm, v) => `Further on, ${nm} emerged as ${v}`,
    (nm, v) => `And last of all ${nm} turned out to be ${v}`,
  ];
  const sentence = (group: typeof xs, i: number, k: number): string => {
    const frame = frames[i === 0 ? 0 : i === k - 1 && k >= 3 ? 2 : 1];
    const parts = group.map((e, j) => (j === 0 ? frame(e.name, e.verdict) : `${e.name} ${e.verdict}`));
    return `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`}.`;
  };
  // As few sentences as fit: k sentences of near-equal size (earlier ones take the extra verdict).
  for (let k = Math.ceil(xs.length / TALLY_PER_SENTENCE); k <= xs.length; k++) {
    const out: string[] = [];
    for (let i = 0, at = 0; i < k; i++) {
      const size = Math.floor(xs.length / k) + (i < xs.length % k ? 1 : 0);
      out.push(sentence(xs.slice(at, at + size), i, k));
      at += size;
    }
    if (out.every((x) => x.length <= TALLY_MAX_CHARS) || k === xs.length) return capitalizeSentences(out.join(' '));
  }
  return '';
}

const endSentence = (t: string) => (/[.!?…]["”’)]?$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

function storyLine(
  pick: Picker, journey: Journey, objs: KbObject[],
  x: { hook: NarrationLine; region?: Slot; sw?: Journey['switch']; template?: Template; tid: string; payoffIdx: number; beatSteps: readonly number[] },
): NarrationLine {
  const n = objs.length;
  const first = objs[0], last = objs[n - 1];
  const payoffObj = objs[Math.min(Math.max(x.payoffIdx, 0), n - 1)];
  const minutes = Math.max(5, Math.round(journey.durationMin / 5) * 5);
  const vars: Vars = {
    hook: { text: proseName(first.names.display) },
    // {name} is the stop that answers the question; after a switch the second theme owns it, so it stays empty
    // and only the name-free story variants fit.
    ...(x.sw ? {} : { name: { text: proseName(payoffObj.names.display) } }),
    count: { text: String(n) },
    minutes: { text: String(minutes) },
    ...(x.region ? { region: x.region } : {}),
    ...(x.sw ? { theme: { text: x.sw.toTitle } } : {}),
  };
  // The theme title stays in the sentence (the overview and tests key on it), quoted like a chapter title rather
  // than run on after a colon. The second question itself is asked once, by the switch line on the transition
  // after the switch stop, so the overview does not repeat it.
  const switchText = (): string => {
    const title = x.sw!.toTitle.trim();
    return `At ${proseName(objs[x.sw!.atStop].names.display)} the night opens a second chapter, “${/[.?!]$/.test(title) ? title : `${title}.`}”`;
  };
  // Beat-aware variant first (round 3 contract): story.<tid>.end<lastStep>, the last beat the first theme reaches
  // (story.<tid>.end<lastStep>.no<step> before it, for a beat skipped on the way).
  const banked = pick.line([...beatKeys('story', x.tid, journey, 0, x.sw ? x.sw.atStop : n - 1, x.beatSteps), `story.${x.tid}`, 'story'], vars, ['story']);
  if (banked) return x.sw ? { ...banked, text: capitalizeSentences(`${banked.text} ${switchText()}`) } : banked;
  // Composed fallback (banks without story lines): prose only, never the stop count or the minutes.
  const parts = [endSentence(x.hook.text)];
  parts.push(`The way runs from ${proseName(first.names.display)} to ${proseName(last.names.display)}${x.region ? `, without leaving the stars of ${x.region.text}` : ''}.`);
  if (x.sw) parts.push(switchText());
  return { key: 'builtin:story', text: capitalizeSentences(parts.join(' ')), numbers: [] };
}

function comparisonLine(pick: Picker, bank: NarrationBank, o: KbObject, row: CardNumber, dist: Vars, i: number): NarrationLine | null {
  if (!row.comparisonKey) return null;
  const base = `compare.${row.comparisonKey}`;
  const bands = bank.bands?.[base];
  let fact: FactKey = row.factRef;
  let key: string | null = null;
  if (bands) {
    const band = bands.find((b) => {
      const v = o.facts[b.fact ?? row.factRef]?.value;
      return v !== undefined && (b.min === undefined || v >= b.min) && (b.max === undefined || v < b.max);
    });
    if (band) { key = `${base}.${band.suffix}`; fact = band.fact ?? row.factRef; }
  }
  const f = o.facts[fact];
  const t = traced(o, fact);
  const vars: Vars = { name: { text: proseName(o.names.display) }, ...dist };
  const valueRow = valueSlot(o, row.factRef);
  if (valueRow) vars.value = valueRow;
  if (f && t) {
    const scaled = scaledPhrase(base, fact, f.value);
    if (scaled) vars.scaled = { text: scaled, numbers: [t] };
    const ref = SUN_REFERENCE[fact];
    if (ref !== undefined) {
      const rp = ratioPhrase(fact, ref, f.value, 'than the Sun');
      if (rp) vars.ratioPhrase = { text: rp, numbers: [t] };
    }
  }
  return pick.line([key, base], vars, ['compare', i, row.factRef]);
}

/** Journey with the narrated texts written into the shared Journey fields (title, question, hook, story, stop texts). */
export function applyNarration(journey: Journey, nar: JourneyNarration): Journey {
  return {
    ...journey,
    title: nar.title.text,
    drivingQuestion: nar.drivingQuestion.text,
    hook: nar.hook.text,
    story: nar.story.text,
    ...(nar.payoff ? { payoff: nar.payoff.text } : {}),
    stops: journey.stops.map((s, i) => {
      const sn = nar.stops[i];
      const why = sn ? [sn.whyHere.text, sn.bridge?.text].filter(Boolean).join(' ') : undefined;
      return {
        ...s,
        transitionText: sn?.transition?.text ?? s.transitionText,
        ...(why ? { whyHereText: why } : {}),
        ...(sn?.skip ? { transitionSkipText: sn.skip.text } : {}),
      };
    }),
  };
}

/** Every line of a narration (for validators and judge rendering). */
export function allLines(nar: JourneyNarration): NarrationLine[] {
  const out: NarrationLine[] = [nar.title, nar.drivingQuestion, nar.hook, nar.story, ...nar.notices];
  if (nar.switchLine) out.push(nar.switchLine);
  if (nar.payoff) out.push(nar.payoff);
  if (nar.coda) out.push(nar.coda);
  for (const s of nar.stops) {
    out.push(s.whyHere, ...s.notices);
    for (const l of [s.bridge, s.transition, s.skip]) if (l) out.push(l);
    for (const num of s.numbers) if (num.comparison) out.push(num.comparison);
  }
  return out;
}

/** Doc 05 §8 validators: no unfilled {…}, no undefined/NaN, sentences ≤ 220 chars, sources resolve. */
export function narrationProblems(nar: JourneyNarration, kb?: Pick<KnowledgeBase, 'sources'>): string[] {
  const out: string[] = [];
  const sources = kb ? new Set(kb.sources.map((s) => s.id)) : null;
  for (const l of allLines(nar)) {
    if (/\{\w*\}/.test(l.text)) out.push(`${l.key}: unfilled placeholder in "${l.text}"`);
    if (/\bundefined\b|\bNaN\b|Infinity/.test(l.text)) out.push(`${l.key}: bad value in "${l.text}"`);
    if (!l.text.trim()) out.push(`${l.key}: empty text`);
    for (const sentence of l.text.split(/(?<=[.!?])\s+/)) if (sentence.length > 220) out.push(`${l.key}: sentence over 220 chars`);
    for (const num of l.numbers) {
      if (!num.sourceId) out.push(`${l.key}: number without source`);
      else if (sources && !sources.has(num.sourceId)) out.push(`${l.key}: unknown source ${num.sourceId}`);
    }
  }
  for (const s of nar.stops) for (const num of s.numbers) if (sources && !sources.has(num.sourceId)) out.push(`stop ${s.index}: number ${num.fact} cites unknown source ${num.sourceId}`);
  return out;
}

/** Narrate and apply in one call (engine integration point). */
export function narrateAndApply(journey: Journey, kb: KnowledgeBase, opts: NarrateOptions): { journey: Journey; narration: JourneyNarration } {
  const narration = narrateJourney(journey, kb, opts);
  return { journey: applyNarration(journey, narration), narration };
}
