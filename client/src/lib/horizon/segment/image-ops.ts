/**
 * Small image helpers shared by the segmentation code (pure, allocation-light, no DOM): luminance, O(N) box means,
 * bilinear sampling and resizing. Pixel centres sit at integer + 0.5 (camera.ts convention: the principal point is
 * at width/2), so a continuous coordinate u maps to index space as u − 0.5.
 */
import type { GrayImage, RgbaImage } from '../photo-types';

/** Rec. 601 luma of an RGBA image, 0…1. */
export function luminance(img: RgbaImage): Float32Array {
  const n = img.width * img.height, d = img.data, out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
  return out;
}

/**
 * Mean over a (2r+1)² window, clamped at the borders (the window shrinks; the mean stays unbiased). Two passes of
 * running sums (a separable integral image), so the cost does not depend on r.
 */
export function boxMean(src: Float32Array, width: number, height: number, r: number, out = new Float32Array(width * height)): Float32Array {
  const tmp = new Float32Array(width * height);
  const line = new Float64Array(Math.max(width, height) + 1);
  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    line[0] = 0;
    for (let x = 0; x < width; x++) line[x + 1] = line[x] + src[row + x];
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
      tmp[row + x] = (line[x1 + 1] - line[x0]) / (x1 - x0 + 1);
    }
  }
  // Vertical pass.
  for (let x = 0; x < width; x++) {
    line[0] = 0;
    for (let y = 0; y < height; y++) line[y + 1] = line[y] + tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
      out[y * width + x] = (line[y1 + 1] - line[y0]) / (y1 - y0 + 1);
    }
  }
  return out;
}

/** Bilinear sample of a single-channel float field at index-space (x, y), clamped to the edges. */
export function sampleFloat(src: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = x0 + 1 < width ? x0 + 1 : x0, y1 = y0 + 1 < height ? y0 + 1 : y0;
  const fx = cx - x0, fy = cy - y0;
  const a = src[y0 * width + x0], b = src[y0 * width + x1], c = src[y1 * width + x0], d = src[y1 * width + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Resize a float field with bilinear interpolation (half-pixel centres, like align_corners = false). */
export function resizeFloat(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < dw; x++) out[y * dw + x] = sampleFloat(src, sw, sh, (x + 0.5) * sx - 0.5, fy);
  }
  return out;
}

/** Float field 0…1 → GrayImage 0…255. */
export function toGray(src: Float32Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const v = src[i] * 255;
    data[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return { width, height, data };
}

/** GrayImage → float field 0…1. */
export function fromGray(img: GrayImage): Float32Array {
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] / 255;
  return out;
}

/** Resize a GrayImage (bilinear); returns the input when the size already matches. */
export function resizeGray(img: GrayImage, width: number, height: number): GrayImage {
  if (img.width === width && img.height === height) return img;
  return toGray(resizeFloat(fromGray(img), img.width, img.height, width, height), width, height);
}

/** Bilinear RGBA sample at index-space (x, y) into out[0..3]; false when (x, y) is outside the image. */
export function sampleRgba(img: RgbaImage, x: number, y: number, out: Float32Array | number[]): boolean {
  const w = img.width, h = img.height;
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return false;
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = cx - x0, fy = cy - y0;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const d = img.data, i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) out[c] = d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11;
  return true;
}
