/** Shared contract for the local horizon (docs/local-horizon-design.md).
 *  A site's horizon has independent layers that are combined only when asking "is this direction clear?":
 *  - terrain: computed from elevation tiles (hills, mountains, valley walls); exact geometry, no lens calibration;
 *  - photo: obstructions measured from the guided camera sweep (trees, buildings), added in a later phase.
 *  Keeping them separate means a poor photo calibration can never corrupt the terrain horizon. */

export type HorizonLayerKind = 'terrain' | 'photo';

/** Altitude of the skyline for each azimuth bin, degrees. Azimuth is measured from true north through east;
 *  bin i covers azimuth i·stepDeg. Values are apparent (refraction included): where the skyline is seen.
 *  Negative values are real (an observer above the surroundings).
 *  The app's star altitudes are GEOMETRIC: compare them only through lib/horizon/profile.ts, which converts the skyline to
 *  a geometric-equivalent threshold (apparent − Bennett refraction). */
export interface HorizonProfile {
  kind: HorizonLayerKind;
  stepDeg: number;
  alt: number[];
  /** Distance of the skyline for each bin, km (terrain only); tells far terrain (reliable) from near ridges. */
  distanceKm?: number[];
  /** Site this was computed for (degrees) and the ground height used (m). */
  lat: number;
  lon: number;
  groundM?: number;
  /** ISO time of computation. */
  computedAt: string;
  /** Data source label for attribution, e.g. "Mapterhorn (Copernicus GLO-30 and national LiDAR)". */
  source: string;
  /** One-sigma uncertainty of the skyline altitude, degrees (photo layer: alignment and calibration). */
  uncertaintyDeg?: number;
}

/** Everything known about one site's horizon. Missing layers are simply absent. */
export interface LocalHorizon {
  terrain?: HorizonProfile | null;
  photo?: HorizonProfile | null;
}

/** Status of the automatic terrain computation for the UI. */
export type TerrainStatus =
  | { state: 'idle' }
  | { state: 'computing'; progress: number }
  | { state: 'ready'; profile: HorizonProfile }
  | { state: 'error'; message: string }
  | { state: 'offline' };
