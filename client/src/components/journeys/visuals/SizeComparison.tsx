import { cloudSizeModel, fmtSig, sizeComparisonModel } from '@/lib/journeys/visual-data';

const W = 320, H = 170, CX = 92, CY = 85, MAX_PX = 74;

/**
 * Star size on the shared marble scale (doc 06 §7.2 item 2, doc 02 §6.3). Concentric circles on one linear scale
 * (Sun at the centre, this star, the previous star stop dashed) with planetary orbit rings for giants; the bar
 * form when the ratio is too large to draw. Labels carry the meaning, never colour.
 */
export function SizeComparison({ name, id, radiusRsun, prev }: { name: string; id: string; radiusRsun: number; prev?: { id: string; name: string; radiusRsun: number } | null }) {
  const m = sizeComparisonModel({ id, name, radiusRsun }, prev ?? null, MAX_PX);
  if (m.mode === 'bar' && m.bar) {
    const max = Math.max(...m.bar.map((b) => b.radiusRsun));
    return (
      <figure className="jv-figure jv-size" data-testid="journey-visual-size">
        <svg viewBox={`0 0 ${W} ${24 + m.bar.length * 30}`} className="jv-svg" role="img" aria-label={`${m.marbleSentence} ${m.scaleNote}`}>
          {m.bar.map((b, k) => {
            const len = Math.max(3, (b.radiusRsun / max) * 200);
            return (
              <g key={b.label} transform={`translate(0 ${14 + k * 30})`}>
                <text x={0} y={10} className="jv-label">{b.label}</text>
                <rect x={100} y={0} width={len} height={12} rx={2} className={k === m.bar!.length - 1 ? 'jv-bar-current' : 'jv-bar'} />
                {len > 150 && <path d={`M${100 + 70},-2 l6,16 M${100 + 76},-2 l6,16`} className="jv-break" />}
                <text x={Math.min(100 + len + 6, W - 4)} y={10} textAnchor={100 + len + 6 > W - 60 ? 'end' : 'start'} className="jv-tick">{b.marble}</text>
              </g>
            );
          })}
        </svg>
        <figcaption className="jv-caption">{m.marbleSentence} {m.scaleNote}</figcaption>
      </figure>
    );
  }
  const labels: { text: string; r: number; dashed?: boolean }[] = [
    ...m.rings.map((r) => ({ text: `${r.label}`, r: r.rPx })),
    ...m.circles.map((c) => ({ text: `${c.label}: ${c.marble}`, r: c.rPx, dashed: c.kind === 'previous' })),
  ].sort((a, b) => b.r - a.r);
  return (
    <figure className="jv-figure jv-size" data-testid="journey-visual-size">
      <svg viewBox={`0 0 ${W} ${H}`} className="jv-svg" role="img" aria-label={`${m.marbleSentence} ${m.circles.map((c) => `${c.label} ${c.marble} across`).join(', ')}${m.rings.length ? `; rings show ${m.rings.map((r) => r.label).join(', ')}` : ''}. ${m.scaleNote}`}>
        {m.rings.map((r) => <circle key={r.id} cx={CX} cy={CY} r={r.rPx} className="jv-ring" data-ring={r.id} />)}
        {m.circles.filter((c) => c.kind !== 'sun').sort((a, b) => b.rPx - a.rPx).map((c) => (
          <circle key={c.id} cx={CX} cy={CY} r={Math.max(1.5, c.rPx)} className={c.kind === 'object' ? 'jv-size-current' : c.kind === 'previous' ? 'jv-size-prev' : 'jv-size-planet'} data-size={c.kind} />
        ))}
        {m.circles.filter((c) => c.kind === 'sun').map((c) => (
          <g key="sun" className="jv-size-sun"><circle cx={CX} cy={CY} r={Math.max(1.2, c.rPx)} />{c.rPx < 2 && <circle cx={CX} cy={CY} r={4} className="jv-size-sun-pointer" />}</g>
        ))}
        {labels.map((l, k) => {
          const y = 18 + k * 18;
          return (
            <g key={l.text}>
              <line x1={CX + l.r * 0.7071} y1={CY - l.r * 0.7071} x2={CX + MAX_PX + 14} y2={y - 4} className="jv-leader" />
              <text x={CX + MAX_PX + 18} y={y} className={`jv-label${l.dashed ? ' jv-label-dashed' : ''}`}>{l.text}{l.dashed ? ' (dashed)' : ''}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="jv-caption">{m.marbleSentence} {m.scaleNote}</figcaption>
    </figure>
  );
}

/** Deep-sky physical size against the Sun–nearest-star gap (same light-year scale for every stop). */
export function CloudSize({ name, sizeLy, prev }: { name: string; sizeLy: number; prev?: { name: string; sizeLy: number } | null }) {
  const m = cloudSizeModel({ name, sizeLy }, prev ?? null);
  return (
    <figure className="jv-figure jv-size" data-testid="journey-visual-cloud-size">
      <svg viewBox={`0 0 ${W} ${16 + m.items.length * 34}`} className="jv-svg" role="img" aria-label={`${m.sentence} ${m.items.map((i) => `${i.label}: ${fmtSig(i.ly)} light-years`).join('; ')}.`}>
        {m.items.map((it, k) => (
          <g key={it.label} transform={`translate(0 ${10 + k * 34})`}>
            <text x={0} y={9} className="jv-label">{it.label} · {fmtSig(it.ly)} ly</text>
            <rect x={0} y={14} width={Math.max(2, it.frac * (W - 8))} height={9} rx={2} className={k === m.items.length - 1 ? 'jv-bar-current' : 'jv-bar'} />
          </g>
        ))}
      </svg>
      <figcaption className="jv-caption">{m.sentence} On the marble scale (Sun = 1 cm) it would still be about {m.items[m.items.length - 1].marble} across.</figcaption>
    </figure>
  );
}
