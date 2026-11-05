# Story grammar research: how published tours tell the sky

Author role: planetarium lecturer and education designer (Sky Journeys P2, story-grammar workstream).
Scope: the research behind `client/public/data/journeys/src/concepts.json`, `templates.json` and `narration.json`.
Date: 2026-11-01. Every claim about a source below links to it. All prose in the data files is original.

---

## 1. What I read, and what each source teaches

| Source | Format | What it does well | What we take |
|---|---|---|---|
| Stuart Atkinson, "Track the life and death of stars in the night sky", *BBC Sky at Night*, Sept 2020 ([link](https://www.skyatnightmagazine.com/advice/skills/track-life-death-stars-night-sky)) | A six-stop "stellar tour": M42 (birth) → Pleiades (youth) → the Sun (middle age) → Betelgeuse (old, massive) → M57 (death of a Sun-like star) → M1 (supernova remnant) | It orders stops by **life stage, not by sky position**. It frames the tour as a "tourist trail" with an explicit start ("let's begin with the youngest") and end ("the final stop"). It uses one analogy per stop (a flock of birds, a smoke ring) and adds foreshadowing ("you're looking ahead to the death of our own Sun"). | The A1 archetype and its build order. One analogy per stop. Foreshadowing lines in `CONNECT`. The "smoke ring" image for planetary nebulae. Our A8 adds the twist this tour lacks: the Sun's fate is the gentle branch. |
| NASA Night Sky Network / ASP, "Supernovae in the Lives of Stars" outreach activity (SUPERNOVA toolkit, 2008; [PDF](https://nightsky.jpl.nasa.gov/documents/829/SNLivesofStars.pdf)) | A 5–10 min volunteer script before a star party | It names the key misconception: people think life **stages** are different **types** of star (the butterfly-lifecycle analogy). It **opens with a question** ("How are all these things related?") and **closes with a driving question** ("So will our Sun go supernova? Why not?"). It also gives a recycling caveat: material shed by a star mostly joins *other* clouds, not the one it was born from. | A8's driving question, "Will the Sun explode?". The rule that every A1/A8 transition says "stage", not "kind". The coda wording in `payoff.A1-*` is generic ("future stars and planets") so that it never claims the gas returns to the same nebula. |
| Larry Sessions & EarthSky editors, "Can you see the different colors of the stars?" (Feb 2026; [link](https://earthsky.org/tonight/can-you-see-the-different-colors-of-the-stars/)) | A winter color walk: Capella → Aldebaran vs the Pleiades → Sirius → Betelgeuse vs Rigel | Its tour is built on **contrast pairs** inside one region. It gives a concrete observing trick (defocus in binoculars) and separates twinkling (atmosphere) from color (temperature). | A2 (one high-contrast pair in the middle), A6 (pairs), the defocus line in `CONTRAST.teffK`, and misconception MC11 (twinkling ≠ variability). |
| Molly Wakeling, "What gives stars their colors?", *Astronomy*, Sept 2024 ([link](https://www.astronomy.com/observing/view-the-full-rainbow-of-stars/)) | Explainer that ends with binocular targets (Albireo, η Cas) | It uses a **temperature ladder** and an incandescent-bulb or flame analogy, and ends on a **color double**. | A2's payoff and twist slots (a color double as the twist). Doc 04's stove-ring analogy is used in `compare.temperature.sun.t0`. |
| Glenn Chaple, "Stellar time machines", *Astronomy*, May 2015 ([link](https://www.astronomy.com/science/stellar-time-machines/)) | A star-party device: convert distance into "this light left when ..." with a famous event (Altair → ISS assembly, Vega → Hubble launch, Arcturus → Pioneer 11, Spica → Messier's catalog, Antares → da Vinci's youth) | **Escalating distance** with a **human anchor** at each step. It works well for a mixed public because it makes distances personal. | A4 (Time Machine). The whole `compare.distance.light-left.*` banded bank. Our anchors are computed from the KB distance, so they stay honest when a distance is revised. |
| PBS *Seeing in the Dark*, "Birthday Stars" ([link](https://www.pbs.org/seeinginthedark/explore-the-sky/birthday-stars.html)) | A table of stars whose light left in your birth year | **Personalization**: the light set out when you were born. | Doc 04 A4 suggests a birth-year option. The `b0` band uses a child's age instead, so it needs no user data. |
| Gary Seronik, *Binocular Highlights* (S&T column 1999–2016; book 2nd ed., [Sky Publishing](https://shopatsky.com/products/binocular-highlights-second-edition)) | One short, region-bound binocular target per column, with a chart and a find route | **Small fields, honest views**: what the binoculars really show, plus one idea. | Card SEE honesty. Get-there phrasing in fields. The "one idea per stop" budget. |
| Philip Harrington, *Touring the Universe through Binoculars* (Wiley 1990; [catalog](https://www.goodreads.com/book/show/1006191)) and his "Binocular Universe" column, e.g. the Big Dipper tour ([Astronomy 2006](https://astronomy.com/observing/phil-harringtons-binocular-universe-the-big-dipper-part-two)) | Constellation-ordered catalogue; each entry gives physical nature, size and distance, then find directions | It **pairs the physical description with the finding route**, and its columns hop through a small area. | Every stop pairs "why here" with a get-there instruction. Tours are region-compact (spec: 30° patch). |
| Consolmagno & Davis, *Turn Left at Orion* (CUP 5th ed. 2018; [front matter](https://assets.cambridge.org/97811084/57569/frontmatter/9781108457569_frontmatter.pdf)) | Seasonal chapters plus northern/southern sky chapters; each object gets "what you're looking at" next to an eyepiece sketch | It uses **seasonal/region grouping** and shows **the eyepiece view, not the photo**. | Card `see` and `notSee`/`photoCaption` honesty (MC7). Our tours are grouped by region (the patch label `{region}` appears in titles). |
| BAA Variable Star Section, "Absolute Beginners" ([link](https://britastro.org/vss/absolute_beginners.htm)) and AAVSO/AWB variable-star guides | How to estimate a variable with comparison stars | Its method has the observer **record a judgement** (fractional or step method against two comparison stars), defocus red stars, and use comparison stars at the same altitude. | A10's participatory ordering: every card asks "brighter or fainter than X?". The `notice.volatile` line. `PERC.purkinje` (glance, don't stare). |
| S&T, "Will the real Albireo please stand up" ([link](https://skyandtelescope.org/stargazing-and-observing/will-the-real-albireo-please-stand-up/)) and doc 04 [S16] Drimmel et al. 2021 | A famous pair questioned | **The twist works best when the observer's eyes are fooled**: a beautiful pair that may be a chance alignment. | A9's twist slot ("Chance alignment?", MC10). |
| Freeman Tilden, *Interpreting Our Heritage* (1957; [NPS history](https://www.nps.gov/parkhistory/online_books/sontag/tilden.htm)): relate, reveal, provoke | Interpretation principles | Information is not interpretation. Every stop must **relate** to the visitor and **provoke** a question, not only instruct. | `CONNECT` lines and the `why.*` bank. Each journey starts from a driving *question*, not a topic. |
| Sam Ham, TORE model (theme, organized, relevant, enjoyable), *Interpretation: Making a Difference on Purpose* (2013; [overview](https://en.wikipedia.org/wiki/Thematic_interpretation)) | Thematic interpretation | One **theme** (a whole-sentence idea, not a topic), **organized** in a few chunks, **relevant** to the visitor. | Each template has one driving question, at most 4 core concepts, and a payoff line that states the theme as a sentence. |
| KaChun Yu, "A guide to communicating astronomy with storytelling in planetariums", *CAPjournal* 33 (2023) 13–20 ([link](https://capjournal.org/issues/33/33_13.php)) | The And–But–Therefore (ABT) story frame for planetarium shows | ABT: set-up (**and**), complication (**but**), resolution (**therefore**). Its authors argue narrative works because of its cause-and-effect structure. | Our arc maps onto ABT: hook + build = AND, twist = BUT, payoff = THEREFORE. Transitions are written as cause-and-effect sentences ("because", "so"), not as lists. |
| Royal Observatory Greenwich live show *Starstruck* ([RMG](https://rmg.co.uk/whats-on/planetarium-shows/starstruck)) | ~25-min live planetarium show on the birth, life and death of a star, presented by an astronomer | It confirms that the **life-cycle arc is the planetarium default** for a general audience aged 7 and up. | A1 is the default theme and is marked `kidFriendly`. |
| Omegon/Astroshop binocular tour series, e.g. "Around the belt of the celestial hunter" ([link](https://astroshop.eu/magazine/practical-tips/observation/tours-with-binoculars/around-the-belt-of-the-celestial-hunter/i,1276)) | Short region tours for binocular owners | Each stop is described **relative to the previous one**, in fields of view. | `direction.sweep` and `direction.same-field` wording. |

## 2. Tour structures that work (and the archetype each one grounds)

1. **The life-stage trail** (Sky at Night 2020; NSN "Lives of Stars"; RMG *Starstruck*). Order stops by stage and say "stage", never "kind" → **A1 Cradle to Grave**. Its strongest form is the **flash-forward**: start on the doomed star, rewind to the nursery, end on the remnant. This is a classic planetarium device (doc 04 §3.0), and the A1 hook slot allows a supergiant opener for it.
2. **The fork by mass** (NSN "Lives of Stars": the Sun-like column and the massive-star column side by side, ending on "Will the Sun go supernova?") → **A8 How Stars Die**. It has two branches and one answer. Its twist is MC8 ("planetary nebulae have nothing to do with planets").
3. **The contrast walk** (EarthSky colors; Astronomy 2024) → **A2 Thermometer** (one ladder) and **A6 Contrasts** (pairs that share one trait and flip another). The defocus trick is the observing hook.
4. **The time-machine ladder** (Chaple 2015; PBS Birthday Stars) → **A4 Time Machine**. Each rung gets a human anchor. It must never imply that a visible star "may already be dead" (MC5).
5. **The distance ladder with methods** (Hubble's 1923 Cepheid V1 in M31: [NASA](https://science.nasa.gov/missions/hubble/hubble-views-the-star-that-changed-the-universe/), [ESA/Hubble](https://esahubble.org/images/opo1115a/); Bessel's 1838 parallax: [arXiv 2009.11913](https://arxiv.org/abs/2009.11913)) → **A3 How Far Is Far?** The "how do we know" is the story.
6. **The family album** (Harrington's Big Dipper tours; the Ursa Major moving group, doc 02 §7.3) → **A5 Families**. Its twist is that the Big Dipper is mostly one family.
7. **The participatory estimate** (BAA VSS beginners; AAVSO) → **A10 Stars That Change**. The observer becomes an instrument, which is the "maintained situational interest" phase of Hidi & Renninger (doc 04 [S2]).
8. **The double-star skill ramp** (Seronik; S&T Albireo) → **A9 Seeing Double**. It runs wide to tight pairs, then optical to physical. Several doubles in a row are allowed here.
9. **Inside-out galaxy tour** (doc 03 U3, Shapley's globulars; doc 03 A2 autumn ladder) → **A11 Inside Our Galaxy**.
10. **The honest moonlit night** → **A12**. When the Moon wins, every guide falls back to colored stars, doubles and bright clusters. Our card says so plainly (`notice.moonlit`) rather than offering a degraded nebula tour.

## 3. Narrative devices adopted (with the data field that carries each)

| Device | Where it comes from | Where it lives in our data |
|---|---|---|
| Open with a question; close it at the payoff | NSN script; Loewenstein information gap (doc 04 [S1]); Ham's theme | `Template.drivingQuestion` + `questionKeys`; `payoffKeys` (3 variants each) answer the question by name |
| Every step says *why* the next object follows | Atkinson's stage transitions; ABT "therefore" | Transition banks keyed `<EDGE_TYPE>[.<subtype>]`, ≥4 variants for every story type. NEIGHBOR is never in a template's `edges`. |
| One analogy per stop, approved list | Doc 04 §6.3; Atkinson (smoke ring, flock) | Neon sign (`CAUSE.ionizes`), fog round a streetlight (`CAUSE.illuminates`), stove ring (`compare.temperature.sun.t0`), distant town past a nearer one (`LINE_OF_SIGHT.background-cluster`) |
| One shared scale model | Doc 06 §7.1: Sun = 1 cm marble | `compare.size.marble.*`, `compare.distance.marble.*`, `compare.time.sun-day.*` (bands below) |
| Historical "this light left when ..." | Chaple 2015 | `compare.distance.light-left.*`, 24 distance bands (§4) |
| Twist = confront a misconception | Doc 04 §3.0/§6.5; NSN "stages vs types" tip | Twist slots match `hasMisconception: true` |
| Callback coda | Peak-end rule (doc 04 [S11]) | `coda.callback` with `{hook}`; coda slots last and optional |
| Observer does something | BAA VSS method; Seronik | `direction.*` phrasing; A10 ordering note; `notice.volatile` |
| Theme drift announced | Doc 04 §3.2 (one switch, announced) | `Template.switchRule` + `switch.<templateId>` lines with `{theme}` |
| Honest expectations | Turn Left at Orion's eyepiece view; MC7 | `notice.photo`, `notice.challenge`, `why.challenge` |

## 4. Historical anchors for light-travel time (banded by distance)

The narrator computes `{year}` = current year − distanceLy and `{ago}` from the KB distance (which has a sourceId). The band
adds the anchor. Band edges assume the 2020s; re-check them around 2040. **If a fact's min–max range straddles a band edge,
use the base key `compare.distance.light-left`, which has no anchor.**

| Band (ly) | Light left (≈) | Anchor used | Source |
|---|---|---|---|
| < 15 | 2011 → now | a few years ago (a schoolchild's age) | none needed |
| 15–28 | 1998–2011 | ISS assembly in orbit (elements launched from 1998) | [NASA ISS reference](https://www.nasa.gov/reference/international-space-station/) |
| 28–40 | 1986–1998 | Hubble launched (24 April 1990) | [NASA Hubble history](https://science.nasa.gov/mission/hubble/overview/the-history-of-hubble/) |
| 40–70 | 1956–1986 | Sputnik (1957), Apollo 11 (1969) | [NASA Sputnik](https://www.nasa.gov/history/sputnik/), [NASA Apollo 11](https://www.nasa.gov/mission/apollo-11/) |
| 70–130 | 1896–1956 | Hubble's Cepheid V1 in M31 (Oct 1923): other galaxies exist | [NASA](https://science.nasa.gov/missions/hubble/hubble-views-the-star-that-changed-the-universe/), [ESA/Hubble](https://esahubble.org/images/opo1115a/) |
| 130–190 | 1836–1896 | First stellar distance (Bessel, 61 Cyg, 1838) | [arXiv 2009.11913](https://arxiv.org/abs/2009.11913) |
| 190–416 | 1610–1836 | After Galileo's telescope (*Sidereus Nuncius*, 1610), before Bessel | [Linda Hall Library](https://www.lindahall.org/about/news/scientist-of-the-day/galileo-galilei/), [arXiv 2009.11913](https://arxiv.org/abs/2009.11913) |
| 416–600 | 1426–1610 | Before any telescope | [Linda Hall Library](https://www.lindahall.org/about/news/scientist-of-the-day/galileo-galilei/) |
| 600–1000 | 1026–1426 | After the 1054 "guest star" (the Crab supernova) | [Chandra: Crab](https://chandra.harvard.edu/photo/2006/crab/) |
| 1000–1400 | 626–1026 | Dunhuang star chart (649–684 CE, oldest complete star atlas); al-Sufi's *Book of Fixed Stars* (964), the first record of the Andromeda "little cloud" | [Bonnet-Bidaud et al. 2009](https://arxiv.org/abs/0906.3034), [British Library IDP](https://idp.bl.uk/blog/the-dunhuang-star-chart), [Science Museum blog](https://blog.sciencemuseum.org.uk/updating-stars-and-observing-the-andromeda-galaxy/) |
| 1400–2100 | 74 BCE–626 CE | Roman Empire; Ptolemy's star catalogue (c. 150 CE) | [Britannica: Ptolemy](https://www.britannica.com/biography/Ptolemy) |
| 2100–4500 | 2474–74 BCE | After Stonehenge's stone circle (c. 2500 BC) | [English Heritage](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/history/) |
| 4500–6000 | 3974–2474 BCE | Invention of writing in Mesopotamia (c. 3200 BCE; Uruk) | [The Met: origins of writing](https://www.metmuseum.org/essays/the-origins-of-writing) |
| 6000–12,000 | ~10,000–4000 BCE | Before writing | same |
| 12,000–19,000 | | End of the Last Glacial Maximum; deglaciation from ~19–20 ka | [Clark et al. 2009, *Science* 325, 710 (USGS record)](https://www.usgs.gov/publications/last-glacial-maximum) |
| 19,000–26,500 | | Last Glacial Maximum (26.5–19 ka) | same |
| 26,500–100,000 | | Before the LGM peak | same |
| 100,000–300,000 | | Oldest *Homo sapiens* fossils: Jebel Irhoud, ~300,000 yr (Hublin et al. 2017) | [Max Planck Society](https://www.mpg.de/11322481/oldest-homo-sapiens-fossils-at-jebel-irhoud-morocco) |
| 300,000–1 M | | Before our species; other humans (e.g. *H. heidelbergensis*) | [Smithsonian Human Origins](https://humanorigins.si.edu/evidence/human-fossils/species/homo-heidelbergensis) |
| 1 M–4 M | | First stone tools (Oldowan ~2.6–3.0 Ma; Nyayanga) | [ScienceDaily / Smithsonian NMNH 2023](https://www.sciencedaily.com/releases/2023/02/230209141458.htm) |
| 4 M–8 M | | Human–chimpanzee lineage split (~6–8 Ma; estimates vary) | [Smithsonian Human Origins: genetics](https://humanorigins.si.edu/evidence/genetics) |
| 8 M–40 M | | Before that split | same |
| 40 M–66 M | | After the end-Cretaceous extinction (~66.0 Ma) | [Renne et al. 2013, *Science* 339, 684](https://www.science.org/doi/10.1126/science.1230492) |
| ≥ 66 M | | Dinosaurs still alive | same |

## 5. The marble scale (one scale for the whole app)

The Sun is a 1 cm marble (doc 06 §7.1). From the IAU nominal solar radius of 695,700 km ([IAU 2015 B3, Prša et al. 2016](https://arxiv.org/abs/1605.09788)) and
the 2012 astronomical unit of 149,597,870.7 km ([Observatoire de Paris](https://observatoiredeparis.psl.eu/the-new-definition-of-the-astronomical-unit.html)):

- 1 AU = 107.5 solar diameters, so Earth is a 0.09 mm grain about **1.08 m** from the marble.
- 1 light-year = **68.0 km** at this scale. Sirius is about 585 km, the Pleiades about 30,000 km and M42 about 92,000 km away.
  M31 is about 170 million km, more than the real Earth–Sun distance. That last comparison is the `m2M` band.
- A star's diameter in this model, in cm, equals its radius in R☉. Betelgeuse at 764 R☉ (Joyce et al. 2020) is 7.6 m.
- **Orbit bands use radius, not diameter.** A star reaches Earth's orbit at 215 R☉ (1 AU), Mars's at 328 R☉ and
  Jupiter's at 1,119 R☉. (A first draft used 107 R☉, which mixes up diameter and radius.)
- The Moon is 384,400 km from Earth ([NASA Moon facts](https://science.nasa.gov/moon/facts/)). It is the yardstick for the `m600`/`m6k` bands.
- Temperature reference: the Sun at 5,772 K (IAU 2015 B3), rounded to 5,800 K in text.
- Supernova line: about 8 M☉ (Smartt 2009, *ARA&A* 47, 63, [arXiv 0908.0700](https://arxiv.org/abs/0908.0700)).
- The Sun-day clock uses a solar age of 4.6 Gyr (4.568 Gyr, Bouvier & Wadhwa 2010, [*Nature Geoscience* 3, 637](https://doi.org/10.1038/ngeo941)).
- "The Sun's siblings are lost" (A5 payoff): the Sun formed in a cluster that has since dispersed (Adams 2010, *ARA&A* 48, 47, [arXiv 1001.5444](https://arxiv.org/abs/1001.5444)).

These URLs are also in `narration.json` → `citations`, keyed by variant key or key prefix.

## 6. Design decisions in the three data files

### concepts.json (62 concepts)
- The 28 doc 04 §2.2 concepts and the 28 doc 02 §2.4 fine concepts. The task text says 27; the doc 02 table actually lists 28, and all 28 are included with their doc 02 parents.
- I added **6 deep-sky fine concepts** so the deep-sky curators can tag what doc 03's stories teach: `NEB.reflection`,
  `NEB.dark`, `LIFE.wind-bubble`, `GAL.interacting`, `GAL.satellites` and `MW.spiral-arm`. Each has a doc 04 parent.
- Every concept has a one-sentence `bigIdea` (card-ready) and a one-sentence `bridge`, which the narrator inserts via
  `bridge.prereq` or `skip.bridge` when the prerequisite was never taught (doc 04 §2.1: one load unit).
- Prereqs are soft and acyclic (a test checks this). `LIFE.recycling` needs "nursery + (pn-wd or supernova)", but the type has no
  OR, so I used `[LIFE.nursery, LIFE.giant]`, the shared ancestor of both endings.
- `evidenceIds` only use ids from `script/journeys/object-list.json` (a test checks this).
- I avoided bare numbers in concept text, because concepts carry no sourceId. The "about eight Suns" supernova line is the one exception, and it is sourced above (Smartt 2009).

### templates.json (12 archetypes)
- The ids keep the fixture ones (`A1-cradle-to-grave`, `A2-thermometer`), and the rest follow the same pattern.
- **Slot grammar per doc 05 §5.4.** Each slot has an arc role (hook/build/twist/payoff/coda), a ≤3-word chip label, a `match` on kind,
  class, roles, evoStage, concepts, facts, misconceptions, superlative tags, variability class or history hook, and optional `repeat` and `inEdges`
  (the link types allowed to *arrive* at the slot). There is exactly one required payoff, the hook comes first, and a coda, when present, comes last. Tests check all of this.
- **Ordering principle:** `order` + `progression` for the engine, and `orderingPrinciple` prose for authors and debugging.
- **Minimum sky ingredients:** doc 04 §3.1 is expressed through `ingredients`, which now also covers superlatives, history hooks,
  sky darkness and Moon illumination limits.
- **Moon:** `moonSuitability` follows the doc 04 §3.2 matrix (bright-ok / partial / dark-only). `moonFriendly` is true only when the value is bright-ok.
- **One archetype switch:** `switchRule` (to, atArc = payoff, via, minStrength, announceKey). Semantics: after the payoff,
  the journey may continue with the target template's slots from its first build slot on. The payoff object serves as the
  target's hook, and the switch is announced with `switch.<id>` text. This implements doc 04 §3.2: "the payoff of one becomes the hook of the next".
  The pairs follow the doc's examples (A2→A1, A3→A4, A9→A10). For the other archetypes I chose the most natural follow-on question.
- **Superlative tag vocabulary** (curators: use these in `superlatives[].tag` so A7 slots can match):
  `largest-star-in-view`, `most-luminous-in-view`, `hottest-star-in-view`, `coolest-star-in-view`, `reddest-star`,
  `brightest-star`, `most-massive`, `youngest`, `oldest`, `nearest`, `farthest`, `farthest-naked-eye`, `fastest-moving`,
  `fastest-spinning`, `richest-cluster`, `largest-apparent`.

### narration.json (216 keys, about 600 variants)
- **Placeholders** are declared in `placeholders`. A test fails if a variant uses an undeclared one. This adds 9 to doc 05's list:
  `{name} {hook} {skipped} {scaled} {year} {ago} {theme} {bridge} {claim}`. Doc 05's `{value}` is now also used with bands.
- **Bands** (`bands`) choose the comparison variant by value, so a single shared scale covers the whole KB without hand-writing.
- **Key families:** `title.*`, `question.*`, `hook.*`, `payoff.*`, `switch.*`; generic transitions `<EDGE_TYPE>` and
  `<EDGE_TYPE>.<subtype>` (subtypes from doc 03 §6.2 and the fixture edges); derived life steps `LIFE_NEXT.<from>-<to>` (evoStage);
  `skip`, `skip.bridge`, `skip.<EDGE_TYPE>`; `bridge.prereq`; `coda.callback`; `why.*` (arc roles, superlative, conditions);
  `notice.*`; `compare.*`; `direction.*` (same-field / sweep / sweep.one / naked-eye-hop / after-skip / challenge).
- **Voice:** second person, present tense, ≤230 characters per variant, and no "simply" or "obviously" (tests enforce all three). Each line holds one idea, and lines use cause-and-effect verbs (ABT).

## 7. Notes and corrections for other workstreams

1. **Doc 06 §7.1's luminosity line is physically wrong.** "Put it where the Sun is and our sky would never be dark" is false: night is
   Earth's shadow, and it does not depend on the Sun's luminosity. The `compare.luminosity.sun.*` lines use scorching or roasting instead.
2. **The `{ratioPhrase}` engine must handle ratios under 2.** Doc 05's 1-significant-figure rule turns 1.3 into "about 1 times hotter".
   Suggestion: for ratios below 1.5 say "a little hotter", and for 1.5–2.5 say "about twice as hot". I removed `{ratioPhrase}` from the 6,500–10,000 K band for this reason.
3. **Band straddle rule.** When a fact's [min, max] range crosses a band edge, use the base key, which has no anchor. Betelgeuse at
   ~500–650 ly straddles 600 ly, so it gets the neutral line, not a possibly wrong century.
4. **README path.** `script/journeys/README.md` says that `curated/concepts.json`, `templates.json` and `narration.json` are the inputs.
   This task placed them in `client/public/data/journeys/src/`. The merge step should read from there, or the files can be moved; the content is the same either way.
5. **Narration in curated batches.** Batch files may add `edge.<from>><to>` keys. They should not redefine the generic keys listed above.
