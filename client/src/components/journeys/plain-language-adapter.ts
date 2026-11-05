/**
 * UI adapter for plain-language descriptions and the glossary (owner feedback r1: never show raw spectral classes
 * or catalog codes as a description; define technical terms, tappable in the app).
 *
 * plainClass and findGlossaryTerms come from the shared contract `client/src/lib/journeys/plain-language.ts`;
 * this file adds what only the UI needs: the "Catalog details" rows and the lazy glossary.json loader.
 */
import type { KbObject } from '@/lib/journeys/types';
import { findGlossaryTerms as findTerms, plainClass, type GlossaryEntry, type GlossaryHit } from '@/lib/journeys/plain-language';

export { plainClass };
export type { GlossaryEntry };
export type GlossaryMatch = Pick<GlossaryHit, 'start' | 'end' | 'entry'>;

/** First occurrence of each glossary term in `text` (whole words, plurals, longest form first), by position. */
export function findGlossaryTerms(text: string, glossary: GlossaryEntry[]): GlossaryMatch[] {
  return findTerms(text, glossary);
}

/** Raw catalog details kept out of the description line (expandable "Catalog details"). */
export function catalogDetails(obj: KbObject): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (obj.names.designation && obj.names.designation !== obj.names.display) rows.push({ label: 'Designation', value: obj.names.designation });
  if (obj.kind === 'star') {
    if (obj.spectral?.text) rows.push({ label: 'Spectral class', value: obj.spectral.text });
    if (obj.variability) rows.push({ label: 'Variable type', value: obj.variability.gcvsType });
  } else {
    rows.push({ label: 'Class', value: obj.dsoClass.replace(/-/g, ' ') });
    if (obj.morphology) rows.push({ label: 'Galaxy type', value: obj.morphology.hubble });
  }
  const ids = obj.names.aliases.filter((a) => a !== obj.names.display && a !== obj.names.designation).slice(0, 6);
  if (ids.length) rows.push({ label: 'Also known as', value: ids.join(', ') });
  return rows;
}

// ───────────────────────────── glossary ─────────────────────────────

let glossaryPromise: Promise<GlossaryEntry[]> | null = null;
/** Lazily fetch data/journeys/glossary.json once; an absent or broken file yields an empty glossary. */
export function loadGlossary(fetcher: typeof fetch = fetch): Promise<GlossaryEntry[]> {
  if (!glossaryPromise) {
    const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
    glossaryPromise = fetcher(new URL('data/journeys/glossary.json', base).toString())
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : []))
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { terms?: unknown }).terms) ? (data as { terms: unknown[] }).terms : [];
        return list.filter((e): e is GlossaryEntry => !!e && typeof (e as GlossaryEntry).term === 'string' && typeof (e as GlossaryEntry).short === 'string')
          .map((e) => ({ ...e, id: e.id ?? e.term, aliases: Array.isArray(e.aliases) ? e.aliases : [] }));
      })
      .catch(() => []);
  }
  return glossaryPromise;
}
