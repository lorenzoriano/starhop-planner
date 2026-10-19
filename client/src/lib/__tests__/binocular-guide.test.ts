import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { formatInTimeZone } from "date-fns-tz";
import { buildUnifiedTargets, loadBinocularTargets, loadMessier, planRoutes, type UnifiedTarget } from "../astronomy";
import { BINOCULAR_ENTRIES, binocularCollection, binocularEvening } from "../binocular-guide";
import { binocularMedia, binocularDatabaseResources, binocularFeaturedImage, primaryOpticalImage } from "../binocular-media";

vi.stubGlobal("fetch", async (input: string) => new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), { status: 200 }));
afterAll(() => vi.unstubAllGlobals());
let targets: UnifiedTarget[];
beforeAll(async () => { targets = buildUnifiedTargets(await loadMessier(), await loadBinocularTargets()); });
const north = (month: number, lat = 37.77) => binocularCollection(targets, lat, -122.42, 2026, month, "America/Los_Angeles");
const south = (month: number) => binocularCollection(targets, -33.87, 151.21, 2026, month, "Australia/Sydney");

describe("monthly binocular guide", () => {
  it("resolves every sourced guide target against the actual offline catalogs", () => {
    const collection = north(10);
    expect(BINOCULAR_ENTRIES.length).toBeGreaterThanOrEqual(200);
    expect(new Set(BINOCULAR_ENTRIES.map((e) => e.targetId)).size).toBe(BINOCULAR_ENTRIES.length);
    expect(collection).toHaveLength(BINOCULAR_ENTRIES.length);
    for (const pick of collection) {
      expect(pick.references.length).toBeGreaterThan(0);
      expect(pick.references.every((ref) => new URL(ref.url).protocol === "https:")).toBe(true);
      expect(Number.isFinite(pick.target.ra) && Number.isFinite(pick.target.dec)).toBe(true);
      expect(pick.bestMonths.length).toBeGreaterThan(0);
    }
  });
  it("bundles two credited, decoded survey cutouts at the actual coordinates of every guide target", () => {
    for (const pick of north(10)) {
      const media = binocularMedia(pick.targetId)!;
      expect(media).toBeDefined();
      expect(media.ra).toBeCloseTo(pick.target.ra, 5);
      expect(media.dec).toBeCloseTo(pick.target.dec, 5);
      expect(media.fov).toBeGreaterThan(0);
      expect(media.images.map((image) => image.variant)).toEqual(["optical", "infrared"]);
      for (const image of media.images) {
        const contents = readFileSync(resolve(__dirname, "../../../public", image.path));
        expect(contents.subarray(0, 3).toString("hex")).toBe("ffd8ff");
        expect(contents.length).toBeGreaterThan(1000);
        const query = new URL(image.url).searchParams;
        expect(Number(query.get("ra"))).toBeCloseTo(pick.target.ra, 5);
        expect(Number(query.get("dec"))).toBeCloseTo(pick.target.dec, 5);
        expect(query.get("hips")).toBe(image.variant === "optical" ? "CDS/P/DSS2/color" : "CDS/P/2MASS/color");
      }
      const resources = binocularDatabaseResources(pick.target, media.fov);
      expect(resources).toHaveLength(2);
      expect(resources.every((r) => !r.url.includes("undefined") && new URL(r.url).protocol === "https:")).toBe(true);
    }
  });
  it("keeps the large-binocular tier distinct from ordinary handheld equipment", () => {
    const m110 = BINOCULAR_ENTRIES.find((e) => e.targetId === "M110")!;
    expect(m110.level).toBe("large");
    expect(m110.minAperture).toBe(80);
    const fields = north(5);
    expect(fields.find((p) => p.targetId === "LMC")!.neverRises).toBe(true);
    expect(south(1).find((p) => p.targetId === "LMC")!.alt).toBeGreaterThan(15);
    expect(fields.filter((p) => (p.minAperture ?? 50) <= 50).length).toBeGreaterThan(200);
  });
  it("bundles an optical photograph at the catalog coordinates of every discovery target", () => {
    for (const target of targets) {
      const media=binocularMedia(target.id)!;
      expect(media, target.id).toBeDefined();
      expect(media.ra).toBeCloseTo(target.ra,5);
      expect(media.dec).toBeCloseTo(target.dec,5);
      const image=media.images.find(image=>image.variant==="optical")!;
      expect(image, target.id).toBeDefined();
      const query=new URL(image.url).searchParams;
      expect(query.get("hips")).toBe("CDS/P/DSS2/color");
      expect(Number(query.get("ra"))).toBeCloseTo(target.ra,5);
      expect(Number(query.get("dec"))).toBeCloseTo(target.dec,5);
      const bytes=readFileSync(resolve(__dirname,"../../../public",image.path));
      expect(bytes.subarray(0,3).toString("hex")).toBe("ffd8ff");
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });
  it("uses audited primary photos with attribution and omits damaged gallery frames",()=>{
    for(const target of targets){
      const image=primaryOpticalImage(target.id)!;
      expect(image,target.id).toBeDefined();expect(image.credit.length,target.id).toBeGreaterThan(0);expect(image.note.length,target.id).toBeGreaterThan(20);
      expect(new URL(image.url).protocol).toBe("https:");expect(new URL(image.policy).protocol).toBe("https:");
      const bytes=readFileSync(resolve(__dirname,"../../../public",image.path));expect(["ffd8ff","89504e"],target.id).toContain(bytes.subarray(0,3).toString("hex"));
    }
    expect(primaryOpticalImage("STAR-Vega")!.path).toContain("primary");expect(primaryOpticalImage("STAR-Sirius")!.credit).toBe("Mellostorm");
    expect(primaryOpticalImage("M97")!.kind).toBe("portrait");
    expect(binocularMedia("STAR-Antares")!.images.find(image=>image.variant==="infrared")!.display).toBe(false);
    expect(binocularMedia("M43")!.images.find(image=>image.variant==="optical")!.display).toBe(false);
    expect(binocularMedia("STAR-Arcturus")!.fov).toBe(3.7);
  });
  it("retains individual attribution and licenses for the resolved-star photographs", () => {
    for (const id of ["DS-Albireo", "DS-MizarAlcor", "STAR-Betelgeuse", "STAR-Sirius"]) {
      const image = binocularFeaturedImage(id)!;
      expect(image.credit.length).toBeGreaterThan(5);
      expect(image.licenseName.length).toBeGreaterThan(5);
      expect(new URL(image.licenseUrl).protocol).toBe("https:");
      expect(new URL(image.source).hostname).toBe("commons.wikimedia.org");
      expect(readFileSync(resolve(__dirname, "../../../public", image.path)).subarray(0, 3).toString("hex")).toBe("ffd8ff");
    }
  });
  it("uses 21:00 in the observing location across daylight-saving changes", () => {
    expect(binocularEvening(2026, 1, "America/Los_Angeles").toISOString()).toBe("2026-01-16T05:00:00.000Z");
    expect(binocularEvening(2026, 7, "America/Los_Angeles").toISOString()).toBe("2026-07-16T04:00:00.000Z");
    expect(formatInTimeZone(binocularEvening(2026, 7, "Australia/Sydney"), "Australia/Sydney", "yyyy-MM-dd HH:mm")).toBe("2026-07-15 21:00");
  });
  it("places Orion in January evenings in both hemispheres rather than flipping calendar months", () => {
    const january = north(1).find((p) => p.targetId === "M42")!;
    const july = north(7).find((p) => p.targetId === "M42")!;
    expect(january.alt).toBeGreaterThan(30);
    expect(january.bestMonths).toContain(1);
    expect(july.alt).toBeLessThan(0);
    expect(july.bestMonths).not.toContain(7);
    expect(south(1).find((p) => p.targetId === "M42")!.alt).toBeGreaterThan(30);
  });
  it("distinguishes a southern target that never rises from one well placed at a southern site", () => {
    expect(north(5, 55).find((p) => p.targetId === "NGC5139")!.neverRises).toBe(true);
    const omega = south(5).find((p) => p.targetId === "NGC5139")!;
    expect(omega.neverRises).toBe(false);
    expect(omega.alt).toBeGreaterThan(40);
    expect(omega.bestMonths).toContain(5);
  });
  it("keeps a near-polar field available all year at a northern site", () => {
    const ring = north(1, 55).find((p) => p.targetId === "AST-EngagementRing")!;
    expect(ring.monthlyAltitudes.every((alt) => alt > 50)).toBe(true);
    expect(ring.bestMonths).toHaveLength(12);
  });
  it("includes a well-placed autumn galaxy before its exact annual altitude peak", () => {
    const andromeda = north(10).find((p) => p.targetId === "M31")!;
    expect(andromeda.alt).toBeGreaterThan(40);
    expect(andromeda.bestMonths).toContain(10);
  });
  it("provides visible seasonal choices for every month at northern and southern mid-latitudes", () => {
    for (let month = 1; month <= 12; month++) {
      for (const list of [north(month), south(month)]) {
        expect(list.filter((p) => p.bestMonths.includes(month) && p.alt >= 15).length).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("treats tight doubles and variable-star brightness as qualified observing goals", () => {
    expect(BINOCULAR_ENTRIES.find((e) => e.targetId === "DS-Albireo")!.level).toBe("challenge");
    expect(BINOCULAR_ENTRIES.find((e) => e.targetId === "STAR-Mira")!.variable).toBe(true);
    const algol = targets.find((t) => t.id === "STAR-Algol")!;
    expect(algol.categoryShort).toBe("Star");
    expect(algol.ra).toBeCloseTo(47.04, 1);
    expect(algol.dec).toBeCloseTo(40.956, 2);
  });
  it("can route to a newly added named star without losing the selected target identity", async () => {
    const result = await planRoutes({ lat: 37.77, lon: -122.42, date: binocularEvening(2026, 10, "America/Los_Angeles"), fovWidth: 7, fovHeight: 7, fovShape: "circle", limitingMag: 6.5, numRoutes: 3, targetId: "STAR-Algol", observingMode: "binocular", difficulty: "beginner" });
    expect(result.targetNode?.id).toBe("STAR-Algol");
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.every((r) => r.hops.at(-1)!.visibleGuideStars[0].id === "STAR-Algol")).toBe(true);
    expect(result.routes.every((r) => r.hops.at(-1)!.center.ra === result.targetNode!.ra)).toBe(true);
  });
});
