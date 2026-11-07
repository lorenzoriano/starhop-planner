/**
 * Canvas 2D overlay of the horizon viewer: altitude grid, compass points, the skyline or terrain line, constellation
 * lines, stars, the Sun, Moon, planets and the user's targets. Works on any CanvasRenderingContext2D-like object (the
 * tests pass a recording stub). Coordinates are CSS pixels; the caller sets the device-pixel transform.
 */
import { stellarRadius } from '../../stellar-appearance';
import type { BodyPoint, SkyCatalogue, SkyPoint } from './sky';
import { azAltToScreen, normAz, vecToScreen, viewBasis, type ViewBasis, type ViewState } from './view';

/** The subset of CanvasRenderingContext2D used here. */
export type Ctx2D = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'arc' | 'fillText' | 'strokeText' |
  'clearRect' | 'setLineDash' | 'closePath'> & {
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    globalAlpha: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    lineJoin: CanvasLineJoin;
  };

export interface OverlayScene {
  catalogue: SkyCatalogue | null;
  stars: Array<SkyPoint | null>;
  lines: Array<SkyPoint | null>;
  targets: Array<SkyPoint | null>;
  bodies: BodyPoint[];
  /** Apparent skyline to outline (combined layers without a photo; the terrain layer over a photo), or null. */
  skyline: ((az: number) => number | null) | null;
  /** 'ridge' = the outline of the ground silhouette; 'terrain' = the thin contrasting check line over the photo. */
  skylineStyle: 'ridge' | 'terrain';
  /** Faintest star drawn. */
  magLimit?: number;
}

const COLOURS = {
  grid: 'rgba(170, 200, 220, 0.28)',
  horizon: 'rgba(190, 215, 230, 0.55)',
  label: '#d8e4ea',
  north: '#ff9a84',
  ridge: '#a9c4b8',
  terrain: '#ffb347', // the same orange as the capture review's terrain line
  terrainShadow: 'rgba(0, 0, 0, 0.75)',
  lines: 'rgba(120, 165, 205, 0.38)',
  target: '#e9d29a',
  sun: '#ffd76a',
  moonDark: '#232b38',
  moonLit: '#d8dde3',
  // Planet colours as on the sky chart (SolarSkySymbol).
  planets: { Mercury: '#d0bab0', Venus: '#f7dfb0', Mars: '#ef987e', Jupiter: '#e5bd91', Saturn: '#decfa0' } as Record<string, string>,
};
const HIDDEN_ALPHA = 0.28;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function outlinedText(ctx: Ctx2D, text: string, x: number, y: number, colour: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

/** Polyline of a function of azimuth (altitude per azimuth), broken where it leaves the view or goes behind it. */
function azimuthCurve(ctx: Ctx2D, view: ViewState, basis: ViewBasis, altAt: (az: number) => number | null, stepDeg = 1) {
  ctx.beginPath();
  let pen = false, prev: { x: number; y: number } | null = null;
  const maxJump = Math.max(view.width, view.height) * 1.5;
  for (let az = 0; az <= 360; az += stepDeg) {
    const alt = altAt(az % 360);
    const p = alt === null ? null : azAltToScreen(view, az, alt, basis);
    if (!p || (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > maxJump)) {
      pen = false;
      prev = p;
      if (!p) continue;
    }
    if (pen) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    pen = true;
    prev = p;
  }
  ctx.stroke();
}

const onScreen = (view: ViewState, p: { x: number; y: number } | null, pad = 40): p is { x: number; y: number } =>
  !!p && p.x > -pad && p.y > -pad && p.x < view.width + pad && p.y < view.height + pad;

function drawGrid(ctx: Ctx2D, view: ViewState, basis: ViewBasis) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const alt of [30, 60]) {
    ctx.strokeStyle = COLOURS.grid;
    azimuthCurve(ctx, view, basis, () => alt, 2);
    const p = azAltToScreen(view, view.yaw, alt, basis);
    if (onScreen(view, p, 0)) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      outlinedText(ctx, `${alt}°`, p.x + 4, p.y - 2, COLOURS.label);
    }
  }
  ctx.strokeStyle = COLOURS.horizon;
  azimuthCurve(ctx, view, basis, () => 0, 2);
  // Compass points just below the horizon line, with ticks every 15°.
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let az = 0; az < 360; az += 15) {
    const top = azAltToScreen(view, az, 0, basis), bottom = azAltToScreen(view, az, az % 45 ? -0.8 : -1.6, basis);
    if (!onScreen(view, top) || !bottom) continue;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
    if (az % 45 === 0) {
      const label = azAltToScreen(view, az, -2.2, basis);
      if (label) outlinedText(ctx, COMPASS[az / 45], label.x, label.y, az === 0 ? COLOURS.north : COLOURS.label);
    }
  }
  ctx.restore();
}

function drawSkyline(ctx: Ctx2D, view: ViewState, basis: ViewBasis, scene: OverlayScene) {
  if (!scene.skyline) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (scene.skylineStyle === 'terrain') {
    ctx.strokeStyle = COLOURS.terrainShadow;
    ctx.lineWidth = 3.5;
    azimuthCurve(ctx, view, basis, scene.skyline, 0.5);
    ctx.strokeStyle = COLOURS.terrain;
    ctx.lineWidth = 1.5;
    azimuthCurve(ctx, view, basis, scene.skyline, 0.5);
  } else {
    ctx.strokeStyle = COLOURS.ridge;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.4;
    azimuthCurve(ctx, view, basis, scene.skyline, 0.5);
  }
  ctx.restore();
}

function drawLines(ctx: Ctx2D, view: ViewState, basis: ViewBasis, lines: Array<SkyPoint | null>) {
  ctx.save();
  ctx.strokeStyle = COLOURS.lines;
  ctx.lineWidth = 1;
  // Two passes: segments in the open sky, then (faint) segments with an end behind the skyline.
  for (const hiddenPass of [false, true]) {
    ctx.globalAlpha = hiddenPass ? HIDDEN_ALPHA : 1;
    ctx.beginPath();
    for (let k = 0; k + 1 < lines.length; k += 2) {
      const a = lines[k], b = lines[k + 1];
      if (!a || !b || (a.hidden || b.hidden) !== hiddenPass) continue;
      const pa = vecToScreen(view, a.vec, basis), pb = vecToScreen(view, b.vec, basis);
      if (!pa || !pb) continue;
      if (!onScreen(view, pa, 400) && !onScreen(view, pb, 400)) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Star dot radius in CSS pixels: the chart's magnitude scale (enlarged for a full-screen view), larger when zoomed in. */
const starRadius = (mag: number, fovDeg: number) => Math.max(0.9, 1.5 * stellarRadius(mag) * Math.min(1.5, Math.max(0.8, 60 / fovDeg)));

function drawStars(ctx: Ctx2D, view: ViewState, basis: ViewBasis, scene: OverlayScene) {
  const cat = scene.catalogue;
  if (!cat) return;
  const limit = scene.magLimit ?? 5;
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  scene.stars.forEach((s, i) => {
    const star = cat.stars[i];
    if (!s || !star || star.mag > limit) return;
    const p = vecToScreen(view, s.vec, basis);
    if (!onScreen(view, p, 8)) return;
    const r = starRadius(star.mag, view.fovDeg);
    ctx.globalAlpha = s.hidden ? HIDDEN_ALPHA : 1;
    ctx.fillStyle = star.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (star.name && star.mag < 1.2 && !s.hidden) outlinedText(ctx, star.name, p.x + r + 3, p.y, 'rgba(216, 228, 234, 0.75)');
  });
  ctx.restore();
}

function moonShape(ctx: Ctx2D, x: number, y: number, r: number, phase: number) {
  ctx.fillStyle = COLOURS.moonDark;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Lit part: the limb on the sunward side plus the terminator ellipse (as SolarSkySymbol).
  const sign = phase <= 180 ? 1 : -1, c = Math.cos((phase * Math.PI) / 180);
  ctx.fillStyle = COLOURS.moonLit;
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const t = -1 + i / 16, px = x + sign * Math.sqrt(Math.max(0, 1 - t * t)) * r, py = y + t * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  for (let i = 0; i <= 32; i++) {
    const t = 1 - i / 16;
    ctx.lineTo(x + sign * c * Math.sqrt(Math.max(0, 1 - t * t)) * r, y + t * r);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBodies(ctx: Ctx2D, view: ViewState, basis: ViewBasis, bodies: BodyPoint[]) {
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const b of bodies) {
    if (b.alt < -1) continue; // well below the horizon: not drawn at all
    const p = vecToScreen(view, b.vec, basis);
    if (!onScreen(view, p, 20)) continue;
    ctx.globalAlpha = b.hidden ? 0.4 : 1;
    let r = 4;
    if (b.name === 'Sun') {
      r = 8;
      ctx.fillStyle = COLOURS.sun;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.name === 'Moon') {
      r = 8;
      moonShape(ctx, p.x, p.y, r, b.phase ?? 180);
    } else {
      ctx.fillStyle = COLOURS.planets[b.name] ?? '#ddc49a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    outlinedText(ctx, b.name, p.x + r + 4, p.y, COLOURS.label);
  }
  ctx.restore();
}

function drawTargets(ctx: Ctx2D, view: ViewState, basis: ViewBasis, scene: OverlayScene) {
  const cat = scene.catalogue;
  if (!cat) return;
  ctx.save();
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.8;
  scene.targets.forEach((t, i) => {
    const target = cat.targets[i];
    if (!t || !target) return;
    const p = vecToScreen(view, t.vec, basis);
    if (!onScreen(view, p, 20)) return;
    ctx.globalAlpha = t.hidden ? 0.6 : 1;
    ctx.strokeStyle = COLOURS.target;
    ctx.setLineDash(t.hidden ? [3, 3] : []);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    outlinedText(ctx, t.hidden ? `${target.name} (behind the skyline)` : target.name, p.x + 13, p.y, COLOURS.target);
  });
  ctx.restore();
}

/** Draws the whole overlay for one frame. */
export function drawOverlay(ctx: Ctx2D, view: ViewState, scene: OverlayScene) {
  const basis = viewBasis(view);
  ctx.clearRect(0, 0, view.width, view.height);
  drawGrid(ctx, view, basis);
  drawSkyline(ctx, view, basis, scene);
  drawLines(ctx, view, basis, scene.lines);
  drawStars(ctx, view, basis, scene);
  drawBodies(ctx, view, basis, scene.bodies);
  drawTargets(ctx, view, basis, scene);
}

// ───────────────────────────── words ─────────────────────────────

const WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

/** "Looking southwest, 20° up" for the screen reader and the corner readout. */
export function lookingAt(yaw: number, pitch: number): string {
  const dir = WORDS[Math.round(normAz(yaw) / 45) % 8];
  const p = Math.round(pitch);
  return `Looking ${dir}, ${p === 0 ? 'level' : p > 0 ? `${p}° up` : `${-p}° down`}`;
}

/** "Photo moved 1.4° to the right" for the alignment readout. */
export function shiftWords(deg: number): string {
  const a = Math.abs(deg);
  if (a < 0.05) return 'Photo not moved';
  return `Photo moved ${a.toFixed(1)}° to the ${deg > 0 ? 'right' : 'left'}`;
}
