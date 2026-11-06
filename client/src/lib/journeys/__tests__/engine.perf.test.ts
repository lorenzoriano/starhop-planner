/**
 * Performance budget (spec decision 13: ≤ 300 ms desktop; doc 05 §12.11 loose CI bound 1,500 ms median).
 * Logs per-stage timings so regressions are visible. The synthetic KB (540 objects) is about the size of
 * the v1 master list (519 objects).
 */
import { describe, expect, it } from 'vitest';
import { generate } from '../assemble';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { request, syntheticKb } from './engine-helpers';
import type { JourneyRequest, KnowledgeBase } from '../types';

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const INSTANTS = Array.from({ length: 10 }, (_, i) => new Date(Date.parse('2026-11-20T05:00:00Z') + i * 11 * 86_400_000 + (i % 3) * 3 * 3_600_000).toISOString());

/** A valley site: a 40° ridge from az 200 to 320 (above the 30° floor, so it binds) and 12° hills elsewhere. */
const VALLEY: JourneyRequest['horizon'] = { kind: 'geometric', stepDeg: 1, alt: Array.from({ length: 360 }, (_, az) => (az >= 200 && az <= 320 ? 40 : 12)) };

function bench(label: string, kb: KnowledgeBase, n: number, extra: Partial<JourneyRequest> = {}) {
  const ms: number[] = [];
  const profile: Record<string, number> = {};
  let journeys = 0;
  // Warm-up (KB preparation is memoised per KB object; the worker pays it once).
  generate(kb, request(INSTANTS[0], extra));
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const r = generate(kb, request(INSTANTS[i % INSTANTS.length], { length: 4 + (i % 4), seed: String(i), ...extra }), { clock: () => performance.now(), profile });
    ms.push(performance.now() - t);
    journeys += r.journeys.length;
  }
  const stages = Object.entries(profile).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(' · ');
  console.log(`[perf] ${label}: median ${median(ms).toFixed(1)} ms, max ${Math.max(...ms).toFixed(1)} ms, journeys ${journeys} | per-run stages (ms): ${stages}`);
  return median(ms);
}

describe('engine performance', () => {
  it('fixture KB (15 objects)', () => {
    expect(bench('fixture', FIXTURE_KB, 20)).toBeLessThan(300);
  });
  it('synthetic KB (540 objects, master-list size)', () => {
    expect(bench('synthetic-540', syntheticKb(36), 10)).toBeLessThan(1500);
  }, 60_000);
  it('synthetic KB with a binding local skyline (valley site)', () => {
    expect(bench('synthetic-540 + skyline', syntheticKb(36), 10, { horizon: VALLEY })).toBeLessThan(1500);
  }, 60_000);
});
