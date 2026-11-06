/**
 * Main-thread side of the terrain horizon worker (pattern of clock-season.worker.ts): one module worker per
 * computation, terminated when it finishes or is aborted, so a superseded site never keeps downloading tiles.
 */
import type { FetchHorizonOptions, TerrainSourceId } from './terrain';
import type { HorizonProfile } from './types';

export type TerrainWorkerOptions = Pick<FetchHorizonOptions, 'maxKm' | 'minM' | 'toleranceDeg' | 'stepDeg' | 'eyeM' | 'refractionK' | 'concurrency'> & {
  sources?: TerrainSourceId[];
};
export type TerrainWorkerRequest =
  | { type: 'compute'; id: number; lat: number; lon: number; options?: TerrainWorkerOptions }
  | { type: 'cancel'; id: number };
export type TerrainWorkerResponse =
  | { id: number; progress: number }
  | { id: number; value: HorizonProfile }
  | { id: number; error: string; aborted?: boolean };

const abortError = () => new DOMException('Terrain horizon cancelled', 'AbortError');

let nextId = 1;

/** Compute a site's terrain horizon in a Web Worker. Rejects with an AbortError when `signal` aborts. */
export function computeTerrainInWorker(
  lat: number,
  lon: number,
  opts: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    options?: TerrainWorkerOptions;
    /** Tests inject a fake. */
    createWorker?: () => Worker;
  } = {},
): Promise<HorizonProfile> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError());
    let worker: Worker;
    try {
      worker = opts.createWorker
        ? opts.createWorker()
        : new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return reject(new Error('The terrain calculator could not start. Reload after the app is offline ready.'));
    }
    const id = nextId++;
    const finish = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
      const data = event.data;
      if (data.id !== id) return;
      if ('value' in data) {
        finish();
        resolve(data.value);
      } else if ('error' in data) {
        finish();
        reject(data.aborted ? abortError() : new Error(data.error));
      } else opts.onProgress?.(data.progress);
    };
    worker.onerror = () => {
      finish();
      reject(new Error('The terrain calculator could not load. Try reloading the app.'));
    };
    const request: TerrainWorkerRequest = { type: 'compute', id, lat, lon, options: opts.options };
    worker.postMessage(request);
  });
}
