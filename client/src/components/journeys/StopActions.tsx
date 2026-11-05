/**
 * The shared object-action row on a journey stop (integration r5, WS-C): a thin wrapper over the app's one
 * ObjectActionRow ("Plan star hop", "Moon effect", "Visibility tonight", "See in Catalog", "Photos", "Add to tonight's
 * plan"; LINK_LABELS, same order as every tab). The journey adds only its context: the hop starts at the previous stop
 * (or the anchor of a jump) and keeps the journey ref for "Back to journey"; adding tags the item with the journey and
 * its stop number. It uses the row's own two looks (full on the Overview, compact in field mode and the Done recap);
 * only the compact row folds the four look-up links behind "More", so field mode stays on the dock.
 */
import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { displayName, resolveObject, sameObject, toRoutingId, type JourneyRef, type ObjectActions, type ObjectCatalog, type ResolvedObject } from "@/lib/object-links";
import { ObjectActionRow } from "../ObjectActionRow";
import "./entry-points.css";

export interface StopActionsProps {
  /** KB / any-form id of the stop's object. */
  objectId: string;
  actions: ObjectActions;
  /** The journey stop this row belongs to (hop keeps "Back to journey"; add-to-night tags the item). */
  journey?: JourneyRef;
  /** Previous stop's object id: the hop starts there. */
  from?: string;
  /** The instant the look-ups and the hop use (Moon effect, Visibility tonight, Plan star hop); field mode passes now. */
  at?: Date;
  /**
   * The stop's own planned time (the journey's `windowStart` for this stop). "Add to tonight's plan" stores it as the
   * item's `plannedAt`, so the Planner keeps the stop in the journey's block at its own time. Kept apart from `at`:
   * field mode looks at the sky now but still plans the stop at its journey time.
   */
  plannedAt?: Date;
  /** Field mode and the Done recap: ObjectActionRow's shared "compact" look (else its "full" look). */
  compact?: boolean;
  /**
   * Additive (WS-C): the loaded catalogs. When given, an object that is neither a unified target nor a BSC star (a
   * KB-only HD star, a dark nebula) gets no row, since no other tab can show it; the ids handed to the actions are the
   * resolved routing ids. Without it the id is used as given (toRoutingId).
   */
  catalog?: ObjectCatalog;
  /** Additive (WS-C): the stop's display name for accessible labels (default: the app's display name, else the id). */
  name?: string;
  /**
   * Where the row sits. "overview": the hop carries `from: "overview"` on its journey ref, so "Back to journey"
   * returns to the Overview with this stop's card open (`#/journeys/<key>?stop=n`) instead of field mode.
   */
  origin?: "overview" | "field";
}

/** The app's one display label for a resolved object (lib/object-links displayName), else its catalog name. */
export function resolvedLabel(r: ResolvedObject, catalog: ObjectCatalog): string {
  const target = r.unifiedId ? catalog.targets.find((t) => t.id === r.unifiedId) : undefined;
  if (target) return displayName(target);
  const star = r.hr ? catalog.stars.find((s) => s.hr === r.hr) : undefined;
  return star ? displayName(star, catalog.targets) : r.name;
}

/** The journey ref the hop carries; from the Overview it also says so (`from: "overview"`, read by the hop's way back). */
export function journeyRefFor(journey: JourneyRef | undefined, origin?: "overview" | "field"): JourneyRef | undefined {
  return journey && origin === "overview" ? { ...journey, from: "overview" } : journey;
}

/** What "Plan star hop" hands to actions.hop: the stop's time, where to start (never the stop itself) and the journey ref. */
export function hopOptions(id: string, o: { from?: string; at?: Date; journey?: JourneyRef }): Parameters<ObjectActions["hop"]>[1] {
  const start = o.from && !sameObject(o.from, id) ? o.from : undefined;
  return { ...(o.at ? { at: o.at } : {}), ...(start ? { from: start } : {}), ...(o.journey ? { journey: o.journey } : {}) };
}
/**
 * The journey tag "Add to tonight's plan" adds (ObjectActionRow addOptions): the journey, the 1-based stop number and,
 * when known, the stop's own planned time (`plannedAts`; never "now"), so the Planner keeps it in the journey's block at
 * its own time.
 */
export function addOptions(o: { journey?: JourneyRef; plannedAt?: Date }): { journeyKey?: string; journeyStops?: number[]; plannedAts?: (Date | undefined)[] } {
  return o.journey ? { journeyKey: o.journey.key, journeyStops: [o.journey.stop], ...(o.plannedAt ? { plannedAts: [o.plannedAt] } : {}) } : {};
}

export function StopActions({ objectId, actions, journey, from, at, plannedAt, compact = false, catalog, name, origin }: StopActionsProps) {
  const [more, setMore] = useState(false);
  const resolved = catalog ? resolveObject(objectId, catalog) : null;
  if (catalog && !resolved) return null;
  const id = resolved?.routingId ?? toRoutingId(objectId);
  if (!id) return null;
  return <div className={`stop-actions${compact ? " compact" : ""}`} data-more={more ? "open" : "closed"} data-testid="stop-actions">
    <ObjectActionRow objectId={id} name={name ?? (resolved && catalog ? resolvedLabel(resolved, catalog) : objectId)} actions={actions} at={at} variant={compact ? "compact" : "full"}
      onHop={() => actions.hop(id, hopOptions(id, { from, at, journey: journeyRefFor(journey, origin) }))} addOptions={addOptions({ journey, plannedAt })}>
      <button type="button" className="object-action stop-action-more" aria-expanded={more} onClick={() => setMore((m) => !m)} data-testid="stop-action-more">
        <Ellipsis size={14} aria-hidden="true"/>{more ? "Less" : "More"}
      </button>
    </ObjectActionRow>
  </div>;
}
