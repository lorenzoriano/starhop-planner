/**
 * Label placer for journey stop labels on the sky chart (owner feedback r2/r3: numbers and names sit beside the
 * stars, never on them, and never drift toward a neighbour's ring).
 *
 * Each stop label tries candidate boxes in 8 directions around its ring, nearest first, and keeps the cheapest:
 *  - forbidden: covering a star brighter than the stop itself, or another stop label;
 *  - expensive: leaving the visible frame, covering another stop's ring (or its own; for a cluster or nebula the ring
 *    is its real angular extent, so the label sits outside its stars) or the compass, sitting closer to another
 *    stop than to its own, covering background labels (constellation and star names);
 *  - mild: covering fainter stars, crossing hop lines, distance from the ring, and a fixed direction preference.
 * A label that had to move away from its ring gets a short leader line. Stop labels are placed before the
 * background names; the chart then places constellation and star names around them (stop labels win).
 *
 * Coordinates are SVG user units; `unit` is one screen pixel in those units.
 */
export interface PlacerBox { l: number; t: number; r: number; b: number }
export interface PlacerPoint { x: number; y: number }
export interface PlacerStar { x: number; y: number; r: number; mag: number }
export interface StopLabelRequest {
  /** Ring centre. */
  x: number;
  y: number;
  /** Ring radius (user units). */
  ring: number;
  width: number;
  height: number;
  /** The stop's own magnitude: stars brighter than this may never be covered (hard to mag 4, heavy beyond). */
  mag: number | null;
  /** Placement order: lower first (current/highlighted stops first). */
  priority?: number;
}
export interface PlacedStopLabel {
  box: PlacerBox;
  /** Leader from the ring edge to the label, when the label sits away from its ring. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  /** True when no candidate was free of forbidden overlaps (best effort). */
  forced: boolean;
}
export interface PlacerInput {
  labels: StopLabelRequest[];
  /** All rings drawn on the chart (stops, plus any anchor mark), as circles. */
  rings: { x: number; y: number; r: number }[];
  stars: PlacerStar[];
  /** Background labels already known (soft obstacles). */
  soft?: PlacerBox[];
  /** Hop lines (soft obstacles). */
  segments?: { a: PlacerPoint; b: PlacerPoint }[];
  /** Chart furniture a label may not cover (the compass), nearly as costly as a ring. */
  blocked?: PlacerBox[];
  view: PlacerBox;
  unit: number;
}

/** Direction order: right, left, the four diagonals (upper first), then above and below. Screen y points down. */
const DIRECTIONS: { dx: number; dy: number; pref: number }[] = [
  { dx: 1, dy: 0, pref: 0 },
  { dx: -1, dy: 0, pref: 1 },
  { dx: Math.SQRT1_2, dy: -Math.SQRT1_2, pref: 2 },
  { dx: Math.SQRT1_2, dy: Math.SQRT1_2, pref: 2.5 },
  { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2, pref: 3 },
  { dx: -Math.SQRT1_2, dy: Math.SQRT1_2, pref: 3.5 },
  { dx: 0, dy: -1, pref: 4 },
  { dx: 0, dy: 1, pref: 4.5 },
];
/** Extra distance beyond the ring + gap, in screen pixels: adjacent first, then with a leader. */
const STEPS = [0, 7, 14, 24, 36];
const FORBIDDEN = 1e7;

export function overlapArea(a: PlacerBox, b: PlacerBox): number {
  return Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
}
function circleHitsBox(c: { x: number; y: number; r: number }, box: PlacerBox): boolean {
  const dx = Math.max(box.l - c.x, 0, c.x - box.r), dy = Math.max(box.t - c.y, 0, c.y - box.b);
  return dx * dx + dy * dy < c.r * c.r;
}
function pointSegmentDistance(p: PlacerPoint, a: PlacerPoint, b: PlacerPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function distanceToBox(p: PlacerPoint, box: PlacerBox): number {
  return Math.hypot(Math.max(box.l - p.x, 0, p.x - box.r), Math.max(box.t - p.y, 0, p.y - box.b));
}
/** Length of a segment inside a box (Liang–Barsky clip). */
export function segmentLengthInBox(a: PlacerPoint, b: PlacerPoint, box: PlacerBox): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, a.x - box.l) || !clip(dx, box.r - a.x) || !clip(-dy, a.y - box.t) || !clip(dy, box.b - a.y)) return 0;
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}

/** The box of a label whose nearest edge/corner touches point P in direction (dx, dy). */
export function boxAt(p: PlacerPoint, dx: number, dy: number, width: number, height: number): PlacerBox {
  const l = dx > 0.3 ? p.x : dx < -0.3 ? p.x - width : p.x - width / 2;
  const t = dy > 0.3 ? p.y : dy < -0.3 ? p.y - height : p.y - height / 2;
  return { l, t, r: l + width, b: t + height };
}

export function placeStopLabels(input: PlacerInput): (PlacedStopLabel | null)[] {
  const { labels, rings, stars, soft = [], segments = [], blocked = [], view, unit } = input;
  const u2 = unit * unit;
  const placed: (PlacedStopLabel | null)[] = labels.map(() => null);
  const taken: PlacerBox[] = [];
  const order = labels.map((label, index) => ({ label, index })).sort((a, b) => (a.label.priority ?? 0) - (b.label.priority ?? 0) || a.index - b.index);
  for (const { label, index } of order) {
    // Hard: stars brighter than the stop stay uncovered, down to mag 4 (and every star to mag 3.5, the guide stars).
    // A faint stop sits among hundreds of fainter-than-4 stars that are still brighter than it: those cost heavily
    // instead, so the label hugs its ring rather than drifting off to find an empty patch of Milky Way.
    const stopMag = label.mag ?? 4.5;
    const hard = Math.max(3.5, Math.min(stopMag, 4));
    const gap = 3 * unit;
    let best: { box: PlacerBox; cost: number; step: number; dir: { dx: number; dy: number } } | null = null;
    for (const step of STEPS) {
      const reach = label.ring + gap + step * unit;
      for (const dir of DIRECTIONS) {
        const p = { x: label.x + dir.dx * reach, y: label.y + dir.dy * reach };
        const box = boxAt(p, dir.dx, dir.dy, label.width, label.height);
        let cost = step * 7 + dir.pref * 3;
        // the visible frame
        const inside = Math.max(0, Math.min(box.r, view.r) - Math.max(box.l, view.l)) * Math.max(0, Math.min(box.b, view.b) - Math.max(box.t, view.t));
        cost += ((box.r - box.l) * (box.b - box.t) - inside) / u2 * 40;
        // other stop labels: never
        for (const other of taken) if (overlapArea(box, other) > 0) cost += FORBIDDEN;
        // chart furniture (the compass)
        for (const b of blocked) if (overlapArea(box, b) > 0) cost += 3500;
        // rings (with a 1 px margin)
        for (const ring of rings) if (circleHitsBox({ x: ring.x, y: ring.y, r: ring.r + unit }, box)) cost += 4000;
        // stars: brighter than the stop is forbidden, fainter ones cost by brightness
        for (const star of stars) {
          if (!circleHitsBox({ x: star.x, y: star.y, r: star.r + 1.5 * unit }, box)) continue;
          if (star.mag < hard) cost += FORBIDDEN;
          else if (star.mag < stopMag) cost += 30 + (6.5 - star.mag) * 15;
          else cost += Math.max(1, (6.5 - star.mag)) ** 2 * 6;
        }
        // background names (they re-place around stop labels, but a free spot is still better)
        for (const s of soft) cost += overlapArea(box, s) / u2 * 0.4;
        // hop lines (a few pixels where a line leaves the ring are fine: the text halo covers them)
        for (const s of segments) cost += Math.max(0, segmentLengthInBox(s.a, s.b, box) / unit - 4) * 4;
        // a leader must not read as the continuation of a hop line leaving this ring
        if (step > 0) for (const s of segments) {
          for (const [end, other] of [[s.a, s.b], [s.b, s.a]] as const) {
            if (Math.hypot(end.x - label.x, end.y - label.y) > label.ring * 2) continue;
            const len = Math.hypot(other.x - end.x, other.y - end.y) || 1;
            if (((other.x - end.x) * dir.dx + (other.y - end.y) * dir.dy) / len > 0.8) cost += 400;
            if (((other.x - end.x) * dir.dx + (other.y - end.y) * dir.dy) / len < -0.95) cost += 250;
          }
        }
        // a leader may not run over a star it would hide (the same rules as the label)
        if (step > 0) {
          const end = { x: Math.max(box.l, Math.min(box.r, label.x)), y: Math.max(box.t, Math.min(box.b, label.y)) };
          for (const star of stars) {
            if (Math.hypot(star.x - label.x, star.y - label.y) <= label.ring) continue;
            if (pointSegmentDistance(star, label, end) > star.r + unit) continue;
            cost += star.mag < hard ? FORBIDDEN : star.mag < stopMag ? 25 : 4;
          }
        }
        // ambiguity: the label must read as belonging to its own ring
        const own = distanceToBox(label, box);
        for (const ring of rings) {
          if (Math.abs(ring.x - label.x) < 1e-6 && Math.abs(ring.y - label.y) < 1e-6) continue;
          // clearly nearer its own ring: another ring may not be as close (within 4 px) as its own
          const other = distanceToBox(ring, box);
          if (other < own + 4 * unit) cost += other < own ? 1500 : 600;
        }
        if (!best || cost < best.cost - 1e-9) best = { box, cost, step, dir };
      }
      // An adjacent (or near) spot with no forbidden hit and little cost ends the search early.
      if (best && best.cost < 60 + step * 7) break;
    }
    if (!best) continue;
    taken.push(best.box);
    const leader = best.step >= 7 ? (() => {
      const end = { x: Math.max(best.box.l, Math.min(best.box.r, label.x)), y: Math.max(best.box.t, Math.min(best.box.b, label.y)) };
      const len = Math.hypot(end.x - label.x, end.y - label.y) || 1;
      const sx = label.x + (end.x - label.x) / len * (label.ring + unit), sy = label.y + (end.y - label.y) / len * (label.ring + unit);
      return { x1: sx, y1: sy, x2: end.x - (end.x - label.x) / len * unit, y2: end.y - (end.y - label.y) / len * unit };
    })() : null;
    placed[index] = { box: best.box, leader, forced: best.cost >= FORBIDDEN };
  }
  return placed;
}
