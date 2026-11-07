import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HorizonViewer from '../horizon/HorizonViewer';
import { PanoramaRenderer } from '@/lib/horizon/viewer/background';
import { drawOverlay, lookingAt, shiftWords, type Ctx2D, type OverlayScene } from '@/lib/horizon/viewer/overlay';
import { bodyPoints, buildCatalogue, horizontalMatrix, skyPoints } from '@/lib/horizon/viewer/sky';
import type { ViewState } from '@/lib/horizon/viewer/view';

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

/** Records the calls a 2D context receives (no DOM or canvas in the test environment). */
function recorder() {
  const calls: Array<{ op: string; args: unknown[]; alpha: number; fill: unknown }> = [];
  const ctx: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'miter' };
  const stack: Array<Record<string, unknown>> = [];
  for (const op of ['beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'fillText', 'strokeText', 'clearRect', 'setLineDash', 'closePath']) {
    ctx[op] = (...args: unknown[]) => { calls.push({ op, args, alpha: ctx.globalAlpha as number, fill: ctx.fillStyle }); };
  }
  ctx.save = () => { stack.push({ ...ctx }); };
  ctx.restore = () => { Object.assign(ctx, stack.pop()); };
  return { ctx: ctx as unknown as Ctx2D, calls };
}

describe('HorizonViewer', () => {
  it('renders the full-screen dialog with Close, the time slider in site time and Now, before any effect runs', () => {
    const html = renderToStaticMarkup(createElement(HorizonViewer, {
      lat: 46.02, lon: 7.75, date: new Date('2026-11-06T21:30:00Z'), onClose: noop,
      targets: [{ id: 'M31', name: 'Andromeda Galaxy', ra: 10.68, dec: 41.27 }],
    }));
    const t = text(html);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="Look around"');
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
    expect(html).toMatch(/<input type="range" aria-label="Time tonight" aria-valuetext="22:30"/);
    expect(t).toContain('Now');
    expect(t).toMatch(/Sunset 1\d:\d\d/);
    expect(t).toMatch(/Sunrise 0\d:\d\d/);
    expect(t).not.toContain('Line up'); // only once a photo is shown
    expect(html).toContain('role="img"');
  });

  it('falls back when the browser has no WebGL', () => {
    const none = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(PanoramaRenderer.create(none)).toBeNull();
    const throws = { getContext: () => { throw new Error('blocked'); } } as unknown as HTMLCanvasElement;
    expect(PanoramaRenderer.create(throws)).toBeNull();
  });
});

describe('viewer overlay', () => {
  const lat = 46.02, lon = 7.75, date = new Date('2026-11-06T21:30:00Z');
  const cat = buildCatalogue(
    [
      { ra: 279.2347, dec: 38.7837, mag: 0.03, name: 'Vega', temperature: 9600 },
      { ra: 297.6958, dec: 8.8683, mag: 0.76, name: 'Altair', temperature: 7700 },
      { ra: 101.2872, dec: -16.7161, mag: -1.46, name: 'Sirius', temperature: 9900 }, // below the horizon at this time
    ],
    [{ points: [[[279.2347, 38.7837], [297.6958, 8.8683]]] }],
    [{ id: 'M31', name: 'Andromeda Galaxy', ra: 10.68, dec: 41.27 }],
    date,
  );
  const m = horizontalMatrix(lat, lon, date);
  const scene = (h: Parameters<typeof skyPoints>[2]): OverlayScene => ({
    catalogue: cat, stars: skyPoints(cat.starVecs, m, h), lines: skyPoints(cat.lineVecs, m, h),
    targets: skyPoints(cat.targetVecs, m, h), bodies: bodyPoints(lat, lon, date, h), skyline: () => 3, skylineStyle: 'terrain',
  });

  it('draws stars, names, lines, compass points and targets in view; dims what the skyline hides', () => {
    const vega = scene(null).stars[0]!;
    const view: ViewState = { yaw: vega.az, pitch: Math.min(60, vega.alt), fovDeg: 100, width: 915, height: 412 };
    const open = recorder();
    drawOverlay(open.ctx, view, scene(null));
    const labels = open.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('Vega');
    expect(labels).toContain('30°');
    expect(open.calls.some((c) => c.op === 'arc' && c.alpha === 1 && c.fill === cat.stars[0].color)).toBe(true);
    expect(open.calls.filter((c) => c.op === 'clearRect')).toHaveLength(1);

    const wall = { terrain: { kind: 'terrain' as const, stepDeg: 1, alt: new Array(360).fill(89), lat, lon, computedAt: '', source: 'test' } };
    const hidden = recorder();
    drawOverlay(hidden.ctx, view, scene(wall));
    const vegaDot = hidden.calls.find((c) => c.op === 'arc' && c.fill === cat.stars[0].color)!;
    expect(vegaDot.alpha).toBeLessThan(0.5);
    expect(hidden.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).not.toContain('Vega');
  });

  it('labels targets and says when one is behind the skyline', () => {
    const m31 = scene(null).targets[0]!;
    const view: ViewState = { yaw: m31.az, pitch: m31.alt, fovDeg: 60, width: 412, height: 915 };
    const r = recorder();
    drawOverlay(r.ctx, view, scene(null));
    expect(r.calls.some((c) => c.op === 'fillText' && c.args[0] === 'Andromeda Galaxy')).toBe(true);
    const w = recorder();
    const wall = { terrain: { kind: 'terrain' as const, stepDeg: 1, alt: new Array(360).fill(89), lat, lon, computedAt: '', source: 'test' } };
    drawOverlay(w.ctx, view, scene(wall));
    expect(w.calls.some((c) => c.op === 'fillText' && c.args[0] === 'Andromeda Galaxy (behind the skyline)')).toBe(true);
  });

  it('puts the compass points on the horizon', () => {
    const r = recorder();
    drawOverlay(r.ctx, { yaw: 0, pitch: 0, fovDeg: 100, width: 915, height: 412 }, { ...scene(null), skyline: null, skylineStyle: 'ridge' });
    const labels = r.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(labels).toEqual(expect.arrayContaining(['N', 'NE', 'NW']));
    expect(labels).not.toContain('S');
  });

  it('words the direction and the alignment shift plainly', () => {
    expect(lookingAt(225, 20)).toBe('Looking southwest, 20° up');
    expect(lookingAt(0, 0)).toBe('Looking north, level');
    expect(lookingAt(91, -10)).toBe('Looking east, 10° down');
    expect(shiftWords(1.43)).toBe('Photo moved 1.4° to the right');
    expect(shiftWords(-0.5)).toBe('Photo moved 0.5° to the left');
    expect(shiftWords(0.01)).toBe('Photo not moved');
  });
});
