/**
 * Module-level registry of terrain horizon computations, so every component asking about the same site shares one
 * worker run (pattern of weather-cache.ts `pending`). Components subscribe for changes and `retain` a site while
 * they show it; a run nobody retains any more is cancelled after a short grace period (StrictMode remounts and quick
 * re-renders do not restart it). Results go to the per-site store (store.ts) and a memory fallback for when
 * localStorage is unavailable.
 */
import { horizonSiteKey, readLocalHorizon, saveHorizonLayer } from './store';
import { computeTerrainInWorker } from './terrain-client';
import type { HorizonProfile, LocalHorizon } from './types';

export type TerrainCompute = (lat: number, lon: number, opts: { signal: AbortSignal; onProgress: (f: number) => void }) => Promise<HorizonProfile>;

interface Job {
  progress: number;
  controller: AbortController;
  promise: Promise<HorizonProfile | null>;
}
export interface TerrainFailure {
  message: string;
  at: number;
  /** Started by an explicit recompute (shown even when an older stored profile exists). */
  forced: boolean;
}

/** After an automatic failure, wait this long before retrying automatically (recompute() always retries). */
export const AUTO_RETRY_MS = 5 * 60 * 1000;
const RELEASE_GRACE_MS = 3000;

const jobs = new Map<string, Job>();
const failures = new Map<string, TerrainFailure>();
const memory = new Map<string, HorizonProfile>();
const refs = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
let storeVersion = 0;
let compute: TerrainCompute = (lat, lon, opts) => computeTerrainInWorker(lat, lon, opts);

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export function subscribeTerrainJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Changes on any job or stored result (useSyncExternalStore snapshot). */
export const terrainJobsVersion = () => version;
/** Changes only when a result was stored (re-read storage). */
export const terrainStoreVersion = () => storeVersion;

export const terrainJob = (key: string): { progress: number } | undefined => jobs.get(key);
export const terrainFailure = (key: string): TerrainFailure | undefined => failures.get(key);

/** Stored layers near the site, with the in-memory result filling in when storage failed. */
export function readSiteHorizon(lat: number, lon: number): LocalHorizon | null {
  const stored = readLocalHorizon(lat, lon);
  if (stored?.terrain) return stored;
  const mem = memory.get(horizonSiteKey(lat, lon));
  return mem ? { ...stored, terrain: mem } : stored;
}

/** True when an automatic run should start for this site now. */
export function shouldAutoCompute(key: string, now = Date.now()): boolean {
  const failed = failures.get(key);
  return !jobs.has(key) && (!failed || now - failed.at >= AUTO_RETRY_MS);
}

/** Start (or join) the run for a site. Resolves with the profile, or null when it failed or was cancelled. */
export function startTerrainJob(lat: number, lon: number, forced = false): Promise<HorizonProfile | null> {
  const key = horizonSiteKey(lat, lon);
  const existing = jobs.get(key);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const job: Job = { progress: 0, controller, promise: Promise.resolve(null) };
  job.promise = compute(lat, lon, {
    signal: controller.signal,
    onProgress: (f) => {
      job.progress = f;
      emit();
    },
  }).then(
    (profile) => {
      failures.delete(key);
      memory.set(key, profile);
      saveHorizonLayer(profile);
      storeVersion++;
      return profile;
    },
    (error: unknown) => {
      if (!controller.signal.aborted && !(error instanceof Error && error.name === 'AbortError')) {
        failures.set(key, { message: error instanceof Error ? error.message : 'Could not compute the terrain horizon.', at: Date.now(), forced });
      }
      return null;
    },
  ).finally(() => {
    if (jobs.get(key) === job) jobs.delete(key);
    emit();
  });
  failures.delete(key);
  jobs.set(key, job);
  emit();
  return job.promise;
}

/** Declare interest in a site while it is shown; the returned release cancels an unwanted run after a grace period. */
export function retainTerrainSite(key: string): () => void {
  refs.set(key, (refs.get(key) ?? 0) + 1);
  return () => {
    const n = (refs.get(key) ?? 1) - 1;
    if (n > 0) refs.set(key, n);
    else refs.delete(key);
    setTimeout(() => {
      if (!refs.has(key)) jobs.get(key)?.controller.abort();
    }, RELEASE_GRACE_MS);
  };
}

/** Tests: swap the compute function and clear all module state. */
export function resetTerrainJobs(fn?: TerrainCompute) {
  jobs.forEach((j) => j.controller.abort());
  jobs.clear();
  failures.clear();
  memory.clear();
  refs.clear();
  compute = fn ?? ((lat, lon, opts) => computeTerrainInWorker(lat, lon, opts));
  emit();
}
