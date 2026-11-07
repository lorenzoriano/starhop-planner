/**
 * SegFormer-B0 (ADE20K) sky worker. The worker itself is created only by the first segformerSky call, so neither
 * Transformers.js (bundled into this worker's chunk, never the main bundle) nor the model weights are fetched before
 * then. The import is static because the app builds workers as IIFE, which cannot code-split. WebGPU (fp16 when the
 * adapter has shader-f16) is tried first, then WASM (q8). The model is kept for later frames.
 */
import * as transformers from '@huggingface/transformers';
import type { SegformerRequest, SegformerResponse } from './segformer-client';
import {
  ADE_SKY_ID, classProbability, halfToFloat, preprocessForSegformer, SEGFORMER_MODEL, SEGFORMER_SIZE, upsampleProbability,
} from './segformer-math';

type Transformers = typeof transformers;
type Model = Awaited<ReturnType<Transformers['SegformerForSemanticSegmentation']['from_pretrained']>>;
interface Runner {
  tf: Transformers;
  model: Model;
  device: 'webgpu' | 'wasm';
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

async function loadModel(tf: Transformers, device: 'webgpu' | 'wasm', dtype: 'fp16' | 'fp32' | 'q8'): Promise<Runner> {
  const model = await tf.SegformerForSemanticSegmentation.from_pretrained(SEGFORMER_MODEL, {
    device,
    dtype,
    progress_callback: (info) => {
      // Aggregate over all files (per-file events jump back to 0 for every new file).
      if (info.status === 'progress_total') progressListener?.(Math.min(1, info.progress / 100));
    },
  });
  return { tf, model, device };
}

async function load(): Promise<Runner> {
  const tf = transformers;
  tf.env.allowLocalModels = false;
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      // A software (fallback) adapter is slower than WASM.
      if (adapter && !adapter.info?.isFallbackAdapter && !adapter.isFallbackAdapter) {
        return await loadModel(tf, 'webgpu', adapter.features.has('shader-f16') ? 'fp16' : 'fp32');
      }
    } catch {
      // Fall through to WASM.
    }
  }
  return loadModel(tf, 'wasm', 'q8');
}

function getRunner(): Promise<Runner> {
  if (!loading) {
    loading = load();
    // A failed load is not cached, so a later call can try again (e.g. back online).
    loading.catch(() => (loading = null));
  }
  return loading;
}

async function infer(runner: Runner, pixelValues: Float32Array): Promise<{ data: ArrayLike<number>; dims: number[] }> {
  const input = new runner.tf.Tensor('float32', pixelValues, [1, 3, SEGFORMER_SIZE, SEGFORMER_SIZE]);
  const output = await runner.model({ pixel_values: input });
  const logits = output.logits as { type: string; data: ArrayLike<number>; dims: number[] };
  if (logits.type === 'float16' && logits.data instanceof Uint16Array) {
    return { data: Float32Array.from(logits.data, halfToFloat), dims: logits.dims };
  }
  return { data: logits.data, dims: logits.dims };
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
      loading = loadModel(runner.tf, 'wasm', 'q8');
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
