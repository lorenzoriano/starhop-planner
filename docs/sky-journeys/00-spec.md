# Sky Journeys — integrated spec (orchestrator decisions)

This is the binding spec. Docs 01–06 are the detailed background; where they disagree, **this file wins**.

- 01 codebase map · 02 star KB · 03 deep-sky KB · 04 pedagogy & criteria · 05 engine · 06 UX

## Product in one paragraph

Sky Journeys is a new top-level section (`#/journeys`). For the observer's date, time, site, binoculars and Moon, it assembles
3–10-stop thematic binocular tours inside one compact region of the sky. Each tour answers one driving question, for example
"How does a star live and die?". Each stop has a layered card with these parts: why here, why from the last stop,
what you'll see in binoculars, understand, wonder, connect, and numbers with relatable scale. It also has a real photo or an
in-app visual. In field mode the app guides the observer stop by stop. It is offline, deterministic, has no runtime LLM, and ranks
candidate journeys with a learned scorer trained offline from expert and student judge panels.

## Resolved decisions

1. **Content is researched, not invented.** Facts and story ideas come from published sources: NASA, ESA/Hubble, ESO, NOIRLab,
   Chandra, APOD, Sky & Telescope, EarthSky, Astronomy Magazine, BAA, Cloudy Nights, published binocular guides (Harrington,
   Consolmagno, Mobberley), Wikipedia (used only to *find* primary refs) and SIMBAD/VizieR/NED/papers.
   Card prose is original (no copying), and every number carries a `sourceId`.
2. **Life-stage scale:** store doc 04's `evoStage` 0–8 and derive doc 05's 0–6 `LifeStage` in code. Don't author both.
3. **Link (edge) types:** doc 05's 9 types (LIFE_NEXT, CAUSE, SIBLING, CONTRAST, SAME_FAMILY, SCALE, TIME_MACHINE,
   SAME_PHYSICS, NEIGHBOR) plus **LINE_OF_SIGHT**. Each edge has a `subtype`, a `strength` from 0.2 to 1 and a `reasonKey`.
   NEIGHBOR alone never justifies a step.
4. **Hard constraints** are plain code and checked by one validator. Defaults:
   - **Altitude:** ≥30° for the whole stop window; the user can lower it to 20°.
   - **Darkness:** deep-sky objects need astronomical night; stars allow nautical twilight.
   - **Moon:** a minimum Moon distance that scales with phase, plus a per-category Krisciunas–Schaefer moonlight limit.
   - **Binoculars:** `binocularAssessment` rating must be OK, with at most one stop marked "challenge".
   - **Region:** a sky patch of 30° radius by default (20–40°), hops ≤20°, total path ≤2.5× the radius, at most one turn
     over 135°. **One story-motivated back-track is allowed only when that link's strength is ≥0.85.**
5. **Defaults:** 5 stops (3–10 allowed), about 8 minutes per stop, and 3 suggestions plus "show more" and Shuffle.
   The seed is built from the night, the 15-minute slot, the site rounded to 0.1°, the binoculars and the theme, so live mode
   doesn't reshuffle.
6. **Archetypes:** doc 04's 12 archetypes, stored as data (slot grammars) in `templates.json`. One change of archetype per
   journey is allowed, so a theme can drift.
7. **Learned scorer:** three tiers, and the ship gate in doc 05 §7.6 decides which one ships:
   1. hand-tuned heuristic as the baseline;
   2. a linear pairwise ranker;
   3. a LightGBM lambdarank model of ≤150 trees × 8 leaves, exported to JSON.

   Training runs via `uv run --with lightgbm`. The same TypeScript `features.ts` is used for training and at runtime.
   Labels come from LLM judge panels (astronomer, educator, observer, 4 student personas) ranking slates of valid
   journeys.
8. **Knowledge-base files.** These are fetched lazily, never bundled, and cached offline automatically:
   - `client/public/data/journeys/`: `kb.json` (stars + deep-sky + context nodes), `concepts.json`, `edges.json`,
     `templates.json`, `narration.json` (transition/comparison text variants) and `model.json`.
   - The build pipeline lives in `script/journeys/` (stdlib Python plus TS). Raw query caches go in `script/journeys/cache/`
     and are committed, so the build reruns offline.
   - Curated sources go in `script/journeys/curated/<batch>.json`, one file per sky-region batch.
     Curated values override automatic catalog values field by field.
9. **IDs:** use the existing target ids where they exist (`STAR-*`, `DS-*`, `AST-*`, `M42`, `NGC869`). New stars use
   `HR####`; non-BSC stars use `HD######` or `NAME-*`. Each record keeps an explicit `hr` field for routing/sessions
   (doc 01 §ids).
10. **Data hosts:** the CDS Strasbourg hosts time out from this machine. Use the Harvard SIMBAD mirror, the IDIA VizieR mirror,
    the Gaia archive, the NASA Exoplanet Archive and NED. New survey cutouts should come from **NASA SkyView**
    (skyview.gsfc.nasa.gov, DSS2) if it is reachable; otherwise use in-app visuals.
11. **Star visuals** are generated in the app:
    - a temperature swatch;
    - an HR mini-diagram over the BSC background, showing the journey's stars so far;
    - a size comparison on one shared scale;
    - a schematic light curve.

    Plus a small set of licensed ESO/ESA/NASA images, with credits.
12. **UI:** a new "Journeys" tab in nav slot 2, lazy-loaded (`components/journeys/*`). Hash routes are `#/journeys`,
    `#/journeys/:key`, `#/journeys/:key/stop/:n` and `#/journeys/:key/done`.
    - **Field mode:** full screen, with Get there → Look & learn steps.
    - **Getting there:** the movement guidance depends on distance (same field / sweep N fields / naked-eye then hop).
      A real star hop is only computed on request.
    - **Red light:** nothing is shown by colour alone.
    - **Storage:** `starhop-journey-v1` holds progress and `starhop-journey-feedback-v1` holds seen/skip/ratings,
      both on the device.
13. **Engine runtime:** pure modules in `client/src/lib/journeys/*`, run in a dedicated `journey.worker.ts`,
    **not** `route-client.ts`. Targets: ≤300 ms on desktop.

## Build phases

- **P2 Foundations**
  1. Contracts first: types, zod schemas, the master object list and a fixture KB.
  2. Then, in parallel:
     - automatic star data and automatic deep-sky data;
     - 6 curator agents, one per sky region, doing heavy web research for facts, pedagogy fields, card text and edges;
     - concepts, templates and narration;
     - the engine;
     - UI shell, cards and visuals.
- **P3 Integration:** build and validate the KB, wire the engine to the real KB and the UI to the engine, and pass the tests.
- **P4 Evaluation loops**, which repeat:
  - simulated students drive the real app with Playwright;
  - an astronomer fact-check pass and an educator review;
  - the UX designer reviews;
  - fixes; repeat until the acceptance checklist in doc 06 passes.
- **P5 Learned scorer:** generate candidate slates, run the judge panels, train, apply the ship gate and bake `model.json`.

Out of scope for v1: planets, Moon stops, runtime LLM, cloud sync, southern-only story pack depth beyond the curated batch.
