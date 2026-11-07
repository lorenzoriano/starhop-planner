/**
 * Night finger trace helpers (design section 8, "Night"): the user's trace of the skyline over the brightened
 * panorama snaps to the strongest nearby vertical edge (sky above brighter than the obstruction below).
 */
import { PANORAMA_ALT_MAX, PANORAMA_ALT_MIN, type RgbaImage } from '../photo-types';
import { azAltToPanoramaPixel } from './panorama';

/**
 * For every trace point, search ±radiusDeg vertically in the panorama for the strongest bright-above/dark-below
 * luminance step (averaged over three columns) and move the point there. Points with no clear edge nearby, or over
 * unfilled (transparent) panorama, are kept as traced.
 */
export function snapTraceToEdges(
  pano: RgbaImage,
  trace: Array<{ az: number; alt: number }>,
  radiusDeg = 1.5,
): Array<{ az: number; alt: number }> {
  const { width: W, height: H, data } = pano;
  const degPerPx = (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN) / H;
  const radiusPx = Math.max(1, Math.round(radiusDeg / degPerPx));
  // Luminance at a pixel, NaN where the panorama is unfilled.
  const lum = (x: number, y: number) => {
    const i = (y * W + (((x % W) + W) % W)) * 4;
    return data[i + 3] < 128 ? NaN : (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  };
  const colLum = (x: number, y: number) => (lum(x - 1, y) + lum(x, y) + lum(x + 1, y)) / 3;
  return trace.map((p) => {
    const { x, y } = azAltToPanoramaPixel(W, H, p.az, p.alt);
    const cx = Math.min(W - 1, Math.floor(x)), cy = Math.round(y);
    let best = 0, bestY = NaN;
    for (let yy = Math.max(1, cy - radiusPx); yy <= Math.min(H - 1, cy + radiusPx); yy++) {
      // Edge between rows yy − 1 (above) and yy (below), at pixel boundary y = yy.
      const step = colLum(cx, yy - 1) - colLum(cx, yy);
      if (!(step > 0)) continue;
      // Mild preference for edges near the finger.
      const score = step * (1 - 0.3 * ((yy - y) / radiusPx) ** 2);
      if (score > best) {
        best = score;
        bestY = yy;
      }
    }
    // A step under 3% of full scale is noise.
    if (!(best > 0.03)) return { az: p.az, alt: p.alt };
    return { az: p.az, alt: PANORAMA_ALT_MAX - bestY * degPerPx };
  });
}
