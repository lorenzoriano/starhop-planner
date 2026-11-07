/**
 * Pure parts of the SegFormer path, kept out of the worker so they are unit-tested: preprocessing (the model's
 * preprocessor_config: bilinear resize to 512², rescale 1/255, ImageNet mean/std), P(sky) from the softmax over the
 * logits (not the argmax, so the result is soft), and the fusion with the classical prior.
 */
import type { GrayImage, RgbaImage } from '../photo-types';
import { resizeFloat, sampleRgba, toGray } from './image-ops';

export const SEGFORMER_MODEL = 'Xenova/segformer-b0-finetuned-ade-512-512';
/** ADE20K-150 label id of "sky" (config.json id2label["2"] = "sky"). */
export const ADE_SKY_ID = 2;
export const SEGFORMER_SIZE = 512;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** CHW float32 pixel_values [1, 3, size, size] for SegFormer from an RGBA frame (aspect not kept, as the processor does). */
export function preprocessForSegformer(img: RgbaImage, size = SEGFORMER_SIZE): Float32Array {
  const out = new Float32Array(3 * size * size);
  const sx = img.width / size, sy = img.height / size, px = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < size; x++) {
      sampleRgba(img, (x + 0.5) * sx - 0.5, fy, px);
      const i = y * size + x;
      for (let c = 0; c < 3; c++) out[c * size * size + i] = (px[c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** Softmax probability of one class from logits laid out [1, C, H, W] (or [C, H, W]). */
export function classProbability(logits: ArrayLike<number>, numClasses: number, height: number, width: number, classId: number): Float32Array {
  const plane = height * width, out = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    let max = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[c * plane + i];
      if (v > max) max = v;
    }
    let sum = 0;
    for (let c = 0; c < numClasses; c++) sum += Math.exp(logits[c * plane + i] - max);
    out[i] = Math.exp(logits[classId * plane + i] - max) / sum;
  }
  return out;
}

/** P(sky) at logit resolution → GrayImage at frame resolution (bilinear). */
export function upsampleProbability(prob: Float32Array, width: number, height: number, outWidth: number, outHeight: number): GrayImage {
  return toGray(resizeFloat(prob, width, height, outWidth, outHeight), outWidth, outHeight);
}

const logit = (p: number) => Math.log(p / (1 - p));

/**
 * Weighted geometric mean of two sky probabilities (a weighted average of their log-odds), model dominant:
 * logit(out) = w·logit(model) + (1 − w)·logit(prior). Inputs are clamped to 1–99% so neither can veto alone.
 * `prior` is resized to `model` when the sizes differ.
 */
export function fuseSkyProbabilities(model: GrayImage, prior: GrayImage, modelWeight = 0.7): GrayImage {
  const { width, height } = model, n = width * height;
  const pr = prior.width === width && prior.height === height ? prior.data : toGray(
    resizeFloat(Float32Array.from(prior.data, (v) => v / 255), prior.width, prior.height, width, height), width, height,
  ).data;
  // Lookup tables: log-odds of every byte value.
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = logit(Math.min(0.99, Math.max(0.01, v / 255)));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = modelWeight * lut[model.data[i]] + (1 - modelWeight) * lut[pr[i]];
    data[i] = Math.round(255 / (1 + Math.exp(-l)));
  }
  return { width, height, data };
}

/** IEEE half → float (for float16 logits stored as Uint16Array). */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
