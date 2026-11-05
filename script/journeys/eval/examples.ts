/**
 * Example journeys for docs/sky-journeys/engine-eval.md: one journey per scenario (seasons, hemispheres, Moon,
 * a forced theme, a long journey), each printed in full. Picks a not-yet-shown archetype where the result has one.
 *   npx tsx script/journeys/eval/examples.cts > data-dev/journeys-eval/examples.md
 */
import { fromZonedTime } from 'date-fns-tz';
import { OPTICS, SITES, formatJourney, loadRealKb } from './run-grid';
import type * as AssembleNs from '../../../client/src/lib/journeys/assemble';
import type { JourneyRequest } from '../../../client/src/lib/journeys/types';

const SCENARIOS: { site: string; local: string; label: string; theme?: string; length?: number; optic?: keyof typeof OPTICS }[] = [
  { site: 'San Francisco', local: '2027-01-08T20:30', label: 'winter, new Moon' },
  { site: 'Colorado dark site', local: '2027-08-04T22:00', label: 'summer, dark site, Moon down' },
  { site: 'London', local: '2027-10-29T21:00', label: 'autumn, new Moon' },
  { site: 'London', local: '2027-04-07T22:30', label: 'spring, new Moon', optic: '7x50' },
  { site: 'Sydney', local: '2027-07-05T19:30', label: 'southern winter, new Moon' },
  { site: 'Santiago', local: '2027-04-06T21:00', label: 'southern autumn, new Moon' },
  { site: 'San Francisco', local: '2027-01-22T23:00', label: 'full Moon up' },
  { site: 'Sydney', local: '2027-08-17T21:00', label: 'southern full Moon up' },
  { site: 'Colorado dark site', local: '2027-08-04T22:00', label: 'forced theme: How Stars Die', theme: 'A8-how-stars-die' },
  { site: 'Sydney', local: '2027-07-05T19:30', label: 'long journey (8 stops asked)', length: 8 },
];

export async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generate } = require('../../../client/src/lib/journeys/assemble.ts') as typeof AssembleNs;
  const kb = loadRealKb();
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const shown = new Set<string>();
  const out: string[] = [];
  SCENARIOS.forEach((sc, n) => {
    const site = SITES.find((s) => s.name === sc.site)!;
    const optic = sc.optic ?? '10x50';
    const req: JourneyRequest = {
      instant: fromZonedTime(sc.local, site.tz).toISOString(), lat: site.lat, lon: site.lon, timezone: site.tz,
      instrument: OPTICS[optic], skyBrightness: site.sky, theme: sc.theme ?? null, length: sc.length ?? 5, includeChallenge: true, limit: 3,
    };
    const res = generate(kb, req);
    // The long scenario shows the archetype switch when one is offered; the others prefer an unseen archetype.
    const j = (sc.length && sc.length > 6 ? res.journeys.find((x) => x.switch) : undefined)
      ?? res.journeys.find((x) => !shown.has(x.templateId)) ?? res.journeys[0];
    out.push(`### ${n + 1}. ${site.name}, ${sc.local.replace('T', ' ')} local, ${optic} — ${sc.label}`, '');
    out.push(`Conditions: ${res.diagnostics.message} Also suggested: ${res.journeys.filter((x) => x !== j).map((x) => `“${x.title}”`).join(', ') || 'nothing else'}.`, '');
    if (!j) { out.push('_No journey._', ''); return; }
    shown.add(j.templateId);
    out.push(formatJourney(j, byId, { why: false }), '');
  });
  console.log(out.join('\n'));
}
