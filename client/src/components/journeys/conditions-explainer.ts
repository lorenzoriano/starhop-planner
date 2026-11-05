/**
 * "Why options are limited" (doc 06 §4.3): turns tonight's sky (Sun, Moon) and the engine's diagnostics into
 * plain-language limiter notes, each with at least two fixes. Pure apart from astronomy-engine event searches.
 */
import * as Astro from "astronomy-engine";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import tzLookup from "tz-lookup";
import { moonMinSeparation } from "@/lib/sky-feasibility";
import { moonDay } from "@/lib/moon";
import { nextLocalDate, visibilityWindow } from "@/lib/target-visibility";
import type { Compass8, JourneyResult } from "@/lib/journeys/types";
import { COMPASS_WORDS } from "./journey-view";

export type ConditionActionId = "moon-friendly" | "after-moonset" | "moon-tab" | "twilight-journey" | "jump-dark" | "plan-tonight" | "lower-alt" | "open-sky" | "later" | "tomorrow" | "surprise";
export interface ConditionAction { id: ConditionActionId; label: string; at?: Date }
export type ConditionCode = "day" | "twilight" | "moon" | "altitude" | "region" | "kb";
export interface ConditionNote { code: ConditionCode; title: string; body: string; actions: ConditionAction[] }

export interface NightEvents { astroDusk: Date | null; astroDawn: Date | null; moonset: Date | null; moonrise: Date | null; sunRising: boolean }

const EVENT_HORIZON_MS = 1.5 * 86_400_000;
const firstAfter = (dates: readonly Date[], from: Date) =>
  dates.filter((d) => d.getTime() > from.getTime() && d.getTime() <= from.getTime() + EVENT_HORIZON_MS).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
const previousLocalDate = (date: string) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/**
 * Next astronomical dusk/dawn and Moon rise/set after `date` (within 36 h), from the app's shared sky model:
 * dusk/dawn are the edges of the dark segments of `visibilityWindow` (the observing nights around `date`, as the
 * Clock and Tonight use them), Moon rise/set come from `moonDay` (the Moon tab). `timezone` only picks the local
 * nights to look at; it defaults to the site's zone.
 */
export function nightEvents(lat: number, lon: number, date: Date, timezone: string = tzLookup(lat, lon)): NightEvents {
  const local = formatInTimeZone(date, timezone, "yyyy-MM-dd");
  const dusks: Date[] = [], dawns: Date[] = [];
  for (const day of [previousLocalDate(local), local, nextLocalDate(local)]) {
    const night = visibilityWindow(day, "12:00", "12:00", "night", timezone, lat, lon);
    if (!night.ok) continue;
    // A segment edge at the window's own noon bounds is a cut, not a Sun crossing (polar and partial nights).
    for (const seg of night.segments) {
      if (seg.start.getTime() !== night.start.getTime()) dusks.push(seg.start);
      if (seg.end.getTime() !== night.end.getTime()) dawns.push(seg.end);
    }
  }
  let moonrise: Date | null = null, moonset: Date | null = null;
  try {
    const moon = moonDay(lat, lon, date, timezone);
    moonrise = firstAfter(moon.nextRise ? [moon.nextRise] : [], date);
    moonset = firstAfter(moon.nextSet ? [moon.nextSet] : [], date);
  } catch { /* no Moon event found: leave null */ }
  const observer = new Astro.Observer(lat, lon, 0);
  const find = (fn: () => Astro.AstroTime | null) => { try { return fn()?.date ?? null; } catch { return null; } };
  const later = find(() => Astro.SearchAltitude(Astro.Body.Sun, observer, 1, date, 0.5, 0));
  const noonish = find(() => Astro.SearchHourAngle(Astro.Body.Sun, observer, 0, date).time);
  // Morning when sunrise comes before the next local noon.
  const sunRising = !!later && !!noonish && later.getTime() < noonish.getTime();
  return { astroDusk: firstAfter(dusks, date), astroDawn: firstAfter(dawns, date), moonset, moonrise, sunRising };
}

export interface ConditionsInput {
  date: Date;
  timezone: string;
  sunAlt: number;
  moon: { alt: number; illumination: number; ra: number; dec: number };
  events: NightEvents;
  minAlt: number;
  openDirections: Compass8[];
  theme: string | null;
  result: Pick<JourneyResult, "journeys" | "diagnostics"> | null;
}

const t = (d: Date, tz: string) => formatInTimeZone(d, tz, "HH:mm");
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

/** Constellation of a J2000 position, e.g. "Gemini" (empty when astronomy-engine cannot resolve it). */
function constellationOf(ra: number, dec: number): string {
  try { return Astro.Constellation(ra / 15, dec).name; } catch { return ""; }
}
/** 21:00 local on the next calendar day. */
export function tomorrowEvening(date: Date, timezone: string): Date {
  const local = formatInTimeZone(new Date(date.getTime() + 24 * 3_600_000), timezone, "yyyy-MM-dd");
  return fromZonedTime(`${local}T21:00:00`, timezone);
}

/**
 * True when `at` falls in tonight's full darkness, judged from the current Sun altitude and the night's events: a
 * "Try 14:00" suggestion during the day would only point at more daylight.
 */
export function isDarkAt(at: Date, input: Pick<ConditionsInput, "sunAlt" | "events">): boolean {
  const { sunAlt, events } = input;
  if (sunAlt <= -18) return !events.astroDawn || at.getTime() < events.astroDawn.getTime();
  if (events.sunRising || !events.astroDusk) return false;
  return at.getTime() >= events.astroDusk.getTime() && (!events.astroDawn || events.astroDawn.getTime() < events.astroDusk.getTime() || at.getTime() < events.astroDawn.getTime());
}

export function conditionNotes(input: ConditionsInput): ConditionNote[] {
  const { date, timezone: tz, sunAlt, moon, events, minAlt, openDirections, result } = input;
  const notes: ConditionNote[] = [];
  const factors = new Set(result?.diagnostics.limitingFactors ?? []);
  const count = result?.journeys.length ?? null;
  const daylight = sunAlt >= -0.833;
  // "Try in two hours" only when those two hours land in the dark; otherwise tonight's first dark hour.
  const later2h = plus(date, 120);
  const tryLater: ConditionAction[] = isDarkAt(later2h, input)
    ? [{ id: "later", label: `Try ${t(later2h, tz)}`, at: later2h }]
    : events.astroDusk && !events.sunRising && events.astroDusk.getTime() > date.getTime() ? [{ id: "plan-tonight", label: `Plan tonight (dark at ${t(events.astroDusk, tz)})`, at: events.astroDusk }] : [];

  if (sunAlt >= -0.833) {
    const dusk = events.astroDusk;
    notes.push({ code: "day", title: "It's daytime here", body: dusk ? `Journeys need a dark sky. It is fully dark from ${t(dusk, tz)}; plan for then and the stops will match tonight's sky.` : "Journeys need a dark sky, and the Sun does not set far enough below the horizon here tonight.",
      actions: dusk ? [{ id: "plan-tonight", label: `Plan tonight (dark at ${t(dusk, tz)})`, at: dusk }, { id: "later", label: `Plan for ${t(plus(dusk, 120), tz)}`, at: plus(dusk, 120) }] : [{ id: "twilight-journey", label: "Bright-star journeys" }, { id: "tomorrow", label: "Tomorrow 21:00", at: tomorrowEvening(date, tz) }] });
  } else if (sunAlt > -18) {
    const dark = events.sunRising ? null : events.astroDusk;
    const nextDark = dark ?? events.astroDusk;
    notes.push({ code: "twilight", title: events.sunRising ? "Dawn is brightening the sky" : "Twilight: the sky is still fading",
      body: events.sunRising
        ? "Only bright stars and doubles still show well, so faint clusters and nebulae are left out until tonight."
        : `${dark ? `Until ${t(dark, tz)}` : "For now"}, only bright stars and doubles show well. Faint clusters and nebulae join the journeys ${dark ? `at ${t(dark, tz)}` : "once it is fully dark"}.`,
      actions: [{ id: "twilight-journey", label: "Start a bright-star journey" }, ...(nextDark ? [{ id: events.sunRising ? "plan-tonight" as const : "jump-dark" as const, label: events.sunRising ? `Plan tonight (dark at ${t(nextDark, tz)})` : `Jump to ${t(nextDark, tz)}`, at: nextDark }] : [{ id: "tomorrow" as const, label: "Tomorrow 21:00", at: tomorrowEvening(date, tz) }])] });
  }

  const moonUp = moon.alt > 0;
  if (moonUp && (moon.illumination >= 0.6 || factors.has("moon"))) {
    const pct = Math.round(moon.illumination * 100);
    const con = constellationOf(moon.ra, moon.dec);
    const sep = Math.round(moonMinSeparation(moon.illumination));
    const set = events.moonset && (!events.astroDawn || events.moonset < events.astroDawn) ? events.moonset : null;
    notes.push({ code: "moon", title: `Bright Moon (${pct}% lit)${set ? ` until ${t(set, tz)}` : ""}`,
      body: `The Moon is ${pct}% lit${con ? ` in ${con}` : ""}. Its glow washes out faint nebulae and galaxies, so every stop stays at least ${sep}° from it and journeys favour stars, doubles and bright clusters.`,
      actions: [{ id: "moon-friendly", label: "Show moonlight-proof journeys" }, ...(set ? [{ id: "after-moonset" as const, label: `After moonset (${t(set, tz)})`, at: plus(set, 10) }] : []), { id: "moon-tab", label: "Explore the Moon itself" }] });
  }

  // When daylight is the blocker, the altitude limit is not the reason and its note would only add noise.
  if (!daylight && (factors.has("altitude") || (count === 0 && sunAlt < -18 && !notes.length))) {
    notes.push({ code: "altitude", title: `Objects must be ${minAlt}° up or more`,
      body: `Near the horizon the air is thicker and murkier, so every stop must stay at least ${minAlt}° high for its whole visit. Right now too few candidates clear that height.`,
      actions: [...(minAlt > 20 ? [{ id: "lower-alt" as const, label: "Lower the limit to 20°" }] : []), ...tryLater, ...(minAlt <= 20 || !tryLater.length ? [{ id: "tomorrow" as const, label: "Tomorrow 21:00", at: tomorrowEvening(date, tz) }] : [])] });
  }

  if (openDirections.length < 8 && (factors.has("region") || count === 0 || (count !== null && count < 3))) {
    const words = openDirections.map((d) => COMPASS_WORDS[d]);
    const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0] ?? "no direction";
    notes.push({ code: "region", title: "Part of your sky is blocked",
      body: `You marked only the ${list} as open, so ${count === null ? "fewer" : count === 0 ? "no" : `only ${count}`} journey${count === 1 ? "" : "s"} fit${count === 1 ? "s" : ""}.`,
      actions: [{ id: "open-sky", label: "Open all directions" }, ...(minAlt > 20 ? [{ id: "lower-alt" as const, label: "Lower the limit to 20°" }] : tryLater.length ? tryLater : [{ id: "tomorrow" as const, label: "Tomorrow 21:00", at: tomorrowEvening(date, tz) }])] });
  }

  if (factors.has("kb") && count !== null && count < 3) {
    notes.push({ code: "kb", title: "Few stories fit this patch of sky",
      body: "The objects up right now don't link into enough complete stories for this theme.",
      actions: [{ id: "surprise", label: "Any theme" }, ...(tryLater.length ? tryLater : [{ id: "tomorrow" as const, label: "Tomorrow 21:00", at: tomorrowEvening(date, tz) }])] });
  }
  return notes;
}

/** Empty state (doc 06 §4.5): at most 3 binding constraints and at least 2 actions, never a bare empty list. */
export function emptyState(notes: ConditionNote[], input: Pick<ConditionsInput, "date" | "timezone" | "theme" | "result">): { reasons: string[]; actions: ConditionAction[] } {
  const reasons = notes.slice(0, 3).map((n) => n.title);
  const message = input.result?.diagnostics.message;
  if (message && !reasons.length) reasons.push(message);
  if (!reasons.length) reasons.push("No story fits this sky and these settings.");
  const actions: ConditionAction[] = [];
  const seen = new Set<string>();
  for (const a of notes.flatMap((n) => n.actions)) if (!seen.has(a.id)) { seen.add(a.id); actions.push(a); }
  if (input.theme && !seen.has("surprise")) actions.push({ id: "surprise", label: "Any theme" });
  if (!seen.has("tomorrow")) actions.push({ id: "tomorrow", label: "Tomorrow 21:00", at: tomorrowEvening(input.date, input.timezone) });
  if (actions.length < 2) actions.push({ id: "later", label: `Try ${t(plus(input.date, 120), input.timezone)}`, at: plus(input.date, 120) });
  return { reasons, actions: actions.slice(0, 4) };
}

/** Moon keep-out radius for the overview ring, or null when the Moon is down. */
export const moonKeepOut = (moon: { alt: number; illumination: number; ra: number; dec: number }) => moon.alt > 0 ? { ra: moon.ra, dec: moon.dec, radiusDeg: moonMinSeparation(moon.illumination) } : null;
