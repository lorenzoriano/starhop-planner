/** Plumbing probe: fake camera + barcode + generator, sensor overrides, orientation angle, clock, PNG-as-WebP tiles. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { BARCODE, barcodeCells, encodePng, outDir, Y4mWriter } from './lib/common';
import { simInit } from './lib/inject';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(path.join(process.env.NODE_PATH ?? '', 'playwright')) as typeof import('playwright');

const dir = outDir('probe');
const file = process.env.Y4M ?? path.join(dir, 'probe.y4m');
const W = 1280, H = 960;
const y4m = process.env.Y4M ? null : new Y4mWriter(file, W, H, 30);
for (let n = 0; y4m && n < 90; n++) {
  const rgb = new Uint8Array(W * H * 3).fill(100 + (n % 50));
  const cells = barcodeCells(n), cw = W / BARCODE.cells;
  for (let y = H - BARCODE.height; y < H; y++) for (let x = 0; x < W; x++) { const v = cells[Math.floor(x / cw)] ? 235 : 20; const j = (y * W + x) * 3; rgb[j] = rgb[j + 1] = rgb[j + 2] = v; }
  y4m.write(rgb);
}
y4m?.close();

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`] });
  const pixel = devices['Pixel 7'];
  const context = await browser.newContext({ ...pixel, viewport: { width: pixel.viewport.height, height: pixel.viewport.width }, screen: { width: (pixel as { screen?: { width: number; height: number } }).screen?.height ?? pixel.viewport.height, height: (pixel as { screen?: { width: number; height: number } }).screen?.width ?? pixel.viewport.width } });
  await context.grantPermissions(['camera', 'accelerometer', 'gyroscope', 'magnetometer', 'geolocation']);
  const page = await context.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  const frames: number[] = [];
  await page.exposeFunction('__simFrame', (n: number) => { frames.push(n); });
  await page.addInitScript('window.__name = window.__name || ((f) => f);');
  await page.addInitScript(simInit, { stripHeight: 12, cells: 32, bits: 20, check: 4, forceAngle: null });
  await page.addInitScript(`window.__wait = ${Number(process.env.WAIT ?? 1500)}`);
  await page.clock.setFixedTime(new Date('2026-11-06T14:00:00Z'));
  await context.route('**/tiles.mapterhorn.com/**', (route) => {
    const px = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = 128; px[i + 1] = 100; px[i + 2] = 64; px[i + 3] = 255; }
    return route.fulfill({ status: 200, contentType: 'image/png', body: encodePng(512, 512, px, 4), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('http://localhost:' + (process.env.PORT ?? '5173') + '/');
  const cdp = await context.newCDPSession(page);
  for (const type of ['relative-orientation', 'absolute-orientation', 'accelerometer', 'gyroscope'] as const) {
    await cdp.send('Emulation.setSensorOverrideEnabled', { enabled: true, type, metadata: { available: true } });
  }
  await cdp.send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: { x: 0.1, y: 0.2, z: 0.3, w: Math.sqrt(1 - 0.14) } } });
  const info = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out.angle = screen.orientation?.angle;
    out.type = screen.orientation?.type;
    out.winOrientation = (window as unknown as { orientation?: number }).orientation;
    out.inner = [innerWidth, innerHeight];
    out.now1 = Date.now();
    await new Promise((r) => setTimeout(r, 300));
    out.now2 = Date.now();
    out.perf = performance.now();
    out.hasProc = 'MediaStreamTrackProcessor' in window;
    out.hasGen = 'MediaStreamTrackGenerator' in window;
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 1280, height: 960 } });
    const t = s.getVideoTracks()[0];
    out.settings = t.getSettings();
    out.label = t.label;
    const v = document.createElement('video');
    v.muted = true; v.srcObject = s; await v.play();
    await new Promise((r) => setTimeout(r, Number((window as unknown as { __wait?: number }).__wait ?? 1500)));
    out.video = [v.videoWidth, v.videoHeight];
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(v, 0, 0);
    out.bottomPixel = Array.from(ctx.getImageData(5, c.height - 2, 1, 1).data);
    try {
      const Rel = (window as unknown as { RelativeOrientationSensor: new (o: object) => { quaternion: number[]; start(): void; addEventListener(t: string, f: (e: unknown) => void): void } }).RelativeOrientationSensor;
      const sensor = new Rel({ frequency: 60, referenceFrame: 'device' });
      out.sensor = await new Promise((res) => { sensor.addEventListener('reading', () => res(sensor.quaternion)); sensor.addEventListener('error', (e) => res(String((e as { error?: unknown }).error))); sensor.start(); setTimeout(() => res('timeout'), 2000); });
    } catch (e) { out.sensor = String(e); }
    try {
      const r = await fetch('https://tiles.mapterhorn.com/12/1/1.webp');
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const oc = new OffscreenCanvas(512, 512).getContext('2d')!; oc.drawImage(bmp, 0, 0);
      out.tile = Array.from(oc.getImageData(0, 0, 1, 1).data);
    } catch (e) { out.tile = String(e); }
    out.state = (window as unknown as { __simState: unknown }).__simState;
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('frames reported', frames.length, frames.slice(0, 10), frames.slice(-5));
  console.log(logs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
