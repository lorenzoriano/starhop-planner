/**
 * Theme lenses (owner feedback round 2, docs/sky-journeys/owner-feedback-r2.md; contract in types.ts ThemeLens /
 * ThemeLensSet). Fixture lens sets (__fixtures__/fixture-lenses.ts) over the winter fixture KB:
 *   - gating: an archetype with a lens set uses only objects with a lens there; without one it keeps its slots;
 *   - order: stops run in non-decreasing beat step, at most maxStops per beat, at least minBeats beats;
 *   - arcs are positional (first stop hook, last payoff) and roles are the beat labels; each stop carries its lens;
 *   - a lens theme never switches (round 3), even with a switch rule;
 *   - whole stories (round 3): opening beat, skipped beats, same-beat rank, a challenge closing on the final beat;
 *   - narration: theme overrides, transition table (pair, then arrive), why-here = lens why, curated pair line only
 *     when it adds something, built-in fallback;
 *   - the resolved card, the lens schemas, the build's lens checks, retired templates, the A/B exporter's options.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORT_JOURNEY_STOPS, generate, generatePool, rebuildJourney, selectWithShuffle } from '../assemble';
import { decodeJourneyKey, encodeJourneyKey } from '../journey-key';
import {
  CHALLENGE_PAYOFF_MAX_GLOW, FINALE_HOP_STRETCH, LENS_CURATED_MIN_STRENGTH, LENS_LINK_STRENGTH, LENS_LINK_SUBTYPE, backtrackLinkOk, buildCandidateTable, claimsSplit, compileTemplate, grammarComplete,
  hopLimitInto, lensFinaleSlot, lensPayoffOk, lensRankOk, lensStepOk, lensVisibleOk, prepareKb, slotAccepts, slotSequenceValid, splitsAt, switchArcOk,
} from '../candidates';
import { normalizeRequest } from '../conditions';
import { KEY_BEAT_FACTOR, LENS_OPEN_PENALTY, LENS_REPEAT_PENALTY, LENS_SKIP_PENALTY, LENS_SKIP_SOFT_PENALTY, lensCoverageTerm } from '../search';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { FIXTURE_LENS_A1, FIXTURE_LENS_A2, FIXTURE_LENS_NARRATION, lensFixtureKb } from '../__fixtures__/fixture-lenses';
import { JourneyResultSchema, JourneySchema, ThemeLensFileSchema, ThemeLensSchema, ThemeLensSetSchema, knowledgeBaseFromFiles, lensIssues } from '../kb-schema';
import { beatKeys, lastLensStep, narrateJourney } from '../narrate';
import { resolveStopCard } from '../stop-card';
import type { Journey, KbObject, KnowledgeBase, StarObject, ThemeLensSet } from '../types';
import { CATALOG_CODE, questionProblems, sentenceCount, splitSentences } from '../voice';
import { independentProblems, request } from './engine-helpers';
import { activeTemplates } from '../../../../../script/journeys/build_kb';
import { LONG_SENTENCE_IS_ERROR, loadLenses } from '../../../../../script/journeys/kb/lenses';
import { DEFAULT_OUT, parseArgs, parseThemes, roundPrefix, roundRules, specsFor } from '../../../../../script/journeys/train/ab-round';

const NIGHT = '2027-01-15T04:30:00Z';
const REQ = request(NIGHT, { length: 5 });
const pool = (kb: KnowledgeBase, req = REQ) => generatePool(kb, req).journeys;
const steps = (j: Journey) => j.stops.map((s) => s.lens?.step);

function lensRules(j: Journey, set: ThemeLensSet, from = 0, to = j.stops.length - 1, minBeats = set.minBeats): string[] {
  const out: string[] = [];
  const st: number[] = [];
  for (let i = from; i <= to; i++) {
    const s = j.stops[i];
    const lens = set.objects[s.objectId];
    if (!lens) { out.push(`${s.objectId} has no ${set.archetype} lens`); continue; }
    if (st.length && lens.step < st[st.length - 1]) out.push(`step back at ${i}`);
    st.push(lens.step);
  }
  for (const b of set.beats) if (st.filter((x) => x === b.step).length > (b.maxStops ?? 1)) out.push(`beat ${b.step} over maxStops`);
  if (new Set(st).size < minBeats) out.push(`${new Set(st).size} beats < ${minBeats}`);
  return out;
}

describe('theme lenses: compiled grammar', () => {
  const ct = compileTemplate(FIXTURE_KB.templates[0], FIXTURE_LENS_A1);

  it('one optional slot per beat in step order; length from minBeats to the sum of maxStops', () => {
    expect(ct.lens).toBeDefined();
    expect(ct.t.slots.map((s) => s.label)).toEqual(FIXTURE_LENS_A1.beats.map((b) => b.label));
    expect(ct.t.slots.every((s) => s.optional)).toBe(true);
    expect(ct.repeatMax).toEqual([1, 2, 1, 1, 1]);
    expect(ct.t.length).toEqual([3, 6]);
    // No lens set: the template is compiled as before.
    expect(compileTemplate(FIXTURE_KB.templates[0]).lens).toBeUndefined();
    expect(compileTemplate(FIXTURE_KB.templates[0]).t.slots).toBe(FIXTURE_KB.templates[0].slots);
  });

  it('non-decreasing steps, maxStops per beat, at least minBeats distinct beats', () => {
    expect(slotSequenceValid(ct, [0, 1, 1, 3])).toBe(true);
    expect(slotSequenceValid(ct, [0, 1, 2, 3, 4])).toBe(true);
    expect(slotSequenceValid(ct, [1, 2, 4])).toBe(true); // a journey may start on a later beat
    expect(slotSequenceValid(ct, [0, 1, 1])).toBe(false); // 2 beats < minBeats 3
    expect(slotSequenceValid(ct, [0, 2, 1, 3])).toBe(false); // steps back
    expect(slotSequenceValid(ct, [0, 1, 1, 1, 3])).toBe(false); // beat 2 maxStops 2
    expect(slotSequenceValid(ct, [0, 1, 0, 3])).toBe(false); // a beat cannot restart
    expect(grammarComplete(ct, 1, 1, 0b11)).toBe(false);
    expect(grammarComplete(ct, 1, 1, 0b11, 2)).toBe(true); // an explicit minBeats overrides the lens's
  });

  it('endSteps: the theme ends only on one of its end beats (cradle to grave ends on its last stage)', () => {
    const end = compileTemplate(FIXTURE_KB.templates[0], { ...FIXTURE_LENS_A1, endSteps: [5] });
    expect(slotSequenceValid(end, [0, 1, 2, 3])).toBe(false); // nursery to giant, no ending
    expect(slotSequenceValid(end, [1, 2, 3, 4])).toBe(true);
    expect(slotSequenceValid(ct, [0, 1, 2, 3])).toBe(true); // without endSteps any beat may close
    const kb = lensFixtureKb({ lenses: [{ ...FIXTURE_LENS_A1, endSteps: [5] }, FIXTURE_LENS_A2] });
    for (const j of pool(kb).filter((x) => x.templateId === 'A1-cradle-to-grave')) expect(j.stops[j.stops.length - 1].lens?.step).toBe(5);
    expect(lensIssues([{ ...FIXTURE_LENS_A1, endSteps: [9] }], FIXTURE_KB).join('\n')).toMatch(/endSteps names 9/);
  });

  it('a lens theme never switches out, at any beat (round 3: a journey is one story)', () => {
    const sw = { ...FIXTURE_KB.templates[0], switchRule: { to: ['A2-thermometer'], atArc: 'payoff' as const, via: ['CONTRAST' as const], minStrength: 0.5, announceKey: 'switch.x' } };
    const c = compileTemplate(sw, FIXTURE_LENS_A1);
    for (let j = 0; j < c.t.slots.length; j++) expect(switchArcOk(c, j)).toBe(false);
    // The same rule without a lens still switches at its payoff slot.
    const plain = compileTemplate(sw);
    expect(plain.t.slots.some((sl, j) => sl.arc === 'payoff' && switchArcOk(plain, j))).toBe(true);
  });

  it('only objects with a lens fill a beat, and only their own beat', () => {
    const kb = lensFixtureKb();
    const prep = prepareKb(kb);
    const a1 = prep.templates.find((x) => x.t.id === 'A1-cradle-to-grave')!;
    const fill = (j: number) => prep.objects.filter((o, i) => slotAccepts(a1, j, o, prep.concepts[i])).map((o) => o.id).sort();
    expect(fill(0)).toEqual(['M42', 'M43']);
    expect(fill(1)).toEqual(['AST-OrionBelt', 'Cr69', 'NGC1981']);
    expect(fill(4)).toEqual(['M1']);
    // HR1895 (no A1 lens) fills no beat; in A2 only stars bright enough to show their color qualify.
    expect([0, 1, 2, 3, 4].some((j) => fill(j).includes('HR1895'))).toBe(false);
  });

  it('a lens distance ladder climbs by at least 1.25×; a Milky Way scene is not a rung', () => {
    const ladder = compileTemplate({ ...FIXTURE_KB.templates[1], id: 'T-far', archetype: 'A3', progression: { property: 'distanceLy', direction: 'up' } }, { ...FIXTURE_LENS_A2, archetype: 'A3' });
    const by = new Map(FIXTURE_KB.objects.map((o) => [o.id, o] as const));
    expect(lensStepOk(ladder, by.get('STAR-Aldebaran')!, by.get('M45')!)).toBe(true); // 67 → 440 ly
    expect(lensStepOk(ladder, by.get('M45')!, by.get('STAR-Aldebaran')!)).toBe(false);
    expect(lensStepOk(ladder, by.get('M42')!, by.get('NGC1981')!)).toBe(false); // 1350 → 1285 ly
    expect(lensStepOk(compileTemplate(FIXTURE_KB.templates[1], FIXTURE_LENS_A2), by.get('M45')!, by.get('STAR-Aldebaran')!)).toBe(true); // not a ladder
  });
});

describe('theme lenses: what the binoculars can really show', () => {
  const capella = FIXTURE_KB.objects.find((o) => o.id === 'STAR-Capella') as StarObject;
  const withPair = (sep: number, magSecondary = 7, magPrimary = 5): KbObject => ({
    ...capella,
    multiplicity: { components: [], pairs: [{ pair: 'AB', sepArcsec: sep, paDeg: 0, epoch: 2000, magPrimary, magSecondary, physical: 'bound', sourceId: 'simbad' }] },
  });

  it('a lens look promises a split only when it says so and does not deny it', () => {
    expect(claimsSplit('Binoculars split it into a yellow and a blue star.')).toBe(true);
    expect(claimsSplit('Steady binoculars just split the pair.')).toBe(true);
    expect(claimsSplit('Binoculars do not split it; it looks single.')).toBe(false);
    expect(claimsSplit('The pair is too close to split in binoculars.')).toBe(false);
    expect(claimsSplit('It won’t split without a telescope.')).toBe(false);
    expect(claimsSplit('A warm yellow point.')).toBe(false);
    expect(claimsSplit(undefined)).toBe(false);
  });

  it('a split needs ~300/magnification arcseconds, twice that for a much fainter companion', () => {
    expect(splitsAt(withPair(35), 10)).toBe(true); // 30″ limit at 10×
    expect(splitsAt(withPair(35), 7)).toBe(false); // 43″ at 7×
    expect(splitsAt(withPair(50, 9.9), 10)).toBe(false); // companion too faint
    expect(splitsAt(withPair(45, 9, 0.1), 10)).toBe(false); // Δm 8.9 needs 60″
    expect(splitsAt(withPair(65, 9, 0.1), 10)).toBe(true);
  });

  it('a stop whose lens look promises a split is used only with binoculars that split it', () => {
    const lens = { ...FIXTURE_LENS_A2, objects: { ...FIXTURE_LENS_A2.objects, 'STAR-Capella': { ...FIXTURE_LENS_A2.objects['STAR-Capella'], look: 'Binoculars split its faint companion off to the side.' } } };
    const ct = compileTemplate(FIXTURE_KB.templates[1], lens);
    expect(lensVisibleOk(ct, withPair(35), 10)).toBe(true);
    expect(lensVisibleOk(ct, withPair(35), 7)).toBe(false);
    expect(lensVisibleOk(ct, capella, 7)).toBe(true); // no pair data: nothing to check
    expect(lensVisibleOk(compileTemplate(FIXTURE_KB.templates[1], FIXTURE_LENS_A2), withPair(35), 7)).toBe(true); // no split promised
    // In the engine: Aldebaran (A1's aging giant) given a 35″ pair and a look that promises the split is used at 10×
    // but never at 7×.
    const ald = FIXTURE_KB.objects.find((o) => o.id === 'STAR-Aldebaran') as StarObject;
    const lensA1 = { ...FIXTURE_LENS_A1, objects: { ...FIXTURE_LENS_A1.objects, 'STAR-Aldebaran': { ...FIXTURE_LENS_A1.objects['STAR-Aldebaran'], look: 'Binoculars split a faint companion off to the side.' } } };
    const kb = lensFixtureKb({ lenses: [lensA1], version: 'fixture-split' });
    kb.objects = kb.objects.map((o) => (o.id === ald.id ? { ...ald, multiplicity: (withPair(35) as StarObject).multiplicity } : o));
    const at = (magnification: number) => generatePool(kb, request(NIGHT, { length: 5, instrument: { fovDeg: 7, aperture: 50, magnification } })).journeys
      .filter((j) => j.templateId === 'A1-cradle-to-grave').flatMap((j) => j.stops.map((x) => x.objectId));
    expect(at(10)).toContain('STAR-Aldebaran');
    expect(at(7)).not.toContain('STAR-Aldebaran');
  });

  it('a lens minMagnification keeps the stop to that power and up, whatever its look says', () => {
    const lens = { ...FIXTURE_LENS_A2, objects: { ...FIXTURE_LENS_A2.objects, 'STAR-Capella': { ...FIXTURE_LENS_A2.objects['STAR-Capella'], minMagnification: 10 } } };
    const ct = compileTemplate(FIXTURE_KB.templates[1], lens);
    expect(lensVisibleOk(ct, capella, 10)).toBe(true);
    expect(lensVisibleOk(ct, capella, 7)).toBe(false);
    expect(lensVisibleOk(ct, withPair(120), 7)).toBe(false); // even a pair the data says splits
    expect(ThemeLensSchema.safeParse({ ...FIXTURE_LENS_A2.objects['STAR-Capella'], minMagnification: 10 }).success).toBe(true);
    expect(ThemeLensSchema.safeParse({ ...FIXTURE_LENS_A2.objects['STAR-Capella'], minMagnification: 0 }).success).toBe(false);
  });
});

describe('theme lenses: journeys', () => {
  const kb = lensFixtureKb();
  const js = pool(kb).filter((j) => j.templateId === 'A1-cradle-to-grave');

  it('finds lens journeys that pass every hard constraint and every lens rule', () => {
    expect(js.length).toBeGreaterThan(0);
    const res = generatePool(kb, REQ);
    for (const j of js) {
      expect(independentProblems(kb, REQ, { journeys: [j], diagnostics: res.diagnostics }, j), j.key).toEqual([]);
      expect(lensRules(j, FIXTURE_LENS_A1), j.key).toEqual([]);
    }
  });

  it('positional arcs, beat labels as roles, and the stop carries its lens', () => {
    for (const j of js) {
      expect(j.stops[0].arc).toBe('hook');
      expect(j.stops[j.stops.length - 1].arc).toBe('payoff');
      for (const s of j.stops.slice(1, -1)) expect(s.arc).toBe('build');
      for (const s of j.stops) {
        expect(s.lens).toEqual(FIXTURE_LENS_A1.objects[s.objectId]);
        expect(FIXTURE_LENS_A1.beats.find((b) => b.step === s.lens!.step)!.label).toBe(s.role);
      }
      // Every step rides the storyline: the lens thread link, a curated edge from LENS_CURATED_MIN_STRENGTH or a
      // derived one from LENS_LINK_STRENGTH.
      for (const s of j.stops.slice(1)) {
        const l = s.link!;
        expect(l.subtype === LENS_LINK_SUBTYPE || l.strength >= (l.curated ? LENS_CURATED_MIN_STRENGTH : LENS_LINK_STRENGTH)).toBe(true);
      }
    }
  });

  it('an object without a lens is never used in that theme', () => {
    // NGC 1981 opens one of the fixture's two A1 journeys; without its lens that journey is gone, the other stays.
    expect(js.some((j) => j.stops.some((s) => s.objectId === 'NGC1981'))).toBe(true);
    const without = { ...FIXTURE_LENS_A1, objects: Object.fromEntries(Object.entries(FIXTURE_LENS_A1.objects).filter(([id]) => id !== 'NGC1981')) };
    const out = pool(lensFixtureKb({ lenses: [without, FIXTURE_LENS_A2] })).filter((j) => j.templateId === 'A1-cradle-to-grave');
    expect(out.length).toBeGreaterThan(0);
    for (const j of out) expect(j.stops.some((s) => s.objectId === 'NGC1981')).toBe(false);
  });

  it('maxStops caps a beat; minBeats sets the fewest beats', () => {
    const one = { ...FIXTURE_LENS_A1, beats: FIXTURE_LENS_A1.beats.map((b) => ({ ...b, maxStops: 1 })) };
    const capped = pool(lensFixtureKb({ lenses: [one] }), request(NIGHT, { length: 4 })).filter((j) => j.templateId === 'A1-cradle-to-grave');
    expect(capped.length).toBeGreaterThan(0);
    for (const j of capped) expect(new Set(steps(j)).size).toBe(j.stops.length);
    expect(js.some((j) => steps(j).filter((x) => x === 2).length === 2)).toBe(true); // the shipped fixture allows two
    const four = { ...FIXTURE_LENS_A1, minBeats: 4 };
    const deep = pool(lensFixtureKb({ lenses: [four] })).filter((j) => j.templateId === 'A1-cradle-to-grave');
    for (const j of deep) expect(new Set(steps(j)).size).toBeGreaterThanOrEqual(4);
  });

  it('an archetype without a lens set keeps its slot grammar', () => {
    const kbA2 = lensFixtureKb({ lenses: [FIXTURE_LENS_A2] });
    const a1 = pool(kbA2).filter((j) => j.templateId === 'A1-cradle-to-grave');
    expect(a1.length).toBeGreaterThan(0);
    const labels = new Set(FIXTURE_KB.templates[0].slots.map((s) => s.label));
    for (const j of a1) for (const s of j.stops) { expect(s.lens).toBeUndefined(); expect(labels.has(s.role)).toBe(true); }
  });

  it('lens journeys rebuild from their key with the same lenses', () => {
    const j = js[0];
    const rb = rebuildJourney(kb, j.key, REQ);
    expect(rb.valid, rb.problems.join('; ')).toBe(true);
    expect(rb.journey!.stops.map((s) => s.lens)).toEqual(j.stops.map((s) => s.lens));
  });

  it('the stop schema keeps the lens (and the journey its payoff) through a save and reload', () => {
    const j = generate(kb, REQ).journeys.find((x) => x.templateId === 'A1-cradle-to-grave')!;
    const back = JourneySchema.parse(JSON.parse(JSON.stringify(j)));
    expect(back.stops.map((s) => s.lens)).toEqual(j.stops.map((s) => s.lens));
    expect(back.payoff).toBe(j.payoff);
    expect(JourneyResultSchema.safeParse(generate(kb, REQ)).success).toBe(true);
  });
});

describe('theme lenses: no archetype switch (round 3)', () => {
  const kb = lensFixtureKb({ switch: true });
  const js = pool(kb);

  it('a lens theme with a switch rule tells its own story only: no switch, one payoff, the A1 lens on every stop', () => {
    expect(js.some((j) => j.templateId === 'A1-cradle-to-grave')).toBe(true);
    const res = generatePool(kb, REQ);
    for (const j of js) {
      expect(j.switch, j.key).toBeUndefined();
      expect(j.stops.filter((s) => s.arc === 'payoff').length).toBe(1);
      expect(independentProblems(kb, REQ, { journeys: [j], diagnostics: res.diagnostics }, j), j.key).toEqual([]);
      if (j.templateId === 'A1-cradle-to-grave') for (const s of j.stops) expect(s.lens).toEqual(kb.lenses!.find((l) => l.archetype === 'A1')!.objects[s.objectId]);
    }
  });

  it('a journey key that names a switch out of a lens theme no longer validates', () => {
    const j = js.find((x) => x.templateId === 'A1-cradle-to-grave' && x.stops.length >= 4)!;
    const k = decodeJourneyKey(j.key)!;
    const a2 = kb.lenses!.find((l) => l.archetype === 'A2')!;
    const at = j.stops.length - 2;
    // Hand-made switch into A2 at the second-to-last stop (A2 is a lens theme too).
    const forged = encodeJourneyKey({ ...k, switch: { toTemplateId: 'A2-thermometer', at } });
    const rb = rebuildJourney(kb, forged, REQ);
    expect(rb.valid).toBe(false);
    expect(rb.problems.join(' ')).toMatch(/never switches|grammar|does not match/);
    expect(a2).toBeDefined();
  });
});

describe('theme lenses: narration', () => {
  const kb = lensFixtureKb({ switch: true });
  const js = pool(kb);
  const plain = js.filter((j) => j.templateId === 'A1-cradle-to-grave' && !j.switch);

  it('theme narration overrides the bank (title, payoff); the payoff carries no label sentence', () => {
    for (const j of plain) {
      expect(j.title).toBe('A Life Story in Orion');
      expect(j.payoff).toBe(FIXTURE_LENS_NARRATION['payoff.A1-cradle-to-grave'][0]);
      expect(j.payoff).not.toMatch(/where it lands/i);
    }
  });

  it('why-here is the lens why; transitions come from the theme table, pair line first, then arrive', () => {
    for (const j of js) {
      const nar = narrateJourney(j, kb, { seedKey: 'journeys-text-1', region: j.regionName });
      j.stops.forEach((s, i) => {
        if (!s.lens) return;
        expect(nar.stops[i].whyHere.text.startsWith(s.lens.why.replace(/\.$/, ''))).toBe(true);
        if (i === 0) return;
        const t = nar.stops[i].transition!;
        expect(t.key, `${j.key} ${i}`).toMatch(/^lens:A[12]:/);
        const prevStep = (j.switch && i === j.switch.atStop + 1 ? FIXTURE_LENS_A2 : i > (j.switch?.atStop ?? Infinity) ? FIXTURE_LENS_A2 : FIXTURE_LENS_A1).objects[j.stops[i - 1].objectId]?.step;
        const set = j.switch && i > j.switch.atStop ? FIXTURE_LENS_A2 : FIXTURE_LENS_A1;
        const pairKey = `${prevStep}>${s.lens.step}`;
        if (set.transitions?.pairs?.[pairKey]) expect(t.key).toBe(`lens:${set.archetype}:${pairKey}`);
        else expect(t.key).toBe(`lens:${set.archetype}:arrive:${s.lens.step}`);
      });
    }
  });

  it('a lens transition is the theme line alone: no curated object-pair line is appended', () => {
    for (const j of js) {
      const nar = narrateJourney(j, kb, { seedKey: 'journeys-text-1', region: j.regionName });
      j.stops.forEach((s, i) => {
        if (!s.lens || i === 0 || (j.switch && i === j.switch.atStop + 1)) return; // the switch stop adds its announce line
        const t = nar.stops[i].transition!;
        if (!t.key.startsWith('lens:A')) return;
        const set = j.switch && i > j.switch.atStop ? FIXTURE_LENS_A2 : FIXTURE_LENS_A1;
        const prevStep = set.objects[j.stops[i - 1].objectId]?.step;
        const lines = [...(set.transitions?.pairs?.[`${prevStep}>${s.lens.step}`] ?? []), ...(set.transitions?.arrive?.[String(s.lens.step)] ?? [])];
        const sentences = (x: string) => x.split(/(?<=[.?])\s+/).length;
        // A line from the theme table (placeholders filled), never with a second, appended pair sentence.
        expect(sentences(t.text), t.text).toBeLessThanOrEqual(Math.max(...lines.map(sentences)));
      });
    }
  });

  it('falls back to a plain thread line when the theme table has no line for a step', () => {
    const bare = { ...FIXTURE_LENS_A1, transitions: undefined };
    const k2 = lensFixtureKb({ lenses: [bare] });
    for (const j of pool(k2).filter((x) => x.templateId === 'A1-cradle-to-grave')) {
      const nar = narrateJourney(j, k2, { seedKey: 'journeys-text-1', region: j.regionName });
      j.stops.slice(1).forEach((s, k) => {
        const t = nar.stops[k + 1].transition!;
        if (s.link!.subtype === LENS_LINK_SUBTYPE) expect(t.key).toBe('builtin:lens');
        else expect(t.key.startsWith('lens:')).toBe(false);
        expect(t.text).not.toMatch(/\{\w+\}/);
      });
    }
  });

  it('the resolved card shows the lens: beat chip, question, why, look, shared story, answer; payoff on the last stop', () => {
    const j = plain[0];
    const by = new Map(kb.objects.map((o) => [o.id, o] as const));
    j.stops.forEach((s, i) => {
      const o = by.get(s.objectId)!;
      const c = resolveStopCard(j, s, o);
      expect(c.lensed).toBe(true);
      expect(c.beat).toBe(s.lens!.beat);
      expect(c.question).toBe(s.lens!.question);
      expect(c.why).toBe(s.whyHereText);
      expect(c.look).toBe(s.lens!.look ?? o.card.see);
      expect(c.understand).toBe(o.card.understand);
      expect(c.answer).toBe(s.lens!.answer);
      expect(c.payoff).toBe(i === j.stops.length - 1 ? j.payoff : null);
    });
  });
});

describe('theme lenses: round 3 contract (story, rank, firstSteps, beat-aware narration)', () => {
  const kb = lensFixtureKb();
  const plain = pool(kb).filter((j) => j.templateId === 'A1-cradle-to-grave' && !j.switch);
  const by = new Map(kb.objects.map((o) => [o.id, o] as const));

  it('the schemas take lens.story, lens.rank and storyline firstSteps (and stay strict)', () => {
    const lens = { ...FIXTURE_LENS_A1.objects.M42, story: 'Gas collapses under its own gravity until the core is hot enough to fuse. We know because infrared shows the stars still wrapped in dust.', rank: 1.5 };
    expect(ThemeLensSchema.parse(lens)).toEqual(lens);
    expect(ThemeLensSchema.safeParse({ ...lens, rank: 'old' }).success).toBe(false);
    expect(ThemeLensSchema.safeParse({ ...lens, story: '' }).success).toBe(false);
    expect(ThemeLensSchema.safeParse({ ...lens, extra: 'x' }).success).toBe(false);
    const set = { ...FIXTURE_LENS_A1, firstSteps: [1, 2], objects: { ...FIXTURE_LENS_A1.objects, M42: lens } };
    expect(ThemeLensSetSchema.parse(set)).toEqual(set);
    expect(ThemeLensFileSchema.safeParse({ ...set, narration: { 'payoff.A1-cradle-to-grave.end5': ['x'] } }).success).toBe(true);
    expect(lensIssues([set], FIXTURE_KB)).toEqual([]);
  });

  it('lensIssues: firstSteps name real beats; a lens story has 1 to 4 sentences', () => {
    const five = 'One. Two. Three. Four. Five.';
    const bad = { ...FIXTURE_LENS_A1, firstSteps: [9], objects: { ...FIXTURE_LENS_A1.objects, M42: { ...FIXTURE_LENS_A1.objects.M42, story: five } } };
    const issues = lensIssues([bad], FIXTURE_KB).join('\n');
    expect(issues).toMatch(/lens A1: firstSteps names 9, which is not a beat/);
    expect(issues).toMatch(/object M42: story has 5 sentences \(1–4\)/);
    expect(sentenceCount('About 1,300 light-years away, e.g. far. It is 3.5 times wider than M. 42 suggests? Yes')).toBe(3);
    expect(sentenceCount('The Sun is 4.6 billion years old.')).toBe(1);
  });

  it('the build: banned phrases in a story are errors, end<N> keys must name a beat, catalog codes are notes', () => {
    const file = 'script/journeys/curated/lenses/A1.json';
    const raw = {
      ...FIXTURE_LENS_A1,
      narration: { ...FIXTURE_LENS_NARRATION, 'payoff.A1-cradle-to-grave.end9': ['Nope.'], 'story.A1-cradle-to-grave.end4': ['Fine.'], 'story.A1-cradle-to-grave.endless': ['Bad key.'] },
      objects: {
        ...FIXTURE_LENS_A1.objects,
        M42: { ...FIXTURE_LENS_A1.objects.M42, story: 'Let’s see why M42 glows.' },
        M45: { ...FIXTURE_LENS_A1.objects.M45, story: 'Its blue stars are young.', rank: 2 },
      },
    };
    const { issues, notes, lenses } = loadLenses([{ file, raw }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    const all = issues.join('\n');
    expect(all).toMatch(/object M42 story: banned phrase/);
    expect(all).toMatch(/narration key "payoff.A1-cradle-to-grave.end9": end9 is not a beat/);
    expect(all).not.toMatch(/story.A1-cradle-to-grave.end4/);
    expect(all).toMatch(/"story.A1-cradle-to-grave.endless": beat variants read/);
    expect(notes.join('\n')).toMatch(/object M42 story: catalog code "M42"/);
    expect(CATALOG_CODE.test('the Orion Nebula')).toBe(false);
    // story and rank reach the runtime set
    expect(lenses[0].set.objects.M45.story).toBe('Its blue stars are young.');
    expect(lenses[0].set.objects.M45.rank).toBe(2);
    const ok = loadLenses([{ file, raw: { ...FIXTURE_LENS_A1, firstSteps: [2, 1], narration: { ...FIXTURE_LENS_NARRATION, 'payoff.A1-cradle-to-grave.end5': ['Fine.'] } } }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    expect(ok.issues).toEqual([]);
    expect(ok.lenses[0].set.firstSteps).toEqual([1, 2]);
  });

  it('splitSentences keeps abbreviations, initials and decimals inside a sentence and ends one at a closing letter', () => {
    expect(splitSentences('Barnard (E. E. Barnard) saw it at 3.5 times the size, e.g. in St. Louis. Then it faded.')).toHaveLength(2);
    expect(splitSentences('The H.E.S.S. observatory saw it. Next.')).toHaveLength(2);
    expect(splitSentences('The spectral letters run O, B, A, F, G, K and M. Only later came the order.')).toHaveLength(2);
    expect(splitSentences('Look beside the fainter, paler ζ¹. Any binoculars split it.')).toHaveLength(2);
    expect(splitSentences('It sits east of the Double Cluster. h Persei, the western one, is younger.')).toHaveLength(2);
    expect(splitSentences('Seen at 19,000 K. The two look alike')).toEqual(['Seen at 19,000 K.', 'The two look alike']);
  });

  it('the build: a lens sentence over 220 characters is reported (an error unless LONG_SENTENCE_IS_ERROR is off) naming file, object, field and length', () => {
    const file = 'script/journeys/curated/lenses/A1.json';
    const long = `${'A very long clause about the stars, '.repeat(7)}and the end.`;
    const raw = {
      ...FIXTURE_LENS_A1,
      storyline: `${FIXTURE_LENS_A1.storyline} ${long}`,
      objects: { ...FIXTURE_LENS_A1.objects, M42: { ...FIXTURE_LENS_A1.objects.M42, story: `Short one. ${long}` } },
    };
    const { issues, notes } = loadLenses([{ file, raw }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    const sink = (LONG_SENTENCE_IS_ERROR ? issues : notes).join('\n');
    expect(sink).toContain(`${file}: object M42 story: long sentence of ${long.length} characters (max 220)`);
    expect(sink).toContain(`${file}: storyline: long sentence of ${long.length} characters`);
    if (!LONG_SENTENCE_IS_ERROR) expect(issues.filter((x) => x.includes('long sentence'))).toEqual([]);
  });

  it('payoff.<tid>.end<lastStep> and story.<tid>.end<lastStep> win when the journey ends on that beat, never otherwise', () => {
    expect(plain.length).toBeGreaterThan(0);
    for (const j of plain) {
      const last = lastLensStep(j, 0, j.stops.length - 1)!;
      expect(last).toBe(j.stops[j.stops.length - 1].lens!.step);
      const other = FIXTURE_LENS_A1.beats.map((b) => b.step).find((x) => x !== last)!;
      const variants = {
        ...kb.narration.variants,
        [`payoff.A1-cradle-to-grave.end${last}`]: ['The story ends on its own last beat tonight.'],
        [`story.A1-cradle-to-grave.end${last}`]: ['A life told up to the chapter the sky allows tonight.'],
        [`payoff.A1-cradle-to-grave.end${other}`]: ['This line promises a beat the journey did not end on.'],
        [`story.A1-cradle-to-grave.end${other}`]: ['This story promises a beat the journey did not end on.'],
      };
      const nar = narrateJourney(j, { ...kb, narration: { ...kb.narration, variants } }, { seedKey: 'journeys-text-1', region: j.regionName });
      expect(nar.payoff!.key).toBe(`payoff.A1-cradle-to-grave.end${last}`);
      expect(nar.story.key).toBe(`story.A1-cradle-to-grave.end${last}`);
      // Round 4: titles too (a night that ends on a living star is never titled for a death it does not show).
      const titled = narrateJourney(j, { ...kb, narration: { ...kb.narration, variants: { ...variants,
        [`title.A1-cradle-to-grave.end${last}`]: ['The Last Chapter Tonight in {region}'],
        [`title.A1-cradle-to-grave.end${other}`]: ['A Title for Another Ending in {region}'] } } }, { seedKey: 'journeys-text-1', region: j.regionName });
      expect(titled.title.key).toBe(`title.A1-cradle-to-grave.end${last}`);
      expect(titled.title.text).not.toMatch(/Another Ending/);
      // Without a variant for the last beat, the generic keys answer.
      const fallback = narrateJourney(j, kb, { seedKey: 'journeys-text-1', region: j.regionName });
      expect(fallback.payoff!.key).toBe('payoff.A1-cradle-to-grave');
    }
    expect(lastLensStep({ stops: [] }, 0, 3)).toBeNull();
  });

  it('<family>.<tid>.end<N>.no<S> wins on a night that skipped beat S before N, never on one that visited it', () => {
    const at = (...xs: number[]) => ({ stops: xs.map((step) => ({ lens: { step } })) }) as unknown as Pick<Journey, 'stops'>;
    expect(beatKeys('payoff', 'T', at(1, 3, 5), 0, 2, [1, 2, 3, 4, 5])).toEqual(['payoff.T.end5.no2', 'payoff.T.end5.no4', 'payoff.T.end5']);
    expect(beatKeys('title', 'T', at(1, 2, 4), 0, 2, [1, 2, 3, 4, 5])).toEqual(['title.T.end4.no3', 'title.T.end4']);
    expect(beatKeys('title', 'T', at(1, 2, 4), 0, 1, [1, 2, 3, 4, 5])).toEqual(['title.T.end2']); // the stretch only
    expect(beatKeys('title', 'T', { stops: [] }, 0, 3, [1, 2])).toEqual([]);
    expect(plain.length).toBeGreaterThan(0);
    let skips = 0;
    for (const j of plain) {
      const last = lastLensStep(j, 0, j.stops.length - 1)!;
      const visited = new Set(j.stops.map((x) => x.lens!.step));
      const before = FIXTURE_LENS_A1.beats.map((b) => b.step).filter((x) => x < last);
      const variants: Record<string, string[]> = { ...kb.narration.variants };
      for (const x of before) {
        variants[`title.A1-cradle-to-grave.end${last}.no${x}`] = [`Without Chapter ${x} in {region}`];
        variants[`payoff.A1-cradle-to-grave.end${last}.no${x}`] = [`The night went without chapter ${x}.`];
        variants[`story.A1-cradle-to-grave.end${last}.no${x}`] = [`A life told without chapter ${x}.`];
      }
      const nar = narrateJourney(j, { ...kb, narration: { ...kb.narration, variants } }, { seedKey: 'journeys-text-1', region: j.regionName });
      const skipped = before.find((x) => !visited.has(x));
      for (const [fam, line] of [['title', nar.title], ['payoff', nar.payoff!], ['story', nar.story]] as const) {
        if (skipped !== undefined) expect(line.key).toBe(`${fam}.A1-cradle-to-grave.end${last}.no${skipped}`);
        else expect(line.key).not.toMatch(/\.no\d/);
      }
      if (skipped !== undefined) skips++;
    }
    expect(skips).toBeGreaterThan(0);
  });

  it('a .no<step> key names a real beat before its end (lens loader)', () => {
    const file = 'lenses/A1.json';
    const load = (k: string) => loadLenses([{ file, raw: { ...FIXTURE_LENS_A1, narration: { ...FIXTURE_LENS_NARRATION, [k]: ['Fine.'] } } }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true).issues.join('\n');
    expect(load('title.A1-cradle-to-grave.end5.no4')).toBe('');
    expect(load('payoff.A1-cradle-to-grave.end4.no5')).toMatch(/no5 must name a beat before end4/);
    expect(load('payoff.A1-cradle-to-grave.end5.no9')).toMatch(/no9 must name a beat before end5/);
    expect(load('story.A1-cradle-to-grave.no4')).toMatch(/beat variants read/);
  });

  it('a title.<tid>.end<step> key must name a real beat (lens loader)', () => {
    const file = 'lenses/A1.json';
    const bad = loadLenses([{ file, raw: { ...FIXTURE_LENS_A1, narration: { ...FIXTURE_LENS_NARRATION, 'title.A1-cradle-to-grave.end9': ['Nine'] } } }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    expect(bad.issues.join('\n')).toMatch(/title\.A1-cradle-to-grave\.end9.*end9 is not a beat/);
  });

  it('a lens card ends on its answer: the wonder goes under More (codaUnderMore), a plain card keeps its coda', () => {
    const j = plain[0];
    const s = j.stops[0];
    const o = by.get(s.objectId)!;
    expect(resolveStopCard(j, s, o).codaUnderMore).toBe(true);
    expect(resolveStopCard(j, { ...s, lens: undefined }, o).codaUnderMore).toBe(false);
  });

  it('the resolved card exposes story = lens.story (else null) and keeps understand separately', () => {
    const j = plain[0];
    const s = j.stops[0];
    const o = by.get(s.objectId)!;
    expect(resolveStopCard(j, s, o).story).toBeNull();
    const withStory = { ...s, lens: { ...s.lens!, story: 'Gravity pulls the gas inward until the core ignites.' } };
    const c = resolveStopCard(j, withStory, o);
    expect(c.story).toBe('Gravity pulls the gas inward until the core ignites.');
    expect(c.understand).toBe(o.card.understand);
  });
});

describe('theme lenses: honest endings (round 4 engine)', () => {
  const ct = compileTemplate(FIXTURE_KB.templates[0], FIXTURE_LENS_A1);
  const last = FIXTURE_LENS_A1.beats.length - 1;
  const dso = FIXTURE_KB.objects.find((o) => o.kind === 'dso')!;
  it('a challenge closes the story only with ≥ 45 mm binoculars and outside moonlight', () => {
    expect(lensPayoffOk(ct, last, dso, 2, { aperture: 50, glowMag: 0 })).toBe(true);
    expect(lensPayoffOk(ct, last, dso, 2, { aperture: 35, glowMag: 0 })).toBe(false);
    expect(lensPayoffOk(ct, last, dso, 2, { aperture: 50, glowMag: CHALLENGE_PAYOFF_MAX_GLOW })).toBe(false);
    // A sure sight (rating 0/1) is untouched by aperture or Moon.
    expect(lensPayoffOk(ct, last, dso, 1, { aperture: 35, glowMag: 2 })).toBe(true);
  });
  it('the hop onto the final beat may stretch to FINALE_HOP_STRETCH × the hop limit; other hops may not', () => {
    expect(hopLimitInto(ct, last, 20)).toBeCloseTo(20 * FINALE_HOP_STRETCH, 9);
    expect(hopLimitInto(ct, 0, 20)).toBe(20);
  });
});

describe('theme lenses: whole stories (round 3 engine)', () => {
  const kb = lensFixtureKb();
  const prep = prepareKb(kb);
  const s = normalizeRequest(REQ);
  const table = buildCandidateTable(prep, s, undefined, 6);
  const a1 = prep.templates.find((x) => x.t.id === 'A1-cradle-to-grave')!;
  const idx = (id: string) => prep.index.get(id)!;
  const m42 = prep.objects[idx('M42')];
  const region = { center: { ra: m42.ra, dec: m42.dec }, radius: 30 };
  const cover = (ct: typeof a1, ids: string[]) => lensCoverageTerm(table, ct, ids.map(idx), region.center, region.radius);

  it('the fixture night has the Orion Nebula and λ Orionis up as sure sights', () => {
    expect(table.feasibleMask[idx('M42')] & 1).toBe(1);
    expect(table.stops[idx('M42')][0].rating).toBeLessThan(2);
    expect(table.feasibleMask[idx('Cr69')] & 1).toBe(1);
  });

  it('opening on a later beat while an earlier beat is in reach costs LENS_OPEN_PENALTY; a firstSteps beat is a fine opening', () => {
    expect(cover(a1, ['M42', 'Cr69', 'M45', 'STAR-Aldebaran'])).toBe(0);
    expect(cover(a1, ['Cr69', 'M45', 'STAR-Aldebaran'])).toBe(LENS_OPEN_PENALTY);
    const first = compileTemplate(FIXTURE_KB.templates[0], { ...FIXTURE_LENS_A1, firstSteps: [1, 2] });
    expect(cover(first, ['Cr69', 'M45', 'STAR-Aldebaran'])).toBe(0);
    // No nursery in reach (a region cap that leaves it out): nothing to pay.
    const far = lensCoverageTerm(table, a1, ['Cr69', 'M45', 'STAR-Aldebaran'].map(idx), { ra: prep.objects[idx('M45')].ra, dec: prep.objects[idx('M45')].dec }, 5);
    expect(far).toBe(0);
  });

  it('jumping over a beat that is in reach of both neighbours costs LENS_SKIP_PENALTY per beat', () => {
    // λ Orionis (2) → Aldebaran (4) leaves out the grown family (3) with the Pleiades and Hyades in reach.
    expect(cover(a1, ['M42', 'Cr69', 'STAR-Aldebaran'])).toBe(LENS_SKIP_PENALTY);
    expect(cover(a1, ['M42', 'Cr69', 'AST-Hyades', 'STAR-Aldebaran'])).toBe(0);
  });

  it('a key beat (storyline keySteps) left out costs KEY_BEAT_FACTOR × the skip and repeat prices (owner r3: A9 strangers)', () => {
    const keyed = compileTemplate(FIXTURE_KB.templates[0], { ...FIXTURE_LENS_A1, keySteps: [3] });
    expect(Array.from(keyed.lens!.keySlots!)).toEqual([2]); // beat 3 is slot 2
    expect(KEY_BEAT_FACTOR).toBeGreaterThan(1);
    // λ Orionis (2) → Aldebaran (4) over the grown family (3), in reach of both: the full skip price, weighted.
    expect(cover(keyed, ['M42', 'Cr69', 'STAR-Aldebaran'])).toBeCloseTo(KEY_BEAT_FACTOR * LENS_SKIP_PENALTY, 9);
    // A repeat on beat 2 while beat 3 waits, then a soft skip of beat 3: both weighted.
    expect(cover(keyed, ['M42', 'Cr69', 'AST-OrionBelt', 'STAR-Betelgeuse'])).toBeCloseTo(KEY_BEAT_FACTOR * (LENS_REPEAT_PENALTY + LENS_SKIP_SOFT_PENALTY), 9);
    // Telling the key beat costs nothing; a key beat elsewhere leaves this skip at its usual price.
    expect(cover(keyed, ['M42', 'Cr69', 'AST-Hyades', 'STAR-Aldebaran'])).toBe(0);
    const other = compileTemplate(FIXTURE_KB.templates[0], { ...FIXTURE_LENS_A1, keySteps: [5] });
    expect(cover(other, ['M42', 'Cr69', 'STAR-Aldebaran'])).toBe(LENS_SKIP_PENALTY);
    // Schema and checks: keySteps is part of the strict set schema and must name real beats.
    const set = { ...FIXTURE_LENS_A1, keySteps: [3] };
    expect(ThemeLensSetSchema.parse(set)).toEqual(set);
    expect(lensIssues([set], FIXTURE_KB)).toEqual([]);
    expect(lensIssues([{ ...FIXTURE_LENS_A1, keySteps: [9] }], FIXTURE_KB).join('\n')).toMatch(/lens A1: keySteps names 9, which is not a beat/);
  });

  it('a second stop on one beat costs LENS_REPEAT_PENALTY when the next, unvisited beat was in reach', () => {
    // λ Orionis (2) → Orion's Belt (2): the Hyades (3) were in reach of λ Orionis and the journey never visits beat 3.
    // Round 4: the Belt → Betelgeuse jump also skips beat 3 while the route passes within a hop of the Hyades, so it
    // pays the soft skip price as well.
    expect(cover(a1, ['M42', 'Cr69', 'AST-OrionBelt', 'STAR-Betelgeuse'])).toBeCloseTo(LENS_REPEAT_PENALTY + LENS_SKIP_SOFT_PENALTY, 9);
    expect(cover(a1, ['M42', 'Cr69', 'AST-OrionBelt', 'AST-Hyades', 'STAR-Aldebaran'])).toBe(0);
  });

  it('the beam ranks a journey that opens at the nursery above one that leaves it out', () => {
    const js = pool(kb).filter((j) => j.templateId === 'A1-cradle-to-grave');
    const best = js.slice().sort((a, b) => b.score - a.score)[0];
    expect(best.stops[0].lens!.step).toBe(1);
    // Every journey that opens later pays for it in its score (same stops otherwise: the score is h).
    const res = generate(kb, { ...REQ, theme: 'A1-cradle-to-grave' });
    expect(res.journeys[0].stops[0].lens!.step).toBe(1);
  });

  it('stops sharing a beat follow ThemeLens.rank (lensRankOk, the beam, the re-ordering and the validator)', () => {
    const ranked: ThemeLensSet = {
      ...FIXTURE_LENS_A1,
      objects: {
        ...FIXTURE_LENS_A1.objects,
        NGC1981: { ...FIXTURE_LENS_A1.objects.NGC1981, rank: 1 },
        Cr69: { ...FIXTURE_LENS_A1.objects.Cr69, rank: 2 },
        'AST-OrionBelt': { ...FIXTURE_LENS_A1.objects['AST-OrionBelt'], rank: 3 },
      },
    };
    const ct = compileTemplate(FIXTURE_KB.templates[0], ranked);
    expect(lensRankOk(ct, 'NGC1981', 'Cr69')).toBe(true);
    expect(lensRankOk(ct, 'Cr69', 'NGC1981')).toBe(false);
    expect(lensRankOk(ct, 'M42', 'NGC1981')).toBe(true); // different beats: the beats decide
    expect(lensRankOk(a1, 'Cr69', 'NGC1981')).toBe(true); // no ranks: any order
    const k2 = lensFixtureKb({ lenses: [ranked, FIXTURE_LENS_A2], version: 'fixture-ranked' });
    const js = pool(k2).filter((j) => j.templateId === 'A1-cradle-to-grave');
    const doubled = js.filter((j) => steps(j).filter((x) => x === 2).length === 2);
    expect(doubled.length).toBeGreaterThan(0);
    for (const j of doubled) {
      const two = j.stops.filter((x) => x.lens!.step === 2).map((x) => ranked.objects[x.objectId].rank!);
      expect(two[0]).toBeLessThan(two[1]);
    }
    // A hand-made key with the two beat-2 stops against their rank no longer validates.
    const j = doubled[0];
    const d = decodeJourneyKey(j.key)!;
    const at = j.stops.findIndex((x) => x.lens!.step === 2);
    const ids = d.stopIds.slice();
    [ids[at], ids[at + 1]] = [ids[at + 1], ids[at]];
    const rb = rebuildJourney(k2, encodeJourneyKey({ ...d, stopIds: ids }), REQ);
    expect(rb.valid).toBe(false);
    expect(rb.problems.join(' ')).toMatch(/lens rank/);
  });

  it('a challenge stop closes the journey only on the final beat or an end beat, and never a fading variable', () => {
    const m1 = prep.objects[idx('M1')], ald = prep.objects[idx('STAR-Aldebaran')];
    expect(lensFinaleSlot(a1, 4)).toBe(true); // "What remains", the last beat
    expect(lensFinaleSlot(a1, 3)).toBe(false);
    expect(lensPayoffOk(a1, 4, m1, 2)).toBe(true);
    expect(lensPayoffOk(a1, 3, ald, 2)).toBe(false);
    expect(lensPayoffOk(a1, 3, ald, 1)).toBe(true);
    const end = compileTemplate(FIXTURE_KB.templates[0], { ...FIXTURE_LENS_A1, endSteps: [4, 5] });
    expect(lensPayoffOk(end, 3, ald, 2)).toBe(true); // an end beat
    const fading = { ...ald, variability: { class: 'mira', vMax: 5, vMin: 11, binocularVisibleAtMin: false } } as unknown as KbObject;
    expect(lensPayoffOk(end, 3, fading, 2)).toBe(false);
    // A faint star never closes, challenge or not.
    expect(lensPayoffOk(a1, 4, { ...ald, mag: 7.5 } as KbObject, 1)).toBe(false);
  });

  it('a back-track may ride the storyline when it moves on to a later beat (lens themes only)', () => {
    const weak = { from: 'a', to: 'b', type: 'SAME_PHYSICS' as const, subtype: LENS_LINK_SUBTYPE, strength: LENS_LINK_STRENGTH, reasonKey: LENS_LINK_SUBTYPE, curated: false, directed: true };
    expect(backtrackLinkOk(a1, weak, 1, 2)).toBe(true);
    expect(backtrackLinkOk(a1, weak, 1, 1)).toBe(false); // same beat: the story gives no reason to turn back
    expect(backtrackLinkOk(compileTemplate(FIXTURE_KB.templates[0]), weak, 1, 2)).toBe(false); // slot themes need a strong link
    expect(backtrackLinkOk(a1, { ...weak, strength: 0.9 }, 2, 2)).toBe(true);
  });

  it('selection: a short journey never ranks above a 4+ stop journey of the same theme', () => {
    const mk = (key: string, n: number, score: number, templateId: string, region: string, tier = 1) => ({
      journey: { key, score, templateId, regionName: region } as Journey, ids: Array.from({ length: n }, (_, i) => `${key}-${i}`), tier, lengthMiss: Math.abs(n - 5),
      patch: { id: key }, centroid: { ra: n * 50, dec: 0 }, plan: undefined, ident: key,
    });
    const pick = selectWithShuffle([mk('short', 3, 9, 'A11-x', 'Cygnus'), mk('long', 4, 1, 'A11-x', 'Cassiopeia')] as never[], 1, 0, 'seed') as unknown as { journey: Journey }[];
    expect(pick[0].journey.key).toBe('long');
    // Without a longer one of its theme, a short journey competes on its score.
    const pick2 = selectWithShuffle([mk('short', 3, 9, 'A11-x', 'Cygnus'), mk('other', 3, 5, 'A2-y', 'Lyra')] as never[], 1, 0, 'seed') as unknown as { journey: Journey }[];
    expect(pick2[0].journey.key).toBe('short');
    expect(SHORT_JOURNEY_STOPS).toBe(4);
  });
});

describe('theme lenses: schema and build checks', () => {
  it('knowledgeBaseFromFiles takes lenses.json; lensIssues names the archetype and object', () => {
    const files = { kb: { version: 'x', objects: FIXTURE_KB.objects, contexts: FIXTURE_KB.contexts, sources: FIXTURE_KB.sources }, concepts: { version: 'c', concepts: FIXTURE_KB.concepts }, edges: { version: 'e', edges: FIXTURE_KB.edges }, templates: { version: 't', templates: FIXTURE_KB.templates }, narration: FIXTURE_KB.narration };
    expect(knowledgeBaseFromFiles({ ...files, lenses: { version: 'l', lenses: [FIXTURE_LENS_A1] } }).lenses).toEqual([FIXTURE_LENS_A1]);
    expect(knowledgeBaseFromFiles({ ...files, lenses: { version: 'l', lenses: [] } }).lenses).toBeUndefined();
    expect(knowledgeBaseFromFiles(files).lenses).toBeUndefined();
    const bad: ThemeLensSet = {
      ...FIXTURE_LENS_A1,
      objects: {
        ...FIXTURE_LENS_A1.objects,
        Nope: { ...FIXTURE_LENS_A1.objects.M42 },
        M43: { ...FIXTURE_LENS_A1.objects.M43, step: 9 },
        M45: { ...FIXTURE_LENS_A1.objects.M45, question: 'Why does this cluster, which you can find easily in winter, look so very blue to the eye' },
      },
      transitions: { pairs: { '3>2': ['x {next}'] } },
    };
    const issues = lensIssues([bad], FIXTURE_KB);
    expect(issues.some((x) => /lens A1 object Nope: not in the KB/.test(x))).toBe(true);
    expect(issues.some((x) => /object M43: step 9 is not a beat/.test(x))).toBe(true);
    expect(issues.some((x) => /object M45: question has \d+ words/.test(x))).toBe(true);
    expect(issues.some((x) => /object M45: question does not end with "\?"/.test(x))).toBe(true);
    expect(issues.some((x) => /pair "3>2" goes back/.test(x))).toBe(true);
    expect(questionProblems('Can you see stars being born from your backyard?')).toEqual([]);
  });

  it('the build reports lens problems with the file and object id', () => {
    const file = 'script/journeys/curated/lenses/A1.json';
    const raw = {
      ...FIXTURE_LENS_A1,
      narration: { 'title.A1-cradle-to-grave': ['Born in {region}'], 'title.A2-thermometer': ['Wrong theme'], 'payoff.A1-cradle-to-grave': ['It ends here {nonsense}.'] },
      transitions: { pairs: {}, arrive: { 2: ['Onward to {next}!'] } },
      objects: { ...FIXTURE_LENS_A1.objects, M1: { ...FIXTURE_LENS_A1.objects.M1, why: 'Let’s finish with the wreck.' } },
    };
    const ineligible = new Set(['M43']);
    const { lenses, issues } = loadLenses([{ file, raw }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, (o) => !ineligible.has(o.id));
    const has = (re: RegExp) => expect(issues.some((x) => x.startsWith(file) && re.test(x)), `${re} in\n${issues.join('\n')}`).toBe(true);
    has(/object M43: not journey-eligible/);
    has(/object M1 why: banned phrase/);
    has(/transition 2: banned phrase or "!"/);
    has(/beat 3 \("Grown family"\) has no arrive line and no transition for 1>3, 2>3/);
    has(/narration key "title.A2-thermometer" does not belong to A1/);
    has(/narration payoff.A1-cradle-to-grave: unknown placeholder \{nonsense\}/);
    expect(lenses.map((l) => l.set.archetype)).toEqual(['A1']);
    // A clean file passes.
    const ok = loadLenses([{ file, raw: { ...FIXTURE_LENS_A1, narration: FIXTURE_LENS_NARRATION } }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    expect(ok.issues).toEqual([]);
    expect(ok.lenses[0].narration['title.A1-cradle-to-grave']).toEqual(FIXTURE_LENS_NARRATION['title.A1-cradle-to-grave']);
    // The file name must match the archetype.
    expect(loadLenses([{ file: 'script/journeys/curated/lenses/A2.json', raw: FIXTURE_LENS_A1 }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true).issues.join('\n')).toMatch(/does not match the file name/);
  });

  it('retired templates are dropped with every reference to them', () => {
    const src = {
      version: 't', templates: [
        { id: 'A3-how-far', archetype: 'A3', chainTo: ['A4-time-machine'], switchRule: { to: ['A4-time-machine'] } },
        { id: 'A4-time-machine', archetype: 'A4', retired: true, chainTo: ['A3-how-far'] },
        { id: 'A9-seeing-double', archetype: 'A9', chainTo: ['A10-stars-that-change', 'A2-thermometer'], switchRule: { to: ['A10-stars-that-change', 'A2-thermometer'] } },
        { id: 'A10-stars-that-change', archetype: 'A10', retired: true },
      ],
    };
    const out = activeTemplates(src) as { templates: Record<string, unknown>[] };
    expect(out.templates.map((t) => t.id)).toEqual(['A3-how-far', 'A9-seeing-double']);
    expect(out.templates[0].chainTo).toBeUndefined();
    expect(out.templates[0].switchRule).toBeUndefined();
    expect(out.templates[1].chainTo).toEqual(['A2-thermometer']);
    expect(out.templates[1].switchRule).toEqual({ to: ['A2-thermometer'] });
    expect(out.templates.some((t) => 'retired' in t)).toBe(false);
    // The shipped source marks A4, A10 and (owner feedback r4) A7 retired.
    const shipped = JSON.parse(readFileSync(new URL('../../../../public/data/journeys/src/templates.json', import.meta.url), 'utf8')) as { templates: { id: string; retired?: boolean }[] };
    expect(shipped.templates.filter((t) => t.retired).map((t) => t.id).sort()).toEqual(['A10-stars-that-change', 'A4-time-machine', 'A7-record-breakers']);
  });

  const built = new URL('../../../../public/data/journeys/templates.json', import.meta.url);
  it.skipIf(!existsSync(built))('the built KB offers no retired theme', () => {
    const t = JSON.parse(readFileSync(built, 'utf8')) as { templates: { id: string; chainTo?: string[]; switchRule?: { to: string[] } }[] };
    const ids = t.templates.map((x) => x.id);
    expect(ids).not.toContain('A4-time-machine');
    expect(ids).not.toContain('A10-stars-that-change');
    expect(ids).not.toContain('A7-record-breakers');
    // A retired theme's lens file stays on disk (restoring it is a one-flag change) but is not built.
    const lensesUrl = new URL('../../../../public/data/journeys/lenses.json', import.meta.url);
    if (existsSync(lensesUrl)) {
      const L = JSON.parse(readFileSync(lensesUrl, 'utf8')) as { lenses: { archetype: string }[] };
      const arch = new Set(t.templates.map((x) => (x as { archetype?: string }).archetype));
      for (const l of L.lenses) expect(arch.has(l.archetype), `lens ${l.archetype} has no active template`).toBe(true);
    }
    for (const x of t.templates) for (const to of [...(x.chainTo ?? []), ...(x.switchRule?.to ?? [])]) expect(ids).toContain(to);
  });
});

describe('A/B exporter options (owner feedback r2)', () => {
  it('--pairs N (default 12) and --round <name> (ab-<name>.json, pair ids abK-NN)', () => {
    expect(parseArgs([])).toMatchObject({ round: 'round1', pairs: 12, out: DEFAULT_OUT, show: null });
    const a = parseArgs(['--round', 'round2', '--pairs', '8']);
    expect(a.round).toBe('round2');
    expect(a.pairs).toBe(8);
    expect(a.out).toMatch(/script\/journeys\/train\/ab-round2\.json$/);
    expect(() => parseArgs(['--pairs', '0'])).toThrow();
    expect(() => parseArgs(['--round', '../x'])).toThrow();
    expect(roundPrefix('round2')).toBe('ab2');
    expect(roundPrefix('pilot')).toBe('ab-pilot');
  });

  it('--themes hand-picks the comparisons (and optionally the night); the pair count follows', () => {
    const t = parseThemes('A3:A7, A1:A9@Colorado dark site/7/new/10x50/23:30');
    expect(t).toEqual([
      { a: 'A3', b: 'A7', night: null },
      { a: 'A1', b: 'A9', night: { site: 'Colorado dark site', month: 7, phase: 'new', optic: '10x50', time: '23:30' } },
    ]);
    expect(parseThemes('A2:A5@santiago/10/waxing-crescent')[0].night).toEqual({ site: 'Santiago', month: 10, phase: 'waxing-crescent', optic: '10x50', time: 'dusk+1.5h' });
    expect(parseArgs(['--round', 'round2', '--themes', 'A3:A7,A6:A11'])).toMatchObject({ pairs: 2, themes: [{ a: 'A3', b: 'A7' }, { a: 'A6', b: 'A11' }] });
    expect(parseArgs([]).themes).toBeNull();
    for (const bad of ['A3:A3', 'A3', 'A3:A7@Mars/1/new', 'A3:A7@London/13/new', 'A3:A7@London/1/blue']) expect(() => parseThemes(bad), bad).toThrow();
    expect(() => parseArgs(['--themes', 'A3:A7', '--pairs', '3'])).toThrow();
  });

  it('N nights, all distinct up to 24; round rules scale with N and the active themes', () => {
    for (const n of [1, 6, 12, 20, 24]) {
      const sp = specsFor(n);
      expect(sp.length).toBe(n);
      expect(new Set(sp.map((x) => JSON.stringify(x))).size).toBe(n);
    }
    expect(specsFor(12).slice(0, 12)).toEqual(specsFor(24).slice(0, 12));
    expect(roundRules(12, 10)).toEqual({ pairs: 12, minThemes: 9, maxA6Pairs: 3, maxPerTheme: 4 });
    expect(roundRules(6, 10)).toEqual({ pairs: 6, minThemes: 8, maxA6Pairs: 2, maxPerTheme: 2 });
    expect(roundRules(3, 10).minThemes).toBe(5);
  });
});
