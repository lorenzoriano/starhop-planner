/**
 * Sky Journeys engine evaluation grid (P4 engine evaluation, docs/sky-journeys/engine-eval.md).
 *
 * Runs the REAL engine (assemble.ts `generate`) on the REAL knowledge base (client/public/data/journeys/) over:
 *   sites     San Francisco, a dark rural Colorado site, London, Sydney, Santiago
 *   nights    the 15th of every month of 2027 plus, per month, the new Moon and full Moon nearest that 15th
 *   times     1.5 h after astronomical dusk (or local solar midnight when the Sun never reaches −18°) and 23:30 local
 *   optics    10x50 (6.5°) and 7x50 (7.1°); default request otherwise (5 stops, minAlt 30°, challenge allowed,
 *             3 suggestions, app-default sky 19.0 mag/arcsec² in cities, 21.5 at the dark site)
 *   themes    each template forced (10x50, first time only)
 * and records, per request: journeys returned, templates, stop counts, rejection reasons, empty results with the
 * diagnostics message, path length / region spread, runtime, stops shared between the suggestions, staleness
 * across nights, hard-constraint violations (recomputed independently by __tests__/engine-helpers.ts, must be 0)
 * and content flags a lecturer would object to (faint payoffs, a cluster and its own member back to back, weak or
 * generic links).
 *
 * Run from the repository root through the CommonJS launcher:
 *   npx tsx script/journeys/eval/run-grid.cts --label after [--quick] [--no-themes] [--length 5] [--site London]
 *   npx tsx script/journeys/eval/run-grid.cts --show "London|2027-01-08T20:30|10x50|*" [--length 8]   one request, printed in full
 *   npx tsx script/journeys/eval/run-grid.cts --examples                 docs examples (engine-eval.md), printed
 *   npx tsx script/journeys/eval/run-grid.cts --label after --summary-only   re-summarise existing rows
 * Output: data-dev/journeys-eval/<label>/{rows-<site>.jsonl, summary.json, summary.md}
 * JOURNEY_ENGINE_DIR=<dir with assemble.ts, narrate.ts> runs another copy of the engine (e.g. the pre-evaluation
 * one) under the same metrics; the KB loader and the independent checker always come from this tree.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as AstroNs from 'astronomy-engine';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type * as AssembleNs from '../../../client/src/lib/journeys/assemble';
import { knowledgeBaseFromFiles } from '../../../client/src/lib/journeys/kb-schema';
import type * as NarrateNs from '../../../client/src/lib/journeys/narrate';
import { independentProblems, resultProblems } from '../../../client/src/lib/journeys/__tests__/engine-helpers';
import type { Journey, JourneyRequest, JourneyResult, KbObject, KnowledgeBase } from '../../../client/src/lib/journeys/types';

const Astro = ((AstroNs as unknown as { default?: typeof AstroNs }).default ?? AstroNs) as typeof AstroNs;
const ROOT = process.cwd();

// The engine under test (this tree by default). Loaded with require: the launcher runs this file as CommonJS.
const ENGINE_DIR = process.env.JOURNEY_ENGINE_DIR ? resolve(process.env.JOURNEY_ENGINE_DIR) : join(ROOT, 'client/src/lib/journeys');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TEXT_SEED, generate } = require(join(ENGINE_DIR, 'assemble.ts')) as typeof AssembleNs;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { narrateJourney } = require(join(ENGINE_DIR, 'narrate.ts')) as typeof NarrateNs;

// ───────────────────────────── args ─────────────────────────────

const arg = (name: string, def?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const flag = (name: string) => process.argv.includes(`--${name}`);

// ───────────────────────────── grid ─────────────────────────────

export const SITES = [
  { name: 'San Francisco', lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles', sky: 19.0 },
  { name: 'Colorado dark site', lat: 38.8, lon: -104.5, tz: 'America/Denver', sky: 21.5 },
  { name: 'London', lat: 51.5, lon: -0.1, tz: 'Europe/London', sky: 19.0 },
  { name: 'Sydney', lat: -33.9, lon: 151.2, tz: 'Australia/Sydney', sky: 19.0 },
  { name: 'Santiago', lat: -33.4, lon: -70.7, tz: 'America/Santiago', sky: 19.0 },
] as const;
type Site = (typeof SITES)[number];

export const OPTICS = {
  '10x50': { fovDeg: 6.5, aperture: 50, magnification: 10 },
  '7x50': { fovDeg: 7.1, aperture: 50, magnification: 7 },
} as const;
type OpticName = keyof typeof OPTICS;

export interface Night { date: string; kind: '15th' | 'new' | 'full'; month: number }

/** Local evening date (yyyy-MM-dd) of the night that contains `t` at this site. */
const nightDateOf = (t: Date, tz: string) => formatInTimeZone(new Date(t.getTime() - 12 * 3_600_000), tz, 'yyyy-MM-dd');

export function nightsFor(site: Site, quick: boolean): Night[] {
  const out: Night[] = [];
  const phases: { kind: 'new' | 'full'; t: Date }[] = [];
  if (!quick) {
    for (const [kind, lon] of [['new', 0], ['full', 180]] as const) {
      let t: Date = new Date('2026-12-01T00:00:00Z');
      for (let k = 0; k < 16; k++) {
        const ev = Astro.SearchMoonPhase(lon, t, 40);
        if (!ev) break;
        phases.push({ kind, t: ev.date });
        t = new Date(ev.date.getTime() + 86_400_000);
      }
    }
  }
  for (let m = 1; m <= 12; m++) {
    const d15 = `2027-${String(m).padStart(2, '0')}-15`;
    out.push({ date: d15, kind: '15th', month: m });
    if (quick) continue;
    const mid = fromZonedTime(`${d15}T22:00:00`, site.tz).getTime();
    for (const kind of ['new', 'full'] as const) {
      const near = phases.filter((p) => p.kind === kind).sort((a, b) => Math.abs(a.t.getTime() - mid) - Math.abs(b.t.getTime() - mid))[0];
      if (near) out.push({ date: nightDateOf(near.t, site.tz), kind, month: m });
    }
  }
  const seen = new Set<string>();
  return out.filter((n) => (seen.has(n.date) ? false : (seen.add(n.date), true)));
}

/** The two request instants of a night: 1.5 h after astronomical dusk (or solar midnight) and 23:30 local. */
export function timesFor(site: Site, date: string): { label: 'dusk+1.5h' | '23:30'; instant: Date; note?: string }[] {
  const observer = new Astro.Observer(site.lat, site.lon, 0);
  const noon = fromZonedTime(`${date}T12:00:00`, site.tz);
  const dusk = Astro.SearchAltitude(Astro.Body.Sun, observer, -1, noon, 1, -18)?.date;
  let first: Date, note: string | undefined;
  if (dusk && dusk.getTime() - noon.getTime() < 16 * 3_600_000) first = new Date(dusk.getTime() + 90 * 60_000);
  else {
    // No astronomical night (high-latitude summer): use the Sun's lowest point.
    const lowest = Astro.SearchHourAngle(Astro.Body.Sun, observer, 12, noon, 1).time.date;
    first = lowest; note = 'no astronomical night: solar midnight';
  }
  const late = fromZonedTime(`${date}T23:30:00`, site.tz);
  return [{ label: 'dusk+1.5h', instant: first, ...(note ? { note } : {}) }, { label: '23:30', instant: late }];
}

// ───────────────────────────── KB ─────────────────────────────

export function loadRealKb(): KnowledgeBase {
  const dir = join(ROOT, 'client/public/data/journeys');
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json') });
}

// ───────────────────────────── content flags ─────────────────────────────

export interface JourneyRow {
  key: string;
  ident: string;
  templateId: string;
  switchTo: string | null;
  title: string;
  stops: string[];
  roles: string[];
  links: string[];
  n: number;
  pathDeg: number;
  /** Largest distance of a stop from the stops' own centroid (degrees). */
  spreadDeg: number;
  maxHopDeg: number;
  regionRadius: number;
  curatedLinkFrac: number;
  minLinkStrength: number;
  relaxed: string[];
  flags: string[];
  violations: string[];
}

const RAD = Math.PI / 180;
const sep = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) => {
  const c = Math.sin(a.dec * RAD) * Math.sin(b.dec * RAD) + Math.cos(a.dec * RAD) * Math.cos(b.dec * RAD) * Math.cos((a.ra - b.ra) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
};

/** Is one object part of the other (a cluster and its own member star, a nebula and its powering star)? */
export function memberOf(a: KbObject, b: KbObject): boolean {
  const inside = (x: KbObject, y: KbObject) =>
    (y.kind === 'dso' && (y.poweredBy?.starIds ?? []).includes(x.id)) || x.contextIds.includes(y.id);
  return inside(a, b) || inside(b, a);
}

export function journeyFlags(j: Journey, kb: KnowledgeBase, byId: Map<string, KbObject>, moonIllumination: number): string[] {
  const flags: string[] = [];
  const objs = j.stops.map((s) => byId.get(s.objectId)!);
  const payoffIdx = j.stops.map((s) => s.arc).lastIndexOf('payoff');
  if (payoffIdx >= 0) {
    // A payoff a lecturer would veto: hard to see, dull and of little interest, or a faint star.
    // Hard veto (faint-payoff): hard to see or a star below naked-eye brightness. Soft (dull-payoff): an easy but
    // unremarkable climax (wow ≤ 1, or wow 2 with interest < 0.7), e.g. Merak closing a thermometer.
    // A slot that asks for a hard payoff (maxObsDifficulty ≥ 4, e.g. A8's Veil) is exempt, as in the engine.
    const p = objs[payoffIdx];
    const tpl = kb.templates.find((t) => t.id === (j.switch && payoffIdx > j.switch.atStop ? j.switch.toTemplateId : j.templateId));
    const slot = tpl?.slots.find((x) => x.label === j.stops[payoffIdx].role);
    const hardOk = (slot?.match.maxObsDifficulty ?? 0) >= 4;
    const faintStar = p.kind === 'star' && p.mag !== null && p.mag > 6;
    if (!hardOk && (p.obsDifficulty >= 4 || faintStar)) flags.push(`faint-payoff:${p.id}`);
    else if (!hardOk && (p.wow <= 1 || (p.wow <= 2 && p.interest < 0.7))) flags.push(`dull-payoff:${p.id}`);
    if (j.stops[payoffIdx].challenge && !hardOk) flags.push(`challenge-payoff:${p.id}`);
  }
  const h = objs[0];
  if (h.obsDifficulty > 2 || (!h.showpiece && h.wow < 3)) flags.push(`weak-opener:${h.id}`);
  for (let i = 1; i < objs.length; i++) {
    const a = objs[i - 1], b = objs[i];
    const d = sep(a, b);
    if (memberOf(a, b) && d < 1) flags.push(`member-adjacent:${a.id}>${b.id}`);
    else if (d < 1) flags.push(`same-view-curated:${a.id}>${b.id}(${d.toFixed(2)}°)`);
    const l = j.stops[i].link!;
    if (l.type === 'SAME_FAMILY') flags.push(`same-family-link:${b.id}`);
    if (!l.curated && l.strength < 0.5) flags.push(`weak-derived-link:${l.type}/${l.subtype}@${b.id}`);
  }
  // Generic (builtin) texts mean the bank had no variant that could be filled.
  const nar = narrateJourney(j, kb, { seedKey: TEXT_SEED, region: j.regionName, moonIllumination });
  for (const s of nar.stops) if (s.transition?.key.startsWith('builtin:')) flags.push(`generic-transition:${s.objectId}`);
  if (nar.title.key.startsWith('builtin:')) flags.push('generic-title');
  return flags;
}

function journeyRow(j: Journey, req: JourneyRequest, res: JourneyResult, kb: KnowledgeBase, byId: Map<string, KbObject>): JourneyRow {
  const objs = j.stops.map((s) => byId.get(s.objectId)!);
  const cx = objs.reduce((acc, o) => [acc[0] + Math.cos(o.dec * RAD) * Math.cos(o.ra * RAD), acc[1] + Math.cos(o.dec * RAD) * Math.sin(o.ra * RAD), acc[2] + Math.sin(o.dec * RAD)], [0, 0, 0]);
  const centroid = { ra: ((Math.atan2(cx[1], cx[0]) / RAD) + 360) % 360, dec: Math.asin(cx[2] / Math.hypot(cx[0], cx[1], cx[2])) / RAD };
  const links = j.stops.slice(1).map((s) => s.link!);
  const moonIllum = res.conditions?.moon.up ? res.conditions.moon.illumination : 0;
  return {
    key: j.key,
    ident: `${j.templateId}${j.switch ? `>${j.switch.toTemplateId}` : ''}|${j.stops.map((s) => s.objectId).join('>')}`,
    templateId: j.templateId,
    switchTo: j.switch?.toTemplateId ?? null,
    title: j.title,
    stops: j.stops.map((s) => s.objectId),
    roles: j.stops.map((s) => s.role),
    links: links.map((l) => `${l.type}/${l.subtype}${l.curated ? '*' : ''}@${l.strength}`),
    n: j.stops.length,
    pathDeg: j.totalPathDeg,
    spreadDeg: Math.round(Math.max(...objs.map((o) => sep(o, centroid))) * 10) / 10,
    maxHopDeg: Math.round(Math.max(0, ...objs.slice(1).map((o, i) => sep(objs[i], o))) * 10) / 10,
    regionRadius: j.regionRadius,
    curatedLinkFrac: links.length ? links.filter((l) => l.curated).length / links.length : 0,
    minLinkStrength: links.length ? Math.min(...links.map((l) => l.strength)) : 0,
    relaxed: j.conditions?.relaxed ?? [],
    flags: journeyFlags(j, kb, byId, moonIllum),
    violations: independentProblems(kb, req, res, j),
  };
}

// ───────────────────────────── one request ─────────────────────────────

export interface RequestRow {
  site: string;
  night: string;
  nightKind: Night['kind'];
  month: number;
  time: string;
  timeNote?: string;
  instant: string;
  optic: OpticName;
  theme: string | null;
  sunAlt: number;
  darkness: string;
  moonUp: boolean;
  moonIllum: number;
  ms: number;
  cold: boolean;
  count: number;
  message: string;
  limitingFactors: string[];
  reasonsRejected: Record<string, number>;
  relaxed: string[];
  candidates: number;
  validated: number;
  sharedStops: number;
  /** Result-level problems (owner feedback round 1): same title, ≥ 2 shared stops, same archetype over one region. */
  resultProblems: string[];
  /** Size of the ranked pool the suggestions were drawn from (0 when the engine has no inspectPool hook). */
  poolSize: number;
  /** 0-based rank of each suggestion in that pool (−1 when unknown). */
  pickRanks: number[];
  /** Each suggestion's score normalised over the pool (1 = the pool's best, 0 = its worst). */
  pickScorePct: number[];
  journeys: JourneyRow[];
}

function runOne(kb: KnowledgeBase, byId: Map<string, KbObject>, site: Site, night: Night, time: ReturnType<typeof timesFor>[number], optic: OpticName, theme: string | null, cold: boolean): RequestRow {
  const req: JourneyRequest = {
    instant: time.instant.toISOString(), lat: site.lat, lon: site.lon, timezone: site.tz,
    instrument: OPTICS[optic], skyBrightness: site.sky, theme, length: Number(arg('length', '5')), minAlt: 30, includeChallenge: true, limit: 3, shuffle: 0, seenObjectIds: [],
  };
  let pool: readonly Journey[] = [];
  const t0 = performance.now();
  const res = generate(kb, req, { clock: () => performance.now(), inspectPool: (p: readonly Journey[]) => { pool = p; } } as Parameters<typeof generate>[2]);
  const ms = performance.now() - t0;
  const rankOf = new Map(pool.map((j, i) => [j.key, i] as const));
  const scores = pool.map((j) => j.score);
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const c = res.conditions!;
  const counts = new Map<string, number>();
  for (const j of res.journeys) for (const id of new Set(j.stops.map((s) => s.objectId))) counts.set(id, (counts.get(id) ?? 0) + 1);
  return {
    site: site.name, night: night.date, nightKind: night.kind, month: night.month, time: time.label, ...(time.note ? { timeNote: time.note } : {}),
    instant: req.instant, optic, theme,
    sunAlt: c.sunAltDeg, darkness: c.darkness, moonUp: c.moon.up, moonIllum: c.moon.illumination,
    ms: Math.round(ms * 10) / 10, cold,
    count: res.journeys.length,
    message: res.diagnostics.message,
    limitingFactors: res.diagnostics.limitingFactors,
    reasonsRejected: res.diagnostics.reasonsRejected as Record<string, number>,
    relaxed: res.diagnostics.relaxed ?? [],
    candidates: res.diagnostics.candidates ?? 0,
    validated: res.diagnostics.validated ?? 0,
    sharedStops: Array.from(counts.values()).filter((v) => v > 1).length,
    resultProblems: resultProblems(res),
    poolSize: pool.length,
    pickRanks: res.journeys.map((j) => rankOf.get(j.key) ?? -1),
    pickScorePct: pool.length ? res.journeys.map((j) => Math.round(1000 * (hi > lo ? (j.score - lo) / (hi - lo) : 1)) / 1000) : [],
    journeys: res.journeys.map((j) => journeyRow(j, req, res, kb, byId)),
  };
}

function runSite(kb: KnowledgeBase, site: Site, opts: { quick: boolean; themes: boolean }, onRow: (r: RequestRow) => void): void {
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const templates = kb.templates.map((t) => t.id).sort();
  for (const night of nightsFor(site, opts.quick)) {
    const times = timesFor(site, night.date);
    for (const time of times) {
      let cold = true;
      for (const optic of Object.keys(OPTICS) as OpticName[]) {
        onRow(runOne(kb, byId, site, night, time, optic, null, cold));
        cold = false;
      }
      if (opts.themes && time.label === 'dusk+1.5h') {
        for (const theme of templates) onRow(runOne(kb, byId, site, night, time, '10x50', theme, false));
      }
    }
  }
}

// ───────────────────────────── summary ─────────────────────────────

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const quantile = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');

/** A "typical dark moonless night": astronomical night, Moon down or ≤ 25 % lit. */
const isDarkMoonless = (r: RequestRow) => r.darkness === 'night' && (!r.moonUp || r.moonIllum <= 0.25);
const isMoonlit = (r: RequestRow) => r.moonUp && r.moonIllum >= 0.6;
/** A journey is "good" when it has no violations and no content flag a lecturer would veto. */
const VETO = /^(faint-payoff|member-adjacent|challenge-payoff|generic-transition)/;
const good = (j: JourneyRow) => !j.violations.length && !j.flags.some((f) => VETO.test(f));
/** "Good" and also no soft complaint (dull payoff). */
const excellent = (j: JourneyRow) => good(j) && !j.flags.some((f) => f.startsWith('dull-payoff'));
/** Archetypes built for a bright Moon (doc 04 §3.2 moonSuitability bright-ok). */
const MOON_FRIENDLY = /^(A2|A9|A10|A12|A5)-/;

export function summarize(rows: RequestRow[]) {
  const def = rows.filter((r) => r.theme === null);
  const themed = rows.filter((r) => r.theme !== null);
  const js = def.flatMap((r) => r.journeys);
  const allJs = rows.flatMap((r) => r.journeys);
  const tally = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); };
  const flagKinds = tally(allJs.flatMap((j) => Array.from(new Set(j.flags.map((f) => f.split(':')[0])))));
  const violations = allJs.flatMap((j) => j.violations);
  const darkRows = def.filter(isDarkMoonless);
  const moonRows = def.filter(isMoonlit);
  const goodCount = (r: RequestRow) => r.journeys.filter(good).length;
  // Staleness: per (site, time, optic) series over the 15th-of-month nights, how many journeys repeat elsewhere.
  const series = new Map<string, RequestRow[]>();
  for (const r of def) { const k = `${r.site}|${r.time}|${r.optic}`; if (!series.has(k)) series.set(k, []); series.get(k)!.push(r); }
  let repeatJ = 0, totalJ = 0, adjRepeat = 0, adjPairs = 0;
  const topRepeats = new Map<string, number>();
  series.forEach((rs) => {
    const nightsOf = new Map<string, Set<string>>();
    for (const r of rs) for (const j of r.journeys) { if (!nightsOf.has(j.ident)) nightsOf.set(j.ident, new Set()); nightsOf.get(j.ident)!.add(r.night); }
    for (const r of rs) for (const j of r.journeys) { totalJ++; if (nightsOf.get(j.ident)!.size > 1) repeatJ++; }
    nightsOf.forEach((ns, id) => { if (ns.size > 2) topRepeats.set(id, Math.max(topRepeats.get(id) ?? 0, ns.size)); });
    // Consecutive nights in the list (15th vs nearest new/full, a few days apart): same top journey?
    const sorted = rs.slice().sort((a, b) => a.night.localeCompare(b.night));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const days = (Date.parse(b.night) - Date.parse(a.night)) / 86_400_000;
      if (days > 4 || !a.journeys.length || !b.journeys.length) continue;
      adjPairs++;
      const A = new Set(a.journeys.map((j) => j.ident));
      if (b.journeys.some((j) => A.has(j.ident))) adjRepeat++;
    }
  });
  const ms = def.map((r) => r.ms), coldMs = def.filter((r) => r.cold).map((r) => r.ms);
  // Suggestion depth (owner feedback round 1): rank of each pick in the pool it was drawn from.
  const ranked = def.filter((r) => r.poolSize > 0);
  const firstRanks = ranked.map((r) => r.pickRanks[0]).filter((x) => x >= 0);
  const allRanks = ranked.flatMap((r) => r.pickRanks).filter((x) => x >= 0);
  const allPct = ranked.flatMap((r) => r.pickScorePct);
  const firstTemplates = tally(def.filter((r) => r.journeys.length).map((r) => r.journeys[0].templateId));
  const ladderRows = allJs.filter((j) => /^A(3|4|11)-/.test(j.templateId) || /^A(3|4|11)-/.test(j.switchTo ?? ''));
  const bySite = SITES.map((s) => {
    const rs = def.filter((r) => r.site === s.name);
    const dark = rs.filter(isDarkMoonless);
    const moon = rs.filter(isMoonlit);
    return {
      site: s.name,
      requests: rs.length,
      meanJourneys: mean(rs.map((r) => r.count)),
      empty: rs.filter((r) => !r.count).length,
      darkRequests: dark.length,
      darkWith3Good: dark.filter((r) => goodCount(r) >= 3).length,
      moonlitRequests: moon.length,
      moonlitWith1: moon.filter((r) => r.count >= 1).length,
      medianMs: quantile(rs.map((r) => r.ms), 0.5),
      p95Ms: quantile(rs.map((r) => r.ms), 0.95),
    };
  });
  const byTheme = Array.from(new Set(themed.map((r) => r.theme!))).sort().map((t) => {
    const rs = themed.filter((r) => r.theme === t);
    const dark = rs.filter(isDarkMoonless), moon = rs.filter(isMoonlit);
    return {
      theme: t, requests: rs.length, nonEmpty: rs.filter((r) => r.count > 0).length,
      dark: dark.length, darkNonEmpty: dark.filter((r) => r.count > 0).length,
      moonlit: moon.length, moonlitNonEmpty: moon.filter((r) => r.count > 0).length,
      relaxedOnly: rs.filter((r) => r.count > 0 && r.journeys.every((j) => j.relaxed.length)).length,
      meanJourneys: mean(rs.map((r) => r.count)),
    };
  });
  return {
    requests: def.length,
    themedRequests: themed.length,
    journeys: js.length,
    meanJourneys: mean(def.map((r) => r.count)),
    emptyRate: def.filter((r) => !r.count).length / (def.length || 1),
    emptyByDarkness: tally(def.filter((r) => !r.count).map((r) => `${r.darkness}${r.moonUp && r.moonIllum > 0.4 ? '+moon' : ''}`)),
    emptyMessages: tally(def.filter((r) => !r.count).map((r) => r.message)).slice(0, 8),
    themedEmptyMessages: tally(themed.filter((r) => !r.count).map((r) => r.message.replace(/\d+(\.\d+)?/g, '#'))).slice(0, 10),
    lowVarietyRequests: def.filter((r) => r.count > 1 && new Set(r.journeys.map((j) => j.templateId)).size === 1).length,
    lessThan3: def.filter((r) => r.count < 3).length,
    darkRequests: darkRows.length,
    darkWith3Good: darkRows.filter((r) => goodCount(r) >= 3).length,
    darkWith3: darkRows.filter((r) => r.count >= 3).length,
    moonlitRequests: moonRows.length,
    moonlitWith1: moonRows.filter((r) => r.count >= 1).length,
    moonlitWithFriendly: moonRows.filter((r) => r.journeys.some((j) => MOON_FRIENDLY.test(j.templateId))).length,
    darkWith3Excellent: darkRows.filter((r) => r.journeys.filter(excellent).length >= 3).length,
    moonlitTemplates: tally(moonRows.flatMap((r) => r.journeys.map((j) => j.templateId))),
    templates: tally(js.map((j) => j.templateId)),
    switched: js.filter((j) => j.switchTo).length,
    stopCounts: tally(js.map((j) => String(j.n))),
    relaxedJourneys: js.filter((j) => j.relaxed.length).length,
    relaxations: tally(js.flatMap((j) => j.relaxed)),
    reasonsRejected: tally(def.flatMap((r) => Object.entries(r.reasonsRejected).flatMap(([k, v]) => Array(Math.min(v, 1)).fill(k)))),
    path: { mean: mean(js.map((j) => j.pathDeg)), p50: quantile(js.map((j) => j.pathDeg), 0.5), p95: quantile(js.map((j) => j.pathDeg), 0.95), max: Math.max(0, ...js.map((j) => j.pathDeg)) },
    spread: { mean: mean(js.map((j) => j.spreadDeg)), p95: quantile(js.map((j) => j.spreadDeg), 0.95), max: Math.max(0, ...js.map((j) => j.spreadDeg)) },
    maxHop: { p95: quantile(js.map((j) => j.maxHopDeg), 0.95), max: Math.max(0, ...js.map((j) => j.maxHopDeg)) },
    curatedLinkFrac: mean(js.map((j) => j.curatedLinkFrac)),
    sharedStops: { meanPerRequest: mean(def.filter((r) => r.count >= 2).map((r) => r.sharedStops)), requestsWithShared: def.filter((r) => r.sharedStops > 0).length },
    staleness: { repeatFrac: repeatJ / (totalJ || 1), adjacentNightsSameJourney: `${adjRepeat}/${adjPairs}`, mostRepeated: Array.from(topRepeats.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6) },
    runtime: { median: quantile(ms, 0.5), p90: quantile(ms, 0.9), p95: quantile(ms, 0.95), max: Math.max(0, ...ms), coldMedian: quantile(coldMs, 0.5), coldP95: quantile(coldMs, 0.95), over300: ms.filter((x) => x > 300).length },
    violations: { count: violations.length, journeysWith: allJs.filter((j) => j.violations.length).length, examples: tally(violations.map((v) => v.replace(/[\d.]+/g, '#'))).slice(0, 10) },
    flags: flagKinds,
    goodFrac: js.filter(good).length / (js.length || 1),
    resultProblems: { requests: rows.filter((r) => (r.resultProblems ?? []).length).length, examples: tally(rows.flatMap((r) => (r.resultProblems ?? []).map((p) => p.replace(/"[^"]*"|\S+\/\S+/g, '…')))).slice(0, 5) },
    depth: ranked.length ? {
      requests: ranked.length,
      firstRank: { p50: quantile(firstRanks, 0.5), p90: quantile(firstRanks, 0.9), max: Math.max(...firstRanks) },
      anyRank: { p50: quantile(allRanks, 0.5), p90: quantile(allRanks, 0.9), max: Math.max(...allRanks) },
      scorePct: { p10: quantile(allPct, 0.1), p50: quantile(allPct, 0.5), min: Math.min(...allPct) },
      meanPool: mean(ranked.map((r) => r.poolSize)),
    } : null,
    firstTemplates,
    ladders: { journeys: ladderRows.length, withLadderViolation: ladderRows.filter((j) => j.violations.some((v) => v.startsWith('ladder'))).length },
    a6Share: js.filter((j) => j.templateId === 'A6-contrasts').length / (js.length || 1),
    themeBalance: themeBalance(def),
    bySite,
    byTheme,
  };
}

/** Archetype of a journey row ("A6-contrasts" → "A6"); a switched journey counts as both its archetypes. */
const archOf = (id: string) => id.split('-')[0];
const tellsA6 = (j: JourneyRow) => archOf(j.templateId) === 'A6' || (j.switchTo !== null && archOf(j.switchTo) === 'A6');

/**
 * Theme balance of the app's top 3 (owner feedback round 1, second pass): archetype per suggestion position, the
 * share of results offering each archetype, A6 per position and per site, and results with more than one A6 tour.
 */
export function themeBalance(def: RequestRow[]) {
  const ARCH = Array.from({ length: 12 }, (_, i) => `A${i + 1}`);
  const withJ = def.filter((r) => r.count > 0);
  const byPos = [0, 1, 2].map((k) => Object.fromEntries(ARCH.map((a) => [a, withJ.filter((r) => r.journeys[k] && archOf(r.journeys[k].templateId) === a).length])));
  const offered = Object.fromEntries(ARCH.map((a) => [a, withJ.filter((r) => r.journeys.some((j) => archOf(j.templateId) === a)).length]));
  const a6Pos = [0, 1, 2].map((k) => withJ.filter((r) => r.journeys[k] && tellsA6(r.journeys[k])).length);
  const a6Top2 = withJ.filter((r) => r.journeys.slice(0, 2).some(tellsA6)).length;
  const a6Multi = def.filter((r) => r.journeys.filter(tellsA6).length > 1).length;
  const a6FirstBySite = SITES.map((st) => {
    const rs = withJ.filter((r) => r.site === st.name);
    return { site: st.name, requests: rs.length, first: rs.filter((r) => tellsA6(r.journeys[0])).length, top2: rs.filter((r) => r.journeys.slice(0, 2).some(tellsA6)).length };
  });
  const themesPerResult = mean(withJ.map((r) => new Set(r.journeys.map((j) => archOf(j.templateId))).size));
  return { requests: withJ.length, byPos, offered, a6Pos, a6Top2, a6Multi, a6FirstBySite, themesPerResult };
}

export function summaryMarkdown(label: string, s: ReturnType<typeof summarize>): string {
  const L: string[] = [];
  L.push(`# Engine grid: ${label}`, '');
  L.push(`| metric | value |`, `|---|---|`);
  L.push(`| default requests | ${s.requests} (themed ${s.themedRequests}) |`);
  L.push(`| journeys / request (mean) | ${f1(s.meanJourneys)} |`);
  L.push(`| empty results | ${pct(s.emptyRate * s.requests, s.requests)} (${Math.round(s.emptyRate * s.requests)}) |`);
  L.push(`| fewer than 3 | ${s.lessThan3} |`);
  L.push(`| dark moonless requests with ≥3 good journeys | ${s.darkWith3Good}/${s.darkRequests} (${pct(s.darkWith3Good, s.darkRequests)}); ≥3 any: ${s.darkWith3} |`);
  L.push(`| … and with no dull payoff either | ${s.darkWith3Excellent}/${s.darkRequests} (${pct(s.darkWith3Excellent, s.darkRequests)}) |`);
  L.push(`| moonlit (≥60 %, up) requests with ≥1 journey | ${s.moonlitWith1}/${s.moonlitRequests} |`);
  L.push(`| moonlit requests offering a bright-Moon archetype (A2/A5/A9/A10/A12) | ${s.moonlitWithFriendly}/${s.moonlitRequests} |`);
  L.push(`| good journeys (no violation, no veto flag) | ${pct(s.goodFrac * s.journeys, s.journeys)} |`);
  L.push(`| hard-constraint violations (independent) | ${s.violations.count} in ${s.violations.journeysWith} journeys |`);
  L.push(`| path length ° (mean / p50 / p95 / max) | ${f1(s.path.mean)} / ${f1(s.path.p50)} / ${f1(s.path.p95)} / ${f1(s.path.max)} |`);
  L.push(`| spread from centroid ° (mean / p95 / max) | ${f1(s.spread.mean)} / ${f1(s.spread.p95)} / ${f1(s.spread.max)} |`);
  L.push(`| max hop ° (p95 / max) | ${f1(s.maxHop.p95)} / ${f1(s.maxHop.max)} |`);
  L.push(`| curated link share | ${pct(s.curatedLinkFrac, 1)} |`);
  L.push(`| switched journeys | ${s.switched}/${s.journeys} |`);
  L.push(`| journeys relying on a relaxation | ${s.relaxedJourneys}/${s.journeys} |`);
  L.push(`| requests where suggestions share a stop | ${s.sharedStops.requestsWithShared} (mean shared stops ${f1(s.sharedStops.meanPerRequest)}) |`);
  L.push(`| staleness: journeys shown on >1 night (same site/time/optic) | ${pct(s.staleness.repeatFrac, 1)}; nights ≤4 d apart sharing a journey ${s.staleness.adjacentNightsSameJourney} |`);
  L.push(`| runtime ms (median / p90 / p95 / max) | ${f1(s.runtime.median)} / ${f1(s.runtime.p90)} / ${f1(s.runtime.p95)} / ${f1(s.runtime.max)} |`);
  L.push(`| runtime cold slot ms (median / p95); >300 ms | ${f1(s.runtime.coldMedian)} / ${f1(s.runtime.coldP95)}; ${s.runtime.over300} |`);
  L.push(`| results with a same title / near-identical pair (all requests) | ${s.resultProblems.requests} |`);
  L.push(`| A6 share of default suggestions; A6 as the first suggestion | ${pct(s.a6Share, 1)}; ${s.firstTemplates.find(([k]) => k === 'A6-contrasts')?.[1] ?? 0}/${s.requests} |`);
  L.push(`| ladder journeys (A3/A4/A11, all requests) with a non-climbing step | ${s.ladders.withLadderViolation}/${s.ladders.journeys} |`);
  if (s.depth) {
    L.push(`| suggestion rank in its pool: first pick p50 / p90 / max | ${s.depth.firstRank.p50} / ${s.depth.firstRank.p90} / ${s.depth.firstRank.max} (mean pool ${f1(s.depth.meanPool)}) |`);
    L.push(`| suggestion rank in its pool: any pick p50 / p90 / max | ${s.depth.anyRank.p50} / ${s.depth.anyRank.p90} / ${s.depth.anyRank.max} |`);
    L.push(`| suggestion score, normalised over its pool (1 = best): p10 / p50 / min | ${s.depth.scorePct.p10} / ${s.depth.scorePct.p50} / ${s.depth.scorePct.min} |`);
  }
  const tb = s.themeBalance;
  L.push('', `Theme balance of the top 3 (${tb.requests} default requests with a journey; distinct archetypes per result ${f1(tb.themesPerResult)}):`, '');
  const arch = Object.keys(tb.offered).filter((a) => tb.offered[a] > 0 || tb.byPos.some((p) => p[a] > 0));
  L.push(`| position | ${arch.join(' | ')} |`, `|---|${arch.map(() => '---').join('|')}|`);
  tb.byPos.forEach((p, k) => L.push(`| #${k + 1} | ${arch.map((a) => p[a]).join(' | ')} |`));
  L.push(`| offered (any position) | ${arch.map((a) => `${tb.offered[a]} (${pct(tb.offered[a], tb.requests)})`).join(' | ')} |`);
  L.push('', `A6 as #1 / #2 / #3: ${tb.a6Pos.join(' / ')}; A6 in the top 2: ${tb.a6Top2}/${tb.requests}; results with more than one A6 tour: ${tb.a6Multi}`);
  L.push(`A6 first by site: ${tb.a6FirstBySite.map((x) => `${x.site} ${x.first}/${x.requests} (top 2: ${x.top2})`).join('; ')}`);
  L.push('', `Templates: ${s.templates.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`First suggestion: ${s.firstTemplates.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`Moonlit templates: ${s.moonlitTemplates.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`Stop counts: ${s.stopCounts.map(([k, v]) => `${k}:${v}`).join(', ')}`);
  L.push(`Relaxations: ${s.relaxations.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  L.push(`Requests with each rejection reason: ${s.reasonsRejected.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`Empty by sky: ${s.emptyByDarkness.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  L.push(`Content flags (journeys): ${s.flags.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (s.violations.examples.length) L.push(`Violations: ${s.violations.examples.map(([k, v]) => `${k} ×${v}`).join('; ')}`);
  L.push(`Most repeated journeys: ${s.staleness.mostRepeated.map(([k, v]) => `${k} (${v} nights)`).join('; ') || 'none'}`);
  L.push('', '| site | requests | mean journeys | empty | dark ≥3 good | moonlit ≥1 | median ms | p95 ms |', '|---|---|---|---|---|---|---|---|');
  for (const b of s.bySite) L.push(`| ${b.site} | ${b.requests} | ${f1(b.meanJourneys)} | ${b.empty} | ${b.darkWith3Good}/${b.darkRequests} | ${b.moonlitWith1}/${b.moonlitRequests} | ${f1(b.medianMs)} | ${f1(b.p95Ms)} |`);
  if (s.byTheme.length) {
    L.push('', '| theme | requests | non-empty | dark non-empty | moonlit non-empty | only relaxed | mean journeys |', '|---|---|---|---|---|---|---|');
    for (const t of s.byTheme) L.push(`| ${t.theme} | ${t.requests} | ${pct(t.nonEmpty, t.requests)} | ${t.darkNonEmpty}/${t.dark} | ${t.moonlitNonEmpty}/${t.moonlit} | ${t.relaxedOnly} | ${f1(t.meanJourneys)} |`);
  }
  L.push('', 'Empty-result messages (top):');
  for (const [m, n] of s.emptyMessages) L.push(`- (${n}) ${m}`);
  L.push('', `Requests whose suggestions all share one archetype: ${s.lowVarietyRequests}`);
  L.push('', 'Themed empty-result messages (top, numbers masked):');
  for (const [m, n] of s.themedEmptyMessages) L.push(`- (${n}) ${m}`);
  return L.join('\n');
}

// ───────────────────────────── main ─────────────────────────────

function runChildren(sites: readonly Site[], out: string, extra: string[]): Promise<void> {
  return Promise.all(sites.map((s) => new Promise<void>((ok, fail) => {
    const p = spawn('npx', ['tsx', 'script/journeys/eval/run-grid.cts', '--site', s.name, '--rows', join(out, `rows-${s.name.replace(/\W+/g, '_')}.jsonl`), ...extra], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${s.name} exited ${code}`))));
  }))).then(() => undefined);
}

/** One journey printed in full (title, question, story, stops with roles, links and transition texts). */
export function formatJourney(j: Journey, byId: Map<string, KbObject>, opts: { why?: boolean } = {}): string {
  const L: string[] = [];
  L.push(`**${j.title}** (${j.templateId}${j.switch ? ` → ${j.switch.toTemplateId} after stop ${j.switch.atStop + 1}` : ''}; ${j.stops.length} stops, ${j.durationMin} min, path ${j.totalPathDeg}°, ${j.difficulty})`);
  L.push('', `*${j.drivingQuestion}* — ${j.hook}`, '', `> ${j.story ?? ''}`, '');
  j.stops.forEach((s, i) => {
    const o = byId.get(s.objectId)!;
    const mag = o.mag === null ? '' : `, mag ${o.mag}`;
    const link = s.link ? ` — via ${s.link.type}/${s.link.subtype}${s.link.curated ? ' (curated)' : ''} ${s.link.strength}` : '';
    L.push(`${i + 1}. **${o.names.display}** (${s.role}${mag}; alt ${Math.round(s.altAtStart)}°${s.challenge ? '; challenge' : ''})${link}`);
    if (s.transitionText) L.push(`   - *From the last stop:* ${s.transitionText}`);
    if (s.whyHereText && opts.why !== false) L.push(`   - *Why here:* ${s.whyHereText}`);
  });
  return L.join('\n');
}

/** `--show "<site>|<local yyyy-MM-ddTHH:mm>|<optic>|<theme or *>"`: run one request and print it in full. */
function show(spec: string): void {
  const [siteName, local, optic = '10x50', theme = '*'] = spec.split('|');
  const site = SITES.find((s) => s.name === siteName);
  if (!site) throw new Error(`unknown site ${siteName}`);
  const kb = loadRealKb();
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const instant = fromZonedTime(local, site.tz).toISOString();
  const req: JourneyRequest = { instant, lat: site.lat, lon: site.lon, timezone: site.tz, instrument: OPTICS[optic as OpticName], skyBrightness: site.sky, theme: theme === '*' ? null : theme, length: Number(arg('length', '5')), includeChallenge: true, limit: Number(arg('limit', '3')) };
  generate(kb, req);
  const t0 = performance.now();
  const res = generate(kb, req);
  console.log(`## ${site.name}, ${local} (${optic}${theme !== '*' ? `, theme ${theme}` : ''}) — ${res.journeys.length} journeys, ${(performance.now() - t0).toFixed(0)} ms warm`);
  console.log(`Conditions: ${res.diagnostics.message} Moon ${res.conditions?.moon.up ? `up ${Math.round((res.conditions?.moon.illumination ?? 0) * 100)}%` : 'down'}.\n`);
  for (const j of res.journeys) {
    console.log(formatJourney(j, byId));
    const v = independentProblems(kb, req, res, j);
    if (v.length) console.log(`   VIOLATIONS: ${v.join('; ')}`);
    console.log(`   flags: ${journeyFlags(j, kb, byId, res.conditions?.moon.up ? res.conditions.moon.illumination : 0).join(', ') || 'none'}\n`);
  }
}

export async function main(): Promise<void> {
  if (arg('show')) { show(arg('show')!); return; }
  const label = arg('label', 'grid')!;
  const quick = flag('quick');
  const themes = !flag('no-themes') && !quick;
  const out = join(ROOT, 'data-dev/journeys-eval', label);
  mkdirSync(out, { recursive: true });
  const siteName = arg('site');
  const summaryOnly = flag('summary-only');
  const childFlags = ['--label', label, '--length', arg('length', '5')!, ...(quick ? ['--quick'] : []), ...(themes ? [] : ['--no-themes'])];

  if (summaryOnly) {
    // Re-summarise existing rows (e.g. after the summary gained a metric).
  } else if (siteName) {
    // Child (or single-site) mode: run one site and write its rows.
    const site = SITES.find((s) => s.name === siteName);
    if (!site) throw new Error(`unknown site ${siteName}`);
    const kb = loadRealKb();
    const rowsPath = arg('rows') ?? join(out, `rows-${site.name.replace(/\W+/g, '_')}.jsonl`);
    const lines: string[] = [];
    let n = 0;
    // Warm-up: KB preparation is memoised per KB object (the worker pays it once at load).
    generate(kb, { instant: '2027-01-15T06:00:00Z', lat: site.lat, lon: site.lon, instrument: OPTICS['10x50'], skyBrightness: site.sky });
    runSite(kb, site, { quick, themes }, (r) => { lines.push(JSON.stringify(r)); if (++n % 50 === 0) process.stderr.write(`[${site.name}] ${n}\n`); });
    writeFileSync(rowsPath, lines.join('\n') + '\n');
    if (arg('rows')) return;
  } else {
    await runChildren(SITES, out, childFlags);
  }
  const rows: RequestRow[] = [];
  for (const s of SITES) {
    const p = join(out, `rows-${s.name.replace(/\W+/g, '_')}.jsonl`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line) as RequestRow);
  }
  const summary = summarize(rows);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  const md = summaryMarkdown(label, summary);
  writeFileSync(join(out, 'summary.md'), md);
  console.log(md);
}
