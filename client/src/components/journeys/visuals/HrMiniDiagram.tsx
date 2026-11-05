import { useId } from 'react';
import { HR_DOMAIN, hrProject, hrTemperatureTicks, MAIN_SEQUENCE_LINE, SUN, type HrGrid, type HrMarker } from '@/lib/journeys/visual-data';
import { useHrGrid } from './useHrGrid';

const W = 320, H = 236;
const BOX = { x: 30, y: 12, width: 278, height: 184 };

/**
 * HR mini-diagram (doc 06 §7.2 item 1, doc 02 §6.2): naked-eye stars as a density background, the main sequence
 * line, the Sun ring, earlier journey stars as small numbered dots joined in stop order, and this star as a big
 * labelled dot. Red-light safe: markers differ by size, number and outline; the axis is labelled in words.
 */
export function HrMiniDiagram({ markers, grid: gridProp }: { markers: HrMarker[]; grid?: HrGrid }) {
  const loaded = useHrGrid();
  const grid = gridProp ?? loaded;
  const arrowId = `jv-hr-arrow-${useId().replaceAll(':', '')}`;
  const P = (bv: number, mv: number) => hrProject(bv, mv, BOX);
  const cw = (grid.bvStep / (HR_DOMAIN.bvMax - HR_DOMAIN.bvMin)) * BOX.width;
  const ch = (grid.mvStep / (HR_DOMAIN.mvMax - HR_DOMAIN.mvMin)) * BOX.height;
  const ms = MAIN_SEQUENCE_LINE.map(([bv, mv], k) => { const p = P(bv, mv); return `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join('');
  const sun = P(SUN.bv, SUN.absMagV);
  const trail = [...markers].sort((a, b) => a.stopNumber - b.stopNumber);
  const trailPath = trail.map((m, k) => { const p = P(m.bv, m.mv); return `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join('');
  const current = markers.find((m) => m.current);
  const label = (bv: number, mv: number, text: string, anchor: 'start' | 'middle' | 'end' = 'middle') => { const p = P(bv, mv); return <text x={p.x} y={p.y} textAnchor={anchor} className="jv-region">{text}</text>; };
  const desc = `Temperature–brightness diagram of naked-eye stars. ${current ? `${current.label} (stop ${current.stopNumber}) is the large dot.` : ''} ${trail.filter((m) => !m.current).map((m) => `Stop ${m.stopNumber}: ${m.label}.`).join(' ')} The Sun is the ring.`;
  return (
    <figure className="jv-figure jv-hr" data-testid="journey-visual-hr">
      <svg viewBox={`0 0 ${W} ${H}`} className="jv-svg" role="img" aria-label={desc} data-hr-source={grid.source}>
        <defs>
          <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" className="jv-arrowhead" />
          </marker>
        </defs>
        <rect x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} className="jv-plot-bg" />
        <g className="jv-hr-cells">
          {grid.cells.map((c) => {
            const x = BOX.x + c.i * cw, y = BOX.y + c.j * ch;
            return <rect key={`${c.i}-${c.j}`} x={x} y={y} width={cw + 0.3} height={ch + 0.3} opacity={0.12 + 0.5 * Math.sqrt(c.count / grid.maxCount)} />;
          })}
        </g>
        <path d={ms} className="jv-hr-ms" />
        {label(-0.2, 3.6, 'main sequence', 'start')}
        {label(-0.2, 4.9, '(long adult life)', 'start')}
        {label(1.35, -2.4, 'giants')}
        {label(0.7, -7.6, 'supergiants')}
        {label(0.15, 13.2, 'white dwarfs')}
        <g className="jv-hr-sun">
          <circle cx={sun.x} cy={sun.y} r={5} />
          <circle cx={sun.x} cy={sun.y} r={1.2} className="jv-hr-sun-dot" />
          <text x={sun.x + 8} y={sun.y + 4} className="jv-label">Sun</text>
        </g>
        {trail.length > 1 && <path d={trailPath} className="jv-hr-trail" markerEnd={`url(#${arrowId})`} />}
        {trail.filter((m) => !m.current).map((m) => {
          const p = P(m.bv, m.mv);
          return (
            <g key={m.id} className="jv-hr-prev" data-hr-stop={m.stopNumber}>
              <circle cx={p.x} cy={p.y} r={7} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="jv-num">{m.stopNumber}</text>
            </g>
          );
        })}
        {current && (() => {
          const p = P(current.bv, current.mv);
          const right = p.x < BOX.x + BOX.width - 80;
          return (
            <g className="jv-hr-current" data-hr-stop={current.stopNumber} data-hr-current="true">
              <circle cx={p.x} cy={p.y} r={11} className="jv-hr-current-halo" />
              <circle cx={p.x} cy={p.y} r={7.5} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="jv-num jv-num-inverse">{current.stopNumber}</text>
              <text x={p.x + (right ? 15 : -15)} y={p.y - 9} textAnchor={right ? 'start' : 'end'} className="jv-label jv-label-strong">{current.label}</text>
            </g>
          );
        })()}
        {hrTemperatureTicks().map((t) => {
          const p = P(t.bv, HR_DOMAIN.mvMax);
          return <g key={t.label}><line x1={p.x} x2={p.x} y1={BOX.y + BOX.height} y2={BOX.y + BOX.height + 4} className="jv-axis" /><text x={p.x} y={BOX.y + BOX.height + 14} textAnchor="middle" className="jv-tick">{t.label}</text></g>;
        })}
        <text x={BOX.x + BOX.width / 2} y={H - 4} textAnchor="middle" className="jv-label">hotter ← surface temperature → cooler</text>
        <text x={12} y={BOX.y + BOX.height / 2} textAnchor="middle" className="jv-label" transform={`rotate(-90 12 ${BOX.y + BOX.height / 2})`}>dimmer ← true brightness → brighter</text>
      </svg>
      <figcaption className="jv-caption">
        Each gray square is a patch of the {grid.source === 'file' ? '8,000+' : 'naked-eye'} stars you can see without optics, placed by true brightness and colour.
        {trail.length > 1 ? ' Numbered dots are tonight’s earlier stars; the arrow follows your journey.' : ''}
      </figcaption>
    </figure>
  );
}
