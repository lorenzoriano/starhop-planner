/**
 * "Add trees and buildings": the guided camera sweep, the optional Sun/Moon/planet/star tap, processing, review and
 * save (docs/local-horizon-design.md, section 9 phase 2). Full-screen; lazy-loaded from the horizon panel.
 *
 * Stable hooks for the simulation harness: root data-testid="horizon-capture"; buttons "Start", "Add the tall-tree
 * ring", "Finish sweep", "Tap when centred", "Skip", "Save"; the night trace area data-testid="horizon-trace"; the
 * chosen alignment in data-testid="horizon-yaw"; progress text in role="status".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { azAltToPixel, focalPx, type CameraIntrinsics } from '@/lib/horizon/calibrate/camera';
import { readCameraCalibration } from '@/lib/horizon/calibrate/calibration-store';
import { magneticDeclinationDeg } from '@/lib/horizon/calibrate/declination';
import { applyYaw } from '@/lib/horizon/calibrate/quat';
import { tapTargets, type TapTarget } from '@/lib/horizon/calibrate/tap-targets';
import { bearingDeg, landmarkFix } from '@/lib/horizon/calibrate/yaw';
import { openCamera, type CameraStream } from '@/lib/horizon/capture/camera-stream';
import { CaptureGuide, type GuideView } from '@/lib/horizon/capture/guide';
import { compassOnlyNote, lightAt, processCapture, type CaptureResult, type CaptureTap } from '@/lib/horizon/capture/pipeline';
import {
  azAltToStrip, chooseLandmark, gridRectInStrip, maskTint, orderTrace, parseLatLon, stripToAzAlt, SUN_WARNING,
  tapInstruction, traceCoverage, traceTerrainFix, visibleTapTargets, yawSentence,
} from '@/lib/horizon/capture/review';
import { startOrientation, type OrientationSource } from '@/lib/horizon/capture/sensors';
import { PHOTO_SAVE_FAILED, PhotoStoreError, savePhotoHorizon } from '@/lib/horizon/photo-store';
import type { CapturedFrame, RgbaImage, SkyGrid, YawChoice } from '@/lib/horizon/photo-types';
import { gridFromTrace, paintGrid, shiftGrid } from '@/lib/horizon/segment/grid';
import { resetSegformer } from '@/lib/horizon/segment/segformer-client';
import { retrySegmentationModel } from '@/lib/horizon/segment/segment-frame';
import { shiftPanorama } from '@/lib/horizon/segment/panorama';
import { snapTraceToEdges } from '@/lib/horizon/segment/trace';
import type { HorizonProfile } from '@/lib/horizon/types';
import './HorizonCapture.css';

type Step = 'intro' | 'starting' | 'sweep' | 'align' | 'processing' | 'review' | 'saving' | 'done' | 'error';
type Tool = 'look' | 'add' | 'remove' | 'trace' | 'landmark';

/** Typical main-camera field of view across a 4:3 landscape video frame, degrees (refined by the sweep). */
const DEFAULT_HFOV = 66;
const BRUSH_DEG = 1.5;
/** Strip canvas size: half the stored panorama. */
const STRIP_W = 2048, STRIP_H = 512;

function screenAngle(): number {
  const a = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

function lockLandscape() {
  const el = document.documentElement;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  void (el.requestFullscreen?.() ?? Promise.resolve())
    .then(() => orientation?.lock?.('landscape'))
    .catch(() => {});
}

function unlockLandscape() {
  try { (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.(); } catch { /* not locked */ }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

/** Encode the panorama for IndexedDB (WebP where the browser can, else PNG). */
async function panoramaBlob(img: RgbaImage): Promise<Blob | null> {
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(img.width, img.height);
      c.getContext('2d')!.putImageData(data, 0, 0);
      return await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
    }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d')!.putImageData(data, 0, 0);
    return await new Promise(resolve => c.toBlob(resolve, 'image/webp', 0.85));
  } catch {
    return null; // The horizon still works without the picture; only Look around loses the photo.
  }
}

function imageCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export default function HorizonCapture({ lat, lon, terrain, onClose }: {
  lat: number; lon: number; terrain: HorizonProfile | null; onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState('');
  const [view, setView] = useState<GuideView | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [targets, setTargets] = useState<TapTarget[]>([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [marker, setMarker] = useState<{ u: number; v: number } | null>(null);
  const [progress, setProgress] = useState({ fraction: 0, message: '' });
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [saveError, setSaveError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<CameraStream | null>(null);
  const sensorsRef = useRef<OrientationSource | null>(null);
  const guideRef = useRef<CaptureGuide | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const tapsRef = useRef<CaptureTap[]>([]);
  const camRef = useRef<CameraIntrinsics>({ width: 1280, height: 960, hfovDeg: DEFAULT_HFOV });
  const stepRef = useRef<Step>('intro');
  const t0Ref = useRef(0);
  const rafRef = useRef(0);
  const targetRef = useRef<TapTarget | null>(null);
  const mountedRef = useRef(true);
  const runRef = useRef<AbortController | null>(null);
  /** Magnetic declination for the align step's rough marker (computed once per step, not per frame). */
  const declinationRef = useRef(0);
  stepRef.current = step;
  targetRef.current = targets[targetIndex] ?? null;

  const stopDevices = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    cameraRef.current?.stop();
    cameraRef.current = null;
    sensorsRef.current?.stop();
    sensorsRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current?.abort(); // processing stops at its next step
      stopDevices();
      unlockLandscape();
    };
  }, [stopDevices]);

  const close = useCallback(() => { stopDevices(); unlockLandscape(); onClose(); }, [onClose, stopDevices]);

  // One animation loop for the live steps: feeds the guide during the sweep, places the predicted marker while aligning.
  const loop = useCallback(() => {
    const sensors = sensorsRef.current, camera = cameraRef.current, guide = guideRef.current;
    if (!sensors || !camera) return;
    const r = sensors.latest();
    const angle = screenAngle();
    if (r && stepRef.current === 'sweep' && guide) {
      const v = guide.update({ qRel: r.qRel, qAbs: r.qAbs, t: r.t, screenAngle: angle });
      if (v.capture) {
        const c = v.capture, image = camera.grabFrame();
        // The lens is calibrated across the width of a landscape frame: a portrait frame (the stream has not turned
        // with the screen yet) is not used, and the dot stays pending.
        if (image.width >= image.height) {
          framesRef.current.push({
            id: framesRef.current.length, image, qRel: c.qRel, qAbs: c.qAbs, screenAngle: c.screenAngle,
            t: c.t - t0Ref.current, ring: c.ring, stillDegPerSec: c.stillDegPerSec,
          });
          setFrameCount(framesRef.current.length);
          navigator.vibrate?.(30);
        } else guide.forget(c.dotId);
      }
      setView(v);
    } else if (r && stepRef.current === 'align') {
      const t = targetRef.current;
      // Rough position from the compass, only to help find the object; the tap itself does not use the compass.
      if (t && r.qAbs) {
        const q = applyYaw(r.qAbs, declinationRef.current);
        setMarker(azAltToPixel({ q, screenAngle: angle }, camRef.current, t.az, t.alt));
      } else setMarker(null);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = async () => {
    setStep('starting');
    lockLandscape();
    try {
      const camera = await openCamera(videoRef.current!);
      // Closed while the permission prompt or the camera was starting: release it at once.
      if (!mountedRef.current) { camera.stop(); return; }
      cameraRef.current = camera;
      const sensors = await startOrientation();
      if (!mountedRef.current) { sensors.stop(); stopDevices(); return; }
      sensorsRef.current = sensors;
      const stored = readCameraCalibration(camera.cameraKey);
      camRef.current = { width: camera.width, height: camera.height, hfovDeg: stored?.hfovDeg ?? DEFAULT_HFOV, k1: stored?.k1 };
    } catch (e) {
      stopDevices();
      setError(e instanceof Error ? e.message : 'The camera or motion sensors could not be started.');
      setStep('error');
      return;
    }
    guideRef.current = new CaptureGuide({ cam: camRef.current });
    framesRef.current = [];
    tapsRef.current = [];
    t0Ref.current = performance.now();
    setStep('sweep');
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const finishSweep = useCallback(() => {
    const now = new Date();
    declinationRef.current = magneticDeclinationDeg(lat, lon, now);
    setTargets(visibleTapTargets(tapTargets(lat, lon, now, terrain ? { terrain } : null), lightAt(lat, lon, now).light));
    setTargetIndex(0);
    setStep('align');
  }, [lat, lon, terrain]);

  // The sweep finishes by itself once every started ring is done.
  useEffect(() => {
    if (step === 'sweep' && view?.complete) finishSweep();
  }, [step, view?.complete, finishSweep]);

  // Keep the guide's lens in step with the stream (it may switch size when the phone turns).
  useEffect(() => {
    const camera = cameraRef.current;
    if (camera && step === 'sweep' && (camera.width !== camRef.current.width || camera.height !== camRef.current.height)) {
      camRef.current = { ...camRef.current, width: camera.width, height: camera.height };
      guideRef.current?.setCamera(camRef.current);
    }
  });

  const runPipeline = useCallback(async () => {
    const camera = cameraRef.current;
    const cameraKey = camera?.cameraKey ?? 'unknown';
    const guess = { ...camRef.current };
    stopDevices();
    setStep('processing');
    const run = new AbortController();
    runRef.current = run;
    retrySegmentationModel(); // a model that failed during an earlier capture gets another chance
    try {
      const res = await processCapture({
        frames: framesRef.current, taps: tapsRef.current, lat, lon, date: new Date(), terrain, cameraKey,
        deviceGuess: { width: guess.width, height: guess.height, hfovDeg: guess.hfovDeg }, signal: run.signal,
      }, (fraction, message) => setProgress({ fraction, message }));
      framesRef.current = []; // raw frames are not kept
      setSaveError('');
      setResult(res);
      setStep('review');
    } catch (e) {
      if (run.signal.aborted) return; // closed while processing
      setError(e instanceof Error ? e.message : 'The photos could not be processed.');
      setStep('error');
    } finally {
      runRef.current = null;
      // Free the sky model (worker, weights and runtime) until the next capture.
      resetSegformer();
    }
  }, [lat, lon, terrain, stopDevices]);

  const tap = () => {
    const sensors = sensorsRef.current, t = targetRef.current;
    const held = sensors?.recent(300);
    if (held && t) {
      // Recompute the body's position for this very moment.
      const now = tapTargets(lat, lon, new Date(), terrain ? { terrain } : null).find((x: TapTarget) => x.label === t.label) ?? t;
      tapsRef.current.push({ qRel: held.qRel, screenAngle: screenAngle(), target: now });
    }
    void runPipeline();
  };

  const target = targets[targetIndex] ?? null;
  const cam = camRef.current;
  const reticleR = Math.max(12, focalPx(cam) * Math.tan((2.5 * Math.PI) / 180));
  const live = step === 'starting' || step === 'sweep' || step === 'align';

  return <div className="horizon-capture" data-testid="horizon-capture">
    <video ref={videoRef} className="horizon-capture-video" hidden={!live} muted playsInline />
    {(step === 'sweep' || step === 'align') && <svg className="horizon-capture-overlay" viewBox={`0 0 ${cam.width} ${cam.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {step === 'sweep' && view?.dots.filter(d => d.visible).map(d => <circle key={d.id} cx={d.u!} cy={d.v!} r={reticleR * 0.55}
        className={d.done ? 'hc-dot hc-dot-done' : d.target ? 'hc-dot hc-dot-target' : 'hc-dot'} />)}
      {step === 'align' && marker && <g className="hc-marker"><circle cx={marker.u} cy={marker.v} r={reticleR * 1.6} /><text x={marker.u} y={marker.v - reticleR * 2}>{target?.label} (roughly)</text></g>}
      <circle className="hc-reticle" cx={cam.width / 2} cy={cam.height / 2} r={reticleR} />
      {step === 'sweep' && view && view.holding > 0 && <circle className="hc-hold" cx={cam.width / 2} cy={cam.height / 2} r={reticleR}
        pathLength={1} strokeDasharray={`${view.holding} 1`} transform={`rotate(-90 ${cam.width / 2} ${cam.height / 2})`} />}
    </svg>}

    <div className="horizon-capture-panel">
      <button type="button" className="horizon-capture-close" onClick={close} aria-label="Close">✕</button>

      {step === 'intro' && <div className="hc-card">
        <h2>Add trees and buildings</h2>
        <p>Stand where the telescope stands. Hold the phone sideways and turn it around itself, close to your body, not at arm&apos;s length. Point the circle at each dot and hold still; the photos take themselves.</p>
        <button type="button" className="hc-primary" onClick={() => void start()}>Start</button>
      </div>}

      {step === 'starting' && <p className="hc-card" role="status">Starting the camera…</p>}

      {step === 'sweep' && <div className="hc-bar">
        <p role="status" className="hc-status">
          {view ? `${view.ring0.done} of ${view.ring0.total}${view.ring1 ? ` · tall trees ${view.ring1.done} of ${view.ring1.total}` : ''}` : 'Point the camera at the horizon'}
          {view?.hint ? ` · ${view.hint}` : ''}
        </p>
        <div className="hc-actions">
          {view?.canFinish && !view.ring1 && <button type="button" onClick={() => guideRef.current?.addRing1()}>Add the tall-tree ring</button>}
          <button type="button" className="hc-primary" disabled={!view?.canFinish} onClick={finishSweep}>Finish sweep</button>
        </div>
      </div>}

      {step === 'align' && <div className="hc-bar hc-align">
        {target
          ? <>
              <p role="status" className="hc-status">{tapInstruction(target)}</p>
              {target.source === 'sun' && <p className="hc-warning" role="alert">{SUN_WARNING}</p>}
              <div className="hc-actions">
                <button type="button" className="hc-primary" onClick={tap}>Tap when centred</button>
                {targets.length > 1 && <button type="button" onClick={() => setTargetIndex((targetIndex + 1) % targets.length)}>Another object</button>}
                <button type="button" onClick={() => void runPipeline()}>Skip</button>
              </div>
            </>
          : <>
              <p role="status" className="hc-status">Nothing bright enough to line up with right now. North will come from {terrain ? 'the compass (approximate) or the hills' : 'the compass (approximate)'}; you can fix it later with "Line up" in Look around.</p>
              <div className="hc-actions"><button type="button" className="hc-primary" onClick={() => void runPipeline()}>Skip</button></div>
            </>}
      </div>}

      {step === 'processing' && <div className="hc-card">
        <p role="status">{progress.message || 'Working…'} {Math.round(progress.fraction * 100)}%</p>
        <progress max={1} value={progress.fraction} aria-label="Processing progress" />
        <p className="hc-note">{frameCount} photos. This can take a minute on a phone.</p>
      </div>}

      {(step === 'review' || step === 'saving') && result && <Review lat={lat} lon={lon} terrain={terrain} result={result} saving={step === 'saving'}
        saveError={saveError}
        onSave={async (grid, panorama, yaw, traced) => {
          setStep('saving');
          setSaveError('');
          try {
            const blob = await panoramaBlob(panorama);
            const record = { ...result.record, yaw, ...(traced ? { segmentation: 'trace' as const } : {}) };
            await savePhotoHorizon({ lat, lon, grid, record, panorama: blob });
            setStep('done');
          } catch (e) {
            // Stay on the review so nothing is lost: the user can free some space and press Save again.
            setSaveError(e instanceof PhotoStoreError ? e.message : PHOTO_SAVE_FAILED);
            setStep('review');
          }
        }} />}

      {step === 'done' && <div className="hc-card">
        <p role="status">Saved. Trees and buildings are now part of your horizon, and every list and time uses them.</p>
        <button type="button" className="hc-primary" onClick={close}>Close</button>
      </div>}

      {step === 'error' && <div className="hc-card">
        <p role="alert">{error}</p>
        <div className="hc-actions">
          <button type="button" onClick={() => { setError(''); setResult(null); setStep('intro'); }}>Try again</button>
          <button type="button" onClick={close}>Close</button>
        </div>
      </div>}
    </div>
  </div>;
}

/** Review: panorama strip with the sky tinted and the terrain line; brush, night trace and landmark alignment; Save. */
function Review({ lat, lon, terrain, result, saving, saveError, onSave }: {
  lat: number; lon: number; terrain: HorizonProfile | null; result: CaptureResult; saving: boolean;
  /** Why the last Save failed, in plain words ('' when it did not). */
  saveError: string;
  onSave: (grid: SkyGrid, panorama: RgbaImage, yaw: YawChoice, traced: boolean) => void;
}) {
  const [grid, setGrid] = useState(result.grid);
  // The automatic grid (before any trace), kept aligned with landmark shifts so "Clear the trace" can go back to it.
  const [baseGrid, setBaseGrid] = useState(result.grid);
  const [panorama, setPanorama] = useState(result.panorama);
  const [yaw, setYaw] = useState(result.yaw);
  const [tool, setTool] = useState<Tool>(result.needsTrace ? 'trace' : 'look');
  const [trace, setTrace] = useState<Array<{ az: number; alt: number }>>([]);
  const [snapped, setSnapped] = useState<Array<{ az: number; alt: number }>>([]);
  const [zoom, setZoom] = useState(false);
  const [landmarkAz, setLandmarkAz] = useState<number | null>(null);
  const [bearing, setBearing] = useState('');
  const [landmarkNote, setLandmarkNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<Array<{ az: number; alt: number }> | null>(null);
  // Every traced point so far (state lags a render behind pointer events).
  const traced = useRef<Array<{ az: number; alt: number }>>([]);

  const panoCanvas = useMemo(() => imageCanvas(panorama), [panorama]);
  const maskCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = grid.width; c.height = grid.height;
    c.getContext('2d')!.putImageData(new ImageData(maskTint(grid), grid.width, grid.height), 0, 0);
    return c;
  }, [grid]);

  // Draw the strip: photo, sky tint, terrain line (apparent), trace, landmark, compass letters.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, STRIP_W, STRIP_H);
    ctx.drawImage(panoCanvas, 0, 0, STRIP_W, STRIP_H);
    const r = gridRectInStrip(grid, STRIP_W, STRIP_H);
    if (!(result.needsTrace && !snapped.length)) ctx.drawImage(maskCanvas, r.x, r.y, r.w, r.h);
    if (terrain) {
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2; ctx.beginPath();
      const n = terrain.alt.length;
      for (let i = 0; i <= n; i++) {
        const p = azAltToStrip((i % n) * terrain.stepDeg, terrain.alt[i % n], STRIP_W, STRIP_H);
        const x = i === n ? STRIP_W : p.x;
        if (i === 0) ctx.moveTo(x, p.y); else ctx.lineTo(x, p.y);
      }
      ctx.stroke();
    }
    const line = orderTrace(snapped.length ? snapped : trace);
    if (line.length > 1) {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 3; ctx.beginPath();
      line.forEach((pt, i) => { const p = azAltToStrip(pt.az, pt.alt, STRIP_W, STRIP_H); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
    }
    if (landmarkAz !== null) {
      const x = azAltToStrip(landmarkAz, 0, STRIP_W, STRIP_H).x;
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, STRIP_H); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff'; ctx.font = '600 22px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const [az, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) ctx.fillText(l, Math.max(12, azAltToStrip(az, 0, STRIP_W, STRIP_H).x), STRIP_H - 10);
  }, [panoCanvas, maskCanvas, grid, terrain, trace, snapped, landmarkAz, result.needsTrace]);

  const pointAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return stripToAzAlt(((e.clientX - rect.left) / rect.width) * STRIP_W, ((e.clientY - rect.top) / rect.height) * STRIP_H, STRIP_W, STRIP_H);
  };

  /** Turn everything on the strip by deltaDeg (trueAz += deltaDeg) after a new alignment. */
  const shiftAll = (deltaDeg: number) => {
    setGrid(g => shiftGrid(g, deltaDeg));
    setBaseGrid(g => shiftGrid(g, deltaDeg));
    setPanorama(p => shiftPanorama(p, deltaDeg));
    const shift = (pts: Array<{ az: number; alt: number }>) => pts.map(pt => ({ az: pt.az + deltaDeg, alt: pt.alt }));
    traced.current = shift(traced.current); setTrace(traced.current); setSnapped(shift);
  };

  const finishTrace = (points: Array<{ az: number; alt: number }>) => {
    if (points.length < 2) return;
    const s = snapTraceToEdges(panorama, orderTrace(points));
    const g = gridFromTrace(s, traceCoverage(s));
    setSnapped(s);
    setGrid(g);
    // North from the compass only: the traced skyline may line up with the hills much better.
    const hills = traceTerrainFix(yaw, g, terrain);
    if (hills) {
      setYaw(hills.choice);
      shiftAll(hills.deltaDeg);
    }
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'look') return;
    const p = pointAt(e);
    if (tool === 'landmark') { setLandmarkAz(p.az); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = [p];
    if (tool === 'add' || tool === 'remove') setGrid(g => paintGrid(g, [p], BRUSH_DEG, tool === 'add'));
    if (tool === 'trace') { traced.current = [...traced.current, p]; setTrace(traced.current); }
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!stroke.current) return;
    const p = pointAt(e), prev = stroke.current[stroke.current.length - 1];
    stroke.current.push(p);
    if (tool === 'add' || tool === 'remove') setGrid(g => paintGrid(g, [prev, p], BRUSH_DEG, tool === 'add'));
    if (tool === 'trace') { traced.current = [...traced.current, p]; setTrace(traced.current); }
  };
  const onUp = () => {
    if (!stroke.current) return;
    stroke.current = null;
    if (tool === 'trace') finishTrace(traced.current);
  };

  const applyLandmark = () => {
    if (landmarkAz === null) return;
    const pos = parseLatLon(bearing);
    const b = pos ? bearingDeg(lat, lon, pos.lat, pos.lon) : Number(bearing);
    if (!bearing.trim() || !Number.isFinite(b)) { setLandmarkNote('Type a bearing in degrees (0 = north, 90 = east) or the landmark\'s latitude, longitude.'); return; }
    // The marked point's azimuth in the sensor frame, then the fix that puts it at the given bearing.
    const relAz = landmarkAz - yaw.chosen.offsetDeg;
    const { choice, deltaDeg } = chooseLandmark(yaw, landmarkFix(relAz, b));
    setYaw(choice);
    shiftAll(deltaDeg);
    setLandmarkAz(null); setBearing(''); setLandmarkNote('');
    setTool(result.needsTrace ? 'trace' : 'look');
  };

  const needsTrace = result.needsTrace && !snapped.length;
  // The "north comes from the compass" note no longer applies once the hills or a landmark lined it up.
  const compassNote = compassOnlyNote(result.yaw.chosen.sigmaDeg, result.light);
  const notes = yaw.chosen.source === 'compass' ? result.notes : result.notes.filter(n => n !== compassNote);
  const tools: Array<[Tool, string]> = result.needsTrace
    ? [['trace', 'Trace the skyline'], ['landmark', 'Line up a landmark']]
    : [['look', 'Look'], ['add', 'Add sky'], ['remove', 'Remove sky'], ['trace', 'Trace the skyline'], ['landmark', 'Line up a landmark']];

  return <div className="hc-review">
    <p className="hc-yaw" data-testid="horizon-yaw">{yawSentence(yaw)}</p>
    {yaw.disagreement && <p className="hc-note">{yaw.disagreement}</p>}
    {notes.map(n => <p key={n} className="hc-note">{n}</p>)}
    <p className="hc-note" role="status">{needsTrace
      ? 'Too dark to find the sky by itself. Trace the skyline with your finger along the strip; it snaps to the nearest edge.'
      : tool === 'landmark' ? 'Tap a landmark on the strip, then type its bearing.'
      : 'Blue is open sky; the orange line is the hills from the terrain map. Fix mistakes with Add sky or Remove sky.'}</p>
    <div className={`hc-strip${zoom ? ' hc-strip-zoom' : ''}`} data-testid={tool === 'trace' ? 'horizon-trace' : undefined}>
      <canvas ref={canvasRef} width={STRIP_W} height={STRIP_H} className={tool === 'look' ? '' : 'hc-drawing'}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        role="img" aria-label="Panorama of the site with the sky tinted blue and the terrain line" />
    </div>
    <div className="hc-tools" role="group" aria-label="Fix the sky">
      {tools.map(([t, label]) => <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>{label}</button>)}
      <button type="button" aria-pressed={zoom} onClick={() => setZoom(z => !z)}>Zoom</button>
      {tool === 'trace' && trace.length > 0 && <button type="button" onClick={() => { traced.current = []; setTrace([]); setSnapped([]); setGrid(baseGrid); }}>Clear the trace</button>}
    </div>
    {tool === 'landmark' && landmarkAz !== null && <div className="hc-landmark">
      <label>This point is at bearing <input type="text" inputMode="decimal" value={bearing} onChange={e => setBearing(e.target.value)} placeholder="e.g. 214 or 45.97, 7.65" aria-label="Landmark bearing in degrees, or its latitude and longitude" />°</label>
      <button type="button" onClick={applyLandmark}>Line up</button>
      {landmarkNote && <p className="hc-note" role="alert">{landmarkNote}</p>}
    </div>}
    <div className="hc-actions">
      <button type="button" className="hc-primary" disabled={saving || needsTrace} onClick={() => onSave(grid, panorama, yaw, result.needsTrace || snapped.length > 0)}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
    {saveError && <p className="hc-warning" role="alert">{saveError}</p>}
  </div>;
}
