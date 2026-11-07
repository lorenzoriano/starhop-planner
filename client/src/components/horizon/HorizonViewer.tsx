/**
 * "Look around": a 360° view of the site (docs/local-horizon-design.md, phase 3). The stored photo panorama (WebGL),
 * or a sky gradient with the site's skyline as dark ground; stars, constellation lines, the Sun, Moon, planets and the
 * targets passed in, for any time tonight; the terrain line over the photo so the alignment can be checked, and
 * "Line up" to fix it. Drag to look around, pinch or wheel to zoom, or "Move the phone" to use it as a window.
 *
 * Opened full screen as a native modal <dialog> (top layer), so it also works from inside the site dialog, whose
 * transform would otherwise trap a fixed overlay. Default export for React.lazy.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import tzLookup from 'tz-lookup';
import { useLocalHorizon } from '@/hooks/use-local-horizon';
import { loadConstellations, loadStars, type ConstellationLine, type Star } from '@/lib/astronomy';
import { horizonAltitudeAt } from '@/lib/horizon/profile';
import { applyYaw } from '@/lib/horizon/calibrate/quat';
import { cameraPointing } from '@/lib/horizon/calibrate/camera';
import type { LocalHorizon } from '@/lib/horizon/types';
import {
  clampPitch, degPerPixel, dragView, normAz, skyLight, zoomView, type ViewState,
} from '@/lib/horizon/viewer/view';
import { bodyPoints, buildCatalogue, horizontalMatrix, skyPoints, tonightWindow, type SkyCatalogue } from '@/lib/horizon/viewer/sky';
import { drawOverlay, lookingAt, shiftWords, type OverlayScene } from '@/lib/horizon/viewer/overlay';
import { PanoramaRenderer, backgroundPixels, decodePanorama, sampleSkyline } from '@/lib/horizon/viewer/background';
import { startPhoneOrientation } from '@/lib/horizon/viewer/motion';
import './HorizonViewer.css';

export interface HorizonViewerProps {
  lat: number;
  lon: number;
  date?: Date;
  targets?: Array<{ id: string; name: string; ra: number; dec: number }>;
  onClose: () => void;
}

type PhotoState = 'loading' | 'none' | 'ready' | 'unsupported' | 'error';
const MINUTE = 60000;
/** Coarse grid for the 2D fallback background (CSS pixels per cell). */
const FALLBACK_CELL = 4;

/** One WebGL renderer per canvas (StrictMode runs effects twice; a canvas keeps its first context type). */
const renderers = new WeakMap<HTMLCanvasElement, PanoramaRenderer | null>();
function rendererFor(canvas: HTMLCanvasElement) {
  if (!renderers.has(canvas)) renderers.set(canvas, PanoramaRenderer.create(canvas));
  return renderers.get(canvas)!;
}

function timeLabel(ms: number, tz: string | null) {
  try {
    if (tz) return formatInTimeZone(ms, tz, 'HH:mm');
  } catch { /* fall back to the browser's zone */ }
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const layerFn = (h: LocalHorizon | null | undefined) => (h && (h.terrain || h.photo) ? (az: number) => horizonAltitudeAt(h, az) : null);

export default function HorizonViewer({ lat, lon, date, targets, onClose }: HorizonViewerProps) {
  const { horizon } = useLocalHorizon(lat, lon);
  const tz = useMemo(() => { try { return tzLookup(lat, lon); } catch { return null; } }, [lat, lon]);

  // ── time ──
  const [anchor, setAnchor] = useState(() => +(date ?? new Date()));
  const night = useMemo(() => tonightWindow(lat, lon, new Date(anchor)), [lat, lon, anchor]);
  const [time, setTime] = useState(anchor);
  const t = Math.min(+night.end, Math.max(+night.start, time));
  const totalMinutes = Math.max(1, Math.round((+night.end - +night.start) / MINUTE));

  // ── catalogue ──
  const [raw, setRaw] = useState<{ stars: Star[]; lines: ConstellationLine[] } | null>(null);
  const [starsFailed, setStarsFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([loadStars(), loadConstellations()])
      .then(([stars, lines]) => { if (live) setRaw({ stars, lines }); })
      .catch(() => { if (live) setStarsFailed(true); });
    return () => { live = false; };
  }, []);
  const targetKey = (targets ?? []).map((x) => `${x.id}:${x.ra}:${x.dec}:${x.name}`).join('|');
  const catalogue = useMemo<SkyCatalogue | null>(() => raw
    ? buildCatalogue(raw.stars, raw.lines, targets ?? [], new Date((+night.start + +night.end) / 2))
    : null,
  // targets are compared by content
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [raw, targetKey, night]);

  // ── skylines (sampled once per horizon) ──
  const combined = useMemo(() => sampleSkyline(layerFn(horizon)), [horizon]);
  const terrain = useMemo(() => sampleSkyline(layerFn(horizon?.terrain ? { terrain: horizon.terrain } : null)), [horizon]);

  // ── canvases and renderer ──
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'gl' | '2d' | null>(null);
  const rendererRef = useRef<PanoramaRenderer | null>(null);
  const viewRef = useRef<ViewState>({ yaw: 180, pitch: 20, fovDeg: 70, width: 1, height: 1 });
  const dprRef = useRef(1);
  const [looking, setLooking] = useState(() => lookingAt(180, 20));

  // ── photo and alignment ──
  const [photo, setPhoto] = useState<PhotoState>('loading');
  const [align, setAlign] = useState<{ shift: number; saving: boolean; error?: string } | null>(null);
  const [motion, setMotion] = useState<'off' | 'starting' | 'on'>('off');
  const [motionError, setMotionError] = useState<string | null>(null);
  const [motionAvailable, setMotionAvailable] = useState(false);
  const stopMotionRef = useRef<(() => void) | null>(null);

  // Latest values for the drawing callback.
  const latest = useRef({ t, catalogue, horizon, combined, terrain, shift: 0, photo, mode });
  latest.current = { t, catalogue, horizon, combined, terrain, shift: align?.shift ?? 0, photo, mode };

  // Sky positions are recomputed only when the time, catalogue or horizon change (one rotation per tick).
  const skyCache = useRef<{ key: unknown[]; scene: Omit<OverlayScene, 'skyline' | 'skylineStyle'>; light: number } | null>(null);
  const skyFor = useCallback(() => {
    const { t: now, catalogue: cat, horizon: h } = latest.current;
    const key = [now, cat, h];
    const c = skyCache.current;
    if (c && c.key.every((k, i) => k === key[i])) return c;
    const date = new Date(now), m = horizontalMatrix(lat, lon, date);
    const bodies = bodyPoints(lat, lon, date, h);
    const scene = {
      catalogue: cat,
      stars: cat ? skyPoints(cat.starVecs, m, h) : [],
      lines: cat ? skyPoints(cat.lineVecs, m, h) : [],
      targets: cat ? skyPoints(cat.targetVecs, m, h) : [],
      bodies,
    };
    skyCache.current = { key, scene, light: skyLight(bodies[0].alt) };
    return skyCache.current;
  }, [lat, lon]);

  const frame = useRef(0);
  const draw = useCallback(() => {
    frame.current = 0;
    const view = viewRef.current, dpr = dprRef.current, l = latest.current;
    const sky = skyFor();
    const bg = bgRef.current, overlay = overlayRef.current;
    if (!bg || !overlay || view.width < 2) return;
    const renderer = rendererRef.current;
    if (renderer) renderer.draw(view, dpr, { light: sky.light, shiftDeg: l.shift });
    else if (l.mode === '2d') {
      const ctx = bg.getContext('2d');
      if (ctx) {
        const cols = Math.ceil(view.width / FALLBACK_CELL), rows = Math.ceil(view.height / FALLBACK_CELL);
        const img = ctx.createImageData(cols, rows);
        img.data.set(backgroundPixels(view, cols, rows, l.combined, sky.light));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(bg, 0, 0, cols, rows, 0, 0, bg.width, bg.height);
      }
    }
    const octx = overlay.getContext('2d');
    if (octx) {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const withPhoto = l.photo === 'ready';
      drawOverlay(octx, view, { ...sky.scene, skyline: withPhoto ? l.terrain : l.combined, skylineStyle: withPhoto ? 'terrain' : 'ridge' });
    }
    const words = lookingAt(view.yaw, view.pitch);
    setLooking((old) => (old === words ? old : words));
  }, [skyFor]);
  const requestDraw = useCallback(() => {
    if (!frame.current && typeof requestAnimationFrame !== 'undefined') frame.current = requestAnimationFrame(draw);
  }, [draw]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  // The latest onClose (the caller may pass a new function on every render; the dialog must not reopen for that).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Open as a modal dialog in the top layer; Escape closes only the viewer.
  useLayoutEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    try { if (!d.open) d.showModal(); } catch { d.setAttribute('open', ''); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // before an enclosing dialog's capture listener on document
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      try { d.close(); } catch { /* already closed */ }
    };
  }, [close]);

  // Pick WebGL or the 2D fallback once the canvas exists.
  useLayoutEffect(() => {
    const canvas = bgRef.current;
    if (!canvas || mode === '2d') return;
    const r = rendererFor(canvas);
    rendererRef.current = r;
    if (!r) { setMode('2d'); return; }
    setMode('gl');
    const lost = (e: Event) => { e.preventDefault(); rendererRef.current = null; setMode('2d'); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      // Free the GPU context once the canvas is really gone (not on a StrictMode re-run, which keeps the canvas).
      setTimeout(() => {
        if (canvas.isConnected) return;
        renderers.delete(canvas);
        r.dispose();
      }, 0);
    };
  }, [mode]);

  // Skyline texture for the shader.
  useEffect(() => {
    rendererRef.current?.setSkyline(combined);
    requestDraw();
  }, [combined, mode, requestDraw]);

  // Size the canvases to the screen (portrait, landscape, rotation).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      dprRef.current = dpr;
      viewRef.current = { ...viewRef.current, width: w, height: h };
      for (const c of [bgRef.current, overlayRef.current]) {
        if (!c) continue;
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
      }
      requestDraw();
    };
    resize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [mode, requestDraw]);

  // Load the stored photo panorama.
  const [photoVersion, setPhotoVersion] = useState(0);
  useEffect(() => {
    if (!mode) return;
    let live = true;
    (async () => {
      try {
        const { readPhotoSite } = await import('@/lib/horizon/photo-store');
        const site = await readPhotoSite(lat, lon);
        if (!live) return;
        if (!site?.panorama) { rendererRef.current?.setPhoto(null); setPhoto('none'); setAlign(null); return; }
        const renderer = rendererRef.current;
        if (!renderer) { setPhoto('unsupported'); return; }
        const bitmap = await decodePanorama(site.panorama, renderer.maxTextureSize);
        if (!live) { bitmap.close(); return; }
        renderer.setPhoto(bitmap);
        bitmap.close();
        setPhoto('ready');
        // After "Save" the stored panorama already includes the shift: end the preview in the same frame.
        setAlign((a) => (a?.saving ? null : a));
      } catch {
        if (live) { setPhoto('error'); setAlign(null); }
      }
    })();
    return () => { live = false; };
  }, [lat, lon, mode, photoVersion]);

  // Redraw whenever anything drawn changes.
  useEffect(requestDraw, [t, catalogue, horizon, combined, terrain, photo, align?.shift, requestDraw]);

  // ── move the phone ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Phones and tablets with a compass (iPhones send no absolute orientation, desktops have no sensor).
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    setMotionAvailable(touch && ('AbsoluteOrientationSensor' in window || 'ondeviceorientationabsolute' in window));
    return () => stopMotionRef.current?.();
  }, []);
  const toggleMotion = async () => {
    if (motion !== 'off') {
      stopMotionRef.current?.();
      stopMotionRef.current = null;
      setMotion('off');
      return;
    }
    setMotion('starting');
    setMotionError(null);
    let declination = 0;
    try {
      const { magneticDeclinationDeg } = await import('@/lib/horizon/calibrate/declination');
      declination = magneticDeclinationDeg(lat, lon, new Date());
    } catch { /* a few degrees off is better than nothing */ }
    try {
      const stop = await startPhoneOrientation((q, screenAngle) => {
        const p = cameraPointing({ q: applyYaw(q, declination), screenAngle });
        const v = viewRef.current;
        // Light smoothing against sensor jitter.
        const dyaw = ((p.az - v.yaw + 540) % 360) - 180;
        viewRef.current = { ...v, yaw: normAz(v.yaw + 0.5 * dyaw), pitch: clampPitch(v.pitch + 0.5 * (p.alt - v.pitch)) };
        requestDraw();
      });
      // Closed while the sensor was starting: stop it right away.
      if (!mounted.current) { stop(); return; }
      stopMotionRef.current = stop;
      setMotion('on');
    } catch (e) {
      setMotion('off');
      setMotionError(e instanceof Error ? e.message : 'This device cannot tell which way it is pointing.');
    }
  };

  // ── pointer, wheel and keys ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointers.current, prev = map.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const other = Array.from(map.entries()).find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 10) viewRef.current = zoomView(viewRef.current, after / before);
    } else if (align) {
      const shift = align.shift + (next.x - prev.x) * degPerPixel(viewRef.current);
      setAlign({ ...align, shift });
    } else if (motion === 'off') {
      viewRef.current = dragView(viewRef.current, next.x - prev.x, next.y - prev.y);
    }
    map.set(e.pointerId, next);
    requestDraw();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => { pointers.current.delete(e.pointerId); };
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      viewRef.current = zoomView(viewRef.current, Math.exp(-e.deltaY * 0.0015));
      requestDraw();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [mode, requestDraw]);
  const onStageKey = (e: ReactKeyboardEvent) => {
    const v = viewRef.current, step = e.shiftKey ? 1 : 5;
    if (align && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      setAlign({ ...align, shift: align.shift + (e.key === 'ArrowRight' ? 0.1 : -0.1) * (e.shiftKey ? 10 : 1) });
    } else if (e.key === 'ArrowLeft') viewRef.current = { ...v, yaw: normAz(v.yaw - step) };
    else if (e.key === 'ArrowRight') viewRef.current = { ...v, yaw: normAz(v.yaw + step) };
    else if (e.key === 'ArrowUp') viewRef.current = { ...v, pitch: clampPitch(v.pitch + step) };
    else if (e.key === 'ArrowDown') viewRef.current = { ...v, pitch: clampPitch(v.pitch - step) };
    else if (e.key === '+' || e.key === '=') viewRef.current = zoomView(v, 1.15);
    else if (e.key === '-') viewRef.current = zoomView(v, 1 / 1.15);
    else return;
    e.preventDefault();
    requestDraw();
  };

  // ── alignment ──
  const saveAlign = async () => {
    if (!align) return;
    if (Math.abs(align.shift) < 0.05) { setAlign(null); return; }
    setAlign({ ...align, saving: true, error: undefined });
    let store: typeof import('@/lib/horizon/photo-store') | null = null;
    try {
      store = await import('@/lib/horizon/photo-store');
      const profile = await store.shiftPhotoHorizon(lat, lon, align.shift);
      if (!profile) throw new Error('no capture');
      setPhotoVersion((v) => v + 1); // the reload ends alignment once the shifted panorama is on screen
    } catch (e) {
      // Storage full or blocked, or the photo could not be turned: say which, in plain words (nothing was changed).
      const error = store && e instanceof store.PhotoStoreError ? e.message : 'Could not save the new alignment.';
      setAlign((a) => (a ? { ...a, saving: false, error } : a));
    }
  };

  const status = starsFailed ? 'Could not load the stars.'
    : photo === 'loading' ? 'Loading…'
    : photo === 'ready' ? (horizon?.terrain ? 'Orange line: the hills from the terrain map. If the photo looks turned, use Line up.' : 'Showing your photo of the site.')
    : photo === 'unsupported' ? 'This device cannot show the photo here; showing the skyline only.'
    : photo === 'error' ? 'Could not open the photo; showing the skyline only.'
    : horizon?.terrain ? 'No photo of this site yet. The dark ground shows the hills from the terrain map.'
    : 'No photo or terrain map for this site yet; a flat horizon is shown.';

  return <dialog ref={dialogRef} className="horizon-viewer" aria-label="Look around" onCancel={(e) => { e.preventDefault(); close(); }}>
    <div ref={stageRef} className="horizon-viewer-stage">
      <canvas key={mode === '2d' ? '2d' : 'gl'} ref={bgRef} className="horizon-viewer-bg" aria-hidden="true"/>
      <canvas ref={overlayRef} className="horizon-viewer-overlay" tabIndex={0} role="img"
        aria-label={`Sky view. ${looking}. Drag to look around, pinch to zoom; arrow keys also work.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onStageKey}/>
    </div>
    <div className="horizon-viewer-top">
      <button type="button" className="horizon-viewer-close" onClick={close}>Close</button>
      <span className="horizon-viewer-looking" aria-hidden="true">{looking}</span>
    </div>
    <div className="horizon-viewer-panel">
      {align ? <div className="horizon-viewer-align">
        <p>Drag sideways until the photo's hills sit on the orange line.</p>
        <div className="horizon-viewer-row">
          <button type="button" aria-label="Move the photo left" onClick={() => setAlign({ ...align, shift: align.shift - 0.1 })}>◀</button>
          <span role="status" className="horizon-viewer-shift">{shiftWords(align.shift)}</span>
          <button type="button" aria-label="Move the photo right" onClick={() => setAlign({ ...align, shift: align.shift + 0.1 })}>▶</button>
        </div>
        <div className="horizon-viewer-row">
          <button type="button" className="primary" disabled={align.saving} onClick={() => void saveAlign()}>{align.saving ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={align.saving} onClick={() => setAlign(null)}>Cancel</button>
        </div>
        {align.error && <p role="alert">{align.error}</p>}
      </div> : <>
        <div className="horizon-viewer-row horizon-viewer-time">
          <span className="horizon-viewer-clock">{timeLabel(t, tz)}</span>
          <input type="range" aria-label="Time tonight" aria-valuetext={timeLabel(t, tz)} min={0} max={totalMinutes} step={1}
            value={Math.round((t - +night.start) / MINUTE)}
            onChange={(e) => setTime(+night.start + Number(e.target.value) * MINUTE)}/>
          <button type="button" onClick={() => { const now = Date.now(); setAnchor(now); setTime(now); }}>Now</button>
        </div>
        <div className="horizon-viewer-row horizon-viewer-ends" aria-hidden="true">
          <span>{night.sunset ? `Sunset ${timeLabel(+night.sunset, tz)}` : timeLabel(+night.start, tz)}</span>
          <span>{night.sunrise ? `Sunrise ${timeLabel(+night.sunrise, tz)}` : timeLabel(+night.end, tz)}</span>
        </div>
        <div className="horizon-viewer-row">
          {photo === 'ready' && <button type="button" onClick={() => { setAlign({ shift: 0, saving: false }); if (motion !== 'off') void toggleMotion(); }}>Line up</button>}
          {motionAvailable && <button type="button" aria-pressed={motion !== 'off'} disabled={motion === 'starting'} onClick={() => void toggleMotion()}>Move the phone</button>}
        </div>
        {motionError && <p role="alert" className="horizon-viewer-note">{motionError}</p>}
      </>}
      <p role="status" className="horizon-viewer-note">{status}</p>
    </div>
  </dialog>;
}
