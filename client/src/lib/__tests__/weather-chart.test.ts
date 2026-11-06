import { describe, it, expect } from 'vitest';
import { skyShade, twilightStops, TWILIGHT_MAX, spansAbove, moonSpans, daylightSpans, moonAtTime, modelRange, hourAt, sampleTimes, rainPeaks, type SkySample } from '../weather-chart';
import { WEATHER_HOUR, type WeatherHour } from '../weather';
import type { ForecastModels } from '../forecast-models';

const H = WEATHER_HOUR, t0 = Date.parse('2026-11-05T20:00:00Z');
const sample = (i: number, sunAlt: number, moonAlt: number, illumination = .1): SkySample => ({ time: t0 + i * H, sunAlt, moonAlt, illumination });
const hour = (i: number, cloud: number | null, rainChance: number | null = 0): WeatherHour => ({ time: t0 + i * H, cloud, low: null, mid: null, high: null, temp: null, dew: null, humidity: null, rainChance, rain: null, wind: null, gust: null, visibility: null });

describe('weather chart data shaping', () => {
  it('shades the sky from daylight through twilight to astronomical darkness', () => {
    expect(skyShade(10)).toBe(0);
    expect(skyShade(0)).toBe(0);
    expect(skyShade(-9)).toBeCloseTo(.5);
    expect(skyShade(-18)).toBe(1);
    expect(skyShade(-40)).toBe(1);
  });

  it('builds a twilight ramp capped below darkness and collapses flat runs', () => {
    const sun = [20, 10, 0, -6, -12, -18, -30, -30, -30, -18, -6, 5];
    const stops = twilightStops(sun.map((alt, i) => ({ time: t0 + i * H, sunAlt: alt })), t0, t0 + 11 * H);
    expect(stops[0]).toEqual({ offset: 0, shade: 0 });
    expect(stops.at(-1)!.offset).toBe(1);
    expect(Math.max(...stops.map(s => s.shade))).toBe(TWILIGHT_MAX);
    // offsets never go backwards, and the flat night run keeps only its ends
    stops.forEach((s, i) => { if (i) expect(s.offset).toBeGreaterThanOrEqual(stops[i - 1].offset); });
    expect(stops.filter(s => s.shade === TWILIGHT_MAX).length).toBe(2);
    expect(stops.length).toBeLessThan(sun.length);
  });

  it('finds spans above zero with interpolated crossings and real rise/set flags', () => {
    const values = [-1, 1, 3, 1, -1, -3];
    const spans = spansAbove(values.map((v, i) => ({ time: t0 + i * H, v })), s => s.v);
    expect(spans).toEqual([{ start: t0 + .5 * H, end: t0 + 3.5 * H, rises: true, sets: true }]);
    // already up at the chart's left edge: not a rise; still up at the right edge: not a set
    const edge = spansAbove([2, 1, -1, 2].map((v, i) => ({ time: t0 + i * H, v })), s => s.v);
    expect(edge.map(s => [s.rises, s.sets])).toEqual([[false, true], [true, false]]);
    expect(edge[0].start).toBe(t0);
    expect(edge[1].end).toBe(t0 + 3 * H);
  });

  it('reports Moon spans with their illumination and daylight spans from the Sun', () => {
    const sky = [sample(0, 5, -10, .1), sample(1, -20, -2, .1), sample(2, -25, 2, .12), sample(3, -20, 8, .13), sample(4, 4, 12, .14)];
    const moon = moonSpans(sky);
    expect(moon).toHaveLength(1);
    expect(moon[0].rises).toBe(true);
    expect(moon[0].sets).toBe(false);
    expect(moon[0].start).toBeCloseTo(t0 + 1.5 * H);
    expect(moon[0].illumination).toBeCloseTo(.14);
    expect(moon[0].peakAlt).toBe(12);
    expect(daylightSpans(sky).map(s => [s.rises, s.sets])).toEqual([[false, true], [true, false]]);
    expect(moonAtTime(sky, t0 + 2.5 * H).moonAlt).toBe(2);
    expect(moonAtTime(sky, t0 - H)).toBe(sky[0]);
  });

  it('returns the ECMWF↔GFS range only when both models cover the hour', () => {
    const models: ForecastModels = { version: 1, key: 'k', lat: 0, lon: 0, fetchedAt: t0, hours: [
      { time: t0, ecmwf: 20, gfs: 70, ecmwfJet: null, gfsJet: null },
      { time: t0 + H, ecmwf: 30, gfs: null, ecmwfJet: null, gfsJet: null },
    ] };
    expect(modelRange(models, t0 + 10 * 60_000)).toEqual({ min: 20, max: 70, spread: 50, ecmwf: 20, gfs: 70 });
    expect(modelRange(models, t0 + H)).toBeNull();
    expect(modelRange(models, t0 + 2 * H)).toBeNull();
    expect(modelRange(undefined, t0)).toBeNull();
  });

  it('maps a pointer ratio to an hour column, clamped to the ends', () => {
    const hours = [0, 1, 2, 3].map(i => hour(i, 10));
    expect(hourAt(hours, 0)).toBe(hours[0]);
    expect(hourAt(hours, .26)).toBe(hours[1]);
    expect(hourAt(hours, .99)).toBe(hours[3]);
    expect(hourAt(hours, 1.5)).toBe(hours[3]);
    expect(hourAt(hours, -1)).toBe(hours[0]);
    expect(hourAt(hours, NaN)).toBe(hours[0]);
  });

  it('samples both ends of the range and labels local rain peaks above a threshold', () => {
    const times = sampleTimes(t0, t0 + H, 20 * 60_000);
    expect(times).toEqual([t0, t0 + 20 * 60_000, t0 + 40 * 60_000, t0 + H]);
    const chances = [10, 40, 65, 65, 30, null, 20, 35, 25, 50];
    const hours = chances.map((c, i) => hour(i, 50, c));
    // plateau keeps its first hour; unknowns never peak; a rise to the last hour counts
    expect(rainPeaks(hours).map(h => h.rainChance)).toEqual([65, 35, 50]);
    expect(rainPeaks(hours, 60).map(h => h.time)).toEqual([t0 + 2 * H]);
    expect(rainPeaks([hour(0, null, null)])).toEqual([]);
  });
});
