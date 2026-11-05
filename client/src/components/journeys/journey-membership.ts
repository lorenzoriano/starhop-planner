/**
 * Journey theme membership for one object (feeds ObjectJourneyLinks' "Find a journey with this" through
 * activeLensObjectKeys when a theme has no lens set). Cheap on purpose: it never runs the engine.
 * An object counts as part of a journey theme (template) when
 *   1. it is journey-eligible (curated card, sourced facts …),
 *   2. it fits one of the template's slots, and
 *   3. some other eligible object that also fits the template sits within one journey patch (2 × default region
 *      radius) and is joined to it by a usable story link of a type the template allows (NEIGHBOR never counts).
 * With `isUp`, partners must also pass that check (e.g. above the default minimum altitude tonight).
 */
import { MIN_EDGE_STRENGTH } from "@/lib/journeys/conditions";
import { prepareKb, slotMatches } from "@/lib/journeys/candidates";
import type { KbObject, KnowledgeBase } from "@/lib/journeys/types";
import { objectKey } from "@/lib/object-links";
import { RETIRED_THEMES } from "./journey-view";

export const MEMBERSHIP_PATCH_DEG = 60;

export interface JourneyMembership {
  /** Template ids (themes) the object can take part in. */
  templateIds: string[];
  /** Distinct story partners across those templates. */
  partnerIds: string[];
}

export function journeyMembership(kb: KnowledgeBase, objectId: string, opts: { isUp?: (o: KbObject) => boolean; patchDeg?: number } = {}): JourneyMembership {
  const prep = prepareKb(kb);
  const x = prep.index.get(objectId);
  if (x === undefined || !prep.eligible[x]) return { templateIds: [], partnerIds: [] };
  const patch = opts.patchDeg ?? MEMBERSHIP_PATCH_DEG;
  const fits = (i: number, slots: KnowledgeBase["templates"][number]["slots"]) => slots.some((s) => slotMatches(prep.objects[i], s.match, prep.concepts[i]));
  // Partner pool shared by all templates: eligible, nearby, up.
  const pool: number[] = [];
  for (let y = 0; y < prep.objects.length; y++) {
    if (y === x || !prep.eligible[y] || prep.sepDeg(x, y) > patch) continue;
    if (opts.isUp && !opts.isUp(prep.objects[y])) continue;
    pool.push(y);
  }
  const templateIds: string[] = [];
  const partners = new Set<string>();
  for (const ct of prep.templates) {
    if (!fits(x, ct.t.slots)) continue;
    let found = false;
    for (const y of pool) {
      if (!fits(y, ct.t.slots)) continue;
      if (prep.graph.best(x, y, ct.allowed, MIN_EDGE_STRENGTH) || prep.graph.best(y, x, ct.allowed, MIN_EDGE_STRENGTH)) {
        found = true;
        partners.add(prep.objects[y].id);
      }
    }
    if (found) templateIds.push(ct.t.id);
  }
  return { templateIds, partnerIds: Array.from(partners).sort() };
}

/**
 * Keys (object-links objectKey) of every object an active theme can tell: those with a lens in the lens set of a
 * non-retired template's archetype ("Find a journey with this", integration r5). Themes without a lens set (and a KB
 * without lenses, like the test fixture) fall back to journeyMembership: the object fits that theme with a partner.
 */
export function activeLensObjectKeys(kb: KnowledgeBase): Set<string> {
  const active = kb.templates.filter((t) => !RETIRED_THEMES.has(t.id));
  const lensSets = new Map((kb.lenses ?? []).map((l) => [l.archetype, l]));
  const keys = new Set<string>();
  for (const t of active) for (const id of Object.keys(lensSets.get(t.archetype)?.objects ?? {})) keys.add(objectKey(id));
  const unlensed = new Set(active.filter((t) => !lensSets.has(t.archetype)).map((t) => t.id));
  if (unlensed.size) for (const o of kb.objects) {
    if (keys.has(objectKey(o.id))) continue;
    if (journeyMembership(kb, o.id).templateIds.some((id) => unlensed.has(id))) keys.add(objectKey(o.id));
  }
  return keys;
}
