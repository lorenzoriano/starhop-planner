import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildUnifiedTargets, type BinocularTarget, type MessierObject } from '../astronomy';
import { kbToUnifiedTarget } from '../object-links';
import type { KbObject } from '../journeys/types';
import {
  airmass,
  estimateVisibility,
  extinctionCoefficient,
  muToCd,
  skyBrightnessAt,
  skyBrightnessBreakdown,
  steadinessPenalty,
  stellarLimit,
} from '../visibility/model';
import { extinctionFromForecast } from '../visibility/conditions';
import { toVisibilityTarget } from '../visibility/targets';
import type { Observer, Optics, SkyInputs, Support, VisibilityTarget } from '../visibility/types';
import { parseDec, parseRA } from './test-helpers';

// Spec §9 setup: 10x50, p = 6 mm, t = 0.85, F = 2, elevation 300 m, k = 0.254, object at 60°.
const OBS: Observer = { pupil: 6, fieldFactor: 2 };
const binos = (support: Support = 'tripod', magnification = 10, aperture = 50): Optics =>
  ({ aperture, magnification, fov: 6.5, transmission: 0.85, support });
const MOON_50_AT_40 = { alt: 50, ra: 40, dec: 0, phaseAngle: 90, illumination: 0.5 };
const sky = (zenithSqm: number, moon: SkyInputs['moon'] = null, extra: Partial<SkyInputs> = {}): SkyInputs =>
  ({ zenithSqm, elevationM: 300, extinctionK: 0.254, extinctionSource: 'manual', moon, ...extra });
const B3 = 21.45, B7 = 18.25, ALT = 60;

const at = (t: Omit<VisibilityTarget, 'ra' | 'dec' | 'id'> & { id?: string }): VisibilityTarget => ({ id: 'x', ra: 0, dec: 0, ...t });
const M31 = at({ kind: 'extended', objectClass: 'galaxy', mag: 3.4, majorArcmin: 190, minorArcmin: 60 });
const M33 = at({ kind: 'extended', objectClass: 'galaxy', mag: 5.7, majorArcmin: 71, minorArcmin: 42 });
const M101 = at({ kind: 'extended', objectClass: 'galaxy', mag: 7.9, majorArcmin: 29, minorArcmin: 27 });
const M13 = at({ kind: 'cluster', objectClass: 'globular', mag: 5.8, majorArcmin: 16.6, brightestStarMag: 11.9 });
const M45 = at({ kind: 'cluster', objectClass: 'open', mag: 1.6, majorArcmin: 110, brightestStarMag: 3.8 });
const ALBIREO = at({ kind: 'double', mag: 3.1, mag2: 5.1, sepArcsec: 34.4 });
const MIZAR_AB = at({ kind: 'double', mag: 2.3, mag2: 4.0, sepArcsec: 14.4 });
const MIZAR_ALCOR = at({ kind: 'double', mag: 2.2, mag2: 4.0, sepArcsec: 708 });

const est = (t: VisibilityTarget, s: SkyInputs, o: Optics = binos(), alt = ALT) => estimateVisibility(t, o, s, alt, OBS);
const lmAt = (s: SkyInputs, support: Support = 'tripod') =>
  stellarLimit(skyBrightnessAt(s, ALT, { ra: 0, dec: 0 }), binos(support), OBS, s.extinctionK * airmass(ALT));

describe('atmosphere and sky (published reference values)', () => {
  it('Green extinction: ~0.28 at sea level, 0.21 at 1 km, 0.15 at 2.2 km', () => {
    expect(extinctionCoefficient(0, 1)).toBeCloseTo(0.28, 2);
    expect(extinctionCoefficient(1000, 1)).toBeCloseTo(0.21, 2);
    expect(extinctionCoefficient(2200, 1)).toBeCloseTo(0.15, 2);
    expect(extinctionCoefficient(0, 0.3)).toBeCloseTo(0.2, 2);
  });
  it('Rozenberg airmass: 1 overhead, 40 at the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1, 3);
    expect(airmass(0)).toBeCloseTo(40, 0);
    expect(airmass(60)).toBeCloseTo(1.155, 2);
  });
  it('Krisciunas & Schaefer Table 2: 99 nL at α 90°, ρ 60°, Z_moon 60°, k 0.172', () => {
    const s: SkyInputs = { zenithSqm: 21.9, elevationM: 0, extinctionK: 0.172, extinctionSource: 'manual', moon: { alt: 30, ra: 60, dec: 0, phaseAngle: 90, illumination: 0.5 } };
    const b = skyBrightnessBreakdown(s, 90, { ra: 0, dec: 0 });
    expect((muToCd(b.mu) - muToCd(b.muNoMoon)) / 3.183e-6).toBeCloseTo(99, -1);
  });
  it('a 50% Moon 40° away costs ~1.3 mag/arcsec² at a Bortle 3 site but little at Bortle 7', () => {
    const dark = skyBrightnessBreakdown(sky(B3, MOON_50_AT_40), ALT, { ra: 0, dec: 0 });
    expect(dark.mu).toBeCloseTo(21.34 - 1.33, 0);
    expect(dark.moonDelta).toBeGreaterThan(1.1);
    expect(dark.moonDelta).toBeLessThan(1.5);
    expect(skyBrightnessBreakdown(sky(B7, MOON_50_AT_40), ALT, { ra: 0, dec: 0 }).moonDelta).toBeLessThan(0.25);
  });
  it('sky brightens toward the horizon (spec §9: 21.45 zenith → ~21.34 at 60°)', () => {
    expect(skyBrightnessAt(sky(B3), ALT)).toBeCloseTo(21.32, 1);
    expect(skyBrightnessAt(sky(B3), 20)).toBeLessThan(skyBrightnessAt(sky(B3), ALT));
  });
  it('twilight brightens the sky: ~2.5 mag at Sun −12°, nothing at −18°', () => {
    const dark = skyBrightnessAt(sky(21.9), 90);
    expect(skyBrightnessAt(sky(21.9, null, { sunAlt: -18 }), 90)).toBeCloseTo(dark, 5);
    expect(dark - skyBrightnessAt(sky(21.9, null, { sunAlt: -12 }), 90)).toBeCloseTo(2.5, 1);
  });
});

describe('stellar limit (Crumey 2014)', () => {
  it('naked eye: m0 = 6.18 at µ 21.83 with F = 2', () => {
    expect(stellarLimit(21.83, { aperture: 6, magnification: 1, fov: 60, transmission: 1, support: 'tripod' }, OBS, 0)).toBeCloseTo(6.18, 2);
  });
  it('10x50 on a tripod: LM ≈ 10.3 at Bortle 3 and ≈ 9.2 at Bortle 7 (±0.3)', () => {
    expect(Math.abs(lmAt(sky(B3)) - 10.35)).toBeLessThan(0.3);
    expect(Math.abs(lmAt(sky(B7)) - 9.22)).toBeLessThan(0.3);
  });
  it('hand-held 10x costs ~0.45 mag; stabilised 0.1', () => {
    expect(lmAt(sky(B3)) - lmAt(sky(B3), 'handheld')).toBeCloseTo(0.45, 2);
    expect(lmAt(sky(B3)) - lmAt(sky(B3), 'stabilized')).toBeCloseTo(0.1, 2);
    expect(steadinessPenalty('handheld', 15).mag).toBeCloseTo(0.7, 5);
  });
});

describe('extended objects and clusters (spec §9 sanity table)', () => {
  it('M31 is Excellent from a dark site', () => {
    expect(est(M31, sky(B3)).label).toBe('Excellent');
  });
  it('M33 is Good-ish from a dark site and Difficult or invisible at Bortle 7', () => {
    expect(est(M33, sky(B3)).level).toBeLessThanOrEqual(1);
    expect(est(M33, sky(B7)).level).toBeGreaterThanOrEqual(3);
  });
  it('M101 is Difficult even from a dark site', () => {
    const e = est(M101, sky(B3));
    expect(e.label).toBe('Difficult');
    expect(e.limits.some((l) => l.factor === 'low-surface-brightness')).toBe(true);
  });
  it('M13 is a visible but unresolved glow in 10x50', () => {
    const e = est(M13, sky(B3));
    expect(e.level).toBeLessThanOrEqual(1);
    expect(e.appearance).not.toMatch(/resolves/i);
    expect(e.limits.some((l) => l.factor === 'unresolved-stars')).toBe(true);
  });
  it('M45 is Excellent anywhere and resolves into stars', () => {
    for (const s of [sky(B3), sky(B7, MOON_50_AT_40), sky(17.5)]) {
      const e = est(M45, s, binos('handheld'));
      expect(e.label).toBe('Excellent');
      expect(e.appearance).toMatch(/resolves/i);
    }
  });
  it('a tiny planetary looks like a star at 10x', () => {
    const e = est(at({ kind: 'extended', objectClass: 'planetary', mag: 8.8, majorArcmin: 0.6, minorArcmin: 0.5 }), sky(B3));
    expect(e.appearance).toMatch(/star/i);
    expect(e.limits.some((l) => l.factor === 'too-small')).toBe(true);
  });
  it('an object bigger than the field is flagged but still visible', () => {
    const e = est(at({ kind: 'cluster', objectClass: 'open', mag: 0.5, majorArcmin: 400, brightestStarMag: 3.6 }), sky(B3));
    expect(e.level).toBe(0);
    expect(e.limits.some((l) => l.factor === 'larger-than-field')).toBe(true);
    expect(e.appearance).toMatch(/fills the field/);
  });
});

describe('double stars', () => {
  const NU_DRA = at({ kind: 'double', mag: 4.9, mag2: 4.9, sepArcsec: 62 });
  const EPS_LYR_WIDE = at({ kind: 'double', mag: 4.7, mag2: 4.6, sepArcsec: 208 });
  const EPS1_LYR = at({ kind: 'double', mag: 5.0, mag2: 6.1, sepArcsec: 2.3 });
  it('Albireo: Good hand-held at 10x, Excellent at 14x stabilised, a clean split on a tripod', () => {
    const hand = est(ALBIREO, sky(B3), binos('handheld'));
    expect(hand.label).toBe('Good');
    expect(hand.appearance).toMatch(/split/i);
    expect(est(ALBIREO, sky(B3), binos('stabilized', 14, 50)).label).toBe('Excellent');
    const tripod = est(ALBIREO, sky(B3));
    expect(tripod.level).toBeLessThanOrEqual(1);
    expect(tripod.margin).toBeGreaterThan(hand.margin);
    // A 7x hand-held still (just) splits it.
    expect(est(ALBIREO, sky(B3), binos('handheld', 7, 50)).level).toBeLessThanOrEqual(2);
  });
  it('Mizar A–B is not split at 10–14x; Mizar–Alcor is trivial', () => {
    for (const o of [binos('tripod'), binos('handheld'), binos('stabilized', 14, 50)]) {
      const ab = est(MIZAR_AB, sky(B3), o);
      expect(ab.level).toBeGreaterThanOrEqual(3);
      expect(ab.appearance).not.toMatch(/^(Splits|A clear|A tight)/);
    }
    const ab = est(MIZAR_AB, sky(B3));
    expect(ab.limits.some((l) => l.factor === 'too-close' || l.factor === 'unequal-pair')).toBe(true);
    expect(est(MIZAR_ALCOR, sky(B7), binos('handheld')).label).toBe('Excellent');
  });
  it('ν Dra and the wide ε Lyr pair are Excellent; the close ε Lyr pairs never split', () => {
    expect(est(NU_DRA, sky(B3), binos('handheld')).label).toBe('Excellent');
    expect(est(EPS_LYR_WIDE, sky(B7), binos('handheld')).label).toBe('Excellent');
    expect(est(EPS1_LYR, sky(B3), binos('tripod', 15, 70)).label).toBe('Not visible');
  });
});

describe('observer pupil', () => {
  const cases: [string, VisibilityTarget][] = [
    ['M33', M33], ['M13', M13], ['M45', M45], ['Albireo', ALBIREO], ['star', at({ kind: 'star', mag: 9.5 })],
    ['M57', at({ kind: 'extended', objectClass: 'planetary', mag: 8.8, majorArcmin: 1.4, minorArcmin: 1.0 })],
  ];
  it('a smaller pupil never improves the margin or the limiting magnitude (any kind, any binocular)', () => {
    for (const [mag, ap] of [[7, 50], [10, 50], [14, 50], [15, 70], [8, 56]]) {
      for (const s of [sky(B3), sky(20.5), sky(B7)]) {
        const o = binos('tripod', mag, ap);
        let prevLm = Infinity;
        const prev = new Map<string, number>();
        for (const pupil of [7.5, 7, 6, 5, 4.5]) {
          const obs = { pupil, fieldFactor: 2 };
          const lm = stellarLimit(skyBrightnessAt(s, ALT), o, obs, s.extinctionK * airmass(ALT));
          expect(lm).toBeLessThanOrEqual(prevLm + 1e-9);
          prevLm = lm;
          for (const [name, t] of cases) {
            const m = estimateVisibility(t, o, s, ALT, obs).margin;
            expect(m, `${name} ${mag}x${ap} p${pupil}`).toBeLessThanOrEqual((prev.get(name) ?? Infinity) + 1e-9);
            prev.set(name, m);
          }
        }
      }
    }
  });
  it('a pupil smaller than the exit pupil costs light (7x50 at 5 mm vs 7 mm)', () => {
    const o = binos('tripod', 7, 50);
    expect(est(M33, sky(B3), o).margin).toBeGreaterThan(estimateVisibility(M33, o, sky(B3), ALT, { pupil: 5, fieldFactor: 2 }).margin);
  });
});

describe('bright nebulae under moonlight', () => {
  const FULL_MOON_45 = { alt: 45, ra: 45, dec: 0, phaseAngle: 5, illumination: 1 };
  const M42 = at({ kind: 'extended', objectClass: 'emission', mag: 4.0, majorArcmin: 90, minorArcmin: 60, core: { majorArcmin: 8, minorArcmin: 6, mag: 4.8 } });
  const M8 = at({ kind: 'extended', objectClass: 'emission', mag: 6.0, majorArcmin: 45, minorArcmin: 30, core: { majorArcmin: 10, minorArcmin: 6, mag: 6.2 } });
  it('M42 stays at least Fair, and M8 at least Difficult, in an 18.5 sky with a full Moon 45° away', () => {
    expect(est(M42, sky(18.5, FULL_MOON_45), binos('handheld'), 45).level).toBeLessThanOrEqual(2);
    expect(est(M8, sky(18.5, FULL_MOON_45), binos('handheld'), 45).level).toBeLessThanOrEqual(3);
  });
});

describe('score', () => {
  it('keeps discriminating above Excellent and ranks rich objects above a lone bright star', () => {
    const vega = est(at({ kind: 'star', mag: 0.0 }), sky(B3));
    expect(vega.label).toBe('Excellent');
    const rich = [M45, M31, M13].map((t) => est(t, sky(B3)));
    for (const r of rich) expect(r.score).toBeGreaterThan(vega.score);
    expect(est(M45, sky(B3)).score).toBeGreaterThan(est(M31, sky(B3)).score);
    expect(est(M45, sky(B3)).score).toBeLessThan(100);
  });
});

describe('conditions move the margin the right way', () => {
  it('a 50% Moon 40° away worsens M33', () => {
    expect(est(M33, sky(B3, MOON_50_AT_40)).margin).toBeLessThan(est(M33, sky(B3)).margin - 0.2);
  });
  it('lower altitude worsens', () => {
    expect(est(M33, sky(B3), binos(), 20).margin).toBeLessThan(est(M33, sky(B3), binos(), 60).margin);
    expect(est(M13, sky(B3), binos(), 15).margin).toBeLessThan(est(M13, sky(B3), binos(), 60).margin);
  });
  it('higher elevation (less extinction) improves', () => {
    const low = sky(B3, null, { elevationM: 0, extinctionK: extinctionCoefficient(0, 1) });
    const high = sky(B3, null, { elevationM: 2500, extinctionK: extinctionCoefficient(2500, 1) });
    expect(est(M101, high, binos(), 30).margin).toBeGreaterThan(est(M101, low, binos(), 30).margin);
  });
  it('stabilised is better than hand-held and close to a tripod', () => {
    for (const t of [M33, M101, M13, ALBIREO]) {
      const tri = est(t, sky(B3)).margin, stab = est(t, sky(B3), binos('stabilized')).margin, hand = est(t, sky(B3), binos('handheld')).margin;
      expect(stab).toBeGreaterThan(hand);
      expect(tri - stab).toBeLessThan(tri - hand);
      expect(tri - stab).toBeLessThan(0.15);
    }
  });
  it('limitations are sorted by gain and a bright nearby Moon is the top one', () => {
    const fullMoonNear = { alt: 40, ra: 20, dec: 0, phaseAngle: 15, illumination: 0.95 };
    const e = est(M33, sky(B3, fullMoonNear, { extinctionK: 0.35 }), binos('handheld'), 40);
    expect(e.limits[0].factor).toBe('moon');
    expect(e.limits[0].text).toMatch(/95% lit Moon, 20° away/);
    for (let i = 1; i < e.limits.length; i++) expect(e.limits[i].gain).toBeLessThanOrEqual(e.limits[i - 1].gain);
    const kinds = new Set(e.limits.map((l) => l.factor));
    for (const f of ['altitude', 'haze'] as const) expect(kinds.has(f)).toBe(true);
  });
  it('score is monotone in the margin and within 0..100', () => {
    const scores = [M101, M33, M31].map((t) => est(t, sky(B3)));
    expect(scores[0].score).toBeLessThan(scores[1].score);
    expect(scores[1].score).toBeLessThan(scores[2].score);
    for (const s of scores) expect(s.score).toBeGreaterThanOrEqual(0), expect(s.score).toBeLessThanOrEqual(100);
  });
});

describe('forecast haze at high and low sites', () => {
  // M45 at 37°, same 19.0 sky setting; CAMS AOD read as a relative haze index (see extinctionFromForecast).
  const site = (elevationM: number, aod: number): SkyInputs =>
    ({ zenithSqm: 19, elevationM, extinctionK: extinctionFromForecast({ aod }, elevationM)!.k, extinctionSource: 'forecast', moon: null });
  const ALT37 = 37;
  it('Mauna Kea beats San Francisco at equal haze; Delhi smoke is much worse', () => {
    const sf = est(M45, site(14, 0.07), binos(), ALT37), mk = est(M45, site(4169, 0.07), binos(), ALT37);
    const delhi = est(M45, site(217, 0.48), binos(), ALT37);
    expect(mk.limitingMag).toBeGreaterThan(sf.limitingMag + 0.1);
    expect(mk.margin).toBeGreaterThan(sf.margin);
    expect(delhi.limitingMag).toBeLessThan(sf.limitingMag - 1);
    // A clear night never brightens the light-polluted sky above the user's setting (glow factor k/k_avg < 1).
    for (const h of [14, 1600, 4169]) expect(skyBrightnessAt(site(h, 0.07), 90)).toBeGreaterThan(19);
    expect(skyBrightnessAt(site(217, 0.48), 90)).toBeLessThan(19);
  });
  it('the altitude line quotes only the extra loss from being low; the haze line only the haze part', () => {
    const s = site(217, 0.48), e = est(M45, s, binos(), ALT37);
    const pct = (factor: string) => Number(e.limits.find((l) => l.factor === factor)!.text.match(/about (\d+)%/)![1]);
    const X = airmass(ALT37), k = s.extinctionK, crisp = extinctionCoefficient(217, 0.3);
    const lost = (d: number) => Math.round((1 - 10 ** (-0.4 * d)) * 100);
    expect(pct('altitude')).toBe(lost(k * (X - 1)));
    expect(pct('haze')).toBe(lost((k - crisp) * X));
    expect(pct('altitude')).toBeLessThan(lost(k * X));
    expect(e.limits.find((l) => l.factor === 'altitude')!.text).toMatch(/more air than overhead/);
  });
  it('names the light pollution after the selected sky preset', () => {
    const lp = (sqm: number) => est(M45, sky(sqm), binos(), ALT37).limits.find((l) => l.factor === 'light-pollution')?.text;
    expect(lp(18.5)).toMatch(/your bright-suburb sky is about 21× brighter than a dark site/);
    expect(lp(19)).toMatch(/your bright-suburb sky/);
    expect(lp(19.5)).toMatch(/your suburban sky/);
    expect(lp(17.5)).toMatch(/your city-centre sky/);
  });
});

// ─── real catalog targets ───
const DATA = 'client/public/data/';
function loadTargets() {
  const messier: MessierObject[] = JSON.parse(readFileSync(DATA + 'messier.json', 'utf8')).map((m: Record<string, string>) => ({
    id: m.M, m: m.M, ngc: m.NGC, type: m.T, mag: parseFloat(m.V), ra: parseRA(m.RA), dec: parseDec(m.Dec), constellation: m.Con, name: m.N, size: m.S,
  }));
  const bino: BinocularTarget[] = JSON.parse(readFileSync(DATA + 'binocular-catalog.json', 'utf8')).map((t: Record<string, unknown>) => ({
    ...t, ra: parseRA(t.ra as string), dec: parseDec(t.dec as string), size: t.size ? String(t.size) : undefined,
  }));
  return buildUnifiedTargets(messier, bino);
}

describe('toVisibilityTarget', () => {
  const targets = loadTargets();
  const get = (id: string) => toVisibilityTarget(targets.find((t) => t.id === id)!);
  it('maps categories to kinds with sizes and cluster data', () => {
    expect(get('M31')).toMatchObject({ kind: 'extended', objectClass: 'galaxy' });
    expect(get('M31').majorArcmin).toBeGreaterThan(150);
    expect(get('M13')).toMatchObject({ kind: 'cluster', objectClass: 'globular' });
    expect(get('M13').brightestStarMag).toBeGreaterThan(11);
    expect(get('DS-Albireo')).toMatchObject({ kind: 'double', sepArcsec: 34.4, mag2: 5.1 });
    expect(get('M40')).toMatchObject({ kind: 'double' });
    expect(get('STAR-Vega')).toMatchObject({ kind: 'star' });
    expect(get('AST-Coathanger')).toMatchObject({ kind: 'cluster', objectClass: 'asterism' });
    expect(get('M57')).toMatchObject({ kind: 'extended', objectClass: 'planetary' });
  });
  it('every unified target yields a finite estimate', () => {
    for (const t of targets) {
      const e = estimateVisibility(toVisibilityTarget(t), binos('handheld'), sky(B3), 45, OBS);
      expect(Number.isFinite(e.margin), t.id).toBe(true);
      expect(e.appearance.length).toBeGreaterThan(0);
    }
  });
});

// ─── agreement with curated KB grades (report, loose threshold) ───
function spearman(a: number[], b: number[]) {
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

describe('agreement with curated 10x50 dark-sky grades (kb.json)', () => {
  it('rank-correlates with the curator grades', () => {
    const targets = loadTargets();
    const kb = (JSON.parse(readFileSync(DATA + 'journeys/kb.json', 'utf8')) as { objects: KbObject[] }).objects;
    const darkSky: SkyInputs = { zenithSqm: B3, elevationM: 300, extinctionK: extinctionCoefficient(300, 1), extinctionSource: 'default', moon: null };
    const rows: { id: string; grade: number; level: number; margin: number; appearance: string }[] = [];
    for (const o of kb) {
      const grade = o.view?.['10x50']?.dark;
      if (grade === undefined || o.mag == null) continue;
      const e = estimateVisibility(toVisibilityTarget(kbToUnifiedTarget(o, { targets })), binos('handheld'), darkSky, 60, OBS);
      rows.push({ id: o.id, grade, level: e.level, margin: e.margin, appearance: e.appearance });
    }
    const rho = spearman(rows.map((r) => r.margin), rows.map((r) => r.grade));
    const mismatches = rows.filter((r) => Math.abs(r.level - (4 - r.grade)) >= 2);
    console.log(`[visibility calibration] n=${rows.length} spearman=${rho.toFixed(3)} exact=${rows.filter((r) => r.level === 4 - r.grade).length} off-by-2+=${mismatches.length}`);
    for (const r of mismatches) console.log(`  ${r.id}: curator ${['Not visible', 'Difficult', 'Fair', 'Good', 'Excellent'][r.grade]}, model level ${r.level} (margin ${r.margin.toFixed(2)}) — ${r.appearance}`);
    expect(rows.length).toBeGreaterThan(100);
    expect(rho).toBeGreaterThanOrEqual(0.5);
  });
});
