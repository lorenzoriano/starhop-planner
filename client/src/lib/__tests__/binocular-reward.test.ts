import { describe, expect, it } from 'vitest';
import messier from '../../../public/data/messier.json';
import binocular from '../../../public/data/binocular-catalog.json';
import kb from '../../../public/data/journeys/kb.json';
import { buildUnifiedTargets, eqToHorizontal, type BinocularTarget, type UnifiedTarget } from '../astronomy';
import { binocularAssessment, opticsOf, skyInputsFrom, type BinocularProfile } from '../binocular-assessment';
import { BINOCULAR_ENTRIES } from '../binocular-guide';
import { moonState } from '../moon';
import { kbToUnifiedTarget } from '../object-links';
import type { KbObject } from '../journeys/types';
import rewardData from '../visibility/reward-data.json';
import rewardModel from '../visibility/reward-model.json';
import { rewardDots, rewardExtrasFromKb, rewardScore, rewardWord, spectralColours, tonightValue, TONIGHT_WEIGHT } from '../visibility/reward';
import { parseDec, parseRA } from './test-helpers';

const targets = buildUnifiedTargets(
  messier.map((m) => ({ id: m.M, m: m.M, ngc: m.NGC, type: m.T, mag: Number(m.V), ra: parseRA(m.RA), dec: parseDec(m.Dec), constellation: m.Con, name: m.N, size: m.S })),
  binocular.map((t) => ({ ...t, cat: t.cat as BinocularTarget['cat'], ra: parseRA(t.ra), dec: parseDec(t.dec) })),
);
const byId = new Map(targets.map((t) => [t.id, t]));
const target = (id: string) => byId.get(id)!;
const data = rewardData as Record<string, { reward: number; confidence: string; why: string; traits: string[] }>;
const TEN_50: BinocularProfile = { magnification: 10, aperture: 50, fov: 6.5, stabilized: false, transmission: 0.85 };

describe('binocular reward data', () => {
  it('covers every curated binocular target and every Messier object, with no sources in the shipped file', () => {
    for (const e of BINOCULAR_ENTRIES) expect(data[e.targetId], e.targetId).toBeDefined();
    for (const m of messier) expect(data[m.M], m.M).toBeDefined();
    for (const [id, r] of Object.entries(data)) {
      expect(byId.has(id), id).toBe(true);
      expect(r.reward).toBeGreaterThanOrEqual(0);
      expect(r.reward).toBeLessThanOrEqual(10);
      expect(r.why.length).toBeGreaterThan(10);
      expect(Object.keys(r).sort()).toEqual(['confidence', 'reward', 'traits', 'why']);
      expect(r.why).not.toMatch(/https?:|cloudynights|Seronik|Harrington|Tonkin/i);
    }
  });
  it('keeps the rubric anchors', () => {
    for (const id of ['M45', 'M31', 'M42', 'NGC869', 'NGC884', 'AST-Hyades', 'Mel20']) expect(data[id].reward, id).toBe(10);
    for (const id of ['M44', 'M7', 'M13', 'DS-Albireo', 'DS-MizarAlcor', 'AST-Coathanger']) expect(data[id].reward, id).toBeGreaterThanOrEqual(8);
    for (const id of ['M91', 'M98', 'M99', 'M100']) expect(data[id].reward, id).toBeLessThanOrEqual(1);
    expect(data.M57.reward).toBeLessThanOrEqual(3);
  });
  it('the generalising model is cross-validated (leave-one-out Spearman ≥ 0.75)', () => {
    expect(rewardModel.metrics.n).toBe(Object.keys(data).length);
    expect(rewardModel.metrics.looSpearman).toBeGreaterThanOrEqual(0.75);
    expect(rewardModel.metrics.looMAE).toBeLessThan(1.3);
  });
});

describe('rewardScore', () => {
  it('uses research for catalogued objects and the model for KB-only ones', () => {
    expect(rewardScore(target('M45'))).toMatchObject({ reward: 10, source: 'researched', confidence: 'high' });
    const kbOnly = (kb.objects as unknown as KbObject[]).filter((o) => !byId.has(o.id) && typeof o.mag === 'number');
    expect(kbOnly.length).toBeGreaterThan(5);
    for (const o of kbOnly) {
      const r = rewardScore(kbToUnifiedTarget(o), undefined, rewardExtrasFromKb(o));
      expect(r.source).toBe('estimated');
      expect(r.reward).toBeGreaterThanOrEqual(0);
      expect(r.reward).toBeLessThanOrEqual(10);
      expect(r.why).toMatch(/^Estimated/);
    }
  });
  it('rates coloured and variable stars above plain white ones when estimating', () => {
    const plain = { id: 'x-white', kind: 'star' as const, mag: 2, ra: 0, dec: 0, objectClass: 'other' as const };
    const red = { ...plain, id: 'x-red' };
    expect(rewardScore(red, undefined, { bv: 2.3, variableAmplitude: 2 }).reward).toBeGreaterThan(rewardScore(plain, undefined, { bv: 0 }).reward + 1);
  });
  it('reads colours from KB spectral texts', () => {
    expect(spectralColours('K3 II + B9.5 V (A + B)')).toEqual([1.15, -0.15]);
    const albireo = (kb.objects as unknown as KbObject[]).find((o) => o.id === 'DS-Albireo')!;
    expect(rewardExtrasFromKb(albireo)).toMatchObject({ bv: 1.15, bv2: -0.15 });
  });
  it('adjusts modestly for the binoculars: tiny objects gain at 15×70, the research stays dominant', () => {
    const optics = (magnification: number, aperture: number, fov: number) => ({ aperture, magnification, fov, transmission: 0.85, support: 'tripod' as const });
    const small = optics(7, 50, 7.3), big = optics(15, 70, 4.4);
    expect(rewardScore(target('M57'), big).reward).toBeGreaterThanOrEqual(rewardScore(target('M57'), small).reward);
    expect(rewardScore(target('AST-Hyades'), big).reward).toBeLessThanOrEqual(rewardScore(target('AST-Hyades'), small).reward);
    for (const t of targets) {
      const base = rewardScore(t).reward;
      for (const o of [small, big]) expect(Math.abs(rewardScore(t, o).reward - base), t.id).toBeLessThanOrEqual(1.05);
    }
  });
  it('words and dots name the band in text', () => {
    expect(rewardWord(10)).toBe('Showpiece');
    expect(rewardWord(7)).toBe('Rewarding');
    expect(rewardWord(5)).toBe('Pleasant');
    expect(rewardWord(3)).toBe('Modest');
    expect(rewardWord(1)).toBe('Faint smudge');
    expect(rewardWord(1, 'star')).toBe('Little to see');
    expect([rewardDots(10), rewardDots(5), rewardDots(0.4)]).toEqual([5, 3, 0]);
  });
});

// "Best tonight" = reward × w(level) + tie-break, as BinocularGuide sorts it.
const SF = { lat: 37.77, lon: -122.42 };
const AT = new Date('2026-11-07T05:00:00Z'); // 2026-11-06 21:00 PST, Moon down (new Moon on the 9th)
const MOONLIT = new Date('2026-11-21T05:00:00Z'); // 2026-11-20 21:00 PST, waxing gibbous Moon up
function bestTonight(sqm: number, opts: { moon?: boolean; profile?: BinocularProfile; at?: Date } = {}) {
  const at = opts.at ?? AT, profile = opts.profile ?? TEN_50, moon = moonState(SF.lat, SF.lon, at);
  const sky = skyInputsFrom(sqm, opts.moon === false ? null : moon);
  return BINOCULAR_ENTRIES.map((e) => target(e.targetId)).filter((t): t is UnifiedTarget => Boolean(t)).map((t) => {
    const alt = eqToHorizontal(t.ra, t.dec, SF.lat, SF.lon, at).alt;
    const v = binocularAssessment(t, profile, { alt, sky }).visibility;
    return { id: t.id, value: tonightValue(rewardScore(t, opticsOf(profile)).reward, v), level: v.level, score: v.score };
  }).filter((r) => r.level < 4).sort((a, b) => b.value - a.value);
}

describe('Best tonight (reward × visibility)', () => {
  it('weights fall with the visibility level', () => {
    expect([0, 1, 2, 3, 4].map((l) => TONIGHT_WEIGHT[l as 0])).toEqual([1, 0.85, 0.6, 0.3, 0]);
    expect(tonightValue(10, { level: 2, score: 60 })).toBeLessThan(tonightValue(8, { level: 0, score: 85 }));
  });
  const plainStars = Object.entries(data).filter(([id, r]) => id.startsWith('STAR-') && r.reward <= 4).map(([id]) => id);
  it('a dark site in November puts the real showpieces on top, never a plain bright star', () => {
    const list = bestTonight(21.8), top = list.slice(0, 8).map((r) => r.id);
    for (const id of ['M45', 'M31', 'NGC869', 'Mel20', 'AST-Hyades']) expect(top, id).toContain(id);
    expect(list.slice(0, 15).map((r) => r.id).filter((id) => plainStars.includes(id))).toEqual([]);
    // Bright plain stars are "Excellent" to see, yet rank far below the showpieces.
    const vega = list.findIndex((r) => r.id === 'STAR-Vega');
    expect(vega).toBeGreaterThan(20);
  });
  it('a suburban sky shifts the order toward bright clusters and doubles, away from faint glows', () => {
    const dark = bestTonight(21.8).map((r) => r.id), suburb = bestTonight(19.0).map((r) => r.id);
    const rank = (list: string[], id: string) => (list.includes(id) ? list.indexOf(id) : Infinity);
    expect(suburb.slice(0, 6)).toEqual(expect.arrayContaining(['M45', 'Mel20', 'AST-Hyades', 'NGC869']));
    expect(rank(suburb, 'M31')).toBeGreaterThan(rank(dark, 'M31'));
    expect(rank(suburb, 'M33')).toBeGreaterThan(rank(dark, 'M33'));
    expect(rank(suburb, 'NGC7000')).toBeGreaterThan(rank(dark, 'NGC7000'));
    expect(rank(suburb, 'DS-Albireo')).toBeLessThan(rank(dark, 'DS-Albireo'));
  });
  it('a suburban sky with a bright Moon keeps bright clusters and doubles on top and drops faint glows', () => {
    const moonlit = bestTonight(19.0, { at: MOONLIT });
    expect(moonState(SF.lat, SF.lon, MOONLIT).alt).toBeGreaterThan(20);
    const top = moonlit.slice(0, 10).map((r) => r.id);
    expect(top).toEqual(expect.arrayContaining(['M45', 'Mel20']));
    for (const id of ['M33', 'NGC7000', 'M1', 'M74']) expect(top, id).not.toContain(id);
    const kinds = top.map((id) => target(id).category);
    expect(kinds.filter((c) => /galaxy|nebula/i.test(c)).length).toBeLessThanOrEqual(1);
  });
});
