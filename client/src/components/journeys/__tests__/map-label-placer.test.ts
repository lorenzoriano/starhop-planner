import { describe, expect, it } from "vitest";
import { boxAt, overlapArea, placeStopLabels, segmentLengthInBox, type PlacerInput } from "../map-label-placer";
import { fieldAnchor } from "../journey-view";
import type { Journey, KbObject } from "@/lib/journeys/types";

const view = { l: 0, t: 0, r: 400, b: 400 };
const base = (over: Partial<PlacerInput> = {}): PlacerInput => ({ labels: [], rings: [], stars: [], view, unit: 1, ...over });
const label = (x: number, y: number, mag: number | null = 5, width = 60) => ({ x, y, ring: 7, width, height: 14, mag });
const ringOf = (l: { x: number; y: number; ring: number }) => ({ x: l.x, y: l.y, r: l.ring });
const centre = (b: { l: number; t: number; r: number; b: number }) => ({ x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });

describe("map label placer", () => {
  it("puts a free label right beside its ring, with no leader", () => {
    const a = label(100, 100);
    const [p] = placeStopLabels(base({ labels: [a], rings: [ringOf(a)] }));
    expect(p).not.toBeNull();
    expect(p!.box.l).toBeGreaterThanOrEqual(100 + 7);
    expect(p!.box.l).toBeLessThan(100 + 7 + 6);
    expect(p!.leader).toBeNull();
    expect(p!.forced).toBe(false);
  });

  it("never covers a star brighter than the stop", () => {
    const a = label(100, 100, 5);
    // a mag 2 star just right of the ring, where the label would go first
    const stars = [{ x: 125, y: 100, r: 2.5, mag: 2 }];
    const [p] = placeStopLabels(base({ labels: [a], rings: [ringOf(a)], stars }));
    const s = stars[0];
    const dx = Math.max(p!.box.l - s.x, 0, s.x - p!.box.r), dy = Math.max(p!.box.t - s.y, 0, s.y - p!.box.b);
    expect(Math.hypot(dx, dy)).toBeGreaterThan(s.r);
    expect(p!.forced).toBe(false);
  });

  it("keeps stop labels apart and each nearer its own ring than any other ring", () => {
    const a = label(100, 100, 5, 90), b = label(160, 100, 5, 90);
    const rings = [ringOf(a), ringOf(b)];
    const [pa, pb] = placeStopLabels(base({ labels: [a, b], rings }));
    expect(overlapArea(pa!.box, pb!.box)).toBe(0);
    const d = (p: { x: number; y: number }, box: { l: number; t: number; r: number; b: number }) => Math.hypot(Math.max(box.l - p.x, 0, p.x - box.r), Math.max(box.t - p.y, 0, p.y - box.b));
    expect(d(a, pa!.box)).toBeLessThan(d(b, pa!.box));
    expect(d(b, pb!.box)).toBeLessThan(d(a, pb!.box));
  });

  it("moves away from a crowded side and draws a leader back to the ring", () => {
    const a = label(200, 200, 6);
    // bright stars hugging the ring on every side at the adjacent distance (between the eight label directions,
    // so a leader can still pass between them)
    const stars = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((deg) => ({ x: 200 + Math.cos((deg * Math.PI) / 180) * 14, y: 200 + Math.sin((deg * Math.PI) / 180) * 14, r: 2, mag: 3 }));
    const [p] = placeStopLabels(base({ labels: [a], rings: [ringOf(a)], stars }));
    expect(p!.leader).not.toBeNull();
    for (const s of stars) {
      const dx = Math.max(p!.box.l - s.x, 0, s.x - p!.box.r), dy = Math.max(p!.box.t - s.y, 0, s.y - p!.box.b);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(s.r);
    }
  });

  it("stays inside the visible frame", () => {
    const a = label(395, 200, 5, 80);
    const [p] = placeStopLabels(base({ labels: [a], rings: [ringOf(a)] }));
    expect(p!.box.r).toBeLessThanOrEqual(view.r);
    expect(p!.box.l).toBeGreaterThanOrEqual(view.l);
  });

  it("prefers a side away from the hop lines", () => {
    const a = label(200, 200, 5, 80);
    // hop lines leave the ring to the right and to the left
    const segments = [{ a: { x: 200, y: 200 }, b: { x: 380, y: 200 } }, { a: { x: 20, y: 200 }, b: { x: 200, y: 200 } }];
    const [p] = placeStopLabels(base({ labels: [a], rings: [ringOf(a)], segments }));
    const c = centre(p!.box);
    expect(Math.abs(c.y - 200)).toBeGreaterThan(7);
  });

  it("helpers: box placement and segment clipping", () => {
    expect(boxAt({ x: 10, y: 10 }, 1, 0, 20, 10)).toEqual({ l: 10, t: 5, r: 30, b: 15 });
    expect(boxAt({ x: 10, y: 10 }, -Math.SQRT1_2, -Math.SQRT1_2, 20, 10)).toEqual({ l: -10, t: 0, r: 10, b: 10 });
    expect(segmentLengthInBox({ x: 0, y: 5 }, { x: 100, y: 5 }, { l: 10, t: 0, r: 30, b: 10 })).toBeCloseTo(20);
    expect(segmentLengthInBox({ x: 0, y: 50 }, { x: 100, y: 50 }, { l: 10, t: 0, r: 30, b: 10 })).toBe(0);
  });
});

describe("fieldAnchor", () => {
  const obj = (id: string, name: string): KbObject => ({ id, ra: 10, dec: 20, names: { display: name } } as unknown as KbObject);
  const objects = new Map([["STAR-Alderamin", obj("STAR-Alderamin", "Alderamin")], ["STAR-Alfirk", obj("STAR-Alfirk", "Alfirk")]]);
  const journey = (anchorId: string | undefined, objectId = "STAR-Alfirk") => ({ stops: [{ objectId, getThere: { mode: "naked-eye-hop", anchorId } }] } as unknown as Pick<Journey, "stops">);
  it("marks the naked-eye anchor the directions start from", () => {
    expect(fieldAnchor(journey("STAR-Alderamin"), 0, -1, objects, "naked-eye-hop")).toEqual({ id: "STAR-Alderamin", ra: 10, dec: 20, label: "Alderamin" });
  });
  it("does not mark the stop itself, a sweep, or a missing anchor", () => {
    expect(fieldAnchor(journey("STAR-Alfirk"), 0, -1, objects, "naked-eye-hop")).toBeNull();
    expect(fieldAnchor(journey("STAR-Alderamin"), 0, -1, objects, "sweep")).toBeNull();
    expect(fieldAnchor(journey(undefined), 0, -1, objects, "naked-eye-hop")).toBeNull();
  });
});

describe("map label placer: leaders", () => {
  it("never runs a leader over a bright star", () => {
    const a = { x: 200, y: 200, ring: 7, width: 60, height: 14, mag: 6 };
    // a bright star right beside the ring blocks the adjacent spot; everything else is crowded except far right
    const stars = [{ x: 216, y: 200, r: 2.5, mag: 2 }, ...[45, 90, 135, 180, 225, 270, 315].map((deg) => ({ x: 200 + Math.cos((deg * Math.PI) / 180) * 14, y: 200 + Math.sin((deg * Math.PI) / 180) * 14, r: 2, mag: 3 }))];
    const [p] = placeStopLabels({ labels: [a], rings: [{ x: 200, y: 200, r: 7 }], stars, view: { l: 0, t: 0, r: 400, b: 400 }, unit: 1 });
    if (p!.leader) {
      const { x1, y1, x2, y2 } = p!.leader;
      for (const s of stars) {
        const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((s.x - x1) * dx + (s.y - y1) * dy) / (dx * dx + dy * dy || 1)));
        expect(Math.hypot(s.x - x1 - t * dx, s.y - y1 - t * dy)).toBeGreaterThan(s.r);
      }
    }
  });
});
