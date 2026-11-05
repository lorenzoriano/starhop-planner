/**
 * Hopper audit: does the star hopper do a good job on real journeys? Real KB + real journey engine + real catalogs
 * + the real route planner (planChain → planRoutes), several sites, dates and themes. Each journey is planned the way
 * Star hop shows it ("Hop the whole journey"), at the journey's instant, with the default Guided (beginner) difficulty,
 * for two instruments: 10×50 binoculars (6.5° field, stars to mag 6.5) and the app's default 14×50 (3.7° field, stars
 * to mag 8; the bright-star waypoint catalogue is sparsest relative to this field).
 *
 * Checks: share of legs that reach their stop, no failed leg for a stop ≥ 30° up, every hopped leg within
 * ceil(distance / (0.7·field)) + 3 moves, and rule 5 (docs/sky-journeys/07-integration.md): the journey's "Get there"
 * agrees with Star hop. The engine's distance in fields is turned into hop units with `estimateHops` (the estimate the
 * journey card shows before the chain is planned) and compared with the moves the hopper plans. The per-leg table and
 * the disagreements are printed for the owner. Skipped without kb.json (like engine.realkb.test.ts).
 *
 * HOPPER_AUDIT_FOV / HOPPER_AUDIT_MAG (and HOPPER_AUDIT_MAGNIFICATION) run it for one other instrument instead.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { angularDistance, buildUnifiedTargets, loadBinocularTargets, loadMessier, loadStars, type ObservingParams } from "../astronomy";
import { estimateHops, legHopBound, legStartHops, planChain } from "../hop-chain";
import type { ChainResult, ObjectCatalog } from "../object-links";
import { generate } from "../journeys/assemble";
import { knowledgeBaseFromFiles } from "../journeys/kb-schema";
import type { Journey, JourneyRequest, KnowledgeBase } from "../journeys/types";
import { journeyChainStops } from "@/components/useHopChain";

const dir = new URL("../../../public/data/journeys/", import.meta.url);
const FILES = ["kb.json", "concepts.json", "edges.json", "templates.json", "narration.json"] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

interface Optics { label: string; fov: number; mag: number; magnification: number }
/** The instruments audited: 10×50 (6.5° field, stars to 6.5) and the app's default 14×50 (3.7° field, stars to 8). */
const OPTICS: Optics[] = process.env.HOPPER_AUDIT_FOV || process.env.HOPPER_AUDIT_MAG
  ? [{ label: "custom", fov: Number(process.env.HOPPER_AUDIT_FOV) || 6.5, mag: Number(process.env.HOPPER_AUDIT_MAG) || 6.5, magnification: Number(process.env.HOPPER_AUDIT_MAGNIFICATION) || 10 }]
  : [{ label: "10×50", fov: 6.5, mag: 6.5, magnification: 10 }, { label: "14×50, the app's default", fov: 3.7, mag: 8, magnification: 14 }];
type Site = [label: string, instant: string, lat: number, lon: number, theme?: string];
// Sites and dates: both hemispheres, four seasons, plus themed requests (the owner's San Francisco evening).
const SITES: Site[] = [
  ["San Francisco, Nov 2026", "2026-11-04T05:30:00Z", 37.77, -122.42],
  ["San Francisco, Nov 2026 · Seeing Double", "2026-11-04T05:30:00Z", 37.77, -122.42, "A9-seeing-double"],
  ["San Francisco, Nov 2026 · How Stars Die", "2026-11-04T05:30:00Z", 37.77, -122.42, "A8-how-stars-die"],
  ["San Francisco, Jan 2027", "2027-01-08T04:15:00Z", 37.77, -122.42],
  ["Colorado, Jul 2027", "2027-07-05T05:30:00Z", 38.8, -104.5],
  ["London, Oct 2027", "2027-10-29T20:00:00Z", 51.5, -0.1],
  ["Sydney, Jul 2027", "2027-07-05T09:30:00Z", -33.9, 151.2],
  ["Santiago, Apr 2027", "2027-04-07T00:00:00Z", -33.4, -70.7],
  ["Santiago, Apr 2027 · Cradle to Grave", "2027-04-07T00:00:00Z", -33.4, -70.7, "A1-cradle-to-grave"],
  ["San Francisco, full Moon Jan 2027 · Moonlight Can't Hide These", "2027-01-22T07:00:00Z", 37.77, -122.42, "A12-moonlit"],
];
/** HOPPER_AUDIT_DIFFICULTY=intermediate|expert re-runs the audit at another Star hop difficulty (default: Guided). */
const DIFFICULTY = (["beginner", "intermediate", "expert"] as const).find((d) => d === process.env.HOPPER_AUDIT_DIFFICULTY) ?? "beginner";

/** Thresholds (see the report in the r5 WS-B hand-off for the observed values). */
const MIN_REACHED_SHARE = 0.9;
const MIN_ALT_FOR_ROUTE = 30;
/** Rule 5: a hopped leg agrees with the journey's estimate when its moves are within max(2, half the estimate) of it… */
const hopTolerance = (estimate: number) => Math.max(2, Math.ceil(estimate / 2));
/** …for at least this share of the hopped legs (the rest are printed as disagreements). */
const MIN_AGREEING_SHARE = 0.85;

interface Row { case: string; journey: string; leg: number; from: string; to: string; alt: number | null; status: string; hops: number; dist: number | null; bound: number | null; maxHopFov: number | null; engine: string; estimate: number | null; ms: number }

/** Legs whose hop count is compared with the journey: hopped legs (not the naked-eye first stop) and same-field calls. */
const compared = (r: Row) => r.estimate !== null && (r.status === "ok" || r.status === "jump" || r.status === "same-field") && !(r.from === "(anchor)" && r.hops === 0);
function disagrees(r: Row): boolean {
  if (!compared(r)) return false;
  if (/^same-field/.test(r.engine)) return r.status !== "same-field" && r.hops > 1;
  return Math.abs(r.hops - r.estimate!) > hopTolerance(r.estimate!);
}

for (const { label: opticsLabel, fov: FOV, mag: MAG, magnification } of OPTICS) {
  const req = (instant: string, lat: number, lon: number, theme?: string): JourneyRequest => ({
    instant, lat, lon, instrument: { fovDeg: FOV, aperture: 50, magnification }, skyBrightness: 20.5, length: 5, includeChallenge: false, limit: 3, ...(theme ? { theme } : {}),
  });
  const CASES: [string, JourneyRequest][] = SITES.map(([label, instant, lat, lon, theme]) => [label, req(instant, lat, lon, theme)]);

  describe.skipIf(!present)(`journey hopper audit (real KB, real engine, real hopper) · ${opticsLabel}: ${FOV}° field, stars to ${MAG}`, () => {
    let kb: KnowledgeBase, catalog: ObjectCatalog;
    const rows: Row[] = [];
    const chains: { label: string; journey: Journey; chain: ChainResult }[] = [];

    beforeAll(async () => {
      vi.stubGlobal("fetch", async (input: string) => new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), { status: 200, headers: { "Content-Type": "application/json" } }));
      kb = knowledgeBaseFromFiles({ kb: read("kb.json"), concepts: read("concepts.json"), edges: read("edges.json"), templates: read("templates.json"), narration: read("narration.json"), lenses: existsSync(new URL("lenses.json", dir)) ? read("lenses.json") : undefined });
      const [stars, messier, bino] = await Promise.all([loadStars(), loadMessier(), loadBinocularTargets()]);
      catalog = { stars, targets: buildUnifiedTargets(messier, bino) };
      const kbById = new Map(kb.objects.map((o) => [o.id, o]));
      for (const [label, r] of CASES) {
        const base: ObservingParams = { lat: r.lat, lon: r.lon, date: new Date(r.instant), fovWidth: FOV, fovHeight: FOV, fovShape: "circle", limitingMag: MAG, numRoutes: 3, targetId: "", observingMode: "binocular", difficulty: DIFFICULTY };
        for (const journey of generate(kb, r).journeys) {
          // Exactly what "Hop the whole journey" plans (useHopChain resolveChainSource).
          const { stops, extraTargets } = journeyChainStops(journey.stops.map((s) => s.objectId), catalog, { journey, kbObject: (id) => kbById.get(id) });
          const chain = await planChain({ ...base, extraTargets }, stops);
          chains.push({ label, journey, chain });
          const starts = legStartHops(chain), hops = chain.route?.hops ?? [];
          chain.legs.forEach((leg, i) => {
            const node = chain.nodes.find((n) => n.id === leg.to);
            const end = chain.stopHopIndex[i];
            let dist: number | null = null, moves = leg.hops;
            if (end >= 0 && leg.status !== "same-field") {
              // Moves counted from the leg's own start field (previous stop, or the anchor of a jump / first leg).
              const fresh = !leg.from || leg.status === "jump" || !!leg.note?.startsWith("Starts from");
              const startIdx = fresh ? starts[i] : starts[i] - 1;
              dist = angularDistance(hops[startIdx].center.ra, hops[startIdx].center.dec, hops[end].center.ra, hops[end].center.dec);
              moves = end - startIdx;
            }
            // The journey's own estimate in hop units: a sweep counts from the previous stop, a naked-eye step from its anchor.
            const g = journey.stops[i].getThere, anchor = g.anchorId ? kbById.get(g.anchorId) : undefined, here = kbById.get(journey.stops[i].objectId);
            const engineFields = g.mode === "naked-eye-hop" ? (anchor && here && anchor.id !== here.id ? angularDistance(anchor.ra, anchor.dec, here.ra, here.dec) / FOV : 0) : g.fields;
            rows.push({
              case: label, journey: journey.title, leg: leg.leg, from: leg.from ? chain.stops.find((s) => s.id === leg.from)?.label ?? leg.from : "(anchor)",
              to: chain.stops[i].label, alt: node ? Math.round(node.alt) : null, status: leg.status, hops: moves, dist: dist === null ? leg.distanceDeg && Math.round(leg.distanceDeg * 10) / 10 : Math.round(dist * 10) / 10,
              bound: dist === null ? null : legHopBound(dist, FOV), maxHopFov: leg.maxHopFov === null ? null : Math.round(leg.maxHopFov * 100) / 100,
              engine: `${leg.journeyGetThere?.mode ?? "?"}${leg.journeyGetThere?.fields !== undefined ? ` ${leg.journeyGetThere.fields.toFixed(1)}f` : ""}`, estimate: estimateHops(engineFields), ms: leg.ms,
            });
          });
        }
      }
      const count = (f: (r: Row) => boolean) => rows.filter(f).length;
      const reached = count((r) => ["ok", "same-field", "jump"].includes(r.status));
      console.log(`\nHOPPER AUDIT (${DIFFICULTY}, ${opticsLabel}: ${FOV}° field, stars to ${MAG}): ${chains.length} journeys, ${rows.length} legs; reached ${reached}/${rows.length} (${(100 * reached / rows.length).toFixed(1)}%)`);
      console.log("status counts:", JSON.stringify(Object.fromEntries(["ok", "same-field", "jump", "no-route", "below-horizon", "anchor-unavailable", "unresolved"].map((s) => [s, count((r) => r.status === s)]))));
      const hopped = rows.filter((r) => r.status === "ok" || r.status === "jump");
      const hopsList = hopped.map((r) => r.hops).sort((a, b) => a - b);
      console.log(`hops per hopped leg: median ${hopsList[Math.floor(hopsList.length / 2)]}, p90 ${hopsList[Math.floor(hopsList.length * 0.9)]}, max ${hopsList.at(-1)}; legs over bound: ${count((r) => r.bound !== null && r.hops > r.bound)}; planning ms total ${rows.reduce((s, r) => s + r.ms, 0)}`);
      console.log("journey coverage:", chains.map((c) => `${c.label} / ${c.journey.title}: ${Math.round(c.chain.coverage * 100)}%`).join("\n  "));
      const line = (r: Row) => `  ${r.case} / ${r.journey} · leg ${r.leg}: ${r.from} → ${r.to} · ${r.alt ?? "?"}° up · ${r.status} · ${r.hops} hops${r.dist !== null ? ` over ${r.dist}°` : ""}${r.bound !== null ? ` (bound ${r.bound})` : ""}${r.maxHopFov !== null ? ` · longest ${r.maxHopFov} fov` : ""} · engine ${r.engine} ≈ ${r.estimate} hops`;
      console.log(`LEGS:\n${rows.map(line).join("\n")}`);
      const disagreements = rows.filter(disagrees);
      console.log(`DISAGREEMENTS (hopper moves outside estimateHops(engine fields) ± max(2, estimate/2), or engine same field and hopper not): ${disagreements.length} of ${rows.filter(compared).length} compared legs`);
      if (disagreements.length) console.log(disagreements.map(line).join("\n"));
      const failures = rows.filter((r) => !["ok", "same-field", "jump"].includes(r.status));
      if (failures.length) console.log(`FAILED LEGS:\n${failures.map(line).join("\n")}`);
    }, 600_000);
    afterAll(() => vi.unstubAllGlobals());

    it("generates journeys for every case", () => {
      expect(chains.length).toBeGreaterThanOrEqual(CASES.length * 2);
    });

    it(`reaches at least ${MIN_REACHED_SHARE * 100}% of journey stops by hops`, () => {
      const reached = rows.filter((r) => ["ok", "same-field", "jump"].includes(r.status)).length;
      expect(reached / rows.length).toBeGreaterThanOrEqual(MIN_REACHED_SHARE);
    });

    it(`has no failed leg for a stop at least ${MIN_ALT_FOR_ROUTE}° up`, () => {
      const failed = rows.filter((r) => ["no-route", "anchor-unavailable", "unresolved"].includes(r.status) && (r.alt ?? 90) >= MIN_ALT_FOR_ROUTE);
      expect(failed.map((r) => `${r.case} / ${r.journey} leg ${r.leg}: ${r.from} → ${r.to} (${r.status})`)).toEqual([]);
    });

    it(`agrees with the journey's Get there (estimateHops ± max(2, half)) on at least ${MIN_AGREEING_SHARE * 100}% of hopped legs`, () => {
      const legs = rows.filter(compared);
      expect(legs.length).toBeGreaterThan(50);
      expect(legs.filter((r) => !disagrees(r)).length / legs.length).toBeGreaterThanOrEqual(MIN_AGREEING_SHARE);
    });

    it("keeps every hopped leg within ceil(distance / (0.7·field)) + 3 moves", () => {
      const over = rows.filter((r) => r.bound !== null && r.hops > r.bound);
      expect(over.map((r) => `${r.case} / ${r.journey} leg ${r.leg}: ${r.from} → ${r.to}: ${r.hops} hops over ${r.dist}° (bound ${r.bound})`)).toEqual([]);
    });
  });
}
