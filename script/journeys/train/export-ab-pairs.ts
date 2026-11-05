/**
 * Sky Journeys, owner A/B rounds (owner feedback r1, "Process"): PAIRS instead of ranking slates of four (12 by
 * default; `--pairs N`). Round 2 (owner feedback r2) adds each stop's theme lens and the card exactly as the app
 * resolves it (lib/journeys/stop-card.ts), so a page renders `resolved` with no logic, and uses only active themes
 * (A4 and A10 are retired as journeys).
 * The product owner reads two complete journeys planned for the same night and answers Left / Right / Equal /
 * Neither, with an optional note.
 *
 * Each pair is ONE observing night (site + date + start time + binoculars, the app's default request: 5 stops,
 * 30° floor, one challenge stop allowed) and TWO complete, valid journeys from the current engine on the current KB.
 * Both sides come from the TOP of that night's pool, the ranked list the app's own suggestions are drawn from
 * (generate's inspectPool): good journeys of the strict tier (no relaxation, no independent violation, no lecturer
 * veto flag) whose score is at least MIN_SCORE_PCT of the pool's range, the best PER_ARCHETYPE per archetype (a pool
 * holds dozens of variants of one story), plus the app's own three suggestions. So both sides are journeys the app
 * could show, and the owner judges stories, not leftovers.
 *
 * Twelve DIFFERENT comparisons (second pass of round 1): one global choice over the 12 nights (chooseAll, an exact
 * branch and bound; a side costs 10 × (1 − its normalised score)) such that
 *   - no two pairs compare the same two archetypes (theme pair, e.g. A3 vs A6),
 *   - the contrast tours (A6) appear in at most MAX_A6_PAIRS pairs,
 *   - the 24 sides cover at least MIN_THEMES of the 12 archetypes,
 * and the two sides of a pair are of different archetypes, share fewer than 2 stops and differ in title. Only when no
 * choice meets these rules does the score floor step down (MIN_SCORE_PCT).
 * Each pair's hypothesis names what it tests, most specific first: the app's own suggestions against each other
 * (app-top), a distance ladder against a contrast tour, doubles against variables, deep-sky against stars, a
 * challenge stop against none, else two themes (theme-vs-theme).
 *
 * Left/right is balanced: a seeded half of the pairs shows the engine's preferred side on the left. `hidden` holds
 * the hypothesis, each side's engine score, pool rank, app rank and role, so the owner answers blind and the key
 * stays in the same file.
 *
 * Every journey carries what the owner judges (titles, question, story, payoff, per-stop texts, the card's question,
 * see, story, answer, wonder and connect, glossary terms, the picture, the link); every pair carries the conditions
 * and a sky block for an interactive map: stars to V 5.0 above the horizon (alt/az and ra/dec), constellation stick
 * figures in alt/az for the constellations above the horizon, and the Moon. The glossary entries used are included
 * once at the top.
 *
 * Run from the repository root through the CommonJS launcher (tsx's ESM mode cannot see astronomy-engine's CJS
 * exports, see run-export.cts):
 *   npx tsx script/journeys/train/export-ab-pairs.cts [--round round2] [--pairs 12] [--out <file>] [--preview 1]
 *   npx tsx script/journeys/train/export-ab-pairs.cts --round round2 --show 3     print pair 3 of the existing file
 * `--round <name>` writes script/journeys/train/ab-<name>.json, seeds the side balance with it and numbers the pairs
 * "ab<k>-NN" (k = the round's number, e.g. round2 → ab2-01). Without --round: round1 (ab-round1.json, ab1-NN).
 * With fewer pairs than nights the round takes the first N nights and scales its rules (roundRules); with more, it
 * adds nights from EXTRA_SPECS.
 * `--themes "A3:A7,A1:A9@Colorado dark site/7/new/10x50/23:30"` builds a hand-picked round instead (buildPickedFile):
 * one pair per theme pair, each side the app's first journey with the theme picker set to that theme.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as AstroNs from 'astronomy-engine';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { generate, rebuildJourney, type PoolInfo } from '../../../client/src/lib/journeys/assemble';
import { fastAltAz, ofDateConverter } from '../../../client/src/lib/journeys/conditions';
import { findGlossaryTerms, glossaryEntries, plainClass, type Glossary, type GlossaryEntry } from '../../../client/src/lib/journeys/plain-language';
import { rngFor } from '../../../client/src/lib/journeys/seed';
import { resolveStopCard } from '../../../client/src/lib/journeys/stop-card';
import { independentProblems } from '../../../client/src/lib/journeys/__tests__/engine-helpers';
import { getConstellationName } from '../../../client/src/lib/astronomy';
import type { Journey, JourneyRequest, JourneyResult, KbImage, KbObject, KnowledgeBase } from '../../../client/src/lib/journeys/types';
import { journeyFlags } from '../eval/run-grid';
import {
  DEFAULT_OUT, DEFAULT_PAIRS, DEFAULT_ROUND, PHASES, ROUND1_MAX_A6_PAIRS, ROUND1_MAX_PER_THEME, ROUND1_MIN_THEMES, SPECS, parseArgs,
  roundPrefix, roundRules, roundSeed, specsFor, EXTRA_SPECS, type Phase, type PickedPair, type RoundRules, type Spec, type TimeKind,
} from './ab-round';
import { OPTICS, SITES, identOf, instantFor, loadRealKb, phaseName, seasonOf } from './export-calibration-slates';

export * from './ab-round';

const Astro = ((AstroNs as unknown as { default?: typeof AstroNs }).default ?? AstroNs) as typeof AstroNs;
const ROOT = process.cwd();
export const FORMAT_VERSION = 'ab-pairs-3';
/** Faintest star in the sky block. */
export const SKY_MAG_LIMIT = 5.0;

// ───────────────────────────── nights ─────────────────────────────

type SiteName = keyof typeof SITES;
type OpticName = keyof typeof OPTICS;
const PHASE_LON: Record<Phase, number> = {
  new: 0, 'waxing-crescent': 45, 'first-quarter': 90, 'waxing-gibbous': 135, full: 180, 'waning-gibbous': 225, 'last-quarter': 270, 'waning-crescent': 315,
};
export const HYPOTHESES = ['app-top', 'ladder-vs-contrast', 'doubles-vs-variables', 'dso-vs-stars', 'challenge-vs-none', 'theme-vs-theme', 'picked'] as const;
export type Hypothesis = (typeof HYPOTHESES)[number];

export const HYPOTHESIS_TEXT: Record<Hypothesis, string> = {
  'app-top': 'Two of the app\'s own three suggestions for this night, with different themes: does the engine\'s order match yours?',
  'ladder-vs-contrast': 'A distance ladder (each stop farther than the last) against a Contrasts tour: does a clear progression with a payoff beat a set of neighbours that differ?',
  'doubles-vs-variables': 'Seeing Double against Stars That Change: which story works better on the same sky?',
  'dso-vs-stars': 'A journey mostly of clusters, nebulae and galaxies against one mostly of stars: which do you prefer?',
  'challenge-vs-none': 'One journey has a challenge stop and the other has none: is the challenge a plus?',
  'theme-vs-theme': 'Two strong journeys with different themes on the same sky: which story would you rather follow tonight?',
  picked: 'A hand-picked comparison (--themes): each side is the app\'s first journey for this night with the theme picker set to that theme.',
};

/**
 * How good a side must be: its score normalised over the night's pool (1 = the pool's best, 0 = its worst), lowered
 * in this order only until the round's rules can be met. The app's own suggestions always qualify.
 */
export const MIN_SCORE_PCT = [0.6, 0.45, 0.3] as const;
/** Good journeys kept per archetype and night (the best ones): pools hold dozens of variants of one story. */
export const PER_ARCHETYPE = 3;
/** At most this many pairs may show a contrast tour (A6) on either side. */
export const MAX_A6_PAIRS = ROUND1_MAX_A6_PAIRS;
/** The 24 sides together cover at least this many of the 12 archetypes. */
export const MIN_THEMES = ROUND1_MIN_THEMES;
/** No archetype appears in more than this many pairs, so the owner is not shown the same story over and over. */
export const MAX_PER_THEME = ROUND1_MAX_PER_THEME;
/** A side costs 10 × (1 − its normalised score); a pair of two of the app's own suggestions earns this credit. */
const APP_PAIR_CREDIT = 1;
/** Credit per archetype the round covers (drives coverage beyond MIN_THEMES when it is cheap). */
const THEME_CREDIT = 1;

/** Local evening date (yyyy-MM-dd) of the night that contains `t` at this site. */
const nightDateOf = (t: Date, tz: string) => formatInTimeZone(new Date(t.getTime() - 12 * 3_600_000), tz, 'yyyy-MM-dd');

/** The night (local evening date) of the `phase` moment nearest the 15th of `month` 2027. */
export function nightOfPhase(site: SiteName, month: number, phase: Phase): { date: string; eventUtc: string } {
  const { tz } = SITES[site];
  const mid = fromZonedTime(`2027-${String(month).padStart(2, '0')}-15T22:00:00`, tz);
  const a = Astro.SearchMoonPhase(PHASE_LON[phase], new Date(mid.getTime() - 16 * 86_400_000), 40);
  if (!a) throw new Error(`no ${phase} Moon near 2027-${month}-15`);
  return { date: nightDateOf(a.date, tz), eventUtc: a.date.toISOString() };
}

// ───────────────────────────── sky block ─────────────────────────────

interface BscRow { HR: string; N?: string; B?: string; C?: string; F?: string; V?: string; RA: string; Dec: string }
interface SkyStar { hr: number; name: string | null; con: string | null; mag: number; ra: number; dec: number }

const parseRa = (s: string) => { const m = /(\d+)h\s*(\d+)m\s*([\d.]+)s/.exec(s)!; return 15 * (+m[1] + +m[2] / 60 + +m[3] / 3600); };
const parseDec = (s: string) => {
  const m = /([+-−])?(\d+)°\s*(\d+)′\s*([\d.]+)″/.exec(s)!;
  const v = +m[2] + +m[3] / 60 + +m[4] / 3600;
  return m[1] === '-' || m[1] === '−' ? -v : v;
};

/** BSC stars to V 5.0; the name is the proper name, else Bayer or Flamsteed + constellation, else null. */
export function skyStars(): SkyStar[] {
  const rows = JSON.parse(readFileSync(join(ROOT, 'client/public/data/bsc5-short.json'), 'utf8')) as BscRow[];
  return rows.filter((r) => r.V !== undefined && +r.V <= SKY_MAG_LIMIT).map((r) => ({
    hr: +r.HR,
    name: r.N ?? ((r.B ?? r.F) && r.C ? `${r.B ?? r.F} ${r.C}` : null),
    con: r.C ?? null,
    mag: +r.V!, ra: r3(parseRa(r.RA)), dec: r3(parseDec(r.Dec)),
  }));
}

interface LineFeature { id: string; geometry: { coordinates: [number, number][][] } }
export function constellationLines(): LineFeature[] {
  return (JSON.parse(readFileSync(join(ROOT, 'client/public/data/constellations.lines.json'), 'utf8')) as { features: LineFeature[] }).features;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function altAzAt(ms: number, lat: number, lon: number) {
  const conv = ofDateConverter(ms);
  const gast = Astro.SiderealTime(new Date(ms)) * 15;
  return (ra: number, dec: number) => { const p = conv.raDec(ra, dec); return fastAltAz(p.ra, p.dec, lat, lon, gast); };
}

// ───────────────────────────── output shapes ─────────────────────────────

export interface AbImage { src: string; large: string | null; credit: string; license: string; caption: string | null; fieldDeg: number | null; variant: string | null; sourceUrl: string | null }

export interface AbStop {
  n: number;
  objectId: string;
  name: string;
  designation: string | null;
  kind: 'star' | 'dso';
  plainClass: string;
  con: string;
  constellation: string;
  mag: number | null;
  role: string;
  arc: string;
  startLocal: string;
  altDeg: number;
  azDeg: number;
  ra: number;
  dec: number;
  challenge: boolean;
  getThere: { mode: string; distanceDeg: number; fields: number; text: string };
  whyHere: string;
  transitionText: string | null;
  /** The stop card in the owner's order (question, see, story = understand, answer; wonder and connect may be empty). */
  card: { question: string; glance: string; see: string; understand: string; answer: string; wonder: string; connect: string; tier: 'showpiece' | 'supporting' };
  /** Glossary term ids found in this stop's texts (get there, why here, transition, card). */
  glossary: string[];
  image: AbImage | null;
  link: { type: string; subtype: string; strength: number; curated: boolean } | null;
  /** The theme lens the stop is told through (owner feedback r2), or null for a theme without lenses. */
  lens: { step: number; rank: number | null; beat: string; question: string; why: string; look: string | null; answer: string; story: string | null } | null;
  /**
   * The card exactly as the app shows it (lib/journeys/stop-card.ts resolveStopCard): beat chip, question, the
   * transition then why, what to look at, the story (`story` = the lens's own story for this theme when it has one;
   * then `understand`, the object's shared story, belongs under a collapsed "More about {name}"; with `story` null,
   * `understand` is the story), the answer, the wonder line, and the journey's payoff on its payoff stop (no label).
   * A page renders these fields as they are.
   */
  resolved: { beat: string; question: string | null; transition: string | null; why: string; look: string; story: string | null; understand: string; answer: string | null; wonder: string; payoff: string | null };
}

export interface AbJourney {
  side: 'left' | 'right';
  key: string;
  title: string;
  drivingQuestion: string;
  hook: string;
  story: string;
  payoff: string | null;
  templateId: string;
  templateName: string;
  switch: { atStop: number; toTemplateId: string; toTemplateName: string } | null;
  durationMin: number;
  difficulty: string;
  difficultyReason: string | null;
  totalPathDeg: number;
  regionLabel: string;
  stops: AbStop[];
}

export interface AbHiddenSide {
  side: 'left' | 'right';
  key: string;
  /** What this side stands for in the hypothesis ("app #1", "distance ladder", "with a challenge stop", …). */
  role: string;
  templateId: string;
  score: number;
  /** 0-based rank in the pool the app's suggestions are drawn from (inspectPool: strict tier first, then by score). */
  poolRank: number;
  /** 0-based rank among the night's good journeys (strict, valid, no veto flag, the best PER_ARCHETYPE per archetype). */
  goodRank: number;
  /** Score normalised over the night's pool (1 = the pool's best, 0 = its worst). */
  scorePct: number;
  /** Position (0..2) among the app's 3 suggestions for this night, or null. */
  appRank: number | null;
  /** pool / app: drawn from the default request; theme: the app's first journey with the theme picker set (--themes). */
  source: 'pool' | 'app' | 'theme';
  flags: string[];
  relaxed: string[];
}

export interface AbPair {
  id: string;
  n: number;
  context: {
    site: string; lat: number; lon: number; timezone: string; hemisphere: 'north' | 'south'; season: string;
    localDate: string; localTime: string; instantUtc: string; timeKind: TimeKind; timeNote?: string;
    binoculars: { name: OpticName; fovDeg: number; magnification: number; aperture: number };
    skyBrightness: number; minAlt: number; length: number;
  };
  conditions: {
    darkness: string; sunAltDeg: number;
    darkWindowLocal: { start: string | null; end: string | null };
    moon: { phaseRequested: Phase; phase: string; illumination: number; up: boolean; altDeg: number; azDeg: number; minSepDeg: number; riseLocal: string | null; setLocal: string | null };
    message: string;
  };
  sky: {
    magLimit: number;
    moon: { altDeg: number; azDeg: number; illumination: number; up: boolean; phase: string };
    stars: { hr: number; name: string | null; con: string | null; mag: number; ra: number; dec: number; altDeg: number; azDeg: number }[];
    /** Stick figures of every constellation with a vertex above the horizon; each polyline is [altDeg, azDeg] points. */
    lines: { con: string; name: string; polylines: [number, number][][] }[];
  };
  journeys: [AbJourney, AbJourney];
  hidden: {
    hypothesis: Hypothesis; question: string;
    /** The two archetypes compared, sorted ("A3|A6"): unique across the round. */
    themePair: string;
    /** Other ways the two sides differ (challenge stop, deep-sky share, length), for reading the answer. */
    contrasts: string[];
    sides: [AbHiddenSide, AbHiddenSide];
    poolSize: number;
    /** The lowest normalised score a side could have in this round (MIN_SCORE_PCT step used). */
    minScorePct: number;
    appTop3: string[];
    notes: string[];
  };
}

export interface AbFile {
  version: string;
  round: string;
  /** The diversity rules this round was chosen under (roundRules). */
  rules: RoundRules;
  generatedBy: string;
  kbVersion: string;
  engineScorer: string;
  instructions: string;
  answerOptions: ['left', 'right', 'equal', 'neither'];
  glossary: GlossaryEntry[];
  pairs: AbPair[];
}

// ───────────────────────────── candidates ─────────────────────────────

/** A journey that may stand in a pair: valid, narrated, near the top of its night's pool. */
export interface Cand {
  j: Journey;
  /** Rank in the night's pool (inspectPool order). */
  poolRank: number;
  /** Rank among the night's good journeys. */
  goodRank: number;
  /** Score normalised over the night's pool (1 = best, 0 = worst). */
  scorePct: number;
  appRank: number | null;
  source: AbHiddenSide['source'];
  flags: string[];
  relaxed: string[];
}

const stopIds = (j: Journey) => j.stops.map((s) => s.objectId);
const shared = (a: Journey, b: Journey) => { const A = new Set(stopIds(a)); return stopIds(b).filter((x) => A.has(x)).length; };
/** Two journeys a pair may show together: fewer than 2 shared stops, and not the same archetype over the same region. */
const regionOf = (j: Journey) => j.regionName ?? j.regionCenter.label;
export const distinctPair = (a: Journey, b: Journey) =>
  shared(a, b) < 2 && !(a.templateId === b.templateId && (regionOf(a) === regionOf(b) || a.regionCenter.label === b.regionCenter.label)) && a.title.trim() !== b.title.trim();

/** Archetype of a journey ("A6-contrasts" → "A6"). */
export const archOf = (j: Pick<Journey, 'templateId'>) => j.templateId.split('-')[0];
/** Does the journey tell a contrast tour (A6), as its template or after a switch? */
export const tellsA6 = (j: Pick<Journey, 'templateId' | 'switch'>) => archOf(j) === 'A6' || (!!j.switch && j.switch.toTemplateId.startsWith('A6-'));
/** The pair's two archetypes, sorted: "A3|A6". */
export const themePairOf = (a: Journey, b: Journey) => [archOf(a), archOf(b)].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))).join('|');

const LADDER = new Set(['A3', 'A4']);
const dsoShare = (j: Journey, byId: Map<string, KbObject>) => j.stops.filter((s) => byId.get(s.objectId)?.kind === 'dso').length / j.stops.length;
const hasChallenge = (j: Journey) => j.stops.some((s) => s.challenge);
/** Lecturer vetoes (run-grid's "good" journey: none of these flags). */
const VETO = /^(faint-payoff|member-adjacent|challenge-payoff|generic-transition)/;

/** Soft flags beyond run-grid's lecturer flags (same as the calibration export). */
function extraFlags(j: Journey): string[] {
  const out: string[] = [];
  const links = j.stops.slice(1).map((s) => s.link!);
  if (links.some((l) => l.strength < 0.5)) out.push(`weak-link:${Math.min(...links.map((l) => l.strength))}`);
  if (j.stops.some((s) => s.challenge)) out.push('challenge-stop');
  if (j.stops.some((s) => s.altAtStart < 35)) out.push(`low-stop:${Math.round(Math.min(...j.stops.map((s) => s.altAtStart)))}°`);
  if (links.length && links.every((l) => !l.curated)) out.push('no-curated-link');
  return out;
}

/** What the pair tests, most specific first, and the role each side stands for (in the order a, b). */
export function classifyPair(a: Cand, b: Cand, byId: Map<string, KbObject>): { hypothesis: Hypothesis; roles: [string, string] } {
  const A = archOf(a.j), B = archOf(b.j);
  const da = dsoShare(a.j, byId), db = dsoShare(b.j, byId);
  const ca = hasChallenge(a.j), cb = hasChallenge(b.j);
  const swap = (x: [string, string], flip: boolean): [string, string] => (flip ? [x[1], x[0]] : x);
  if (a.appRank !== null && b.appRank !== null) return { hypothesis: 'app-top', roles: [`app #${a.appRank + 1}`, `app #${b.appRank + 1}`] };
  if ((LADDER.has(A) && B === 'A6') || (LADDER.has(B) && A === 'A6')) return { hypothesis: 'ladder-vs-contrast', roles: swap(['distance ladder', 'contrasts'], A === 'A6') };
  if ((A === 'A9' && B === 'A10') || (A === 'A10' && B === 'A9')) return { hypothesis: 'doubles-vs-variables', roles: swap(['seeing double', 'stars that change'], A === 'A10') };
  if ((da >= 0.6 && db <= 0.2) || (db >= 0.6 && da <= 0.2)) return { hypothesis: 'dso-vs-stars', roles: swap(['deep-sky heavy', 'star heavy'], db >= 0.6) };
  if (ca !== cb) return { hypothesis: 'challenge-vs-none', roles: swap(['with a challenge stop', 'no challenge stop'], cb) };
  return { hypothesis: 'theme-vs-theme', roles: [a.j.title, b.j.title] };
}

/** Other ways the left and right journeys differ, for reading the owner's answer. */
export function contrastsOf(left: Journey, right: Journey, byId: Map<string, KbObject>): string[] {
  const out: string[] = [];
  const cl = hasChallenge(left), cr = hasChallenge(right);
  if (cl !== cr) out.push(`challenge stop on the ${cl ? 'left' : 'right'} only`);
  const dl = dsoShare(left, byId), dr = dsoShare(right, byId);
  if (Math.abs(dl - dr) >= 0.4) out.push(`deep-sky share ${Math.round(dl * 100)}% (left) vs ${Math.round(dr * 100)}% (right)`);
  if (left.stops.length !== right.stops.length) out.push(`${left.stops.length} (left) vs ${right.stops.length} (right) stops`);
  return out;
}

/** Everything one night offers the round: the app's answer, its pool, and the good journeys at the top of it. */
export interface NightCands {
  spec: Spec;
  req: JourneyRequest;
  night: { date: string; eventUtc: string };
  note?: string;
  app: JourneyResult;
  poolSize: number;
  /** Good journeys, best first (goodRank = index). */
  cands: Cand[];
  notes: string[];
  /** What a hand-picked pair asks the owner (buildPickedFile), shown as hidden.question. */
  question?: string;
}

/**
 * The night's candidates: the app's own three suggestions and, per archetype, the PER_ARCHETYPE best good journeys of
 * the strict tier of the pool the app drew them from (inspectPool), narrated and re-validated from their keys.
 */
export function nightCandidates(kb: KnowledgeBase, spec: Spec): NightCands {
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const { req, night, note } = requestFor(spec);
  let pool: readonly Journey[] = [];
  let info: readonly PoolInfo[] = [];
  const app = generate(kb, req, { inspectPool: (p, i) => { pool = p; info = i; } });
  const moonIll = app.conditions?.moon.up ? app.conditions.moon.illumination : 0;
  const appRankOf = new Map(app.journeys.map((j, k) => [identOf(j), k] as const));
  const scores = pool.map((j) => j.score);
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const pct = (x: number) => (hi > lo ? Math.round((1000 * (x - lo)) / (hi - lo)) / 1000 : 1);
  const notes: string[] = [];
  const cands: Cand[] = [];
  const perArch = new Map<string, number>();
  // Only active themes (owner feedback r2 retired A4 and A10 as journeys): the KB's templates, neither side switching
  // into a theme that is not one.
  const active = new Set(kb.templates.map((t) => t.id));
  const strict: JourneyResult = { journeys: [], diagnostics: { ...app.diagnostics, relaxed: [] } };
  let good = 0;
  pool.forEach((raw, rank) => {
    const appRank = appRankOf.get(identOf(raw)) ?? null;
    if (!active.has(raw.templateId) || (raw.switch && !active.has(raw.switch.toTemplateId))) return;
    if (appRank === null && (info[rank].tier !== 0 || (perArch.get(archOf(raw)) ?? 0) >= PER_ARCHETYPE)) return;
    // The app's copy is the one the user sees; pool entries are narrated by rebuilding them from their keys.
    let j: Journey, res: JourneyResult;
    if (appRank !== null) { j = app.journeys[appRank]; res = app; } else {
      const r = rebuildJourney(kb, raw.key, req);
      if (!r.valid || !r.journey) { notes.push(`pool #${rank} did not rebuild: ${r.problems.join('; ')}`); return; }
      j = { ...r.journey, score: raw.score };
      res = strict;
    }
    if (independentProblems(kb, req, res, j).length) { notes.push(`pool #${rank} failed the independent check`); return; }
    const flags = [...journeyFlags(j, kb, byId, moonIll), ...extraFlags(j)];
    if (flags.some((f) => VETO.test(f))) return;
    perArch.set(archOf(raw), (perArch.get(archOf(raw)) ?? 0) + 1);
    cands.push({ j, poolRank: rank, goodRank: good++, scorePct: pct(raw.score), appRank, source: appRank !== null ? 'app' : 'pool', flags, relaxed: appRank !== null ? [...(j.conditions?.relaxed ?? [])] : [] });
  });
  return { spec, req, night, ...(note ? { note } : {}), app, poolSize: pool.length, cands, notes };
}

interface PairOption { a: Cand; b: Cand; cost: number; themePair: string; a6: boolean; themes: string[] }

/** Every pair a night may show from its journeys scoring at least `minPct` (plus the app's), cheapest first. */
export function pairOptions(n: NightCands, minPct: number): PairOption[] {
  const xs = n.cands.filter((c) => c.scorePct >= minPct || c.appRank !== null);
  const out: PairOption[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let k = i + 1; k < xs.length; k++) {
      const a = xs[i], b = xs[k];
      if (archOf(a.j) === archOf(b.j) || !distinctPair(a.j, b.j)) continue;
      const both = a.appRank !== null && b.appRank !== null;
      const cost = Math.round(1000 * (10 * (2 - a.scorePct - b.scorePct) - (both ? APP_PAIR_CREDIT : 0))) / 1000;
      out.push({ a, b, cost, themePair: themePairOf(a.j, b.j), a6: tellsA6(a.j) || tellsA6(b.j), themes: [archOf(a.j), archOf(b.j)] });
    }
  }
  return out.sort((x, y) => x.cost - y.cost || x.a.goodRank - y.a.goodRank || x.b.goodRank - y.b.goodRank || x.a.j.key.localeCompare(y.a.j.key) || x.b.j.key.localeCompare(y.b.j.key));
}

/** Story of a journey for the no-repeat rule: its archetype and region ("A9|Cygnus"). */
const storyOf = (j: Journey) => `${archOf(j)}|${regionOf(j)}`;
/** Options kept per night and theme pair. */
const OPTIONS_PER_THEME_PAIR = 3;

/** Search nodes before chooseAll settles for the best round found so far. */
const NODE_LIMIT = 3_000_000;

/**
 * One pair per night, chosen together: unique theme pairs, no story (archetype + region) shown twice, at most MAX_PER_THEME pairs
 * per archetype, at most MAX_A6_PAIRS pairs with a contrast tour, at least
 * MIN_THEMES archetypes over the round; among those, the lowest total cost minus THEME_CREDIT per archetype covered.
 * Constraints only see a pair's theme pair, so each night keeps its OPTIONS_PER_THEME_PAIR cheapest options per theme pair (so the no-repeat rule has alternatives); then an exact
 * depth-first branch and bound (nights with the fewest options first; bound = cost so far + each remaining night's
 * cheapest option, and the archetypes still reachable). Deterministic; null when no round meets the rules.
 */
export function chooseAll(nights: readonly NightCands[], minPct: number, rules: Pick<RoundRules, 'minThemes' | 'maxA6Pairs' | 'maxPerTheme'> = { minThemes: MIN_THEMES, maxA6Pairs: MAX_A6_PAIRS, maxPerTheme: MAX_PER_THEME }): PairOption[] | null {
  const opts = nights.map((n) => {
    const best = new Map<string, PairOption[]>();
    for (const o of pairOptions(n, minPct)) {
      const xs = best.get(o.themePair) ?? [];
      if (xs.length < OPTIONS_PER_THEME_PAIR) best.set(o.themePair, [...xs, o]);
    }
    return Array.from(best.values()).flat().sort((x, y) => x.cost - y.cost);
  });
  if (opts.some((o) => !o.length)) return null;
  const order = nights.map((_, i) => i).sort((a, b) => opts[a].length - opts[b].length || a - b);
  const N = order.length;
  const minRest: number[] = new Array(N + 1).fill(0);
  const themesRest: Set<string>[] = Array.from({ length: N + 1 }, () => new Set<string>());
  for (let k = N - 1; k >= 0; k--) {
    minRest[k] = minRest[k + 1] + Math.min(...opts[order[k]].map((o) => o.cost));
    themesRest[k] = new Set([...Array.from(themesRest[k + 1]), ...opts[order[k]].flatMap((o) => o.themes)]);
  }
  const picks: PairOption[] = new Array(N);
  const usedPairs = new Set<string>();
  /** Stories already shown (archetype + region): the same journey never appears in two pairs. */
  const usedTitles = new Set<string>();
  const themeCount = new Map<string, number>();
  let best: { obj: number; picks: PairOption[] } | null = null;
  let nodes = 0;
  const dfs = (k: number, cost: number, a6: number): void => {
    if (++nodes > NODE_LIMIT) return;
    if (k === N) {
      const obj = cost - THEME_CREDIT * themeCount.size;
      if (themeCount.size >= rules.minThemes && (!best || obj < best.obj - 1e-9)) best = { obj, picks: picks.slice() };
      return;
    }
    const reachable = new Set([...Array.from(themeCount.keys()), ...Array.from(themesRest[k])]).size;
    if (reachable < rules.minThemes) return;
    if (best && cost + minRest[k] - THEME_CREDIT * reachable >= best.obj - 1e-9) return;
    for (const o of opts[order[k]]) {
      if (usedPairs.has(o.themePair) || (o.a6 && a6 >= rules.maxA6Pairs)) continue;
      if (o.themes.some((t) => (themeCount.get(t) ?? 0) >= rules.maxPerTheme)) continue;
      if (usedTitles.has(storyOf(o.a.j)) || usedTitles.has(storyOf(o.b.j))) continue;
      usedPairs.add(o.themePair);
      usedTitles.add(storyOf(o.a.j)); usedTitles.add(storyOf(o.b.j));
      for (const t of o.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
      picks[order[k]] = o;
      dfs(k + 1, cost + o.cost, a6 + (o.a6 ? 1 : 0));
      for (const t of o.themes) { const c = themeCount.get(t)! - 1; if (c) themeCount.set(t, c); else themeCount.delete(t); }
      usedPairs.delete(o.themePair);
      usedTitles.delete(storyOf(o.a.j)); usedTitles.delete(storyOf(o.b.j));
    }
  };
  dfs(0, 0, 0);
  return (best as { picks: PairOption[] } | null)?.picks ?? null;
}

// ───────────────────────────── one pair ─────────────────────────────

/** The picture the app shows first (StopCard.choosePhoto): the first optical image, else the first non-infrared. */
function shownImage(o: KbObject): KbImage | undefined {
  return o.media.images.find((i) => i.variant !== 'infrared' && i.variant !== 'illustration') ?? o.media.images.find((i) => i.variant !== 'infrared');
}

function stopOut(j: Journey, i: number, byId: Map<string, KbObject>, tz: string, glossary: Glossary, used: Set<string>): AbStop {
  const s = j.stops[i];
  const o = byId.get(s.objectId)!;
  const img = shownImage(o);
  const card = {
    question: o.card.question ?? '', glance: o.card.glance, see: o.card.see, understand: o.card.understand,
    answer: o.card.answer ?? '', wonder: o.card.wonder ?? '', connect: o.card.connect ?? '', tier: o.card.tier,
  };
  const whyHere = s.whyHereText ?? o.card.whyHere;
  const r = resolveStopCard(j, s, o);
  const resolved = { beat: r.beat, question: r.question, transition: r.transition, why: r.why, look: r.look, story: r.story, understand: r.understand, answer: r.answer, wonder: r.wonder, payoff: r.payoff };
  const lens = s.lens ? { step: s.lens.step, rank: s.lens.rank ?? null, beat: s.lens.beat, question: s.lens.question, why: s.lens.why, look: s.lens.look ?? null, answer: s.lens.answer, story: s.lens.story ?? null } : null;
  const texts = [s.getThere.bearingText, whyHere, s.transitionText ?? '', card.question, card.glance, card.see, card.understand, card.answer, card.wonder, card.connect,
    resolved.question ?? '', resolved.look, resolved.story ?? '', resolved.answer ?? '', resolved.payoff ?? ''];
  const terms = Array.from(new Set(texts.flatMap((t) => findGlossaryTerms(t, glossary).map((h) => h.id)))).sort();
  for (const t of terms) used.add(t);
  return {
    n: i + 1,
    objectId: o.id,
    name: o.names.display,
    designation: o.names.designation ?? null,
    kind: o.kind,
    plainClass: plainClass(o),
    con: o.con,
    constellation: getConstellationName(o.con),
    mag: o.mag,
    role: s.role,
    arc: s.arc,
    startLocal: formatInTimeZone(new Date(s.windowStart), tz, 'HH:mm'),
    altDeg: r1(s.altAtStart),
    azDeg: r1(s.azAtStart),
    ra: r3(o.ra),
    dec: r3(o.dec),
    challenge: s.challenge,
    getThere: { mode: s.getThere.mode, distanceDeg: r1(s.getThere.distanceDeg), fields: r1(s.getThere.fields), text: s.getThere.bearingText },
    whyHere,
    transitionText: s.transitionText,
    card,
    glossary: terms,
    image: img && existsSync(join(ROOT, 'client/public', img.src))
      ? { src: img.src, large: img.large ?? null, credit: img.credit, license: img.license, caption: img.caption ?? null, fieldDeg: img.fieldDeg ?? null, variant: img.variant ?? null, sourceUrl: img.sourceUrl ?? null }
      : null,
    link: s.link ? { type: s.link.type, subtype: s.link.subtype, strength: s.link.strength, curated: s.link.curated } : null,
    lens,
    resolved,
  };
}

function journeyOut(j: Journey, side: 'left' | 'right', kb: KnowledgeBase, byId: Map<string, KbObject>, tz: string, glossary: Glossary, used: Set<string>): AbJourney {
  const tname = (id: string) => kb.templates.find((t) => t.id === id)?.title ?? id;
  return {
    side, key: j.key,
    title: j.title, drivingQuestion: j.drivingQuestion, hook: j.hook, story: j.story ?? '', payoff: j.payoff ?? null,
    templateId: j.templateId, templateName: tname(j.templateId),
    switch: j.switch ? { atStop: j.switch.atStop + 1, toTemplateId: j.switch.toTemplateId, toTemplateName: tname(j.switch.toTemplateId) } : null,
    durationMin: j.durationMin, difficulty: j.difficulty, difficultyReason: j.difficultyReason ?? null,
    totalPathDeg: r1(j.totalPathDeg), regionLabel: j.regionCenter.label,
    stops: j.stops.map((_, i) => stopOut(j, i, byId, tz, glossary, used)),
  };
}

export function requestFor(spec: Spec): { req: JourneyRequest; night: { date: string; eventUtc: string }; note?: string } {
  const site = SITES[spec.site];
  const night = nightOfPhase(spec.site, spec.month, spec.phase);
  const t = spec.time === '23:30' ? { instant: fromZonedTime(`${night.date}T23:30:00`, site.tz) } : instantFor(spec.site, night.date, 'dusk+1.5h');
  return {
    req: {
      instant: t.instant.toISOString(), lat: site.lat, lon: site.lon, timezone: site.tz,
      instrument: OPTICS[spec.optic], skyBrightness: site.sky, theme: null, length: 5, minAlt: 30,
      includeChallenge: true, limit: 3, shuffle: 0, seenObjectIds: [],
    },
    night,
    ...('note' in t && t.note ? { note: t.note } : {}),
  };
}

/**
 * The output pair for one night and its chosen two journeys. `higherLeft`: show the side with the higher engine score
 * on the left (balanced over the round by buildFile, so the side never reveals the engine's preference).
 */
export function buildPair(kb: KnowledgeBase, nc: NightCands, choice: { a: Cand; b: Cand }, n: number, higherLeft: boolean, minPct: number, stars: SkyStar[], lines: LineFeature[], glossary: Glossary, used: Set<string>, prefix = 'ab1'): AbPair {
  const { spec, req, night, note, app } = nc;
  const site = SITES[spec.site];
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const id = `${prefix}-${String(n).padStart(2, '0')}`;
  const notes = nc.notes.slice();
  if (nc.poolSize < 3) notes.push(`the pool had ${nc.poolSize} journeys`);
  const cls = choice.a.source === 'theme'
    ? { hypothesis: 'picked' as const, roles: [`theme picker: ${choice.a.j.templateId}`, `theme picker: ${choice.b.j.templateId}`] as [string, string] }
    : classifyPair(choice.a, choice.b, byId);
  const aFirst = (choice.a.j.score >= choice.b.j.score) === higherLeft;
  const [L, R] = aFirst ? [choice.a, choice.b] : [choice.b, choice.a];
  const [roleL, roleR] = aFirst ? cls.roles : [cls.roles[1], cls.roles[0]];
  const hiddenOf = (c: Cand, side: 'left' | 'right', role: string): AbHiddenSide => ({
    side, key: c.j.key, role, templateId: c.j.templateId, score: c.j.score, scorePct: c.scorePct, poolRank: c.poolRank, goodRank: c.goodRank, appRank: c.appRank,
    source: c.source, flags: c.flags, relaxed: c.relaxed,
  });
  const contrasts = contrastsOf(L.j, R.j, byId);

  const c = app.conditions!;
  const loc = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), site.tz, 'yyyy-MM-dd HH:mm') : null);
  const ms = Date.parse(req.instant);
  const aa = altAzAt(ms, site.lat, site.lon);
  const elong = Astro.MoonPhase(new Date(ms));
  const illum = Astro.Illumination(Astro.Body.Moon, new Date(ms)).phase_fraction;
  const moonEq = Astro.Equator(Astro.Body.Moon, new Date(ms), new Astro.Observer(site.lat, site.lon, 0), true, true);
  const moonHor = Astro.Horizon(new Date(ms), new Astro.Observer(site.lat, site.lon, 0), moonEq.ra, moonEq.dec, 'normal');
  const upStars = stars.map((s) => ({ s, h: aa(s.ra, s.dec) })).filter((x) => x.h.alt > 0).sort((a, b) => a.s.mag - b.s.mag || a.s.hr - b.s.hr);
  const skyLines = lines.flatMap((f) => {
    const polylines = f.geometry.coordinates.map((line) => line.map(([lon, dec]) => {
      const h = aa((lon + 360) % 360, dec);
      return [r1(h.alt), r1(h.az)] as [number, number];
    }));
    return polylines.some((pl) => pl.some(([alt]) => alt > 0)) ? [{ con: f.id, name: getConstellationName(f.id), polylines }] : [];
  });

  return {
    id, n,
    context: {
      site: spec.site, lat: site.lat, lon: site.lon, timezone: site.tz, hemisphere: site.hemisphere, season: seasonOf(spec.month, site.hemisphere),
      localDate: night.date, localTime: formatInTimeZone(new Date(ms), site.tz, 'yyyy-MM-dd HH:mm'), instantUtc: req.instant,
      timeKind: spec.time, ...(note ? { timeNote: note } : {}),
      binoculars: { name: spec.optic, ...OPTICS[spec.optic] },
      skyBrightness: site.sky, minAlt: 30, length: 5,
    },
    conditions: {
      darkness: c.darkness, sunAltDeg: c.sunAltDeg,
      darkWindowLocal: { start: loc(c.darkWindow.start), end: loc(c.darkWindow.end) },
      moon: {
        phaseRequested: spec.phase, phase: phaseName(elong), illumination: r3(c.moon.illumination), up: c.moon.up,
        altDeg: c.moon.altDeg, azDeg: c.moon.azDeg, minSepDeg: c.moon.minSepDeg, riseLocal: loc(c.moon.rise), setLocal: loc(c.moon.set),
      },
      message: app.diagnostics.message,
    },
    sky: {
      magLimit: SKY_MAG_LIMIT,
      moon: { altDeg: r1(moonHor.altitude), azDeg: r1(moonHor.azimuth), illumination: r3(illum), up: moonHor.altitude > 0, phase: phaseName(elong) },
      stars: upStars.map((x) => ({ hr: x.s.hr, name: x.s.name, con: x.s.con, mag: x.s.mag, ra: x.s.ra, dec: x.s.dec, altDeg: r1(x.h.alt), azDeg: r1(x.h.az) })),
      lines: skyLines,
    },
    journeys: [journeyOut(L.j, 'left', kb, byId, site.tz, glossary, used), journeyOut(R.j, 'right', kb, byId, site.tz, glossary, used)],
    hidden: {
      hypothesis: cls.hypothesis, question: nc.question ?? HYPOTHESIS_TEXT[cls.hypothesis],
      themePair: themePairOf(L.j, R.j), contrasts,
      sides: [hiddenOf(L, 'left', roleL), hiddenOf(R, 'right', roleR)],
      poolSize: nc.poolSize, minScorePct: minPct, appTop3: app.journeys.map(identOf), notes,
    },
  };
}

// ───────────────────────────── preview + main ─────────────────────────────

export function previewPair(p: AbPair): string {
  const c = p.context, m = p.conditions.moon;
  const L: string[] = [];
  L.push(`${p.id}: ${c.site} (${c.hemisphere}ern ${c.season}), ${c.localTime} local (${c.timeKind}), ${c.binoculars.name}`);
  L.push(`  ${p.conditions.darkness}; Moon ${m.phase} ${Math.round(m.illumination * 100)}% ${m.up ? `up alt ${m.altDeg}°` : 'down'}; sky: ${p.sky.stars.length} stars, ${p.sky.lines.length} constellations`);
  for (const j of p.journeys) {
    L.push('', `  [${j.side}] ${j.title} — ${j.templateName}, ${j.stops.length} stops, ${j.durationMin} min, path ${j.totalPathDeg}°, ${j.difficulty}`);
    L.push(`      ${j.drivingQuestion}`);
    for (const s of j.stops) L.push(`      ${s.n}. ${s.startLocal} ${s.name} — ${s.plainClass} in ${s.constellation} (alt ${Math.round(s.altDeg)}°${s.challenge ? ', challenge' : ''})${s.lens ? ` [${s.lens.step}: ${s.lens.beat}]` : ''}`);
    if (j.payoff) L.push(`      payoff: ${j.payoff}`);
  }
  return L.join('\n');
}


export interface RoundOptions { round?: string; pairs?: number }

export function buildFile(kb: KnowledgeBase, log: (s: string) => void = () => {}, opts: RoundOptions = {}): AbFile {
  const round = opts.round ?? DEFAULT_ROUND;
  const specs = specsFor(opts.pairs ?? DEFAULT_PAIRS);
  const rules = roundRules(specs.length, new Set(kb.templates.map((t) => t.archetype)).size);
  const stars = skyStars();
  const lines = constellationLines();
  const glossaryFile = JSON.parse(readFileSync(join(ROOT, 'client/public/data/journeys/glossary.json'), 'utf8')) as Glossary;
  const used = new Set<string>();
  const nights = specs.map((spec) => {
    const nc = nightCandidates(kb, spec);
    log(`${spec.site} ${nc.night.date} ${spec.time} ${spec.optic}: pool ${nc.poolSize}, ${nc.cands.length} good candidates (${new Set(nc.cands.map((c) => archOf(c.j))).size} archetypes)`);
    return nc;
  });
  let chosen: PairOption[] | null = null, minPct = 0;
  for (const m of MIN_SCORE_PCT) {
    chosen = chooseAll(nights, m, rules);
    minPct = m;
    if (chosen) break;
    log(`no round meets the rules with every side at ≥ ${m} of its pool's score range; lowering`);
  }
  if (!chosen) throw new Error(`no ${specs.length} different comparisons with every side at ≥ ${MIN_SCORE_PCT[MIN_SCORE_PCT.length - 1]} of its pool's score range (rules ${JSON.stringify(rules)})`);
  // Balanced sides: a seeded half of the pairs shows the higher-scored journey on the left.
  const order = specs.map((_, i) => ({ i, r: rngFor(roundSeed(round), 'side', i)() })).sort((x, y) => x.r - y.r).map((x) => x.i);
  const higherLeft = new Set(order.slice(0, specs.length >> 1));
  const pairs = nights.map((nc, i) => {
    const p = buildPair(kb, nc, chosen![i], i + 1, higherLeft.has(i), minPct, stars, lines, glossaryFile, used, roundPrefix(round));
    log(`${p.id} ${nc.spec.site} ${p.context.localTime} ${nc.spec.optic} moon ${p.conditions.moon.phase} ${Math.round(p.conditions.moon.illumination * 100)}%: ${p.hidden.hypothesis} ${p.hidden.themePair} (score % ${p.hidden.sides.map((x) => Math.round(100 * x.scorePct)).join('/')}, pool ranks ${p.hidden.sides.map((x) => x.poolRank).join('/')}) — ${p.journeys[0].title} | ${p.journeys[1].title}${p.hidden.notes.length ? ` (${p.hidden.notes.length} notes)` : ''}`);
    return p;
  });
  return {
    version: FORMAT_VERSION,
    round,
    rules,
    generatedBy: 'script/journeys/train/export-ab-pairs.ts',
    kbVersion: kb.version,
    engineScorer: 'heuristic',
    instructions: 'For each pair, read both journeys as an observer under exactly these conditions and answer left, right, equal or neither, with an optional note. Do not open `hidden` until you have answered every pair: it holds the hypothesis and the engine\'s scores.',
    answerOptions: ['left', 'right', 'equal', 'neither'],
    glossary: glossaryEntries(glossaryFile).filter((e) => used.has(e.id)).sort((a, b) => a.id.localeCompare(b.id)),
    pairs,
  };
}

// ───────────────────────────── hand-picked rounds ─────────────────────────────

/**
 * Nights a hand-picked round may use besides SPECS and EXTRA_SPECS: the new-Moon night nearest the 15th of every
 * other month at every site (10x50, dusk + 1.5 h), so the dark-sky themes (A1, A8, A11) have nights to run on.
 */
export const PICKED_NIGHTS: Spec[] = (['San Francisco', 'Colorado dark site', 'London', 'Sydney', 'Santiago'] as const)
  .flatMap((site) => [1, 3, 5, 7, 9, 11].map((month): Spec => ({ site, month, phase: 'new', optic: '10x50', time: 'dusk+1.5h' })));

/** What each hand-picked comparison asks (owner feedback r2); keyed by the sorted theme pair. */
export const PICKED_QUESTIONS: Record<string, string> = {
  'A3|A7': 'Round 1 found the distance ladder (A3) to be "five objects sorted by distance". It is rebuilt as rungs, each a new way of measuring that rests on the one before. Is it now a story, held against records (A7), the round-1 favorite?',
  'A1|A9': 'Cradle to grave (A1) is rebuilt to run nursery, newborn cluster, family, aging giant, and the end (a remnant where one is in reach). Does every card now do what its step says, held against seeing double (A9)?',
  'A2|A5': 'The thermometer (A2) got "neither" in round 1: the cards did not read temperature from color. Do the rebuilt cards now carry the color thread, held against families (A5)?',
  'A6|A11': 'Look-alikes (A6), liked in round 1, against Inside our galaxy (A11), a dark-sky theme you have not judged yet.',
  'A6|A8': 'Look-alikes (A6), liked in round 1, against How stars die (A8), a dark-sky theme you have not judged yet.',
};

/** Round 3 questions (owner feedback r3); a round without its own entry falls back to PICKED_QUESTIONS. */
export const PICKED_QUESTIONS_BY_ROUND: Record<string, Record<string, string>> = {
  round3: {
    'A3|A7': 'Records (A7) "jumps around the five cards". It is rebuilt as one climb, each rung needing the one before: how far, how much light, how hot, how big, how old. Does it flow now, held against the distance ladder (A3) that beat it?',
    'A1|A9': 'Seeing double (A9) was "a collection, not a story". It is rebuilt around one question, how do you weigh a star, with a strangers step as the twist. Is it a story now, held against cradle to grave (A1)?',
    'A5|A6': 'Look-alikes (A6) no longer ends on a galaxy; it stays with stars and ends on families aging apart. Does the new ending land, and does it feel distinct from star families (A5) on the same sky?',
  },
  round4: {
    'A1|A9': 'Seeing double (A9) now says on every card whether a pair is real partners, siblings or a chance alignment, and how we know; Sheliak is gone, and the ending recaps only the pairs you visited. Is the answer clear now, held against cradle to grave (A1) on a Colorado summer night like round 3’s?',
    'A3|A9': 'On a winter night with no orbiting pair in reach, seeing double (A9) has to say so honestly. Does its Taurus journey still answer its question, held against the distance ladder (A3)?',
  },
};

interface ForcedSide { cand: Cand; poolSize: number; quality: number; app: JourneyResult }

/**
 * The app's first journey for this night with the theme picker set to `arch`, or null when the theme has none that
 * is told through lenses on every stop, keeps its theme (no switch), passes the independent check and has no
 * lecturer veto flag. Quality: stops and distinct storyline beats (a story that reaches more of its beats).
 */
export function forcedSide(kb: KnowledgeBase, req: JourneyRequest, arch: string): ForcedSide | null {
  const t = kb.templates.find((x) => x.archetype === arch || x.id.split('-')[0] === arch);
  if (!t) return null;
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  let pool: readonly Journey[] = [];
  const fr: JourneyRequest = { ...req, theme: t.id };
  const app = generate(kb, fr, { inspectPool: (p) => { pool = p; } });
  const j = app.journeys[0];
  if (!j || archOf(j) !== arch || j.switch || j.stops.some((s) => !s.lens)) return null;
  if (independentProblems(kb, fr, app, j).length) return null;
  const moonIll = app.conditions?.moon.up ? app.conditions.moon.illumination : 0;
  const flags = [...journeyFlags(j, kb, byId, moonIll), ...extraFlags(j)];
  if (flags.some((f) => VETO.test(f))) return null;
  const beats = new Set(j.stops.map((s) => s.lens!.step)).size;
  const poolRank = Math.max(0, pool.findIndex((x) => identOf(x) === identOf(j)));
  return {
    cand: { j, poolRank, goodRank: 0, scorePct: 1, appRank: 0, source: 'theme', flags, relaxed: [...(j.conditions?.relaxed ?? [])] },
    poolSize: Math.max(pool.length, poolRank + 1), quality: 3 * j.stops.length + 2 * beats - (j.stops.some((s) => s.challenge) ? 1 : 0), app,
  };
}

/**
 * A hand-picked round (owner feedback r2: a short round that asks what is still open): one pair per requested theme
 * pair. Each side is the app's first journey with the theme picker set to that theme. A pair with a night given uses
 * it; the others search SPECS, EXTRA_SPECS and PICKED_NIGHTS for a night where both themes tell a full story, then
 * the round as a whole prefers different sites, both hemispheres and different months (exhaustive over each pair's
 * best nights).
 */
export function buildPickedFile(kb: KnowledgeBase, picks: readonly PickedPair[], log: (s: string) => void = () => {}, opts: { round?: string } = {}): AbFile {
  const round = opts.round ?? 'round2';
  const allNights: Spec[] = [];
  const seen = new Set<string>();
  for (const sp of [...SPECS, ...EXTRA_SPECS, ...PICKED_NIGHTS]) {
    const k = `${sp.site}|${sp.month}|${sp.phase}|${sp.optic}|${sp.time}`;
    if (!seen.has(k)) { seen.add(k); allNights.push(sp); }
  }
  const cache = new Map<string, ForcedSide | null>();
  const reqs = new Map<Spec, ReturnType<typeof requestFor>>();
  const reqOf = (sp: Spec) => { let r = reqs.get(sp); if (!r) { r = requestFor(sp); reqs.set(sp, r); } return r; };
  const side = (sp: Spec, arch: string) => {
    const k = `${sp.site}|${sp.month}|${sp.phase}|${sp.optic}|${sp.time}|${arch}`;
    if (!cache.has(k)) cache.set(k, forcedSide(kb, reqOf(sp).req, arch));
    return cache.get(k)!;
  };
  interface Opt { sp: Spec; a: ForcedSide; b: ForcedSide; q: number }
  const OPTS_PER_PAIR = 6;
  const options: Opt[][] = picks.map((pk) => {
    const nights = pk.night ? [pk.night] : allNights;
    const xs: Opt[] = [];
    for (const sp of nights) {
      const a = side(sp, pk.a); if (!a) continue;
      const b = side(sp, pk.b); if (!b) continue;
      if (!distinctPair(a.cand.j, b.cand.j)) continue;
      xs.push({ sp, a, b, q: Math.min(a.quality, b.quality) + 0.25 * (a.quality + b.quality) });
    }
    xs.sort((x, y) => y.q - x.q);
    log(`${pk.a}:${pk.b}: ${xs.length} nights with both themes${xs.length ? `; best ${xs.slice(0, 3).map((o) => `${o.sp.site} m${o.sp.month} ${o.sp.phase} (${o.q})`).join(', ')}` : ''}`);
    if (!xs.length) throw new Error(`--themes ${pk.a}:${pk.b}: no night where both themes have a full lens-told journey`);
    return xs.slice(0, OPTS_PER_PAIR);
  });
  // Exhaustive over the pairs' best nights: quality, minus repeated sites, plus both hemispheres and distinct months.
  let best: { obj: number; picks: Opt[] } | null = null;
  const cur: Opt[] = [];
  const dfs = (k: number) => {
    if (k === picks.length) {
      const sites = new Set(cur.map((o) => o.sp.site));
      const hemis = new Set(cur.map((o) => SITES[o.sp.site].hemisphere));
      const months = new Set(cur.map((o) => o.sp.month));
      const obj = cur.reduce((t, o) => t + o.q, 0) - 6 * (cur.length - sites.size) + (hemis.size > 1 ? 4 : 0) + months.size;
      if (!best || obj > best.obj) best = { obj, picks: cur.slice() };
      return;
    }
    for (const o of options[k]) {
      if (cur.some((c) => c.sp === o.sp)) continue;
      cur.push(o); dfs(k + 1); cur.pop();
    }
  };
  dfs(0);
  if (!best) throw new Error('no set of different nights carries every hand-picked comparison');
  const chosen = (best as { picks: Opt[] }).picks;
  const stars = skyStars();
  const lines = constellationLines();
  const glossaryFile = JSON.parse(readFileSync(join(ROOT, 'client/public/data/journeys/glossary.json'), 'utf8')) as Glossary;
  const used = new Set<string>();
  const order = chosen.map((_, i) => ({ i, r: rngFor(roundSeed(round), 'side', i)() })).sort((x, y) => x.r - y.r).map((x) => x.i);
  const higherLeft = new Set(order.slice(0, chosen.length >> 1));
  const pairs = chosen.map((o, i) => {
    const { req, night, note } = reqOf(o.sp);
    const app = generate(kb, req);
    const tp = themePairOf(o.a.cand.j, o.b.cand.j);
    const nc: NightCands = {
      spec: o.sp, req, night, ...(note ? { note } : {}), app, poolSize: Math.min(o.a.poolSize, o.b.poolSize),
      cands: [o.a.cand, o.b.cand], notes: [`hand-picked ${tp}: each side is the app's first journey with the theme picker set to its theme`],
      question: PICKED_QUESTIONS_BY_ROUND[round]?.[tp] ?? PICKED_QUESTIONS[tp] ?? HYPOTHESIS_TEXT.picked,
    };
    // poolRank is within each side's own (theme-forced) pool; poolSize is the smaller of the two.
    for (const c of nc.cands) c.poolRank = Math.min(c.poolRank, nc.poolSize - 1);
    const p = buildPair(kb, nc, { a: o.a.cand, b: o.b.cand }, i + 1, higherLeft.has(i), 0, stars, lines, glossaryFile, used, roundPrefix(round));
    log(`${p.id} ${o.sp.site} ${p.context.localTime} ${o.sp.optic} moon ${p.conditions.moon.phase} ${Math.round(p.conditions.moon.illumination * 100)}%: ${tp} — ${p.journeys[0].title} | ${p.journeys[1].title}`);
    return p;
  });
  const themes = new Set(picks.flatMap((p) => [p.a, p.b]));
  return {
    version: FORMAT_VERSION,
    round,
    rules: {
      pairs: picks.length, minThemes: themes.size,
      maxA6Pairs: Math.max(1, picks.filter((p) => p.a === 'A6' || p.b === 'A6').length),
      maxPerTheme: Math.max(1, ...Array.from(themes).map((t) => picks.filter((p) => p.a === t || p.b === t).length)),
    },
    generatedBy: 'script/journeys/train/export-ab-pairs.ts --themes',
    kbVersion: kb.version,
    engineScorer: 'heuristic',
    instructions: 'For each pair, read both journeys as an observer under exactly these conditions and answer left, right, equal or neither, with an optional note. Do not open `hidden` until you have answered every pair: it holds what each pair asks and the engine\'s scores.',
    answerOptions: ['left', 'right', 'equal', 'neither'],
    glossary: glossaryEntries(glossaryFile).filter((e) => used.has(e.id)).sort((a, b) => a.id.localeCompare(b.id)),
    pairs,
  };
}

export async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const out = a.out;
  if (a.show !== null) {
    const f = JSON.parse(readFileSync(out, 'utf8')) as AbFile;
    console.log(previewPair(f.pairs[a.show - 1]));
    return;
  }
  const kb = loadRealKb();
  const log = (s: string) => process.stderr.write(`${s}\n`);
  const file = a.themes ? buildPickedFile(kb, a.themes, log, { round: a.round }) : buildFile(kb, log, { round: a.round, pairs: a.pairs });
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`wrote ${out}: ${file.pairs.length} pairs, ${file.glossary.length} glossary entries`);
  const p = a.preview;
  if (p > 0) console.log(`\n${previewPair(file.pairs[p - 1])}`);
}
