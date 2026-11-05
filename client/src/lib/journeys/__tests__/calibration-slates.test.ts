/**
 * Schema + sanity test for the product owner's calibration slates (script/journeys/train/calibration-slates.json,
 * written by script/journeys/train/export-calibration-slates.ts). Checks the JSON shape, the diversity the slates
 * promise (sites, hemispheres, seasons, Moon phases, binoculars, archetypes), that the shown order hides the
 * engine's ranking. The file is frozen against the KB it was made with, so its journey keys are not rebuilt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const FILE = new URL('../../../../../script/journeys/train/calibration-slates.json', import.meta.url);
const PUBLIC = new URL('../../../../public/', import.meta.url);
const present = existsSync(FILE);

const num = z.number().finite();
const altAz = z.object({ altDeg: num.min(-90).max(90), azDeg: num.min(0).max(360) });
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const nonEmpty = z.string().min(1);

const Stop = z.object({
  n: z.number().int().min(1),
  objectId: nonEmpty,
  name: nonEmpty,
  designation: z.string().nullable(),
  kind: z.enum(['star', 'dso']),
  class: nonEmpty,
  mag: num.nullable(),
  role: nonEmpty,
  arc: z.enum(['hook', 'build', 'twist', 'payoff', 'coda']),
  startLocal: z.string().regex(/^\d{2}:\d{2}$/),
  altDeg: num.min(0).max(90),
  azDeg: num.min(0).max(360),
  ra: num.min(0).max(360),
  dec: num.min(-90).max(90),
  challenge: z.boolean(),
  getThere: z.object({ mode: z.enum(['same-field', 'sweep', 'naked-eye-hop']), distanceDeg: num.min(0), fields: num.min(0), text: nonEmpty }),
  whyHere: nonEmpty,
  transitionText: z.string().nullable(),
  card: z.object({ glance: nonEmpty, see: nonEmpty, understand: nonEmpty }),
  image: z.object({ path: nonEmpty, variant: z.string().nullable(), credit: nonEmpty }).nullable(),
  link: z.object({ type: nonEmpty, subtype: nonEmpty, strength: num.min(0.2).max(1), curated: z.boolean() }).nullable(),
}).strict();

const Journey = z.object({
  label: z.enum(['A', 'B', 'C', 'D']),
  key: nonEmpty,
  title: nonEmpty,
  drivingQuestion: nonEmpty,
  hook: nonEmpty,
  story: nonEmpty,
  templateId: z.string().regex(/^A\d+-/),
  switch: z.object({ atStop: z.number().int().min(1), toTemplateId: nonEmpty }).nullable(),
  durationMin: z.number().int().positive(),
  difficulty: z.enum(['easy', 'moderate', 'stretch']),
  totalPathDeg: num.min(0),
  regionRadius: num.min(20).max(40),
  regionLabel: nonEmpty,
  stops: z.array(Stop).min(3).max(10),
}).strict();

const Hidden = z.object({
  label: z.enum(['A', 'B', 'C', 'D']),
  key: nonEmpty,
  pick: z.enum(['top', 'flawed', 'mid', 'low', 'sampled', 'shuffle', 'theme']),
  poolRank: z.number().int().min(0).nullable(),
  score: num,
  flags: z.array(z.string()),
  relaxed: z.array(z.string()),
  appRank: z.number().int().min(0).max(2).nullable(),
}).strict();

const Slate = z.object({
  id: z.string().regex(/^cal-\d{2}$/),
  n: z.number().int().min(1),
  context: z.object({
    site: nonEmpty, lat: num, lon: num, timezone: nonEmpty, hemisphere: z.enum(['north', 'south']),
    season: z.enum(['winter', 'spring', 'summer', 'autumn']),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), localTime: localDateTime, instantUtc: z.string().datetime(),
    timeKind: z.enum(['dusk+1.5h', '23:30', '02:00']), timeNote: z.string().optional(),
    binoculars: z.object({ name: z.enum(['7x50', '10x50']), fovDeg: num, magnification: num, aperture: num }),
    skyBrightness: num, minAlt: num, length: z.number().int(),
  }).strict(),
  conditions: z.object({
    darkness: z.enum(['day', 'civil', 'nautical', 'astronomical', 'night']),
    sunAltDeg: num,
    darkWindowLocal: z.object({ start: localDateTime.nullable(), end: localDateTime.nullable() }),
    moon: z.object({
      phaseRequested: z.enum(['new', 'first-quarter', 'full', 'last-quarter']), phase: nonEmpty,
      illumination: num.min(0).max(1), up: z.boolean(), altDeg: num, azDeg: num, minSepDeg: num,
      riseLocal: localDateTime.nullable(), setLocal: localDateTime.nullable(),
    }).strict(),
    message: z.string(),
  }).strict(),
  sky: z.object({
    moon: altAz.nullable(),
    brightStars: z.array(altAz.extend({ name: nonEmpty, hr: z.number().int(), mag: num.max(2.5) })).min(10),
  }).strict(),
  journeys: z.array(Journey).length(4),
  hidden: z.object({ poolSize: z.number().int().min(0), order: z.array(Hidden).length(4), appTop3: z.array(z.string()), notes: z.array(z.string()) }).strict(),
}).strict();

const CalibrationFile = z.object({
  version: z.literal('calibration-slates-1'),
  generatedBy: nonEmpty,
  kbVersion: nonEmpty,
  engineScorer: nonEmpty,
  instructions: nonEmpty,
  slates: z.array(Slate).length(20),
}).strict();

describe.skipIf(!present)('calibration slates (script/journeys/train/calibration-slates.json)', () => {
  const raw = present ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
  const file = present ? CalibrationFile.parse(raw) : null!;

  it('matches the schema', () => {
    expect(CalibrationFile.safeParse(raw).success).toBe(true);
  });

  it('each slate holds 4 distinct journeys, labelled A–D, with a matching hidden answer key', () => {
    for (const s of file.slates) {
      expect(s.journeys.map((j) => j.label)).toEqual(['A', 'B', 'C', 'D']);
      expect(new Set(s.journeys.map((j) => j.key)).size).toBe(4);
      expect(new Set(s.journeys.map((j) => `${j.templateId}|${j.stops.map((x) => x.objectId).join('>')}`)).size).toBe(4);
      expect(s.hidden.order.map((h) => `${h.label}:${h.key}`)).toEqual(s.journeys.map((j) => `${j.label}:${j.key}`));
      const top = s.hidden.order.filter((h) => h.pick === 'top');
      expect(top).toHaveLength(1);
      expect(top[0].poolRank).toBe(0);
      for (const j of s.journeys) {
        expect(j.stops.map((x) => x.n)).toEqual(j.stops.map((_, i) => i + 1));
        expect(j.stops[0].link).toBeNull();
        for (const st of j.stops.slice(1)) expect(st.link).not.toBeNull();
        expect(new Set(j.stops.map((x) => x.objectId)).size).toBe(j.stops.length);
        for (const st of j.stops) if (st.image) expect(existsSync(new URL(st.image.path, PUBLIC)), st.image.path).toBe(true);
      }
    }
  });

  it('shown order does not reveal the engine ranking', () => {
    const topFirst = file.slates.filter((s) => s.hidden.order[0].pick === 'top').length;
    expect(topFirst).toBeLessThan(10);
    const sortedByRank = file.slates.filter((s) => {
      const r = s.hidden.order.map((h) => h.poolRank ?? Infinity);
      return r.every((x, i) => i === 0 || r[i - 1] <= x);
    }).length;
    expect(sortedByRank).toBeLessThan(5);
  });

  it('covers 5 sites (2 southern), 4 seasons, new/quarter/full Moon, both binoculars and most archetypes', () => {
    const ctx = file.slates.map((s) => s.context);
    expect(new Set(ctx.map((c) => c.site)).size).toBe(5);
    expect(new Set(ctx.filter((c) => c.hemisphere === 'south').map((c) => c.site)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(ctx.map((c) => c.season)).size).toBe(4);
    expect(new Set(ctx.map((c) => c.binoculars.name))).toEqual(new Set(['7x50', '10x50']));
    const phases = new Set(file.slates.map((s) => s.conditions.moon.phaseRequested));
    for (const p of ['new', 'full'] as const) expect(phases.has(p)).toBe(true);
    expect(phases.has('first-quarter') || phases.has('last-quarter')).toBe(true);
    expect(file.slates.some((s) => s.conditions.moon.up && s.conditions.moon.illumination > 0.9)).toBe(true);
    expect(file.slates.some((s) => !s.conditions.moon.up || s.conditions.moon.illumination < 0.05)).toBe(true);
    const templates = new Set(file.slates.flatMap((s) => s.journeys.map((j) => j.templateId)));
    expect(templates.size).toBeGreaterThanOrEqual(10);
    // A plausible-but-flawed journey in most slates.
    expect(file.slates.filter((s) => s.hidden.order.some((h) => h.pick === 'flawed')).length).toBeGreaterThanOrEqual(15);
  });
});
