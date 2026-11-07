/**
 * Downloads for the sky model (the ONNX weights and ONNX Runtime's wasm): streamed so the caller sees byte progress,
 * and kept with the Cache API so later sweeps work offline. Every cache step is best-effort: without a usable cache
 * (private browsing, insecure context, quota) the files are simply downloaded again next session.
 */

/** Cache API bucket for model files. Bump the version to drop everything cached by older builds. */
export const MODEL_CACHE_NAME = 'starhop-models-v1';

/** Byte progress of one download; `total` is 0 when the size is unknown (no Content-Length). */
export type ByteProgress = (loaded: number, total: number) => void;

export interface FetchDeps {
  fetch: (url: string) => Promise<Response>;
  /** null: no Cache API. */
  caches: Pick<CacheStorage, 'open'> | null;
}

const defaultDeps = (): FetchDeps => ({
  fetch: (url) => fetch(url),
  caches: typeof caches === 'undefined' ? null : caches,
});

async function openCache(storage: FetchDeps['caches']): Promise<Cache | null> {
  try {
    return storage ? await storage.open(MODEL_CACHE_NAME) : null;
  } catch {
    // SecurityError in some private modes and opaque origins.
    return null;
  }
}

async function readBody(response: Response, onBytes?: ByteProgress): Promise<Uint8Array> {
  const header = Number(response.headers.get('Content-Length'));
  const total = Number.isFinite(header) && header > 0 ? header : 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes?.(bytes.byteLength, bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    // A compressed transfer can deliver more than Content-Length says.
    onBytes?.(loaded, total && Math.max(total, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onBytes?.(loaded, loaded);
  return bytes;
}

/** The file at `url`, from the model cache when there, else downloaded (with progress) and cached for next time. */
export async function fetchCached(url: string, onBytes?: ByteProgress, deps: FetchDeps = defaultDeps()): Promise<Uint8Array> {
  const cache = await openCache(deps.caches);
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        onBytes?.(bytes.byteLength, bytes.byteLength);
        return bytes;
      }
    } catch {
      // Unreadable entry: download it again.
    }
  }
  const response = await deps.fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url.split('/').pop()}`);
  const bytes = await readBody(response, onBytes);
  if (cache) {
    const type = response.headers.get('Content-Type') ?? 'application/octet-stream';
    // Not awaited: a full disk or quota error must not fail the frame.
    cache.put(url, new Response(bytes, { headers: { 'Content-Type': type } })).catch(() => {});
  }
  return bytes;
}

/**
 * One fraction (0…1) over several downloads running together. Each file starts with a size hint so the fraction does
 * not jump when a later file's size becomes known; a real Content-Length replaces the hint. Never goes backwards, and
 * reports in steps of at least 0.5%.
 */
export function combinedProgress(sizeHints: number[], report: (fraction: number) => void): ByteProgress[] {
  const loaded = sizeHints.map(() => 0), totals = [...sizeHints];
  let last = 0;
  return sizeHints.map((_, i) => (bytes: number, total: number) => {
    loaded[i] = bytes;
    totals[i] = Math.max(total || totals[i], bytes);
    const sumTotal = totals.reduce((a, b) => a + b, 0);
    const fraction = sumTotal > 0 ? Math.min(1, loaded.reduce((a, b) => a + b, 0) / sumTotal) : 0;
    // Steps of at least 0.5% (a download delivers thousands of small chunks), and always the end.
    if (fraction - last >= 0.005 || (fraction === 1 && last < 1)) {
      last = fraction;
      report(fraction);
    }
  });
}
