/**
 * Schema + sanity test for the product owner's A/B round 1 (script/journeys/train/ab-round1.json, written by
 * script/journeys/train/export-ab-pairs.ts; AB_PAIRS_FILE=<path> checks another export). Checks the JSON shape, the
 * coverage the round promises (sites, hemispheres, Moon phases, binoculars, start times), that the 12 comparisons
 * all differ (no theme pair twice, contrast tours in at most 3 pairs, at least 9 of the 12 archetypes), that both
 * sides come from the top of their night's pool, that each pair really tests its hypothesis, that the shown sides
 * hide the engine's preference, that every stop carries what the owner judges (card question and answer, a picture
 * on disk, glossary terms defined in the file) and the sky block. The files are the owner's answer history, frozen
 * against the KB they were made with, so their journey keys are not rebuilt against the current KB.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BANNED } from './voice-rules';

/** The rounds checked: AB_PAIRS_FILE, else every committed round file (round 1, and round 2 from owner feedback r2). */
const FILES = process.env.AB_PAIRS_FILE
  ? [pathToFileURL(process.env.AB_PAIRS_FILE)]
  : ['ab-round1.json', 'ab-round2.json'].map((f) => new URL(`../../../../../script/journeys/train/${f}`, import.meta.url));
const PUBLIC = new URL('../../../../public/', import.meta.url);

/** A raw spectral class ("A7 III", "B-type") shown as a description. */
const RAW_CLASS = /\b[OBAFGKM]\d(?:\.\d)?\s?(?:Ia|Ib|III|II|IV|V)\b|\b[OBAFGKM]-type\b/;

const num = z.number().finite();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const nonEmpty = z.string().min(1);
const PHASES = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'] as const;
const HYPOTHESES = ['app-top', 'ladder-vs-contrast', 'doubles-vs-variables', 'dso-vs-stars', 'challenge-vs-none', 'theme-vs-theme', 'picked'] as const;

const Image = z.object({
  src: nonEmpty, large: z.string().nullable(), credit: nonEmpty, license: nonEmpty, caption: z.string().nullable(),
  fieldDeg: num.positive().nullable(), variant: z.string().nullable(), sourceUrl: z.string().nullable(),
}).strict();

const Stop = z.object({
  n: z.number().int().min(1),
  objectId: nonEmpty,
  name: nonEmpty,
  designation: z.string().nullable(),
  kind: z.enum(['star', 'dso']),
  plainClass: nonEmpty,
  con: z.string().regex(/^[A-Z][A-Za-z]{2}\d?$/),
  constellation: nonEmpty,
  mag: num.nullable(),
  role: nonEmpty,
  arc: z.enum(['hook', 'build', 'twist', 'payoff', 'coda']),
  startLocal: z.string().regex(/^\d{2}:\d{2}$/),
  altDeg: num.min(0).max(90),
  azDeg: num.min(0).max(360),
  ra: num.min(0).max(360),
  dec: num.min(-90).max(90),
  challenge: z.boolean(),
  getThere: z.object({ mode: z.enum(['same-field', 'sweep', 'naked-eye-hop']), distanceDeg: num.min(0), fields: num.min(0), text: nonEmpty }).strict(),
  whyHere: nonEmpty,
  transitionText: z.string().nullable(),
  // The owner's card: question, see, story (understand), answer; wonder and connect are optional (empty string).
  card: z.object({
    question: z.string().regex(/\?$/), glance: nonEmpty, see: nonEmpty, understand: nonEmpty, answer: nonEmpty, wonder: z.string(), connect: z.string(),
    tier: z.enum(['showpiece', 'supporting']),
  }).strict(),
  glossary: z.array(nonEmpty),
  image: Image,
  link: z.object({ type: nonEmpty, subtype: nonEmpty, strength: num.min(0.2).max(1), curated: z.boolean() }).strict().nullable(),
  // Round 2 on (ab-pairs-3): the stop's theme lens and the card exactly as the app resolves it.
  // Round 3 contract: the lens's own `rank` (order within a beat) and `story` (the theme's Story box), null when unset.
  lens: z.object({
    step: z.number().int(), rank: num.nullable().optional(), beat: nonEmpty, question: z.string().regex(/\?$/), why: nonEmpty, look: nonEmpty.nullable(),
    answer: nonEmpty, story: nonEmpty.nullable().optional(),
  }).strict().nullable().optional(),
  resolved: z.object({
    beat: nonEmpty, question: z.string().regex(/\?$/).nullable(), transition: z.string().nullable(), why: nonEmpty, look: nonEmpty,
    story: nonEmpty.nullable().optional(), understand: nonEmpty, answer: nonEmpty.nullable(), wonder: z.string(), payoff: nonEmpty.nullable(),
  }).strict().optional(),
}).strict();

const Journey = z.object({
  side: z.enum(['left', 'right']),
  key: nonEmpty,
  title: nonEmpty,
  drivingQuestion: nonEmpty,
  hook: nonEmpty,
  story: nonEmpty,
  payoff: nonEmpty.nullable(),
  templateId: z.string().regex(/^A\d+-/),
  templateName: nonEmpty,
  switch: z.object({ atStop: z.number().int().min(1), toTemplateId: nonEmpty, toTemplateName: nonEmpty }).strict().nullable(),
  durationMin: z.number().int().positive(),
  difficulty: z.enum(['easy', 'moderate', 'stretch']),
  difficultyReason: z.string().nullable(),
  totalPathDeg: num.min(0),
  regionLabel: nonEmpty,
  stops: z.array(Stop).min(3).max(10),
}).strict();

const HiddenSide = z.object({
  side: z.enum(['left', 'right']),
  key: nonEmpty,
  role: nonEmpty,
  templateId: nonEmpty,
  score: num,
  scorePct: num.min(0).max(1),
  poolRank: z.number().int().min(0),
  goodRank: z.number().int().min(0),
  appRank: z.number().int().min(0).max(2).nullable(),
  source: z.enum(['pool', 'app', 'theme']),
  flags: z.array(z.string()),
  relaxed: z.array(z.string()),
}).strict();

const point = z.tuple([num.min(-90).max(90), num.min(0).max(360)]);

const Pair = z.object({
  id: z.string().regex(/^ab[\w-]*-\d{2}$/),
  n: z.number().int().min(1),
  context: z.object({
    site: nonEmpty, lat: num, lon: num, timezone: nonEmpty, hemisphere: z.enum(['north', 'south']),
    season: z.enum(['winter', 'spring', 'summer', 'autumn']),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), localTime: localDateTime, instantUtc: z.string().datetime(),
    timeKind: z.enum(['dusk+1.5h', '23:30']), timeNote: z.string().optional(),
    binoculars: z.object({ name: z.enum(['7x50', '10x50']), fovDeg: num, magnification: num, aperture: num }).strict(),
    skyBrightness: num, minAlt: num, length: z.number().int(),
  }).strict(),
  conditions: z.object({
    darkness: z.enum(['day', 'civil', 'nautical', 'astronomical', 'night']),
    sunAltDeg: num,
    darkWindowLocal: z.object({ start: localDateTime.nullable(), end: localDateTime.nullable() }).strict(),
    moon: z.object({
      phaseRequested: z.enum(PHASES), phase: nonEmpty,
      illumination: num.min(0).max(1), up: z.boolean(), altDeg: num, azDeg: num, minSepDeg: num,
      riseLocal: localDateTime.nullable(), setLocal: localDateTime.nullable(),
    }).strict(),
    message: z.string(),
  }).strict(),
  sky: z.object({
    magLimit: z.literal(5),
    moon: z.object({ altDeg: num.min(-90).max(90), azDeg: num.min(0).max(360), illumination: num.min(0).max(1), up: z.boolean(), phase: nonEmpty }).strict(),
    stars: z.array(z.object({
      hr: z.number().int().positive(), name: z.string().nullable(), con: z.string().nullable(), mag: num.max(5),
      ra: num.min(0).max(360), dec: num.min(-90).max(90), altDeg: num.min(0).max(90), azDeg: num.min(0).max(360),
    }).strict()).min(300),
    lines: z.array(z.object({ con: z.string().regex(/^[A-Z][A-Za-z]{2}\d?$/), name: nonEmpty, polylines: z.array(z.array(point).min(2)).min(1) }).strict()).min(20),
  }).strict(),
  journeys: z.tuple([Journey, Journey]),
  hidden: z.object({
    hypothesis: z.enum(HYPOTHESES), question: nonEmpty,
    themePair: z.string().regex(/^A\d+\|A\d+$/), contrasts: z.array(nonEmpty),
    sides: z.tuple([HiddenSide, HiddenSide]),
    poolSize: z.number().int().min(0), minScorePct: num.min(0).max(1), appTop3: z.array(z.string()).max(3), notes: z.array(z.string()),
  }).strict(),
}).strict();

const Rules = z.object({ pairs: z.number().int().min(1), minThemes: z.number().int().min(1), maxA6Pairs: z.number().int().min(0), maxPerTheme: z.number().int().min(1) }).strict();
/** Round 1's rules (ab-pairs-2 files carry none). */
const ROUND1_RULES = { pairs: 12, minThemes: 9, maxA6Pairs: 3, maxPerTheme: 4 };

const AbFile = z.object({
  version: z.enum(['ab-pairs-2', 'ab-pairs-3']),
  round: nonEmpty.optional(),
  rules: Rules.optional(),
  generatedBy: nonEmpty,
  kbVersion: nonEmpty,
  engineScorer: nonEmpty,
  instructions: nonEmpty,
  answerOptions: z.tuple([z.literal('left'), z.literal('right'), z.literal('equal'), z.literal('neither')]),
  glossary: z.array(z.object({ id: nonEmpty, term: nonEmpty, aliases: z.array(z.string()), short: nonEmpty }).passthrough()).min(1),
  pairs: z.array(Pair).min(1),
}).strict();

type File = z.infer<typeof AbFile>;
type J = File['pairs'][number]['journeys'][number];
const ids = (j: J) => j.stops.map((s) => s.objectId);
const shared = (a: J, b: J) => ids(a).filter((x) => ids(b).includes(x)).length;

for (const FILE of FILES) {
const present = existsSync(FILE);
describe.skipIf(!present)(`A/B pairs (${FILE.pathname.split('/').pop()})`, () => {
  const raw = present ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
  const parsed = present ? AbFile.safeParse(raw) : null;
  const file = (parsed?.success ? parsed.data : null) as File;
  const rules = file?.rules ?? ROUND1_RULES;
  const full = (file?.pairs.length ?? 0) >= 12;

  it('matches the schema', () => {
    expect(parsed?.success, parsed && !parsed.success ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true);
    expect(file.pairs.length).toBe(rules.pairs);
  });

  it('numbers the pairs and keeps a matching hidden key per side', () => {
    const prefix = file.pairs[0].id.replace(/-\d{2}$/, '');
    expect(file.pairs.map((p) => p.id)).toEqual(file.pairs.map((_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`));
    for (const p of file.pairs) {
      expect(p.journeys.map((j) => j.side)).toEqual(['left', 'right']);
      expect(p.hidden.sides.map((h) => `${h.side}:${h.key}:${h.templateId}`)).toEqual(p.journeys.map((j) => `${j.side}:${j.key}:${j.templateId}`));
    }
  });

  // Only a full 12-pair round promises the full coverage; smaller rounds (round 2) don't register this check.
  if (full) it('covers 5 sites (2 southern), every Moon phase, both binoculars and both start times', () => {
    const ctx = file.pairs.map((p) => p.context);
    expect(new Set(ctx.map((c) => c.site)).size).toBe(5);
    expect(new Set(ctx.filter((c) => c.hemisphere === 'south').map((c) => c.site)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(file.pairs.map((p) => p.conditions.moon.phaseRequested))).toEqual(new Set(PHASES));
    expect(new Set(ctx.map((c) => c.binoculars.name))).toEqual(new Set(['7x50', '10x50']));
    expect(new Set(ctx.map((c) => c.timeKind))).toEqual(new Set(['dusk+1.5h', '23:30']));
    expect(file.pairs.some((p) => p.conditions.moon.up && p.conditions.moon.illumination > 0.9)).toBe(true);
    expect(file.pairs.some((p) => p.conditions.moon.illumination < 0.05)).toBe(true);
  });

  it('makes different comparisons: no theme pair twice, few contrast tours, many archetypes (the round\'s rules)', () => {
    const arch = (id: string) => id.split('-')[0];
    const pairs = file.pairs.map((p) => p.journeys.map((j) => arch(j.templateId)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join('|'));
    expect(new Set(pairs).size, pairs.join(', ')).toBe(file.pairs.length);
    expect(file.pairs.map((p) => p.hidden.themePair)).toEqual(pairs);
    for (const p of file.pairs) expect(arch(p.journeys[0].templateId), p.id).not.toBe(arch(p.journeys[1].templateId));
    const a6 = file.pairs.filter((p) => p.journeys.some((j) => arch(j.templateId) === 'A6' || j.switch?.toTemplateId.startsWith('A6-')));
    expect(a6.length).toBeLessThanOrEqual(rules.maxA6Pairs);
    expect(new Set(file.pairs.flatMap((p) => p.journeys.map((j) => arch(j.templateId)))).size).toBeGreaterThanOrEqual(rules.minThemes);
    // From round 2 on (owner feedback r2) only active themes: A4 and A10 are retired as journeys.
    if (file.version !== 'ab-pairs-2') {
      for (const p of file.pairs) for (const j of p.journeys) for (const t of [j.templateId, j.switch?.toTemplateId]) expect(t ?? '', p.id).not.toMatch(/^A(4|10)-/);
    }
  });

  it('draws both sides from the top of their night\'s pool, and still asks about the app\'s own order', () => {
    for (const p of file.pairs) {
      for (const s of p.hidden.sides) {
        // A side is one of the app's own suggestions, or a good strict-tier journey scoring at least the round's floor,
        // or (a hand-picked round, --themes) the app's first journey with the theme picker set to that side's theme.
        if (s.source === 'theme') {
          expect(p.hidden.hypothesis, p.id).toBe('picked');
          expect(s.appRank, `${p.id} ${s.side}`).toBe(0);
        } else if (s.appRank === null) {
          expect(s.source, `${p.id} ${s.side}`).toBe('pool');
          expect(s.scorePct, `${p.id} ${s.side}`).toBeGreaterThanOrEqual(p.hidden.minScorePct);
          expect(s.relaxed, `${p.id} ${s.side}`).toEqual([]);
        } else expect(s.source, `${p.id} ${s.side}`).toBe('app');
        expect(s.flags.filter((f) => /^(faint-payoff|member-adjacent|challenge-payoff|generic-transition)/.test(f)), `${p.id} ${s.side}`).toEqual([]);
        expect(s.poolRank, `${p.id} ${s.side}`).toBeLessThan(p.hidden.poolSize);
      }
    }
    const app = file.pairs.filter((x) => x.hidden.hypothesis === 'app-top');
    for (const p of file.pairs.filter((x) => x.hidden.hypothesis === 'picked')) for (const s of p.hidden.sides) expect(s.source, p.id).toBe('theme');
    if (!file.rules) expect(app.length).toBeGreaterThanOrEqual(3);
    for (const p of app) for (const s of p.hidden.sides) expect(s.appRank, p.id).not.toBeNull();
  });

  it('each pair really tests its hypothesis with two different journeys', () => {
    for (const p of file.pairs) {
      const [a, b] = p.journeys;
      expect(shared(a, b), p.id).toBeLessThan(2);
      expect(a.title.trim(), p.id).not.toBe(b.title.trim());
      if (a.templateId === b.templateId) expect(a.regionLabel, p.id).not.toBe(b.regionLabel);
      const tpls = new Set([a.templateId, b.templateId]);
      const dso = (j: J) => j.stops.filter((s) => s.kind === 'dso').length / j.stops.length;
      expect(tpls.size, p.id).toBe(2);
      switch (p.hidden.hypothesis) {
        case 'app-top': break;
        case 'theme-vs-theme': break;
        case 'picked': expect(a.switch ?? b.switch, p.id).toBeNull(); break;
        case 'ladder-vs-contrast':
          expect(tpls.has('A6-contrasts'), p.id).toBe(true);
          expect(tpls.has('A3-how-far') || tpls.has('A4-time-machine'), p.id).toBe(true);
          break;
        case 'doubles-vs-variables': expect(tpls, p.id).toEqual(new Set(['A9-seeing-double', 'A10-stars-that-change'])); break;
        case 'challenge-vs-none': expect(p.journeys.filter((j) => j.stops.some((s) => s.challenge)).length, p.id).toBe(1); break;
        case 'dso-vs-stars': expect(Math.max(dso(a), dso(b)), p.id).toBeGreaterThanOrEqual(0.6); expect(Math.min(dso(a), dso(b)), p.id).toBeLessThanOrEqual(0.2); break;
      }
    }
  });

  it('does not reveal the engine\'s preference by side', () => {
    const higherLeft = file.pairs.filter((p) => p.hidden.sides[0].score > p.hidden.sides[1].score).length;
    expect(higherLeft).toBeGreaterThanOrEqual(Math.floor(file.pairs.length / 4));
    expect(higherLeft).toBeLessThanOrEqual(Math.ceil((3 * file.pairs.length) / 4));
  });

  it('gives every stop a picture on disk, its card question and answer, and glossary terms the file defines', () => {
    const defined = new Set(file.glossary.map((g) => g.id));
    const used = new Set<string>();
    for (const p of file.pairs) {
      for (const j of p.journeys) {
        expect(j.stops.map((s) => s.n), j.key).toEqual(j.stops.map((_, i) => i + 1));
        expect(j.stops[0].link, j.key).toBeNull();
        for (const s of j.stops.slice(1)) expect(s.link, `${j.key} ${s.objectId}`).not.toBeNull();
        expect(j.stops.filter((s) => s.challenge).length, j.key).toBeLessThanOrEqual(1);
        for (const s of j.stops) {
          // From round 2 on (owner feedback r2: an object without a lens is not used in that theme) every stop has one.
          if (file.round && file.round !== 'round1') expect(s.lens, `${p.id} ${s.objectId}`).not.toBeNull();
          expect(existsSync(new URL(s.image.src, PUBLIC)), s.image.src).toBe(true);
          if (s.image.large) expect(existsSync(new URL(s.image.large, PUBLIC)), s.image.large).toBe(true);
          for (const g of s.glossary) { expect(defined.has(g), `${s.objectId}: ${g}`).toBe(true); used.add(g); }
        }
      }
    }
    expect(used).toEqual(defined);
  });

  it('keeps the owner\'s voice rules: no meta-talk, no raw spectral classes, no unfilled placeholders, no sentence twice in a stop', () => {
    for (const p of file.pairs) {
      for (const j of p.journeys) {
        const texts: [string, string][] = [['title', j.title], ['question', j.drivingQuestion], ['hook', j.hook], ['story', j.story], ['payoff', j.payoff ?? '']];
        for (const s of j.stops) {
          texts.push([`${s.objectId}.why`, s.whyHere], [`${s.objectId}.get`, s.getThere.text], [`${s.objectId}.transition`, s.transitionText ?? ''], [`${s.objectId}.plainClass`, s.plainClass]);
          for (const [k, v] of Object.entries(s.card)) texts.push([`${s.objectId}.card.${k}`, v]);
          for (const [k, v] of Object.entries(s.resolved ?? {})) texts.push([`${s.objectId}.resolved.${k}`, v ?? '']);
          if (s.resolved && s.lens) {
            // The shown card is the lens's: its beat chip, question and answer, its why (the narrated why-here).
            expect(s.resolved.beat, s.objectId).toBe(s.lens.beat);
            expect(s.resolved.question, s.objectId).toBe(s.lens.question);
            expect(s.resolved.answer, s.objectId).toBe(s.lens.answer);
            expect(s.resolved.look, s.objectId).toBe(s.lens.look ?? s.card.see);
            // The Story box is the lens's story where one is written (the shared card.understand then moves under More).
            if ('story' in s.lens) expect(s.resolved.story ?? null, s.objectId).toBe(s.lens.story ?? null);
          }
        }
        // No sentence twice inside one stop as the owner reads it (owner brief r2: no sentence may repeat across boxes).
        for (const s of j.stops) {
          const seen = new Set<string>();
          const shown = s.resolved
            ? [s.resolved.transition ?? '', s.resolved.why, s.resolved.question ?? '', s.resolved.look, s.resolved.story ?? '', s.resolved.understand, s.resolved.answer ?? '', s.resolved.wonder, s.resolved.payoff ?? '']
            : [s.transitionText ?? '', s.whyHere, ...Object.values(s.card)];
          for (const t of shown) {
            for (const x of t.split(/(?<=[.!?][”’"')]?)\s+/).map((y) => y.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim()).filter((y) => y.split(/\s+/).length >= 6)) {
              expect(seen.has(x), `${p.id} ${s.objectId} repeats "${x}"`).toBe(false);
              seen.add(x);
            }
          }
        }
        for (const [k, t] of texts) {
          expect(t, `${p.id} ${k}`).not.toMatch(BANNED);
          expect(t, `${p.id} ${k}`).not.toMatch(RAW_CLASS);
          expect(t, `${p.id} ${k}`).not.toMatch(/\{\w*\}|\bundefined\b|\bNaN\b/);
        }
      }
    }
  });

  it('carries a sky block: stars above the horizon to V 5, stick figures with a vertex up, the Moon', () => {
    for (const p of file.pairs) {
      const named = p.sky.stars.filter((s) => s.name).length;
      expect(named / p.sky.stars.length, p.id).toBeGreaterThan(0.5);
      for (const l of p.sky.lines) expect(l.polylines.some((pl) => pl.some(([alt]) => alt > 0)), `${p.id} ${l.con}`).toBe(true);
      expect(p.sky.moon.up, p.id).toBe(p.sky.moon.altDeg > 0);
      if (p.conditions.moon.up) expect(Math.abs(p.sky.moon.altDeg - p.conditions.moon.altDeg), p.id).toBeLessThan(2);
    }
  });
});
}
