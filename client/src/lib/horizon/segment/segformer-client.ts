/**
 * Main-thread side of the SegFormer sky worker: one lazily created worker for the whole session (the model stays
 * loaded between frames), requests queued by id. Nothing is fetched until segformerSky is first called.
 */
import type { GrayImage, RgbaImage } from '../photo-types';

export type SegformerRequest = { id: number; width: number; height: number; data: Uint8ClampedArray };
export type SegformerResponse =
  | { id: number; progress: number }
  | { id: number; value: { width: number; height: number; data: Uint8Array }; device: 'webgpu' | 'wasm' }
  | { id: number; error: string };

interface Pending {
  resolve: (g: GrayImage) => void;
  reject: (e: Error) => void;
  onProgress?: (p: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let createWorker: () => Worker = () =>
  new Worker(new URL('./segformer.worker.ts', import.meta.url), { type: 'module' });
/** Device the model last ran on (diagnostics). */
export let segformerDevice: 'webgpu' | 'wasm' | null = null;

function failAll(message: string) {
  pending.forEach((p) => p.reject(new Error(message)));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = createWorker();
  w.onmessage = (event: MessageEvent<SegformerResponse>) => {
    const data = event.data, p = pending.get(data.id);
    if (!p) return;
    if ('progress' in data) return p.onProgress?.(data.progress);
    pending.delete(data.id);
    if ('error' in data) p.reject(new Error(data.error));
    else {
      segformerDevice = data.device;
      p.onProgress?.(1);
      p.resolve(data.value);
    }
  };
  w.onerror = () => {
    failAll('The sky model could not start.');
    resetSegformer();
  };
  worker = w;
  return w;
}

/**
 * P(sky) per pixel (0…255) from SegFormer-B0 ADE20K, at the frame's size. Loads ONNX Runtime Web and the model on the
 * first call (`onProgress` gets the download fraction 0…1; later sessions read them from the Cache API). Rejects when
 * the model cannot load or run.
 */
export function segformerSky(img: RgbaImage, onProgress?: (p: number) => void): Promise<GrayImage> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = getWorker();
    } catch {
      return reject(new Error('The sky model could not start in this browser.'));
    }
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    // Copy: the caller keeps its frame; the copy's buffer is transferred.
    const data = img.data.slice();
    const request: SegformerRequest = { id, width: img.width, height: img.height, data };
    w.postMessage(request, [data.buffer]);
  });
}

/** Stop the worker and free the model (pending requests reject). The next segformerSky call starts afresh. */
export function resetSegformer(): void {
  const w = worker;
  worker = null;
  segformerDevice = null;
  w?.terminate();
  failAll('The sky model was stopped.');
}

/** Tests only: replace the worker factory. */
export function __setSegformerWorkerFactory(factory: () => Worker): void {
  resetSegformer();
  createWorker = factory;
}
