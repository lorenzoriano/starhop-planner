import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../horizon/photo-types';
import { __setSegformerWorkerFactory, resetSegformer, segformerSky, type SegformerRequest, type SegformerResponse } from '../horizon/segment/segformer-client';
import {
  ADE_SKY_ID, classProbability, fuseSkyProbabilities, halfToFloat, preprocessForSegformer, upsampleProbability,
} from '../horizon/segment/segformer-math';
import { retrySegmentationModel, segmentFrame } from '../horizon/segment/segment-frame';

function solid(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
}

/** Sky on the top half (blue), dark ground below. */
function halfSky(width: number, height: number): RgbaImage {
  const img = solid(width, height, [30, 40, 25]);
  for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) img.data.set([140, 180, 235, 255], (y * width + x) * 4);
  return img;
}

describe('segformer maths', () => {
  it('preprocessing follows the model config (512², ImageNet mean/std, CHW)', () => {
    const v = preprocessForSegformer(solid(64, 48, [255, 0, 128]), 8);
    expect(v).toHaveLength(3 * 64);
    expect(v[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(v[64]).toBeCloseTo((0 - 0.456) / 0.224, 5);
    expect(v[128 + 63]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5);
  });

  it('class probability is the softmax over the class axis, not the argmax', () => {
    const C = 4, H = 1, W = 2;
    // Pixel 0: logits [0, 0, 2, 0]; pixel 1: sky is not the winner [3, 0, 1, 0].
    const logits = new Float32Array([0, 3, 0, 0, 2, 1, 0, 0]);
    const p = classProbability(logits, C, H, W, ADE_SKY_ID);
    const e2 = Math.exp(2);
    expect(p[0]).toBeCloseTo(e2 / (e2 + 3), 6);
    expect(p[1]).toBeCloseTo(Math.exp(1) / (Math.exp(3) + Math.exp(1) + 2), 6);
    // Large logits do not overflow.
    const big = classProbability(new Float32Array([1000, 1001, 999, 0]).map((v, i) => (i < 4 ? v : 0)), 4, 1, 1, 1);
    expect(big[0]).toBeCloseTo(Math.exp(1) / (1 + Math.exp(1) + Math.exp(-1)), 6);
  });

  it('upsampling keeps a top/bottom split in place', () => {
    const prob = new Float32Array(16).map((_, i) => (i < 8 ? 1 : 0)); // 4×4, top half sky
    const g = upsampleProbability(prob, 4, 4, 40, 40);
    expect(g.data[0]).toBe(255);
    expect(g.data[39 * 40 + 39]).toBe(0);
    expect(g.data[10 * 40 + 20]).toBe(255);
    expect(g.data[29 * 40 + 20]).toBe(0);
    // Halfway between rows 1 and 2 of the source (y = 20 in the output) is 50%.
    expect(Math.abs(g.data[19 * 40 + 20] + g.data[20 * 40 + 20] - 255)).toBeLessThan(3);
  });

  it('fusion: model dominant, prior can tip uncertain pixels, 50% prior is neutral in direction', () => {
    const g = (v: number) => ({ width: 1, height: 1, data: new Uint8Array([v]) });
    const fuse = (m: number, c: number) => fuseSkyProbabilities(g(m), g(c)).data[0];
    expect(fuse(250, 5)).toBeGreaterThan(128); // confident model beats a confident prior
    expect(fuse(5, 250)).toBeLessThan(128);
    expect(fuse(140, 5)).toBeLessThan(128); // unsure model, sure prior: prior decides
    expect(fuse(200, 128)).toBeGreaterThan(128);
    expect(fuse(60, 128)).toBeLessThan(128);
    expect(fuse(128, 128)).toBeCloseTo(128, -1);
    // Different sizes: the prior is resized.
    const prior = { width: 2, height: 2, data: new Uint8Array([255, 255, 255, 255]) };
    expect(fuseSkyProbabilities({ width: 4, height: 4, data: new Uint8Array(16).fill(128) }, prior).data[5]).toBeGreaterThan(200);
  });

  it('half floats decode', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(0.33325, 4);
    expect(halfToFloat(0)).toBe(0);
  });
});

/** A fake worker that answers like segformer.worker.ts: progress, then P(sky) = top half, or an error. */
class FakeWorker {
  onmessage: ((e: MessageEvent<SegformerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  requests: SegformerRequest[] = [];
  constructor(private mode: 'ok' | 'fail') {}
  postMessage(req: SegformerRequest) {
    this.requests.push(req);
    queueMicrotask(() => {
      const send = (data: SegformerResponse) => this.onmessage?.({ data } as MessageEvent<SegformerResponse>);
      if (this.mode === 'fail') return send({ id: req.id, error: 'no network' });
      send({ id: req.id, progress: 0.5 });
      const data = new Uint8Array(req.width * req.height);
      data.fill(250, 0, (req.width * req.height) / 2);
      data.fill(5, (req.width * req.height) / 2);
      send({ id: req.id, value: { width: req.width, height: req.height, data }, device: 'wasm' });
    });
  }
  terminate() {
    this.terminated = true;
  }
}

describe('segformerSky client and segmentFrame', () => {
  afterEach(() => {
    resetSegformer();
    retrySegmentationModel();
  });

  it('one worker for many frames; progress reported; the caller keeps its frame', async () => {
    const workers: FakeWorker[] = [];
    __setSegformerWorkerFactory(() => {
      const w = new FakeWorker('ok');
      workers.push(w);
      return w as unknown as Worker;
    });
    const img = halfSky(64, 48);
    const progress: number[] = [];
    const a = await segformerSky(img, (p) => progress.push(p));
    const b = await segformerSky(img);
    expect(workers).toHaveLength(1);
    expect(progress).toEqual([0.5, 1]);
    expect(a.width).toBe(64);
    expect(a.data[0]).toBe(250);
    expect(b.data[64 * 47]).toBe(5);
    expect(img.data.length).toBe(64 * 48 * 4); // not detached by the transfer
  });

  it('segmentFrame uses the model, refined and fused, when it loads', async () => {
    __setSegformerWorkerFactory(() => new FakeWorker('ok') as unknown as Worker);
    const img = halfSky(64, 48);
    const { alpha, method } = await segmentFrame(img);
    expect(method).toBe('segformer-b0-ade');
    expect(alpha.data[5 * 64 + 30]).toBeGreaterThan(220);
    expect(alpha.data[40 * 64 + 30]).toBeLessThan(30);
  });

  it('segmentFrame falls back to the classical prior when the model fails, and does not retry every frame', async () => {
    const workers: FakeWorker[] = [];
    __setSegformerWorkerFactory(() => {
      const w = new FakeWorker('fail');
      workers.push(w);
      return w as unknown as Worker;
    });
    const img = halfSky(64, 48);
    const first = await segmentFrame(img);
    expect(first.method).toBe('classical');
    expect(first.alpha.data[5 * 64 + 30]).toBeGreaterThan(200);
    expect(first.alpha.data[40 * 64 + 30]).toBeLessThan(40);
    const second = await segmentFrame(img);
    expect(second.method).toBe('classical');
    expect(workers[0].requests).toHaveLength(1);
  });

  it('useModel: false never starts the worker', async () => {
    const factory = vi.fn(() => new FakeWorker('ok') as unknown as Worker);
    __setSegformerWorkerFactory(factory);
    const { method } = await segmentFrame(halfSky(32, 24), { useModel: false });
    expect(method).toBe('classical');
    expect(factory).not.toHaveBeenCalled();
  });

  it('a worker that cannot start rejects pending requests', async () => {
    let worker: FakeWorker | null = null;
    __setSegformerWorkerFactory(() => {
      worker = new FakeWorker('ok');
      worker.postMessage = () => queueMicrotask(() => worker!.onerror?.(new Event('error')));
      return worker as unknown as Worker;
    });
    await expect(segformerSky(halfSky(8, 8))).rejects.toThrow(/could not start/);
    expect(worker!.terminated).toBe(true);
  });
});
