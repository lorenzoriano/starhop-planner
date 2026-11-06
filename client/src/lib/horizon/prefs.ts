/**
 * Global "Use my local horizon" preference (default on), stored in localStorage. When off, useLocalHorizon returns no
 * horizon, so the whole app falls back to its flat-horizon behaviour; stored profiles are kept for when it is turned
 * back on. Subscribers are notified on change in this tab and on `storage` events from other tabs.
 */

import { readLocalHorizon } from './store';
import type { LocalHorizon } from './types';

export const HORIZON_PREFS_KEY = 'starhop-local-horizon-prefs-v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const listeners = new Set<() => void>();
/** Last value read or written; also the fallback when storage is unavailable. */
let cached: boolean | null = null;

function read(storage: StorageLike | undefined): boolean {
  try {
    const raw = storage?.getItem(HORIZON_PREFS_KEY);
    if (!raw) return true;
    const data: unknown = JSON.parse(raw);
    return !(data && typeof data === 'object' && (data as { enabled?: unknown }).enabled === false);
  } catch {
    return true;
  }
}

/** True unless the user turned the local horizon off. */
export function localHorizonEnabled(storage: StorageLike | undefined = defaultStorage()): boolean {
  if (cached === null) cached = read(storage);
  return cached;
}

/** Turn the local horizon on or off for the whole app. Returns false when it could not be stored (still applies now). */
export function setLocalHorizonEnabled(enabled: boolean, storage: StorageLike | undefined = defaultStorage()): boolean {
  const before = localHorizonEnabled(storage);
  let saved = false;
  try {
    storage?.setItem(HORIZON_PREFS_KEY, JSON.stringify({ enabled }));
    saved = !!storage;
  } catch {
    saved = false;
  }
  cached = enabled;
  if (before !== enabled) listeners.forEach((l) => l());
  return saved;
}

const onStorage = (event: StorageEvent) => {
  if (event.key !== null && event.key !== HORIZON_PREFS_KEY) return;
  const next = read(defaultStorage());
  if (next !== cached) {
    cached = next;
    listeners.forEach((l) => l());
  }
};

/** useSyncExternalStore subscription for the preference. */
export function subscribeLocalHorizonPref(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Tests: forget the cached value (the next read goes to storage). */
export function resetLocalHorizonPref() {
  cached = null;
}

/** The stored horizon for a site when the preference is on, for code outside React (exports, chain sources).
 *  Never computes: components use useLocalHorizon, which also fills the store. */
export function activeStoredHorizon(lat: number, lon: number): LocalHorizon | null {
  return localHorizonEnabled() ? readLocalHorizon(lat, lon) : null;
}
