import { describe, expect, it } from "vitest";
import { appendNightItems } from "../night-ops";
import { nightListSchema, type NightItem } from "../session";

const AT = "2026-11-03T20:00:00.000Z";
const item = (id: string, extra: Partial<NightItem> = {}): NightItem => ({ id, addedAt: "2026-11-01T10:00:00.000Z", notes: "", ...extra });

describe("appendNightItems", () => {
  it("appends new objects in the given order and keeps existing items untouched and first", () => {
    const existing = [item("M31", { notes: "keep me", observedAt: "2026-11-02T02:00:00.000Z" }), item("M42")];
    const { items, added } = appendNightItems(existing, ["M45", "M31", "NGC869"], { at: AT });
    expect(items.map((i) => i.id)).toEqual(["M31", "M42", "M45", "NGC869"]);
    expect(items[0]).toEqual(existing[0]);
    expect(added).toEqual(["M45", "NGC869"]);
    expect(items[2]).toEqual({ id: "M45", addedAt: AT, notes: "" });
  });
  it("deduplicates across id forms and within the request, storing session ids", () => {
    const { items, added } = appendNightItems([item("STAR-Betelgeuse")], ["HR2061", "star:HR2061", "HR1017", "star:HR1017", "HR1017", ""], { at: AT });
    expect(items.map((i) => i.id)).toEqual(["STAR-Betelgeuse", "star:HR1017"]);
    expect(added).toEqual(["star:HR1017"]);
  });
  it("tags new items with the journey and stop, and tags an existing untagged item without moving it", () => {
    const { items } = appendNightItems([item("M45"), item("M1", { journeyKey: "other", journeyStop: 2 })], ["M45", "M1", "NGC869"], { at: AT, journeyKey: "k1", journeyStops: [1, 2, 3] });
    expect(items).toEqual([item("M45", { journeyKey: "k1", journeyStop: 1 }), item("M1", { journeyKey: "other", journeyStop: 2 }), { id: "NGC869", addedAt: AT, notes: "", journeyKey: "k1", journeyStop: 3 }]);
    expect(nightListSchema.parse(items)).toEqual(items);
  });
  it("is a no-op for an empty request and never removes anything", () => {
    const existing = [item("M31")];
    expect(appendNightItems(existing, [], { at: AT })).toEqual({ items: existing, added: [], updated: [] });
    expect(appendNightItems(existing, ["M31"], { at: AT }).items).toEqual(existing);
  });
});
