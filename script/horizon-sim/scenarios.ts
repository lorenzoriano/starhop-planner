/**
 * Simulation scenarios and pass criteria (docs/local-horizon-design.md, 10.2 table). Every script takes
 * `--scenario <name>` and writes into <OUT_ROOT>/<name>/. `npx tsx script/horizon-sim/scenarios.ts` lists them.
 */

export interface ScenarioConfig {
  name: string;
  description: string;
  seed: number;
  /** Site (the DEM is synthetic, so the place only sets the sky and the declination). */
  lat: number;
  lon: number;
  /** Scene time, ISO UTC (the page clock is fixed to it). */
  time: string;
  /** Sky rendering: day (blue, Sun drawn), overcast (grey, no Sun), twilight, night (stars + Moon). */
  sky: 'day' | 'overcast' | 'twilight' | 'night';
  terrain: 'hills' | 'flat';
  /** Near obstructions. */
  trees: number;
  buildings: number;
  /** Camera. */
  hfovDeg: number;
  k1: number;
  /** Stabilisation-crop model: principal point shift in px per °/s of rotation (0 = off). */
  stabPxPerDegPerSec: number;
  /** Sweep. */
  ring1: boolean;
  /** What the alignment step taps: the Sun, the Moon, or nothing (press Skip). */
  tap: 'sun' | 'moon' | 'none';
  /** Night: trace the skyline with the finger (true skyline + noise). */
  trace: boolean;
  traceNoiseDeg: number;
  /** Truth: true azimuth = relative-sensor azimuth + northOffsetDeg. */
  northOffsetDeg: number;
  /** Starting true heading of the sweep. */
  startAzDeg: number;
  /** Gyro drift about the vertical: bias °/s and random walk °/√s. */
  gyroBiasDegPerSec: number;
  gyroWalkDegPerRootSec: number;
  /** Compass: constant bias (°), heading-dependent deviation amplitude (°) and phase, white noise σ (°). */
  compassBiasDeg: number;
  compassDeviationDeg: number;
  compassDeviationPhaseDeg: number;
  compassNoiseDeg: number;
  /** World image width (equirect, height = width/2). */
  worldWidth: number;
  /** Pass criteria, checked by run.ts (each optional). */
  checks: {
    fovRelErr?: number;
    yawErrDeg?: number;
    skylineMaeDeg?: number;
    yawSource?: string[];
    terrainDeclines?: boolean;
    compassSigmaMin?: number;
    disagreement?: boolean;
    relYawErrDeg?: number;
    edgeErrDeg?: number;
    measureOnly?: boolean;
  };
}

const BASE: Omit<ScenarioConfig, 'name' | 'description' | 'checks'> = {
  seed: 1,
  lat: 45.07,
  lon: 7.69,
  time: '2026-11-06T12:30:00Z',
  sky: 'day',
  terrain: 'hills',
  trees: 7,
  buildings: 3,
  hfovDeg: 63.4,
  k1: 0,
  stabPxPerDegPerSec: 0,
  ring1: false,
  tap: 'sun',
  trace: false,
  traceNoiseDeg: 0.3,
  northOffsetDeg: 137.3,
  startAzDeg: 20,
  gyroBiasDegPerSec: 0.008,
  gyroWalkDegPerRootSec: 0.002,
  compassBiasDeg: 6,
  compassDeviationDeg: 5,
  compassDeviationPhaseDeg: 40,
  compassNoiseDeg: 1,
  worldWidth: 4096,
};

const list: ScenarioConfig[] = [
  {
    ...BASE, name: 'day-sun-hills', description: 'Day, Sun visible, hills',
    checks: { fovRelErr: 0.01, yawErrDeg: 0.5, skylineMaeDeg: 1, yawSource: ['sun'] },
  },
  {
    ...BASE, name: 'overcast-hills', description: 'Overcast day, no Sun, hills', sky: 'overcast', tap: 'none', seed: 2, northOffsetDeg: 251.8,
    checks: { fovRelErr: 0.01, yawErrDeg: 2, yawSource: ['terrain'] },
  },
  {
    ...BASE, name: 'flat-backyard', description: 'Flat backyard, no Sun', sky: 'overcast', tap: 'none', terrain: 'flat', seed: 3,
    trees: 9, buildings: 4, northOffsetDeg: 12.5,
    checks: { terrainDeclines: true, yawSource: ['compass'], compassSigmaMin: 5 },
  },
  {
    ...BASE, name: 'night-moon-trace', description: 'Night, Moon tap, finger trace', sky: 'night', tap: 'moon', trace: true,
    time: '2026-11-24T18:00:00Z', seed: 4, northOffsetDeg: 300.2, startAzDeg: 60,
    checks: { yawErrDeg: 1, skylineMaeDeg: 1, yawSource: ['moon'] },
  },
  {
    ...BASE, name: 'compass-bias', description: 'Compass bias 25° + deviation 8°', seed: 5, compassBiasDeg: 25, compassDeviationDeg: 8,
    checks: { disagreement: true, yawSource: ['sun'], yawErrDeg: 0.5 },
  },
  {
    ...BASE, name: 'gyro-drift', description: 'Gyro drift 1°/min', seed: 6, gyroBiasDegPerSec: 1 / 60, gyroWalkDegPerRootSec: 0.004,
    checks: { relYawErrDeg: 1, yawErrDeg: 1 },
  },
  {
    ...BASE, name: 'distortion-k1', description: 'Distortion k1', seed: 7, k1: -0.08, ring1: true,
    checks: { edgeErrDeg: 0.5, fovRelErr: 0.01 },
  },
  {
    ...BASE, name: 'stab-crop', description: 'Stabilisation crop on (measure only)', seed: 8, stabPxPerDegPerSec: 0.6,
    checks: { measureOnly: true },
  },
];

export const SCENARIOS: Record<string, ScenarioConfig> = Object.fromEntries(list.map((s) => [s.name, s]));

export function scenario(name: string | undefined): ScenarioConfig {
  const s = name ? SCENARIOS[name] : undefined;
  if (!s) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  return s;
}

if (process.argv[1]?.endsWith('scenarios.ts')) {
  for (const s of list) console.log(`${s.name.padEnd(18)} ${s.description}  checks: ${JSON.stringify(s.checks)}`);
}
