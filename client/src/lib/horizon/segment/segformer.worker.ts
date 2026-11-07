/**
 * SegFormer-B0 (ADE20K) sky worker, run directly with ONNX Runtime Web. The worker itself is created only by the first
 * segformerSky call, so neither ONNX Runtime (bundled into this worker's chunk, never the main bundle) nor its wasm nor
 * the model weights are fetched before then. The import is static because the app builds workers as IIFE, which cannot
 * code-split. WebGPU (fp16 when the adapter has shader-f16, else fp32) is tried first, then WASM (int8). The session
 * is kept for later frames; the weights and the runtime's wasm are kept in the Cache API for offline sweeps.
 *
 * `onnxruntime-web/webgpu` is the build with both the WebGPU and the WASM execution providers. Its wasm is fetched
 * from jsDelivr at the installed version (vite.config.ts resolves the `onnxruntime-web-use-extern-wasm` entry so no
 * copy lands in dist).
 */
import * as ort from 'onnxruntime-web/webgpu';
import type { SegformerRequest, SegformerResponse } from './segformer-client';
import { combinedProgress, fetchCached, type ByteProgress } from './model-fetch';
import {
  ADE_SKY_ID, classProbability, logitsToFloat32, preprocessForSegformer, SEGFORMER_FILES, SEGFORMER_SIZE,
  segformerModelUrl, upsampleProbability, type SegformerDtype,
} from './segformer-math';

type Device = 'webgpu' | 'wasm';
interface Runner {
  session: ort.InferenceSession;
  device: Device;
}

/** The parts of GPUAdapter used here (the DOM lib in use has no WebGPU types). */
interface GpuAdapter {
  features: { has(name: string): boolean };
  info?: { isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}

const reply = (r: SegformerResponse) => (self as unknown as Worker).postMessage(r);

let progressListener: ((fraction: number) => void) | null = null;
let loading: Promise<Runner> | null = null;
let runtime: Promise<void> | null = null;

/** Safari before 26 without WebGPU needs the plain wasm build (as Transformers.js does); everyone else the asyncify one. */
function isSafariBelow26(): boolean {
  const ua = self.navigator.userAgent;
  const safari = (self.navigator.vendor ?? '').includes('Apple') && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave|Chrome|Android/i.test(ua);
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1]);
  return safari && version > 0 && version < 26;
}

function runtimeFiles(): { mjs: string; wasm: string; bytes: number } {
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/ort-wasm-simd-threaded`;
  const plain = isSafariBelow26() && !('gpu' in self.navigator);
  // Sizes: progress estimate only, used when the CDN sends no Content-Length.
  return plain
    ? { mjs: `${base}.mjs`, wasm: `${base}.wasm`, bytes: 14_300_000 }
    : { mjs: `${base}.asyncify.mjs`, wasm: `${base}.asyncify.wasm`, bytes: 26_900_000 };
}

/**
 * Fetch (or take from the cache) ONNX Runtime's wasm and its JS loader once, and hand both to ORT: the binary as
 * bytes, the loader as a blob URL, so a cached runtime starts offline.
 */
function initRuntime(onBytes: ByteProgress): Promise<void> {
  if (!runtime) {
    runtime = (async () => {
      const files = runtimeFiles();
      const [wasm, loader] = await Promise.all([fetchCached(files.wasm, onBytes), fetchCached(files.mjs)]);
      ort.env.wasm.wasmBinary = wasm;
      ort.env.wasm.wasmPaths = {
        mjs: URL.createObjectURL(new Blob([loader as BlobPart], { type: 'text/javascript' })),
        wasm: files.wasm,
      };
      // Already off the main thread.
      ort.env.wasm.proxy = false;
      if (ort.env.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
    })();
    // A failed start is not cached, so a later call can try again (e.g. back online).
    runtime.catch(() => (runtime = null));
  }
  return runtime;
}

async function loadModel(device: Device, dtype: SegformerDtype): Promise<Runner> {
  const needRuntime = !runtime;
  const [onRuntimeBytes, onModelBytes] = combinedProgress(
    [needRuntime ? runtimeFiles().bytes : 0, SEGFORMER_FILES[dtype].bytes],
    (fraction) => progressListener?.(fraction),
  );
  const [, model] = await Promise.all([initRuntime(onRuntimeBytes), fetchCached(segformerModelUrl(dtype), onModelBytes)]);
  const session = await ort.InferenceSession.create(model, { executionProviders: [device] });
  return { session, device };
}

async function load(): Promise<Runner> {
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      // A software (fallback) adapter is slower than WASM.
      if (adapter && !adapter.info?.isFallbackAdapter && !adapter.isFallbackAdapter) {
        return await loadModel('webgpu', adapter.features.has('shader-f16') ? 'fp16' : 'fp32');
      }
    } catch {
      // Fall through to WASM.
    }
  }
  return loadModel('wasm', 'q8');
}

function getRunner(): Promise<Runner> {
  if (!loading) {
    loading = load();
    // A failed load is not cached, so a later call can try again (e.g. back online).
    loading.catch(() => (loading = null));
  }
  return loading;
}

async function infer(runner: Runner, pixelValues: Float32Array): Promise<{ data: ArrayLike<number>; dims: readonly number[] }> {
  const { session } = runner;
  const input = new ort.Tensor('float32', pixelValues, [1, 3, SEGFORMER_SIZE, SEGFORMER_SIZE]);
  const output = await session.run({ [session.inputNames[0]]: input });
  const logits = output[session.outputNames[0]];
  const data = logitsToFloat32(logits.type, logits.data as ArrayLike<number>);
  return { data, dims: logits.dims };
}

self.onmessage = async (event: MessageEvent<SegformerRequest>) => {
  const { id, width, height, data } = event.data;
  progressListener = (progress) => reply({ id, progress });
  try {
    let runner = await getRunner();
    const pixelValues = preprocessForSegformer({ width, height, data });
    let logits;
    try {
      logits = await infer(runner, pixelValues);
    } catch (error) {
      if (runner.device !== 'webgpu') throw error;
      // WebGPU loaded but failed to run (driver limits, lost device): switch to WASM for this and later frames.
      runner.session.release().catch(() => {});
      loading = loadModel('wasm', 'q8');
      loading.catch(() => (loading = null));
      runner = await loading;
      logits = await infer(runner, pixelValues);
    }
    const [classes, h, w] = logits.dims.slice(-3);
    const prob = classProbability(logits.data, classes, h, w, ADE_SKY_ID);
    const alpha = upsampleProbability(prob, w, h, width, height);
    reply({ id, value: { width, height, data: alpha.data }, device: runner.device });
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    progressListener = null;
  }
};
