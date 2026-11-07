/**
 * Zero-download sky segmentation (design section 8, "Model cannot load"): a per-pixel sky prior from brightness,
 * blueness and low texture, thresholded with Otsu, then a per-column sky border (the sky is connected to the top of the
 * frame; below the border is obstruction, except gaps as bright as the open sky, i.e. sky between leaves).
 * Also the fine-detail prior fused with the model output in segmentFrame.
 */
import type { GrayImage, RgbaImage } from '../photo-types';
import { boxMean, toGray } from './image-ops';

/** Below this the frame is a night frame: luminance percentiles (0…1). */
const DARK_P90 = 0.12;
const DARK_CONTRAST = 0.06;
/** Value returned where the image cannot tell sky from obstruction. */
export const UNKNOWN_ALPHA = 128;

/** Luminance percentiles of a frame from a coarse sample (fast; ~40k pixels at most). */
function lumaPercentiles(img: RgbaImage, ps: number[]): number[] {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 40000)));
  const hist = new Uint32Array(256);
  let count = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const j = (y * img.width + x) * 4, d = img.data;
      hist[Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2])]++;
      count++;
    }
  }
  return ps.map((p) => {
    const target = p * count;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v / 255;
    }
    return 1;
  });
}

/**
 * True when a frame is too dark (or too flat) to separate sky from obstruction automatically — night frames. The UI
 * then switches to the finger trace.
 */
export function isTooDarkToSegment(img: RgbaImage): boolean {
  const [p5, p90, p98] = lumaPercentiles(img, [0.05, 0.9, 0.98]);
  return p90 < DARK_P90 || p98 - p5 < DARK_CONTRAST;
}

/** Otsu threshold of values in 0…1 (256 bins). Returns the threshold and the two class means. */
function otsu(values: Float32Array): { t: number; lo: number; hi: number } {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    hist[v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)]++;
  }
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, bestT = 128, loMean = 0, hiMean = 255;
  for (let t = 0; t < 255; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t + 0.5;
      loMean = mB;
      hiMean = mF;
    }
  }
  return { t: bestT / 255, lo: loMean / 255, hi: hiMean / 255 };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Sky probability (255 = sky) of a frame from brightness, blueness and texture, with a per-column sky border.
 * Night frames (isTooDarkToSegment) return UNKNOWN_ALPHA everywhere.
 */
export function classicalSky(img: RgbaImage): GrayImage {
  const { width, height } = img, n = width * height, d = img.data;
  if (isTooDarkToSegment(img)) return { width, height, data: new Uint8Array(n).fill(UNKNOWN_ALPHA) };

  // Features: luminance, blueness (B above R and G), local texture (mean gradient magnitude over a small window).
  const Y = new Float32Array(n), blue = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const R = d[j] / 255, G = d[j + 1] / 255, B = d[j + 2] / 255;
    Y[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    blue[i] = Math.max(0, B - Math.max(R, G));
  }
  const grad = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const gx = Y[x + 1 < width ? i + 1 : i] - Y[x > 0 ? i - 1 : i];
      const gy = Y[y + 1 < height ? i + width : i] - Y[y > 0 ? i - width : i];
      grad[i] = Math.abs(gx) + Math.abs(gy);
    }
  }
  const r = Math.max(1, Math.round(Math.max(width, height) / 320));
  const texture = boxMean(grad, width, height, r);

  // Combined score: bright, bluish and smooth is sky. Texture is penalised relative to the typical sky texture.
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = Math.min(1, Math.max(0, Y[i] + 0.6 * blue[i] - 2.5 * texture[i]));
  let { t, lo, hi } = otsu(f);
  if (hi - lo < 0.1) {
    // One class only (all sky or all obstruction): judge by absolute brightness instead.
    t = 0.4;
    lo = 0.3;
    hi = 0.5;
  }
  // Soft per-pixel prior around the threshold; the ramp scales with how well the two classes separate.
  const halfWidth = Math.max(0.02, 0.25 * (hi - lo));
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = smoothstep(t - halfWidth, t + halfWidth, f[i]);

  // Per-column sky border: the row b maximising Σ_{y<b} (s − ½) (the longest sky-dominated run from the top).
  // Gaps below the border count as sky only when they look like the open sky above it (canopy gaps).
  const gapLo = t + 0.5 * (hi - t), gapHi = hi;
  const out = new Float32Array(n);
  for (let x = 0; x < width; x++) {
    let acc = 0, best = 0, border = 0;
    for (let y = 0; y < height; y++) {
      acc += s[y * width + x] - 0.5;
      if (acc > best) {
        best = acc;
        border = y + 1;
      }
    }
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      // Soft edge: a two-pixel ramp across the border.
      const above = smoothstep(border + 1.5, border - 1.5, y + 0.5);
      const gap = s[i] * smoothstep(gapLo, gapHi, f[i]);
      out[i] = above * s[i] + (1 - above) * gap;
    }
  }
  return toGray(boxMean(out, width, height, 1), width, height);
}
