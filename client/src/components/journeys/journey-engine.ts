/**
 * THE single place where the Journeys UI chooses its engine and knowledge base.
 *
 *   "worker" → lib/journeys/journey-client.ts (dedicated worker) + the runtime KB files in data/journeys/
 *   "mock"   → fixture KB + a UI mock built on the fixture's mock client (no worker, no fetch)
 *   "auto"   → (default in the app) "worker" when data/journeys/kb.json is reachable, otherwise "mock"
 *
 * Tests (vitest) default to "mock". Override at build time with VITE_JOURNEY_ENGINE=worker|mock, or on one device
 * with localStorage["starhop-journey-engine"] = "worker" | "mock" (handy for screenshots and debugging).
 * Every branch is dynamically imported, so the fixture never loads in a worker session and the worker never
 * starts in mock mode.
 */
import type { JourneyEngineClient, KnowledgeBase } from "@/lib/journeys/types";

export type JourneyEngineMode = "mock" | "worker";
export type JourneyEngineSetting = JourneyEngineMode | "auto";

type Env = Record<string, string | boolean | undefined>;
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};
const envMode = env.VITE_JOURNEY_ENGINE;
const isTest = env.MODE === "test" || !!env.VITEST;
export const ENGINE_OVERRIDE_KEY = "starhop-journey-engine";

function deviceOverride(): JourneyEngineMode | null {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(ENGINE_OVERRIDE_KEY) : null;
    return v === "worker" || v === "mock" ? v : null;
  } catch { return null; }
}

/** Build-time choice; "auto" probes for the KB at first use. */
export const JOURNEY_ENGINE: JourneyEngineSetting = envMode === "worker" || envMode === "mock" ? envMode : isTest ? "mock" : "auto";

export interface JourneyEngineSource {
  /** The setting this source was created for ("auto" until resolved; see `resolvedMode`). */
  mode: JourneyEngineSetting;
  /** The engine actually in use once the KB probe finished. */
  resolvedMode(): Promise<JourneyEngineMode>;
  client: JourneyEngineClient;
  /** Display data for cards, names and coordinates (the worker keeps its own parsed copy). */
  loadKb(): Promise<KnowledgeBase>;
  dispose(): void;
}

const baseUrl = () => (typeof document !== "undefined" ? document.baseURI : "http://localhost/");

/**
 * Is the runtime KB served? A GET (not HEAD) so an offline service-worker cache answers it; the body is cancelled
 * after the headers, so nothing large is read here. SPA fallbacks answer HTML with 200, hence the type check.
 */
export async function probeJourneyKb(base: string = baseUrl(), fetchFn: typeof fetch | undefined = typeof fetch !== "undefined" ? fetch : undefined): Promise<boolean> {
  if (!fetchFn) return false;
  try {
    const res = await fetchFn(new URL("data/journeys/kb.json", base).toString());
    const type = res.headers.get("content-type") ?? "";
    void res.body?.cancel().catch(() => {});
    return res.ok && /json/i.test(type);
  } catch { return false; }
}

function workerSource(): JourneyEngineSource {
  const clientModule = import("@/lib/journeys/journey-client");
  let kb: Promise<KnowledgeBase> | null = null;
  return {
    mode: "worker",
    resolvedMode: async () => "worker",
    client: { generate: async (req) => (await clientModule).getJourneyClient().generate(req) },
    loadKb: () => (kb ??= clientModule.then((m) => m.loadJourneyData(baseUrl())).then((d) => d.kb).catch((error) => { kb = null; throw error; })),
    dispose: () => { void clientModule.then((m) => m.getJourneyClient().dispose()); },
  };
}

function mockSource(): JourneyEngineSource {
  const mockModule = import("./mock-engine");
  return {
    mode: "mock",
    resolvedMode: async () => "mock",
    client: { generate: async (req) => (await mockModule).uiMockJourneyClient.generate(req) },
    loadKb: async () => (await mockModule).MOCK_KB,
    dispose: () => {},
  };
}

function autoSource(): JourneyEngineSource {
  const resolved = probeJourneyKb().then((ok) => {
    if (!ok && typeof console !== "undefined") console.info("Sky Journeys: data/journeys/kb.json not found; using the demo knowledge base.");
    return ok ? workerSource() : mockSource();
  });
  return {
    mode: "auto",
    resolvedMode: async () => (await resolved).mode as JourneyEngineMode,
    client: { generate: async (req) => (await resolved).client.generate(req) },
    loadKb: async () => (await resolved).loadKb(),
    dispose: () => { void resolved.then((s) => s.dispose()); },
  };
}

let shared: JourneyEngineSource | null = null;

export function getJourneyEngineSource(mode: JourneyEngineSetting = deviceOverride() ?? JOURNEY_ENGINE): JourneyEngineSource {
  if (shared?.mode === mode) return shared;
  shared?.dispose();
  shared = mode === "worker" ? workerSource() : mode === "mock" ? mockSource() : autoSource();
  return shared;
}

/**
 * The stale-key check against the real KB (journey-key.ts journeyKeyResolver), or null when the demo KB is in use:
 * the demo KB knows none of the real journeys, so nothing stored on the device may be dropped because of it.
 */
export async function realJourneyKeyResolver(source: JourneyEngineSource = getJourneyEngineSource()): Promise<((key: string) => boolean) | null> {
  if ((await source.resolvedMode()) !== "worker") return null;
  const [kb, { journeyKeyResolver }] = await Promise.all([source.loadKb(), import("@/lib/journeys/journey-key")]);
  return journeyKeyResolver(kb);
}
