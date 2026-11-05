/**
 * nightEvents now reads the shared sky model (visibilityWindow dark segments + moonDay) instead of its own
 * astronomy-engine searches. It must give the same events as the old implementation, within a minute.
 */
import * as Astro from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { nightEvents, type NightEvents } from "../conditions-explainer";

/** The pre-r5 implementation, kept verbatim as the reference. */
function legacyNightEvents(lat: number, lon: number, date: Date): NightEvents {
  const observer = new Astro.Observer(lat, lon, 0);
  const find = (fn: () => Astro.AstroTime | null) => { try { return fn()?.date ?? null; } catch { return null; } };
  const astroDusk = find(() => Astro.SearchAltitude(Astro.Body.Sun, observer, -1, date, 1.5, -18));
  const astroDawn = find(() => Astro.SearchAltitude(Astro.Body.Sun, observer, 1, date, 1.5, -18));
  const moonset = find(() => Astro.SearchRiseSet(Astro.Body.Moon, observer, -1, date, 1.5));
  const moonrise = find(() => Astro.SearchRiseSet(Astro.Body.Moon, observer, 1, date, 1.5));
  const later = find(() => Astro.SearchAltitude(Astro.Body.Sun, observer, 1, date, 0.5, 0));
  const noonish = find(() => Astro.SearchHourAngle(Astro.Body.Sun, observer, 0, date).time);
  const sunRising = !!later && !!noonish && later.getTime() < noonish.getTime();
  return { astroDusk, astroDawn, moonset, moonrise, sunRising };
}

const SITES: [string, number, number, string][] = [
  ["San Francisco", 37.77, -122.42, "America/Los_Angeles"],
  ["London", 51.5, -0.1, "Europe/London"],
  ["Sydney", -33.9, 151.2, "Australia/Sydney"],
  ["Tromsø (no astronomical night in summer)", 69.65, 18.96, "Europe/Oslo"],
];
const START = Date.parse("2026-11-03T00:00:00Z");
const INSTANTS = Array.from({ length: 16 }, (_, i) => new Date(START + i * 5.25 * 3_600_000));
const SUMMER = Array.from({ length: 6 }, (_, i) => new Date(Date.parse("2027-06-20T00:00:00Z") + i * 4 * 3_600_000));

const close = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : Math.abs(a.getTime() - b.getTime()) <= 60_000);

describe("nightEvents on the shared sky model", () => {
  for (const [label, lat, lon, tz] of SITES) {
    it(`${label}: same dusk, dawn, moonrise, moonset and morning flag as before (±1 min)`, () => {
      for (const at of [...INSTANTS, ...SUMMER]) {
        const now = nightEvents(lat, lon, at, tz), old = legacyNightEvents(lat, lon, at);
        const msg = `${label} at ${at.toISOString()}: ${JSON.stringify({ now, old })}`;
        expect(close(now.astroDusk, old.astroDusk), msg).toBe(true);
        expect(close(now.astroDawn, old.astroDawn), msg).toBe(true);
        expect(close(now.moonrise, old.moonrise), msg).toBe(true);
        expect(close(now.moonset, old.moonset), msg).toBe(true);
        expect(now.sunRising, msg).toBe(old.sunRising);
      }
    });
  }

  it("defaults the time zone from the site", () => {
    const at = new Date("2026-11-04T04:30:00Z");
    expect(nightEvents(37.77, -122.42, at)).toEqual(nightEvents(37.77, -122.42, at, "America/Los_Angeles"));
  });
});
