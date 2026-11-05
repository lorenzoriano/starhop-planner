/**
 * UI-development engine built on the contracts fixture (lib/journeys/__fixtures__/fixture-kb.ts).
 *
 * The fixture's own mock client returns one fixed journey. For the discovery screen (3 suggestions, "show more",
 * Shuffle, theme filter, empty state) this wrapper adds a few more journeys made only of fixture objects and
 * fixture edges, and recomputes every stop's time and altitude for the requested instant and site, so the
 * overview and field mode stay consistent with the planner's sky. It is selected in ./journey-engine.ts only.
 */
import { angularDistance, directionBetween, eqToHorizontal } from "@/lib/astronomy";
import { moonState } from "@/lib/moon";
import { FIXTURE_EDGES, FIXTURE_KB, FIXTURE_NARRATION, MOCK_EMPTY_RESULT, mockJourneyEngineClient } from "@/lib/journeys/__fixtures__/fixture-kb";
import type { ArcRole, Compass8, Journey, JourneyEngineClient, JourneyRequest, JourneyResult, JourneyStop, KbObject, KnowledgeBase, LimitingFactor } from "@/lib/journeys/types";

export const MOCK_KB: KnowledgeBase = FIXTURE_KB;
const byId = new Map(MOCK_KB.objects.map((o) => [o.id, o]));
const name = (id: string) => byId.get(id)?.names.display ?? id;

interface Plan { key: string; templateId: string; title: string; question: string; hook: string; tags: string[]; moonFriendly: boolean; starsOnly: boolean; stops: [string, string, ArcRole][]; difficulty: Journey["difficulty"]; difficultyReason: string }

const PLANS: Plan[] = [
  { key: "ui-a2-thermometer-orion", templateId: "A2-thermometer", title: "A Thermometer in the Sky", question: "Why are stars different colors, and what does that tell us?", hook: "Read the temperature of stars by their color, from ember-orange to blue-white.", tags: ["star-colours", "moonlit"], moonFriendly: true, starsOnly: true,
    stops: [["STAR-Aldebaran", "Cool giant", "hook"], ["STAR-Betelgeuse", "Color step", "build"], ["AST-OrionBelt", "Color step", "build"], ["HR1713", "Hottest star", "payoff"]], difficulty: "easy", difficultyReason: "Every stop is a bright star you can find by eye." },
  { key: "ui-a5-families-taurus", templateId: "A5-families", title: "Families and Siblings", question: "Do stars grow up in families, and what happens to the family?", hook: "Meet star families at every age, from tight-knit newborns to scattered siblings.", tags: ["clusters", "families"], moonFriendly: true, starsOnly: false,
    stops: [["M45", "Teen family", "hook"], ["AST-Hyades", "Middle age", "build"], ["M35", "Distant cousin", "twist"], ["NGC2158", "Old family", "payoff"]], difficulty: "moderate", difficultyReason: "NGC 2158 is a faint smudge beside M35." },
  { key: "ui-a1-nursery-sword", templateId: "A1-cradle-to-grave", title: "Inside a Star Nursery", question: "Where are stars being born right now?", hook: "Zoom into Orion's Sword, where stars are being born tonight, and meet their older siblings.", tags: ["nurseries", "lives-of-stars"], moonFriendly: false, starsOnly: false,
    stops: [["HR1895", "Newborn star", "hook"], ["M42", "Nursery", "build"], ["M43", "Second bubble", "build"], ["NGC1981", "Young family", "build"], ["AST-OrionBelt", "Older siblings", "payoff"], ["Cr69", "Family at the head", "coda"]], difficulty: "moderate", difficultyReason: "M43 is small; steady the binoculars." },
  { key: "ui-a6-contrasts-taurus", templateId: "A6-contrasts", title: "Same Sky, Different Stories", question: "Can two things that look alike be completely different?", hook: "Pairs that look alike but live opposite lives. Spot the difference, then learn why.", tags: ["contrasts"], moonFriendly: false, starsOnly: false,
    stops: [["STAR-Aldebaran", "Impostor", "hook"], ["AST-Hyades", "True family", "build"], ["M45", "Younger family", "build"], ["M35", "Far twin", "payoff"]], difficulty: "easy", difficultyReason: "All four stops are bright and large." },
];

function fillNarration(key: string, prev: string, next: string): string | null {
  const text = FIXTURE_NARRATION.variants[key]?.[0];
  if (!text) return null;
  const out = text.replaceAll("{prev}", prev).replaceAll("{next}", next);
  return /\{\w+\}/.test(out) ? null : out;
}

function link(from: string, to: string) {
  const edge = FIXTURE_EDGES.find((x) => (x.from === from && x.to === to) || (x.directed === false && x.from === to && x.to === from));
  return edge ? { from, type: edge.type, subtype: edge.subtype, strength: edge.strength, reasonKey: edge.reasonKey, curated: edge.curated } : null;
}

const compassOf = (az: number): Compass8 => (["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const)[Math.round(((az % 360) + 360) % 360 / 45) % 8];
const COMPASS_WORD: Record<Compass8, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };

/** Recompute times, altitudes and get-there legs for the request; keep curated texts from the fixture where present. */
function layout(plan: Plan, req: JourneyRequest, template?: Journey): Journey {
  const minutes = req.minutesPerStop ?? 8;
  const start = Date.parse(req.instant);
  const fov = req.instrument.fovDeg;
  const stops: JourneyStop[] = plan.stops.map(([id, role, arc], index) => {
    const o = byId.get(id) as KbObject;
    const at = new Date(start + index * minutes * 60_000);
    const { alt, az } = eqToHorizontal(o.ra, o.dec, req.lat, req.lon, at);
    const prev = index ? (byId.get(plan.stops[index - 1][0]) as KbObject) : null;
    const distanceDeg = prev ? angularDistance(prev.ra, prev.dec, o.ra, o.dec) : 0;
    const fields = distanceDeg / fov;
    const mode = !prev ? "naked-eye-hop" : fields <= 0.8 ? "same-field" : fields <= 4 ? "sweep" : "naked-eye-hop";
    const dir = prev ? directionBetween(prev.ra, prev.dec, o.ra, o.dec) : "";
    const fixed = template?.stops.find((s) => s.objectId === id && s.index === index);
    const bearingText = fixed?.getThere.bearingText ?? (!prev
      ? `Start by eye: ${o.names.display} is ${Math.round(alt)}° up in the ${COMPASS_WORD[compassOf(az)]}.`
      : mode === "same-field" ? `Stay put: ${o.names.display} is in the same view as ${prev.names.display}, toward the ${dir}.`
      : mode === "sweep" ? `Sweep about ${Math.max(1, Math.round(fields * 2) / 2)} binocular fields ${dir} from ${prev.names.display}.`
      : `Lower your binoculars, find ${o.names.display} by eye ${Math.round(distanceDeg)}° ${dir} of ${prev.names.display}, then raise them.`);
    const lk = prev ? link(prev.id, id) : null;
    const transitionText = !prev ? null : fixed?.transitionText ?? (lk ? fillNarration(lk.reasonKey, prev.names.display, o.names.display) : null) ?? prev.card.connect;
    return {
      index, objectId: id, role, arc, link: lk, challenge: o.obsDifficulty >= 4,
      windowStart: at.toISOString(), windowEnd: new Date(at.getTime() + minutes * 60_000).toISOString(),
      altAtStart: Math.round(alt * 10) / 10, azAtStart: Math.round(az * 10) / 10, moonSepDeg: null,
      transitionText,
      getThere: { mode, fields: Math.round(fields * 100) / 100, distanceDeg: Math.round(distanceDeg * 100) / 100, bearingText, ...(fixed?.getThere.anchorId ? { anchorId: fixed.getThere.anchorId } : {}) },
    };
  });
  const totalPathDeg = stops.reduce((sum, s) => sum + s.getThere.distanceDeg, 0);
  const meanAz = stops.reduce((sum, s) => sum + s.azAtStart, 0) / stops.length, meanAlt = stops.reduce((sum, s) => sum + s.altAtStart, 0) / stops.length;
  const label = `${meanAlt >= 50 ? "High" : meanAlt >= 30 ? "Midway up" : "Low"} in the ${COMPASS_WORD[compassOf(meanAz)]}`;
  const ras = plan.stops.map(([id]) => byId.get(id)!);
  return {
    key: plan.key, templateId: plan.templateId, title: template?.title ?? plan.title, drivingQuestion: plan.question, hook: plan.hook, stops,
    regionCenter: { ra: ras.reduce((s, o) => s + o.ra, 0) / ras.length, dec: ras.reduce((s, o) => s + o.dec, 0) / ras.length, altDeg: Math.round(meanAlt * 10) / 10, azDeg: Math.round(meanAz * 10) / 10, label },
    regionRadius: req.regionRadius ?? 30, totalPathDeg: Math.round(totalPathDeg * 10) / 10, durationMin: stops.length * minutes,
    difficulty: template?.difficulty ?? plan.difficulty, difficultyReason: template?.difficultyReason ?? plan.difficultyReason, score: 0.8 - PLANS.indexOf(plan) * 0.05,
    bestWindow: { start: stops[0].windowStart, end: new Date(start + 3 * 3_600_000).toISOString() },
  };
}

function fixturePlan(j: Journey): Plan {
  return { key: j.key, templateId: j.templateId, title: j.title, question: j.drivingQuestion, hook: j.hook, tags: ["lives-of-stars", "nurseries", "star-corpses"], moonFriendly: false, starsOnly: false, stops: j.stops.map((s) => [s.objectId, s.role, s.arc]), difficulty: j.difficulty, difficultyReason: j.difficultyReason ?? "" };
}

export const uiMockJourneyClient: JourneyEngineClient = {
  async generate(req: JourneyRequest): Promise<JourneyResult> {
    const base = await mockJourneyEngineClient.generate(req);
    const fixture = base.journeys[0];
    const plans = [fixturePlan(fixture), ...PLANS];
    const at = new Date(req.instant);
    const moon = moonState(req.lat, req.lon, at);
    const factors: LimitingFactor[] = [];
    const brightMoon = moon.alt > 0 && moon.illumination >= 0.6;
    const twilight = moon.sunAlt > -18;
    if (brightMoon) factors.push("moon");
    if (twilight) factors.push("twilight");
    const open = req.openDirections?.length ? new Set(req.openDirections) : null;
    if (open && !(["E", "SE", "S"] as const).some((d) => open.has(d))) {
      return { ...structuredClone(MOCK_EMPTY_RESULT), diagnostics: { reasonsRejected: { direction: 14 }, limitingFactors: ["region"], message: "Every fixture journey sits in the south-east; none fits the open sky you chose." } };
    }
    const minAlt = req.minAlt ?? 30;
    let pool = plans
      .filter((p) => (!brightMoon || p.moonFriendly) && (!twilight || p.starsOnly || moon.sunAlt <= -12))
      .map((p) => layout(p, req, p.key === fixture.key ? fixture : undefined))
      .filter((j) => j.stops.every((s) => s.altAtStart >= Math.min(minAlt, 25) - 5));
    if (req.theme) {
      const themed = pool.filter((j) => j.templateId === req.theme || plans.find((p) => p.key === j.key)?.tags.includes(req.theme!));
      if (themed.length) pool = themed;
    }
    if (!pool.length) {
      const sun = moon.sunAlt > -6;
      return { journeys: [], diagnostics: { reasonsRejected: { altitude: 6, ...(brightMoon ? { "moon-glow": 9 } : {}), ...(twilight ? { twilight: 7 } : {}) }, limitingFactors: factors.length ? factors : ["altitude"],
        message: sun ? "It is still light here, so no journey fits this moment." : brightMoon ? `The Moon is ${Math.round(moon.illumination * 100)}% lit and up; the fixture journeys need a darker sky.` : "The fixture objects are below the minimum altitude at this time." } };
    }
    const k = (req.shuffle ?? 0) % pool.length;
    const ordered = [...pool.slice(k), ...pool.slice(0, k)];
    return {
      journeys: ordered.slice(0, req.limit ?? 3),
      seedKey: `ui-mock|${req.instant}|${req.shuffle ?? 0}`,
      kbVersion: MOCK_KB.version,
      modelVersion: "heuristic-fixture",
      diagnostics: {
        ...base.diagnostics,
        limitingFactors: factors,
        message: brightMoon ? `The Moon is ${Math.round(moon.illumination * 100)}% lit: showing journeys built from stars, doubles and bright clusters.` : twilight ? "Twilight: bright stars only until the sky is fully dark." : moon.alt > 0 ? "Fixture journeys (UI mock engine): the Moon is up but faint enough for every journey." : base.diagnostics.message,
        candidates: MOCK_KB.objects.length, validated: pool.length,
      },
    };
  },
};
