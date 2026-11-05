import { ageBarModel } from '@/lib/journeys/visual-data';
import type { KbObject } from '@/lib/journeys/types';

const W = 340, X0 = 14, X1 = W - 14;

/**
 * Cluster/nebula age on a log axis from 100,000 years to the age of the Universe, with the journey's other dated
 * stops as numbered dots, published age ranges as bars, and landmarks (dinosaurs, Sun, Universe).
 */
export function ClusterAgeBar({ stops, currentStopNumber, name }: { stops: { obj: KbObject; stopNumber: number }[]; currentStopNumber: number; name: string }) {
  const m = ageBarModel(stops, currentStopNumber);
  const axisY = 34, H = 98;
  const X = (pos: number) => X0 + pos * (X1 - X0);
  const current = m.markers.find((x) => x.current);
  return (
    <figure className="jv-figure jv-age" data-testid="journey-visual-age-bar">
      <svg viewBox={`0 0 ${W} ${H}`} className="jv-svg" role="img" aria-label={`Age scale, logarithmic, from 100,000 years to 13.8 billion years. ${m.markers.map((x) => `Stop ${x.stopNumber}, ${x.name}: about ${x.label}.`).join(' ')}`}>
        <line x1={X0} x2={X1} y1={axisY} y2={axisY} className="jv-axis" />
        {m.ticks.map((t, k) => (
          <g key={t.label}><line x1={X(t.pos)} x2={X(t.pos)} y1={axisY - 3} y2={axisY + 3} className="jv-axis" /><text x={X(t.pos)} y={axisY + 14} textAnchor={k === 0 ? 'start' : 'middle'} className="jv-tick">{t.label}</text></g>
        ))}
        {m.landmarks.map((l, k) => (
          <g key={l.id} className="jv-landmark">
            <path d={`M${X(l.pos)},${axisY + 20} l4,5 l-4,5 l-4,-5 Z`} />
            {/* Alternate label rows so close landmarks (Sun, Universe) never collide. */}
            <text x={X(l.pos)} y={axisY + 42 + (k % 2) * 12} textAnchor={l.pos > 0.9 ? 'end' : 'middle'} className="jv-tick">{l.label}</text>
          </g>
        ))}
        {m.markers.map((x) => (
          <g key={`${x.id}-${x.stopNumber}`} className={x.current ? 'jv-stop jv-stop-current' : 'jv-stop'} data-age-stop={x.stopNumber}>
            {x.minPos !== undefined && x.maxPos !== undefined && <rect x={X(x.minPos)} y={axisY - 3} width={Math.max(2, X(x.maxPos) - X(x.minPos))} height={6} className="jv-range" />}
            {x.current && <circle cx={X(x.pos)} cy={axisY - 16} r={10} className="jv-stop-halo" />}
            <circle cx={X(x.pos)} cy={axisY - 16} r={7} />
            <text x={X(x.pos)} y={axisY - 12.5} textAnchor="middle" className="jv-num">{x.stopNumber}</text>
          </g>
        ))}
      </svg>
      <figcaption className="jv-caption">
        {current ? `${name}: about ${current.label}.` : ''}
        {m.sunDay ? ` If the Sun’s life so far were one day, ${name} would be ${m.sunDay} old.` : ''} The bar shows the published age range.
      </figcaption>
    </figure>
  );
}
