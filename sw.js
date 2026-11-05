"use strict";
(() => {
  // client/src/lib/sw-logic.ts
  function isBulkAsset(path) {
    const normalized = path.replace(/^\.\//, "");
    return /^data\/binocular-images\//i.test(normalized) || /^data\/journey-images\//i.test(normalized) || /^data\/finder-stars\//i.test(normalized) || /^data\/moon\/(?:features\/.*|lroc-gray-.*)\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized);
  }
  function buildOfCacheKey(key, prefix) {
    if (!key.startsWith(prefix)) return void 0;
    const build = key.slice(prefix.length);
    return /^[a-f0-9]{16}$/.test(build) ? build : void 0;
  }
  function carryOverPaths(previous, next) {
    if (!previous || !Array.isArray(previous.files) || !previous.sizes || !next.sizes) return [];
    const previousFiles = new Set(previous.files);
    return next.files.filter((path) => {
      if (!isBulkAsset(path) || !previousFiles.has(path)) return false;
      const before = previous.sizes[path];
      const after = next.sizes[path];
      return typeof before === "number" && typeof after === "number" && before === after;
    });
  }
  function appendHistory(history, build, limit = 20) {
    return [...history.filter((entry) => entry !== build), build].slice(-limit);
  }
  function isPageStale(pageBuild, currentBuild, history) {
    return Boolean(pageBuild) && pageBuild !== currentBuild && history.includes(pageBuild);
  }
  function cachesToDelete({
    keys,
    prefix,
    currentBuild,
    history,
    clientBuilds,
    maxRetained = 3,
    includeUnknownBuilds = false
  }) {
    const currentIndex = history.indexOf(currentBuild);
    const previous = keys.filter((key) => {
      const build = buildOfCacheKey(key, prefix);
      if (build === void 0 || build === currentBuild) return false;
      const index = history.indexOf(build);
      if (index === -1) return includeUnknownBuilds;
      return currentIndex !== -1 && index < currentIndex;
    });
    const unknownClient = clientBuilds.some((build) => !build);
    const inUse = new Set(clientBuilds.filter((build) => Boolean(build)));
    const retained = unknownClient ? previous : previous.filter((key) => inUse.has(buildOfCacheKey(key, prefix)));
    const rank = (key) => history.indexOf(buildOfCacheKey(key, prefix));
    const kept = new Set([...retained].sort((a, b) => rank(b) - rank(a)).slice(0, Math.max(0, maxRetained)));
    return previous.filter((key) => !kept.has(key));
  }

  // client/service-worker/sw.js
  var BUILD = "77d9f2e5f35bcb91";
  var PREFIX = `starhop-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
  var CACHE = `${PREFIX}${BUILD}`;
  var META_CACHE = `${PREFIX}meta`;
  var urlFor = (path) => new URL(path, self.registration.scope).href;
  var NAVIGATION_TIMEOUT_MS = 4e3;
  var assetSize = (response) => {
    const value = response?.headers.get("content-length");
    const size = value ? Number(value) : NaN;
    return Number.isFinite(size) && size >= 0 ? size : void 0;
  };
  async function readManifest(cache) {
    const response = await cache.match(urlFor("./offline-assets.json"));
    try {
      return response ? await response.json() : null;
    } catch {
      return null;
    }
  }
  var HISTORY_URL = urlFor("./__starhop-history.json");
  var CLIENTS_URL = urlFor("./__starhop-clients.json");
  async function readJson(url, fallback) {
    try {
      const response = await (await caches.open(META_CACHE)).match(url);
      return response ? await response.json() : fallback;
    } catch {
      return fallback;
    }
  }
  async function writeJson(url, value) {
    await (await caches.open(META_CACHE)).put(
      url,
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
    );
  }
  async function loadMeta() {
    const history = await readJson(HISTORY_URL, []);
    const clients = await readJson(CLIENTS_URL, {});
    return {
      history: Array.isArray(history) ? history : [],
      clients: clients && typeof clients === "object" ? clients : {}
    };
  }
  var clientsQueue = Promise.resolve();
  function updateClients(change) {
    clientsQueue = clientsQueue.then(async () => {
      const { clients } = await loadMeta();
      if (change(clients) !== false) await writeJson(CLIENTS_URL, clients);
    }).catch(() => {
    });
    return clientsQueue;
  }
  function noNewerWorker() {
    const registration = self.registration;
    if (registration.installing || registration.waiting) return false;
    return Boolean(self.serviceWorker) && registration.active === self.serviceWorker;
  }
  async function windowClients() {
    return self.clients.matchAll({ type: "window", includeUncontrolled: true });
  }
  async function prunePreviousCaches({ activating = false } = {}) {
    const open = await windowClients();
    const openIds = new Set(open.map((client) => client.id));
    await updateClients((clients) => {
      let changed = false;
      for (const id of Object.keys(clients)) {
        if (!openIds.has(id)) {
          delete clients[id];
          changed = true;
        }
      }
      return changed;
    });
    const meta = await loadMeta();
    const doomed = cachesToDelete({
      keys: await caches.keys(),
      prefix: PREFIX,
      currentBuild: BUILD,
      history: meta.history,
      clientBuilds: open.map((client) => meta.clients[client.id]),
      includeUnknownBuilds: activating || noNewerWorker()
    });
    await Promise.all(doomed.map((key) => caches.delete(key)));
  }
  async function previousBuildCaches() {
    const keys = await caches.keys();
    const meta = await loadMeta();
    const rank = (key) => meta.history.indexOf(buildOfCacheKey(key, PREFIX));
    const current = meta.history.indexOf(BUILD);
    return keys.filter((key) => key !== CACHE && buildOfCacheKey(key, PREFIX) !== void 0).filter((key) => current === -1 || rank(key) < current).sort((a, b) => rank(b) - rank(a));
  }
  async function carryOverDownloads(cache, manifest) {
    for (const key of await previousBuildCaches()) {
      try {
        const previous = await caches.open(key);
        const paths = carryOverPaths(await readManifest(previous), manifest);
        for (const path of paths) {
          const url = urlFor(path);
          if (await cache.match(url)) continue;
          const response = await previous.match(url);
          if (response) await cache.put(url, response);
        }
      } catch {
      }
    }
  }
  async function slimPreviousCaches() {
    const current = await caches.open(CACHE);
    const held = new Set((await current.keys()).map((request) => request.url));
    for (const key of await previousBuildCaches()) {
      try {
        const previous = await caches.open(key);
        const duplicates = (await previous.keys()).filter((request) => held.has(request.url));
        for (let i = 0; i < duplicates.length; i += 64) {
          await Promise.all(duplicates.slice(i, i + 64).map((request) => previous.delete(request)));
        }
      } catch {
      }
    }
  }
  async function matchAnyBuild(request) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    for (const key of await previousBuildCaches()) {
      const older = await (await caches.open(key)).match(request);
      if (older) return older;
    }
    return void 0;
  }
  async function reportStatus(cache) {
    const manifest = await readManifest(cache);
    if (!manifest || !Array.isArray(manifest.files)) {
      return { ready: false, allAssets: false, cachedFiles: 0, totalFiles: 0, cachedBytes: 0 };
    }
    const resources = await Promise.all(
      manifest.files.map(async (path) => {
        const response = await cache.match(urlFor(path));
        return { response, size: manifest.sizes?.[path] ?? assetSize(response), bulk: isBulkAsset(path) };
      })
    );
    const essential = resources.filter((resource) => !resource.bulk);
    const bulk = resources.filter((resource) => resource.bulk);
    const cached = resources.filter((resource) => resource.response);
    const totalBytesFromManifest = manifest.sizes ? Object.values(manifest.sizes).reduce((sum, value) => sum + (Number(value) || 0), 0) : void 0;
    const allBytesKnown = resources.every((resource) => resource.size !== void 0);
    const knownCachedResources = cached.filter((resource) => resource.size !== void 0);
    const cachedBulk = bulk.filter((resource) => resource.response);
    const knownCachedBulk = cachedBulk.filter((resource) => resource.size !== void 0);
    return {
      build: manifest.build,
      ready: essential.length > 0 && essential.every((resource) => resource.response),
      allAssets: bulk.length > 0 && bulk.every((resource) => resource.response),
      cachedFiles: cached.length,
      totalFiles: resources.length,
      cachedBytes: cached.length && knownCachedResources.length === cached.length ? knownCachedResources.reduce((sum, resource) => sum + resource.size, 0) : void 0,
      totalBytes: totalBytesFromManifest ?? (allBytesKnown ? resources.reduce((sum, resource) => sum + resource.size, 0) : void 0),
      bulkCachedFiles: bulk.filter((resource) => resource.response).length,
      bulkTotalFiles: bulk.length,
      bulkCachedBytes: cachedBulk.length && knownCachedBulk.length === cachedBulk.length ? knownCachedBulk.reduce((sum, resource) => sum + resource.size, 0) : void 0,
      bulkTotalBytes: bulk.length > 0 && bulk.every((resource) => resource.size !== void 0) ? bulk.reduce((sum, resource) => sum + resource.size, 0) : void 0
    };
  }
  var send = (event, message) => {
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
        if (manifest.build !== BUILD) throw new Error("Offline manifest belongs to another build");
        const cache = await caches.open(CACHE);
        const essentialFiles = manifest.files.filter((path) => !isBulkAsset(path));
        try {
          for (let i = 0; i < essentialFiles.length; i += 16) {
            await cache.addAll(
              essentialFiles.slice(i, i + 16).map(
                (path) => new Request(urlFor(path), { cache: "reload" })
              )
            );
          }
          await carryOverDownloads(cache, manifest);
          await cache.put(
            urlFor("./offline-assets.json"),
            new Response(JSON.stringify(manifest), {
              headers: { "Content-Type": "application/json" }
            })
          );
          await self.skipWaiting();
        } catch (error) {
          await caches.delete(CACHE);
          throw error;
        }
      })()
    );
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        await writeJson(HISTORY_URL, appendHistory((await loadMeta()).history, BUILD));
        await self.clients.claim();
        await slimPreviousCaches();
        await prunePreviousCaches({ activating: true });
      })()
    );
  });
  self.addEventListener("message", (event) => {
    if (event.data?.type === "OFFLINE_STATUS") {
      event.waitUntil(
        (async () => {
          const pageBuild = typeof event.data.build === "string" ? event.data.build : void 0;
          const clientId = event.source?.id;
          if (pageBuild && clientId) {
            await updateClients((clients) => {
              if (clients[clientId] === pageBuild) return false;
              clients[clientId] = pageBuild;
            });
          }
          const cache = await caches.open(CACHE);
          const meta = await loadMeta();
          send(event, {
            ...await reportStatus(cache),
            workerBuild: BUILD,
            pageStale: isPageStale(pageBuild, BUILD, meta.history)
          });
          if (pageBuild && clientId) await prunePreviousCaches();
        })()
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
                error: error instanceof Error ? error.message : "Download failed."
              });
              return;
            }
          }
          const size = assetSize(response);
          if (size !== void 0) {
            sizes.push(size);
            downloadedBytes += size;
          }
          completedFiles++;
          send(event, {
            type: "OFFLINE_DOWNLOAD_PROGRESS",
            completedFiles,
            totalFiles: bulkFiles.length,
            downloadedBytes,
            totalBytes: sizes.length === bulkFiles.length ? sizes.reduce((sum, value) => sum + value, 0) : void 0
          });
        }
        send(event, {
          type: "OFFLINE_DOWNLOAD_PROGRESS",
          completedFiles,
          totalFiles: bulkFiles.length,
          downloadedBytes,
          totalBytes: sizes.length === bulkFiles.length ? sizes.reduce((sum, value) => sum + value, 0) : void 0,
          done: true
        });
      })()
    );
  });
  async function navigationResponse(request) {
    const cache = await caches.open(CACHE);
    const network = (async () => {
      const response = await fetch(request.url, { cache: "no-cache", credentials: "same-origin" });
      return response.redirected ? fetch(request) : response;
    })();
    const shell = await cache.match(urlFor("./index.html"));
    if (!shell) {
      try {
        return await network;
      } catch {
        return new Response("Open StarHop once online to prepare it.", { status: 503 });
      }
    }
    network.catch(() => {
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
    try {
      const response = await Promise.race([network, timeout]);
      return response && response.ok ? response : shell;
    } catch {
      return shell;
    }
  }
  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
    if (event.request.mode === "navigate") {
      event.respondWith(navigationResponse(event.request));
      event.waitUntil(prunePreviousCaches().catch(() => {
      }));
      return;
    }
    event.respondWith(
      (async () => {
        const cached = await matchAnyBuild(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok && response.type !== "opaque") {
            try {
              await (await caches.open(CACHE)).put(event.request, response.clone());
            } catch {
            }
          }
          return response;
        } catch {
          return new Response("This resource has not been prepared for offline use.", { status: 503 });
        }
      })()
    );
  });
})();
