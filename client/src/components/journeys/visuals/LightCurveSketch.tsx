import { hash32, lightCurveModel, type LightCurveShape } from '@/lib/journeys/visual-data';

const W = 320, H = 132, BOX = { x: 66, y: 10, width: 246, height: 86 };

/** Schematic light curve for a variable star (doc 02 §6.4): shape by class, true range and period on the axes. */
export function LightCurveSketch({ id, name, shape, vMax, vMin, periodDays, betaLyrae }: { id: string; name: string; shape: LightCurveShape; vMax?: number; vMin?: number; periodDays?: number; betaLyrae?: boolean }) {
  const m = lightCurveModel(shape, { vMax, vMin, periodDays, seed: hash32(id), betaLyrae }, BOX);
  return (
    <figure className="jv-figure jv-lightcurve" data-testid="journey-visual-light-curve">
      <svg viewBox={`0 0 ${W} ${H}`} className="jv-svg" role="img" aria-label={`Schematic light curve of ${name}: ${m.yTop} to ${m.yBottom}; ${m.xLabel}. ${m.caption}`}>
        <rect x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} className="jv-plot-bg" />
        <line x1={BOX.x} x2={BOX.x + BOX.width} y1={BOX.y} y2={BOX.y} className="jv-grid" />
        <line x1={BOX.x} x2={BOX.x + BOX.width} y1={BOX.y + BOX.height} y2={BOX.y + BOX.height} className="jv-grid" />
        <path d={m.d} className="jv-curve" />
        <text x={BOX.x - 6} y={BOX.y + 4} textAnchor="end" className="jv-tick">{m.yTop.split(' · ')[0]}</text>
        {m.yTop.includes('·') && <text x={BOX.x - 6} y={BOX.y + 16} textAnchor="end" className="jv-tick">{m.yTop.split(' · ')[1]}</text>}
        <text x={BOX.x - 6} y={BOX.y + BOX.height - 8} textAnchor="end" className="jv-tick">{m.yBottom.split(' · ')[0]}</text>
        {m.yBottom.includes('·') && <text x={BOX.x - 6} y={BOX.y + BOX.height + 4} textAnchor="end" className="jv-tick">{m.yBottom.split(' · ')[1]}</text>}
        <text x={BOX.x + BOX.width / 2} y={H - 14} textAnchor="middle" className="jv-label">{m.xLabel}</text>
      </svg>
      <figcaption className="jv-caption">{m.caption} Up is brighter. Smaller magnitude numbers mean a brighter star.</figcaption>
    </figure>
  );
}
