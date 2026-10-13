import { useEffect, useState, useSyncExternalStore } from "react";

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
  async function prepare() {
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
            30_000,
          ),
        ),
      ]);
      const channel = new MessageChannel();
      const status = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          channel.port1.close();
          resolve(false);
        }, 5000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          resolve(event.data.ready === true);
        };
        registration.active?.postMessage({ type: "OFFLINE_STATUS" }, [
          channel.port2,
        ]);
      });
      setState(status ? "ready" : "error");
    } catch {
      setState("error");
    }
  }
  useEffect(() => {
    void prepare();
    const changed = () => {
      void prepare();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () =>
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
  }, []);
  return { online, state, prepare };
}
