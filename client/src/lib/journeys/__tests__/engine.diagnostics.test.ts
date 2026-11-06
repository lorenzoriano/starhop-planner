/**
 * Empty-sky behaviour and diagnostics (doc 05 §5.8, §12.2; doc 06 §4.3–4.5): bright Moon, twilight, daylight
 * and polar summer give plain-language reasons, never throw, and never relax Moon / twilight / rating-3 rules.
 */
import * as Astro from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { moonState } from '../../moon';
import { generate } from '../assemble';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { independentProblems, request, SF, syntheticKb } from './engine-helpers';

const observer = new Astro.Observer(SF.lat, SF.lon, 0);
const noMoonOrTwilightRelaxation = (relaxed: string[] | undefined) =>
  expect((relaxed ?? []).filter((r) => /moon|twilight|rating/i.test(r))).toEqual([]);

describe('diagnostics', () => {
  it('full Moon near Orion: Moon named as the limit, every surviving stop still Moon-safe', () => {
    const full = Astro.SearchMoonPhase(180, new Date('2027-01-10T00:00:00Z'), 30)!.date;
    // Evening of the full Moon in San Francisco (about 22:00 PST).
    const instant = new Date(Math.floor(full.getTime() / 86_400_000) * 86_400_000 + 6 * 3_600_000).toISOString();
    const moon = moonState(SF.lat, SF.lon, new Date(instant));
    expect(moon.illumination).toBeGreaterThan(0.9);
    expect(moon.alt).toBeGreaterThan(10);
    for (const kb of [FIXTURE_KB, syntheticKb(24)]) {
      const req = request(instant);
      const res = generate(kb, req);
      expect(res.diagnostics.message).toMatch(/Moon is \d+% lit/);
      expect((res.diagnostics.reasonsRejected['moon-separation'] ?? 0) + (res.diagnostics.reasonsRejected['moon-glow'] ?? 0)).toBeGreaterThan(0);
      noMoonOrTwilightRelaxation(res.diagnostics.relaxed);
      if (!res.journeys.length) expect(res.diagnostics.limitingFactors).toContain('moon');
      for (const j of res.journeys) expect(independentProblems(kb, req, res, j)).toEqual([]);
    }
  });

  it('twilight: deep-sky waits for astronomical darkness; message says when', () => {
    const t = Astro.SearchAltitude(Astro.Body.Sun, observer, -1, new Date('2027-01-15T18:00:00Z'), 1, -14)!.date;
    const req = request(t.toISOString());
    for (const kb of [FIXTURE_KB, syntheticKb(24)]) {
      const res = generate(kb, req);
      expect(res.diagnostics.limitingFactors).toContain('twilight');
      expect(res.diagnostics.message).toMatch(/twilight/i);
      expect(res.diagnostics.message).toMatch(/full darkness from \d\d:\d\d/);
      expect(res.diagnostics.reasonsRejected.twilight ?? 0).toBeGreaterThan(0);
      noMoonOrTwilightRelaxation(res.diagnostics.relaxed);
      for (const j of res.journeys) {
        for (const st of j.stops) expect(kb.objects.find((o) => o.id === st.objectId)!.kind).toBe('star');
        expect(independentProblems(kb, req, res, j)).toEqual([]);
      }
    }
  });

  it('daytime: no journeys, a reason and the time darkness starts', () => {
    const res = generate(syntheticKb(24), request('2027-01-15T20:00:00Z')); // noon PST
    expect(res.journeys).toEqual([]);
    expect(res.diagnostics.message).toMatch(/daytime/);
    expect(res.diagnostics.message).toMatch(/open at \d\d:\d\d/);
    expect(res.diagnostics.limitingFactors).toContain('twilight');
  });

  it('polar summer (Oslo, midsummer midnight): no night at all, still no throw', () => {
    const res = generate(syntheticKb(24), request('2027-06-21T22:30:00Z', { lat: 59.91, lon: 10.75, timezone: 'Europe/Oslo' }));
    expect(res.journeys).toEqual([]);
    expect(res.diagnostics.limitingFactors).toContain('twilight');
    expect(res.diagnostics.message.length).toBeGreaterThan(20);
  });

  it('dark sky: counts and scorer reported; relaxations are recorded when used', () => {
    const res = generate(FIXTURE_KB, request('2027-01-09T05:00:00Z'));
    expect(res.diagnostics.candidates).toBeGreaterThan(0);
    expect(res.diagnostics.validated).toBeGreaterThan(0);
    expect(res.diagnostics.scorer).toBe('heuristic');
    expect(res.diagnostics.limitingFactors).toEqual([]);
    // The fixture has too few 5-stop journeys for 3 suggestions, so the length window opened.
    expect(res.diagnostics.relaxed?.[0]).toMatch(/^length/);
    noMoonOrTwilightRelaxation(res.diagnostics.relaxed);
  });

  it('obstructed sky: open-direction filter is explained', () => {
    const res = generate(FIXTURE_KB, request('2027-01-09T05:00:00Z', { openDirections: ['N'] }));
    expect(res.diagnostics.reasonsRejected.direction ?? 0).toBeGreaterThan(0);
    expect(res.diagnostics.message).toMatch(/Only part of the sky is open/);
  });

  it('lists the open directions in compass order, not alphabetically', () => {
    const res = generate(FIXTURE_KB, request('2027-01-09T05:00:00Z', { openDirections: ['W', 'S', 'NE', 'N', 'E'] }));
    expect(res.diagnostics.message).toContain('Only part of the sky is open from here (N, NE, E, S, W).');
  });
});
