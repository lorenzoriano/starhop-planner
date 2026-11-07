/**
 * Playwright runner (design 10.2 step 5): drives the real capture page in Chrome with the synthetic scene and compares
 * what the app saves with the truth.
 *
 *   NODE_PATH=<dir containing playwright> npx tsx script/horizon-sim/run.ts --scenario day-sun-hills
 *     [--base http://localhost:5173/]   use a running dev server (default: start one on PORT or 5173, stop it after)
 *     [--rebuild]                       regenerate scene, video and sensors even if present
 *     [--headed]                        show the browser
 *
 * - Chrome: fake camera from scene.y4m (looped by Chrome), fake permission UI; camera, motion sensors and
 *   geolocation granted; Pixel 7 in landscape (screen.orientation.angle forced to 90 if the emulation says otherwise);
 *   page clock fixed at the scene time (Date only; timers and performance.now keep running).
 * - Sensors: CDP Emulation.setSensorOverrideEnabled/Readings for relative-orientation, absolute-orientation,
 *   accelerometer and gyroscope; the init script (lib/inject.ts) reports the barcode frame number of every camera
 *   frame and the runner pushes that frame's readings.
 * - Tiles: the scene's DEM served for Mapterhorn and AWS Terrarium (tiles.ts).
 * - UI: site dialog → horizon panel → "Add trees and buildings" → "Start" → (ring 0) → "Add the tall-tree ring" or
 *   "Finish sweep" → "Tap when centred" during the alignment hold, or "Skip" → (night: trace in horizon-trace) → "Save".
 * - Result: localStorage photo layer + camera calibration, IndexedDB `starhop-horizon`/`sites`; report.json and
 *   screenshots in the scenario folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { pixelToWorld } from '../../client/src/lib/horizon/calibrate/camera';
import { angleDiffDeg, IDENTITY } from '../../client/src/lib/horizon/calibrate/quat';
import { horizonSiteKey } from '../../client/src/lib/horizon/store';
import type { HorizonProfile } from '../../client/src/lib/horizon/types';
import { args, BARCODE, gaussian, RAD, REPO, rng, writeJson } from './lib/common';
import { simInit } from './lib/inject';
import { loadTruth, makeScene, sceneDir, type Truth } from './make-scene';
import { makeVideo, type PosesFile } from './make-video';
import { loadPoses, simulateSensors, type SensorFrame } from './sensors';
import { scenario, type ScenarioConfig } from './scenarios';
import { installTileRoutes } from './tiles';

const require = createRequire(import.meta.url);
function loadPlaywright(): typeof import('playwright') {
  const dirs = [process.env.NODE_PATH, '/home/lorenzo/.npm/_npx/705bc6b22212b352/node_modules'].filter(Boolean) as string[];
  for (const d of dirs) {
    try { return require(path.join(d, 'playwright')) as typeof import('playwright'); } catch { /* next */ }
  }
  return require('playwright') as typeof import('playwright');
}

/** Review strip geometry (capture/review.ts azAltToStrip: PANORAMA_ALT_MAX at the top, PANORAMA_ALT_MIN at the bottom). */
const PANO_MAX = 80, PANO_MIN = -10;

// ───────────────────────────── dev server ─────────────────────────────

async function startServer(port: number, logFile: string): Promise<{ base: string; child: ChildProcess }> {
  const log = fs.openSync(logFile, 'w');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: REPO, env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', log, log],
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const text = fs.readFileSync(logFile, 'utf8');
    const m = text.match(/serving on http:\/\/localhost:(\d+)/);
    if (m) return { base: `http://localhost:${m[1]}/`, child };
    if (child.exitCode !== null) throw new Error(`dev server exited: ${text.slice(-500)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('dev server did not start within 60 s');
}

// ───────────────────────────── scenario assets ─────────────────────────────

function ensureAssets(s: ScenarioConfig, rebuild: boolean): { truth: Truth; poses: PosesFile; sensors: SensorFrame[] } {
  const dir = sceneDir(s.name);
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (rebuild || !has('truth.json') || !has('world.rgb')) makeScene(s);
  if (rebuild || !has('scene.y4m') || !has('poses.json')) makeVideo(s.name);
  const truth = loadTruth(s.name), poses = loadPoses(s.name);
  const sensors = simulateSensors(truth, poses);
  writeJson(path.join(dir, 'sensors.json'), sensors);
  return { truth, poses, sensors };
}

// ───────────────────────────── evaluation ─────────────────────────────

interface StoredResult {
  photo: HorizonProfile | null;
  terrain: HorizonProfile | null;
  calibration: unknown;
  idb: Array<{ key: string; record: Record<string, unknown>; grid: { width: number; height: number; stepDeg: number; altMinDeg: number; altMaxDeg: number; alphaB64: string; knownB64: string } | null; panoramaB64: string | null; panoramaType: string | null }>;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Truth skyline at any azimuth (linear between 0.25° bins). */
function truthAt(truth: Truth, az: number) {
  const n = truth.skyline.length, f = ((((az / truth.stepDeg) % n) + n) % n), i = Math.floor(f), t = f - i;
  return truth.skyline[i] * (1 - t) + truth.skyline[(i + 1) % n] * t;
}

/** Mean absolute error of a profile against the truth after shifting it by `shift` degrees (profile az + shift). */
function profileMae(p: HorizonProfile, truth: Truth, shift = 0, from = 0, to = 360) {
  const errs: number[] = [];
  p.alt.forEach((a, i) => {
    const az = i * p.stepDeg;
    if (((az - from + 360) % 360) > ((to - from + 360) % 360 || 360)) return;
    errs.push(Math.abs(a - truthAt(truth, az + shift)));
  });
  return mean(errs);
}

function bestShift(p: HorizonProfile, truth: Truth, from = 0, to = 360, range = 10) {
  let best = { shift: 0, mae: Infinity };
  for (let s = -range; s <= range + 1e-9; s += 0.05) {
    const mae = profileMae(p, truth, s, from, to);
    if (mae < best.mae) best = { shift: Number(s.toFixed(2)), mae };
  }
  return best;
}

/** Largest angular error (°) at the image edge between the solved and the true intrinsics (same pose). */
function edgeError(truth: Truth, hfov: number, k1: number | undefined) {
  const W = truth.camera.width, H = truth.camera.height;
  const solved = { width: W, height: H, hfovDeg: hfov, k1: k1 ?? 0 }, actual = { width: W, height: H, hfovDeg: truth.camera.hfovDeg, k1: truth.camera.k1 };
  let worst = 0;
  for (const [u, v] of [[0, H / 2], [W, H / 2], [W / 2, 0], [W / 2, H], [0, 0], [W, H], [W * 0.25, H / 2], [W * 0.75, 0]]) {
    const a = pixelToWorld({ q: IDENTITY, screenAngle: 90 }, solved, u, v), b = pixelToWorld({ q: IDENTITY, screenAngle: 90 }, actual, u, v);
    worst = Math.max(worst, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / RAD);
  }
  return worst;
}

function evaluate(s: ScenarioConfig, truth: Truth, poses: PosesFile, sensors: SensorFrame[], result: StoredResult, ui: Record<string, unknown>) {
  const c = s.checks;
  const rec = result.idb[0]?.record as undefined | {
    camera: { hfovDeg: number; k1?: number; sigmaDeg: number };
    yaw: { chosen: { source: string; offsetDeg: number; sigmaDeg: number; label: string }; fixes: Array<{ source: string; offsetDeg: number; sigmaDeg: number }>; disagreement?: string };
    segmentation: string; frames: number;
  };
  const out: Record<string, unknown> = {};
  const checks: Array<{ name: string; pass: boolean; value: unknown; limit: unknown }> = [];
  const check = (name: string, pass: boolean, value: unknown, limit: unknown) => checks.push({ name, pass, value, limit });
  if (!rec) {
    check('saved', false, 'no IndexedDB record', 'a saved photo horizon');
    return { checks, out };
  }
  // Drift the app should have absorbed: mean over the sweep holds; at the alignment hold for a tap.
  const holdDrift = mean(poses.frames.filter((f) => /^(start|ring)/.test(f.phase)).map((f) => sensors[f.i].driftDeg));
  const alignDrift = mean(poses.frames.filter((f) => f.phase === 'align').map((f) => sensors[f.i].driftDeg));
  const trueOffset = truth.northOffsetDeg + (s.tap !== 'none' ? alignDrift : holdDrift);
  const yawErr = angleDiffDeg(rec.yaw.chosen.offsetDeg, trueOffset);
  const fovRel = rec.camera.hfovDeg / truth.camera.hfovDeg - 1;
  out.record = { camera: rec.camera, yaw: rec.yaw, segmentation: rec.segmentation, frames: rec.frames };
  out.truth = { hfovDeg: truth.camera.hfovDeg, k1: truth.camera.k1, northOffsetDeg: truth.northOffsetDeg, holdDrift, alignDrift, trueOffset, declinationDeg: truth.declinationDeg, compass: truth.compass };
  out.yawErrDeg = yawErr;
  out.fovRelErr = fovRel;
  out.fixErrors = rec.yaw.fixes.map((f) => ({ source: f.source, errDeg: angleDiffDeg(f.offsetDeg, truth.northOffsetDeg + holdDrift), sigmaDeg: f.sigmaDeg }));
  if (result.photo) {
    const mae = profileMae(result.photo, truth);
    const shift = bestShift(result.photo, truth);
    const sectors = [0, 90, 180, 270].map((a) => bestShift(result.photo!, truth, a, a + 90, 5).shift);
    out.skyline = { maeDeg: mae, bestShiftDeg: shift.shift, maeAtBestShift: shift.mae, sectorShiftsDeg: sectors, uncertaintyDeg: result.photo.uncertaintyDeg };
    if (c.skylineMaeDeg !== undefined) check('photo skyline MAE', mae <= c.skylineMaeDeg, mae, c.skylineMaeDeg);
    if (c.relYawErrDeg !== undefined) {
      const spread = Math.max(...sectors.map((x) => Math.abs(angleDiffDeg(x, mean(sectors)))));
      check('relative yaw error (sector shift spread)', spread <= c.relYawErrDeg, spread, c.relYawErrDeg);
    }
  } else if (c.skylineMaeDeg !== undefined) check('photo skyline MAE', false, 'no photo layer in localStorage', c.skylineMaeDeg);
  if (c.fovRelErr !== undefined) check('FOV', Math.abs(fovRel) <= c.fovRelErr, fovRel, c.fovRelErr);
  if (c.yawErrDeg !== undefined) check('yaw', Math.abs(yawErr) <= c.yawErrDeg, yawErr, c.yawErrDeg);
  if (c.yawSource) check('yaw source', c.yawSource.includes(rec.yaw.chosen.source), rec.yaw.chosen.source, c.yawSource);
  if (c.terrainDeclines) {
    const terrain = rec.yaw.fixes.find((f) => f.source === 'terrain');
    check('terrain match declines', !terrain && rec.yaw.chosen.source !== 'terrain', terrain ?? 'no terrain fix', 'no terrain fix');
  }
  if (c.compassSigmaMin !== undefined) {
    check('compass sigma', rec.yaw.chosen.source === 'compass' && rec.yaw.chosen.sigmaDeg >= c.compassSigmaMin, rec.yaw.chosen.sigmaDeg, `>= ${c.compassSigmaMin}`);
    const u = result.photo?.uncertaintyDeg;
    check('photo layer uncertainty widens verdicts', (u ?? 0) >= c.compassSigmaMin, u, `>= ${c.compassSigmaMin}`);
  }
  if (c.disagreement) {
    const shown = typeof ui.disagreementText === 'string' && ui.disagreementText.length > 0;
    check('disagreement message shown', shown && !!rec.yaw.disagreement, ui.disagreementText ?? rec.yaw.disagreement ?? null, 'shown');
  }
  if (c.edgeErrDeg !== undefined) {
    const e = edgeError(truth, rec.camera.hfovDeg, rec.camera.k1);
    out.edgeErrDeg = e;
    check('edge error with solved k1', e <= c.edgeErrDeg, { edgeErrDeg: e, k1: rec.camera.k1 ?? null }, c.edgeErrDeg);
  }
  return { checks, out };
}

// ───────────────────────────── the page ─────────────────────────────

async function readStored(page: Page, lat: number, lon: number): Promise<StoredResult> {
  return page.evaluate(async ({ key }) => {
    const toB64 = (u8: Uint8Array) => {
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const raw = localStorage.getItem('starhop-local-horizon-v1');
    const site = raw ? (JSON.parse(raw) as Record<string, { photo?: unknown; terrain?: unknown }>)[key] : undefined;
    const calibration = JSON.parse(localStorage.getItem('starhop-camera-calibration-v1') ?? 'null');
    const idb = await new Promise<Array<{ key: string; value: Record<string, unknown> }>>((resolve) => {
      const req = indexedDB.open('starhop-horizon');
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sites')) { resolve([]); return; }
        const store = db.transaction('sites', 'readonly').objectStore('sites');
        const keys = store.getAllKeys(), values = store.getAll();
        values.onsuccess = () => resolve(keys.result.map((k, i) => ({ key: String(k), value: values.result[i] as Record<string, unknown> })));
        values.onerror = () => resolve([]);
      };
    });
    const entries = [];
    for (const e of idb) {
      const v = e.value as { record: Record<string, unknown>; grid?: { width: number; height: number; stepDeg: number; altMinDeg: number; altMaxDeg: number; alpha: Uint8Array; known: Uint8Array }; panorama?: Blob | null };
      const g = v.grid;
      entries.push({
        key: e.key,
        record: v.record,
        grid: g ? { width: g.width, height: g.height, stepDeg: g.stepDeg, altMinDeg: g.altMinDeg, altMaxDeg: g.altMaxDeg, alphaB64: toB64(new Uint8Array(g.alpha)), knownB64: toB64(new Uint8Array(g.known)) } : null,
        panoramaB64: v.panorama ? toB64(new Uint8Array(await v.panorama.arrayBuffer())) : null,
        panoramaType: v.panorama?.type ?? null,
      });
    }
    return { photo: (site?.photo ?? null) as never, terrain: (site?.terrain ?? null) as never, calibration, idb: entries };
  }, { key: horizonSiteKey(lat, lon) });
}

async function clickByName(page: Page, name: string) {
  const b = page.getByTestId('horizon-capture').getByRole('button', { name, exact: true });
  await b.click({ timeout: 5000 });
}

async function visible(page: Page, name: string) {
  const b = page.getByTestId('horizon-capture').getByRole('button', { name, exact: true });
  return (await b.count()) > 0 && (await b.first().isVisible()) && (await b.first().isEnabled());
}

/** Trace the true skyline (plus noise) on the review strip, in strokes of 30°. */
async function traceSkyline(page: Page, truth: Truth, s: ScenarioConfig) {
  const area = page.getByTestId('horizon-trace');
  await area.waitFor({ timeout: 10000 });
  const canvas = area.locator('canvas');
  const r = rng(s.seed * 3 + 1);
  for (let a0 = 0; a0 < 360; a0 += 30) {
    // Bring this part of the strip into view (it may be wider than the screen).
    await canvas.evaluate((el, frac) => {
      const box = el.parentElement!;
      if (box.scrollWidth > box.clientWidth) box.scrollLeft = frac * box.scrollWidth - box.clientWidth / 2;
    }, (a0 + 15) / 360);
    const rect = (await canvas.boundingBox())!;
    const pt = (az: number) => {
      const alt = truthAt(truth, az) + gaussian(r) * s.traceNoiseDeg;
      return { x: rect.x + (Math.min(az, 359.999) / 360) * rect.width, y: rect.y + ((PANO_MAX - alt) / (PANO_MAX - PANO_MIN)) * rect.height };
    };
    const p0 = pt(a0);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    for (let az = a0 + 0.5; az <= a0 + 30.001; az += 0.5) {
      const p = pt(Math.min(az, 359.999));
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();
  }
}

async function run() {
  const a = args();
  const s = scenario(a.scenario);
  const dir = sceneDir(s.name);
  const { truth, poses, sensors } = ensureAssets(s, a.rebuild === 'true');
  const { chromium, devices } = loadPlaywright();

  let server: ChildProcess | null = null;
  let base = a.base;
  if (!base) {
    const started = await startServer(Number(process.env.PORT ?? 5173), path.join(dir, 'dev-server.log'));
    base = started.base;
    server = started.child;
  }
  const ui: Record<string, unknown> = { timeline: [] as string[] };
  const timeline = ui.timeline as string[];
  const t0 = Date.now();
  const note = (msg: string) => { const line = `${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`; timeline.push(line); console.log(line); };
  let browser: Browser | null = null;
  const logs: string[] = [];
  try {
    browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome', headless: a.headed !== 'true',
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${path.join(dir, 'scene.y4m')}`],
    });
    const pixel = devices['Pixel 7'];
    const context: BrowserContext = await browser.newContext({
      ...pixel,
      viewport: { width: pixel.viewport.height, height: pixel.viewport.width },
      screen: { width: (pixel as { screen?: { width: number; height: number } }).screen?.height ?? pixel.viewport.height, height: (pixel as { screen?: { width: number; height: number } }).screen?.width ?? pixel.viewport.width },
      geolocation: { latitude: s.lat, longitude: s.lon },
      permissions: ['camera', 'geolocation', 'accelerometer', 'gyroscope', 'magnetometer'],
    });
    const tiles = await installTileRoutes(context, truth.dem);
    // Other people edit the tree while this runs: answer Vite's HMR socket ourselves so no hot update or full reload
    // ever reaches the page mid-capture.
    await context.routeWebSocket((url) => url.protocol === 'ws:' || url.protocol === 'wss:', () => { /* mocked, silent */ });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 500)); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 500)));

    // Sensors over CDP, pushed per camera frame.
    const cdp: CDPSession = await context.newCDPSession(page);
    for (const type of ['relative-orientation', 'absolute-orientation', 'accelerometer', 'gyroscope'] as const) {
      await cdp.send('Emulation.setSensorOverrideEnabled', { enabled: true, type, metadata: { available: true, minimumFrequency: 1, maximumFrequency: 60 } });
    }
    let frame = -1, loops = 0, framesSeen = 0;
    const push = async (n: number) => {
      const f = sensors[n % sensors.length];
      const quat = (q: readonly number[]) => ({ quaternion: { x: q[0], y: q[1], z: q[2], w: q[3] } });
      await Promise.all([
        cdp.send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: quat(f.rel) }),
        cdp.send('Emulation.setSensorOverrideReadings', { type: 'absolute-orientation', reading: quat(f.abs) }),
        cdp.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: { xyz: { x: f.acc[0], y: f.acc[1], z: f.acc[2] } } }),
        cdp.send('Emulation.setSensorOverrideReadings', { type: 'gyroscope', reading: { xyz: { x: f.gyro[0], y: f.gyro[1], z: f.gyro[2] } } }),
      ]).catch(() => undefined);
    };
    await page.exposeFunction('__simFrame', async (n: number) => {
      if (n < frame - 100) loops++;
      frame = n;
      framesSeen++;
      await push(n);
    });
    await page.addInitScript('window.__name = window.__name || ((f) => f);');
    await page.addInitScript(simInit, { stripHeight: BARCODE.height, cells: BARCODE.cells, bits: BARCODE.bits, check: BARCODE.check, forceAngle: 90 });
    await page.clock.setFixedTime(new Date(truth.time));

    // Seed the site and the horizon switch, then reload.
    await page.goto(base);
    await page.evaluate(({ lat, lon, time }) => {
      const cur = JSON.parse(localStorage.getItem('starhop-settings-v2') || '{}');
      Object.assign(cur, { lat, lon, date: time.slice(0, 10), time: time.slice(11, 16), timeMode: 'planned', plannedAt: time, siteElevation: null, redLight: false });
      localStorage.setItem('starhop-settings-v2', JSON.stringify(cur));
      localStorage.setItem('starhop-local-horizon-prefs-v1', JSON.stringify({ enabled: true }));
    }, { lat: s.lat, lon: s.lon, time: new Date(truth.time).toISOString() });
    await page.reload();
    const angle = await page.evaluate(() => screen.orientation?.angle);
    note(`page loaded; screen.orientation.angle = ${angle}`);
    ui.screenAngle = angle;

    await page.locator('button[aria-label="Change observing location"]').first().waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => (document.querySelector('button[aria-label="Change observing location"]') as HTMLButtonElement).click());
    const panel = page.locator('.local-horizon');
    await panel.waitFor({ timeout: 20000 });
    // The terrain layer must be ready: the capture uses it for terrain matching.
    const key = horizonSiteKey(s.lat, s.lon);
    const tTerrain = Date.now();
    await page.waitForFunction((k) => { const r = localStorage.getItem('starhop-local-horizon-v1'); return !!r && !!JSON.parse(r)[k]?.terrain; }, key, { timeout: 120000 });
    note(`terrain layer ready in ${((Date.now() - tTerrain) / 1000).toFixed(1)} s (tiles served: ${JSON.stringify(tiles)})`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(dir, 'shot-0-panel.png') });
    await panel.getByRole('button', { name: /Add trees and buildings|Capture again/ }).click();
    const cap = page.getByTestId('horizon-capture');
    await cap.waitFor({ timeout: 20000 });
    await push(0);
    await clickByName(page, 'Start');
    note('pressed Start');

    const status = async () => (await cap.getByRole('status').allInnerTexts().catch(() => [])).join(' | ');
    const deadline = Date.now() + Number(a.timeout ?? 420) * 1000;
    let lastProbe = 0;
    let lastStatus = '', ringRequested = false, finished = false, tapped = false, traced = false, saved = false, shots = 0;
    while (Date.now() < deadline) {
      const st = await status();
      if (Date.now() - lastProbe > 3000) {
        lastProbe = Date.now();
        note(`sim ${JSON.stringify(await page.evaluate(() => (window as unknown as { __simState?: unknown }).__simState).catch(() => null))}`);
      }
      if (st !== lastStatus) { note(`status: ${st.slice(0, 160)} (frame ${frame}, loop ${loops})`); lastStatus = st; }
      if (await cap.getByRole('alert').count()) {
        const alerts = (await cap.getByRole('alert').allInnerTexts()).join(' | ');
        if (!/Sun|eyes|look/i.test(alerts) || /could not|error|failed/i.test(alerts)) { ui.alert = alerts; }
      }
      if (/Saved\./.test(st)) { saved = true; break; }
      if (await visible(page, 'Try again')) { ui.error = (await cap.getByRole('alert').allInnerTexts()).join(' | '); note(`error: ${ui.error}`); break; }

      if (!finished && (await visible(page, 'Finish sweep'))) {
        if (shots === 0) { await page.screenshot({ path: path.join(dir, 'shot-1-sweep.png') }); shots++; }
        if (s.ring1 && !ringRequested && (await visible(page, 'Add the tall-tree ring'))) {
          await clickByName(page, 'Add the tall-tree ring');
          ringRequested = true;
          note(`added ring 1 (frame ${frame})`);
        } else if (!s.ring1) {
          await clickByName(page, 'Finish sweep');
          finished = true;
          note(`finished sweep (frame ${frame})`);
        }
      }
      if (!tapped && (await visible(page, 'Skip'))) {
        finished = true;
        if (s.tap === 'none' || !(await visible(page, 'Tap when centred'))) {
          ui.alignStatus = st;
          await page.screenshot({ path: path.join(dir, 'shot-2-align.png') });
          await clickByName(page, 'Skip');
          tapped = true;
          note(`pressed Skip (tap target in UI: ${st.slice(0, 100)})`);
        } else {
          // Pick the right object (the Moon at night), then tap mid-hold.
          const want = s.tap === 'sun' ? /Sun/ : /Moon/;
          if (!want.test(st) && (await visible(page, 'Another object'))) { await clickByName(page, 'Another object'); await page.waitForTimeout(200); continue; }
          const w = poses.windows.align;
          if (w && frame >= w[0] + 18 && frame <= w[1] - 12) {
            ui.alignStatus = st;
            await page.screenshot({ path: path.join(dir, 'shot-2-align.png') });
            await clickByName(page, 'Tap when centred');
            tapped = true;
            ui.tapFrame = frame;
            note(`tapped at frame ${frame} (align window ${w[0]}–${w[1]})`);
          }
        }
      }
      if (await visible(page, 'Save')) {
        await page.waitForTimeout(500);
        ui.yawText = await page.getByTestId('horizon-yaw').innerText().catch(() => null);
        ui.notes = await cap.locator('.hc-note').allInnerTexts().catch(() => []);
        ui.disagreementText = (ui.notes as string[]).find((t) => /disagree/i.test(t)) ?? null;
        if (s.trace && !traced) {
          await page.screenshot({ path: path.join(dir, 'shot-3-review-before-trace.png') });
          await traceSkyline(page, truth, s);
          traced = true;
          note('traced the skyline');
          await page.waitForTimeout(800);
        }
        await page.screenshot({ path: path.join(dir, 'shot-3-review.png') });
        await clickByName(page, 'Save');
        note('pressed Save');
      } else if (s.trace && !traced && (await page.getByTestId('horizon-trace').count())) {
        await page.screenshot({ path: path.join(dir, 'shot-3-review-before-trace.png') });
        await traceSkyline(page, truth, s);
        traced = true;
        note('traced the skyline');
      }
      await page.waitForTimeout(100);
    }
    ui.framesSeen = framesSeen;
    ui.loops = loops;
    ui.simState = await page.evaluate(() => (window as unknown as { __simState?: unknown }).__simState).catch(() => null);
    await page.screenshot({ path: path.join(dir, 'shot-4-end.png') });
    const stored = await readStored(page, s.lat, s.lon);
    if (stored.idb[0]?.grid) writeJson(path.join(dir, 'grid.json'), stored.idb[0].grid);
    if (stored.idb[0]?.panoramaB64) {
      const ext = stored.idb[0].panoramaType === 'image/png' ? 'png' : 'webp';
      fs.writeFileSync(path.join(dir, `panorama.${ext}`), Buffer.from(stored.idb[0].panoramaB64, 'base64'));
      stored.idb[0].panoramaB64 = `(saved to panorama.${ext})`;
    }
    const { checks, out } = evaluate(s, truth, poses, sensors, stored, ui);
    if (!saved) checks.unshift({ name: 'capture completed', pass: false, value: lastStatus, limit: 'Saved.' });
    const pass = checks.every((c) => c.pass);
    const report = {
      scenario: s.name, description: s.description, pass: s.checks.measureOnly ? null : pass, checks, ...out, ui,
      tiles, stored: { photo: stored.photo, terrainSource: stored.terrain?.source ?? null, calibration: stored.calibration, idbKeys: stored.idb.map((e) => e.key) },
      consoleErrors: logs.slice(0, 40), elapsedSec: (Date.now() - t0) / 1000,
    };
    writeJson(path.join(dir, 'report.json'), report);
    console.log(`\n${s.name}: ${s.checks.measureOnly ? 'MEASURED' : pass ? 'PASS' : 'FAIL'}`);
    for (const c of checks) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}: ${JSON.stringify(c.value)} (limit ${JSON.stringify(c.limit)})`);
    const sky = out.skyline as { maeDeg?: number } | undefined, chosen = (out.record as { yaw?: { chosen?: { source: string; sigmaDeg: number } } } | undefined)?.yaw?.chosen;
    console.log(`  measured: FOV error ${((Number(out.fovRelErr) || 0) * 100).toFixed(2)}%, yaw error ${Number(out.yawErrDeg).toFixed(2)}° ` +
      `(${chosen?.source} ±${chosen?.sigmaDeg}°), skyline MAE ${sky?.maeDeg?.toFixed(2)}°`);
    console.log(`report: ${path.join(dir, 'report.json')}`);
    process.exitCode = pass || s.checks.measureOnly ? 0 : 1;
  } finally {
    await browser?.close().catch(() => undefined);
    if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
