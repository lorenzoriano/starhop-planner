import { describe, expect, it, vi } from 'vitest';
import { combinedProgress, fetchCached, MODEL_CACHE_NAME, type FetchDeps } from '../horizon/segment/model-fetch';
import { logitsToFloat32, SEGFORMER_FILES, segformerModelUrl } from '../horizon/segment/segformer-math';

const URL_A = 'https://example.test/models/a.onnx';

/** A response whose body arrives in `chunks` pieces, with or without Content-Length. */
function streamed(bytes: Uint8Array, chunks: number, withLength = true): Response {
  const step = Math.ceil(bytes.length / chunks);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
      controller.close();
    },
  });
  return new Response(body, { headers: withLength ? { 'Content-Length': String(bytes.length) } : {} });
}

/** In-memory Cache API (only what fetchCached uses). */
function memoryCaches() {
  const store = new Map<string, Response>();
  const opened: string[] = [];
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, response: Response) => void store.set(url, response),
  } as unknown as Cache;
  return { store, opened, caches: { open: async (name: string) => (opened.push(name), cache) } };
}

const payload = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('model download and cache', () => {
  it('streams the download with byte progress and caches it under the model cache name', async () => {
    const mem = memoryCaches();
    const fetchFn = vi.fn(async () => streamed(payload, 4));
    const progress: [number, number][] = [];
    const bytes = await fetchCached(URL_A, (l, t) => progress.push([l, t]), { fetch: fetchFn, caches: mem.caches });
    expect(Array.from(bytes)).toEqual(Array.from(payload));
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress[0]).toEqual([250, 1000]);
    expect(progress[progress.length - 1]).toEqual([1000, 1000]);
    await flush();
    expect(mem.opened).toEqual([MODEL_CACHE_NAME]);
    expect(mem.store.has(URL_A)).toBe(true);

    // Second time (e.g. offline): from the cache, no network.
    const offline = vi.fn(async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    });
    const again: [number, number][] = [];
    const cached = await fetchCached(URL_A, (l, t) => again.push([l, t]), { fetch: offline, caches: mem.caches });
    expect(Array.from(cached)).toEqual(Array.from(payload));
    expect(offline).not.toHaveBeenCalled();
    expect(again).toEqual([[1000, 1000]]);
  });

  it('works without a Cache API, or with one that throws', async () => {
    const plain = await fetchCached(URL_A, undefined, { fetch: async () => streamed(payload, 2), caches: null });
    expect(plain.length).toBe(1000);
    const throwing: FetchDeps['caches'] = { open: async () => { throw new DOMException('denied', 'SecurityError'); } };
    const viaThrowing = await fetchCached(URL_A, undefined, { fetch: async () => streamed(payload, 2), caches: throwing });
    expect(viaThrowing.length).toBe(1000);
    // A failing put (quota) does not fail the download.
    const full = { open: async () => ({ match: async () => undefined, put: async () => { throw new Error('QuotaExceeded'); } }) as unknown as Cache };
    expect((await fetchCached(URL_A, undefined, { fetch: async () => streamed(payload, 2), caches: full })).length).toBe(1000);
  });

  it('unknown size reports total 0 until the end; HTTP errors reject and are not cached', async () => {
    const progress: [number, number][] = [];
    await fetchCached(URL_A, (l, t) => progress.push([l, t]), { fetch: async () => streamed(payload, 2, false), caches: null });
    expect(progress[0]).toEqual([500, 0]);
    expect(progress[progress.length - 1]).toEqual([1000, 1000]);

    const mem = memoryCaches();
    await expect(fetchCached(URL_A, undefined, { fetch: async () => new Response('nope', { status: 404 }), caches: mem.caches }))
      .rejects.toThrow(/404/);
    await flush();
    expect(mem.store.size).toBe(0);
  });

  it('combined progress spans several files, uses hints until sizes are known, never goes back', () => {
    const seen: number[] = [];
    const [a, b] = combinedProgress([300, 100], (f) => seen.push(f));
    a(150, 0); // hint 300 → 150 / 400
    expect(seen.at(-1)).toBeCloseTo(0.375);
    b(50, 200); // b is larger than its hint: 200 / 500
    expect(seen).toEqual([0.375, 0.4]);
    b(60, 1000); // a larger size lowers the true fraction; the reported one holds
    expect(seen).toEqual([0.375, 0.4]);
    a(300, 300);
    b(200, 200);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
    // Thousands of tiny chunks: at most ~200 reports.
    const many: number[] = [];
    const [one] = combinedProgress([100_000], (f) => many.push(f));
    for (let i = 1; i <= 100_000; i += 10) one(i, 100_000);
    one(100_000, 100_000);
    expect(many.length).toBeLessThanOrEqual(201);
    expect(many.at(-1)).toBe(1);
    // A zero hint (file already present) does not hold the fraction below 1.
    const done: number[] = [];
    const [, model] = combinedProgress([0, 10], (f) => done.push(f));
    model(10, 10);
    expect(done).toEqual([1]);
  });
});

describe('segformer model files', () => {
  it('model URLs follow the Hugging Face layout for each dtype', () => {
    expect(segformerModelUrl('q8')).toBe('https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/main/onnx/model_quantized.onnx');
    expect(segformerModelUrl('fp16')).toMatch(/\/onnx\/model_fp16\.onnx$/);
    expect(segformerModelUrl('fp32')).toMatch(/\/onnx\/model\.onnx$/);
    expect(SEGFORMER_FILES.q8.bytes).toBeLessThan(SEGFORMER_FILES.fp16.bytes);
  });

  it('float16 logits are widened to float32; float32 passes through', () => {
    const f32 = new Float32Array([1, -2]);
    expect(logitsToFloat32('float32', f32)).toBe(f32);
    expect(Array.from(logitsToFloat32('float16', new Uint16Array([0x3c00, 0xc000])))).toEqual([1, -2]);
    expect(Array.from(logitsToFloat32('float16', [0.5, 3]))).toEqual([0.5, 3]);
  });
});
