// The build generates an asset manifest and inserts a content-based version.
const PREFIX = `starhop-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE = `${PREFIX}6fd3a1d3b0ba33c5`;
const urlFor = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(urlFor("./offline-assets.json"), {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Offline manifest unavailable");
      const manifest = await response.json();
      const cache = await caches.open(CACHE);
      try {
        // Bounded batches keep the complete photo atlas reliable on mobile connections.
        for (let i = 0; i < manifest.files.length; i += 16) {
          await cache.addAll(manifest.files.slice(i, i + 16).map(
            (path) => new Request(urlFor(path), { cache: "reload" }),
          ));
        }
        await cache.put(
          urlFor("./offline-assets.json"),
          new Response(JSON.stringify(manifest), {
            headers: { "Content-Type": "application/json" },
          }),
        );
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "OFFLINE_STATUS") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await cache.match(urlFor("./offline-assets.json"));
      const manifest = response ? await response.json() : null;
      const resources = manifest
        ? await Promise.all(
            manifest.files.map((path) => cache.match(urlFor(path))),
          )
        : [];
      event.ports[0]?.postMessage({
        build: manifest?.build,
        ready: resources.length > 0 && resources.every(Boolean),
        files: resources.length,
      });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.includes("/api/")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Navigations use the live app while connected and the complete stored build offline.
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (
            (await cache.match(urlFor("./index.html"))) ||
            new Response("Open StarHop once online to prepare it.", {
              status: 503,
            })
          );
        }
      }
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch {
        return new Response(
          "This resource has not been prepared for offline use.",
          { status: 503 },
        );
      }
    })(),
  );
});
