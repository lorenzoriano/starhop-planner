/**
 * Synthetic Terrarium tiles (design 10.2 step 4). `installTileRoutes` answers the app's Mapterhorn (512 px, .webp URL)
 * and AWS Terrarium (256 px, .png) requests from the scene's DEM. The bodies are PNG for both: the terrain worker
 * decodes with createImageBitmap, which sniffs the bytes (checked in Chrome 155 by probe.ts).
 *
 * CLI self-check: `npx tsx script/horizon-sim/tiles.ts [--scenario day-sun-hills]` — encodes tiles, compares the
 * quantised heights with the analytic DEM, counts the tiles the app will ask for and writes sample tiles + a profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import { planTiles, TERRAIN_SOURCES, type TerrainSourceId } from '../../client/src/lib/horizon/terrain';
import { args, encodePng, outDir, writeJson } from './lib/common';
import { elevation, makeDem, terrainTruth, tileLookup, tileRgba, type DemSpec } from './lib/dem';

export interface TileServeStats {
  mapterhorn: number;
  terrarium: number;
  failed: number;
}

/** Route both tile hosts to the synthetic DEM. `failMapterhorn` answers Mapterhorn with HTTP 503 (fallback test). */
export async function installTileRoutes(context: BrowserContext, dem: DemSpec, opts: { failMapterhorn?: boolean } = {}): Promise<TileServeStats> {
  const stats: TileServeStats = { mapterhorn: 0, terrarium: 0, failed: 0 };
  const cache = new Map<string, Buffer>();
  const serve = (source: TerrainSourceId, z: number, x: number, y: number) => {
    const size = TERRAIN_SOURCES[source].tileSize, key = `${source}/${z}/${x}/${y}`;
    let png = cache.get(key);
    if (!png) {
      png = encodePng(size, size, tileRgba(dem, z, x, y, size), 4, 1);
      cache.set(key, png);
    }
    return png;
  };
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  await context.route('**/tiles.mapterhorn.com/**', (route) => {
    const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.webp/);
    if (!m || opts.failMapterhorn) { stats.failed++; return route.fulfill({ status: 503, headers, body: 'unavailable' }); }
    stats.mapterhorn++;
    return route.fulfill({ status: 200, contentType: 'image/png', headers, body: serve('mapterhorn', +m[1], +m[2], +m[3]) });
  });
  await context.route('**/elevation-tiles-prod/terrarium/**', (route) => {
    const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (!m) { stats.failed++; return route.fulfill({ status: 404, headers, body: '' }); }
    stats.terrarium++;
    return route.fulfill({ status: 200, contentType: 'image/png', headers, body: serve('terrarium', +m[1], +m[2], +m[3]) });
  });
  return stats;
}

async function selfCheck() {
  const a = args();
  const lat = Number(a.lat ?? 45.07), lon = Number(a.lon ?? 7.69);
  const dir = outDir('tiles-check');
  const report: Record<string, unknown> = {};
  for (const kind of ['hills', 'flat'] as const) {
    const dem = makeDem(Number(a.seed ?? 1), lat, lon, kind);
    // Quantisation error of the encoded heights against the analytic DEM.
    const size = TERRAIN_SOURCES.mapterhorn.tileSize;
    const plan = planTiles(lat, lon, { grid: TERRAIN_SOURCES.mapterhorn });
    const lookup = tileLookup(dem, size);
    let maxErr = 0;
    for (const t of plan.slice(0, 3)) {
      const h = lookup(t.z, t.x, t.y);
      const rgba = tileRgba(dem, t.z, t.x, t.y, size);
      for (let i = 0; i < h.length; i += 997) {
        const decoded = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
        maxErr = Math.max(maxErr, Math.abs(decoded - h[i]));
      }
      fs.writeFileSync(path.join(dir, `${kind}-${t.z}-${t.x}-${t.y}.png`), encodePng(size, size, rgba, 4));
    }
    const t0 = Date.now();
    const p1 = terrainTruth(dem, 1);
    const ms1 = Date.now() - t0;
    const p4 = terrainTruth(dem, 0.25);
    const fallback = terrainTruth(dem, 1, 'terrarium');
    let maxDiff = 0, maxSrcDiff = 0;
    for (let i = 0; i < 360; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(p1.alt[i] - p4.alt[i * 4]));
      maxSrcDiff = Math.max(maxSrcDiff, Math.abs(p1.alt[i] - fallback.alt[i]));
    }
    const max = Math.max(...p4.alt), min = Math.min(...p4.alt);
    report[kind] = {
      tilesMapterhorn: plan.length,
      tilesTerrarium: planTiles(lat, lon, { grid: TERRAIN_SOURCES.terrarium }).length,
      groundM: p1.groundM, siteElevation: elevation(dem, lat, lon),
      decodeRoundTripMaxErrM: maxErr,
      skylineMinDeg: min, skylineMaxDeg: max,
      oneDegVsQuarterDegMaxDiff: maxDiff,
      mapterhornVsTerrariumMaxDiff: maxSrcDiff,
      msOneDegree: ms1,
    };
    writeJson(path.join(dir, `${kind}-profile.json`), { alt1: p1.alt, dist1: p1.distanceKm });
  }
  writeJson(path.join(dir, 'report.json'), report);
  console.log(JSON.stringify(report, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('horizon-sim', 'tiles.ts'))) {
  selfCheck().catch((e) => { console.error(e); process.exit(1); });
}
