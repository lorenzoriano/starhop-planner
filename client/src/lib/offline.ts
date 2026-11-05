import { createElement, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { shouldCheckForUpdate, updateAction } from "@/lib/pwa-update";

export type OfflineState = "preparing" | "ready" | "error" | "unavailable";
export interface OfflineAssetState {
  cachedFiles: number;
  totalFiles: number;
  cachedBytes?: number;
  totalBytes?: number;
  bulkCachedFiles: number;
  bulkTotalFiles: number;
  bulkCachedBytes?: number;
  bulkTotalBytes?: number;
  complete: boolean;
}
export interface OfflineDownloadProgress {
  completedFiles: number;
  totalFiles: number;
  downloadedBytes: number;
  totalBytes?: number;
  done?: boolean;
  error?: string;
}

const emptyAssets: OfflineAssetState = {
  cachedFiles: 0,
  totalFiles: 0,
  cachedBytes: undefined,
  bulkCachedFiles: 0,
  bulkTotalFiles: 0,
  bulkCachedBytes: undefined,
  complete: false,
};

const AUTO_RELOAD_KEY = "starhop-auto-reload-build";
const pageBuild = () =>
  typeof document === "undefined"
    ? undefined
    : document.querySelector<HTMLMetaElement>('meta[name="starhop-build"]')?.content;

function readSession(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Without session storage the reload guard simply falls back to prompting.
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UseOfflineOptions {
  /** True while reloading would interrupt the user (e.g. a playing hop animation). */
  busy?: boolean;
}

export function useOffline({ busy = false }: UseOfflineOptions = {}) {
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const [state, setState] = useState<OfflineState>("preparing");
  const [allAssets, setAllAssets] = useState<OfflineAssetState>(emptyAssets);
  const [downloadProgress, setDownloadProgress] = useState<OfflineDownloadProgress | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Build of a newer worker that replaced the one this page was loaded with.
  const pendingUpdate = useRef<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  function reloadNow(workerBuild: string, automatic: boolean) {
    if (automatic) writeSession(AUTO_RELOAD_KEY, workerBuild);
    window.location.reload();
  }

  // Apply the update now if nobody would notice, otherwise ask once and retry
  // when the page is next hidden.
  function applyUpdate(workerBuild: string) {
    const action = updateAction({
      hidden: document.visibilityState === "hidden",
      sinceLoadMs: performance.now(),
      busy: busyRef.current,
      alreadyAutoReloaded: readSession(AUTO_RELOAD_KEY) === workerBuild,
    });
    if (action === "reload") {
      reloadNow(workerBuild, true);
      return;
    }
    if (pendingUpdate.current === workerBuild) return;
    pendingUpdate.current = workerBuild;
    // The header's offline pill turns into a persistent "Update ready" button;
    // the toast only announces it briefly so it never hides the navigation.
    setUpdateReady(true);
    toast({
      title: "StarHop updated",
      description: "Tap reload to use the new version.",
      duration: 8000,
      action: createElement(
        ToastAction,
        { altText: "Reload to use the updated StarHop", onClick: () => reloadNow(workerBuild, false) },
        "Reload",
      ) as unknown as ToastActionElement,
    });
  }

  async function readStatus(worker: ServiceWorker): Promise<{ ready: boolean; build?: string; [key: string]: unknown }> {
    const channel = new MessageChannel();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        channel.port1.close();
        resolve({ ready: false });
      }, 5000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type: "OFFLINE_STATUS", build: pageBuild() }, [channel.port2]);
    });
  }

  function storeStatus(status: Record<string, unknown>) {
    setAllAssets({
      cachedFiles: Number(status.cachedFiles) || 0,
      totalFiles: Number(status.totalFiles) || 0,
      cachedBytes: typeof status.cachedBytes === "number" ? status.cachedBytes : undefined,
      totalBytes: typeof status.totalBytes === "number" ? status.totalBytes : undefined,
      bulkCachedFiles: Number(status.bulkCachedFiles) || 0,
      bulkTotalFiles: Number(status.bulkTotalFiles) || 0,
      bulkCachedBytes: typeof status.bulkCachedBytes === "number" ? status.bulkCachedBytes : undefined,
      bulkTotalBytes: typeof status.bulkTotalBytes === "number" ? status.bulkTotalBytes : undefined,
      complete: Boolean(status.allAssets),
    });
  }

  async function prepare() {
    const attempt = ++generation.current;
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      setState("unavailable");
      return;
    }
    setState("preparing");
    try {
      // Always fetch sw.js from the network so deploys are noticed promptly.
      await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Offline preparation timed out")), 180_000),
        ),
      ]);
      const expectedBuild = pageBuild();
      const deadline = Date.now() + 180_000;
      while (generation.current === attempt) {
        const worker = registration.active;
        const status = worker ? await readStatus(worker) : { ready: false };
        if (generation.current !== attempt) return;
        storeStatus(status);
        // The active worker serves a newer build than this page: the page keeps
        // working (its build's cache is retained) but should move over.
        if (status.ready && status.pageStale === true && typeof status.workerBuild === "string") {
          setState("ready");
          applyUpdate(status.workerBuild);
          return;
        }
        if (status.ready && (!expectedBuild || status.build === expectedBuild)) {
          setState("ready");
          return;
        }
        if (Date.now() >= deadline) {
          setState("error");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      if (generation.current === attempt) setState("error");
    }
  }

  async function downloadAll() {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      setDownloadProgress({ completedFiles: 0, totalFiles: allAssets.bulkTotalFiles, downloadedBytes: 0, error: "Offline storage is not ready yet." });
      return;
    }
    setDownloadProgress({ completedFiles: allAssets.bulkCachedFiles, totalFiles: allAssets.bulkTotalFiles, downloadedBytes: allAssets.bulkCachedBytes ?? 0 });
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<OfflineDownloadProgress & { type?: string }>) => {
      const progress = event.data;
      setDownloadProgress(progress);
      if (progress.error || progress.done) {
        channel.port1.close();
        void readStatus(navigator.serviceWorker.controller!).then(storeStatus);
      }
    };
    navigator.serviceWorker.controller.postMessage({ type: "OFFLINE_DOWNLOAD_ALL" }, [channel.port2]);
  }

  const saveData = typeof navigator !== "undefined" && Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
  );

  // Installed apps resume from the background for days without a navigation,
  // so also look for a new deploy when the app comes back or reconnects.
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let lastCheck = Date.now();
    const check = () => {
      if (!navigator.onLine || !shouldCheckForUpdate(Date.now(), lastCheck)) return;
      lastCheck = Date.now();
      void navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => {});
    };
    const visibility = () => {
      const pending = pendingUpdate.current;
      if (pending && document.visibilityState === "hidden") {
        if (updateAction({ hidden: true, sinceLoadMs: performance.now(), busy: busyRef.current, alreadyAutoReloaded: readSession(AUTO_RELOAD_KEY) === pending }) === "reload") {
          reloadNow(pending, true);
          return;
        }
      }
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", check);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", check);
    };
  }, []);

  useEffect(() => {
    void prepare();
    const changed = () => { void prepare(); };
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () => {
      generation.current++;
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);

  const reloadForUpdate = () => {
    if (pendingUpdate.current) reloadNow(pendingUpdate.current, false);
  };

  return { online, state, prepare, allAssets, downloadAll, downloadProgress, saveData, formatBytes, updateReady, reloadForUpdate };
}
