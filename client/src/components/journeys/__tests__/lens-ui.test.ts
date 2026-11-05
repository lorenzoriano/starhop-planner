/**
 * Owner feedback round 2 UI: theme lens on the card, the storyline spine, collapsed stop cards, and a payoff with no
 * label. The lens fixture below stands in for script/journeys/curated/lenses/*.json until real content reaches the KB.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import type { Journey, KbObject, KnowledgeBase, ThemeLens, ThemeLensSet } from "@/lib/journeys/types";
import { StopCard, galleryImages } from "../StopCard";
import { StorySpine } from "../StorySpine";
import { GlossaryProvider } from "../Glossary";
import { JourneyOverview } from "../JourneyOverview";
import { JourneyDone } from "../JourneyDone";
import type { JourneysShared } from "../JourneysPage";
import { chapterOf, doneHeadline, indexObjects, journeySpine, seenCountLine, shortMapLabel, spineBeatOf, stopBeatLabel, stopRoleLine, storylineFor } from "../journey-view";
import { emptyFeedbackStore, emptyJourneyStore } from "@/lib/journeys/progress";
import { NOOP_ACTIONS } from "@/lib/object-links";

// The star chart measures text with a canvas; the overview test only needs the story column.
vi.mock("@/components/SkyChart", () => ({ SkyChart: () => null }));

const base = MOCK_JOURNEY_RESULT.journeys[0];
const objects = indexObjects(FIXTURE_KB);

/** A1 cradle-to-grave told through a lens: nursery → newborn family (2 stops) → aging giant → death. */
const LENSES: ThemeLens[] = [
  { step: 1, beat: "Stellar nursery", question: "Where in Orion are stars being born right now?", why: "Every life story needs a cradle, and this cloud is where Orion's next stars are still assembling.", look: "A soft gray-green glow around a tight knot of stars: the glow is gas lit by the newborns inside it.", answer: "Inside this cloud: its brightest stars are a few hundred thousand years old, and they light the gas that made them." },
  { step: 2, beat: "Newborn family", question: "What happens to a star family once its cloud is gone?", why: "Step two of the life story: the same kind of birth, a few million years later.", answer: "They drift apart; a family like this one holds together for a few hundred million years at most." },
  { step: 2, beat: "Newborn family", question: "How can a family of stars look young and old at once?", why: "A second newborn family shows the next part of the thread.", answer: "Its heaviest members have already aged; mass sets the pace." },
  { step: 4, beat: "Aging giant", question: "What does a heavy star become near its end?", why: "The family members grow old at different speeds; here is one that ran fastest.", look: "A deep orange point, clearly warmer in color than the white stars of the Belt.", answer: "A red supergiant: a core running out of fuel, wrapped in an envelope wider than Mars's orbit." },
  { step: 5, beat: "Death", question: "What is left when a star explodes?", why: "The last chapter: a giant like the one before, nine hundred years after it died.", answer: "An expanding cloud of debris, still glowing, seeded with the elements the star made." },
];
const lensed: Journey = { ...base, payoff: "From a cloud that is still making stars to the wreck of one that died, the whole life of a heavy star fits in one patch of winter sky.", stops: base.stops.map((s, i) => ({ ...s, lens: LENSES[i] })) };
const A1_SET: ThemeLensSet = {
  archetype: "A1", storyline: "Nursery to grave.", minBeats: 3,
  beats: [{ step: 1, label: "The nursery" }, { step: 2, label: "A newborn family", maxStops: 2 }, { step: 3, label: "A grown family" }, { step: 4, label: "An aging giant" }, { step: 5, label: "The death" }],
  objects: {},
};
const KB_WITH_LENSES: KnowledgeBase = { ...FIXTURE_KB, lenses: [A1_SET] };
const GLOSSARY = [{ id: "nebula", term: "nebula", aliases: ["nebulae"], short: "A cloud of gas and dust in space." }];

function renderStop(journey: Journey, index: number, extra: Record<string, unknown> = {}, kb: KnowledgeBase = FIXTURE_KB) {
  const stop = journey.stops[index];
  const object = objects.get(stop.objectId)!;
  return renderToStaticMarkup(createElement(GlossaryProvider, { entries: GLOSSARY },
    createElement(StopCard, { object, stop, journey, kb, mode: "read", fovDeg: 6.5, transition: null, ...extra })));
}
const between = (html: string, from: string, to: string) => { const a = html.indexOf(from); return html.slice(a, html.indexOf(to, a + from.length)); };
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("theme lens on the stop card", () => {
  it("shows the lens beat as the chip and the lens question as the card question", () => {
    const html = renderStop(lensed, 3);
    expect(strip(between(html, 'data-testid="journey-stop-beat"', "</span>"))).toContain("Aging giant");
    expect(strip(between(html, 'data-testid="journey-stop-question"', "</section>"))).toContain("What does a heavy star become near its end?");
    expect(html).toContain('data-lens="theme"');
  });

  it("puts lens.why, after the transition, in a 'Why it’s in this journey' box", () => {
    const html = renderStop(lensed, 3, { transition: { heading: "From the Belt", text: "The Belt stars are young; this one is not." } });
    const box = between(html, 'data-section="way"', "</section>");
    expect(box).toContain("Why it’s in this journey");
    expect(box).not.toContain("On the way");
    const text = strip(box);
    expect(text.indexOf("this one is not")).toBeGreaterThan(-1);
    expect(text.indexOf("this one is not")).toBeLessThan(text.indexOf("ran fastest"));
  });

  it("uses lens.look in What you’ll see and lens.answer in the answer box", () => {
    const html = renderStop(lensed, 3);
    expect(strip(between(html, 'data-section="see"', "</section>"))).toContain("clearly warmer in color than the white stars of the Belt");
    const answer = strip(between(html, 'data-testid="journey-stop-answer"', "</section>"));
    expect(answer).toContain("wider than Mars's orbit");
  });

  it("falls back to the card's own see text when the lens has no look", () => {
    const stop = lensed.stops[1];
    const o = objects.get(stop.objectId)!;
    const html = renderStop(lensed, 1);
    expect(strip(between(html, 'data-section="see"', "</section>"))).toContain(strip(o.card.see).slice(0, 40));
  });

  it("without a lens: today's role chip, card question and the 'On the way' box", () => {
    const html = renderStop(base, 3);
    expect(html).toContain(`data-testid="journey-stop-beat">${base.stops[3].role}<`);
    expect(html).toContain("On the way");
    expect(html).not.toContain("Why it’s in this journey");
    expect(html).not.toContain('data-lens="theme"');
  });

  it("embedded in an overview item: no duplicate title, beat line, kind or altitude; the subtitle says where to look", () => {
    const html = renderStop(lensed, 3, { embedded: true });
    expect(html).not.toContain('class="jstop-title"');
    expect(html).not.toContain('data-testid="journey-stop-beat"');
    expect(html).toContain('data-testid="journey-stop-description"');
    expect(html).toContain("jstop-embedded");
    const subtitle = strip(between(html, 'data-testid="journey-stop-description"', "</p>"));
    expect(subtitle).toMatch(/In .+ · toward the /);
    expect(subtitle).not.toMatch(/° up/);
    expect(subtitle).not.toMatch(/supergiant/);
    // the grouped stop list carries the thread; no dot spine inside the opened card
    expect(html).not.toContain('data-testid="journey-spine"');
  });

  it("a story box always shows: a lens without its own story falls back to the shared card's story, once (r5, voice.md rule 2)", () => {
    const o = objects.get(lensed.stops[3].objectId)!;
    const html = renderStop(lensed, 3);
    const fallback = between(html, 'data-section="understand"', "</section>");
    expect(strip(fallback)).toContain(strip(o.card.understand).slice(0, 30));
    // and it does not repeat under More
    expect(strip(between(html, 'data-testid="journey-stop-more"', "</details>"))).not.toContain(strip(o.card.understand).slice(0, 30));
    // a lens with its own story (mechanism, how we know, for THIS theme) fills the Story box
    const withStory = { ...lensed, stops: lensed.stops.map((st, i) => (i === 3 ? { ...st, lens: { ...st.lens!, story: "Its core has run through its hydrogen, so it now burns helium in a shell and swells." } } : st)) };
    const story = between(renderStop(withStory, 3), 'data-section="understand"', "</section>");
    expect(strip(story)).toContain("burns helium in a shell");
  });

  it("round 3 contract: lens.story fills the Story box; the object's general story sits under More about {name}", () => {
    const o = objects.get(lensed.stops[3].objectId)!;
    const lensStory = "Its core has run through its hydrogen, so it now burns helium in a shell and swells.";
    const withStory = { ...lensed, stops: lensed.stops.map((st, i) => (i === 3 ? { ...st, lens: { ...st.lens!, story: lensStory } } : st)) };
    const html = renderStop(withStory, 3);
    const story = between(html, 'data-section="understand"', "</section>");
    expect(strip(story)).toContain(lensStory);
    expect(strip(story)).not.toContain(strip(o.card.understand).slice(0, 30));
    const aside = between(html, 'data-testid="journey-stop-aside"', "</section>");
    expect(aside).toContain(`More about ${o.names.display}`);
    expect(strip(aside)).toContain(strip(o.card.understand).slice(0, 30));
    // the Story box sits between what to look at and the answer; More (collapsed) comes after
    expect(html.indexOf('data-section="understand"')).toBeLessThan(html.indexOf('data-testid="journey-stop-more"'));
    // a stop without a lens keeps the object's own story in the Story box and has no aside
    const bare = { ...lensed, stops: lensed.stops.map((st, i) => (i === 3 ? { ...st, lens: undefined } : st)) };
    const plainHtml = renderStop(bare, 3);
    expect(strip(between(plainHtml, 'data-section="understand"', "</section>"))).toContain(strip(o.card.understand).slice(0, 30));
    expect(plainHtml).not.toContain('data-testid="journey-stop-aside"');
  });

  it("why it is in this journey is an unboxed lead straight under the question", () => {
    const html = renderStop(lensed, 3);
    expect(html).toMatch(/<section class="jstop-why" data-section="way"/);
    expect(html.indexOf('data-section="way"')).toBeGreaterThan(html.indexOf('data-testid="journey-stop-question"'));
    expect(html.indexOf('data-section="way"')).toBeLessThan(html.indexOf('data-testid="journey-stop-hero"'));
  });
});

describe("the payoff carries no label", () => {
  it("closes the payoff stop with the payoff text alone", () => {
    const html = renderStop(lensed, 3);
    const payoff = between(html, 'data-testid="journey-stop-payoff"', "</section>");
    expect(strip(payoff)).toContain("whole life of a heavy star");
    for (const label of ["Where it lands", "where it lands", "Tonight’s answer", "The answer you saw"]) expect(html).not.toContain(label);
    expect(payoff).not.toMatch(/jbox-head|<h3/);
  });

  it("puts the conclusion right after the done headline, without a label", () => {
    const html = renderToStaticMarkup(createElement(JourneyDone, { shared: sharedFor(lensed), journey: lensed }));
    expect(html).toContain('data-testid="journey-payoff"');
    expect(html.indexOf('data-testid="journey-payoff"')).toBeLessThan(html.indexOf("journey-recap"));
    for (const label of ["Where it lands", "The answer you saw", "The question:"]) expect(html).not.toContain(label);
    // the question sits in the gold question box right above its answer
    expect(html.indexOf('data-testid="journey-done-question"')).toBeLessThan(html.indexOf('data-testid="journey-payoff"'));
    expect(html).not.toContain("travelled");
  });

  it("the last card in the field does not show the payoff the done screen shows right after Finish", () => {
    expect(renderStop(lensed, 3, { mode: "field" })).not.toContain('data-testid="journey-stop-payoff"');
    expect(renderStop(lensed, 3)).toContain('data-testid="journey-stop-payoff"');
  });
});

describe("storyline spine", () => {
  it("groups consecutive stops on one lens step into one beat", () => {
    const spine = journeySpine(lensed);
    expect(spine.map((b) => [b.label, b.stops])).toEqual([["Stellar nursery", [0]], ["Newborn family", [1, 2]], ["Aging giant", [3]], ["Death", [4]]]);
    expect(spineBeatOf(spine, 2)).toBe(1);
  });

  it("names beats from the theme storyline when the KB carries it", () => {
    expect(storylineFor(KB_WITH_LENSES, "A1-cradle-to-grave")?.archetype).toBe("A1");
    expect(storylineFor(KB_WITH_LENSES, "A10-stars-that-change")).toBeNull();
    expect(journeySpine(lensed, KB_WITH_LENSES).map((b) => b.label)).toEqual(["The nursery", "A newborn family", "An aging giant", "The death"]);
  });

  it("without lenses, groups consecutive identical roles", () => {
    expect(journeySpine(base).map((b) => b.label)).toEqual(["Nursery", "Young family", "Doomed giant", "Shattered star"]);
    expect(stopBeatLabel(base.stops[0])).toBe("Nursery");
  });

  it("compact without dots (field mode): only what comes next in the story", () => {
    const html = renderToStaticMarkup(createElement(StorySpine, { beats: journeySpine(lensed), current: 1, variant: "compact", totalStops: 5, dots: false }));
    expect(html).not.toContain("jspine-dot");
    expect(strip(html)).toBe("Next in the story: Aging giant");
    const last = renderToStaticMarkup(createElement(StorySpine, { beats: journeySpine(lensed), current: 4, variant: "compact", totalStops: 5, dots: false }));
    expect(strip(last)).toBe("The last chapter of the story");
  });

  it("compact: one dot per stop, the current one marked, and what comes next", () => {
    const html = renderToStaticMarkup(createElement(StorySpine, { beats: journeySpine(lensed), current: 1, variant: "compact", totalStops: 5 }));
    expect(html.match(/jspine-dot/g)?.length).toBe(5);
    expect(html.match(/dot-current/g)?.length).toBe(1);
    expect(html.match(/dot-past/g)?.length).toBe(1);
    expect(strip(html)).toContain("Stop 2 of 5");
    expect(strip(html)).toContain("next: Aging giant");
  });

  it("full: every beat named in order, the current one marked as the step", () => {
    const html = renderToStaticMarkup(createElement(StorySpine, { beats: journeySpine(lensed), current: 3, variant: "full" }));
    const labels = Array.from(html.matchAll(/class="jspine-label">([^<]+)</g), (m) => m[1]);
    expect(labels).toEqual(["Stellar nursery", "Newborn family", "Aging giant", "Death"]);
    expect(html).toMatch(/beat-current" aria-current="step"><span[^>]*>4</);
  });

  it("is on every stop card", () => {
    expect(renderStop(lensed, 0)).toContain('data-testid="journey-spine"');
  });
});

describe("overview: stop cards start collapsed", () => {
  it("renders every stop as a closed toggle, with no instruction text and no Read mode", () => {
    const html = renderToStaticMarkup(createElement(JourneyOverview, { shared: sharedFor(lensed), journey: lensed }));
    const toggles = html.match(/data-testid="journey-stop-toggle"/g) ?? [];
    expect(toggles.length).toBe(lensed.stops.length);
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(lensed.stops.length);
    expect(html).not.toContain('data-testid="journey-stop-card"');
    for (const text of [/tap to open/i, /click to open/i, /Read mode/, /open (the|a) card/i]) expect(html).not.toMatch(text);
    // the collapsed card shows the lens beat and the lens question as its hook
    expect(html).toContain("Aging giant");
    expect(html).toContain("What does a heavy star become near its end?");
    expect(html).toContain('data-testid="journey-spine"');
  });

  it("groups the stops under the storyline's beats, in the spine's own words", () => {
    const shared = { ...sharedFor(lensed), kb: KB_WITH_LENSES };
    const html = renderToStaticMarkup(createElement(JourneyOverview, { shared, journey: lensed }));
    const heads = Array.from(html.matchAll(/data-testid="journey-stop-group">([^<]+)</g), (m) => m[1]);
    expect(heads).toEqual(["The nursery", "A newborn family", "An aging giant", "The death"]);
    const spineLabels = Array.from(html.matchAll(/class="jspine-label">([^<]+)</g), (m) => m[1]);
    expect(spineLabels).toEqual(heads);
    // both newborn-family stops sit in one group
    const group = between(html, ">A newborn family</h3>", "</section>");
    expect(group.match(/data-testid="journey-stop-toggle"/g)?.length).toBe(2);
    // a full question is the reason to tap: no line clamp marker, the whole lens question is present
    expect(html).toContain("What happens to a star family once its cloud is gone?");
  });

  it("ends an open card with a pull to the next stop, led by its question", () => {
    const html = renderToStaticMarkup(createElement(JourneyOverview, { shared: sharedFor(lensed), journey: lensed, initialOpen: 0 }));
    expect(html.match(/data-testid="journey-stop-card"/g)?.length).toBe(1);
    const next = strip(between(html, 'data-testid="journey-stop-next"', "</button>"));
    expect(next).toContain(`Next: 2 · ${objects.get(lensed.stops[1].objectId)!.names.display}`);
    expect(next).toContain("What happens to a star family once its cloud is gone?");
    // the last stop has no Next button
    const lastOpen = renderToStaticMarkup(createElement(JourneyOverview, { shared: sharedFor(lensed), journey: lensed, initialOpen: 4 }));
    expect(lastOpen).not.toContain('data-testid="journey-stop-next"');
  });

  it("without a lens storyline the stops stay one flat list", () => {
    const html = renderToStaticMarkup(createElement(JourneyOverview, { shared: sharedFor(base), journey: base }));
    expect(html).not.toContain('data-testid="journey-stop-group"');
    expect(html.match(/data-testid="journey-stop-toggle"/g)?.length).toBe(base.stops.length);
  });
});

describe("done screen: a headline in the story's own terms", () => {
  const seenAll = (j: Journey) => j.stops.map((_, i) => i);
  it("keeps the distance stat for How far? only", () => {
    const a3 = { ...lensed, templateId: "A3-how-far" };
    const h = doneHeadline(a3, seenAll(a3), objects);
    expect(h.headline).toMatch(/^You saw light that traveled [\d,.]+ (million )?light[-\u2011]years$/);
    expect(h.detail).toMatch(/^the farthest was /);
    for (const t of ["A1-cradle-to-grave", "A6-contrasts", "A7-record-breakers", "A9-seeing-double"]) {
      const other = doneHeadline({ ...lensed, templateId: t }, seenAll(lensed), objects);
      expect(other.headline, t).not.toMatch(/light[-\u2011]years|farthest/);
      expect(other.detail, t).toBeNull();
    }
  });
  it("speaks each theme's language", () => {
    expect(doneHeadline(lensed, seenAll(lensed), objects).headline).toBe("A star's life, told in four chapters");
    expect(doneHeadline({ ...lensed, templateId: "A9-seeing-double" }, [0, 1], objects).headline).toMatch(/^You split two (pairs|points of light) tonight$/);
    const stars = { ...base, templateId: "A2-thermometer", stops: base.stops.filter((s) => objects.get(s.objectId)?.kind === "star") };
    const a2 = doneHeadline(stars, seenAll(stars), objects).headline;
    expect(a2).toMatch(/K|thermometer/);
    for (const t of ["A1-cradle-to-grave", "A2-thermometer", "A5-families", "A6-contrasts", "A7-record-breakers", "A8-how-stars-die", "A9-seeing-double", "A11-inside-our-galaxy", "A12-moonlit"]) {
      const h = doneHeadline({ ...lensed, templateId: t }, [0], objects).headline;
      expect(h, t).not.toMatch(/!|\bone (pairs|records|stops|sights|landmarks|look-alikes|points|families|chapters)\b/);
      // Design review r4: a full clause with a capital first, never a lowercase number word.
      expect(h[0], t).toMatch(/[A-Z]/);
    }
    expect(doneHeadline(lensed, [], objects).headline).toBe("Journey's end");
  });
  it("lets the narration bank override it (done.<templateId>)", () => {
    const kb = { ...FIXTURE_KB, narration: { ...FIXTURE_KB.narration, variants: { ...FIXTURE_KB.narration.variants, "done.A1-cradle-to-grave": ["Birth to death in {n} stops"] } } };
    expect(doneHeadline(lensed, seenAll(lensed), objects, kb).headline).toBe("Birth to death in 5 stops");
  });
});

describe("map labels", () => {
  it("shortens a parenthesised nickname for the map label", () => {
    expect(shortMapLabel("Stock 2 (Muscleman Cluster)")).toBe("Stock 2");
    expect(shortMapLabel("Algol")).toBe("Algol");
  });
});

function sharedFor(journey: Journey): JourneysShared {
  const page = {
    location: `/journeys/${journey.key}`, navigate: () => {}, lat: 37.77, lon: -122.42, date: new Date("2027-01-15T04:30:00Z"), timezone: "America/Los_Angeles",
    live: true, locationName: "San Francisco", skyBrightness: 21, profile: { fov: 6.5, aperture: 50, magnification: 10 } as JourneysShared["page"]["profile"],
    stars: [], targets: [], constellations: [], denseStars: [], milkyWay: [], catalogsLoading: false,
    moon: { alt: -10, az: 0, ra: 0, dec: 0, illumination: 0.2 } as unknown as JourneysShared["page"]["moon"], sunAlt: -30, offlineLabel: "Online",
    redLight: false, onRedLight: () => {}, onTime: () => {}, onLive: () => {}, onMoonTab: () => {}, onEditSetup: () => {},
  } as JourneysShared["page"];
  const store = { ...emptyJourneyStore(), active: { key: journey.key, journey, startedAt: 0, stopIndex: 4, phase: "look", outcomes: journey.stops.map(() => ({ outcome: "seen" })), completedAt: 1 } } as unknown as JourneysShared["store"];
  return {
    page, kb: FIXTURE_KB, objects: objects as ReadonlyMap<string, KbObject> as JourneysShared["objects"], skyNodes: [], stopNodes: () => [], moonRing: null, minAlt: 30,
    go: () => {}, store, updateStore: () => {}, feedback: emptyFeedbackStore(), updateFeedback: () => {}, actions: NOOP_ACTIONS, catalog: { targets: [], stars: [] }, resolve: () => null, hopLeg: () => null, startJourney: () => {},
  };
}

describe("design review r4: one gold label, the chapter; the role only when it adds", () => {
  it("chapterOf names the storyline beat of a stop (Chapter n of N)", () => {
    const spine = journeySpine(lensed, KB_WITH_LENSES);
    expect(chapterOf(spine, 2)).toEqual({ n: 2, total: 4, label: "A newborn family" });
    expect(chapterOf(spine, 9)).toBeNull();
  });
  it("stopRoleLine hides a role that paraphrases its chapter and keeps one that adds", () => {
    expect(stopRoleLine({ role: "x", lens: { ...LENSES[0], beat: "Measured by its yearly shift" } }, "A near star's yearly shift")).toBeNull();
    expect(stopRoleLine({ role: "x", lens: { ...LENSES[0], beat: "Hundreds of shifts averaged" } }, "A near cluster as template")).toBe("Hundreds of shifts averaged");
    expect(stopRoleLine({ role: "x", lens: LENSES[0] }, null)).toBeNull();
  });
  it("the field card names its chapter and leaves 'Next in the story' to after 'I see it'", () => {
    const html = renderStop(lensed, 3, { mode: "field" }, KB_WITH_LENSES);
    expect(strip(between(html, 'data-testid="journey-stop-beat"', "</span>"))).toContain("Chapter 3 of 4 · An aging giant");
    expect(html).not.toContain("Next in the story");
  });
  it("a lens card ends on its answer: the wonder sits under More, after the shared story", () => {
    const html = renderStop(lensed, 3);
    const o = objects.get(lensed.stops[3].objectId)!;
    if (!o.card.wonder) return;
    const more = html.slice(html.indexOf('data-testid="journey-stop-more"'));
    const before = html.slice(0, html.indexOf('data-testid="journey-stop-more"'));
    expect(before).not.toContain('class="jstop-coda"');
    expect(strip(more)).toContain(strip(o.card.wonder).slice(0, 30));
  });
});

describe("design review r4: done screen counts and pictures", () => {
  it("seenCountLine speaks in words, like the headline", () => {
    expect(seenCountLine(5, 5)).toBe("all five stops seen");
    expect(seenCountLine(3, 5)).toBe("three of five stops seen");
    expect(seenCountLine(2, 2)).toBe("both stops seen");
  });
  it("a star's nebula close-up never leads when a survey field exists", () => {
    const star = FIXTURE_KB.objects.find((o) => o.kind === "star")!;
    const o = { ...star, media: { ...star.media, images: [
      { src: "photos/crescent.jpg", caption: "Hubble's close-up of the gas around the star, a nebula it blew.", credit: "NASA", license: "PD", variant: "photo" },
      { src: "fields/star.jpg", caption: "Survey photo of the binocular field around it.", credit: "DSS", license: "survey", variant: "optical", fieldDeg: 4 },
    ] } } as unknown as KbObject;
    expect(galleryImages(o)[0].src).toContain("fields/star.jpg");
  });
});

describe("withArticle (done-screen detail line)", () => {
  it("adds 'the' to galaxy, nebula and cluster names but not to stars or catalog names", async () => {
    const { withArticle } = await import("../journey-view");
    expect(withArticle("Andromeda Galaxy")).toBe("the Andromeda Galaxy");
    expect(withArticle("Owl Cluster (ET Cluster)")).toBe("the Owl Cluster (ET Cluster)");
    expect(withArticle("Deneb")).toBe("Deneb");
    expect(withArticle("M31")).toBe("M31");
    expect(withArticle("The Pleiades Cluster")).toBe("The Pleiades Cluster");
  });
});
