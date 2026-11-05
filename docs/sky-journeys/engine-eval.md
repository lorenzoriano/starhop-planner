# Sky Journeys: engine evaluation and tuning (P4)

This is the first evaluation of the journey engine (`client/src/lib/journeys/*`) on the real knowledge base
(`kb-v1+954e598452`, 519 objects, 515 journey-eligible). It covers the bugs found, the defaults that were
calibrated, before/after numbers from a year-long grid, and ten example journeys printed in full.

**Summary.**
- On a dark, moonless night, every site and season now gets three valid journeys with no lecturer veto. Before,
  only 3% did: the engine ignored half of the template rules, and its payoffs were often faint challenge objects.
- No request returns an empty list any more. Before, the full Moon emptied the dark Colorado site.
- On moonlit nights, a bright-Moon archetype (thermometer, doubles, variables, families, moonlit) is offered in
  96% of requests.
- Runtime is about 3× lower. On the evaluation machine the first request after the knowledge base loads takes
  ≤ 300 ms, and later requests have a median of about 60 ms.
- The rules that remain unmet are data problems. They are listed in `script/journeys/curated/_fixes.json` under
  `engineEvalFlags`.
- Round 1 owner feedback (§8): distance ladders now only climb, in even steps; no result holds two near-identical
  journeys or two equal titles; contrast tours (A6) no longer lead three suggestions in four; the first suggestion is
  always one of the best eight journeys of the pool.
- Second pass (§9): at most one contrast tour per result, first only when it beats every other story by a margin
  (A6 first 49% → 32% of requests, in the top two 85% → 66%); variable-star tours open and close on stars whose
  change you can see (≥ 0.3 mag); the owner's A/B round makes twelve different comparisons.

## 1. Method

**Harness:** `script/journeys/eval/run-grid.ts`. Run it with `npx tsx script/journeys/eval/run-grid.cts --label <name>`.
Its output goes to `data-dev/journeys-eval/<label>/`, which is git-ignored. The harness runs the real `generate()` on
the real KB over this grid:

| dimension | values |
|---|---|
| sites | San Francisco (37.77, −122.42), dark rural Colorado (38.8, −104.5), London (51.5, −0.1), Sydney (−33.9, 151.2), Santiago (−33.4, −70.7) |
| nights | every month of 2027: the 15th, the new Moon nearest it, and the full Moon nearest it (34–35 distinct nights per site; a few coincide) |
| times | 1.5 h after astronomical dusk (solar midnight when the Sun never reaches −18°, as in London in summer), and 23:30 local |
| binoculars | 10×50 (6.5°) and 7×50 (7.1°) |
| request | the app defaults: 5 stops, minAlt 30°, a challenge stop allowed, 3 suggestions. Sky brightness is 19.0 mag/arcsec² in the cities (the app's suggested default) and 21.5 at the dark site |
| themes | each of the 12 archetypes forced (10×50, the 1.5 h-after-dusk time only): 2,076 requests |
| long journeys | the same grid with `length: 8` (the UI's "Long"), without forced themes |

**What each request records:**
- the journeys returned, their templates and stop counts;
- the rejection reasons and the diagnostics message (also for empty results);
- path length, and the largest distance of a stop from the stops' own centroid;
- runtime;
- the stops shared between the three suggestions;
- staleness: whether the same journey (same template and stops) appears on other nights for the same site, time and
  binoculars.

**Rule violations** are checked by the independent checker `__tests__/engine-helpers.ts` (`independentProblems`). It
recomputes the following with `eqToHorizontal`, `moonState`, `scatteredMoonlight` and `binocularAssessment` at the
displayed stop windows:
- altitude, darkness, Moon distance, moonlight and binocular rating;
- challenge stops, near-duplicate stops, region, hops, path, turns and back-tracks;
- link types.

For this evaluation it was extended so that it also checks:
- switched journeys, by validating each part of the journey against its own template;
- slot arrival types (`inEdges`);
- the `variabilityClasses` and `hasHistoryHook` slot clauses, and the slot's `kinds` and `roles`.

**Lecturer checks** (`journeyFlags` in the harness). These are not hard rules: they are the things an astronomy
lecturer would veto.
- **Hard veto:**
  - a payoff star fainter than mag 6, a payoff of difficulty ≥ 4, or a challenge stop as the payoff, unless the
    slot asks for a hard object (`maxObsDifficulty` ≥ 4, as for A8's supernova remnant);
  - a cluster and its own member star back to back;
  - a transition that falls back to the generic built-in text.
- **Soft complaint:** a dull payoff (wow ≤ 1, or wow 2 with interest < 0.7). Information flags: weak derived links
  (< 0.5), SAME_FAMILY links, and two stops in one view joined by a curated comparison.

A journey is **good** when it has no violation and no hard veto. "Dark moonless" means astronomical night with the
Moon down or at most 25% lit; "moonlit" means the Moon is up and at least 60% lit.

**Before** is the engine exactly as the integration step left it. That copy was saved before any change and re-run
under the same harness, on the same KB, with the same metric definitions. **After** is the current engine.

## 2. Results

### 2.1 Default requests (5 stops)

| metric | before | after |
|---|---|---|
| requests (5 sites × ~35 nights × 2 times × 2 binoculars) | 692 | 692 |
| journeys per request (mean) | 2.84 | 3.00 |
| empty results | 5.5% (38) | 0.0% (0) |
| **dark moonless requests with ≥ 3 good journeys** | 7/232 (3.0%) | **232/232 (100.0%)** |
| … and with no dull payoff either | 7/232 | 190/232 (81.9%) |
| moonlit requests (Moon ≥ 60 %, up) with ≥ 1 journey | 374/412 | 412/412 |
| moonlit requests offering a bright-Moon archetype | 283/412 | 394/412 |
| **rule violations (independent re-check)** | 4302 in 2713 journeys | **0** |
| good journeys (no violation, no hard veto) | 37.5% | 100.0% |
| challenge stop as the payoff | 1204 | 0 |
| faint payoff (star fainter than mag 6, or difficulty ≥ 4) | 615 | 0 |
| dull payoff (soft: wow ≤ 1, or wow 2 and interest < 0.7) | 619 | 574 |
| two stops in one binocular view (curated comparisons only after) | 1057 | 193 |
| suggestions sharing a stop / mean shared stops | 533 / 2.2 | 387 / 0.8 |
| requests whose 3 suggestions are one archetype | 1 | 26 |
| staleness: journeys shown on > 1 night (same site, time, binoculars) | 64.9% | 31.5% |
| nights ≤ 4 days apart sharing a journey | 72/112 | 20/128 |
| path length ° mean / p95 / max | 39.0 / 57.9 / 73.4 | 41.7 / 61.7 / 73.2 |
| spread from the stops' centroid ° mean / p95 / max | 16.2 / 27.3 / 31.2 | 16.7 / 26.4 / 31.0 |
| curated share of links | 30.2% | 24.0% |
| journeys relying on a relaxation | 0 | 72 |
| archetype switches | 0 | 0 |
| runtime ms median / p90 / p95 / max (warm process) | 168.3 / 276.0 / 308.0 / 398.8 | 58.6 / 88.5 / 116.9 / 186.0 |
| requests over 300 ms | 46 | 0 |

Templates shown, before: A6-contrasts 616, A3-how-far 381, A2-thermometer 369, A4-time-machine 205, A12-moonlit 195, A10-stars-that-change 117, A1-cradle-to-grave 59, A9-seeing-double 15, A5-families 5.
After: A6-contrasts 815, A9-seeing-double 332, A4-time-machine 206, A5-families 183, A12-moonlit 176, A2-thermometer 105, A3-how-far 96, A10-stars-that-change 89, A1-cradle-to-grave 61, A7-record-breakers 13.

The "before" violations were all story rules the engine never enforced. The most frequent:
  - stop # link type CONTRAST not allowed into slot "Older light" (×809)
  - HR# lacks the variability class of slot "Hidden by soot" (×408)
  - stop # link type CONTRAST not allowed into slot "Farthest light" (×252)
  - stop # link type CONTRAST not allowed into slot "Newborn family" (×224)
  - stop # link type SIBLING not allowed into slot "Its opposite" (×218)
  - stop # link type CONTRAST not allowed into slot "Oldest light" (×181)
  - stop # link type CONTRAST not allowed into slot "Last pair" (×168)
  - HR# lacks the variability class of slot "Heartbeat" (×161)

The only true sky-rule mismatch was SMC (7 journeys), and it disappeared once the slot and pair rules were fixed.

### 2.2 Per site

| site | dark ≥ 3 good, before → after | empty, before → after | median / p95 ms, before → after |
|---|---|---|---|
| San Francisco | 0/48 → 48/48 | 0 → 0 | 187 / 252 → 56 / 106 |
| Colorado dark site | 0/48 → 48/48 | 38 → 0 | 106 / 309 → 65 / 140 |
| London | 0/38 → 38/38 | 0 → 0 | 156 / 254 → 54 / 85 |
| Sydney | 3/50 → 50/50 | 0 → 0 | 194 / 326 → 63 / 113 |
| Santiago | 4/48 → 48/48 | 0 → 0 | 179 / 330 → 61 / 121 |

### 2.3 Forced themes (173 requests each)

| theme | before: non-empty (dark / moonlit) | after: non-empty (dark / moonlit) |
|---|---|---|
| A1-cradle-to-grave | 37.0% (40/58 / 18/103) | 26.0% (32/58 / 7/103) |
| A10-stars-that-change | 85.5% (55/58 / 83/103) | 71.7% (48/58 / 68/103) |
| A11-inside-our-galaxy | 1.2% (2/58 / 0/103) | 1.2% (2/58 / 0/103) |
| A12-moonlit | 68.8% (48/58 / 61/103) | 32.9% (0/58 / 57/103) |
| A2-thermometer | 94.8% (58/58 / 94/103) | 79.2% (48/58 / 80/103) |
| A3-how-far | 73.4% (58/58 / 59/103) | 40.5% (37/58 / 29/103) |
| A4-time-machine | 76.3% (57/58 / 65/103) | 53.8% (44/58 / 45/103) |
| A5-families | 72.8% (51/58 / 66/103) | 71.7% (51/58 / 63/103) |
| A6-contrasts | 94.8% (58/58 / 94/103) | 100.0% (58/58 / 103/103) |
| A7-record-breakers | 0.0% (0/58 / 0/103) | 14.5% (19/58 / 4/103) |
| A8-how-stars-die | 0.0% (0/58 / 0/103) | 3.5% (6/58 / 0/103) |
| A9-seeing-double | 87.9% (56/58 / 84/103) | 91.3% (56/58 / 90/103) |

A theme can be empty for a correct reason, and every empty result now says which one. A12 is a bright-Moon theme
and is gated off on dark nights. A8 and A11 need a sky darker than 20 mag/arcsec² and the Moon below 40% lit.
Themes also fail when their stops are not up together. Before, A7, A8 and A11 were empty on every request, because
of tag mismatches, missing links and a broken hook rule. The most common messages for themed empty results (numbers
masked):

- (85) “Inside Our Galaxy” needs a dark sky (darker than # mag/arcsec²); this site is set to #. The Moon is #% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least #° from it; it sets at #:#.
- (85) “How Stars Die” needs a dark sky (darker than # mag/arcsec²); this site is set to #. The Moon is #% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least #° from it; it sets at #:#.
- (76) “Cradle to Grave”: tonight's candidates do not link into a complete story; a longer or shorter journey, or another time, may work. The Moon is #% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least #° from it; it sets at #:#.
- (58) “Moonlight Can't Hide These” is a bright-Moon theme: it runs when the Moon is at least #% lit and up.
- (54) “How Far Is Far?”: tonight's candidates do not link into a complete story; a longer or shorter journey, or another time, may work. The Moon is #% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least #° from it; it sets at #:#.
- (46) “Inside Our Galaxy” needs a dark sky (darker than # mag/arcsec²); this site is set to #.
- (46) “How Stars Die” needs a dark sky (darker than # mag/arcsec²); this site is set to #.
- (45) “Record Breakers” needs a “Farthest thing” stop (such as Andromeda Galaxy, M#, Triangulum Galaxy), and none is high enough in a dark enough sky right now. The Moon is #% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least #° from it; it sets at #:#.

### 2.4 Long journeys (8 stops asked)

| metric | before | after |
|---|---|---|
| requests (5 sites × ~35 nights × 2 times × 2 binoculars) | 692 | 692 |
| journeys per request (mean) | 2.84 | 3.00 |
| empty results | 5.5% (38) | 0.0% (0) |
| **dark moonless requests with ≥ 3 good journeys** | 2/232 (0.9%) | **232/232 (100.0%)** |
| … and with no dull payoff either | 2/232 | 137/232 (59.1%) |
| moonlit requests (Moon ≥ 60 %, up) with ≥ 1 journey | 374/412 | 412/412 |
| moonlit requests offering a bright-Moon archetype | 121/412 | 393/412 |
| **rule violations (independent re-check)** | 2099 in 1358 journeys | **0** |
| good journeys (no violation, no hard veto) | 27.4% | 100.0% |
| challenge stop as the payoff | 238 | 0 |
| faint payoff (star fainter than mag 6, or difficulty ≥ 4) | 73 | 0 |
| dull payoff (soft: wow ≤ 1, or wow 2 and interest < 0.7) | 517 | 252 |
| two stops in one binocular view (curated comparisons only after) | 626 | 106 |
| suggestions sharing a stop / mean shared stops | 649 / 5.9 | 486 / 1.1 |
| requests whose 3 suggestions are one archetype | 276 | 27 |
| staleness: journeys shown on > 1 night (same site, time, binoculars) | 51.7% | 32.1% |
| nights ≤ 4 days apart sharing a journey | 59/112 | 21/128 |
| path length ° mean / p95 / max | 62.3 / 73.9 / 75.0 | 47.7 / 72.1 / 94.3 |
| spread from the stops' centroid ° mean / p95 / max | 21.3 / 31.7 / 36.5 | 18.1 / 28.1 / 34.8 |
| curated share of links | 27.4% | 23.7% |
| journeys relying on a relaxation | 91 | 1760 |
| archetype switches | 1707 | 350 |
| runtime ms median / p90 / p95 / max (warm process) | 168.9 / 305.3 / 342.1 / 442.2 | 79.7 / 162.5 / 183.4 / 304.0 |
| requests over 300 ms | 77 | 1 |

Stop counts, before: 8: 1871, 7: 40, 6: 16, 5: 15, 4: 15, 3: 5. After: 6: 760, 5: 618, 8: 321, 4: 303, 7: 69, 9: 5.

The old engine reached 8 stops mostly by breaking slot rules: 1,358 of 2,076 journeys had violations. It switched
from A6 to A2 almost every time, and the three suggestions shared about six stops. Under the corrected rules, only a
few archetypes can fill 8 stops. A3 reaches 8 only with every optional slot filled. The archetype switch rarely
connects, because the switch link must now continue the target's theme (§3.2). So most "Long" requests are met by
relaxing the length, mostly to 5–6 stops. The relaxed length now stays within 4 stops of the request, and relaxed
lengths are ranked by how close they are to it. This limit comes from the template data (§4), not from the engine.
The 94° maximum path belongs to journeys that also needed the 40° region relaxation, whose path limit is 100°. One
long request (of 692) took 304 ms in the warm grid.

### 2.5 Runtime

On the evaluation machine (DGX Spark: Arm Cortex-X925 / A725 cores, Node 22.23), the grid process stays warm between requests; the "after"
rows above show the median, p95 and max. The worst case a user meets is the **first request after the knowledge base
loads**: cold link caches and the JIT are not warmed yet. It is measured below in a fresh process each time, with
`script/journeys/eval/first-request.ts`; each cell is "first request / next 15-minute slot".

| case | before (ms) | after (ms) |
|---|---|---|
| Sydney, May, 5 stops (heaviest sky) | 586 / 448 | 280 / 197 |
| San Francisco, January, 5 stops | 468 / 330 | 189 / 120 |
| Colorado, August, 5 stops | 380 / 274 | 155 / 102 |
| London, October, 5 stops | 456 / 322 | 180 / 126 |
| Sydney, May, 8 stops | 654 / 476 | 291 / 212 |
| Colorado, August, 8 stops | 384 / 306 | 183 / 131 |

Loading and validating the KB costs another ~110 ms once per worker (`knowledgeBaseFromFiles`). `engine.realkb.test.ts`
logs a real-KB timing and asserts a loose 600 ms median bound, for slower CI machines.

## 3. What was wrong, and what changed

Every change below has a regression test in `client/src/lib/journeys/__tests__/engine.eval-fixes.test.ts` (unit
level, on the fixture KB) or in `engine.realkb.test.ts` (on the real KB). Constant names are given so the values
can be found.

### 3.1 Template rules the engine ignored (bugs)
- **`TemplateSlot.inEdges` was never read.** Links were checked against the template-wide edge list, so 2,600
  journey steps arrived at slots through forbidden link types. Example: "Farthest light" reached through a
  CONTRAST. Now each slot has its own allowed set (`CompiledTemplate.slotAllowed`). The search, the Held–Karp
  re-ordering and the validator all use `candidates.slotLink`.
- **`SlotMatch.variabilityClasses` and `hasHistoryHook` were ignored.** Errai filled "Hidden by soot" (an R CrB
  slot), and Mu Cephei filled "Eclipse". Both clauses are now enforced in `slotMatches`.
- **Template ingredients were half-implemented.** The engine ignored these ingredients:
  - `minSuperlatives` and `minHistoryHooks` (A7, A4);
  - `maxMoonIllumination` (A8, A11);
  - `minMoonIllumination` (A12, which ran on moonless nights);
  - `minSkyBrightness`.

  The engine now checks them. The night gates are applied in `candidates.templateNightBlock`, reading the brightest
  Moon while it is up during the journey (`conditions.moonDuring`).
- **Free-order templates (A12) could open on the payoff and end on the hook.** Free order now shuffles only the
  middle of the arc: hook first, then build and twist, then payoff, then coda.
- **The switch-link cache key** left out the target template, so two switch targets with different `via` sets could
  share a cached link.

### 3.2 Links that were true but off-theme (calibration)
`candidates.themeLinkOk` keeps fact-bearing links on the archetype's theme:
- **On the progression fact.** In an archetype with a fact progression, a CONTRAST, SCALE or TIME_MACHINE link must
  be about that fact. Before, the distance ladder stepped "Next rung: Chi Cygni is 700 times larger", and the
  thermometer moved by star radius. Life-story archetypes (A1, A8) keep their curated links, but a derived contrast
  must be about a life fact (age, temperature, size, luminosity or mass), never distance alone.
- **In the progression's direction.** SCALE and TIME_MACHINE steps, and CONTRAST or LINE_OF_SIGHT steps into build
  and payoff slots, must go the progression's way. A time machine no longer steps from Cygnus X-1 (7,240 ly) back to
  Vega with "Keep counting", and a ladder no longer goes Alnair (101 ly) → ε Indi (12 ly). The exceptions are a twist,
  a coda ("Back home"), and a step out of a Milky Way scene hook such as A11's star cloud.
- **Derived SAME_PHYSICS needs a shared core concept.** It must share one of the archetype's `coreConcepts`. A
  thermometer stepped through "clusters slowly dissolve".
- **The switch link continues the target's theme** (`validate.switchLinkOf`). After M14 (30,000 ly), the "time
  machine" no longer resets to Barnard's Star (6 ly).
- **Derived distance contrasts only within 10°** (`DEPTH_CONTRAST_MAX_SEP_DEG`). Every bank line for them says
  "they look like neighbours" or "they share this patch of sky".
- **New derived link: "mass decides the fate".** It is a CONTRAST between a planetary nebula or white dwarf and a
  supergiant or supernova remnant (`FATE_REASON_KEY`). It has its own text, because no curated edge joined a PN to a
  supergiant and A8 could never run.
- **Colour archetypes use stars brighter than mag 6** (`STAR_COLOR_MAG`). A colour journey had ended at Cygnus X-1,
  which is mag 8.9.

### 3.3 Duplicate-ish stops
`StoryGraph.pairOk` replaces the 0.5° near-duplicate rule:
- **Closer than 0.1° (`SAME_POINT_DEG`)** two objects are one sight, so they are never both stops. Examples: α Cen A
  and B, Acrux A and B, the Trapezium inside M42, and τ CMa inside its cluster.
- **Closer than 1° (`SAME_VIEW_DEG`)** two stops need a curated LINE_OF_SIGHT, CONTRAST or CAUSE comparison: M35
  and NGC 2158, M81 and M82, Mimosa and the Jewel Box. Before, h and χ Persei were split into two stops in 327 journeys;
  now they are refused, as are Alnitak and σ Ori, and NGC 6231 and ζ¹ Sco (0.56°, which passed the old 0.5° rule).
- **A star inside a deep-sky object's extent**, within 3° of its centre (`INSIDE_VIEW_DEG`), needs a curated
  LINE_OF_SIGHT edge. That keeps Aldebaran with the Hyades and keeps out Alcyone with M45, θ Tau with the Hyades and
  Mirfak with the Alpha Persei Cluster.

### 3.4 Payoffs and challenge stops
- **A challenge payoff** is allowed only where the slot asks for a hard object (`maxObsDifficulty` ≥ 4, as for A8's
  Veil): `challengePayoffAllowed`. Before, 1,204 payoffs were challenge stops, for example Lalande 21185 at mag 7.5
  as "Deepest contrast".
- **A star payoff** must be visible to the naked eye (`PAYOFF_STAR_MAG` = 6). `payoffTerm` in h adds 0.35 per wow
  point above 3, subtracts 0.3 per difficulty point above 2, and subtracts 0.2 per magnitude for star payoffs fainter
  than mag 5.
- **Variables that fade out of binocular reach** (`binocularVisibleAtMin` false: Mira, χ Cyg, R Leo, R CrB and 12
  others) are at best the one challenge stop (`conditions.fadingFloor`). The engine cannot know their phase offline.

### 3.5 Moon and sky
- **Moonlight is measured against a reference sky.** The limits are now applied against min(site sky, 20.0
  mag/arcsec²) (`GLOW_REFERENCE_SKY`, `conditions.moonGlow`). Krisciunas–Schaefer brightening is relative: the same
  Moon brightens a 21.5 site by about 2 mag more than a 19.0 city. So the full Moon emptied the dark Colorado site
  (38 empty results) while the cities kept three journeys each. The independent checker applies the same rule
  definition.
- **Bright-Moon archetypes.** On a moonlit night they get a small bonus in h (`MOONLIT_FIT` × illumination). If the
  Moon is at least 50% lit (`MOONLIT_PREFER`) and none of the first two picks is a bright-Moon archetype, the third
  suggestion is reserved for one.

### 3.6 Three suggestions, three stories
- **MMR similarity.** Similarity now counts shared stops (relative to the shorter journey), plus the same opener,
  archetype and patch, with λ = 0.6. A journey that shares ≥ 2 stops with a pick (`MAX_SHARED_STOPS`), or repeats a
  picked archetype, is a last resort. Mean shared stops per request fell from 2.2 to 0.8.
- **Relaxing for variety.** The relaxation chain (doc 05 §5.8) now also runs when there are fewer than three
  *distinct* journeys, not only fewer than three journeys. If even that cannot vary the stories, the diagnostics say
  so: "Only “…” stories fit this part of the sky right now". This happens in 26 requests, mostly in the Santiago and
  Sydney spring evenings over Grus and Tucana, where the KB holds only contrast tours.
- **Night rotation.** The canonical pick gets Gumbel noise (`NIGHT_ROTATION` = 0.12 on the normalised score). The
  noise is seeded per night, site, binoculars and theme, never per 15-minute slot. Near-equal journeys take turns
  from night to night, while live mode inside one night never reshuffles. Journeys shown on more than one night fell
  from 65% to 32%. Some repeats are inherent: the same sky at the same clock time a month apart.
- **Length.** Relaxed lengths rank by closeness to the request (`LENGTH_MISS_COST`), so 7 stops come before 4 for an
  8-stop request, and the relaxation stays within 4 stops of the request (never 3 stops for 8 asked).

### 3.7 Diagnostics and narration
- **Forced themes explain an empty result** (`themeDiagnosis`), naming one of these causes:
  - the theme is unknown;
  - it needs a dark sky (with the site's setting);
  - it needs the Moon below a limit, or it is a bright-Moon theme;
  - the missing slot, with examples ("needs a “Farthest thing” stop (such as Andromeda Galaxy, M33, …)");
  - the stops are too far apart;
  - the stops are up but do not link into a story.
- **The altitude factor no longer shows on every empty result.** "Many objects are lower than 30°" used to appear
  every time, because 70% of the sky always is lower than 30°. It is now raised only when fewer than 25 objects are
  feasible.
- **Steps back toward us.** A SCALE or TIME_MACHINE step back toward us (into a coda, or out of a scene hook) now
  uses direction-neutral lines. The bank's lines all climb ("Next rung", "Keep counting").
- **Derived SAME_PHYSICS names the shared idea.** It quotes the concept's big idea and prefers the archetype's core
  concepts. Before, it said "What made Orion's Belt work also makes Meissa work".

### 3.8 Performance
Overall, the median dropped from 169 ms to about 60 ms, and the cold first request from about 570 ms to under
300 ms. The first six items below change no result (a grid run before and after them returned identical journeys);
the last one changes only the length-relaxed tier.
- `StoryGraph.ranked` keeps per pair a ranked list of edges, the same order `best()` used. `slotLink` takes the
  first edge that passes its filters, with no closure per call.
- The beam memoises links per (template, hook or not, slot), keyed by numeric pairs.
- The beam checks reachability first, with a cosine pre-check, so edges are only derived for pairs within the
  maximum hop.
- The beam adds the heuristic incrementally (`addStopTerms` + `closeHeuristic`, with the same floating-point order
  as the full sum).
- The naked-eye anchor pool is memoised per table and stop index. Before, it rebuilt over all 519 objects for every
  stop of about 300 candidates.
- Or-opt skips moves that the DP constraints already reject. Those constraints are necessary conditions of the
  validator.
- The strict length and the length relaxation share one search, which keeps its best candidates per stop count.
  The relaxed tier is validated only when it is needed, and only its top 120 per length.

## 4. Data problems flagged

These are recorded in `script/journeys/curated/_fixes.json` → `engineEvalFlags`. The build does not read that key;
it is for the template, narration and curator owners. One fix was applied through the existing `objectFixes`
mechanism. Like Castor B (HR 2890), α Centauri B (HR 5460) and α² Crucis (HR 4731) are now journey-ineligible: at
8″ and 3.5″ from their primaries, binoculars show each pair as one point. The KB was rebuilt and kb-real passes.
- **A7 Record Breakers**: the slot tags (`most-luminous-in-view`, `hottest-star-in-view`, …) do not match the
  curated tags (`most-luminous`, `hottest`). The engine now matches stems, which moved A7 from 0% to about 15% of
  themed requests. The vocabularies should be aligned.
- **A11 Inside Our Galaxy**: only M24 can be the "Milky Way river" hook, and the "Another galaxy" payoff accepts
  globulars. The KB needs binocular Milky Way fields: the Scutum, Large Sagittarius, Cygnus and Norma star clouds,
  and the Carina Milky Way.
- **A8 How Stars Die**: one PN (M27) and three SNRs, all of them challenge objects. It runs only from dark sites in
  summer.
- **A1 and A2 payoffs**: "Dying star" accepts any giant (Ain, γ Tau, ζ Per), and "Blue-hot star" accepts white A
  stars (Merak). These are the main source of the remaining dull payoffs.
- **Long journeys**: template lengths (max 5–8) and the switch rules cannot fill the UI's "Long: 7–10 stops" option.
- **A9 and A10**: many steps ride derived luminosity or radius contrasts. More curated SAME_PHYSICS and SAME_FAMILY
  edges between doubles and between variables would carry these themes.
- **Narration**:
  - there are no `SCALE.*-down`, `TIME_MACHINE.nearer` or `CONTRAST.fate` variants;
  - the generic `LIFE_NEXT` line assumes clusters ("what a family like Albireo grows into");
  - an A6 question assumes two nebulae;
  - two winter-stars lines double "about".
- **Objects**:
  - Alcyone and 15 Mon carry the role `young-cluster`, so a single star can fill a "Bright family" slot;
  - 16 variables have `mag` at maximum while fading out of reach;
  - member-star SIBLING edges join a cluster to a star inside it (these are now never used as steps).

## 5. Open issues

- **"Long" requests are mostly answered with 5–6 stops; only 321 of 2,076 grid journeys have the full 8** (§2.4).
  This needs template data, or a UI label change.
- **Dull payoffs remain in about 18% of dark-night requests** (strict criterion). They come from template slot
  definitions (A1, A2), not from engine choice.
- **Derived links still carry about 76% of steps.** Their texts are true and now on-theme, but many are weak (0.35–0.5)
  luminosity or radius contrasts. More curated edges would raise quality most.
- **Staleness is about 32%.** The most repeated journeys: A9-seeing-double|DS-DeltaCep>HR8383>HR8238>HR8974>HR424 (7 nights); A10-stars-that-change|HR7763>HR7735>STAR-MuCep>HD212466>DS-DeltaCep (7 nights); A5-families|NGC2451>IC2391>NGC2516>IC2602>NGC3532 (7 nights); A6-contrasts|DS-AlpCVn>HR4550>STAR-LaSuperba>HR5191>DS-MizarAlcor (5 nights). These are the same sky at the same clock
  time on nights a month apart. The `seenObjectIds` request field already demotes journeys the user has done.
- **Southern spring evenings over Grus and Tucana yield only contrast tours.** The engine says so in its
  diagnostics. The data depth there is out of scope for v1 (spec).
- **The archetype switch at 8 stops** happens in about 17% of long journeys (350 of 2,076). The 0.2 switch cost was kept: switches
  are now limited by valid links, not by the cost.
- **The independent checker** (`engine-helpers.ts`) mirrors the new rule definitions for moonlight (reference sky)
  and switched journeys. Any future change to a rule must update both, as before.

## 6. Example journeys

One journey per scenario, printed with title, driving question, hook, story, stops (slot role, magnitude, altitude,
link) and the transition text into each stop. "Why here" lines are left out for length. The examples were
regenerated with `npx tsx script/journeys/eval/examples.cts`.

### 1. San Francisco, 2027-01-08 20:30 local, 10x50 — winter, new Moon

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Pairs and Impostors of Cepheus”, “Same Sky, Different Stories: Auriga”.

**Andromeda: Near, Far, Farther** (A3-how-far; 5 stops, 40 min, path 48.5°, easy)

*Which of these is closest, and how do we know?* — Start next door and end far beyond, one measured step at a time.

> Start next door and end far beyond, one measured step at a time. In 5 stops and about 40 minutes you go from Algol to Caph, all in the sky around Andromeda.

1. **Algol** (Next-door star, mag 2.09; alt 84°)
2. **56 Andromedae** (Next rung, mag 5.67; alt 69°) — via SCALE/distanceLy-up 0.44
   - *From the last stop:* From about 90 light-years to about 327 light-years: your binoculars just reached about 4 times farther.
3. **NGC 752** (Next rung, mag 5.7; alt 68°) — via LINE_OF_SIGHT/foreground-pair (curated) 0.85
   - *From the last stop:* The orange pair at the cluster’s edge is not part of it: 56 Andromedae lies about 330 light-years away, several times closer than NGC 752.
4. **Andromeda Galaxy** (Farthest light, mag 3.4; alt 53°) — via SCALE/distanceLy-up 1
   - *From the last stop:* Climb again: Andromeda Galaxy lies about 2,000 times farther than NGC 752.
5. **Caph** (Back home, mag 2.27; alt 47°) — via SCALE/distanceLy-down 1
   - *From the last stop:* Andromeda Galaxy and Caph look like neighbors, but Caph is about 50,000 times closer than Andromeda Galaxy.

### 2. Colorado dark site, 2027-08-04 22:00 local, 10x50 — summer, dark site, Moon down

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Cygnus: Spot the Difference”, “Starlight Postmarked Long Ago: Boötes”.

**Pairs and Impostors of Lyra** (A9-seeing-double; 5 stops, 40 min, path 50.4°, moderate)

*Is that one star, or two, or six?* — One point of light can hide a whole family. Let's count.

> One point of light can hide a whole family. Let's count. In 5 stops and about 40 minutes you go from Zeta Lyrae to 70 Ophiuchi, all in the sky around Lyra.

1. **Zeta Lyrae** (Naked-eye pair, mag 4.36; alt 80°)
2. **Sheliak** (Chance alignment?, mag 3.45; alt 79°) — via CONTRAST/lumLsun 1
   - *From the last stop:* True power against looks: Zeta Lyrae gives off about 32 times the Sun's light, Sheliak about 11,000–14,000 times the Sun's light.
3. **100 Herculis** (Split it, mag 5.86; alt 77°) — via CONTRAST/lumLsun 1
   - *From the last stop:* Line them up by true output: Sheliak at about 11,000–14,000 times the Sun's light, 100 Herculis at about 6.3–12 times the Sun's light.
4. **Rasalgethi** (Split it, mag 3.48; alt 62°) — via CONTRAST/radiusRsun 1
   - *From the last stop:* Both are stars, both are points of light, yet Rasalgethi is about 300 times larger than 100 Herculis.
5. **70 Ophiuchi** (Hidden system, mag 4.03; alt 53°) — via CONTRAST/radiusRsun 1
   - *From the last stop:* Picture them side by side: Rasalgethi at about 370–500 times the Sun's radius, 70 Ophiuchi at about 1.1 times the Sun's radius.

### 3. London, 2027-10-29 21:00 local, 10x50 — autumn, new Moon

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “A Ladder of Distances in Perseus”, “Splitting Stars over Cygnus”.

**Twins and Opposites in Cepheus** (A6-contrasts; 5 stops, 40 min, path 46°, easy)

*What makes look-alikes live such different lives?* — Twins that aren't, neighbors that aren't: tonight is about differences.

> Twins that aren't, neighbors that aren't: tonight is about differences. In 5 stops and about 40 minutes you go from Polaris to ρ Cassiopeiae, all in the sky around Cepheus.

1. **Polaris** (Pair opener, mag 2.02; alt 52°)
2. **Errai** (Its opposite, mag 3.21; alt 63°) — via CONTRAST/lumLsun 1
   - *From the last stop:* Don't judge a star by how bright it looks. Errai is about 200 times less luminous than Polaris.
3. **Alfirk** (New pair, mag 3.23; alt 69°) — via CONTRAST/lumLsun 1
   - *From the last stop:* Alfirk is about 2,000 times more luminous than Errai, whatever their brightness in your binoculars suggests.
4. **VV Cephei** (Unlikely opposite, mag 4.91; alt 76°) — via CONTRAST/radiusRsun 1
   - *From the last stop:* Alfirk measures about 6.3 times the Sun's radius; VV Cephei about 779 times the Sun's radius. To your eye both are points of light.
5. **ρ Cassiopeiae** (Deepest contrast, mag 4.54; alt 80°) — via CONTRAST/lumLsun 0.484
   - *From the last stop:* True power against looks: VV Cephei gives off about 57,000–89,000 times the Sun's light, ρ Cassiopeiae about 470,000–890,000 times the Sun's light.

### 4. London, 2027-04-07 22:30 local, 7x50 — spring, new Moon

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Same Sky, Different Stories: Ursa Major”, “Splitting Stars over Boötes”.

**Boötes: Light from Every Century** (A4-time-machine; 5 stops, 40 min, path 54.2°, stretch)

*How far back in time can your binoculars see?* — Every stop shows light from a different moment in history. Read it like a calendar.

> Every stop shows light from a different moment in history. Read it like a calendar. In 5 stops and about 40 minutes you go from Arcturus to Great Hercules Globular Cluster, all in the sky around Boötes. R Coronae Borealis is the one challenge: give it a minute, and skip it without guilt if it does not show.

1. **Arcturus** (Recent light, mag -0.04; alt 36°)
2. **Izar** (Older light, mag 2.7; alt 39°) — via SCALE/distanceLy-up 0.486
   - *From the last stop:* From about 37 light-years to about 203 light-years: your binoculars just reached about 6 times farther.
3. **ν¹ & ν² Boötis** (Older light, mag 5.02; alt 42°) — via SCALE/distanceLy-up 0.47
   - *From the last stop:* Climb again: ν¹ & ν² Boötis lies about 5 times farther than Izar.
4. **R Coronae Borealis** (Older light, mag 5.85; alt 32°; challenge) — via SCALE/distanceLy-up 0.393
   - *From the last stop:* Next rung: R Coronae Borealis is about 1,900–2,800 light-years away, about 2 times farther than ν¹ & ν² Boötis.
5. **Great Hercules Globular Cluster** (Oldest light, mag 5.8; alt 31°) — via SCALE/distanceLy-up 0.556
   - *From the last stop:* Keep counting: R Coronae Borealis at about 1,900–2,800 light-years, Great Hercules Globular Cluster at about 24,200 light-years.

### 5. Sydney, 2027-07-05 19:30 local, 10x50 — southern winter, new Moon

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Twins and Opposites in Scorpius”, “A Ladder of Distances in Crux”.

**Sagittarius: A Star's Whole Life** (A1-cradle-to-grave; 5 stops, 40 min, path 45.4°, easy)

*Could you watch a star's whole life in one patch of sky?* — Start where stars are born and end where they die, without leaving one patch of sky.

> Start where stars are born and end where they die, without leaving one patch of sky. In 5 stops and about 40 minutes you go from Eagle Nebula to β Arae, all in the sky around Sagittarius.

1. **Eagle Nebula** (Nursery, mag 6.4; alt 34°)
2. **M25** (Newborn family, mag 6.5; alt 36°) — via LIFE_NEXT/stage-1-2 0.6
   - *From the last stop:* M25 is what a family like Eagle Nebula grows into: the same story, a later chapter.
3. **Alnasl** (Impostor, mag 2.99; alt 47°) — via LIFE_NEXT/stage-2-3 0.6
   - *From the last stop:* M25 showed you one stage of a star's life. Alnasl is the stage that follows.
4. **Sargas** (Grown-up family, mag 1.87; alt 56°) — via CONTRAST/lumLsun 0.645
   - *From the last stop:* Don't judge a star by how bright it looks. Sargas is about 20 times more luminous than Alnasl.
5. **β Arae** (Dying star, mag 2.85; alt 57°) — via LIFE_NEXT/stage-3-4 0.6
   - *From the last stop:* Turn the page in a star's life, from Sargas to β Arae.

### 6. Santiago, 2027-04-06 21:00 local, 10x50 — southern autumn, new Moon

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Time Machine over Centaurus”, “Look-Alikes of Carina”.

**Reading Star Colors over Puppis** (A2-thermometer; 5 stops, 40 min, path 56.9°, easy)

*Why are stars different colors, and what does that tell us?* — Your eyes are a thermometer tonight. All you need is a slight defocus.

> Your eyes are a thermometer tonight. All you need is a slight defocus. In 5 stops and about 40 minutes you go from Avior to U Monocerotis, all in the sky around Puppis.

1. **Avior** (Ember star, mag 1.86; alt 62°)
2. **Naos** (Color step, mag 2.25; alt 73°) — via CONTRAST/teffK 0.484
   - *From the last stop:* Color is temperature. Naos is about 9 times hotter than Avior, and the color difference shows it.
3. **Pi Puppis** (Color clash, mag 2.7; alt 62°) — via CONTRAST/teffK (curated) 0.9
   - *From the last stop:* Ten degrees apart, these two read opposite ends of the thermometer: about 40,000 K for Naos and about 3,900 K for Pi Puppis.
4. **τ Canis Majoris** (Blue-hot star, mag 4.4; alt 58°) — via CONTRAST/teffK 0.462
   - *From the last stop:* Swing from Pi Puppis to τ Canis Majoris and compare colors. About 3,900 K against 32,800 K: your eyes are reading a thermometer.
5. **U Monocerotis** (The Sun's color, mag 5.45; alt 51°) — via CONTRAST/teffK 0.379
   - *From the last stop:* Opposite ends of the thermometer, one short swing apart: τ Canis Majoris near 32,800 K, U Monocerotis near 5,700 K.

### 7. San Francisco, 2027-01-22 23:00 local, 10x50 — full Moon up

Conditions: The Moon is 99% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least 40° from it; it sets at 08:14. Also suggested: “Look-Alikes of Orion”, “Splitting Stars over Perseus”.

**Moonlight Can't Hide These: Auriga** (A12-moonlit; 5 stops, 40 min, path 48.8°, easy)

*What can you still see when the Moon floods the sky?* — Moonlight steals the faint stuff. Here's what it can't take.

> Moonlight steals the faint stuff. Here's what it can't take. In 5 stops and about 40 minutes you go from Mirfak to Alcyone, all in the sky around Auriga.

1. **Mirfak** (Moon-proof jewel, mag 1.79; alt 51°)
2. **ε Aurigae** (Color or pair, mag 2.99; alt 66°) — via SAME_FAMILY/star:4 0.4
   - *From the last stop:* ε Aurigae is the same type of object as Mirfak. Notice what makes it different.
3. **ζ Aurigae** (Color or pair, mag 3.75; alt 65°) — via SAME_PHYSICS/eclipsing (curated) 0.9
   - *From the last stop:* Two eclipsing stars side by side in the Kids: at ε Aurigae a dark disk covers a bright star; at ζ Aurigae a bright giant hides a small hot star.
4. **ε Persei** (Color or pair, mag 2.89; alt 51°) — via CONTRAST/radiusRsun 0.638
   - *From the last stop:* Size check: ε Persei is about 20 times smaller than ζ Aurigae.
5. **Alcyone** (Bright family, mag 2.87; alt 41°) — via LIFE_NEXT/stage-2-3 0.6
   - *From the last stop:* Fast-forward. Alcyone shows the stage that comes after ε Persei.

### 8. Sydney, 2027-08-17 21:00 local, 10x50 — southern full Moon up

Conditions: The Moon is 100% lit and up. Its glow washes out faint nebulae and galaxies, so every stop is kept at least 40° from it; it sets at 06:45. Also suggested: “Twins and Opposites in Scorpius”, “Triangulum Australe: Light from Every Century”.

**Star Families of Scorpius** (A5-families; 5 stops, 40 min, path 33.6°, easy)

*Where are the Sun's brothers and sisters?* — The Sun lost its siblings long ago. Tonight, meet stars that still have theirs.

> The Sun lost its siblings long ago. Tonight, meet stars that still have theirs. In 5 stops and about 40 minutes you go from NGC 6231 to M23, all in the sky around Scorpius.

1. **NGC 6231** (Jewel box, mag 2.6; alt 67°)
2. **Butterfly Cluster** (Older family, mag 4.2; alt 75°) — via LIFE_NEXT/age-ladder (curated) 0.8
   - *From the last stop:* Up Scorpius’s tail, a family about ten times older: the heaviest stars are gone, and one member has already turned into an orange giant.
3. **Ptolemy’s Cluster** (Older family, mag 3.3; alt 76°) — via LIFE_NEXT/age-ladder (curated) 0.85
   - *From the last stop:* A few degrees southeast, a family about three times older and much nearer, its brightest survivor now a yellow giant.
4. **M21** (Older family, mag 6.5; alt 72°) — via SAME_FAMILY/open-cluster 0.4
   - *From the last stop:* One more example so you can compare: M21, next to your memory of Ptolemy’s Cluster.
5. **M23** (Lost siblings, mag 6.9; alt 67°) — via LIFE_NEXT/older-analog (curated) 0.7
   - *From the last stop:* From a family about five million years old to one about forty times older, a few degrees away: same kind of birth, much later chapter.

### 9. Colorado dark site, 2027-08-04 22:00 local, 10x50 — forced theme: How Stars Die

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Cygnus: Two Ways to Die”, “How Stars Die, over Cygnus”.

**Will the Sun Explode? Ask Cygnus** (A8-how-stars-die; 4 stops, 32 min, path 34.3°, stretch)

*How does a star die, and what decides the way?* — Gentle fade or violent blast? A star's mass decides.

> Gentle fade or violent blast? A star's mass decides. In 4 stops and about 30 minutes you go from Albireo to East Veil Nebula, all in the sky around Cygnus. East Veil Nebula is the one challenge: give it a minute, and skip it without guilt if it does not show.

1. **Albireo** (The Sun's future, mag 3.08; alt 67°)
2. **Dumbbell Nebula** (Smoke ring, mag 7.4; alt 60°) — via LIFE_NEXT/stage-3-5 0.9
   - *From the last stop:* Dumbbell Nebula is what a family like Albireo grows into: the same story, a later chapter.
3. **P Cygni** (Heavyweight, mag 4.81; alt 65°) — via CONTRAST/massMsun-fate 0.8
   - *From the last stop:* Mass decides the ending. A Sun-like star finishes like Dumbbell Nebula, a puffed-off shell around a white dwarf; a star as heavy as P Cygni is headed for a supernova instead.
4. **East Veil Nebula** (Shattered star, mag 7; alt 57°; challenge) — via LIFE_NEXT/stage-4-6 0.9
   - *From the last stop:* Same life story, further along. Look for what has changed between P Cygni and East Veil Nebula.

### 10. Sydney, 2027-07-05 19:30 local, 10x50 — long journey (8 stops asked)

Conditions: Dark sky with the Moon down: every kind of journey is available. Also suggested: “Crux: Light from Every Century”, “Scorpius: Spot the Difference”.

**Ember to Blue-White: Scorpius** (A2-thermometer → A1-cradle-to-grave after stop 4; 8 stops, 64 min, path 44.1°, easy)

*Can you read a star's temperature just by looking?* — Red is cool, blue is hot. Test it on tonight's brightest stars.

> Red is cool, blue is hot. Test it on tonight's brightest stars. In 8 stops and about 65 minutes you go from Antares to Kaus Media, all in the sky around Scorpius. At 9 Sagittarii the story turns to a second question: Cradle to Grave.

1. **Antares** (Ember star, mag 0.96; alt 62°)
2. **τ Scorpii** (Color step, mag 2.82; alt 63°) — via CONTRAST/teffK (curated) 1
   - *From the last stop:* Same birth cloud, same age, opposite ends of the thermometer: Antares at about 3,700 K, τ Scorpii at about 31,500 K. The difference is mass.
3. **36 Ophiuchi** (Color clash, mag 5.11; alt 56°) — via CONTRAST/teffK 0.393
   - *From the last stop:* Color is temperature. 36 Ophiuchi is about 6 times cooler than τ Scorpii, and the color difference shows it.
4. **9 Sagittarii** (Blue-hot star, mag 5.97; alt 47°) — via CONTRAST/teffK 0.469
   - *From the last stop:* 36 Ophiuchi burns at about 5,200 K; 9 Sagittarii at about 44,700 K. That temperature gap is the color difference you see.
5. **Butterfly Cluster** (Newborn family, mag 4.2; alt 56°) — via CONTRAST/ageMyr 0.858
   - *From the last stop:* Change of theme, Cradle to Grave: the reddest stars you saw are old, and that is where we go next. Look for what time has done: 9 Sagittarii at about 1 million years, Butterfly Cluster at about 30–91 million years.
6. **Ptolemy’s Cluster** (Newborn family, mag 3.3; alt 56°) — via LIFE_NEXT/age-ladder (curated) 0.85
   - *From the last stop:* Two clusters in one sweep, two ages: Butterfly Cluster is the younger family, Ptolemy’s Cluster the older one.
7. **Alnasl** (Impostor, mag 2.99; alt 54°) — via LIFE_NEXT/stage-2-3 0.6
   - *From the last stop:* Same life story, further along. Look for what has changed between Ptolemy’s Cluster and Alnasl.
8. **Kaus Media** (Dying star, mag 2.7; alt 52°) — via CONTRAST/lumLsun 0.714
   - *From the last stop:* Line them up by true output: Alnasl at about 62 times the Sun's light, Kaus Media at about 1,650 times the Sun's light.

## 7. Re-running

```
npm run journeys:kb                                                    # rebuild the KB after data changes
npx tsx script/journeys/eval/run-grid.cts --label after                # full grid + themes (~3 min, 5 processes)
npx tsx script/journeys/eval/run-grid.cts --label long --length 8 --no-themes
npx tsx script/journeys/eval/run-grid.cts --show "London|2027-10-29T21:00|10x50|*"   # one request in full
npx tsx script/journeys/eval/run-grid.cts --label after --summary-only                # re-summarise existing rows
npx tsx script/journeys/eval/first-request.cts 2027-05-15T13:30:00Z -33.9 151.2      # cold timing (LEN=8 for long; JOURNEY_ENGINE_DIR too)
JOURNEY_ENGINE_DIR=<copy of client/src/lib/journeys> npx tsx script/journeys/eval/run-grid.cts --label old  # compare engines
npx vitest run client/src/lib/journeys                                  # incl. engine.eval-fixes + engine.realkb
```

## 8. Round 1 owner feedback (2026-11-02)

The product owner ranked calibration sets cal-01..03 (`docs/sky-journeys/owner-feedback-r1.md`, the binding brief).
Four engine changes follow from it. **Before** is the engine as it stood before this round, saved and re-run under
the same harness, on the same KB build (`kb.json` of 2026-11-01 22:40), with the same checker. The checker now
also enforces the ladder rule and the result-level rules below, so "before" is judged by the new rules.

### 8.1 Distance ladders climb, in even steps

Owner, cal-03 D (Vega 25 → Eltanin 154 → g Her 384 → M13 24,201 → ζ Her 35 light-years): "it should have been of
increasing distances, not having the last one be closer. Maybe shorter jumps, because four of them are within the
same range, and then you put that cluster that is … thousands of light years away."

Every step of a distance ladder (any template whose progression is `distanceLy` up: A3 How Far, A4 Time Machine,
A11 Inside Our Galaxy) must now pass `candidates.ladderStepOk`, whatever the link type and slot:

- each rung is **2 to 15 times** farther than the one before (`LADDER_MIN_RATIO`, `LADDER_MAX_RATIO`). The lower bound
  makes A3's hook line ("each rung at least twice as far as the last") true; the upper bound rules out a flat run
  followed by one giant leap. Together they keep the in-galaxy steps even in log distance: the largest step is at most
  log 15 / log 2 ≈ 3.9 times the smallest;
- the only longer step is the **leap out of the Milky Way** (to ≥ 100,000 ly), and only from a rung at least 2,000 ly
  out (`LADDER_LEAP_FROM_LY`), so the ladder climbs through our galaxy first. Nothing visible lies between about
  30,000 and 160,000 ly, so Andromeda can only be reached by a leap; cal-01 A, the owner's favourite, leapt from
  9,170 ly;
- every stop needs a sourced distance; only a Milky Way scene opening A11 is not a rung;
- the "Back home" / "All at once" / "The band again" codas could never pass, so they were removed from
  `src/templates.json` (A3's length is now 5–7: hook, up to four rungs, a twist, the payoff).

The rule lives in `themeLinkOk`, so the beam search, the Held–Karp re-ordering, the archetype switch and the validator
share it. With every step climbing, the narrated comparisons ("about 6 times farther") always go up.

| | before | after |
|---|---|---|
| ladder journeys (A3/A4/A11, all 2,768 grid requests) with a step that is not 2–15× (or the leap) | 696 of 791 | 0 of 301 |
| forced A3 "How Far" requests with a journey (dark / moonlit) | 40.5% (37/58, 29/103) | 24.9% (27/58, 14/103) |
| forced A4 "Time Machine" requests with a journey (dark / moonlit) | 53.8% (44/58, 45/103) | 35.3% (35/58, 24/103) |

Honest ladders are rarer: most old ladders ended with a "back home" coda or jumped 60–160× from a few hundred
light-years to a globular. A wider beam for ladder templates found almost nothing more (A4 +4 of 120 contexts), so
the limit is data: rungs between 1,500 and 10,000 ly near the globulars and galaxies (§8.5).

### 8.2 Never two near-identical suggestions

Owner, cal-02: "C and D are pretty much the same" (two "Same Sky, Different Stories: Ursa Major" tours). Two journeys
are now **near-identical** (`assemble.nearIdentical`) when they share two or more stops, or tell the same archetype
over the same region (same region name, or stop centroids within `NEAR_REGION_DEG` = 20°). Near-identical journeys
are never shown together, not even to make up the number. After narration, two equal titles are also refused (the
clashing journey is set aside and the selection rerun); same archetype + same region already covers every bank title,
since all of them carry `{region}`.

| | before | after |
|---|---|---|
| default requests whose suggestions hold a near-identical pair or an equal title | 46 / 692 | 0 / 692 |
| forced-theme requests with such a pair | 758 / 2,076 | 0 / 2,076 |
| default requests with fewer than 3 journeys | 0 | 21 (5 of them dark; long journeys: 32) |

The 21 short results are southern-spring skies around Grus and Tucana (and two Cassiopeia/Cepheus late nights), where
the pool holds only contrast tours over the same few stars: they used to be three near-copies, now they are one or
two. A forced theme now offers one journey per region (mean journeys per forced theme fell, e.g. A10 2.1 → 0.9).

### 8.3 Heuristic recalibration

The owner ranked a progression with a payoff first (cal-01 A How Far, cal-03 A Stars That Change, cal-02 B Seeing Double
"with a good story") and the contrast tours (A6) low both times h ranked one first. A6 filled 39% of all suggestions
and was the first suggestion in 76% of requests. The calibration is deliberately moderate (three ranked sets); the
changes are in h (`search.ts`, the runtime scorer) and mirrored in the feature-tier weights:

| term (h) | change |
|---|---|
| `ARCHETYPE_PRIOR` | A6 −1.0 (about one stop's interest); A3 +0.3, A4 +0.2, A10 +0.3; A9 0 (first once, last once) |
| `CLEAN_PROGRESSION_BONUS` | +0.3 for a progression of ≥ 3 steps with none against it |
| `CHALLENGE_BONUS` | +0.25 for the (single) challenge stop: "I like the idea of having a challenge in the set" |
| `WEAK_LINK_PENALTY` | −0.3 per derived link weaker than 0.45 (on top of 0.8 × strength); also in the re-ordering DP |
| kind-run term | the −0.4 "three of a kind in a row" no longer applies in star-only themes (A2, A9, A10: `oneKindTheme`), where three stars in a row is the theme |
| `HEURISTIC_WEIGHTS` (v2) | `has_challenge` −0.1 → +0.15, `edge_strength_min` 0.4 → 0.6, `progression_rho` 0.5 → 0.7 |

| | before | after |
|---|---|---|
| A6 share of default suggestions | 39.3% | 35.3% |
| A6 as the first suggestion | 523 / 692 (76%) | 337 / 692 (49%) |
| first suggestion, other archetypes | A12 49, A4 47, A3 29, A9 27, A1 6, A10 5, A5 3, A2 3 | A12 128, A9 93, A10 51, A3 36, A1 29, A4 10, A2 8 |
| weak derived links shown (flags, all requests) | 2,776 | 1,853 |
| dark requests whose three journeys are good and none has a dull payoff | 79 / 232 | 198 / 232 |

On the ranked sets themselves (h of the four journeys at the slate instant), excluding the two journeys the ladder
rule now rejects (cal-01 C, cal-03 D): h agrees with 3 of the owner's 11 known pairwise preferences, before 4.
cal-01 is right both times (A How Far first); cal-02 B, the owner's favourite moonlit double-star tour, stays last
(h 1.96: faint, low stops) but the app now shows it beside the A6 tour as the bright-Moon pick; in cal-03 the two
A6/A9 tours the owner ranked 3rd and 4th still edge out the A10 variable-star tour (4.53, 4.43 vs 4.02). Three
rankings cannot calibrate more than a nudge; the A/B rounds that follow should.

### 8.4 Suggestions from the top of the pool

The calibration slates showed the app's own three suggestions at pool ranks #35..#174. The cause: MMR and the night
rotation's Gumbel noise (0.12) ranged over the whole pool, and the more journeys hold a lottery ticket the deeper the
winner. Each pick is now made among the `PICK_WINDOW` = 8 best journeys still eligible for it (not near-identical to
an earlier pick, of an archetype not shown yet while the pool has one, the bright-Moon slot on a moonlit night): the
rotation only reorders near-equals at the top, and a pick sits deeper only when every journey above it repeats a
story already shown.

| suggestion rank in the full explore pool (120 contexts, 10×50) | before | after |
|---|---|---|
| first suggestion p50 / p90 / max | 11 / 79 / 175 | 2 / 8 / 13 |
| any suggestion p50 / p90 / max | 44 / 152 / 337 | 10 / 99 / 187 |
| rank among distinct options (near-identical pool entries merged) p50 / p90 / max | 1 / 4 / 17 | 1 / 4 / 10 |

In the grid (rank in the pool `generate` drew from, mean 102 journeys): first suggestion p50 / p90 / max 2 / 6 / 7;
the score of every suggestion, normalised over its pool, has median 0.79. Deep second and third picks remain where
the pool's next different story is deep (a contrast-only sky, or the moonlit slot: cal-02's double-star tour is #140
of 147). The rotation now reaches less far, so the same journey returns on more nights (journeys shown on more than
one night: 31.5% → 44.8%; nights ≤ 4 days apart sharing one: 20 → 32 of 128). `PICK_WINDOW` 5 / 8 / 12 gave 48.5 /
44.8 / 42.7% with first-pick p90 4 / 6 / 8; 8 is the compromise.

### 8.5 Grid, before → after

| default requests (5 stops) | before | after |
|---|---|---|
| dark moonless requests with ≥ 3 good journeys | 103/232 (all three valid before the ladder rule: 232) | 227/232 (97.8%) |
| hard-constraint violations (independent) | 1,523 in 696 journeys (all ladder steps) | 0 |
| moonlit requests with ≥ 1 journey / with a bright-Moon archetype | 412/412 / 394/412 | 412/412 / 392/412 |
| empty results | 0 | 0 |
| runtime ms median / p95 / max (warm) | 60.1 / 121.8 / 200.9 | 60.1 / 128.3 / 215.7 |
| first request after load, cold (Sydney May, 5 / 8 stops) | 293 / 286 | 263 / 294 |

| long journeys (8 stops asked) | before | after |
|---|---|---|
| dark moonless requests with ≥ 3 good journeys | 89/232 | 224/232 |
| violations | 760 in 313 journeys | 0 |
| fewer than 3 journeys | 0 | 32 |
| runtime ms median / p95 / max; requests over 300 ms | 83.7 / 192.7 / 324.1; 1 | 73.7 / 168.5 / 251.9; 0 |

The 5 dark requests short of three good journeys are the southern-spring contrast-only skies of §8.2 (Sydney
2027-09-30 23:30, both binoculars; Santiago 2027-10-28 at both times). They need data, not engine rules: non-A6 material around Grus,
Tucana and Phoenix (more doubles and variables), and ladder rungs at 1,500–10,000 ly near 47 Tucanae and the
Magellanic Clouds.

Regression tests: `client/src/lib/journeys/__tests__/engine.owner-r1.test.ts` (ladder rule incl. cal-03 D, near-identical
selection incl. cal-02, priors and terms of h, pick depth on the real KB), plus the updated `engine.eval-fixes`,
`engine.determinism`, `engine.property` and `engine.realkb` tests; `engine-helpers.independentProblems` checks ladder
steps and `resultProblems` the result-level rules. Grid labels: `r1-before2`, `r1-after`, `r1-before-long8`,
`r1-after-long8` (the before engine is a copy in `data-dev/engine-r1-before/`).

## 9. Round 1, second pass: theme balance, visible variables, twelve different A/B pairs (2026-11-02)

Three follow-ups to §8. **Before** is the engine as §8 left it, saved to `data-dev/engine-r2-before/` and re-run
under the same harness on the same KB build (`kb-v1+0e9008da41`); **after** is the current engine. Both grids use
the checker of this section, which now also enforces the variable-star rule of §9.2.

### 9.1 At most one contrast tour, and only where it clearly wins

After §8.3 the contrast tours (A6) were still the first suggestion on half the nights (Santiago and Sydney on
almost two nights in three) and in the top two on 85% of them. The h prior alone cannot fix this: on most patches
of bright stars the pool holds many near-equal A6 tours, so one of them is nearly always near the top. Two
selection rules in `assemble.ts` now apply (`selectTop`, `A6_MARGIN`, `tellsCapped`):

- **One contrast tour per result.** A result holds at most one journey that tells A6, as its template or after an
  archetype switch. A second one is no longer a last resort to make up the number, on the first page or on shuffles.
- **First only when nothing comparable exists.** For every slot, an A6 tour is eligible only when it beats the best
  other eligible journey by `A6_MARGIN` = 0.15 on the pool-normalised score (before the night rotation's noise and
  MMR). Otherwise it waits for a later slot. On a typical night 0.15 of the pool's range is about 0.7 of h, which is
  more than the gaps by which h preferred the A6 tours the owner ranked 3rd and 4th (cal-02, cal-03: about 0.5).
- A forced A6 theme ("contrasts") lifts both rules, because the observer asked for contrast tours.

The margin was tuned on the quick grid (240 default requests, the 15th of each month):

| variant (quick grid) | A6 first | A6 in the top 2 | A6 offered |
|---|---|---|---|
| before | 116 | 207 | 233 |
| at most one A6, no margin | 119 | 213 | 233 |
| margin 0.15 for the first slot only | 70 | 213 | 233 |
| margin 0.15 first, 0.10 later slots | 70 | 176 | 217 |
| margin 0.25 first, 0.10 later slots | 52 | 176 | 217 |
| **margin 0.15 for every slot (shipped)** | **70** | **163** | **210** |

The app's top 3 over the full grid (692 default requests, 5 stops), archetype per position:

| before | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A9 | A10 | A12 |
|---|---|---|---|---|---|---|---|---|---|---|
| #1 | 27 | 0 | 38 | 12 | 0 | **339** | 3 | 101 | 49 | 123 |
| #2 | 32 | 38 | 15 | 52 | 34 | 273 | 13 | 132 | 38 | 56 |
| #3 | 21 | 35 | 22 | 42 | 81 | 151 | 7 | 199 | 91 | 23 |
| offered | 80 | 73 | 75 | 106 | 115 | **664** | 23 | 432 | 178 | 202 |

| after | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A9 | A10 | A12 |
|---|---|---|---|---|---|---|---|---|---|---|
| #1 | 33 | 1 | 39 | 33 | 1 | **224** | 3 | 184 | 18 | 156 |
| #2 | 31 | 44 | 19 | 38 | 43 | 232 | 18 | 141 | 61 | 31 |
| #3 | 20 | 36 | 25 | 47 | 78 | 132 | 9 | 150 | 92 | 23 |
| offered | 84 | 81 | 83 | 118 | 122 | **588** | 30 | 464 | 171 | 206 |

| default requests (5 stops) | before | after |
|---|---|---|
| A6 as the first suggestion | 339 / 692 (49%) | 224 / 692 (32%) |
| A6 in the top two | 587 (85%) | 456 (66%) |
| results offering an A6 tour | 664 (96%) | 588 (85%) |
| results with more than one A6 tour | 81 | 0 |
| A6 first, by site | SF 68/140, Colorado 53/140, London 45/136, Sydney 86/136, Santiago 87/140 | SF 32, Colorado 32, London 14, Sydney 71, Santiago 75 |
| results whose suggestions all tell one archetype | 25 | 0 |
| fewer than 3 journeys | 20 | 80 (34 with one journey) |
| dark moonless requests with ≥ 3 good journeys | 226 / 232 | 218 / 232 |

The cost is shorter lists where the sky holds little but contrast tours. Of the 80 short results, 60 lost a second
or third A6 tour, 13 were already short before and 7 lost another journey (mostly an A10 tour, §9.2). The 34
single-journey results are mostly the southern-spring skies of §8.2 (Sydney and Santiago, September to November,
28 of them), plus Sydney in July at 23:30 and Colorado in February at 23:30. Where A6 still leads, it leads clearly: in the south the next story is usually
0.25–0.5 of the pool's range behind (A2, A5 or A9 tours over thin material). The fix there is data, as in §8.5:
doubles, variables and ladder rungs around Grus, Tucana, Phoenix and Carina.

The first suggestion may now sit deeper in the pool, but only behind A6 tours it is within the margin of (p50 / p90
/ max rank 2 / 7 / 49, was 2 / 6 / 7); the score of the picks, normalised over the pool, is unchanged or higher
(p10 0.389, p50 0.768; was 0.349, 0.753). Staleness rose a little because fewer A6 variants rotate through the
picks (journeys shown on more than one night 46.0% → 50.2%).

### 9.2 Stars That Change: the hook and the payoff swing visibly

The most repeated A10 journey opened on HR 8238 (β Cephei), a pulsator whose brightness changes by 0.05 mag: nothing
an observer can see. In variable-star stories (theme tag `variable-stars`, A10) the hook and the payoff must now
swing by at least `VISIBLE_AMPLITUDE_MAG` = 0.3 mag between `vMax` and `vMin` when the KB knows both
(`candidates.variableStopOk`, part of `slotAccepts`, so the beam search, the re-ordering and the validator share it).
Microvariables stay welcome as supporting stops (build, twist); an unknown amplitude passes. The independent checker
(`engine-helpers.independentProblems`) applies the same rule, and the A10 entry of `src/templates.json` states it.

| | before | after |
|---|---|---|
| A10 journeys (all grid requests) whose hook or payoff swings < 0.3 mag | 205 of 337 (HR 8238 in 144) | 0 of 306 |
| … among the default suggestions | 102 of 178 | 0 of 171 |
| forced A10 requests with a journey (dark / moonlit) | 71.7% (48/58, 68/103) | 56.1% (39/58, 51/103) |
| A10 as the first suggestion | 49 | 18 |

The variable-star tours that remain open on stars you can watch change (P Cygni, the Garnet Star μ Cephei, UU Aurigae)
and close on a Cepheid (δ Cephei in 152 of the 171 default A10 suggestions, Mekbuda). More visible variables in the
KB (Miras, eclipsing binaries) would bring A10 back up. Data gap: five objects carry the role `variable` without a
`variability` record (HR 2095 Mahasim, M25, NGC 129, NGC 6067, NGC 6087), so their amplitude is unknown and passes;
Mahasim opened 2 default A10 suggestions.

### 9.3 Twelve different comparisons for the owner's A/B round

The A/B export (`script/journeys/train/export-ab-pairs.ts`, format `ab-pairs-2`) no longer fixes a hypothesis per
night. It chooses the 12 pairs together (`chooseAll`, an exact branch and bound over the nights):

- no two pairs compare the same two archetypes;
- contrast tours (A6) appear in at most 3 pairs;
- the 24 sides cover at least 9 of the 12 archetypes;
- both sides come from the top of their night's pool (the ranked list `generate` draws from, via `inspectPool`):
  good strict-tier journeys scoring at least 60% of the pool's range (the best three per archetype), or the app's
  own suggestions;
- among the rounds that meet these rules, the one with the best-scoring sides, with a small credit for pairs of the
  app's own suggestions and for each extra archetype covered.

The nights keep the coverage of round 1: five sites (two southern), all eight Moon phases, both binoculars and both
start times. Each pair is then labelled with the most specific hypothesis it tests, and the `hidden` block records
the hypothesis, the theme pair, other differences (a challenge stop, the deep-sky share), each side's score,
normalised score, pool rank and app rank. Left and right are balanced: a seeded half of the pairs shows the
engine's preferred side on the left.

| # | night | Moon | pair | hypothesis | sides (normalised score, pool rank) |
|---|---|---|---|---|---|
| 01 | San Francisco 2027-01-07, dusk+1.5 h, 10×50 | new | A3 / A4 | app-top | A3 100% #0 (app #1) / A4 87% #9 (app #2) |
| 02 | San Francisco 2027-11-01, 23:30, 7×50 | crescent 15% | A3 / A10 | dso-vs-stars | A3 100% #0 / A10 88% #12 |
| 03 | Colorado 2027-07-03, 23:30, 10×50 | new | A4 / A9 | challenge-vs-none | A4 64% #62 / A9 100% #0 |
| 04 | Colorado 2027-10-06, dusk+1.5 h, 7×50 | first quarter | A7 / A9 | app-top | A7 93% #9 (app #2) / A9 98% #2 (app #1) |
| 05 | Colorado 2027-04-02, 23:30, 7×50 | crescent 14% | A4 / A6 | ladder-vs-contrast | A6 85% #0 / A4 64% #8 (app #2) |
| 06 | London 2027-09-19, 23:30, 10×50 | gibbous 84% | A9 / A10 | app-top | A10 72% #22 (app #2) / A9 91% #6 (app #1) |
| 07 | London 2027-12-13, 23:30, 10×50 | full | A6 / A9 | app-top | A6 76% #8 (app #2) / A9 92% #1 (app #1) |
| 08 | London 2027-01-28, dusk+1.5 h, 7×50 | last quarter | A3 / A9 | app-top | A9 78% #13 (app #2) / A3 100% #1 (app #1) |
| 09 | Sydney 2027-07-14, dusk+1.5 h, 10×50 | gibbous 84% | A5 / A12 | dso-vs-stars | A5 57% #157 (app #3) / A12 98% #0 |
| 10 | Sydney 2027-05-06, 23:30, 7×50 | new | A2 / A4 | theme-vs-theme | A4 67% #42 / A2 63% #50 |
| 11 | Santiago 2027-04-20, dusk+1.5 h, 10×50 | full | A6 / A12 | challenge-vs-none | A12 96% #1 / A6 82% #10 |
| 12 | Santiago 2027-01-15, dusk+1.5 h, 7×50 | first quarter | A2 / A5 | app-top | A2 69% #20 (app #2) / A5 38% #50 (app #3) |

Before, the round compared A9 with A10 three times, A3 with A6 and A4 with A6 twice each, showed a contrast tour in
7 of 12 pairs, covered 8 archetypes and reached pool rank 79. Now: 12 different theme pairs, 3 with a contrast tour,
9 archetypes (A2, A3, A4, A5, A6, A7, A9, A10, A12; A1 is only reachable below the 60% floor, and A8 and A11 need
a dark site the nights do not offer). The two sides below 60% are app suggestions (pairs 09 and 12). This table is
from the current KB; the export is deterministic and is rerun after the KB rebuild, so the pairs may change.

### 9.4 Grid, before → after

| default requests (5 stops) | before | after |
|---|---|---|
| hard-constraint violations (independent, including §9.2) | 0 under the §8 checker; the before engine's A10 picks fail §9.2 (quick grid: 30) | 0 |
| near-identical pairs or equal titles | 0 | 0 |
| moonlit requests with a bright-Moon archetype | 388 / 412 | 388 / 412 |
| empty results | 0 | 0 |
| runtime ms median / p95 / max (warm) | 57.2 / 127.3 / 218.1 | 57.6 / 129.3 / 178.1 |
| first request after load, cold (Sydney May, 5 / 8 stops) | 267 / 277 | 255 / 269 |

| long journeys (8 stops asked) | before | after |
|---|---|---|
| A6 first / in the top two / results with more than one A6 | 334 / 578 / 97 | 223 / 498 / 0 |
| violations (checker of §9.2) | 74 in 72 journeys (all A10 hooks or payoffs) | 0 |
| dark moonless requests with ≥ 3 good journeys | 217 / 232 | 214 / 232 |
| fewer than 3 journeys | 31 | 80 |
| runtime ms median / p95 / max; requests over 300 ms | 75.9 / 172.5 / 251.5; 0 | 73.0 / 163.7 / 222.2; 0 |

Regression tests: `engine.owner-r1.test.ts` (theme balance with and without the cap, the margin, shuffles, switched
journeys; `variableStopOk`; pick depth on the real KB, allowing the first pick behind A6 tours only),
`engine.realkb.test.ts` (a contrast-only sky now shows one tour and says why), and `ab-pairs.test.ts` (unique theme
pairs, at most 3 A6 pairs, at least 9 archetypes, sides from the top of their pool; `AB_PAIRS_FILE=<path>` checks
another export). The grid summary has a "Theme balance of the top 3" block; `run-grid.cts --label <l> --summary-only`
re-summarises existing rows. Grid labels: `r2-before`, `r2-after`, `r2-before-long8`, `r2-after-long8`, and the
quick-grid tuning runs `r2-q-*`.
