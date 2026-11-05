import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_KB, MOCK_JOURNEY_RESULT } from "@/lib/journeys/__fixtures__/fixture-kb";
import type { KbImage, KbObject, StarObject } from "@/lib/journeys/types";
import { StopCard, choosePhoto, galleryImages } from "../StopCard";
import { journeyStats, storyProse } from "../journey-view";
import { GlossaryProvider } from "../Glossary";
import { catalogDetails, findGlossaryTerms, plainClass, type GlossaryEntry } from "../plain-language-adapter";

const journey = MOCK_JOURNEY_RESULT.journeys[0];
const byId = new Map(FIXTURE_KB.objects.map((o) => [o.id, o]));
const obj = (id: string) => byId.get(id)!;
const GLOSSARY: GlossaryEntry[] = [
  { id: "supergiant", term: "supergiant", aliases: ["supergiants"], short: "One of the largest, most luminous kinds of star." },
  { id: "open-cluster", term: "open cluster", aliases: [], short: "A loose family of stars born together from one cloud." },
  { id: "nebula", term: "nebula", aliases: ["nebulae"], short: "A cloud of gas and dust in space." },
  { id: "light-year", term: "light-year", aliases: ["light-years"], short: "The distance light travels in a year." },
];

function renderCard(object: KbObject, stopIndex: number, mode: "read" | "field" = "read", glossary: GlossaryEntry[] = GLOSSARY) {
  const stop = { ...journey.stops[stopIndex], objectId: object.id };
  return renderToStaticMarkup(createElement(GlossaryProvider, { entries: glossary },
    createElement(StopCard, { object, stop, journey, kb: FIXTURE_KB, mode, fovDeg: 6.5, transition: null })));
}

/** Text content order of the box sections, by their data-section attribute. */
const sectionOrder = (html: string) => Array.from(html.matchAll(/data-section="([a-z]+)"/g), (m) => m[1]);

describe("plain-language description (owner feedback r1)", () => {
  it("says what a star is in words, never as a spectral class", () => {
    expect(plainClass(obj("STAR-Betelgeuse"))).toMatch(/^red supergiant/);
    expect(plainClass(obj("STAR-Aldebaran"))).toMatch(/^orange giant/);
    expect(plainClass(obj("HR1713"))).toBe("blue-white supergiant");
    for (const o of FIXTURE_KB.objects) expect(plainClass(o)).not.toMatch(/\b[OBAFGKM]\d|\bI{1,3}V?\b|Ia|Iab/);
  });

  it("names both stars of a pair, as the owner asked (θ Tauri: white giant + orange giant)", () => {
    const pair = { ...obj("STAR-Aldebaran"), spectral: { text: "A7 III (θ²) + G9 III (θ¹)", class: "A", lumClass: "III", sourceId: "simbad" }, multiplicity: { components: [{ label: "A", spType: "A7 III (θ²)" }, { label: "B", spType: "K0 IIIb (θ¹)" }], pairs: [] } } as StarObject;
    expect(plainClass(pair)).toBe("white giant + orange giant");
  });

  it("names deep-sky classes plainly", () => {
    expect(plainClass(obj("M45"))).toMatch(/open cluster$/);
    expect(plainClass(obj("M42"))).toMatch(/^glowing gas cloud/);
  });

  it("keeps raw designations and classes for the Catalog details drawer", () => {
    const rows = catalogDetails(obj("STAR-Betelgeuse"));
    expect(rows.find((r) => r.label === "Spectral class")?.value).toBe("M1-M2 Ia-Iab");
  });
});

describe("glossary matching", () => {
  it("finds the first occurrence of each term: whole words, plurals, case-insensitive", () => {
    const text = "Open clusters drift apart; a supergiant is not a giant. Supergiants and nebulae.";
    const hits = findGlossaryTerms(text, GLOSSARY).map((m) => [text.slice(m.start, m.end), m.entry.id]);
    expect(hits).toEqual([["Open clusters", "open-cluster"], ["supergiant", "supergiant"], ["nebulae", "nebula"]]);
    expect(findGlossaryTerms("a protonebula", GLOSSARY)).toEqual([]);
  });
});

describe("StopCard round 2: question, picture, a few flowing boxes, the answer last", () => {
  const betel = obj("STAR-Betelgeuse");
  const qa = {
    ...betel,
    card: { ...betel.card, question: "What does a heavy star become near the end?", answer: "A red supergiant: swollen, cool on the surface, and close to exploding.",
      wonder: "Its light set out before the printing press.", connect: "Next, a star that is only beginning." },
  } as KbObject;

  it("reads question → why (unboxed lead) → picture → get there line → see → story → answer → coda, with More folded last", () => {
    const html = renderCard(qa, 3);
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const order = [
      'data-testid="journey-stop-question"', 'data-section="way"', 'data-testid="journey-stop-hero"', 'data-section="getthere"',
      'data-section="see"', 'data-section="understand"', 'data-testid="journey-stop-answer"', 'data-testid="journey-stop-coda"', 'data-testid="journey-stop-more"',
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sectionOrder(html)).toEqual(["way", "getthere", "see", "understand", "answer"]);
    for (const label of ["On the way", "Get there", "What you’ll see", "The story", "The answer"]) expect(html).toContain(label);
    // No separate Wonder / Connect / Why here boxes any more; the old boxes are gone.
    for (const gone of ["Why here", ">Wonder<", ">Connect<", ">Understand<"]) expect(html).not.toContain(gone);
  });

  it("states the question once: the answer box does not repeat it", () => {
    const html = renderCard(qa, 3);
    expect(html.split("What does a heavy star become near the end?").length - 1).toBe(1);
  });

  it("shows wonder and connect as one quiet line, and drops a sentence that only repeats another box", () => {
    const html = renderCard(qa, 3);
    const coda = html.slice(html.indexOf('data-testid="journey-stop-coda"'), html.indexOf("</p>", html.indexOf('data-testid="journey-stop-coda"')));
    expect(coda).toContain("printing press");
    expect(coda).toContain("only beginning");
    const repeating = { ...qa, card: { ...qa.card, wonder: qa.card.understand, connect: "" } } as KbObject;
    expect(renderCard(repeating, 3)).not.toContain('data-testid="journey-stop-coda"');
  });

  it("merges the engine's transition and why-here into one paragraph led by the previous stop's name", () => {
    const stop = { ...journey.stops[3], objectId: betel.id, whyHereText: "Here the Hunter's shoulder shows what a heavy star becomes." };
    const html = renderToStaticMarkup(createElement(GlossaryProvider, { entries: GLOSSARY },
      createElement(StopCard, { object: qa, stop, journey, kb: FIXTURE_KB, mode: "read", fovDeg: 6.5, transition: { heading: "From Orion’s Belt", text: "The Belt stars are young and blue; this one is old and red." } })));
    const box = html.slice(html.indexOf('data-section="way"'), html.indexOf("</section>", html.indexOf('data-section="way"')));
    // a quiet sentence-case "From …" line above one flowing paragraph (no shouting caps prefix inside the prose)
    expect(box.match(/<p\b/g)?.length).toBe(2);
    expect(box).toMatch(/<p class="jstop-from"[^>]*>From Orion’s Belt<\/p>/);
    expect(box).not.toContain("jbox-from");
    expect(box.indexOf("old and red")).toBeLessThan(box.indexOf("Hunter"));
  });

  it("leaves out the generic skip bridge instead of printing filler", async () => {
    const { NEUTRAL_BRIDGE } = await import("../journey-view");
    const html = renderToStaticMarkup(createElement(GlossaryProvider, { entries: GLOSSARY },
      createElement(StopCard, { object: qa, stop: { ...journey.stops[3], objectId: betel.id }, journey, kb: FIXTURE_KB, mode: "read", fovDeg: 6.5, transition: { heading: "Next chapter", text: NEUTRAL_BRIDGE } })));
    expect(html).not.toContain(NEUTRAL_BRIDGE.replace("'", "&#x27;"));
    expect(html).not.toContain("Next chapter");
  });

  it("uses the glance line as the picture caption, not as a box", () => {
    const html = renderCard(obj("M42"), 0);
    const hero = html.slice(html.indexOf('data-testid="journey-stop-hero"'), html.indexOf("</figure>", html.indexOf('data-testid="journey-stop-hero"')));
    expect(hero).toContain('data-testid="journey-stop-glance"');
    expect(hero).toContain("grey-green glow");
  });

  it("folds numbers, catalog details and sources under More, closed by default", () => {
    const html = renderCard(betel, 3);
    const more = html.indexOf('data-testid="journey-stop-more"');
    expect(html.slice(more - 200, more)).toMatch(/<details class="jstop-more"\s*$/);
    expect(html.slice(more, more + 60)).not.toContain("open");
    for (const id of ["journey-stop-numbers", "journey-stop-catalog", "journey-stop-sources"]) expect(html.indexOf(`data-testid="${id}"`)).toBeGreaterThan(more);
    expect(html.indexOf("M1-M2 Ia-Iab")).toBeGreaterThan(more);
  });

  it("uses the plain description line; the spectral class lives in Catalog details", () => {
    const html = renderCard(betel, 3);
    const desc = html.slice(html.indexOf('data-testid="journey-stop-description"'), html.indexOf("</p>", html.indexOf('data-testid="journey-stop-description"')));
    expect(desc).not.toContain("M1-M2");
    expect(desc).toContain("upergiant");
    expect(html).toContain("Catalog details");
  });

  it("links a glossary term at its first appearance in the card only", () => {
    const o = { ...betel, card: { ...betel.card, understand: "A supergiant burns fast. Every supergiant does.", wonder: "No supergiant lives long." } } as KbObject;
    const html = renderCard(o, 3);
    expect(html.match(/data-glossary-id="supergiant"/g)?.length).toBe(1);
    expect(html).toMatch(/class="jgloss-term"[^>]*aria-expanded="false"/);
  });

  it("makes the picture a button that opens the gallery viewer", () => {
    const html = renderCard(obj("M42"), 0);
    expect(html).toMatch(/<button[^>]*data-testid="journey-stop-photo-toggle"[^>]*aria-haspopup="dialog"/);
    expect(html).toMatch(/aria-label="Enlarge the photograph of [^"]*\(2 pictures\)"/);
  });

  it("never leaves the picture slot empty: stars without a photo show their colour, others a naked-eye field", () => {
    const rigel = obj("HR1713");
    expect(choosePhoto(rigel)).toBeNull();
    expect(renderCard(rigel, 3)).toContain('data-testid="journey-stop-visual-fallback"');
    const cr69 = obj("Cr69");
    if (!choosePhoto(cr69)) expect(renderCard(cr69, 2)).toContain('data-testid="journey-stop-visual-fallback"');
    expect(renderCard(rigel, 3)).not.toContain("No photograph");
  });

  it("field mode: no Get there box (the field shell has its own step), the photo dimmed, the story still open", () => {
    const html = renderCard(qa, 3, "field");
    expect(html).not.toContain('data-section="getthere"');
    expect(html).toMatch(/<section class="jbox jbox-understand"/);
    expect(html).toMatch(/<section class="jbox jbox-see"/);
    expect(html).toContain("jstop-photo-dimmed");
  });

  it("planning view: Get there is one quiet line, not a box", () => {
    const html = renderCard(qa, 3);
    expect(html).toMatch(/<p class="jstop-getthere" data-section="getthere"/);
    expect(html).not.toMatch(/class="jbox jbox-getthere"/);
  });

  it("the picture credit opens the viewer instead of hiding behind a tooltip", () => {
    const html = renderCard(obj("M42"), 0);
    expect(html).toMatch(/<button type="button" class="jstop-credit"[^>]*aria-haspopup="dialog"/);
    expect(html).toContain('class="jstop-credit-more">details<');
  });

  it("More opens with the same rotating chevron as the stop rows (no '▸ show' text)", () => {
    const html = renderCard(betel, 3);
    expect(html).toContain("jstop-more-chevron");
    expect(html).not.toContain("▸ show");
  });
});

describe("pictures: a real photograph before a survey field", () => {
  const base = obj("M42");
  const img = (variant: KbImage["variant"], src: string, fieldDeg?: number): KbImage => ({ src, credit: "c", license: "l", caption: `cap ${src}`, variant, ...(fieldDeg ? { fieldDeg } : {}) });
  const withImages = (images: KbImage[]) => ({ ...base, media: { ...base.media, images } }) as KbObject;

  it("ranks photo > survey field > illustration > infrared, keeping KB order within a kind", () => {
    const g = galleryImages(withImages([img("infrared", "ir.jpg", 2), img("optical", "field.jpg", 4), img("illustration", "art.jpg"), img("photo", "hst.jpg"), img("featured", "feat.jpg")]));
    expect(g.map((x) => x.src)).toEqual(["./hst.jpg", "./feat.jpg", "./field.jpg", "./art.jpg", "./ir.jpg"]);
    expect(g.map((x) => x.kind)).toEqual(["photo", "photo", "survey", "illustration", "infrared"]);
    expect(choosePhoto(withImages([img("optical", "field.jpg", 4), img("photo", "hst.jpg")]))?.src).toBe("./hst.jpg");
  });

  it("labels each picture so the viewer knows a survey field from a photograph", () => {
    const g = galleryImages(withImages([img("optical", "field.jpg", 4), img("photo", "hst.jpg")]));
    expect(g[0].label).toBe("Photograph");
    expect(g[1].label).toBe("Sky-survey photograph");
    expect(g[0].alt).toMatch(/^Photograph of /);
  });

  it("drops duplicate pictures", () => {
    const srcs = galleryImages(withImages([img("photo", "a.jpg"), img("photo", "a.jpg")])).map((g) => g.src);
    expect(srcs.filter((x) => x === "./a.jpg")).toHaveLength(1);
    expect(new Set(srcs).size).toBe(srcs.length);
  });
});

describe("overview text (round 2)", () => {
  const j = { ...journey, hook: "Which star is nearest? Looks will mislead you.", story: "Which star is nearest? Looks will mislead you. In about 40 minutes you visit 5 stops around Perseus, from Algol to the Andromeda Galaxy. δ Persei sits in a family of young stars that drift together.", durationMin: 38, totalPathDeg: 61.4, difficulty: "easy" as const };

  it("keeps the story as prose: no repeated hook and no logistics sentence", () => {
    expect(storyProse(j)).toBe("δ Persei sits in a family of young stars that drift together.");
    expect(storyProse({ ...j, story: j.hook })).toBeNull();
  });

  it("does not repeat the driving question in the stop list", async () => {
    const { chapterLine } = await import("../JourneyOverview");
    expect(chapterLine("Which is nearest? Start next door with Algol.", "Which is nearest?")).toBe("Start next door with Algol.");
    expect(chapterLine("Which is nearest?", "Which is nearest?")).toBe("Which is nearest?");
  });

  it("puts duration, stops, path and difficulty on their own line as chips", () => {
    expect(journeyStats(j).map((s) => s.label)).toEqual(["~40 min", `${journey.stops.length} stops`, "61° of sky", "Easy"]);
  });
});

describe("route map framing", () => {
  it("frames the whole route tightly, using the chart's wider side", async () => {
    const { routeRadiusDeg } = await import("../JourneyRouteMap");
    const wide = [{ ra: 30, dec: 45 }, { ra: 60, dec: 45 }];
    const square = routeRadiusDeg(wide, 3.7, 1), landscape = routeRadiusDeg(wide, 3.7, 2);
    expect(square).toBeGreaterThan(10);
    expect(square).toBeLessThan(16);
    expect(landscape).toBeLessThan(square);
    expect(routeRadiusDeg([{ ra: 10, dec: 10 }], 6.5, 1)).toBeCloseTo(7.8, 1);
  });
});
