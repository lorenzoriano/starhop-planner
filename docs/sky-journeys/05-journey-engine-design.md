# 05 — Sky Journeys: journey-assembly engine design

Status: design, phase 1 (no code changed). Owner role: ML/algorithms.
Audience: orchestrator + implementer agents. Branch: `feature/sky-journeys`.

This document specifies the program that, for a given site, night, time, binoculars and sky, **assembles** 3–10-stop
thematic journeys from the knowledge base (KB), orders them as a compact regional path, explains every stop and every
transition, and ranks candidate journeys with a **small learned scorer** trained offline from LLM-judge preferences.
Runtime is client-side, offline, deterministic, and has no LLM.

The KB schema, the concept taxonomy and the educator rubrics are owned by the sibling docs in `docs/sky-journeys/`. This
doc defines only the **contract the engine consumes** (§4) and flags where it depends on them.

---

## 0. Decisions at a glance (opinionated)

| # | Decision | Why |
|---|----------|-----|
| D1 | Model the task as an **orienteering problem with time windows plus a sequence-dependent story reward**, solved by **template-guided beam search** followed by **exact Held–Karp re-ordering** (n ≤ 10). | Orienteering = "pick a subset of scored nodes and a route under a budget" ([Vansteenwegen et al. 2011](https://ideas.repec.org/a/eee/ejores/v209y2011i1p1-10.html)). n ≤ 10 makes exact DP on order cheap (≤ 10·2¹⁰·10 ≈ 10⁵ steps). |
| D2 | **Hard constraints are code, never model.** Visibility, altitude, twilight, Moon, binocular fit and region compactness are filters/validators. The learned model only *ranks* journeys that already passed. | A learned scorer can never produce an unsafe/invisible stop; tests can assert invariants exhaustively. |
| D3 | Region = **spherical cap, default radius 30°** (range 20–40°), max hop 20°, ≤ 1 direction reversal, ≤ 1 sharp (> 135°) turn. | 30° ≈ three fists at arm's length; keeps the observer facing one part of the sky. |
| D4 | Story = **archetype grammars** (≈ 12 JSON templates of *slots* + allowed **typed edges**), not hand-written tours. Objects fill slots dynamically for tonight's sky. | Combinatorial variety from a few hundred objects; no list that "runs out". |
| D5 | Learned scorer = **LightGBM LambdaMART** (lambdarank) over **36 journey-level features**, ≤ 150 trees of ≤ 8 leaves, **monotone constraints** on safety-like features; exported to a compact JSON (~25 KB, ~6 KB gzipped) and evaluated by a ~60-line TS function. A **pairwise-logistic (Bradley–Terry) linear model** on the same features is trained alongside as baseline and as the shipping fallback if the GBDT does not beat it on held-out judges. | LambdaMART is the standard boosted-tree learning-to-rank method ([Burges 2010, MSR-TR-2010-82](https://www.microsoft.com/en-us/research/?p=159784)); tiny trees are trivially portable. |
| D6 | **Features are computed by the same TypeScript module (`features.ts`) at training-data generation and at runtime.** Python only reads a JSONL of feature vectors + labels. | Eliminates train/serve skew — the #1 failure mode of distilled rankers. |
| D7 | Training runs with `uv run --no-project --with lightgbm==4.7.0 --with numpy …` (nothing installed in the system Python). | Verified on this machine: python3 3.12.3 has **no** numpy/sklearn/lightgbm; `uv` is at `~/.local/bin/uv`; PyPI has `lightgbm-4.7.0 manylinux2014_aarch64` and `scikit_learn-1.9.1 cp312 aarch64` wheels (host is aarch64). Node v22.23.3 is present. |
| D8 | Labels come from offline **LLM judge panels** (astronomer, educator, observer-practitioner, 2–3 simulated students), **listwise over slates of 6**, each slate judged twice in reversed order, aggregated per judge-z-score into graded relevance 0–4. | Pairwise/listwise preference labels distil well into small rankers ([Christiano et al. 2017](https://arxiv.org/abs/1706.03741)); order randomisation is required because LLM judges have strong position bias ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685)). |
| D9 | **Narration is a seeded template grammar keyed by edge type**, filling slots only from KB facts that carry a source id. | No runtime LLM; every sentence traceable to a cited fact. |
| D10 | **Determinism:** seed = hash(engine/model/KB versions, local night date, site rounded to 0.1°, start slot rounded to 15 min, request options). Shuffle = Gumbel-top-k over model scores with `seed+shuffleIndex`, with MMR de-duplication. Scores are quantised to 1e-6 before any comparison. | Same night ⇒ same journeys on every device (V8 vs JavaScriptCore `Math.sin` can differ in the last ulp); "Shuffle" gives stable alternatives. |
| D11 | Runs in a **Web Worker** cloned from the `route-worker.ts`/`route-client.ts` pattern (supersede-and-terminate). Budget: ≤ 300 ms desktop, ≤ 1.5 s mid-range phone. | Matches existing architecture. |
| D12 | **Themes are told through lenses** (owner feedback r2): each active theme has a storyline of ordered beats, and each object it may use has a theme-specific chip, question, why, look and answer. Stops follow the beats; an object without a lens is not used. A4 and A10 are retired as journeys. See §5.4a. | Five objects sorted by a number are not a story; a card must say why it is in *this* journey. |

---

## 1. What exists and what we reuse

Read and verified in `client/src/lib/`:

| Need | Reuse | Notes |
|------|-------|-------|
| Alt/az of fixed objects | `eqToHorizontal(ra,dec,lat,lon,date)` (`astronomy.ts`) | Calls `equatorialOfDate`, whose rotation cache in `fixed-equatorial.ts` holds **one** date only. **Loop time-major** (outer: time sample, inner: objects) or the cache thrashes. For the hot loop use the fast path in §5.1. |
| Angular distance / bearing | `angularDistance` (`astronomy.ts`), `directionAngle` (`route-planner.ts`, 0° = N, 90° = E) | `directionAngle` is exported; reuse for hop bearings. |
| Darkness window | `visibilityWindow(…, "night", …)`, `targetWindow`, `nightAltitudeSamples` (`target-visibility.ts`) | Astronomical-dark segments between local noons; handles polar nights. |
| Moon state and moonlight | `moonState`, `scatteredMoonlight`, `targetMoonlight` (`moon.ts`) | Krisciunas–Schaefer 1991 brightening in mag ([paper](https://articles.adsabs.harvard.edu/pdf/1991PASP..103.1033K)). `moonDay(...).windows` gives moonless dark windows for "come back at…" suggestions. |
| Binocular feasibility | `binocularAssessment(target, profile, {alt, moon, skyBrightness})` → `rating 0..3`, `pointLimit`, `contrast`, `glow` (`binocular-assessment.ts`) | Already merges limiting magnitude, surface brightness, double-star split, curated levels, moonlight, low altitude. **Use it as the single source of truth for "binocular-appropriate".** |
| Profiles | `BinocularProfile` (`binocular-assessment.ts`), `KITE_14X50`, optical profiles in `optical-profiles.ts` | FOV in degrees drives hop "fields". |
| Sky brightness | `getSiteSkyBrightness` / `suggestedSiteSkyBrightness` (`site-sky-brightness.ts`) | mag/arcsec² zenith. |
| Twilight rules precedent | `suggestSequence` (`session-planner.ts`) uses Sun ≤ −6° for stellar mag ≤ 5, else ≤ −18°; `minimum` alt 15°; beam over (time, mask). | Journeys are stricter (§5.2). The (tick, mask) beam is a good precedent for time-aware search. |
| Worker plumbing | `route-worker.ts` + `route-client.ts` | Copy the pattern: `journey-worker.ts` / `journey-client.ts`. The worker re-bases `fetch` to `document.baseURI`; keep that. |
| Per-hop star-hop instructions | `planRoutes` (A* with landmark costs) | **Not** called during assembly (too slow × thousands). Each stop card offers "Star hop from previous stop" lazily via the existing route worker. |
| Existing content | `binocular-catalog.json` (187 objects: 92 OC, 27 DS, 20 AST, 16 STAR, 10 GC, 8 GAL, 7 PN, 5 EN, 2 SNR), `messier.json` (110), `binocular-guide-extra.json` (179 curated entries with `family/level/impression/finding/minAperture/variable`), `OBJECT_GUIDES` in `observing.ts`, `bsc5-short.json` (9,096 stars with `K` temperature), 558 survey images in `public/data/binocular-images/` (38 MB) | The KB builds on these ids; engine uses `UnifiedTarget.id` as the object key so cards, sessions and hop routes interoperate. |
| Offline | `script/build.ts` precaches **everything** under `dist/public`; `sw.js` reads `offline-assets.json`. | Any new file in `client/public/data/journeys/` is automatically offline. JSON imported from `client/src/lib/` is bundled into JS. |
| Seeded RNG | none exists | Add `rng.ts` (FNV-1a 32/53-bit hash + mulberry32). |

---

## 2. Problem formulation

Given request *R* (site, time, instrument, sky, options) and KB objects *O* with facts and a typed concept graph *G*:

Find journeys *J = (o₁…oₙ)*, 3 ≤ n ≤ 10, scheduled at *tᵢ = t₀ + (i−1)·m* (m = minutes per stop), such that

* **Hard (feasibility):** every *oᵢ* is visible, high enough, dark enough, Moon-safe and binocular-appropriate at **both** *tᵢ* and *tᵢ + m*; all *oᵢ* lie inside one cap; hop/turn/reversal limits hold; consecutive stops are linked by an allowed typed edge; *J* matches an archetype grammar.
* **Soft (quality):** maximise *score(J)* = learned ranker over journey features (story coherence, wonder, teaching value, path comfort, observing quality, variety).

Return the top-k (default 3) **diverse** journeys plus, for "shuffle", a deterministic stream of alternatives.

Because stop time depends only on **position index**, time-window feasibility inside an order-DP is exact (state = (mask, last), time = t₀ + popcount(mask)·m). This is what makes exact re-ordering cheap.

---

## 3. Pipeline overview

```
JourneyRequest
  │
  ▼ S0  Night context   – darkness segments, t-grid (every 10 min over [t0, t0+D+m]), Moon state per sample
  ▼ S1  Candidate table – per object × time: alt, az, sunAlt, moonSep, K-S glow, binocular rating → feasible bitmask
  ▼ S2  Regions         – generate caps, score, non-max-suppress → ≤ 12 patches
  ▼ S3  Archetypes      – keep (archetype × patch) pairs whose required slots are fillable
  ▼ S4  Beam search     – build sequences slot-by-slot with heuristic h(); edges from story graph
  ▼ S5  Re-order + validate – Held–Karp over slot-partial-order; hard validator
  ▼ S6  Rank            – features.ts → learned model; tie-break by id
  ▼ S7  Diversify       – MMR (λ = 0.7) + Gumbel-top-k for shuffle
  ▼ S8  Narrate         – titles, why-picked, transitions, directions (seeded templates)
JourneyResult { journeys[], diagnostics }
```

---

## 4. Contract with the knowledge base (what the engine reads)

The KB doc owns the full schema; the engine needs **at least** the following, in `client/public/data/journeys/objects.json`
(lazy-fetched by the worker and precached) plus `edges.json`, `archetypes.json`, `transitions.json`. The model goes in
`client/src/lib/journeys/scorer-model.json` (bundled, so it is versioned with code).

```ts
// client/src/lib/journeys/types.ts  (engine-facing view; KB may hold more)
export type ObjectKind =
  | 'star' | 'double' | 'variable' | 'asterism'
  | 'open-cluster' | 'globular' | 'emission-nebula' | 'reflection-nebula' | 'dark-nebula'
  | 'planetary-nebula' | 'snr' | 'galaxy' | 'milky-way-field';

/** Ordinal evolutionary axis used by life-cycle stories. null = not applicable (e.g. galaxy). */
export type LifeStage =
  | 0 /* molecular cloud / nursery */ | 1 /* pre-MS, very young cluster */ | 2 /* main sequence */
  | 3 /* subgiant / giant */ | 4 /* supergiant / AGB */ | 5 /* PN / white dwarf */ | 6 /* SNR / neutron star */;

export interface FactValue { value: number; lo?: number; hi?: number; unit: string; sourceId: string; }

export interface JourneyObject {
  id: string;                      // == UnifiedTarget.id (e.g. "M42", "DS-Albireo", "star:HR2061")
  name: string; ra: number; dec: number; mag: number;
  kind: ObjectKind;
  concepts: string[];              // KB taxonomy ids, e.g. "star-formation","red-supergiant","ionisation"
  stage: LifeStage | null;
  facts: Partial<Record<
    'distanceLy'|'ageMyr'|'teffK'|'radiusRsun'|'massMsun'|'lumLsun'|'sizeLy'|'memberCount'|'periodDays',
    FactValue>>;
  superlatives: string[];          // e.g. "largest-star-in-view","youngest","nearest","oldest"
  interest: number;                // 0..1 curated "wow" prior (educator doc), used as feature, never as filter
  showpiece: boolean;              // finds itself (mag ≤ ~4 or iconic), good opener
  imageIds: string[];              // offline image paths; [] allowed
  hooks: { whySeeKey: string; lookForKey: string };   // narrative snippets (KB-authored text ids)
}

export type EdgeType =
  | 'LIFE_NEXT'      // a → b is the next life stage (stage+1, or curated "becomes")
  | 'CAUSE'          // a causes/illuminates b (Trapezium stars ionise M42; supernova → remnant)
  | 'SIBLING'        // born together / same association (Orion OB1, Ursa Major group)
  | 'CONTRAST'       // same property, very different value (|log10 ratio| ≥ 0.5) or opposite class
  | 'SAME_FAMILY'    // same kind, different specimen (open cluster vs open cluster)
  | 'SCALE'          // size/distance ladder step (ratio ≥ 2 in the archetype's direction)
  | 'TIME_MACHINE'   // light-travel time step
  | 'SAME_PHYSICS'   // illustrate one concept twice (colour = temperature)
  | 'NEIGHBOR';      // physically near each other in space (not just on the sky)

export interface StoryEdge {
  from: string; to: string; type: EdgeType;
  strength: number;                // 0..1
  property?: keyof JourneyObject['facts'];  // for CONTRAST/SCALE/TIME_MACHINE
  curatedReasonKey?: string;       // hand-written transition text id, preferred when present
  directed: boolean;
}
```

Edges have two sources:

1. **Curated** (`edges.json`, from the KB/educator team): the best stories (CAUSE, SIBLING, curated LIFE_NEXT) with a hand-written reason.
2. **Derived at load** (`story-graph.ts`, deterministic rules over facts, computed once per KB version and memoised):
   * `LIFE_NEXT` if `stage(b) = stage(a)+1` (strength 0.6; 0.9 if mass ranges compatible, e.g. a massive star → SNR, a Sun-like star → PN).
   * `CONTRAST` on `teffK`, `radiusRsun`, `lumLsun`, `ageMyr`, `distanceLy` when |log₁₀ ratio| ≥ 0.5; strength = min(1, |log ratio| / 2).
   * `SCALE` / `TIME_MACHINE` same as contrast but directional (archetype chooses ascending/descending).
   * `SAME_FAMILY` if same `kind` (strength 0.4 — weak; useful only for "family" archetypes).
   * `SAME_PHYSICS` if ≥ 1 shared non-trivial concept (strength = Jaccard of concepts).
   * `NEIGHBOR` if 3-D separation < 300 ly (from distance + sky position).

Derived edges are computed on the **whole KB** (≈ 400–600 objects → ≤ 360k pairs, < 50 ms) and then sliced per night.
The derived set is a JSON-free memo; only curated edges ship as data.

> **Data-quality gate (engine side):** an object is journey-eligible only if it has `kind`, `concepts.length ≥ 1`, at
> least one sourced numeric fact, and `hooks`. The KB validator test (KB doc) must enforce this.

---

## 5. Stage details

### 5.1 S0/S1 — night context and the candidate table

Time grid: `t₀` = request start (snap to the minute), horizon `D` = duration (default 60 min, max 180), step 10 min, plus every
scheduled stop boundary. For n ≤ 10 and m = 8 min this is ≤ 20 samples.

Per sample: `moonState`, `sunAlt` (from `moonState().sunAlt`), and GAST once. Fast alt/az for fixed objects: precompute
`equatorialOfDate(ra,dec, t_mid)` once per object (precession over 3 h is < 0.01°), then per sample
`ha = gast·15 + lon − ra_d`; standard spherical formula (identical to `eqToHorizontal`'s body). 600 objects × 20 samples
= 12k trig evaluations ≈ 2–5 ms. Moon separation uses `angularDistance(obj, moon.ra/dec)`; glow uses `scatteredMoonlight`.

`binocularAssessment` is comparatively expensive (string regex + recursion for the baseline). Call it **once per object at
the sample where its altitude is maximal within the window, and once at the minimum**, and use the worse rating for the
whole window (conservative, monotone in alt and glow). Cache by `(id, round(alt,0), round(glow,1))`.

Store in typed arrays: `alt: Float32Array[N·T]`, `glow: Float32Array[N·T]`, `moonSep: Float32Array[N·T]`, `ok: Uint8Array[N·T]`
(bit flags per constraint so diagnostics can say *why* an object failed), `rating: Int8Array[N]`.

### 5.2 Hard constraints (the validator — single source of truth)

`constraints.ts` exports `stopViolations(objIdx, t, ctx): Violation[]` and `journeyViolations(J, ctx): Violation[]`.
Defaults (all overridable in `JourneyRequest`, with the floors shown):

| Constraint | Default | Floor / notes |
|------------|---------|---------------|
| Altitude at tᵢ and tᵢ+m | ≥ **30°** | user may lower to 25°; engine fallback may lower to 25°, never below |
| Sun altitude | ≤ −18° for everything; ≤ **−12°** for `star`/`double`/`asterism` and clusters with mag ≤ 4.5 | Stricter than `suggestSequence` (−6°): we want a dark-adapted, coherent session. A "Twilight stars" archetype explicitly allows −10°. |
| Moon separation (Moon above −0.25°) | ≥ **max(15°, 10° + 30°·illum)** | e.g. full Moon ⇒ ≥ 40° |
| K-S moonlight brightening at tᵢ | diffuse (nebula/galaxy/PN/SNR/dark/MW field) ≤ **0.7 mag**; globulars/clusters ≤ **1.2 mag**; stars/doubles ≤ **2.5 mag** | from `scatteredMoonlight` with request sky brightness |
| Binocular rating (`binocularAssessment`) | **0–1** always OK; **2** allowed for at most **one** stop, never stop 1 or 2, flagged `challenge`; **3** forbidden | level `first-night` ⇒ no rating 2 at all |
| Doubles | if presented as "split this pair", split rating must be ≤ 1; otherwise card must present it as a single/colour star | narration checks this flag |
| Angular extent | major axis ≤ 3 × FOV unless `kind ∈ {asterism, milky-way-field}` or curated level `large` | |
| Region cap | all stops within **R = 30°** of the cap centre | R ∈ [20°, 40°]; user "wide" option = 40° |
| Max hop | ≤ **20°** (and ≤ 0.75·R) | |
| Total path | ≤ **2.5·R** (75° at R = 30°) | |
| Sharp turns | turns > **135°** at most **once** | turn = 180° − interior angle in the tangent plane |
| Direction reversals | ≤ **1** sign change of the progress along the cap's principal axis (n ≥ 5) | definition below |
| Duplicates | no object twice; no two stops < 0.5° apart (unless curated pair, e.g. M42/M43 merged as one stop) | |
| Story | every consecutive pair has an allowed edge of strength ≥ 0.35 for the archetype | |

**Principal-axis reversal metric.** Project stops gnomonically about the cap centre → points pᵢ in a plane. Compute the
2×2 covariance, take the major eigenvector u. Progress sᵢ = pᵢ·u. A reversal is a sign change in (sᵢ₊₁ − sᵢ), ignoring
steps with |Δs| < 0.15·R (small sidesteps are fine). This captures "no east/west/north/south zig-zag" independently of
sky orientation and is rotation-invariant (turn angles and reversals don't change as the sky turns during the session).

### 5.3 S2 — region (patch) generation and scoring

Centres: (a) every feasible object's position, (b) a Fibonacci sphere grid of 400 points filtered to centre-alt ≥ minAlt +
10° at t_mid. For each centre c with radius R:

```
patchScore(c) = Σ_{top 8 feasible objects in cap by interest}  interest(o)
              + 0.5 · (#distinct concepts in cap) / 10
              + 0.3 · smoothstep(centreAlt, 40°, 70°)
              − 1.0 · [Moon within R + 10° of c and illum > 0.5]
              + 0.8 · regionHintMatch(c)          // user picked e.g. "Orion, high in the south"
```

Non-max suppression: keep best, drop centres within 15° of a kept one, until 12 patches. Patches with < 3 feasible objects
are discarded. Label each patch for the UI from its centre's alt/az (`compassLabel` in `observing.ts`) and the dominant
constellation ("high in the south, around Orion").

### 5.4 S3 — archetype grammars (the story layer)

An archetype is a small grammar, not a tour. File `client/public/data/journeys/archetypes.json`:

```ts
export interface ArchetypeSlot {
  role: string;                         // "nursery", "young-family", "dying-giant", "corpse"...
  match: {                              // all present clauses must hold
    kinds?: ObjectKind[]; anyConcepts?: string[]; allConcepts?: string[];
    stageIn?: LifeStage[]; superlatives?: string[]; minInterest?: number;
  };
  optional?: boolean;                   // may be skipped
  repeat?: [number, number];            // e.g. [1,3] → 1..3 consecutive fillers
}
export interface Archetype {
  id: string; titleKeys: string[];      // narrated titles, seeded choice
  slots: ArchetypeSlot[];
  order: 'strict' | 'partial' | 'free'; // partial: slots may swap only inside declared groups
  swapGroups?: number[][];              // indices of slots that may permute (partial order)
  edges: EdgeType[];                    // allowed links between consecutive stops
  progression?: { property: keyof JourneyObject['facts'] | 'stage'; direction: 'up'|'down'|'arc' };
  length: [number, number];             // e.g. [4, 8]
  levels?: ('first-night'|'curious'|'keen')[];
  themeTags: string[];                  // for user-chosen theme filter
}
```

Initial set (12; the educator doc may rename/extend — engine is data-driven):

| id | Slots (→ = consecutive) | Edges | Progression |
|----|-------------------------|-------|-------------|
| `life-of-stars` | nursery → young-family → main-sequence-star(opt) → giant/supergiant → corpse (PN/SNR) | LIFE_NEXT, CAUSE, SIBLING, CONTRAST | stage, `arc` allowed (journey may start at a giant and circle back to a nursery) |
| `fates-by-mass` | massive-star → its fate (SNR) → Sun-like giant → its fate (PN) | LIFE_NEXT, CONTRAST | free |
| `colour-is-temperature` | hot-blue star → cool-red star → (double with contrast) → cluster with mixed colours | CONTRAST, SAME_PHYSICS | teffK `down` or alternate |
| `giants-and-dwarfs` | biggest star in view → smallest/compact → … | CONTRAST, SCALE | radiusRsun |
| `star-families` | young open cluster → older cluster → ancient globular | SAME_FAMILY, CONTRAST, SCALE | ageMyr `up` |
| `cosmic-distance-ladder` | nearby star → cluster → nebula → globular → galaxy | TIME_MACHINE, SCALE | distanceLy `up` |
| `nurseries-and-what-they-make` | nebula → embedded/young cluster → hot stars that light it | CAUSE, SIBLING | free |
| `gravity-dances` | wide double → colour double → multiple → binary-driven variable | SAME_FAMILY, CONTRAST | free |
| `variable-hearts` | pulsating variable → eclipsing binary → long-period red variable | SAME_PHYSICS, CONTRAST | free |
| `our-galaxy-and-beyond` | Milky Way field → open cluster in disc → globular in halo → another galaxy | SCALE, TIME_MACHINE | distanceLy `up` |
| `twilight-stars` (Sun ≤ −10°) | 3–5 bright stars and doubles only | CONTRAST, SAME_PHYSICS | free |
| `free-walk` | any 4–7 stops | any edge with strength ≥ 0.5 **and** concept overlap with one of the 2 previous stops ≥ 1 | none — a drifting theme with local coherence |

`free-walk` is what makes "the theme can evolve" work without a template: each step must be locally coherent, and the
`theme-drift` feature (§7) lets the model learn when drift is delightful vs. confusing.

Pre-check per (archetype, patch): every non-optional slot has ≥ 1 feasible matcher in the patch; otherwise skip. Typically 3–7
archetypes survive per patch.

### 5.4a Theme lenses and storyline beats (owner feedback r2)

Owner feedback round 2 (`owner-feedback-r2.md`) found that the slot grammars above produce a good premise with
disjoint cards: five objects sorted by a number are not a story, and a card that reads the same in every journey does
not say why the object is there. Every active theme is therefore told through a **theme lens**, and the lens replaces
the slot grammar for that theme.

**Active and retired themes.** Ten themes are journeys: A1 cradle to grave, A2 thermometer (colors), A3 how far (a
distance ladder of rulers), A5 families, A6 contrasts and look-alikes, A7 record breakers, A8 how stars die, A9 seeing
double, A11 inside our galaxy, A12 moonlit. **A4 time machine** (distance sorting by another name; lost every round-1
pair) and **A10 stars that change** (variability cannot be seen in one night) are retired. They are marked
`"retired": true` in `client/public/data/journeys/src/templates.json`; `build_kb.ts` drops them and every `chainTo`
or `switchRule` target that names them. Their facts stay on the cards (light-travel time, variability).

**Source.** One file per active theme, `script/journeys/curated/lenses/<archetype>.json` (schema
`ThemeLensFileSchema` in `kb-schema.ts`, types `ThemeStoryline`, `StorylineBeat`, `ThemeLens` in `types.ts`):

- `storyline`: one paragraph, the thread every journey of the theme follows.
- `beats`: ordered ideas (`step`, `label`, `maxStops`, default 1). Each beat must add an idea that needs the one
  before (A3: parallax → a cluster's shared parallax → main-sequence fitting → a cluster lends its distance to a
  bright star → Cepheids in another galaxy).
- `minBeats`: fewest distinct beats a journey must cover; `endSteps`: beats a journey may end on (A1 ends on "on the
  brink" or "the end"; A9 on partners or a crowd; A11 on 4–6; A12 on a glow or a cluster); optional `firstSteps`:
  beats a journey may open on without the opening penalty (default: the lowest beat with an in-reach candidate, rule
  6 below); optional `keySteps`: beats that carry the theme's turn (A9: strangers), whose omission while in reach
  costs `KEY_BEAT_FACTOR` (2) × the skip and repeat prices (rule 6).
- `objects`: per object `step`, `beat` (the chip), `question` (≤ 16 words, ends with "?"), `why` (its role in this
  story, no give-away), optional `look` (what to look at for this theme, true for binoculars), `answer` (moves the
  thread forward), optional `story` (1–4 sentences, validated; the mechanism or how-we-know for this theme, shown as
  the card's Story box, which sends the shared `card.understand` under "More about {name}") and optional `rank` (the
  order of stops that share a beat, ascending; writers use the theme's own quantity: age for A5, distance for A3 and
  A11, temperature for A2).
- `transitions`: `pairs["a>b"]` and `arrive["b"]` lines with `{prev}`/`{next}` (and `{hook}`, `{kind}`, `{ago}`,
  `{year}`); the build requires a line for every way into every beat.
- `narration`: theme lines that override the bank (`title.*`, `question.*`, `hook.*`, `story.*`, `payoff.*`).
  Beat-aware variants `title.<template>.end<N>`, `story.<template>.end<N>` and `payoff.<template>.end<N>` are tried
  before the generic key when the journey's last stop is on beat N (`narrate.ts`), so a story or payoff can name the
  ending the night reached and never promises one it did not. Every sentence must stay ≤ 220 characters after
  `{hook}`/`{name}` are filled (`narrationProblems`).

`npm run journeys:kb` validates every file (`script/journeys/kb/lenses.ts`), merges `narration` into the bank and
writes the runtime sets to `client/public/data/journeys/lenses.json`.

**Engine rules** (`candidates.ts` `compileLensTemplate`, `search.ts`, `validate.ts`, `order.ts`):

1. An object without a lens for a theme is not a candidate in that theme.
2. The template's slots become one optional slot per beat, in strict order, repeatable up to `maxStops`: stops run in
   non-decreasing step order, and a journey must cover at least `minBeats` distinct beats. Stops that share a beat
   follow `lens.rank` (ascending; `lensRankOk`, enforced by the beam, the re-ordering DP and the validator); without
   ranks any order passes.
3. The arc is positional: the first stop is the hook, the last the payoff. The payoff stop must be, for a star,
   bright enough, and its beat must be in `endSteps`. It may be a challenge only on the theme's final beat or an end
   beat (`lensPayoffOk`, `lensFinaleSlot`: A8 closing at the Veil or the Crab) and never a variable that may have
   faded (`fadingFloor`); a challenge is by definition visible tonight (rating 2, never 3; never stops 1–2).
4. A lens whose `look` promises a split is used only when the selected binoculars split the pair (`lensVisibleOk`).
5. The link between two lens stops is the best real edge, else the lens thread link (`LENS_LINK_STRENGTH`). A3 also
   requires each rung to lie at least `LENS_LADDER_MIN_RATIO` (1.25) times farther than the one before. The one
   allowed back-track may ride the storyline when it moves on to a later beat (`backtrackLinkOk`; otherwise it needs a
   link of strength ≥ 0.85). This is what lets A9 visit Albireo, 10° off Lyra with nothing beyond it in reach.
6. **Whole stories** (round 3, `search.ts` `lensCoverageTerm`, scoring penalties rather than hard rules so a night
   whose only nursery leads nowhere still gets a journey). A beat is *in reach* when an object with a lens on it is
   inside the region cap, a sure sight (rating < 2) at that position, within one hop of its would-be neighbours and
   not sharing their view. h pays `LENS_OPEN_PENALTY` (1.5) when the journey opens on a later beat although an
   earlier one is in reach of its first stop (a `firstSteps` beat is always a fine opening), `LENS_SKIP_PENALTY`
   (1.0) per beat jumped over while in reach of both neighbours, and `LENS_REPEAT_PENALTY` (0.5) for a second stop on
   one beat while the next, unvisited beat was in reach (both × `KEY_BEAT_FACTOR` for a `keySteps` beat). The
   progression term scores beats covered, and reaching the theme's last beat earns `LENS_FINALE_BONUS` (0.5).
7. **One story per journey**: a lens theme never switches and is never switched into (`switchArcOk`,
   `switchableInto`, validator). Switches produced a second payoff stop, dropped the first theme's payoff and put the
   second theme's raw question into a transition. Non-lens templates keep their switch rules.
8. **Selection**: a journey with fewer than `SHORT_JOURNEY_STOPS` (4) stops ranks after every journey of the same
   theme that has more (`assemble.ts` `SHORT_JOURNEY_DEMOTION`), whatever the tiers and scores.
9. **Ratings** (`conditions.ts` `makeRater`): on a moonless night a curated view grade alone rates a deep-sky object
   from `CURATED_GRADE_MIN_ALT` (30°) up. The mean-surface-brightness model had rated the Orion, Lagoon and Carina
   nebulae invisible from a suburban sky, so A1 could never open at its nursery. With the Moon up, or lower down, the
   more cautious of grade and model still decides.

**Card resolution** (`lib/journeys/stop-card.ts` `resolveStopCard`, shared by the UI and the A/B export): beat chip
= `lens.beat`; question = `lens.question`; the transition then `lens.why`; what to look at = `lens.look ?? card.see`;
the theme story (`lens.story` when the lens has one; the shared `card.understand` then moves under "More about
{name}", where it also sits on lens stops without a story); `lens.answer`; the wonder line; the journey payoff on the
last stop, with no label (beat-aware: `payoff.<template>.end<lastStep>` first, likewise `story.<template>.end<lastStep>`
for the overview).

**Which journey the app shows first.** Among journeys of similar score the app rotates by a seed that includes the KB
version (`assemble.ts` `rotationSeedOf`), so any rebuild of the KB, even a one-word card edit, can change the first
journey of a theme on a given night. Hand-picked A/B rounds (`export-ab-pairs.ts --themes`) must therefore be
exported last, after the final KB build, and re-exported after any later KB change.

**Known gaps** (open after round 3): the KB now holds the southern planetary nebulae NGC 2440, NGC 3132 and NGC 3242
(and the Helix), but few southern A1 paths reach one within the hop limit, so most southern A1 nights still end on a
star on the brink (A8 reaches NGC 2440 through π Puppis on dark 10×50 nights); a forced-theme journey may close on a
challenge remnant (A1 at the East Veil on some Colorado nights), which the app allows on a final beat but the A/B
exporter vetoes; Albireo lies 20.6° from 31 Cygni and 22.5° from 16 Cygni (hop limit 20°), so
the only A9 journeys through it are 4-stop Lyra loops until a double nearer to it gets an A9 lens.

### 5.5 S4 — beam search

For each surviving (archetype A, patch P):

```
state = { seq: objIdx[], slotPtr, usedMask, pathLen, lastBearing, reversals, sharpTurns, challengeUsed, h }
beam₀ = openers: matchers of slot 0 (or first non-optional) with feasible(t₀); showpieces get +0.3 (good first light)
for depth = 1 .. A.length[1]-1:
  for state in beam:
    for each next slot option (current slot repeat, next slot, skip optional):
      for o in matchers(slot) ∩ feasibleAt(t₀ + depth·m) ∩ cap(P) \ used:
        e = bestEdge(seq.last, o, A.edges); if !e or e.strength < 0.35: continue
        geometric checks (hop ≤ maxHop, turn/reversal counters within limits, pathLen ≤ 2.5R)  // prune early
        h' = h + heuristicStep(state, o, e)
        push
  beam = top-B by h' (B = 24), dedupe by (usedMask, last)
  completed states (slots satisfied, length within A.length) → candidate pool
```

`heuristicStep` (hand-tuned; also the "hand-tuned baseline" for evaluation):

```
  1.0·interest(o) + 0.8·e.strength + 0.4·[o has superlative]
− 0.6·hop/R − 0.5·max(0, turn − 90°)/90° − 0.8·glow(o,t)/0.7 − 0.6·max(0, 45° − alt)/15°
+ 0.3·[new concept introduced] − 0.4·[same kind as previous two]
+ progressionStep(A, prev, o)          // +0.3 if step follows A.progression, −0.3 if against (arc: sign may flip once)
```

Budget: 12 patches × ~5 archetypes × B 24 × branching ≤ 25 × depth ≤ 9 ≈ 3.2M edge checks worst case; with typed-array
lookups and early geometric pruning, measured target ≤ 250 ms in a worker on a phone. **Safety valve:** global expansion
counter; at 2M expansions, reduce B to 12 for the remaining pairs (deterministic order: patches by score, archetypes by id).

### 5.6 S5 — exact re-ordering and validation

Geometric order and story order conflict (worked example in §11). For each completed candidate set S (|S| = n ≤ 10):

* Build the slot partial order from `A.order`/`swapGroups` (strict ⇒ a chain; free ⇒ no constraints; `arc` progression
  ⇒ allow one direction change).
* Held–Karp DP ([Held & Karp 1962](https://doi.org/10.1137/0110015)) over `(mask, last)`:
  `cost = Σ hop + 0.25·R·[turn>135°]` (turn approximated by keeping best predecessor) subject to: precedence respected,
  feasible(oₖ at t₀+(k−1)m), consecutive edge exists. 2ⁿ·n² ≤ 102,400 transitions.
* Then one pass of **Or-opt** (move one stop) with the exact turn/reversal metrics.
* Keep the better of (beam order, re-ordered) by heuristic h.
* Run `journeyViolations`. Anything non-empty is **dropped** (and counted in diagnostics — a non-zero count in tests is a bug
  in pruning, not a runtime error).

### 5.7 S6/S7 — ranking and diversification

1. Compute `features(J)` (§7.2) → `model.score(x)`; quantise `Math.round(s·1e6)/1e6`; tie-break by `journey.id`
   (stable hash of ordered object ids + archetype id).
2. **MMR** ([Carbonell & Goldstein 1998](https://doi.org/10.1145/290941.291025)) to pick k: maximise
   `0.7·ŝ(J) − 0.3·max_{J'∈picked} sim(J,J')`, `sim = Jaccard(objects) + 0.3·[same archetype] + 0.2·[same patch]`.
   ŝ = min-max normalised scores of the pool.
3. **Shuffle** (`shuffleIndex = k ≥ 1`): Gumbel-top-k sampling ([Kool et al. 2019](https://arxiv.org/abs/1903.06059)) — add
   `τ·Gumbel(rng(seed, k, journey.id))` with τ = 0.15 to ŝ, then MMR, excluding any journey with Jaccard ≥ 0.5 to
   anything shown at indices < k. Deterministic per (seed, k), endless, and still quality-weighted.
4. **Novelty (optional):** if `seenObjectIds` given (from saved session observations), add feature `seen_fraction`; the
   model learns its weight; the UI can also offer "only new objects".

### 5.8 Fallbacks and diagnostics

If < k journeys survive, relax **in this order** and record each relaxation in `diagnostics.relaxed[]` (the UI must show it):
(1) length min 4 → 3, (2) R 30° → 40°, (3) minAlt 30° → 25°, (4) allow one challenge stop at level `first-night`,
(5) add `twilight-stars`. Never relax Moon/twilight/rating-3 rules. If still empty, return `diagnostics.blockers`
(counts per violated constraint from the `ok` bit flags) and `suggestions` from `moonDay(...).windows` and the next
astronomical-dark hour: "Full Moon 12° from Orion; after 23:40 the Moon is in the west and a 5-stop journey opens up."

---

## 6. Public interfaces

```ts
// client/src/lib/journeys/types.ts
export interface JourneyRequest {
  lat: number; lon: number; timezone: string;
  start: string;                 // ISO instant; engine never reads Date.now()
  durationMinutes?: number;      // default 60, 20..180
  minutesPerStop?: number;       // default 8 (≈6 observe + 2 move), 4..20
  stops?: [number, number];      // default [4, 7], clamp to [3, 10]
  instrument: BinocularProfile;  // magnification, aperture, fov°, stabilized, transmission
  skyBrightness: number;         // zenith mag/arcsec²
  minAltitude?: number;          // default 30, floor 25
  capRadius?: number;            // default 30, 20..40
  theme?: string | null;         // archetype themeTag
  regionHint?: { alt: number; az: number } | { constellation: string } | null;
  level?: 'first-night' | 'curious' | 'keen';  // default 'curious'
  seenObjectIds?: string[];
  shuffleIndex?: number;         // 0 = canonical
  limit?: number;                // default 3
}

export interface HopInfo {
  distanceDeg: number; fields: number;         // distance / instrument.fov
  skyBearing: number;                          // directionAngle, 0=N 90=E
  screenBearing: number;                       // relative to the horizon at tᵢ: 0=up (toward zenith), 90=right
  altChange: number;                           // + = climb
}
export type ReasonCode =
  | { kind: 'slot'; role: string } | { kind: 'superlative'; tag: string }
  | { kind: 'edge'; edge: EdgeType; property?: string; ratio?: number }
  | { kind: 'showpiece' } | { kind: 'challenge' } | { kind: 'conditions'; note: 'moon-far' | 'high' | 'setting-soon' };

export interface JourneyStop {
  objectId: string; index: number; role: string;
  at: string; alt: number; az: number;
  moonSepDeg: number | null; moonGlowMag: number; rating: 0 | 1 | 2;
  challenge: boolean;
  edgeIn: { type: EdgeType; strength: number; property?: string; curatedReasonKey?: string } | null;
  hopIn: HopInfo | null;
  why: ReasonCode[];
  minutesAboveMinAlt: number;                  // margin before it drops below minAlt (for "see this first" hints)
}
export interface JourneyMetrics {
  pathDeg: number; maxHopDeg: number; reversals: number; sharpTurns: number; capRadiusUsed: number;
  minAlt: number; maxGlowMag: number; minMoonSep: number | null;
}
export interface Journey {
  id: string; archetypeId: string;
  region: { ra: number; dec: number; radiusDeg: number; alt: number; az: number; label: string };
  stops: JourneyStop[]; metrics: JourneyMetrics;
  score: { model: number; heuristic: number; modelVersion: string };
}
export interface NarratedJourney extends Journey {
  title: string; subtitle: string;
  stopText: { whyHere: string; transition: string | null; direction: string | null; lookFor: string }[];
}
export interface JourneyResult {
  journeys: NarratedJourney[];
  seedKey: string; engineVersion: string; kbVersion: string; modelVersion: string;
  diagnostics: { candidates: number; validated: number; droppedByValidator: number;
                 relaxed: string[]; blockers?: Record<string, number>; suggestions?: string[]; ms: number };
}

// client/src/lib/journeys/engine.ts
export function assembleJourneys(req: JourneyRequest, kb: LoadedKb, model?: RankerModel): JourneyResult;
// client/src/lib/journeys/journey-client.ts
export function assembleJourneysInWorker(req: JourneyRequest): Promise<JourneyResult>;
```

The engine is a pure function of `(req, kb, model)` — no `Date.now()`, no `Math.random()`, no `localStorage`. This makes it
callable from vitest, from the Node training-data generator (`tsx`), and from the worker.

---

## 7. The learned scorer

### 7.1 Why and what exactly

The product owner wants learning, not just rules. The honest place for learning here is **taste**: which of several
*valid* journeys a curious binocular observer and a good teacher would prefer — story arc, wonder, variety, pacing,
comfort. Those trade-offs are hard to hand-weight and easy for judges to compare. Validity stays in code (D2).

Model: **LightGBM `lambdarank`** ([LightGBM params](https://lightgbm.readthedocs.io/en/stable/Parameters.html)), one query
group = one (conditions, patch) slate. Hyper-parameters (start point; tune with grouped CV):
`num_leaves=8, max_depth=3, learning_rate=0.05, n_estimators≤300 with early stopping on val NDCG@3 (expect 80–150),
min_data_in_leaf=20, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambdarank_truncation_level=6,
label_gain=[0,1,3,7,15], seed=7, deterministic=true`.

**Monotone constraints** (`monotone_constraints`, +1 increasing / −1 decreasing) on features where "more is better/worse"
is non-negotiable, so the model can't learn a perverse preference from judge noise:
`min_alt +1, mean_alt +1, max_glow −1, min_moon_sep +1, max_hop_deg −1, reversals −1, sharp_turns −1,
path_over_cap −1, fact_coverage +1, image_coverage +1, edge_strength_mean +1`.

**Baseline/fallback:** pairwise logistic (Bradley–Terry, [Bradley & Terry 1952](https://doi.org/10.2307/2334029)) on
standardised feature differences, L2-regularised; 36 weights + mean/std. Trained in the same script with numpy (no sklearn
needed). Ship whichever wins on the held-out test (§7.6); both use one JSON schema discriminated by `type`.

### 7.2 Feature vector (36, computed in `features.ts`, all finite, clipped)

Notation: n stops, R cap radius, FOV instrument field, hᵢ hop distances, tᵢ scheduled times.

**Geometry / path comfort (9)**
| # | name | definition |
|---|------|-----------|
| 0 | `n_stops` | n |
| 1 | `mean_hop_deg` | mean(hᵢ) |
| 2 | `max_hop_deg` | max(hᵢ) |
| 3 | `path_over_cap` | Σhᵢ / R |
| 4 | `mean_turn_deg` | mean of turn angles (0 = straight), tangent plane at cap centre |
| 5 | `sharp_turns` | #turns > 135° |
| 6 | `reversals` | principal-axis reversals (§5.2) |
| 7 | `cap_used` | max distance of a stop from the stops' centroid / R |
| 8 | `log_hop_fields` | mean log₂(1 + hᵢ/FOV) — hops in binocular fields |

**Observing quality (9)**
| # | name | definition |
|---|------|-----------|
| 9 | `min_alt` | min over stops of alt at tᵢ |
| 10 | `mean_alt` | mean alt at tᵢ |
| 11 | `max_glow` | max K-S brightening (mag) |
| 12 | `min_moon_sep` | min Moon separation (180 if Moon down) |
| 13 | `mean_rating` | mean binocular rating (0..2) |
| 14 | `has_challenge` | 1 if a rating-2 stop exists |
| 15 | `min_margin_min` | min `minutesAboveMinAlt` after tᵢ+m, capped at 180 |
| 16 | `twilight_stops` | #stops with Sun > −18° |
| 17 | `setting_first` | Kendall-τ between stop index and "time until object drops below minAlt" (positive = observe setting objects first) |

**Story / teaching / wonder (14)**
| # | name | definition |
|---|------|-----------|
| 18 | `edge_strength_mean` | mean consecutive edge strength |
| 19 | `edge_strength_min` | min consecutive edge strength |
| 20 | `curated_edge_frac` | fraction of consecutive edges that are curated |
| 21 | `edge_type_count` | #distinct edge types used |
| 22 | `kind_count` | #distinct object kinds |
| 23 | `concept_count` | #distinct concepts |
| 24 | `progression_rho` | Spearman ρ between index and archetype progression property (0 if none; |ρ| for `arc` after split at the turning point) |
| 25 | `interest_mean` | mean KB interest |
| 26 | `interest_max` | max KB interest |
| 27 | `opener_showpiece` | 1 if stop 1 or 2 is a showpiece |
| 28 | `finale_lift` | interest(last) − interest_mean |
| 29 | `superlative_count` | #stops carrying a superlative |
| 30 | `scale_span` | log₁₀(max distanceLy / min distanceLy) among stops with distance (0 if < 2) |
| 31 | `theme_drift` | 1 − mean concept-Jaccard between consecutive stops (high = drifting) |

**Content support + context (4)**
| # | name | definition |
|---|------|-----------|
| 32 | `fact_coverage` | mean over stops of (#sourced numeric facts / 6), capped at 1 |
| 33 | `image_coverage` | fraction of stops with ≥ 1 offline image |
| 34 | `moon_illum` | Moon illumination 0..1 if up during journey, else 0 |
| 35 | `sky_brightness` | request zenith SQM value |

Notes: `archetype` is **not** a feature (the model would memorise template popularity and kill variety); its effect is
expressed via the generic story features. `theme match` and `seen_fraction` are post-model additive terms
(`+0.5·themeMatch`, `−0.5·seen`) applied only when the user set them, because judge slates do not vary them. Feature list
order and names are frozen per `modelVersion` and stored in the model JSON; `features.ts` asserts equality at load.

### 7.3 Training-data generation loop

All generation code is TypeScript run with `npx tsx` and imports the real engine. Output lives in
`data-dev/journeys-training/` (git-ignored except for the final aggregated labels and the model).

1. **Conditions sampler** (`script/journeys/sample-conditions.ts`, seeded): Latin-hypercube over
   * 18 sites: latitudes −35°…+60° (incl. Sydney, Santiago, Cape Town, Nairobi, Mexico City, San Francisco, Denver, Rome,
     London, Oslo, Tokyo…), real time zones via `tz-lookup`;
   * 24 dates/year (both halves of every month) × start times {dusk+30 min, 22:30, 01:30 local};
   * Moon phase is implied by date — stratify so that ⅓ of nights have illum > 0.6 with the Moon up;
   * instruments {7×50 FOV 7.1°, 10×50 6.5°, 15×70 4.4°, KITE 14×50 3.7°};
   * sky {18.5, 20.0, 21.3} mag/arcsec²; level {first-night, curious, keen}.
2. **Slate generator** (`script/journeys/generate-slates.ts`): run the engine with `explore: true` (an internal option: no
   MMR, larger beam) and for each (conditions, patch) emit a **slate of 6 valid journeys**: 2 top by heuristic, 2 from the
   middle of the pool, 1 uniform-random valid, 1 *perturbed* (re-order with more turns but still valid, or swap a stop
   for a weaker-edge alternative). Every slate member passes `journeyViolations` — the model must learn taste among
   valid journeys, the runtime distribution. Store **the full journey JSON + narrated text + feature vector**, so features
   can be recomputed later when `features.ts` changes (key for iteration).
3. **Judge rendering**: each journey rendered as the observer would see it (title, per-stop "why here", transition,
   direction in binocular fields, alt and Moon notes, one key fact per stop) plus a compact table (alt, hop°, rating).
   No scores, no features, no archetype id.
4. **Judge panel** (offline, run as Claude Code workflow agents — the same harness producing these docs; never shipped):
   * Personas: **Astronomer** (physical correctness, coherence of the physics thread), **Educator** (arc, scaffolding,
     explanation quality, the educator doc's rubric), **Observer-practitioner** (findability in binoculars, comfort, pacing,
     conditions), **Student-curious-adult** (first binoculars, wants wonder and clarity), **Student-teen** (short attention,
     wants "whoa"), optional **Student-skeptic** (asks "so what?").
   * Each call: persona prompt + rubric + conditions summary + the 6 journeys labelled A–F in **random order** →
     strict JSON `{ perJourney: {A: {coherence, wonder, teaching, observability, flow, overall(1–10), oneLineWhy}}, ranking: ["C","A",…] }`.
   * Each slate is judged **twice with reversed order** by the Astronomer, Educator and Observer; once by each student.
     Position-consistency (Kendall τ between the two orders) is logged; judge-slates with τ < 0.2 are discarded.
5. **Aggregation** (`script/journeys/aggregate-labels.ts`):
   * z-score each judge's `overall` within that judge's history (removes leniency), average over runs;
   * persona weights: Educator 0.3, Astronomer 0.25, Observer 0.25, students 0.2 total (tunable; the PO decides);
   * graded label 0–4 by within-slate rank of the weighted z (top = 4, then 3, 2, 2, 1, 0) **blended** with an absolute
     anchor (if all six are judged poor, cap labels at 2) so groups are comparable;
   * drop slates with inter-persona Kendall's W < 0.3 (too ambiguous to learn from); log the rate.
   * Also emit all pairwise preferences with their consensus margin for evaluation.
6. **Human calibration**: the product owner ranks 40 slates blind; report judge-panel vs PO agreement. If < 65 % pairwise,
   revise persona prompts/weights before scaling up.

Volumes and cost: **v0** 300 slates (1,800 journeys; 3 personas × 2 orders + 2 students = 2,400 judge calls) to validate the
pipeline and features; **v1** 1,500 slates (9,000 journeys; ~12k calls). Split **grouped by site × month**: 70 % train, 15 %
validation, 15 % test; plus a **geographic hold-out** (all slates from 3 sites, incl. one southern) to test generalisation.

### 7.4 Training code

`script/journeys/train_ranker.py` (≈ 150 lines), run as:

```sh
uv run --no-project --with lightgbm==4.7.0 --with numpy==2.* \
  python script/journeys/train_ranker.py \
  --data data-dev/journeys-training/labeled.jsonl --out client/src/lib/journeys/scorer-model.json
```

Steps: load JSONL (`group, features[36], label, pairs`), grouped split, train `lgb.LGBMRanker` with §7.1 params and
monotone constraints, early-stop on val NDCG@3; train BT-logistic baseline (numpy gradient descent on pair differences,
L2 = 1.0); evaluate both (§7.6); export the winner via `booster.dump_model()` → **convert** to the compact schema below;
write `golden-vectors.json` (60 feature vectors with Python-predicted scores, ±1e-9) for the TS parity test.

### 7.5 Export format and inference

```jsonc
// scorer-model.json  (GBDT variant)
{
  "type": "gbdt", "modelVersion": "jr-2026.11-v1", "features": ["n_stops", "...", "sky_brightness"],
  "base": 0.0,
  "trees": [ // one object per tree; parallel arrays; leaves encoded as negative child indices (~leafIndex)
    { "f": [11, 3, 24], "t": [0.62, 1.9, 0.31], "l": [1, -1, -3], "r": [2, -2, -4], "v": [-0.12, 0.05, 0.08, 0.21] }
  ],
  "trainedOn": { "slates": 1500, "date": "2026-11-xx", "kbVersion": "…", "featuresHash": "…" },
  "metrics": { "testPairAcc": 0.0, "testNdcg3": 0.0, "judgeCeiling": 0.0 }
}
// linear variant: { "type": "linear", "features": [...], "mean": [...], "std": [...], "w": [...], "b": 0 }
```

LightGBM's `dump_model` tree JSON uses `split_feature`, `threshold`, `decision_type` (`<=`), `default_left`,
`left_child/right_child`, `leaf_value`; the converter flattens that recursion into the arrays above, asserts
`decision_type == "<="` and no categorical splits, and maps NaN handling to "missing goes left" (we never emit NaN anyway).

```ts
// client/src/lib/journeys/scorer.ts (inference core, ~40 lines)
export function scoreGbdt(m: GbdtModel, x: Float64Array): number {
  let s = m.base;
  for (const tr of m.trees) {
    let node = 0;
    for (;;) {
      const next = x[tr.f[node]] <= tr.t[node] ? tr.l[node] : tr.r[node];
      if (next < 0) { s += tr.v[~next]; break; }
      node = next;
    }
  }
  return s;
}
```

Size: ≤ 150 trees × 7 internal nodes ≈ 1,050 nodes ≈ 25 KB JSON (≈ 6 KB gzip). Cost per journey ≈ 450 comparisons;
2,000 candidates ≈ 1 ms. Load-time validation: feature names/hash equal `FEATURE_NAMES`, array lengths consistent, all
child indices in range; on failure fall back to the linear model, and if that fails to the heuristic `h` (and set
`diagnostics.scorer = 'heuristic'`).

### 7.6 Evaluation (gates for shipping a model)

On the **test split** and the **geographic hold-out**:

| Metric | Definition |
|--------|-----------|
| Pairwise accuracy | over consensus pairs with margin ≥ 0.5 z, fraction ordered like the panel |
| NDCG@1, NDCG@3 | per slate with graded labels |
| Judge ceiling | leave-one-persona-out: how often one persona agrees with the rest (the realistic upper bound) |
| Top-1 win rate | fresh judge panel (different prompt wording, unseen slates) compares model's top-1 vs heuristic's top-1, A/B order randomised; report win rate with 95 % Wilson CI |

Comparisons: random, **hand-tuned heuristic h** (§5.5), BT-linear, GBDT. **Ablations**: drop each feature group (geometry,
quality, story, content) and retrain; drop monotone constraints; train on 25/50/100 % of slates (learning curve tells
whether to buy more labels).

**Ship gate:** GBDT pairwise accuracy ≥ heuristic + 5 pts **and** ≥ 85 % of judge ceiling **and** top-1 win rate CI lower
bound > 50 %. Otherwise ship BT-linear if it passes the same gate vs heuristic; otherwise ship the heuristic and keep
collecting labels. Report everything in the model JSON `metrics` and in `docs/sky-journeys/model-card.md` (written at
training time).

### 7.7 Iterative improvement

* **Active learning (v2+)**: generate new slates where (a) the model's top-2 scores are within 0.05, or (b) model and
  heuristic disagree on top-1, or (c) conditions are under-represented (southern sites, bright Moon, high-latitude summer).
  Judge only those; retrain. Typically 300–500 slates per round.
* **Retrain triggers**: KB grows > 20 % or new archetypes/edge types; any feature change (bump `modelVersion`; recompute
  features from stored journey JSON — no re-judging needed unless the narration changed materially).
* **Failure mining**: a nightly-style script (`script/journeys/audit.ts`) runs the engine over 500 conditions and flags
  outliers (very low top score, repeated objects across top-3, frequent relaxations) for judge review.
* **Implicit signals (later, opt-in, on-device only)**: record "started / completed / shuffled away / skipped stop" in local
  storage, include it in the existing backup export; never uploaded automatically (offline-first, private). If users
  share backups, these become additional preference pairs.
* **Distilled beam heuristic (v3)**: train a tiny per-transition linear model on the same labels (credit assignment from
  journey labels via the BT strengths) to replace hand weights in `heuristicStep`, improving what the beam proposes, not
  only what is ranked.
* **Golden snapshot test**: 25 pinned requests; their top-1 journey ids are snapshotted per `modelVersion`. A model update
  that changes them must update the snapshot in the same commit (intentional, reviewable diff).

---

## 8. Narration (no LLM)

`narrate.ts` turns structured `Journey` + KB facts into text with `transitions.json`:

```jsonc
{
  "CONTRAST.teffK": [
    "{prev} burns at about {prevVal}; {next} at about {nextVal} — {ratioPhrase}. That temperature gap is the colour difference you can see.",
    "Compare colours: {prev} ({prevVal}) and {next} ({nextVal}). Hotter stars shine bluer; cooler ones redder."
  ],
  "LIFE_NEXT.4-6": ["{prev} is a star near the end of its life. {next} shows what such a star leaves behind: {nextHook}."],
  "CAUSE": ["The light of {prev}'s hot stars is what makes {next} glow."],
  "direction": [
    "Move about {deg}° ({fields} binocular fields) {screenDir}{compassHint}.",
    "From {prev}, sweep {screenDir} roughly {fields} fields{compassHint}."
  ]
}
```

Rules:

* **Selection:** prefer `curatedReasonKey`; else `TYPE.property` or `TYPE.stageFrom-stageTo`; else `TYPE`. Variant chosen by
  `rng(seed, journey.id, stopIndex)` **without reuse inside a journey**. ≥ 4 variants per frequent key (educator doc
  supplies wording; this doc only fixes the slot vocabulary).
* **Numbers:** `ratioPhrase` = "about 3 times hotter" (round to 1 significant figure < 10, otherwise "about 20 times");
  ranges with `lo/hi` render as "roughly 550–700 light-years"; uncertain facts get "about". Units from `FactValue.unit`.
  Every rendered number carries its `sourceId` so the card can cite it.
* **Directions:** `screenDir` from `HopInfo.screenBearing` relative to the horizon at tᵢ (8 sectors: "up", "up and to
  the left", …, computed from Δalt/Δaz at tᵢ, so it's what the observer actually does with the binoculars);
  `compassHint` from `skyBearing` (", toward the east of the constellation"). Fields = distance / instrument FOV.
* **Why picked:** from `ReasonCode[]`: slot role ("the stellar nursery of this story"), superlatives ("the largest star you
  will see tonight"), conditions ("highest it will be tonight", "see it first — it sets soon").
* **Titles:** archetype `titleKeys` with the patch label: "Birth to death above Orion · high in the south".
* **Validators (tests):** no unfilled `{…}`, no `undefined`/`NaN`, sentence ≤ 220 chars, every number has a source.

---

## 9. Determinism, variety and caching

* `seedKey = fnv1a53([ENGINE_VERSION, modelVersion, kbVersion, localNightDate(tz), lat.toFixed(1), lon.toFixed(1),
  floor(startLocalMinutes/15), duration, minutesPerStop, stops, instrument.fov.toFixed(1), instrument.aperture,
  sky.toFixed(1), minAlt, capRadius, theme, level].join('|'))`.
* Live sky updates every 30 s (README); journeys **must not** re-roll then: the 15-minute start slot keeps them stable;
  the UI pins the chosen journey and only refreshes alt/az on the card.
* `rng.ts`: `fnv1a53(str)`, `mulberry32(seed)`, `rngFor(seedKey, ...parts)`. Used only for: Gumbel noise (shuffle), template
  variant choice, and tie-breaks that are not resolved by id. All sorts use comparator `(b.s − a.s) || a.id.localeCompare(b.id)`
  on quantised scores.
* Memoise `JourneyResult` in the worker by `seedKey + shuffleIndex` (LRU 8). The night context (S0–S2) is memoised by
  `seedKey` minus `shuffleIndex/theme/level`, so shuffling and theme changes only redo S3–S8 (< 150 ms).

---

## 10. Module / file layout

```
client/src/lib/journeys/
  types.ts            interfaces in §4/§6, EdgeType, FEATURE_NAMES (frozen)
  rng.ts              fnv1a53, mulberry32, gumbel                                    (~40 LOC)
  kb.ts               load/validate objects/edges/archetypes/transitions (zod), indices, kbVersion  (~150)
  story-graph.ts      derived edges + curated merge, bestEdge(a,b,allowed)           (~180)
  conditions.ts       S0/S1: time grid, fast alt/az, moon, glow, rating → candidate table (~200)
  constraints.ts      stopViolations, journeyViolations (single source of truth)    (~150)
  geometry.ts         gnomonic projection, turn angles, principal-axis reversals, caps, Fibonacci grid (~120)
  regions.ts          S2 patch generation/scoring/NMS                                (~100)
  archetypes.ts       slot matching, pre-check                                       (~100)
  search.ts           S4 beam search + heuristicStep                                 (~250)
  reorder.ts          S5 Held–Karp with precedence + Or-opt                          (~120)
  features.ts         36 features, shared by runtime and training                    (~200)
  scorer.ts           model load/validate, scoreGbdt, scoreLinear, heuristic fallback (~90)
  diversify.ts        MMR, Gumbel-top-k shuffle                                      (~70)
  narrate.ts          templates, numbers, directions                                 (~220)
  engine.ts           assembleJourneys: orchestrates S0–S8, relaxations, diagnostics (~150)
  journey-worker.ts   worker entry (pattern of route-worker.ts)
  journey-client.ts   assembleJourneysInWorker (supersede/terminate, pattern of route-client.ts)
  scorer-model.json   shipped model (bundled)
client/public/data/journeys/
  objects.json  edges.json  archetypes.json  transitions.json     (KB team; precached automatically)
client/src/lib/__tests__/journeys/
  constraints.property.test.ts  geometry.test.ts  story-graph.test.ts  search.test.ts  reorder.test.ts
  features.test.ts  scorer-parity.test.ts  narrate.test.ts  determinism.test.ts  engine.perf.test.ts
  fixtures/golden-vectors.json  fixtures/golden-requests.json
script/journeys/
  sample-conditions.ts  generate-slates.ts  render-for-judges.ts  judge-prompts/*.md
  aggregate-labels.ts   train_ranker.py  export_model.py  eval.ts  audit.ts
data-dev/journeys-training/          (git-ignored raw slates/judgements; keep labeled.jsonl + model-card)
```

The **only** coupling with UI code: `journey-client.ts` + `NarratedJourney`. Cards can link stops to existing views via
`objectId` (`#/hop/<id>`, binocular detail, add to session).

---

## 11. Worked example (illustrates the story-vs-geometry trade-off)

Winter evening, mid-northern site, Orion high in the south. Archetype `life-of-stars`, `order: partial`, progression
`arc`. Candidate set: Rigel, M42, Betelgeuse, M1, Aldebaran (+ Hyades), M45.

Naive "textbook" order (nursery → young cluster → giant → supergiant → remnant): M42 → M45 → Aldebaran → Betelgeuse → M1
gives hops 39.6°, 13.8°, 21.4°, 15.4° = **90.1°** and a 39.6° first hop — **rejected** by max-hop (20°) and the reversal
rule. Held–Karp with the arc progression finds Rigel → M42 → Betelgeuse → M1 → Aldebaran → M45 with hops 5.9°, 13.7°,
15.4°, 14.9°, 13.8° = **63.6°**, one gentle sweep up and to the west (distances computed from catalog J2000 positions).
Narrative: young blue supergiant (Rigel) → the nursery that makes such stars (M42, ~1,350 ly per `OBJECT_GUIDES`) → a
massive star near its end (Betelgeuse, red supergiant ~750 R☉ at ~550 ly, [Joyce et al. 2020](https://uhra.herts.ac.uk/id/eprint/8636/))
→ what such a star leaves (M1, remnant of the supernova recorded in 1054, with a pulsar —
[ESA/Hubble](https://esahubble.org/images/opo0015a)) — flagged **challenge** (curated level `challenge` in
`binocular-guide-extra.json`), so it cannot be stop 1–2 → a gentler giant's fate (Aldebaran, K giant) → and back to the
beginning: a young family (M45, ~100 Myr, [CfA](https://www.cfa.harvard.edu/news/how-far-are-pleiades-really)).
The facts above are illustrative; card text must use the KB's sourced values.

---

## 12. Test strategy (vitest; `npx vitest`)

1. **Constraint property tests** (`constraints.property.test.ts`) — the core guarantee. Grid: 10 sites (incl. −34°, 0°,
   +65°), 24 dates (incl. full Moon, new Moon, midsummer at +60° where astronomical night may not exist), 3 start times,
   4 instruments, 3 sky values = 8,640 requests (run a seeded random 400 by default; full grid behind `JOURNEYS_FULL=1`).
   For every returned stop **recompute independently with `eqToHorizontal`/`moonState`/`scatteredMoonlight`/
   `binocularAssessment`** (not the fast path) at tᵢ and tᵢ+m: alt ≥ minAlt − 0.05°, Sun rule, Moon separation, glow
   limits, rating ≤ 2 and ≤ 1 challenge (not at index 0/1), within cap, max hop, path ≤ 2.5R, reversals ≤ 1,
   sharp turns ≤ 1, no duplicates, each consecutive pair has an allowed edge. Also `diagnostics.droppedByValidator == 0`
   (pruning must be at least as strict as validation).
2. **Empty-sky behaviour**: daytime request, polar summer, full Moon next to the only high region → `journeys = []`,
   `blockers` populated, no throw; relaxations never touch Moon/twilight/rating-3 rules.
3. **Geometry unit tests**: turn angle on known triangles, reversal count on synthetic zig-zags vs. sweeps, cap membership
   across RA = 0/360 wrap and near the poles, gnomonic projection symmetry.
4. **Story graph**: derived edges on fixtures (Betelgeuse/Rigel `CONTRAST.teffK` strength > 0.5; M42→Trapezium `CAUSE`
   curated wins over derived); no self-edges; directed edges respected.
5. **Re-ordering**: Held–Karp equals brute-force permutation on random n ≤ 7 sets with precedence; respects time windows.
6. **Determinism**: same request twice → deep-equal result; request at 21:02 vs 21:13 (same 15-min slot) → same journeys;
   `shuffleIndex` 1..5 give distinct journey ids, each with Jaccard < 0.5 to earlier ones; result independent of KB
   array order (shuffle input arrays in the test).
7. **Scorer parity**: TS `scoreGbdt/scoreLinear` vs `golden-vectors.json` (|Δ| < 1e-9); malformed model → fallback path.
8. **Monotonic sanity**: for the shipped model, increasing `max_glow` or `reversals` with all else fixed never increases
   the score (holds by construction; the test catches export bugs).
9. **Features**: hand-computed expected vectors for 3 fixture journeys; all features finite; names match model.
10. **Narration**: for 200 generated journeys: no unfilled slots/`NaN`/`undefined`, every number has a `sourceId`,
    variant not repeated within a journey, double-star "split" wording only if split rating ≤ 1.
11. **Performance** (`engine.perf.test.ts`, loose): full assembly < 1,500 ms in Node on CI for 20 requests (median);
    log timings per stage. Phone budget verified manually in the production build.
12. **Integration with existing data**: every `objectId` resolves in `buildUnifiedTargets(messier, binocular)` or in the
    bundled BSC (star ids `star:HR…`), and every `imageIds` path exists under `client/public/data/` (offline guarantee).

---

## 13. Risks and open questions

1. **KB coverage drives everything.** Life-cycle stories need enough PN/SNR/supergiant/nursery objects that are binocular
   feasible; the repo has only 7 PN, 2 SNR, 5 EN in the binocular catalog, and `binocularAssessment` forces rating 3 for
   any planetary nebula smaller than 3′, so most PNs are excluded.
   Expect "corpse" slots to be filled mostly by M1 (challenge), M27, the Veil (dark skies), or *stand-ins* (a red giant
   "that will become a planetary nebula"). The KB team must add `stage`/facts for bright stars from BSC (cheap, high value).
2. **Judge validity.** LLM judges may reward verbose narration and well-known objects; mitigate with persona diversity,
   z-scoring, order reversal, PO calibration (§7.3.6), and by keeping the narration identical in style across slate members.
3. **Small label sets.** 1,500 slates × 6 is modest; hence shallow trees, monotone constraints, and a linear fallback with
   an explicit ship gate.
4. **Southern-hemisphere and high-latitude coverage** of the KB and the archetypes (Magellanic Clouds, ω Cen, 47 Tuc,
   η Car nebula) — must be in the KB or southern users get thin journeys; the geographic hold-out will show it.
5. **Constraint defaults** (30° altitude, 30° cap, 20° hop, 8 min/stop) are informed guesses; the observer-practitioner
   judge and the PO should confirm. They are request parameters, so tuning is cheap.
6. **Planets and the Moon** are excluded in v1 (KB is fixed objects). Hook: a `transient` object provider can feed
   S1 later (planets via `getPlanetPositions`).
7. **Light-pollution realism.** `binocularAssessment` is a model, not a guarantee (README wording); cards must keep the
   app's "guidance, not a guarantee" tone.
8. **`binocularAssessment` cost** in S1 (regex + baseline recursion) — profile first; if hot, precompute the static
   (sky-independent) parts per object at KB load.
