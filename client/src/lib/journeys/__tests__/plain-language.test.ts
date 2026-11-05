/**
 * plain-language.ts and glossary.json (owner feedback r1): descriptions never show spectral classes or catalog
 * codes; every technical term the cards and narration use has a short plain definition the app can make tappable.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import {
  capitalizeSentences, findGlossaryTerms, glossaryEntries, nameInSentence, parseSpectralType, plainClass, plainKind,
  sizeFromLumClass, withArticle, type Glossary, type GlossaryEntry,
} from '../plain-language';
import type { DsoObject, KbObject, StarObject } from '../types';

const PUBLIC = resolve(__dirname, '../../../../public/data/journeys');
const glossary = JSON.parse(readFileSync(resolve(PUBLIC, 'glossary.json'), 'utf8')) as Glossary;
const entries = glossaryEntries(glossary);

const star = (patch: Partial<StarObject>): StarObject => {
  const base = FIXTURE_KB.objects.find((o) => o.kind === 'star') as StarObject;
  return { ...base, spectral: undefined, evolutionaryStage: undefined, variability: undefined, multiplicity: undefined, ...patch };
};
const dso = (patch: Partial<DsoObject>): DsoObject => {
  const base = FIXTURE_KB.objects.find((o) => o.kind === 'dso') as DsoObject;
  return { ...base, traits: [], ...patch };
};
const sp = (text: string, cls: string, lumClass?: string) => ({ text, class: cls, ...(lumClass ? { lumClass } : {}), sourceId: 's' });

describe('spectral parsing', () => {
  it('reads temperature and luminosity class from published types', () => {
    expect(parseSpectralType('K1.5 III Fe−0.5')).toEqual({ cls: 'K', lum: 'III' });
    expect(parseSpectralType('M1-M2 Ia-Iab')).toEqual({ cls: 'M', lum: 'Ia-Iab' });
    expect(parseSpectralType('B8V')).toEqual({ cls: 'B', lum: 'V' });
    expect(parseSpectralType('A7 III (θ²)')).toEqual({ cls: 'A', lum: 'III' });
    expect(parseSpectralType('gM0')).toEqual({ cls: 'M', lum: 'III' });
    expect(parseSpectralType('DA white dwarf').cls).toBe('D');
    expect(parseSpectralType('C5,4J(N3)').cls).toBe('C');
    expect(sizeFromLumClass('Ia-0')).toBe('hypergiant');
    expect(sizeFromLumClass('Iab')).toBe('supergiant');
    expect(sizeFromLumClass('II-III')).toBe('giant');
    expect(sizeFromLumClass('IV-V')).toBe('subgiant');
    expect(sizeFromLumClass('V')).toBe('dwarf');
  });
});

describe('plainClass', () => {
  it('describes stars by color and size, never by class code', () => {
    expect(plainClass(star({ spectral: sp('K1.5 III Fe−0.5', 'K', 'III') }))).toBe('orange giant');
    expect(plainClass(star({ spectral: sp('M1-M2 Ia-Iab', 'M', 'Ia-Iab'), evolutionaryStage: 'red-supergiant',
      variability: { class: 'semiregular', gcvsType: 'SRC', vMax: 0, vMin: 1.6, binocularVisibleAtMin: true, volatile: true, sourceId: 'g' } }))).toBe('red supergiant, slowly pulsating');
    expect(plainClass(star({ spectral: sp('F5Ib-G1Ib', 'F', 'Ib'), evolutionaryStage: 'yellow-supergiant',
      variability: { class: 'cepheid', gcvsType: 'DCEP', vMax: 3.5, vMin: 4.4, binocularVisibleAtMin: true, volatile: false, sourceId: 'g' } }))).toBe('yellow supergiant, pulsating Cepheid');
    expect(plainClass(star({ spectral: sp('B8V', 'B', 'V'),
      variability: { class: 'eclipsing-algol', gcvsType: 'EA', vMax: 2.1, vMin: 3.4, binocularVisibleAtMin: true, volatile: false, sourceId: 'g' } }))).toBe('blue-white star, eclipsing binary');
    expect(plainClass(star({ spectral: sp('K5 V', 'K', 'V') }))).toBe('orange dwarf');
    expect(plainClass(star({ spectral: sp('A0 V', 'A', 'V') }))).toBe('white star');
    expect(plainClass(star({ spectral: sp('C5,4J(N3)', 'C'), evolutionaryStage: 'tp-agb' }))).toBe('carbon star');
    expect(plainClass(star({ evolutionaryStage: 'white-dwarf' }))).toBe('white dwarf');
  });

  it('describes multiple stars component by component', () => {
    const thetaTau = star({
      spectral: sp('A7 III (θ²) + G9 III (θ¹)', 'A', 'III'),
      multiplicity: { components: [{ label: 'A', spType: 'A7 III (θ²)' }, { label: 'B', spType: 'K0 IIIb (θ¹)' }], pairs: [] },
    });
    expect(plainClass(thetaTau)).toBe('white giant + orange giant');
    const twins = star({ spectral: sp('K5 V', 'K', 'V'), multiplicity: { components: [{ label: 'A', spType: 'K5 V' }, { label: 'B', spType: 'K7 V' }], pairs: [] } });
    expect(plainClass(twins)).toBe('pair of orange dwarfs');
    const trio = star({ spectral: sp('A1 Vp', 'A', 'V'), multiplicity: { components: [{ label: 'A', spType: 'A1 Vp' }, { label: 'C', spType: 'A5 V' }, { label: 'D', spType: 'M3-4 V' }], pairs: [] } });
    expect(plainClass(trio)).toBe('two white stars + red dwarf');
  });

  it('describes deep-sky objects in plain words, with cluster age', () => {
    expect(plainClass(dso({ dsoClass: 'open-cluster', evoStage: 2 }))).toBe('young open cluster');
    expect(plainClass(dso({ dsoClass: 'open-cluster', evoStage: 4 }))).toBe('old open cluster');
    expect(plainClass(dso({ dsoClass: 'open-cluster', evoStage: 3 }))).toBe('open cluster');
    expect(plainClass(dso({ dsoClass: 'planetary-nebula', evoStage: 6 }))).toBe('planetary nebula');
    expect(plainClass(dso({ dsoClass: 'hii-region', evoStage: 0 }))).toBe('glowing gas cloud where stars form');
    expect(plainClass(dso({ dsoClass: 'galaxy-spiral', evoStage: 8, traits: ['edge-on'] }))).toBe('spiral galaxy, seen edge-on');
  });

  it('never leaks a class code for any fixture or shipped object', () => {
    const shipped = JSON.parse(readFileSync(resolve(PUBLIC, 'kb.json'), 'utf8')) as { objects: KbObject[] };
    for (const o of [...FIXTURE_KB.objects, ...shipped.objects]) {
      const d = plainClass(o);
      expect(d, o.id).toMatch(/^[a-zA-Z]/);
      expect(d, `${o.id}: ${d}`).not.toMatch(/\b[OBAFGKM]\d|\b(Ia|Iab|Ib|II|III|IV|V)\b|[·_()]|-(?:cluster|nebula|galaxy)\b/);
      expect(plainKind(o).length, o.id).toBeGreaterThan(2);
    }
  });

  it('articles and names in running text', () => {
    expect(withArticle('orange giant')).toBe('an orange giant');
    expect(withArticle('young open cluster')).toBe('a young open cluster');
    expect(nameInSentence('Andromeda Galaxy')).toBe('the Andromeda Galaxy');
    expect(nameInSentence('Garnet Star')).toBe('the Garnet Star');
    expect(nameInSentence('Double Cluster (h Persei)')).toBe('the Double Cluster (h Persei)');
    expect(nameInSentence('Stock 2 (Muscleman Cluster)')).toBe('Stock 2 (Muscleman Cluster)');
    expect(nameInSentence('Ptolemy’s Cluster')).toBe('Ptolemy’s Cluster');
    expect(nameInSentence('NGC 6231')).toBe('NGC 6231');
    expect(nameInSentence('Algol')).toBe('Algol');
    expect(nameInSentence('Jewel Box')).toBe('the Jewel Box');
    expect(nameInSentence('Southern Beehive')).toBe('the Southern Beehive');
    expect(nameInSentence('Heart Nebula cluster')).toBe('the Heart Nebula cluster');
    expect(nameInSentence('Omega Centauri')).toBe('Omega Centauri');
    expect(capitalizeSentences('the Hyades are near. the Pleiades are young.')).toBe('The Hyades are near. The Pleiades are young.');
  });
});

describe('findGlossaryTerms', () => {
  const g: GlossaryEntry[] = [
    { id: 'cepheid', term: 'Cepheid', aliases: ['Cepheid variable'], short: 'x' },
    { id: 'light-year', term: 'light-year', aliases: [], short: 'x' },
    { id: 'nebula', term: 'nebula', aliases: [], short: 'x' },
    { id: 'planetary-nebula', term: 'planetary nebula', aliases: [], short: 'x' },
    { id: 'nova', term: 'nova', aliases: [], short: 'x' },
    { id: 'galaxy', term: 'galaxy', aliases: [], short: 'x' },
  ];

  it('finds the first occurrence of each term, case-insensitive, with plurals', () => {
    const text = 'Cepheids pulse. A cepheid 2,000 light-years away; more light-years later.';
    const hits = findGlossaryTerms(text, g);
    expect(hits.map((h) => [h.id, h.match])).toEqual([['cepheid', 'Cepheids'], ['light-year', 'light-years']]);
    expect(text.slice(hits[0].start, hits[0].end)).toBe('Cepheids');
    expect(hits[0].term).toBe('Cepheid');
  });

  it('prefers the longest term, respects word boundaries and irregular plurals', () => {
    const hits = findGlossaryTerms('A planetary nebula is not a supernova; two nebulae and two galaxies.', g);
    expect(hits.map((h) => h.match)).toEqual(['planetary nebula', 'nebulae', 'galaxies']);
    expect(findGlossaryTerms('supernova', g)).toEqual([]);
    expect(findGlossaryTerms('', g)).toEqual([]);
    // Accepts the file shape as well as a bare list.
    expect(findGlossaryTerms('a nova', { version: 'v', terms: g })).toHaveLength(1);
  });
});

describe('glossary.json', () => {
  it('has 60–90 unique, short, plain entries', () => {
    expect(entries.length).toBeGreaterThanOrEqual(60);
    expect(entries.length).toBeLessThanOrEqual(90);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    const forms = new Map<string, string>();
    for (const e of entries) {
      expect(e.id, e.id).toMatch(/^[a-z0-9-]+$/);
      expect(Array.isArray(e.aliases), e.id).toBe(true);
      expect(e.short.split(/\s+/).length, `${e.id}: ${e.short}`).toBeLessThanOrEqual(25);
      expect(e.short.trim().endsWith('.'), e.id).toBe(true);
      for (const f of [e.term, ...e.aliases]) {
        const k = f.toLowerCase();
        expect(forms.get(k), `"${f}" in ${e.id} and ${forms.get(k)}`).toBeUndefined();
        forms.set(k, e.id);
      }
    }
  });

  it('defines the terms the owner flagged and the jargon the narration uses', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of ['cepheid', 'spectral-type', 'supergiant', 'open-cluster', 'light-year', 'parallax', 'eclipsing-binary',
      'planetary-nebula', 'globular-cluster', 'white-dwarf', 'supernova', 'magnitude', 'luminosity', 'averted-vision']) {
      expect(ids, id).toContain(id);
    }
    const bank = JSON.parse(readFileSync(resolve(PUBLIC, 'src/narration.json'), 'utf8')) as { variants: Record<string, string[]> };
    const text = Object.values(bank.variants).flat().join(' ');
    const found = new Set(findGlossaryTerms(text, glossary).map((h) => h.id));
    for (const id of ['cepheid', 'parallax', 'supernova', 'white-dwarf', 'light-year', 'ultraviolet']) expect(found, id).toContain(id);
  });
});
