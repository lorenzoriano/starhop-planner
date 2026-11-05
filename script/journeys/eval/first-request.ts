/**
 * First request after the KB loads (cold caches + JIT), the worst case a user meets, then the next 15-minute slot.
 *   npx tsx script/journeys/eval/first-request.cts [instant lat lon]   (LEN=8 for a long journey; JOURNEY_ENGINE_DIR=…)
 */
import { join, resolve } from 'node:path';
import { loadRealKb, OPTICS } from './run-grid';
import type * as AssembleNs from '../../../client/src/lib/journeys/assemble';
import type * as CandidatesNs from '../../../client/src/lib/journeys/candidates';

// JOURNEY_ENGINE_DIR=<copy of client/src/lib/journeys> times another engine copy (as run-grid.ts does).
const ENGINE_DIR = process.env.JOURNEY_ENGINE_DIR ? resolve(process.env.JOURNEY_ENGINE_DIR) : join(process.cwd(), 'client/src/lib/journeys');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate } = require(join(ENGINE_DIR, 'assemble.ts')) as typeof AssembleNs;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prepareKb } = require(join(ENGINE_DIR, 'candidates.ts')) as typeof CandidatesNs;
export async function main() {
  const t0 = performance.now();
  const kb = loadRealKb();
  const t1 = performance.now();
  prepareKb(kb);
  const t2 = performance.now();
  const req = { instant: process.argv[2] ?? '2027-05-15T13:30:00.000Z', lat: Number(process.argv[3] ?? -33.9), lon: Number(process.argv[4] ?? 151.2), instrument: OPTICS['10x50'], skyBrightness: 19, length: Number(process.env.LEN ?? 5), includeChallenge: true };
  const profile: Record<string, number> = {};
  const r = generate(kb, req, { clock: () => performance.now(), profile });
  const t3 = performance.now();
  const r2 = generate(kb, { ...req, instant: new Date(Date.parse(req.instant) + 15 * 60_000).toISOString() });
  const t4 = performance.now();
  console.log(`load+validate ${(t1 - t0).toFixed(0)} ms, prepare ${(t2 - t1).toFixed(0)} ms, first generate ${(t3 - t2).toFixed(0)} ms ${JSON.stringify(Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, Math.round(v)])))}, next slot ${(t4 - t3).toFixed(0)} ms; journeys ${r.journeys.length}/${r2.journeys.length}`);
}
