import records from './catalog-extents.json';

export interface CatalogExtent {
  /** Full major and minor angular diameters, in degrees, not radii. */
  major: number;
  minor: number;
  /** East of celestial north, in degrees; null means orientation unknown. */
  positionAngle: number | null;
  /** When false, minor equals major only to describe a diameter envelope. */
  minorKnown: boolean;
  source: string;
}

interface ExtentRecord {
  majorArcmin: number;
  minorArcmin: number | null;
  positionAngle: number | null;
  source: string;
}
const extents: Record<string, ExtentRecord> = records;

/** Approximate published footprint; the visible boundary depends on sky and exposure.
 * An unknown PA must be drawn as a diameter envelope, not an invented rotated ellipse.
 * Stars and double stars remain point symbols; these are not stellar diameters.
 */
export function catalogExtent(target: {id: string; size?: string; category?: string}): CatalogExtent | null {
  if (target.id === 'M40' || /^(STAR-|DS-|HR\d)/.test(target.id) || /^(star|double star)$/i.test(target.category ?? '')) return null;
  const record = extents[target.id];
  if (record) return {
    major: record.majorArcmin / 60,
    minor: (record.minorArcmin ?? record.majorArcmin) / 60,
    minorKnown: record.minorArcmin !== null,
    positionAngle: record.positionAngle,
    source: record.source === 'included' ? 'Included observing catalog' : `OpenNGC · ${record.source.replace(/^(NGC|IC)0*/, '$1 ')}`,
  };
  if (!target.size) return null;
  const values = target.size.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!values?.length || values[0] <= 0 || values.length > 2 || (values[1] ?? values[0]) <= 0) return null;
  const factor = /°|deg/i.test(target.size) ? 1 : /″|arcsec|"/.test(target.size) ? 1 / 3600 : 1 / 60;
  const major = values[0] * factor, minor = (values[1] ?? values[0]) * factor;
  if (major > 180 || minor > major) return null;
  return {major, minor, minorKnown: values.length === 2, positionAngle: null, source: 'Included observing catalog'};
}
