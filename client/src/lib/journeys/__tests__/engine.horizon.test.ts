/**
 * Local horizon in the journeys engine (docs/local-horizon-design.md, MAP E): a stop must clear max(minAlt, skyline(az))
 * for its whole visit, behind the skyline is its own reject reason ('terrain'), and without a skyline that can bind the
 * engine is exactly what it was (the golden fixture stays unchanged).
 */
import { describe, expect, it } from 'vitest';
import { eqToHorizontal } from '../../astronomy';
import { horizonFingerprint, horizonLookup, type CompactHorizon } from '../../horizon/profile';
import { generate, rebuildJourney } from '../assemble';
import { buildCandidateTable, prepareKb } from '../candidates';
import { fastAltAz, hourAngle, minutesAboveAlt, minutesClear, normalizeRequest, ofDateConverter } from '../conditions';
import { journeyRequestCacheKey } from '../journey-host';
import type { JourneyRequest, JourneyResult } from '../types';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { request } from './engine-helpers';

const DARK = '2027-01-09T05:00:00Z';

/** Synthetic skyline: `high`° between az `from` and `to` (wrapping), `low`° elsewhere (1° bins). */
function wall(from: number, to: number, high: number, low = 0): CompactHorizon {
  const inside = (az: number) => (from <= to ? az >= from && az <= to : az >= from || az <= to);
  return { kind: 'geometric', stepDeg: 1, alt: Array.from({ length: 360 }, (_, az) => (inside(az) ? high : low)) };
}
const flat = (alt: number): CompactHorizon => ({ kind: 'geometric', stepDeg: 1, alt: new Array(360).fill(alt) });

/** Everything observable of a result except timings. */
const digest = (r: JourneyResult) => JSON.parse(JSON.stringify({ ...r, diagnostics: { ...r.diagnostics, ms: undefined } }));

/** Every sample of the displayed stop windows (every 2 minutes) must clear max(minAlt, skyline). */
function stopsBehindSkyline(req: JourneyRequest, r: JourneyResult, minAlt: number): string[] {
  const lookup = horizonLookup(req.horizon)!;
  const out: string[] = [];
  for (const j of r.journeys) {
    const floor = j.conditions?.relaxed?.some((x) => x.startsWith('altitude')) ? Math.min(minAlt, 25) : minAlt;
    for (const st of j.stops) {
      const o = FIXTURE_KB.objects.find((x) => x.id === st.objectId)!;
      for (let t = Date.parse(st.windowStart); t <= Date.parse(st.windowEnd); t += 120_000) {
        const h = eqToHorizontal(o.ra, o.dec, req.lat, req.lon, new Date(t));
        // 0.3°: the engine's of-date fast path vs eqToHorizontal.
        if (h.alt < Math.max(floor, lookup(h.az)) - 0.3) out.push(`${j.key} ${o.id} at ${new Date(t).toISOString()}: ${h.alt.toFixed(1)}° at az ${h.az.toFixed(0)}`);
      }
    }
  }
  return out;
}

describe('journeys with a local horizon', () => {
  it('no skyline, a null skyline, a flat one and one that never rises above minAlt all give the same journeys', () => {
    const base = digest(generate(FIXTURE_KB, request(DARK)));
    expect(base.journeys.length).toBeGreaterThan(0);
    for (const horizon of [null, flat(0), flat(-2), wall(200, 260, 20), wall(0, 359, 29.9)]) {
      expect(digest(generate(FIXTURE_KB, request(DARK, { horizon })))).toEqual(base);
    }
  });

  it('a wall higher than minAlt over the stops of the best journey rejects them as terrain, never as altitude', () => {
    const base = generate(FIXTURE_KB, request(DARK));
    const first = base.journeys[0];
    const az = first.stops[0].azAtStart;
    const horizon = wall(Math.round(az + 330) % 360, Math.round(az + 30) % 360, 70);
    const req = request(DARK, { horizon });
    const r = generate(FIXTURE_KB, req);
    expect(r.diagnostics.reasonsRejected.terrain ?? 0).toBeGreaterThan(0);
    expect(stopsBehindSkyline(req, r, 30)).toEqual([]);
    expect(r.journeys.some((j) => j.key === first.key)).toBe(false);

    // The candidate table says why: behind the hills, while high enough above the flat horizon.
    const s = normalizeRequest(req);
    const table = buildCandidateTable(prepareKb(FIXTURE_KB), s, undefined, 3);
    const idx = table.prep.index.get(first.stops[0].objectId)!;
    const ev = table.stops[idx][0];
    expect(ev.reasons).toContain('terrain');
    if (ev.minAlt >= 30) expect(ev.reasons).not.toContain('altitude');
    // Without the wall the same stop was feasible.
    const flatTable = buildCandidateTable(prepareKb(FIXTURE_KB), normalizeRequest(request(DARK)), undefined, 3);
    expect(flatTable.stops[idx][0].reasons).not.toContain('terrain');
  });

  it('a wall away from the journeys only drops what is behind it', () => {
    const base = generate(FIXTURE_KB, request(DARK));
    const used = new Set(base.journeys.flatMap((j) => j.stops.map((s) => Math.round(s.azAtStart))));
    // A 60° wall over the quarter of the sky farthest from every stop.
    let best = 0, bestGap = -1;
    for (let c = 0; c < 360; c += 5) {
      const gap = Math.min(...Array.from(used, (a) => Math.abs(((a - c + 540) % 360) - 180)));
      if (gap > bestGap) { bestGap = gap; best = c; }
    }
    const req = request(DARK, { horizon: wall((best + 315) % 360, (best + 45) % 360, 60) });
    const r = generate(FIXTURE_KB, req);
    expect(stopsBehindSkyline(req, r, 30)).toEqual([]);
    if (bestGap > 60) expect(r.journeys.map((j) => j.key)).toEqual(base.journeys.map((j) => j.key));
  });

  it('minutesClear is the analytic answer without a binding skyline and follows a uniform skyline above minAlt', () => {
    const o = FIXTURE_KB.objects.find((x) => x.id === 'STAR-Betelgeuse') ?? FIXTURE_KB.objects[0];
    const s0 = normalizeRequest(request(DARK));
    const p = ofDateConverter(s0.slotMs).raDec(o.ra, o.dec);
    const gast = 100; // any sidereal angle works: the loop below covers a whole turn
    for (let g = gast; g < gast + 360; g += 30) {
      const analytic = minutesAboveAlt(p.dec, s0.lat, hourAngle(p.ra, s0.lon, g), s0.minAlt);
      expect(minutesClear(p.ra, p.dec, s0, g)).toBe(analytic);
      expect(minutesClear(p.ra, p.dec, normalizeRequest(request(DARK, { horizon: flat(25) })), g)).toBe(analytic);
      // A 45° skyline all around behaves like minAlt 45 (linear interpolation over 5-minute steps).
      const high = minutesClear(p.ra, p.dec, normalizeRequest(request(DARK, { horizon: flat(45) })), g);
      const at45 = minutesAboveAlt(p.dec, s0.lat, hourAngle(p.ra, s0.lon, g), 45);
      expect(Math.abs(high - at45)).toBeLessThan(0.6);
      expect(high).toBeLessThanOrEqual(analytic);
    }
    // Hidden now → 0.
    const now = fastAltAz(p.ra, p.dec, s0.lat, s0.lon, gast);
    if (now.alt > 30) expect(minutesClear(p.ra, p.dec, normalizeRequest(request(DARK, { horizon: flat(now.alt + 5) })), gast)).toBe(0);
  });

  it('the candidate table reports minutes clear of the skyline', () => {
    const s = normalizeRequest(request(DARK, { horizon: flat(45) }));
    const table = buildCandidateTable(prepareKb(FIXTURE_KB), s, undefined, 3);
    const flatTable = buildCandidateTable(prepareKb(FIXTURE_KB), normalizeRequest(request(DARK)), undefined, 3);
    table.candidates.forEach((c, i) => expect(c.minutesAboveMinAlt).toBeLessThanOrEqual(flatTable.candidates[i].minutesAboveMinAlt));
    expect(table.candidates.some((c, i) => c.minutesAboveMinAlt < flatTable.candidates[i].minutesAboveMinAlt)).toBe(true);
  });

  it('caches results by the skyline fingerprint; no skyline keeps the old key', () => {
    const req = request(DARK);
    const key = journeyRequestCacheKey(req);
    expect(key).toBe(JSON.stringify(req));
    expect(journeyRequestCacheKey({ ...req, horizon: null })).toBe(key);
    const h = wall(200, 260, 40);
    const withH = journeyRequestCacheKey({ ...req, horizon: h });
    expect(withH).toContain(horizonFingerprint(h));
    expect(withH.length).toBeLessThan(key.length + 40);
    expect(journeyRequestCacheKey({ ...req, horizon: wall(200, 260, 41) })).not.toBe(withH);
  });

  it('a journey key carries no skyline: a rebuild uses the requesting device’s skyline at its own site only', () => {
    const base = generate(FIXTURE_KB, request(DARK));
    const j = base.journeys[0];
    const az = j.stops[0].azAtStart;
    const horizon = wall(Math.round(az + 330) % 360, Math.round(az + 30) % 360, 70);
    expect(rebuildJourney(FIXTURE_KB, j.key, request(DARK)).valid).toBe(true);
    const here = rebuildJourney(FIXTURE_KB, j.key, request(DARK, { horizon }));
    expect(here.valid).toBe(false);
    expect(here.codes).toContain('terrain');
    expect(here.problems.join(' ')).toMatch(/behind the hills/);
    // Opened on a device far away: its skyline describes another site, so the key's site is checked flat.
    const elsewhere = rebuildJourney(FIXTURE_KB, j.key, { ...request(DARK, { horizon }), lat: 48.1, lon: 11.6 });
    expect(elsewhere.valid).toBe(true);
  });
});
