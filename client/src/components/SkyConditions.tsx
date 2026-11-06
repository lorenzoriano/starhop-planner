import { useState } from 'react';
import {
  LITTLE_DIPPER_ANSWERS, MILKY_WAY_ANSWERS, SKY_PRESETS, TRANSPARENCY_OPTIONS, isPresetSqm, skyPresetFor, sqmFromQuiz,
  type LittleDipperAnswer, type MilkyWayAnswer, type TransparencyMode,
} from '@/lib/visibility/conditions';
import type { Transparency } from '@/lib/visibility/types';
import { LocalHorizonPanel } from './LocalHorizonPanel';

/** Compact "How dark is your sky?" select (setup drawer, Moon tab). Any stored value stays selectable. */
export function SkyDarknessSelect({ value, onChange, label = 'How dark is your sky?', className }: { value: number; onChange: (sqm: number) => void; label?: string; className?: string }) {
  const nearest = skyPresetFor(value);
  return <label className={className}>{label}<select aria-label="How dark is your sky" value={isPresetSqm(value) ? nearest.sqm : value} onChange={e => onChange(Number(e.target.value))}>
    {SKY_PRESETS.map(p => <option key={p.id} value={p.sqm}>{p.label}</option>)}
    {!isPresetSqm(value) && <option value={value}>≈ {nearest.label} (your setting, {value.toFixed(1)})</option>}
  </select><small className="sky-cue">{nearest.cue}</small></label>;
}

/**
 * Site dialog block: sky darkness presets with the Milky Way cue, a two-question helper, tonight's haze and the
 * site elevation, then the local horizon of `horizonSite`. `brightness` is the dialog's draft (saved per site on apply);
 * haze, elevation and the horizon switch apply at once.
 */
export function SkyConditionsEditor({ brightness, onBrightness, note, haze, forecastHaze, onHaze, elevation, horizonSite }: {
  brightness: number; onBrightness: (sqm: number) => void; note?: string;
  haze: TransparencyMode; forecastHaze: { label: string } | null; onHaze: (mode: TransparencyMode) => void;
  /** Omit when the dialog shows another site (its elevation comes from that site's forecast once applied). */
  elevation?: { metres: number; source: 'manual' | 'forecast' | 'unknown'; forecastMetres: number | null; onChange: (metres: number | null) => void };
  /** The app's current site, for its terrain horizon; omit (like `elevation`) when the dialog shows another site. */
  horizonSite?: { lat: number; lon: number };
}) {
  const [milkyWay, setMilkyWay] = useState<MilkyWayAnswer | null>(null), [dipper, setDipper] = useState<LittleDipperAnswer | null>(null);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
  const nearest = skyPresetFor(brightness), exact = isPresetSqm(brightness);
  const answer = (mw: MilkyWayAnswer | null, ld: LittleDipperAnswer | null) => {
    setMilkyWay(mw); setDipper(ld);
    const sqm = sqmFromQuiz({ milkyWay: mw, littleDipper: ld });
    if (sqm !== null) onBrightness(skyPresetFor(sqm).sqm);
  };
  const selectedHaze = haze === 'auto' ? null : TRANSPARENCY_OPTIONS[haze - 1];
  const saveElevation = () => {
    const v = Number(draft);
    if (draft.trim() && Number.isFinite(v) && v >= -500 && v <= 9000) { elevation?.onChange(Math.round(v)); setEditing(false); }
  };
  return <section className="sky-conditions" aria-label="Sky conditions">
    <h3>How dark is your sky?</h3>
    <div className="sky-preset-list" role="radiogroup" aria-label="How dark is your sky">
      {SKY_PRESETS.map(p => <button key={p.id} type="button" role="radio" aria-checked={nearest.id === p.id} onClick={() => onBrightness(p.sqm)}>
        <span>{p.label}{!exact && nearest.id === p.id ? ' (closest to your setting)' : ''}</span><small>{p.cue}</small>
      </button>)}
    </div>
    <details className="sky-quiz">
      <summary>Not sure? Answer 2 quick questions</summary>
      <p>On a clear, moonless night, can you see the Milky Way?</p>
      <div className="choice-chips">{MILKY_WAY_ANSWERS.map(a => <button key={a.value} type="button" aria-pressed={milkyWay === a.value} onClick={() => answer(milkyWay === a.value ? null : a.value, dipper)}>{a.label}</button>)}</div>
      <p>How many stars of the Little Dipper can you see?</p>
      <div className="choice-chips">{LITTLE_DIPPER_ANSWERS.map(a => <button key={String(a.value)} type="button" aria-pressed={dipper === a.value} onClick={() => answer(milkyWay, dipper === a.value ? null : a.value)}>{a.label}</button>)}</div>
      {(milkyWay || dipper) && <p role="status">Sounds like: <strong>{nearest.label}</strong> (selected above).</p>}
    </details>
    <p className="sky-note">{note ? `${note} ` : ''}Sky darkness {brightness.toFixed(1)} mag/arcsec² · Bortle {nearest.bortle}</p>
    <h3>Haze tonight</h3>
    <div className="choice-chips" role="group" aria-label="Haze tonight">
      <button type="button" aria-pressed={haze === 'auto'} onClick={() => onHaze('auto')}>Auto{forecastHaze ? ` (forecast: ${forecastHaze.label})` : ''}</button>
      {TRANSPARENCY_OPTIONS.map(o => <button key={o.value} type="button" aria-pressed={haze === o.value} onClick={() => onHaze(o.value as Transparency)}>{o.label}</button>)}
    </div>
    <p className="sky-note">{selectedHaze ? selectedHaze.hint : forecastHaze ? 'From the weather and air-quality forecast for the time you are planning.' : 'Without a haze forecast for this site and time, an average night is assumed.'}</p>
    {elevation && <div className="sky-elevation">
      {editing
        ? <>
            <label>Elevation (m) <input aria-label="Site elevation in metres" type="number" inputMode="numeric" min={-500} max={9000} step={1} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveElevation(); } }} autoFocus /></label>
            <button type="button" onClick={saveElevation}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </>
        : <><span>Elevation: {elevation.source === 'unknown' ? 'unknown (sea level assumed)' : `${Math.round(elevation.metres).toLocaleString()} m (${elevation.source === 'manual' ? 'your value' : 'from forecast'})`}</span>
            <button type="button" onClick={() => { setDraft(String(Math.round(elevation.metres))); setEditing(true); }}>Edit</button>
            {elevation.source === 'manual' && <button type="button" onClick={() => elevation.onChange(null)}>{elevation.forecastMetres != null ? `Use forecast (${Math.round(elevation.forecastMetres).toLocaleString()} m)` : 'Use forecast'}</button>}</>}
    </div>}
    {horizonSite && <LocalHorizonPanel lat={horizonSite.lat} lon={horizonSite.lon} elevation={elevation} />}
  </section>;
}
