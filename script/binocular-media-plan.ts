/** Regenerate the coordinate-based image acquisition plan from the offline catalogs.
 * Run: node --import tsx script/binocular-media-plan.ts > /tmp/binocular-media-plan.json
 */
import { readFile } from "node:fs/promises";
import { BINOCULAR_ENTRIES } from "../client/src/lib/binocular-guide";
import { buildUnifiedTargets, loadMessier, loadBinocularTargets } from "../client/src/lib/astronomy";

globalThis.fetch = async (input) => new Response(await readFile(`client/public/${String(input).replace(/^\.\//, "")}`, "utf8"));
const binocular = await loadBinocularTargets();
const messier = await loadMessier();
const targets = new Map(buildUnifiedTargets(messier, binocular).map((t) => [t.id, t]));
const sizes = new Map([...binocular.map((t) => [t.id, t.size] as const), ...messier.map((t) => [t.id, t.size] as const)]);
const overrides: Record<string, number> = {
  M31: 4, M33: 2, LMC: 14, SMC: 8, M45: 3, "AST-Hyades": 7,
  Mel20: 5, Mel111: 6, NGC869: 2, NGC7000: 5, NGC3372: 4, M42: 2,
  "AST-OrionBelt": 7, "AST-DavisDog": 8, "AST-EngagementRing": 2,
  "DS-MizarAlcor": 0.7, "AST-JobsCoffin": 4,
};
const images = BINOCULAR_ENTRIES.map((e) => {
  const t = targets.get(e.targetId);
  if (!t) throw new Error(`Missing target: ${e.targetId}`);
  const size = Math.max(...(sizes.get(t.id)?.match(/[\d.]+/g)?.map(Number) ?? [20]));
  const fov = overrides[t.id] ?? (e.family === "star" ? 0.6 : e.family === "double" ? 0.3 : e.family === "asterism" ? 5 : Math.max(0.6, Math.min(7, size / 60 * 2)));
  const variants = ["optical", "infrared"].map((variant) => {
    const query = new URLSearchParams({ hips: variant === "optical" ? "CDS/P/DSS2/color" : "CDS/P/2MASS/color", ra: t.ra.toFixed(7), dec: t.dec.toFixed(7), width: "640", height: "480", fov: String(fov), projection: "TAN", coordsys: "icrs", rotation_angle: "0", format: "jpg" });
    return { variant, path: `data/binocular-images/${t.id}-${variant}.jpg`, url: `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${query}` };
  });
  return { id: t.id, ra: t.ra, dec: t.dec, fov, images: variants };
});
process.stdout.write(JSON.stringify(images, null, 2));
