/**
 * Test helpers for the journey engine: request builder, an INDEPENDENT hard-constraint checker (recomputes
 * with eqToHorizontal / moonState / scatteredMoonlight / binocularAssessment at the displayed stop windows,
 * not the engine's fast path), and a synthetic sky-wide KB made of rotated fixture copies.
 */
import * as Astro from 'astronomy-engine';
import { angularDistance, eqToHorizontal } from '../../astronomy';
import { binocularAssessment } from '../../binocular-assessment';
import { moonState, scatteredMoonlight } from '../../moon';
import { CURATED_GRADE_MIN_ALT, GLOW_REFERENCE_SKY, binocularProfileOf, glowLimitFor, normalizeRequest, sunLimitFor, toBinocularTarget, viewGradeRating } from '../conditions';
import { pathGeometry } from '../region';
import { FIXTURE_KB } from '../__fixtures__/fixture-kb';
import type { Edge, Journey, JourneyRequest, JourneyResult, KbObject, KnowledgeBase, Template, ThemeLensSet } from '../types';

export const SF = { lat: 37.77, lon: -122.42, timezone: 'America/Los_Angeles' };
export const BINOS_10X50 = { fovDeg: 6.5, aperture: 50, magnification: 10 };

export function request(instant: string, extra: Partial<JourneyRequest> = {}): JourneyRequest {
  return { instant, lat: SF.lat, lon: SF.lon, timezone: SF.timezone, instrument: BINOS_10X50, skyBrightness: 21.3, ...extra };
}

/** Every hard-constraint problem of one returned journey, recomputed independently. */
export function independentProblems(kb: KnowledgeBase, req: JourneyRequest, result: JourneyResult, j: Journey): string[] {
  const out: string[] = [];
  const relaxed = result.diagnostics.relaxed ?? [];
  const s = normalizeRequest(req);
  const minAlt = relaxed.some((r) => r.startsWith('altitude')) ? Math.min(s.minAlt, 25) : s.minAlt;
  const radius = relaxed.some((r) => r.startsWith('wider region')) ? 40 : s.radius;
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const template = kb.templates.find((t) => t.id === j.templateId);
  if (!template) out.push(`unknown template ${j.templateId}`);
  // The one archetype switch (spec decision 6): stops after `atStop` follow the target template.
  const sw = j.switch;
  const target = sw ? kb.templates.find((t) => t.id === sw.toTemplateId) : undefined;
  if (sw && (!target || !template?.switchRule?.to.includes(sw.toTemplateId))) out.push(`invalid switch ${j.templateId} → ${sw.toTemplateId}`);
  const templateAt = (i: number): Template | undefined => (sw && i > sw.atStop ? target : template);
  // Theme lenses (owner feedback r2): a theme with a lens set tells its stops through it (checked below).
  const lensSet = (t: Template | undefined): ThemeLensSet | undefined => (t ? kb.lenses?.find((l) => l.archetype === t.archetype) : undefined);
  const lensAt = (i: number) => lensSet(templateAt(i));
  // Round 3: a theme told through a lens never switches and is never switched into.
  if (sw && (lensSet(template) || lensSet(target))) out.push(`lens theme switch ${j.templateId} → ${sw.toTemplateId}`);
  const profile = binocularProfileOf(s);
  const objs = j.stops.map((st) => byId.get(st.objectId)).filter((o): o is KbObject => !!o);
  if (objs.length !== j.stops.length) out.push('unknown object id');
  if (j.stops.length < 3 || j.stops.length > 10) out.push(`length ${j.stops.length}`);
  if (template && !sw && !lensSet(template) && (j.stops.length < template.length[0] || j.stops.length > template.length[1])) out.push(`template length ${j.stops.length}`);
  if (template && sw && target && !lensSet(template) && !lensSet(target) && (sw.atStop + 1 > template.length[1] || j.stops.length - sw.atStop > target.length[1] || j.stops.length < template.length[0])) out.push(`switched lengths ${sw.atStop + 1}+${j.stops.length - sw.atStop}`);
  // Lens rules, per theme part: every stop has the theme's lens (and carries it), steps never go back, stops of one
  // beat follow the lens rank, at most maxStops per beat, at least minBeats beats (2 after a switch), the part's last
  // stop is a challenge only on the theme's final beat or an end beat, a lens distance ladder climbs by ≥ 1.25×.
  const parts: [number, number][] = sw ? [[0, sw.atStop], [sw.atStop + 1, j.stops.length - 1]] : [[0, j.stops.length - 1]];
  parts.forEach(([from, to], p) => {
    const L = lensAt(from);
    if (!L) return;
    const steps: number[] = [];
    // After a switch the switch stop opens the second theme's part on its own beat there.
    const first = p === 1 ? from - 1 : from;
    for (let i = first; i <= to; i++) {
      const lens = L.objects[j.stops[i].objectId];
      if (!lens) { out.push(`stop ${i} ${j.stops[i].objectId} has no ${L.archetype} lens`); continue; }
      if (i >= from && JSON.stringify(j.stops[i].lens) !== JSON.stringify(lens)) out.push(`stop ${i} does not carry its ${L.archetype} lens`);
      if (steps.length && lens.step < steps[steps.length - 1]) out.push(`stop ${i} steps back (${steps[steps.length - 1]} → ${lens.step})`);
      const prevLens = i > first ? L.objects[j.stops[i - 1].objectId] : undefined;
      if (prevLens && prevLens.step === lens.step && prevLens.rank !== undefined && lens.rank !== undefined && lens.rank < prevLens.rank) out.push(`stop ${i} breaks the rank order of beat ${lens.step}`);
      steps.push(lens.step);
    }
    for (const b of L.beats) if (steps.filter((x) => x === b.step).length > (b.maxStops ?? 1)) out.push(`beat ${b.step} has more than ${b.maxStops ?? 1} stops`);
    const need = p === 1 ? 2 : Math.min(L.minBeats, L.beats.length);
    if (new Set(steps).size < need) out.push(`${new Set(steps).size} beats < ${need}`);
    const finale = (step: number | undefined) => step !== undefined && (step === Math.max(...L.beats.map((b) => b.step)) || !!L.endSteps?.includes(step));
    if (j.stops[to].challenge && !finale(L.objects[j.stops[to].objectId]?.step)) out.push(`challenge stop ${to} closes the ${L.archetype} story off its final beat`);
    const t = templateAt(from);
    if (t?.progression?.property === 'distanceLy' && t.progression.direction === 'up') {
      for (let i = Math.max(first + 1, 1); i <= to; i++) {
        const a = objs[i - 1], b = objs[i];
        if (a.kind === 'dso' && (a.dsoClass === 'milky-way-field' || a.dsoClass === 'star-cloud')) continue;
        const da = a.facts.distanceLy?.value, db = b.facts.distanceLy?.value;
        if (!da || !db || db < 1.25 * da) out.push(`lens ladder step ${i} (${da} → ${db} ly)`);
      }
    }
  });
  let challenges = 0;
  j.stops.forEach((st, i) => {
    const o = objs[i];
    if (!o) return;
    if (st.index !== i) out.push(`stop ${i} index ${st.index}`);
    if (o.provenance?.status !== 'curated' && o.provenance?.status !== 'reviewed') out.push(`${o.id} not curated`);
    let worst = 0;
    for (const iso of [st.windowStart, st.windowEnd]) {
      const at = new Date(iso);
      const { alt } = eqToHorizontal(o.ra, o.dec, req.lat, req.lon, at);
      if (alt < minAlt - 0.05) out.push(`${o.id} alt ${alt.toFixed(2)} < ${minAlt} at ${iso}`);
      const moon = moonState(req.lat, req.lon, at);
      if (moon.sunAlt > sunLimitFor(o) + 0.01) out.push(`${o.id} sun ${moon.sunAlt.toFixed(2)} > ${sunLimitFor(o)} at ${iso}`);
      if (moon.alt > -moon.diameter / 2) {
        const sep = angularDistance(o.ra, o.dec, moon.ra, moon.dec);
        const need = Math.max(15, 10 + 30 * moon.illumination);
        if (sep < need - 0.05) out.push(`${o.id} Moon ${sep.toFixed(1)}° < ${need.toFixed(1)}° at ${iso}`);
        // Moonlight limits are measured against a sky no darker than GLOW_REFERENCE_SKY (conditions.ts).
        const glow = scatteredMoonlight(moon, alt, sep, Math.min(req.skyBrightness, GLOW_REFERENCE_SKY)).brightening;
        if (glow > glowLimitFor(o) + 0.02) out.push(`${o.id} moonlight ${glow.toFixed(2)} mag > ${glowLimitFor(o)} at ${iso}`);
      }
      // A curated view grade rates a deep-sky object on its own when the Moon is down and it stands high enough
      // (conditions.ts makeRater); otherwise the surface-brightness model decides.
      const moonUp = moon.alt > -moon.diameter / 2;
      const grade = o.view?.basis === 'curator' && !moonUp && alt >= CURATED_GRADE_MIN_ALT ? viewGradeRating(o, s) : null;
      if (o.mag !== null) worst = Math.max(worst, grade ?? binocularAssessment(toBinocularTarget(o), profile, { alt, moon, skyBrightness: req.skyBrightness }).rating);
    }
    if (worst >= 3) out.push(`${o.id} binocular rating 3`);
    if (worst === 2 && !st.challenge) out.push(`${o.id} rating 2 but not flagged challenge`);
    if (st.challenge) { challenges++; if (i < 2) out.push(`challenge at stop ${i}`); }
    if (i === 0) {
      if (st.link) out.push('stop 0 has a link');
    } else {
      const l = st.link;
      if (!l) out.push(`stop ${i} without link`);
      else {
        if (l.from !== j.stops[i - 1].objectId) out.push(`stop ${i} link from ${l.from}`);
        if (l.type === 'NEIGHBOR') out.push(`stop ${i} NEIGHBOR link`);
        if (l.strength < 0.35) out.push(`stop ${i} weak link ${l.strength}`);
        if (sw && i === sw.atStop + 1) {
          const rule = template?.switchRule;
          if (!rule || !rule.via.includes(l.type) || l.strength < rule.minStrength) out.push(`stop ${i} switch link ${l.type} ${l.strength} breaks the switch rule`);
        } else if (lensAt(i)) {
          // A lens step rides the storyline (lens-thread link) or a real edge of at least 0.5.
          if (l.subtype !== 'lens-thread' && l.strength < 0.5) out.push(`stop ${i} lens link ${l.type} ${l.strength} below 0.5`);
        } else {
          const t = templateAt(i);
          if (t && !t.edges.includes(l.type)) out.push(`stop ${i} link type ${l.type} not allowed`);
          // Slot-level arrival rule (TemplateSlot.inEdges).
          const slot = t?.slots.find((x) => x.label === st.role && x.arc === st.arc);
          if (slot?.inEdges && !slot.inEdges.includes(l.type)) out.push(`stop ${i} link type ${l.type} not allowed into slot "${slot.label}"`);
        }
      }
    }
    // Slot clauses the engine must honour (checked here independently of candidates.slotMatches). A lens stop's role
    // is its beat label and its arc is positional (checked above).
    const L = lensAt(i);
    if (L) {
      if (!L.beats.some((b) => b.label === st.role)) out.push(`stop ${i} role "${st.role}" is not a ${L.archetype} beat`);
      return;
    }
    const slot = templateAt(i)?.slots.find((x) => x.label === st.role && x.arc === st.arc);
    if (!slot) out.push(`stop ${i} role "${st.role}" is not a slot of its template`);
    else {
      const m = slot.match;
      if (m.variabilityClasses && !(o.kind === 'star' && o.variability && m.variabilityClasses.includes(o.variability.class))) out.push(`${o.id} lacks the variability class of slot "${slot.label}"`);
      if (m.hasHistoryHook && !o.historyHook) out.push(`${o.id} lacks the history hook of slot "${slot.label}"`);
      if (m.kinds && !m.kinds.includes(o.kind)) out.push(`${o.id} is not a ${m.kinds.join('/')} (slot "${slot.label}")`);
      if (m.roles && !m.roles.some((r) => o.roles.includes(r))) out.push(`${o.id} lacks the roles of slot "${slot.label}"`);
      // Variable-star stories: the hook and payoff stars swing by ≥ 0.3 mag when the amplitude is known.
      const v = o.kind === 'star' ? o.variability : undefined;
      if ((slot.arc === 'hook' || slot.arc === 'payoff') && templateAt(i)?.themeTags.includes('variable-stars') && v && v.vMin - v.vMax < 0.3 - 1e-6) {
        out.push(`${o.id} swings only ${(v.vMin - v.vMax).toFixed(2)} mag in slot "${slot.label}"`);
      }
    }
  });
  if (challenges > 1) out.push(`${challenges} challenge stops`);
  // Distance ladders (owner feedback round 1): every step of a distance-up template climbs at least 2× and at most
  // 15× (the one leap out of the Milky Way, to ≥ 100,000 ly, only from a rung ≥ 2,000 ly). A Milky Way scene
  // opening the journey is not a rung.
  for (let i = 1; i < objs.length; i++) {
    const t = templateAt(i);
    if (!t || lensSet(t) || t.progression?.property !== 'distanceLy' || t.progression.direction !== 'up') continue;
    const a = objs[i - 1], b = objs[i];
    if (i === 1 && a.kind === 'dso' && (a.dsoClass === 'milky-way-field' || a.dsoClass === 'star-cloud')) continue;
    const da = a.facts.distanceLy?.value, db = b.facts.distanceLy?.value;
    if (!da || !db) { out.push(`ladder stop ${i} without a distance`); continue; }
    const r = db / da;
    const leap = db >= 100_000 && da < 100_000 && da >= 2_000;
    if (r < 2 || (r > 15 && !leap)) out.push(`ladder step ${i} ×${r.toFixed(2)} (${Math.round(da)} → ${Math.round(db)} ly)`);
  }
  if (new Set(j.stops.map((x) => x.objectId)).size !== j.stops.length) out.push('duplicate stop');
  const curatedPair = (a: string, b: string) => kb.edges.some((e: Edge) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  for (let a = 0; a < objs.length; a++) for (let b = a + 1; b < objs.length; b++) {
    if (angularDistance(objs[a].ra, objs[a].dec, objs[b].ra, objs[b].dec) < 0.5 && !curatedPair(objs[a].id, objs[b].id)) out.push(`${objs[a].id}/${objs[b].id} < 0.5°`);
  }
  const geo = pathGeometry(objs, { ra: j.regionCenter.ra, dec: j.regionCenter.dec }, j.regionRadius);
  if (j.regionRadius > radius + 1e-9) out.push(`radius ${j.regionRadius} > ${radius}`);
  if (geo.maxFromCenter > j.regionRadius + 1e-6) out.push(`stop ${geo.maxFromCenter.toFixed(2)}° from cap centre`);
  // Hops stay within 20°; the hop onto a lens theme's final beat may run 25° (candidates.FINALE_HOP_STRETCH, round 4).
  geo.hops.forEach((h, k) => {
    const L = lensAt(k + 1);
    const finale = !!L && L.objects[j.stops[k + 1].objectId]?.step === Math.max(...L.beats.map((b) => b.step));
    if (h > (finale ? 25 : 20) + 1e-6) out.push(`hop ${h.toFixed(1)}°`);
  });
  if (geo.pathDeg > 2.5 * j.regionRadius + 1e-6) out.push(`path ${geo.pathDeg.toFixed(1)}°`);
  if (geo.sharpTurns > 1) out.push(`${geo.sharpTurns} sharp turns`);
  if (geo.reversals > 1) out.push(`${geo.reversals} reversals`);
  if (geo.backtrackHops.length > 1) out.push(`${geo.backtrackHops.length} back-tracks`);
  // A back-track rides a strong link, or (lens theme) the storyline moving on to a later beat.
  const storyStep = (k: number) => { const L = lensAt(k + 1); const a = L?.objects[j.stops[k].objectId], b = L?.objects[j.stops[k + 1].objectId]; return !!a && !!b && b.step > a.step; };
  for (const k of geo.backtrackHops) if ((j.stops[k + 1].link?.strength ?? 0) < 0.85 && !storyStep(k)) out.push(`back-track on weak link at stop ${k + 1}`);
  if (Math.abs(geo.pathDeg - j.totalPathDeg) > 0.06) out.push(`totalPathDeg ${j.totalPathDeg} vs ${geo.pathDeg.toFixed(2)}`);
  return out;
}

/**
 * Problems of a whole result (owner feedback round 1): two suggestions with the same title, sharing two or more
 * stops, or telling the same archetype over the same named region.
 */
export function resultProblems(result: JourneyResult): string[] {
  const out: string[] = [];
  const js = result.journeys;
  for (let a = 0; a < js.length; a++) for (let b = a + 1; b < js.length; b++) {
    const A = js[a], B = js[b];
    if (A.title.trim().toLowerCase() === B.title.trim().toLowerCase()) out.push(`same title "${A.title}"`);
    const shared = A.stops.filter((x) => B.stops.some((y) => y.objectId === x.objectId)).length;
    if (shared >= 2) out.push(`${A.key}/${B.key} share ${shared} stops`);
    if (A.templateId === B.templateId && A.regionName !== undefined && A.regionName === B.regionName) out.push(`two ${A.templateId} journeys over ${A.regionName}`);
  }
  return out;
}

/**
 * A sky-wide synthetic KB: `copies` rotated copies of the fixture (RA shifted by `raStep`·c, Dec mirrored for
 * odd copies, constellation recomputed), with edges and contexts renamed. Real catalog ids are kept only for copy 0.
 */
export function syntheticKb(copies: number, raStep = 360 / copies, opts: { moonFriendlyTemplate?: boolean } = {}): KnowledgeBase {
  const rename = (id: string, c: number) => (c === 0 ? id : `${id}~${c}`);
  const objects: KbObject[] = [];
  const edges: Edge[] = [];
  const contexts = [];
  for (let c = 0; c < copies; c++) {
    const flip = c % 2 === 1 ? -1 : 1;
    for (const o of FIXTURE_KB.objects) {
      const clone = structuredClone(o) as KbObject;
      clone.id = rename(o.id, c);
      clone.ra = (((o.ra + raStep * c) % 360) + 360) % 360;
      clone.dec = flip * o.dec;
      // The constellation the copy really sits in, so region names (titles, near-identical suggestions) differ.
      if (c > 0) clone.con = Astro.Constellation(clone.ra / 15, clone.dec).symbol;
      clone.contextIds = o.contextIds.map((x) => rename(x, c));
      if (clone.kind === 'dso' && clone.poweredBy?.starIds) clone.poweredBy.starIds = clone.poweredBy.starIds.map((x) => rename(x, c));
      objects.push(clone);
    }
    for (const e of FIXTURE_KB.edges) edges.push({ ...e, from: rename(e.from, c), to: rename(e.to, c), factRefs: e.factRefs?.map((r) => ({ ...r, objectId: rename(r.objectId, c) })) });
    for (const x of FIXTURE_KB.contexts) contexts.push({ ...x, id: rename(x.id, c), parentId: x.parentId ? rename(x.parentId, c) : undefined, memberIds: x.memberIds.map((m) => rename(m, c)) });
  }
  // Test-only moon-friendly archetype: any bright stars and clusters, free order (exercises Moon rules on real stops).
  const templates = opts.moonFriendlyTemplate
    ? [...FIXTURE_KB.templates, {
      ...FIXTURE_KB.templates[1], id: 'TEST-moonlit', archetype: 'A12', title: 'Moonlit test', titleKeys: ['title.A2-thermometer'],
      themeTags: ['moonlit'], order: 'free' as const, swapGroups: undefined, length: [3, 6] as [number, number], defaultLength: 4,
      slots: [
        { arc: 'hook' as const, label: 'Bright star', match: { kinds: ['star' as const] }, repeat: [1, 6] as [number, number] },
        { arc: 'build' as const, label: 'Bright family', match: { dsoClasses: ['open-cluster' as const, 'ob-association' as const] }, repeat: [1, 4] as [number, number], optional: true },
      ],
      edges: ['CONTRAST', 'SAME_PHYSICS', 'SAME_FAMILY', 'SIBLING', 'LIFE_NEXT', 'LINE_OF_SIGHT', 'SCALE'] as Edge['type'][],
      progression: undefined, ingredients: {}, moonFriendly: true,
    }]
    : FIXTURE_KB.templates;
  return { ...FIXTURE_KB, version: `synthetic-${copies}${opts.moonFriendlyTemplate ? '-moon' : ''}`, objects, edges, contexts, templates };
}

/** Result without timing (for deep-equality). */
export const stripMs = (r: JourneyResult) => ({ ...r, diagnostics: { ...r.diagnostics, ms: undefined } });
