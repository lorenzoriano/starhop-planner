/**
 * Equirectangular panorama for the viewer (design 5.3): true north at the left edge, azimuth increasing to the right,
 * PANORAMA_ALT_MAX at the top edge. Pixel (x, y) is centred on azimuth (x + ½)·360/width and altitude
 * ALT_MAX − (y + ½)·(ALT_MAX − ALT_MIN)/height. Built by inverse mapping: every panorama pixel samples the frames
 * that see it, feathered by distance to each frame's edge; pixels no frame covers stay transparent.
 */
import type { CameraIntrinsics, CameraPose } from '../calibrate/camera';
import { PANORAMA_ALT_MAX, PANORAMA_ALT_MIN, PANORAMA_HEIGHT, PANORAMA_WIDTH, type RgbaImage } from '../photo-types';
import { sampleRgba } from './image-ops';
import { FrameProjector } from './projector';

const RAD = Math.PI / 180;

/** Azimuth and altitude of a panorama pixel centre (or of any continuous x, y in pixel units), degrees. */
export function panoramaPixelToAzAlt(width: number, height: number, x: number, y: number): { az: number; alt: number } {
  return { az: (x * 360) / width, alt: PANORAMA_ALT_MAX - (y * (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN)) / height };
}

/** Continuous pixel coordinates (edges at integers) of an azimuth/altitude in a panorama. */
export function azAltToPanoramaPixel(width: number, height: number, az: number, alt: number): { x: number; y: number } {
  return { x: ((((az % 360) + 360) % 360) * width) / 360, y: ((PANORAMA_ALT_MAX - alt) * height) / (PANORAMA_ALT_MAX - PANORAMA_ALT_MIN) };
}

export function composePanorama(
  frames: Array<{ image: RgbaImage; pose: CameraPose; cam: CameraIntrinsics }>,
  width = PANORAMA_WIDTH,
  height = PANORAMA_HEIGHT,
): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const projectors = frames.map((f) => new FrameProjector(f.pose, f.cam));
  const feather = frames.map((f) => Math.max(1, 0.2 * Math.min(f.cam.width, f.cam.height)));
  const sinAz = new Float64Array(width), cosAz = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const az = ((x + 0.5) * 360 * RAD) / width;
    sinAz[x] = Math.sin(az);
    cosAz[x] = Math.cos(az);
  }
  const px = new Float32Array(4);
  const active = new Int32Array(frames.length);
  const altSpan = PANORAMA_ALT_MAX - PANORAMA_ALT_MIN;
  for (let y = 0; y < height; y++) {
    const alt = (PANORAMA_ALT_MAX - ((y + 0.5) * altSpan) / height) * RAD, ch = Math.cos(alt), dz = Math.sin(alt);
    // Frames whose cone can reach this row at all (cheap per-row cull).
    let nActive = 0;
    for (let k = 0; k < projectors.length; k++) if (projectors[k].reachesAltitude(alt)) active[nActive++] = k;
    if (!nActive) continue;
    for (let x = 0; x < width; x++) {
      const dx = ch * sinAz[x], dy = ch * cosAz[x];
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let j = 0; j < nActive; j++) {
        const k = active[j], p = projectors[k];
        if (!p.project(dx, dy, dz)) continue;
        const { u, v } = p;
        const edge = Math.min(u, v, p.width - u, p.height - v);
        if (edge <= 0) continue;
        const img = frames[k].image;
        // Frame image may be stored at another size than the intrinsics describe: scale.
        if (!sampleRgba(img, (u * img.width) / p.width - 0.5, (v * img.height) / p.height - 0.5, px)) continue;
        const t = Math.min(1, edge / feather[k]);
        const w = t * t * (3 - 2 * t) + 1e-4;
        r += w * px[0];
        g += w * px[1];
        b += w * px[2];
        wsum += w;
      }
      if (wsum > 0) {
        const i = (y * width + x) * 4;
        out[i] = r / wsum;
        out[i + 1] = g / wsum;
        out[i + 2] = b / wsum;
        out[i + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

/** Rotate a panorama in azimuth: content at azimuth a moves to a + deltaDeg (premultiplied linear interpolation). */
export function shiftPanorama(img: RgbaImage, deltaDeg: number): RgbaImage {
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const s = (deltaDeg * W) / 360, whole = Math.floor(s), f = s - whole;
  for (let x = 0; x < W; x++) {
    const x0 = (((x - whole - 1) % W) + W) % W, x1 = (((x - whole) % W) + W) % W;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4, i0 = (y * W + x0) * 4, i1 = (y * W + x1) * 4;
      const a0 = (f * data[i0 + 3]) / 255, a1 = ((1 - f) * data[i1 + 3]) / 255, a = a0 + a1;
      if (a <= 0) continue;
      out[i] = (a0 * data[i0] + a1 * data[i1]) / a;
      out[i + 1] = (a0 * data[i0 + 1] + a1 * data[i1 + 1]) / a;
      out[i + 2] = (a0 * data[i0 + 2] + a1 * data[i1 + 2]) / a;
      out[i + 3] = a * 255;
    }
  }
  return { width: W, height: H, data: out };
}
