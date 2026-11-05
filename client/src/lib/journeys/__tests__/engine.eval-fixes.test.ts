/**
 * Regression tests for the engine bugs found in the P4 engine evaluation on the real KB
 * (docs/sky-journeys/engine-eval.md, script/journeys/eval/run-grid.ts). Each block names the bug it pins down.
 */
import { describe, expect, it } from 'vitest';
import { moonState, scatteredMoonlight } from '../../moon';
import { generate, selectWithShuffle } from '../assemble';
import {
  DEPTH_CONTRAST_MAX_SEP_DEG, FATE_REASON_KEY, challengePayoffAllowed, compileTemplate, ingredientsMet, payoffStopOk, prepareKb,
  slotAccepts, slotLink, slotMatches, superlativeStem, templateNightBlock, themeLinkOk,
} from '../candidates';
import { GLOW_REFERENCE_SKY, fadingFloor, moonGlow } from '../conditions';
import { isDownStep, narrateJourney } from '../narrate';
import { selectTemplates } from '../search';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { independentProblems, request } from './engine-helpers';
import type { Edge, KbObject, KnowledgeBase, StarObject, Template } from '../types';

const DARK = '2027-01-09T05:00:00Z'; // SF 21:00 PST, Moon down
const byId = (id: string) => FIXTURE_KB.objects.find((o) => o.id === id)!;
const clone = <T>(x: T): T => structuredClone(x);
const star = (id: string, patch: Partial<StarObject>): StarObject => ({ ...(clone(byId(id)) as StarObject), ...patch });
const kbWith = (patch: Partial<KnowledgeBase>, version: string): KnowledgeBase => ({ ...FIXTURE_KB, ...patch, version });
const derivedEdge = (type: Edge['type'], subtype: string, factRefs?: Edge['factRefs']): Edge =>
  ({ from: 'a', to: 'b', type, subtype, strength: 0.8, reasonKey: type, curated: false, ...(factRefs ? { factRefs } : {}) });

describe('slot clauses the engine used to ignore', () => {
  const none = new Set<string>();
  it('variabilityClasses and hasHistoryHook are honoured', () => {
    const eclipsing = star('STAR-Betelgeuse', { variability: { class: 'eclipsing-algol', gcvsType: 'EA', vMax: 2, vMin: 3, binocularVisibleAtMin: true, volatile: false, sourceId: 'gcvs' } });
    const semireg = byId('STAR-Betelgeuse');
    expect(slotMatches(eclipsing, { variabilityClasses: ['eclipsing-algol'] }, none)).toBe(true);
    expect(slotMatches(semireg, { variabilityClasses: ['eclipsing-algol'] }, none)).toBe(false);
    expect(slotMatches(byId('M42'), { variabilityClasses: ['eclipsing-algol'] }, none)).toBe(false);
    expect(slotMatches(semireg, { hasHistoryHook: true }, none)).toBe(true);
    expect(slotMatches({ ...clone(semireg), historyHook: undefined } as KbObject, { hasHistoryHook: true }, none)).toBe(false);
  });

  it('superlative tags match on their stem (template "-in-view" / "-star" forms vs curated tags)', () => {
    expect(superlativeStem('most-luminous-in-view')).toBe('most-luminous');
    expect(superlativeStem('hottest-star-in-view')).toBe('hottest');
    expect(superlativeStem('fastest-moving')).toBe(superlativeStem('fastest-spinner'));
    const lum = star('STAR-Betelgeuse', { superlatives: [{ claim: 'x', scope: 'y', sourceId: 'joyce2020', tag: 'most-luminous' }] });
    expect(slotMatches(lum, { superlativeTags: ['most-luminous-in-view'] }, none)).toBe(true);
    expect(slotMatches(lum, { superlativeTags: ['farthest'] }, none)).toBe(false);
  });

  it('TemplateSlot.inEdges restricts the link that may arrive at a slot', () => {
    const t: Template = { ...FIXTURE_KB.templates[0], id: 'T-in', slots: FIXTURE_KB.templates[0].slots.map((s, j) => (j === 1 ? { ...s, inEdges: ['SIBLING'] } : s)) };
    const prep = prepareKb(kbWith({ templates: [t] }, 'eval-inedges'));
    const ct = prep.templates[0];
    const m42 = prep.index.get('M42')!, ngc1981 = prep.index.get('NGC1981')!;
    // The only curated M42 → NGC 1981 link is LIFE_NEXT; slot 1 now only accepts SIBLING.
    expect(prep.graph.best(m42, ngc1981, ct.allowed)?.type).toBe('LIFE_NEXT');
    expect(slotLink(prep, ct, 0, 1, m42, ngc1981)?.type ?? null).not.toBe('LIFE_NEXT');
    expect(ct.slotAllowed[1]).toEqual(new Set(['SIBLING']));
  });

  it('ingredients count superlatives and history hooks', () => {
    const prep = prepareKb(FIXTURE_KB);
    const ids = ['STAR-Betelgeuse', 'M42', 'M45'].map((x) => prep.index.get(x)!);
    const withSup = ids.filter((i) => prep.objects[i].superlatives.length).length;
    expect(ingredientsMet(prep, ids, { minSuperlatives: withSup })).toBe(true);
    expect(ingredientsMet(prep, ids, { minSuperlatives: withSup + 1 })).toBe(false);
    const hooks = ids.filter((i) => prep.objects[i].historyHook).length;
    expect(ingredientsMet(prep, ids, { minHistoryHooks: hooks + 1 })).toBe(false);
  });
});

describe('night gates (dark sky, Moon limits) select archetypes', () => {
  const base = FIXTURE_KB.templates[1];
  it('templateNightBlock and selectTemplates honour minSky / maxMoon / minMoon', () => {
    expect(templateNightBlock({ ...base, ingredients: { maxMoonIllumination: 0.4 } }, 21, 0.8)).toBe('moon-bright');
    expect(templateNightBlock({ ...base, ingredients: { maxMoonIllumination: 0.4 } }, 21, 0)).toBeNull();
    expect(templateNightBlock({ ...base, ingredients: { minMoonIllumination: 0.6 } }, 21, 0.3)).toBe('moon-faint');
    expect(templateNightBlock({ ...base, ingredients: { minSkyBrightness: 20 } }, 19, 0)).toBe('dark-sky');
    expect(templateNightBlock({ ...base, needsDark: true }, 19.5, 0)).toBe('dark-sky');
    const moonlit: Template = { ...base, id: 'T-moonlit', ingredients: { ...base.ingredients, minMoonIllumination: 0.6 } };
    const prep = prepareKb(kbWith({ templates: [...FIXTURE_KB.templates, moonlit] }, 'eval-gates'));
    expect(selectTemplates(prep, null, 21, 0).map((c) => c.t.id)).not.toContain('T-moonlit');
    expect(selectTemplates(prep, null, 21, 0.9).map((c) => c.t.id)).toContain('T-moonlit');
  });

  it('a forced theme that cannot run explains why instead of blaming the altitude', () => {
    const dark: Template = { ...FIXTURE_KB.templates[0], id: 'T-dark', needsDark: true };
    const kb = kbWith({ templates: [dark, FIXTURE_KB.templates[1]], narration: { ...FIXTURE_KB.narration, variants: { ...FIXTURE_KB.narration.variants, 'title.T-dark': ['Dark {region}'] } } }, 'eval-dark');
    const r = generate(kb, request(DARK, { theme: 'T-dark', skyBrightness: 19 }));
    expect(r.journeys).toEqual([]);
    expect(r.diagnostics.message).toMatch(/needs a dark sky/);
    expect(r.diagnostics.message).not.toMatch(/lower than 30/);
    expect(generate(kb, request(DARK, { theme: 'no-such-theme' })).diagnostics.message).toMatch(/no journey theme called/);
  });
});

describe('on-theme links (themeLinkOk)', () => {
  const ladder = compileTemplate({ ...FIXTURE_KB.templates[1], id: 'T-far', progression: { property: 'distanceLy', direction: 'up' } });
  const life = compileTemplate(FIXTURE_KB.templates[0]);
  const near = star('STAR-Aldebaran', { facts: { ...byId('STAR-Aldebaran').facts, distanceLy: { value: 65, unit: 'ly', sourceId: 'x', method: 'catalog' } } });
  const far = star('STAR-Betelgeuse', { facts: { ...byId('STAR-Betelgeuse').facts, distanceLy: { value: 548, unit: 'ly', sourceId: 'x', method: 'catalog' } } });
  it('a distance ladder steps by distance and only outward, even into a coda (owner feedback round 1)', () => {
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('SCALE', 'radiusRsun-up'), near, far)).toBe(false);
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('SCALE', 'distanceLy-up'), near, far)).toBe(true);
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('SCALE', 'distanceLy-down'), far, near)).toBe(false);
    // "It should have been of increasing distances, not having the last one be closer": no "back home" coda.
    expect(themeLinkOk(ladder, 'build', 'coda', derivedEdge('SCALE', 'distanceLy-down'), far, near)).toBe(false);
    // Out of the hook only when the hook is a Milky Way scene (A11's star cloud), not an ordinary rung.
    expect(themeLinkOk(ladder, 'hook', 'build', derivedEdge('SCALE', 'distanceLy-down'), far, near)).toBe(false);
    const cloud = { ...clone(byId('M42')), dsoClass: 'star-cloud', facts: { ...byId('M42').facts, distanceLy: { value: 10000, unit: 'ly', sourceId: 'x', method: 'catalog' } } } as KbObject;
    expect(themeLinkOk(ladder, 'hook', 'build', derivedEdge('SCALE', 'distanceLy-down'), cloud, near)).toBe(true);
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('CONTRAST', 'lumLsun'), near, far)).toBe(false);
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('SIBLING', 'same-context'), near, far)).toBe(true);
    // Every link type climbs on a ladder, into a twist too (the twist is a rung).
    expect(themeLinkOk(ladder, 'build', 'build', derivedEdge('SIBLING', 'same-context'), far, near)).toBe(false);
    const contrast = { ...derivedEdge('CONTRAST', 'lum-vs-app', [{ objectId: 'x', fact: 'distanceLy' }]), curated: true };
    expect(themeLinkOk(ladder, 'build', 'build', contrast, far, near)).toBe(false);
    expect(themeLinkOk(ladder, 'build', 'twist', contrast, far, near)).toBe(false);
    expect(themeLinkOk(ladder, 'build', 'build', contrast, near, far)).toBe(true);
  });
  it('life-story archetypes keep curated links but drop derived distance-only contrasts', () => {
    expect(themeLinkOk(life, 'build', 'build', derivedEdge('CONTRAST', 'distanceLy'), near, far)).toBe(false);
    expect(themeLinkOk(life, 'build', 'build', derivedEdge('CONTRAST', 'ageMyr'), near, far)).toBe(true);
    expect(themeLinkOk(life, 'build', 'build', { ...derivedEdge('CONTRAST', 'same-stage-different-mass'), curated: true }, near, far)).toBe(true);
  });
  it('a derived SAME_PHYSICS link must share one of the archetype\'s core concepts', () => {
    const thermo = compileTemplate(FIXTURE_KB.templates[1]); // core: LIGHT.color-temp, PERC.night-eyes, STAR.size
    const sp = derivedEdge('SAME_PHYSICS', 'shared-concept');
    const a = byId('STAR-Betelgeuse'), b = byId('HR1713');
    expect(themeLinkOk(thermo, 'build', 'build', sp, a, b, new Set(['LIGHT.color-temp']), new Set(['LIGHT.color-temp']))).toBe(true);
    expect(themeLinkOk(thermo, 'build', 'build', sp, a, b, new Set(['MW.families']), new Set(['MW.families']))).toBe(false);
    expect(themeLinkOk(thermo, 'build', 'build', { ...sp, curated: true }, a, b, new Set(['MW.families']), new Set(['MW.families']))).toBe(true);
  });
  it('colour archetypes only use stars bright enough to show colour', () => {
    const thermo = compileTemplate(FIXTURE_KB.templates[1]);
    const concepts = new Set<string>();
    const j = thermo.t.slots.findIndex((s) => s.label === 'Hottest star');
    const hot = star('HR1713', {});
    expect(slotAccepts(thermo, j, hot, concepts)).toBe(true);
    expect(slotAccepts(thermo, j, { ...hot, mag: 8.9 }, concepts)).toBe(false);
  });
});

describe('payoffs a lecturer would veto', () => {
  it('no challenge payoff unless the slot asks for a hard one; naked-eye star payoffs', () => {
    expect(challengePayoffAllowed({ arc: 'payoff', match: { maxObsDifficulty: 3 } })).toBe(false);
    expect(challengePayoffAllowed({ arc: 'payoff', match: {} })).toBe(false);
    expect(challengePayoffAllowed({ arc: 'payoff', match: { maxObsDifficulty: 4 } })).toBe(true);
    expect(challengePayoffAllowed({ arc: 'build', match: {} })).toBe(true);
    const faint = star('HR1713', { mag: 7.5 });
    expect(payoffStopOk({ arc: 'payoff', match: {} }, faint)).toBe(false);
    expect(payoffStopOk({ arc: 'payoff', match: { maxObsDifficulty: 4 } }, faint)).toBe(true);
    expect(payoffStopOk({ arc: 'build', match: {} }, faint)).toBe(true);
  });
  it('variables that fade out of binocular reach are at best the one challenge stop', () => {
    const mira = star('STAR-Betelgeuse', { variability: { class: 'mira', gcvsType: 'M', vMax: 2, vMin: 10.1, binocularVisibleAtMin: false, volatile: true, sourceId: 'gcvs' } });
    expect(fadingFloor(mira)).toBe(2);
    expect(fadingFloor(byId('STAR-Betelgeuse'))).toBe(0);
  });
});

describe('duplicate-ish stops (StoryGraph.pairOk)', () => {
  const prep = prepareKb(FIXTURE_KB);
  const ix = (id: string) => prep.index.get(id)!;
  it('one sight never counts twice; a shared view needs a curated comparison', () => {
    expect(prep.graph.pairOk(ix('HR1895'), ix('M42'))).toBe(false); // the Trapezium inside the Orion Nebula: one sight
    expect(prep.graph.pairOk(ix('M42'), ix('M43'))).toBe(false); // same view, linked only as siblings
    expect(prep.graph.pairOk(ix('M35'), ix('NGC2158'))).toBe(true); // same view, the line-of-sight lesson
    expect(prep.graph.pairOk(ix('STAR-Aldebaran'), ix('AST-Hyades'))).toBe(true); // foreground star, curated LINE_OF_SIGHT
    expect(prep.graph.pairOk(ix('STAR-Betelgeuse'), ix('HR1713'))).toBe(true); // far apart
  });
  it('a star well inside a cluster\'s extent shares its view even beyond 1°', () => {
    // A member star 1.5° from the Hyades centre (extent 330′), joined only by a curated SIBLING edge.
    const member = star('HR1713', { id: 'MEMBER-test', ra: 66.75 + 1.5 / Math.cos((15.867 * Math.PI) / 180), dec: 15.86667 });
    const sib: Edge = { from: 'MEMBER-test', to: 'AST-Hyades', type: 'SIBLING', subtype: 'cluster-member', strength: 0.9, reasonKey: 'SIBLING', curated: true, directed: false };
    const kb = kbWith({ objects: [...FIXTURE_KB.objects, member], edges: [...FIXTURE_KB.edges, sib] }, 'eval-inside');
    const p = prepareKb(kb);
    const d = p.sepDeg(p.index.get('MEMBER-test')!, p.index.get('AST-Hyades')!);
    expect(d).toBeGreaterThan(1);
    expect(p.graph.pairOk(p.index.get('MEMBER-test')!, p.index.get('AST-Hyades')!)).toBe(false);
  });
  it('no returned journey has two stops in one view without a curated comparison', () => {
    for (const instant of [DARK, '2027-02-10T04:00:00Z', '2026-12-01T07:00:00Z']) {
      for (const j of generate(FIXTURE_KB, request(instant), { explore: true }).journeys) {
        const ids = j.stops.map((s) => ix(s.objectId));
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) expect(prep.graph.pairOk(ids[a], ids[b]), `${j.key}`).toBe(true);
      }
    }
  });
});

describe('derived edges', () => {
  it('distance contrasts ("they look like neighbours") only within one patch of sky', () => {
    const prep = prepareKb(FIXTURE_KB);
    const n = prep.objects.length;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const d = prep.graph.derivedEdges(a, b).find((e) => e.type === 'CONTRAST' && e.subtype === 'distanceLy');
      if (d) expect(prep.sepDeg(a, b)).toBeLessThanOrEqual(DEPTH_CONTRAST_MAX_SEP_DEG);
    }
  });
  it('mass decides the fate: planetary nebula / white dwarf vs supergiant or supernova remnant', () => {
    const pn = { ...clone(byId('M1')), id: 'PN-test', dsoClass: 'planetary-nebula', roles: ['pn', 'wd'], evoStage: 6 } as KbObject;
    const kb = kbWith({ objects: [...FIXTURE_KB.objects, pn] }, 'eval-fate');
    const prep = prepareKb(kb);
    const fate = prep.graph.derivedEdges(prep.index.get('PN-test')!, prep.index.get('STAR-Betelgeuse')!).find((e) => e.reasonKey === FATE_REASON_KEY);
    expect(fate).toMatchObject({ type: 'CONTRAST', subtype: 'massMsun-fate', directed: false });
    expect(themeLinkOk(compileTemplate(FIXTURE_KB.templates[0]), 'build', 'build', fate!, pn, byId('STAR-Betelgeuse'))).toBe(true);
  });
});

describe('moonlight is measured against a reference sky', () => {
  it('a dark site is not penalised for being dark', () => {
    const at = new Date('2027-01-22T07:00:00Z'); // full Moon over SF
    const moon = moonState(37.77, -122.42, at);
    expect(moonGlow(moon, 50, 60, 21.5)).toBeCloseTo(moonGlow(moon, 50, 60, GLOW_REFERENCE_SKY), 9);
    expect(moonGlow(moon, 50, 60, 21.5)).toBeLessThan(scatteredMoonlight(moon, 50, 60, 21.5).brightening);
    expect(moonGlow(moon, 50, 60, 19)).toBeCloseTo(scatteredMoonlight(moon, 50, 60, 19).brightening, 9);
    // The full-Moon night that emptied the dark site keeps journeys there.
    const res = generate(FIXTURE_KB, request('2027-01-22T07:00:00Z', { skyBrightness: 21.5 }));
    const city = generate(FIXTURE_KB, request('2027-01-22T07:00:00Z', { skyBrightness: 19 }));
    expect(res.journeys.length).toBeGreaterThanOrEqual(Math.min(1, city.journeys.length));
    for (const j of res.journeys) expect(independentProblems(FIXTURE_KB, request('2027-01-22T07:00:00Z', { skyBrightness: 21.5 }), res, j)).toEqual([]);
  });
});

describe('three suggestions are three stories', () => {
  const mk = (key: string, score: number, ids: string[], templateId: string, patch = 'P0') => ({
    journey: { key, score, templateId } as never, ids, ident: key, patch: { id: patch } as never, plan: {} as never, h: score, s: {} as never, tier: 0,
  });
  it('same archetype only as a last resort; two shared stops never (owner feedback round 1)', () => {
    const pool = [mk('a', 1, ['x', 'y', 'z', 'q'], 'T'), mk('b', 0.98, ['p', 'r', 's', 't'], 'T'), mk('c', 0.5, ['x', 'y', 'm', 'n'], 'U'), mk('d', 0.4, ['e', 'f', 'g', 'h'], 'V')];
    expect(selectWithShuffle(pool, 2, 0, 'seed').map((b) => (b.journey as { key: string }).key)).toEqual(['a', 'd']);
    // c shares two stops with a: never shown together, even when the pool runs short.
    const four = selectWithShuffle(pool, 4, 0, 'seed').map((b) => (b.journey as { key: string }).key);
    expect(four).toEqual(['a', 'd', 'b']);
  });
  it('a preferred archetype (bright-Moon night) takes the last slot when no earlier pick is one', () => {
    const pool = [mk('a', 1, ['a1', 'a2'], 'T'), mk('b', 0.9, ['b1', 'b2'], 'U'), mk('c', 0.8, ['c1', 'c2'], 'V'), mk('m', 0.1, ['m1', 'm2'], 'MOON')];
    const keys = (xs: { journey: unknown }[]) => xs.map((b) => (b.journey as { key: string }).key);
    expect(keys(selectWithShuffle(pool, 3, 0, 'seed'))).toEqual(['a', 'b', 'c']);
    const prefer = (b: { journey: unknown }) => (b.journey as { templateId: string }).templateId === 'MOON';
    expect(keys(selectWithShuffle(pool, 3, 0, 'seed', undefined, prefer))).toEqual(['a', 'b', 'm']);
    expect(keys(selectWithShuffle(pool.slice(0, 3), 3, 0, 'seed', undefined, prefer))).toEqual(['a', 'b', 'c']);
  });
  it('the canonical pick rotates between nights but never within one', () => {
    const pool = Array.from({ length: 12 }, (_, i) => mk(`k${i}`, 1 - i * 0.01, [`s${i}`, `t${i}`, `u${i}`], `T${i}`, `P${i}`));
    const pick = (night: string) => selectWithShuffle(pool, 3, 0, 'seed', night).map((b) => (b.journey as { key: string }).key).join(',');
    expect(pick('night-1')).toBe(pick('night-1'));
    const nights = new Set(Array.from({ length: 10 }, (_, i) => pick(`night-${i}`)));
    expect(nights.size).toBeGreaterThan(1);
    // Rotation only reorders near-equal journeys: the clearly worst ones never make the top 3.
    for (const p of nights) expect(p).not.toMatch(/k11/);
  });
  it('generate keeps results identical inside a 15-minute slot', () => {
    const a = generate(FIXTURE_KB, request('2027-01-09T05:01:00Z'));
    const b = generate(FIXTURE_KB, request('2027-01-09T05:14:00Z'));
    expect(a.journeys.map((j) => j.key)).toEqual(b.journeys.map((j) => j.key));
  });
});

describe('narration of a step back toward us', () => {
  it('derived down-steps never use the climbing SCALE / TIME_MACHINE lines', () => {
    expect(isDownStep({ type: 'SCALE', subtype: 'distanceLy-down' })).toBe(true);
    expect(isDownStep({ type: 'TIME_MACHINE', subtype: 'nearer' })).toBe(true);
    expect(isDownStep({ type: 'SCALE', subtype: 'distanceLy-up' })).toBe(false);
    const j = generate(FIXTURE_KB, request(DARK)).journeys[0];
    const prev = j.stops[0], next = j.stops[1];
    const down = { ...j, stops: [prev, { ...next, link: { from: prev.objectId, type: 'SCALE' as const, subtype: 'distanceLy-down', strength: 0.6, reasonKey: 'SCALE.distanceLy', curated: false } }, ...j.stops.slice(2)] };
    const nar = narrateJourney(down, FIXTURE_KB, { seedKey: 's', region: 'Orion' });
    expect(nar.stops[1].transition!.key).not.toMatch(/^SCALE/);
    expect(nar.stops[1].transition!.text).not.toMatch(/Next rung|Climb|Keep counting|Bigger again/);
  });
});
