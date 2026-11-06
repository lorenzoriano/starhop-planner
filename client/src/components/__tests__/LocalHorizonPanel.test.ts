import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalHorizonView, groundHeightOffer, horizonStatusText, profileChartRange } from '../LocalHorizonPanel';
import { ATTRIBUTION_LINKS } from '@/lib/horizon/terrain';
import type { HorizonProfile, TerrainStatus } from '@/lib/horizon/types';
import zermatt from '@/lib/__tests__/horizon-zermatt-village.json';

const Z = zermatt as HorizonProfile;
const noop = () => {};
const render = (props: Partial<Parameters<typeof LocalHorizonView>[0]>) => renderToStaticMarkup(createElement(LocalHorizonView, {
  enabled: true, onEnabled: noop, status: { state: 'idle' }, profile: null, onRecompute: noop, ...props,
}));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('LocalHorizonView', () => {
  it('shows the plain summary, the skyline chart, Recompute and the credits when ready', () => {
    const html = render({ status: { state: 'ready', profile: Z }, profile: Z });
    const t = text(html);
    expect(t).toContain('Mountains block up to 33° to the northwest (1.2 km away)');
    expect(html).toContain('class="local-horizon-chart"');
    expect(html).toMatch(/<path class="local-horizon-ground" d="M8,[\d.]+L/);
    for (const l of ['N', 'E', 'S', 'W']) expect(html).toContain(`>${l}</text>`);
    expect(t).toContain('Recompute');
    expect(t).not.toContain('Retry');
    expect(t).toContain('elevation data © Mapterhorn');
    for (const link of ATTRIBUTION_LINKS) expect(html).toContain(`href="${link.url}"`);
    expect(html).toMatch(/type="checkbox" role="switch" checked=""/);
  });

  it('shows progress while computing, a Retry on errors and an offline note, all without a chart', () => {
    const computing = render({ status: { state: 'computing', progress: 0.42 } });
    expect(text(computing)).toContain('Measuring the hills and mountains around this site… 42%');
    expect(computing).toContain('<progress');
    expect(computing).not.toContain('local-horizon-chart');
    const error = render({ status: { state: 'error', message: 'HTTP 503 for tile 14/1/2' } });
    expect(text(error)).toContain('Could not load the terrain map, so a flat horizon is used for now.');
    expect(text(error)).toContain('Retry');
    expect(text(error)).not.toContain('HTTP 503 for tile'); // jargon only in the tooltip
    expect(error).toContain('title="HTTP 503 for tile 14/1/2"');
    expect(text(render({ status: { state: 'offline' } }))).toContain('Offline: a flat horizon is used');
  });

  it('keeps the old profile visible during a forced recompute', () => {
    const html = render({ status: { state: 'computing', progress: 0.1 }, profile: Z });
    expect(html).toContain('local-horizon-chart');
    expect(text(html)).toContain('Mountains block up to');
  });

  it('when off: only the switch and a flat-horizon note, no chart, buttons or credits', () => {
    const html = render({ enabled: false, status: { state: 'idle' }, profile: Z });
    expect(text(html)).toContain('Off: the app assumes a flat horizon everywhere.');
    expect(html).not.toMatch(/checked=""/);
    expect(html).not.toContain('local-horizon-chart');
    expect(html).not.toContain('Mapterhorn');
    expect(text(html)).not.toContain('Recompute');
  });

  it('offers the terrain map ground height only when the user has not typed an elevation', () => {
    const elevation = (metres: number, source: 'manual' | 'forecast' | 'unknown') => ({ metres, source, onChange: noop });
    expect(groundHeightOffer(Z, elevation(0, 'unknown'))).toBe(1603);
    expect(groundHeightOffer(Z, elevation(1540, 'forecast'))).toBe(1603);
    expect(groundHeightOffer(Z, elevation(1595, 'forecast'))).toBeNull();
    expect(groundHeightOffer(Z, elevation(1540, 'manual'))).toBeNull();
    expect(groundHeightOffer({ ...Z, groundM: undefined }, elevation(0, 'unknown'))).toBeNull();
    expect(groundHeightOffer(Z, undefined)).toBeNull();
    const html = render({ status: { state: 'ready', profile: Z }, profile: Z, elevation: elevation(0, 'unknown') });
    expect(text(html)).toContain('Use ground height from the terrain map (1,603 m)');
  });
});

describe('profile chart helpers', () => {
  it('scales to at least 0–10° in 5° steps and extends below 0 for a summit', () => {
    expect(profileChartRange([0.2, 1, 3])).toEqual({ lo: 0, hi: 10 });
    expect(profileChartRange(Z.alt)).toEqual({ lo: 0, hi: 35 });
    expect(profileChartRange([-2.4, -1, 0.5])).toEqual({ lo: -3, hi: 10 });
  });
  it('status text falls back to the summary for an idle stored profile', () => {
    const s: TerrainStatus = { state: 'idle' };
    expect(horizonStatusText(true, s, null)).toBe('Checking the terrain around this site…');
    expect(horizonStatusText(true, s, Z)).toMatch(/^Mountains block up to/);
  });
});
