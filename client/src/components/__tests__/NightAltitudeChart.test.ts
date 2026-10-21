import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NightAltitudeChart } from "../ObservingVisuals";
import { visibilityWindow } from "@/lib/target-visibility";
import { resolveLocalMoment } from "@/lib/session";
import type { UnifiedTarget } from "@/lib/astronomy";

const target={id:"M31",name:"Andromeda Galaxy",ra:10.6847,dec:41.269,mag:3.4,category:"Spiral Galaxy"} as UnifiedTarget;
const timezone="America/Los_Angeles",lat=37.7749,lon=-122.4194;
const night=visibilityWindow("2026-11-08","12:00","12:00","night",timezone,lat,lon);
describe("night chart observing context",()=>{
 it("removes irrelevant Moon separation from a Moon-down night",()=>{
  const html=renderToStaticMarkup(createElement(NightAltitudeChart,{target,lat,lon,timezone,night,skyBrightness:19}));
  expect(html).not.toContain('class="moon-separation-line"');
  expect(html).not.toContain('class="night-moon-key"');
  expect(html).toContain("Moon below horizon");
  expect(html).not.toContain("from Moon");
 });
 it("uses the scheduled row time rather than a competing independent suggestion",()=>{
  const scheduledAt=resolveLocalMoment("2026-11-08","18:48",timezone)!;
  const html=renderToStaticMarkup(createElement(NightAltitudeChart,{target,lat,lon,timezone,night,scheduledAt,skyBrightness:19}));
  expect(html).toContain("Scheduled: 18:48");
  expect(html).not.toContain("Suggested:");
  expect(html).not.toContain('class="night-observation-suggestion"');
 });
});
