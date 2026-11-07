/**
 * Background of the horizon viewer: the equirectangular photo where there is one, otherwise a sky gradient above the
 * site's skyline and dark ground below it.
 * - WebGL (PanoramaRenderer): a full-screen quad; the fragment shader turns each pixel into a ray, then (az, alt), and
 *   samples the panorama or the skyline texture.
 * - 2D fallback (backgroundPixels): the same colours computed on a coarse grid in JS, without the photo, for devices
 *   (and test environments) without WebGL.
 */
import { PANORAMA_ALT_MAX, PANORAMA_ALT_MIN } from '../photo-types';
import { SKY_COLOURS, backgroundRgb, fitTextureSize, screenToVec, viewBasis, type ViewState } from './view';

const RAD = Math.PI / 180;

/** Skyline bins handed to the shader (0.25°, like the photo grid). */
export const SKYLINE_BINS = 1440;

/**
 * A skyline function resampled into SKYLINE_BINS bins with linear interpolation (wrap-around), so the per-frame
 * drawing does not re-validate the profile layers thousands of times. Null stays null; unknown bins read 0°.
 */
export function sampleSkyline(skyline: ((az: number) => number | null) | null): ((az: number) => number) | null {
  if (!skyline) return null;
  const bins = new Float32Array(SKYLINE_BINS), step = 360 / SKYLINE_BINS;
  for (let i = 0; i < SKYLINE_BINS; i++) bins[i] = skyline(i * step) ?? 0;
  return (az: number) => {
    let x = (az % 360) / step;
    if (x < 0) x += SKYLINE_BINS;
    const i0 = Math.floor(x), f = x - i0, a = i0 % SKYLINE_BINS;
    return bins[a] * (1 - f) + bins[(a + 1) % SKYLINE_BINS] * f;
  };
}

/** Apparent skyline sampled into SKYLINE_BINS bins, 16-bit encoded in R and G ((alt + 90) / 180 · 65535). */
export function encodeSkyline(skyline: ((az: number) => number | null) | null): Uint8Array {
  const out = new Uint8Array(SKYLINE_BINS * 4);
  for (let i = 0; i < SKYLINE_BINS; i++) {
    const alt = skyline?.((i * 360) / SKYLINE_BINS) ?? 0;
    const enc = Math.round(((Math.max(-90, Math.min(90, alt)) + 90) / 180) * 65535);
    out[i * 4] = enc >> 8;
    out[i * 4 + 1] = enc & 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function decodeSkylineBin(bytes: Uint8Array, i: number): number {
  return ((bytes[i * 4] * 256 + bytes[i * 4 + 1]) / 65535) * 180 - 90;
}

/**
 * 2D fallback: RGBA pixels of the background for a `cols` × `rows` grid covering the view (draw it scaled up).
 * `skyline` is the combined apparent skyline (null = flat horizon at 0°); `light` from view.ts skyLight.
 */
export function backgroundPixels(view: ViewState, cols: number, rows: number, skyline: ((az: number) => number | null) | null, light: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cols * rows * 4), basis = viewBasis(view);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = screenToVec(view, ((i + 0.5) / cols) * view.width, ((j + 0.5) / rows) * view.height, basis);
      const alt = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
      const az = ((Math.atan2(v[0], v[1]) / RAD) % 360 + 360) % 360;
      const [r, g, b] = backgroundRgb(alt, skyline?.(az) ?? 0, light);
      const k = (j * cols + i) * 4;
      out[k] = r;
      out[k + 1] = g;
      out[k + 2] = b;
      out[k + 3] = 255;
    }
  }
  return out;
}

// ───────────────────────────── WebGL ─────────────────────────────

const VERT = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const glVec = (c: readonly number[]) => `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uForward; uniform vec3 uRight; uniform vec3 uUp;
uniform vec2 uSize; uniform float uFocal;
uniform sampler2D uSkyline; uniform float uHasSkyline;
uniform sampler2D uPhoto; uniform float uHasPhoto; uniform float uShift;
uniform float uLight;
const float PI = 3.14159265358979;
const float ALT_MIN = ${PANORAMA_ALT_MIN.toFixed(1)}; const float ALT_MAX = ${PANORAMA_ALT_MAX.toFixed(1)};
const float BINS = ${SKYLINE_BINS.toFixed(1)};
void main() {
  vec2 s = (gl_FragCoord.xy - 0.5 * uSize) / uFocal;
  vec3 d = normalize(uForward + s.x * uRight + s.y * uUp);
  float alt = degrees(asin(clamp(d.z, -1.0, 1.0)));
  float az = degrees(atan(d.x, d.y));
  if (az < 0.0) az += 360.0;
  float skyline = 0.0;
  if (uHasSkyline > 0.5) {
    float bin = mod(floor(az / 360.0 * BINS + 0.5), BINS);
    vec4 e = texture2D(uSkyline, vec2((bin + 0.5) / BINS, 0.5));
    skyline = (e.x * 255.0 * 256.0 + e.y * 255.0) / 65535.0 * 180.0 - 90.0;
  }
  float t = pow(clamp(alt / 90.0, 0.0, 1.0), 0.5);
  vec3 sky = mix(mix(${glVec(SKY_COLOURS.NIGHT_HORIZON)}, ${glVec(SKY_COLOURS.DAY_HORIZON)}, uLight),
                 mix(${glVec(SKY_COLOURS.NIGHT_ZENITH)}, ${glVec(SKY_COLOURS.DAY_ZENITH)}, uLight), t);
  vec3 colour = alt < skyline ? ${glVec(SKY_COLOURS.GROUND)} : sky;
  if (uHasPhoto > 0.5 && alt >= ALT_MIN && alt <= ALT_MAX) {
    float u = fract((az - uShift) / 360.0);
    vec4 c = texture2D(uPhoto, vec2(u, (ALT_MAX - alt) / (ALT_MAX - ALT_MIN)));
    colour = mix(colour, c.rgb, c.a);
  }
  gl_FragColor = vec4(colour, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
}

/** Full-screen WebGL renderer of the panorama / sky / ground. `create` returns null when WebGL is unavailable. */
export class PanoramaRenderer {
  private photo: WebGLTexture | null = null;
  private skyline: WebGLTexture;
  private hasSkyline = false;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  readonly maxTextureSize: number;

  private constructor(private gl: WebGLRenderingContext, program: WebGLProgram) {
    gl.useProgram(program);
    for (const n of ['uForward', 'uRight', 'uUp', 'uSize', 'uFocal', 'uSkyline', 'uHasSkyline', 'uPhoto', 'uHasPhoto', 'uShift', 'uLight']) {
      this.loc[n] = gl.getUniformLocation(program, n);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.skyline = gl.createTexture()!;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.uniform1i(this.loc.uPhoto, 0);
    gl.uniform1i(this.loc.uSkyline, 1);
  }

  static create(canvas: HTMLCanvasElement): PanoramaRenderer | null {
    let gl: WebGLRenderingContext | null = null;
    try {
      const opts = { antialias: false, premultipliedAlpha: false, alpha: false } as const;
      gl = (canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new PanoramaRenderer(gl, program);
  }

  private texture(unit: number, tex: WebGLTexture, wrapS: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Combined apparent skyline for the ground below it (null = flat horizon). */
  setSkyline(skyline: ((az: number) => number | null) | null) {
    const gl = this.gl;
    this.texture(1, this.skyline, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SKYLINE_BINS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, encodeSkyline(skyline));
    this.hasSkyline = !!skyline;
  }

  /** Uploads the panorama (already decoded; downscale it first with `fitTextureSize(…, maxTextureSize)`), or clears it. */
  setPhoto(image: TexImageSource | null) {
    const gl = this.gl;
    if (!image) {
      if (this.photo) gl.deleteTexture(this.photo);
      this.photo = null;
      return;
    }
    this.photo ??= gl.createTexture();
    // Width 4096 (or a downscaled power of two) repeats across north; never mipmapped (the wrap seam would show).
    this.texture(0, this.photo!, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  /** Draws one frame; `dpr` scales CSS pixels to the canvas's backing pixels. */
  draw(view: ViewState, dpr: number, opts: { light: number; shiftDeg: number }) {
    const gl = this.gl, b = viewBasis(view), l = this.loc;
    gl.viewport(0, 0, Math.round(view.width * dpr), Math.round(view.height * dpr));
    gl.uniform3fv(l.uForward, Array.from(b.forward));
    gl.uniform3fv(l.uRight, Array.from(b.right));
    gl.uniform3fv(l.uUp, Array.from(b.up));
    gl.uniform2f(l.uSize, view.width * dpr, view.height * dpr);
    gl.uniform1f(l.uFocal, b.focal * dpr);
    gl.uniform1f(l.uHasSkyline, this.hasSkyline ? 1 : 0);
    gl.uniform1f(l.uHasPhoto, this.photo ? 1 : 0);
    gl.uniform1f(l.uShift, opts.shiftDeg);
    gl.uniform1f(l.uLight, opts.light);
    if (this.photo) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.photo);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.skyline);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Decodes the stored panorama Blob, downscaled to fit the GPU's texture limit. */
export async function decodePanorama(blob: Blob, maxTextureSize: number): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob);
  const fit = fitTextureSize(bitmap.width, bitmap.height, maxTextureSize);
  if (fit.width === bitmap.width && fit.height === bitmap.height) return bitmap;
  const scaled = await createImageBitmap(bitmap, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: 'high' });
  bitmap.close();
  return scaled;
}
