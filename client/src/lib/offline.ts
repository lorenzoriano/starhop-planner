import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type OfflineState = "preparing" | "ready" | "error" | "unavailable";
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
  const generation = useRef(0);
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
          setTimeout(
            () => reject(new Error("Offline preparation timed out")),
            180_000,
          ),
        ),
      ]);
      const expectedBuild = document.querySelector<HTMLMetaElement>('meta[name="starhop-build"]')?.content;
      const deadline = Date.now() + 180_000;
      while (generation.current === attempt) {
        const channel = new MessageChannel();
        const status = await new Promise<{ ready: boolean; build?: string }>((resolve) => {
          const timeout = setTimeout(() => { channel.port1.close(); resolve({ ready: false }); }, 5000);
          channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            resolve(event.data);
          };
          registration.active?.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
        });
        if (generation.current !== attempt) return;
        if (status.ready && (!expectedBuild || status.build === expectedBuild)) {
          setState("ready");
          return;
        }
        if (Date.now() >= deadline) { setState("error"); return; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      if (generation.current === attempt) setState("error");
    }
  }
  useEffect(() => {
    void prepare();
    const changed = () => {
      void prepare();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () => {
      generation.current++;
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);
  return { online, state, prepare };
}
