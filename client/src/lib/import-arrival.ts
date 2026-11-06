/**
 * Arrival of a "Send to phone" link (`#/import?v=1&k=…&d=…`, see plan-share.ts). Tiny and dependency-free: it runs
 * in main.tsx before React mounts, so the link is caught on a cold start (installed app opened by the camera, first
 * visit, offline) before the router can redirect the unknown route.
 *
 * The link waits as the "pending import" until the user adds or cancels it. sessionStorage keeps it across the
 * installed app's update reload; the URL itself is replaced with the Planner at once, so a reload or Back never
 * imports twice.
 */
import { useEffect, useState } from "react";

/** True for `#/import?…` (with or without the leading "#"). */
export const isShareHash = (hash: string) => /^#?\/import(?:[?/]|$)/.test(hash);

export const PENDING_IMPORT_KEY = "starhop-pending-import-v1";
export const PENDING_IMPORT_EVENT = "starhop-pending-import";
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const pendingStore = (): SessionStore | null => { try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; } };
let pendingInMemory: string | null = null;

const notify = (win: Pick<Window, "dispatchEvent"> | undefined = typeof window !== "undefined" ? window : undefined) => win?.dispatchEvent(new Event(PENDING_IMPORT_EVENT));

/**
 * When the page's hash is an import link: keep it as the pending import, replace the URL with the Planner and tell
 * the app. Call before React mounts and on every hashchange (registered before the router's own listener).
 * Returns true when it captured a link.
 */
export function captureShareHash(win: Window = window): boolean {
  const hash = win.location.hash;
  if (!isShareHash(hash)) return false;
  pendingInMemory = hash;
  try { pendingStore()?.setItem(PENDING_IMPORT_KEY, hash); } catch { /* the in-memory copy still works for this page */ }
  const url = new URL(win.location.href);
  url.hash = "/planner";
  win.history.replaceState(win.history.state, "", url.href);
  notify(win);
  return true;
}
export function readPendingImport(): string | null {
  try { return pendingStore()?.getItem(PENDING_IMPORT_KEY) ?? pendingInMemory; } catch { return pendingInMemory; }
}
export function clearPendingImport(): void {
  pendingInMemory = null;
  try { pendingStore()?.removeItem(PENDING_IMPORT_KEY); } catch { /* nothing kept */ }
  notify();
}
/** Whether a link is waiting (the Planner then mounts the import preview, loaded lazily). */
export function usePendingImport(): boolean {
  const [pending, setPending] = useState(() => !!readPendingImport());
  useEffect(() => {
    const sync = () => setPending(!!readPendingImport());
    sync();
    window.addEventListener(PENDING_IMPORT_EVENT, sync);
    return () => window.removeEventListener(PENDING_IMPORT_EVENT, sync);
  }, []);
  return pending;
}
