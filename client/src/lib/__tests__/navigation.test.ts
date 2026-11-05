import { describe, expect, it } from "vitest";
import { catalogPath, hopPath, journeyFocusFromPath, journeyOverviewStopPath, journeyRouteFromPath, journeysFocusPath, pageForPath, parseCatalogLocation, parseHopLocation, targetFromPath } from "../navigation";

describe("hop locations", () => {
  it("round-trips single, journey-stop and chained hop locations", () => {
    const cases = [
      { targetId: "M42" },
      { targetId: "NGC869", journey: { key: "look-alikes~M45.NGC869~202611040430", stop: 4 } },
      { targetId: "STAR-Betelgeuse", journey: { key: "k" }, chain: { from: 1, to: 5 } },
      { targetId: "HR1017", journey: { key: "k" }, chain: { from: 2, to: 5 }, leg: 3 },
    ];
    for (const c of cases) {
      const { targetId, ...rest } = c;
      const path = hopPath(targetId, rest);
      expect(parseHopLocation(path)).toEqual(c);
      expect(pageForPath(path)).toBe("hop");
      expect(targetFromPath(path)).toBe(targetId);
    }
    expect(hopPath("NGC869", { journey: { key: "a b/c", stop: 2 } })).toBe("/hop/NGC869?journey=a+b%2Fc&stop=2");
  });
  it("carries a hop opened from the journey Overview (from=overview) and returns there with the stop's card open", () => {
    const path = hopPath("M31", { journey: { key: "k", stop: 3, from: "overview" } });
    expect(path).toBe("/hop/M31?journey=k&stop=3&from=overview");
    expect(parseHopLocation(path)).toEqual({ targetId: "M31", journey: { key: "k", stop: 3, from: "overview" } });
    expect(parseHopLocation("/hop/M31?journey=k&stop=3&from=elsewhere")).toEqual({ targetId: "M31", journey: { key: "k", stop: 3 } });
    const back = journeyOverviewStopPath("a b", 3);
    expect(back).toBe("/journeys/a%20b?stop=3");
    expect(pageForPath(back)).toBe("journeys");
    expect(journeyRouteFromPath(back)).toEqual({ view: "overview", key: "a b" });
  });
  it("keeps existing hop paths working and ignores malformed query values", () => {
    expect(targetFromPath("/hop/M31")).toBe("M31");
    expect(parseHopLocation("/hop/M31")).toEqual({ targetId: "M31" });
    expect(parseHopLocation("/hop/M31?chain=5-1&leg=0&stop=x")).toEqual({ targetId: "M31" });
    expect(parseHopLocation("/catalog")).toBeNull();
  });
});

describe("catalog and journeys focus locations", () => {
  it("round-trips object and photos", () => {
    expect(parseCatalogLocation(catalogPath("NGC869"))).toEqual({ objectId: "NGC869", photos: false });
    expect(parseCatalogLocation(catalogPath("star:HR1017", { photos: true }))).toEqual({ objectId: "star:HR1017", photos: true });
    expect(pageForPath(catalogPath("M42", { photos: true }))).toBe("catalog");
    expect(parseCatalogLocation("/catalog")).toEqual({ photos: false });
  });
  it("journeys focus stays on Discovery", () => {
    const path = journeysFocusPath("NGC7209");
    expect(pageForPath(path)).toBe("journeys");
    expect(journeyRouteFromPath(path)).toEqual({ view: "discover" });
    expect(journeyFocusFromPath(path)).toBe("NGC7209");
  });
});
