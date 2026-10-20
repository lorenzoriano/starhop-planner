import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useOffline() {
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
      worker.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
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
      await navigator.serviceWorker.register("./sw.js");
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Offline preparation timed out")), 180_000),
        ),
      ]);
      const expectedBuild = document.querySelector<HTMLMetaElement>('meta[name="starhop-build"]')?.content;
      const deadline = Date.now() + 180_000;
      while (generation.current === attempt) {
        const worker = registration.active;
        const status = worker ? await readStatus(worker) : { ready: false };
        if (generation.current !== attempt) return;
        storeStatus(status);
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

  useEffect(() => {
    void prepare();
    const changed = () => { void prepare(); };
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () => {
      generation.current++;
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);

  return { online, state, prepare, allAssets, downloadAll, downloadProgress, saveData, formatBytes };
}
