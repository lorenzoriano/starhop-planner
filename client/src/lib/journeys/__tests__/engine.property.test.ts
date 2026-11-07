/**
 * Core guarantee (doc 05 §12.1): every stop of every returned journey satisfies every hard constraint,
 * re-checked independently with the app's astronomy functions at the displayed stop windows, across sites,
 * dates, Moon phases, times and request options.
 */
import * as Astro from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { moonState } from '../../moon';
import { generate } from '../assemble';
import { mulberry32 } from '../seed';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { BINOS_10X50, independentProblems, request, resultProblems, syntheticKb } from './engine-helpers';
import type { Compass8, JourneyRequest } from '../types';

const SITES = [
  { name: 'San Francisco', lat: 37.77, lon: -122.42 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
  { name: 'Quito', lat: -0.18, lon: -78.47 },
  { name: 'Oslo', lat: 59.91, lon: 10.75 },
];
/** UTC instant for a local-mean-time clock reading on a date. */
const lmt = (date: string, hours: number, lon: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hours - lon / 15) * 3_600_000).toISOString();
const dates = (from: string, n: number, stepDays: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * stepDays * 86_400_000).toISOString().slice(0, 10));

describe('journey hard constraints (independent re-check)', () => {
  it('fixture KB: 4 sites × 24 dates × 2 times', () => {
    let journeys = 0, withMoon = 0, runs = 0, empty = 0;
    const problems: string[] = [];
    for (const site of SITES) {
      for (const date of dates('2026-11-15', 24, 5)) {
        for (const hour of [21, 25.5]) {
          const req = request(lmt(date, hour, site.lon), { lat: site.lat, lon: site.lon, timezone: undefined });
          const res = generate(FIXTURE_KB, req);
          runs++;
          if (!res.journeys.length) { empty++; expect(res.diagnostics.message.length).toBeGreaterThan(10); }
          const moon = moonState(req.lat, req.lon, new Date(req.instant));
          for (const j of res.journeys) {
            journeys++;
            if (moon.alt > 0 && moon.illumination > 0.3) withMoon++;
            for (const p of independentProblems(FIXTURE_KB, req, res, j)) problems.push(`${site.name} ${req.instant} ${j.key}: ${p}`);
          }
          expect(res.diagnostics.relaxed ?? []).not.toContain('moon');
        }
      }
    }
    console.log(`[property/fixture] runs=${runs} journeys=${journeys} withMoonUp=${withMoon} emptyRuns=${empty}`);
    expect(problems).toEqual([]);
    expect(journeys).toBeGreaterThan(40);
  }, 60_000);

  it('fixture KB: request options (minAlt 20, first-night, open sky, long journeys, 7×50)', () => {
    const problems: string[] = [];
    let journeys = 0;
    const variants: Partial<JourneyRequest>[] = [
      { minAlt: 20 },
      { level: 'first-night' },
      { openDirections: ['S', 'SE', 'SW'] as Compass8[] },
      { openDirections: ['N'] as Compass8[] },
      { length: 3 },
      { length: 7, regionRadius: 40 },
      { instrument: { fovDeg: 7.1, aperture: 50, magnification: 7 }, skyBrightness: 19.5 },
      { instrument: { fovDeg: 3.7, aperture: 50, magnification: 14, stabilized: true }, minutesPerStop: 12 },
      { includeChallenge: false },
    ];
    for (const date of dates('2026-12-01', 12, 9)) {
      for (const v of variants) {
        const req = request(lmt(date, 22, SITES[0].lon), v);
        const res = generate(FIXTURE_KB, req);
        for (const j of res.journeys) {
          journeys++;
          for (const p of independentProblems(FIXTURE_KB, req, res, j)) problems.push(`${JSON.stringify(v)} ${req.instant} ${j.key}: ${p}`);
          if (v.level === 'first-night' && !(res.diagnostics.relaxed ?? []).some((r) => r.includes('challenge'))) expect(j.stops.some((s) => s.challenge)).toBe(false);
          if (v.includeChallenge === false && !(res.diagnostics.relaxed ?? []).some((r) => r.includes('challenge'))) expect(j.stops.some((s) => s.challenge)).toBe(false);
          if (v.length === 3 && !(res.diagnostics.relaxed ?? []).length) expect(j.stops.length).toBe(3);
        }
      }
    }
    console.log(`[property/options] journeys=${journeys}`);
    expect(problems).toEqual([]);
    expect(journeys).toBeGreaterThan(10);
  }, 60_000);

  it('synthetic sky-wide KB (360 objects): seeded random conditions incl. bright Moon', () => {
    const kb = syntheticKb(24);
    const rng = mulberry32(20261101);
    const problems: string[] = [];
    let journeys = 0, moonUp = 0;
    for (let n = 0; n < 48; n++) {
      const site = SITES[Math.floor(rng() * SITES.length)];
      const day = Math.floor(rng() * 365);
      const date = new Date(Date.parse('2026-11-01T00:00:00Z') + day * 86_400_000).toISOString().slice(0, 10);
      const req = request(lmt(date, 20 + rng() * 8, site.lon), {
        lat: site.lat, lon: site.lon, timezone: undefined,
        instrument: rng() < 0.5 ? BINOS_10X50 : { fovDeg: 3.7, aperture: 50, magnification: 14, stabilized: true },
        skyBrightness: [18.5, 20, 21.3][Math.floor(rng() * 3)],
        length: 3 + Math.floor(rng() * 5),
      });
      const res = generate(kb, req);
      const moon = moonState(req.lat, req.lon, new Date(req.instant));
      for (const p of resultProblems(res)) problems.push(`${site.name} ${req.instant}: ${p}`);
      for (const j of res.journeys) {
        journeys++;
        if (moon.alt > 0 && moon.illumination > 0.5) moonUp++;
        for (const p of independentProblems(kb, req, res, j)) problems.push(`${site.name} ${req.instant} ${j.key}: ${p}`);
      }
    }
    console.log(`[property/synthetic] journeys=${journeys} underBrightMoon=${moonUp}`);
    expect(problems).toEqual([]);
    // The rotated fixture copies tell the same two stories over and over; near-identical suggestions are no longer
    // shown together (owner feedback round 1), so fewer journeys per request than the 3 asked for are normal here.
    expect(journeys).toBeGreaterThan(15);
  }, 60_000);

  it('near full Moon: Moon up and bright at every request, every stop still Moon-safe', () => {
    const kb = syntheticKb(24, 15, { moonFriendlyTemplate: true });
    const problems: string[] = [];
    let runs = 0, journeys = 0;
    let from = new Date('2026-11-01T00:00:00Z');
    for (let m = 0; m < 6; m++) {
      const full = Astro.SearchMoonPhase(180, from, 40)!.date;
      from = new Date(full.getTime() + 5 * 86_400_000);
      for (const site of SITES.slice(0, 3)) {
        for (const dd of [-3, -1, 0, 2]) {
          for (let h = 18; h <= 30; h += 1.5) {
            const date = new Date(full.getTime() + dd * 86_400_000).toISOString().slice(0, 10);
            const req = request(lmt(date, h, site.lon), { lat: site.lat, lon: site.lon, timezone: undefined });
            const moon = moonState(req.lat, req.lon, new Date(req.instant));
            if (moon.alt < 10 || moon.illumination < 0.75 || moon.sunAlt > -12) continue;
            runs++;
            const res = generate(kb, req);
            for (const j of res.journeys) {
              journeys++;
              for (const p of independentProblems(kb, req, res, j)) problems.push(`${site.name} ${req.instant} ${j.key}: ${p}`);
            }
            if (runs >= 60) break;
          }
        }
      }
    }
    console.log(`[property/bright-moon] runs=${runs} journeys=${journeys}`);
    expect(runs).toBeGreaterThan(30);
    expect(problems).toEqual([]);
    expect(journeys).toBeGreaterThan(10);
  }, 60_000);
});
