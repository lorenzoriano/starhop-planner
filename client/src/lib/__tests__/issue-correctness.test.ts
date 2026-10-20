import { describe, expect, it } from "vitest";
import * as Astro from "astronomy-engine";
import { eqToHorizontal } from "../astronomy";
import { moonDay } from "../moon";
import { targetDayEvents } from "../target-visibility";
import {
  observingWeather,
  parseWeather,
  WEATHER_HOUR,
  WEATHER_VARIABLES,
} from "../weather";

const sanFrancisco = { lat: 37.77, lon: -122.42, zone: "America/Los_Angeles" };

describe("issue regressions: date-correct astronomy", () => {
  it("matches fixed J2000 catalog coordinates transformed to date before the horizon calculation", () => {
    const ra = 10.6847083; // M31 catalog position in degrees, J2000
    const dec = 41.26875;
    const date = new Date("2045-10-20T04:17:00Z");
    const j2000 = Astro.VectorFromSphere(new Astro.Spherical(dec, ra, 1), date);
    const ofDate = Astro.EquatorFromVector(
      Astro.RotateVector(Astro.Rotation_EQJ_EQD(date), j2000),
    );
    const expected = Astro.Horizon(
      date,
      new Astro.Observer(sanFrancisco.lat, sanFrancisco.lon, 0),
      ofDate.ra,
      ofDate.dec,
    );
    const actual = eqToHorizontal(ra, dec, sanFrancisco.lat, sanFrancisco.lon, date);

    expect(actual.alt).toBeCloseTo(expected.altitude, 8);
    expect(actual.az).toBeCloseTo(expected.azimuth, 8);
  });

  it("assigns predawn weather to the observing night that began at the previous local noon", () => {
    const selected = new Date("2026-10-19T04:30:00Z"); // 9:30 pm PDT on Oct 18
    const firstHour = Date.parse("2026-10-18T00:00:00Z");
    const count = 72;
    const units: Record<string, string> = {
      cloud: "%", low: "%", mid: "%", high: "%", temp: "°C", dew: "°C",
      humidity: "%", rainChance: "%", rain: "mm", wind: "km/h", gust: "km/h", visibility: "m",
    };
    const values: Record<string, number> = {
      cloud: 10, low: 5, mid: 3, high: 4, temp: 12, dew: 5, humidity: 65,
      rainChance: 5, rain: 0, wind: 8, gust: 12, visibility: 25000,
    };
    const hourly: Record<string, (number | null)[]> = {
      time: Array.from({ length: count }, (_, i) => (firstHour + i * WEATHER_HOUR) / 1000),
    };
    for (const [key, variable] of Object.entries(WEATHER_VARIABLES)) {
      hourly[variable] = Array(count).fill(values[key]);
    }
    const raw = {
      hourly,
      hourly_units: Object.fromEntries(
        Object.entries(WEATHER_VARIABLES).map(([key, variable]) => [variable, units[key]]),
      ),
    };
    const forecast = parseWeather(raw, sanFrancisco.lat, sanFrancisco.lon, +selected);
    const result = observingWeather(forecast, selected, sanFrancisco.zone, +selected);

    expect(result.night.ok).toBe(true);
    if (!result.night.ok) return;
    expect(result.night.start.toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(result.night.end.toISOString()).toBe("2026-10-19T19:00:00.000Z");
    expect(result.hours.some((hour) => hour.time <= +selected && +selected < hour.time + WEATHER_HOUR)).toBe(true);
    expect(result.best).not.toBeNull();
    expect(result.best!.start).toBeGreaterThanOrEqual(+selected);
  });

  it("keeps Moon dark windows fixed for all selections within the same observing night", () => {
    const evening = new Date("2026-10-19T04:00:00Z"); // Oct 18, 9 pm PDT
    const predawn = new Date("2026-10-19T12:00:00Z"); // Oct 19, 5 am PDT
    const first = moonDay(sanFrancisco.lat, sanFrancisco.lon, evening, sanFrancisco.zone);
    const second = moonDay(sanFrancisco.lat, sanFrancisco.lon, predawn, sanFrancisco.zone);

    expect(first.start.toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(second.start.toISOString()).toBe(first.start.toISOString());
    expect(first.end.toISOString()).toBe(second.end.toISOString());
    expect(first.windows).toEqual(second.windows);
    expect(first.windows.length).toBeGreaterThan(0);
  });

  it("keeps seasonal targets and circumpolar/southern limits correct from San Francisco", () => {
    const targets = [
      { id: "M31", ra: 10.6847, dec: 41.269 },
      { id: "M42", ra: 5.5881 * 15, dec: -5.391 },
      { id: "M13", ra: 16.6949 * 15, dec: 36.461 },
      { id: "Polaris", ra: 2.5303 * 15, dec: 89.264 },
      { id: "Alpha Centauri", ra: 14.6601 * 15, dec: -60.835 },
    ];
    const atLocalMidnight = (date: string) => new Date(`${date}T08:00:00Z`);
    const cases = [
      { id: "M31", date: "2026-10-20" },
      { id: "M42", date: "2027-01-20" },
      { id: "M13", date: "2026-07-20" },
      { id: "Polaris", date: "2026-10-20" },
      { id: "Alpha Centauri", date: "2026-10-20" },
    ];

    for (const { id, date } of cases) {
      const target = targets.find((item) => item.id === id)!;
      const events = targetDayEvents(target.ra, target.dec, sanFrancisco.lat, sanFrancisco.lon, atLocalMidnight(date), sanFrancisco.zone);
      if (id === "Polaris") {
        expect(events.alwaysUp).toBe(true);
        expect(events.rise).toBeNull();
        expect(events.set).toBeNull();
      } else if (id === "Alpha Centauri") {
        expect(events.neverUp).toBe(true);
        expect(events.rise).toBeNull();
        expect(events.set).toBeNull();
      } else {
        expect(events.alwaysUp).toBe(false);
        expect(events.neverUp).toBe(false);
        expect(events.rise).not.toBeNull();
        expect(events.transit).not.toBeNull();
        expect(events.set).not.toBeNull();
      }
    }
  });
});
