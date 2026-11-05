/**
 * Sky Journeys reading tool for reviewers and theme writers (owner feedback round 2): the journeys the app would
 * suggest over a grid of nights, printed as readable text, plus an availability report.
 *
 * Grid: San Francisco, Colorado dark site, London, Sydney, Santiago × six dates across 2027 (the 15th of Jan, Mar,
 * May, Jul, Sep, Nov) × 10x50 (6.5° field) and 7x35 (8° field), starting 1.5 h after astronomical dusk (solar
 * midnight where the night never gets dark), the app's default request (5 stops, 30° floor, one challenge allowed).
 *
 * Reading mode (default): per night the top 3 journeys (generate, as the app shows them): title, driving question,
 * story; per stop the beat chip, the transition, why, what to look at, the Story box (lens.story, else the shared story), the question and its answer, and
 * (on a lens stop) the shared story and the wonder that move under "More about {name}"
 * (the card as lib/journeys/stop-card.ts resolves it); the payoff.
 * Availability mode (--availability): per theme and overall, the share of nights with at least 1 / 2 / 3 journeys,
 * journeys per theme and the objects used. Per theme the request forces that theme (as the app's theme picker does);
 * overall it is the default request.
 *
 *   npx tsx script/journeys/eval/print-journeys.cts [options]
 *     --theme <A2 | A2-thermometer | tag>   only this theme (forced in the request)
 *     --limit <n>                           print at most n journeys in all (reading mode)
 *     --per-night <k>                       journeys per night (default 3)
 *     --site <name> --month <m> --optic <10x50|7x35>   narrow the grid (site: substring, case-insensitive)
 *     --availability                        the availability report instead of the journeys
 *     --moon <grid|new>                     grid: the 15th of each month (default, mostly a bright Moon); new: the
 *                                           new-Moon night nearest the 15th (dark-sky themes A1, A8, A11)
 *     --sky <mag/arcsec²>                   override every site's sky brightness (e.g. 21.5 for a dark site)
 *     --fresh                               build the KB in memory from the sources (curated/lenses included)
 *                                           instead of reading client/public/data/journeys; prints build problems
 *     --lenses <dir>                        with --fresh: read the lens files from <dir>
 *     --no-lenses                           with --fresh: build without lenses (compare before / after)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatInTimeZone } from 'date-fns-tz';
import { generate } from '../../../client/src/lib/journeys/assemble';
import { knowledgeBaseFromFiles, knowledgeBaseFromReader } from '../../../client/src/lib/journeys/kb-schema';
import { resolveStopCard } from '../../../client/src/lib/journeys/stop-card';
import type { Journey, JourneyRequest, JourneyResult, KbObject, KnowledgeBase } from '../../../client/src/lib/journeys/types';
import { getConstellationName } from '../../../client/src/lib/astronomy';
import { build } from '../build_kb';
import { SITES, instantFor, nightOfPhase } from '../train/export-calibration-slates';

const ROOT = process.cwd();

export const GRID_SITES = ['San Francisco', 'Colorado dark site', 'London', 'Sydney', 'Santiago'] as const;
export type GridSite = (typeof GRID_SITES)[number];
export const GRID_MONTHS = [1, 3, 5, 7, 9, 11] as const;
export const GRID_OPTICS = {
  '10x50': { fovDeg: 6.5, aperture: 50, magnification: 10 },
  '7x35': { fovDeg: 8, aperture: 35, magnification: 7 },
} as const;
export type GridOptic = keyof typeof GRID_OPTICS;

export interface Night { site: GridSite; date: string; optic: GridOptic; req: JourneyRequest; note?: string }

/** The grid's nights (filtered), each with the app's default request at dusk + 1.5 h. */
export function gridNights(f: { site?: string; month?: number; optic?: string; moon?: 'grid' | 'new'; sky?: number } = {}): Night[] {
  const out: Night[] = [];
  for (const site of GRID_SITES) {
    if (f.site && !site.toLowerCase().includes(f.site.toLowerCase())) continue;
    for (const month of GRID_MONTHS) {
      if (f.month && f.month !== month) continue;
      // Default: the 15th (a bright Moon on most grid dates); --moon new: the new-Moon night nearest the 15th.
      const date = f.moon === 'new' ? nightOfPhase(site, month, 'new').date : `2027-${String(month).padStart(2, '0')}-15`;
      const t = instantFor(site, date, 'dusk+1.5h');
      for (const optic of Object.keys(GRID_OPTICS) as GridOptic[]) {
        if (f.optic && f.optic !== optic) continue;
        const st = SITES[site];
        out.push({
          site, date, optic, ...(t.note ? { note: t.note } : {}),
          req: {
            instant: t.instant.toISOString(), lat: st.lat, lon: st.lon, timezone: st.tz, instrument: GRID_OPTICS[optic],
            skyBrightness: f.sky ?? st.sky, theme: null, length: 5, minAlt: 30, includeChallenge: true, limit: 3, shuffle: 0, seenObjectIds: [],
          },
        });
      }
    }
  }
  return out;
}

/** The runtime KB: the built files, or (fresh) an in-memory build from the sources. */
export function loadKb(opts: { fresh?: boolean; lensDir?: string; lenses?: boolean } = {}, log: (s: string) => void = () => {}): KnowledgeBase {
  if (!opts.fresh) {
    const dir = join(ROOT, 'client/public/data/journeys');
    return knowledgeBaseFromReader((f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : undefined));
  }
  const r = build({ lenses: opts.lenses !== false, ...(opts.lensDir ? { lensDir: resolve(opts.lensDir) } : {}) });
  if (r.issues.length) log(`build problems (${r.issues.length}):\n- ${r.issues.join('\n- ')}`);
  log(`fresh KB ${r.version}: ${r.lenses.length ? r.lenses.map((l) => `${l.archetype} (${Object.keys(l.objects).length} objects)`).join(', ') : 'no lenses'}`);
  return knowledgeBaseFromFiles(r.files);
}

const wrap = (text: string, indent: string, width = 110): string => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (indent.length + cur.length + 1 + w.length) > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => indent + l).join('\n');
};
const labelled = (label: string, text: string | null | undefined, indent: string) => (text ? wrap(`${label} ${text}`, indent).replace(new RegExp(`^${indent}`), indent) : null);

function nightHeader(n: Night, res: JourneyResult): string {
  const c = res.conditions;
  const local = formatInTimeZone(new Date(n.req.instant), n.req.timezone!, 'yyyy-MM-dd HH:mm');
  const moon = c ? (c.moon.up ? `Moon ${Math.round(c.moon.illumination * 100)}% lit, up` : `Moon ${Math.round(c.moon.illumination * 100)}% lit, down`) : '';
  const o = GRID_OPTICS[n.optic];
  return `${n.site} · ${local} local · ${n.optic} (${o.fovDeg}°) · ${moon}${n.note ? ` · ${n.note}` : ''}`;
}

/** One journey as text (the card exactly as the app resolves it). */
export function journeyText(j: Journey, kb: KnowledgeBase, rank: number): string {
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const L: string[] = [];
  const tpl = kb.templates.find((t) => t.id === j.templateId);
  L.push(`#${rank} ${j.title}   [${j.templateId}${j.switch ? ` → ${j.switch.toTemplateId} after stop ${j.switch.atStop + 1}` : ''} · ${j.stops.length} stops · score ${j.score.toFixed(2)} · ${j.difficulty}]`);
  L.push(wrap(`Question: ${j.drivingQuestion}`, '   '));
  if (j.story) L.push(wrap(`Story: ${j.story}`, '   '));
  if (!tpl) L.push('   (template not in the KB)');
  j.stops.forEach((s) => {
    const o = byId.get(s.objectId) as KbObject;
    const c = resolveStopCard(j, s, o);
    L.push('');
    L.push(`   ${s.index + 1}. ${o.names.display} — ${getConstellationName(o.con)} · alt ${Math.round(s.altAtStart)}°${s.challenge ? ' · challenge' : ''}   [${c.beat}${c.lensed ? `, step ${s.lens!.step}` : ', no lens'} · ${s.arc}]`);
    for (const [label, text] of [
      ['→', c.transition], ['Why:', c.why], ['Q:', c.question], ['Look:', c.look], ['Story:', c.lensed ? c.story : c.understand], ['A:', c.answer], ['Wonder:', c.codaUnderMore ? null : c.wonder || null],
      ['More:', c.lensed ? [c.understand, c.codaUnderMore ? c.wonder : ''].filter(Boolean).join(' ') || null : null],
    ] as const) {
      const t = labelled(label, text, '      ');
      if (t) L.push(t);
    }
    if (c.payoff) L.push(wrap(`Payoff: ${c.payoff}`, '      '));
  });
  if (j.payoff && !j.stops.some((s) => resolveStopCard(j, s, byId.get(s.objectId)!).payoff)) L.push('', wrap(`Payoff: ${j.payoff}`, '   '));
  return L.join('\n');
}

const archOf = (id: string) => id.split('-')[0];

export interface Availability {
  nights: number;
  overall: { atLeast: [number, number, number]; perTheme: Record<string, number>; objects: number };
  themes: Record<string, { title: string; lensed: boolean; atLeast: [number, number, number]; journeys: number; objects: number; topObjects: [string, number][]; nightsNorth: [number, number]; nightsSouth: [number, number] }>;
}

/** Availability over the nights: default requests (overall) and one forced-theme request per theme and night. */
export function availability(kb: KnowledgeBase, nights: readonly Night[], themes: readonly string[], progress: (s: string) => void = () => {}): Availability {
  const lensed = new Set((kb.lenses ?? []).map((l) => l.archetype));
  const count3 = (ns: number[]): [number, number, number] => [1, 2, 3].map((k) => ns.filter((x) => x >= k).length / Math.max(1, ns.length)) as [number, number, number];
  const overallCounts: number[] = [];
  const perTheme: Record<string, number> = {};
  const overallObjects = new Set<string>();
  for (const n of nights) {
    const r = generate(kb, n.req);
    overallCounts.push(r.journeys.length);
    for (const j of r.journeys) {
      perTheme[archOf(j.templateId)] = (perTheme[archOf(j.templateId)] ?? 0) + 1;
      for (const s of j.stops) overallObjects.add(s.objectId);
    }
  }
  progress(`overall: ${nights.length} nights`);
  const out: Availability['themes'] = {};
  for (const theme of themes) {
    const t = kb.templates.find((x) => x.id === theme || x.archetype === theme)!;
    const counts: number[] = [];
    const used = new Map<string, number>();
    let journeys = 0;
    const north: [number, number] = [0, 0];
    const south: [number, number] = [0, 0];
    for (const n of nights) {
      const r = generate(kb, { ...n.req, theme: t.id });
      const mine = r.journeys.filter((j) => j.templateId === t.id);
      counts.push(mine.length);
      const h = SITES[n.site].hemisphere === 'north' ? north : south;
      h[1]++;
      if (mine.length) h[0]++;
      journeys += mine.length;
      for (const j of mine) for (const s of j.stops) used.set(s.objectId, (used.get(s.objectId) ?? 0) + 1);
    }
    out[t.archetype] = {
      title: t.title, lensed: lensed.has(t.archetype), atLeast: count3(counts), journeys, objects: used.size,
      topObjects: Array.from(used.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
      nightsNorth: north, nightsSouth: south,
    };
    progress(`${t.archetype}: ${journeys} journeys`);
  }
  return { nights: nights.length, overall: { atLeast: count3(overallCounts), perTheme, objects: overallObjects.size }, themes: out };
}

const pct = (x: number) => `${Math.round(100 * x)}%`.padStart(4);

export function availabilityText(a: Availability, kb: KnowledgeBase): string {
  const L: string[] = [];
  L.push(`Availability over ${a.nights} nights (5 sites × 6 dates × 2 binoculars, dusk + 1.5 h, 5 stops; north / south = nights with ≥1 journey)`);
  L.push('');
  L.push(`Overall (default request, up to 3 suggestions): ≥1 ${pct(a.overall.atLeast[0])}  ≥2 ${pct(a.overall.atLeast[1])}  ≥3 ${pct(a.overall.atLeast[2])}  · ${a.overall.objects} objects used`);
  L.push(`  suggestions per theme: ${Object.entries(a.overall.perTheme).sort((x, y) => Number(x[0].slice(1)) - Number(y[0].slice(1))).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  L.push('');
  L.push('Per theme (theme forced, up to 3 journeys a night):');
  L.push('  theme  lens   ≥1    ≥2    ≥3   north  south  journeys  objects  most used');
  for (const [arch, t] of Object.entries(a.themes).sort((x, y) => Number(x[0].slice(1)) - Number(y[0].slice(1)))) {
    const top = t.topObjects.map(([id, n]) => `${kb.objects.find((o) => o.id === id)?.names.display ?? id} ${n}`).join(', ');
    const hemi = (h: [number, number]) => `${h[0]}/${h[1]}`.padStart(5);
    L.push(`  ${arch.padEnd(5)}  ${(t.lensed ? 'yes' : 'no').padEnd(4)}  ${pct(t.atLeast[0])}  ${pct(t.atLeast[1])}  ${pct(t.atLeast[2])}  ${hemi(t.nightsNorth)}  ${hemi(t.nightsSouth)}   ${String(t.journeys).padStart(6)}   ${String(t.objects).padStart(6)}   ${top}`);
  }
  return L.join('\n');
}

export function parseArgs(argv: readonly string[]) {
  const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (name: string) => { const v = get(name); if (v === undefined) return undefined; const x = Number(v); if (!Number.isFinite(x)) throw new Error(`--${name} ${v}: not a number`); return x; };
  return {
    theme: get('theme'),
    limit: num('limit'),
    perNight: num('per-night') ?? 3,
    site: get('site'),
    month: num('month'),
    optic: get('optic'),
    moon: (get('moon') ?? 'grid') as 'grid' | 'new',
    sky: num('sky'),
    availability: argv.includes('--availability'),
    fresh: argv.includes('--fresh') || !!get('lenses') || argv.includes('--no-lenses'),
    lensDir: get('lenses'),
    lenses: !argv.includes('--no-lenses'),
  };
}

export async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const err = (s: string) => process.stderr.write(`${s}\n`);
  const kb = loadKb({ fresh: a.fresh, lensDir: a.lensDir, lenses: a.lenses }, err);
  if (a.optic && !(a.optic in GRID_OPTICS)) throw new Error(`--optic ${a.optic}: use ${Object.keys(GRID_OPTICS).join(' or ')}`);
  if (a.moon !== 'grid' && a.moon !== 'new') throw new Error(`--moon ${a.moon}: use grid or new`);
  const nights = gridNights({ site: a.site, month: a.month, optic: a.optic, moon: a.moon, sky: a.sky });
  if (!nights.length) throw new Error('no night matches the filters');
  const theme = a.theme ? kb.templates.find((t) => t.id === a.theme || t.archetype === a.theme || t.themeTags.includes(a.theme!)) : undefined;
  if (a.theme && !theme) throw new Error(`--theme ${a.theme}: not an active theme (${kb.templates.map((t) => t.archetype).join(', ')})`);
  console.log(`KB ${kb.version} · ${kb.templates.length} themes · lenses: ${(kb.lenses ?? []).map((l) => l.archetype).join(', ') || 'none'}`);
  if (a.availability) {
    const themes = theme ? [theme.id] : kb.templates.map((t) => t.id);
    console.log(availabilityText(availability(kb, nights, themes, err), kb));
    return;
  }
  let printed = 0;
  for (const n of nights) {
    if (a.limit !== undefined && printed >= a.limit) break;
    const req: JourneyRequest = { ...n.req, ...(theme ? { theme: theme.id } : {}), limit: Math.max(1, a.perNight) };
    const res = generate(kb, req);
    const js = res.journeys.filter((j) => !theme || j.templateId === theme.id).slice(0, a.perNight);
    console.log(`\n${'═'.repeat(110)}\n${nightHeader(n, res)}\n${'═'.repeat(110)}`);
    if (!js.length) { console.log(wrap(`No journey: ${res.diagnostics.message}`, '   ')); continue; }
    for (const [k, j] of js.entries()) {
      if (a.limit !== undefined && printed >= a.limit) break;
      console.log(`\n${journeyText(j, kb, k + 1)}`);
      printed++;
    }
  }
}
