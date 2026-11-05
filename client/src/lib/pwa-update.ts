// Pure decisions for applying app updates in the installed PWA.

/** Minimum gap between update checks triggered by resume or reconnect. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** A page this young has not been used yet: reloading it is invisible to the user. */
export const JUST_LAUNCHED_MS = 10_000;

export function shouldCheckForUpdate(now: number, lastCheck: number, interval = UPDATE_CHECK_INTERVAL_MS): boolean {
  return now - lastCheck >= interval;
}

export interface UpdateContext {
  /** The page is not visible (backgrounded app or tab). */
  hidden: boolean;
  /** Time since this page loaded. */
  sinceLoadMs: number;
  /** Something the user is watching would be interrupted (a playing hop animation). */
  busy: boolean;
  /** An automatic reload for this update already happened in this tab and did not take. */
  alreadyAutoReloaded: boolean;
}

/**
 * How to move a page running an older build onto the newly activated one:
 * reload silently when nobody can notice, otherwise ask.
 */
export function updateAction({ hidden, sinceLoadMs, busy, alreadyAutoReloaded }: UpdateContext): "reload" | "prompt" {
  if (busy || alreadyAutoReloaded) return "prompt";
  return hidden || sinceLoadMs < JUST_LAUNCHED_MS ? "reload" : "prompt";
}
