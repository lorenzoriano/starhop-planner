/** Discovery card (doc 06 §4.1) and its 96 px dome thumbnail. */
import { CircleDot, Clock3, Compass, Play } from "lucide-react";
import type { UnifiedTarget } from "@/lib/astronomy";
import type { Journey, KnowledgeBase } from "@/lib/journeys/types";
import { objectName } from "@/lib/object-links";
import { arcChips, DIFFICULTY_HELP, DIFFICULTY_LABELS, durationLabel, journeyStatus, localTime, regionWords, themeLabel, type ObjectIndex } from "./journey-view";

/** Overhead dome: horizon circle, min-altitude ring, region circle, path and numbered stops. East is left, as on the overview chart. */
export function JourneyDomeThumb({ journey, minAlt, size = 96 }: { journey: Pick<Journey, "stops" | "regionCenter">; minAlt: number; size?: number }) {
  const R = size / 2 - 6, c = size / 2;
  const pos = (alt: number, az: number) => { const r = ((90 - alt) / 90) * R, a = (az * Math.PI) / 180; return { x: c - r * Math.sin(a), y: c - r * Math.cos(a) }; };
  const pts = journey.stops.map((s) => pos(s.altAtStart, s.azAtStart));
  const center = pos(journey.regionCenter.altDeg, journey.regionCenter.azDeg);
  const spread = Math.max(8, ...pts.map((p) => Math.hypot(p.x - center.x, p.y - center.y) + 6));
  return <svg className="journey-dome" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Sky map: ${journey.stops.length} stops ${journey.regionCenter.label.toLowerCase()}`}>
    <circle cx={c} cy={c} r={R} className="dome-horizon"/>
    <circle cx={c} cy={c} r={((90 - minAlt) / 90) * R} className="dome-minalt"/>
    <circle cx={center.x} cy={center.y} r={spread} className="dome-region"/>
    <polyline points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} className="dome-path"/>
    {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r={i === 0 ? 4.6 : 3.6} className={i === 0 ? "dome-stop first" : "dome-stop"}/>{i === 0 && <text x={p.x} y={p.y + 2.6} textAnchor="middle" className="dome-number">1</text>}</g>)}
    <text x={c} y={9} textAnchor="middle" className="dome-compass">N</text>
    <text x={7} y={c + 3} textAnchor="middle" className="dome-compass">E</text>
  </svg>;
}

export function JourneyCard({ journey, objects, now, timezone, minAlt, onStart, onPreview, resumeStop, kb, targets }: {
  journey: Journey; objects: ObjectIndex; now: Date; timezone: string; minAlt: number;
  onStart: () => void; onPreview: () => void; resumeStop?: number;
  /** For the storyline beat labels of the arc teaser (the same words as the overview spine). */
  kb?: Pick<KnowledgeBase, "lenses"> | null;
  /** The app's catalog targets, so stop names are the app's one display name (lib/object-links). */
  targets?: readonly UnifiedTarget[];
}) {
  const status = journeyStatus(journey, now, timezone);
  const chips = arcChips(journey, kb);
  const names = journey.stops.map((s) => { const o = objects.get(s.objectId); return o ? objectName(o, targets).label : s.objectId; });
  return <article className="journey-card" data-testid={`journey-card-${journey.key}`} aria-labelledby={`jt-${journey.key}`}>
    <div className="journey-card-top">
      <JourneyDomeThumb journey={journey} minAlt={minAlt}/>
      <div className="journey-card-heading">
        <p className="journey-card-theme" data-testid="journey-card-theme">{themeLabel(journey.templateId)}</p>
        <h3 id={`jt-${journey.key}`}>{journey.title}</h3>
        <p className={`journey-status status-${status.kind}`}><CircleDot size={12} aria-hidden="true"/>{status.text}</p>
        <p className="journey-hook">{journey.hook}</p>
      </div>
    </div>
    <ol className="journey-arc" aria-label={`Story arc: ${chips.filter((c) => !/^\+\d+$/.test(c)).join(", then ")}. Stops: ${names.join(", ")}`}>
      {chips.map((chip, i) => /^\+\d+$/.test(chip) ? <li key={`${chip}-${i}`} className="journey-arc-more">{chip} more</li> : <li key={`${chip}-${i}`}>{chip}</li>)}
    </ol>
    <p className="journey-meta"><span><strong>{journey.stops.length}</strong> stops</span><span><Clock3 size={12} aria-hidden="true"/>{durationLabel(journey.durationMin)}</span><span><Compass size={12} aria-hidden="true"/>{regionWords(journey)}</span></p>
    {/* The difficulty is a chip; its explanation is a tooltip here and spelled out on the overview. */}
    <p className="journey-meta"><span className={`journey-difficulty difficulty-${journey.difficulty}`} title={journey.difficultyReason ?? DIFFICULTY_HELP[journey.difficulty]}>{DIFFICULTY_LABELS[journey.difficulty]}</span>{journey.bestWindow && <span>Best {localTime(journey.bestWindow.start, timezone)}–{localTime(journey.bestWindow.end, timezone)}</span>}</p>
    <div className="journey-card-actions">
      <button type="button" className="journey-button primary" onClick={onStart} data-testid="journey-start"><Play size={15} aria-hidden="true"/>{resumeStop ? `Resume at stop ${resumeStop}` : "Start"}</button>
      <button type="button" className="journey-button" onClick={onPreview} data-testid="journey-preview">Preview ›</button>
    </div>
  </article>;
}
