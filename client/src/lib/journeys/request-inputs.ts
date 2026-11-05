/**
 * UI-side inputs that link the journeys engine to the rest of the app (r5): the Planner's observed objects join
 * "seen", Tonight's Best top objects nudge the journeys (boostIds), and "a journey from my night" asks for the
 * night's objects (mustInclude). Every id form (unified id, STAR-<Name>, HR<n>, star:HR<n>) becomes the KB id with
 * object-links toKbId; lunar features are dropped. Main-thread only (object-links is not part of the worker).
 */
import { toKbId } from '../object-links';
import type { JourneyRequest } from './types';

/** Sorted, deduplicated KB ids of any id forms (lunar features and empty ids dropped). */
export function kbIdsOf(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of Array.from(ids)) {
    const kb = id ? toKbId(id) : null;
    if (kb) out.add(kb);
  }
  return Array.from(out).sort();
}

/** Ids of every Planner item marked observed, across the given nights (archived ones included: seen is seen). */
export function plannerObservedIds(sessions: readonly { items: readonly { id: string; observedAt?: string | null }[] }[]): string[] {
  return kbIdsOf(sessions.flatMap((s) => s.items.filter((i) => !!i.observedAt).map((i) => i.id)));
}

export interface SkyInputs {
  /** Planner observedAt ids (any form). */
  observedIds?: Iterable<string>;
  /** Tonight's Best top object ids (any form), e.g. rankTonight(...).slice(0, 8).map((t) => t.target.id). */
  boostIds?: Iterable<string>;
  /** Objects the journeys should include when the sky allows (any form), e.g. a Planner night's items. */
  mustInclude?: Iterable<string>;
}

/**
 * `req` with the linked inputs as KB ids. A field is only set when it has ids, so a request without inputs stays
 * byte-identical (same worker cache key, same journeys).
 */
export function withSkyInputs(req: JourneyRequest, inputs: SkyInputs): JourneyRequest {
  const out: JourneyRequest = { ...req };
  const observed = kbIdsOf(inputs.observedIds ?? []);
  const boost = kbIdsOf(inputs.boostIds ?? []);
  const must = kbIdsOf(inputs.mustInclude ?? []);
  if (observed.length) out.observedIds = observed;
  if (boost.length) out.boostIds = boost;
  if (must.length) out.mustInclude = must;
  return out;
}

/**
 * The app-wide linked inputs (r5 decision: journeys borrow from Tonight's Best). The planner shell sets them while it
 * renders (Planner observed ids + Tonight's top 8); every journey request builder (Discovery, the Tonight teaser,
 * ObjectJourneyLinks chips, the Moon and Planner journey lists) applies the same inputs, so they all send ONE
 * identical request and agree on which journeys exist tonight. A plain module value read during render: it only
 * changes when the planner re-renders, which re-renders those screens too.
 */
export interface SharedSkyInputs { observedIds: string[]; boostIds: string[]; /** Stable key of the two lists. */ key: string }
let shared: SharedSkyInputs = { observedIds: [], boostIds: [], key: "" };
export function setSharedSkyInputs(inputs: { observedIds?: Iterable<string>; boostIds?: Iterable<string> }): SharedSkyInputs {
  const observedIds = kbIdsOf(inputs.observedIds ?? []), boostIds = kbIdsOf(inputs.boostIds ?? []);
  const key = observedIds.length || boostIds.length ? `${observedIds.join(",")}|${boostIds.join(",")}` : "";
  if (key !== shared.key) shared = { observedIds, boostIds, key };
  return shared;
}
export const sharedSkyInputs = (): SharedSkyInputs => shared;
