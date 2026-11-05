// Source of the StarHop service worker. script/build.ts bundles this file with
// esbuild into dist/public/sw.js and replaces __STARHOP_BUILD__ with the
// content hash of the build.
import {
  appendHistory,
  buildOfCacheKey,
  cachesToDelete,
  carryOverPaths,
  isBulkAsset,
  isPageStale,
} from "../src/lib/sw-logic.ts";

/* global __STARHOP_BUILD__ */
const BUILD = __STARHOP_BUILD__;
const PREFIX = `starhop-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE = `${PREFIX}${BUILD}`;
// Small bookkeeping cache (not a build cache: its suffix is not a build hash).
const META_CACHE = `${PREFIX}meta`;
const urlFor = (path) => new URL(path, self.registration.scope).href;
// On a slow mobile connection, serve the cached app shell instead of waiting.
const NAVIGATION_TIMEOUT_MS = 4000;

const assetSize = (response) => {
  const value = response?.headers.get("content-length");
  const size = value ? Number(value) : NaN;
  return Number.isFinite(size) && size >= 0 ? size : undefined;
};

async function readManifest(cache) {
  const response = await cache.match(urlFor("./offline-assets.json"));
  try {
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

// --- Bookkeeping, kept in two entries so concurrent workers cannot clobber each
// other: the activated builds (oldest first; written only while activating) and
// the build each open page runs (written by whichever worker the page talks to).
const HISTORY_URL = urlFor("./__starhop-history.json");
const CLIENTS_URL = urlFor("./__starhop-clients.json");
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
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }),
  );
}
async function loadMeta() {
  const history = await readJson(HISTORY_URL, []);
  const clients = await readJson(CLIENTS_URL, {});
  return {
    history: Array.isArray(history) ? history : [],
    clients: clients && typeof clients === "object" ? clients : {},
  };
}
// Serialize this worker's read-modify-write of the client map; `change` returns
// false when nothing changed.
let clientsQueue = Promise.resolve();
function updateClients(change) {
  clientsQueue = clientsQueue.then(async () => {
    const { clients } = await loadMeta();
    if (change(clients) !== false) await writeJson(CLIENTS_URL, clients);
  }).catch(() => {});
  return clientsQueue;
}

// True when this worker is the active one and nothing newer is installing, so a
// build cache missing from the history can only be an older one.
function noNewerWorker() {
  const registration = self.registration;
  if (registration.installing || registration.waiting) return false;
  return Boolean(self.serviceWorker) && registration.active === self.serviceWorker;
}

async function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

// Delete previous build caches no open page still needs. A page running an
// older build lazily loads hashed chunks (tabs, workers) that only exist there.
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
    includeUnknownBuilds: activating || noNewerWorker(),
  });
  await Promise.all(doomed.map((key) => caches.delete(key)));
}

async function previousBuildCaches() {
  const keys = await caches.keys();
  const meta = await loadMeta();
  const rank = (key) => meta.history.indexOf(buildOfCacheKey(key, PREFIX));
  const current = meta.history.indexOf(BUILD);
  // Builds activated before this one (or unknown, i.e. older than the history),
  // newest first. A newer build's cache may be mid-install: leave it alone.
  return keys
    .filter((key) => key !== CACHE && buildOfCacheKey(key, PREFIX) !== undefined)
    .filter((key) => current === -1 || rank(key) < current)
    .sort((a, b) => rank(b) - rank(a));
}

// Keep downloaded photos across updates: copy unchanged bulk files from older
// build caches into this build's cache.
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
      // Copying is an optimisation; a failure only means re-downloading later.
    }
  }
}

// Previous caches stay only for pages still running that build; drop the
// entries the current cache already holds so photos are not stored twice.
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
      // Best effort.
    }
  }
}

// Current build first, then caches retained for pages on an older build.
async function matchAnyBuild(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  for (const key of await previousBuildCaches()) {
    const older = await (await caches.open(key)).match(request);
    if (older) return older;
  }
  return undefined;
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
      // A deploy in progress can pair this worker with another build's files;
      // fail now and install cleanly on the next update check.
      if (manifest.build !== BUILD) throw new Error("Offline manifest belongs to another build");
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
        await carryOverDownloads(cache, manifest);
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
      await writeJson(HISTORY_URL, appendHistory((await loadMeta()).history, BUILD));
      await self.clients.claim();
      // Pages still on an older build keep its cache (minus what this build
      // already holds) until they reload; see prunePreviousCaches.
      await slimPreviousCaches();
      await prunePreviousCaches({ activating: true });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "OFFLINE_STATUS") {
    event.waitUntil(
      (async () => {
        // Pages report the build they run; it decides which old caches to keep.
        const pageBuild = typeof event.data.build === "string" ? event.data.build : undefined;
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
          ...(await reportStatus(cache)),
          workerBuild: BUILD,
          pageStale: isPageStale(pageBuild, BUILD, meta.history),
        });
        if (pageBuild && clientId) await prunePreviousCaches();
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

async function navigationResponse(request) {
  const cache = await caches.open(CACHE);
  const network = (async () => {
    // Revalidate the HTML so an HTTP-cached page cannot pin an older build.
    const response = await fetch(request.url, { cache: "no-cache", credentials: "same-origin" });
    // A redirected response cannot answer a navigation; let the browser follow it.
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
  network.catch(() => {});
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
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.includes("/api/")
  ) return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event.request));
    event.waitUntil(prunePreviousCaches().catch(() => {}));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await matchAnyBuild(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        // Cache same-origin resources on demand so viewed images work offline.
        if (response.ok && response.type !== "opaque") {
          try {
            await (await caches.open(CACHE)).put(event.request, response.clone());
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
