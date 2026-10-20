import { useEffect, useState } from "react";
import {
  cloneOpticalProfile,
  loadOpticalProfileSelection,
  loadUserOpticalProfiles,
  OPTICAL_PROFILE_PRESETS,
  saveOpticalProfileSelection,
  saveUserOpticalProfiles,
  type OpticalProfile,
  type OpticalProfileSelection,
  type OpticalStage,
} from "@/lib/optical-profiles";

const MIN_OPTICAL_FOV = 0.2;
const MAX_OPTICAL_FOV = 15;
function canApplyOpticalProfile(profile: OpticalProfile) {
  return profile.fov >= MIN_OPTICAL_FOV && profile.fov <= MAX_OPTICAL_FOV;
}

interface OpticalProfilesProps {
  /** Called with the selected stage's settings; the parent applies them to the chart. */
  onApply: (profile: Pick<OpticalProfile, "fov" | "mirrored" | "rotation" | "reticle">) => void;
  onStageChange?: (stage: OpticalStage) => void;
}

export function OpticalProfiles({ onApply, onStageChange }: OpticalProfilesProps) {
  const [selection, setSelection] = useState<OpticalProfileSelection>(() => loadOpticalProfileSelection());
  const { stage, profiles } = selection;
  const [users, setUsers] = useState<OpticalProfile[]>(() => loadUserOpticalProfiles());
  const [saveName, setSaveName] = useState("");
  const current = profiles[stage];
  const available = [...OPTICAL_PROFILE_PRESETS, ...users];

  useEffect(() => saveUserOpticalProfiles(users), [users]);
  useEffect(() => saveOpticalProfileSelection(selection), [selection]);


  const updateCurrent = (changes: Partial<OpticalProfile>) => {
    setSelection(previous => ({ ...previous, profiles: { ...previous.profiles, [stage]: cloneOpticalProfile(previous.profiles[stage], changes) } }));
  };
  const chooseProfile = (id: string) => {
    const selected = available.find(profile => profile.id === id);
    if (selected) setSelection(previous => ({ ...previous, profiles: { ...previous.profiles, [stage]: cloneOpticalProfile(selected) } }));
  };
  const changeStage = (next: OpticalStage) => {
    setSelection(previous => ({ ...previous, stage: next }));
    onStageChange?.(next);
    const profile = profiles[next];
    if (canApplyOpticalProfile(profile)) onApply({ fov: profile.fov, mirrored: profile.mirrored, rotation: profile.rotation, reticle: profile.reticle });
  };
  const save = () => {
    const name = saveName.trim();
    if (!name) return;
    const profile: OpticalProfile = { ...current, id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, builtIn: false };
    setUsers(previous => [...previous, profile]);
    setSaveName("");
  };
  const remove = () => {
    if (current.builtIn) return;
    setUsers(previous => previous.filter(profile => profile.id !== current.id));
    setSelection(previous => ({ ...previous, profiles: { ...previous.profiles, [stage]: { ...OPTICAL_PROFILE_PRESETS.find(profile => profile.id === (stage === "finder" ? "RACI" : "Newtonian"))! } } }));
  };

  return <section className="rounded-lg border border-border/70 bg-card/40 p-3" aria-label="Optical profiles">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">Finder and eyepiece</h3>
        <p className="text-xs text-muted-foreground">Use the finder for the hop, then switch to the eyepiece at the target.</p>
      </div>
      <div className="flex gap-1" role="group" aria-label="Optical stage">
        <button type="button" className="rounded border px-2 py-1 text-xs" aria-pressed={stage === "finder"} onClick={() => changeStage("finder")}>Finder hop</button>
        <button type="button" className="rounded border px-2 py-1 text-xs" aria-pressed={stage === "eyepiece"} onClick={() => changeStage("eyepiece")}>Eyepiece</button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs">Named setup
        <select aria-label={`${stage} optical preset`} className="rounded border bg-background px-2 py-1.5 text-sm" value={current.id} onChange={event => chooseProfile(event.target.value)}>
          {available.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Field width (degrees)
        <input aria-label={`${stage} field width in degrees`} className="rounded border bg-background px-2 py-1.5 text-sm" type="number" min={MIN_OPTICAL_FOV} max={MAX_OPTICAL_FOV} step="0.1" value={current.fov} onChange={event => {
          const fov = Number(event.target.value);
          if (Number.isFinite(fov) && fov >= 0.05 && fov <= 180) updateCurrent({ fov, fovSource: "measured" });
        }} />
      </label>
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground">{!canApplyOpticalProfile(current) ? "This field is outside the optical chart range (0.2°–15°). Use the planetarium for naked-eye viewing, or enter a supported field width." : current.fovSource === "measured" ? "Your field width" : "Preset field width is an estimate; enter the measured value for your finder or eyepiece."}</p>

    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={current.mirrored} onChange={event => updateCurrent({ mirrored: event.target.checked })} /> Mirror East / West</label>
      <label className="flex items-center gap-1.5">Rotation
        <select className="rounded border bg-background px-1.5 py-1" value={current.rotation} onChange={event => updateCurrent({ rotation: Number(event.target.value) as OpticalProfile["rotation"] })}>
          {[0, 90, 180, 270].map(degrees => <option key={degrees} value={degrees}>{degrees}°</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5">Reticle
        <select className="rounded border bg-background px-1.5 py-1" value={current.reticle} onChange={event => updateCurrent({ reticle: event.target.value as OpticalProfile["reticle"] })}>
          <option value="field">Field</option><option value="crosshair">Crosshair</option><option value="telrad">Telrad</option><option value="rigel">Rigel</option>
        </select>
      </label>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!canApplyOpticalProfile(current)} onClick={() => onApply({ fov: current.fov, mirrored: current.mirrored, rotation: current.rotation, reticle: current.reticle })}>Apply to {stage === "finder" ? "finder hop" : "eyepiece"}</button>
      <input aria-label="Name saved optical profile" className="min-w-32 flex-1 rounded border bg-background px-2 py-1.5 text-xs" placeholder="Save current setup as…" value={saveName} onChange={event => setSaveName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") save(); }} />
      <button type="button" className="rounded border px-2 py-1.5 text-xs disabled:opacity-50" disabled={!saveName.trim()} onClick={save}>Save</button>
      {!current.builtIn && <button type="button" className="rounded border px-2 py-1.5 text-xs" onClick={remove}>Delete</button>}
    </div>
  </section>;
}
