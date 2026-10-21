import { describe, expect, it } from "vitest";
import { browsingMonthMoment, isPastBrowsingMoment } from "../binocular-browsing";

describe("binocular month browsing",()=>{
 const observing=new Date("2026-10-23T04:30:35Z");
 it("restores the user's Oct22 night when returning from a different monthly reference",()=>{
  expect(browsingMonthMoment(observing,11,2026,"America/Los_Angeles")).toBeNull();
  expect(browsingMonthMoment(observing,10,2026,"America/Los_Angeles")).toBe(observing);
  expect(browsingMonthMoment(observing,10,2027,"America/Los_Angeles")).toBeNull();
 });
 it("does not call the currently displayed minute a past observing time",()=>{
  expect(isPastBrowsingMoment(new Date("2026-10-23T04:30:00Z"),observing)).toBe(false);
  expect(isPastBrowsingMoment(new Date("2026-10-23T04:29:59Z"),observing)).toBe(true);
 });
});
