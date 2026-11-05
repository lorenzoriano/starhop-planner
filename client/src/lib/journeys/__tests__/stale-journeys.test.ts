/**
 * Journeys from before a KB rebuild: a key whose theme or stop objects are gone no longer resolves, and the app drops
 * what carries it (device progress and feedback, Planner journey tags) instead of showing a dead link.
 */
import { describe, expect, it } from 'vitest';
import { generate } from '../assemble';
import { decodeJourneyKey, encodeJourneyKey, journeyKeyResolver } from '../journey-key';
import {
  appendFeedback, emptyFeedbackStore, emptyJourneyStore, pruneFeedbackStore, pruneJourneyStore, rememberJourney, startJourneyProgress,
} from '../progress';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import { stripStaleJourneyTags, type NightItem } from '../../session';
import { stripStalePlannerJourneyTags, type PlannerStore } from '../../session-planner';
import { journeyFitsKb } from '../../../components/journeys/journey-view';
import { request } from './engine-helpers';

const [fresh] = generate(FIXTURE_KB, request('2027-01-09T05:00:00Z')).journeys;
const d = decodeJourneyKey(fresh.key)!;
const { format: _f, ...data } = d;
/** The same journey after a KB rebuild removed its last stop object / its theme. */
const goneStop = encodeJourneyKey({ ...data, stopIds: [...d.stopIds.slice(0, -1), 'NOT-THERE'] });
const goneTheme = encodeJourneyKey({ ...data, templateId: 'A99-retired' });
const resolves = journeyKeyResolver(FIXTURE_KB);
const T0 = Date.UTC(2027, 0, 9, 5);

describe('journeyKeyResolver', () => {
  it('accepts a key the KB can show and rejects malformed keys and keys whose theme or objects are gone', () => {
    expect(resolves(fresh.key)).toBe(true);
    for (const key of ['', 'nonsense', 'look-alikes~M45.NGC869~202611040430', goneStop, goneTheme]) expect(resolves(key), key).toBe(false);
    // A switch into a theme the KB no longer has.
    expect(resolves(encodeJourneyKey({ ...data, switch: { toTemplateId: 'A99-retired', at: 0 } }))).toBe(false);
  });

  it('a KB version bump alone does not make a key stale (the journey still opens)', () => {
    expect(journeyKeyResolver({ ...FIXTURE_KB, version: 'rebuilt' })(fresh.key)).toBe(true);
  });
});

describe('device journey storage', () => {
  const stale = { ...fresh, key: goneStop };
  it('pruneJourneyStore drops the stale active and recent journeys and keeps the rest', () => {
    let store = rememberJourney(rememberJourney(emptyJourneyStore(), fresh, false, T0), stale, false, T0);
    store = startJourneyProgress(store, stale, false, T0);
    const pruned = pruneJourneyStore(store, resolves);
    expect(pruned.active).toBeNull();
    expect(pruned.recent.map((r) => r.journey.key)).toEqual([fresh.key]);
    // Nothing stale: the same object back, so callers can skip the write.
    expect(pruneJourneyStore(pruned, resolves)).toBe(pruned);
    const ok = startJourneyProgress(pruned, fresh, false, T0);
    expect(pruneJourneyStore(ok, resolves)).toBe(ok);
  });

  it('pruneFeedbackStore drops feedback of stale journeys', () => {
    let fb = appendFeedback(emptyFeedbackStore(), { type: 'stop', journeyKey: fresh.key, templateId: fresh.templateId, objectId: fresh.stops[0].objectId, stopIndex: 0, outcome: 'seen', at: T0 });
    fb = appendFeedback(fb, { type: 'stop', journeyKey: goneStop, templateId: fresh.templateId, objectId: fresh.stops[0].objectId, stopIndex: 0, outcome: 'seen', at: T0 });
    fb = appendFeedback(fb, { type: 'journey', journeyKey: goneTheme, templateId: 'A99-retired', status: 'completed', at: T0 });
    const pruned = pruneFeedbackStore(fb, resolves);
    expect(pruned.records.map((r) => r.journeyKey)).toEqual([fresh.key]);
    expect(pruneFeedbackStore(pruned, resolves)).toBe(pruned);
  });

  it('journeyFitsKb: a stored journey shows only while its theme and stops are in the KB', () => {
    expect(journeyFitsKb(FIXTURE_KB, fresh)).toBe(true);
    expect(journeyFitsKb(FIXTURE_KB, { ...fresh, templateId: 'A99-retired' })).toBe(false);
    expect(journeyFitsKb(FIXTURE_KB, { ...fresh, stops: [...fresh.stops.slice(1), { ...fresh.stops[0], objectId: 'NOT-THERE' }] })).toBe(false);
  });
});

describe('Planner journey tags', () => {
  const item = (id: string, extra: Partial<NightItem> = {}): NightItem => ({ id, addedAt: '2027-01-09T04:00:00.000Z', notes: '', ...extra });
  const planned = '2027-01-09T05:10:00.000Z';

  it('stripStaleJourneyTags drops the stale journey tag but keeps the item and its planned time', () => {
    const items = [item('M42', { journeyKey: fresh.key, journeyStop: 1, plannedAt: planned }), item('M45', { journeyKey: goneStop, journeyStop: 2, plannedAt: planned, notes: 'keep' }), item('M31')];
    expect(stripStaleJourneyTags(items, resolves)).toEqual([items[0], item('M45', { plannedAt: planned, notes: 'keep' }), items[2]]);
    const clean = [items[0], items[2]];
    expect(stripStaleJourneyTags(clean, resolves)).toBe(clean);
  });

  it('stripStalePlannerJourneyTags touches only nights with a stale tag', () => {
    const night = (id: string, items: NightItem[]) => ({ id, name: id, startAt: '2027-01-09T03:00:00.000Z', lat: 37.8, lon: -122.4, locationName: '', durationMinutes: 180, minutesPerTarget: 15, items, archived: false, createdAt: '2027-01-01T00:00:00.000Z' });
    const ok = night('a', [item('M42', { journeyKey: fresh.key, journeyStop: 1 })]);
    const store: PlannerStore = { sessions: [ok, night('b', [item('M45', { journeyKey: goneTheme, journeyStop: 3 })])], activeId: 'a' };
    const next = stripStalePlannerJourneyTags(store, resolves);
    expect(next.sessions[0]).toBe(ok);
    expect(next.sessions[1].items).toEqual([item('M45')]);
    expect(stripStalePlannerJourneyTags(next, resolves)).toBe(next);
  });
});
