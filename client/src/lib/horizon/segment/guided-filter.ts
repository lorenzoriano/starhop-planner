/**
 * Guided filter (He, Sun and Tang, "Guided Image Filtering", ECCV 2010 / PAMI 2013) on the luminance of the frame.
 * Used to refine a coarse sky probability against the full-resolution photo: edges of the output follow edges of the
 * guide (branches, roof lines), flat areas are smoothed. O(N) through box means of running sums.
 */
import type { GrayImage, RgbaImage } from '../photo-types';
import { boxMean, fromGray, luminance, resizeGray, toGray } from './image-ops';

/**
 * Filter `p` (0…255) guided by `guide`. `radius` is the window half-size in guide pixels; `eps` is the regularisation in
 * squared intensity units of a 0…1 guide (1e-4…1e-3 keeps edges very sharp, 0.01–0.04 smooths more). `p` is resized
 * to the guide when the sizes differ.
 */
export function guidedFilter(guide: RgbaImage, p: GrayImage, radius: number, eps: number): GrayImage {
  const { width, height } = guide, n = width * height;
  const r = Math.max(1, Math.round(radius));
  const I = luminance(guide);
  const P = fromGray(resizeGray(p, width, height));
  const II = new Float32Array(n), IP = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    II[i] = I[i] * I[i];
    IP[i] = I[i] * P[i];
  }
  const meanI = boxMean(I, width, height, r);
  const meanP = boxMean(P, width, height, r);
  const corrI = boxMean(II, width, height, r);
  const corrIP = boxMean(IP, width, height, r, II); // reuse buffers: II and IP are no longer needed after this
  const a = IP, b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIP = corrIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, width, height, r, meanI);
  const meanB = boxMean(b, width, height, r, meanP);
  const q = corrI;
  for (let i = 0; i < n; i++) q[i] = meanA[i] * I[i] + meanB[i];
  return toGray(q, width, height);
}
