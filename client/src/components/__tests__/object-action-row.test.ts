/**
 * Integration r5 fix 3: one ObjectActionRow look (compact / full) on every tab, Tonight cards plan through actions.hop,
 * the visible "Add to tonight's plan" label, in-app actions without the external-link arrow.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UnifiedTarget } from "@/lib/astronomy";
import { LINK_LABELS, NOOP_ACTIONS, type ObjectActions } from "@/lib/object-links";
import { CARD_ACTION_OMIT, OBJECT_ACTION_ORDER, ObjectActionRow, objectActionLook } from "../ObjectActionRow";
import { TargetCard, targetCardVerbs } from "../TargetCard";
import { photoCaption } from "../TargetPhoto";
import { journeyOutsideReason } from "../SessionPlanner";
import { openOwnChart } from "../CatalogExplorer";

const navigated = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/navigation")>()), navigateHash: (path: string) => { navigated.push(path); } }));

const DC: UnifiedTarget = { id: "NGC869", name: "Double Cluster (h Per)", displayName: "Double Cluster", mag: 4.3, ra: 34.75, dec: 57.13, con: "Per", category: "Open Cluster", categoryShort: "Open Cl.", source: "binocular" };
const labelsIn = (html: string) => Array.from(html.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)).map((m) => m[1].replace(/&#x27;/g, "'"));

describe("ObjectActionRow looks", () => {
  it("maps both variant names to two looks and keeps the older class names for existing selectors", () => {
    expect(objectActionLook()).toEqual({ look: "compact", className: "compact links" });
    expect(objectActionLook("links")).toEqual(objectActionLook("compact"));
    expect(objectActionLook("full")).toEqual({ look: "full", className: "full buttons" });
    expect(objectActionLook("buttons")).toEqual(objectActionLook("full"));
  });

  it("renders the same verbs in the same order with visible labels in both looks", () => {
    for (const variant of ["compact", "full"] as const) {
      const html = renderToStaticMarkup(createElement(ObjectActionRow, { objectId: "NGC869", name: "Double Cluster (NGC 869)", actions: NOOP_ACTIONS, variant }));
      expect(html).toContain(`data-look="${variant}"`);
      expect(labelsIn(html)).toEqual([LINK_LABELS.hop, LINK_LABELS.moon, LINK_LABELS.clock, LINK_LABELS.catalog, LINK_LABELS.images, LINK_LABELS.addToNight]);
    }
    expect(OBJECT_ACTION_ORDER).toEqual(["hop", "moon", "clock", "catalog", "images", "addToNight"]);
  });
});

describe("ObjectActionRow add for a journey stop", () => {
  it("asks isInNight with the journey tag and time, so a stop in the night but untimed can still be added", () => {
    const at = new Date("2026-11-04T04:30:00Z");
    const isInNight = vi.fn((_id: string, tag?: { plannedAt?: Date }) => !tag);
    const html = renderToStaticMarkup(createElement(ObjectActionRow, { objectId: "NGC869", name: "Double Cluster", actions: { ...NOOP_ACTIONS, isInNight }, addOptions: { journeyKey: "k", journeyStops: [2], plannedAts: [at] } }));
    expect(isInNight).toHaveBeenCalledWith("NGC869", { journeyKey: "k", journeyStop: 2, plannedAt: at });
    expect(labelsIn(html)).toContain(LINK_LABELS.addToNight);
    // Without journey options the plain check is used.
    isInNight.mockClear();
    renderToStaticMarkup(createElement(ObjectActionRow, { objectId: "NGC869", name: "Double Cluster", actions: { ...NOOP_ACTIONS, isInNight } }));
    expect(isInNight).toHaveBeenCalledWith("NGC869");
  });
});

describe("Tonight's Best card actions", () => {
  const visible = { target: DC, alt: 54, az: 40 } as never;
  const card = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(TargetCard, { object: visible, fit: "Excellent", saved: false, selected: false, onSelect: () => {}, onSave: () => {}, ...extra }));

  it("uses the shared compact row: labelled 'Add to tonight's plan', no bare '+', no external-link arrow", () => {
    const html = card({ actions: NOOP_ACTIONS });
    expect(html).toContain('data-testid="object-action-row"');
    expect(html).toContain('data-look="compact"');
    expect(labelsIn(html)).toEqual([LINK_LABELS.hop, LINK_LABELS.moon, LINK_LABELS.clock, LINK_LABELS.addToNight]);
    expect(html).not.toContain("lucide-arrow-up-right");
    expect(CARD_ACTION_OMIT).toEqual(["catalog", "images"]);
  });

  it("'Plan star hop' plans through actions.hop (one behaviour per label), not a card-only select-and-navigate", () => {
    const hop = vi.fn(), onHop = vi.fn();
    const actions: ObjectActions = { ...NOOP_ACTIONS, hop };
    const row = targetCardVerbs(actions, onHop, false);
    expect(row.onHop).toBeUndefined();
    row.verbs.hop("NGC869");
    expect(hop).toHaveBeenCalledWith("NGC869");
    expect(onHop).not.toHaveBeenCalled();
  });

  it("without shared actions falls back to the card's own hop and shows only verbs that work", () => {
    const onHop = vi.fn();
    const row = targetCardVerbs(undefined, onHop, true);
    expect(row.onHop).toBe(onHop);
    expect(row.verbs.isInNight("NGC869")).toBe(true);
    expect(row.omit).toEqual(["moon", "clock", "catalog", "images"]);
    const html = card({ onHop, saved: true });
    expect(labelsIn(html)).toEqual([LINK_LABELS.hop, "Remove from tonight's plan"]);
  });
});

describe("small fixes", () => {
  it("photo credits are short corner captions", () => {
    expect(photoCaption({ shortCredit: "DSS2 / CDS", caption: "DSS2 · OPTICAL SURVEY" })).toBe("DSS2 / CDS");
    expect(photoCaption({ caption: "Wikimedia" })).toBe("Wikimedia");
  });

  it("explains a journey stop outside the session with its local time", () => {
    expect(journeyOutsideReason(new Date("2026-11-04T05:02:00Z"), "America/Los_Angeles", 5))
      .toBe("Journey stop 5 is planned for 21:02, outside this session. Extend or move the session to keep the journey together.");
  });

  it("'Use your own chart' opens the image page prefilled with the object", () => {
    const update = vi.fn();
    openOwnChart("NGC869", update);
    expect(update).toHaveBeenCalledWith({ targetId: "NGC869", startStarId: undefined, waypointIds: undefined });
    expect(navigated).toEqual(["/image"]);
    expect(LINK_LABELS.ownChart).toBe("Use your own chart");
  });
});
