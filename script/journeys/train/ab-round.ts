/**
 * Round options of the owner's A/B export (script/journeys/train/export-ab-pairs.ts): the nights of an N-pair round,
 * the diversity rules it is chosen under, its file, seed and pair ids, and the command line. Pure (no engine, no
 * file access), so tests import it directly; export-ab-pairs.ts re-exports everything here.
 */
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

/** Sites and binoculars of export-calibration-slates.ts SITES / OPTICS (the same keys). */
export type AbSiteName = 'San Francisco' | 'Colorado dark site' | 'London' | 'Sydney' | 'Santiago';
export type AbOpticName = '10x50' | '7x50';
export type TimeKind = 'dusk+1.5h' | '23:30';

export const PHASES = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'] as const;
export type Phase = (typeof PHASES)[number];

/** Round 1's diversity rules (12 pairs over 12 themes); roundRules scales them. */
export const ROUND1_MIN_THEMES = 9;
export const ROUND1_MAX_A6_PAIRS = 3;
export const ROUND1_MAX_PER_THEME = 4;

export const DEFAULT_ROUND = 'round1';
export const DEFAULT_PAIRS = 12;
/** Output file of a round: script/journeys/train/ab-<round>.json. */
export const roundFile = (round: string) => join(ROOT, `script/journeys/train/ab-${round}.json`);
export const DEFAULT_OUT = roundFile(DEFAULT_ROUND);
/** Side-balance seed of a round (round 1 keeps its original seed). */
export const roundSeed = (round: string) => (round === 'round1' ? 'ab-round-1' : `ab-${round}`);
/** Pair id prefix of a round: "round2" → "ab2", any other name → "ab-<name>". */
export const roundPrefix = (round: string) => { const m = /^round(\d+)$/.exec(round); return m ? `ab${m[1]}` : `ab-${round}`; };

/** One observing night of the round (the pair's two journeys are chosen globally, see chooseAll). */
export interface Spec { site: AbSiteName; month: number; phase: Phase; optic: AbOpticName; time: TimeKind }

/**
 * The 12 nights: 5 sites (2 southern), all eight Moon phases, both binoculars (6 each), both start times (6 each).
 * Which two journeys each night compares is decided globally (chooseAll), so the 12 comparisons all differ.
 */
export const SPECS: Spec[] = [
  { site: 'San Francisco', month: 1, phase: 'new', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'San Francisco', month: 11, phase: 'waxing-crescent', optic: '7x50', time: '23:30' },
  { site: 'Colorado dark site', month: 7, phase: 'new', optic: '10x50', time: '23:30' },
  { site: 'Colorado dark site', month: 10, phase: 'first-quarter', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Colorado dark site', month: 4, phase: 'waning-crescent', optic: '7x50', time: '23:30' },
  { site: 'London', month: 9, phase: 'waning-gibbous', optic: '10x50', time: '23:30' },
  { site: 'London', month: 12, phase: 'full', optic: '10x50', time: '23:30' },
  { site: 'London', month: 1, phase: 'last-quarter', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 7, phase: 'waxing-gibbous', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 5, phase: 'new', optic: '7x50', time: '23:30' },
  { site: 'Santiago', month: 4, phase: 'full', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'Santiago', month: 1, phase: 'first-quarter', optic: '7x50', time: 'dusk+1.5h' },
];

/**
 * More nights for rounds of more than 12 pairs (--pairs): the same sites, other months, phases, binoculars and times.
 */
export const EXTRA_SPECS: Spec[] = [
  { site: 'San Francisco', month: 4, phase: 'first-quarter', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'San Francisco', month: 8, phase: 'waning-crescent', optic: '7x50', time: '23:30' },
  { site: 'Colorado dark site', month: 1, phase: 'waxing-crescent', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'Colorado dark site', month: 9, phase: 'last-quarter', optic: '10x50', time: '23:30' },
  { site: 'London', month: 3, phase: 'new', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'London', month: 6, phase: 'waxing-gibbous', optic: '10x50', time: '23:30' },
  { site: 'Sydney', month: 1, phase: 'full', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 10, phase: 'waning-gibbous', optic: '10x50', time: '23:30' },
  { site: 'Santiago', month: 7, phase: 'new', optic: '10x50', time: '23:30' },
  { site: 'Santiago', month: 10, phase: 'waxing-crescent', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Colorado dark site', month: 6, phase: 'full', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 3, phase: 'last-quarter', optic: '10x50', time: 'dusk+1.5h' },
];

/** The nights of an N-pair round: the first N of SPECS, then EXTRA_SPECS (then the same nights a year later). */
export function specsFor(n: number): Spec[] {
  const all = [...SPECS, ...EXTRA_SPECS];
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const sp = all[i % all.length];
    return i < all.length ? sp : { ...sp, month: ((sp.month - 1 + Math.floor(i / all.length)) % 12) + 1 };
  });
}

/** The diversity rules of an N-pair round over `active` themes (12 pairs, 10 themes: 9 themes, ≤ 3 A6 pairs, ≤ 4 per theme). */
export interface RoundRules { pairs: number; minThemes: number; maxA6Pairs: number; maxPerTheme: number }
export function roundRules(n: number, active: number): RoundRules {
  return {
    pairs: n,
    minThemes: Math.max(2, Math.min(ROUND1_MIN_THEMES, active - 1, n + 2)),
    maxA6Pairs: Math.max(1, Math.round(n / 4)),
    maxPerTheme: Math.max(2, Math.ceil(n / 3)),
  };
}

/**
 * A hand-picked comparison (`--themes "A3:A7,A1:A9@Colorado dark site/7/new/10x50/23:30"`): two archetypes, and
 * optionally the night (site/month/phase[/optic[/time]]); without one, buildPickedFile searches the nights.
 */
export interface PickedPair { a: string; b: string; night: Spec | null }

const SITE_NAMES: readonly AbSiteName[] = ['San Francisco', 'Colorado dark site', 'London', 'Sydney', 'Santiago'];

export function parseThemes(s: string): PickedPair[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((item) => {
    const [pair, at] = item.split('@');
    const m = /^(A\d+)\s*[:|]\s*(A\d+)$/.exec(pair.trim());
    if (!m || m[1] === m[2]) throw new Error(`--themes "${item}": use two different archetypes, e.g. A3:A7`);
    if (!at) return { a: m[1], b: m[2], night: null };
    const [site, month, phase, optic = '10x50', time = 'dusk+1.5h'] = at.split('/').map((y) => y.trim());
    const st = SITE_NAMES.find((n) => n.toLowerCase() === site.toLowerCase());
    if (!st) throw new Error(`--themes "${item}": unknown site "${site}" (${SITE_NAMES.join(', ')})`);
    if (!(PHASES as readonly string[]).includes(phase)) throw new Error(`--themes "${item}": phase is one of ${PHASES.join(', ')}`);
    if (optic !== '10x50' && optic !== '7x50') throw new Error(`--themes "${item}": binoculars 10x50 or 7x50`);
    if (time !== 'dusk+1.5h' && time !== '23:30') throw new Error(`--themes "${item}": time dusk+1.5h or 23:30`);
    const mo = Number(month);
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) throw new Error(`--themes "${item}": month 1-12`);
    return { a: m[1], b: m[2], night: { site: st, month: mo, phase: phase as Phase, optic, time } };
  });
}

/**
 * Command-line options: --round <name> (default round1), --pairs N (default 12), --out <file> (default
 * ab-<round>.json), --themes <hand-picked comparisons> (parseThemes; sets the number of pairs).
 */
export function parseArgs(argv: readonly string[]): { round: string; pairs: number; out: string; show: number | null; preview: number; themes: PickedPair[] | null } {
  const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const round = get('round') ?? DEFAULT_ROUND;
  if (!/^[\w-]+$/.test(round)) throw new Error(`--round "${round}": use letters, digits, - or _`);
  const themesArg = get('themes');
  const themes = themesArg ? parseThemes(themesArg) : null;
  const pairs = Number(get('pairs') ?? (themes ? themes.length : DEFAULT_PAIRS));
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 48) throw new Error(`--pairs ${get('pairs')}: a whole number from 1 to 48`);
  if (themes && pairs !== themes.length) throw new Error(`--pairs ${pairs} but --themes names ${themes.length} comparisons`);
  const show = get('show');
  return { round, pairs, out: resolve(get('out') ?? roundFile(round)), show: show ? Number(show) : null, preview: Number(get('preview') ?? '1'), themes };
}
