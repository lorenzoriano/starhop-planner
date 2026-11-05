# Sky Journeys: training the journey scorer

This folder holds the offline loop that teaches the app which valid journeys people prefer. The runtime engine
never calls a language model. LLM judge panels label journeys offline, a small ranker learns from the labels,
and the ranker ships as `client/public/data/journeys/model.json`. The binding decisions are spec decision 7 and
doc 05 §7.

Hard constraints stay in code. The engine's validator rejects anything that is invisible, too low, moonlit,
too faint or too spread out, before scoring. The model only ranks journeys that already passed (doc 05 D2).
It can never make an unsafe or invisible stop win.

## Files

| file | role |
|---|---|
| `client/src/lib/journeys/features.ts` | The 36 journey features (doc 05 §7.2) and doc 04's F1–F20 criteria. **The same code runs at training time and at runtime.** |
| `client/src/lib/journeys/heuristic-weights.ts` | Tier 1: the hand-tuned weights and doc 04 §4.4's Q. |
| `client/src/lib/journeys/score.ts` | Inference for the three tiers (heuristic, linear, GBDT), model validation and fallback, and the engine plug-in `createModelScorer`. |
| `client/src/lib/journeys/narrate.ts` | Seeded narration. Judges read the same text users will see. |
| `export-candidates.ts` + `run-export.cts` | Samples conditions, runs the real engine, writes candidate rows and judge slates. |
| `feature-meta.json` | Generated from `features.ts`: names, clip ranges, monotone constraints, groups, hash and heuristic weights. `train.py` reads only this file, and a vitest checks it is in sync. |
| `export-ab-pairs.ts` + `export-ab-pairs.cts` + `ab-round.ts` | Owner A/B rounds: two complete journeys for one night, answered Left / Right / Equal / Neither with a note. Round 1 (`ab-round1.json`, 12 pairs, chosen from the default request's pool) and its answers (`ab-round1-answers.json`) led to owner feedback r2. Round 2 (`ab-round2.json`, 4 hand-picked pairs via `--themes`) adds each stop's theme lens and the card exactly as the app resolves it (`resolved`). Each file has a hidden block (what the pair asks, scores, ranks), a sky block for an interactive map and the glossary entries it uses. `client/src/lib/journeys/__tests__/ab-pairs.test.ts` checks every round file. |
| `train.py` | Label aggregation, training, evaluation, the ship gate and export. |
| `client/src/lib/journeys/__fixtures__/scorer-toy-*.json` | A tiny model with golden vectors from `train.py toy`. They pin the TS-vs-LightGBM parity test. |

## Commands

Run all commands from the repository root.

```sh
# 0. Regenerate the feature metadata whenever features.ts changes (a vitest fails until you do).
npx tsx script/journeys/train/run-export.cts --meta-only

# 1. Candidates and judge slates. Uses the built KB in client/public/data/journeys/ when kb.json exists;
#    `--kb fixture` or `--kb synthetic` work for smoke tests.
npx tsx script/journeys/train/run-export.cts --n 300 --seed 7 --out data-dev/journeys-training

# 2. Judge panels (see below) write data-dev/journeys-training/judgments.jsonl.

# 3. Aggregate the labels, then train, evaluate, apply the gate and export.
uv run --no-project --with lightgbm==4.7.0 --with numpy --with scikit-learn \
  python script/journeys/train/train.py aggregate \
  --candidates data-dev/journeys-training/candidates.jsonl \
  --judgments data-dev/journeys-training/judgments.jsonl \
  --out data-dev/journeys-training/labeled.jsonl
uv run --no-project --with lightgbm==4.7.0 --with numpy --with scikit-learn \
  python script/journeys/train/train.py train \
  --data data-dev/journeys-training/labeled.jsonl \
  --out client/public/data/journeys/model.json \
  --golden data-dev/journeys-training/golden-vectors.json \
  --card data-dev/journeys-training/model-card.md \
  --holdout-sites Sydney,Oslo,Nairobi --winrate data-dev/journeys-training/ab.jsonl --ablations

# Owner A/B pairs (deterministic; rerun after a KB rebuild so the pairs rebuild from their keys):
npx tsx script/journeys/train/export-ab-pairs.cts                         # round 1: writes ab-round1.json, previews pair 1
npx tsx script/journeys/train/export-ab-pairs.cts --round round2 --pairs 8   # an automatic round of 8 pairs
npx tsx script/journeys/train/export-ab-pairs.cts --show 3                # prints pair 3 without the hidden block
# A hand-picked round (owner feedback r2): one pair per theme pair; each side is the app's first journey with the
# theme picker set to that theme; "@site/month/phase[/optic[/time]]" pins the night, else the exporter searches
# SPECS, EXTRA_SPECS and the new-Moon nights (PICKED_NIGHTS) and prefers different sites and both hemispheres.
npx tsx script/journeys/train/export-ab-pairs.cts --round round2 --themes \
  "A3:A7@San Francisco/1/new/10x50/dusk+1.5h,A1:A9@Colorado dark site/10/new/10x50/dusk+1.5h,A2:A5@Sydney/11/new/10x50/dusk+1.5h,A6:A11@Colorado dark site/10/new/10x50/23:30"
npx tsx script/journeys/train/export-ab-pairs.cts --round round2 --show 2
AB_PAIRS_FILE=$PWD/script/journeys/train/ab-round2.json npx vitest run client/src/lib/journeys/__tests__/ab-pairs.test.ts

# Refresh the committed parity fixture (only when the export format changes):
uv run --no-project --with lightgbm==4.7.0 --with numpy \
  python script/journeys/train/train.py toy --out-dir client/src/lib/journeys/__fixtures__
```

`run-export.cts` is a CommonJS launcher. The package is `"type": "module"`, and in that mode tsx cannot see
astronomy-engine's CommonJS exports through `import * as`. Loading the engine as CommonJS fixes this, and it
matches how vitest resolves it. `train.py` only needs numpy and LightGBM's core API; scikit-learn is accepted
but not used. On this aarch64 host, `uv run --with lightgbm==4.7.0` was checked to resolve wheels (lightgbm 4.7.0,
numpy 2.5, scikit-learn 1.9.1).

## The judge-labeling loop

### 1. Conditions

`export-candidates.ts` samples a seeded Latin hypercube, so every value of every dimension appears evenly.
The dimensions are:

- **Sites:** 18 sites from −34° to +60° latitude, with real time zones.
- **Dates:** 24 per year, two in each month.
- **Start times:** dusk + 30 min, 22:30 and 01:30, local time.
- **Binoculars:** four models: 7×50, 10×50, 15×70 and KITE 14×50 IS.
- **Sky brightness:** 18.5, 20.0 and 21.3 mag/arcsec².
- **Observer level:** three levels.

The Moon phase follows from the date. The Moon illumination is stored with every row, so you can check
coverage of bright-Moon nights. If they are under-represented, add samples (doc 05 §7.7, active learning).

### 2. Slates of 6

For each condition, the engine runs in `explore` mode: the whole valid pool, with no MMR and no relaxations.
Journeys are grouped by sky patch, and each group yields one slate with these members:

- the **2 best** by heuristic;
- **2 from the middle**;
- **1 seeded-random** pick;
- **the weakest valid** journey.

Every member passed the validator. Judges compare taste among *valid* journeys, which is what the runtime
model will rank.

When a KB is thin, patches can hold too few journeys for a slate. Their leftovers are then pooled into one
`mixed` slate for that night. This is still fair, because the sky, site, binoculars and observer are the
same.

`candidates.jsonl` stores each member in full:

- the full journey JSON;
- the 36 features;
- the 30 doc 04 criteria;
- three baseline scores: the engine's beam objective `engineH`, the tier-1 `featureHeuristic`, and doc 04's
  `doc04Q`.

Keeping the full journey lets you recompute features after `features.ts` changes without judging again.

### 3. What judges see

`slates.jsonl` holds, for each journey, the text an observer would read:

- the title, driving question and hook;
- a conditions line;
- a stop table with object, role, altitude, hop in degrees and binocular fields, and challenge flag;
- for each stop: why it is here, the transition, the get-there direction, and one sourced number with its
  relatable comparison;
- the payoff line.

Judges never see scores, features or the archetype id. All slate members use the same narration style,
so judges cannot reward wordier text (doc 05 §13.2).

### 4. Personas and runs

| persona | judges | runs per slate |
|---|---|---|
| `astronomer` | physical correctness; coherence of the physics thread | 2 (A–F order, then reversed) |
| `educator` | arc, scaffolding, explanation quality (doc 04 rubric R1–R8) | 2 (reversed) |
| `observer` | findability in binoculars, comfort, pacing, conditions | 2 (reversed) |
| `student-curious-adult`, `student-teen`, `student-skeptic`, `student-parent-child` | doc 04 §7 personas: wonder, clarity, "so what?" | 1 |

Each call receives:

- the persona prompt and rubric;
- the conditions summary;
- the six journeys, labelled A–F in the order from `slates.jsonl` (`orders[0]`, then `orders[1]`, which is
  the reverse).

Each call must answer with strict JSON. Write one line per call to `judgments.jsonl`:

```json
{"slateId": "c0042-p0", "persona": "educator", "run": 0, "order": ["j-…", "j-…", "…"],
 "perJourney": {"A": {"coherence": 4, "wonder": 5, "teaching": 4, "observability": 3, "flow": 4, "overall": 8,
                      "oneLineWhy": "…"}, "…": {}},
 "ranking": ["C", "A", "F", "B", "E", "D"]}
```

`order` maps the letters back to journey keys, so the two runs can present different orders. Order is
reversed because LLM judges have a strong position bias, and most favour the first option. Swapping the order
and checking consistency is the standard way to detect and cancel it
([Zheng et al. 2023, "Judging LLM-as-a-Judge"](https://arxiv.org/abs/2306.05685)).

### 5. Normalisation and aggregation

`train.py aggregate` turns raw judgments into graded labels in seven steps:

1. **Per-judge z-scores.** Each persona's `overall` scores are converted to z-scores over that persona's whole
   history. This removes leniency: one judge's 7 can mean another's 5.
2. **Order consistency.** For personas with two runs, Kendall τ is computed between the two rankings. A slate
   judgment with τ < 0.2 is discarded, because that judge was mostly reacting to position. The discard count is
   logged.
3. **Persona weights:**
   - educator 0.30;
   - astronomer 0.25;
   - observer 0.25;
   - students 0.20 in total, split evenly.

   Weights are renormalised over the personas present. These are the doc 05 §7.3.5 defaults; the product
   owner may tune them.
4. **Agreement filter.** Kendall's W across personas is computed for each slate. Slates with W < 0.3 are too
   ambiguous to learn from, so they are dropped and the count is logged.
5. **Graded labels.** Each journey's label comes from its within-slate rank of the weighted z: 4, 3, 2, 2, 1, 0.
   For a slate that is not size 6, labels are spread evenly from 4 to 0.
6. **Absolute anchor.** If every journey in a slate averaged below 5/10, the labels are capped at 2, so that
   slates stay comparable.
7. **Pairs.** The consensus z and each persona's z are kept on every row. Evaluation uses pairs whose
   consensus margin is at least 0.5 z, and the leave-one-persona-out judge ceiling.

### 6. Human calibration

The product owner ranks 40 slates blind. If the panel and the product owner agree on fewer than 65 % of
pairs, revise the persona prompts or weights before scaling up (doc 05 §7.3.6).

Planned volumes:

- **v0:** 300 slates, to validate the pipeline.
- **v1:** about 1,500 slates.

## Training

`train.py train` works as follows:

- **Splits.** The data is split by site × month (hashed): 70 % train, 15 % validation, 15 % test. Hold-out
  sites go to a separate geographic hold-out.
- **GBDT.** LightGBM `lambdarank` ([parameter reference](https://lightgbm.readthedocs.io/en/stable/Parameters.html)):
  - `num_leaves=8`, `max_depth=3`, `learning_rate=0.05`;
  - at most **150 trees**, with early stopping on validation NDCG;
  - `lambdarank_truncation_level=6`, `label_gain=[0,1,3,7,15]`;
  - `deterministic=true`, single thread.

  LambdaMART is the boosted-tree learning-to-rank method of
  [Burges 2010](https://www.microsoft.com/en-us/research/publication/from-ranknet-to-lambdarank-to-lambdamart-an-overview/).
- **Monotone constraints.** `monotone_constraints_method="advanced"`, the least over-constraining option. The
  output can never improve as `max_glow`, `reversals`, `sharp_turns`, `max_hop_deg` or `path_over_cap` grow.
  It can never get worse as `min_alt`, `mean_alt`, `min_moon_sep`, `fact_coverage`, `image_coverage` or
  `edge_strength_mean` grow. Label noise cannot teach a perverse preference.
- **Linear.** A pairwise logistic, Bradley–Terry model on standardised feature differences, with L2 = 1 and
  Newton steps. Weights whose sign contradicts a monotone constraint are projected to 0.
- **Export check.** The GBDT is converted from `booster.dump_model()` to compact parallel arrays:
  - internal nodes are numbered in preorder, so children always come after their parent;
  - leaves are stored as `~leafIndex`;
  - only `<=` numerical splits are allowed, with no zero-as-missing.

  Before writing, the Python mirror of `score.ts` must match `booster.predict(raw_score=True)` within 1e-9.

### Evaluation and the ship gate (doc 05 §7.6)

The test split and the geographic hold-out are scored with:

- pairwise accuracy on consensus pairs;
- NDCG@1 and NDCG@3;
- the judge ceiling, meaning how often one persona agrees with the rest.

Each metric is computed for: random, the engine heuristic h, the feature heuristic, doc 04 Q, linear and
GBDT. `--ablations` also retrains with each feature group dropped, without monotone constraints, and on
25 % and 50 % of the data.

The top-1 win rate comes from a **fresh** A/B panel, run with different prompt wording on unseen slates. It
compares the model's top-1 journey with the heuristic's top-1, in randomised A/B order. Pass it as
`--winrate ab.jsonl`, with one `{"winner": "model" | "heuristic" | "tie"}` per line. The report gives a 95 %
Wilson interval.

**Gate:** GBDT ships when all three conditions hold:

- its pairwise accuracy is ≥ heuristic + 5 points;
- its pairwise accuracy is ≥ 85 % of the judge ceiling;
- the lower bound of the win-rate CI is > 50 %.

Otherwise, the linear model ships if it passes the same gate. Otherwise, the heuristic ships and label
collection continues.

`--waive-winrate` exists for experiments only, and the result records that the check was waived. The
winner is written to `model.json`, along with:

- the metrics;
- golden vectors;
- a model card.

The app validates the model at load: feature names must equal `FEATURE_NAMES`, array shapes must be
consistent, and child indices must be in range. A model that fails validation falls back to the heuristic.

## Iterating

- **When `features.ts` changes:**
  1. Bump the model version.
  2. Regenerate `feature-meta.json`.
  3. Recompute features from the stored journey JSON.
  4. Retrain.

  You only need to judge again if the narration changed materially.
- **Active learning:** judge new slates in three cases:
  - the model's top-2 scores are within 0.05;
  - the model and the heuristic disagree on top-1;
  - the conditions are under-represented, such as southern sites, bright Moon or high-latitude summer.
- **Retrain triggers:** the KB grows by more than 20 %, or new archetypes or edge types are added.

## Owner A/B rounds

| round | file | pairs | how chosen | what it asked |
|---|---|---|---|---|
| 1 | `ab-round1.json`, answers `ab-round1-answers.json` | 12 | automatic: one night per pair, both sides from the top of the default request's pool, 12 different theme pairs | which themes and stories work; the answers (owner feedback r2) retired A4 and A10 and introduced theme lenses |
| 2 (re-exported, round 3) | `ab-round2.json` | 4 | hand-picked (`--themes`), nights pinned to each side's strongest story on a new Moon with 10×50 | ab2-01 San Francisco, 7 Jan 2027: A3 ladder Capella → Alpha Persei Cluster → Stock 2 → Owl Cluster → Andromeda (all five rungs) vs A7 records Hyades → W Orionis → Rigel → θ¹ Orionis C → Betelgeuse. ab2-02 Colorado dark site, 28 Oct 2027 dusk: A1 IC 1396 → M39 → Deneb → P Cygni → Dumbbell (nursery to a cast-off shell) vs A9 ζ Lyrae → 31 Cygni → 16 Cygni → Double-Double. ab2-03 Sydney, 28 Nov 2027: A2 Tiaki → α Tucanae → β Hydri → α Hydri → Achernar (red to blue-white) vs A5 σ Orionis → NGC 1981 → Klingon Battlecruiser Cluster → Hyades → Orion's Belt. ab2-04 Colorado dark site, 28 Oct 2027 23:30: A11 Alpha Persei Cluster → Stock 2 → Owl Cluster → Andromeda (home to beyond the galaxy) vs A6 Alfirk → δ Cephei → ρ Cassiopeiae → Double Cluster → Andromeda. Every stop carries its lens (with `rank` and `story`) and the resolved card, including `resolved.story`. |

Each pair's `hidden.question` says what the pair asks. A hand-picked pair has `hidden.hypothesis = "picked"` and
both sides `source = "theme"` (the app's first journey for that theme, `appRank` 0 within the theme-forced request).
Keep rounds short (the owner asked for far fewer than 12 pairs) and aim each pair at something still open.

**Export a hand-picked round last.** The app's first journey for a theme rotates with a seed that includes the KB
version (`assemble.ts` `rotationSeedOf`), so any KB rebuild, even a one-word card edit, can change which journey a
pinned night yields, or make a night fail (a side that ends on a challenge stop is vetoed). After the final KB build,
re-check the pinned nights (both sides must keep a whole story) and re-export. The A/B test rebuilds every
journey from its key only while the file's `kbVersion` matches the built KB (it skips that check otherwise), so
re-export a round before sending it if the KB has changed since.

