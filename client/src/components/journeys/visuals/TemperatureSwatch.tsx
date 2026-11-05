import { useId } from 'react';
import { blackbodyHex, fmtSig, SUN, TEMP_BAR, temperatureBarPosition, temperatureWord } from '@/lib/journeys/visual-data';

const GRADIENT_K = [40_000, 20_000, 10_000, 7000, 5772, 4500, 3500, 2500];

/**
 * Colour/temperature swatch (doc 06 §7.2 item 3, doc 02 §6.1): a disc in the blackbody display colour, a text
 * colour word (red light removes hue), and the star's place on a 2,500–40,000 K log bar with the Sun marked.
 */
export function TemperatureSwatch({ teffK, name, compact = false }: { teffK: number; name: string; compact?: boolean }) {
  const gid = `jv-tbar-${useId().replaceAll(':', '')}`;
  const color = blackbodyHex(teffK), word = temperatureWord(teffK);
  const W = 300, x0 = 12, x1 = W - 12, barY = 34;
  const at = (t: number) => x0 + temperatureBarPosition(t) * (x1 - x0);
  const starX = at(teffK), sunX = at(SUN.teffK);
  return (
    <figure className="jv-figure jv-swatch" data-testid="journey-visual-temperature">
      <div className="jv-swatch-head">
        <span className="jv-swatch-disc" style={{ background: color }} aria-hidden="true" />
        <span><strong>{word}</strong> · ≈ {fmtSig(teffK)} K surface</span>
      </div>
      {!compact && (
        <svg viewBox={`0 0 ${W} 62`} className="jv-svg" role="img" aria-label={`Temperature scale from ${TEMP_BAR.maxK.toLocaleString('en-US')} K (hot, left) to ${TEMP_BAR.minK.toLocaleString('en-US')} K (cool, right). ${name} at about ${fmtSig(teffK)} K; the Sun at ${SUN.teffK.toLocaleString('en-US')} K.`}>
          <defs>
            <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
              {GRADIENT_K.map((t) => <stop key={t} offset={temperatureBarPosition(t)} stopColor={blackbodyHex(t)} />)}
            </linearGradient>
          </defs>
          <text x={x0} y={barY + 22} className="jv-label">← hot</text>
          <text x={x1} y={barY + 22} className="jv-label" textAnchor="end">cool →</text>
          <rect x={x0} y={barY - 5} width={x1 - x0} height={10} rx={5} fill={`url(#${gid})`} opacity={0.85} />
          <g className="jv-tick-sun">
            <line x1={sunX} x2={sunX} y1={barY - 9} y2={barY + 9} />
            <text x={sunX} y={barY + 22} textAnchor="middle" className="jv-label">Sun</text>
          </g>
          <g className="jv-tick-star">
            <path d={`M${starX - 6},${barY - 16} L${starX + 6},${barY - 16} L${starX},${barY - 7} Z`} />
            <text x={Math.max(x0 + 30, Math.min(x1 - 30, starX))} y={barY - 19} textAnchor="middle" className="jv-label jv-label-strong">{name}</text>
          </g>
        </svg>
      )}
      <figcaption className="jv-caption">Display color of a {fmtSig(teffK)} K glow, not what your eye sees: faint stars look white at night.</figcaption>
    </figure>
  );
}
