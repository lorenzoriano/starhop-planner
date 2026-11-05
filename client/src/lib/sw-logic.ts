// Pure decisions used by the service worker (client/service-worker/sw.js).
// Kept free of browser globals so they can be unit tested.

export interface OfflineManifest {
  build?: string;
  files: string[];
  sizes?: Record<string, number>;
}

/** Large photographs and atlases that are cached on demand instead of at install. */
export function isBulkAsset(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  return (
    /^data\/binocular-images\//i.test(normalized) ||
    /^data\/journey-images\//i.test(normalized) ||
    /^data\/finder-stars\//i.test(normalized) ||
    /^data\/moon\/(?:features\/.*|lroc-gray-.*)\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized)
  );
}

/** Build caches are `${prefix}<16 hex chars>`; anything else is left alone. */
export function buildOfCacheKey(key: string, prefix: string): string | undefined {
  if (!key.startsWith(prefix)) return undefined;
  const build = key.slice(prefix.length);
  return /^[a-f0-9]{16}$/.test(build) ? build : undefined;
}

/**
 * Downloaded photos that can be copied from a previous build's cache into the
 * new one: bulk files still listed by the new build whose recorded size did
 * not change. Without sizes on both sides nothing is trusted.
 */
export function carryOverPaths(previous: OfflineManifest | null | undefined, next: OfflineManifest): string[] {
  if (!previous || !Array.isArray(previous.files) || !previous.sizes || !next.sizes) return [];
  const previousFiles = new Set(previous.files);
  return next.files.filter((path) => {
    if (!isBulkAsset(path) || !previousFiles.has(path)) return false;
    const before = previous.sizes![path];
    const after = next.sizes![path];
    return typeof before === "number" && typeof after === "number" && before === after;
  });
}

/** Builds this worker has activated, newest last, without duplicates. */
export function appendHistory(history: readonly string[], build: string, limit = 20): string[] {
  return [...history.filter((entry) => entry !== build), build].slice(-limit);
}

/** A page is stale when it runs a build this worker has already replaced. */
export function isPageStale(pageBuild: string | undefined, currentBuild: string, history: readonly string[]): boolean {
  return Boolean(pageBuild) && pageBuild !== currentBuild && history.includes(pageBuild!);
}

export interface CacheRetentionInput {
  keys: readonly string[];
  prefix: string;
  currentBuild: string;
  /** Activated builds, oldest first. */
  history: readonly string[];
  /** Build reported by each open window; undefined when a window has not reported yet. */
  clientBuilds: ReadonlyArray<string | undefined>;
  /** Upper bound on retained previous build caches, whatever the clients say. */
  maxRetained?: number;
  /**
   * Also treat build caches missing from `history` as previous builds. Only the
   * worker that is activating may do this: for any other worker such a cache can
   * belong to a newer build that is installing right now.
   */
  includeUnknownBuilds?: boolean;
}

/**
 * Previous build caches that can be deleted. Previous means activated before
 * `currentBuild` (see `includeUnknownBuilds`). A previous cache is kept while an
 * open page still runs that build (its lazily loaded chunks live there). While
 * any open page has not reported its build, every previous cache is kept, up to
 * `maxRetained` newest ones.
 */
export function cachesToDelete({
  keys,
  prefix,
  currentBuild,
  history,
  clientBuilds,
  maxRetained = 3,
  includeUnknownBuilds = false,
}: CacheRetentionInput): string[] {
  const currentIndex = history.indexOf(currentBuild);
  const previous = keys.filter((key) => {
    const build = buildOfCacheKey(key, prefix);
    if (build === undefined || build === currentBuild) return false;
    const index = history.indexOf(build);
    // Never delete a build newer than this worker's own.
    if (index === -1) return includeUnknownBuilds;
    return currentIndex !== -1 && index < currentIndex;
  });
  const unknownClient = clientBuilds.some((build) => !build);
  const inUse = new Set(clientBuilds.filter((build): build is string => Boolean(build)));
  const retained = unknownClient
    ? previous
    : previous.filter((key) => inUse.has(buildOfCacheKey(key, prefix)!));
  // Newest first by activation order; builds missing from history count as oldest.
  const rank = (key: string) => history.indexOf(buildOfCacheKey(key, prefix)!);
  const kept = new Set([...retained].sort((a, b) => rank(b) - rank(a)).slice(0, Math.max(0, maxRetained)));
  return previous.filter((key) => !kept.has(key));
}
