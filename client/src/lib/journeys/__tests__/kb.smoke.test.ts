/**
 * Smoke test against the REAL knowledge base (client/public/data/journeys/*.json) when the KB build has
 * produced it; skipped otherwise. Logs titles, stops and timing for two San Francisco evenings. It checks
 * correctness only (hard constraints recomputed independently, narration without seams, keys rebuild); it does
 * not judge journey quality or tune constraints (that is the evaluation phase).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate, rebuildJourney } from '../assemble';
import { knowledgeBaseFromFiles, parseScorerModel } from '../kb-schema';
import type { JourneyRequest, KnowledgeBase, ScorerModel } from '../types';
import { independentProblems, request } from './engine-helpers';

const dir = new URL('../../../../public/data/journeys/', import.meta.url);
const FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
const present = FILES.every((f) => existsSync(new URL(f, dir)));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

function loadReal(): { kb: KnowledgeBase; model: ScorerModel | null } {
  const kb = knowledgeBaseFromFiles({ kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'), narration: read('narration.json'), lenses: existsSync(new URL('lenses.json', dir)) ? read('lenses.json') : undefined });
  let model: ScorerModel | null = null;
  if (existsSync(new URL('model.json', dir))) model = parseScorerModel(read('model.json'));
  return { kb, model };
}

const CASES: [string, JourneyRequest][] = [
  ['SF 2027-01-15 20:30 PST', request('2027-01-16T04:30:00Z')],
  ['SF 2026-08-10 21:30 PDT', request('2026-08-11T04:30:00Z')],
];

describe.skipIf(!present)('real KB smoke test', () => {
  const loaded = present ? loadReal() : null;
  for (const [label, req] of CASES) {
    it(label, () => {
      const { kb, model } = loaded!;
      const t0 = performance.now();
      const res = generate(kb, req, { model, clock: () => performance.now() });
      const ms = performance.now() - t0;
      const eligible = kb.objects.filter((o) => o.provenance?.status === 'curated' || o.provenance?.status === 'reviewed').length;
      const lines = [`[smoke] ${label}: ${res.journeys.length} journeys in ${ms.toFixed(0)} ms (kb ${kb.version}, ${kb.objects.length} objects, ${eligible} curated; candidates ${res.diagnostics.candidates}, validated ${res.diagnostics.validated}, scorer ${res.diagnostics.scorer})`];
      lines.push(`  conditions: ${res.diagnostics.message}${res.diagnostics.relaxed ? ` | relaxed: ${res.diagnostics.relaxed.join(', ')}` : ''}`);
      for (const j of res.journeys) {
        lines.push(`  ★ ${j.title} [${j.templateId}${j.switch ? ` → ${j.switch.toTemplateId} after stop ${j.switch.atStop}` : ''}] ${j.durationMin} min, ${j.difficulty}, path ${j.totalPathDeg}°, score ${j.score}`);
        lines.push(`    ${j.story}`);
        for (const s of j.stops) {
          const t = s.windowStart.slice(11, 16);
          lines.push(`    ${s.index + 1}. ${t}Z ${s.objectId} (${s.role}) alt ${s.altAtStart}° ${s.link ? `via ${s.link.type}/${s.link.subtype} ${s.link.strength}` : ''}`);
          if (s.transitionText) lines.push(`       → ${s.transitionText}`);
        }
        expect(independentProblems(kb, req, res, j).filter((p) => !(j.switch && /link type .* not allowed|template length/.test(p)))).toEqual([]);
        const texts = [j.title, j.story ?? '', ...j.stops.flatMap((s) => [s.transitionText ?? '', s.whyHereText ?? '', s.transitionSkipText ?? ''])];
        for (const t of texts) expect(t).not.toMatch(/\{\w+\}|undefined|NaN/);
        const rb = rebuildJourney(kb, j.key, req);
        expect(rb.journey?.stops.map((s) => s.objectId)).toEqual(j.stops.map((s) => s.objectId));
        if (!rb.valid) lines.push(`    (rebuild at the rounded site reports: ${rb.problems.join('; ')})`);
      }
      console.log(lines.join('\n'));
    }, 120_000);
  }
});
