// The build generates an asset manifest and inserts a content-based version.
const PREFIX = `starhop-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE = `${PREFIX}16320cfbbe3e1d87`;
const urlFor = (path) => new URL(path, self.registration.scope).href;

// Sky catalogs and the app shell are small enough to prepare automatically.
// Survey photographs and the lunar surface atlas remain available on demand.
const isBulkAsset = (path) => {
  const normalized = path.replace(/^\.\//, "");
  return (
    /^data\/binocular-images\//i.test(normalized) ||
    /^data\/finder-stars\//i.test(normalized) ||
    /^data\/moon\/(?:features\/.*|lroc-gray-.*)\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized)
  );
};

const assetSize = (response) => {
  const value = response?.headers.get("content-length");
  const size = value ? Number(value) : NaN;
  return Number.isFinite(size) && size >= 0 ? size : undefined;
};

async function readManifest(cache) {
  const response = await cache.match(urlFor("./offline-assets.json"));
  return response ? response.json() : null;
}

async function reportStatus(cache) {
  const manifest = await readManifest(cache);
  if (!manifest || !Array.isArray(manifest.files)) {
    return { ready: false, allAssets: false, cachedFiles: 0, totalFiles: 0, cachedBytes: 0 };
  }
  const resources = await Promise.all(
    manifest.files.map(async (path) => {
      const response = await cache.match(urlFor(path));
      return { response, size: manifest.sizes?.[path]??assetSize(response), bulk: isBulkAsset(path) };
    }),
  );
  const essential = resources.filter((resource) => !resource.bulk);
  const bulk = resources.filter((resource) => resource.bulk);
  const cached = resources.filter((resource) => resource.response);
  const totalBytesFromManifest = manifest.sizes
    ? Object.values(manifest.sizes).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : undefined;
  const allBytesKnown = resources.every((resource) => resource.size !== undefined);
  const knownCachedResources = cached.filter((resource) => resource.size !== undefined);
  const cachedBulk = bulk.filter((resource) => resource.response);
  const knownCachedBulk = cachedBulk.filter((resource) => resource.size !== undefined);
  return {
    build: manifest.build,
    ready: essential.length > 0 && essential.every((resource) => resource.response),
    allAssets: bulk.length > 0 && bulk.every((resource) => resource.response),
    cachedFiles: cached.length,
    totalFiles: resources.length,
    cachedBytes: cached.length && knownCachedResources.length === cached.length
      ? knownCachedResources.reduce((sum, resource) => sum + resource.size, 0)
      : undefined,
    totalBytes: totalBytesFromManifest ?? (allBytesKnown ? resources.reduce((sum, resource) => sum + resource.size, 0) : undefined),
    bulkCachedFiles: bulk.filter((resource) => resource.response).length,
    bulkTotalFiles: bulk.length,
    bulkCachedBytes: cachedBulk.length && knownCachedBulk.length === cachedBulk.length
      ? knownCachedBulk.reduce((sum, resource) => sum + resource.size, 0)
      : undefined,
    bulkTotalBytes: bulk.length > 0 && bulk.every((resource) => resource.size !== undefined)
      ? bulk.reduce((sum, resource) => sum + resource.size, 0)
      : undefined,
  };
}

const send = (event, message) => {
  const port = event.ports?.[0];
  if (port) port.postMessage(message);
  else event.source?.postMessage(message);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(urlFor("./offline-assets.json"), { cache: "no-store" });
      if (!response.ok) throw new Error("Offline manifest unavailable");
      const manifest = await response.json();
      const cache = await caches.open(CACHE);
      const essentialFiles = manifest.files.filter((path) => !isBulkAsset(path));
      try {
        // Keep each atomic batch modest for mobile storage and connections.
        for (let i = 0; i < essentialFiles.length; i += 16) {
          await cache.addAll(
            essentialFiles.slice(i, i + 16).map(
              (path) => new Request(urlFor(path), { cache: "reload" }),
            ),
          );
        }
        await cache.put(
          urlFor("./offline-assets.json"),
          new Response(JSON.stringify(manifest), {
            headers: { "Content-Type": "application/json" },
          }),
        );
        await self.skipWaiting();
      } catch (error) {
        // Only remove this worker's incomplete cache; older app caches remain usable.
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
      // Retire only prior StarHop build caches with the expected hash format.
      // Unknown caches, even with a similar prefix, are left untouched.
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE && /^[a-f0-9]{16}$/.test(key.slice(PREFIX.length)))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "OFFLINE_STATUS") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        send(event, await reportStatus(cache));
      })(),
    );
    return;
  }
  if (event.data?.type !== "OFFLINE_DOWNLOAD_ALL") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const manifest = await readManifest(cache);
      if (!manifest || !Array.isArray(manifest.files)) {
        send(event, { type: "OFFLINE_DOWNLOAD_PROGRESS", error: "Offline asset list is unavailable." });
        return;
      }
      const bulkFiles = manifest.files.filter(isBulkAsset);
      let completedFiles = 0;
      let downloadedBytes = 0;
      const sizes = [];
      for (const path of bulkFiles) {
        const request = new Request(urlFor(path));
        let response = await cache.match(request);
        if (!response) {
          try {
            response = await fetch(new Request(urlFor(path), { cache: "reload" }));
            if (!response.ok) throw new Error(`Download failed (${response.status})`);
            await cache.put(request, response.clone());
          } catch (error) {
            send(event, {
              type: "OFFLINE_DOWNLOAD_PROGRESS",
              completedFiles,
              totalFiles: bulkFiles.length,
              downloadedBytes,
              error: error instanceof Error ? error.message : "Download failed.",
            });
            return;
          }
        }
        const size = assetSize(response);
        if (size !== undefined) {
          sizes.push(size);
          downloadedBytes += size;
        }
        completedFiles++;
        send(event, {
          type: "OFFLINE_DOWNLOAD_PROGRESS",
          completedFiles,
          totalFiles: bulkFiles.length,
          downloadedBytes,
          totalBytes: sizes.length === bulkFiles.length ? sizes.reduce((sum, value) => sum + value, 0) : undefined,
        });
      }
      send(event, {
        type: "OFFLINE_DOWNLOAD_PROGRESS",
        completedFiles,
        totalFiles: bulkFiles.length,
        downloadedBytes,
        totalBytes: sizes.length === bulkFiles.length ? sizes.reduce((sum, value) => sum + value, 0) : undefined,
        done: true,
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
  ) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (
            (await cache.match(urlFor("./index.html"))) ||
            new Response("Open StarHop once online to prepare it.", { status: 503 })
          );
        }
      }
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        // Cache same-origin resources on demand so viewed images work offline.
        if (response.ok && response.type !== "opaque") {
          try {
            await cache.put(event.request, response.clone());
          } catch {
            // A full cache must not turn a successful online image request into an error.
          }
        }
        return response;
      } catch {
        return new Response("This resource has not been prepared for offline use.", { status: 503 });
      }
    })(),
  );
});
