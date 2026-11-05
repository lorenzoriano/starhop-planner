/**
 * Sky Journeys: JourneyEngineClient backed by a dedicated Web Worker (spec decision 13; pattern of
 * clock-season.worker.ts, not route-client.ts).
 *
 * - One long-lived worker keeps the parsed knowledge base and a small result cache between requests.
 * - A new request while another is running supersedes it: the old promise rejects with an AbortError and the
 *   busy worker is terminated (the engine is synchronous, so it cannot be interrupted any other way).
 * - Without Worker support (tests, very old browsers) the same engine runs in-thread (same host code).
 * - Besides `generate`, the client serves the parsed KB for display (`loadKb`, no second fetch/validation on the
 *   main thread).
 * KB files are fetched lazily from data/journeys/ (never bundled) and are cached offline by the service worker.
 */
import { KB_FILES, LENSES_FILE, knowledgeBaseFromFiles, parseScorerModel } from './kb-schema';
import type { JourneyEngineClient, JourneyRequest, JourneyResult, KnowledgeBase, ScorerModel } from './types';

export const JOURNEY_DATA_DIR = 'data/journeys/';
export const JOURNEY_DATA_FILES = KB_FILES;
/** Optional runtime files: theme lenses (owner feedback r2). A KB built before lenses existed has none. */
export const JOURNEY_OPTIONAL_FILES = [LENSES_FILE] as const;

export interface LoadedJourneyData {
  kb: KnowledgeBase;
  model: ScorerModel | null;
}

/** Fetch + validate the runtime KB files (and model.json when present). */
export async function loadJourneyData(base: string, fetchFn: typeof fetch = fetch): Promise<LoadedJourneyData> {
  const url = (name: string) => new URL(`${JOURNEY_DATA_DIR}${name}`, base).toString();
  const getJson = async (name: string) => {
    const res = await fetchFn(url(name));
    if (!res.ok) throw new Error(`Could not load ${name} (${res.status}). Open the app online once so journeys work offline.`);
    return res.json();
  };
  const getOptional = async (name: string): Promise<unknown> => {
    try {
      const res = await fetchFn(url(name));
      return res.ok ? await res.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const [[kb, concepts, edges, templates, narration], lenses] = await Promise.all([Promise.all(JOURNEY_DATA_FILES.map(getJson)), getOptional(LENSES_FILE)]);
  let model: ScorerModel | null = null;
  try {
    const res = await fetchFn(url('model.json'));
    if (res.ok) model = parseScorerModel(await res.json());
  } catch {
    model = null; // the heuristic scorer is the documented fallback (doc 05 §7.5)
  }
  return { kb: knowledgeBaseFromFiles({ kb, concepts, edges, templates, narration, lenses }), model };
}

/** Worker protocol (see journey-host.ts for the message types and what the worker caches). */
export type JourneyWorkerRequest = import('./journey-host').JourneyHostRequest;
export type JourneyWorkerResponse = { id: number; value: import('./journey-host').JourneyHostValue } | { id: number; error: string };

export interface JourneyClientOptions {
  /** Document base for data URLs (default document.baseURI). */
  base?: string;
  /** Worker factory (tests inject a fake). Default: the bundled journey.worker.ts. */
  createWorker?: () => Worker;
  /** In-thread data loader used when no Worker is available. */
  loadData?: () => Promise<LoadedJourneyData>;
  /** Force the in-thread engine. */
  inThread?: boolean;
}

export interface JourneyClient extends JourneyEngineClient {
  /**
   * The parsed, validated KB for display (cards, names, coordinates), straight from the engine's copy, so the
   * UI never downloads or validates the KB twice. Cached; a failed load is retried on the next call.
   */
  loadKb(): Promise<KnowledgeBase>;
  /** Terminate the worker (e.g. when leaving the Journeys section). */
  dispose(): void;
}

const abortError = () => (typeof DOMException !== 'undefined' ? new DOMException('Superseded journey request', 'AbortError') : Object.assign(new Error('Superseded journey request'), { name: 'AbortError' }));

type Pending = { msg: JourneyWorkerRequest; resolve: (v: unknown) => void; reject: (e: Error) => void };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export function createJourneyClient(opts: JourneyClientOptions = {}): JourneyClient {
  const base = () => opts.base ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  const canWork = !opts.inThread && (!!opts.createWorker || typeof Worker !== 'undefined');
  let kbPromise: Promise<KnowledgeBase> | null = null;
  const cachedKb = (fetchKb: () => Promise<KnowledgeBase>) => (kbPromise ??= fetchKb().catch((error) => { kbPromise = null; throw error; }));

  if (!canWork) {
    let host: Promise<import('./journey-host').JourneyHost> | null = null;
    let seq = 0;
    const getHost = () => (host ??= import('./journey-host').then((m) => m.createJourneyHost(opts.loadData ? { loadData: () => opts.loadData!() } : {})));
    return {
      async generate(req) {
        const my = ++seq;
        const h = await getHost();
        if (my !== seq) throw abortError();
        const value = await h.handle({ id: my, req, base: base() });
        if (my !== seq) throw abortError();
        return value as JourneyResult;
      },
      loadKb: () => cachedKb(async () => (await getHost()).handle({ id: 0, type: 'kb', base: base() }) as Promise<KnowledgeBase>),
      dispose() { host = null; kbPromise = null; },
    };
  }

  const make = opts.createWorker ?? (() => new Worker(new URL('./journey.worker.ts', import.meta.url), { type: 'module' }));
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  /** Id of the running generate request (only one at a time; a new one supersedes it). */
  let generating: number | null = null;

  const start = () => {
    const w = make();
    w.onmessage = (event: MessageEvent<JourneyWorkerResponse>) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      if (generating === event.data.id) generating = null;
      if ('error' in event.data) p.reject(new Error(event.data.error));
      else p.resolve(event.data.value);
    };
    w.onerror = (event) => {
      event.preventDefault?.();
      const all = Array.from(pending.values());
      pending.clear();
      generating = null;
      worker?.terminate();
      worker = null;
      for (const p of all) p.reject(new Error('The journey planner could not start. Reload the app and try again.'));
    };
    return w;
  };

  const send = <T>(msg: WithoutId<JourneyWorkerRequest>, isGenerate = false): Promise<T> => {
    if (isGenerate && generating !== null) {
      // Supersede: the engine is synchronous inside the worker, so stop it and start fresh. Other requests that
      // were queued behind it (KB) are re-sent to the new worker.
      const old = pending.get(generating);
      pending.delete(generating);
      generating = null;
      old?.reject(abortError());
      worker?.terminate();
      worker = null;
      const again = Array.from(pending.values());
      worker = start();
      for (const p of again) worker.postMessage(p.msg);
    }
    worker ??= start();
    const id = ++nextId;
    const full = { ...msg, id } as JourneyWorkerRequest;
    if (isGenerate) generating = id;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { msg: full, resolve: resolve as (v: unknown) => void, reject });
      worker!.postMessage(full);
    });
  };

  return {
    generate: (req) => send<JourneyResult>({ type: 'generate', req, base: base() }, true),
    loadKb: () => cachedKb(() => send<KnowledgeBase>({ type: 'kb', base: base() })),
    dispose() {
      const all = Array.from(pending.values());
      pending.clear();
      generating = null;
      kbPromise = null;
      worker?.terminate();
      worker = null;
      for (const p of all) p.reject(abortError());
    },
  };
}

let shared: JourneyClient | null = null;
/** App-wide client (lazy). */
export function getJourneyClient(): JourneyClient {
  shared ??= createJourneyClient();
  return shared;
}
