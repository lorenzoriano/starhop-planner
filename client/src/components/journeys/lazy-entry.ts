/**
 * Entry points into Sky Journeys from other screens (doc 06 §2.1), as lazy components so their code, the engine
 * and the knowledge base stay out of the main bundle. The Tonight teaser additionally waits until the browser is
 * idle, so it can never delay the Tonight page itself.
 */
import { lazy } from "react";

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
const whenIdle = () => new Promise<void>((resolve) => {
  const w = (typeof window !== "undefined" ? window : undefined) as IdleWindow | undefined;
  if (w?.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 3000 });
  else setTimeout(resolve, 1200);
});

export const TonightJourneyTeaser = lazy(() => whenIdle().then(() => import("./TonightJourneyTeaser")));
/** Journey links for any object (TargetCard, featured object, Catalog, Planner, Moon, Clock, Binoculars). */
export const ObjectJourneyLinks = lazy(() => import("./ObjectJourneyLinks"));
/** Tonight's journeys on the Planner ("Add a journey to this night") and the Moon tab. */
export const TonightJourneyList = lazy(() => import("./TonightJourneyList"));
/** "Journey · <title> · stop n" on Planner rows tagged with a journey. */
export const NightJourneyBadge = lazy(() => import("./TonightJourneyList").then((m) => ({ default: m.NightJourneyBadge })));
