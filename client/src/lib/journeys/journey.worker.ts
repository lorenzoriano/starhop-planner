/**
 * Sky Journeys worker (spec decision 13). All state and message handling live in journey-host.ts (shared with
 * the in-thread fallback): the parsed KB + model, an LRU of 8 results, and the engine's per-slot night memo.
 */
import { createJourneyHost } from './journey-host';
import type { JourneyWorkerRequest, JourneyWorkerResponse } from './journey-client';

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const host = createJourneyHost({ clock: now });

self.onmessage = async (event: MessageEvent<JourneyWorkerRequest>) => {
  const msg = event.data;
  const reply = (r: JourneyWorkerResponse) => (self as unknown as Worker).postMessage(r);
  try {
    reply({ id: msg.id, value: await host.handle(msg) });
  } catch (error) {
    reply({ id: msg.id, error: error instanceof Error ? error.message : 'Could not plan journeys for this sky.' });
  }
};
