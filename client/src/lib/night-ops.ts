import { mergeJourneyTag, type NightItem } from "./session";
import { objectKey, toSessionId } from "./object-links";

export interface AppendNightMeta {
  /** addedAt for new items (ISO). */
  at: string;
  /** Journey the objects come from ("Journey · stop 3" badge in the Planner). */
  journeyKey?: string;
  /** 1-based journey stop of each id, parallel to `ids`. */
  journeyStops?: number[];
  /**
   * Planned start of each id, parallel to `ids` (a journey stop's own time). Stored as `plannedAt`, so the Planner keeps
   * the journey's order and times instead of re-timing the stops. Invalid or missing entries are left out.
   */
  plannedAts?: readonly (Date | string | undefined)[];
}

const isoOf = (value: Date | string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : undefined;
};

/**
 * Add objects to a night's items: add-only (nothing is removed or reordered), new items appended in the given order,
 * duplicates skipped whatever id form they use (STAR-Betelgeuse = HR2061 = star:HR2061). An existing item takes the
 * journey tag by the shared rule (session.ts mergeJourneyTag): an untagged item gains the journey, its stop and its
 * planned time; an item already tagged with the same journey stop but no time gets the stop's time. Ids are stored as
 * session ids (toSessionId). Returns the new list, the ids added and the ids of existing items whose tag or time was
 * filled in (`updated`).
 */
export function appendNightItems(items: readonly NightItem[], ids: readonly string[], meta: AppendNightMeta): { items: NightItem[]; added: string[]; updated: string[] } {
  const keys = new Map(items.map((item, index) => [objectKey(item.id), index]));
  const next = [...items], added: string[] = [], updated: string[] = [];
  ids.forEach((raw, index) => {
    if (!raw.trim()) return;
    const id = toSessionId(raw), key = objectKey(id), stop = meta.journeyStops?.[index], plannedAt = isoOf(meta.plannedAts?.[index]);
    const journey = meta.journeyKey ? { journeyKey: meta.journeyKey, ...(stop ? { journeyStop: stop } : {}) } : {};
    const timed = plannedAt ? { plannedAt } : {};
    const existing = keys.get(key);
    if (existing !== undefined) {
      const merged = mergeJourneyTag(next[existing], { ...journey, ...timed });
      if (merged !== next[existing]) { next[existing] = merged; updated.push(next[existing].id); }
      return;
    }
    keys.set(key, next.length);
    next.push({ id, addedAt: meta.at, notes: "", ...journey, ...timed });
    added.push(id);
  });
  return { items: next, added, updated };
}

/**
 * True when the night already holds the object and adding it again (with this journey tag, if any) would change
 * nothing: "In tonight's plan" / "All stops in tonight's plan". A stop that is in the night but untagged, or tagged
 * without its planned time, is not "in" yet, so the add stays enabled and fills it in.
 */
export function nightHolds(items: readonly NightItem[], id: string, tag: { journeyKey?: string; journeyStop?: number; plannedAt?: Date | string } = {}): boolean {
  const { added, updated } = appendNightItems(items, [id], { at: "", journeyKey: tag.journeyKey, journeyStops: tag.journeyStop ? [tag.journeyStop] : undefined, plannedAts: [tag.plannedAt] });
  return !added.length && !updated.length;
}
