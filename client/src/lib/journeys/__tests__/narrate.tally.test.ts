/**
 * The payoff's {tally} (owner feedback r4, rule 5: the last card answers the driving question in words the reader could
 * repeat, for THIS night's pairs): verdictTally renders the visited stops' lens verdicts as flowing prose, and the
 * narrator fills {tally} from the stops the journey actually visited, never from stops it did not.
 */
import { describe, expect, it } from 'vitest';
import { generatePool } from '../assemble';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { FIXTURE_LENS_A1, FIXTURE_LENS_A2, FIXTURE_LENS_NARRATION, lensFixtureKb } from '../__fixtures__/fixture-lenses';
import { ThemeLensSchema } from '../kb-schema';
import { TALLY_MAX_CHARS, narrateJourney, narrationProblems, proseName, verdictTally } from '../narrate';
import type { ThemeLensSet } from '../types';
import { request } from './engine-helpers';
import { loadLenses } from '../../../../../script/journeys/kb/lenses';

const e = (name: string, verdict: string) => ({ name, verdict });

describe('verdictTally', () => {
  it('renders nothing for no verdict or a single one (the last card already gave it)', () => {
    expect(verdictTally([])).toBe('');
    expect(verdictTally([e('ζ Lyrae', 'a real pair')])).toBe('');
    // Stops without a verdict do not count.
    expect(verdictTally([e('ζ Lyrae', 'a real pair'), e('Vega', ''), e('Sheliak', '   ')])).toBe('');
  });

  it('two verdicts make one sentence', () => {
    expect(verdictTally([e('ζ Lyrae', 'a real pair'), e('the Double-Double', 'a family of four suns in two pairs')]))
      .toBe('Tonight ζ Lyrae turned out to be a real pair, and the Double-Double a family of four suns in two pairs.');
  });

  it('three verdicts read as one flowing sentence in visiting order', () => {
    expect(verdictTally([e('ζ Lyrae', 'a real pair'), e('δ Lyrae', 'two strangers lined up by chance'), e('the Double-Double', 'a family of four')]))
      .toBe('Tonight ζ Lyrae turned out to be a real pair, δ Lyrae two strangers lined up by chance, and the Double-Double a family of four.');
  });

  it('longer nights continue in balanced sentences ("Further on", then "And last of all")', () => {
    const four = verdictTally([e('ζ Lyrae', 'a real pair'), e('31 Cygni', 'a likely real pair with a stranger alongside'), e('16 Cygni', 'partners too slow to weigh yet'), e('the Double-Double', 'a family of four suns in two pairs')]);
    expect(four).toBe('Tonight ζ Lyrae turned out to be a real pair, and 31 Cygni a likely real pair with a stranger alongside. '
      + 'Further on, 16 Cygni emerged as partners too slow to weigh yet, and the Double-Double a family of four suns in two pairs.');
    const seven = verdictTally(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x) => e(x, `verdict ${x.toLowerCase()}`)));
    expect(seven.split(/(?<=\.)\s+/)).toEqual([
      'Tonight A turned out to be verdict a, B verdict b, and C verdict c.',
      'Further on, D emerged as verdict d, and E verdict e.',
      'And last of all F turned out to be verdict f, and G verdict g.',
    ]);
  });

  it('keeps every sentence under the validator limit by splitting further, and trims stray punctuation', () => {
    const long = 'a very long verdict that goes on and on about the pair';
    const out = verdictTally(['Albireo', 'ν Geminorum', 'Aludra', 'ω Scorpii', 'ζ Scorpii', 'α Capricorni'].map((n) => e(n, long)));
    for (const s of out.split(/(?<=[.!?])\s+/)) expect(s.length, s).toBeLessThanOrEqual(TALLY_MAX_CHARS);
    for (const n of ['Albireo', 'ν Geminorum', 'Aludra', 'ω Scorpii', 'ζ Scorpii', 'α Capricorni']) expect(out).toContain(n);
    expect(verdictTally([e('ζ Lyrae', 'a real pair.'), e('δ Lyrae', 'two strangers,')]))
      .toBe('Tonight ζ Lyrae turned out to be a real pair, and δ Lyrae two strangers.');
  });
});

describe('{tally} in the payoff', () => {
  const VERDICTS: Record<string, string> = {
    M42: 'a nursery still at work', M43: 'a second cradle in the same cloud', NGC1981: 'a family without its gas',
    'AST-OrionBelt': 'older siblings of the nebula', Cr69: 'a family in a blown ring', M45: 'a family grown up',
    'AST-Hyades': 'an older family spreading out', 'STAR-Aldebaran': 'a giant in old age', 'STAR-Betelgeuse': 'a giant near its end',
    M1: 'the wreck of a heavy star',
  };
  const withVerdicts: ThemeLensSet = {
    ...FIXTURE_LENS_A1,
    objects: Object.fromEntries(Object.entries(FIXTURE_LENS_A1.objects).map(([id, l]) => [id, { ...l, verdict: VERDICTS[id] }])),
  };
  const RULE = 'Every chapter sits in this one patch of sky.';
  const base = lensFixtureKb({ lenses: [withVerdicts, FIXTURE_LENS_A2], version: 'fixture-tally' });
  const kb = { ...base, narration: { ...base.narration, variants: { ...base.narration.variants, 'payoff.A1-cradle-to-grave': [`{tally} ${RULE}`] } } };
  const journeys = generatePool(kb, request('2027-01-15T04:30:00Z', { length: 5 })).journeys.filter((j) => j.templateId === 'A1-cradle-to-grave' && !j.switch);

  it('names every visited stop with its verdict, and no lens object the night did not visit', () => {
    expect(journeys.length).toBeGreaterThan(0);
    for (const j of journeys) {
      expect(j.stops.every((s) => s.lens?.verdict)).toBe(true); // the stop carries the lens verdict
      const nar = narrateJourney(j, kb, { seedKey: 'journeys-text-1', region: j.regionName });
      const text = nar.payoff!.text;
      expect(text.startsWith('Tonight ')).toBe(true);
      expect(text.endsWith(RULE)).toBe(true);
      const visited = new Set(j.stops.map((s) => s.objectId));
      for (const s of j.stops) expect(text, text).toContain(VERDICTS[s.objectId]);
      for (const [id, v] of Object.entries(VERDICTS)) if (!visited.has(id)) expect(text, `${id} not visited`).not.toContain(v);
      // Visiting order: each verdict appears after the one before it.
      const at = j.stops.map((s) => text.indexOf(VERDICTS[s.objectId]));
      expect(at.slice().sort((a, b) => a - b)).toEqual(at);
      const kbObj = new Map(kb.objects.map((o) => [o.id, o] as const));
      for (const s of j.stops) expect(text).toContain(proseName(kbObj.get(s.objectId)!.names.display));
      expect(narrationProblems(nar)).toEqual([]);
    }
  });

  it('renders empty without verdicts, and the payoff still reads as a whole', () => {
    const plain = { ...lensFixtureKb(), narration: kb.narration };
    for (const j of generatePool(plain, request('2027-01-15T04:30:00Z', { length: 5 })).journeys.filter((x) => x.templateId === 'A1-cradle-to-grave' && !x.switch)) {
      const nar = narrateJourney(j, plain, { seedKey: 'journeys-text-1', region: j.regionName });
      expect(nar.payoff!.text).toBe(RULE);
    }
  });

  it('lens verdicts: in the schema, ordered into the runtime set, short lower-case phrases only (lens loader)', () => {
    expect(ThemeLensSchema.safeParse({ ...FIXTURE_LENS_A1.objects.M42, verdict: 'a nursery' }).success).toBe(true);
    expect(ThemeLensSchema.safeParse({ ...FIXTURE_LENS_A1.objects.M42, verdict: '' }).success).toBe(false);
    const file = 'lenses/A1.json';
    const load = (verdict: string) => loadLenses([{ file, raw: { ...FIXTURE_LENS_A1, narration: { ...FIXTURE_LENS_NARRATION, 'payoff.A1-cradle-to-grave': ['{tally} Fine.'] }, objects: { ...FIXTURE_LENS_A1.objects, M42: { ...FIXTURE_LENS_A1.objects.M42, verdict } } } }], FIXTURE_KB.objects, FIXTURE_KB.templates, FIXTURE_KB.narration, () => true);
    const ok = load('a nursery still at work');
    expect(ok.issues).toEqual([]);
    expect(Object.keys(ok.lenses[0].set.objects.M42).slice(0, 4)).toEqual(['step', 'beat', 'verdict', 'question']);
    expect(load('a far hypergiant aligned by chance with a near giant').issues).toEqual([]); // ten words fit
    for (const bad of ['A nursery', 'a nursery, still at work', 'a nursery.', 'one two three four five six seven eight nine ten eleven']) {
      expect(load(bad).issues.join('\n'), bad).toMatch(/object M42 verdict/);
    }
  });
});
