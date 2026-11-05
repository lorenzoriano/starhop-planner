/**
 * Engine wiring (P3): default learned scorer, narration as the single text source (bare {region}), story /
 * skip / conditions fields, the one archetype switch, regenerable #/journeys/:key keys + rebuild, and the
 * worker protocol (KB display data, supersede).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate, generatePool, heuristicScorer, rebuildJourney, scorerFor } from '../assemble';
import { getConstellationName } from '../../astronomy';
import { createJourneyClient, type JourneyWorkerRequest, type JourneyWorkerResponse } from '../journey-client';
import { createJourneyHost } from '../journey-host';
import { decodeJourneyKey, encodeJourneyKey, kbHashOf } from '../journey-key';
import { JourneyResultSchema } from '../kb-schema';
import { tidyText } from '../narrate';
import { scoreJourney } from '../score';
import type { GbdtModel, Journey, JourneyResult, KnowledgeBase, Template } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { independentProblems, request, stripMs } from './engine-helpers';

const gbdt = JSON.parse(readFileSync(new URL('../__fixtures__/scorer-toy-gbdt.json', import.meta.url), 'utf8')) as GbdtModel;
const DARK = '2027-01-09T05:00:00Z'; // SF 21:00 PST, Moon down
const DOUBLED = /\b([A-Za-z]{3,})\s+\1\b/i;

/** Every user-facing text of a journey. */
function texts(j: Journey): string[] {
  return [j.title, j.drivingQuestion, j.hook, j.story ?? '', ...j.stops.flatMap((s) => [s.transitionText ?? '', s.whyHereText ?? '', s.transitionSkipText ?? '', s.getThere.bearingText])].filter(Boolean);
}

describe('default scorer', () => {
  it('uses the learned model when given one, the heuristic otherwise', () => {
    const r = generate(FIXTURE_KB, request(DARK), { model: gbdt });
    expect(r.diagnostics.scorer).toBe('gbdt');
    expect(r.modelVersion).toBe(gbdt.modelVersion);
    for (const j of r.journeys) expect(j.score).toBe(scoreJourney(j.features!, gbdt));
    const h = generate(FIXTURE_KB, request(DARK));
    expect(h.diagnostics.scorer).toBe('heuristic');
    expect(h.journeys.every((j) => j.features === undefined)).toBe(true);
    // An invalid model silently falls back to the heuristic tier.
    expect(generate(FIXTURE_KB, request(DARK), { model: { ...gbdt, features: ['x'] } }).diagnostics.scorer).toBe('heuristic');
    // An explicit scorer always wins.
    expect(scorerFor({ model: gbdt, scorer: heuristicScorer })).toBe(heuristicScorer);
  });
});

describe('narration is the single text source', () => {
  const r = generate(FIXTURE_KB, request(DARK));
  it('titles use a bare region name from the bank, never the old "· phrase" form', () => {
    expect(r.journeys.length).toBeGreaterThan(0);
    for (const j of r.journeys) {
      expect(j.regionName).toBeTruthy();
      expect(j.title).toContain(j.regionName!);
      expect(j.title).not.toMatch(/·|\{|\bhigh in\b|\blow in\b/);
      const variants = FIXTURE_KB.narration.variants[`title.${j.templateId}`].map((v) => v.replace('{region}', j.regionName!));
      expect(variants).toContain(j.title);
      expect(j.regionCenter.label).toMatch(new RegExp(`around ${j.regionName}$`));
    }
    // The region name is a real constellation name (Orion for this fixture sky).
    expect(r.journeys.map((j) => j.regionName)).toContain(getConstellationName('Ori'));
  });

  it('transitions, why-here, skip texts and story are filled with no seams', () => {
    for (const j of r.journeys) {
      j.stops.forEach((s, i) => {
        if (i === 0) expect(s.transitionText).toBeNull();
        else expect(s.transitionText).toBeTruthy();
        expect(s.whyHereText).toBeTruthy();
        if (i < j.stops.length - 1) expect(s.transitionSkipText).toBeTruthy();
        else expect(s.transitionSkipText).toBeUndefined();
      });
      const sentences = j.story!.split(/(?<=[.!?])\s+/);
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.length).toBeLessThanOrEqual(3);
      for (const t of texts(j)) {
        expect(t).not.toMatch(/\{\w+\}|undefined|NaN/);
        expect(t, t).not.toMatch(DOUBLED);
      }
    }
    expect(JourneyResultSchema.safeParse(r).success).toBe(true);
  });

  it('the fixture bank no longer doubles words around {ratioPhrase}', () => {
    const pool = generatePool(FIXTURE_KB, request('2027-01-15T04:30:00Z', { length: 6 }));
    for (const j of pool.journeys) for (const t of texts(j)) expect(t, t).not.toMatch(DOUBLED);
    expect(tidyText('about about 4 times farther farther away')).toBe('about 4 times farther away');
    expect(tidyText('He had had enough; that that works.')).toBe('He had had enough; that that works.');
  });

  it('conditions summarise the night for the strip', () => {
    for (const j of r.journeys) {
      const c = j.conditions!;
      expect(c.darkness).toBe('night');
      expect(c.moon.up).toBe(false);
      expect(c.moon.minSepDeg).toBeGreaterThanOrEqual(15);
      expect(c.glowLimits).toEqual({ diffuse: 0.7, cluster: 1.2, star: 2.5 });
      expect(c.sunLimits).toEqual({ star: -12, dso: -18 });
      expect(Date.parse(c.darkWindow.start!)).toBeLessThan(Date.parse(DARK));
      expect(Date.parse(c.darkWindow.end!)).toBeGreaterThan(Date.parse(DARK));
      expect(c.closestMoonDeg).toBeNull();
    }
    expect(r.conditions?.limitingFactors).toEqual(r.diagnostics.limitingFactors);
    // Moonlit night: the Moon block is filled.
    const moon = generate(FIXTURE_KB, request('2027-01-20T06:00:00Z'));
    expect(moon.conditions!.moon.illumination).toBeGreaterThan(0.5);
    expect(moon.conditions!.moon.minSepDeg).toBeGreaterThan(25);
  });

  it('the pool returns narrated journeys plus their narration objects', () => {
    const pool = generatePool(FIXTURE_KB, request(DARK));
    for (const j of pool.journeys) {
      expect(pool.narrations[j.key].title.text).toBe(j.title);
      expect(j.story).toBe(pool.narrations[j.key].story.text);
    }
  });
});

// ───────────────────────────── archetype switch ─────────────────────────────

/** Two small archetypes over the fixture: an Orion life story that may switch into a colour contrast. */
function switchKb(): KnowledgeBase {
  const src: Template = {
    ...FIXTURE_KB.templates[0], id: 'T-src', archetype: 'A1', title: 'Born in Orion', titleKeys: ['title.T-src'],
    slots: [
      { arc: 'hook', label: 'Nursery', match: { roles: ['nursery'], kinds: ['dso'] } },
      { arc: 'build', label: 'Young family', match: { roles: ['young-cluster', 'association'] }, repeat: [1, 2] },
      { arc: 'payoff', label: 'Doomed giant', match: { roles: ['supergiant'], kinds: ['star'] } },
    ],
    order: 'strict', swapGroups: undefined, edges: ['LIFE_NEXT', 'SIBLING', 'CAUSE'], progression: undefined,
    length: [3, 5], defaultLength: 4, ingredients: {}, chainTo: ['T-dst'],
    switchRule: { to: ['T-dst'], atArc: 'payoff', via: ['CONTRAST'], minStrength: 0.8, announceKey: 'switch.T-src' },
  };
  const dst: Template = {
    ...FIXTURE_KB.templates[1], id: 'T-dst', archetype: 'A2', title: 'Hot and Cool', titleKeys: ['title.T-dst'],
    slots: [
      { arc: 'hook', label: 'Cool star', match: { kinds: ['star'] } },
      { arc: 'build', label: 'Hot star', match: { kinds: ['star'], factRanges: { teffK: { min: 9000 } } } },
      { arc: 'coda', label: 'Look again', match: { kinds: ['star'] }, optional: true },
    ],
    order: 'strict', swapGroups: undefined, edges: ['CONTRAST', 'SAME_PHYSICS'], progression: undefined,
    length: [3, 4], defaultLength: 3, ingredients: {}, chainTo: undefined, switchRule: undefined,
  };
  return {
    ...FIXTURE_KB, version: 'fixture-switch-1', templates: [src, dst],
    narration: {
      ...FIXTURE_KB.narration,
      variants: {
        ...FIXTURE_KB.narration.variants,
        'title.T-src': ['Born in {region}'], 'title.T-dst': ['Hot and Cool in {region}'],
        'switch.T-src': ['That giant’s color is a clue. New question: {theme}.'],
      },
    },
  };
}

function switchProblems(kb: KnowledgeBase, req: ReturnType<typeof request>, res: JourneyResult, j: Journey): string[] {
  // The shared checker validates link types against the first template only; check the second theme here.
  const base = independentProblems(kb, req, res, j).filter((p) => !/link type .* not allowed|template length/.test(p));
  const sw = j.switch!;
  const src = kb.templates.find((t) => t.id === sw.fromTemplateId)!, dst = kb.templates.find((t) => t.id === sw.toTemplateId)!;
  j.stops.forEach((s, i) => {
    if (!s.link) return;
    if (i <= sw.atStop && !src.edges.includes(s.link.type)) base.push(`stop ${i}: ${s.link.type} not in ${src.id}`);
    if (i === sw.atStop + 1 && (!src.switchRule!.via.includes(s.link.type) || s.link.strength < src.switchRule!.minStrength)) base.push(`switch link ${s.link.type} ${s.link.strength}`);
    if (i > sw.atStop + 1 && !dst.edges.includes(s.link.type)) base.push(`stop ${i}: ${s.link.type} not in ${dst.id}`);
  });
  if (src.slots.find((x) => x.label === j.stops[sw.atStop].role)?.arc !== 'payoff') base.push('switch stop is not the payoff');
  return base;
}

describe('one archetype switch per journey (spec decision 6)', () => {
  const kb = switchKb();
  const req = request(DARK, { length: 5 });

  it('beam search finds switched journeys that pass every hard constraint', () => {
    const r = generate(kb, req, { explore: true });
    const switched = r.journeys.filter((j) => j.switch);
    expect(switched.length).toBeGreaterThan(0);
    for (const j of switched) {
      expect(switchProblems(kb, req, r, j)).toEqual([]);
      expect(j.switch).toMatchObject({ fromTemplateId: 'T-src', toTemplateId: 'T-dst', toTitle: 'Hot and Cool' });
      const after = j.stops[j.switch!.atStop + 1];
      expect(after.transitionText).toMatch(/^That giant’s color is a clue\. New question: Hot and Cool\. /);
      expect(after.role).toBe('Hot star');
      expect(j.story).toMatch(/second chapter, “Hot and Cool\.”/);
      // Only one switch: every stop after the first theme uses the second theme's labels.
      expect(j.stops.slice(j.switch!.atStop + 1).every((s) => ['Hot star', 'Look again'].includes(s.role))).toBe(true);
    }
    console.log(`[switch] ${switched.length}/${r.journeys.length} pool journeys switch, e.g. ${switched[0].stops.map((s) => s.objectId).join(' > ')}`);
  });

  it('switches can be turned off and never appear without a switchRule', () => {
    expect(generate(kb, req, { explore: true, switches: false }).journeys.some((j) => j.switch)).toBe(false);
    expect(generatePool(FIXTURE_KB, req).journeys.some((j) => j.switch)).toBe(false);
  });

  it('switched journeys rebuild from their key', () => {
    const j = generate(kb, req, { explore: true }).journeys.find((x) => x.switch)!;
    const rb = rebuildJourney(kb, j.key, req);
    expect(rb.valid).toBe(true);
    expect(rb.journey!.stops.map((s) => s.objectId)).toEqual(j.stops.map((s) => s.objectId));
    expect(rb.journey!.switch).toEqual(j.switch);
    expect(rb.journey!.stops.map((s) => s.transitionText)).toEqual(j.stops.map((s) => s.transitionText));
  });
});

// ───────────────────────────── keys & rebuild ─────────────────────────────

describe('regenerable journey keys', () => {
  it('encode/decode round-trips and rejects junk', () => {
    const data = {
      kbHash: kbHashOf('v1'), templateId: 'A1-cradle-to-grave', switch: { toTemplateId: 'A8-how-stars-die', at: 3 },
      stopIds: ['M42', 'NGC1981', 'AST-OrionBelt', 'STAR-Betelgeuse', 'M1~3'], slots: [0, 1, 1, 4, 1], slotMinute: 28_911_360,
      lat: 37.8, lon: -122.4, fovDeg: 6.5, aperture: 50, magnification: 10, stabilized: false, skyBrightness: 21.3,
      minAlt: 30, regionRadius: 30, minutesPerStop: 8, includeChallenge: true, centerRa: 84.79, centerDec: 3.69,
    };
    const key = encodeJourneyKey(data);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeJourneyKey(key)).toEqual({ format: 'j1', ...data });
    for (const junk of ['', 'j-0123abcd', '%%%', key.slice(0, -6), encodeURIComponent('a|b')]) expect(decodeJourneyKey(junk)).toBeNull();
    expect(() => encodeJourneyKey({ ...data, stopIds: ['a|b', 'c', 'd', 'e', 'f'] })).toThrow();
  });

  it('engine keys are stable inside the 15-minute slot and carry the plan', () => {
    const a = generate(FIXTURE_KB, request('2027-01-09T05:02:00Z'));
    const b = generate(FIXTURE_KB, request('2027-01-09T05:13:00Z'));
    expect(a.journeys.map((j) => j.key)).toEqual(b.journeys.map((j) => j.key));
    for (const j of a.journeys) {
      const d = decodeJourneyKey(j.key)!;
      expect(d.templateId).toBe(j.templateId);
      expect(d.stopIds).toEqual(j.stops.map((s) => s.objectId));
      expect(d.slotMinute * 60_000).toBe(Date.parse('2027-01-09T05:00:00Z'));
      expect([d.lat, d.lon, d.fovDeg]).toEqual([37.8, -122.4, 6.5]);
      expect(d.kbHash).toBe(kbHashOf(FIXTURE_KB.version));
    }
  });

  it('rebuildJourney regenerates the same journey and texts, and reports when conditions no longer hold', () => {
    const req = request(DARK);
    const r = generate(FIXTURE_KB, req);
    for (const j of r.journeys) {
      const rb = rebuildJourney(FIXTURE_KB, j.key, req);
      expect(rb.valid, rb.problems.join('; ')).toBe(true);
      const k = rb.journey!;
      expect(k.key).toBe(j.key);
      expect(k.stops.map((s) => s.objectId)).toEqual(j.stops.map((s) => s.objectId));
      expect([k.title, k.story, k.drivingQuestion, k.hook]).toEqual([j.title, j.story, j.drivingQuestion, j.hook]);
      expect(k.stops.map((s) => [s.role, s.transitionText, s.whyHereText, s.transitionSkipText])).toEqual(j.stops.map((s) => [s.role, s.transitionText, s.whyHereText, s.transitionSkipText]));
      expect(k.stops.map((s) => s.windowStart)).toEqual(j.stops.map((s) => s.windowStart));
    }
    // The same journey opened the next morning: re-validated at that time, it no longer fits.
    const j = r.journeys[0];
    const later = rebuildJourney(FIXTURE_KB, j.key, req, { instant: '2027-01-09T16:00:00Z' });
    expect(later.valid).toBe(false);
    expect(later.problems.length).toBeGreaterThan(0);
    expect(later.codes.some((c) => c === 'twilight' || c === 'altitude')).toBe(true);
    expect(later.journey!.conditions!.limitingFactors.length).toBeGreaterThan(0);
    // Opened on another night (request outside the key's slot): rebuilt as planned, not at the request time.
    const elsewhere = rebuildJourney(FIXTURE_KB, j.key, request('2027-03-01T05:00:00Z'));
    expect(elsewhere.journey!.stops[0].windowStart).toBe('2027-01-09T05:00:00.000Z');
  });

  it('rebuild reports bad keys and missing objects', () => {
    expect(rebuildJourney(FIXTURE_KB, 'nonsense', request(DARK))).toMatchObject({ journey: null, valid: false });
    const j = generate(FIXTURE_KB, request(DARK)).journeys[0];
    const d = decodeJourneyKey(j.key)!;
    const { format: _f, ...rest } = d;
    const gone = encodeJourneyKey({ ...rest, stopIds: [...d.stopIds.slice(0, -1), 'NOT-THERE'] });
    const res = rebuildJourney(FIXTURE_KB, gone, request(DARK));
    expect(res.journey).toBeNull();
    expect(res.problems[0]).toMatch(/NOT-THERE/);
  });
});

// ───────────────────────────── worker protocol ─────────────────────────────

describe('journey client: KB display data', () => {
  const loadData = async () => ({ kb: FIXTURE_KB, model: null });

  it('in-thread: loadKb returns the engine copy once', async () => {
    const client = createJourneyClient({ inThread: true, loadData });
    const kb = await client.loadKb();
    expect(kb).toBe(FIXTURE_KB);
    expect(await client.loadKb()).toBe(kb);
    expect((await client.generate(request(DARK))).journeys.length).toBeGreaterThan(0);
    client.dispose();
  });

  it('worker: a kb message survives a superseded generate', async () => {
    const made: { terminated: boolean }[] = [];
    const create = () => {
      const host = createJourneyHost({ loadData: async () => ({ kb: FIXTURE_KB, model: null }) });
      const w = {
        terminated: false,
        onmessage: null as ((e: MessageEvent<JourneyWorkerResponse>) => void) | null,
        onerror: null,
        postMessage(msg: JourneyWorkerRequest) {
          setTimeout(() => {
            if (w.terminated) return;
            host.handle(msg).then((value) => { if (!w.terminated) w.onmessage?.({ data: { id: msg.id, value } } as MessageEvent<JourneyWorkerResponse>); });
          }, 5);
        },
        terminate() { w.terminated = true; },
      };
      made.push(w);
      return w as unknown as Worker;
    };
    const client = createJourneyClient({ createWorker: create, base: 'http://localhost/' });
    const first = client.generate(request(DARK));
    const kb = client.loadKb();
    const second = client.generate(request(DARK, { shuffle: 1 }));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect((await kb).version).toBe(FIXTURE_KB.version);
    const res = await second;
    expect(made).toHaveLength(2);
    expect(stripMs(await client.generate(request(DARK, { shuffle: 1 })))).toEqual(stripMs(res));
    client.dispose();
  });
});
