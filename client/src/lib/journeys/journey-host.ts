/**
 * Sky Journeys engine host: the message handler shared by journey.worker.ts and the in-thread fallback of
 * journey-client.ts, so both paths behave identically.
 *
 * State kept between messages (one host per worker):
 * - the fetched + validated KB and the optional learned model (loaded once, retried after a failure);
 * - an LRU of the last 8 generate results (re-opening the tab or flipping back to a shuffle is instant).
 * The engine itself memoises the night grid and candidate table per (KB, 15-minute slot, site, instrument), so
 * the NightContext of a slot is computed once per worker.
 *
 * Messages:
 *   generate {req}            → JourneyResult
 *   kb                        → KnowledgeBase (display data: the UI does not fetch or zod-validate the KB again)
 * The KB answer is a structured clone of the worker's parsed copy. That costs one clone (tens of ms for a few MB)
 * and a second in-memory copy on the main thread, but saves the main thread a second download parse and the
 * zod + referential validation, which are several times slower than a clone.
 */
import { horizonFingerprint } from '../horizon/profile';
import { generate } from './assemble';
import { loadJourneyData, type LoadedJourneyData } from './journey-client';
import type { JourneyRequest, JourneyResult, KnowledgeBase } from './types';

export type JourneyHostRequest =
  | { id: number; type?: 'generate'; req: JourneyRequest; base: string }
  | { id: number; type: 'kb'; base: string };

export type JourneyHostValue = JourneyResult | KnowledgeBase;

export interface JourneyHost {
  handle(msg: JourneyHostRequest): Promise<JourneyHostValue>;
}

/** Request fields that are sets of KB ids: order and duplicates never change a result. */
const ID_SET_FIELDS = ['seenObjectIds', 'observedIds', 'boostIds', 'mustInclude'] as const;

/**
 * Result-cache key of a request: every field (so boostIds, mustInclude and observedIds are part of it), with the id
 * sets sorted and deduplicated and empty sets dropped (an empty set is exactly the absent field for the engine). The
 * skyline (`horizon`, hundreds of numbers) is replaced by its short fingerprint; no skyline is the absent field, so a
 * request without one keeps exactly its old key.
 */
export function journeyRequestCacheKey(req: JourneyRequest): string {
  const copy: Record<string, unknown> = { ...req };
  for (const f of ID_SET_FIELDS) {
    const ids = req[f];
    if (!ids?.length) delete copy[f];
    else copy[f] = Array.from(new Set(ids)).sort();
  }
  const fingerprint = horizonFingerprint(req.horizon ?? null);
  if (fingerprint === 'flat') delete copy.horizon;
  else copy.horizon = fingerprint;
  return JSON.stringify(copy);
}

export function createJourneyHost(opts: { loadData?: (base: string) => Promise<LoadedJourneyData>; clock?: () => number } = {}): JourneyHost {
  let data: Promise<LoadedJourneyData> | null = null;
  const results = new Map<string, JourneyResult>();
  const load = (base: string) => {
    data ??= (opts.loadData ?? ((b: string) => loadJourneyData(b)))(base).catch((error) => { data = null; throw error; });
    return data;
  };
  return {
    async handle(msg) {
      const loaded = await load(msg.base);
      if (msg.type === 'kb') return loaded.kb;
      const key = journeyRequestCacheKey(msg.req);
      let value = results.get(key);
      if (value) results.delete(key);
      else value = generate(loaded.kb, msg.req, { model: loaded.model, ...(opts.clock ? { clock: opts.clock } : {}) });
      results.set(key, value);
      while (results.size > 8) results.delete(results.keys().next().value as string);
      return value;
    },
  };
}
