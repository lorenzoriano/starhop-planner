# 04 — Pedagogy and journey criteria for Sky Journeys

Author role: planetarium lecturer and science-education researcher (informal learning, adult outreach).
Audience: the orchestrator, the knowledge-base (KB) authors, the journey assembler and scorer implementers, card writers, and the simulated-student harness.
Status: design input, phase 1. This document changes no code or data.

Source tags such as `[S3]` point to the reference list in section 11. Astrophysical numbers in the example cards are cited. Wherever the literature disagrees, the card says "about" or gives a range.

---

## 0. The decisions in one page

1. **Every journey is built around one driving question, and the last stop answers it.** Examples: "Where do stars come from, and how do they end?" and "How far back in time can your binoculars see?". Curiosity is triggered by a gap between what someone knows and what they want to know. It is strongest when the person can almost guess the answer [S1]. So the app shows the question when the journey starts, ends each card with a teaser that opens the next gap, and closes the gap at the payoff stop.
2. **Each journey teaches one big idea through two to four supporting concepts.** The concepts come from a fixed concept graph (section 2) with explicit prerequisites. The assembler must not ask the observer to understand a concept before its prerequisites, unless the card adds a one-sentence bridge. A bridge counts against the cognitive-load budget.
3. **Journeys come from about 12 archetypes (section 3), not from hand-written tours.** An archetype is a slot grammar: an ordering principle, stop roles (hook, build, twist, payoff, coda), and the minimum ingredients the sky must contain. The assembler fills the slots from the KB for tonight's sky, and the scorer ranks the candidates. One archetype filled from a 300-object KB gives hundreds of distinct valid journeys, so the content never runs out.
4. **Every consecutive pair of stops must have a typed link reason.** Examples are "next life stage", "same X, different Y" and "this star lights that cloud" (section 4.3). "It's nearby" never stands alone as a reason. This one rule does more for perceived coherence than anything else.
5. **The arc uses the peak-end rule.** The first stop is easy and striking, with difficulty 2 or less and wow 3 or more. The best stop (wow plus understanding) falls in the final third. The last stop is the peak itself or a short coda that calls back to the first stop. People remember an experience by its peak and its end [S11].
6. **The cognitive-load budget is hard.** A stop introduces at most 2 new terms and 1 new concept. A journey has at most 4 core concepts and 8 new terms. Each card's main text is 220 words or fewer: under red light at the eyepiece, people read in glances. The idea comes from working-memory limits of about 4 chunks [S9] and from the coherence and segmenting principles [S8].
7. **Cards are honest about what binoculars show.** Faint objects look grey because night vision does not see color [S20]. Every card has a SEE section that describes the binocular view, not the photograph. Each photo caption says what the camera shows that the eye cannot.
8. **Labels for the learned scorer are mostly pairwise.** A judge picks the better of two journeys and adds 1–5 rubric scores on 8 dimensions (section 5). Accuracy is a hard gate, not a score. Pairwise judgments are more consistent than absolute scores, and they train a ranking model (gradient-boosted trees or logistic regression on the computed features in section 4) directly.
9. **Four simulated personas test every release candidate (section 7).** The curious beginner adult is the primary user, and that persona's rubric weights are the default.

---

## 1. Why these choices: the research in six short points

| Finding | Design rule it produces |
|---|---|
| Free-choice learners come with identity-related motivations (explorer, facilitator, hobbyist, experience seeker, recharger) and learn through personal, sociocultural and physical context together [S3][S4]. | The personas (section 7) follow these identities. The parent is a facilitator, and the returning amateur is a hobbyist. The physical context is cold, dark, a red screen and a tired neck, so cards must be short and easy to glance at. |
| Curiosity comes from a perceived information gap, and it peaks when people can nearly guess the answer [S1]. | Driving question, teaser at the end of every card, and payoff placement (section 3.0). |
| Interest develops in four phases: triggered situational, maintained situational, emerging individual, well-developed individual [S2]. | The hook triggers interest with surprise and a striking sight. The build maintains it through meaningful involvement: the observer looks for something specific. The coda points to a next journey and starts individual interest. |
| Extraneous material hurts learning (coherence principle, median effect size 1.32 in Mayer's tests). Signaling and user-paced segments help [S8]. | One concept per card, a fixed section structure (signaling), stops as user-paced segments, and "seductive details" restricted to the WONDER line, which must still be on topic. |
| Working memory holds about 4 chunks [S9]. Cognitive load theory [S10]. | At most 2 new terms per stop, at most 3 headline numbers per card, and the theme term repeated across cards. |
| Adults have stable misconceptions about stars. Before instruction, fewer than 10% of students named fusion as a star's energy source, and post-test scores on the Star Properties Concept Inventory were only about 51% [S5][S6]. Comins catalogued more than 1,700 popular astronomy misconceptions [S7]. | Section 6.5 has a misconceptions table. A card that confronts a misconception gets a twist role in the arc. |

---

## 2. Concept taxonomy and curriculum graph

### 2.1 How it works

- A **concept** is one big idea a curious adult can understand in about 60 seconds when it is tied to something they are looking at.
- Each concept has a **tier** (0 = perceptual or sky literacy, 3 = cosmic scale), **prerequisites**, a **one-sentence big idea**, the **terms** it introduces, and **evidence objects**: things in the binocular sky that show it.
- Each KB object gets a `teaches` list of concept IDs, each with a strength from 1 to 3 (3 = a textbook example). The assembler uses this list to fill slots, and the scorer uses it to measure coherence and progression.
- Prerequisites are **soft**. A prerequisite counts as satisfied if (a) an earlier stop in this journey taught it, (b) the device's learned-concepts record contains it (section 8.3), or (c) the card adds a one-sentence bridge. A bridge costs 1 unit of cognitive load.

### 2.2 The concept graph

| ID | Tier | Big idea (card-ready) | Prerequisites | Terms introduced | Evidence objects (binoculars) |
|---|---|---|---|---|---|
| `PERC.night-eyes` | 0 | Your night vision sees faint light but almost no color, and works best slightly off-center. | none | averted vision, dark adaptation | any faint nebula or galaxy, M31, M33 |
| `PERC.binoculars` | 0 | Binoculars collect far more light than your pupil, so hundreds of hidden stars appear. | none | aperture, field of view | Pleiades, Hyades, Alpha Persei Cluster (Mel20), Coma Cluster (Mel111) |
| `SKY.projection` | 0 | Stars that look side by side can be at very different distances. A constellation is a perspective effect. | none | line of sight | Orion's stars, Aldebaran in front of the Hyades |
| `LIGHT.brightness` | 1 | How bright a star looks depends on how much light it gives out and how far away it is. | none | apparent brightness, magnitude (optional) | any bright star pair |
| `DIST.light-year` | 1 | A light-year is a distance: how far light travels in a year. | none | light-year | any star with a known distance |
| `LIGHT.color-temp` | 1 | A star's color is a thermometer: red-orange stars are cool, blue-white stars are hot. | `PERC.night-eyes` (for faint stars) | surface temperature, kelvin (optional) | Betelgeuse and Rigel, Antares, Albireo, the Garnet Star (μ Cep), La Superba |
| `DIST.lum-vs-app` | 2 | A faint-looking star can be a giant far away, and a bright one can be ordinary and near. | `LIGHT.brightness`, `DIST.light-year` | luminosity | Rigel and Sirius, Deneb and Vega |
| `TIME.lookback` | 2 | Looking far away means looking back in time. Every object shows you old light. | `DIST.light-year` | lookback time | the distance ladder (archetype A4) |
| `STAR.fusion` | 1 | Stars shine by fusing hydrogen into helium in their cores. They are not fires. | none | fusion, hydrogen | any main-sequence star (Vega, Sirius) |
| `STAR.size` | 2 | Stars range from smaller than Earth (white dwarfs) to wider than Mars's orbit (supergiants). Cool and very bright means huge. | `LIGHT.color-temp`, `DIST.lum-vs-app` | giant, supergiant, dwarf | Betelgeuse, Antares, μ Cep |
| `STAR.mass-fate` | 2 | Mass is destiny. Heavy stars live fast and die young and violently. Light stars live long and fade quietly. | `STAR.fusion` | mass (solar masses), lifetime | Rigel or Deneb vs Sun-like stars; cluster comparisons |
| `LIFE.nursery` | 2 | Stars are born in cold clouds of gas and dust. Newborn hot stars light up their cloud. | `STAR.fusion` | nebula, emission (gas glowing) | M42, M8, North America Nebula (NGC 7000), Rosette (NGC 2237), η Carinae Nebula (NGC 3372) |
| `LIFE.cluster-birth` | 2 | Stars are born in batches: a cluster is a family of siblings of the same age. | `LIFE.nursery` | open cluster | NGC 2244, NGC 6530, Pleiades |
| `LIFE.cluster-age` | 3 | A cluster's brightest remaining stars tell its age: blue giants mean young, and only yellow and orange left means old. | `LIFE.cluster-birth`, `STAR.mass-fate`, `LIGHT.color-temp` | turn-off (Deeper section only) | Pleiades, Hyades, M44, NGC 752, M67 |
| `MW.families` | 3 | Clusters slowly dissolve. Their stars spread into loose associations and moving groups that still share a motion. | `LIFE.cluster-birth` | association, moving group | Orion's belt (Orion OB1), Ursa Major group (Mizar), Alpha Persei Cluster, Coma Cluster |
| `LIFE.giant` | 2 | When the core runs out of hydrogen, a star swells into a cool, huge, bright giant. | `STAR.fusion`, `LIGHT.color-temp` | red giant | Aldebaran, Arcturus, Betelgeuse, Antares |
| `LIFE.pn-wd` | 3 | A Sun-like star dies gently: it puffs off its outer layers (a planetary nebula) and leaves a white dwarf. | `LIFE.giant`, `STAR.mass-fate` | planetary nebula, white dwarf | M27, M57 (hard), NGC 7293, NGC 6826, NGC 3242, NGC 7662 |
| `LIFE.supernova` | 3 | A heavy star ends in a supernova and leaves a neutron star or black hole. | `LIFE.giant`, `STAR.mass-fate` | supernova, neutron star, pulsar | M1 (challenge), Veil (NGC 6960/6992), Betelgeuse (future), Crescent Nebula (NGC 6888, precursor) |
| `LIFE.recycling` | 3 | Dying stars return enriched gas to space, and new stars and planets form from it. We are made of it. | `LIFE.nursery` + (`LIFE.pn-wd` or `LIFE.supernova`) | heavy elements | payoff concept for A1 and A6 |
| `MULT.doubles` | 1 | Many "stars" are two or more. Some are true orbiting pairs, others are chance alignments. | `SKY.projection` | double star, binary | Mizar & Alcor, Albireo, α Cap, ν Dra, ζ Lyr |
| `MULT.weighing` | 3 | Orbiting pairs let us weigh stars, and that is how we know stellar masses. | `MULT.doubles`, `STAR.mass-fate` | orbit | Mizar (A spectroscopic binary), Albireo A (debated) |
| `VAR.pulsating` | 2 | Some stars breathe in and out and change brightness on a rhythm. | `STAR.fusion` | variable star | Mira, δ Cep, Rasalgethi |
| `VAR.eclipsing` | 2 | Some "variables" are pairs that eclipse each other. | `MULT.doubles` | eclipsing binary | Algol |
| `DIST.standard-candle` | 3 | Stars of known true brightness, such as Cepheids, are cosmic yardsticks. | `VAR.pulsating`, `DIST.lum-vs-app` | standard candle, Cepheid | δ Cep, then M31 |
| `MW.disk` | 2 | The Milky Way band is our galaxy, a flat disk seen edge-on from inside. Nurseries and young clusters crowd along it. | `PERC.binoculars` | galactic plane | the Milky Way in Cygnus or Sagittarius, clusters along the band |
| `MW.halo` | 3 | Globular clusters are ancient swarms in a halo around the galaxy's center. They are older than the Sun. | `MW.disk`, `LIFE.cluster-age` | globular cluster, halo | M13, M22, ω Cen, 47 Tuc |
| `GAL.other` | 3 | Some faint smudges are whole other galaxies, each with billions of stars. | `MW.disk`, `TIME.lookback` | galaxy | M31, M33, M81/M82, LMC/SMC, NGC 253 |
| `SCALE.cosmic` | 3 | Ladder of scale: Sun → stars → clusters → galaxy → galaxies. Each step is about 10–1,000 times bigger. | `TIME.lookback`, `GAL.other` | none | payoff concept for A4 and A11 |

### 2.3 Prerequisite DAG (summary)

```
PERC.night-eyes ─► LIGHT.color-temp ─┬─► STAR.size ◄── DIST.lum-vs-app ◄─┬─ LIGHT.brightness
                                     │                                   └─ DIST.light-year ─► TIME.lookback ─┐
STAR.fusion ─┬─► STAR.mass-fate ─────┼─► LIFE.cluster-age ◄── LIFE.cluster-birth ◄── LIFE.nursery ◄─ STAR.fusion
             │                       │          │                       └─► MW.families
             └─► LIFE.giant ◄────────┘          └─► MW.halo ◄── MW.disk ◄── PERC.binoculars
                    ├─► LIFE.pn-wd ──┐                             └──────► GAL.other ◄────────────┘
                    └─► LIFE.supernova ┴─► LIFE.recycling (also needs LIFE.nursery)
SKY.projection ─► MULT.doubles ─┬─► MULT.weighing (needs STAR.mass-fate)
                                └─► VAR.eclipsing
VAR.pulsating + DIST.lum-vs-app ─► DIST.standard-candle ─► (supports GAL.other, SCALE.cosmic)
GAL.other + TIME.lookback ─► SCALE.cosmic
```

### 2.4 Object pedagogy fields the KB must provide

The KB doc owns the schema. Sky Journeys pedagogy needs the following fields on every object:

| Field | Type | Purpose |
|---|---|---|
| `teaches` | `{conceptId, strength 1–3}[]` | Slot filling, coherence, progression |
| `roles` | enum[]: `nursery`, `young-cluster`, `adult-cluster`, `old-cluster`, `globular`, `main-sequence`, `giant`, `supergiant`, `pn`, `snr`, `wd`, `variable`, `double`, `galaxy`, `association` | Archetype slot matching |
| `evoStage` | ordinal 0–8 (0 cloud, 1 embedded/≤10 Myr cluster, 2 young ≤200 Myr, 3 intermediate ≤2 Gyr, 4 old cluster or globular; 5 giant/supergiant star, 6 PN or SN-imminent, 7 remnant, 8 galaxy, outside the sequence) | Life-cycle ordering |
| `superlatives` | `{claim, scope, source}[]`, e.g. "largest star visible to the naked eye in the northern winter sky" | Superlative tour, hook text |
| `distanceLy`, `distanceLyRange` | number, [lo, hi] | Ladder archetypes, honesty about uncertainty |
| `ageMyr`, `ageRange` | number, [lo, hi] | Contrast and cluster-age arcs |
| `teffK`, `radiusSun`, `massSun`, `lumSun` | numbers or ranges (stars) | Contrast axes |
| `wow` | 1–5 | Perceptual impact in binoculars under typical suburban-to-dark skies (not the photo) |
| `insight` | 1–5 | How much "aha" the object can carry. Betelgeuse is 5 (with its story), a generic open cluster is 2 |
| `obsDifficulty` | 1–5 | 1 naked-eye bright star; 2 obvious in binoculars after one hop; 3 needs dark sky, averted vision or a multi-hop; 4 challenge for 50 mm under dark skies (M1, Veil); 5 beyond hand-held binoculars (exclude from default journeys) |
| `seeText` | short | Honest binocular impression (current `impression` field is a starting point) |
| `misconceptions` | ID[] from table 6.5 | Twist slots |
| `historyHook` | short, cited | WONDER line and lookback anchors |
| `links` | `{to, type, text}[]`, optional and hand-curated | Strong authored link reasons (θ1 Ori C lights M42, Aldebaran is in front of the Hyades) that override computed ones |

---

## 3. Journey archetypes

### 3.0 The arc grammar every archetype uses

```
HOOK (1)  →  BUILD (1–6)  →  [TWIST (0–1)]  →  PAYOFF (1)  →  [CODA (0–1)]
```

- **HOOK**: easy (`obsDifficulty` ≤ 2) and striking (`wow` ≥ 3). It poses or embodies the driving question. A naked-eye anchor is ideal, because the observer has not yet warmed up their skills or their eyes.
- **BUILD**: each stop adds exactly one concept or one step along the archetype's ordering axis. Difficulty may rise.
- **TWIST** (optional): a stop that breaks an expectation the build created. Examples: "the bright orange star in the cluster isn't a member" (Aldebaran), "this beautiful double may not be a pair at all" (Albireo). Twists drive curiosity [S1] and are where misconceptions get confronted.
- **PAYOFF**: the stop with the highest `wow + insight`. It answers the driving question. It sits in the final third and has `obsDifficulty` ≤ 3 unless the persona or sky allows 4. A 4 always has a fallback.
- **CODA** (optional, at most 1): a gentle stop or a naked-eye "look up" moment that calls back to the hook ("now look at Betelgeuse again; you know where those atoms are going").

Default length: **5 stops** (range 3–10, per the product vision). Persona defaults: beginner 5, kid 4, returning amateur 7, engineer 6. Session time is 5–8 minutes per stop plus the hops, so 30–60 minutes.

Opening strategy (opinionated). Do not open with the single best object. Open with something striking and easy, and save the best for the end. **One exception: the flash-forward hook.** For the life-cycle archetype, the app may open on the star whose fate is the story (Betelgeuse), then go back to the beginning (M42). The payoff is then the remnant, or a return to the hook star with new understanding. This is a classic planetarium technique, and it fits the peak-end rule because the hook is not the peak; the understanding is.

### 3.1 The archetypes

For each archetype: driving question, ordering principle, stops, arc, minimum ingredients (the assembler must check these before attempting the archetype), allowed link types, and an example from the existing catalog.

---

#### A1. Cradle to Grave (life cycle of stars)

- **Driving question:** "Where do stars come from, and how do they end?"
- **Ordering principle:** `evoStage` non-decreasing along the build. A flash-forward hook is allowed (see 3.0).
- **Stops:** 4–7.
- **Arc:** hook = nursery (wow) or a doomed supergiant (flash-forward). Build = nursery → very young cluster → young cluster → older cluster or giant. Twist = a foreground giant (Aldebaran) or "this cluster's blue stars are already gone". Payoff = dying star or remnant plus the recycling idea. Coda = callback to the nursery ("that cloud contains atoms from stars like the one you just saw").
- **Minimum ingredients:** ≥1 `nursery`, ≥1 cluster (`young-cluster` or `adult-cluster`), ≥1 of {`giant`/`supergiant`, `pn`, `snr`}, and at least 3 distinct `evoStage` values.
- **Core concepts:** `LIFE.nursery`, `LIFE.cluster-birth`, `LIFE.giant`, plus `LIFE.pn-wd` or `LIFE.supernova`. Optional payoff: `LIFE.recycling`.
- **Example (northern winter, Orion and Taurus):** M42 → Orion's belt stars (Orion OB1 siblings) → Pleiades (about 100 Myr) → Hyades with Aldebaran (about 650 Myr, twist) → Betelgeuse (payoff) → M1 (challenge coda, "what Betelgeuse will leave").
- **Summer variant:** M8 → NGC 6530 → M7/IC 4665 → Antares → Veil (dark sky) or M27.

#### A2. A Thermometer in the Sky (color is temperature)

- **Driving question:** "Why are stars different colors, and what does that tell us?"
- **Ordering principle:** monotonic `teffK` (cool → hot or hot → cool) with one high-contrast pair in the middle.
- **Stops:** 4–6.
- **Arc:** hook = an obviously colored naked-eye star (Betelgeuse or Antares). Build = a ladder of colors. Twist = a color-contrast double (Albireo), or "red doesn't mean weak" (cool Betelgeuse is one of the most luminous stars in the sky, see `STAR.size`). Payoff = the reddest naked-eye or binocular star (the Garnet Star, La Superba) or the hottest (Rigel). Coda = "the Sun sits in the middle: yellow-white".
- **Minimum ingredients:** ≥4 stars spanning ≥ 6,000 K in `teffK`, ≥1 with `teffK` < 4,000 and ≥1 with `teffK` > 9,000. A bright Moon is acceptable.
- **Core concepts:** `LIGHT.color-temp`, `PERC.night-eyes` (why color is easier on bright stars; the defocus trick), then `STAR.size` as the payoff.
- **Moon-friendly. This is the default archetype for moonlit nights.**

#### A3. How Far Is Far? (a ladder of distances)

- **Driving question:** "Which of these is closest, and how do we know?"
- **Ordering principle:** `distanceLy` strictly increasing. Consecutive stops differ by a factor of ≥2 (log10 step ≥ 0.3).
- **Stops:** 5–8.
- **Arc:** hook = a bright, near star (Sirius at 8.6 ly, Vega at 25 ly). Build = a nearby cluster (Hyades), a farther cluster (Pleiades), a nebula (M42), a distant cluster (Double Cluster). Twist = `DIST.lum-vs-app`: a fainter-looking star that is much farther and far more luminous (Rigel or Deneb). Payoff = M31 at 2.5 million ly [S19].
- **Minimum ingredients:** ≥5 objects with `distanceLy` spanning ≥3 orders of magnitude. A galaxy is preferred as the payoff; without one, the payoff is the most distant Milky Way object (a globular or a far cluster).
- **Core concepts:** `DIST.light-year`, `DIST.lum-vs-app`, `DIST.standard-candle` (optional), `SCALE.cosmic`.
- **Difference from A4:** A3 is about **how we know** (parallax, then clusters, then Cepheids, then galaxies). Its Deeper sections name the measuring method.

#### A4. Time Machine (light-travel-time ladder)

- **Driving question:** "How old is the light hitting your eye right now?"
- **Ordering principle:** `distanceLy` increasing. Each stop has a historical anchor: "this light left when ...".
- **Stops:** 4–7.
- **Arc:** hook = a star whose light left within the observer's lifetime ("this light left Vega when you were ..."; personalization is cheap if the user enters a birth year and powerful). Build = a medieval-era star (Betelgeuse, light left around 1400–1500 CE), an antiquity-era nebula (M42, light left around 700 CE), a cluster whose light predates writing. Payoff = M31: light that left before our species existed [S19]. Coda = "you are seeing all of these at once, each at a different moment".
- **Minimum ingredients:** ≥4 objects with `distanceLy` spanning ≥2 orders of magnitude, each with a `historyHook`. Without a galaxy, cap the ladder at the farthest cluster and use the "before the pyramids" style of anchor.
- **Core concepts:** `DIST.light-year`, `TIME.lookback`, `GAL.other` (payoff).
- **Honesty rule:** never imply that a nearby naked-eye star "may already be dead" (misconception MC5).

#### A5. Families and Siblings (clusters, associations and moving groups)

- **Driving question:** "Do stars have families?"
- **Ordering principle:** from tight to loose (embedded cluster → compact young cluster → older cluster → dissolving association or moving group), or by increasing age.
- **Stops:** 4–6.
- **Arc:** hook = a jewel-box cluster (Pleiades, Double Cluster). Build = clusters that loosen with age (Hyades, Coma Cluster). Twist = the stars of the Big Dipper are mostly one family, the Ursa Major moving group, scattered across the sky. Payoff = "the Sun's own siblings are lost: it was born in a cluster that dissolved long ago". Coda = a naked-eye look at Orion's belt as a family (Orion OB1).
- **Minimum ingredients:** ≥3 clusters or associations with known ages spanning ≥1 order of magnitude, or ≥2 clusters plus 1 association or moving group.
- **Core concepts:** `LIFE.cluster-birth`, `MW.families`, `LIFE.cluster-age`.

#### A6. Same X, Different Y (contrasts)

- **Driving question:** depends on the pair. "Why do these two neighbors look so different?" or "Birth or death? Both are glowing clouds."
- **Ordering principle:** pairs. Every stop shares ≥1 salient attribute with its predecessor and differs strongly on ≥1 axis (section 4.3). Usually 2 or 3 pairs.
- **Stops:** 4–6 (2 or 3 contrast pairs).
- **Arc:** hook = the most visible pair (Betelgeuse vs Rigel: same constellation, opposite colors, both supergiants). Build = a second pair on a new axis (Pleiades vs Hyades: both clusters, different ages). Payoff = the deepest pair (M42 vs a planetary nebula: both glowing gas, one is birth and the other is death).
- **Minimum ingredients:** ≥2 contrast pairs whose contrast score is ≥0.6 (see feature `F4`).
- **Core concepts:** varies by pair. The journey's "big idea" is the property that explains each difference.

#### A7. Record Breakers (superlatives)

- **Driving question:** "What are the most extreme things you can see tonight?"
- **Ordering principle:** by category, not magnitude. Each stop holds a different record (biggest, hottest, most luminous, oldest, youngest, farthest), and each record leads to the next ("biggest" → "but not most luminous; that's ...").
- **Stops:** 4–7.
- **Arc:** hook = the biggest star you can see. Build = the hottest, the youngest family, the oldest cluster (a globular). Payoff = the farthest object (M31). Coda = "and the most ordinary star of all: the Sun".
- **Minimum ingredients:** ≥4 objects that each carry a `superlatives` claim with scope "visible tonight from this site". The scope must be honest and computed for tonight; the assembler may only claim "biggest star in tonight's sky" if the KB scope supports it.
- **Risk:** this archetype drifts into trivia. The scorer penalizes it unless each link says why the record holder is extreme (for example, "most luminous because most massive").

#### A8. How Stars Die (fates)

- **Driving question:** "Will the Sun explode?" (No.)
- **Ordering principle:** two branches by mass. Light stars: giant → planetary nebula → white dwarf. Heavy stars: supergiant → supernova remnant → neutron star. The journey alternates or finishes one branch and then the other, and ends with `LIFE.recycling`.
- **Stops:** 4–6.
- **Arc:** hook = an aging giant like the Sun's future (Arcturus, Aldebaran). Build = a planetary nebula (M27, NGC 7293 or NGC 3242, depending on season). Twist = "a planetary nebula has nothing to do with planets" (MC8). Then the heavy branch: a supergiant (Antares, Betelgeuse, Deneb) and a remnant (Veil, M1). Payoff = the remnant plus recycling.
- **Minimum ingredients:** ≥1 giant or supergiant, ≥1 `pn` or `snr` with `obsDifficulty` ≤ 3 (or ≤4 with a fallback), and a Moon that is no more than slightly illuminated (PNs and SNRs suffer in moonlight).
- **Core concepts:** `STAR.mass-fate`, `LIFE.giant`, `LIFE.pn-wd`, `LIFE.supernova`, `LIFE.recycling`.

#### A9. Seeing Double (multiplicity)

- **Driving question:** "Is that one star, or two, or six?"
- **Ordering principle:** wide to tight separation (an easy-to-hard skill ramp), or optical-pair-to-physical-system (concept ramp).
- **Stops:** 4–6.
- **Arc:** hook = Mizar & Alcor (naked-eye double). Build = a color double (Albireo), a "double double" (ε Lyr) in steady binoculars. Twist = "true pair or chance alignment?" (Albireo is debated [S16]). Payoff = a multiple system with a story (Mizar: the first telescopic double, and later spectroscopic binaries) or Algol (an eclipsing pair seen as a "winking" star).
- **Minimum ingredients:** ≥3 doubles with `sep` ≥ the instrument's practical limit (about 30″ for 10×, more for shaky hand-held), plus ≥1 with documented physical status. **Moon-friendly.**
- **Core concepts:** `SKY.projection`, `MULT.doubles`, `MULT.weighing`, `VAR.eclipsing` (optional).
- **This archetype may break the "no 3 consecutive same family" variety rule.**

#### A10. Stars That Change (variability)

- **Driving question:** "Aren't stars constant?"
- **Ordering principle:** by mechanism: eclipse (Algol) → pulsation (δ Cep, Mira) → irregular or dust (Betelgeuse's Great Dimming [S14]).
- **Stops:** 3–5.
- **Arc:** hook = a star currently at an interesting brightness. This needs ephemerides (Algol minima, Mira's phase). Without them, use the reliably striking ones. Build = compare each variable with nearby reference stars ("is it brighter than X tonight?"). This involves the observer, which maintains interest [S2]. Payoff = δ Cep and the standard-candle idea leading to the distance of galaxies, or the Betelgeuse dimming story.
- **Minimum ingredients:** ≥3 variables visible, ≥1 with comparison stars inside one binocular field. **Moon-friendly.**
- **Core concepts:** `VAR.eclipsing`, `VAR.pulsating`, `DIST.standard-candle`.
- **Special feature:** this is the one archetype where the observer records a measurement. Cards ask "brighter or fainter than star X?", and the app stores the answer locally.

#### A11. Inside Our Galaxy (Milky Way structure)

- **Driving question:** "Where are we in the Milky Way?"
- **Ordering principle:** from the galactic plane outward: a dense star field along the band → nurseries and young clusters in the plane → a globular in the halo → an external galaxy.
- **Stops:** 4–6.
- **Arc:** hook = sweep the Milky Way band in Cygnus or Sagittarius ("you are looking along the disk"). Build = nursery and young cluster in the plane, then a globular off the plane ("older than the Sun, in the halo"). Payoff = M31 ("this is what our galaxy would look like from outside"). Coda = turn back to the band.
- **Minimum ingredients:** a visible Milky Way at a dark site (Bortle ≤ 5 and no bright Moon), ≥1 globular, and ≥1 galaxy, or a globular as payoff.
- **Core concepts:** `MW.disk`, `MW.halo`, `GAL.other`, `SCALE.cosmic`.
- **Regional tension:** the plane and M31 can be about 40° apart. Allowed only if the region constraint (owned by the constraints doc) accepts it. Otherwise end on the globular.

#### A12. Moonlit Sky (a constraint archetype, not a theme)

- **When it applies:** the Moon is bright (illumination above about 60% and the Moon up) and diffuse objects are excluded by the visibility model.
- **Content:** re-weights A2, A9 and A10 and bright open clusters. A card states this honestly ("tonight's Moon washes out nebulae; it can't hide color or doubles") rather than offering a degraded nebula tour.

### 3.2 Archetype selection matrix (for the assembler)

| Archetype | Moon bright OK? | Needs dark site? | Good for kids? | Default stops |
|---|---|---|---|---|
| A1 Cradle to Grave | partly (nursery suffers) | helpful | yes | 5–6 |
| A2 Thermometer | **yes** | no | **yes** | 5 |
| A3 How Far | partly | helpful (galaxy) | ok | 6 |
| A4 Time Machine | partly | helpful | **yes** | 5 |
| A5 Families | yes (bright clusters) | no | ok | 5 |
| A6 Contrasts | depends on pairs | depends | yes | 4–6 |
| A7 Record Breakers | partly | helpful | **yes** | 5 |
| A8 How Stars Die | no | yes | ok | 5 |
| A9 Seeing Double | **yes** | no | yes | 5 |
| A10 Stars That Change | **yes** | no | ok | 4 |
| A11 Inside Our Galaxy | no | **yes** | ok | 5 |
| A12 Moonlit | (it *is* the moon case) | no | yes | 4–5 |

Theme evolution along the path, which the product vision asks for: an A1 journey naturally evolves (giant → remnant → nebula). The assembler may also **chain** two archetypes once: the payoff of one becomes the hook of the next. A3 into A4 works, as do A2 into A1 (color, then "why is the red one dying?") and A9 into A10 (doubles, then Algol). Chaining is capped at one switch per journey, and the switch must be announced in the transition text.

---

## 4. Computable criteria for path quality

These features are computed for every candidate journey. They feed the learned scorer, and some are also hard or soft gates. Notation: a journey has stops `s_1 … s_N`. `C(s)` is the set of concepts the stop teaches with strength ≥2. `T` is the journey's theme concept set, defined by the archetype.

### 4.1 Hard gates (reject the candidate)

| Gate | Rule |
|---|---|
| G1 Visibility | Every stop passes the visibility, altitude, Moon and binocular gates (owned by the constraints/astronomy doc). |
| G2 Region | Passes the regional compactness constraint (owned by the constraints doc). |
| G3 Archetype ingredients | Satisfies the minimum ingredients of section 3.1. |
| G4 Link coverage | Every consecutive pair has ≥1 link of type other than `SPATIAL_ONLY`. |
| G5 Accuracy | Every factual claim used in the plan (superlatives, ordering facts such as "older than") comes from a cited KB field. Superlative scopes are valid for tonight. |
| G6 Length | 3 ≤ N ≤ 10. |
| G7 Payoff observability | The payoff has `obsDifficulty` ≤ the persona or sky maximum, or has a declared fallback. |

### 4.2 Scored features

| ID | Feature | Definition | Good range | Informs rubric |
|---|---|---|---|---|
| F1 | Theme coverage | fraction of stops with `C(s) ∩ T ≠ ∅` | ≥0.8 | R1 |
| F2 | Concept continuity | mean over consecutive pairs of Jaccard(`C(s_i)`, `C(s_{i+1})`), using concept plus parent concept | 0.15–0.5 (too high is repetitive) | R1, R4 |
| F3 | Prerequisite violations | count of stops whose primary concept has a prerequisite not taught earlier, not in the learned set, and not bridged | 0 (each bridge costs 1 load unit) | R2 |
| F4 | Contrast score | per pair: `max_axis Δnorm(axis)` × `[shares ≥1 attribute]`, where the axes are log10 `teffK`, log10 `distanceLy`, log10 `ageMyr`, log10 `radiusSun`, `evoStage`, and family. Δnorm uses KB-wide percentile ranks. Report the mean and the max. | mean ≥0.35, max ≥0.6 | R4 |
| F5 | Ordering monotonicity | Kendall τ between position and the archetype's ordering axis (A1 `evoStage`, A2 `teffK`, A3/A4 `distanceLy`, A5 age). Hook and coda excluded. | ≥0.8 | R2, R1 |
| F6 | Family variety | Shannon entropy of `roles`/family across stops, normalized by log(N); plus the count of runs of ≥3 identical families | entropy ≥0.6; runs = 0 (except A9) | R4 |
| F7 | Payoff position | `argmax(wow + insight)` / N | ≥0.67 | R5 |
| F8 | Hook quality | `wow(s_1) ≥ 3 ∧ obsDifficulty(s_1) ≤ 2` (boolean); plus wow(s_1) | true | R5, R7 |
| F9 | Peak-end value | (max(wow+insight) + (wow+insight)(s_N)) / 2 | high | R5 |
| F10 | Callback | the last link or coda refers to the hook's object or concept (boolean) | true | R5, R1 |
| F11 | New terms per stop | max and mean over stops of newly introduced terms (concept terms not seen earlier in the journey or the learned set) | max ≤2, total ≤8 | R6 |
| F12 | Concept load | count of distinct core concepts with strength 3; count of bridges | 2–4 core, ≤1 bridge | R6 |
| F13 | Difficulty ramp | Spearman ρ(position, `obsDifficulty`), max upward jump, `obsDifficulty(s_1)` | ρ ≥0.3, jump ≤2 (a flagged challenge coda with fallback is exempt), start ≤2 | R7 |
| F14 | Visibility margin | min over stops of the modeled visibility margin (altitude above the floor, Moon penalty headroom) | higher is better | R7 |
| F15 | Link strength | mean link weight (table 4.3) over pairs; min link weight | mean ≥0.75, min ≥0.4 | R3 |
| F16 | Spatial flow | total angular path length, max hop, number of direction reversals (sign changes of azimuth step beyond 20°) | low reversals | R7 (also a constraint) |
| F17 | Duration | estimated minutes (per-stop dwell by difficulty plus hop time) | 30–60 | R6, R7 |
| F18 | Wonder density | fraction of stops with `insight` ≥4 or a superlative or a twist | 0.3–0.6 | R8 |
| F19 | Misconception confrontation | number of stops tagged with a misconception and placed in a twist role | 1 | R8, R2 |
| F20 | Novelty vs history | fraction of stops and archetype not seen in this device's last 5 journeys | ≥0.5 | R8 (persona-level) |

### 4.3 Link-reason types (the transition vocabulary)

| Type | Weight | When it applies | Example |
|---|---|---|---|
| `NEXT_STAGE` | 1.0 | `evoStage(b) = evoStage(a) + 1` (or the next on the same mass branch) | M42 → Pleiades: "the same kind of family, 100 million years later" |
| `SAME_X_DIFF_Y` | 1.0 | shares ≥1 attribute and contrast ≥0.6 on another axis | Betelgeuse → Rigel: same constellation and both supergiants, opposite temperature |
| `CAUSAL` | 0.9 | an authored link: b explains, powers or produced a | θ1 Ori C → M42; Crescent Nebula (NGC 6888) ← WR 136's wind |
| `SAME_FAMILY` | 0.9 | same association, moving group or birth cloud | Orion's belt → M42 (Orion OB1) |
| `SCALE_STEP` | 0.8 | distance, size or age grows by ×2–×1000 | Hyades → Pleiades → M42 |
| `PREDICTION` | 0.8 | b shows a's future or past | Pleiades → Hyades ("the Pleiades in 500 million years") |
| `SUPERLATIVE_CHAIN` | 0.6 | b beats a on a record, or holds a different record that a's card set up | biggest → most luminous |
| `SAME_TYPE_VARIANT` | 0.4 | another example of the same thing | open cluster → open cluster |
| `SPATIAL_ONLY` | 0.2 | only "it's nearby" | allowed only as a secondary reason |

Each transition text names its type internally. The UI may show a small label ("Next stage", "Contrast").

### 4.4 Scalar quality and the learned scorer

Phase 1 hand-weighted baseline, used to bootstrap labeling:

```
Q = 0.20·norm(F1,F5) + 0.15·(F15) + 0.15·(F4) + 0.15·(F7,F8,F9,F10 combined)
  + 0.10·(1 − load_penalty(F11,F12,F3)) + 0.10·(F13,F14 combined) + 0.10·F6 + 0.05·F18
```

Phase 2: train a pairwise ranker (logistic regression on feature differences, or gradient-boosted trees with a pairwise objective) on the labels from section 5. Use the hand-weighted Q only as a fallback and for choosing which pairs to label (active learning on near ties). Small decision trees stay inspectable and can be exported as JSON for the offline client, which matches the product vision's "decision trees" preference. Per-persona weight vectors (section 7) are applied as a final re-weighting or as a persona feature.

---

## 5. Labeling rubrics (1–5) for human judges or simulated students

### 5.1 Protocol

1. **Label the plan, not the prose.** Each item is the plan skeleton: archetype, driving question, ordered stops with role, short why-selected line and link type plus a one-line link reason, and tonight's conditions summary. Card prose is labeled separately with rubric C (5.3). This keeps the scorer's target about assembly.
2. **Pairwise first.** Show two candidate journeys for the same conditions and persona. Ask "Which would you rather do tonight?" and "Which teaches more clearly?", then the 1–5 rubric for each. Fit Bradley-Terry or Elo scores from the pairwise answers. The rubric scores act as auxiliary targets and diagnostics.
3. **Calibration anchors.** Before each labeling session, a judge rates 6 gold journeys with known scores (two 1–2s, two 3s, two 4–5s). Disagreement by more than 1 on more than 2 dimensions leads to recalibration.
4. **Reliability target.** Krippendorff's α ≥ 0.67 per dimension across judges (human or simulated personas at temperature > 0). A dimension below that has its anchors rewritten.
5. **Accuracy (R9) is a gate.** Any factual error a judge flags removes the item from training and files a KB bug.

### 5.2 Plan rubric (R1–R8)

**R1 Coherence and story**
- 1: A random list of objects. No discernible theme, or the theme is only "they're in the same area".
- 2: A theme is named, but ≥2 stops don't serve it, or the order looks arbitrary.
- 3: Every stop relates to the theme, but the order could be shuffled without loss.
- 4: Clear theme and meaningful order. The driving question is answered at the end.
- 5: Reads like a story. Each stop is needed, the order is the argument, and the end returns to the beginning with new meaning.

**R2 Progression and scaffolding**
- 1: Requires concepts never introduced (for example, a turn-off age before color = temperature). Overwhelming or confusing.
- 2: One or two concepts arrive before their prerequisites, without a bridge.
- 3: Prerequisites are respected, but stops don't build: each is a separate lesson.
- 4: Each stop uses what the previous one taught. One small gap, bridged.
- 5: A clean ladder. By the last stop the observer can explain something they could not at the start, using ideas from earlier stops.

**R3 Transitions (link reasons)**
- 1: Transitions are missing, or only "next, nearby".
- 2: Most transitions are generic ("another nice cluster").
- 3: Every transition has a real reason, but some are weak (`SAME_TYPE_VARIANT`).
- 4: Most transitions are next-stage, contrast, causal or family links. The observer knows why they're moving.
- 5: Every transition opens a question that the next stop answers. Moving feels inevitable.

**R4 Contrast and variety**
- 1: Monotonous: the same kind of object over and over with nothing new to see.
- 2: Some variety, but consecutive stops look and mean the same thing.
- 3: Reasonable mix of object types. Contrasts exist but aren't highlighted.
- 4: Consecutive stops differ in a way the observer can see (color, size, texture) and that means something.
- 5: Deliberate "same X, different Y" pairs. The variety itself teaches.

**R5 Arc and payoff**
- 1: Starts with the best object, then declines, or ends on the dullest or hardest stop.
- 2: Flat: no stop stands out, or the peak is in the middle and the end fizzles.
- 3: A reasonable opening and a decent ending, but the peak is not where the story peaks.
- 4: Easy, striking hook. The peak falls in the final third and answers the question.
- 5: Hook, build, twist, payoff and callback all present. The ending is the most memorable moment.

**R6 Cognitive load**
- 1: Jargon-heavy, with many numbers and concepts per stop. A beginner would give up by stop 2.
- 2: Too many new terms on some stops (≥3), or more than 5 core concepts overall.
- 3: Manageable, but one or two stops are crowded.
- 4: About one new idea per stop. Terms are reused.
- 5: Feels effortless. The few new terms are each earned and reused, and the observer leaves with 2–4 ideas they can repeat.

**R7 Observability and flow**
- 1: Stops are hard to find or see under the stated conditions, or the path zig-zags across the sky.
- 2: One stop is unrealistic (too faint, too low, washed out), or there is a big back-and-forth.
- 3: Everything is findable, but difficulty jumps around, or the path is longer than needed.
- 4: Easy start, gentle ramp, compact path. One challenge stop with a fallback.
- 5: Feels designed for tonight and this instrument. Each find builds skill for the next.

**R8 Wonder and curiosity**
- 1: Encyclopedic. Nothing surprising.
- 2: One interesting fact, otherwise dry.
- 3: Some memorable moments, but no twist or emotional peak.
- 4: At least one "wait, really?" moment and a strong payoff. The observer wants to tell someone.
- 5: The observer wants another journey. It changes how they see the night sky with the naked eye.

**R9 Accuracy and honesty (gate, yes or no)**
- No if any claim is false or out of date, a superlative scope is wrong, a photo is presented as the eye's view, or an uncertain number has no "about" or range.

**Overall (1–5)** is holistic. It must not exceed min(R1, R7) + 1: a beautiful story you can't observe, or an observable list with no story, cannot score 5.

### 5.3 Card rubric (C1–C6, for card text and templates)

| Dim | 1 | 3 | 5 |
|---|---|---|---|
| C1 SEE honesty | describes the photo | describes the view vaguely | tells exactly what binoculars show tonight, where to look and what not to expect |
| C2 UNDERSTAND clarity | wrong, or jargon soup | correct, but abstract | one idea, one analogy, tied to what is in the field |
| C3 Scale and analogy | raw numbers only | one comparison | a vivid, accurate comparison at human scale |
| C4 WONDER | absent or off-topic trivia | an interesting fact | a surprising fact that deepens the main idea |
| C5 CONNECT | absent | names the next stop | opens a question the next stop answers, or a callback |
| C6 Length and readability | >300 words or > grade 12 | 220–300 words | ≤220 words, about grade 8–9, glanceable |

---

## 6. Card writing guidelines

### 6.1 Card structure (fixed order; signaling [S8])

```
[Stop n of N · Role badge (Hook/Build/Twist/Payoff/Coda) · Link-type chip]
TITLE — common name (designation)
WHY HERE          1 sentence: why this object was selected for THIS journey (its role/superlative).
FROM THE LAST STOP 1–2 sentences: the transition (only stops 2..N). Hop directions are handled by the existing star-hop UI.
SEE               40–70 words. What the binocular view shows, where to look in the field, one thing to try
                  (averted vision, defocus for color, compare with star X). What NOT to expect.
UNDERSTAND        60–110 words. One concept. One analogy. Tied to what is in view.
WONDER            1–2 sentences. One striking, on-topic fact or scale comparison.
CONNECT           1 sentence. Teaser for the next stop (open a gap) or callback to the hook.
NUMBERS           ≤5 rows: Distance · Age · Size/Temperature/Mass (as relevant). Rounded, with "about"/ranges.
PHOTO CAPTION     1 sentence: what the photo shows that your eye won't (color, faint wisps), plus the credit.
DEEPER (collapsed) 80–150 words for engineers and returning amateurs: how we know (method), caveats, numbers with uncertainty.
SOURCES (collapsed)
```

- **Main text length** (WHY + FROM + SEE + UNDERSTAND + WONDER + CONNECT): 220 words or fewer. That is about 60–90 seconds of reading, which suits red-light glancing between looks.
- **Reading level:** about grade 8–9 (Flesch-Kincaid). Short sentences in the second person, present tense: "you are looking at ...".
- **Kid mode:** the same structure with a 120-word main text, one analogy, and a "Try this" action in SEE.

### 6.2 Numbers and scale

- Light-years are the primary distance unit. Parsecs appear only in DEEPER.
- Round to 2 significant figures in the main text ("about 1,300 light-years", not "1,344"). Give a range when the literature disagrees by more than 20% (Betelgeuse: "about 500–650 light-years").
- Each headline number gets a human-scale comparison. Use standard reference scales consistently across cards:
  - Size: "if it replaced the Sun, its surface would reach past Mars" (orbits), Earth-to-Sun = 1 AU only in DEEPER.
  - Temperature: compare with the Sun's surface, about 5,800 K [S21], and with everyday objects carefully. A stove ring glows red at about 1,000 K. Mention the "red is cool" inversion explicitly.
  - Time: anchor light-travel times and ages to history and geology (dinosaurs, pyramids, the first humans). Each anchor must be checked.
  - Distance: "if the Sun were a grain of sand ..." scale models, used once per journey at most to avoid fatigue.
- At most 3 headline numbers in the main text. Everything else goes in NUMBERS or DEEPER.

### 6.3 Analogies (approved patterns)

| Concept | Analogy | Limits to state, or avoid |
|---|---|---|
| color = temperature | the glow of a stove ring, from dull red to orange to white-hot | Don't use "blue flame" without noting that it's chemistry; keep it to glowing hot metal. |
| luminosity vs apparent brightness | a candle close by vs a lighthouse far away | none |
| star clusters | siblings born in the same family home who slowly move out | none |
| cluster age from color | a birthday cake with candles of different lengths: the big ones burn out first | Heavy stars burn hotter and shorter. Avoid "fire" literalism by saying "like" and pointing to fusion. |
| nebula glowing | a neon sign: gas glows when energized | none |
| planetary nebula | a smoke ring puffed out by a dying star | Explicitly say there are no planets involved (MC8). |
| lookback | a letter that took 1,300 years to arrive | none |
| supergiant size | a ball wider than Mars's orbit, yet thinner than the air you breathe in its outer layers | Density claims must be checked against KB data. |

### 6.4 Jargon policy

- **Allowed with a gloss on first use:** nebula, cluster, light-year, giant or supergiant, white dwarf, supernova, fusion, galaxy, binary, variable.
- **DEEPER only:** magnitude numbers (the main text uses "brightness" and comparisons), spectral classes (OBAFGKM), parsec, H II region, main sequence (in the main text say "its long, steady adult life"), turn-off, ionization (in the main text say "energized").
- **Banned:** unexplained acronyms, "simply" and "obviously", and adjectives without referents ("massive" without "about 20 times the Sun's mass").

### 6.5 Misconceptions the cards must address

Each KB object can carry misconception IDs. Twist stops should confront one.

| ID | Misconception | Correct idea | Best place |
|---|---|---|---|
| MC1 | Brighter stars are closer. | Brightness depends on luminosity and distance (Rigel is far but extremely luminous). [S5][S6] | A3, A6, Rigel |
| MC2 | Red means hot and blue means cold. | Red stars are the cool ones (everyday color coding is backwards). | A2, Betelgeuse vs Rigel |
| MC3 | Stars burn like fire. | Stars shine by nuclear fusion; fewer than 10% of surveyed students knew this [S6]. | any main-sequence star, A1 build |
| MC4 | All stars are about the same size, or the Sun is big. | From city-sized neutron stars to supergiants wider than Mars's orbit. | A7, Betelgeuse |
| MC5 | Many stars you see may be long dead. | Most naked-eye stars are under a few thousand light-years away, and their lifetimes are millions to billions of years. Almost all are still there. | A4 |
| MC6 | Betelgeuse will explode any day now. | Probably in about 100,000 years [S13]; the 2019–20 dimming was dust [S14]. | Betelgeuse |
| MC7 | Nebulae look like the photos. | The eye sees a grey or faintly greenish glow; cameras collect color for hours [S20]. | every diffuse object |
| MC8 | Planetary nebulae have to do with planets. | It's a historical name for a dying star's shell. | A8 |
| MC9 | Stars in a constellation are close together. | It's perspective (Aldebaran is in front of the Hyades). | `SKY.projection` |
| MC10 | A double star is always an orbiting pair. | Some are chance alignments, and some are unresolved debates (Albireo [S16]). | A9 |
| MC11 | Twinkling means the star is pulsing or variable. | Twinkling is our atmosphere. Variability is in the star, over hours to years. [S7] | A10 |
| MC12 | The Milky Way is something "over there". | It is our galaxy, seen edge-on from inside. | A11 |
| MC13 | Clusters stay together forever. | Open clusters dissolve over hundreds of millions of years. | A5 |
| MC14 | The Pleiades' blue haze is the cloud they were born from. | It is a different cloud they are passing through [S18]. | Pleiades |
| MC15 | A light-year is a unit of time. | It's a distance. | first use of `DIST.light-year` |

### 6.6 Example cards

Context: these three cards belong to the example A1 journey "Cradle to Grave in the Winter Sky" (section 3.1). Stop 1 is M42 (Hook), stop 3 is the Pleiades (Build), and stop 5 is Betelgeuse (Payoff). The texts below are the target style and length.

---

#### Card: M42 — the Orion Nebula

`Stop 1 of 6 · HOOK · Link: —`

**WHY HERE** — This is the brightest star nursery in the northern sky, and the start of every star's story: birth.

**SEE** — Below Orion's belt, the "sword" hangs as a short line of stars. Its middle "star" is fuzzy. That fuzz is the nebula, a soft grey-green glow about the size of the full Moon around a tight knot of stars. Look slightly to one side of it (averted vision) and the glow spreads into wings. Don't expect the reds and pinks of photographs: your night vision barely sees color [S20].

**UNDERSTAND** — You are looking at a cloud of gas and dust where stars are being born right now. At its heart sits a small group of very young, very hot stars called the Trapezium. Their ultraviolet light energizes the surrounding hydrogen, and the hydrogen glows like the gas in a neon sign [S15]. The cloud is lit from the inside by its own newborn stars.

**WONDER** — The cluster at its center is only about one to two million years old [S15]. When it began to shine, our ancestors were already walking upright on Earth. Hubble has photographed young stars here wrapped in dusty disks: planetary systems in the making [S22].

**CONNECT** — These newborns are still inside their cocoon. What will this family look like once the cloud has blown away? Our next stops show you.

**NUMBERS** — Distance about 1,350 light-years [S12] · Cluster age about 1–2 million years [S15] · Light you're seeing left around 700 CE.

**PHOTO CAPTION** — The long-exposure photo records red hydrogen glow and fine dust lanes that are too faint in color for the eye. In binoculars, expect a grey-green mist around a bright knot.

**DEEPER** — The distance was measured by radio parallax of young stars in the cluster: 414 ± 7 parsecs (Menten et al. 2007) [S12]. Most of the ionizing light comes from θ¹ Orionis C, a close massive binary with a combined mass of tens of Suns [S15]. The visible nebula is a thin blister on the near side of a much larger molecular cloud. Visually, the faint greenish tint comes from doubly ionized oxygen [S20].

---

#### Card: The Pleiades (M45)

`Stop 3 of 6 · BUILD · Link: NEXT_STAGE (from M42 via Orion's belt)`

**WHY HERE** — It's a star family about 100 times older than the Orion Nebula's newborns. The cloud is gone, and the family is out in the open.

**FROM THE LAST STOP** — In Orion the stars were still hidden in their birth cloud. Here you see the same kind of family more than 100 million years later [S17], fully unwrapped.

**SEE** — With the naked eye you see a tiny dipper of six or seven stars. In binoculars it becomes dozens of blue-white jewels filling about a third of your view. Notice how similar in color the brightest stars are: all bluish-white. Under very dark skies, faint haze around the brightest stars is just possible, but usually photographic.

**UNDERSTAND** — All these stars were born together from one cloud, so they are siblings of the same age. Their blue-white color tells you they are hot. The hottest, heaviest stars burn their fuel fastest. The Pleiades still have some, and that is how we know the cluster is young by star standards.

**WONDER** — The cluster formed around the time dinosaurs roamed the Earth [S17]. The blue haze in photographs is not leftover birth cloud: the cluster is drifting through an unrelated cloud of dust [S18].

**CONNECT** — Families don't stay together forever. Next, a cluster several times older, with an orange intruder in front of it.

**NUMBERS** — Distance about 440 light-years [S17] · Age about 100–130 million years [S17] · Members: over a thousand identified by Gaia [S23].

**PHOTO CAPTION** — The photo shows blue dust lit by the stars, collected over a long exposure. Binoculars show the stars, and rarely the haze.

**DEEPER** — Gaia parallaxes put the cluster at about 135–136 pc, which settled the "Pleiades distance controversy" with Hipparcos (about 120 pc) [S17]. The age comes from the lithium-depletion boundary: the faintest stars that still hold their lithium mark the cluster's age, with estimates of about 110–130 million years [S17]. The nebula's gas moves at a different speed from the stars, which shows it is a chance encounter [S18]. Galileo sketched 36 Pleiades stars with his first telescope (*Sidereus Nuncius*, 1610).

---

#### Card: Betelgeuse (α Orionis)

`Stop 5 of 6 · PAYOFF · Link: SAME_X_DIFF_Y / PREDICTION (from the Hyades & Aldebaran)`

**WHY HERE** — This is one of the biggest stars you can see with your own eyes, and it is near the end of its life. This is where heavy stars go.

**FROM THE LAST STOP** — Aldebaran was an orange giant, an aging star. Betelgeuse is the same story told by a star about 15–20 times heavier than the Sun [S13], and it's living fast and dying young.

**SEE** — Orion's left shoulder (upper left as Orion rises in the evening). Compare it with blue-white Rigel at Orion's opposite corner by swinging between the two. Turn the focus slightly out of sharpness: the star spreads into a disk and its orange-red color becomes much easier to see.

**UNDERSTAND** — Betelgeuse is a red supergiant. It ran through its core hydrogen in a few million years and swelled enormously. Its surface cooled to about 3,600 degrees (the Sun's is about 5,800), and that is why it's orange-red [S24][S21]. Cool but extremely bright means it must be huge: if it replaced the Sun, its surface would reach beyond the orbit of Mars [S13].

**WONDER** — In 2019–2020 it faded noticeably, and people wondered whether it was about to explode. Telescopes showed that it had burped out a cloud of dust that briefly veiled it [S14]. The real explosion is probably about 100,000 years away [S13].

**CONNECT** — What will it leave behind? One last, challenging stop: the shredded remains of a star that did explode, nearly a thousand years ago.

**NUMBERS** — Distance about 500–650 light-years [S13] · Size about 750 times the Sun [S13] · Surface about 3,600 K [S24] · Mass about 15–20 Suns [S13].

**PHOTO CAPTION** — Even the largest telescopes see Betelgeuse's surface only as a few pixels. Illustrations of its bubbling surface are models, not photos.

**DEEPER** — Joyce et al. (2020) combined pulsation periods with evolution models. They found Betelgeuse in early core-helium burning, with a mass of 16.5–19 Suns, a radius of about 764 (+116/−62) solar radii and a distance of 168 (+27/−15) pc [S13]. Other analyses disagree on its evolutionary phase [S25]. The spectrum taken during the Great Dimming showed only a modest temperature drop, which pointed to dust rather than cooling [S24]. ESO's VLT imaged the dusty veil directly [S14].

---

### 6.7 Example transition texts

Transitions appear as FROM THE LAST STOP on the next card, and as a short banner during the hop.

**Transition A — M42 (via Orion's belt) → Pleiades (`NEXT_STAGE`, `SCALE_STEP` in time)**

> You've just seen stars being born inside their cloud. Now fast-forward roughly a hundred million years. The newborns' hot winds and light blow their cradle away, and what's left is a bare family of stars drifting through space together. We're going to a family at exactly that stage. From the belt, head up past orange Aldebaran to the little dipper of the Pleiades. As you arrive, ask yourself: are the stars all the same color, and what would that mean?

(78 words. Ends with a question that the Pleiades card's UNDERSTAND section answers.)

**Transition B — Hyades & Aldebaran → Betelgeuse (`PREDICTION` and `SAME_X_DIFF_Y`)**

> Aldebaran looked like the Hyades' brightest member, but it's a foreground star less than half as far away [S26][S27]. It's an orange giant, an aging star past its long, steady adult life. Keep that image. Now swing down-left to Orion's shoulder. Betelgeuse is the same chapter of life in a far heavier star, and heavy stars don't age gently. Compare the two colors as you go. Which one looks redder?

(73 words. Contains the twist, carries the giant concept forward, and sets up the payoff with an observing task.)

**Transition C (alternative A2/A6 journey) — Betelgeuse → Rigel (`SAME_X_DIFF_Y`)**

> Same constellation, same family of supergiant stars, and the opposite color. Slide across Orion to its right foot. Rigel's surface is about 12,000 degrees, more than three times hotter than Betelgeuse's [S28]. If color is a thermometer, you are about to read both ends of the scale in one constellation.

---

## 7. Simulated-student personas

Each persona is a prompt-level simulator. Run each one on candidate journeys (plan plus cards) for scoring and regression testing. Every persona returns the same JSON (7.5). The personas are deliberately different on the axes that matter: prior knowledge, attention, need for evidence and emotional drivers.

### P1 — Maya, the curious beginner adult (PRIMARY, default weights)

- **Profile:** 38, works in marketing, watched a space documentary and bought 10×50 binoculars. Knows the Big Dipper and Orion, and that's it. Suburban sky (Bortle 6), 45 minutes on a weekday evening, standing in the garden. Falk identity: explorer [S4].
- **Needs:** reassurance at stop 1 ("I found it!"); visible payoffs; a story she can retell over coffee tomorrow; no math.
- **Breaks the experience:** a hard object early, jargon, three clusters in a row that look alike, photos that promise what the eye won't deliver, and cards longer than she can read with cold hands.
- **How she judges:** "Did I find everything? Did I get it? Would I do another?"
- **Rubric weights:** R1 .15, R2 .10, R3 .10, R4 .10, R5 .15, R6 .15, R7 .15, R8 .10.
- **Success test:** after the journey she can say the takeaway in one sentence ("stars are born in clouds, live in families, and the big ones die young"), and she found ≥80% of the stops.

### P2 — Dan and Leo (9), parent with child

- **Profile:** Dan is a teacher, not an astronomer. Leo is 9 and enthusiastic, with an attention span of about 5 minutes per stop and 25 minutes in total. They share one pair of 8×42 binoculars and it's cold. Falk identity: facilitator [S4].
- **Needs:** 4 short stops; "Try this" actions (count stars, compare colors, which is brighter?); superlatives and vivid analogies; something Dan can read aloud in under 30 seconds; nothing scary or wrong ("Betelgeuse will blow up and kill us" must be headed off).
- **Breaks the experience:** faint fuzzies, long text, abstract concepts (lookback, turn-off), and waiting.
- **How they judge:** "Did Leo stay engaged? Did he ask a question?"
- **Rubric weights:** R1 .10, R2 .05, R3 .05, R4 .15, R5 .15, R6 .20, R7 .20, R8 .10.
- **Success test:** Leo answers "why is that star orange?" correctly, and wants to go out again.

### P3 — Rita, the returning amateur

- **Profile:** 61, had a small telescope in her twenties and knows the Messier list by name. Now uses 15×70 binoculars on a tripod at a dark site (Bortle 4). Falk identity: hobbyist / professional [S4].
- **Needs:** new connections between objects she already knows; updated science (Gaia distances, the Betelgeuse dimming explanation); challenge stops; DEEPER sections with methods; 6–8 stops.
- **Breaks the experience:** being talked down to; outdated numbers (Pleiades at 400 ly, "Betelgeuse may explode tomorrow"); only showpieces; wrong superlative claims.
- **How she judges:** "Did I learn something new about something old? Is it correct?"
- **Rubric weights:** R1 .15, R2 .10, R3 .20, R4 .15, R5 .10, R6 .05, R7 .10, R8 .15.
- **Success test:** she flags zero factual errors and names at least one link between objects she hadn't considered.

### P4 — Sam, the skeptical engineer

- **Profile:** 45, mechanical engineer, likes numbers and distrusts hype. Takes 10×50 binoculars along on hikes. Falk identity: explorer with a high need for evidence.
- **Needs:** "how do we know?" for every headline number; honest uncertainty; units; no anthropomorphism without a clear signal ("dying" as a metaphor is fine once it's explained); consistent scales across cards; a credible link from what he sees to the physics.
- **Breaks the experience:** unsourced superlatives; false precision (a 4-digit distance for Betelgeuse); "scientists believe" with no method; photos without exposure context; contradictions between cards (Pleiades age 100 Myr on one card and 125 on another).
- **How he judges:** "Is it rigorous and consistent? Would I trust the next claim?"
- **Rubric weights:** R1 .10, R2 .20, R3 .10, R4 .10, R5 .05, R6 .10, R7 .15, R8 .05, plus a double weight on the R9 gate.
- **Success test:** no inconsistency between cards; every NUMBERS row has a source and a range when the literature disagrees.

### 7.5 Simulation protocol and output schema

Inputs for each run: persona prompt, conditions (site, date and time, Moon, Bortle, instrument), the full journey (plan plus cards), and the instruction: "Walk through the journey stop by stop as this person. You cannot see photos, only read the captions."

```json
{
  "persona": "P1",
  "journeyId": "…",
  "perStop": [
    {"stop": 1, "foundIt": "yes|probably|no", "engagement": 1-5, "confusingTerms": ["…"],
     "question": "the question this person would ask now", "wouldContinue": true}
  ],
  "dropOffStop": null,
  "takeawaySentence": "what this person would tell a friend",
  "takeawayMatchesBigIdea": 1-5,
  "rubric": {"R1":1-5,"R2":1-5,"R3":1-5,"R4":1-5,"R5":1-5,"R6":1-5,"R7":1-5,"R8":1-5},
  "accuracyFlags": [{"stop": 3, "claim": "…", "why": "…"}],
  "overall": 1-5,
  "wouldDoAnother": true
}
```

- The assembler team uses `confusingTerms` to tune the jargon list and `question` to seed future card content. A missing answer to a common question becomes a KB task.
- In pairwise mode the persona receives two journeys and also returns `{"prefer": "A|B", "why": "…"}`.
- Simulated labels are cheap and biased. Calibrate them against at least a small human-labeled set (20–50 pairs) before trusting them for training, and track agreement between simulation and humans per dimension.

---

## 8. Recommendations to the other workstreams

### 8.1 To the KB authors

- Prioritize objects that carry **concepts**, not only showpieces. The binocular catalog (187 entries plus Messier) is rich in open clusters (92) and doubles (27). It is thin on what the life-cycle and fates arcs need: only 7 planetary nebulae (several hard in binoculars), 2 SNR entries (Veil), and 16 named stars. Add at least: Rigel, Aldebaran's giant role (cross-linked with the Hyades), Polaris (Cepheid), δ Cep (already present as a double; add variability), Mira (present), Algol (present), Antares (present), Deneb (present), Arcturus (present). Also M44, M45, M42, M8, M31 and M13 pedagogy entries (from `messier.json`), the Ursa Major moving group, Orion OB1, Collinder 69 and 70, the Hyades with Aldebaran as an authored `SKY.projection` twist, the Coma Cluster (Mel111) as an association, and the Alpha Persei Cluster (Mel20).
- Fill `teaches`, `roles`, `evoStage`, `wow`, `insight` and `obsDifficulty` for every object. Without them, the assembler cannot build arcs.
- Every number needs a source and a range. Use one canonical value per quantity across all cards; the engineer persona catches inconsistencies.

### 8.2 To the assembler and scorer implementers

- Implement archetypes as data (slot grammar JSON) and do not hard-code them. Candidate generation per archetype: beam search over KB objects that pass tonight's gates, filling slots in order and keeping the top K by the partial Q. Then score complete candidates with the learned ranker.
- Compute and store all F-features per candidate. They serve as labels' context, as debugging aids, and as UI explanations ("why this order?").
- Link-reason text comes from typed templates filled with KB fields, with authored `links` overriding them. Never generate a transition without a type.
- Keep `SPATIAL_ONLY` as a tie-breaker only.

### 8.3 To the UI implementers

- Store a per-device learned-concepts record (localStorage, alongside the existing session state) so that prerequisites can be skipped and later journeys go deeper. Offer a "What I learned" recap at the end listing the 2–4 concepts.
- Show the driving question at the start, and the answered question at the payoff.
- The red-light mode must keep cards readable. The 220-word limit exists because of it.
- For A10, add a single "brighter / same / fainter than star X" input.

---

## 9. Worked example: the scores for the example journey

"Cradle to Grave in the Winter Sky": M42 (Hook) → Orion's belt / Orion OB1 (Build, `SAME_FAMILY`) → Pleiades (Build, `NEXT_STAGE`) → Hyades & Aldebaran (Twist, `PREDICTION` + MC9) → Betelgeuse (Payoff, `SAME_X_DIFF_Y`/`PREDICTION`) → M1 (Coda, challenge, `CAUSAL`/`PREDICTION`, with fallback "look again at M42: Crab-like debris seeds clouds like it").

| Feature | Value (approx.) | Comment |
|---|---|---|
| F1 theme coverage | 1.0 | all stops teach a life-cycle concept |
| F5 monotonicity | about 0.9 | evoStage 0, 1, 2, 3, 5, 7 |
| F7 payoff position | 5/6 = 0.83 | Betelgeuse has the highest wow + insight among easy stops |
| F8 hook | true | M42: wow 5, difficulty 2 |
| F10 callback | true | via the M1 or M42 fallback coda |
| F11 new terms per stop | max 2 | nebula; cluster; giant; supergiant; supernova |
| F13 difficulty ramp | 2, 1, 1, 1, 1, 4 | the easy middle gives relief; the 1→4 jump is allowed only because M1 is a flagged challenge coda with a fallback |
| F16 spatial flow | 1 reversal (Taurus → Orion → Taurus) | the honest cost of story order. The constraints doc decides whether about 35° fits the region. The alternative flash-forward order (Betelgeuse → M42 → belt → Hyades → Pleiades → M1) has fewer reversals, but its F5 is lower. |

Expected labels: R1 5, R2 5, R3 4–5, R4 4, R5 5, R6 4, R7 3–4 (the reversal and the M1 challenge), R8 5. This journey is a good **gold anchor** for calibration (section 5.1). Its flash-forward variant is a good **pairwise partner**, because it isolates the story-order versus spatial-flow tradeoff, which is the most important thing for the scorer to learn.

---

## 10. Open questions for the orchestrator

1. **Region tolerance.** Life-cycle and galaxy-structure stories in the real sky sometimes need 30–40° spans or one reversal. The constraints doc should state whether a story-motivated single reversal within a compact region is allowed. My recommendation: allow one reversal when F15 is at least 0.85.
2. **Personalization.** Collect a birth year for the A4 time anchors ("this light left when you were 7")? It's high-impact and local-only, but it is personal data. My recommendation: make it optional and keep it on the device.
3. **Ephemerides for A10.** Algol minima and Mira phase need computation or a small table. Without them, A10 is weaker.
4. **The learned scorer's cold start** depends on simulated labels. Human labels are needed for calibration (at least 20–50 pairs). Who labels them?
5. **Photos.** Existing DSS2 and 2MASS cutouts are survey images, good for the "what the camera sees" caption. The pedagogy relies on honest captions, and on an optional "binocular-view simulation" image for SEE (owned by the media doc).

---

## 11. Sources

Learning science
- [S1] Loewenstein, G. (1994). *The Psychology of Curiosity: A Review and Reinterpretation*. Psychological Bulletin 116(1), 75–98. https://stafforini.com/works/loewenstein-1994-psychology-curiosity-review/
- [S2] Hidi, S., & Renninger, K. A. (2006). *The Four-Phase Model of Interest Development*. Educational Psychologist 41(2), 111–127. https://works.swarthmore.edu/fac-education/12
- [S3] Falk, J. H., & Dierking, L. D. (1992/2000). Contextual Model of Learning; *The Museum Experience*. https://en.wikipedia.org/wiki/The_Museum_Experience and https://informalscience.org/research/using-contextual-model-learning-understand-visitor-learning-science-center-exhibition
- [S4] Falk, J. H. (2006/2009). Identity-related visitor motivations (explorer, facilitator, professional/hobbyist, experience seeker, recharger). https://pacificsciencecenter.org/wp-content/uploads/2022/11/falk-2006-visitor-motivations.pdf
- [S5] Bailey, J. M. (2007). Development of a concept inventory to assess students' understanding and reasoning difficulties about the properties and formation of stars. Astronomy Education Review. https://www.compadre.org/portal/items/detail.cfm?ID=13738
- [S6] Bailey, J. M., Johnson, B., Prather, E. E., & Slater, T. F. (2012). Development and validation of the Star Properties Concept Inventory. IJSE 34. https://istardb.org/aerpublications/development-and-validation-of-the-star-properties-concept-inventory/ and https://istardb.org/aerpublications/development-of-a-concept-inventory-to-assess-students-understanding-and-reasoning-difficulties-about-the-properties-and-formation-of-stars/ ; PhysPort SPCI: https://physport.org/assessments/assessment.cfm?A=SPCI
- [S7] Comins, N. F. (2001). *Heavenly Errors: Misconceptions About the Real Nature of the Universe*. Columbia University Press; companion list: https://physics.umaine.edu/?p=4549
- [S8] Mayer, R. E. (2014). Principles for reducing extraneous processing in multimedia learning (coherence, signaling, ...). *Cambridge Handbook of Multimedia Learning*. https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/C98AB3A6CE760DD63C048936EA0B3B44
- [S9] Cowan, N. (2001). The magical number 4 in short-term memory. Behavioral and Brain Sciences 24(1), 87–114.
- [S10] Sweller, J. (1988). Cognitive load during problem solving. Cognitive Science 12(2), 257–285.
- [S11] Kahneman, D., Fredrickson, B. L., Schreiber, C. A., & Redelmeier, D. A. (1993). When more pain is preferred to less: Adding a better end. Psychological Science 4(6), 401–405 (peak-end rule).

Astrophysics (example cards and transitions)
- [S12] Menten, K. M., Reid, M. J., Forbrich, J., & Brunthaler, A. (2007). The distance to the Orion Nebula. A&A 474, 515–520 (414 ± 7 pc). https://ysoc.caltech.edu/ref_details/311 ; https://skyandtelescope.org/astronomy-news/the-orion-nebula-exactly/
- [S13] Joyce, M., et al. (2020). Standing on the Shoulders of Giants: New mass and distance estimates for Betelgeuse. ApJ 902, 63 (168 +27/−15 pc; R ≈ 764 R☉; 16.5–19 M☉; early core-He burning; about 100 kyr to explosion). https://uhra.herts.ac.uk/handle/2299/23307 ; https://arxiv.org/abs/2006.09837
- [S14] Montargès, M., et al. (2021). A dusty veil shading Betelgeuse during its Great Dimming. Nature 594, 365–368. https://www.eso.org/public/news/eso2109/
- [S15] Orion Nebula Cluster age (< 1–2 Myr, Hillenbrand 1997) and θ¹ Ori C as the main ionizing source (a massive binary of about 44 M☉ total, Kraus et al. 2009). https://ar5iv.labs.arxiv.org/html/0801.2584 ; https://www.arxiv.org/pdf/0902.0365v2
- [S16] Drimmel, R., et al. (2021). A new look at the Albireo system (A–B association unresolved). MNRAS. https://openaccess.inaf.it/handle/20.500.12386/32024?mode=full ; context: https://www.syfy.com/syfy-wire/just-how-many-stars-is-albireo-and-is-one-of-them-a-black-hole
- [S17] Pleiades distance (Gaia DR2 about 135 pc; VLBI 136.2 ± 1.2 pc) and age (lithium-depletion boundary about 110–130 Myr). https://arxiv.org/pdf/2309.10862 ; https://www.aanda.org/10.1051/0004-6361/201629103 ; https://arxiv.org/pdf/2408.05423
- [S18] Pleiades nebulosity as a chance encounter with an interstellar cloud (Gibson & Nordsieck 2003; White 2003). https://noirlab.edu/public/news/noao0315 ; https://spaceflightnow.com/news/n0311/12collision/
- [S19] NASA Hubble Messier catalog, M31: 2.5 million light-years. https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/
- [S20] Low-light vision (rods, Purkinje shift) and the visual color of M42. https://en.wikipedia.org/wiki/Purkinje_effect ; https://www.discovermagazine.com/skylights-15450
- [S21] IAU 2015 Resolution B3: nominal solar effective temperature 5,772 K (rounded to about 5,800 K in cards).
- [S22] O'Dell, C. R., Wen, Z., & Hu, X. (1993). Discovery of new objects in the Orion Nebula on HST images: shocks, compact sources, and protoplanetary disks. ApJ 410, 696.
- [S23] Lodieu, N., Pérez-Garrido, A., Smart, R. L., & Silvotti, R. (2019). A 5D view of the α Per, Pleiades, and Praesepe clusters. A&A 628, A66 (Gaia DR2 membership, more than 1,000 Pleiades members). *Verify the member count when the KB records it.*
- [S24] Levesque, E. M., & Massey, P. (2020). Betelgeuse Just Isn't That Cool. ApJL 891, L37 (Teff 3,600 ± 25 K). https://arxiv.org/abs/2002.10463
- [S25] Betelgeuse: a Review (2023), on the disagreement about evolutionary phase (e.g. Neuhäuser et al. 2022). https://arxiv.org/pdf/2306.09449
- [S26] van Leeuwen, F. (2007). Hipparcos, the New Reduction: Aldebaran parallax about 48.9 mas, so about 65 ly. *Verify in the KB.*
- [S27] Hyades at about 47 pc (about 153 ly): Gaia Collaboration, Babusiaux et al. (2018), A&A 616, A10. Age about 625–750 Myr: Perryman et al. 1998; Brandt & Huang 2015. *Verify in the KB.*
- [S28] Rigel Teff about 12,100 K, log L/L☉ about 5.1 (Przybilla et al. 2006/2010; Moravveji et al. 2012). https://www.arxiv.org/pdf/1201.0843

Items marked *verify* are standard literature values I did not re-fetch in this phase. The KB workstream should confirm them before they appear in shipped cards.
