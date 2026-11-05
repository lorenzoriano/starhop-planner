/**
 * Get-there lines (owner feedback r1): naked-eye starts name the anchor's constellation and a recognisable
 * description; moves are given in fields of the observer's own binoculars, with the field size and degrees, once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANCHOR_HINTS, anchorLook, buildGetThere, fillTemplate, spanPhrase, wherePhrase } from '../getthere';
import { NarrationBankSchema } from '../kb-schema';
import { mulberry32 } from '../seed';
import type { NarrationBank } from '../types';

const SRC = resolve(__dirname, '../../../../public/data/journeys/src/narration.json');
const bank = NarrationBankSchema.parse(JSON.parse(readFileSync(SRC, 'utf8'))) as NarrationBank;
const kbIds = new Set((JSON.parse(readFileSync(resolve(__dirname, '../../../../public/data/journeys/kb.json'), 'utf8')) as { objects: { id: string }[] }).objects.map((o) => o.id));

const pos = (id: string, name: string, con: string, alt: number, az: number, ra = 0, dec = 0) => ({ id, name, con, alt, az, ra, dec });

describe('span and place phrases', () => {
  it('states the hop in fields of the selected binoculars, singular when it should be', () => {
    expect(spanPhrase(3.2, 6.5)).toBe('about half a field of your 6.5° binoculars (3°)');
    expect(spanPhrase(6.5, 6.5)).toBe('about one field of your 6.5° binoculars (7°)');
    expect(spanPhrase(13, 6.5)).toBe('about two fields of your 6.5° binoculars (13°)');
    expect(spanPhrase(10, 7.1)).toBe('about one and a half fields of your 7.1° binoculars (10°)');
    expect(spanPhrase(12, 4)).toBe('about three fields of your 4° binoculars (12°)');
    // A hop well under half a field is stated in degrees (Mimosa → Jewel Box is 1°, never "half a field").
    expect(spanPhrase(1.2, 6.5)).toBe('about 1° (a fraction of one field of your 6.5° binoculars)');
    expect(wherePhrase({ alt: 44, az: 90 })).toBe('about 45° up in the east');
    expect(wherePhrase({ alt: 80, az: 90 })).toBe('nearly overhead');
  });

  it('fillTemplate closes punctuation seams', () => {
    expect(fillTemplate('Find {a} by eye.', { a: 'Arcturus, the bright orange star of Boötes,' })).toBe('Find Arcturus, the bright orange star of Boötes, by eye.');
    expect(fillTemplate('Go to {a}.', { a: 'X,' })).toBe('Go to X.');
    expect(fillTemplate('Go {x}.', {})).toBeNull();
  });
});

describe('naked-eye starts', () => {
  it('describe a hinted anchor with its constellation and a pointer (the owner’s Arcturus example)', () => {
    const t = buildGetThere({ prev: null, next: pos('STAR-Arcturus', 'Arcturus', 'Boo', 44, 92), anchor: { id: 'STAR-Arcturus', name: 'Arcturus', ra: 0, dec: 0, mag: -0.04, alt: 44, az: 92 }, fovDeg: 6.5, distanceDeg: 0, anchorDistanceDeg: 0, bank, rng: mulberry32(1) });
    expect(t.bearingText).toBe('Find Arcturus by eye, the bright orange star of Boötes, about 45° up in the east; follow the arc of the Big Dipper’s handle to it. Then raise your binoculars onto it.');
    expect(t.mode).toBe('naked-eye-hop');
  });

  it('name the constellation when there is no hint', () => {
    const t = buildGetThere({ prev: null, next: pos('X1', 'Menkib', 'Per', 80, 10), anchor: { id: 'X1', name: 'Menkib', ra: 0, dec: 0, mag: 2.5, alt: 80, az: 10 }, fovDeg: 6.5, distanceDeg: 0, anchorDistanceDeg: 0, rng: mulberry32(1) });
    expect(t.bearingText).toBe('Find Menkib by eye in Perseus, nearly overhead. Then raise your binoculars onto it.');
  });

  it('describe the anchor, then hop in binocular fields to a faint first stop', () => {
    const anchor = { id: 'HR5793', name: 'Alphecca', ra: 233.7, dec: 26.7, mag: 2.2, alt: 40, az: 85 };
    const t = buildGetThere({ prev: null, next: pos('HR5681', 'δ Boötis', 'Boo', 48, 80), anchor, fovDeg: 6.5, distanceDeg: 0, anchorDistanceDeg: 13, bank, rng: mulberry32(2) });
    expect(t.bearingText).toMatch(/^Find Alphecca by eye, the brightest star of the little semicircle of Corona Borealis, about 40° up in the east\. From there, hop .+ about two fields of your 6\.5° binoculars \(13°\) to δ Boötis\.$/);
    expect(t.anchorId).toBe('HR5793');
  });

  it('mid-journey naked-eye hops name the anchor recognisably', () => {
    const prev = pos('M42', 'Orion Nebula', 'Ori', 40, 150);
    const next = pos('M1', 'Crab Nebula', 'Tau', 65, 140);
    for (let s = 1; s <= 10; s++) {
      const t = buildGetThere({ prev, next, anchor: { id: 'STAR-Aldebaran', name: 'Aldebaran', ra: 69, dec: 16.5, mag: 0.85, alt: 60, az: 160 }, fovDeg: 6.5, distanceDeg: 27.5, anchorDistanceDeg: 15, bank, rng: mulberry32(s) });
      expect(t.bearingText).toMatch(/Aldebaran, the orange eye of Taurus the Bull/);
      expect(t.bearingText).toMatch(/fields of your 6\.5° binoculars \(15°\) to the Crab Nebula\.$/);
    }
  });
});

describe('moves between stops', () => {
  it('give each number once, with the field size, and never "one fields"', () => {
    const prev = pos('A', 'Stock 2 (Muscleman Cluster)', 'Cas', 50, 320);
    for (const [deg, fov] of [[18, 6.5], [6.4, 6.5], [9, 7.1], [3, 6.5], [25, 10]] as const) {
      for (let s = 1; s <= 8; s++) {
        const next = pos('B', 'Andromeda Galaxy', s % 2 ? 'And' : 'Cas', 50 - deg * 0.7, 320 - deg * 0.7);
        const t = buildGetThere({ prev, next, anchor: null, fovDeg: fov, distanceDeg: deg, anchorDistanceDeg: 0, bank, rng: mulberry32(s) });
        expect(t.bearingText, t.bearingText).not.toMatch(/\{|undefined|NaN|one fields|half a fields|\(about \d+°\).*\(about \d+°\)/);
        expect((t.bearingText.match(/°/g) ?? []).length, t.bearingText).toBeLessThanOrEqual(2);
        if (t.mode === 'sweep') expect(t.bearingText, t.bearingText).toMatch(new RegExp(`of your ${fov}° binoculars`));
        if (t.mode === 'same-field') expect(t.bearingText).toMatch(/same view/);
        // A hop names the constellation it lands in ("toward Andromeda" or "…, in Andromeda") and, as a sweep, its target.
        if (t.mode !== 'same-field' && s % 2) expect(t.bearingText).toMatch(/(toward|in) Andromeda/);
        if (t.mode !== 'same-field' && !(s % 2)) expect(t.bearingText).toMatch(/still in Cassiopeia/);
        if (t.mode === 'sweep') expect(t.bearingText).toMatch(/the Andromeda Galaxy/);
        expect(t.bearingText).not.toMatch(/^the /);
      }
    }
  });
});

describe('anchor hints', () => {
  it('are keyed by real KB ids, name a place in the sky, and never repeat the anchor name', () => {
    const missing = Object.keys(ANCHOR_HINTS).filter((id) => !kbIds.has(id));
    expect(missing).toEqual([]);
    for (const [id, h] of Object.entries(ANCHOR_HINTS)) {
      expect(h.look, id).not.toMatch(/\b(left|right)\b/);
      expect(h.look.length, id).toBeLessThanOrEqual(100);
    }
    expect(anchorLook({ id: 'STAR-Vega', name: 'Vega' })).toBe('Vega, the brilliant blue-white star of Lyra, brightest of the Summer Triangle,');
    expect(anchorLook({ id: 'X', name: 'Alphecca', con: 'CrB' })).toBe('Alphecca in Corona Borealis');
    expect(anchorLook({ id: 'X', name: 'Small Magellanic Cloud' })).toBe('the Small Magellanic Cloud');
  });
});
