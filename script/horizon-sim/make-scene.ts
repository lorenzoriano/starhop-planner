/**
 * Scene generator (design 10.2 step 1): a deterministic world for one scenario.
 *
 *   npx tsx script/horizon-sim/make-scene.ts --scenario day-sun-hills
 *
 * Writes to <OUT_ROOT>/<scenario>/:
 * - world.rgb: equirectangular RGB (width × width/2; column x at azimuth (x+0.5)·360/W, row y at altitude
 *   90 − (y+0.5)·180/H), apparent sky positions;
 * - world-preview.png (half size, with the true skyline in red);
 * - truth.json: true skyline per 0.25° (apparent), terrain skylines (0.25° and the app's 1°), true sky grid (SkyGrid
 *   geometry, base64 alpha), camera (HFOV, k1, size), north offset, compass model and declination, Sun/Moon, the DEM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { angleDiffDeg } from '../../client/src/lib/horizon/calibrate/quat';
import { GRID_ALT_MAX, GRID_ALT_MIN, GRID_STEP_DEG } from '../../client/src/lib/horizon/photo-types';
import { args, encodePng, fbm, outDir, RAD, rng, valueNoise, writeJson } from './lib/common';
import { makeDem, terrainTruth, type DemSpec } from './lib/dem';
import { bodyPosition, lightFor, starsAt, type SkyBody } from './lib/sky';
import { scenario, type ScenarioConfig } from './scenarios';

const geomagnetism = createRequire(import.meta.url)('geomagnetism') as typeof import('geomagnetism');

/** Logical camera image (what the app sees after the barcode strip is cropped). */
export const CAMERA = { width: 1280, height: 948, videoHeight: 960, fps: 30 } as const;

export interface Building { az0: number; az1: number; top: number; base: number; color: [number, number, number] }
export interface Tree { az: number; alt: number; rx: number; ry: number; trunkW: number; base: number; seed: number; color: [number, number, number] }

export interface Truth {
  scenario: ScenarioConfig;
  site: { lat: number; lon: number; groundM: number };
  time: string;
  light: 'day' | 'twilight' | 'night';
  camera: { width: number; height: number; hfovDeg: number; k1: number; screenAngle: number };
  northOffsetDeg: number;
  declinationDeg: number;
  compass: { biasDeg: number; deviationDeg: number; deviationPhaseDeg: number; noiseDeg: number };
  gyro: { biasDegPerSec: number; walkDegPerRootSec: number };
  sun: SkyBody;
  moon: SkyBody;
  tapTarget: { body: 'sun' | 'moon'; az: number; alt: number } | null;
  startAzDeg: number;
  stepDeg: number;
  /** Apparent skyline per 0.25° (terrain + near obstructions; foliage gaps ignored). */
  skyline: number[];
  /** Terrain only, per 0.25° and per 1° (what the app's terrain layer should hold). */
  terrain: number[];
  terrain1: number[];
  grid: { stepDeg: number; altMinDeg: number; altMaxDeg: number; width: number; height: number; alphaB64: string };
  buildings: Building[];
  trees: Tree[];
  dem: DemSpec;
  world: { file: string; width: number; height: number };
}

// ───────────────────────────── obstructions ─────────────────────────────

function avoidAz(az: number, halfWidth: number, keepOut: number[]) {
  return keepOut.some((k) => Math.abs(angleDiffDeg(az, k)) < halfWidth + 15);
}

function makeObstructions(s: ScenarioConfig, keepOut: number[]): { buildings: Building[]; trees: Tree[] } {
  const r = rng(s.seed * 104729 + 7);
  const buildings: Building[] = [], trees: Tree[] = [];
  for (let i = 0, tries = 0; i < s.buildings && tries < 200; tries++) {
    const az = r() * 360, w = 8 + r() * 16;
    if (avoidAz(az, w / 2, keepOut) || buildings.some((b) => Math.abs(angleDiffDeg(az, (b.az0 + b.az1) / 2)) < w)) continue;
    const g = 120 + r() * 80;
    buildings.push({ az0: az - w / 2, az1: az + w / 2, top: 4 + r() * 9, base: -4 - r() * 6, color: [g, g * (0.85 + r() * 0.15), g * (0.7 + r() * 0.2)] });
    i++;
  }
  for (let i = 0, tries = 0; i < s.trees && tries < 300; tries++) {
    const az = r() * 360, rx = 3 + r() * 5, ry = 4 + r() * 4;
    if (avoidAz(az, rx * 1.3, keepOut)) continue;
    trees.push({
      az, alt: 8 + r() * 10, rx, ry, trunkW: 0.4 + r() * 0.6, base: -5 - r() * 8, seed: Math.floor(r() * 1e6),
      color: [30 + r() * 30, 70 + r() * 40, 25 + r() * 25],
    });
    i++;
  }
  return { buildings, trees };
}

const azIn = (az: number, a0: number, a1: number) => {
  const d = (((az - a0) % 360) + 360) % 360;
  return d <= a1 - a0;
};

/** Crown boundary radius (in units of rx/ry) at angle θ around the crown centre. */
function crownBoundary(t: Tree, theta: number) {
  return 1 + 0.36 * (valueNoise(Math.cos(theta) * 2.2 + 10, Math.sin(theta) * 2.2 + 10, t.seed) - 0.5);
}

/** 0 = not the tree, 1 = foliage/trunk, 2 = gap inside the crown (sky shows through). */
export function treeHit(t: Tree, az: number, alt: number): 0 | 1 | 2 {
  const dx = angleDiffDeg(az, t.az) / t.rx, dy = (alt - t.alt) / t.ry;
  const rho = Math.hypot(dx, dy);
  if (rho < crownBoundary(t, Math.atan2(dy, dx))) {
    // See-through gaps, more towards the edge of the crown.
    const n = fbm(az * 1.4, alt * 1.4, t.seed, 3);
    return n > 0.7 - 0.12 * rho ? 2 : 1;
  }
  if (alt < t.alt && alt > t.base && Math.abs(angleDiffDeg(az, t.az)) < t.trunkW) return 1;
  return 0;
}

/** Top of a tree's crown (ignoring gaps) at an azimuth, or −90 where the tree is absent. */
function treeTop(t: Tree, az: number): number {
  const dxDeg = angleDiffDeg(az, t.az);
  if (Math.abs(dxDeg) > t.rx * 1.25) return -90;
  for (let alt = t.alt + t.ry * 1.25; alt > t.alt - t.ry * 1.25; alt -= 0.01) {
    if (treeHit(t, az, alt) !== 0) return alt;
  }
  return Math.abs(dxDeg) < t.trunkW ? t.alt : -90;
}

// ───────────────────────────── rendering ─────────────────────────────

const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface SceneModel {
  s: ScenarioConfig;
  terrainAt: (az: number) => number;
  buildings: Building[];
  trees: Tree[];
  sun: SkyBody;
  moon: SkyBody;
}

/** Is the direction open sky (ignores sky bodies)? */
export function isSky(m: SceneModel, az: number, alt: number): boolean {
  if (alt <= m.terrainAt(az)) return false;
  for (const b of m.buildings) if (alt <= b.top && alt > b.base && azIn(az, b.az0, b.az1)) return false;
  for (const t of m.trees) if (treeHit(t, az, alt) === 1) return false;
  return true;
}

function angDist(az1: number, alt1: number, az2: number, alt2: number) {
  const c = Math.sin(alt1 * RAD) * Math.sin(alt2 * RAD) + Math.cos(alt1 * RAD) * Math.cos(alt2 * RAD) * Math.cos((az1 - az2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

function skyColor(m: SceneModel, az: number, alt: number): number[] {
  const t = Math.max(0, Math.min(1, alt / 60));
  const sky = m.s.sky;
  if (sky === 'day') {
    let c = mix([195, 212, 232], [70, 120, 200], Math.pow(t, 0.7));
    const d = angDist(az, alt, m.sun.az, m.sun.alt);
    const glow = 70 * Math.exp(-d / 10) + 120 * Math.exp(-d / 1.2);
    c = c.map((v) => v + glow);
    if (d < m.sun.radiusDeg) c = [255, 255, 250];
    return c;
  }
  if (sky === 'overcast') {
    const cloud = (fbm(az / 9, alt / 6, 77, 4) - 0.5) * 18;
    return mix([214, 217, 221], [168, 173, 181], t).map((v) => v + cloud);
  }
  if (sky === 'twilight') {
    const toward = Math.max(0, Math.cos(angleDiffDeg(az, m.sun.az) * RAD));
    return mix(mix([120, 110, 140], [235, 150, 90], toward), [25, 35, 85], Math.pow(t, 0.6));
  }
  // Night: dark, a little light pollution near the horizon, a halo around the Moon.
  let c = mix([24, 25, 34], [4, 6, 14], Math.pow(t, 0.5));
  if (m.moon.alt > -2) {
    const d = angDist(az, alt, m.moon.az, m.moon.alt);
    const halo = 40 * Math.exp(-d / 6) + 60 * Math.exp(-d / 0.8);
    c = c.map((v) => v + halo);
    if (d < m.moon.radiusDeg) c = [236, 234, 222];
  }
  return c;
}

function groundColor(m: SceneModel, az: number, alt: number, terrainAlt: number): number[] {
  const night = m.s.sky === 'night', dim = m.s.sky === 'overcast' ? 0.85 : m.s.sky === 'twilight' ? 0.45 : 1;
  const tex = fbm(az * 2.2, alt * 2.2, 5, 4) - 0.5, fine = valueNoise(az * 9, alt * 9, 9) - 0.5;
  if (night) return [14 + tex * 10, 15 + tex * 10, 19 + tex * 10];
  const depth = terrainAlt - alt;
  // Distant hills: hazy blue-green; near ground below the horizon: greener and darker.
  const far = [118, 135, 140], near = [72, 98, 52];
  const base = alt > -1 ? mix(far, [96, 118, 92], Math.min(1, depth / 4)) : mix([90, 110, 70], near, Math.min(1, (-1 - alt) / 10));
  return base.map((v) => (v + tex * 70 + fine * 25) * dim);
}

function obstructionColor(m: SceneModel, az: number, alt: number): number[] | null {
  const night = m.s.sky === 'night', dim = m.s.sky === 'overcast' ? 0.85 : m.s.sky === 'twilight' ? 0.4 : 1;
  for (const t of m.trees) {
    if (treeHit(t, az, alt) === 1) {
      if (night) return [6, 8, 6];
      const trunk = alt < t.alt - t.ry * 0.6 && Math.abs(angleDiffDeg(az, t.az)) < t.trunkW;
      const n = fbm(az * 3, alt * 3, t.seed + 1, 3);
      return (trunk ? [70, 52, 36] : t.color).map((v) => v * (0.55 + 0.9 * n) * dim);
    }
  }
  for (const b of m.buildings) {
    if (alt <= b.top && alt > b.base && azIn(az, b.az0, b.az1)) {
      if (night) return [12, 12, 15];
      const lx = ((az - b.az0) % 360 + 360) % 360;
      const win = (lx % 2.4) > 0.6 && (lx % 2.4) < 1.6 && (alt % 2.0 + 2.0) % 2.0 > 0.6 && (alt % 2.0 + 2.0) % 2.0 < 1.4 && alt < b.top - 0.8;
      const c = win ? [60, 75, 95] : b.color;
      const n = valueNoise(az * 6, alt * 6, 3) - 0.5;
      return c.map((v) => (v + n * 20) * dim);
    }
  }
  return null;
}

/** Render the equirectangular world (RGB). */
function renderWorld(m: SceneModel, W: number, stars: { az: number; alt: number; mag: number }[]): Uint8Array {
  const H = W / 2;
  const rgb = new Uint8Array(W * H * 3);
  // Star layer, splatted with a small Gaussian.
  const starLayer = new Float32Array(W * H);
  if (m.s.sky === 'night') {
    const sigmaPx = 0.7;
    for (const s of stars) {
      const x = (s.az / 360) * W - 0.5, y = ((90 - s.alt) / 180) * H - 0.5;
      const I = 255 * Math.min(1.6, Math.pow(10, -0.4 * (s.mag - 1.2)));
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (py < 0 || py >= H) continue;
        const w = Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * sigmaPx * sigmaPx));
        starLayer[py * W + ((px % W) + W) % W] += I * w;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const alt = 90 - ((y + 0.5) * 180) / H;
    for (let x = 0; x < W; x++) {
      const az = ((x + 0.5) * 360) / W;
      const ta = m.terrainAt(az);
      let c = alt < GRID_ALT_MAX + 25 ? obstructionColor(m, az, alt) : null;
      if (!c) c = alt <= ta ? groundColor(m, az, alt, ta) : skyColor(m, az, alt).map((v) => v + starLayer[y * W + x]);
      const j = (y * W + x) * 3;
      rgb[j] = Math.max(0, Math.min(255, Math.round(c[0])));
      rgb[j + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      rgb[j + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
    }
  }
  return rgb;
}

// ───────────────────────────── main ─────────────────────────────

export function sceneDir(name: string) {
  return outDir(name);
}

export function loadTruth(name: string): Truth {
  return JSON.parse(fs.readFileSync(path.join(sceneDir(name), 'truth.json'), 'utf8')) as Truth;
}

export function loadWorld(truth: Truth): Uint8Array {
  return new Uint8Array(fs.readFileSync(truth.world.file));
}

export function makeScene(s: ScenarioConfig): Truth {
  const dir = sceneDir(s.name);
  const date = new Date(s.time);
  const sun = bodyPosition('Sun', date, s.lat, s.lon), moon = bodyPosition('Moon', date, s.lat, s.lon);
  const light = lightFor(sun.geoAlt);
  const tapBody = s.tap === 'sun' ? sun : s.tap === 'moon' ? moon : null;
  if (tapBody && tapBody.alt < 5) throw new Error(`${s.tap} is not up (${tapBody.alt.toFixed(1)}°) at ${s.time}`);
  const dem = makeDem(s.seed, s.lat, s.lon, s.terrain);
  const t0 = Date.now();
  const terrainP = terrainTruth(dem, GRID_STEP_DEG);
  const terrain1 = terrainTruth(dem, 1);
  console.log(`terrain truth: ${(Date.now() - t0) / 1000}s, ground ${terrainP.groundM} m`);
  const keepOut = tapBody ? [tapBody.az] : [];
  const { buildings, trees } = makeObstructions(s, keepOut);
  const n = terrainP.alt.length, step = GRID_STEP_DEG;
  const terrainAt = (az: number) => {
    const f = ((((az / step) % n) + n) % n), i = Math.floor(f), t = f - i;
    return terrainP.alt[i] * (1 - t) + terrainP.alt[(i + 1) % n] * t;
  };
  const model: SceneModel = { s, terrainAt, buildings, trees, sun, moon };

  // True skyline per 0.25° (foliage gaps ignored) and the true sky grid (4×4 supersampled).
  const skyline = terrainP.alt.map((ta, i) => {
    const az = i * step;
    let top = ta;
    for (const b of buildings) if (azIn(az, b.az0, b.az1)) top = Math.max(top, b.top);
    for (const t of trees) top = Math.max(top, treeTop(t, az));
    return Number(top.toFixed(3));
  });
  const gw = Math.round(360 / step), gh = Math.round((GRID_ALT_MAX - GRID_ALT_MIN) / step);
  const alpha = new Uint8Array(gw * gh);
  for (let row = 0; row < gh; row++) {
    for (let col = 0; col < gw; col++) {
      let sky = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const az = col * step + ((sx + 0.5) / 4 - 0.5) * step;
        const alt = GRID_ALT_MAX - (row + (sy + 0.5) / 4) * step;
        if (isSky(model, az, alt)) sky++;
      }
      alpha[row * gw + col] = Math.round((sky / 16) * 255);
    }
  }

  const stars = s.sky === 'night' ? starsAt(date, s.lat, s.lon, 6, -2) : [];
  const t1 = Date.now();
  const world = renderWorld(model, s.worldWidth, stars);
  console.log(`world ${s.worldWidth}×${s.worldWidth / 2}: ${(Date.now() - t1) / 1000}s, ${stars.length} stars`);
  const worldFile = path.join(dir, 'world.rgb');
  fs.writeFileSync(worldFile, world);

  // Preview at half size with the true skyline in red.
  const PW = s.worldWidth / 2, PH = PW / 2, prev = new Uint8Array(PW * PH * 3);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const j = ((y * 2) * s.worldWidth + x * 2) * 3, k = (y * PW + x) * 3;
    prev[k] = world[j]; prev[k + 1] = world[j + 1]; prev[k + 2] = world[j + 2];
  }
  for (let i = 0; i < skyline.length; i++) {
    const x = Math.floor(((i * step) / 360) * PW), y = Math.round(((90 - skyline[i]) / 180) * PH);
    if (y >= 0 && y < PH) { const k = (y * PW + x) * 3; prev[k] = 255; prev[k + 1] = 0; prev[k + 2] = 0; }
  }
  fs.writeFileSync(path.join(dir, 'world-preview.png'), encodePng(PW, PH, prev, 3));

  const declinationDeg = geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([s.lat, s.lon]).decl;
  const truth: Truth = {
    scenario: s,
    site: { lat: s.lat, lon: s.lon, groundM: terrainP.groundM ?? 0 },
    time: s.time,
    light,
    camera: { width: CAMERA.width, height: CAMERA.height, hfovDeg: s.hfovDeg, k1: s.k1, screenAngle: 90 },
    northOffsetDeg: s.northOffsetDeg,
    declinationDeg,
    compass: { biasDeg: s.compassBiasDeg, deviationDeg: s.compassDeviationDeg, deviationPhaseDeg: s.compassDeviationPhaseDeg, noiseDeg: s.compassNoiseDeg },
    gyro: { biasDegPerSec: s.gyroBiasDegPerSec, walkDegPerRootSec: s.gyroWalkDegPerRootSec },
    sun, moon,
    tapTarget: tapBody ? { body: s.tap as 'sun' | 'moon', az: tapBody.az, alt: tapBody.alt } : null,
    startAzDeg: s.startAzDeg,
    stepDeg: step,
    skyline,
    terrain: terrainP.alt,
    terrain1: terrain1.alt,
    grid: { stepDeg: step, altMinDeg: GRID_ALT_MIN, altMaxDeg: GRID_ALT_MAX, width: gw, height: gh, alphaB64: Buffer.from(alpha).toString('base64') },
    buildings, trees, dem,
    world: { file: worldFile, width: s.worldWidth, height: s.worldWidth / 2 },
  };
  writeJson(path.join(dir, 'truth.json'), truth);
  return truth;
}

if (process.argv[1]?.endsWith('make-scene.ts')) {
  const a = args();
  const t = makeScene(scenario(a.scenario));
  const max = Math.max(...t.skyline), min = Math.min(...t.skyline);
  console.log(`${t.scenario.name}: light ${t.light}, sun ${t.sun.az.toFixed(1)}/${t.sun.alt.toFixed(1)}, moon ${t.moon.az.toFixed(1)}/${t.moon.alt.toFixed(1)}, ` +
    `skyline ${min.toFixed(1)}…${max.toFixed(1)}°, declination ${t.declinationDeg.toFixed(2)}°, ${t.buildings.length} buildings, ${t.trees.length} trees`);
}
