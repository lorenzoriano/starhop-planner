/**
 * Sky Journeys learned scorer: 20 CALIBRATION SLATES for the product owner to rank by hand (README "Human
 * calibration", doc 05 §7.3.6). The owner's rankings later calibrate the LLM judge panels.
 *
 * Each slate is ONE observing context (night + site + binoculars + start time, default "surprise me" request) and
 * four distinct, valid journeys the REAL engine (assemble.ts) built for it on the REAL KB:
 *   top      the engine's best-scored journey of the whole valid pool (explore mode, heuristic scorer);
 *   flawed   a plausible-but-flawed one: the best-scored pool journey carrying a lecturer flag
 *            (run-grid journeyFlags: dull payoff, weak opener, same-view pair, weak derived link, …) or a
 *            weak link / challenge stop / low stop, when the pool has one;
 *   mid      the journey nearest the 40th-percentile rank;
 *   low      the journey nearest the 85th-percentile rank;
 * every one sharing fewer than 2 stops with the others (and, where the pool allows, telling a different archetype).
 * When the strict pool is too thin, the engine's shuffles (generate(), which may use its relaxations) fill in.
 * Two dark-site contexts (`feature` in SPECS) swap the low pick for the best journey of a rare archetype that the
 * default pool never offers there (A11, A8), so every archetype gets calibrated at least once.
 * `hidden.order[].appRank` says whether a journey is also one of the app's 3 canonical suggestions (MMR + night
 * rotation pick far down the pool, so the pool's top is often not among them).
 * The four are shown in a deterministic shuffled order (labels A–D); `hidden` keeps the engine's score, rank and
 * pick reason, so the product owner ranks blind and the answer key stays in the same file.
 *
 * Contexts cover 5 sites (2 southern), all 4 seasons per site, new / first-quarter / full / last-quarter Moon,
 * 7x50 and 10x50, and three start times (dusk + 1.5 h, 23:30, 02:00).
 *
 * Run from the repository root through the CommonJS launcher (tsx's ESM mode cannot see astronomy-engine's CJS
 * exports, see run-export.cts):
 *   npx tsx script/journeys/train/export-calibration-slates.cts [--out script/journeys/train/calibration-slates.json]
 *       [--preview 1]       print slate N as text after writing (default 1; 0 = none)
 *   npx tsx script/journeys/train/export-calibration-slates.cts --show 3   print slate 3 of the existing file
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as AstroNs from 'astronomy-engine';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { generate, generatePool } from '../../../client/src/lib/journeys/assemble';
import { fastAltAz, ofDateConverter } from '../../../client/src/lib/journeys/conditions';
import { knowledgeBaseFromFiles } from '../../../client/src/lib/journeys/kb-schema';
import { rngFor, seededShuffle } from '../../../client/src/lib/journeys/seed';
import { independentProblems } from '../../../client/src/lib/journeys/__tests__/engine-helpers';
import type { Journey, JourneyRequest, JourneyResult, KbObject, KnowledgeBase } from '../../../client/src/lib/journeys/types';
import { journeyFlags } from '../eval/run-grid';

const Astro = ((AstroNs as unknown as { default?: typeof AstroNs }).default ?? AstroNs) as typeof AstroNs;
const ROOT = process.cwd();
const SEED = 'calibration-1';
export const DEFAULT_OUT = join(ROOT, 'script/journeys/train/calibration-slates.json');
export const FORMAT_VERSION = 'calibration-slates-1';

// ───────────────────────────── contexts ─────────────────────────────

/** Same five sites as the evaluation grid (run-grid.ts), with the app-default sky brightness. */
export const SITES = {
  'San Francisco': { lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles', sky: 19.0, hemisphere: 'north' },
  'Colorado dark site': { lat: 38.8, lon: -104.5, tz: 'America/Denver', sky: 21.5, hemisphere: 'north' },
  London: { lat: 51.5, lon: -0.1, tz: 'Europe/London', sky: 19.0, hemisphere: 'north' },
  Sydney: { lat: -33.9, lon: 151.2, tz: 'Australia/Sydney', sky: 19.0, hemisphere: 'south' },
  Santiago: { lat: -33.4, lon: -70.7, tz: 'America/Santiago', sky: 19.0, hemisphere: 'south' },
} as const;
type SiteName = keyof typeof SITES;

export const OPTICS = {
  '10x50': { fovDeg: 6.5, aperture: 50, magnification: 10 },
  '7x50': { fovDeg: 7.1, aperture: 50, magnification: 7 },
} as const;
type OpticName = keyof typeof OPTICS;

type Phase = 'new' | 'first-quarter' | 'full' | 'last-quarter';
const PHASE_LON: Record<Phase, number> = { new: 0, 'first-quarter': 90, full: 180, 'last-quarter': 270 };
type TimeKind = 'dusk+1.5h' | '23:30' | '02:00';

interface Spec {
  site: SiteName; month: number; phase: Phase; optic: OpticName; time: TimeKind;
  /**
   * A rare archetype the default pool lacks here: the best journey of a forced-theme request for this same context
   * takes the "low" place (A8 and A11 need a dark site and are almost never in a default pool, P4 evaluation).
   */
  feature?: string;
}

/**
 * The 20 contexts: every site gets all four seasons (Jan/Apr/Jul/Oct) and three Moon phases (new, a quarter, full),
 * 10 slates per binocular, start times mix early, late and after midnight (the last-quarter Moon rises late).
 * Southern spring evenings (Sydney, October) are deliberately kept once: the KB is thin there and only contrast
 * tours fit, which the owner should see too.
 */
export const SPECS: Spec[] = [
  { site: 'San Francisco', month: 1, phase: 'new', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'San Francisco', month: 4, phase: 'first-quarter', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'San Francisco', month: 7, phase: 'full', optic: '10x50', time: '23:30' },
  { site: 'San Francisco', month: 10, phase: 'new', optic: '7x50', time: '23:30' },
  { site: 'Colorado dark site', month: 4, phase: 'new', optic: '7x50', time: '23:30' },
  { site: 'Colorado dark site', month: 7, phase: 'new', optic: '10x50', time: 'dusk+1.5h', feature: 'A11-inside-our-galaxy' },
  { site: 'Colorado dark site', month: 10, phase: 'first-quarter', optic: '10x50', time: '23:30', feature: 'A8-how-stars-die' },
  { site: 'Colorado dark site', month: 1, phase: 'full', optic: '7x50', time: '23:30' },
  { site: 'London', month: 10, phase: 'new', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'London', month: 1, phase: 'first-quarter', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'London', month: 4, phase: 'full', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'London', month: 7, phase: 'last-quarter', optic: '7x50', time: '02:00' },
  { site: 'Sydney', month: 7, phase: 'new', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 10, phase: 'first-quarter', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Sydney', month: 1, phase: 'full', optic: '10x50', time: '23:30' },
  { site: 'Sydney', month: 4, phase: 'last-quarter', optic: '7x50', time: '02:00' },
  { site: 'Santiago', month: 4, phase: 'new', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Santiago', month: 1, phase: 'first-quarter', optic: '10x50', time: 'dusk+1.5h' },
  { site: 'Santiago', month: 7, phase: 'full', optic: '7x50', time: 'dusk+1.5h' },
  { site: 'Santiago', month: 10, phase: 'last-quarter', optic: '10x50', time: '02:00' },
];

const SEASONS_NORTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'] as const;
export function seasonOf(month: number, hemisphere: 'north' | 'south'): string {
  const n = SEASONS_NORTH[month - 1];
  if (hemisphere === 'north') return n;
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[n];
}

/** Local evening date (yyyy-MM-dd) of the night that contains `t` at this site. */
const nightDateOf = (t: Date, tz: string) => formatInTimeZone(new Date(t.getTime() - 12 * 3_600_000), tz, 'yyyy-MM-dd');

/** The night (local evening date) of the `phase` event nearest the 15th of `month` 2027. */
export function nightOfPhase(site: SiteName, month: number, phase: Phase): { date: string; eventUtc: string } {
  const { tz } = SITES[site];
  const mid = fromZonedTime(`2027-${String(month).padStart(2, '0')}-15T22:00:00`, tz);
  const a = Astro.SearchMoonPhase(PHASE_LON[phase], new Date(mid.getTime() - 16 * 86_400_000), 40);
  if (!a) throw new Error(`no ${phase} Moon near 2027-${month}-15`);
  return { date: nightDateOf(a.date, tz), eventUtc: a.date.toISOString() };
}

/** Request instant for the night of `date`: 1.5 h after astronomical dusk (solar midnight without one), 23:30 or 02:00. */
export function instantFor(site: SiteName, date: string, kind: TimeKind): { instant: Date; note?: string } {
  const st = SITES[site];
  if (kind === '23:30') return { instant: fromZonedTime(`${date}T23:30:00`, st.tz) };
  if (kind === '02:00') return { instant: new Date(fromZonedTime(`${date}T02:00:00`, st.tz).getTime() + 86_400_000) };
  const observer = new Astro.Observer(st.lat, st.lon, 0);
  const noon = fromZonedTime(`${date}T12:00:00`, st.tz);
  const dusk = Astro.SearchAltitude(Astro.Body.Sun, observer, -1, noon, 1, -18)?.date;
  if (dusk && dusk.getTime() - noon.getTime() < 16 * 3_600_000) return { instant: new Date(dusk.getTime() + 90 * 60_000) };
  return { instant: Astro.SearchHourAngle(Astro.Body.Sun, observer, 12, noon, 1).time.date, note: 'no astronomical night: solar midnight' };
}

export function phaseName(elongation: number): string {
  const names = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent'];
  return names[Math.round((((elongation % 360) + 360) % 360) / 45) % 8];
}

// ───────────────────────────── KB + bright stars ─────────────────────────────

export function loadRealKb(): KnowledgeBase {
  const dir = join(ROOT, 'client/public/data/journeys');
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(join(dir, 'lenses.json')) ? read('lenses.json') : undefined });
}

interface BscRow { HR: string; N?: string; B?: string; C?: string; F?: string; V?: string; RA: string; Dec: string }
interface BrightStar { hr: number; name: string; mag: number; ra: number; dec: number }

const parseRa = (s: string) => { const m = /(\d+)h\s*(\d+)m\s*([\d.]+)s/.exec(s)!; return 15 * (+m[1] + +m[2] / 60 + +m[3] / 3600); };
const parseDec = (s: string) => {
  const m = /([+-−])?(\d+)°\s*(\d+)′\s*([\d.]+)″/.exec(s)!;
  const v = +m[2] + +m[3] / 60 + +m[4] / 3600;
  return m[1] === '-' || m[1] === '−' ? -v : v;
};

/** BSC stars brighter than V 2.5 (the sky-plot backdrop; no constellation lines). */
export function brightStars(): BrightStar[] {
  const rows = JSON.parse(readFileSync(join(ROOT, 'client/public/data/bsc5-short.json'), 'utf8')) as BscRow[];
  return rows.filter((r) => r.V !== undefined && +r.V < 2.5).map((r) => ({
    hr: +r.HR,
    name: r.N ?? ([r.B ?? r.F, r.C].filter(Boolean).join(' ') || `HR ${r.HR}`),
    mag: +r.V!, ra: parseRa(r.RA), dec: parseDec(r.Dec),
  }));
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function altAzAt(ms: number, lat: number, lon: number) {
  const conv = ofDateConverter(ms);
  const gast = Astro.SiderealTime(new Date(ms)) * 15;
  return (ra: number, dec: number) => { const p = conv.raDec(ra, dec); return fastAltAz(p.ra, p.dec, lat, lon, gast); };
}

// ───────────────────────────── output shapes ─────────────────────────────

export interface SlateStop {
  n: number;
  objectId: string;
  name: string;
  designation: string | null;
  kind: 'star' | 'dso';
  class: string;
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
  card: { glance: string; see: string; understand: string };
  image: { path: string; variant: string | null; credit: string } | null;
  link: { type: string; subtype: string; strength: number; curated: boolean } | null;
}

export interface SlateJourney {
  label: string;
  key: string;
  title: string;
  drivingQuestion: string;
  hook: string;
  story: string;
  templateId: string;
  switch: { atStop: number; toTemplateId: string } | null;
  durationMin: number;
  difficulty: string;
  totalPathDeg: number;
  regionRadius: number;
  regionLabel: string;
  stops: SlateStop[];
}

export interface HiddenEntry {
  label: string;
  key: string;
  pick: 'top' | 'flawed' | 'mid' | 'low' | 'sampled' | 'shuffle' | 'theme';
  /** 0-based rank in the engine's valid pool (by score), null for shuffle fills outside the strict pool. */
  poolRank: number | null;
  score: number;
  flags: string[];
  relaxed: string[];
  /** Among the app's 3 canonical suggestions (generate, shuffle 0) for this context. */
  /**
   * Position (0..2) among the app's 3 canonical suggestions (generate, shuffle 0) for this context, matched by
   * identity (template, switch, ordered stops; the key also encodes the region centre, which can differ), or null.
   */
  appRank: number | null;
}

export interface Slate {
  id: string;
  n: number;
  context: {
    site: string; lat: number; lon: number; timezone: string; hemisphere: string; season: string;
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
  sky: { moon: { altDeg: number; azDeg: number } | null; brightStars: { name: string; hr: number; mag: number; altDeg: number; azDeg: number }[] };
  journeys: SlateJourney[];
  /** appTop3: identities ("template[>switch@stop]|id>id>…") of the app's 3 canonical suggestions. */
  hidden: { poolSize: number; order: HiddenEntry[]; appTop3: string[]; notes: string[] };
}

export interface CalibrationFile {
  version: string;
  generatedBy: string;
  kbVersion: string;
  engineScorer: string;
  instructions: string;
  slates: Slate[];
}

// ───────────────────────────── picking ─────────────────────────────

interface Cand { j: Journey; rank: number | null; flags: string[]; relaxed: string[]; source: 'pool' | 'shuffle' | 'theme' }

const ids = (j: Journey) => j.stops.map((s) => s.objectId);
/** What makes two journeys the same (assemble.ts identOf): template, switch and ordered stops. */
export const identOf = (j: Journey) => `${j.templateId}${j.switch ? `>${j.switch.toTemplateId}@${j.switch.atStop}` : ''}|${ids(j).join('>')}`;
const shared = (a: Journey, b: Journey) => { const A = new Set(ids(a)); return ids(b).filter((x) => A.has(x)).length; };

/** Soft quality problems beyond run-grid's lecturer flags, so a "flawed" pick exists on most nights. */
function extraFlags(j: Journey): string[] {
  const out: string[] = [];
  const links = j.stops.slice(1).map((s) => s.link!);
  if (links.some((l) => l.strength < 0.5)) out.push(`weak-link:${Math.min(...links.map((l) => l.strength))}`);
  if (j.stops.some((s) => s.challenge)) out.push('challenge-stop');
  if (j.stops.some((s) => s.altAtStart < 35)) out.push(`low-stop:${Math.round(Math.min(...j.stops.map((s) => s.altAtStart)))}°`);
  if (links.length && links.every((l) => !l.curated)) out.push('no-curated-link');
  return out;
}

/**
 * Pick 4 distinct journeys: top, a plausible-but-flawed one, a middle and a low rank. A pick must share < 2 stops
 * with every earlier pick; a different archetype is preferred (then one rarely used in earlier slates).
 */
export function pickFour(pool: Cand[], templateUse: Map<string, number>, rng: () => number, featured: Cand | null = null): { cand: Cand; pick: HiddenEntry['pick'] }[] {
  const out: { cand: Cand; pick: HiddenEntry['pick'] }[] = [];
  if (!pool.length) return out;
  out.push({ cand: pool[0], pick: 'top' });
  const n = pool.length;
  const ok = (c: Cand, maxShared: number) => !out.some((o) => o.cand === c) && out.every((o) => shared(o.cand.j, c.j) < maxShared);
  const freshTpl = (c: Cand) => (out.some((o) => o.cand.j.templateId === c.j.templateId) ? 1 : 0);
  const choose = (score: (c: Cand) => number, filter: (c: Cand) => boolean = () => true): Cand | null => {
    for (const [maxShared, needFresh] of [[2, true], [2, false], [3, false], [99, false]] as const) {
      const xs = pool.filter((c) => filter(c) && ok(c, maxShared) && (!needFresh || !freshTpl(c)));
      if (xs.length) return xs.sort((a, b) => score(a) - score(b) || a.j.key.localeCompare(b.j.key))[0];
    }
    return null;
  };
  const rankOf = (c: Cand) => c.rank ?? n;
  // Template balance across slates (the pools are dominated by A6 contrasts).
  const use = (c: Cand) => (templateUse.get(c.j.templateId) ?? 0) * 0.05;
  const ranked = (c: Cand) => c.source !== 'theme';
  // Plausible but flawed: the best-ranked flagged journey (upper 60 % preferred).
  const flawed = choose((c) => rankOf(c) / n + (rankOf(c) / n > 0.6 ? 1 : 0) + use(c), (c) => ranked(c) && c.flags.length > 0);
  if (flawed) out.push({ cand: flawed, pick: 'flawed' });
  const target = (q: number) => q * (n - 1);
  const mid = choose((x) => Math.abs(rankOf(x) - target(0.4)) / n + use(x), ranked);
  if (mid) out.push({ cand: mid, pick: 'mid' });
  if (featured && out.length < 4 && ok(featured, 2) && !freshTpl(featured)) out.push({ cand: featured, pick: 'theme' });
  if (out.length < 4) {
    const low = choose((x) => Math.abs(rankOf(x) - target(0.85)) / n + use(x), ranked);
    if (low) out.push({ cand: low, pick: 'low' });
  }
  while (out.length < 4) {
    const rest = pool.filter((c) => ok(c, 99));
    if (!rest.length) break;
    out.push({ cand: rest[Math.floor(rng() * rest.length)], pick: 'sampled' });
  }
  return out;
}

// ───────────────────────────── one slate ─────────────────────────────

function stopOut(j: Journey, i: number, byId: Map<string, KbObject>, tz: string): SlateStop {
  const s = j.stops[i];
  const o = byId.get(s.objectId)!;
  const img = o.media.images[0];
  const cls = o.kind === 'dso'
    ? o.dsoClass
    : [o.spectral?.text, o.evolutionaryStage, o.variability ? `${o.variability.class} variable` : null].filter(Boolean).join(' · ') || 'star';
  return {
    n: i + 1,
    objectId: o.id,
    name: o.names.display,
    designation: o.names.designation ?? null,
    kind: o.kind,
    class: cls,
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
    whyHere: s.whyHereText ?? o.card.whyHere,
    transitionText: s.transitionText,
    card: { glance: o.card.glance, see: o.card.see, understand: o.card.understand },
    image: img && existsSync(join(ROOT, 'client/public', img.src)) ? { path: img.src, variant: img.variant ?? null, credit: img.credit } : null,
    link: s.link ? { type: s.link.type, subtype: s.link.subtype, strength: s.link.strength, curated: s.link.curated } : null,
  };
}

function journeyOut(j: Journey, label: string, byId: Map<string, KbObject>, tz: string): SlateJourney {
  return {
    label, key: j.key,
    title: j.title, drivingQuestion: j.drivingQuestion, hook: j.hook, story: j.story ?? '',
    templateId: j.templateId,
    switch: j.switch ? { atStop: j.switch.atStop + 1, toTemplateId: j.switch.toTemplateId } : null,
    durationMin: j.durationMin, difficulty: j.difficulty, totalPathDeg: r1(j.totalPathDeg), regionRadius: j.regionRadius,
    regionLabel: j.regionCenter.label,
    stops: j.stops.map((_, i) => stopOut(j, i, byId, tz)),
  };
}

export function buildSlate(kb: KnowledgeBase, spec: Spec, n: number, templateUse: Map<string, number>, stars: BrightStar[]): Slate {
  const site = SITES[spec.site];
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const night = nightOfPhase(spec.site, spec.month, spec.phase);
  const t = instantFor(spec.site, night.date, spec.time);
  const req: JourneyRequest = {
    instant: t.instant.toISOString(), lat: site.lat, lon: site.lon, timezone: site.tz,
    instrument: OPTICS[spec.optic], skyBrightness: site.sky, theme: null, length: 5, minAlt: 30,
    includeChallenge: true, limit: 3, shuffle: 0, seenObjectIds: [],
  };
  const id = `cal-${String(n).padStart(2, '0')}`;
  const notes: string[] = [];
  const poolRes = generatePool(kb, req);
  const strictRes: JourneyResult = { journeys: poolRes.journeys, diagnostics: { ...poolRes.diagnostics, relaxed: [] } };
  const moonIll = poolRes.night.moon.up ? poolRes.night.moon.illumination : 0;
  const cands: Cand[] = [];
  poolRes.journeys.forEach((j, rank) => {
    if (independentProblems(kb, req, strictRes, j).length) { notes.push(`pool #${rank} failed the independent check`); return; }
    cands.push({ j, rank, flags: [...journeyFlags(j, kb, byId, moonIll), ...extraFlags(j)], relaxed: [], source: 'pool' });
  });
  // App view: the 3 canonical suggestions; shuffles fill a thin pool (they may rely on the engine's relaxations).
  const app = generate(kb, req);
  const appTop3 = app.journeys.map(identOf);
  const known = new Set(cands.map((c) => identOf(c.j)));
  const addFrom = (res: JourneyResult, source: Cand['source'], max = Infinity) => {
    let added = 0;
    for (const j of res.journeys) {
      if (added >= max || known.has(identOf(j)) || independentProblems(kb, req, res, j).length) continue;
      known.add(identOf(j));
      added++;
      cands.push({ j, rank: null, flags: [...journeyFlags(j, kb, byId, moonIll), ...extraFlags(j)], relaxed: j.conditions?.relaxed ?? [], source });
    }
  };
  for (let k = 0; k < 4; k++) addFrom(k === 0 ? app : generate(kb, { ...req, shuffle: k }), 'shuffle');
  let featured: Cand | null = null;
  if (spec.feature) {
    const before = cands.length;
    addFrom(generate(kb, { ...req, theme: spec.feature }), 'theme', 1);
    featured = cands.length > before ? cands[cands.length - 1] : cands.find((x) => x.j.templateId === spec.feature) ?? null;
    if (!featured) notes.push(`no ${spec.feature} journey for this context`);
  }
  if (poolRes.journeys.length < 4) notes.push(`strict pool had ${poolRes.journeys.length} journeys; engine shuffles filled in`);
  const rng = rngFor(SEED, id, 'pick');
  const picks = pickFour(cands.filter((x) => x.source !== 'theme'), templateUse, rng, featured);
  if (picks.length < 4) notes.push(`only ${picks.length} distinct valid journeys`);
  for (const p of picks) templateUse.set(p.cand.j.templateId, (templateUse.get(p.cand.j.templateId) ?? 0) + 1);
  const shuffled = seededShuffle(picks, rngFor(SEED, id, 'order'));
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

  const c = app.conditions!;
  const loc = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), site.tz, 'yyyy-MM-dd HH:mm') : null);
  const aa = altAzAt(t.instant.getTime(), site.lat, site.lon);
  const elong = Astro.MoonPhase(t.instant);
  return {
    id, n,
    context: {
      site: spec.site, lat: site.lat, lon: site.lon, timezone: site.tz, hemisphere: site.hemisphere, season: seasonOf(spec.month, site.hemisphere),
      localDate: night.date, localTime: formatInTimeZone(t.instant, site.tz, 'yyyy-MM-dd HH:mm'), instantUtc: req.instant,
      timeKind: spec.time, ...(t.note ? { timeNote: t.note } : {}),
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
      moon: c.moon.up ? { altDeg: c.moon.altDeg, azDeg: c.moon.azDeg } : null,
      brightStars: stars
        .map((s) => ({ s, h: aa(s.ra, s.dec) }))
        .filter((x) => x.h.alt > 0)
        .sort((a, b) => a.s.mag - b.s.mag)
        .map((x) => ({ name: x.s.name, hr: x.s.hr, mag: x.s.mag, altDeg: r1(x.h.alt), azDeg: r1(x.h.az) })),
    },
    journeys: shuffled.map((p, i) => journeyOut(p.cand.j, labels[i], byId, site.tz)),
    hidden: {
      poolSize: poolRes.journeys.length,
      order: shuffled.map((p, i) => ({
        label: labels[i], key: p.cand.j.key, pick: p.cand.source === 'shuffle' && p.pick !== 'top' && p.pick !== 'theme' ? 'shuffle' : p.pick,
        poolRank: p.cand.rank, score: p.cand.j.score, flags: p.cand.flags, relaxed: p.cand.relaxed,
        appRank: appTop3.includes(identOf(p.cand.j)) ? appTop3.indexOf(identOf(p.cand.j)) : null,
      })),
      appTop3,
      notes,
    },
  };
}

// ───────────────────────────── preview ─────────────────────────────

/** Compact human-readable text of one slate (no hidden fields). */
export function previewSlate(s: Slate): string {
  const c = s.context, m = s.conditions.moon;
  const L: string[] = [];
  L.push(`${s.id}: ${c.site} (${c.hemisphere}ern ${c.season}), ${c.localTime} local (${c.timeKind}), ${c.binoculars.name}, sky ${c.skyBrightness}`);
  L.push(`  ${s.conditions.darkness}, Sun ${s.conditions.sunAltDeg}°; dark ${s.conditions.darkWindowLocal.start ?? '—'} → ${s.conditions.darkWindowLocal.end ?? '—'}; Moon ${m.phase} ${Math.round(m.illumination * 100)}% ${m.up ? `up alt ${m.altDeg}° az ${m.azDeg}°` : 'down'}`);
  L.push(`  sky plot: ${s.sky.brightStars.length} bright stars up (${s.sky.brightStars.slice(0, 5).map((b) => `${b.name} ${b.altDeg}/${b.azDeg}`).join(', ')} …)`);
  for (const j of s.journeys) {
    L.push('', `  [${j.label}] ${j.title} — ${j.templateId}${j.switch ? `→${j.switch.toTemplateId}` : ''}, ${j.stops.length} stops, ${j.durationMin} min, path ${j.totalPathDeg}°, ${j.difficulty}`);
    L.push(`      ${j.drivingQuestion} | ${j.hook}`);
    for (const st of j.stops) {
      const link = st.link ? ` ⟵ ${st.link.type}/${st.link.subtype}${st.link.curated ? '*' : ''} ${st.link.strength}` : '';
      L.push(`      ${st.n}. ${st.startLocal} ${st.name} (${st.kind}, ${st.role}, alt ${Math.round(st.altDeg)}° az ${Math.round(st.azDeg)}°${st.challenge ? ', challenge' : ''})${link}`);
    }
  }
  return L.join('\n');
}

// ───────────────────────────── main ─────────────────────────────

const arg = (name: string, def?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };

export async function main(): Promise<void> {
  const out = resolve(arg('out', DEFAULT_OUT)!);
  if (arg('show')) {
    const f = JSON.parse(readFileSync(out, 'utf8')) as CalibrationFile;
    console.log(previewSlate(f.slates[Number(arg('show')) - 1]));
    return;
  }
  const kb = loadRealKb();
  const stars = brightStars();
  const templateUse = new Map<string, number>();
  const slates: Slate[] = [];
  SPECS.forEach((spec, i) => {
    const t0 = Date.now();
    const s = buildSlate(kb, spec, i + 1, templateUse, stars);
    slates.push(s);
    process.stderr.write(`${s.id} ${spec.site} ${s.context.localTime} ${spec.optic} moon ${s.conditions.moon.phase} ${Math.round(s.conditions.moon.illumination * 100)}%${s.conditions.moon.up ? ' up' : ''}: pool ${s.hidden.poolSize}, picks ${s.hidden.order.map((o) => `${o.pick}#${o.poolRank ?? '-'}`).join(' ')} (${Date.now() - t0} ms)${s.hidden.notes.length ? ` — ${s.hidden.notes.join('; ')}` : ''}\n`);
  });
  const file: CalibrationFile = {
    version: FORMAT_VERSION,
    generatedBy: 'script/journeys/train/export-calibration-slates.ts',
    kbVersion: kb.version,
    engineScorer: 'heuristic',
    instructions: 'For each slate, rank journeys A–D from best to worst for an observer under exactly these conditions (one ranking per slate; ties allowed only if truly equal). Do not open `hidden` until you have ranked every slate: it holds the engine\'s own score, pool rank and pick reason.',
    slates,
  };
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  const tpl = new Map<string, number>();
  for (const s of slates) for (const j of s.journeys) tpl.set(j.templateId, (tpl.get(j.templateId) ?? 0) + 1);
  console.log(`wrote ${out}: ${slates.length} slates, ${slates.reduce((a, s) => a + s.journeys.length, 0)} journeys; templates ${Array.from(tpl.entries()).sort().map(([k, v]) => `${k.split('-')[0]}:${v}`).join(' ')}`);
  const p = Number(arg('preview', '1'));
  if (p > 0) console.log(`\n${previewSlate(slates[p - 1])}`);
}
