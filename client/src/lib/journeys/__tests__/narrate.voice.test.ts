/**
 * House voice (docs/sky-journeys/voice.md, owner brief r1: an author at the eyepiece, not a headline writer) on
 * narrated journeys rendered with the SOURCE bank (client/public/data/journeys/src/narration.json, merged over the
 * fixture's edge texts): no meta-talk or teasers, the driving question is never repeated in a why-here line (the UI
 * shows it), the answer appears once (Journey.payoff), no sentence repeats across the boxes of a journey, at most
 * one bridge, plain kinds, and titles that do not all follow one formula.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { NarrationBankSchema } from '../kb-schema';
import { MAX_BRIDGES, allLines, applyNarration, narrateJourney, narrationProblems, tidyText } from '../narrate';
import { mulberry32 } from '../seed';
import { TemplatesJsonFileSchema } from '../kb-schema';
import type { ArcRole, Edge, Journey, JourneyStop, KnowledgeBase, NarrationBank, Template } from '../types';
import { BANNED } from './voice-rules';

const SRC = resolve(__dirname, '../../../../public/data/journeys/src/narration.json');
const src = NarrationBankSchema.parse(JSON.parse(readFileSync(SRC, 'utf8'))) as NarrationBank;
const KB: KnowledgeBase = { ...FIXTURE_KB, narration: { ...src, variants: { ...FIXTURE_KB.narration.variants, ...src.variants } } };

/** Phrases the owner called out, and their cousins: meta-talk, teasers, clickbait, stats lines in the prose. */
export { BANNED };

const TEMPLATES: Template[] = TemplatesJsonFileSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../../../public/data/journeys/src/templates.json'), 'utf8'))).templates as Template[];

/**
 * The shape of a title, independent of its words (owner r1: "Same Sky, Different Stories: X" everywhere reads like
 * headlines). Region placement and punctuation are what make a run of titles feel formulaic.
 */
export function titlePattern(title: string, region: string): string {
  const t = title.replace(new RegExp(region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'R');
  if (t.includes('?')) return 'question';
  if (t.includes(':')) return 'colon';
  if (/^R['’](s\b|\s)/.test(t)) return 'possessive';
  if (t.startsWith('R')) return 'region-first';
  if (t.endsWith('R')) return 'region-last';
  return 'region-middle';
}

/** Sentences of a text (for the no-repeat check); short fragments are ignored. */
const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 6);

const ARCS: ArcRole[] = ['build', 'build', 'twist', 'build'];
const TYPES: [Edge['type'], string][] = [
  ['LIFE_NEXT', 'stage-2-3'], ['CAUSE', 'ionizes'], ['SIBLING', 'same-context'], ['CONTRAST', 'teffK'], ['CONTRAST', 'x'],
  ['SAME_FAMILY', 'open-cluster'], ['SCALE', 'distanceLy-up'], ['TIME_MACHINE', 'farther'], ['SAME_PHYSICS', 'shared-concept'],
  ['LINE_OF_SIGHT', 'line-of-sight'], ['NEIGHBOR', 'within-300-ly'],
];

function journey(seed: number, withCoda = false): Journey {
  const rng = mulberry32(seed);
  const ids = FIXTURE_KB.objects.map((o) => o.id);
  const n = 4 + Math.floor(rng() * 3);
  const picked: string[] = [];
  while (picked.length < n) { const id = ids[Math.floor(rng() * ids.length)]; if (!picked.includes(id)) picked.push(id); }
  const stops: JourneyStop[] = picked.map((id, i) => {
    const [type, subtype] = TYPES[Math.floor(rng() * TYPES.length)];
    const arc: ArcRole = i === 0 ? 'hook' : i === n - 1 ? (withCoda ? 'coda' : 'payoff') : withCoda && i === n - 2 ? 'payoff' : ARCS[Math.floor(rng() * ARCS.length)];
    return {
      index: i, objectId: id, role: arc, arc,
      link: i === 0 ? null : { from: picked[i - 1], type, subtype, strength: 0.6, reasonKey: type, curated: false },
      windowStart: new Date(Date.UTC(2027, 0, 15, 4, 30 + 8 * i)).toISOString(), windowEnd: new Date(Date.UTC(2027, 0, 15, 4, 38 + 8 * i)).toISOString(),
      altAtStart: 45, azAtStart: 150, moonSepDeg: null, challenge: false, transitionText: null,
      getThere: { mode: 'sweep', fields: 1, distanceDeg: 6.5, bearingText: 'Sweep up.' },
    };
  });
  return {
    key: `voice-${seed}`, templateId: FIXTURE_KB.templates[seed % 2].id, title: 'x', drivingQuestion: 'x', hook: 'x', stops,
    regionCenter: { ra: 85, dec: 5, altDeg: 50, azDeg: 150, label: 'Orion' }, regionRadius: 30, totalPathDeg: 30, durationMin: 8 * n,
    difficulty: 'easy', score: 0,
  };
}

describe('source bank voice', () => {
  it('has no meta-talk or filler variants', () => {
    for (const [k, vs] of Object.entries(src.variants)) for (const v of vs) expect(v, k).not.toMatch(BANNED);
  });

  it('never repeats the driving question in a why-here line, and never answers yes/no in a payoff', () => {
    for (const [k, vs] of Object.entries(src.variants)) {
      if (k.startsWith('why.')) for (const v of vs) expect(v, `${k}: ${v}`).not.toContain('{question}');
      if (k.startsWith('payoff.')) for (const v of vs) expect(v, `${k}: ${v}`).not.toMatch(/^(Yes|No)\b|\?/);
      // The overview is prose: the UI states the stop count and the minutes.
      if (k.startsWith('story')) for (const v of vs) expect(v, `${k}: ${v}`).not.toMatch(/\{(count|minutes)\}|\d/);
    }
    expect(src.variants['bridge.prereq']).toEqual(['{bridge}']);
  });
});

describe('narrated journeys keep the voice', () => {
  it('300 journeys: no repeated question, the answer once, no repeated sentence, ≤1 bridge, no filler, no seams', () => {
    for (let s = 1; s <= 300; s++) {
      const j = journey(s, s % 3 === 0);
      const nar = narrateJourney(j, KB, { seedKey: `v${s}`, region: 'Orion' });
      expect(narrationProblems(nar, KB), `seed ${s}`).toEqual([]);
      for (const l of allLines(nar)) {
        expect(l.text, `${s} ${l.key}`).not.toMatch(BANNED);
        expect(l.text, `${s} ${l.key}`).not.toMatch(/\b(\w{3,}) \1\b|\s[,.]|,,|\.\./);
      }
      // The question is shown by the UI (overview, first card); the answer only in Journey.payoff.
      const q = nar.drivingQuestion.text;
      for (const st of nar.stops) expect(st.whyHere.text, `${s}: ${st.whyHere.text}`).not.toContain(q);
      const payoffIdx = j.stops.map((x) => x.arc).lastIndexOf('payoff');
      expect(nar.payoff, `seed ${s}`).not.toBeNull();
      if (nar.payoff && payoffIdx > 0) {
        const why = nar.stops[payoffIdx].whyHere.text;
        expect(why, `${s}: ${why}`).not.toContain(nar.payoff.text);
      }
      expect(nar.story.text, `${s}`).not.toContain(nar.hook.text);
      // No sentence appears in two boxes of one journey (skip texts are alternates, compare lines a detail).
      const shown = [nar.title, nar.drivingQuestion, nar.hook, nar.story, ...(nar.payoff ? [nar.payoff] : []), ...(nar.coda ? [nar.coda] : []),
        ...nar.stops.flatMap((x) => [x.whyHere, ...(x.bridge ? [x.bridge] : []), ...(x.transition ? [x.transition] : [])])];
      const seen = new Map<string, string>();
      for (const l of shown) for (const sen of sentencesOf(l.text)) {
        expect(seen.get(sen), `${s}: "${sen}" in ${l.key} and ${seen.get(sen)}`).toBeUndefined();
        seen.set(sen, l.key);
      }
      expect(nar.stops.filter((x) => x.bridge).length).toBeLessThanOrEqual(MAX_BRIDGES);
      expect(nar.stops[0].bridge).toBeNull();
      // Sentence-initial names are capitalized ("The Pleiades …").
      for (const l of allLines(nar)) expect(l.text, l.text).not.toMatch(/^the\s|[.!?]\s+the\s/);
      const applied = applyNarration(j, nar);
      expect(applied.stops[0].whyHereText).toBe(nar.stops[0].whyHere.text);
    }
  });

  it('500 journeys over all 12 templates: no title pattern covers more than a quarter of the titles', () => {
    const regions = ['Orion', 'Perseus', 'Cygnus', 'Ursa Major', 'Cassiopeia', 'Boötes', 'Carina', 'Scorpius', 'the Summer Triangle', 'Canis Major'];
    const counts = new Map<string, number>();
    const titles = new Map<string, number>();
    const N = 500;
    for (let s = 1; s <= N; s++) {
      const j = { ...journey(s), key: `title-${s}`, templateId: TEMPLATES[(s * 7) % TEMPLATES.length].id };
      const region = regions[(s * 3) % regions.length];
      const t = narrateJourney(j, KB, { seedKey: `t${s}`, region }).title;
      expect(t.key, t.text).toBe(`title.${j.templateId}`);
      expect(t.text.toLowerCase(), t.text).toContain(region.toLowerCase());
      expect(t.text, t.text).not.toMatch(/s['’]s\b/); // "Perseus' Ladder", never "Perseus's".
      const p = titlePattern(t.text, region);
      counts.set(p, (counts.get(p) ?? 0) + 1);
      const shape = t.text.replace(new RegExp(region, 'i'), 'R');
      titles.set(shape, (titles.get(shape) ?? 0) + 1);
    }
    for (const [p, c] of Array.from(counts)) expect(c / N, `${p}: ${c}/${N}`).toBeLessThanOrEqual(0.25);
    expect(counts.size).toBeGreaterThanOrEqual(5);
    // No single title wording dominates either, and the old colon formula is gone.
    for (const [shape, c] of Array.from(titles)) expect(c / N, shape).toBeLessThanOrEqual(0.05);
    expect(Array.from(titles.keys()).some((x) => /Same Sky, Different Stories/.test(x))).toBe(false);
  });

  it('uses the curated card line for middle stops instead of generic bank lines', () => {
    const j = journey(11);
    const nar = narrateJourney(j, KB, { seedKey: 'c' });
    j.stops.forEach((st, i) => {
      if (i === 0 || st.arc === 'payoff') return;
      const o = KB.objects.find((x) => x.id === st.objectId)!;
      if (o.card.whyHere.trim()) expect(nar.stops[i].whyHere.key, st.objectId).toBe('card:whyHere');
    });
  });

  it('names the plain kinds in transitions that have no sourced number', () => {
    let named = 0;
    for (let s = 1; s <= 120; s++) {
      const nar = narrateJourney(journey(s), KB, { seedKey: `k${s}` });
      for (const st of nar.stops) if (st.transition && /\b(an?|the) [a-z-]+ (giant|supergiant|hypergiant|star|dwarf|cluster|cloud|nebula|galaxy|remnant)\b/.test(st.transition.text)) named++;
    }
    expect(named).toBeGreaterThan(20);
  });

  it('a temperature progression compares sourced temperatures even on a derived shared-idea link', () => {
    const j = journey(5);
    j.templateId = 'A2-thermometer';
    j.stops = j.stops.slice(0, 2);
    j.stops[0] = { ...j.stops[0], objectId: 'STAR-Betelgeuse' };
    j.stops[1] = { ...j.stops[1], objectId: 'HR1713', arc: 'build', link: { from: 'STAR-Betelgeuse', type: 'SAME_PHYSICS', subtype: 'shared-concept', strength: 0.5, reasonKey: 'SAME_PHYSICS', curated: false } };
    const t = narrateJourney(j, KB, { seedKey: 't' }).stops[1].transition!;
    expect(t.key).toBe('SAME_PHYSICS.teffK');
    expect(t.numbers.map((x) => x.fact)).toEqual(['teffK', 'teffK']);
  });

  it('an undirected curated edge walked backwards keeps its stops in the authored roles', () => {
    const j = journey(3);
    j.stops = j.stops.slice(0, 2);
    j.stops[0] = { ...j.stops[0], objectId: 'M35' };
    j.stops[1] = { ...j.stops[1], objectId: 'M45', arc: 'build', link: { from: 'M35', type: 'CONTRAST', subtype: 'same-age-different-distance', strength: 0.75, reasonKey: 'edge.M45>M35', curated: true } };
    const t = narrateJourney(j, KB, { seedKey: 'r' }).stops[1].transition!;
    expect(t.key).toBe('edge.M45>M35');
    // Authored "{next} is about the same age as {prev} but {ratioPhrase}": M35 is the farther one.
    expect(t.text).toMatch(/^M35 is about the same age as the Pleiades but about \d+ times farther/);
    expect(t.numbers.map((x) => x.objectId).sort()).toEqual(['M35', 'M45']);
  });

  it('tidyText repairs unit seams and sentence-initial articles', () => {
    expect(tidyText('Antares gives out about 45,000 times the Sun\'s light of the Sun\'s light.')).toBe('Antares gives out about 45,000 times the Sun\'s light.');
    expect(tidyText('the Hyades are old. the Pleiades are young.')).toBe('The Hyades are old. The Pleiades are young.');
  });
});
