import { planRoutes, type ObservingParams } from './astronomy';
import { planChain } from './hop-chain';
import type { ChainStop } from './object-links';
import { horizonFingerprint } from './horizon/profile';

/** Messages: a single route plan (no `type`, the original protocol), a chained plan, or an abort for a chain. */
export type RouteWorkerRequest =
  | { type?: 'plan'; params: ObservingParams; base: string }
  | { type: 'chain'; id: number; params: ObservingParams; stops: ChainStop[]; maxLegDeg?: number; base: string }
  | { type: 'abort'; id: number };

let patchedBase: string | null = null;
function patchFetch(base: string) {
  if (patchedBase !== null) { patchedBase = base; return; }
  patchedBase = base;
  const original = self.fetch.bind(self);
  self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => original(typeof input === 'string' ? new URL(input, patchedBase!) : input, init)) as typeof fetch;
}

// Per-leg memo: a chain replanned with the same sky (another stop range, a reload of the bar) reuses its legs.
const MEMO_LIMIT = 96;
const memo = new Map<string, ReturnType<typeof planRoutes>>();
function memoPlan(params: ObservingParams): ReturnType<typeof planRoutes> {
  // The skyline (ObservingParams.horizon, ~360 numbers) enters the key as its short fingerprint.
  const key = JSON.stringify({ ...params, horizon: params.horizon ? horizonFingerprint(params.horizon) : undefined });
  const hit = memo.get(key);
  if (hit) return hit;
  const value = planRoutes(params);
  memo.set(key, value);
  value.catch(() => memo.delete(key));
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  return value;
}

const chains = new Map<number, AbortController>();
self.onmessage = async (event: MessageEvent<RouteWorkerRequest>) => {
  const data = event.data;
  if (data.type === 'abort') { chains.get(data.id)?.abort(); return; }
  patchFetch(data.base);
  if (data.type === 'chain') {
    const controller = new AbortController();
    chains.set(data.id, controller);
    try {
      const value = await planChain(data.params, data.stops, { signal: controller.signal, maxLegDeg: data.maxLegDeg, planLeg: memoPlan, onLeg: leg => self.postMessage({ type: 'leg', id: data.id, leg }) });
      self.postMessage({ type: 'done', id: data.id, value });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      self.postMessage({ type: 'error', id: data.id, aborted, error: error instanceof Error ? error.message : 'Could not plan this hop sequence.' });
    } finally { chains.delete(data.id); }
    return;
  }
  try { self.postMessage({ value: await planRoutes(data.params) }); } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not calculate this route.' }); }
};
