import { distanceLadderModel, fmtLarge, roundSig } from '@/lib/journeys/visual-data';
import type { KbObject } from '@/lib/journeys/types';

const W = 340, X0 = 14, X1 = W - 14;

/**
 * Distance ladder (doc 06 §7.2 item 4): the journey's stops as numbered dots on a log light-year axis with
 * landmarks (Sirius, Galactic centre, Andromeda) and a "light left when…" list underneath.
 */
export function DistanceLadder({ stops, refYear, currentStopNumber }: { stops: { obj: KbObject; stopNumber: number }[]; refYear: number; currentStopNumber?: number }) {
  const m = distanceLadderModel(stops, refYear, currentStopNumber);
  const rows = Math.max(1, ...m.stops.map((s) => s.row + 1));
  const axisY = 18 + rows * 18;
  const H = axisY + 58;
  const X = (pos: number) => X0 + pos * (X1 - X0);
  return (
    <figure className="jv-figure jv-ladder" data-testid="journey-visual-distance-ladder">
      <svg viewBox={`0 0 ${W} ${H}`} className="jv-svg" role="img" aria-label={`Distance ladder, logarithmic, 1 to 10 million light-years. ${m.stops.map((s) => `Stop ${s.stopNumber}, ${s.name}: about ${fmtLarge(roundSig(s.ly))} light-years.`).join(' ')} Landmarks: ${m.landmarks.map((l) => l.label).join(', ')}.`}>
        <line x1={X0} x2={X1} y1={axisY} y2={axisY} className="jv-axis" />
        {m.ticks.map((t) => (
          <g key={t.ly}>
            <line x1={X(t.pos)} x2={X(t.pos)} y1={axisY - 3} y2={axisY + 3} className="jv-axis" />
            <text x={X(t.pos)} y={axisY + 14} textAnchor="middle" className="jv-tick">{t.label}</text>
          </g>
        ))}
        {m.landmarks.map((l, k) => (
          <g key={l.id} className="jv-landmark">
            <path d={`M${X(l.pos)},${axisY + 18} l4,5 l-4,5 l-4,-5 Z`} />
            {/* Alternate label rows so neighbouring landmarks never collide. */}
            <text x={X(l.pos)} y={axisY + 38 + (k % 2) * 12} textAnchor={l.pos > 0.85 ? 'end' : l.pos < 0.15 ? 'start' : 'middle'} className="jv-tick">{l.label}</text>
          </g>
        ))}
        {m.stops.map((s) => {
          const y = axisY - 12 - s.row * 18;
          return (
            <g key={`${s.id}-${s.stopNumber}`} className={s.current ? 'jv-stop jv-stop-current' : 'jv-stop'} data-ladder-stop={s.stopNumber}>
              <line x1={X(s.pos)} x2={X(s.pos)} y1={y + 7} y2={axisY} className="jv-leader" />
              {s.current && <circle cx={X(s.pos)} cy={y} r={10} className="jv-stop-halo" />}
              <circle cx={X(s.pos)} cy={y} r={7} />
              <text x={X(s.pos)} y={y + 3.5} textAnchor="middle" className="jv-num">{s.stopNumber}</text>
            </g>
          );
        })}
        <text x={X1} y={10} textAnchor="end" className="jv-tick">light-years (each step ×10)</text>
      </svg>
      <ol className="jv-ladder-list">
        {[...m.stops].sort((a, b) => a.stopNumber - b.stopNumber).map((s) => (
          <li key={`${s.id}-${s.stopNumber}`} aria-current={s.current ? 'step' : undefined}>
            <span className="jv-ladder-n">{s.stopNumber}</span> {s.name} · ≈ {fmtLarge(roundSig(s.ly))} ly · {s.lightLeft}
          </li>
        ))}
      </ol>
    </figure>
  );
}
