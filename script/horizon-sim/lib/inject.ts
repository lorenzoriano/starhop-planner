/**
 * Browser-side init script for the runner (design 10.2 step 5). Wraps getUserMedia: the fake camera track (our
 * scene.y4m) goes through MediaStreamTrackProcessor → read the frame-number barcode → crop the strip off →
 * MediaStreamTrackGenerator, and the app receives the generated track. Each new frame number is reported to the runner
 * through the exposed binding `__simFrame(n)`, which pushes that frame's sensor readings over CDP. Falls back to a
 * canvas capture stream when the generator is missing. Optionally forces screen.orientation.angle.
 *
 * Exported as a function so Playwright can serialise it (`page.addInitScript(simInit, opts)`); it must not close over
 * anything outside its body.
 */
export interface InjectOptions {
  stripHeight: number;
  cells: number;
  bits: number;
  check: number;
  /** Force screen.orientation.angle (and window.orientation) when the emulation reports something else. */
  forceAngle: number | null;
}

export function simInit(opts: InjectOptions) {
  type W = typeof window & {
    __simFrame?: (n: number) => Promise<void>;
    __simState?: { frames: number; lastFrame: number; decodeFailures: number; mode: string; size: string; errors: string[]; reads: number; writes: number; writing: boolean };
    MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
    MediaStreamTrackGenerator?: new (init: { kind: string }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };
  };
  const w = window as W;
  const state = { frames: 0, lastFrame: -1, decodeFailures: 0, mode: 'none', size: '', errors: [] as string[], reads: 0, writes: 0, writing: false };
  w.__simState = state;

  if (opts.forceAngle !== null) {
    try {
      const angle = opts.forceAngle;
      if (screen.orientation && screen.orientation.angle !== angle) {
        Object.defineProperty(ScreenOrientation.prototype, 'angle', { get: () => angle, configurable: true });
        Object.defineProperty(ScreenOrientation.prototype, 'type', { get: () => (angle === 90 || angle === 270 ? 'landscape-primary' : 'portrait-primary'), configurable: true });
      }
      Object.defineProperty(window, 'orientation', { get: () => angle, configurable: true });
    } catch (e) {
      state.errors.push(`orientation override: ${String(e)}`);
    }
  }

  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const original = md.getUserMedia.bind(md);

  function decode(row: Uint8ClampedArray, width: number): number | null {
    const cellW = width / opts.cells;
    const cells: number[] = [];
    for (let c = 0; c < opts.cells; c++) {
      let sum = 0, n = 0;
      const x0 = Math.floor(c * cellW + cellW * 0.25), x1 = Math.floor(c * cellW + cellW * 0.75);
      for (let x = x0; x < x1; x++) { const i = x * 4; sum += (row[i] + row[i + 1] + row[i + 2]) / 3; n++; }
      cells.push(sum / n > 128 ? 1 : 0);
    }
    if (cells[0] !== 1 || cells[1] !== 0) return null;
    let v = 0, s = 0, chk = 0;
    for (let i = 0; i < opts.bits; i++) { v = v * 2 + cells[2 + i]; s += cells[2 + i]; }
    for (let i = 0; i < opts.check; i++) chk = chk * 2 + cells[2 + opts.bits + i];
    return s % 16 === chk ? v : null;
  }

  function report(n: number | null) {
    if (n === null) { state.decodeFailures++; return; }
    if (n === state.lastFrame) return;
    state.lastFrame = n;
    state.frames++;
    try { void w.__simFrame?.(n); } catch { /* runner gone */ }
  }

  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints);
    const track = stream.getVideoTracks()[0];
    if (!track) return stream;
    const settings = track.getSettings();
    const width = settings.width ?? 1280, height = settings.height ?? 960;
    const outH = height - opts.stripHeight;
    state.size = `${width}x${height}`;
    const strip = new OffscreenCanvas(width, opts.stripHeight);
    const sctx = strip.getContext('2d', { willReadFrequently: true })!;
    const readStrip = (src: CanvasImageSource) => {
      sctx.drawImage(src, 0, height - opts.stripHeight, width, opts.stripHeight, 0, 0, width, opts.stripHeight);
      return decode(sctx.getImageData(0, Math.floor(opts.stripHeight / 2), width, 1).data, width);
    };
    let out: MediaStreamTrack;
    if (w.MediaStreamTrackProcessor && w.MediaStreamTrackGenerator) {
      state.mode = 'generator';
      const processor = new w.MediaStreamTrackProcessor({ track });
      const generator = new w.MediaStreamTrackGenerator({ kind: 'video' });
      const reader = processor.readable.getReader();
      const writer = generator.writable.getWriter();
      void (async () => {
        try {
          for (;;) {
            const { value: frame, done } = await reader.read();
            if (done || !frame) break;
            state.reads++;
            try {
              report(readStrip(frame));
              const cropped = new VideoFrame(frame, { visibleRect: { x: 0, y: 0, width, height: outH }, displayWidth: width, displayHeight: outH });
              state.writing = true;
              await writer.write(cropped);
              state.writing = false;
              state.writes++;
            } finally {
              frame.close();
            }
          }
        } catch (e) {
          state.errors.push(`pump: ${String(e)}`);
        }
      })();
      out = generator;
    } else {
      state.mode = 'canvas';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      void video.play();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      const cap = canvas.captureStream(30);
      const tick = () => {
        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, width, outH, 0, 0, width, outH);
          report(readStrip(video));
        }
        if (track.readyState === 'live') (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback?.(tick) ?? setTimeout(tick, 15);
      };
      tick();
      out = cap.getVideoTracks()[0];
    }
    // Make the generated track look like the camera (label, settings) and stop the real one with it.
    const label = track.label;
    try { Object.defineProperty(out, 'label', { get: () => label }); } catch { /* ignore */ }
    const baseSettings = { ...settings, width, height: outH, aspectRatio: width / outH, facingMode: 'environment' };
    out.getSettings = () => baseSettings as MediaTrackSettings;
    const caps = track.getCapabilities?.() ?? {};
    out.getCapabilities = () => ({ ...caps, width: { min: width, max: width }, height: { min: outH, max: outH } } as MediaTrackCapabilities);
    out.applyConstraints = async () => undefined;
    const stop = out.stop.bind(out);
    out.stop = () => { stop(); track.stop(); };
    return new MediaStream([out, ...stream.getAudioTracks()]);
  };
}
