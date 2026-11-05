/**
 * One KB → target conversion (rule 1/8): the journey engine's toBinocularTarget (lib/journeys/conditions, kept in the
 * worker so it does not pull object-links' media tables in) must equal object-links kbToUnifiedTarget without `targets`
 * for every object of the shipped KB, so the engine and the stop cards rate the same object the same way. The engine
 * golden values depend on toBinocularTarget, which therefore stays as it is. Skipped without kb.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toBinocularTarget } from "../journeys/conditions";
import { kbToUnifiedTarget } from "../object-links";
import type { KbObject } from "../journeys/types";

const KB = new URL("../../../public/data/journeys/kb.json", import.meta.url);

describe.skipIf(!existsSync(KB))("KB → target parity: toBinocularTarget = kbToUnifiedTarget", () => {
  const objects = (JSON.parse(readFileSync(KB, "utf8")) as { objects: KbObject[] }).objects;
  it("converts every KB object identically (aliases are the app's extra)", () => {
    expect(objects.length).toBeGreaterThan(500);
    const differ = objects.filter((o) => {
      const { aliases: _aliases, ...app } = kbToUnifiedTarget(o);
      return JSON.stringify(app) !== JSON.stringify(toBinocularTarget(o));
    }).map((o) => o.id);
    expect(differ).toEqual([]);
  });
  it("keeps the missing-magnitude default the engine rates with (99), and StopCard's 6 only on request", () => {
    const dark = objects.find((o) => o.mag === null || o.mag === undefined);
    if (!dark) return;
    expect(toBinocularTarget(dark).mag).toBe(99);
    expect(kbToUnifiedTarget(dark).mag).toBe(99);
    expect(kbToUnifiedTarget(dark, { missingMag: 6 }).mag).toBe(6);
  });
});
