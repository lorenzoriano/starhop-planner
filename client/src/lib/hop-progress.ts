import { z } from "zod";
import type { Route } from "./astronomy";

const STORAGE_KEY = "starhop-hop-progress-v1";
const LIVE_MAX_AGE = 8 * 60 * 60 * 1000;
export const hopProgressSchema = z.object({
  configKey: z.string().max(4000),
  algorithm: z.enum(["auto", "landmark-discount", "confidence-decay", "focal-search", "landmark-magnet"]),
  fingerprint: z.string().max(9000),
  step: z.number().int().min(0).max(511),
  savedAt: z.number().finite(),
  live: z.boolean(),
});
export type HopProgress = z.infer<typeof hopProgressSchema>;

// Scores, ranks and horizontal coordinates change as the sky moves. Resume only
// the same physical path, including the final position of a moving target.
export function routeFingerprint(route: Route) {
  return JSON.stringify([route.startAnchor.id, route.target.id, route.strategyId ?? (route.isExpertRoute ? "field-guide" : "computed"),
    route.hops.map(hop => [Number(hop.center.ra.toFixed(6)), Number(hop.center.dec.toFixed(6))])]);
}
export function parseHopProgress(raw: string | null, now = Date.now()): HopProgress | null {
  if (!raw || raw.length > 16000) return null;
  try {
    const parsed = hopProgressSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.savedAt > now + 60_000 || (parsed.data.live && now - parsed.data.savedAt > LIVE_MAX_AGE)) return null;
    return parsed.data;
  } catch { return null; }
}
export function readHopProgress() {
  try { return parseHopProgress(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}
export function writeHopProgress(progress: HopProgress) {
  try {
    const raw = JSON.stringify(progress);
    if (!parseHopProgress(raw)) return false;
    localStorage.setItem(STORAGE_KEY, raw);
    return true;
  } catch { return false; }
}
export function matchingRouteIndex(routes: Route[], progress: HopProgress) {
  return routes.findIndex(route => routeFingerprint(route) === progress.fingerprint && progress.step < route.hops.length);
}
