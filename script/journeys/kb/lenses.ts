/**
 * Theme lenses for the Sky Journeys KB build (owner feedback round 2, docs/sky-journeys/owner-feedback-r2.md).
 *
 * Source: script/journeys/curated/lenses/<archetype>.json, one file per active theme (format: ThemeLensFileSchema in
 * client/src/lib/journeys/kb-schema.ts). The build
 *   - validates every file (shape, archetype = file name and an active template, object ids in the KB and
 *     journey-eligible, steps from the beats, questions of at most 16 words ending with "?", no banned phrases,
 *     narration keys that belong to the theme, placeholders the narrator knows, hook lines of at most 90 characters,
 *     a transition for every way into every beat, lens stories of 1-4 sentences, beat-aware narration keys
 *     payoff|story|title.<templateId>.end<step>[.no<step>] naming real beats, verdicts as short lower-case noun phrases for the
 *     payoff's {tally}), reporting each problem with
 *     its file and object id, and no sentence over 220 characters in lens text (LONG_SENTENCE_IS_ERROR; a catalog code
 *     in a lens story is a note, not an error);
 *   - merges each file's `narration` into the narration bank (the theme's lines replace the bank's);
 *   - writes the runtime sets (storyline, beats, minBeats, endSteps, firstSteps, keySteps, transitions, objects) to
 *     lenses.json.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { claimsSplit, splitsAt } from '../../../client/src/lib/journeys/candidates';
import { ThemeLensFileSchema, lensIssues } from '../../../client/src/lib/journeys/kb-schema';
import type { KbObject, NarrationBank, Template, ThemeLensSet } from '../../../client/src/lib/journeys/types';
import { BANNED, CATALOG_CODE, SENTENCE_MAX_CHARS, splitSentences } from '../../../client/src/lib/journeys/voice';
import { byString, orderKeys, readJson, type Obj } from './util';

export interface LensSource { file: string; raw: unknown }
export interface LoadedLens { file: string; set: ThemeLensSet; narration: Record<string, string[]> }

export const LENS_FILE_RE = /^(A\d{1,2})\.json$/;

/** Every lens file of `dir` (sorted), or none when the directory does not exist. */
export function readLensSources(dir: string): LensSource[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => LENS_FILE_RE.test(f)).sort(byString).map((f) => ({ file: `script/journeys/curated/lenses/${f}`, raw: readJson(resolve(dir, f)) }));
}

/**
 * Sentences over SENTENCE_MAX_CHARS characters in lens text (storyline, narration, transitions, an object's question,
 * why, look, answer and story) are build errors. Set this to false to report them as notes instead (while a lens file
 * is mid-edit); build_kb prints those notes even with --check.
 */
export const LONG_SENTENCE_IS_ERROR = true;
/** Prefix of a long-sentence report (build_kb --check prints these notes). */
export const LONG_SENTENCE_TAG = 'long sentence';

/** Longest lens verdict (words): several verdicts share one {tally} sentence, which must stay under 220 characters. */
export const VERDICT_MAX_WORDS = 10;

/** Placeholders the narrator fills in theme narration overrides (besides the bank's documented ones). */
const LENS_PLACEHOLDERS = new Set(['prev', 'next', 'name', 'hook', 'kind', 'region', 'ago', 'year', 'sharedKind', 'prevKind', 'nextKind', 'claim', 'question', 'theme', 'themeQuestion', 'tally']);
/**
 * Placeholders a lens transition may use: the two stops' names ({prev}, {next}; {name} = {next}), the opening stop
 * ({hook}), the arriving stop's plain kind ({kind}, with its article) and its light-travel time ({ago}, {year}).
 * Anything else could not be filled for every pair of stops, and the line would be skipped.
 */
export const TRANSITION_PLACEHOLDERS: ReadonlySet<string> = new Set(['prev', 'next', 'name', 'hook', 'kind', 'ago', 'year']);

/**
 * Parse + check the lens files against the merged KB. Returns the loaded sets and every problem (build errors).
 * `eligible` is the journey-eligibility gate; `templates` are the ACTIVE templates (retired ones already dropped).
 */
export function loadLenses(
  sources: readonly LensSource[], objects: readonly KbObject[], templates: readonly Template[], bank: NarrationBank,
  eligible: (o: KbObject) => boolean,
): { lenses: LoadedLens[]; issues: string[]; notes: string[] } {
  const issues: string[] = [];
  // Not errors: what the engine reads from the lens (a promised split is honoured only by binoculars that make it).
  const notes: string[] = [];
  const lenses: LoadedLens[] = [];
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const known = new Set([...Object.keys(bank.placeholders ?? {}), ...Array.from(LENS_PLACEHOLDERS)]);
  for (const src of sources) {
    const parsed = ThemeLensFileSchema.safeParse(src.raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push(`${src.file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
      continue;
    }
    const f = parsed.data;
    const fileArch = LENS_FILE_RE.exec(src.file.split('/').pop()!)?.[1];
    if (fileArch !== f.archetype) issues.push(`${src.file}: archetype "${f.archetype}" does not match the file name`);
    const { narration = {}, ...set } = f;
    const own: ThemeLensSet = set;
    const where = (x: string) => `${src.file}: ${x.replace(/^lens A\d+:?\s*/, '')}`;
    for (const x of lensIssues([own], { objects: objects as KbObject[], templates: templates as Template[] })) issues.push(where(x));
    const tids = templates.filter((t) => t.archetype === f.archetype).map((t) => t.id);
    const banned = (what: string, text: string) => { if (BANNED.test(text)) issues.push(`${src.file}: ${what}: banned phrase or "!" in "${text.slice(0, 80)}"`); };
    const placeholders = (what: string, text: string, allowed: ReadonlySet<string> = known) => {
      for (const m of Array.from(text.matchAll(/\{(\w+)\}/g))) if (!allowed.has(m[1])) issues.push(`${src.file}: ${what}: unknown placeholder {${m[1]}}${allowed === known ? '' : ` (transitions may use ${Array.from(allowed).map((x) => `{${x}}`).join(' ')})`}`);
    };
    // Voice rule (voice.md "Sentence length"): no sentence over SENTENCE_MAX_CHARS characters, measured as written.
    const long = (what: string, text: string) => {
      for (const s of splitSentences(text)) {
        if (s.length > SENTENCE_MAX_CHARS) (LONG_SENTENCE_IS_ERROR ? issues : notes).push(`${src.file}: ${what}: ${LONG_SENTENCE_TAG} of ${s.length} characters (max ${SENTENCE_MAX_CHARS}): "${s.slice(0, 60)}…"`);
      }
    };
    banned('storyline', f.storyline);
    long('storyline', f.storyline);
    for (const b of f.beats) banned(`beat ${b.step} label`, b.label);
    for (const [oid, lens] of Object.entries(f.objects)) {
      const o = byId.get(oid);
      if (o && !eligible(o)) issues.push(`${src.file}: object ${oid}: not journey-eligible (${o.provenance?.ineligibleReason ?? o.provenance?.status ?? 'incomplete card'})`);
      if (lens.minMagnification !== undefined) notes.push(`${src.file}: object ${oid} is a stop only at ${lens.minMagnification}× or more (minMagnification)`);
      if (o && o.kind === 'star' && o.multiplicity?.pairs.length && claimsSplit(lens.look)) {
        notes.push(`${src.file}: object ${oid} look promises a split: 10x50 ${splitsAt(o, 10) ? 'yes' : 'no'}, 7x35 ${splitsAt(o, 7) ? 'yes' : 'no'} (the engine skips it where the answer is no)`);
      }
      for (const k of ['beat', 'verdict', 'question', 'why', 'look', 'answer', 'story'] as const) {
        const v = lens[k];
        if (v === undefined) continue;
        banned(`object ${oid} ${k}`, v);
        if (k !== 'beat' && k !== 'verdict') long(`object ${oid} ${k}`, v);
        if (/\{\w+\}/.test(v)) issues.push(`${src.file}: object ${oid} ${k}: placeholders are not filled in lens card text`);
      }
      // The verdict is a short noun phrase the payoff's {tally} sets after "turned out to be" ("a real pair").
      if (lens.verdict !== undefined && (/[.!?;:,]/.test(lens.verdict) || /^[A-Z]/.test(lens.verdict) || lens.verdict.split(/\s+/).length > VERDICT_MAX_WORDS)) {
        issues.push(`${src.file}: object ${oid} verdict: a lower-case noun phrase of at most ${VERDICT_MAX_WORDS} words without commas or end punctuation ("a real pair")`);
      }
      // Voice rule (a common name, not a catalog code, when one exists): a note only, since some objects have none.
      const code = lens.story !== undefined ? CATALOG_CODE.exec(lens.story) : null;
      if (code) notes.push(`${src.file}: object ${oid} story: catalog code "${code[0]}" in prose (use the common name when there is one)`);
    }
    // Beats the theme can actually tell (an object with a lens there), and a transition for every way into a beat.
    const told = new Set(Object.values(f.objects).map((l) => l.step));
    const toldBeats = f.beats.filter((b) => told.has(b.step)).length;
    if (toldBeats < f.minBeats) issues.push(`${src.file}: only ${toldBeats} beats have an object, fewer than minBeats ${f.minBeats}`);
    const steps = f.beats.map((b) => b.step).sort((a, b) => a - b);
    const pairs = f.transitions?.pairs ?? {}, arrive = f.transitions?.arrive ?? {};
    for (const b of f.beats) {
      if (arrive[String(b.step)]) continue;
      const missing = steps.filter((a) => a < b.step && !pairs[`${a}>${b.step}`]).map((a) => `${a}>${b.step}`);
      if ((b.maxStops ?? 1) > 1 && !pairs[`${b.step}>${b.step}`]) missing.push(`${b.step}>${b.step}`);
      if (missing.length) issues.push(`${src.file}: beat ${b.step} ("${b.label}") has no arrive line and no transition for ${missing.join(', ')}`);
    }
    for (const [k, vs] of [...Object.entries(pairs), ...Object.entries(arrive)]) {
      for (const v of vs) { banned(`transition ${k}`, v); long(`transition ${k}`, v); placeholders(`transition ${k}`, v, TRANSITION_PLACEHOLDERS); }
    }
    const beatSteps = new Set(f.beats.map((b) => b.step));
    for (const [k, vs] of Object.entries(narration)) {
      if (!tids.some((tid) => k === tid || k.endsWith(`.${tid}`) || k.includes(`.${tid}.`))) {
        issues.push(`${src.file}: narration key "${k}" does not belong to ${f.archetype} (${tids.join(', ') || 'no active template'})`);
      }
      // Beat-aware variants (payoff|story|title.<tid>.end<step>[.no<step>]): the journey's last beat must be real, and
      // a skipped beat (.no<step>) must be a real beat before it.
      const end = /^(payoff|story|title)\.(.+?)\.end(-?\d+)(?:\.no(-?\d+))?$/.exec(k);
      if (end && tids.includes(end[2]) && !beatSteps.has(Number(end[3]))) {
        issues.push(`${src.file}: narration key "${k}": end${end[3]} is not a beat (${Array.from(beatSteps).join(', ')})`);
      }
      if (end?.[4] !== undefined && tids.includes(end[2]) && (!beatSteps.has(Number(end[4])) || Number(end[4]) >= Number(end[3]))) {
        issues.push(`${src.file}: narration key "${k}": no${end[4]} must name a beat before end${end[3]}`);
      }
      if (/^(payoff|story|title)\./.test(k) && /\.(end|no)/.test(k) && !end) issues.push(`${src.file}: narration key "${k}": beat variants read "<family>.<templateId>.end<step>[.no<step>]"`);
      for (const v of vs) {
        banned(`narration ${k}`, v);
        long(`narration ${k}`, v);
        placeholders(`narration ${k}`, v);
        if (k.startsWith('hook.') && v.length > 90) issues.push(`${src.file}: narration ${k}: hook line over 90 characters`);
      }
    }
    lenses.push({ file: src.file, set: normaliseSet(own), narration });
  }
  return { lenses: lenses.sort((a, b) => byString(a.set.archetype, b.set.archetype)), issues, notes };
}

/** Stable key order (diffable lenses.json). */
function normaliseSet(set: ThemeLensSet): ThemeLensSet {
  const objects: Record<string, ThemeLensSet['objects'][string]> = {};
  for (const id of Object.keys(set.objects).sort(byString)) objects[id] = orderKeys(set.objects[id] as unknown as Obj, ['step', 'rank', 'minMagnification', 'beat', 'verdict', 'question', 'why', 'look', 'answer', 'story']) as unknown as ThemeLensSet['objects'][string];
  const out: ThemeLensSet = {
    archetype: set.archetype, storyline: set.storyline,
    beats: set.beats.slice().sort((a, b) => a.step - b.step),
    minBeats: set.minBeats,
    ...(set.endSteps ? { endSteps: set.endSteps.slice().sort((a, b) => a - b) } : {}),
    ...(set.firstSteps ? { firstSteps: set.firstSteps.slice().sort((a, b) => a - b) } : {}),
    ...(set.keySteps ? { keySteps: set.keySteps.slice().sort((a, b) => a - b) } : {}),
    ...(set.transitions ? { transitions: set.transitions } : {}),
    objects,
  };
  return out;
}

/** The bank with every lens file's narration lines replacing the bank's (theme-level overrides). */
export function mergeLensNarration(bank: NarrationBank, lenses: readonly LoadedLens[], log: (s: string) => void): NarrationBank {
  const variants = { ...bank.variants };
  for (const L of lenses) {
    for (const [k, v] of Object.entries(L.narration)) {
      log(`${L.file}: narration ${k} ${variants[k] ? 'overrides the bank' : 'added'} (${v.length} variants)`);
      variants[k] = v.slice();
    }
  }
  return { ...bank, variants };
}
