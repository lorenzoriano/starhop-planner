/**
 * The shared object-action row (integration r5): the same verbs, order and labels on every tab that shows an object
 * (Tonight cards, Catalog rows and focus, Binoculars dialog, Moon comparison card, Clock list, journey stops via
 * StopActions). Labels come from LINK_LABELS; verbs from the planner's ObjectActions. A tab leaves out the verb that
 * would open itself (`omit`) and may keep its own add/remove toggle (`saved` + `onToggleSave`), which knows which night
 * it saves to.
 *
 * Two looks, one order (OBJECT_ACTION_ORDER) and one fixed gap each:
 * - `compact` (cards, list rows): icon + label as quiet text actions, 12px, gap 4px × 14px, wrapping by whole action.
 * - `full` (detail panels, dialogs, journey stop cards): outlined buttons, "Plan star hop" highlighted, gap 6px,
 *   wrapping by whole button.
 * The older names still work: `links` = `compact`, `buttons` = `full` (the row keeps both class names, so existing
 * selectors such as `.object-action-row.buttons` keep matching).
 */
import type { ReactNode } from "react";
import { BookOpen, Check, Clock, Image as ImageIcon, Moon, Navigation, Plus } from "lucide-react";
import { LINK_LABELS, type ObjectActions } from "@/lib/object-links";
import "./ObjectActionRow.css";

export type ObjectActionKey = "hop" | "moon" | "clock" | "catalog" | "images" | "addToNight";
/** Display order everywhere (contract §5). */
export const OBJECT_ACTION_ORDER: readonly ObjectActionKey[] = ["hop", "moon", "clock", "catalog", "images", "addToNight"];
/**
 * What object cards (Tonight's Best, Binoculars) leave out of their compact row: the card's photo and its details panel
 * already lead to the Catalog entry and photographs. Same set on every card grid.
 */
export const CARD_ACTION_OMIT: readonly ObjectActionKey[] = ["catalog", "images"];
export const REMOVE_FROM_NIGHT = "Remove from tonight's plan";

export type ObjectActionVariant = "compact" | "full" | "links" | "buttons";
/** The row's look for a variant name (older names map to the two looks) and the class names it carries. */
export function objectActionLook(variant: ObjectActionVariant = "compact"): { look: "compact" | "full"; className: string } {
  const look = variant === "full" || variant === "buttons" ? "full" : "compact";
  return { look, className: look === "full" ? "full buttons" : "compact links" };
}

/** The verbs a row shows, in order, without the omitted ones. */
export const objectActionKeys = (omit: readonly ObjectActionKey[] = []) => OBJECT_ACTION_ORDER.filter((key) => !omit.includes(key));

export interface ObjectActionRowProps {
  /** Any id form; the planner resolves it. */
  objectId: string;
  /** The object's display name (for accessible labels). */
  name: string;
  actions: ObjectActions;
  /** The moment the row is about (a card's matching time, a dialog's chosen time); verbs preview it. */
  at?: Date;
  omit?: readonly ObjectActionKey[];
  /** The tab's own night toggle; without it the row adds with actions.addToNight (add-only). */
  saved?: boolean;
  onToggleSave?: () => void;
  /** The tab's own hop (e.g. Binoculars plans at its explicit time); default actions.hop(id, {at}). */
  onHop?: () => void;
  /** Reason the hop is unavailable (disables it). */
  hopDisabled?: string;
  /** Runs before any verb (e.g. close the dialog the row sits in). */
  onBefore?: () => void;
  /** "compact": text actions (cards, lists); "full": outlined buttons (detail panels, dialogs). "links"/"buttons" are the older names. */
  variant?: ObjectActionVariant;
  className?: string;
  /**
   * Additive (WS-C): extra options for the add-only "Add to tonight's plan" (a journey stop tags the item with its
   * journey, its 1-based stop number and the stop's planned time). Ignored with `onToggleSave`.
   */
  addOptions?: { journeyKey?: string; journeyStops?: number[]; plannedAts?: (Date | undefined)[] };
  /** Extra items after the verbs (ObjectJourneyLinks). */
  children?: ReactNode;
}

export function ObjectActionRow({ objectId, name, actions, at, omit = [], saved, onToggleSave, onHop, hopDisabled, onBefore, variant = "compact", className = "", addOptions, children }: ObjectActionRowProps) {
  // A journey stop counts as in the night only with its journey tag and time, so the add can still fill them in.
  const journeyTag = !onToggleSave && addOptions?.journeyKey ? { journeyKey: addOptions.journeyKey, journeyStop: addOptions.journeyStops?.[0], plannedAt: addOptions.plannedAts?.[0] } : undefined;
  const inNight = saved ?? (journeyTag ? actions.isInNight(objectId, journeyTag) : actions.isInNight(objectId));
  const run = (verb: () => void) => () => { onBefore?.(); verb(); };
  const item: Record<ObjectActionKey, () => ReactNode> = {
    hop: () => <button key="hop" type="button" className="object-action primary" disabled={!!hopDisabled} title={hopDisabled} aria-label={`${LINK_LABELS.hop}: ${name}${hopDisabled ? `. ${hopDisabled}` : ""}`} onClick={run(onHop ?? (() => actions.hop(objectId, { at })))}><Navigation size={14} aria-hidden="true"/>{LINK_LABELS.hop}</button>,
    moon: () => <button key="moon" type="button" className="object-action" aria-label={`${LINK_LABELS.moon}: ${name}`} onClick={run(() => actions.moon(objectId, at))}><Moon size={14} aria-hidden="true"/>{LINK_LABELS.moon}</button>,
    clock: () => <button key="clock" type="button" className="object-action" aria-label={`${LINK_LABELS.clock}: ${name}`} onClick={run(() => actions.clock([objectId], at))}><Clock size={14} aria-hidden="true"/>{LINK_LABELS.clock}</button>,
    catalog: () => <button key="catalog" type="button" className="object-action" aria-label={`${LINK_LABELS.catalog}: ${name}`} onClick={run(() => actions.catalog(objectId))}><BookOpen size={14} aria-hidden="true"/>{LINK_LABELS.catalog}</button>,
    images: () => <button key="images" type="button" className="object-action" aria-label={`${LINK_LABELS.images}: ${name}`} onClick={run(() => actions.images(objectId))}><ImageIcon size={14} aria-hidden="true"/>{LINK_LABELS.images}</button>,
    addToNight: () => onToggleSave
      ? <button key="add" type="button" className={`object-action add ${inNight ? "saved" : ""}`} aria-pressed={inNight} aria-label={`${inNight ? REMOVE_FROM_NIGHT : LINK_LABELS.addToNight}: ${name}`} onClick={onToggleSave}>{inNight ? <Check size={14} aria-hidden="true"/> : <Plus size={14} aria-hidden="true"/>}{inNight ? REMOVE_FROM_NIGHT : LINK_LABELS.addToNight}</button>
      : <button key="add" type="button" className={`object-action add ${inNight ? "saved" : ""}`} disabled={inNight} aria-label={`${inNight ? "In tonight's plan" : LINK_LABELS.addToNight}: ${name}`} onClick={() => actions.addToNight([objectId], { at, ...addOptions })}>{inNight ? <Check size={14} aria-hidden="true"/> : <Plus size={14} aria-hidden="true"/>}{inNight ? "In tonight's plan" : LINK_LABELS.addToNight}</button>,
  };
  return <div className={`object-link-row object-action-row ${objectActionLook(variant).className} ${className}`} role="group" aria-label={`Actions for ${name}`} data-testid="object-action-row" data-look={objectActionLook(variant).look}>
    {objectActionKeys(omit).map((key) => item[key]())}
    {children}
  </div>;
}
