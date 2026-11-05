/**
 * One short description per object, shared by every tab (integration r5): Tonight's featured object and cards, Star
 * hop, Catalog, Binoculars and the journeys' stop cards show the same text; journeys add their own story on top.
 *
 * Sources, in priority order:
 *  1. OBJECT_GUIDES (observing.ts): curated story + what to look for, the Tonight showpieces.
 *  2. Binoculars guide (binocular-guide.ts BINOCULAR_ENTRIES, incl. binocular-guide-extra.json): impression + finding.
 *  3. Catalog record (`target.desc` + `binoTip`), when it is a real sentence and not catalog boilerplate.
 *  4. Generic "<label> is a <category> in <constellation>." (needs the target).
 *
 * Any id form resolves to the same summary (STAR-Betelgeuse = HR2061 = star:HR2061, legacy alias ids) through
 * object-links' objectKey. Pure; no KB import.
 */
import { getConstellationName, type UnifiedTarget } from "./astronomy";
import { BINOCULAR_ENTRIES, type BinocularEntry } from "./binocular-guide";
import { displayName, objectKey, toSessionId } from "./object-links";
import { OBJECT_GUIDES } from "./observing";

export type ObjectSummarySource = "guide" | "binocular-guide" | "catalog" | "generic";
export interface ObjectSummary {
  /** One or two sentences (about 220 characters at most): what the object is / what it looks like. */
  text: string;
  /** Where or how to find it / what to look for, when a source has it. */
  lookFor?: string;
  source: ObjectSummarySource;
}
export interface ObjectSummaryOptions {
  /** The unified target (or a star:HR planning target), when the caller has it: enables catalog and generic text. */
  target?: UnifiedTarget;
  /** The loaded unified targets, used to find the target when `target` is not given. */
  targets?: readonly UnifiedTarget[];
}

/** Soft length cap: whole sentences up to this many characters (the first sentence is always kept). */
export const SUMMARY_MAX_CHARS = 220;

let entryIndex: Map<string, BinocularEntry> | null = null;
function binocularEntry(key: string): BinocularEntry | undefined {
  if (!entryIndex) {
    entryIndex = new Map();
    // First entry wins, like binocularCollection's catalog order.
    for (const e of BINOCULAR_ENTRIES) { const k = objectKey(e.targetId); if (!entryIndex.has(k)) entryIndex.set(k, e); }
  }
  return entryIndex.get(key);
}

/** Catalog `desc` texts that describe the catalog, not the object. */
const BOILERPLATE = [
  /^Binocular target in the Astronomical League/i,
  /^Named star; coordinates/i,
  /^Position and magnitude from the bundled/i,
];
const isBoilerplate = (text: string) => BOILERPLATE.some((re) => re.test(text.trim()));

/** Whole sentences up to `max` characters; the first sentence always stays. */
export function clipSentences(text: string, max = SUMMARY_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [clean];
  let out = sentences[0].trim();
  for (const s of sentences.slice(1)) {
    const next = `${out} ${s.trim()}`;
    if (next.length > max) break;
    out = next;
  }
  return out;
}
const sentence = (text: string) => { const t = text.trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };

function findTarget(id: string, key: string, opts: ObjectSummaryOptions): UnifiedTarget | undefined {
  if (opts.target) return opts.target;
  if (!opts.targets) return undefined;
  const ids = new Set([id, key, toSessionId(key)]);
  return opts.targets.find((t) => ids.has(t.id));
}

/** Constellation abbreviations in guide text read as names ("in Per" → "in Perseus"), as on the Binoculars tab. */
function expandConstellation(text: string, con?: string): string {
  if (!con) return text;
  const name = getConstellationName(con);
  return name && name !== con ? text.replace(new RegExp(`\\b${con}\\b`, "g"), name) : text;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * The shared short description of an object, or null when nothing is known about it (an unknown id without a target).
 * `id` may be any form (unified id, HR<n>, star:HR<n>, legacy alias).
 */
export function objectSummary(id: string, opts: ObjectSummaryOptions = {}): ObjectSummary | null {
  const key = objectKey(id);
  const target = findTarget(id, key, opts);
  const con = target?.con || undefined;

  const guide = OBJECT_GUIDES[key];
  if (guide) return { text: clipSentences(guide.story), lookFor: guide.lookFor, source: "guide" };

  const entry = binocularEntry(key);
  if (entry) return { text: clipSentences(expandConstellation(entry.impression, con)), lookFor: expandConstellation(entry.finding, con), source: "binocular-guide" };

  if (!target) return null;
  const tip = target.binoTip?.trim() ? sentence(target.binoTip) : undefined;
  // Messier records carry only "<type>, <size>'" as desc: not a description.
  if (target.source !== "messier" && target.desc?.trim() && !isBoilerplate(target.desc)) {
    return { text: clipSentences(sentence(target.desc)), ...(tip ? { lookFor: tip } : {}), source: "catalog" };
  }

  const category = (target.category || "object").toLowerCase();
  const where = con ? ` in ${getConstellationName(con)}` : "";
  return { text: `${displayName(target)} is ${article(category)} ${category}${where}.`, ...(tip ? { lookFor: tip } : {}), source: "generic" };
}

/** The summary text alone ("" when nothing is known). */
export function objectSummaryText(id: string, opts: ObjectSummaryOptions = {}): string {
  return objectSummary(id, opts)?.text ?? "";
}
