import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { localHorizonEnabled, setLocalHorizonEnabled, subscribeLocalHorizonPref } from '@/lib/horizon/prefs';
import { horizonSiteKey } from '@/lib/horizon/store';
import {
  readSiteHorizon, retainTerrainSite, shouldAutoCompute, startTerrainJob, subscribeTerrainJobs, terrainFailure, terrainJob,
  terrainJobsVersion, terrainStoreVersion,
} from '@/lib/horizon/terrain-jobs';
import type { LocalHorizon, TerrainStatus } from '@/lib/horizon/types';

/** Wait for coordinate entry to settle before downloading tiles. */
const DEBOUNCE_MS = 1500;

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

const preferenceSnapshot = () => localHorizonEnabled();

/** The global "Use my local horizon" preference (default on) and its setter; every component re-renders on change. */
export function useLocalHorizonPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeLocalHorizonPref, preferenceSnapshot, preferenceSnapshot);
  return [enabled, setLocalHorizonEnabled];
}

/**
 * The site's local horizon (stored layers within ~200 m) and the state of the automatic terrain computation.
 * When online, enabled and nothing is stored, the terrain horizon is computed in a Web Worker after a short debounce;
 * all components asking about the same site share one run (lib/horizon/terrain-jobs.ts). Never blocks render;
 * offline it returns what is stored, or status `offline`. When the user turned "Use my local horizon" off
 * (lib/horizon/prefs.ts) it returns no horizon and status `idle`, so callers keep their flat-horizon behaviour.
 */
export function useLocalHorizon(
  lat: number,
  lon: number,
  { enabled = true }: { enabled?: boolean } = {},
): { horizon: LocalHorizon | null; status: TerrainStatus; recompute: () => void } {
  const [preferred] = useLocalHorizonPreference();
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  // Turned off by the user: behave as if nothing were known for any site.
  const key = valid && preferred ? horizonSiteKey(lat, lon) : '';
  const online = useOnline();
  const version = useSyncExternalStore(subscribeTerrainJobs, terrainJobsVersion, terrainJobsVersion);
  const storeVersion = terrainStoreVersion();
  // lat/lon are captured through `key` (≈100 m site).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const horizon = useMemo(() => (key ? readSiteHorizon(lat, lon) : null), [key, storeVersion]);
  const hasTerrain = !!horizon?.terrain;

  useEffect(() => {
    if (!key || !enabled) return;
    return retainTerrainSite(key);
  }, [key, enabled]);

  useEffect(() => {
    if (!key || !enabled || !online || hasTerrain || !shouldAutoCompute(key)) return;
    const timer = setTimeout(() => void startTerrainJob(lat, lon), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, online, hasTerrain]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recompute = useCallback(() => { if (key) void startTerrainJob(lat, lon, true); }, [key]);

  const status = useMemo((): TerrainStatus => {
    if (!key) return { state: 'idle' };
    const job = terrainJob(key);
    if (job) return { state: 'computing', progress: job.progress };
    const failed = terrainFailure(key);
    if (failed && (!horizon?.terrain || failed.forced)) return { state: 'error', message: failed.message };
    if (horizon?.terrain) return { state: 'ready', profile: horizon.terrain };
    if (!enabled) return { state: 'idle' };
    if (!online) return { state: 'offline' };
    return { state: 'idle' };
    // `version` changes whenever a job or failure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, horizon, enabled, online]);

  return { horizon, status, recompute };
}
