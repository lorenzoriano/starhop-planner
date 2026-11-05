/**
 * JourneyEngineClient: in-thread fallback, worker protocol, supersede semantics, data loading.
 */
import { describe, expect, it, vi } from 'vitest';
import { generate } from '../assemble';
import { createJourneyClient, loadJourneyData, type JourneyWorkerRequest, type JourneyWorkerResponse } from '../journey-client';
import { FIXTURE_CONCEPTS, FIXTURE_CONTEXTS, FIXTURE_EDGES, FIXTURE_KB, FIXTURE_NARRATION, FIXTURE_OBJECTS, FIXTURE_SOURCES, FIXTURE_TEMPLATES } from '../__fixtures__/fixture-kb';
import { request, stripMs } from './engine-helpers';

const REQ = request('2027-01-09T05:00:00Z');

/** Fake Worker that runs the real engine asynchronously (same protocol as journey.worker.ts). */
function fakeWorkerFactory() {
  const made: { terminated: boolean }[] = [];
  const create = () => {
    const w = {
      terminated: false,
      onmessage: null as ((e: MessageEvent<JourneyWorkerResponse>) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      postMessage(msg: JourneyWorkerRequest) {
        setTimeout(() => {
          if (w.terminated) return;
          w.onmessage?.({ data: { id: msg.id, value: generate(FIXTURE_KB, msg.req) } } as MessageEvent<JourneyWorkerResponse>);
        }, 5);
      },
      terminate() { w.terminated = true; },
    };
    made.push(w);
    return w as unknown as Worker;
  };
  return { create, made };
}

describe('journey client', () => {
  it('in-thread fallback returns the engine result', async () => {
    const client = createJourneyClient({ inThread: true, loadData: async () => ({ kb: FIXTURE_KB, model: null }) });
    const res = await client.generate(REQ);
    expect(stripMs(res)).toEqual(stripMs(generate(FIXTURE_KB, REQ)));
    client.dispose();
  });

  it('worker protocol: resolves, reuses the idle worker, supersedes a running request', async () => {
    const { create, made } = fakeWorkerFactory();
    const client = createJourneyClient({ createWorker: create, base: 'http://localhost/' });
    const a = await client.generate(REQ);
    expect(a.journeys.length).toBeGreaterThan(0);
    await client.generate(REQ);
    expect(made).toHaveLength(1); // idle worker reused (keeps its parsed KB)
    const first = client.generate(REQ);
    const second = client.generate(request('2027-01-09T05:00:00Z', { shuffle: 1 }));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ seedKey: a.seedKey });
    expect(made).toHaveLength(2);
    expect(made[0].terminated).toBe(true); // the busy worker was stopped and replaced
    expect(made[1].terminated).toBe(false);
    client.dispose();
    expect(made[1].terminated).toBe(true);
  });

  it('loads and validates the runtime KB files; model.json is optional', async () => {
    const files: Record<string, unknown> = {
      'kb.json': { version: FIXTURE_KB.version, objects: FIXTURE_OBJECTS, contexts: FIXTURE_CONTEXTS, sources: FIXTURE_SOURCES },
      'concepts.json': { version: 'c', concepts: FIXTURE_CONCEPTS },
      'edges.json': { version: 'e', edges: FIXTURE_EDGES },
      'templates.json': { version: 't', templates: FIXTURE_TEMPLATES },
      'narration.json': FIXTURE_NARRATION,
    };
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const name = String(url).split('/').pop()!;
      expect(String(url)).toContain('/app/data/journeys/');
      return name in files ? new Response(JSON.stringify(files[name])) : new Response('missing', { status: 404 });
    });
    const data = await loadJourneyData('https://example.org/app/', fetchFn as unknown as typeof fetch);
    expect(data.model).toBeNull();
    expect(data.kb.objects).toHaveLength(FIXTURE_OBJECTS.length);
    expect(stripMs(generate(data.kb, REQ)).journeys.map((j) => j.key)).toEqual(generate(FIXTURE_KB, REQ).journeys.map((j) => j.key));
  });
});
