import { useLocalHorizon, useLocalHorizonPreference } from '@/hooks/use-local-horizon';
import { horizonSummary } from '@/lib/horizon/profile';
import { ATTRIBUTION, ATTRIBUTION_LINKS } from '@/lib/horizon/terrain';
import type { HorizonProfile, TerrainStatus } from '@/lib/horizon/types';
import './LocalHorizonPanel.css';

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

/** Presentational panel (tests render it directly). */
export function LocalHorizonView({ enabled, onEnabled, status, profile, onRecompute, elevation }: {
  enabled: boolean; onEnabled: (enabled: boolean) => void; status: TerrainStatus; profile: HorizonProfile | null;
  onRecompute: () => void; elevation?: HorizonElevation;
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
    {enabled && <p className="local-horizon-credits">{ATTRIBUTION}{ATTRIBUTION_LINKS.map(link => <span key={link.url}> · <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></span>)}</p>}
  </div>;
}

/** Site dialog block: the automatic terrain horizon for the app's current site, with the global on/off switch. */
export function LocalHorizonPanel({ lat, lon, elevation }: { lat: number; lon: number; elevation?: HorizonElevation }) {
  const [enabled, setEnabled] = useLocalHorizonPreference();
  const { horizon, status, recompute } = useLocalHorizon(lat, lon);
  return <LocalHorizonView enabled={enabled} onEnabled={setEnabled} status={status} profile={horizon?.terrain ?? null} onRecompute={recompute} elevation={elevation} />;
}
