/** UnifiedTarget → VisibilityTarget for the binocular visibility model (./model.ts). */
import type { UnifiedTarget } from '../astronomy';
import { catalogExtent } from '../catalog-extents';
import clusterData from './cluster-stars.json';
import type { ObjectClass, VisibilityKind, VisibilityTarget } from './types';

interface ClusterRecord { brightestStarMag?: number; memberCount?: number }
const CLUSTERS: Record<string, ClusterRecord> = (clusterData as { clusters: Record<string, ClusterRecord> }).clusters;

/** Doubles whose catalogue entry has only a combined magnitude (Messier DS). */
const DOUBLE_OVERRIDES: Record<string, { mag: number; mag2: number; sepArcsec: number }> = {
  M40: { mag: 9.6, mag2: 10.1, sepArcsec: 51.7 }, // Winnecke 4 (WDS 12222+5805)
};

/**
 * Bright inner regions of concentrated nebulae (arcmin, and the V magnitude of the light they hold; estimates from
 * visual descriptions and surface photometry, ±0.5 mag). The generic 0.3·extent core underrates these, e.g. M42's
 * Huygens region stays visible from cities under moonlight.
 */
const NEBULA_CORES: Record<string, { majorArcmin: number; minorArcmin: number; mag: number }> = {
  M42: { majorArcmin: 8, minorArcmin: 6, mag: 4.8 }, // Huygens region + Fish's Mouth surroundings
  M43: { majorArcmin: 4, minorArcmin: 3, mag: 9.0 },
  M8: { majorArcmin: 10, minorArcmin: 6, mag: 6.2 }, // bright western part incl. the Hourglass
  M17: { majorArcmin: 8, minorArcmin: 3, mag: 7.0 }, // the Swan's bar
  NGC3372: { majorArcmin: 20, minorArcmin: 20, mag: 5.0 }, // Keyhole / η Car region
};

/** Category label (UnifiedTarget.category, incl. KB_DSO_CATEGORY labels) → kind and finer class. */
export function classifyCategory(category: string): { kind: VisibilityKind; objectClass: ObjectClass } {
  const c = category.toLowerCase();
  if (c === 'star') return { kind: 'star', objectClass: 'other' };
  if (c.includes('double')) return { kind: 'double', objectClass: 'other' };
  if (c.includes('globular')) return { kind: 'cluster', objectClass: 'globular' };
  if (c.includes('open cluster')) return { kind: 'cluster', objectClass: 'open' };
  if (c.includes('asterism')) return { kind: 'cluster', objectClass: 'asterism' };
  if (c.includes('galaxy')) return { kind: 'extended', objectClass: 'galaxy' };
  if (c.includes('planetary')) return { kind: 'extended', objectClass: 'planetary' };
  if (c.includes('dark')) return { kind: 'extended', objectClass: 'dark' };
  if (c.includes('reflection')) return { kind: 'extended', objectClass: 'reflection' };
  if (c.includes('remnant')) return { kind: 'extended', objectClass: 'snr' };
  // Star clouds are rich star fields: judged like a cluster (glow + resolved stars).
  if (c.includes('milky way') || c.includes('star cloud')) return { kind: 'cluster', objectClass: 'star-cloud' };
  if (c.includes('nebula')) return { kind: 'extended', objectClass: 'emission' };
  return { kind: 'extended', objectClass: 'other' };
}

/** Parse a catalogue size string ("8x5.7′", "1.5°", "60″") into arcmin; null when missing or non-positive. */
export function angularDimensions(size?: string): { major: number; minor: number; circular: boolean } | null {
  if (!size) return null;
  const values = size.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!values?.length || values[0] <= 0 || (values[1] ?? values[0]) <= 0) return null;
  const unit = /°|deg/i.test(size) ? 60 : /″|arcsec|"/.test(size) ? 1 / 60 : 1;
  return { major: values[0] * unit, minor: (values[1] ?? values[0]) * unit, circular: values.length === 1 };
}

/** Angular size in arcmin: catalog-extents (OpenNGC / included catalog) first, then the target's size string. */
function dimensions(t: UnifiedTarget): { major: number; minor: number } | null {
  const ext = catalogExtent(t);
  if (ext) return { major: ext.major * 60, minor: ext.minor * 60 };
  const d = angularDimensions(t.size);
  return d ? { major: d.major, minor: d.minor } : null;
}

export function toVisibilityTarget(t: UnifiedTarget): VisibilityTarget {
  const { kind: baseKind, objectClass } = classifyCategory(t.category);
  const base = { id: t.id, mag: t.mag, ra: t.ra, dec: t.dec, objectClass };

  if (baseKind === 'double') {
    const o = DOUBLE_OVERRIDES[t.id];
    if (o) return { ...base, kind: 'double', ...o };
    if (t.sep !== undefined && t.mag2 !== undefined) return { ...base, kind: 'double', sepArcsec: t.sep, mag2: t.mag2 };
    return { ...base, kind: 'star' };
  }
  if (baseKind === 'star') return { ...base, kind: 'star' };

  const dims = dimensions(t);
  const out: VisibilityTarget = { ...base, kind: baseKind, ...(dims ? { majorArcmin: dims.major, minorArcmin: dims.minor } : {}) };
  if (NEBULA_CORES[t.id] && dims) out.core = NEBULA_CORES[t.id];
  if (baseKind === 'cluster') {
    const rec = CLUSTERS[t.id];
    if (rec?.brightestStarMag !== undefined) out.brightestStarMag = rec.brightestStarMag;
    if (rec?.memberCount !== undefined) out.memberCount = rec.memberCount;
  }
  return out;
}
