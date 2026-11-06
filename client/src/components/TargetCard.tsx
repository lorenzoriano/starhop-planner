import type { ReactNode } from "react";
import { getConstellationName } from "@/lib/astronomy";
import { targetDesignation } from "@/lib/catalog-presentation";
import { displayName, objectName, NOOP_ACTIONS, type ObjectActions } from "@/lib/object-links";
import { compassLabel, type VisibleTarget } from "@/lib/observing";
import { MIN_ALT } from "@/lib/sky-feasibility";
import { TargetPhoto } from "./TargetPhoto";
import { CARD_ACTION_OMIT, ObjectActionRow, type ObjectActionKey } from "./ObjectActionRow";

/**
 * The verbs a card's action row uses. With the planner's shared `actions`, "Plan star hop" plans through actions.hop
 * like every other tab (one behaviour per label); without them (previews, older callers) it falls back to `onHop`,
 * and only the verbs that can work are shown.
 */
export function targetCardVerbs(actions: ObjectActions | undefined, onHop: (() => void) | undefined, saved: boolean): { verbs: ObjectActions; omit: readonly ObjectActionKey[]; onHop?: () => void } {
  if (actions) return { verbs: actions, omit: CARD_ACTION_OMIT };
  return { verbs: { ...NOOP_ACTIONS, isInNight: () => saved }, omit: ["moon", "clock", "catalog", "images", ...(onHop ? [] : ["hop" as const])], onHop };
}

/** One object in the Tonight's Best grid. `linksSlot` renders below the actions (journey links, ObjectJourneyLinks). */
export function TargetCard({
  object,
  fit,
  saved,
  selected,
  onSelect,
  onSave,
  onHop,
  actions,
  at,
  omit,
  linksSlot,
  summary,
}: {
  object: VisibleTarget;
  fit: string;
  saved: boolean;
  selected: boolean;
  onSelect: () => void;
  onSave: () => void;
  /** @deprecated Fallback only: with `actions`, "Plan star hop" goes through actions.hop. */
  onHop?: () => void;
  /** The planner's shared object verbs (lib/object-links). */
  actions?: ObjectActions;
  /** The moment the card is about (verbs preview it); default the viewed sky. */
  at?: Date;
  /** Verbs to leave out (default CARD_ACTION_OMIT). */
  omit?: readonly ObjectActionKey[];
  linksSlot?: ReactNode;
  /** The shared short description (object-info objectSummaryText), two lines at most. */
  summary?: string;
}) {
  const { target, alt, az } = object;
  const row = targetCardVerbs(actions, onHop, saved);
  return (
    <article className={`target-card ${selected ? "selected" : ""}`}>
      <button
        className="target-card-main"
        onClick={onSelect}
        aria-label={`Explore ${displayName(target)}`}
        aria-pressed={selected}
        title="Select this object and show its details above"
        data-testid={`target-${target.id}`}
      >
        <div className="target-thumbnail">
          <TargetPhoto target={target} compact />
        </div>
        <div className="target-card-info">
          <span className="eyebrow">
            {targetDesignation(target)} · {target.categoryShort}
          </span>
          <h3>{objectName(target).name}</h3>
          <p>{getConstellationName(target.con)}</p><span className="target-fit">{fit}</span>
          {summary && <p className="target-summary">{summary}</p>}
          <div className={`target-alt ${alt < MIN_ALT.possible || object.obstructed ? "low" : ""}`}>
            <span className="status-dot" />
            {Math.round(alt)}° {compassLabel(az)}
            {object.obstructed && alt > 0 && <span>· behind the hills</span>}
            <span>· mag {target.mag.toFixed(1)}</span>
          </div>
        </div>
      </button>
      <div className="target-card-object-actions">
        <ObjectActionRow objectId={target.id} name={displayName(target)} actions={row.verbs} at={at} omit={actions ? omit ?? row.omit : row.omit} saved={saved} onToggleSave={onSave} onHop={row.onHop} variant="compact"/>
      </div>
      {linksSlot}
    </article>
  );
}
