/**
 * Sky Journeys knowledge-base build (merge). Spec: docs/sky-journeys/00-spec.md decision 8; rules:
 * script/journeys/README.md ("Merge rule", "Journey-eligible").
 *
 *   npm run journeys:kb                 # = npx tsx script/journeys/build_kb.ts
 *   npx tsx script/journeys/build_kb.ts --check   # build + validate, write nothing
 *
 * Inputs (all local, so the build reruns offline and deterministically):
 *   script/journeys/object-list.json                       master list (ids, positions, batch)
 *   script/journeys/generated/{stars,dso}.auto.json        auto tier
 *   script/journeys/generated/media.auto.json              survey cutouts per object
 *   script/journeys/generated/media.licensed.json          localised licensed photographs (optional)
 *   script/journeys/generated/media.fill.json              survey fields + photos for objects with no other image (optional)
 *   script/journeys/curated/<batch>-<stars|dso>.json       curated tier (12 files)
 *   script/journeys/curated/_fixes.json                    merge-layer fixes owned by this build
 *   script/journeys/sources.canonical.json                 canonical source registry + alias map
 *   script/journeys/kb/narration-extra.json                comparison lines the shared bank lacks
 *   script/journeys/curated/lenses/<archetype>.json        theme lenses (owner feedback r2; optional, kb/lenses.ts)
 *   client/public/data/journeys/src/{concepts,templates,narration}.json
 * Outputs (client/public/data/journeys/): kb.json, edges.json, concepts.json, templates.json, narration.json,
 * lenses.json, story-seeds.json; plus docs/sky-journeys/kb-report.md. The build fails (exit 1, nothing written)
 * unless knowledgeBaseFromFiles() accepts the result with zero issues and every lens file passes its checks.
 * Retired templates (src/templates.json "retired": true: A4, A7, A10) are dropped from the built
 * templates, and every chainTo / switchRule reference to them is removed.
 *   --no-lenses      build as if script/journeys/curated/lenses/ were empty
 *   --lenses <dir>   read the lens files from <dir> instead (try a draft with --check)
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConceptsJsonFileSchema, KnowledgeBaseError, NarrationBankSchema, TemplatesJsonFileSchema, knowledgeBaseFromFiles,
} from '../../client/src/lib/journeys/kb-schema';
import {
  FACT_KEYS, type ContextNode, type Edge, type FactKey, type FactValue, type KbImage, type KbObject,
  type NarrationBand, type NarrationBank, type Source, type Template, type ThemeLensSet,
} from '../../client/src/lib/journeys/types';
import { LONG_SENTENCE_TAG, loadLenses, mergeLensNarration, readLensSources } from './kb/lenses';
import { renderReport, type BuildLog, type StorySeed } from './kb/report';
import {
  byString, canonical, clone, isObj, orderKeys, readJson, readJsonIfExists, same, sha256, uniq, writeJson, writeText,
  type Obj,
} from './kb/util';

// ───────────────────────────── paths ─────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const P = {
  objectList: resolve(HERE, 'object-list.json'),
  starsAuto: resolve(HERE, 'generated/stars.auto.json'),
  dsoAuto: resolve(HERE, 'generated/dso.auto.json'),
  mediaAuto: resolve(HERE, 'generated/media.auto.json'),
  mediaLicensed: resolve(HERE, 'generated/media.licensed.json'),
  mediaFill: resolve(HERE, 'generated/media.fill.json'),
  curatedDir: resolve(HERE, 'curated'),
  fixes: resolve(HERE, 'curated/_fixes.json'),
  canonical: resolve(HERE, 'sources.canonical.json'),
  narrationExtra: resolve(HERE, 'kb/narration-extra.json'),
  lensDir: resolve(HERE, 'curated/lenses'),
  srcDir: resolve(ROOT, 'client/public/data/journeys/src'),
  outDir: resolve(ROOT, 'client/public/data/journeys'),
  publicDir: resolve(ROOT, 'client/public'),
  report: resolve(ROOT, 'docs/sky-journeys/kb-report.md'),
};
const rel = (p: string) => p.slice(ROOT.length + 1);

// ───────────────────────────── input shapes ─────────────────────────────

interface ListEntry {
  id: string; kind: 'star' | 'dso'; hr?: number; name: string; con: string; ra: number; dec: number;
  mag: number | null; existing: boolean; batch: string; selection: string[]; note?: string;
}
interface TierFile { version?: string; sources: Source[]; objects: Obj[] }
interface CuratedFile extends TierFile {
  batch: string; kind: 'star' | 'dso'; version: string; curator: string;
  edges: Edge[]; contexts: ContextNode[]; narration?: Record<string, string[]>; storySeeds?: Obj[];
}
interface Canonical { version: string; sources: Source[]; aliases: Record<string, string>; renames: Record<string, Record<string, string>> }
interface ObjectFix { patch?: Obj; journeyIneligible?: string; why?: string }
interface Fixes { objectFixes?: Record<string, ObjectFix>; contextFixes?: Record<string, { addMembers?: string[]; why?: string }> }
interface LicensedEntry {
  objectId: string; imageIndex: number; originalUrl: string; sourcePageUrl?: string; localPath: string; credit: string;
  license: string; caption?: string; variant?: KbImage['variant']; fieldDeg?: number; largePath?: string;
}
interface LicensedFile { images: LicensedEntry[]; skipped?: { objectId: string; imageIndex: number; originalUrl: string; reason: string }[] }
interface MediaAuto { objects: Record<string, { images: KbImage[] }> }
/** fetch_media_fill.py: images for objects that get none from curated / licensed / auto media. */
interface MediaFill { version?: string; objects: Record<string, { images: KbImage[] }> }
interface NarrationExtra {
  variants: Record<string, string[]>;
  bands: Record<string, NarrationBand[]>;
  citations: Record<string, string[]>;
  periodBands: { keys: string[]; bands: NarrationBand[]; variants: Record<string, string[]> };
}

// ───────────────────────────── load ─────────────────────────────

const CURATED_RE = /^(winter|spring|summer-north|summer-south|autumn|southern)-(stars|dso)\.json$/;

function loadInputs(opts: BuildOptions = {}) {
  const list = readJson<{ objects: ListEntry[] }>(P.objectList).objects;
  const starsAuto = readJson<TierFile>(P.starsAuto);
  const dsoAuto = readJson<TierFile>(P.dsoAuto);
  const mediaAuto = readJsonIfExists<MediaAuto>(P.mediaAuto);
  const licensed = readJsonIfExists<LicensedFile>(P.mediaLicensed);
  const mediaFill = readJsonIfExists<MediaFill>(P.mediaFill);
  const curatedNames = readdirSync(P.curatedDir).filter((f) => CURATED_RE.test(f)).sort(byString);
  const curated = curatedNames.map((f) => ({ key: f.replace(/\.json$/, ''), file: readJson<CuratedFile>(resolve(P.curatedDir, f)) }));
  const fixes = readJsonIfExists<Fixes>(P.fixes) ?? {};
  const canon = readJson<Canonical>(P.canonical);
  const extra = readJson<NarrationExtra>(P.narrationExtra);
  const concepts = readJson<Obj>(resolve(P.srcDir, 'concepts.json'));
  const templates = readJson<Obj>(resolve(P.srcDir, 'templates.json'));
  const narration = readJson<NarrationBank>(resolve(P.srcDir, 'narration.json'));
  const lensSources = opts.lenses === false ? [] : readLensSources(opts.lensDir ?? P.lensDir);
  return { list, starsAuto, dsoAuto, mediaAuto, licensed, mediaFill, curated, fixes, canon, extra, concepts, templates, narration, lensSources };
}

/**
 * Active templates (A4 Time Machine and A10 Stars That Change since owner feedback r2, A7 Record Breakers
 * later, are retired as journeys; their content stays as card facts): drop every template marked "retired": true, and every chainTo / switchRule target naming one.
 */
export function activeTemplates(file: Obj, log: (s: string) => void = () => {}): Obj {
  const all = (file.templates as Obj[]) ?? [];
  const retired = new Set(all.filter((t) => t.retired === true).map((t) => t.id as string));
  const templates = all.filter((t) => !retired.has(t.id as string)).map((t0) => {
    const t = clone(t0);
    delete t.retired;
    if (Array.isArray(t.chainTo)) {
      const kept = (t.chainTo as string[]).filter((x) => !retired.has(x));
      if (kept.length !== (t.chainTo as string[]).length) log(`template ${t.id as string}: chainTo ${(t.chainTo as string[]).filter((x) => retired.has(x)).join(', ')} retired`);
      if (kept.length) t.chainTo = kept; else delete t.chainTo;
    }
    const sr = t.switchRule as Obj | undefined;
    if (sr) {
      const to = (sr.to as string[]).filter((x) => !retired.has(x));
      if (!to.length) { delete t.switchRule; log(`template ${t.id as string}: switch rule dropped (its targets are retired)`); } else sr.to = to;
    }
    return t;
  });
  return { ...file, templates };
}

// ───────────────────────────── source ids ─────────────────────────────

/** Keys whose values are source ids (string) or source-id lists (string[]) anywhere inside a record. */
const SOURCE_ID_KEYS = new Set(['sourceId', 'sourceIds', 'sources', 'evidenceIds']);

/** Rewrite every source id inside `node` (in place) through `map`; returns the set of ids seen (after mapping). */
function rewriteSourceIds(node: unknown, map: (id: string) => string, seen = new Set<string>()): Set<string> {
  if (Array.isArray(node)) { node.forEach((x) => rewriteSourceIds(x, map, seen)); return seen; }
  if (!isObj(node)) return seen;
  for (const [k, v] of Object.entries(node)) {
    if (SOURCE_ID_KEYS.has(k) && typeof v === 'string') { node[k] = map(v); seen.add(node[k] as string); continue; }
    if (SOURCE_ID_KEYS.has(k) && Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      node[k] = uniq((v as string[]).map(map));
      (node[k] as string[]).forEach((x) => seen.add(x));
      continue;
    }
    rewriteSourceIds(v, map, seen);
  }
  return seen;
}

const collectSourceIds = (node: unknown): Set<string> => rewriteSourceIds(clone(node), (x) => x);

function sourceMapper(canon: Canonical, fileKey: string, log: BuildLog) {
  const renames = canon.renames[fileKey] ?? {};
  return (id: string): string => {
    let out = renames[id] ?? id;
    if (canon.aliases[out]) out = canon.aliases[out];
    if (out !== id) log.sourceRewrites[`${id} → ${out}`] = (log.sourceRewrites[`${id} → ${out}`] ?? 0) + 1;
    return out;
  };
}

// ───────────────────────────── object merge ─────────────────────────────

const STAR_ONLY = ['spectral', 'evolutionaryStage', 'stageConfidence', 'variability', 'multiplicity', 'membershipRole',
  'population', 'exoplanets', 'pmRA', 'pmDec', 'view'] as const;
const DSO_ONLY = ['dsoClass', 'secondaryClasses', 'traits', 'morphology', 'extent', 'poweredBy', 'view', 'appearance'] as const;
const BASE_HEAD = ['id', 'kind', 'hr', 'names', 'con', 'ra', 'dec', 'mag'] as const;
const BASE_TAIL = ['facts', 'evoStage', 'contextIds', 'teaches', 'roles', 'wow', 'insight', 'obsDifficulty', 'superlatives',
  'misconceptions', 'historyHook', 'showpiece', 'interest', 'eventDependent', 'media', 'card', 'sources', 'provenance'] as const;
const STAR_ORDER = [...BASE_HEAD, ...STAR_ONLY.filter((k) => k !== 'view'), 'view', ...BASE_TAIL];
const DSO_ORDER = [...BASE_HEAD, ...DSO_ONLY, ...BASE_TAIL];
/** Fields taken from object-list / auto, never from the curated tier (README merge rule 5; task brief). */
const POSITIONAL = new Set(['id', 'kind', 'ra', 'dec', 'con', 'mag', 'hr', 'provenance', 'sources', 'facts', 'names', 'media']);
const CARD_ORDER = ['question', 'glance', 'whyHere', 'see', 'understand', 'wonder', 'connect', 'answer', 'numbers', 'photoCaption', 'notSee', 'deeper', 'tier'];
const FACT_ORDER = ['value', 'min', 'max', 'unit', 'sourceId', 'method', 'note'];

function orderFacts(f: Obj): Obj {
  const out: Obj = {};
  for (const k of FACT_KEYS) if (f[k]) out[k] = orderKeys(f[k] as Obj, FACT_ORDER);
  return out;
}

/** Apply a curated-style patch onto `base` (facts per key, null deletes, everything else replaces). */
function applyPatch(base: Obj, patch: Obj, overrides: string[] | null, auto: Obj | null): void {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'facts' && isObj(v)) {
      const facts = (base.facts ?? {}) as Obj;
      const autoFacts = (auto?.facts ?? {}) as Obj;
      for (const [fk, fv] of Object.entries(v)) {
        const had = autoFacts[fk] !== undefined;
        if (fv === null) {
          if (facts[fk] !== undefined && overrides && had) overrides.push(`facts.${fk}`);
          delete facts[fk];
        } else {
          if (overrides && had && !same(autoFacts[fk], fv)) overrides.push(`facts.${fk}`);
          facts[fk] = clone(fv);
        }
      }
      base.facts = facts;
      continue;
    }
    if (overrides && auto && auto[k] !== undefined && !same(auto[k], v)) overrides.push(k);
    if (v === null && k !== 'mag' && k !== 'evoStage') delete base[k];
    else base[k] = clone(v);
  }
}

const PLACEHOLDER_TEXT = 'Not yet curated for Sky Journeys.';

function mergeObject(
  e: ListEntry, auto: Obj | undefined, cur: Obj | undefined, curFile: { key: string; file: CuratedFile } | undefined,
  media: { auto: MediaAuto | null; licensed: LicensedFile | null; fill: MediaFill | null }, fix: ObjectFix | undefined, log: BuildLog,
): Obj {
  const overrides: string[] = [];
  const a = auto ? clone(auto) : null;
  const out: Obj = {};
  if (a) {
    for (const [k, v] of Object.entries(a)) if (!['auto', 'provenance'].includes(k)) out[k] = v;
  }
  // curated tier, field by field (facts per key)
  if (cur) {
    const patch: Obj = {};
    for (const [k, v] of Object.entries(cur)) if (!POSITIONAL.has(k)) patch[k] = v;
    applyPatch(out, patch, overrides, a);
    applyPatch(out, { facts: cur.facts ?? {} }, overrides, a);
    log.curatedFacts[e.id] = Object.entries((cur.facts ?? {}) as Obj).filter(([, v]) => v !== null).map(([k]) => k);
  }
  // names: curated display/designation/simbadId win; aliases are the union (search needs the catalog ids)
  const an = (a?.names ?? null) as Obj | null;
  const cn = (cur?.names ?? null) as Obj | null;
  const names: Obj = { ...(an ?? {}), ...(cn ?? {}) };
  if (!names.display) names.display = e.name;
  const seenAlias = new Set<string>();
  names.aliases = [...((cn?.aliases as string[]) ?? []), ...((an?.aliases as string[]) ?? [])].filter((x) => {
    const k = x.toLowerCase();
    if (seenAlias.has(k) || x === names.display) return false;
    seenAlias.add(k);
    return true;
  });
  if (an && cn && (an.display !== cn.display || (an.designation ?? null) !== (cn.designation ?? null))) overrides.push('names');
  out.names = orderKeys(names, ['display', 'designation', 'aliases', 'simbadId']);

  // positions and identity from the master list (auto mag first: max light for variables)
  out.id = e.id;
  out.kind = e.kind;
  out.con = e.con;
  out.ra = e.ra;
  out.dec = e.dec;
  const hr = e.hr ?? (cur?.hr as number | undefined) ?? (a?.hr as number | undefined);
  if (hr) out.hr = hr; else delete out.hr;
  const autoMag = a?.mag as number | null | undefined;
  const curMag = cur?.mag as number | null | undefined;
  out.mag = autoMag ?? curMag ?? e.mag ?? null;
  if (typeof autoMag === 'number' && typeof curMag === 'number' && Math.abs(autoMag - curMag) > 0.3) {
    log.magConflicts.push({ id: e.id, auto: autoMag, curated: curMag });
  }
  if (cur && (cur.ra !== undefined || cur.dec !== undefined) && e.hr && (cur.ra !== e.ra || cur.dec !== e.dec)) {
    log.notes.push(`${e.id}: curated ra/dec ignored for a BSC star (positions come from object-list.json)`);
  }

  // facts: drop unknown keys, keep FACT_KEYS order
  const facts = (out.facts ?? {}) as Obj;
  for (const k of Object.keys(facts)) {
    if (!(FACT_KEYS as readonly string[]).includes(k)) { log.dropped.push({ id: e.id, what: `facts.${k}`, why: 'not a FactKey' }); delete facts[k]; }
  }
  out.facts = facts;

  // media: curated images replace auto (README rule 3); fallback media.auto.json, then the auto record
  const curMedia = (cur?.media ?? null) as Obj | null;
  const autoImages = (media.auto?.objects[e.id]?.images ?? (a?.media as Obj | undefined)?.images ?? []) as KbImage[];
  let images: KbImage[] = clone((curMedia?.images as KbImage[] | undefined)?.length ? (curMedia!.images as KbImage[]) : autoImages);
  if (curMedia?.images && (curMedia.images as KbImage[]).length) {
    images = localiseLicensed(e.id, images, media.licensed, log);
  }
  const keepImage = (list: KbImage[]) => list.filter((im, i) => {
    if (/^https?:/.test(im.src)) { log.images.remote.push({ id: e.id, src: im.src }); return true; }
    if (!existsSync(resolve(P.publicDir, im.src))) { log.images.missingFile.push({ id: e.id, src: im.src }); return false; }
    if (im.large && !existsSync(resolve(P.publicDir, im.large))) { log.images.missingFile.push({ id: e.id, src: im.large }); delete im.large; }
    return list.findIndex((x) => x.src === im.src) === i;
  });
  images = keepImage(images);
  // fill: survey field / showpiece photo for objects that would otherwise have no picture (owner brief r1)
  if (!images.length && media.fill?.objects[e.id]?.images.length) {
    images = keepImage(clone(media.fill.objects[e.id].images));
    if (images.length) log.images.filled.push({ id: e.id, src: images[0].src });
  }
  const visuals = (curMedia?.visuals ?? (a?.media as Obj | undefined)?.visuals ?? []) as unknown[];
  out.media = { images: images.map((im) => orderKeys(im as unknown as Obj, ['src', 'large', 'credit', 'license', 'caption', 'fieldDeg', 'variant', 'sourceUrl'])), visuals };

  // auto-only records still need every KbObject field (they ship for the inspector, never for journeys)
  if (!cur) {
    log.autoOnly.push(e.id);
    Object.assign(out, {
      evoStage: out.evoStage ?? null, contextIds: [], teaches: [], roles: out.roles ?? [], wow: 1, insight: 1, obsDifficulty: 3,
      superlatives: [], misconceptions: [], showpiece: false, interest: 0,
      card: { glance: PLACEHOLDER_TEXT, whyHere: PLACEHOLDER_TEXT, see: PLACEHOLDER_TEXT, understand: PLACEHOLDER_TEXT,
        wonder: PLACEHOLDER_TEXT, connect: PLACEHOLDER_TEXT, numbers: [], photoCaption: PLACEHOLDER_TEXT, tier: 'supporting' },
    });
  }

  // provenance
  const cp = (cur?.provenance ?? {}) as Obj;
  const prov: Obj = {
    status: cur ? (cp.status === 'reviewed' ? 'reviewed' : 'curated') : 'auto',
    batch: e.batch,
    curatedBy: cp.curatedBy ?? curFile?.file.curator,
    reviewedAt: cp.reviewedAt,
  };

  // merge-layer fixes
  if (fix?.patch) {
    applyPatch(out, fix.patch, overrides, a);
    log.fixesApplied.push({ id: e.id, what: `patch ${Object.keys(fix.patch).join(', ')}${isObj(fix.patch.facts) ? ` (${Object.keys(fix.patch.facts).join(', ')})` : ''}`, why: fix.why ?? '' });
  }
  if (fix?.journeyIneligible) {
    prov.status = 'seeded';
    prov.ineligibleReason = fix.journeyIneligible;
    log.fixesApplied.push({ id: e.id, what: 'journey-ineligible', why: fix.journeyIneligible });
  }
  const ov = uniq(overrides).sort(byString);
  if (ov.length) prov.overrides = ov;
  out.provenance = orderKeys(prov, ['status', 'batch', 'curatedBy', 'reviewedAt', 'overrides', 'ineligibleReason']);

  // sources: curated list ∪ every id the merged record cites (auto-only ids survive only while still cited)
  const cited = collectSourceIds({ ...out, sources: [] });
  out.sources = uniq([...((cur?.sources as string[]) ?? []), ...Array.from(cited).sort(byString)]);

  // drop kind-foreign keys
  const allowed = new Set<string>(e.kind === 'star' ? STAR_ORDER : DSO_ORDER);
  for (const k of Object.keys(out)) {
    if (!allowed.has(k)) { log.dropped.push({ id: e.id, what: k, why: `not a ${e.kind} field` }); delete out[k]; }
  }
  out.facts = orderFacts(out.facts as Obj);
  if (isObj(out.card)) out.card = orderKeys(out.card, CARD_ORDER);
  return orderKeys(out, e.kind === 'star' ? STAR_ORDER : DSO_ORDER);
}

/** Replace curated http(s) images with their localised copies (media.licensed.json); drop the ones it skipped. */
function localiseLicensed(id: string, images: KbImage[], lic: LicensedFile | null, log: BuildLog): KbImage[] {
  if (!lic) return images;
  const out: KbImage[] = [];
  images.forEach((im, i) => {
    if (!/^https?:/.test(im.src)) { out.push(im); return; }
    const hit = lic.images.find((x) => x.objectId === id && x.imageIndex === i && x.originalUrl === im.src)
      ?? lic.images.find((x) => x.objectId === id && x.originalUrl === im.src);
    if (hit) {
      const loc: KbImage = { src: hit.localPath, credit: hit.credit, license: hit.license, caption: hit.caption || im.caption };
      if (hit.largePath) loc.large = hit.largePath;
      const fieldDeg = hit.fieldDeg ?? im.fieldDeg;
      if (fieldDeg) loc.fieldDeg = fieldDeg;
      const variant = hit.variant ?? im.variant;
      if (variant) loc.variant = variant;
      const sourceUrl = hit.sourcePageUrl ?? im.sourceUrl;
      if (sourceUrl) loc.sourceUrl = sourceUrl;
      out.push(loc);
      log.images.licensed.push({ id, src: hit.localPath });
      return;
    }
    const skip = lic.skipped?.find((x) => x.objectId === id && x.originalUrl === im.src);
    if (skip) { log.images.licensedSkipped.push({ id, src: im.src, reason: skip.reason }); return; }
    out.push(im);
  });
  return out;
}

// ───────────────────────────── referential clean-up on objects ─────────────────────────────

function periodKey(days: number): string {
  if (days < 2) return 'time.hours';
  if (days < 1000) return 'time.days';
  return 'time.years';
}

function cleanObject(o: Obj, conceptIds: Set<string>, nodeIds: Set<string>, contextIds: Set<string>, narrationKeys: Set<string>, bands: Set<string>, log: BuildLog): void {
  const id = o.id as string;
  const facts = o.facts as Record<string, FactValue>;
  o.teaches = (o.teaches as { conceptId: string }[]).filter((t) => {
    if (conceptIds.has(t.conceptId)) return true;
    log.dropped.push({ id, what: `teaches ${t.conceptId}`, why: 'unknown concept' });
    return false;
  });
  o.contextIds = uniq(o.contextIds as string[]).filter((c) => {
    if (contextIds.has(c)) return true;
    log.dropped.push({ id, what: `contextId ${c}`, why: 'unknown context' });
    return false;
  });
  const card = o.card as { numbers: { label: string; factRef: FactKey; comparisonKey?: string }[] };
  card.numbers = card.numbers.filter((n) => {
    if (facts[n.factRef]) return true;
    log.cardMissingFacts.push({ id, label: n.label, fact: n.factRef });
    return false;
  });
  for (const n of card.numbers) {
    if (n.factRef === 'periodDays' && n.comparisonKey === 'time.sun-day') {
      const to = periodKey(facts.periodDays.value);
      log.comparisonRemaps.push({ id, label: n.label, from: n.comparisonKey, to, why: 'time.sun-day compares an age, not a period' });
      n.comparisonKey = to;
    }
    if (n.comparisonKey && !narrationKeys.has(`compare.${n.comparisonKey}`) && !bands.has(`compare.${n.comparisonKey}`)) {
      log.comparisonRemaps.push({ id, label: n.label, from: n.comparisonKey, to: '(none)', why: 'no compare.* narration' });
      delete n.comparisonKey;
    }
  }
  if (o.kind === 'dso' && isObj(o.poweredBy) && Array.isArray(o.poweredBy.starIds)) {
    const pb = o.poweredBy as { starIds: string[] };
    pb.starIds = pb.starIds.filter((s) => {
      if (nodeIds.has(s)) return true;
      log.dropped.push({ id, what: `poweredBy.starIds ${s}`, why: 'not in KB' });
      return false;
    });
  }
}

// ───────────────────────────── contexts ─────────────────────────────

function mergeContexts(curated: { key: string; file: CuratedFile }[], fixes: Fixes, objects: Obj[], log: BuildLog): ContextNode[] {
  const byId = new Map<string, { recs: ContextNode[]; files: string[] }>();
  for (const { key, file } of curated) {
    for (const c of file.contexts ?? []) {
      const g = byId.get(c.id) ?? { recs: [], files: [] };
      g.recs.push(clone(c));
      g.files.push(key);
      byId.set(c.id, g);
    }
  }
  const richness = (c: ContextNode) => Object.keys(c.facts ?? {}).length * 1000 + (c.text?.length ?? 0) + c.memberIds.length + c.sources.length;
  const objIds = new Set(objects.map((o) => o.id as string));
  const out: ContextNode[] = [];
  for (const [id, g] of Array.from(byId.entries()).sort((x, y) => byString(x[0], y[0]))) {
    const ranked = g.recs.map((r, i) => ({ r, i })).sort((x, y) => richness(y.r) - richness(x.r) || x.i - y.i);
    const best = clone(ranked[0].r);
    if (g.recs.length > 1) log.contexts.merged.push({ id, files: g.files });
    best.memberIds = uniq(ranked.flatMap((x) => x.r.memberIds));
    best.sources = uniq(ranked.flatMap((x) => x.r.sources));
    best.facts = orderFacts(best.facts as unknown as Obj) as ContextNode['facts'];
    const fx = fixes.contextFixes?.[id];
    for (const m of fx?.addMembers ?? []) {
      if (!best.memberIds.includes(m)) { best.memberIds.push(m); log.contexts.addedByFix.push({ id, member: m }); }
    }
    best.memberIds = best.memberIds.filter((m) => {
      if (objIds.has(m)) return true;
      log.contexts.unknownMembers.push({ id, member: m });
      return false;
    });
    out.push(orderKeys(best as unknown as Obj, ['id', 'kind', 'name', 'parentId', 'memberIds', 'facts', 'text', 'sources']) as unknown as ContextNode);
  }
  for (const id of Object.keys(fixes.contextFixes ?? {})) if (!byId.has(id)) log.notes.push(`_fixes.json: context ${id} does not exist`);
  // mirror memberships both ways
  const ctxById = new Map(out.map((c) => [c.id, c] as const));
  for (const o of objects) {
    for (const c of o.contextIds as string[]) {
      const ctx = ctxById.get(c);
      if (ctx && !ctx.memberIds.includes(o.id as string)) { ctx.memberIds.push(o.id as string); log.contexts.mirrored.push({ id: c, member: o.id as string, dir: 'object→context' }); }
    }
  }
  const objById = new Map(objects.map((o) => [o.id as string, o] as const));
  for (const c of out) {
    for (const m of c.memberIds) {
      const o = objById.get(m)!;
      const ids = o.contextIds as string[];
      if (!ids.includes(c.id)) { ids.push(c.id); log.contexts.mirrored.push({ id: c.id, member: m, dir: 'context→object' }); }
    }
  }
  return out;
}

// ───────────────────────────── edges ─────────────────────────────

const EDGE_ORDER = ['from', 'to', 'type', 'subtype', 'strength', 'reasonKey', 'factRefs', 'curated', 'directed', 'sourceIds'];

function mergeEdges(curated: { key: string; file: CuratedFile }[], nodes: Map<string, Obj>, log: BuildLog): Edge[] {
  const all: { e: Edge; file: string; n: number }[] = [];
  let n = 0;
  for (const { key, file } of curated) for (const e of file.edges ?? []) all.push({ e: clone(e), file: key, n: n++ });
  const kept: { e: Edge; file: string; n: number }[] = [];
  for (const x of all) {
    const { e } = x;
    if (!nodes.has(e.from) || !nodes.has(e.to)) { log.edges.dropped.push({ edge: `${e.from}>${e.to} ${e.type}`, file: x.file, why: 'unknown endpoint' }); continue; }
    if (e.from === e.to) { log.edges.dropped.push({ edge: `${e.from}>${e.to} ${e.type}`, file: x.file, why: 'self-loop' }); continue; }
    if (e.factRefs) {
      e.factRefs = e.factRefs.filter((r) => {
        const owner = nodes.get(r.objectId);
        if ((owner?.facts as Obj | undefined)?.[r.fact]) return true;
        log.edges.factRefsDropped.push({ edge: `${e.from}>${e.to} ${e.type}`, ref: `${r.objectId}.${r.fact}` });
        return false;
      });
      if (!e.factRefs.length) delete e.factRefs;
    }
    kept.push(x);
  }
  // dedupe: identical (from,to,type) and reversed undirected (to,from,type) pairs
  const groups: { items: typeof kept }[] = [];
  const keyToGroup = new Map<string, number>();
  for (const x of kept) {
    const keys = [`${x.e.from}>${x.e.to}|${x.e.type}`];
    if (x.e.directed === false) keys.push(`${x.e.to}>${x.e.from}|${x.e.type}`);
    // a directed edge also collides with an undirected edge registered under its own (from,to)
    const g = keys.map((k) => keyToGroup.get(k)).find((v) => v !== undefined);
    const gi = g ?? groups.push({ items: [] }) - 1;
    groups[gi].items.push(x);
    for (const k of keys) keyToGroup.set(k, gi);
  }
  const out: Edge[] = [];
  for (const g of groups) {
    const ranked = [...g.items].sort((a, b) => (b.e.factRefs?.length ?? 0) - (a.e.factRefs?.length ?? 0)
      || b.e.strength - a.e.strength || Number(b.e.curated) - Number(a.e.curated) || a.n - b.n);
    const win = clone(ranked[0].e);
    if (g.items.length > 1) {
      const src = uniq(g.items.flatMap((x) => x.e.sourceIds ?? []));
      if (src.length) win.sourceIds = src;
      log.edges.duplicates.push({
        kept: `${win.from}>${win.to} ${win.type} (${ranked[0].file}, strength ${win.strength}, ${win.factRefs?.length ?? 0} factRefs)`,
        removed: ranked.slice(1).map((x) => `${x.e.from}>${x.e.to} ${x.e.type} (${x.file}, strength ${x.e.strength})`),
      });
    }
    out.push(orderKeys(win as unknown as Obj, EDGE_ORDER) as unknown as Edge);
  }
  // LINE_OF_SIGHT needs both distances with a ratio ≥ 2 (README edge rules) — reported, not enforced
  for (const e of out) {
    if (e.type !== 'LINE_OF_SIGHT') continue;
    const d1 = ((nodes.get(e.from)?.facts as Obj)?.distanceLy as FactValue | undefined)?.value;
    const d2 = ((nodes.get(e.to)?.facts as Obj)?.distanceLy as FactValue | undefined)?.value;
    if (!d1 || !d2 || Math.max(d1, d2) / Math.min(d1, d2) < 2) log.edges.losViolations.push({ edge: `${e.from}>${e.to}`, d1: d1 ?? null, d2: d2 ?? null });
  }
  return out.sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.type, b.type) || byString(a.subtype, b.subtype));
}

// ───────────────────────────── narration ─────────────────────────────

function mergeNarration(base: NarrationBank, curated: { key: string; file: CuratedFile }[], extra: NarrationExtra, log: BuildLog): NarrationBank {
  const bank = clone(base);
  const variants = bank.variants;
  for (const { key, file } of curated) {
    for (const [k, v] of Object.entries(file.narration ?? {})) {
      if (!variants[k]) { variants[k] = clone(v); continue; }
      if (same(variants[k], v)) continue;
      const merged = uniq([...variants[k], ...v]);
      log.narration.unioned.push({ key: k, file: key, variants: merged.length });
      variants[k] = merged;
    }
  }
  // comparison lines the bank lacks (the bank always wins)
  const add = (k: string, v: string[]) => { if (!variants[k]) { variants[k] = clone(v); log.narration.added.push(k); } };
  for (const [k, v] of Object.entries(extra.variants)) add(k, v);
  bank.bands = bank.bands ?? {};
  for (const [k, b] of Object.entries(extra.bands)) if (!bank.bands[k]) bank.bands[k] = clone(b);
  for (const k of extra.periodBands.keys) {
    if (!bank.bands[k]) bank.bands[k] = clone(extra.periodBands.bands);
    for (const band of extra.periodBands.bands) add(`${k}.${band.suffix}`, extra.periodBands.variants[band.suffix]);
  }
  bank.citations = bank.citations ?? {};
  for (const [k, v] of Object.entries(extra.citations)) if (!bank.citations[k]) bank.citations[k] = clone(v);
  return bank;
}

function finishNarration(bank: NarrationBank, edges: Edge[], version: string, log: BuildLog): NarrationBank {
  const used = new Set(edges.map((e) => e.reasonKey));
  const variants: Record<string, string[]> = {};
  for (const k of Object.keys(bank.variants).sort(byString)) {
    if (k.startsWith('edge.') && !used.has(k)) { log.narration.pruned.push(k); continue; }
    variants[k] = bank.variants[k];
  }
  const sortRec = <T>(r: Record<string, T> | undefined) => (r ? Object.fromEntries(Object.entries(r).sort((a, b) => byString(a[0], b[0]))) : undefined);
  return orderKeys({ ...bank, version, variants, bands: sortRec(bank.bands), citations: sortRec(bank.citations) } as unknown as Obj,
    ['version', 'placeholders', 'bands', 'citations', 'variants']) as unknown as NarrationBank;
}

// ───────────────────────────── story seeds ─────────────────────────────

function collectSeeds(curated: { key: string; file: CuratedFile }[], canon: Canonical, objIds: Set<string>, log: BuildLog): StorySeed[] {
  const out: StorySeed[] = [];
  for (const { key, file } of curated) {
    const map = sourceMapper(canon, key, log);
    (file.storySeeds ?? []).forEach((raw, i) => {
      const s = clone(raw);
      rewriteSourceIds(s, map);
      const take = (...ks: string[]) => { for (const k of ks) if (s[k] !== undefined) { const v = s[k]; for (const kk of ks) delete s[kk]; return v; } return undefined; };
      const id = (take('id') as string | undefined) ?? `${key}-seed-${i + 1}`;
      const title = take('title') as string;
      const arch = take('archetypes', 'archetype');
      const archetypes = (Array.isArray(arch) ? arch : String(arch ?? '').split(/[\s/,]+/)).map(String).filter((x) => /^A\d+$/.test(x));
      const stops = ((take('stops', 'path', 'objectIds') as string[] | undefined) ?? []).map(String);
      const optional = (take('optional') as string[] | undefined) ?? [];
      const summary = take('summary', 'story', 'description', 'text') as string | undefined;
      const sourceIds = uniq([...((take('sourceIds') as string[]) ?? []), ...((take('sources') as string[]) ?? [])]);
      const seed: StorySeed = {
        id, batch: file.batch, kind: file.kind, file: `script/journeys/curated/${key}.json`, title, archetypes, stops,
        ...(optional.length ? { optional } : {}),
        ...(summary ? { summary } : {}),
        sourceIds,
        ...(Object.keys(s).length ? { extra: Object.fromEntries(Object.entries(s).sort((a, b) => byString(a[0], b[0]))) } : {}),
      };
      for (const st of [...stops, ...optional]) if (!objIds.has(st)) log.seeds.unknownStops.push({ seed: id, stop: st });
      out.push(seed);
    });
  }
  return out;
}

// ───────────────────────────── eligibility (mirror of candidates.ts isJourneyEligible) ─────────────────────────────

export function eligibleForJourneys(o: KbObject): boolean {
  const status = o.provenance?.status;
  if (status !== 'curated' && status !== 'reviewed') return false;
  if (!o.teaches.length) return false;
  if (!Object.values(o.facts).some((f) => f && Number.isFinite(f.value) && !!f.sourceId)) return false;
  const c = o.card;
  // wonder and connect are optional (owner brief r2: one sentence, or empty when it would only repeat the card).
  if (![c.glance, c.whyHere, c.see, c.understand].every((x) => typeof x === 'string' && x.trim().length > 0)) return false;
  if (o.kind === 'dso' && o.view.basis === 'derived') return false;
  return Number.isFinite(o.ra) && Number.isFinite(o.dec);
}

// ───────────────────────────── main ─────────────────────────────

export interface BuildOptions {
  /** false: build without theme lenses (as if curated/lenses/ were empty). */
  lenses?: boolean;
  /** Read lens files from this directory instead of script/journeys/curated/lenses (tests). */
  lensDir?: string;
}

export function build(opts: BuildOptions = {}) {
  const I = loadInputs(opts);
  const log: BuildLog = {
    sourceRewrites: {}, curatedFacts: {}, sourceConflicts: [], unreferencedSources: [], magConflicts: [], dropped: [], notes: [], autoOnly: [],
    fixesApplied: [], cardMissingFacts: [], comparisonRemaps: [],
    images: { licensed: [], licensedSkipped: [], missingFile: [], remote: [], filled: [] },
    contexts: { merged: [], addedByFix: [], unknownMembers: [], mirrored: [] },
    edges: { dropped: [], duplicates: [], factRefsDropped: [], losViolations: [], reasonFallbacks: [] },
    narration: { unioned: [], added: [], pruned: [] },
    seeds: { unknownStops: [] },
    inputs: {
      curated: I.curated.map((c) => `${c.key} (${c.file.version})`),
      auto: [I.starsAuto.version ?? 'stars.auto', I.dsoAuto.version ?? 'dso.auto'],
      mediaLicensed: I.licensed ? `${(I.licensed as unknown as Obj).version ?? 'present'} (${I.licensed.images.length} images, ${I.licensed.skipped?.length ?? 0} skipped)` : 'absent',
      mediaAuto: I.mediaAuto ? `${(I.mediaAuto as unknown as Obj).version ?? 'present'}` : 'absent',
      mediaFill: I.mediaFill ? `${I.mediaFill.version ?? 'present'} (${Object.keys(I.mediaFill.objects).length} objects)` : 'absent',
    },
  };

  // 1. sources: canonical registry, aliases, per-file renames
  const canonById = new Map(I.canon.sources.map((s) => [s.id, s] as const));
  const passthrough = new Map<string, { rec: Source; files: string[] }>();
  const tierFiles: { key: string; file: TierFile }[] = [
    { key: 'stars.auto', file: I.starsAuto }, { key: 'dso.auto', file: I.dsoAuto }, ...I.curated,
  ];
  for (const { key, file } of tierFiles) {
    const map = sourceMapper(I.canon, key, log);
    for (const s of file.sources) {
      const id = map(s.id);
      if (canonById.has(id)) continue;
      const rec = { ...clone(s), id };
      const prev = passthrough.get(id);
      if (!prev) { passthrough.set(id, { rec, files: [key] }); continue; }
      prev.files.push(key);
      if (!same(prev.rec, rec)) log.sourceConflicts.push({ id, files: [...prev.files] });
    }
    // rewrite ids inside the tier's records (objects, edges, contexts)
    rewriteSourceIds(file.objects, map);
    const cf = file as CuratedFile;
    if (cf.edges) rewriteSourceIds(cf.edges, map);
    if (cf.contexts) rewriteSourceIds(cf.contexts, map);
  }
  if (log.sourceConflicts.length) {
    throw new Error(`conflicting source records (add them to sources.canonical.json or rename):\n${log.sourceConflicts.map((c) => `  ${c.id}: ${c.files.join(', ')}`).join('\n')}`);
  }

  // 2. objects
  const autoById = new Map<string, Obj>();
  for (const o of [...I.starsAuto.objects, ...I.dsoAuto.objects]) autoById.set(o.id as string, o);
  const curById = new Map<string, { obj: Obj; file: { key: string; file: CuratedFile } }>();
  for (const cf of I.curated) {
    for (const o of cf.file.objects) {
      const id = o.id as string;
      if (curById.has(id)) throw new Error(`object ${id} curated twice (${curById.get(id)!.file.key}, ${cf.key})`);
      curById.set(id, { obj: o, file: cf });
    }
  }
  const listIds = new Set(I.list.map((e) => e.id));
  for (const [id, c] of Array.from(curById.entries())) {
    if (!listIds.has(id)) log.notes.push(`curated object ${id} (${c.file.key}) is not in object-list.json and was ignored`);
  }
  for (const id of Object.keys(I.fixes.objectFixes ?? {})) if (!listIds.has(id)) log.notes.push(`_fixes.json: object ${id} is not in object-list.json`);
  const objects = I.list.map((e) => {
    const c = curById.get(e.id);
    if (c && (c.file.file.kind !== e.kind || c.file.file.batch !== e.batch)) {
      log.notes.push(`${e.id}: curated in ${c.file.key} but listed as ${e.batch}/${e.kind}`);
    }
    return mergeObject(e, autoById.get(e.id), c?.obj, c?.file, { auto: I.mediaAuto, licensed: I.licensed, fill: I.mediaFill }, I.fixes.objectFixes?.[e.id], log);
  }).sort((a, b) => byString(a.id as string, b.id as string));

  // 3. contexts (before clean-up so contextIds can be checked), concepts, narration
  const contexts = mergeContexts(I.curated, I.fixes, objects, log);
  const concepts = ConceptsJsonFileSchema.parse(I.concepts);
  const templatesFile = activeTemplates(I.templates, (x) => log.notes.push(x));
  const templates = TemplatesJsonFileSchema.parse(templatesFile);
  NarrationBankSchema.parse(I.narration);
  const conceptIds = new Set(concepts.concepts.map((c) => c.id));
  const ctxIds = new Set(contexts.map((c) => c.id));
  const nodes = new Map<string, Obj>([...objects.map((o) => [o.id as string, o] as const), ...contexts.map((c) => [c.id, c as unknown as Obj] as const)]);
  const nodeIds = new Set(nodes.keys());
  const bankBase = mergeNarration(I.narration, I.curated, I.extra, log);
  // Theme lenses: checked against the merged objects (eligibility needs the final records), their narration lines
  // replace the bank's. A lens whose theme is retired (owner feedback r4: A7) stays on disk, so restoring the theme
  // is a one-flag change, but is not built.
  const activeArch = new Set(templates.templates.map((t) => t.archetype as string));
  const retiredArch = new Set(((I.templates.templates as Obj[]) ?? []).filter((t) => t.retired === true).map((t) => t.archetype as string).filter((a) => !activeArch.has(a)));
  const lensSources = I.lensSources.filter((s) => {
    const arch = (s.raw as Obj | null)?.archetype as string | undefined;
    if (arch && retiredArch.has(arch)) { log.notes.push(`${s.file}: theme ${arch} is retired, lens not built`); return false; }
    return true;
  });
  const lensLoad = loadLenses(lensSources, objects as unknown as KbObject[], templates.templates as Template[], bankBase, eligibleForJourneys);
  log.notes.push(...lensLoad.notes);
  const bank0 = mergeLensNarration(bankBase, lensLoad.lenses, (x) => log.notes.push(x));
  const lensSets = lensLoad.lenses.map((l) => l.set);
  const narrationKeys = new Set(Object.keys(bank0.variants));
  const bandKeys = new Set(Object.keys(bank0.bands ?? {}));
  for (const o of objects) cleanObject(o, conceptIds, nodeIds, ctxIds, narrationKeys, bandKeys, log);
  for (const o of objects) (o.contextIds as string[]).sort(byString);
  for (const c of contexts) c.memberIds = uniq(c.memberIds);

  // 4. edges
  const edges = mergeEdges(I.curated, nodes, log);
  for (const e of edges) {
    if (narrationKeys.has(e.reasonKey)) continue;
    const generic = narrationKeys.has(`${e.type}.${e.subtype}`) ? `${e.type}.${e.subtype}` : e.type;
    log.edges.reasonFallbacks.push({ edge: `${e.from}>${e.to} ${e.type}`, from: e.reasonKey, to: generic });
    e.reasonKey = generic;
  }

  // 5. sources actually cited (objects, contexts, edges, seeds)
  const seeds = collectSeeds(I.curated, I.canon, new Set(objects.map((o) => o.id as string)), log);
  const cited = new Set<string>([
    ...collectSourceIds(objects), ...collectSourceIds(contexts), ...collectSourceIds(edges), ...collectSourceIds(seeds),
  ]);
  const allSources = [...I.canon.sources, ...Array.from(passthrough.values()).map((x) => x.rec)];
  const sources = allSources.filter((s) => {
    if (cited.has(s.id)) return true;
    log.unreferencedSources.push(s.id);
    return false;
  }).map((s) => orderKeys(s as unknown as Obj, ['id', 'title', 'url', 'publisher', 'license', 'kind', 'citation', 'bibcode', 'retrieved']) as unknown as Source)
    .sort((a, b) => byString(a.id, b.id));
  const known = new Set(sources.map((s) => s.id));
  const undefinedIds = Array.from(cited).filter((x) => !known.has(x)).sort(byString);

  // 6. version (content hash → deterministic)
  const contentHash = sha256(canonical({ objects, contexts, sources, edges, concepts, templates, n: bank0.variants, ...(lensSets.length ? { lenses: lensSets } : {}) })).slice(0, 10);
  const version = `kb-v1+${contentHash}`;
  const narration = finishNarration(bank0, edges, `${I.narration.version}+${contentHash}`, log);
  const files = {
    kb: { version, objects, contexts, sources },
    concepts: I.concepts,
    edges: { version, edges },
    templates: templatesFile,
    narration,
    lenses: { version, lenses: lensSets },
  };

  // 7. validate exactly as the app will
  let issues: string[] = [];
  try {
    knowledgeBaseFromFiles(files);
  } catch (err) {
    if (err instanceof KnowledgeBaseError) issues = err.issues;
    else if (err && typeof err === 'object' && 'issues' in err) issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    else throw err;
  }
  issues.push(...undefinedIds.map((x) => `undefined source id "${x}"`));
  // Lens problems are reported once, with their file (kb/lenses.ts runs the same lensIssues checks and more).
  issues = issues.filter((x) => !/^lens A\d+[: ]/.test(x));
  issues.push(...lensLoad.issues);
  const seedFile = { version, generatedBy: 'script/journeys/build_kb.ts', notes: 'Story seeds from the curated batch files, normalised (id, batch, kind, archetypes, stops, summary, sourceIds; other fields under extra). Ideas for templates, judge slates and QA, not runtime data.', seeds };
  return { files, seedFile, log, issues, version, objects: objects as unknown as KbObject[], contexts, edges, sources, narration, seeds, lenses: lensSets, inputs: I };
}

function main() {
  const check = process.argv.includes('--check');
  const li = process.argv.indexOf('--lenses');
  const r = build({ lenses: !process.argv.includes('--no-lenses'), ...(li >= 0 && process.argv[li + 1] ? { lensDir: resolve(process.argv[li + 1]) } : {}) });
  if (r.issues.length) {
    console.error(`KB validation failed (${r.issues.length} issues):\n- ${r.issues.slice(0, 80).join('\n- ')}`);
    process.exit(1);
  }
  const report = renderReport({
    version: r.version, objects: r.objects, contexts: r.contexts, edges: r.edges, sources: r.sources, narration: r.narration,
    seeds: r.seeds, log: r.log, list: r.inputs.list, eligible: eligibleForJourneys, publicDir: P.publicDir,
    auto: {
      dsoQa: ((r.inputs.dsoAuto as unknown as Obj).qa ?? []) as { id: string; issue: string; detail: string }[],
      starFlags: Object.fromEntries(r.inputs.starsAuto.objects.map((o) => [o.id as string, (((o.auto as Obj | undefined)?.flags) ?? []) as string[]])),
    },
  });
  // Long lens sentences are errors; when kb/lenses.ts LONG_SENTENCE_IS_ERROR is false they are notes, shown here since
  // the report is easy to miss.
  const longNotes = r.log.notes.filter((x) => x.includes(`: ${LONG_SENTENCE_TAG} of `));
  if (longNotes.length) console.warn(`NOTE ${longNotes.length} lens sentences over 220 characters:\n- ${longNotes.join('\n- ')}`);
  if (check) {
    console.log(`OK ${r.version}: ${r.objects.length} objects, ${r.contexts.length} contexts, ${r.edges.length} edges, ${r.sources.length} sources, ${lensSummary(r.lenses)} (--check: nothing written)`);
    return;
  }
  const out = (f: string) => resolve(P.outDir, f);
  writeJson(out('kb.json'), r.files.kb);
  writeJson(out('edges.json'), r.files.edges);
  writeJson(out('concepts.json'), r.files.concepts);
  writeJson(out('templates.json'), r.files.templates);
  writeJson(out('narration.json'), r.files.narration);
  writeJson(out('lenses.json'), r.files.lenses);
  writeJson(out('story-seeds.json'), r.seedFile);
  writeText(P.report, report);
  const elig = r.objects.filter(eligibleForJourneys).length;
  console.log(`${r.version}: ${r.objects.length} objects (${elig} journey-eligible), ${r.contexts.length} contexts, ${r.edges.length} edges, ${r.sources.length} sources, ${Object.keys(r.narration.variants).length} narration keys, ${r.seeds.length} story seeds`);
  console.log(`${(r.files.templates.templates as unknown[]).length} active templates; ${lensSummary(r.lenses)}`);
  console.log(`wrote ${['kb.json', 'edges.json', 'concepts.json', 'templates.json', 'narration.json', 'lenses.json', 'story-seeds.json'].map((f) => rel(out(f))).join(', ')}, ${rel(P.report)}`);
}

function lensSummary(lenses: readonly ThemeLensSet[]): string {
  if (!lenses.length) return 'no theme lenses';
  return `theme lenses ${lenses.map((l) => `${l.archetype} (${Object.keys(l.objects).length} objects, ${l.beats.length} beats)`).join(', ')}`;
}

const isMain = (() => {
  const argv1 = process.argv[1] ? resolve(process.argv[1]) : '';
  return argv1.endsWith('build_kb.ts') || argv1.endsWith('build_kb.js');
})();
if (isMain) main();

