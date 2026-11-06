/** Shared contract for the binocular visibility model (docs/binocular-visibility-research.md).
 *  Physics lives in ./model.ts; turning settings and weather into SkyInputs lives in ./conditions.ts. */

/** How the binoculars are held. Tripod/mount is the steadiest; image-stabilized is close to it. */
export type Support = 'handheld' | 'stabilized' | 'tripod';

export interface Optics {
  aperture: number; // mm
  magnification: number;
  fov: number; // true field, degrees
  transmission: number; // 0..1
  support: Support;
}

export interface Observer {
  /** Dark-adapted pupil, mm. Derived from the age bracket; default 6.5. */
  pupil: number;
  /** Crumey field factor F (typical observer 2; experienced ~1.6). */
  fieldFactor: number;
}

/** Haze level the user can name without instruments. 1 = crisp after rain/cold front, 3 = normal, 5 = smoke/heavy haze. */
export type Transparency = 1 | 2 | 3 | 4 | 5;

export interface SkyInputs {
  /** Moonless zenith sky brightness at the site, mag/arcsec² (Bortle/SQM). */
  zenithSqm: number;
  /** Site elevation, metres above sea level (0 when unknown). */
  elevationM: number;
  /** V-band extinction coefficient, mag/airmass, already including elevation and haze. */
  extinctionK: number;
  /** Where extinctionK came from, for the explanation text. */
  extinctionSource: 'forecast' | 'manual' | 'default';
  /** Sun altitude, degrees (twilight brightens the sky). Omit for "full darkness". */
  sunAlt?: number;
  /** Moon state at the time of observation, or null when not relevant. */
  moon?: { alt: number; ra: number; dec: number; phaseAngle: number; illumination: number } | null;
}

export type VisibilityKind = 'extended' | 'star' | 'double' | 'cluster';

export interface VisibilityTarget {
  id: string;
  kind: VisibilityKind;
  /** Integrated V magnitude (primary for doubles). */
  mag: number;
  ra: number; // degrees
  dec: number; // degrees
  majorArcmin?: number;
  minorArcmin?: number;
  /** Doubles. */
  sepArcsec?: number;
  mag2?: number;
  /** Clusters: magnitude of the brightest members (≈ 3rd–5th brightest), when known. */
  brightestStarMag?: number;
  memberCount?: number;
  /** Finer object class (optional). Selects the galaxy/globular "core" variant, the nebula colour correction and the
   *  type-based brightest-star estimate for clusters. */
  objectClass?: ObjectClass;
  /** Known bright inner region (e.g. M42's Huygens region), used as an extra "core" variant: size and the
   *  magnitude of the light it holds. */
  core?: { majorArcmin: number; minorArcmin: number; mag: number };
}

export type ObjectClass =
  | 'galaxy' | 'globular' | 'open' | 'asterism' | 'planetary' | 'emission' | 'reflection' | 'snr' | 'dark' | 'star-cloud' | 'other';

/** 0 Excellent · 1 Good · 2 Fair · 3 Difficult · 4 Not visible */
export type VisibilityLevel = 0 | 1 | 2 | 3 | 4;
export const VISIBILITY_LABELS = ['Excellent', 'Good', 'Fair', 'Difficult', 'Not visible'] as const;

export type LimitFactor =
  // tonight's conditions (fixable by waiting, travelling or a steadier mount)
  | 'moon' | 'light-pollution' | 'haze' | 'altitude' | 'twilight' | 'steadiness'
  // the local skyline (hills) hides it right now (lib/horizon); fixable by waiting
  | 'terrain'
  // the object itself vs these binoculars
  | 'faint' | 'low-surface-brightness' | 'too-small' | 'too-close' | 'unequal-pair' | 'unresolved-stars' | 'larger-than-field';

/**
 * The local skyline in the target's direction (lib/horizon/profile.ts horizonThresholdAt): `alt` is the GEOMETRIC
 * altitude a target must reach to clear it at azimuth `az` (degrees from north through east, for the wording).
 */
export interface SkylineAt {
  alt: number;
  az?: number;
}

export interface Limitation {
  factor: LimitFactor;
  /** One plain-English sentence, e.g. "The Moon, 35° away and 62% lit, brightens the sky around it." */
  text: string;
  /** How much the margin would improve without this limitation (margin units, ≥ 0). */
  gain: number;
}

export interface VisibilityEstimate {
  level: VisibilityLevel;
  label: (typeof VISIBILITY_LABELS)[VisibilityLevel];
  /** log10(object contrast / threshold) for extended objects; equivalent margin for the other kinds. >0 visible. */
  margin: number;
  /** 0..100, for bars and sorting. */
  score: number;
  kind: VisibilityKind;
  /** What you will actually see, one short sentence ("A bright, obvious oval glow", "Splits cleanly into two stars"). */
  appearance: string;
  /** Faintest star the binoculars show tonight at this altitude. */
  limitingMag: number;
  /** Sky brightness in the direction of the target, mag/arcsec² (incl. Moon, twilight, horizon). */
  skyAtTarget: number;
  extinctionMag: number;
  /** Sorted by gain, largest first; only entries that matter (gain ≥ 0.1 or intrinsic). */
  limits: Limitation[];
}
