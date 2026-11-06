/**
 * Pure presentation helpers for the Journeys screens (no React, no DOM) — unit-tested in __tests__/journey-view.test.ts.
 */
import { formatInTimeZone } from "date-fns-tz";
import { angularDistance, directionBetween, eqToHorizontal } from "@/lib/astronomy";
import { MIN_ALT } from "@/lib/sky-feasibility";
import { blockedDirections8, clearanceDeg, compass8Word, compassWord, horizonFingerprint, type CompactHorizon, type HorizonInput } from "@/lib/horizon/profile";
import type { LocalHorizon } from "@/lib/horizon/types";
import { estimateHops, hopCountLabel, legDifficulty } from "@/lib/hop-chain";
import { nameInSentence } from "@/lib/journeys/plain-language";
import type { LegReport } from "@/lib/object-links";
import type { Compass8, Journey, JourneyRequest, JourneyStop, KbObject, KnowledgeBase, Template, ThemeStoryline } from "@/lib/journeys/types";
import { objectTeff } from "@/lib/journeys/visual-data";

// ───────────────────────────── controls ─────────────────────────────

export interface ThemeOption { id: string | null; label: string; description: string }
/** Short chip labels for the 12 archetypes (doc 04 / templates.json); unknown templates fall back to their title. */
const THEME_LABELS: Record<string, string> = {
  "A1-cradle-to-grave": "Lives of stars", "A2-thermometer": "Star colors", "A3-how-far": "How far?", "A4-time-machine": "Time machine",
  "A5-families": "Star families", "A6-contrasts": "Contrasts", "A7-record-breakers": "Record breakers", "A8-how-stars-die": "Star deaths",
  "A9-seeing-double": "Doubles", "A10-stars-that-change": "Changing stars", "A11-inside-our-galaxy": "Our galaxy", "A12-moonlit": "Moonlight-proof",
};
/**
 * Themes that are no longer journeys (templates.json "retired": true): A4 (time machine) and A10 (stars that change)
 * since owner feedback r2, A7 (record breakers) since r4. Their content stays on cards.
 */
export const RETIRED_THEMES: ReadonlySet<string> = new Set(["A4-time-machine", "A7-record-breakers", "A10-stars-that-change"]);
const isRetired = (id: string) => RETIRED_THEMES.has(id) || /^A(4|7|10)-/.test(id);
export const SURPRISE_THEME: ThemeOption = { id: null, label: "Surprise me", description: "The best story the sky offers right now." };
export function themeOptions(templates: readonly Pick<Template, "id" | "title" | "hookLine">[]): ThemeOption[] {
  const known = Object.keys(THEME_LABELS);
  const ids = (templates.length ? templates.map((t) => t.id) : known).filter((id) => !isRetired(id));
  const sorted = [...ids].sort((a, b) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99));
  return [SURPRISE_THEME, ...sorted.map((id) => {
    const t = templates.find((x) => x.id === id);
    return { id, label: THEME_LABELS[id] ?? t?.title ?? id, description: t?.hookLine ?? "" };
  })];
}
export const themeLabel = (id: string) => THEME_LABELS[id] ?? id;

export type LengthChoice = "short" | "medium" | "long";
export const LENGTHS: Record<LengthChoice, { stops: number; label: string; detail: string }> = {
  short: { stops: 4, label: "Short", detail: "3–4 stops · ~20 min" },
  medium: { stops: 5, label: "Medium", detail: "5–6 stops · ~40 min" },
  long: { stops: 8, label: "Long", detail: "7–10 stops · 60+ min" },
};
export const COMPASS8: Compass8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const COMPASS_WORDS: Record<Compass8, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };
export const compassOf = (az: number): Compass8 => COMPASS8[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Engine seeds use a 15-minute slot, so live mode does not reshuffle every clock tick (spec decision 5). */
export const SLOT_MS = 15 * 60_000;
export const slotInstant = (date: Date) => new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS);

/** One-shot hand-off from the binocular dialog chip to Discovery (sessionStorage: a reload of #/journeys starts clean). */
export const JOURNEY_FOCUS_KEY = "starhop-journey-focus";

// ───────────────────────────── engine request ─────────────────────────────

/**
 * Open-sky defaults from the site's terrain: the compass directions where the hills rise above the lowest stop altitude
 * (`minAlt`) over most of the 45° sector (lib/horizon/profile blockedDirections8) start unticked. `open` is undefined
 * when nothing is blocked, when everything is (the per-azimuth skyline check in the engine then does all the work), or
 * when no terrain is known. The engine also checks every stop against the exact skyline, so this only mirrors it.
 */
export function terrainDirections(horizon: LocalHorizon | null | undefined, minAlt: number): { blocked: Compass8[]; open: Compass8[] | undefined } {
  const blocked = horizon ? blockedDirections8(horizon, minAlt) : [];
  if (!blocked.length || blocked.length >= 8) return { blocked: blocked.length >= 8 ? [] : blocked, open: undefined };
  return { blocked, open: COMPASS8.filter((d) => !blocked.includes(d)) };
}
/** "Hills block the northwest from here." (null when nothing is blocked). Skyline sentences use the app's compass
 *  words (lib/horizon/profile), not the journeys' hyphenated COMPASS_WORDS. */
export function terrainHint(blocked: readonly Compass8[]): string | null {
  if (!blocked.length) return null;
  const words = COMPASS8.filter((d) => blocked.includes(d)).map(compass8Word);
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0];
  return `Hills block the ${list} from here.`;
}

/** Discovery controls remembered on the device (JourneyStore.prefs) with their defaults applied. */
export interface RequestControls { theme: string | null; length: LengthChoice; minAlt: number; includeChallenge: boolean; openDirections: Compass8[] }
/**
 * `horizon` (the site's local horizon) seeds the open directions when the user has not chosen them for this site
 * (terrainDirections); a manual choice in `openSky[site]` always wins.
 */
export function controlsFromPrefs(prefs: { theme?: string | null; length?: LengthChoice; minAlt?: number; includeChallenge?: boolean; openSky?: Record<string, Compass8[]> } | undefined, site: string, horizon?: LocalHorizon | null): RequestControls {
  const p = prefs ?? {};
  const minAlt = p.minAlt ?? MIN_ALT.comfortable;
  const manual = p.openSky?.[site];
  return { theme: p.theme ?? null, length: p.length ?? "medium", minAlt, includeChallenge: p.includeChallenge ?? true, openDirections: manual ?? terrainDirections(horizon, minAlt).open ?? COMPASS8 };
}
/** The open directions to remember for a site: undefined (forget, use the default) when the choice is the default or empty. */
export function openSkyToStore(choice: readonly Compass8[], horizon: LocalHorizon | null | undefined, minAlt: number): Compass8[] | undefined {
  const def = terrainDirections(horizon, minAlt).open ?? COMPASS8;
  if (!choice.length || (choice.length === def.length && def.every((d) => choice.includes(d)))) return undefined;
  return COMPASS8.filter((d) => choice.includes(d));
}

/**
 * Stable string key of a request (React deps, the shared tonight cache): the skyline's hundreds of numbers are replaced
 * by their fingerprint. A request without a skyline keeps exactly its old key (JSON.stringify).
 */
export function journeyRequestKey(req: JourneyRequest): string {
  return JSON.stringify(req.horizon ? { ...req, horizon: horizonFingerprint(req.horizon) } : req);
}

/**
 * The engine request for a sky + controls. Discovery and the Tonight teaser build it the same way, so the
 * worker's result cache answers the second one instantly and "Start" opens the very journey the teaser showed.
 */
export function journeyRequestFor(a: {
  date: Date; lat: number; lon: number; timezone: string;
  profile: { fov: number; aperture: number; magnification: number; stabilized?: boolean };
  skyBrightness: number; controls: RequestControls; shuffle: number; limit: number; seen: string[];
  /** The site's skyline (compactHorizon of useLocalHorizon); null/absent = flat, and the request is unchanged. */
  horizon?: CompactHorizon | null;
}): JourneyRequest {
  const c = a.controls;
  return {
    instant: slotInstant(a.date).toISOString(), lat: a.lat, lon: a.lon, timezone: a.timezone,
    instrument: { fovDeg: a.profile.fov, aperture: a.profile.aperture, magnification: a.profile.magnification, stabilized: a.profile.stabilized },
    skyBrightness: a.skyBrightness,
    theme: c.theme,
    length: LENGTHS[c.length].stops,
    minAlt: c.minAlt,
    includeChallenge: c.includeChallenge,
    ...(c.openDirections.length < 8 ? { openDirections: c.openDirections } : {}),
    shuffle: a.shuffle,
    limit: a.limit,
    seenObjectIds: a.seen,
    ...(a.horizon ? { horizon: a.horizon } : {}),
  };
}

// ───────────────────────────── journey card ─────────────────────────────

/** The chip naming a stop's role in its story: the theme lens's beat when there is one, else the template role. */
export const stopBeatLabel = (stop: Pick<JourneyStop, "role" | "lens">) => stop.lens?.beat?.trim() || stop.role;

/**
 * Story-arc teaser for the journey card: the storyline beat labels (the same words as the overview spine), at most
 * three on one line and "+N" for the rest.
 */
export function arcChips(journey: Pick<Journey, "stops"> & Partial<Pick<Journey, "templateId" | "switch">>, kb?: Pick<KnowledgeBase, "lenses"> | null): string[] {
  const beats = journeySpine(journey, kb).map((b) => b.label);
  return beats.length <= 3 ? beats : [...beats.slice(0, 3), `+${beats.length - 3}`];
}

// ───────────────────────────── storyline spine ─────────────────────────────

export interface SpineBeat {
  /** Storyline step (lens) or the position of the group (no lens). */
  step: number;
  label: string;
  /** Stop indices told under this beat, in order. */
  stops: number[];
}

/** The storyline (lens set) a journey's archetype is told through, when the KB carries one. */
export function storylineFor(kb: Pick<KnowledgeBase, "lenses"> | null | undefined, templateId: string): ThemeStoryline | null {
  const archetype = templateId.split("-")[0];
  return kb?.lenses?.find((l) => l.archetype === archetype || l.archetype === templateId) ?? null;
}

/**
 * The journey's thread as beats in order (owner feedback r2: "make the thread visible"). Consecutive stops on the
 * same lens step (or, without a lens, the same role label) share a beat. Labels come from the theme's storyline when
 * known, else the first stop's lens beat chip, else its role.
 */
export function journeySpine(journey: Pick<Journey, "stops"> & Partial<Pick<Journey, "templateId" | "switch">>, kb?: Pick<KnowledgeBase, "lenses"> | null): SpineBeat[] {
  const beats: (SpineBeat & { key: string })[] = [];
  journey.stops.forEach((stop, i) => {
    const templateId = journey.switch && i > journey.switch.atStop ? journey.switch.toTemplateId : journey.templateId ?? "";
    const key = stop.lens ? `${templateId}#${stop.lens.step}` : `role#${stop.role}`;
    const last = beats[beats.length - 1];
    if (last && last.key === key) { last.stops.push(i); return; }
    const storyLabel = stop.lens && templateId ? storylineFor(kb, templateId)?.beats.find((b) => b.step === stop.lens!.step)?.label : undefined;
    beats.push({ key, step: stop.lens?.step ?? beats.length + 1, label: storyLabel?.trim() || stopBeatLabel(stop), stops: [i] });
  });
  return beats.map(({ key: _k, ...b }) => b);
}

/** Index of the beat that tells stop `index` (-1 when out of range). */
export const spineBeatOf = (spine: readonly SpineBeat[], index: number) => spine.findIndex((b) => b.stops.includes(index));

/** "Chapter 2 of 5": the storyline beat that tells stop `index`, for field mode and the opened card. */
export function chapterOf(spine: readonly SpineBeat[], index: number): { n: number; total: number; label: string } | null {
  const k = spineBeatOf(spine, index);
  return spine.length >= 2 && k >= 0 ? { n: k + 1, total: spine.length, label: spine[k].label } : null;
}

const ROLE_STOP = new Set(["a", "an", "the", "of", "and", "or", "to", "in", "on", "by", "its", "it", "is", "for", "with", "at", "as", "from", "one", "two"]);
const roleWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !ROLE_STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, ""));
/**
 * The stop's own role under its chapter (the lens beat, e.g. "Measured by its yearly shift"), or null when it only
 * paraphrases the chapter label ("A near star's yearly shift") or there is no chapter (design review r4: one gold
 * label, the chapter; the role is a plain subtitle and only when it adds something).
 */
export function stopRoleLine(stop: Pick<JourneyStop, "role" | "lens">, chapterLabel: string | null | undefined): string | null {
  const role = stopBeatLabel(stop);
  if (!chapterLabel) return null;
  const a = roleWords(role), b = new Set(roleWords(chapterLabel));
  if (!a.length || role.trim().toLowerCase() === chapterLabel.trim().toLowerCase()) return null;
  const shared = a.filter((w) => b.has(w)).length;
  return shared / a.length >= 0.5 ? null : role;
}

/** A short map label: the display name without a parenthesised nickname ("Stock 2 (Muscleman Cluster)" → "Stock 2"). */
export const shortMapLabel = (name: string) => { const s = name.replace(/\s*\([^)]*\)\s*$/, "").trim(); return s || name; };
export const durationLabel = (minutes: number) => `~${Math.max(5, Math.round(minutes / 5) * 5)} min`;
export function altitudeBand(stops: readonly Pick<JourneyStop, "altAtStart">[]): string {
  if (!stops.length) return "";
  const alts = stops.map((s) => Math.round(s.altAtStart));
  const lo = Math.min(...alts), hi = Math.max(...alts);
  return lo === hi ? `${lo}° high` : `${lo}–${hi}° high`;
}
export function regionWords(journey: Pick<Journey, "stops" | "regionCenter">): string {
  return `${COMPASS_WORDS[compassOf(journey.regionCenter.azDeg)].replace(/^./, (c) => c.toUpperCase())} · ${altitudeBand(journey.stops)}`;
}
export const DIFFICULTY_LABELS: Record<Journey["difficulty"], string> = { easy: "Easy", moderate: "Moderate", stretch: "Stretch" };
export const DIFFICULTY_HELP: Record<Journey["difficulty"], string> = {
  easy: "Everything should show within about 30 seconds.",
  moderate: "One faint or tricky stop.",
  stretch: "At least one challenge object; a dark sky helps.",
};
export const localTime = (iso: string | Date, timezone: string) => formatInTimeZone(typeof iso === "string" ? new Date(iso) : iso, timezone, "HH:mm");

export type JourneyStatus = { kind: "now" | "later" | "ending" | "past"; text: string };
/** "Fits now" / "Starts at 21:10" / "Ends soon" from the best window. */
export function journeyStatus(journey: Pick<Journey, "bestWindow" | "stops" | "durationMin">, now: Date, timezone: string): JourneyStatus {
  const start = Date.parse(journey.bestWindow?.start ?? journey.stops[0]?.windowStart ?? "");
  const end = Date.parse(journey.bestWindow?.end ?? journey.stops.at(-1)?.windowEnd ?? "");
  const t = now.getTime();
  if (Number.isFinite(start) && start - t > 10 * 60_000) return { kind: "later", text: `Starts at ${localTime(new Date(start), timezone)}` };
  if (Number.isFinite(end) && end < t) return { kind: "past", text: "Window has passed" };
  if (Number.isFinite(end) && end - t < journey.durationMin * 60_000 + 15 * 60_000) return { kind: "ending", text: `Ends soon · start by ${localTime(new Date(end - journey.durationMin * 60_000), timezone)}` };
  return { kind: "now", text: "Fits now" };
}

// ───────────────────────────── objects & ids ─────────────────────────────

export type ObjectIndex = Map<string, KbObject>;
export const indexObjects = (kb: Pick<KnowledgeBase, "objects"> | null): ObjectIndex => new Map((kb?.objects ?? []).map((o) => [o.id, o]));
export const displayName = (objects: ObjectIndex, id: string) => objects.get(id)?.names.display ?? id;
/** Can this KB still show `journey` (one kept on the device): its theme and every stop object are in the KB? */
export function journeyFitsKb(kb: Pick<KnowledgeBase, "objects" | "templates">, journey: Pick<Journey, "templateId" | "stops">, objects: ObjectIndex = indexObjects(kb)): boolean {
  return kb.templates.some((t) => t.id === journey.templateId) && journey.stops.every((s) => objects.has(s.objectId));
}

// ───────────────────────────── field mode ─────────────────────────────

export const NEUTRAL_BRIDGE = "Let's move on to the next chapter of the story.";

/**
 * "Why from the previous one" after skips (doc 06 §6.5): use the engine's transition only when the stop right
 * before was actually seen; otherwise a neutral bridge, so the text never refers to an object the user missed.
 */
export function transitionFor(journey: Pick<Journey, "stops">, index: number, lastSeen: number, objects: ObjectIndex): { heading: string; text: string } | null {
  if (index <= 0) return null;
  const stop = journey.stops[index];
  if (lastSeen === index - 1 && stop.transitionText) return { heading: `From ${displayName(objects, journey.stops[index - 1].objectId)}`, text: stop.transitionText };
  // Exactly the previous stop was skipped (and the one before it seen, or it was stop 1): the engine's skip-bridge
  // for that stop (JourneyStop.transitionSkipText, optional) goes from the last seen stop to this one.
  const skipText = lastSeen === index - 2 ? textOf((journey.stops[index - 1] as { transitionSkipText?: unknown }).transitionSkipText) : null;
  return { heading: "Next chapter", text: skipText ?? NEUTRAL_BRIDGE };
}

// ───────────────────────────── optional engine fields (read defensively) ─────────────────────────────

/** A non-empty trimmed string, or null. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function firstText(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== "object") return null;
  for (const k of keys) { const t = textOf((value as Record<string, unknown>)[k]); if (t) return t; }
  return null;
}

/**
 * Journey.story (optional opening paragraph) and Journey.payoff (narrate.ts applyNarration: the narrated answer to the
 * driving question), trimmed; empty texts yield nulls so the screens fall back to the driving question alone.
 */
export function journeyStory(journey: Pick<Journey, "story" | "payoff">): { intro: string | null; payoff: string | null } {
  return { intro: textOf(journey.story), payoff: textOf(journey.payoff) };
}

/** Sentences of a paragraph (keeps "…", quotes and closing brackets with their sentence). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…]["”’)]?)\s+(?=[^a-z\s])/).map((x) => x.trim()).filter(Boolean);
}
/** A sentence that only reports logistics ("In about 40 minutes you visit 5 stops around Perseus…"): chips say that. */
const STATS_SENTENCE = /\b\d+\s*(?:minutes?|min)\b[^.!?]*\b\d+\s+stops?\b|\b\d+\s+stops?\b[^.!?]*\b\d+\s*(?:minutes?|min)\b/i;

/**
 * The overview's story as prose only (round 2): the hook already shown as the lede is not repeated, and the
 * duration / stop-count sentence moves to the stat chips (`journeyStats`). Null when nothing is left.
 */
export function storyProse(journey: object): string | null {
  const intro = journeyStory(journey).intro;
  if (!intro) return null;
  const hook = textOf((journey as { hook?: unknown }).hook);
  let rest = intro;
  if (hook && rest.startsWith(hook)) rest = rest.slice(hook.length).trim();
  const kept = sentences(rest).filter((x) => !STATS_SENTENCE.test(x));
  return kept.length ? kept.join(" ") : null;
}

export interface JourneyStat { id: "time" | "stops" | "path" | "difficulty" | "hops"; label: string; title: string }

/** How much hopping a journey takes, in Star hop's units: its planned chain once there is one, else the estimate. */
export interface JourneyEffort {
  /** Binocular hops over the whole journey. */
  hops: number;
  /** True when the counts are Star hop's planned chain (legs), false for the pre-plan estimate. */
  planned: boolean;
  /** Legs Star hop marks hard (a detour, no field overlap, a weak route). */
  hardLegs: number;
}
/** Minutes per hop and per stop for the hop-based duration (finding a field, then looking). */
const MIN_PER_HOP = 1.5, MIN_PER_STOP = 4;
/**
 * A journey's hopping effort. `legs` (1 per stop, JourneysShared.hopLeg) are Star hop's own reports once "Hop the whole
 * journey" planned it; without all of them the effort is estimated from the journey's get-there numbers with the same
 * estimate the stop cards show (estimateHops), so the overview, the cards and Star hop count alike.
 */
export function journeyEffort(journey: Pick<Journey, "stops">, objects: ObjectIndex, fovDeg: number, legs?: readonly (LegReport | null | undefined)[]): JourneyEffort {
  const reports = legs?.filter((l): l is LegReport => !!l && !UNROUTED.has(l.status)) ?? [];
  if (reports.length && reports.length === journey.stops.length) {
    return { hops: reports.reduce((n, l) => n + l.hops, 0), planned: true, hardLegs: reports.filter((l) => /· hard$/.test(legDifficulty(l).label)).length };
  }
  const hops = journey.stops.reduce((n, _s, i) => {
    const view = getThereFor(journey, i, i - 1, objects, fovDeg);
    if (view.mode === "same-field" || (view.mode === "naked-eye-hop" && !view.startName)) return n;
    return n + estimateHops(view.hopFields ?? view.fields);
  }, 0);
  return { hops, planned: false, hardLegs: 0 };
}

/**
 * Duration, stops, path length, hops and difficulty as short chips for their own line (never inside the prose). With
 * `effort` the journey also says its hops in Star hop's units, its time covers the hopping (never less than the
 * engine's), and a planned chain with hard legs raises the difficulty ("Moderate" for one, "Stretch" for more).
 */
export function journeyStats(journey: Pick<Journey, "durationMin" | "stops" | "totalPathDeg" | "difficulty">, effort?: JourneyEffort): JourneyStat[] {
  const minutes = effort ? Math.max(journey.durationMin, journey.stops.length * MIN_PER_STOP + effort.hops * MIN_PER_HOP) : journey.durationMin;
  const out: JourneyStat[] = [
    { id: "time", label: durationLabel(minutes), title: effort ? "About how long it takes, with the star hops" : "About how long it takes" },
    { id: "stops", label: `${journey.stops.length} stops`, title: "Stops on this journey" },
  ];
  if (Number.isFinite(journey.totalPathDeg) && journey.totalPathDeg > 0) out.push({ id: "path", label: `${Math.round(journey.totalPathDeg)}° of sky`, title: "Total length of the path across the sky" });
  if (effort) out.push({ id: "hops", label: hopCountLabel(effort.hops, { estimate: !effort.planned }), title: effort.planned ? "Binocular hops in Star hop's plan for this journey" : "About how many binocular hops Star hop plans for this journey" });
  const rank: Journey["difficulty"][] = ["easy", "moderate", "stretch"];
  const hopLevel: Journey["difficulty"] = !effort?.planned || !effort.hardLegs ? "easy" : effort.hardLegs === 1 ? "moderate" : "stretch";
  const level = rank[Math.max(rank.indexOf(journey.difficulty), rank.indexOf(hopLevel))];
  out.push({ id: "difficulty", label: DIFFICULTY_LABELS[level], title: level === journey.difficulty ? DIFFICULTY_HELP[level] : `Star hop marks ${effort!.hardLegs} ${effort!.hardLegs === 1 ? "leg" : "legs"} hard (long or tricky hops).` });
  return out;
}

/**
 * Journey.conditions (optional JourneyConditions from the engine) as short plain-language lines for the overview:
 * darkness, the Moon and the altitude floor. Strings / lists of strings are passed through for robustness.
 */
export function journeyConditionLines(journey: object, timezone = "UTC", o: { moon?: boolean } = {}): string[] {
  const c = (journey as { conditions?: unknown }).conditions;
  if (!c) return [];
  const one = (x: unknown) => textOf(x) ?? firstText(x, ["text", "message", "summary", "note", "label"]);
  if (Array.isArray(c)) return c.map(one).filter((x): x is string => !!x).slice(0, 4);
  const direct = one(c);
  if (direct) return [direct];
  if (typeof c !== "object") return [];
  const k = c as {
    darkness?: string; darkWindow?: { start?: string | null; end?: string | null }; minAlt?: number; closestMoonDeg?: number | null;
    moon?: { up?: boolean; illumination?: number; rise?: string | null; set?: string | null };
  };
  const at = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? localTime(new Date(t), timezone) : null; };
  const lines: string[] = [];
  const darkEnd = at(k.darkWindow?.end), darkStart = at(k.darkWindow?.start);
  if (k.darkness === "night") lines.push(darkEnd ? `Fully dark until ${darkEnd}` : "Fully dark");
  else if (k.darkness === "astronomical") lines.push(darkStart ? `Last twilight; fully dark from ${darkStart}` : "Last twilight");
  else if (k.darkness === "nautical") lines.push("Twilight: bright stars and doubles first");
  else if (k.darkness === "civil" || k.darkness === "day") lines.push("Still light: bright stars only");
  if (k.moon && o.moon !== false) lines.push(moonWords(k, at));
  if (typeof k.minAlt === "number") lines.push(`every stop above ${Math.round(k.minAlt)}°`);
  return lines;
}

type ConditionsMoon = { closestMoonDeg?: number | null; moon?: { up?: boolean; illumination?: number; rise?: string | null; set?: string | null } };
function moonWords(k: ConditionsMoon, at: (iso: string | null | undefined) => string | null): string {
  const m = k.moon!, pct = Math.round((m.illumination ?? 0) * 100);
  if (m.up) {
    const near = typeof k.closestMoonDeg === "number" ? `, nearest stop ${Math.round(k.closestMoonDeg)}° from it` : "";
    const sets = at(m.set);
    return `Moon ${pct}% lit and up${near}${sets ? `; sets ${sets}` : ""}`;
  }
  if (pct >= 5) { const rises = at(m.rise); return `Moon down${rises ? ` until ${rises}` : ""}`; }
  return "No Moon";
}

/**
 * The journey's one-line Moon check (Overview header, Done), from the engine's own conditions (never recomputed), plus
 * the stop that passes closest to the Moon: "Moon effect" opens the Moon tab on that stop at its time.
 */
export function journeyMoonCheck(journey: Pick<Journey, "stops"> & object, timezone = "UTC"): { text: string; stopIndex: number } | null {
  const c = (journey as { conditions?: unknown }).conditions;
  if (!c || typeof c !== "object" || Array.isArray(c) || !(c as ConditionsMoon).moon) return null;
  const at = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? localTime(new Date(t), timezone) : null; };
  let stopIndex = 0;
  journey.stops.forEach((s, i) => { const best = journey.stops[stopIndex].moonSepDeg; if (s.moonSepDeg !== null && (best === null || s.moonSepDeg < best)) stopIndex = i; });
  return { text: moonWords(c as ConditionsMoon, at), stopIndex };
}

export interface GetThereView {
  mode: JourneyStop["getThere"]["mode"]; text: string; fromName: string | null; distanceDeg: number; fields: number; anchorName: string | null; restarted: boolean;
  /**
   * Where the binocular hop of this leg begins: the stop the leg starts from (same field, sweep), or the naked-eye
   * anchor the directions name (a jump). "Plan star hop" starts here, so Star hop and the card agree. Null: Star hop
   * chooses (a jump with no anchor, or an anchor that is the stop itself).
   */
  startId: string | null;
  startName: string | null;
  /** The binocular part of the leg from `startId` (null when unknown): what the directions' "about two fields" counts. */
  hopDeg: number | null;
  hopFields: number | null;
}

/** True field the journey was planned with (its get-there numbers), so card numbers match the narrated directions. */
export function plannedFov(stop: Pick<JourneyStop, "getThere">, fallback: number): number {
  const g = stop.getThere;
  return g.fields > 0.05 && g.distanceDeg > 0 ? g.distanceDeg / g.fields : fallback;
}

/** The binocular hop from the anchor of a naked-eye jump to the stop, from KB positions (null when either is unknown). */
function anchorHop(stop: Pick<JourneyStop, "objectId" | "getThere">, objects: ObjectIndex, fovDeg: number): { id: string; name: string; deg: number; fields: number } | null {
  const id = stop.getThere.anchorId;
  if (!id || id === stop.objectId) return null;
  const a = objects.get(id), t = objects.get(stop.objectId);
  const name = a?.names.display ?? id;
  if (!a || !t) return { id, name, deg: NaN, fields: NaN };
  const deg = angularDistance(a.ra, a.dec, t.ra, t.dec);
  return { id, name, deg, fields: deg / fovDeg };
}

/**
 * Movement guidance for a stop. When the previous stop was skipped the leg restarts from the last stop the
 * observer saw (or a naked-eye jump), never from an object that was not found. The view also says where the binocular
 * hop starts (`startId`), the one place "Plan star hop" and the card's numbers are taken from.
 */
export function getThereFor(journey: Pick<Journey, "stops">, index: number, lastSeen: number, objects: ObjectIndex, fovDeg: number): GetThereView {
  const stop = journey.stops[index];
  const target = objects.get(stop.objectId);
  const anchorName = stop.getThere.anchorId ? displayName(objects, stop.getThere.anchorId) : null;
  const fov = plannedFov(stop, fovDeg);
  const jump = anchorHop(stop, objects, fov);
  const jumpStart = { startId: jump?.id ?? null, startName: jump?.name ?? null, hopDeg: jump && Number.isFinite(jump.deg) ? jump.deg : null, hopFields: jump && Number.isFinite(jump.fields) ? jump.fields : null };
  if (index === 0 || lastSeen === index - 1) {
    const prev = index ? journey.stops[index - 1] : null;
    const fromName = prev ? displayName(objects, prev.objectId) : null;
    const g = stop.getThere;
    const start = g.mode === "naked-eye-hop" ? jumpStart
      : { startId: prev?.objectId ?? null, startName: fromName, hopDeg: g.distanceDeg, hopFields: g.fields };
    return { mode: g.mode, text: g.bearingText, fromName, distanceDeg: g.distanceDeg, fields: g.fields, anchorName, restarted: false, ...start };
  }
  const from = lastSeen >= 0 ? objects.get(journey.stops[lastSeen].objectId) : undefined;
  const name = target?.names.display ?? stop.objectId;
  if (from && target) {
    const d = angularDistance(from.ra, from.dec, target.ra, target.dec), fields = d / fovDeg;
    const dir = directionBetween(from.ra, from.dec, target.ra, target.dec);
    if (fields <= 4) return { mode: fields <= 0.8 ? "same-field" : "sweep", text: `Start again from ${from.names.display}, the last stop you saw: ${name} is ${fields <= 0.8 ? "in the same binocular field" : `about ${Math.max(1, Math.round(fields * 2) / 2)} binocular fields away`}, toward the ${dir}.`, fromName: from.names.display, distanceDeg: d, fields, anchorName, restarted: true, startId: from.id, startName: from.names.display, hopDeg: d, hopFields: fields };
  }
  const anchor = anchorName && jump ? `Find ${anchorName} by eye, then raise the binoculars and hop to ${name}.` : `Find ${name}'s part of the sky by eye first, then raise the binoculars.`;
  // The leg restarts at the anchor: its numbers are the anchor's hop, never the distance from a stop that was not seen.
  return { mode: "naked-eye-hop", text: `Lower your binoculars. ${anchor}`, fromName: from?.names.display ?? null, distanceDeg: jumpStart.hopDeg ?? 0, fields: jumpStart.hopFields ?? 0, anchorName, restarted: true, ...jumpStart };
}

/** Report statuses that say nothing about how to get there (the leg was not routed). */
const UNROUTED: ReadonlySet<LegReport["status"]> = new Set<LegReport["status"]>(["below-horizon", "unresolved", "anchor-unavailable", "no-route"]);
/** True when the directions already state the leg's degrees ("… two fields of your 3.7° binoculars (8°)"). */
const statesDegrees = (text: string) => /\d\s*°/.test(text.replace(/\d+(?:\.\d+)?°\s*(?:binoculars|up|high)\b/g, ""));

/**
 * One short summary of a leg that the card meta, the field-mode chip and "Plan star hop" all share. It counts from
 * `startId`, the hop the directions narrate, in Star hop's hop units (lib/hop-chain hopCountLabel): before the journey's
 * chain is planned an estimate calibrated on the hopper ("about 3 hops"), after it Star hop's own count from `report`
 * ("5 hops · hard"). Names read as in a sentence ("from the Hyades"), and the degrees appear once: the directions say
 * them, so the summary adds them only when the directions do not (a restart counted in fields).
 */
export function legSummary(view: GetThereView, report?: LegReport | null): string {
  const planned = report && !UNROUTED.has(report.status) ? report : null;
  const start = view.startName ? nameInSentence(view.startName) : null;
  const fields = view.hopFields ?? view.fields, deg = view.hopDeg ?? view.distanceDeg;
  const hard = planned && legDifficulty(planned).label.endsWith("· hard") ? " · hard" : "";
  const hops = (estimateFields: number) => (planned ? `${hopCountLabel(planned.hops)}${hard}` : hopCountLabel(estimateHops(estimateFields), { estimate: true }));
  const degrees = !statesDegrees(view.text) && deg >= 1 ? `, about ${Math.round(deg)}°` : "";
  if (planned?.status === "jump" && planned.hops === 0) return "No hop needed";
  if (view.mode === "same-field") {
    const where = start ? `Same field as ${start}` : "Same binocular field";
    return planned && planned.status !== "same-field" ? `${where} · ${hops(fields)}` : where;
  }
  if (view.mode === "sweep") return `${start ? `From ${start}` : "A sweep"}${degrees} · ${hops(fields)}`;
  if (planned?.status === "ok") return legDifficulty(planned).label;
  if (start) return view.hopFields !== null ? `By eye to ${start}, then ${hops(view.hopFields)}` : `By eye to ${start}, then ${planned ? hops(0) : "a short hop"}`;
  // The stop is its own naked-eye anchor ("Find Delta Centauri by eye"): the directions say "by eye", the summary does not.
  if (view.anchorName) return "No hop needed";
  return planned ? `Naked-eye jump · ${hops(0)}` : "Naked-eye jump";
}

/**
 * One journey stop as the sky-chart overlay draws it: ring, label, its own star (stars: magnitude and colour) and,
 * for a cluster or nebula, its angular extent so the label sits outside its stars (design review r4).
 */
export function overlayStop(o: KbObject, state: "todo" | "current" | "done" | "skipped"): { id: string; ra: number; dec: number; label: string; state: typeof state; mag: number | null; kind: "star" | "dso"; teffK: number | null; sizeDeg: number | null } {
  const arcmin = o.facts.angularSizeArcmin?.value;
  return { id: o.id, ra: o.ra, dec: o.dec, label: shortMapLabel(o.names.display), state, mag: o.mag ?? null, kind: o.kind === "star" ? "star" : "dso", teffK: o.kind === "star" ? objectTeff(o) : null, sizeDeg: o.kind === "dso" && arcmin ? arcmin / 60 : null };
}

/**
 * The naked-eye anchor to mark on the field-mode map ("Find Alderamin by eye"): only for a naked-eye jump, and not
 * when the anchor is the stop itself or the stop the leg starts from (those already carry a ring).
 */
export function fieldAnchor(journey: Pick<Journey, "stops">, index: number, fromIndex: number, objects: ObjectIndex, mode: GetThereView["mode"]): { id: string; ra: number; dec: number; label: string } | null {
  const stop = journey.stops[index];
  const id = stop?.getThere.anchorId;
  if (!stop || !id || mode !== "naked-eye-hop" || id === stop.objectId) return null;
  if (fromIndex >= 0 && journey.stops[fromIndex]?.objectId === id) return null;
  const o = objects.get(id);
  return o ? { id: o.id, ra: o.ra, dec: o.dec, label: shortMapLabel(o.names.display) } : null;
}

/**
 * The generic "Lower your binoculars first" line for a naked-eye jump: never on stop 1 (the observer is not at the
 * eyepiece yet), and not when the directions already say to find the spot by eye (it would repeat them).
 */
export function showLowerBinoculars(guide: Pick<GetThereView, "mode" | "text">, index: number): boolean {
  return guide.mode === "naked-eye-hop" && index > 0 && !/\bby eye\b|lower (?:your|the) binoculars/i.test(guide.text);
}

export type StopAltitudeState = {
  kind: "ok" | "getting-low" | "missed"; alt: number; text: string | null;
  /** Azimuth now, degrees. */
  az: number;
  /** Degrees above the local skyline now (negative: behind it); null when no skyline is known. */
  clearance: number | null;
  /** Why a stop is (or soon is) out of reach: low in the sky, or behind the hills. Absent when ok. */
  reason?: "low" | "terrain";
};
/** Above the flat horizon but behind the skyline: the hills hide it (below the horizon it is simply set). */
const behindHills = (alt: number, clearance: number | null) => clearance !== null && clearance < 0 && alt >= 0;
/**
 * Live check (doc 06 §6.7): flag a stop that falls below the minimum altitude, or behind the local skyline when
 * `horizon` is known, now or within 10 minutes. Without a horizon the result is exactly the flat-horizon check.
 */
export function stopAltitudeState(object: Pick<KbObject, "ra" | "dec">, lat: number, lon: number, now: Date, minAlt: number, timezone: string, horizon?: HorizonInput): StopAltitudeState {
  const { alt, az } = eqToHorizontal(object.ra, object.dec, lat, lon, now);
  const clearance = clearanceDeg(horizon, alt, az);
  const base = { alt, az, clearance };
  if (behindHills(alt, clearance)) return { kind: "missed", ...base, reason: "terrain", text: `Missed — now behind the hills to the ${compassWord(az)}` };
  if (alt < minAlt) return { kind: "missed", ...base, reason: "low", text: `Missed — now ${Math.round(alt)}° high, below ${minAlt}°` };
  const soon = new Date(now.getTime() + 10 * 60_000);
  const later = eqToHorizontal(object.ra, object.dec, lat, lon, soon);
  if (behindHills(later.alt, clearanceDeg(horizon, later.alt, later.az))) return { kind: "getting-low", ...base, reason: "terrain", text: `Going behind the hills to the ${compassWord(later.az)} by ${localTime(soon, timezone)}` };
  if (later.alt < minAlt) return { kind: "getting-low", ...base, reason: "low", text: `Getting low — drops below ${minAlt}° by ${localTime(soon, timezone)}` };
  return { kind: "ok", ...base, text: null };
}

/** The "Can't find it?" altitude line: the flat-horizon wording, or precise against the skyline when it is known. */
export function altitudeHelpText(a: Pick<StopAltitudeState, "alt" | "az" | "clearance">, minAlt: number): string {
  const h = Math.round(a.alt), dir = compassWord(a.az);
  if (a.clearance === null) return a.alt < minAlt + 5 ? `It's only ${h}° high — low objects dim in thick air; trees and haze may hide it.` : `It's ${h}° high — height is not the problem.`;
  if (behindHills(a.alt, a.clearance)) return `It's ${h}° high but behind the hills to the ${dir}, so it can't be seen from this spot right now.`;
  const c = Math.round(a.clearance);
  if (a.clearance < 5) return `It's ${h}° high and ${c < 1 ? "only just" : `only ${c}°`} above your skyline to the ${dir}; trees, roofs or haze near the skyline may hide it.`;
  if (a.alt < minAlt + 5) return `It's only ${h}° high — low objects dim in thick air. It clears your skyline to the ${dir} by ${c}°.`;
  return `It's ${h}° high and ${c}° above your skyline — height is not the problem.`;
}

/** Light-travel recap line for the done screen: the farthest seen stop. */
export function farthestSeen(journey: Pick<Journey, "stops">, seen: readonly number[], objects: ObjectIndex): { name: string; ly: number } | null {
  let best: { name: string; ly: number } | null = null;
  for (const i of seen) {
    const o = objects.get(journey.stops[i]?.objectId ?? "");
    const ly = o?.facts.distanceLy?.value;
    if (o && ly && (!best || ly > best.ly)) best = { name: o.names.display, ly };
  }
  return best;
}
export const formatLy = (ly: number) => ly >= 1e6 ? `${(ly / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} million light-years` : `${Math.round(ly >= 1000 ? Math.round(ly / 100) * 100 : ly).toLocaleString("en-US")} light-years`;

// ───────────────────────────── done screen ─────────────────────────────

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "five look-alikes", "one record", "12 stops": small counts read as words in a headline. */
const plural = (n: number, one: string, many: string) => `${NUMBER_WORDS[n] ?? n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const roundK = (k: number) => (Math.round(k / 100) * 100).toLocaleString("en-US");

/** "Andromeda Galaxy" → "the Andromeda Galaxy" in running text; star names and "M31"-style names stay bare. */
export function withArticle(name: string): string {
  return /^the\s/i.test(name) || !/\b(Galaxy|Nebula|Cluster|Clouds?|Belt|Rift)\b/.test(name) ? name : `the ${name}`;
}

/**
 * The done screen's headline, in the terms of the story just told (design review r2: a distance stat is the How-far
 * story only). A narration key `done.<templateId>` (first variant; {n} stops seen, {beats} beats covered, {total})
 * overrides the built-in line. `detail` extends the lede ("; the farthest was Deneb").
 */
export function doneHeadline(journey: Pick<Journey, "templateId" | "stops"> & Partial<Pick<Journey, "switch">>, seen: readonly number[], objects: ObjectIndex, kb?: Pick<KnowledgeBase, "narration" | "lenses"> | null): { headline: string; detail: string | null } {
  const n = seen.length;
  if (!n) return { headline: "Journey's end", detail: null };
  const spine = journeySpine(journey, kb);
  const beats = spine.filter((b) => b.stops.some((i) => seen.includes(i))).length;
  const custom = textOf(kb?.narration?.variants?.[`done.${journey.templateId}`]?.[0]);
  if (custom) return { headline: capitalizeFirst(custom).replace(/\{n\}/g, String(n)).replace(/\{beats\}/g, String(beats)).replace(/\{total\}/g, String(journey.stops.length)), detail: null };
  const seenObjects = seen.flatMap((i) => { const o = objects.get(journey.stops[i]?.objectId ?? ""); return o ? [o] : []; });
  // Design review r4: every headline opens with a full clause and a capital ("You saw four records…"), never with a
  // lowercase number word.
  const out = (headline: string, detail: string | null = null) => ({ headline: capitalizeFirst(headline), detail });
  switch (journey.templateId.split("-")[0]) {
    case "A1": return out(beats > 1 ? `A star's life, told in ${plural(beats, "chapter", "chapters")}` : "The first chapter of a star's life");
    case "A2": {
      const temps = seenObjects.map(objectTeff).filter((t): t is number => !!t && t > 1000);
      if (temps.length >= 2 && Math.max(...temps) - Math.min(...temps) >= 500) return out(`Color alone took you from ${roundK(Math.min(...temps))} K to ${roundK(Math.max(...temps))} K`);
      return out(`You read ${plural(n, "star", "stars")} like a thermometer`);
    }
    case "A3": {
      const far = farthestSeen(journey, seen, objects);
      // A no-break hyphen keeps "light-years" on one line in the large headline.
      return far ? out(`You saw light that traveled ${formatLy(far.ly).replace("light-years", "light\u2011years")}`, `the farthest was ${withArticle(far.name)}`) : out("Journey's end");
    }
    case "A5": return out(seenObjects.every((o) => o.kind === "dso") ? `You met ${plural(n, "star family", "star families")}` : `You followed a family of stars through ${plural(n, "stop", "stops")}`);
    case "A6": return out(`You told ${plural(n, "look-alike", "look-alikes")} apart`);
    case "A7": return out(`You saw ${plural(n, "record", "records")} with your own eyes`);
    case "A8": return out(`You followed the road to a star's end through ${plural(n, "stop", "stops")}`);
    case "A9": return out(seenObjects.every((o) => o.kind === "star") ? `You split ${plural(n, "pair", "pairs")} tonight` : `You split ${plural(n, "point", "points")} of light tonight`);
    case "A11": return out(`You visited ${plural(n, "landmark", "landmarks")} of the galaxy you live inside`);
    case "A12": return out(`You found ${plural(n, "sight", "sights")} the Moon could not wash out`);
    default: return out("Journey's end");
  }
}

const capitalizeFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The done screen's count line in words, matching the headline: "all five stops seen", "three of five stops seen". */
export function seenCountLine(seen: number, total: number): string {
  const w = (k: number) => NUMBER_WORDS[k] ?? k.toLocaleString("en-US");
  if (total > 0 && seen === total) return total === 1 ? "the one stop seen" : total === 2 ? "both stops seen" : `all ${w(total)} stops seen`;
  return `${w(seen)} of ${w(total)} stops seen`;
}
