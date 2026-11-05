/**
 * One object, one set of actions: the shared contract that links Journeys, Star hop, the Planner, Tonight's Best,
 * Moon, Clock, Catalog and photos (integration blueprint r5). Types and pure functions only. It must never import the
 * journeys knowledge base or any journeys runtime module (type-only imports are fine), so it stays in the main bundle
 * at no cost.
 *
 * Id forms of one physical object: unified catalog ids (M42, NGC869, STAR-Betelgeuse, DS-Albireo, AST-…), BSC routing
 * nodes (HR2061), planning/session ids (star:HR2061) and KB ids (the unified id when one exists, else HR<n>, HD…, NAME-…).
 * STAR-Betelgeuse, HR2061 and star:HR2061 are the same object; the converters below are idempotent.
 */
import { angularDistance, type Route, type SkyNode, type Star, type UnifiedTarget } from "./astronomy";
import type { BinocularProfile } from "./binocular-assessment";
import type { DeepSkyClass, KbObject } from "./journeys/types";
import { STAR_TARGET_HR } from "./binocular-media";
import { canonicalTargetId } from "./catalog-identifiers";
import { formatCatalogDesignation, targetDesignation } from "./catalog-presentation";
import { starPlanningTarget } from "./session-planner";

// ───────────────────────────── identity ─────────────────────────────

/** Every id one physical object goes by; a field is absent when the object has no such form. */
export interface ObjectIds {
  /** Unified catalog target id (Messier + binocular catalog), the id Tonight, Catalog, Moon and Star hop select. */
  unifiedId?: string;
  /** Bright Star Catalogue number for stellar objects. */
  hr?: number;
  /** Id `planRoutes` and `#/hop/<id>` accept: the unified id when one exists, else `HR<n>`. */
  routingId?: string;
  /** Planner/session item id: the unified id when one exists, else `star:HR<n>` (or `moon:<feature>`). */
  sessionId?: string;
  /** Journeys knowledge-base id: the unified id when one exists, else `HR<n>` (KB-only ids pass through). */
  kbId?: string;
}

const HR_TO_TARGET = new Map(Object.entries(STAR_TARGET_HR).map(([name, hr]) => [hr, `STAR-${name}`]));
const BSC_ID = /^(?:star:)?HR(\d+)$/;

/** HR number of a curated `STAR-<Name>`, `HR<n>` or `star:HR<n>` id; undefined for anything else. */
export function hrOf(id: string): number | undefined {
  const bsc = id.match(BSC_ID);
  if (bsc) return Number(bsc[1]);
  return id.startsWith("STAR-") ? STAR_TARGET_HR[id.slice(5)] : undefined;
}
/** Canonical key of an object: `STAR-<Name>` for a curated star in any form, `HR<n>` for other BSC stars, else the id with legacy aliases resolved. */
export function objectKey(id: string): string {
  const bsc = id.match(BSC_ID);
  if (!bsc) return canonicalTargetId(id);
  return HR_TO_TARGET.get(Number(bsc[1])) ?? `HR${Number(bsc[1])}`;
}
/** True when two ids (any form) name the same object. */
export const sameObject = (a: string, b: string) => objectKey(a) === objectKey(b);
/** Routing id (`planRoutes` target, `#/hop/<id>`); null for lunar features. Syntactic: use resolveObject to know it exists. */
export function toRoutingId(id: string): string | null {
  return id.startsWith("moon:") ? null : objectKey(id);
}
/** Planner/session item id: curated stars as `STAR-<Name>`, other BSC stars as `star:HR<n>`, everything else as-is. */
export function toSessionId(id: string): string {
  const key = objectKey(id);
  return /^HR\d+$/.test(key) ? `star:${key}` : key;
}
/** Journeys KB id; null for lunar features. Curated stars stay `STAR-<Name>`, other BSC stars become `HR<n>`. */
export function toKbId(id: string): string | null {
  return id.startsWith("moon:") ? null : objectKey(id);
}

/** Catalogs an object is resolved against (the planner's loaded catalogs). */
export interface ObjectCatalog { targets: readonly UnifiedTarget[]; stars: readonly Star[] }
export type ResolvedObject = ObjectIds & { name: string; ra: number; dec: number; mag: number };

const indexes = new WeakMap<readonly unknown[], Map<string | number, unknown>>();
function indexed<T>(list: readonly T[], key: (item: T) => string | number): Map<string | number, T> {
  let map = indexes.get(list) as Map<string | number, T> | undefined;
  if (!map) { map = new Map(list.map((item) => [key(item), item])); indexes.set(list, map); }
  return map;
}
/**
 * Resolve any id form (or a KB object with an `hr`) to all its ids, name and J2000 position, preferring the unified
 * catalog target. Null when the object is neither a unified target nor a BSC star (lunar features, KB-only objects).
 */
export function resolveObject(id: string | Pick<KbObject, "id" | "hr">, cat: ObjectCatalog): ResolvedObject | null {
  const rawId = typeof id === "string" ? id : id.id, key = objectKey(rawId);
  const target = indexed(cat.targets, (t) => t.id).get(key);
  if (target) {
    const hr = hrOf(key);
    return { unifiedId: key, ...(hr ? { hr } : {}), routingId: key, sessionId: key, kbId: key, name: target.name, ra: target.ra, dec: target.dec, mag: target.mag };
  }
  const hr = hrOf(key) ?? (typeof id === "string" ? undefined : id.hr);
  const star = hr ? indexed(cat.stars, (s) => s.hr).get(hr) : undefined;
  if (!hr || !star) return null;
  const unifiedId = HR_TO_TARGET.get(hr);
  if (unifiedId && indexed(cat.targets, (t) => t.id).has(unifiedId)) return resolveObject(unifiedId, cat);
  return { hr, routingId: `HR${hr}`, sessionId: `star:HR${hr}`, kbId: typeof id === "string" || /^HR\d+$/.test(rawId) ? `HR${hr}` : rawId, name: starPlanningTarget(star).name, ra: star.ra, dec: star.dec, mag: star.mag };
}

/**
 * Start star for a hop that begins at `from` (the previous journey stop): the object itself when it is a naked-eye BSC
 * star (mag ≤ maxMag, what findAnchors accepts), else the brightest such star within 1.5 fields of it, else undefined
 * (Star hop chooses). Fallback for single hops; chains start legs at the previous stop itself via planRoutes startNodeId.
 */
export function startStarFor(from: Pick<ResolvedObject, "ra" | "dec" | "mag" | "hr">, stars: readonly Star[], fovDeg: number, maxMag = 4.5): string | undefined {
  if (from.hr && from.mag <= maxMag && indexed(stars, (s) => s.hr).has(from.hr)) return `HR${from.hr}`;
  let best: Star | undefined;
  for (const s of stars) if (s.mag <= maxMag && (!best || s.mag < best.mag) && angularDistance(from.ra, from.dec, s.ra, s.dec) <= 1.5 * fovDeg) best = s;
  return best ? `HR${best.hr}` : undefined;
}

// ───────────────────────────── names ─────────────────────────────

/** One object's name as every tab shows it. */
export interface ObjectName {
  /** The one display label: "Double Cluster (NGC 869)", "Orion Nebula (M42)", "Betelgeuse (α Ori)", "NGC 7209". */
  label: string;
  /** Common name without designation ("Double Cluster"); the designation when there is no common name. */
  name: string;
  /** Formatted catalog designation ("NGC 869", "M42", "α Ori"), when known. */
  designation?: string;
  /** Other names for an "Also known as" line (never repeats name or designation). */
  alsoKnownAs: string[];
}
/** Anything with a name: a unified target (incl. star:HR planning targets), a BSC star, or a KB record. */
const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω" };
/** "ζ Lyrae" / "Zeta Lyrae" already say "ζ Lyr": the designation adds nothing to the label. */
function sameBayerName(name: string, des: string): boolean {
  const d = des.match(/^([α-ω])\S*\s+([A-Za-z]{3})$/), n = name.match(/^(\S+)\s+([A-Za-z]+)/);
  if (!d || !n) return false;
  const letter = GREEK[n[1].toLowerCase()] ?? n[1].charAt(0);
  return letter === d[1] && n[2].toLowerCase().startsWith(d[2].toLowerCase());
}
export type NamedObject = UnifiedTarget | Star | { id: string; names: { display: string; designation?: string; aliases?: string[] } };
const squash = (value: string) => value.toLowerCase().replace(/[\s.]/g, "");
/**
 * The display-name rule, shared by every tab. Resolve first: a KB record that is a unified target is named from that
 * target (pass `targets`), so Journeys and the other tabs agree. Then: label = "<common name> (<designation>)", or just
 * one of them when they coincide or one is missing (an HR number never labels a named star). A trailing parenthesis in the common name ("Double Cluster (h Per)")
 * moves to alsoKnownAs when a designation exists to disambiguate; otherwise it stays in the name.
 */
export function objectName(o: NamedObject, targets?: readonly UnifiedTarget[]): ObjectName {
  if ("names" in o && targets) {
    const map = indexed(targets, (t) => t.id), hr = (o as { hr?: number }).hr, real = map.get(objectKey(o.id)) ?? (hr ? map.get(HR_TO_TARGET.get(hr) ?? "") : undefined);
    if (real) return objectName(real);
  }
  let raw: string, designation: string | undefined, aliases: string[];
  if ("names" in o) { raw = o.names.display; designation = o.names.designation; aliases = o.names.aliases ?? []; }
  else if ("category" in o) { raw = o.name; designation = targetDesignation(o) || undefined; aliases = o.aliases ?? []; }
  else {
    designation = o.bayer && o.constellation ? `${o.bayer} ${o.constellation}` : o.flamsteed && o.constellation ? `${o.flamsteed} ${o.constellation}` : `HR ${o.hr}`;
    raw = o.name && !/^HR\s*\d+$/i.test(o.name) ? o.name : designation; aliases = [];
  }
  let des = designation ? formatCatalogDesignation(designation) : undefined;
  const paren = raw.match(/^(.*\S)\s*\(([^()]+)\)$/), extra: string[] = [];
  // A named star is never labelled by its catalogue number ("Capella (HR 1708)"): HR goes to alsoKnownAs.
  if (des && /^HR\s*\d+$/i.test(des) && !/^HR\s*\d+$/i.test(raw.trim())) { extra.push(des); des = undefined; }
  let name = raw.trim();
  if (paren && des) { name = paren[1]; extra.push(paren[2].trim()); }
  const label = !des || squash(des) === squash(name) || sameBayerName(name, des) ? name : `${name} (${des})`;
  const taken = new Set([squash(name), ...(des ? [squash(des)] : [])]), alsoKnownAs: string[] = [];
  for (const alias of [...extra, ...aliases.map(formatCatalogDesignation)]) { const k = squash(alias); if (alias && !taken.has(k)) { taken.add(k); alsoKnownAs.push(alias); } }
  return { label, name, ...(des ? { designation: des } : {}), alsoKnownAs };
}
/** The one display label of an object (objectName(o, targets).label). */
export const displayName = (o: NamedObject, targets?: readonly UnifiedTarget[]) => objectName(o, targets).label;

// ───────────────────────────── KB → unified target ─────────────────────────────

/** UnifiedTarget category for each KB deep-sky class (what binocularAssessment and the badges expect). */
export const KB_DSO_CATEGORY: Record<DeepSkyClass, string> = {
  "hii-region": "Emission Nebula", "reflection-nebula": "Reflection Nebula", "dark-nebula": "Dark Nebula",
  "nebula-complex": "Nebula Complex", "embedded-cluster": "Open Cluster", "open-cluster": "Open Cluster",
  "ob-association": "Asterism", "moving-group": "Asterism", "globular-cluster": "Globular Cluster",
  "star-cloud": "Star Cloud", asterism: "Asterism", "planetary-nebula": "Planetary Nebula",
  "supernova-remnant": "Supernova Remnant", "wind-bubble": "Emission Nebula", "galaxy-spiral": "Spiral Galaxy",
  "galaxy-barred-spiral": "Barred Spiral Galaxy", "galaxy-lenticular": "Lenticular Galaxy",
  "galaxy-elliptical": "Elliptical Galaxy", "galaxy-dwarf-elliptical": "Dwarf Elliptical Galaxy",
  "galaxy-irregular": "Irregular Galaxy", "milky-way-field": "Milky Way Field",
};
/** Major axis of a KB object in arcmin (extent, else the angularSizeArcmin fact), or null. */
export function kbMajorArcmin(o: KbObject): number | null {
  if (o.kind === "dso" && o.extent) return o.extent.majorArcmin;
  return o.facts.angularSizeArcmin?.value ?? null;
}
export interface KbToTargetOptions {
  /** When given and the KB object is a unified catalog target (any id form), that real target is returned instead. */
  targets?: readonly UnifiedTarget[];
  /** Magnitude for objects without one (dark nebulae, Milky Way fields). Default 99 (assessment: not a point source). */
  missingMag?: number;
}
/**
 * The single KB record → UnifiedTarget converter (replaces StopCard kbObjectToTarget and conditions toBinocularTarget):
 * feeds binocularAssessment, TargetPhoto, MoonlightCard, clocks and charts. Without `targets` the result is exactly
 * the conversion the journey engine rates (stars as single points, category from KB_DSO_CATEGORY, size from extent).
 */
export function kbToUnifiedTarget(o: KbObject, opts: KbToTargetOptions = {}): UnifiedTarget {
  if (opts.targets) {
    const map = indexed(opts.targets, (t) => t.id), real = map.get(objectKey(o.id)) ?? (o.hr ? map.get(HR_TO_TARGET.get(o.hr) ?? "") : undefined);
    if (real) return real;
  }
  const major = kbMajorArcmin(o), minor = o.kind === "dso" ? o.extent?.minorArcmin ?? major : major;
  const category = o.kind === "star" ? "Star" : KB_DSO_CATEGORY[o.dsoClass];
  return {
    id: o.id, name: o.names.display, displayName: o.names.display, aliases: o.names.aliases,
    mag: o.mag ?? opts.missingMag ?? 99, ra: o.ra, dec: o.dec, con: o.con,
    category, categoryShort: category, source: "binocular",
    ...(major !== null ? { size: `${major}×${minor ?? major}′` } : {}),
  };
}

// ───────────────────────────── actions ─────────────────────────────

/** A journey stop reference; `stop` is 1-based everywhere (as in URLs and "stop 3 of 5"). */
export interface JourneyRef {
  key: string; stop: number;
  /** Additive (r5 fix 1): the hop was opened from the Overview's stop card, so "Back to journey" returns there (`#/journeys/<key>?stop=n`), not to field mode. */
  from?: "overview";
}

/** What a chained star hop covers. Journey stop numbers are 1-based and inclusive. */
export type HopSource =
  | { kind: "single" }
  | { kind: "journey"; key: string; fromStop?: number; toStop?: number }
  | { kind: "night"; sessionId: string }
  | { kind: "ids"; ids: string[]; label?: string };

/**
 * The cross-tab verbs every screen uses for an object. Built once in planner.tsx (objectActions) from the existing
 * planner functions and passed as `actions` (SessionPlanner: `objectActions`). Ids may be in any form (see top).
 * `at` previews that instant (planned mode) without changing the page unless the verb navigates.
 */
export interface ObjectActions {
  /** Select the object on Tonight (featured block); BSC stars open the star dialog. */
  inspect(id: string, at?: Date): void;
  /** "Plan star hop": plan and open a single hop. `from` is an object to start from (a BSC star becomes the start star); `journey` keeps the "Back to journey" context. */
  hop(id: string, o?: { at?: Date; from?: string; journey?: JourneyRef }): void;
  /** "Hop the whole journey": plan a chained hop sequence and open Star hop on it. */
  hopChain(src: HopSource, at?: Date): void;
  /** "Moon effect": open Moon with this object as the comparison target. */
  moon(id: string, at?: Date): void;
  /** "Visibility tonight": open the astronomical clock comparing these objects. */
  clock(ids: string[], at?: Date): void;
  /** "See in Catalog": open the Catalog focused on the object (#/catalog?object=<id>). */
  catalog(id: string): void;
  /** "Photos": open the object's photographs (#/catalog?object=<id>&photos=1). */
  images(id: string): void;
  /**
   * "Add to tonight's plan" / "Add all stops to tonight's plan": add-only, in order, deduplicated, at most one new night.
   * `journeyStops` is parallel to `ids` (1-based). `plannedAts` (additive, r5 fix) is parallel to `ids` too: each stop's
   * own time, so the Planner keeps the journey's order and times as one block (night-ops AppendNightMeta.plannedAts).
   */
  addToNight(ids: string[], o?: { at?: Date; journeyKey?: string; journeyStops?: number[]; plannedAts?: (Date | undefined)[] }): void;
  /**
   * True when the night that addToNight would use already holds the object (any id form). With a journey `tag`
   * (additive), true only when the item also carries that journey stop and its planned time, so "Add to tonight's
   * plan" / "Add all stops" stay enabled for stops that are in the night but untagged or untimed, and fill them in.
   */
  isInNight(id: string, tag?: { journeyKey?: string; journeyStop?: number; plannedAt?: Date }): boolean;
  /**
   * "I see it": log an observation on the viewed night. `journey` (additive) tags the item with the journey stop and
   * its planned time, by the same rule as addToNight (session.ts mergeJourneyTag).
   */
  markObserved(id: string, journey?: { journeyKey: string; journeyStop?: number; plannedAt?: Date }): void;
  /** "In journey: …" / "Start here" / "Back to journey" / "Find a journey with this" / "Journey complete": key+stop → field mode, key+done → the summary, key → overview, objectId → Discovery focused on it (#/journeys?focus=<id>). */
  journey(r: { key?: string; objectId?: string; stop?: number; /** Additive (r5 fix 1): with key+stop, the Overview with that stop's card open. */ from?: "overview";
    /** Additive: with key, the journey's summary ("Journey complete", `#/journeys/<key>/done`). */ done?: boolean }): void;
}
const noop = () => {};
/** Inert actions for tests, storybook-like previews and screens rendered outside the planner. */
export const NOOP_ACTIONS: ObjectActions = Object.freeze({
  inspect: noop, hop: noop, hopChain: noop, moon: noop, clock: noop, catalog: noop, images: noop,
  addToNight: noop, isInNight: () => false, markObserved: noop, journey: noop,
});

/** Observing context for components that look at "tonight" (ObjectJourneyLinks level 2). */
export interface ObjectSkyContext { at: Date; lat: number; lon: number; timezone: string; live: boolean; skyBrightness: number; profile: BinocularProfile }

// ───────────────────────────── chained hops ─────────────────────────────

/** One destination of a chained hop. `id` is a routing id (toRoutingId). */
export interface ChainStop {
  id: string;
  label: string;
  kbId?: string;
  /** 1-based journey stop number, when the chain comes from a journey. */
  stop?: number;
  /** The journey engine's "get there" for this stop (compared with the hop planner in LegReport). */
  getThere?: { mode: string; fields?: number };
  /** Naked-eye start star (`HR<n>`) for a leg that starts fresh at this stop (the first leg, a jump): the journey's own anchor. */
  startStarId?: string;
  /** Additive (r5 fix 1): the journey finds this stop itself by eye ("Find Betelgeuse by eye"), so its leg is one field, no hops. */
  byEye?: boolean;
}

/** How a leg of a chain was planned. `jump`: too far for hops (> MAX_CHAIN_LEG_DEG), go by eye then hop from an anchor. */
export type LegStatus = "ok" | "same-field" | "no-route" | "below-horizon" | "anchor-unavailable" | "unresolved" | "jump";

/** Planner quality report for one leg (also the hopper audit record). */
export interface LegReport {
  /** 1-based leg number (= the 1-based index of its destination in ChainResult.stops). */
  leg: number;
  /** Previous stop's routing id; null for the first leg (starts from a naked-eye anchor). */
  from: string | null;
  to: string;
  status: LegStatus;
  /** Fields in this leg's hops (0 when not routed). */
  hops: number;
  distanceDeg: number | null;
  /** Longest hop as a multiple of the field of view. */
  maxHopFov: number | null;
  minPatternScore: number | null;
  routeScore: number | null;
  strategyId?: string;
  usedExpertRoute: boolean;
  /** Planning time. */
  ms: number;
  /** What the journey engine predicted for getting there (to compare with the hop planner). */
  journeyGetThere?: { mode: string; fields?: number };
  /** Plain-language note for the UI ("Needs a naked-eye jump"). */
  note?: string;
  /** Additive (r5 fix 1): the naked-eye star a fresh leg starts from ("By eye to Mirach"), for a jump or the first leg. */
  anchor?: string;
  /** Additive (r5 fix 1): moves a sensible leg of this length takes in this field (legHopBound); more is a detour. */
  hopBound?: number;
}
/** A whole chain: one combined Route (legs concatenated like planRoutes waypoints) plus per-leg reports. */
export interface ChainResult {
  stops: ChainStop[];
  /** Combined route over all routed legs; null when no leg could be routed. */
  route: Route | null;
  /** Chart nodes for the combined route (as planRoutes `nodes`). */
  nodes: SkyNode[];
  /** The final stop's node. */
  targetNode: SkyNode | null;
  legs: LegReport[];
  /** For each stop, the index in route.hops where it is reached; -1 when not reached. */
  stopHopIndex: number[];
  /** Share of legs that were routed (ok or same-field), 0..1. */
  coverage: number;
}

/** A journey an object belongs to, for "In journey: <title> · stop n" / "Start here" links. `stop` is 1-based. */
export interface JourneyLink { key: string; title: string; themeId: string; stop: number; stopCount: number; /** True only when the journey is one of tonight's suggestions (say "tonight" only then). */ tonight: boolean }

/** User-facing link labels; use exactly these everywhere (they replace "Hop to it", "Clock ↗", "Check Moon ↗", "Add to night", "Part of N themes"). */
export const LINK_LABELS = {
  hop: "Plan star hop", hopChain: "Hop the whole journey", /** Planner: a chained hop over the night's viewing order (HopSource night). */ hopPlan: "Hop the whole plan", addToNight: "Add to tonight's plan", addAllToNight: "Add all stops to tonight's plan",
  moon: "Moon effect", clock: "Visibility tonight", catalog: "See in Catalog", images: "Photos",
  /** Only when no real journey tonight includes the object (else inJourney). */
  findJourney: "Find a journey with this",
  startHere: "Start here", backToJourney: "Back to journey", nextStop: "Next stop",
  /** Additive (r5 fix 1), Star hop: replan the shown route; find a dark window for the destination; the bring-your-own-chart page; the chain's end. */
  replan: "Replan route", moonFreeNight: "Find a Moon-free night", ownChart: "Use your own chart", journeyComplete: "Journey complete",
  /** Only when one of tonight's real journeys includes the object. */
  inJourney: (title: string, stop: number) => `In journey: ${title} · stop ${stop}`,
} as const;
