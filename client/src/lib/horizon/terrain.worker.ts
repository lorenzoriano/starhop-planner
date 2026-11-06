/**
 * Terrain horizon worker: fetches Terrarium tiles (Mapterhorn, falling back wholesale to AWS Terrain Tiles), decodes
 * them without colour management and ray-casts the skyline (terrain.ts). Started by terrain-client.ts, one worker
 * per computation; `{type:'cancel'}` or terminate() stops it.
 */
import { decodeTerrarium, fetchTerrainHorizon, type TerrainSource, type TileId } from './terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrain-client';

const TILE_TIMEOUT_MS = 20000;
const running = new Map<number, AbortController>();

async function loadTile(source: TerrainSource, tile: TileId, signal: AbortSignal): Promise<Float32Array | null> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TILE_TIMEOUT_MS);
  const relay = () => controller.abort();
  signal.addEventListener('abort', relay);
  try {
    const res = await fetch(source.url(tile.z, tile.x, tile.y), { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for tile ${tile.key}`);
    // Colour management or premultiplication would corrupt the encoded heights.
    const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    try {
      const size = source.tileSize;
      if (bitmap.width !== size || bitmap.height !== size) throw new Error(`Tile ${tile.key} is ${bitmap.width}×${bitmap.height} px`);
      const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No 2D canvas in this browser');
      ctx.drawImage(bitmap, 0, 0);
      return decodeTerrarium(ctx.getImageData(0, 0, size, size).data);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (timedOut && !signal.aborted) throw new Error(`Tile ${tile.key} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relay);
  }
}

self.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  const msg = event.data;
  const reply = (r: TerrainWorkerResponse) => (self as unknown as Worker).postMessage(r);
  if (msg.type === 'cancel') {
    running.get(msg.id)?.abort();
    return;
  }
  const controller = new AbortController();
  running.set(msg.id, controller);
  let last = -1;
  try {
    const value = await fetchTerrainHorizon(msg.lat, msg.lon, loadTile, {
      ...msg.options,
      signal: controller.signal,
      onProgress: (progress) => {
        // Throttle to whole percents.
        const pct = Math.floor(progress * 100);
        if (pct !== last) {
          last = pct;
          reply({ id: msg.id, progress });
        }
      },
    });
    reply({ id: msg.id, value });
  } catch (error) {
    const aborted = controller.signal.aborted;
    reply({ id: msg.id, error: aborted ? 'Cancelled' : error instanceof Error ? error.message : 'Could not compute the terrain horizon.', aborted });
  } finally {
    running.delete(msg.id);
  }
};
