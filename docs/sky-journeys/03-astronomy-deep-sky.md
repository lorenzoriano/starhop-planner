# 03: Sky Journeys deep-sky knowledge base

Author role: deep-sky observer and astrophysicist (star formation, clusters, nebulae, galaxies).
Date: 2026-11-02. Status: design. No code or data was changed in this phase.
Scope: the deep-sky half of the knowledge base (KB). Stars, doubles and variables belong to the star doc.
Sibling contracts I conform to: `05-journey-engine-design.md` §4 (`JourneyObject`, `StoryEdge`, `EdgeType`) and
`04-pedagogy-and-journey-criteria.md` §2.4 (pedagogy fields: `teaches`, `roles`, `evoStage`, `wow`, `insight`, `obsDifficulty` …).
This doc owns the deep-sky record schema, the deep-sky taxonomy, the source pipeline, the context nodes and the curated deep-sky edges.

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | **Key the KB on the existing `UnifiedTarget.id`** (`M42`, `NGC869`, `AST-Hyades`, `Mel20` …). New objects get ids in the same style (`Cr69`, `DN-Pipe`). | Cards, sessions, hop routes and the 558 bundled images already use these ids. |
| D2 | **Curated source file + pinned catalog snapshots + offline build script → one compiled JSON.** Nothing is fetched at runtime. | Offline-first; reproducible; every number keeps a `sourceId`. |
| D3 | **Open clusters: Hunt & Reffert 2023/2024 (Gaia DR3) are the primary catalog**: distance, members, radii, mass, age with a 16–84 % range. Cantat-Gaudin 2020 is the cross-check. **For about 40 showcase clusters a curated literature value overrides the catalog age.** WEBDA and Kharchenko MWSC are legacy fallbacks only. | HR23/24 are the largest homogeneous Gaia DR3 census, with masses. Their neural-net ages are biased for very old clusters (M67: 1.7 Gyr vs 3.5–4.8 Gyr in the literature) and for some young ones, as §5.4 shows. |
| D4 | **Globulars: Baumgardt & Vasiliev (distance, mass, radii) + Harris 2010 ([Fe/H]) + curated literature ages.** | Baumgardt is the modern Gaia/HST dynamical compilation. Harris remains the standard for metallicity. Neither catalog gives ages. |
| D5 | **Galaxies: NED-D for distances (prefer TRGB/Cepheid), SIMBAD/OpenNGC for morphology, curated text for interactions.** | SIMBAD's `otype` is wrong for teaching (M81 = "Sy2", M31 = "AGN"). The taxonomy is ours. |
| D6 | **Nebulae inherit distance from their ionizing cluster** (M8 ← NGC 6530, M16 ← NGC 6611, Rosette ← NGC 2244). Planetary nebulae use the Gaia parallax of the central star. SNRs use literature values with explicit ranges. | Nebulae have no parallax of their own. Cluster distances are now good to a few percent. |
| D7 | **Context nodes** (non-observable): OB associations, cloud complexes, galaxy groups, host galaxies. Edges between observable objects are mostly *derived through* these nodes. | "Same family" stories (Orion OB1, Per OB1, M81 Group, Local Group) fall out automatically. |
| D8 | **Map every deep-sky relation to the engine's 9 `EdgeType`s with a `subtype`.** Add exactly one new type, `LINE_OF_SIGHT`, or accept `CONTRAST` + `subtype:"line-of-sight"` as a fallback. | Chance alignments (Aldebaran/Hyades, M46/NGC 2438, M35/NGC 2158, 47 Tuc/SMC, Coathanger) are the best TWIST stops in doc 04. They deserve a first-class edge. |
| D9 | **Binocular view = a 2×2 grade matrix** (7×50/10×50 × suburban/dark), grades 0–4. It is seeded from the existing `level` and the existing surface-brightness model in `binocular-assessment.ts`, then hand-reviewed for every journey-eligible object. | Honest "what you will actually see" is the core promise. The runtime moon and sky check stays in `binocularAssessment()`. |
| D10 | **Deep-sky KB data file is licensed CC BY-SA 4.0** (it contains OpenNGC-derived values), alongside the existing `docs/licenses/OpenNGC-CC-BY-SA-4.0.txt`. Prose is original. Never paste Wikipedia text. | ShareAlike obligation of OpenNGC. Facts are not copyrightable, but prose is. |

---

## 1. Inventory: what already exists (measured on the branch, 2026-11-02)

### 1.1 Files

| File | Content | Deep-sky relevance |
|---|---|---|
| `client/public/data/messier.json` | 110 records `{M, NGC, T, V, S, RA, Dec, Con, N?}`. `T` counts: GC 29, OC 27, SG 23, EG 8, DN 6, PN 4, BG 4, LG 4, SN 1, MW 1, DS 1, AS 1, IG 1. | Coordinates, magnitude, size. `T` is coarse: `DN` lumps H II regions (M8, M17, M42, M43) with the reflection nebula M78. M16 is typed `OC`. |
| `client/public/data/binocular-catalog.json` | 187 records `{id, cat, name, altId?, ra, dec, mag, con, desc, binoTip, size?, mag2?, sep?}`. `cat` counts: OC 92, DS 27, AST 20, STAR 16, GC 10, GAL 8, PN 7, EN 5, SNR 2. | Southern and NGC/IC clusters, the Veil, Helix, NGC 7000 and others. `desc` is one line of trivia. |
| `client/src/lib/binocular-guide.ts` | 61 hard-coded `BinocularEntry` items (`family`, `level`, `equipment`, `impression`, `finding`, `references`). | Original, honest observing notes. Useful seed for `seeText`. |
| `client/src/lib/binocular-guide-extra.json` | 179 more entries in the same shape, plus `minAperture` and `variable`. | Same. Together with the 61 above: **240 guide targets**. |
| `client/src/lib/binocular-media.json` | 297 keys (all unified catalog objects), each with `{ra, dec, fov, images[]}`: 297 DSS2 optical + 240 2MASS infrared. 24 images are `display:false`. | Image paths for `imageIds`. |
| `client/src/lib/binocular-featured-images.json` | 20 credited Wikimedia/NASA photos. 14 of them replace a saturated or poorly framed DSS2 cutout of a deep-sky object (M7, M8, M13, M16, M17, M20, M27, M42, M43, M62, M97, M108, NGC 3372, NGC 6530); M64 has an extra photo. | Best photos for the showpiece nebulae. The license pattern can be reused. |
| `client/public/data/binocular-images/` | 558 files, 38.2 MB (537 survey JPEGs + 20 featured + CREDITS.md). | Already precached offline. |
| `client/src/lib/catalog-extents.json` | 253 extended targets `{majorArcmin, minorArcmin, positionAngle, source}`; 71 from OpenNGC (pinned commit `be3cd6c`, SHA-256 `54abea0b…`). | Angular size → physical size (derived). |
| `client/src/lib/binocular-assessment.ts` | Surface brightness `mag + 2.5 log10(π/4·a·b·3600)`, sky contrast, Krisciunas–Schaefer moon glow, point-source limit. | **Reuse for the visibility gate.** Don't write a second model. |
| `client/src/lib/binocular-observation-references.json` | 28 targets with links to real binocular sketches (VdS, ASOD). | Evidence for curated view grades. |
| `docs/binocular-guide-research.md`, `docs/round5-content-sources.md`, `docs/catalog-angular-extents.md`, `docs/licenses/OpenNGC-CC-BY-SA-4.0.txt` | Provenance and licensing precedent: DSS2 non-commercial with acknowledgment, 2MASS public domain, OpenNGC CC BY-SA 4.0. | Same rules apply to the new KB. |

### 1.2 Counts that matter for journeys

Composition of the 240 guide targets by `family`: cluster 151 (including 39 globulars), galaxy 42, nebula 10, asterism 8, star 16, double 13. **211 are deep-sky.**

Deep-sky guide entries by catalog type × difficulty level:

| Type | easy | dark | challenge | large (80 mm tier) | total |
|---|---|---|---|---|---|
| Open cluster (OC + M-OC) | 52 | 51 | 8 | 0 | 111 |
| Globular (GC + M-GC) | 6 | 22 | 7 | 4 | 39 |
| Galaxy (all types) | 3 | 9 | 9 | 21 | 42 |
| Emission/diffuse nebula (EN + M-DN) | 1 | 4 | 1 | 1 | 7 |
| Planetary nebula | 0 | 1 | 1 | 0 | 2 |
| Supernova remnant (M1) | 0 | 0 | 1 | 0 | 1 |
| Asterism / star cloud | 6 | 2 | 0 | 0 | 8 (+M24) |

- **185 deep-sky objects are in the small-binocular tier** (not `large`). **All 185 have bundled DSS2 optical and 2MASS infrared images.** 10 of them (M7, M8, M13, M16, M17, M27, M42, M62, M97, NGC 3372) show a credited photograph in place of the DSS2 cutout.
- **26 more** are in the mounted 80 mm tier, also with both images.
- **30 deep-sky objects are in the catalog but not in the guide.** They have only an optical image and no observing notes: M43, M57, M73, M74, M76, M91, M98, IC 405, NGC 884, 1502, 2158, 2237, 2362, 2392, 3242, 4565, 6530, 6543, 6802, 6826, 6871, 6885, 6888, 6960, 6992, 7009, 7293, 7331, 7662, 891. **About 12 of them are binocular-viable and important for stories:** M43, NGC 884, NGC 2158, NGC 2362, NGC 6530, NGC 6871, NGC 6960/6992 (Veil), NGC 7293 (Helix), NGC 2237 (Rosette nebula, dark sky), plus NGC 6888 and M57 as challenges. Promote them (§8).
- **Total: about 197 binocular-viable deep-sky objects already have offline images.** None has astrophysical facts (distance, age, mass, power source). That is the gap this KB fills.

**Thin classes for the life-cycle stories.** Only 2 planetary nebulae (M27, M97) and 1 SNR (M1) are guide entries. The Helix, the Veil and NGC 6530 exist only in the catalog. There are **zero dark nebulae** and **zero reflection nebulae** apart from M78. These are the deep-sky gaps that matter (§8).

---

## 2. Taxonomy

### 2.1 `class` (one per object) and `traits` (zero or more)

```ts
type DeepSkyClass =
  // where stars are born
  | 'hii-region'            // emission nebula ionised by O/early-B stars: M42, M8, M17, NGC 7000, NGC 3372
  | 'reflection-nebula'     // dust scattering starlight: M78, NGC 1977 (mixed), Pleiades dust (not binocular)
  | 'dark-nebula'           // silhouette dust cloud: Pipe (B59/B78), Barnard's E (B142/143), Coalsack
  | 'nebula-complex'        // genuinely mixed emission+reflection+dark in one object: M20 (Trifid)
  // stellar groups
  | 'embedded-cluster'      // still inside its natal gas, ≲ 5 Myr: ONC/M42, NGC 6530 in M8, NGC 6611 in M16, NGC 2264
  | 'open-cluster'          // gravitationally bound, gas-free; age bins are computed (§2.3)
  | 'ob-association'        // unbound young group (context node, or observable when it has a binocular "face": Cr 70 Belt)
  | 'moving-group'          // dispersed co-moving stars: Ursa Major group (star doc), Mel 111 is borderline
  | 'globular-cluster'
  | 'star-cloud'            // M24: a window through dust onto a spiral arm
  | 'asterism'              // chance alignment, no physical group: Coathanger (Cr 399), Kemble's Cascade, Engagement Ring
  // how stars die
  | 'planetary-nebula'      // M27, M57, NGC 7293, M97 …
  | 'supernova-remnant'     // M1, Veil (NGC 6960/6992)
  | 'wind-bubble'           // Wolf–Rayet/O-star bubble: NGC 6888 (Crescent)
  // galaxies
  | 'galaxy-spiral' | 'galaxy-barred-spiral' | 'galaxy-lenticular' | 'galaxy-elliptical'
  | 'galaxy-dwarf-elliptical' | 'galaxy-irregular'          // LMC/SMC = Magellanic irregular, M82 = irregular/starburst
  | 'milky-way-field';      // a rich field or rift, not a catalog object: Cygnus Rift, Scutum Star Cloud

type Trait =
  | 'starburst' | 'active-nucleus' | 'interacting' | 'satellite' | 'edge-on'
  | 'core-collapsed' | 'former-dwarf-nucleus' | 'retrograde-halo'          // globulars
  | 'contains-red-supergiants' | 'contains-red-giants' | 'contains-white-dwarfs' | 'dissolving'
  | 'pulsar' | 'historical-supernova'
  | 'naked-eye' | 'line-of-sight-pair';
```

Rules:
- **`secondaryClasses`** handle composites: M8 = `hii-region` + `embedded-cluster` (NGC 6530); M16 = `hii-region` + `embedded-cluster`; NGC 2244 is the `open-cluster` and NGC 2237 is the `hii-region` (separate records, linked by `CAUSE`).
- **The asterism class is a teaching asset, not a demotion.** Its `teaches` must include `SKY.projection`.
- Do **not** derive `class` from SIMBAD `otype` or from `messier.json` `T`. Map once by hand and check it with a validator. Section 4.1 gives the seed mapping.

### 2.2 Mapping to the sibling contracts

| `class` | doc 05 `ObjectKind` | doc 04 `roles` | default doc 04 `evoStage` (0–8) | doc 05 `LifeStage` (0–6) |
|---|---|---|---|---|
| dark-nebula | dark-nebula | nursery | 0 | 0 |
| hii-region / reflection-nebula / nebula-complex | emission-nebula / reflection-nebula | nursery | 0 (1 if its cluster is the target) | 0 |
| embedded-cluster | open-cluster | young-cluster | 1 | 1 |
| open-cluster ≤ 10 Myr | open-cluster | young-cluster | 1 | 1 |
| open-cluster 10–200 Myr | open-cluster | young-cluster | 2 | 2 |
| open-cluster 0.2–2 Gyr | open-cluster | adult-cluster | 3 | 2 |
| open-cluster > 2 Gyr | open-cluster | old-cluster | 4 | 2 |
| globular-cluster | globular | globular | 4 | 2 |
| ob-association | open-cluster | association | 1–2 | 1 |
| asterism | asterism | (none) | null | null |
| star-cloud / milky-way-field | milky-way-field | (none) | null | null |
| planetary-nebula | planetary-nebula | pn | 6 | 5 |
| supernova-remnant | snr | snr | 7 | 6 |
| wind-bubble | emission-nebula | supergiant (precursor) | 6 | 4 |
| galaxy-* | galaxy | galaxy | 8 | null |

**Open question for the orchestrator.** Doc 04 defines `evoStage` 0–8 and doc 05 defines `LifeStage` 0–6. Recommendation: store doc 04's finer `evoStage` and **derive** `LifeStage` with the table above in `kb.ts`. Don't author both.

### 2.3 Cluster age bins (computed, not authored)

`ageMyr` → bin: `≤10` newborn (still has gas or OB stars), `10–100` young (blue B stars dominate), `100–1000` adult (A stars on top, first red giants), `1000–5000` old (yellow/orange top, many giants), and `>8000` ancient (globulars).
The binocular-visible signature for each bin goes in the card template ("blue-white sparkle" vs "golden giants"). That is the payoff of doc 04's `LIFE.cluster-age`.

---

## 3. The per-object record

### 3.1 Schema

Authoring source: `data-src/sky-journeys/deep-sky.json` (array), `context-nodes.json`, `edges.deep-sky.json`, `sources.json`.
Compiled output: merged into `client/public/data/journeys/objects.json` / `edges.json` as doc 05 specifies.
The compiled `JourneyObject` is a **projection** of this record. Extra fields stay in the record for cards.

```ts
// Source registry: every number and every curated claim points here.
interface Source {
  id: string;                        // "HR24", "BV21", "H10", "ONGC", "Menten07", "Kiss08", …
  kind: 'catalog' | 'paper' | 'web' | 'book' | 'curator';
  citation: string;                  // "Hunt & Reffert 2024, A&A 686, A42"
  bibcode?: string; url?: string; vizier?: string;   // "J/A+A/686/A42/clusters"
  license?: string;                  // "CC BY-SA 4.0" (OpenNGC), "CDS terms", "Harris: free, cite, no fee"
  retrieved?: string; snapshotSha256?: string;
}

type FactMethod = 'gaia-parallax' | 'gaia-cluster-ml' | 'maser-parallax' | 'isochrone' | 'nn-isochrone'
  | 'lithium-depletion' | 'kinematic' | 'n-body-fit' | 'cepheid' | 'trgb' | 'expansion'
  | 'historical-record' | 'photometric' | 'compiled' | 'derived';

interface Fact {                     // superset of doc 05 FactValue {value, lo, hi, unit, sourceId}
  value: number; lo?: number; hi?: number; unit: string;
  sourceId: string; method?: FactMethod;
  derived?: boolean;                 // computed by the build script (sizeLy from distance × angle)
  confidence?: 'high' | 'medium' | 'low';
  note?: string;                     // "LDB age; isochrone ages range 75–150 Myr"
}

interface BinocularView {            // grades 0..4, see §3.3
  '7x50':  { suburban: 0|1|2|3|4; dark: 0|1|2|3|4 };
  '10x50': { suburban: 0|1|2|3|4; dark: 0|1|2|3|4 };
  basis: 'curator' | 'derived' | 'sketch-evidence';    // derived = seeded, must become curator before journey use
  evidenceIds?: string[];            // binocular-observation-references / VdS sketches
}

interface DeepSkyRecord {
  id: string;                        // == UnifiedTarget.id
  names: { common?: string; catalog: string[]; simbadMainId: string };
  class: DeepSkyClass; secondaryClasses?: DeepSkyClass[]; traits?: Trait[];
  morphology?: { hubble: string; sourceId: string };   // galaxies: "SA(s)b"

  facts: {                           // doc 05 keys first; units fixed
    distanceLy?: Fact;               // canonical; builder converts pc ×3.26156 and keeps pc in note
    ageMyr?: Fact;                   // clusters, nebulae (ionizing cluster age), PN/SNR (0.01 = 10 kyr)
    sizeLy?: Fact;                   // physical diameter; derived from catalog-extents + distance unless curated
    massMsun?: Fact;                 // stellar mass (clusters, globulars); galaxies optional (total, with range)
    memberCount?: Fact;              // Gaia members (note the magnitude limit); never "number of stars" for galaxies
    feH?: Fact;                      // [Fe/H] dex; globulars and old clusters
    surfaceBrightness?: Fact;        // mag/arcsec² (OpenNGC SurfBr or computed); feeds visibility
    angularSizeArcmin?: Fact;        // copy of catalog-extents major axis, for the card
    radialVelocityKms?: Fact;        // used only for line-of-sight proofs (M46 vs NGC 2438)
  };

  poweredBy?: {                      // "what makes it shine"
    kind: 'ionizing-stars' | 'reflected-starlight' | 'silhouette' | 'central-star-uv'
        | 'pulsar-wind' | 'shock-heating' | 'stellar-wind' | 'starlight' | 'agn-plus-stars';
    starIds?: string[];              // star-doc ids, e.g. "star:HR1895" (θ1 Ori C)
    textKey: string; sourceIds: string[];
  };
  contextIds: string[];              // ["ctx:OriOB1d","ctx:OrionA"]; membership in context nodes (§6.1)

  appearance: {
    view: BinocularView;
    moonTolerance: 'high' | 'medium' | 'low';   // fast pre-filter; the real check is binocularAssessment()
    resolves: 'stars' | 'partly' | 'glow' | 'silhouette';
    bestFieldDeg: number;            // field needed to frame it with context (Hyades 6, M31 4, M13 1)
    colorVisible: boolean;           // honest: true only for bright stars inside the object (Double Cluster RSGs)
    filterHelps?: 'OIII' | 'UHC' | 'H-beta';
    seeText: string;                 // ≤ 40 words: what 10×50 actually shows (start from guide `impression`)
    notSeeText: string;              // ≤ 25 words: what photos show and binoculars won't
  };

  // doc 04 pedagogy fields (owned there, stored here)
  teaches: { conceptId: string; strength: 1|2|3 }[];
  roles: string[]; evoStage: number | null;
  superlatives: { claim: string; scope: string; sourceId: string }[];
  wow: 1|2|3|4|5; insight: 1|2|3|4|5; obsDifficulty: 1|2|3|4|5;
  misconceptions: string[]; historyHook?: { textKey: string; sourceId: string };
  showpiece: boolean;                // doc 05
  interest: number;                  // doc 05 0..1, set by educator rubric

  text: {                            // original prose, keys for the template grammar (doc 05 §8)
    whySee: string;                  // ≤ 50 words, physics-first
    physics: string;                 // ≤ 120 words: what it is, what powers it, how we know
    deeper?: string;                 // optional "Deeper" section, ≤ 150 words
  };
  imageIds: string[];                // existing paths under data/binocular-images/ (featured first)

  provenance: {
    status: 'seeded' | 'curated' | 'reviewed';   // journey-eligible only when ≥ curated
    curatedBy: string; reviewedAt?: string;
    overrides?: { field: string; catalogValue: number; reason: string }[];  // e.g. M67 age
  };
}
```

### 3.2 Field rules

- **Every `Fact` has a `sourceId`** that exists in `sources.json`. Derived facts point to the inputs as `sourceId:"derived"` and say which ones in `note`.
- **Always keep ranges.** Showcase ages vary by method (Pleiades: LDB 112–130 Myr vs turn-off 75–150 Myr). The card shows "about 120 million years (estimates 110–130)" and the engine uses `value`.
- **`sizeLy` for clusters is the visible extent, not the tidal radius.** Use `catalog-extents.json`, the existing *observing* extent, with distance. Store HR24 `rJpc` (Jacobi radius) only in `note`. The "lone star" fringe is real but invisible.
- **Galaxy `massMsun`** is optional and must carry `confidence:'low'` and a range (M31 total-mass estimates differ by about 2×). Prefer luminosity statements ("about a trillion stars" is too uncertain; say "hundreds of billions").
- **`memberCount`** must say "Gaia members brighter than G ≈ 18–20". Don't present it as all the stars.

### 3.3 Binocular view grades

| Grade | Meaning in the eyepiece |
|---|---|
| 0 | Not seen |
| 1 | Suspected with averted vision, or only with prior knowledge |
| 2 | Certain but faint; needs the chart |
| 3 | Easy once pointed; shape or texture clear |
| 4 | Showpiece; draws attention in a sweep |

"Suburban" means Bortle 5–6 (SQM ≈ 19.0–19.8 mag/arcsec²). "Dark" means Bortle 2–3 (SQM ≈ 21.3–21.7). The existing model's default sky is 21.6.

**Seeding** (`basis:'derived'`), from the guide `level`. Starting points for 10×50 (suburban/dark): `easy` 3/4, `dark` 1/3, `challenge` 0/2, `large` 0/1. 7×50 is one grade lower for objects < 10′ (magnification-limited). It is the same or one grade higher for objects > 60′ (wider field, bigger exit pupil, e.g. Hyades, Mel 111, NGC 7000, dark nebulae).
Then clamp with `binocularAssessment()` contrast at sky 19.5 and 21.6. Every journey-eligible object must then be reviewed by a person (`basis:'curator'`). The VdS sketch links in `binocular-observation-references.json` count as evidence.

`moonTolerance`: `high` for open clusters with members brighter than mag 7 and for the Belt and Hyades. `medium` for globulars, M42, M8 and M31's core. `low` for galaxies other than M31's core, large faint nebulae, PNs other than M27, SNRs and dark nebulae.

### 3.4 Worked examples (real values; sources in §10)

```jsonc
{
  "id": "M42",
  "names": { "common": "Orion Nebula", "catalog": ["NGC 1976", "Sh2-281", "LBN 974"], "simbadMainId": "M  42" },
  "class": "hii-region", "secondaryClasses": ["embedded-cluster"], "traits": ["naked-eye"],
  "facts": {
    "distanceLy": { "value": 1350, "lo": 1265, "hi": 1375, "unit": "ly", "sourceId": "Menten07", "method": "maser-parallax",
                    "note": "414±7 pc (VLBA); Kounkel+2017 VLBA gives 388±5 pc; Zucker+2020 dust 433 pc" },
    "ageMyr":      { "value": 1, "lo": 0.3, "hi": 2, "unit": "Myr", "sourceId": "Hillenbrand97", "method": "isochrone",
                    "note": "Orion Nebula Cluster = Ori OB1d, <1 Myr in Brown+1994" },
    "sizeLy":      { "value": 33, "unit": "ly", "sourceId": "derived", "derived": true,
                    "note": "85′ catalog extent (catalog-extents.json, OpenNGC 90′×60′) at 414 pc" },
    "angularSizeArcmin": { "value": 90, "unit": "arcmin", "sourceId": "ONGC" }
  },
  "poweredBy": { "kind": "ionizing-stars", "starIds": ["star:HR1895"], "textKey": "m42.power",
                 "sourceIds": ["ODell01"] },              // θ1 Ori C (O7 V), the brightest Trapezium star
  "contextIds": ["ctx:OriOB1d", "ctx:OrionA"],
  "appearance": {
    "view": { "7x50": { "suburban": 3, "dark": 4 }, "10x50": { "suburban": 3, "dark": 4 }, "basis": "curator",
              "evidenceIds": ["cloudynights-805760"] },     // tripod 10×50 sketch, Bortle 6
    "moonTolerance": "medium", "resolves": "partly", "bestFieldDeg": 3, "colorVisible": false,
    "seeText": "A grey-green fan of glow wrapped around a tight knot of stars in the Sword; the dark 'fish mouth' bay is visible on a dark night.",
    "notSeeText": "No red or pink: photo colors need long exposures. The Trapezium is a single bright point at 10×."
  },
  "teaches": [{ "conceptId": "LIFE.nursery", "strength": 3 }, { "conceptId": "LIFE.cluster-birth", "strength": 2 },
              { "conceptId": "PERC.night-eyes", "strength": 2 }],
  "roles": ["nursery"], "evoStage": 0,
  "superlatives": [{ "claim": "nearest region forming massive stars", "scope": "whole sky", "sourceId": "ODell01" }],
  "wow": 5, "insight": 5, "obsDifficulty": 1, "misconceptions": ["MC-photo-colors"], "showpiece": true, "interest": 1.0,
  "imageIds": ["data/binocular-images/M42-primary.jpg", "data/binocular-images/M42-infrared.jpg"],
  "provenance": { "status": "curated", "curatedBy": "kb-deep-sky" }
}
```

```jsonc
{
  "id": "M45", "names": { "common": "Pleiades", "catalog": ["Melotte 22", "Cr 42"], "simbadMainId": "Cl Melotte 22" },
  "class": "open-cluster", "traits": ["naked-eye"],
  "facts": {
    "distanceLy":  { "value": 440, "lo": 435, "hi": 445, "unit": "ly", "sourceId": "HR23", "method": "gaia-cluster-ml", "note": "134.8 pc" },
    "ageMyr":      { "value": 120, "lo": 110, "hi": 130, "unit": "Myr", "sourceId": "Stauffer98", "method": "lithium-depletion",
                     "note": "LDB 125–130 Myr (Stauffer+98), 122 Myr (Jeffries & Naylor 2000); HR24 NN 122 Myr; CG20 78 Myr" },
    "massMsun":    { "value": 950, "lo": 860, "hi": 1030, "unit": "Msun", "sourceId": "HR24", "note": "mass within Jacobi radius 13.7 pc" },
    "memberCount": { "value": 1721, "unit": "stars", "sourceId": "HR23", "note": "Gaia DR3 members (HDBSCAN), not all stars" },
    "sizeLy":      { "value": 14, "unit": "ly", "sourceId": "derived", "derived": true, "note": "110′ observing extent at 135 pc" }
  },
  "poweredBy": { "kind": "starlight", "textKey": "m45.power", "sourceIds": ["NASA-Pleiades-dust"] },
  "contextIds": [],
  "appearance": { "view": { "7x50": { "suburban": 4, "dark": 4 }, "10x50": { "suburban": 4, "dark": 4 }, "basis": "curator" },
    "moonTolerance": "high", "resolves": "stars", "bestFieldDeg": 3, "colorVisible": true,
    "seeText": "Dozens of blue-white stars in a dipper shape, filling a 7° field with room to spare.",
    "notSeeText": "The blue nebulosity of photographs is a passing dust cloud, invisible in binoculars." },
  "teaches": [{ "conceptId": "LIFE.cluster-birth", "strength": 3 }, { "conceptId": "LIFE.cluster-age", "strength": 3 },
              { "conceptId": "PERC.binoculars", "strength": 3 }],
  "roles": ["young-cluster"], "evoStage": 2,
  "misconceptions": ["MC-nebula-is-birth-cloud"],   // the dust is NOT leftover birth gas
  "wow": 5, "insight": 4, "obsDifficulty": 1, "showpiece": true
}
```

Compact examples (facts only):

| id | class | distance | age | mass / members | other key facts |
|---|---|---|---|---|---|
| M13 | globular-cluster | 7.42 kpc = 24,200 ly (BV21) | ~12 Gyr (11–13; VandenBerg+2013, verify) | 4.84×10⁵ M☉ (BV21) | [Fe/H] = −1.53 (H10); half-light radius 3.47 pc; Arecibo message target, 1974 |
| M31 | galaxy-spiral (SA(s)b) | 761 ± 11 kpc = 2.48 Mly (Li+2021) | — | — | satellites M32, M110; OpenNGC 177.8′ × 69.7′ → ~128,000 ly catalog isophote (derived) |
| M81 / M82 | galaxy-spiral / galaxy-irregular + `starburst`,`interacting` | 3.6 Mpc = 11.8 Mly (NED-D median, TRGB/Cepheid) | starburst triggered ~200–300 Myr ago | — | HI tidal bridges (Yun, Ho & Lo 1994); SN 1993J in M81; SN 2014J in M82 |
| M27 | planetary-nebula | 389 pc = 1,270 ly (Gaia EDR3 central star via SIMBAD) | ~10 kyr (expansion; verify) | — | M57: 788 pc; NGC 7293: 200 pc (nearest bright PN) |

---

## 4. Seed mapping and data sources

### 4.1 Seed `class` from existing type codes (validator rejects any unmapped id)

| Existing code | Default `class` | Hand exceptions |
|---|---|---|
| `OC` (catalog), `OC` (Messier) | open-cluster | M16 → hii-region + embedded-cluster; NGC 6530, NGC 6611, NGC 2264, NGC 2244 → embedded-cluster/open-cluster ≤ 5 Myr; Mel 111 → open-cluster + `dissolving` |
| `GC` | globular-cluster | M54 + `former-dwarf-nucleus`; NGC 5139 + `former-dwarf-nucleus` |
| `DN` (Messier) | hii-region | M78 → reflection-nebula; M20 → nebula-complex |
| `EN` | hii-region | NGC 7000, NGC 3372 |
| `PN` | planetary-nebula | — |
| `SN` / `SNR` | supernova-remnant | — |
| `SG`, `BG` | galaxy-spiral / galaxy-barred-spiral | M82 is `IG` → galaxy-irregular + `starburst`; M77 + `active-nucleus`; M104 + `edge-on` |
| `EG`, `LG` | galaxy-elliptical / galaxy-lenticular | M32, M110 → galaxy-dwarf-elliptical + `satellite` |
| `GAL` | by object | LMC/SMC → galaxy-irregular; NGC 5128 → galaxy-elliptical + `active-nucleus` |
| `AST` | asterism | AST-Hyades → open-cluster; AST-OrionBelt → ob-association (face of Ori OB1b) |
| `MW` | star-cloud | M24 |

### 4.2 Sources: what to use for which field

Reachability was tested from this host on 2026-11-02.

| Source | Use for | Access (tested) | License / terms |
|---|---|---|---|
| **Hunt & Reffert 2023** `J/A+A/673/A114/clusters` | OC distance (`dist16/50/84`), members `N`, `r50pc`, `logAge16/50/84`, `AV50`, `Type` (o/m/g) | ✅ VizieR mirror `vizier.idia.ac.za` (ASU). ❌ CDS Strasbourg timed out from this host | CDS terms; cite paper + DOI |
| **Hunt & Reffert 2024** `J/A+A/686/A42/clusters` | Adds `MassJ`, `MassTot`, `rJpc`, `NJ`. **Primary OC record.** | ✅ IDIA mirror | CDS terms |
| Cantat-Gaudin+ 2020 `J/A+A/640/A1/table1` | Cross-check age (`AgeNN`) and distance (`DistPc`) | ✅ IDIA mirror | CDS terms |
| Kharchenko+ 2013 MWSC `J/A+A/558/A53`; WEBDA | Fallback only (pre-Gaia) | WEBDA ✅ homepage; MWSC via VizieR | — |
| **Baumgardt & Vasiliev 2021** combined table | GC distance `R_Sun`, `Mass`, `rh,l`, `rc`, `rt` | ✅ `people.smp.uq.edu.au/HolgerBaumgardt/globular/combined_table.txt` | Public; cite BV21 and Baumgardt+ papers |
| **Harris 1996 (2010 ed.)** `mwgc.dat` | GC `[Fe/H]`, `M_V,t`, concentration `c`, core-collapse flag | ✅ `physics.mcmaster.ca/~harris/mwgc.dat` | Free; must cite and refer to source; no fee |
| GC ages: VandenBerg+ 2013 (ApJ 775, 134), Ying+ 2023 (M92) | Curated `ageMyr` for ~40 globulars | Paper tables (not found on the VizieR mirror) | Cite |
| **OpenNGC** `NGC.csv`, `addendum.csv` @ `be3cd6c` | Type, axes, PA, `SurfBr`, Hubble type, identifiers, common names | ✅ raw.githubusercontent; SHA-256 matches the pinned `54abea0b…` | **CC BY-SA 4.0** (already in `docs/licenses/`) |
| **SIMBAD TAP** | Identifiers, `main_id`, `mesDistance` (all published distances with bibcodes), hierarchy `h_link` (group membership) | ✅ `simbad.harvard.edu/simbad/sim-tap/sync`. ❌ CDS Strasbourg | Acknowledge SIMBAD (Wenger+2000) |
| **NED-D** | Galaxy redshift-independent distances, by method | ✅ `ned.ipac.caltech.edu/cgi-bin/nDistance`, `srs/ObjectLookup` | NED acknowledgment |
| Gaia EDR3/DR3 PN central stars (González-Santamaría+ 2021 `J/A+A/656/A51`) | PN distances | ✅ IDIA mirror; also via SIMBAD `mesDistance` (I/350) | CDS terms |
| Green's SNR catalogue | SNR identifiers, size | ✅ `mrao.cam.ac.uk/surveys/snrs` | Cite Green |
| Wikipedia REST / Wikidata SPARQL | **Discovery and cross-check only**; Wikidata P2583 distances are noisy (13 values for M31) | ✅ both | Wikipedia text CC BY-SA 4.0 (**don't copy prose**); Wikidata CC0 |
| HiPS2FITS (DSS2/2MASS cutouts) | New object images | ❌ `alasky.cds.unistra.fr` timed out from this host today. The existing script needs CDS; run acquisition from a network that reaches it | DSS2 non-commercial with acknowledgment; 2MASS public domain |

**Pipeline note.** Snapshot every catalog *subset* that we use into `data-src/sky-journeys/snapshots/` with the URL, retrieval date and SHA-256, as `script/import-catalog-extents.py` already does. Then build offline. This also makes the build immune to CDS outages, which we saw today.

### 4.3 Field precedence (build script)

| Field | Open cluster | Globular | Nebula (H II, reflection, dark) | PN | SNR | Galaxy |
|---|---|---|---|---|---|---|
| distance | curated > HR24 `dist50` > CG20 | BV21 `R_Sun` > H10 | curated > ionizing/embedded cluster (HR24) > SIMBAD mesDistance (Zucker+2020 dust) | Gaia central star (SIMBAD I/350) > curated | curated literature (range) | NED-D TRGB/Cepheid median > SIMBAD |
| age | **curated literature for showcase** > HR24 `logAge50` (with 16/84) > CG20 | curated literature (VandenBerg13, Ying23, …) | = embedded cluster age | curated (expansion age) | curated (historical or expansion) | n/a |
| mass | HR24 `MassJ` | BV21 `Mass` | n/a | n/a | n/a | optional, curated, low confidence |
| [Fe/H] | curated (where known) | H10 | n/a | n/a | n/a | n/a |
| angular size | `catalog-extents.json` (existing) | same | same | same | same | same |
| class / traits | curated (§4.1) | curated | curated | curated | curated | curated + OpenNGC Hubble |

---

## 5. Sample queries (exact syntax) and what they taught us

All queries ran from this host on 2026-11-02. Outputs are pasted verbatim (whitespace trimmed).

### 5.1 Pleiades, Hyades, Double Cluster, Praesepe: Cantat-Gaudin 2020 vs Hunt & Reffert 2023/24

```sh
# Cantat-Gaudin 2020 (one cluster per request: the ASU comma list returned nothing)
curl -s "https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=J/A%2BA/640/A1/table1&-out=Cluster,r50,nbstars07,plx,AgeNN,AVNN,DistPc&Cluster=Melotte_22" | grep -v '^#'
```
```
Cluster          r50    nbstars07 plx    AgeNN AVNN DistPc
Melotte_22       1.274  952       7.346  7.89  0.18  128
Melotte_25       5.416  515      21.059  8.90  0.00   47
NGC_869          0.136  503       0.399  7.18  1.69 2197
NGC_884          0.125  322       0.398  7.25  1.72 2130
NGC_2632         0.985  685       5.361  8.83  0.00  183
NGC_2244         0.232  460       0.617  7.10  1.46 1478
NGC_752          0.485  223       2.239  9.07  0.07  483
```

```sh
# Hunt & Reffert 2024 (includes HR23 columns + masses)
curl -s "https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=J/A%2BA/686/A42/clusters&-out=Name,Type,MassJ,e_MassJ,NJ,rJpc,logAge50,dist50&Name=Melotte_22" | grep -v '^#'
# alias search when the main name differs (M39 = NGC 7092 → "Theia_517"):
curl -s "https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=J/A%2BA/686/A42/clusters&-out=Name,Type,N,dist50,logAge50,MassTot&AllNames=*NGC_7092,*"
# canonical TAP form when CDS is reachable:
#   POST https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync  REQUEST=doQuery LANG=ADQL FORMAT=csv
#   QUERY=SELECT Name,Type,N,dist50,logAge16,logAge50,logAge84,MassJ FROM "J/A+A/686/A42/clusters" WHERE Name='Melotte_22'
```
```
Name         Type MassJ    e_MassJ NJ   rJpc   logAge50 dist50
Melotte_22   o    946.5    86.8    1639 13.69  8.085    134.8
Melotte_25   o    193.0    42.6     569  8.06  8.761     47.2
NGC_869      o   2402.4   419.4     403 21.34  7.260   2279.6
NGC_2632     o    945.0    72.7    1224 13.73  8.539    183.5
NGC_2244     o   1387.6   135.6     360 17.18  6.614   1415.2
NGC_752      o    319.5    69.0     310  9.63  9.152    433.6
```

### 5.2 Globulars: M13 (and friends) from Harris 2010 + Baumgardt

```sh
curl -s -o mwgc.dat https://physics.mcmaster.ca/~harris/mwgc.dat
grep -E "^ NGC (6205|6341|6121) " mwgc.dat          # Part I positions, Part II [Fe/H] etc., Part III dynamics
curl -s -o bv.txt https://people.smp.uq.edu.au/HolgerBaumgardt/globular/combined_table.txt
grep -E "^NGC_(6205|6341|6121|5139|6715) " bv.txt | awk '{print $1,$4,$10,$17}'   # name R_Sun[kpc] Mass[Msun] rh,l[pc]
```
```
 NGC 6205    -1.53 13   0.02 14.90 14.33  5.78  -8.55  -0.02  0.68        0.86  F6    0.11   ← Harris part II: [Fe/H]=-1.53, V_t=5.78, M_V=-8.55
NGC_6205 7.42 4.84e+05 3.47     ← M13
NGC_6341 8.50 2.73e+05 2.03     ← M92  ([Fe/H] −2.31, Harris)
NGC_6121 1.85 9.04e+04 2.50     ← M4   (nearest globular; [Fe/H] −1.16)
NGC_5139 5.43 3.94e+06 7.56     ← ω Cen (most massive)
NGC_6715 26.28 1.59e+06 3.58    ← M54  (nucleus region of the Sagittarius dwarf galaxy)
```
Extracted [Fe/H] (Harris) / R_Sun kpc / mass (BV21) for the story globulars: 47 Tuc −0.72/4.52/8.5e5 · ω Cen −1.53/5.43/3.9e6 · M3 −1.50/10.18/4.1e5 · M53 −2.10/18.5/5.0e5 · M5 −1.29/7.48/3.9e5 · M10 −1.56/5.07/1.9e5 · M12 −1.37/5.11/1.1e5 · M22 −1.70/3.30/4.7e5 · M62 −1.18/6.03/5.8e5 · M15 −2.37/10.71/5.2e5 · NGC 6397 −2.02/2.48/8.2e4 · NGC 6752 −1.54/4.12/2.6e5.

### 5.3 M42 and M31 (and hierarchy) from SIMBAD TAP; M31/M42 from OpenNGC

```sh
S=https://simbad.harvard.edu/simbad/sim-tap/sync
curl -s $S --data-urlencode request=doQuery --data-urlencode lang=adql --data-urlencode format=csv --data-urlencode \
 "query=SELECT b.main_id, b.otype, b.ra, b.dec, b.plx_value, b.morph_type, b.galdim_majaxis FROM basic AS b JOIN ident AS i ON i.oidref=b.oid WHERE i.id IN ('M 45','M 13','M 42','M 31')"
```
```
main_id,otype,ra,dec,plx_value,morph_type,galdim_majaxis
"M  13","GlC",250.4234750,36.4613194,0.127,,33.0
"M  31","AGN",10.6847083,41.2687500,,"SA(s)b",199.53
"M  42","HII",83.8201,-5.3876,,,66.0
"Cl Melotte   22","OpC",56.6008333,24.1138889,7.364,,76.86
```
```sh
# all published distances with method + bibcode (note: no ORDER BY on qualified columns, the service rejects it)
"query=SELECT b.main_id, d.dist, d.unit, d.plus_err, d.minus_err, d.method, d.bibcode FROM mesDistance AS d JOIN basic AS b ON d.oidref=b.oid JOIN ident AS i ON i.oidref=b.oid WHERE i.id IN ('M 45','M 13','M 42','M 31')"
```
```
"M  31",761.0,"kpc ",11.0,-11.0,,"2021ApJ...920...84L"
"M  42",433.0,"pc  ",12.0,-15.0,"plx     ","2020A&A...633A..51Z"
"Cl Melotte   22",135.0,"pc  ",1.0,-1.0,"paral   ","2021MNRAS.504..356D"
"Cl Melotte   22",135.4,"pc  ",,,"paral   ","2022ApJ...939...94M"
```
```sh
# group membership (feeds context nodes): parents of M82
"query=SELECT p.main_id AS parent, p.otype, c.main_id AS child FROM h_link AS h JOIN basic AS p ON h.parent=p.oid JOIN basic AS c ON h.child=c.oid JOIN ident AS i ON i.oidref=c.oid WHERE i.id IN ('M 82')"
```
```
"NAME M 81-82 Group","GrG","M  82"
"KPG 218","PaG","M  82"            ← Karachentsev isolated-pair catalog: M81+M82 as an interacting pair
"LGG 176","GrG","M  82"
```
```sh
curl -s -o NGC.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/be3cd6c5498806a2fbb2f7e0452ef802dbb02be0/database_files/NGC.csv
sha256sum NGC.csv   # 54abea0b57b0a103831bfc7a8e3a99a23acfbf4bb581fcf3d8af539cbb826c84 (matches the pinned import)
grep -E "^(NGC0224|NGC1976);" NGC.csv | cut -d';' -f1-15
```
```
NGC0224;G;00:42:44.35;+41:16:08.6;And;177.83;69.66;35;4.29;3.44;2.09;1.28;0.98;23.63;Sb
NGC1976;Cl+N;05:35:16.48;-05:23:22.8;Ori;90.00;60.00;;4.00;4.00;;;;;
```
(`SurfBr` = 23.63 mag/arcsec² for M31 is the field to feed `facts.surfaceBrightness`. The Pleiades are `Mel022` in `addendum.csv`.)

```sh
curl -s 'https://ned.ipac.caltech.edu/cgi-bin/nDistance?name=MESSIER+081' | sed 's/<[^>]*>//g' | grep -E 'Mean|Median'
#  → Mean 27.80 mag / 3.675 Mpc ; Median 27.80 / 3.630 Mpc ; dozens of Cepheid/TRGB/PNLF/SBF rows with bibcodes
```

### 5.4 QA findings from the samples (these set the build rules)

1. **Neural-net cluster ages are not safe for showcase objects.**
   - M67 (NGC 2682): HR24 gives 1.7 Gyr (1.15–2.6), but the literature gives 3.5–4.8 Gyr. Castro+2011 found 3.87 Gyr with solar metallicity and solar twins.
   - Praesepe: HR24 gives 346 Myr, CG20 gives 676 Myr, and the literature gives ~600–750 Myr. Praesepe is Hyades-like.
   - Pleiades: CG20 gives 78 Myr, but LDB ages are 112–130 Myr.
   - Hyades: HR24 gives 577 Myr, but LDB gives 650 ± 70 Myr (Martín+2018) and rotation-isochrones give 750 ± 100 Myr (Brandt & Huang 2015).
   - IC 2602: HR24 gives 26 Myr, but the LDB age is ~46 Myr (Dobbie+2010, verify).
   → **Rule:** curated literature `ageMyr` with `overrides[]` is required for every `showpiece` cluster and every cluster used in an age-ordered archetype. Otherwise use HR24 and always show the 16–84 % range.
2. **Name crossmatch can silently match the wrong thing.** `NGC_6618` (the M17 cluster) returns a *moving group* (`Type=m`) aged 390 Myr at 606 pc, which is nonsense for a ~1 Myr embedded cluster at ~1.6 kpc. → **Rule:** accept a catalog row only if `Type=='o'`, the distance agrees with an independent value within 25 %, and the position agrees within `r50`. Otherwise mark it `curated-required`.
3. **Some binocular "clusters" are not in HR24 by name.** These include M39 (`Theia_517`), Cr 70 (split into `OCSN_61/65`), NGC 1981 and Cr 399. **Cr 399 is absent because it is not a cluster:** Hipparcos showed a chance alignment (Baumgardt 1998). Treat that as a teaching fact, not as missing data.
4. **SIMBAD `otype` is unusable as a public label** (M31 `AGN`, M81 `Sy2`, NGC 253 `SyG`, NGC 7000 `Cl*`). Use our taxonomy.
5. **Distances differ by method.** M42 is 388 pc (VLBA), 414 pc (VLBA) or 433 pc (dust); M81 ranges from 1.4 to 5.0 Mpc across 80+ NED rows. Store the curated value with a range, and keep the alternatives in `note`.

---

## 6. Relationships: the deep-sky story graph

### 6.1 Context nodes (`context-nodes.json`, not observable, but they carry facts and text)

| id | kind | members (observable ids) | key facts (source) |
|---|---|---|---|
| `ctx:OriOB1` (+ `1a`…`1d`) | ob-association | 1b: AST-OrionBelt (ε, ζ, δ Ori). 1c: NGC1981, Sword stars. 1d: M42, M43 | Subgroup ages 1a 11.4 ± 1.9, 1b 1.7 ± 1.1, 1c 4.6 ± 2.0, 1d < 1 Myr (Brown+1994; modern Gaia work, e.g. Kounkel+2018, shows a more complex structure) |
| `ctx:OrionA`, `ctx:OrionB` | molecular-complex | A: M42, M43, NGC 1977. B: M78 (+ NGC 2024 / Horsehead, not binocular) | ~400 pc; the "cloud that is still making stars" |
| `ctx:LambdaOri` | ob-association | Cr69 (to add) | ~5 Myr (HR24 log 6.72); ring of gas around λ Ori |
| `ctx:PerOB1` | ob-association | NGC869, NGC884 (+ halo of red supergiants) | 14 Myr (Currie+2010), ~2.3 kpc |
| `ctx:CasTau` / `ctx:AlphaPer` | moving-group | Mel20 | α Per cluster ~50–90 Myr; 175 pc |
| `ctx:ScoCen` (Upper Sco) | ob-association | star:Antares (star doc) | nearest OB association, ~140 pc; Upper Sco ~10–11 Myr (Pecaut & Mamajek 2016, verify) |
| `ctx:ScoOB1` | ob-association | NGC6231 (+ ζ¹ Sco) | 1.55 kpc, 4 Myr (HR24) |
| `ctx:MonOB1`, `ctx:MonOB2` | ob-association | OB1: NGC2264. OB2: NGC2244, NGC2237 | ~0.7 and ~1.4–1.6 kpc |
| `ctx:SgrOB1`, `ctx:SerOB1` | ob-association | SgrOB1: M8/NGC6530, M20, M21. SerOB1: M16/NGC6611 | ~1.2–1.7 kpc; the Sagittarius arm |
| `ctx:NAP` | molecular-complex | NGC7000 (+ IC 5070) | ~800 pc; ionized by the Bajamar star (O3.5 III + O8, Comerón & Pasquali 2005; GOSSS) |
| `ctx:CarinaComplex` | molecular-complex | NGC3372 (Tr 14, Tr 16), NGC3293 | ~2.3 kpc; η Car (luminous blue variable) |
| `ctx:UMaMG` | moving-group | (star doc: Mizar, Merak, Phecda, Megrez, Alioth) | ~25 pc; 414 ± 23 Myr (Jones+2015) |
| `ctx:GalacticHalo` | galactic-structure | all globulars | Shapley 1918 used their distribution to locate the Galactic center |
| `ctx:SgrDSph` | host-galaxy | M54 | Sagittarius dwarf (Ibata+1994); M54 sits at its nucleus (Bellazzini+2008) |
| `ctx:LocalGroup` | galaxy-group | M31, M32, M110, M33, LMC, SMC | — |
| `ctx:M81Group` | galaxy-group | M81, M82, NGC2403 | ~3.6 Mpc; HI tidal bridges M81–M82–NGC 3077 (Yun, Ho & Lo 1994) |
| `ctx:LeoTriplet`, `ctx:LeoI` | galaxy-group | M65, M66 / M95, M96, M105 | 80 mm tier |
| `ctx:VirgoCluster` | galaxy-cluster | M49, M84, M86, M87, … | 16.5 Mpc (M87; Tully+2013) |

The engine derives `SIBLING` between all members of the same `ob-association`, `molecular-complex` or `moving-group` (strength 0.8). It derives `NEIGHBOR` (subtype `same-group`) between members of the same `galaxy-group` (0.6).

### 6.2 Relation vocabulary → doc 05 `EdgeType`

| Deep-sky relation (`subtype`) | `EdgeType` | Direction | Example |
|---|---|---|---|
| `ionizes`, `illuminates`, `sculpts` | CAUSE | star → nebula | θ1 Ori C → M42; Bajamar star → NGC 7000; HD 38563 → M78 |
| `cluster-in-nebula` (`formed-from`) | CAUSE | nebula ↔ cluster | M8 ↔ NGC 6530; NGC 2237 ↔ NGC 2244 |
| `same-association`, `same-cloud` | SIBLING | — | M42 ~ NGC 1981 ~ Belt; h ~ χ Persei |
| `older-analog` / `younger-analog` | LIFE_NEXT | young → old | M42 (1 Myr) → NGC 2264 (5 Myr) → M45 (120 Myr) → Hyades (650 Myr) → M67 (4 Gyr) |
| `fate-low-mass` / `fate-high-mass` | LIFE_NEXT | cluster or giant → PN/SNR | Hyades giants → M27; Double Cluster RSGs → Veil/M1 |
| `same-distance-different-age` | CONTRAST (`ageMyr`) | — | M44 (183 pc, ~650 Myr) vs Mel 20 (175 pc, ~60–90 Myr) |
| `same-age-different-distance` | CONTRAST (`distanceLy`) | — | Hyades (47 pc) vs Praesepe (183 pc); M45 (135 pc) vs NGC 1647 (577 pc) |
| `line-of-sight` | **LINE_OF_SIGHT** (new) or CONTRAST + subtype | near → far | Aldebaran/Hyades; M46/NGC 2438; M35/NGC 2158; 47 Tuc/SMC; NGC 362/SMC; Antares/M4 |
| `interacting`, `satellite-of`, `same-group` | NEIGHBOR | — | M81 ↔ M82; M31 ↔ M32/M110; NGC 2403 ↔ M81 |
| `twin` | SAME_FAMILY | — | M10 ↔ M12; M36 ↔ M37 ↔ M38 (same type, different age) |
| `scale-step`, `lookback-step` | SCALE / TIME_MACHINE (derived) | — | Double Cluster (7,500 ly) → M31 (2.5 Mly) |
| `same-process` | SAME_PHYSICS | — | M42 ↔ M8 ↔ NGC 7000 (ionization); M57 ↔ M27 ↔ Helix |

### 6.3 Curated edges (`edges.deep-sky.json`, initial set; reason texts become `curatedReasonKey`)

| from → to | type / subtype | str. | reason (card voice, ≤ 25 words) | sources |
|---|---|---|---|---|
| star:HR1895 → M42 | CAUSE / ionizes | 1.0 | The brightest Trapezium star is hot enough to make the whole cloud glow. | O'Dell 2001 |
| M42 → M43 | SIBLING / same-cloud | 0.9 | Same cloud, a separate bubble lit by a single young star. | ONGC, Menten07 |
| M42 → NGC1981 | LIFE_NEXT / older-analog | 0.8 | Just north, a few-million-year-old cluster that has already blown its gas away. | Brown94 |
| NGC1981 → AST-OrionBelt | SIBLING / same-association | 0.8 | The Belt stars are big siblings from the same Orion OB1 family. | Brown94 |
| M42 → M78 | SIBLING / same-cloud | 0.7 | Across the Orion clouds: here dust reflects light instead of glowing. | — |
| M45 → AST-Hyades | LIFE_NEXT / older-analog | 0.9 | Same kind of family, about five times older: the blue giants are gone and orange giants have appeared. | Stauffer98, Martin18 |
| star:Aldebaran → AST-Hyades | LINE_OF_SIGHT | 1.0 | The bright orange eye is less than half as far away, a foreground star. | star doc, HR23 |
| M45 → NGC1647 | CONTRAST / same-age-different-distance | 0.7 | Pleiades' twin in age, four times farther, so it looks small and faint. | HR24 |
| AST-Hyades → M44 | CONTRAST / same-age-different-distance | 0.8 | Similar age and composition, four times farther: same family portrait, smaller frame. | Martin18, CG20 |
| M44 → M67 | LIFE_NEXT / older-analog | 0.9 | From 0.7 to 4 billion years: M67 is as old as the Sun. | Castro11 |
| M44 ↔ Mel20 | CONTRAST / same-distance-different-age | 0.6 | Same distance, about ten times older: blue sparkle vs white and yellow. | HR24, CG20 |
| M35 → NGC2158 | LINE_OF_SIGHT | 1.0 | Half a degree away but four times farther and ten times older: a faint grainy smudge. | HR24 |
| M47 → M46 | CONTRAST / different distance and age | 0.8 | Bright and sparse vs faint and rich: M46 is three times farther and four times older. | HR24 |
| M46 → NGC2438 (to add) | LINE_OF_SIGHT | 0.9 | The little planetary nebula "in" M46 is not a member; its velocity differs by ~30 km/s. | Kiss08 |
| M36 → M38 → M37 | SAME_FAMILY / age-ladder | 0.8 | Three Auriga clusters: 27, 270, 490 Myr. Watch them get richer and redder. | HR24 |
| NGC2264 → NGC2244 | SIBLING / same-process | 0.7 | Two nurseries in Monoceros; the Rosette's stars have hollowed out their cloud. | HR24 |
| NGC2237 ↔ NGC2244 | CAUSE / cluster-in-nebula | 1.0 | The cluster's O stars light the Rosette and push it outward. | — |
| NGC869 ↔ NGC884 | SIBLING / same-association | 1.0 | Twin clusters, 14 Myr old, 7,500 ly away: Per OB1's heart. | Currie10 |
| NGC869 → M45 | CONTRAST / distance | 0.6 | Comparable families, but 17 times farther. Only giants shine through. | HR24 |
| NGC869 → Mel20 → M34 → NGC752 | LIFE_NEXT / age-ladder | 0.8 | Perseus age ladder: 14 → ~60 → ~120 → 1,400 Myr. | HR24, curated |
| M8 ↔ NGC6530 | CAUSE / cluster-in-nebula | 1.0 | The Lagoon's own newborn cluster; its hottest stars light the gas. | HR24 |
| M8 → M20 → M21 | SIBLING / same-association | 0.7 | Sgr OB1: same arm and same birth episode, different stages. | — |
| M17 → M16 | SAME_PHYSICS / same-process | 0.7 | Two nurseries on the next spiral arm in; the Eagle hides the "Pillars of Creation". | HR24 |
| M24 → M8 | SCALE / window | 0.6 | Through a gap in the dust: thousands of stars on a farther arm. | — |
| star:Antares → M4 | LINE_OF_SIGHT + CONTRAST(age) | 1.0 | 1.3° apart: a ~12 Myr supergiant and a ~12 billion-year globular, 10 times farther. | BV21, star doc |
| NGC6231 → M6 → M7 | LIFE_NEXT / age-ladder | 0.7 | Scorpius tail: 4 → 52 → ~170 Myr. | HR24, HR23 |
| M13 ↔ M92 | CONTRAST / feH + age | 0.9 | Neighbors in Hercules; M92 is poorer in metals and among the oldest objects known (13.8 ± 0.75 Gyr). | H10, Ying23 |
| M10 ↔ M12 | SAME_FAMILY / twin | 0.7 | Twins 3° apart, both ~16,000 ly; compare compactness. | BV21 |
| M54 → ctx:SgrDSph | SIBLING / belongs-to-other-galaxy | 1.0 | This globular came with another galaxy that the Milky Way is swallowing. | Bellazzini08 |
| NGC5139 → M54 | SAME_PHYSICS / former-dwarf-nucleus | 0.8 | ω Cen is likely a stripped dwarf nucleus and hosts an intermediate-mass black hole of at least 8,200 M☉. | Häberle24 |
| NGC104 → SMC; NGC362 → SMC | LINE_OF_SIGHT | 1.0 | Our globular is 4.5 kpc away and the SMC is ~62 kpc: a 14× depth illusion. | BV21 |
| M81 ↔ M82 | NEIGHBOR / interacting | 1.0 | A close pass ~200–300 Myr ago stirred M82 into a starburst. | Yun94, Yun99 |
| M81 → NGC2403 | NEIGHBOR / same-group | 0.5 | Another member of the M81 group. | SIMBAD h_link |
| M31 ↔ M32, M110 | NEIGHBOR / satellite | 0.9 | Two satellite galaxies in the same binocular field. | — |
| M31 → M33 | NEIGHBOR / same-group | 0.8 | Local Group's third spiral, 840 kpc (Cepheids). | Li21, Breuval23 |
| NGC7000 ← star:Bajamar | CAUSE / ionizes | 0.9 | An O3.5 star hidden behind the dust "Gulf of Mexico" powers the whole complex. | Comerón05 |
| M27 → NGC6992/NGC6960 | CONTRAST / fate-low vs high mass | 0.9 | A Sun-like star's gentle death vs a massive star's explosion. | Gaia, Fesen21 |
| M1 → NGC6960 | SAME_FAMILY / snr-age | 0.6 | 970-year-old remnant vs 10–20 kyr old: same kind of object, different age. | Trimble73, Fesen21 |
| AST-Coathanger → any OC | LINE_OF_SIGHT / asterism | 0.8 | Looks like a cluster, but the stars are at very different distances. | Baumgardt98 |

### 6.4 Derived relations (rules for `story-graph.ts`, deep-sky specifics)

- **`LIFE_NEXT` among clusters**: when `ageMyr(b)/ageMyr(a)` is between 3 and 50 and both are `open-cluster` or `embedded-cluster`. Strength = 0.5 + 0.2·[same `contextId` family] + 0.2·[both `showpiece`].
- **`CONTRAST same-distance-different-age`**: when |Δlog distance| < 0.1 and |Δlog age| ≥ 0.7.
- **`CONTRAST same-age-different-distance`**: when |Δlog age| < 0.15 and |Δlog distance| ≥ 0.5.
- **`LINE_OF_SIGHT`** (derived): when the sky separation is < 2° and the distance ratio is ≥ 3, or the separation is < 0.5° with any class difference. Curated edges override.
- **Never derive a `SIBLING` from sky proximity alone.** Use only shared `contextIds`.

---

## 7. Concept stories (deep-sky, by season)

Spans and path lengths were computed from the repo's own coordinates. The path is the shortest permutation with the given first stop. The engine re-orders anyway. "N" means northern mid-latitudes (~40–50° N); "S" means southern. Grades are curator estimates for **10×50 suburban/dark**; review them before shipping. Concept ids follow doc 04.

| # | Season | Title (archetype) | Stops in order (role) | Span / path | 10×50 sub/dark | Core concepts | Twist |
|---|---|---|---|---|---|---|---|
| W1 | Winter N/S | **Orion's family album: a stellar nursery and its older siblings** (A1, A5) | M78 (reflection; Orion B cloud) → AST-OrionBelt (Ori OB1b, ~2–5 Myr supergiants) → NGC1981 (OB1c, ~5 Myr, gas gone) → M42 (OB1d, ~1 Myr, glowing) → M43 (separate bubble) | 6.2° / 7.6° | M78 1/2, Belt 4/4, 1981 3/3, M42 3/4, M43 1/2 | LIFE.nursery, LIFE.cluster-birth, MW.families | The newest stars are in the Sword, not the bright Belt. Ages from Brown+1994 (Gaia now shows a more complex history; say "roughly"). |
| W2 | Winter | **Taurus cluster clock** (A6) | M45 (120 Myr, blue) → AST-Hyades (650–750 Myr, orange giants) → NGC1647 (same age as the Pleiades, 4× farther) | 14.6° / 18.0° | 4/4, 4/4, 2/3 | LIFE.cluster-age, SKY.projection, DIST.light-year | Aldebaran is not a Hyad (star-doc edge). The Pleiades' blue haze is a passing cloud. |
| W3 | Winter | **Three ages of Auriga, plus a stowaway** (A6) | M36 (27 Myr) → M38 (270 Myr) → M37 (490 Myr) → M35 (~150–200 Myr) → NGC2158 (1.9 Gyr, 3.7 kpc) | 14.4° / 17.5° | 2/3, 1/3, 2/3, 3/4, 0/1 | LIFE.cluster-age, STAR.mass-fate | NGC 2158, 0.4° from M35, is 4× farther and 10× older. |
| W4 | Winter | **Monoceros: from cloud to grown-up** (A1) | NGC2264 (5 Myr, in its cloud) → NGC2244/NGC2237 (4 Myr; winds hollow the Rosette) → NGC2232 (13 Myr, no gas) → M50 (144 Myr) → M41 (154 Myr; orange giant in the middle) | 30.7° / 37.7° (monotonic N→S) | 3/3, 3/3 (nebula 0/1), 2/3, 2/3, 3/4 | LIFE.nursery → LIFE.cluster-birth → LIFE.cluster-age | The Rosette nebula is a dark-sky challenge; the cluster is the sure target. |
| W5 | Late winter | **Puppis: same field, different worlds** (A6) | M47 (109 Myr, 470 pc) → M46 (430 Myr, 1.55 kpc) → NGC2438 (PN, not a member) → M93 → NGC2477 (700 Myr, rich) | 24.3° / 25.1° | 3/4, 2/3, 0/0 (photo only), 2/3, 1/3 | SKY.projection, LIFE.cluster-age, LIFE.pn-wd (preview) | Kiss+2008 velocities prove that NGC 2438 is not in M46. |
| S1 | Spring | **Middle age and the Sun's age** (A6, A5) | M48 (~400 Myr) → M67 (~3.9 Gyr, solar metallicity, solar twins) → M44 (~650 Myr, red giants) | 26.6° / 28.4° | 3/4, 2/3, 4/4 | LIFE.cluster-age, STAR.mass-fate | M67 is as old as the Sun. Most clusters dissolve long before that. |
| S2 | Spring (N, circumpolar) | **Galaxies in conversation** (A11) | NGC2403 (M81 group) → M81 (spiral) → M82 (starburst after an encounter) | 13.6° / 14.2° | 0/2, 1/3, 1/2 | GAL.other, TIME.lookback | M82's starburst was triggered by M81. Light left ~12 Myr ago. |
| S3 | S autumn (Mar–May) | **Carina: a monster, a fountain and a corpse-to-be** (A1, A7) | IC2602 (26–46 Myr, 150 pc) → NGC3372 (η Car LBV, Tr 14/16 ~5 Myr) → NGC3293 (15 Myr) → NGC3532 (~240–400 Myr) → NGC4755 (23 Myr, one red supergiant) → NGC5139 (ω Cen, stripped dwarf nucleus) | 27.7° / 37.8° | 4/4, 3/4, 3/3, 4/4, 3/3, 3/4 | LIFE.nursery, STAR.mass-fate, MW.halo | η Car will explode someday; ω Cen may once have been a galaxy. |
| U1 | Summer | **The nursery district of Sagittarius** (A1) | M8 + NGC6530 (~4 Myr) → M20 (emission + reflection + dark) → M21 (~5 Myr) → M24 (window to the next arm) → M17 (~1 Myr, massive) → M16 (NGC 6611 ~2–6 Myr; Pillars) → M23 (226 Myr, contrast) | 11.2° / 19.4° | 3/4, 1/2, 2/3, 3/4, 2/3, 2/3, 3/3 | LIFE.nursery, LIFE.cluster-birth, MW.disk | All of these sit on one spiral arm; M23 shows what they become. |
| U2 | Summer (low N) | **Scorpius: young giants, an ancient neighbor** (A6) | M4 (12 Gyr, 1.85 kpc, beside Antares) → NGC6231 (4 Myr, O stars, Sco OB1) → M6 (52 Myr) → M7 (~170 Myr, 280 pc) | 21.0° / 33.6° | 2/3, 3/4, 3/4, 4/4 | MW.halo vs LIFE.cluster-birth, SKY.projection | Antares (star doc) and M4 share a field yet differ ~1000× in age. M4 hosts the oldest known planet (PSR B1620−26; verify). |
| U3 | Summer | **How Shapley found the galaxy's center** (A11) | M12 → M10 → M14 → M9 → M19 → M62 (globulars crowding toward Sagittarius) | 28.4° / 41.8° | 2/3, 2/3, 1/2, 1/2, 1/3, 2/3 | MW.halo, MW.disk, SCALE.cosmic | Shapley (1918) used this lopsided crowd of globulars to show that the Sun is not at the center. |
| U3b | Summer N | **Ancient twins of Hercules** (A6, short) | M13 (4.8×10⁵ M☉, [Fe/H] −1.53) → M92 (13.8 ± 0.75 Gyr, [Fe/H] −2.31) | 9.5° | 3/4, 2/3 | MW.halo, LIFE.recycling | M92 is nearly as old as the Universe and has fewer heavy elements: it formed from less recycled gas. Pair it with the Hercules stars from the star doc to reach 3+ stops. |
| U4 | Late summer | **Summer Triangle: birth, gentle death, violent death** (A8, A1) | NGC7000 (nursery; Bajamar star) → M29 (6 Myr) → NGC6992 / NGC6960 (Veil SNR, 0.73–0.89 kpc, 10–20 kyr) → M27 (PN, 389 pc) → AST-Coathanger (asterism) | 31.0° / 42.0° | 1/3, 2/3, 0/2, 0/2, 2/3, 4/4 | LIFE.nursery, LIFE.pn-wd, LIFE.supernova, LIFE.recycling | The "cluster" at the end is not a cluster. The Veil needs a dark sky and ideally an OIII filter. |
| U5 | Summer (dark sky) | **Dark rivers: the dust that makes stars** (A11) | Cygnus Rift (MW field) → Barnard's E (B142/143) → Pipe Nebula (B59/B78, ~130–160 pc) | needs new objects (§8) | 7×50 better | MW.disk, LIFE.nursery | The "empty" patches are full of dust, not empty. |
| A1 | Autumn N | **Perseus age ladder** (A6) | NGC869 + NGC884 (14 Myr, RSGs, 2.3 kpc) → Stock2 (~290 Myr, 370 pc) → Mel20 (~60–90 Myr, 175 pc) → M34 (~120–250 Myr) → NGC752 (1.4 Gyr, giants) | 21.8° / 35.4° | 4/4, 3/4, 4/4, 3/4, 2/3 | LIFE.cluster-age, LIGHT.color-temp | Orange points in the Double Cluster are red supergiants, the future of massive stars. |
| A2 | Autumn N | **How far can you see?** (A3, A4) | NGC869 (7,500 ly) → NGC752 (1,400 ly) → M33 (2.7 Mly) → M32 → M31 (2.5 Mly) → M110 | 27.6° / 43.9° | 4/4, 2/3, 0/2, 1/2, 4/4, 1/2 | DIST.light-year, TIME.lookback, GAL.other, SCALE.cosmic | M33 is bigger than the full Moon yet fainter than its magnitude suggests (low surface brightness). |
| A3 | Autumn N | **Cassiopeia: young clusters and an old rose** (A6) | NGC457 (23 Myr) → M103 (47 Myr) → NGC663 → M52 → NGC7789 (1.6 Gyr, 17,800 M☉) | 16.8° / 25.6° | 3/3, 2/3, 2/3, 2/3, 1/3 | LIFE.cluster-age | NGC 7789 is old and rich; the others are young and sparse. |
| A4 | S spring/autumn | **Magellanic depth illusion** (A3) | NGC104 (47 Tuc, 4.5 kpc) → SMC (~62 kpc) → NGC362 (8.8 kpc) → LMC (~50 kpc, Tarantula) | 23.0° / 25.3° | 4/4, 3/4, 2/3, 4/4 | SKY.projection, GAL.other | Two "fuzzy stars" beside a galaxy are 7–14× nearer. |

These cover all four seasons, both hemispheres, and every `LIFE.*`, `MW.*` and `GAL.*` concept. W1, W2, U1, U4 and A1/A2 are the flagship set to hand-polish first.

**Region check.** All spans are ≤ 31° except where noted. W4 and U4 are long but monotonic (no backtracking). U3 and U4 sit at the edge of doc 05's region tolerance. Keep them as curated "long-arc" variants, or split U4 into Cygnus (NGC7000, M29, Veil) and Vulpecula (M27, Coathanger) halves.

---

## 8. Gaps: objects and data to add

### 8.1 Promote existing catalog-only objects (images already bundled; need guide notes and KB records)

P0: **M43, NGC 884, NGC 2158, NGC 6530, NGC 6960, NGC 6992, NGC 7293 (Helix), NGC 2362 (τ CMa cluster, 7 Myr)**.
P1: NGC 2237 (Rosette nebula), NGC 6871, NGC 6888 (wind bubble, challenge), M57, M97 (exists).
P2: the small, stellar-looking PNs (NGC 3242, 6543, 6826, 7009, 7662, 2392). Give them `obsDifficulty 5`; keep them for "how stars die" telescope add-ons, not for binocular journeys.

### 8.2 New objects (need a catalog row, coordinates from SIMBAD, an extent, a DSS2/2MASS cutout and a KB record)

| New id | Object | Why (story) | Data | Image fov |
|---|---|---|---|---|
| `Cr69` | λ Orionis cluster / ring | W1 extension: an older Orion sibling, ~5 Myr | HR24 `Collinder_69` (394 pc, log 6.72, 1,247 members) | 4° |
| `NGC1977` | Running Man (reflection + emission) | W1: reflection vs emission side by side with M42 | SIMBAD; distance = ONC | 1.5° |
| `NGC2438` | PN in front of M46 | W5 line-of-sight twist (photo-only stop) | Gaia central star; Kiss+2008 RV | 1° (share M46 field) |
| `DN-Pipe` | Pipe Nebula (B59, B65–67, B78) | U5; nearest dark cloud complex, ~130–160 pc | Literature (Alves & Franco 2007, verify) | 8° |
| `DN-BarnardE` | Barnard 142/143 | U5; classic binocular dark nebula near γ Aql | SIMBAD | 2° |
| `DN-Coalsack` | Coalsack (S) | S3 extension; ~180–190 pc | Literature (verify) | 7° |
| `MWF-CygnusRift` | Great/Cygnus Rift | U5; dust in the Local Arm | Text only, no distance fact | 15° (DSS2 mosaic fine) |
| `IC1396` + `Tr37` | Elephant's Trunk region (Cep OB2) | Autumn nursery in the north (Cepheus) | HR24 `Trumpler_37` (note: HR24 age 285 Myr is suspicious; literature ~4 Myr → override) | 3° |
| `IC2944` | Running Chicken / λ Cen cluster (S) | Southern nursery for S3 | SIMBAD, literature | 2° |
| `M39` alias fix | NGC 7092 ↔ HR24 `Theia_517` | Crossmatch only | HR24 | exists |

### 8.3 Facts work (the bulk of the effort)

- **About 120 open clusters**: HR24 automatic (distance, N, mass, age range). **About 40 showcase clusters** need a curated literature age with `overrides`.
- **39 globulars**: BV21 + H10 automatic. Ages are curated from VandenBerg+2013 (relative ages) and Ying+2023 (M92).
- **About 12 nebulae**: distance from the embedded cluster, `poweredBy` star ids (θ1 Ori C HR 1895, 9 Sgr for M8 (verify), η Car HR 4210, HD 38563 for M78, Bajamar star outside the BSC).
- **4–8 PNs/SNRs**: Gaia distances; curated ages with ranges.
- **42 galaxies**: NED-D distance, morphology. Interactions are curated for M81/M82, M31 family, M51 (80 mm tier) and the Leo Triplet.
- **Text**: `whySee`, `physics`, `seeText`, `notSeeText` for each journey-eligible object, written fresh. The guide `impression` field is the seed for `seeText`.

### 8.4 Images

- New objects: reuse `script/binocular-media-plan.ts` + `script/download-binocular-media.py` (DSS2 + 2MASS via HiPS2FITS). **CDS was unreachable from this host today**, so run the acquisition where CDS is reachable and commit the JPEGs. For dark nebulae, use wide fields (5–8°). DSS2 color shows them well; 2MASS largely sees through them, which is itself a teaching pair ("dust hides visible light, infrared passes").
- Featured photos: follow the `binocular-featured-images.json` pattern. Use Wikimedia Commons files only with a verified license (CC BY, CC BY-SA or public domain such as NASA/ESA/ESO). Record credit, license URL and source.
- Cheap, license-free and very effective: **generate SVG fact graphics at runtime** from KB numbers: an age bar on a log scale with "you are here", and a distance bar. They need no images and work offline.
- Budget: ~15 new objects × 2 cutouts × ~70 KB ≈ 2 MB extra precache. That is acceptable next to the current 38 MB.

---

## 9. Build pipeline, files, validation

```
data-src/sky-journeys/
  deep-sky.json            curated records (§3), CC BY-SA 4.0
  context-nodes.json       §6.1
  edges.deep-sky.json      §6.3
  sources.json             registry (shared with the star doc)
  snapshots/
    hr24-subset.tsv  cg20-subset.tsv  baumgardt-combined.txt  harris-mwgc.dat
    openngc-NGC.csv@be3cd6c  simbad-distances.csv  ned-distances.csv   (+ SHA256SUMS, RETRIEVED.md)
script/kb/
  fetch-deep-sky-snapshots.py   network step, run manually; uses the IDIA VizieR + Harvard SIMBAD mirrors as fallbacks
  build-deep-sky.py             offline; stdlib only (like import-catalog-extents.py); applies §4.3 precedence,
                                derives sizeLy, converts pc→ly, emits provenance; fails on any rule below
client/public/data/journeys/objects.json, edges.json   compiled output (doc 05 contract); precached by the existing manifest
```

Validator (vitest, `client/src/lib/__tests__/kb-deep-sky.test.ts`), which runs on the compiled JSON:
1. Every `id` resolves to a `UnifiedTarget` (or appears in the "new objects" list together with a catalog row). Every `imageIds` path exists in the build manifest.
2. Every `Fact` has a `sourceId` in `sources.json`, with `lo ≤ value ≤ hi` and the expected unit for its key.
3. Journey-eligible means `provenance.status ≥ curated`, `view.basis == 'curator'`, ≥ 1 `teaches`, ≥ 1 sourced numeric fact and non-empty `seeText`/`notSeeText` (doc 05 gate).
4. Physics sanity checks:
   - globulars have `ageMyr ≥ 8000`; `embedded-cluster` has `ageMyr ≤ 10`;
   - `planetary-nebula` has `ageMyr ≤ 0.1`; galaxies have `distanceLy ≥ 1.5e5`;
   - an H II region has `poweredBy.kind == 'ionizing-stars'`; a dark nebula has `resolves == 'silhouette'`;
   - `asterism` teaches `SKY.projection`; `LINE_OF_SIGHT` edges need both distances with a ratio ≥ 2.
5. Showcase clusters (`showpiece && class in [open-cluster, embedded-cluster]`) must have `ageMyr.method != 'nn-isochrone'` (a curated override exists).
6. Edge endpoints exist, every curated edge has a reason, and there are no self-loops.
7. Snapshot SHA-256 values match `SHA256SUMS` (in `build-deep-sky.py`, not vitest).

Size: ~250 deep-sky records × ~1.6 KB ≈ 400 KB JSON (≈ 80 KB gzip). That is fine for a worker-side lazy fetch.

---

## 10. Sources cited

Catalogs:
- Hunt & Reffert 2023, A&A 673, A114 (VizieR `J/A+A/673/A114`).
- Hunt & Reffert 2024, A&A 686, A42 (`J/A+A/686/A42`).
- Cantat-Gaudin et al. 2020, A&A 640, A1 (`J/A+A/640/A1`).
- Harris 1996, AJ 112, 1487 (2010 edition): https://physics.mcmaster.ca/~harris/mwgc.dat
- Baumgardt & Vasiliev 2021, MNRAS 505, 5957: https://people.smp.uq.edu.au/HolgerBaumgardt/globular/
- OpenNGC (Verga et al.), commit `be3cd6c`, CC BY-SA 4.0.
- SIMBAD (Wenger et al. 2000), TAP at https://simbad.harvard.edu/simbad/sim-tap.
- NED-D: https://ned.ipac.caltech.edu/
- González-Santamaría et al. 2021, A&A 656, A51 (PN central stars, Gaia EDR3).

Papers:
- Brown, de Geus & de Zeeuw 1994, A&A 289, 101 (Ori OB1 subgroup ages) — ages as reported in secondary sources, e.g. https://en.wikipedia.org/wiki/Orion_OB1 and https://arxiv.org/pdf/astro-ph/0410494
- Menten et al. 2007, A&A 474, 515 (ONC 414 ± 7 pc); Kounkel et al. 2017, ApJ 834, 142 (388 ± 5 pc); Zucker et al. 2020, A&A 633, A51 (dust distances, 433 pc for M42 via SIMBAD).
- Hillenbrand 1997, AJ 113, 1733 (ONC age < 1 Myr); O'Dell 2001, ARA&A 39, 99 (Orion Nebula, θ1 Ori C).
- Stauffer et al. 1998, ApJ 499, L199 (Pleiades LDB 125–130 Myr): https://arxiv.org/pdf/astro-ph/9804005 ; Jeffries & Naylor 2000: https://arxiv.org/pdf/astro-ph/0009179
- Pleiades nebulosity is an unrelated cloud passing at ~11 km/s: https://en.wikipedia.org/wiki/NGC_1435 and https://spaceflightnow.com/news/n0311/12collision/ (White 2003, ApJS).
- Martín et al. 2018, ApJ 856, 40 (Hyades LDB 650 ± 70 Myr): https://arxiv.org/pdf/1802.07155 ; Brandt & Huang 2015, ApJ 807, 58 (750 ± 100 Myr).
- Currie et al. 2010, ApJS 186, 191 (h & χ Per, 14 Myr): https://arxiv.org/abs/0911.5514
- Castro et al. 2011, A&A 526, A17 (M67 3.87 Gyr, solar twins): https://arxiv.org/pdf/1011.1276
- Kiss et al. 2008, MNRAS 391, 399 (NGC 2438 not a member of M46): https://arxiv.org/abs/0809.0327
- Yun, Ho & Lo 1994, Nature 372, 530 (M81 group HI) and Yun 1999 (encounter timing ~220 Myr); summary: https://arxiv.org/pdf/0711.2685
- Häberle et al. 2024, Nature 631, 285 (ω Cen IMBH ≥ 8,200 M☉): https://www.mpia.de/news/science/2024-10-omega-cen-imbh
- Ibata, Gilmore & Irwin 1994, Nature 370, 194; Bellazzini et al. 2008, AJ 136, 1147 (M54 and the Sgr dSph nucleus): https://arxiv.org/abs/0807.0105v1
- Ying et al. 2023, AJ 166, 18 (M92 13.80 ± 0.75 Gyr): https://arxiv.org/pdf/2306.02180
- Comerón & Pasquali 2005, A&A 430, 541 (NAP ionizing star); GOSSS/Villafranca: O3.5 III(f*) + O8: https://arxiv.org/pdf/2009.05773 ; NAP distance with Gaia EDR3: https://ar5iv.labs.arxiv.org/html/2012.05074
- Fesen et al. 2021 (Cygnus Loop 725 ± 15 pc; later contested, ~890 pc also proposed): https://arxiv.org/pdf/2109.05368 ; https://arxiv.org/pdf/2401.00960
- Jones et al. 2015, ApJ 813, 58 (UMa moving group 414 ± 23 Myr): https://ar5iv.arxiv.org/html/1508.05643
- Baumgardt 1998, A&A 340, 402 (Cr 399 not a cluster): https://en.wikipedia.org/wiki/Brocchi%27s_Cluster
- Li et al. 2021, ApJ 920, 84 (M31 761 ± 11 kpc); Breuval et al. 2023, ApJ 951, 118 (M33 840 kpc) — both via SIMBAD `mesDistance` (§5.3).
- Trimble 1973, PASP 85, 579 (Crab ~2 kpc); Shapley 1918, ApJ 48, 154 (globular distribution).

Marked "verify": not checked against the primary paper in this session. The curator must confirm these before they reach a card: VandenBerg+2013 per-cluster ages, the IC 2602 LDB age, Upper Sco age, 9 Sgr as the main ionizer of M8, HD 38563 for M78, Pipe and Coalsack distances, PN expansion ages, PSR B1620−26, and Trumpler 37's age.
