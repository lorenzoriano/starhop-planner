import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocalHorizon, useLocalHorizonPreference } from '@/hooks/use-local-horizon';
import { captureSupported } from '@/lib/horizon/capture/support';
import { IMPORT_SOURCE } from '@/lib/horizon/photo-types';
import { horizonSummary, photoLayerSummary } from '@/lib/horizon/profile';
import { recaptureAdvice } from '@/lib/horizon/season';
import { ATTRIBUTION, ATTRIBUTION_LINKS } from '@/lib/horizon/terrain';
import type { HorizonProfile, LocalHorizon, TerrainStatus } from '@/lib/horizon/types';
import './LocalHorizonPanel.css';

// Full-screen tools, loaded only when opened.
const HorizonCapture = lazy(() => import('./horizon/HorizonCapture'));
const HorizonViewer = lazy(() => import('./horizon/HorizonViewer'));

/** The site dialog's elevation setting (SkyConditionsEditor), for offering the terrain map's ground height. */
export type HorizonElevation = { metres: number; source: 'manual' | 'forecast' | 'unknown'; onChange: (metres: number | null) => void };

/** A forecast height this close to the terrain map's is not worth a button. */
const GROUND_OFFER_MIN_DIFF_M = 20;

/**
 * Ground height (m) to offer from the terrain map, or null: only when the user has not typed an elevation and the
 * terrain map knows the ground, and it differs from what is used now (or nothing is known).
 */
export function groundHeightOffer(profile: HorizonProfile | null | undefined, elevation: Pick<HorizonElevation, 'metres' | 'source'> | undefined): number | null {
  const ground = profile?.groundM;
  if (!elevation || elevation.source === 'manual' || typeof ground !== 'number' || !Number.isFinite(ground)) return null;
  const metres = Math.round(ground);
  if (metres < -500 || metres > 9000) return null;
  return elevation.source === 'unknown' || Math.abs(metres - elevation.metres) >= GROUND_OFFER_MIN_DIFF_M ? metres : null;
}

// Profile chart geometry (viewBox units): 1 unit per degree of azimuth.
const PAD_X = 8, TOP = 8, PLOT_H = 56, AXIS_Y = TOP + PLOT_H, VIEW_W = 360 + 2 * PAD_X, VIEW_H = AXIS_Y + 16;
const TICKS = [{ az: 0, label: 'N' }, { az: 90, label: 'E' }, { az: 180, label: 'S' }, { az: 270, label: 'W' }, { az: 360, label: 'N' }];

/** Vertical range of the chart: at least 0–10°, in whole 5° steps; negative skylines (a summit) extend below 0°. */
export function profileChartRange(alt: readonly number[]): { lo: number; hi: number } {
  const finite = alt.filter(Number.isFinite);
  const max = finite.length ? Math.max(...finite) : 0, min = finite.length ? Math.min(...finite) : 0;
  return { lo: Math.min(0, Math.floor(min)), hi: Math.max(10, Math.ceil(max / 5) * 5) };
}

/** Small skyline silhouette: azimuth 0–360° across (N, E, S, W, N), skyline altitude up, ground filled. */
export function HorizonProfileChart({ profile, label }: { profile: HorizonProfile; label: string }) {
  const n = profile.alt.length, step = 360 / n;
  const { lo, hi } = profileChartRange(profile.alt);
  const y = (a: number) => TOP + ((hi - (Number.isFinite(a) ? a : lo)) / (hi - lo)) * PLOT_H;
  const x = (az: number) => PAD_X + az;
  const base = y(lo);
  const points = profile.alt.map((a, i) => `${x(i * step).toFixed(1)},${y(a).toFixed(1)}`);
  points.push(`${x(360).toFixed(1)},${y(profile.alt[0]).toFixed(1)}`);
  const ground = `M${x(0)},${base.toFixed(1)}L${points.join('L')}L${x(360)},${base.toFixed(1)}Z`;
  return <svg className="local-horizon-chart" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label}>
    <line className="local-horizon-grid" x1={x(0)} x2={x(360)} y1={TOP} y2={TOP} />
    {lo < 0 && <line className="local-horizon-grid" x1={x(0)} x2={x(360)} y1={y(0)} y2={y(0)} />}
    {TICKS.map(t => <line key={t.az} className="local-horizon-grid" x1={x(t.az)} x2={x(t.az)} y1={TOP} y2={AXIS_Y} />)}
    <path className="local-horizon-ground" d={ground} />
    <line className="local-horizon-axis" x1={x(0)} x2={x(360)} y1={AXIS_Y} y2={AXIS_Y} />
    <text className="local-horizon-scale" x={x(0) + 3} y={TOP + 9}>{hi}°</text>
    {lo < 0 && <text className="local-horizon-scale" x={x(0) + 3} y={y(0) - 2}>0°</text>}
    {TICKS.map((t, i) => <text key={t.az} className="local-horizon-tick" x={x(t.az)} y={VIEW_H - 3} textAnchor={i === 0 ? 'start' : i === TICKS.length - 1 ? 'end' : 'middle'}>{t.label}</text>)}
  </svg>;
}

/** Plain status sentence for the horizon panel. */
export function horizonStatusText(enabled: boolean, status: TerrainStatus, profile: HorizonProfile | null): string {
  if (!enabled) return 'Off: the app assumes a flat horizon everywhere.';
  switch (status.state) {
    case 'computing': return `Measuring the hills and mountains around this site… ${Math.round(status.progress * 100)}%`;
    case 'error': return profile ? 'Could not refresh the terrain map; the saved horizon is still used.' : 'Could not load the terrain map, so a flat horizon is used for now.';
    case 'offline': return 'Offline: a flat horizon is used until the terrain map can be loaded.';
    case 'ready': return horizonSummary(status.profile);
    default: return profile ? horizonSummary(profile) : 'Checking the terrain around this site…';
  }
}

export type HorizonDownload = 'stellarium' | 'nina' | 'text';

/** The photo horizon part of the panel: what it shows and what its buttons do. */
export interface PhotoHorizonSection {
  /** The site's photo layer (a camera sweep or an imported file), or null. */
  profile: HorizonProfile | null;
  /** Seasonal recapture advice for the capture in use, or null. */
  advice: string | null;
  /** The browser can use the camera and motion sensors (otherwise only import is offered). */
  cameraSupported: boolean;
  /** Something to download exists (terrain or photo). */
  canDownload: boolean;
  /** Result of the last import or removal, in plain words. */
  message?: string | null;
  onCapture: () => void;
  onLookAround: () => void;
  onRemove: () => void;
  onDownload: (kind: HorizonDownload) => void;
  onImport: (file: File) => void;
}

/** Trees and buildings: summary, capture / look around / remove, and a small disclosure for downloads and import. */
function PhotoSection({ photo }: { photo: PhotoHorizonSection }) {
  const { profile } = photo;
  return <div className="local-horizon-photo">
    <h4>Trees and buildings</h4>
    <p className="sky-note">{profile ? photoLayerSummary(profile) : 'Not added yet. A short camera sweep adds the trees and roofs around you.'}</p>
    {profile && photo.advice && <p className="sky-note local-horizon-advice">{photo.advice}</p>}
    {!profile && !photo.cameraSupported && <p className="sky-note">This browser cannot use the camera and motion sensors, so trees and buildings cannot be captured here.</p>}
    <div className="local-horizon-actions">
      {photo.cameraSupported && <button type="button" onClick={photo.onCapture}>{profile ? 'Capture again' : 'Add trees and buildings'}</button>}
      <button type="button" onClick={photo.onLookAround}>Look around</button>
      {profile && <button type="button" onClick={photo.onRemove}>Remove photo horizon</button>}
    </div>
    <details className="local-horizon-files">
      <summary>Download or import a horizon file</summary>
      <div className="local-horizon-actions">
        {photo.canDownload && <>
          <button type="button" onClick={() => photo.onDownload('stellarium')}>Download for Stellarium</button>
          <button type="button" onClick={() => photo.onDownload('nina')}>Download for NINA</button>
          <button type="button" onClick={() => photo.onDownload('text')}>Download as text</button>
        </>}
        <label className="local-horizon-import">Import a horizon file
          <input type="file" accept=".txt,.hrz,.csv,.hzn,text/plain" onChange={e => { const f = e.target.files?.[0]; if (f) photo.onImport(f); e.target.value = ''; }} />
        </label>
      </div>
    </details>
    {photo.message && <p className="sky-note" role="status">{photo.message}</p>}
  </div>;
}

/** Presentational panel (tests render it directly). */
export function LocalHorizonView({ enabled, onEnabled, status, profile, onRecompute, elevation, photo }: {
  enabled: boolean; onEnabled: (enabled: boolean) => void; status: TerrainStatus; profile: HorizonProfile | null;
  onRecompute: () => void; elevation?: HorizonElevation;
  /** The photo horizon section; omitted, the panel shows the terrain horizon only. */
  photo?: PhotoHorizonSection;
}) {
  const shown = enabled ? profile : null;
  const computing = enabled && status.state === 'computing';
  const ground = groundHeightOffer(shown, elevation);
  const summary = shown ? horizonSummary(shown) : '';
  return <div className="local-horizon" aria-label="Local horizon">
    <div className="local-horizon-head">
      <h3>Your horizon</h3>
      <label className="local-horizon-toggle"><input type="checkbox" role="switch" checked={enabled} onChange={e => onEnabled(e.target.checked)} />Use my local horizon</label>
    </div>
    <p className="sky-note" role="status" title={enabled && status.state === 'error' ? status.message : undefined}>{horizonStatusText(enabled, status, shown)}</p>
    {computing && <progress className="local-horizon-progress" max={1} value={status.progress} aria-label="Terrain horizon progress" />}
    {shown && <>
      {status.state !== 'ready' && status.state !== 'idle' && <p className="sky-note">{summary}</p>}
      <HorizonProfileChart profile={shown} label={`Skyline around this site. ${summary}`} />
    </>}
    {enabled && <div className="local-horizon-actions">
      {status.state === 'error' && <button type="button" onClick={onRecompute}>Retry</button>}
      {shown && status.state === 'ready' && <button type="button" onClick={onRecompute}>Recompute</button>}
      {ground !== null && elevation && <button type="button" onClick={() => elevation.onChange(ground)}>Use ground height from the terrain map ({ground.toLocaleString()} m)</button>}
    </div>}
    {enabled && photo && <PhotoSection photo={photo} />}
    {enabled && <p className="local-horizon-credits">{ATTRIBUTION}{ATTRIBUTION_LINKS.map(link => <span key={link.url}> · <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></span>)}</p>}
  </div>;
}

/** Save text or bytes as a file. */
function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Full-screen layer for the capture and the viewer. A nested Radix dialog, so it sits above the site dialog, keeps
 * focus, and is not clipped by the site dialog's transform.
 */
function HorizonOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content className="local-horizon-overlay" aria-describedby={undefined}>
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <Suspense fallback={<p className="local-horizon-overlay-loading" role="status">Loading…</p>}>{children}</Suspense>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

/** Site dialog block: the site's horizon (terrain, and trees and buildings from the camera), with the global switch. */
export function LocalHorizonPanel({ lat, lon, elevation }: { lat: number; lon: number; elevation?: HorizonElevation }) {
  const [enabled, setEnabled] = useLocalHorizonPreference();
  const { horizon, status, recompute } = useLocalHorizon(lat, lon);
  const [overlay, setOverlay] = useState<'capture' | 'viewer' | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cameraSupported] = useState(captureSupported);
  const photo = horizon?.photo ?? null;
  const latest = useRef({ lat, lon });
  latest.current = { lat, lon };

  // Recapture advice for the capture in use (useLocalHorizon has already switched to this season's capture). Only a
  // camera sweep has a stored capture to read.
  useEffect(() => {
    if (!enabled || !photo || photo.source === IMPORT_SOURCE) { setAdvice(null); return; }
    let live = true;
    void import('@/lib/horizon/photo-store').then(async store => {
      const site = await store.readPhotoSite(lat, lon);
      if (live) setAdvice(site ? recaptureAdvice(site.record, new Date()) : null);
    }).catch(() => { if (live) setAdvice(null); });
    return () => { live = false; };
  }, [lat, lon, enabled, photo]);

  const both: LocalHorizon = { terrain: horizon?.terrain ?? null, photo };
  const section: PhotoHorizonSection = {
    profile: photo,
    advice,
    cameraSupported,
    canDownload: !!(both.terrain || both.photo),
    message,
    onCapture: () => { setMessage(null); setOverlay('capture'); },
    onLookAround: () => setOverlay('viewer'),
    onRemove: () => {
      if (!window.confirm('Remove the trees and buildings for this site? The terrain horizon stays.')) return;
      void import('@/lib/horizon/photo-store')
        .then(store => store.deletePhotoHorizon(lat, lon))
        .then(() => setMessage('Photo horizon removed.'), (e: unknown) => setMessage(e instanceof Error && e.name === 'PhotoStoreError' ? e.message : 'Could not remove the photo horizon.'));
    },
    onDownload: kind => {
      void import('@/lib/horizon/export').then(ex => {
        if (kind === 'nina') download('starhop-horizon.hrz', ex.toNinaHrz(both), 'text/plain');
        else if (kind === 'text') download('starhop-horizon.txt', ex.toAzAltText(both), 'text/plain');
        else download('starhop-horizon-stellarium.zip', ex.toStellariumZip(both, 'StarHop horizon'), 'application/zip');
      }, () => setMessage('Could not prepare the file.'));
    },
    onImport: file => {
      void Promise.all([file.text(), import('@/lib/horizon/export'), import('@/lib/horizon/photo-store')]).then(([text, ex, store]) => {
        const parsed = ex.parseAzAltText(text, latest.current);
        if ('error' in parsed) { setMessage(parsed.error); return; }
        setMessage(store.importPhotoProfile(parsed.profile) ? 'Imported. The file now counts as the trees and buildings for this site.' : 'Could not save the imported horizon on this device — storage is full or blocked.');
      }, () => setMessage('Could not read that file.'));
    },
  };

  return <>
    <LocalHorizonView enabled={enabled} onEnabled={setEnabled} status={status} profile={horizon?.terrain ?? null} onRecompute={recompute} elevation={elevation} photo={section} />
    {overlay === 'capture' && <HorizonOverlay title="Add trees and buildings" onClose={() => setOverlay(null)}>
      <HorizonCapture lat={lat} lon={lon} terrain={horizon?.terrain ?? null} onClose={() => setOverlay(null)} />
    </HorizonOverlay>}
    {overlay === 'viewer' && <HorizonOverlay title="Look around" onClose={() => setOverlay(null)}>
      <HorizonViewer lat={lat} lon={lon} onClose={() => setOverlay(null)} />
    </HorizonOverlay>}
  </>;
}
