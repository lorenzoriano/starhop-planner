import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogExtent } from '../catalog-extents';
import extents from '../catalog-extents.json';

describe('catalog angular footprints', () => {
  it('uses the published M31 dimensions and PA east of celestial north', () => {
    const size = catalogExtent({id: 'M31'});
    expect(size?.major).toBeCloseTo(177.83 / 60);
    expect(size?.minor).toBeCloseTo(69.66 / 60);
    expect(size?.positionAngle).toBe(35);
    expect(size?.minorKnown).toBe(true);
    expect(size?.source).toBe('OpenNGC · NGC 224');
  });

  it('keeps missing orientation and axes unknown instead of inventing circular shape', () => {
    const orion = catalogExtent({id: 'M42'});
    expect(orion?.major).toBe(1.5);
    expect(orion?.minor).toBe(1);
    expect(orion?.minorKnown).toBe(true);
    expect(orion?.positionAngle).toBeNull();
    const ring = catalogExtent({id: 'M57'});
    expect(ring?.major).toBeCloseTo(1.27 / 60);
    expect(ring?.minorKnown).toBe(false);
    expect(ring?.positionAngle).toBeNull();
  });

  it('keeps visual cluster footprints instead of swapping in smaller central regions', () => {
    expect(catalogExtent({id: 'M45'})?.major).toBeCloseTo(110 / 60);
    expect(catalogExtent({id: 'NGC869'})?.major).toBeCloseTo(30 / 60);
    expect(catalogExtent({id: 'NGC884'})?.major).toBeCloseTo(30 / 60);
    expect(catalogExtent({id: 'M45'})?.source).toBe('Included observing catalog');
  });

  it('covers every included extended target, while leaving stellar diameters out', () => {
    const messier = JSON.parse(readFileSync('client/public/data/messier.json', 'utf8')) as {M: string; T: string}[];
    const binocular = JSON.parse(readFileSync('client/public/data/binocular-catalog.json', 'utf8')) as {id: string; cat: string}[];
    const extended = [...messier.filter(o => o.T !== 'DS').map(o => o.M), ...binocular.filter(o => o.cat !== 'STAR' && o.cat !== 'DS').map(o => o.id)];
    expect(extended).toHaveLength(253);
    expect(Object.keys(extents).sort()).toEqual(extended.sort());
    for (const id of extended) {
      const size = catalogExtent({id});
      expect(size, id).not.toBeNull();
      expect(size!.major, id).toBeGreaterThan(0);
      expect(size!.major, id).toBeLessThanOrEqual(180);
      expect(size!.minor, id).toBeGreaterThan(0);
      expect(size!.minor, id).toBeLessThanOrEqual(size!.major);
      if (size!.positionAngle !== null) expect(size!.positionAngle, id).toBeGreaterThanOrEqual(0);
    }
    for (const target of binocular.filter(o => o.cat === 'STAR' || o.cat === 'DS')) expect(catalogExtent({id: target.id, size: '30'})).toBeNull();
    expect(catalogExtent({id: 'M40'})).toBeNull();
  });

  it('converts degrees, arcminutes and arcseconds without assigning an arbitrary unknown size', () => {
    expect(catalogExtent({id: 'custom', size: '2.5°'})?.major).toBe(2.5);
    expect(catalogExtent({id: 'custom', size: '13×6.5′'})?.minor).toBeCloseTo(6.5 / 60);
    expect(catalogExtent({id: 'custom', size: '60″'})?.major).toBeCloseTo(1 / 60);
    expect(catalogExtent({id: 'custom', size: '316’X186′'})?.major).toBeCloseTo(316 / 60);
    expect(catalogExtent({id: 'custom', size: 'unknown'})).toBeNull();
    expect(catalogExtent({id: 'custom', size: '0′'})).toBeNull();
    expect(catalogExtent({id: 'custom', size: '2x4′'})).toBeNull();
    expect(catalogExtent({id: 'custom', size: '200°'})).toBeNull();
    expect(catalogExtent({id: 'unknown'})).toBeNull();
    expect(catalogExtent({id: 'star', category: 'Star', size: '10′'})).toBeNull();
  });
});
