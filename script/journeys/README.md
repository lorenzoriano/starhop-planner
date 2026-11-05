# Sky Journeys knowledge-base pipeline

Binding spec: `docs/sky-journeys/00-spec.md`. Types: `client/src/lib/journeys/types.ts`.
Validation: `client/src/lib/journeys/kb-schema.ts` (`parseKnowledgeBase`, `knowledgeBaseFromFiles`).
A worked, schema-valid example of every record type is `client/src/lib/journeys/__fixtures__/fixture-kb.ts`.

## Layout

```
script/journeys/
  README.md                     this file
  make_object_list.py           builds object-list.json (stdlib; `python3 -I script/journeys/make_object_list.py`)
  object-list.json              MASTER LIST of v1 objects (ids, coordinates, batch). Nothing outside it ships.
  cache/                        raw query caches, committed so builds rerun offline
    object-list-simbad.json     SIMBAD (Harvard mirror) resolution of the hand-picked stars and new DSOs
    ...                         auto-tier caches (HR24, Hipparcos, GCVS, WDS, Baumgardt, OpenNGC, NED …)
  generated/                    AUTO tier, written by scripts only, never edited by hand
    stars.auto.json
    dso.auto.json
    media.auto.json             survey cutouts per object (fetch_media.py)
    media.licensed.json         localised licensed photographs (fetch_licensed_media.py); `largePath` is the
                                tap-to-enlarge copy, shipped as `KbImage.large`
    media.fill.json             a picture for every object that gets none from the files above
                                (fetch_media_fill.py: DSS2-colour HiPS field of the binocular view, plus a few
                                licensed showpiece photos). The build uses it only when an object has no other image.
  curated/                      CURATED tier, written by curators (one file per sky batch and kind)
    winter-stars.json   winter-dso.json
    spring-stars.json   spring-dso.json
    summer-north-stars.json  summer-north-dso.json
    summer-south-stars.json  summer-south-dso.json
    autumn-stars.json   autumn-dso.json
    southern-stars.json southern-dso.json
    concepts.json  templates.json  narration.json      (non-batch curated sources, see below)
```

Media scripts need Python packages: `uv run --with pillow --with numpy --with astropy --with astropy-healpix python -I
script/journeys/fetch_media_fill.py` (HiPS tiles are cached in the system temp dir; `--tile-cache=DIR` overrides).
Rerun it with `--manifest-only` when a curator removes a curated image, so the fill covers that object again.
The glossary (`client/public/data/journeys/glossary.json`, `{version, notes, terms[]}`) is hand-written and not built.

Cards open with `card.question` (≤ 15 words, ends in "?") and close with `card.answer` (≤ 40 words). The build orders
card keys as question, glance, whyHere, see, understand, wonder, connect, answer, then the rest.

Final outputs (lazy-fetched by the worker, never bundled, cached offline):

```
client/public/data/journeys/
  kb.json          KbJsonFile        { version, objects: KbObject[], contexts: ContextNode[], sources: Source[] }
  concepts.json    ConceptsJsonFile  { version, concepts: Concept[] }
  edges.json       EdgesJsonFile     { version, edges: Edge[] }          (curated edges only; derived edges are computed at load)
  templates.json   TemplatesJsonFile { version, templates: Template[] }
  narration.json   NarrationBank     { version, variants: { key: string[] } }
  model.json       ScorerModel       heuristic | linear | gbdt (doc 05 §7.5)
```

The merged result must pass `knowledgeBaseFromFiles(...)`: zod shape plus referential checks (every `sourceId`
exists, every `teaches.conceptId` exists, edge endpoints exist, every `reasonKey`/`titleKey` exists in narration,
card `numbers[].factRef` points at an existing fact, `min ≤ value ≤ max`).

## The master list (`object-list.json`)

`{ version, generatedBy, counts, objects: ObjectListEntry[] }`, where an entry is:

| field | meaning |
|---|---|
| `id` | the KB id (spec decision 9): existing unified-target id (`STAR-*`, `DS-*`, `AST-*`, `M42`, `NGC869`, …), else `HR<n>` for BSC stars (unpadded, = routing SkyNode id), `HD<n>` for non-BSC stars, `NAME-<Name>` when there is no HD number, `DN-*`/`MWF-*`/`Cr69`/`IC1396`… for new DSOs |
| `kind` | `star` or `dso` |
| `hr` | BSC number of the (primary) star, when there is one |
| `name`, `con` | display name and IAU constellation |
| `ra`, `dec` | J2000 degrees (BSC position for BSC stars, catalog position for existing targets, SIMBAD otherwise) |
| `mag` | reference V, or `null` (dark nebulae, MW fields, a few variables SIMBAD lists without V; the auto tier fills those) |
| `existing` | `true` if the id is already a unified catalog target (has bundled DSS2/2MASS images and a finder field) |
| `batch` | curator batch (below) |
| `selection` | why it is in: `bsc-v3`, `existing-catalog-star`, `handpicked:<group>` (doc 02 §3.2), `guide:<level>` (binocular guide, not the 80 mm "large" tier), `promoted` (doc 03 §8.1), `new` (doc 03 §8.2) |
| `cat`, `simbad`, `note` | optional: source type code, SIMBAD main id, remarks |

Batches by constellation: **winter** Ori Tau Aur Gem CMa CMi Mon Lep Cam + Eri north of −30°; **spring** Leo Cnc UMa CVn Com
Vir Boo Hya Crv Crt Sex LMi Lyn UMi; **summer-north** Lyr Cyg Vul Sge Del Aql Her CrB Dra Equ + Oph north of 0°;
**summer-south** Sco Sgr Ser Sct Lup Lib CrA Nor Ara Tel + Oph south of 0°; **autumn** Cas Cep And Per Tri Peg Psc Cet Aqr
Cap PsA Ari Lac Scl (+ For, Mic); **southern** Car Cru Cen Vel Pup Mus Tuc Dor Men Pav Gru Phe Hor Pic Col Hyi Ret Vol Cir
TrA Aps Oct Cha + Eri south of −30° (+ Ant, Pyx, Cae, Ind). The parenthesised constellations were not named in the brief
and go to the neighbouring batch.

Regenerate: `python3 -I script/journeys/make_object_list.py` (offline, from the cache) or `--refresh` (re-queries SIMBAD).
To add an object, add it to the hand lists in the script (with a doc/source reason), refresh, and commit list + cache.

## Auto tier (`generated/*.auto.json`)

Written by the auto star / auto DSO scripts from the cached catalogs:

```jsonc
{ "version": "stars.auto-2026-11-xx", "generatedBy": "script/journeys/<script>",
  "sources": [ /* Source[] for every catalog used */ ],
  "objects": [ /* Partial<KbObject> keyed by id: id, kind, hr, names, con, ra, dec, mag, facts, spectral,
                  variability, multiplicity, dsoClass (seed map, doc 03 §4.1), extent, evoStage (seed), view
                  (basis "derived"), media.images (existing survey cutouts), sources,
                  provenance: { status: "auto" } */ ] }
```

Auto values use `method: "catalog"` (or `"derived"` for computed ones such as `sizeLy`); every value has a `sourceId`.

## Curated tier (`curated/<batch>-<stars|dso>.json`)

One file per batch and kind, written by the curator for that sky region. Format:

```jsonc
{
  "batch": "winter",                    // BatchId
  "kind": "star",                       // "star" | "dso" — every object in this file has this kind
  "version": "winter-stars-2026-11-xx",
  "curator": "curator-winter",
  "sources": [ /* Source[] added by this curator (ids must be globally unique; reuse existing ids when citing the same work) */ ],
  "objects": [ /* curated object records, see example; must be ids from object-list.json with this batch and kind */ ],
  "edges": [ /* Edge[] with curated: true; endpoints may be in any batch */ ],
  "contexts": [ /* optional ContextNode[] (associations, clouds, groups) introduced by this batch */ ],
  "narration": { /* optional: reasonKey -> string[] variants for this file's edges */ }
}
```

A curated object record has the `KbObject` shape (types.ts). It may omit fields that the auto tier supplies
(coordinates, `hr`, `con`, catalog `mag`, catalog facts); everything the auto tier cannot supply (pedagogy, card,
media captions, curated facts) must be present for the object to be journey-eligible. One full example record
(copied from the fixture, which validates):

```json
{
  "id": "STAR-Betelgeuse", "kind": "star", "hr": 2061,
  "names": { "display": "Betelgeuse", "designation": "α Orionis", "aliases": ["alf Ori", "HR 2061", "HD 39801", "58 Ori"], "simbadId": "* alf Ori" },
  "con": "Ori", "ra": 88.79292, "dec": 7.40694, "mag": 0.5,
  "facts": {
    "distanceLy": { "value": 548, "min": 499, "max": 636, "unit": "ly", "sourceId": "joyce2020", "method": "model", "note": "168 +27/−15 pc from seismic + evolutionary modelling" },
    "teffK": { "value": 3600, "min": 3575, "max": 3625, "unit": "K", "sourceId": "levesque2020", "method": "measured", "note": "3600 ± 25 K" },
    "radiusRsun": { "value": 764, "min": 702, "max": 880, "unit": "Rsun", "sourceId": "joyce2020", "method": "model" },
    "massMsun": { "value": 18, "min": 16.5, "max": 19, "unit": "Msun", "sourceId": "joyce2020", "method": "model" },
    "vMax": { "value": 0.0, "unit": "mag", "sourceId": "gcvs", "method": "catalog" },
    "vMin": { "value": 1.6, "unit": "mag", "sourceId": "gcvs", "method": "catalog" }
  },
  "spectral": { "text": "M1-M2 Ia-Iab", "class": "M", "lumClass": "Ia-Iab", "sourceId": "simbad" },
  "evolutionaryStage": "red-supergiant", "stageConfidence": "established",
  "variability": { "class": "semiregular", "gcvsType": "SRc", "vMax": 0.0, "vMin": 1.6, "binocularVisibleAtMin": true, "volatile": true, "sourceId": "gcvs" },
  "evoStage": 5, "contextIds": [],
  "teaches": [ { "conceptId": "LIFE.giant", "strength": 3 }, { "conceptId": "STAR.size", "strength": 3 },
               { "conceptId": "LIGHT.color-temp", "strength": 3 }, { "conceptId": "STAR.supergiant-fate", "strength": 3 } ],
  "roles": ["supergiant", "variable"], "wow": 4, "insight": 5, "obsDifficulty": 1,
  "superlatives": [ { "claim": "one of the largest stars visible to the naked eye", "scope": "whole sky", "sourceId": "joyce2020", "tag": "largest-star-in-view" } ],
  "misconceptions": ["MC2", "MC4", "MC6"],
  "historyHook": { "text": "In 2019–20 it faded so much that people expected an explosion; a dust cloud it had puffed out was to blame.", "sourceId": "eso2109" },
  "showpiece": true, "interest": 0.95,
  "media": {
    "images": [ { "src": "data/binocular-images/STAR-Betelgeuse-optical.jpg", "credit": "Digitized Sky Survey · STScI / Caltech / UKST / AAO; color mosaic by CDS",
                  "license": "DSS2: educational non-commercial use with acknowledgment", "caption": "Survey photograph of the Betelgeuse field; the star itself is a saturated point.",
                  "fieldDeg": 3.7, "variant": "optical" } ],
    "visuals": [ { "type": "temperature-swatch" }, { "type": "hr-diagram" }, { "type": "size-comparison" }, { "type": "light-curve", "shape": "irregular" } ]
  },
  "card": {
    "glance": "A bright orange point at Orion’s shoulder; defocus slightly and the color becomes obvious.",
    "whyHere": "A star near the end of its life: this is what a heavy star becomes before it explodes.",
    "see": "Center the shoulder star, then nudge the focus off sharp: the point swells into a small orange disk. Swing to blue-white Rigel at the opposite corner of Orion and back.",
    "understand": "Betelgeuse is a red supergiant. It used up the hydrogen in its core in a few million years and swelled enormously. Its surface cooled to about 3,600 K, well below the Sun’s 5,800 K, so it glows orange-red.",
    "wonder": "Put it where the Sun is and its surface would reach past the orbit of Mars.",
    "connect": "Heavy stars do not fade quietly. Next: the wreck left by one that already exploded.",
    "numbers": [ { "label": "Distance", "factRef": "distanceLy", "comparisonKey": "distance.light-left" },
                 { "label": "Size", "factRef": "radiusRsun", "comparisonKey": "size.marble" },
                 { "label": "Surface temperature", "factRef": "teffK", "comparisonKey": "temperature.sun" } ],
    "photoCaption": "Survey photos show only a saturated point; even big telescopes resolve its surface into a few pixels.",
    "deeper": "Joyce et al. (2020) combined its pulsation periods with evolution models: 16.5–19 solar masses, about 764 solar radii and 168 (+27/−15) parsecs.",
    "tier": "showpiece"
  },
  "eventDependent": { "kind": "dimming", "note": "Its brightness varies; check AAVSO before comparing it with nearby stars.", "checkUrl": "https://www.aavso.org/" },
  "sources": ["joyce2020", "levesque2020", "eso2109", "gcvs", "simbad"],
  "provenance": { "status": "curated", "batch": "winter", "curatedBy": "curator-winter" }
}
```

One example edge (the `reasonKey` must exist in narration; put its text in this file's `narration` block or in
`curated/narration.json`):

```json
{
  "from": "STAR-Aldebaran", "to": "AST-Hyades", "type": "LINE_OF_SIGHT", "subtype": "foreground-star",
  "strength": 1, "reasonKey": "edge.STAR-Aldebaran>AST-Hyades", "curated": true, "directed": false,
  "factRefs": [ { "objectId": "STAR-Aldebaran", "fact": "distanceLy" }, { "objectId": "AST-Hyades", "fact": "distanceLy" } ]
}
```

```json
"narration": { "edge.STAR-Aldebaran>AST-Hyades": ["{prev} looks like part of the Hyades but sits less than half as far away, a foreground star."] }
```

Edge rules (spec decision 3): type is one of `LIFE_NEXT CAUSE SIBLING CONTRAST SAME_FAMILY SCALE TIME_MACHINE
SAME_PHYSICS NEIGHBOR LINE_OF_SIGHT`; `strength` 0.2–1; every edge has a `subtype` and a `reasonKey`; NEIGHBOR alone
never justifies a step; `LINE_OF_SIGHT` needs both distances with a ratio ≥ 2.

Content rules (spec decision 1): ground every fact and story in published sources (NASA, ESA/Hubble, ESO, NOIRLab, Chandra,
APOD, S&T, EarthSky, Astronomy, BAA, Cloudy Nights, published binocular guides, SIMBAD/VizieR/NED/papers; Wikipedia
only to find primary references). Write original prose; never copy. Every number is a `FactValue` with a `sourceId`.

## Merge rule (curated overrides auto, field by field)

For each id in `object-list.json`, the build starts from the auto record and overlays the curated record:

1. **Scalars and plain objects** (`mag`, `names`, `spectral`, `variability`, `card`, `view`, `appearance`, …): a curated
   value replaces the auto value wholesale. A field the curated record omits keeps its auto value.
2. **`facts`** merge per key: a curated `FactValue` replaces the auto one for that key; other auto keys survive.
   A curated `null` for a key deletes the auto value (use it for a known-bad catalog number; say why in `provenance.overrides`).
3. **Arrays** (`teaches`, `roles`, `superlatives`, `misconceptions`, `contextIds`, `media.images`, `media.visuals`) are
   replaced, not concatenated. Exception: `sources` is the union of both tiers.
4. `provenance.status` becomes `curated` (or `reviewed`); the build appends to `provenance.overrides` every field path
   where a curated value replaced a different auto value (e.g. `facts.ageMyr`).
5. Positions of BSC stars always come from `bsc5-short.json` (single source of truth for charts); a curated `ra/dec`
   for a BSC star is an error.
6. Edges, contexts and narration from all curated files are concatenated; duplicate `(from, to, type)` edges or duplicate
   ids are a build error. Sources are de-duplicated by id (identical records only; conflicting duplicates are an error).

Journey-eligible (engine gate, doc 05 §4 / doc 03 §9): `provenance.status` ≥ curated, ≥ 1 `teaches`, ≥ 1 sourced
numeric fact, a complete `card`, and for DSOs `view.basis` ≠ `derived`. Auto-only records ship for the inspector but are
never placed in a journey.

## Non-batch curated sources

`curated/concepts.json` (`ConceptsJsonFile`), `curated/templates.json` (`TemplatesJsonFile`, 12 archetypes as slot
grammars, doc 04 §3 / doc 05 §5.4) and `curated/narration.json` (`NarrationBank`: generic transition keys such as
`CONTRAST.teffK`, `LIFE_NEXT`, `direction.sweep`, `title.<templateId>`, `compare.<comparisonKey>`) are copied to the outputs
after validation, with batch narration blocks merged in.
