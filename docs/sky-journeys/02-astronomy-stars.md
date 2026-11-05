# 02 — The star half of the Sky Journeys knowledge base

Author role: stellar astrophysicist / observing astronomer. Status: design, phase 1 (no code or data changed).
Sibling docs: `01-codebase-map.md`, `04-pedagogy-and-journey-criteria.md` (concept IDs, pedagogy fields), `05-journey-engine-design.md` (engine contract `JourneyObject`), `06-ux-design.md`. The deep-sky half lives in a separate doc.

---

## 0. Decisions on one page

| # | Decision | Why |
|---|---|---|
| S1 | **Build a separate star KB (`stars.kb.json`, about 320 records) offline with a Python build script.** Do not enrich `bsc5-short.json` in place. The app joins the two by `hr` (or carries its own coordinates for non-BSC stars). | `bsc5-short.json` is the routing catalog (9,096 stars, 954 KB) and has to stay small and stable. The physics belongs in a curated, provenance-heavy layer. |
| S2 | **Use two tiers of facts: a *catalog* tier (automatic, every record) and a *curated* tier (reviewed by hand, overrides the catalog tier).** Every numeric fact is a `FactValue {value, lo, hi, unit, sourceId, method}`, the same type as engine doc §4. | Automatic data is badly wrong for exactly the stars we care most about: supergiants, Miras and very bright stars (see §4.6). Curated values have to win, and the reason has to be visible. |
| S3 | **The bulk pipeline uses SIMBAD TAP, the Gaia archive (Hipparcos 2007 plus Gaia DR3), VizieR (BSC5 V/50, GCVS, VSX, WDS, JMDC/JSDC) and the NASA Exoplanet Archive. Every query is tested from this machine (§4).** Use the *Harvard SIMBAD mirror* and the *IDIA VizieR mirror*: the main CDS hosts (`*.cds.unistra.fr`, 130.79.x) time out from this machine. | This reproduces the build, and the queries are pasted below verbatim. |
| S4 | **Distance policy.** Use literature values for supergiants, Miras and stars with V ≤ 2. Use Hipparcos 2007 for V < 5.5. Use Gaia DR3 for V ≥ 5.5 only when RUWE < 1.4 and σϖ/ϖ < 0.1. Otherwise mark the distance "uncertain" and never print it to 3 significant figures. | Gaia saturates on bright stars. In our sample queries μ Cep gives ϖ = 0.12 ± 0.26 mas (RUWE 3.1), and naive 1/ϖ puts RW Cep at 8.8 kpc and VY CMa at 2.4 kpc (VY CMa's maser parallax gives 1.2 kpc). |
| S5 | **Select about 320 stars in three layers:** (a) all 173 BSC stars with V ≤ 3.0, as landmarks and story anchors; (b) about 150 hand-curated "binocular showcase" stars, many fainter than V = 3 and about 35 not in the BSC at all; (c) optionally, an automatic "physics stub" for every other BSC star, used by the star inspector and not by journeys. | Every journey needs bright anchors. The wonder lives in the curated layer: carbon stars, Miras, wide doubles, red dwarfs, a black-hole binary, the oldest star in the binocular sky. |
| S6 | **Multiplicity is stored as physical data (separation, PA, magnitudes, physical or optical). "Splittable" is computed at runtime from the user's magnification and mount.** | The same pair is "easy" at 15×70 on a tripod and "impossible" at 7×35 hand-held. |
| S7 | **Star images are mostly generated in the app.** They are a color swatch from Teff, an HR-diagram dot over a real HR diagram of about 8,700 naked-eye stars, a size-comparison drawing, a schematic light curve with live Algol minima, and a binocular-field view of the pair. Real photos are limited to about 12 iconic, verified CC BY 4.0 or public-domain research images (ESO/ESA/NASA), plus the existing DSS2 field cutouts. | Stars are points. Photos of points teach nothing, while an HR-diagram position teaches a lot. The offline budget matters too: 558 existing images already take 38 MB. |
| S8 | **Each star carries `teaches` with concept IDs from doc 04, plus a finer star vocabulary (§2.4) that maps onto those IDs.** It also carries `superlatives` with explicit scope, `misconceptions`, and curated `links` (story edges with a reason). | The engine (doc 05) derives CONTRAST/SCALE edges from the facts. The best star stories (Aldebaran in front of the Hyades, AE Aur fleeing Orion) must be authored. |
| S9 | **Event-dependent stars are flagged `volatile`:** T CrB (expected recurrent nova), R CrB (fadings), Betelgeuse (dimming), ε Aur (next eclipse 2036–38), Mira and other LPVs. Cards for these must never state current brightness. They state the range and link to AAVSO. | As of late August 2026, coverage still described T CrB's eruption as pending ([Star Walk](https://starwalk.space/ay/en/tcrb), [S&T](https://skyandtelescope.org/astronomy-blogs/stargazing-why-we-look-up/waiting-for-the-blaze-star/)). The data ships offline and goes stale. |

---

## 1. What exists today (inventory)

### 1.1 `client/public/data/bsc5-short.json` (9,096 records, 954 KB)

- Fields and counts: `HR` 9096, `RA` 9096 (sexagesimal string), `Dec` 9096, `V` 9096 (string), `K` 9095, `C` constellation 3144, `F` Flamsteed 2554, `B` Bayer letter 1564 (Greek with superscripts, e.g. `β¹`), `N` proper name 340, `magnitudeNote` 1 (T CrB, set to quiescent V = 10.0 on purpose).
- The format matches `brettonw/YaleBrightStarCatalog`'s `bsc5-short.json`. The repo records no provenance for this file. **Gap:** add a CREDITS entry when the KB lands.
- **`K` is not a measured temperature.** It is a coarse value looked up from spectral type. Betelgeuse has `K = 3350` (measured ≈ 3,600–3,650 K, see §4.2), Sirius `K = 9750` (measured ≈ 9,800–9,900 K), Mira `K = 2450`. It is good enough for display color (`stellar-appearance.ts → stellarColor()`). **The KB must never present `K` as Teff on a card.**
- There is no B−V, spectral type, parallax, multiplicity or variability. The full BSC5 (VizieR V/50) has all of these. The sample in §4.3 shows it is reachable.
- Name resolution (`astronomy.ts → loadStars`):
  - `name = s.N || majorStarNamesFor('HR…')[0]`, where `MAJOR_STAR_NAMES` is a 23-entry fallback map.
  - `stellar-search.ts → starSearchAliases()` adds `HRnnnn`, Bayer + constellation abbreviation and genitive, and Flamsteed + constellation.
  - There is a special case for "Shedir".
  - The 340 `N` names include a few duplicates for components (two `Mizar`, two `Castor`, two `Alnitak`) and IAU-WGSN exoplanet-host names such as "Cervantes" and "Helvetios".
- `stars-dense.json` (1.07 MB) is a bare `[ra, dec, V, B−V]` tuple list for background stars. It has no IDs, so it cannot carry facts.

### 1.2 `client/public/data/binocular-catalog.json` (187 objects)

- There are 16 `STAR-*` and 27 `DS-*` entries.
- **The 16 `STAR` entries are:** Algol, Mira, Betelgeuse, Aldebaran, Arcturus, Antares, Rasalgethi, μ Cep (Garnet Star), Capella, Sirius, Procyon, Vega, Deneb, Fomalhaut, Alphard and La Superba (Y CVn).
  - Eight of them have a placeholder `desc` ("Named star; coordinates and reference magnitude from the included Bright Star Catalogue…").
  - None has physical data.
- **The 27 `DS` entries carry `mag`, `mag2` and `sep` (arcsec):** Albireo, Mizar & Alcor, Almach, ε Lyr, 61 Cyg, Cor Caroli, 16/17 Dra, ν Dra, α Cap, θ Tau, α Lib, 56 And, δ Cep, ι Cas, 15 Mon, β Mon, 100 Her, ω Sgr, ο Cep, γ Ari, Winnecke 4 (M40), σ Cas, η Cas, ψ Dra, 39 Dra, 14 Ari and ν Gem.
  - Several are close pairs (2.6″–9.8″) that are explicitly "telescope only".
  - There is no physical-vs-optical flag and no PA.
- Each of these 43 has DSS2 + 2MASS cutouts (3.7° field, `binocular-media.json`) and a Tycho-2 finder field (`finder-stars/`).

### 1.3 `client/src/lib/binocular-guide-extra.json` (179 entries)

- Families: `star` 8, `double` 6, and the rest deep-sky. The fields are `level`, `equipment`, `impression`, `finding`, `minAperture`, `references` and `variable`.
- These are good observing prose with real references (O'Meara's *Deep-Sky Companions* index pages, Tonkin's BinocularSky newsletters, S&T).
- **Reuse:** `impression` becomes the seed for `seeText`, and `finding` stays the finding text. The physics is new.
- More star guides are hard-coded in `binocular-guide.ts` (Algol, Mira, Betelgeuse, Antares, Rasalgethi, μ Cep), with `variable: true`.

### 1.4 What the app can already render (reuse, don't rebuild)

- `stellarColor(teff, bv)`: a Planck-ratio display color (Ballesteros 2012 B−V→T).
- `binocular-assessment.ts`: double-star split rating (engine doc 05 makes it the source of truth for binocular feasibility). The KB has to feed it `sep`, `mag`, `mag2` and the physical flag.
- The optical field preview and finder charts (`optical-star-field.ts`, `finder-fields.json`, `finder-stars/*.json`).
- **New faint targets (for example Barnard's Star and HD 189733) need new Tycho-2 finder fields.** The existing `script/download-finder-stars.py` points at `vizier.cds.unistra.fr`, which is unreachable from this machine. Switch the host to `vizier.idia.ac.za` (§4.3).

### 1.5 Gap summary

Of the 243 existing star-ish objects (16 STAR + 27 DS + 200 BSC anchors), **none** has spectral type, Teff (except the coarse K), distance, luminosity, radius, mass, age, evolutionary stage, variability parameters, group membership or teaching tags. All of it has to be built.

---

## 2. Per-star record schema

### 2.1 Design rules

1. **One record per *story object*, not per catalog component.**
   - Mizar & Alcor is one record, with components inside.
   - Albireo is one record. Its debated physical status is a property of that record.
   - When a component deserves its own stop, it gets its own record and a `partOf` link. Example: 16 Cyg B (planet host) inside the 16 Cyg pair.
2. **Every number is a `FactValue`.** It has value, range, unit, `sourceId` and `method`, where `method` is one of `measured | literature | derived | model | catalog-lookup`. Cards must not show a `derived` or `model` value with more than 2 significant figures.
3. **IDs:**
   - Existing catalog objects keep their `UnifiedTarget.id` (`STAR-Betelgeuse`, `DS-Albireo`).
   - New BSC stars use `star:HR2061`.
   - Non-BSC stars use `star:HD95735`, or `star:GJ699` for stars with no HD number (Barnard's is HD-less).
   - `aliases[]` holds the SIMBAD main_id, HR, HD, HIP, Gaia DR3, Bayer/Flamsteed and proper names. One record maps to exactly one engine `JourneyObject`.
4. **Positions:**
   - BSC stars take RA/Dec from `bsc5-short.json` by `hr`, so there is a single source of truth for charts.
   - Non-BSC stars carry ICRS J2000 `ra`, `dec`, `pmRA`, `pmDec` (mas/yr) and an epoch. **The app must apply proper motion for stars above 1″/yr.** Barnard's Star has moved ≈ 4.5′ since J2000 (10.36″/yr × 26 yr). That is small against a binocular field, but it visibly shifts a finder-chart mark.

### 2.2 TypeScript shape (KB file view; the engine projects this to `JourneyObject`)

```ts
// client/src/lib/journeys/star-kb.ts (types only; data in client/public/data/journeys/stars.kb.json)
export type FactMethod = 'measured' | 'literature' | 'derived' | 'model' | 'catalog-lookup';
export interface FactValue { value: number; lo?: number; hi?: number; unit: string; sourceId: string; method: FactMethod; note?: string }

export type EvolutionaryStage =
  | 'pre-main-sequence' | 'zams' | 'main-sequence' | 'terminal-main-sequence' | 'subgiant'
  | 'red-giant-branch' | 'red-clump' | 'horizontal-branch' | 'early-agb' | 'tp-agb'   // tp-agb = Miras, carbon & S stars
  | 'post-agb' | 'blue-supergiant' | 'yellow-supergiant' | 'yellow-hypergiant' | 'red-supergiant'
  | 'lbv' | 'wolf-rayet' | 'white-dwarf' | 'binary-interacting' | 'compact-companion-host';   // e.g. Cyg X-1 donor

export type VariabilityClass =   // GCVS/VSX type families, coarse for teaching
  | 'eclipsing-algol' | 'eclipsing-beta-lyrae' | 'eclipsing-long-period' | 'cepheid' | 'rr-lyrae' | 'delta-scuti'
  | 'beta-cephei' | 'mira' | 'semiregular' | 'irregular' | 'rv-tauri' | 'gamma-cas-be' | 'r-crb' | 'recurrent-nova'
  | 'dwarf-nova' | 'alpha2-cvn' | 'lbv' | 'yellow-hypergiant' | 'young-stellar-object' | 'rotational' | 'none-detectable';

export interface StarComponent {
  label: string;            // "A", "B", "Aa", per WDS component naming
  spType?: string; vMag?: number; massMsun?: FactValue;
  notes?: string;           // "white dwarf, 9.5 mag", "red dwarf flare star"
}
export interface PairMeasure {   // one WDS pair line, filtered (§4.5)
  pair: string;             // "AB", "AC", "Aa,Ab"
  sepArcsec: number; paDeg: number; epoch: number;     // last WDS measure
  magPrimary: number; magSecondary: number;
  physical: 'bound' | 'common-proper-motion' | 'optical' | 'debated' | 'unknown';
  orbitPeriodYr?: FactValue;
  sourceId: string;         // "wds:19307+2758:STFA43"
}

export interface StarRecord {
  id: string; kind: 'star' | 'double' | 'variable';   // engine ObjectKind
  name: string; aliases: string[];
  hr?: number; hd?: number; hip?: number; gaiaDr3?: string; simbadMainId: string;
  ra?: number; dec?: number; pmRA?: number; pmDec?: number; epoch?: number;   // only if not in BSC
  constellation: string;
  vMag: FactValue;                      // reference V; for variables = max-light or mean, see variability
  bv?: FactValue;                       // B−V, for color perception
  spType: { text: string; class: string; subclass?: number; lumClass?: string; peculiarity?: string; sourceId: string };
  teffK?: FactValue; distancePc?: FactValue;        // distanceLy is derived for the engine
  lumLsun?: FactValue; radiusRsun?: FactValue; massMsun?: FactValue; ageMyr?: FactValue;
  metallicityFeH?: FactValue; vsiniKms?: FactValue; angularDiameterMas?: FactValue;
  evolutionaryStage: EvolutionaryStage; stageConfidence: 'established' | 'likely' | 'debated';
  variability?: {
    class: VariabilityClass; gcvsType: string;       // raw GCVS/VSX code e.g. "SRC", "EA/SD", "M"
    vMax: number; vMin: number; band: 'V' | 'p' | 'Hp';
    periodDays?: FactValue; epochJD?: number;        // epoch only when useful for predictions (Algol)
    binocularVisibleAtMin: boolean;                  // vMin ≤ 9.0
    volatile: boolean;                               // current state cannot be inferred offline
    sourceId: string;
  };
  multiplicity?: { components: StarComponent[]; pairs: PairMeasure[]; systemNote?: string };
  membership?: { group: string; groupId: string; role?: 'member' | 'probable' | 'foreground' | 'background' | 'escaped-runaway'; sourceId: string }[];
  kinematics?: { population: 'thin-disk' | 'thick-disk' | 'halo'; spaceVelocityKms?: number; runawayFrom?: string; sourceId: string };
  exoplanets?: { count: number; firstDiscoveryYear: number; method: string; status: 'confirmed' | 'disputed'; note?: string; sourceId: string };
  // pedagogy (doc 04 §2.4) ---------------------------------------------------
  teaches: { conceptId: string; strength: 1 | 2 | 3 }[];   // doc 04 concept IDs, plus §2.4 star concepts
  roles: string[];                 // doc 04 roles: 'main-sequence','giant','supergiant','wd','variable','double','association'
  superlatives: { claim: string; scope: string; sourceId: string }[];
  misconceptions: string[];        // MC1..MC15 (doc 04 §6.5)
  links: { to: string; type: 'SIBLING'|'CAUSE'|'CONTRAST'|'LIFE_NEXT'|'NEIGHBOR'|'SAME_PHYSICS'; text: string; sourceId?: string }[];
  seeText: string;                 // honest binocular impression (≤ 40 words)
  lookFor: string[];               // concrete things to notice: "orange vs blue-white", "compare with γ Ori"
  understandText: string;          // ≤ 110 words, 1 concept (doc 04 §6.1)
  historyHook?: { text: string; sourceId: string };
  wow: 1|2|3|4|5; insight: 1|2|3|4|5; obsDifficulty: 1|2|3|4|5;
  visual: { colorHex: string; hrPoint?: { bv: number; absMagV: number }; sizeDiagram: boolean; lightCurve: boolean; imageIds: string[] };
  provenance: { builtAt: string; pipelineVersion: string; curatedBy?: string; reviewedAt?: string; overrides: string[] };  // overrides = fields where curated beat catalog
}
export interface SourceRef { id: string; kind: 'catalog'|'paper'|'web'|'book'; citation: string; url?: string; bibcode?: string; license?: string }
```

`sources.json` is a shared registry, for example `{"id":"joyce2020","kind":"paper","citation":"Joyce et al. 2020, ApJ 902, 63","bibcode":"2020ApJ...902...63J"}`. The DSO half should share the same registry.

### 2.3 Mapping to the engine and pedagogy fields (two inconsistencies to resolve)

Doc 05 expects `stage: LifeStage 0..6`. Doc 04 expects `evoStage 0..8`. These are different scales; **the orchestrator should pick one**. My mapping for stars covers both:

| `evolutionaryStage` | doc 05 `LifeStage` | doc 04 `evoStage` | doc 04 `roles` |
|---|---|---|---|
| pre-main-sequence | 1 | 1 | — |
| zams, main-sequence, terminal-main-sequence | 2 | 2 or 3 (by age; ≤ 200 Myr → 2) | main-sequence |
| subgiant, red-giant-branch, red-clump, horizontal-branch | 3 | 5 | giant |
| early-agb, tp-agb, post-agb, red/yellow/blue-supergiant, yellow-hypergiant, lbv, wolf-rayet | 4 | 5 (6 for "SN-imminent": none of ours is imminent in human terms; see MC6) | supergiant / giant |
| white-dwarf | 5 | 7 | wd |
| compact-companion-host (Cyg X-1) | 4 for the visible star; story edge `CAUSE` to a remnant concept | 5 | supergiant |

The facts projection into doc 05 is as follows:

- `distanceLy = distancePc × 3.26156`, with the range carried through.
- `teffK`, `radiusRsun`, `massMsun`, `lumLsun` and `ageMyr` map directly.
- `periodDays` comes from `variability.periodDays`.

### 2.4 Star concept vocabulary (children of doc 04 concept IDs)

Doc 04's concepts are deliberately coarse. Stars need finer hooks to make stories that differ from one another. Each fine concept declares its parent, so the scorer can compute Jaccard on "concept plus parent" (doc 04 F2).

| Fine concept ID | Parent (doc 04) | Big idea (card-ready) | Best binocular evidence |
|---|---|---|---|
| `STAR.spectral-sequence` | `LIGHT.color-temp` | OBAFGKM is a temperature sequence; spectra reveal composition. | Rigel → Sirius → Procyon → Capella → Arcturus → Betelgeuse |
| `STAR.luminosity-class` | `STAR.size` | Same temperature can mean dwarf or giant; the spectrum's line widths tell which. | Aldebaran (K5 III) vs 61 Cyg A (K5 V): same color, 400× different size |
| `STAR.mass-luminosity` | `STAR.mass-fate` | Twice the mass → ~10× the light → much shorter life. | Vega vs the Sun; Sirius A vs Sirius B story |
| `STAR.rotation` | `STAR.fusion` | Some stars spin so fast they are squashed and have hot poles, cool equators. | Altair, Vega (pole-on), Regulus, Achernar |
| `STAR.be-disk` | `STAR.rotation` | Spinning hot stars can throw off a gas disk that flickers in brightness. | γ Cas, Pleione, ζ Tau, δ Sco |
| `STAR.red-clump` | `LIFE.giant` | After the giant phase, stars settle down burning helium. They pile up at one luminosity. | Hyades giants (γ, δ¹, ε, θ¹ Tau), Capella Aa |
| `STAR.agb-massloss` | `LIFE.giant` | Old giants pulse, cool and lose mass in winds that will become planetary nebulae. | Mira, R Leo, χ Cyg, g Her |
| `STAR.carbon-dredge-up` | `LIFE.recycling` | In late giants, newly made carbon is dredged to the surface; soot makes them deep red. | La Superba, R Lep, V Aql, T Lyr, 19 Psc, W Ori |
| `STAR.s-process` | `LIFE.recycling` | Some giants show technetium, an element with no stable isotope, so it was made inside the star. | χ Cyg (S star) |
| `STAR.supergiant-fate` | `LIFE.supernova` | Stars over ~8 Msun end as core-collapse supernovae. | Betelgeuse, Antares, Rigel, Deneb, μ Cep |
| `STAR.white-dwarf` | `LIFE.pn-wd` | The Sun's fate: an Earth-sized ember of carbon and oxygen. | Sirius B (story), 40 Eri B (challenge), Procyon B (story) |
| `STAR.black-hole-binary` | `LIFE.supernova` | A visible blue supergiant orbits an invisible 21-solar-mass black hole. | HDE 226868 = Cyg X-1 (V 8.9) |
| `STAR.mass-transfer` | `VAR.eclipsing` | In close pairs, one star can steal the other's gas, which turns evolution upside down. | Algol (Algol paradox), β Lyr |
| `VAR.mira` | `VAR.pulsating` | Some cool giants brighten and fade by 100–1000× over about a year. | Mira, χ Cyg, R Leo, R Hya |
| `VAR.cepheid` | `DIST.standard-candle` | The pulsation period gives true brightness, which makes a cosmic yardstick. | δ Cep, η Aql, ζ Gem, Polaris (low amplitude) |
| `VAR.rr-lyrae` | `DIST.standard-candle` | Old, low-mass pulsators found in globular clusters measure the halo. | RR Lyr (V 7.1–8.1) |
| `VAR.dust-fading` | `VAR.pulsating` (sibling) | A star can vanish behind soot it just puffed out. | R CrB; Betelgeuse 2019–20 |
| `VAR.nova` | `MULT.doubles` | A white dwarf piling up stolen hydrogen detonates its surface, again and again. | T CrB (expected), RS Oph (story) |
| `KIN.moving-group` | `MW.families` | Stars born together still drift together across the sky. | Ursa Major group, Hyades, Sco-Cen |
| `KIN.runaway` | `MW.families` | Stars ejected from their birth cluster by a supernova or a close encounter. | AE Aur, μ Col, ζ Oph |
| `KIN.halo-star` | `MW.halo` | Some passing stars belong to the Galaxy's ancient halo: old, metal-poor, fast. | HD 140283, Groombridge 1830, Arcturus (thick disk) |
| `KIN.proper-motion` | `DIST.light-year` | Nearby stars visibly move over human lifetimes. | Barnard's Star, 61 Cyg, Groombridge 1830 |
| `NEAR.neighborhood` | `DIST.light-year` | The nearest stars are mostly dim red dwarfs you cannot see without optics. | Lalande 21185, Lacaille 8760, Lacaille 9352, Groombridge 34 |
| `PLAN.host` | `LIFE.recycling` | Planets are common; some hosts are visible in binoculars. | 51 Peg, HD 209458, HD 189733, υ And, τ Boo |
| `PLAN.debris-disk` | `PLAN.host` | Dusty belts like our Kuiper belt surround young nearby stars. | Fomalhaut, Vega, ε Eri |
| `PLAN.solar-twin` | `STAR.fusion` | Stars almost identical to the Sun show us our Sun from outside. | 18 Sco, 16 Cyg A/B, α Cen A, β CVn |
| `PERC.purkinje` | `PERC.night-eyes` | Red stars look brighter the longer you stare; estimating red variables is tricky. | Mira, R Lep, μ Cep |
| `OBS.extinction` | `MW.disk` | Dust between us and a star dims and reddens it. | μ Cep, VY CMa, HDE 226868 |

---

## 3. Selection: which stars (about 320)

### 3.1 Layers and rules

| Layer | Rule | Count | Fact depth |
|---|---|---|---|
| A. Landmarks | every BSC star with V ≤ 3.0 | 173 (130 at Dec > −40°) | catalog tier automatic, plus curated `teaches` and `seeText` for all of them, and full curated physics for about 70 |
| B. Binocular showcase | hand list (§3.2), from V ≈ −1.5 to V ≈ 9.6 | ≈ 150 (≈ 115 not in layer A) | full curated |
| C. Physics stubs (optional, inspector only) | all other BSC stars | ≈ 8,800 | automatic only (SpT, distance, B−V, M_V, variability code); about 450 KB; no `teaches`; journey-ineligible |

The net is about 290–320 journey-eligible stars. That matches the engine's 400–600-object KB once the deep-sky half is added.

**Inclusion criteria for layer B.** A star needs at least one of the following, *and* it must be a binocular-visible observation (V_max ≤ 9.0 with 50 mm, or ≤ 9.6 with a "challenge" flag):

- (i) it is a textbook example of a fine concept in §2.4;
- (ii) it holds a defensible superlative with a scope;
- (iii) it gives a striking color or double in binoculars;
- (iv) it has a story link to a nearby DSO or star.

**Excluded on purpose:**

- Close doubles that only a telescope splits are excluded *as doubles*. Keep the star if its physics is good (Castor, γ Ari).
- Stars that are only "interesting in papers" are excluded when there is nothing to see (Wolf 359, Proxima).
- Far-southern showpieces stay in, but they surface only where they rise: α Cen, η Car, ζ Pup, γ² Vel, β Pic, ε Ind, Achernar, Canopus.

### 3.2 Layer B, curated list by role

Each name was resolved in SIMBAD for this doc (query in §4.2): the identifier exists and the V shown is SIMBAD's reference value. For variables that value is a snapshot, so use the GCVS range instead.

**Supergiants, hypergiants and the biggest stars**

- Betelgeuse, Antares, Rigel, Deneb, Canopus, Polaris, Mirfak, Wezen (δ CMa), Aludra (η CMa), Sadr (γ Cyg), Enif, Alnilam, Alnitak, Mintaka.
- μ Cep (Garnet Star).
- VV Cep (M2 Iab + B, V 4.9, eclipsing every 20.3 yr).
- ρ Cas (yellow hypergiant, V 4.6).
- 6 Cas.
- P Cyg (LBV, V 4.8, 1600 eruption).
- RW Cep (K/M hypergiant, V ≈ 6.7; 2022–23 "great dimming").
- VY CMa (V ≈ 7–9.6; one of the largest known stars, R ≈ 1,420 R☉, [Wittkowski 2012, A&A 540, L12]).
- ζ¹ Sco (in NGC 6231).
- ε Aur (F supergiant with a 27.1-yr dusty-disk eclipse).
- HDE 226868 (Cyg X-1 donor, O9.7 Iab, V 8.9).
- σ Ori.
- Excluded: UY Sct (V 11.2, too faint).

**Hot, young and runaway**

- λ Ori (Meissa, O8 III, in the λ Ori ring).
- ι Ori.
- θ¹/θ² Ori (the Trapezium region; binoculars show the θ¹–θ² pair, and the Trapezium itself is a telescope target).
- 10 Lac (O9 V, a northern O-dwarf standard).
- ζ Oph (runaway, ex-companion of a supernova).
- AE Aur (runaway from Orion, lights IC 405).
- μ Col (its runaway twin, Dec −32°).
- ζ Pup (Naos, O4, one of the hottest naked-eye stars).
- γ² Vel (Wolf–Rayet + O; southern).
- τ CMa (O star in NGC 2362).
- 15 Mon (lights NGC 2264).
- Pleiades B stars as one record each: Alcyone, Atlas, Electra, Maia, Merope, Taygeta, Pleione (Be, shell episodes).

**Main-sequence references, rotation and peculiar stars**

- Sirius, Vega, Altair, Regulus, Achernar, Fomalhaut, Procyon, Denebola, Castor.
- Alioth (Ap star with the strongest field among the bright stars; verify the claim before shipping).
- Cor Caroli (α² CVn, prototype of its variable class).
- γ Cas (Be prototype), ζ Tau, δ Sco (2000 brightening).
- β CVn (Chara, a solar analog).

**Red giants and the red clump**

- Aldebaran, Arcturus, Pollux, Capella, Hamal, Kochab, Dubhe, Menkar, Alphard, Unukalhai, Rasalhague (A, ok), Schedar.
- The Hyades giants γ, δ¹, ε (planet host) and θ¹ Tau.
- Mirach, Scheat, Gacrux.

**AGB, Mira, S and carbon stars (the "color" showcase)**

- Mira (ο Cet, V 2–10.1, P 332 d).
- χ Cyg (S6-9e, V 3.3–14.2; largest known range of any Mira, verify in GCVS).
- R Leo, R Hya.
- g Her (30 Her), W Cyg, Rasalgethi, β Gru (south), L² Pup (south).
- La Superba (Y CVn), R Lep (Hind's Crimson Star), V Aql, T Lyr, 19 Psc (TX Psc), W Ori, X Cnc, RS Cyg, V460 Cyg, UU Aur, S Cep (challenge).
- Excluded: U Cam (SIMBAD V 11, not reliable in binoculars).

**Pulsating yardsticks**

- δ Cep, η Aql, ζ Gem, Polaris (low-amplitude Cepheid).
- RR Lyr (V 7.1–8.1).
- δ Sct (V 4.7).
- β Cep.
- R Sct (RV Tau type, V ≈ 4.2–8.6).
- U Mon (RV Tau type).

**Eclipsing and interacting binaries**

- Algol.
- β Lyr (Sheliak).
- λ Tau, δ Lib, ζ Aur, 31 Cyg.
- U Cep (V 6.75–9.2).
- RZ Cas (V 6.2–7.7).
- VV Cep (listed above).
- ε Aur (listed above).

**Novae, dust fadings, YSOs and cataclysmics (all `volatile`)**

- T CrB (V ≈ 10 quiescent, ≈ 2 in eruption).
- R CrB (V 5.7 at max, fades to ~14).
- SS Cyg (V ≈ 12 quiescent, ≈ 8.2 in outburst; challenge, outburst only).
- AB Aur (Herbig Ae, V 7.1).
- FU Ori (V 9.6, challenge).
- T Tau (V ≈ 9–13.5; challenge, story only).

**Nearest stars, red dwarfs and high proper motion**

- α Cen A/B, Sirius, Procyon, ε Eri, τ Cet, ε Ind.
- 61 Cyg (first parallax, Bessel 1838).
- ο² Eri = 40 Eri (A K0 V, V 4.4; B a white dwarf at ≈ 83″, V 9.5; mounted-binocular challenge, verify the current separation in WDS).
- Lalande 21185 (HD 95735, M2 V, V 7.5, 2.5 pc).
- Lacaille 8760 (AX Mic, M1 V, V 6.7, 4.0 pc).
- Lacaille 9352 (HD 217987, V 7.4, 3.3 pc).
- Groombridge 34 (HD 1326, V 8.1).
- Barnard's Star (V 9.5, 1.8 pc, 10.36″/yr; challenge).
- Kapteyn's Star (HD 33793, V 8.9, halo).
- Groombridge 1830 (HD 103095, V 6.45, halo).
- HD 16160 (Gliese 105).
- 70 Oph.
- η Cas (G0 V + K7 V pair).
- 36 Oph.

**Planet hosts**

- 51 Peg (first planet around a Sun-like star, 1995).
- υ And (first multi-planet main-sequence system).
- τ Boo.
- 55 Cnc (ρ¹ Cnc).
- 47 UMa, 70 Vir, 14 Her, ρ CrB.
- 16 Cyg B (inside a 39″ binocular pair with 16 Cyg A).
- HD 209458 (V 7.6, first transiting planet).
- HD 189733 (V 7.65, about 0.3° from M27; verify the offset).
- Pollux (β Gem b), ε Eri, γ Cep (Errai), ι Dra.
- Fomalhaut (debris disk).
- β Pic (south).
- Aldebaran (planet *disputed*, which makes it a teaching point).

**Halo, old and metal-poor**

- HD 140283 ("Methuselah", V 7.2, in Libra; age 12.0 ± 0.5 Gyr after revision, [Tang & Joyce 2021, RNAAS 5, 117]; earlier 14.46 ± 0.8 Gyr, [Bond et al. 2013, ApJ 765, L12]).
- Groombridge 1830, Kapteyn's Star.
- Arcturus (thick disk, [Fe/H] ≈ −0.5; [Ramírez & Allende Prieto 2011, ApJ 743, 135]).

**Solar twins and analogs**

- 18 Sco (V 5.5; [Porto de Mello & da Silva 1997, ApJ 482, L89]).
- 16 Cyg A/B.
- α Cen A.
- β CVn.
- 51 Peg.

**Wide binocular doubles (beyond the existing 27)**

Each pair is ≥ 20″ at Δm ≤ 3, or a famous color pair. All are tagged with physical status from WDS plus the literature:

- ζ Lyr (44″), δ Lyr (optical, color pair), ο¹ Cyg (30/31 Cyg, color pair).
- β Cyg is already in the catalog.
- ν Sco (Jabbah, 41″ wide pair).
- β Sco (13.6″, hand-held marginal).
- ζ Sco (ζ¹/ζ² optical), μ Sco (μ¹/μ²), ω¹/ω² Sco.
- α Lib (already in), κ Her, δ Boo, μ Boo, ν Boo (ν¹/ν² optical), ξ UMa? (telescope only, drop).
- 61 Cyg (already in).
- ο² Eri (see above).
- 8/10 Lac? (verify).
- τ¹/τ² Aqr, δ¹/δ² Tau, θ¹/θ² Tau (already), σ² Tau, κ/67 Tau.
- ν Gem (already).
- 19 Lyn.
- α CVn (already).
- 17 CVn? (verify).
- 94 Aqr? (telescope; drop).
- Struve 2725 / γ Del (telescope; keep γ Del as "color star" only).
- ψ¹ Psc, ζ Psc? (verify sep).
- 15/16 Lib? (verify).

Rule for implementers: keep only pairs whose WDS last-epoch `sep2 ≥ 20″` and `mag2 ≤ 8.5`, or that are explicitly famous; drop the "verify" items that fail.

**Cluster and association members used as story pivots** (no separate cards unless listed elsewhere)

- Ursa Major moving group: Merak, Phecda, Megrez, Alioth, Mizar, Alcor. Dubhe and Alkaid are *not* members. Membership from [King et al. 2003, AJ 125, 1980], age 414 ± 23 Myr from [Jones et al. 2015, ApJ 813, 58].
- Upper Scorpius / Sco–Cen: Antares, δ, β¹, π, σ, ν Sco ([de Zeeuw et al. 1999, AJ 117, 354]).
- Orion OB1b: the Belt stars ([Brown et al. 1994, A&A 289, 101]).
- α Per cluster: Mirfak.
- Coma Berenices cluster (Mel 111): γ Com is a *non-member* giant (verify).

### 3.3 Superlatives worth shipping (each with a scope; verify and cite before shipping)

| Superlative (scope) | Star | Source to cite |
|---|---|---|
| Brightest star in the night sky | Sirius | BSC V = −1.46 |
| Nearest star visible to the naked eye from mid-northern latitudes | Sirius (2.64 pc) | Hipparcos 2007, ϖ = 379.21 ± 1.58 mas (queried §4.2) |
| Nearest star system overall (southern) | α Cen | literature |
| Largest star in binocular reach (in radius) | VY CMa (≈ 1,420 R☉); northern: μ Cep or VV Cep A | Wittkowski 2012; Levesque 2005 for μ Cep (radius very distance-dependent; state a range) |
| Brightest red dwarf in the sky | Lacaille 8760 (AX Mic, V 6.7) | SIMBAD |
| Brightest red dwarf in the northern sky | Lalande 21185 (V 7.5) | SIMBAD |
| Fastest-moving star across the sky | Barnard's Star (10.36″/yr) | SIMBAD PM (queried) |
| First stellar parallax | 61 Cyg (Bessel 1838) | historical |
| First planet around a Sun-like star | 51 Peg b | Mayor & Queloz 1995, Nature 378, 355 |
| First transiting exoplanet host | HD 209458 | Charbonneau et al. 2000, ApJ 529, L45; Henry et al. 2000, ApJ 529, L41 |
| Oldest well-dated star in binocular reach | HD 140283 | Bond 2013; Tang & Joyce 2021 |
| Visible star orbiting a black hole | HDE 226868 (Cyg X-1), BH ≈ 21 M☉ at 2.2 kpc | Miller-Jones et al. 2021, Science 371, 1046 |
| Longest-period eclipsing binary visible to the eye | ε Aur (27.1 yr) | Kloppenborg et al. 2010, Nature 464, 870 (disk image) |
| Reddest naked-eye or binocular star | μ Cep (naked eye; Herschel's "Garnet"); R Lep (binocular, deepest red) | B−V from SIMBAD (μ Cep B−V 2.24 Hipparcos) |
| Most oblate bright star imaged | Achernar | Domiciano de Souza et al. 2003, A&A 407, L47 |
| First stellar surface image of a star other than the Sun | Betelgeuse (HST 1996) | Gilliland & Dupree 1996, ApJ 463, L29 |

---

## 4. Data sources: tested queries, sample results, pitfalls, licenses

Network status from this machine (2026-11-01):

- **Unreachable:** `simbad.cds.unistra.fr`, `simbad.u-strasbg.fr`, `vizier.cds.unistra.fr`, `tapvizier.cds.unistra.fr`, `alasky.cds.unistra.fr` and `cdsarc.cds.unistra.fr`. All TCP connections time out. DNS resolves (130.79.128.x); the cause is network-level, not the sandbox policy.
- **Reachable:**
  - `simbad.cfa.harvard.edu` / `simbad.harvard.edu` (official SIMBAD mirror, same database);
  - `vizier.idia.ac.za` (official VizieR mirror in South Africa; the CfA, NAO and IUCAA VizieR mirrors timed out or dropped);
  - `gea.esac.esa.int` (Gaia archive, which also serves Hipparcos);
  - `exoplanetarchive.ipac.caltech.edu`;
  - `query.wikidata.org`, `en.wikipedia.org`, `commons.wikimedia.org`, `www.eso.org`, `esahubble.org`.
- **Consequence:** the hips2fits DSS2 cutout service used by `script/download-binocular-media.py` (alasky) is unreachable from here. New survey cutouts would have to be built elsewhere. Another reason for S7.

The build script must **cache every raw response** under `script/data-cache/stars/` (git-ignored, or committed if small) and record the host and date in provenance.

### 4.1 SIMBAD TAP (identifiers, spectral type, parallax, photometry, object type)

Endpoint: `https://simbad.cfa.harvard.edu/simbad/sim-tap/sync`.

The license is CDS's reuse policy: free use, with acknowledgement that the work "has made use of the SIMBAD database, operated at CDS, Strasbourg, France", citing Wenger et al. 2000, A&AS 143, 9. See https://cds.unistra.fr/vizier-org/licences_vizier.html.

**Sample: six stars by HR**

```bash
curl -sS 'https://simbad.cfa.harvard.edu/simbad/sim-tap/sync' \
 --data-urlencode 'REQUEST=doQuery' --data-urlencode 'LANG=ADQL' --data-urlencode 'FORMAT=csv' \
 --data-urlencode "QUERY=SELECT i.id AS hr, b.main_id, b.ra, b.dec, b.sp_type, b.sp_qual, b.plx_value, b.plx_err, b.plx_bibcode, b.otype, b.rvz_radvel, f.V, f.B FROM ident AS i JOIN basic AS b ON b.oid=i.oidref LEFT JOIN allfluxes AS f ON f.oidref=b.oid WHERE i.id IN ('HR 2061','HR 1713','HR 2491','HR 7417','HR 681','HR 1084')"
```

```
hr,main_id,ra,dec,sp_type,sp_qual,plx_value,plx_err,plx_bibcode,otype,rvz_radvel,V,B
"HR  1084","* eps Eri",53.2326853,-9.4582609,"K2V",B,310.5773,0.1355,"2020yCat.1350....0G","BY*",16.376,3.73,4.61
"HR  1713","* bet Ori",78.6344670,-8.2016383,"B8Ia",C,3.78,0.34,"2007A&A...474..653V","s*b",17.8,0.13,0.1
"HR  2061","* alf Ori",88.7929389,7.4070630,"M1-M2Ia-Iab",B,6.55,0.83,"2007A&A...474..653V","s*r",21.91,0.42,2.27
"HR  2491","* alf CMa",101.2871553,-16.7161158,"A0mA1Va",C,379.21,1.58,"2007A&A...474..653V","SB*",-5.5,-1.46,-1.46
"HR   681","* omi Cet",34.8366337,-2.9776376,"M5/6IIIe",C,10.91,1.22,"2007A&A...474..653V","Mi*",63.5,6.53,7.63
"HR  7417","* bet01 Cyg",292.6803150,27.9596736,"K3II+B9.5V",C,8.9816,0.4474,"2020yCat.1350....0G","**",-24.7752,3.08,4.21
```

Note that Mira's `V = 6.53` is a *snapshot* and must never be shown as "its magnitude".

**Bulk: every HR star with all identifiers.** This returned 9,128 rows in 11 s.

```sql
SELECT i.id AS hr, b.main_id, b.sp_type, b.plx_value, b.plx_err, b.otype, f.V, f.B, ids.ids
FROM ident AS i JOIN basic AS b ON b.oid=i.oidref
LEFT JOIN allfluxes AS f ON f.oidref=b.oid LEFT JOIN ids ON ids.oidref=b.oid
WHERE i.id LIKE 'HR %'
```

Coverage of that dump:

- `sp_type` 9,093 of 9,128;
- σϖ/ϖ < 10% for 8,763;
- a Gaia DR3 id for 8,702 (the brightest ~400 have none);
- a WDS id for 3,276;
- a `V*` (GCVS) id for 1,341.

The `ids` column is `|`-separated (`HIP 424|Gaia DR3 386612584958214400|WDS J00052+4514A|…`). This is how the pipeline gets HIP and Gaia IDs for joins.

**Resolving curated non-BSC stars** works the same way, with `WHERE i.id IN ('NAME Barnard''s star','HD 95735','HD 226868','V* VY CMa','V* RR Lyr',...)`. All 56 curated identifiers resolved. Selected rows:

```
NAME Barnard's star  M4V             V=9.511  d=1.8pc   PM*/BY*  pm=(-801.6,+10362.4) mas/yr
HD 95735             M2+V            V=7.52   d=2.5pc   (Lalande 21185)
HD 226868            O9.7Iabpvar     V=8.91   d=2253pc  HXB  (Cyg X-1 donor)
HD 140283            F9VkA5mA1       V=7.212  d=61.5pc  pm=(-1115,-304)
V* VY CMa            M5Iae           V=8.691  d=2386pc  ← Gaia 1/ϖ; literature maser parallax ≈ 1.2 kpc
V* RW Cep            K2_0-Ia         V=6.65   d=8772pc  ← garbage 1/ϖ; never use
V* Y CVn             C-N5            V=4.87   B=7.41    (La Superba; B−V 2.54)
V* R Lep             C7,6e           V=7.76   B=13.51   (snapshot; Hind's Crimson Star)
V* T CrB             M3IIIe_sh       V=10.247 d=916pc   Sy*
```

**Teff measurements (`mesFe_h`).** This table is heterogeneous: it holds many papers per star, with occasional outliers (Betelgeuse 4,039 K and log g 4.24 in one 2021 entry). The pipeline uses the **median of entries from 2000 onward, after rejecting values more than 3 MAD from the median**. It stores the *count* and the *range*, and it lets curation override.

```sql
SELECT b.main_id AS star, m.teff, m.log_g, m.fe_h, m.bibcode
FROM mesFe_h AS m JOIN basic AS b ON b.oid=m.oidref
WHERE b.main_id IN ('* alf Ori','* bet Ori','* alf CMa')
```

```
"* alf CMa",9850,4.3,0.4,"2025A&A...698A..93J"
"* alf Ori",3633,-0.06,-0.111,"2025A&A...693A.163T"
"* bet Ori",12622,1.907,-0.159,"2023ApJS..266...11B"
"* alf Ori",3654,0.43,-0.21,"2019A&A...627A.138A"
"* bet Ori",12100,1.75,,"2012A&A...543A..80F"
"* alf Ori",4039,4.24,0.75,"2021MNRAS.505.4496G"      ← outlier, rejected by MAD filter
```

Two TAP quirks:

- ADQL `ORDER BY` with a qualified column (`b.main_id`) fails on this service. Order by an alias, or sort client-side.
- `mesVar` (SIMBAD variability) mixes surveys; for example it lists two different periods for Mira, 330 d and 418 d. **Use GCVS/VSX for variability, not `mesVar`.** `mesDiameter` returned nothing for Betelgeuse, Sirius or Mira; use JMDC/JSDC instead (§4.4).

### 4.2 Gaia archive: Hipparcos 2007 and Gaia DR3

Endpoint: `https://gea.esac.esa.int/tap-server/tap/sync`.

Licenses:

- Gaia data: CC BY-SA 3.0 IGO. Credit "ESA/Gaia/DPAC" and cite Gaia Collaboration 2023, A&A 674, A1. See https://www.cosmos.esa.int/web/gaia-users/license.
- Hipparcos new reduction: van Leeuwen 2007, A&A 474, 653.

```sql
SELECT hip, plx, e_plx, hp_mag, b_v FROM public.hipparcos_newreduction
WHERE hip IN (27989, 24436, 32349, 95947, 10826, 16537, 107259)
```

```
hip,plx,e_plx,hp_mag,b_v
27989,6.55,0.83,0.4997,1.5        Betelgeuse  → 153 pc formal; adopt literature 168 (+27/−15) pc, Joyce et al. 2020
95947,7.51,0.33,3.2177,1.088      Albireo A   (Gaia DR3 8.98 ± 0.45 mas but RUWE 9.4 → unreliable)
10826,10.91,1.22,4.9898,0.966     Mira        → ≈ 92 pc (±11%)
32349,379.21,1.58,-1.0876,0.009   Sirius      → 2.637 pc
107259,0.55,0.2,3.9123,2.242      μ Cep       → σ/ϖ = 36% → distance "uncertain" (literature ~0.6–1.8 kpc; state range)
16537,310.94,0.16,3.8652,0.881    ε Eri       → 3.216 pc
24436,3.78,0.34,0.193,-0.03       Rigel       → ≈ 265 pc (±9%)
```

```sql
SELECT s.source_id, s.phot_g_mean_mag, s.parallax, s.parallax_error, s.ruwe,
       a.teff_gspphot, a.radius_flame, a.lum_flame, a.mass_flame, a.age_flame, a.evolstage_flame
FROM gaiadr3.gaia_source AS s LEFT JOIN gaiadr3.astrophysical_parameters AS a USING (source_id)
WHERE s.source_id IN (5164707970261890560, 2026116260337482112, 2493390319631956352, 2202630001603369856)
```

```
source_id,phot_g_mean_mag,parallax,parallax_error,ruwe,teff_gspphot,radius_flame,lum_flame,mass_flame,age_flame,evolstage_flame
2026116260337482112,2.65,8.98,0.447,9.43,,,,,,          Albireo A: RUWE 9.4 (binary + saturation)
2493390319631956352,3.57,,,,,,,,,                       Mira: no astrometry at all
2202630001603369856,2.45,0.119,0.264,3.07,,,,,,          μ Cep: meaningless parallax
5164707970261890560,3.47,310.58,0.135,2.72,5002,0.776,0.340,0.811,7.30,224   ε Eri: FLAME R=0.78 R☉ (lit. ≈0.74), age 7.3 Gyr (model; lit. 0.4–0.8 Gyr — wrong for this young active star)
```

**Conclusion:** use Gaia DR3 FLAME/GSP-Phot values for nothing on cards. They can at most be cross-checks with `method: 'model'` for faint dwarfs. FLAME ages for active young K dwarfs are unreliable, as ε Eri shows above.

### 4.3 VizieR: BSC5 (V/50), GCVS (B/gcvs), VSX (B/vsx) and WDS (B/wds)

Endpoint: `https://vizier.idia.ac.za/viz-bin/asu-tsv`. The license is the CDS/VizieR policy (same link as SIMBAD). Cite each catalog's paper.

**BSC5, full version** (Hoffleit & Warren 1991, VizieR V/50). It includes B−V, SpType, a multiplicity code and a variable ID.

```
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=V/50/catalog&-out=HR,Name,HD,RAJ2000,DEJ2000,Vmag,B-V,SpType,Parallax,MultID,MultCnt,VarID&HR=2061,1713,2491,7417,681
```

```
 681	 68Omi Cet	 14386	02 19 20.7	-02 58 39	 3.04	 1.42	  M7IIIe+Bep    0.024	AC  	 4	Omi Cet
1713	 19Bet Ori	 34085	05 14 32.3	-08 12 06	 0.12	-0.03	  B8Ia:         0.013	AB  	 4	 1882
2061	 58Alp Ori	 39801	05 55 10.3	+07 24 25	 0.50	 1.85	  M1-2Ia-Iab    0.005	AE  	 6	Alp Ori
2491	  9Alp CMa	 48915	06 45 08.9	-16 42 58	-1.46	 0.00	  A1Vm          0.375	AB  	 4
7417	  6Bet1Cyg	183912	19 30 43.3	+27 57 35	 3.08	 1.13	  K3II+B9.5V    0.017	AB  	 3	12105
```

Use V/50 B−V as the *primary* color for HR stars. It is homogeneous, it matches the BSC V, and SIMBAD's B is a mix of sources.

**GCVS** (Samus et al. 2017, ARep 61, 80; VizieR B/gcvs).

- Query by cone, because the name format is fiddly: `GCVS==omi Cet` with a URL-encoded `%3D%3D` works.
- `magMax`/`Min1` are in the band `flt`. `Min1` is primary minimum, or the amplitude when `n_Min1 = '('`.

```
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=B/gcvs/gcvs_cat&-out=GCVS,VarType,magMax,Min1,n_Min1,flt,Period,SpType&GCVS=%3D%3Domi%20Cet
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=B/gcvs/gcvs_cat&-out=GCVS,VarType,magMax,Min1,n_Min1,flt,Period,SpType&-c=05+55+10.3+%2B07+24+25&-c.rs=60
```

```
omi Cet   	M         	 2.000	10.100	  	V 	  331.9600000000	M5e-M9e
alf Ori   	SRC       	 0.000	 1.600	  	V 	 2335.0000000000	M1-M2Ia-Ibe     ← 2335 d is the long secondary period; the ~400 d pulsation is in the literature
bet Per   	EA/SD     	 2.120	 3.390	  	V 	    2.8673043000	B8V
```

**VSX** (Watson et al. 2006; VizieR B/vsx). VSX is more current than GCVS (Mira P = 331.3 d), but it is a cone search with neighbors. **Pick the row whose name matches SIMBAD's `V*` id**; never take the first row.

```
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=B/vsx/vsx&-c=02+19+20.7+-02+58+39&-c.rs=30&-out=Name,Type,max,min,Period,Sp
omi Cet   M   2.000  10.100  331.30   M5e-M9e
VZ Cet    *   9.500  12.000  4750.0   Beq        ← neighbor, ignore
```

Policy: **prefer VSX for type, range and period, and fall back to GCVS. Record both source IDs.** The AAVSO web pages return 403 to curl from this machine. The VSX data is CC BY 4.0, per AAVSO's VSX licensing (verify the exact terms on aavso.org before shipping).

**WDS** (Mason et al. 2001, AJ 122, 3466; VizieR B/wds, updated continuously).

```
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=B/wds/wds&-c=19+30+43.3+%2B27+57+35&-c.rs=60&-out=WDS,Disc,Comp,Obs1,Obs2,pa2,sep2,mag1,mag2,SpType
```

```
19307+2758	BNU  10	Aa,Ab	1978	1995	160	  0.00	 3.370	 5.00	K3II
19307+2758	MCA  55	Aa,Ac	1976	2024	 32	  0.30	 3.370	 5.16	K3III+B0V
19307+2758	STFA 43	AB   	1755	2025	 54	 34.30	 3.190	 4.68	K3II+B9.5      ← the binocular pair
19307+2758	WAL 114	AC   	1944	2023	339	 64.80	 3.190	10.99	K3II+B9.5      ← field star, drop
… 9 more faint "SMR 34" field components, all mag2 ≥ 10 → drop
```

The Mizar query (`-c.rs=900&mag1=<5`) returns AB 14.4″, AC 715.5″ (Alcor) and AD 498″ (Sidus Ludoviciana, 7.6), plus `SHY` common-motion pairs at 999.9″.

**WDS filter rule:**

- keep pairs with `mag2 ≤ 9.0` and either `sep2 ≥ 6″` or an `Aa,Ab`-type close pair used only for the system note;
- drop `SHY` and `SMR` survey components unless curated;
- WDS gives no physical/optical verdict, so `physical` comes from curation, informed by Gaia DR3 parallax and PM agreement for components fainter than G ≈ 5.

Albireo is the case study. Its status is `debated`: Gaia DR2 parallaxes differ ([Drimmel et al. 2019, RNAAS 3, 79]) while the PM and RV are similar. That makes it a great card (MC10).

### 4.4 Angular diameters: JMDC and JSDC (radius without luminosity assumptions)

- JMDC: measured diameters, Duvert 2016 (VizieR II/345).
- JSDC v2: predicted diameters, Chelli et al. 2016, A&A 589, A112 (VizieR II/346).

```
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=II/346/jsdc_v2&-c=06+45+08.9+-16+42+58&-c.rs=30&-out.all
→ HD48915  A1V+DA  V=-1.440  LDD=6.175 ± 0.466 mas
https://vizier.idia.ac.za/viz-bin/asu-tsv?-source=II/345/jmdc&-c=05+55+10.3+%2B07+24+25&-c.rs=30&-out.all
→ HD39801 (α Ori): 34 mas (Pease 1931, the first ever) … 49.4 ± 0.24 mas (800 nm) — several entries, band-dependent
```

Radius from angular diameter:

```
R/R☉ = θ[mas] × d[pc] / 9.305        (since 1 R☉ at 1 pc subtends 9.305 mas in diameter)
```

Sirius gives 6.175 × 2.637 / 9.305 = 1.75 R☉. The literature value is 1.71 R☉, so this is a good check.

**Pipeline rule:** for stars with a JMDC limb-darkened measurement, derive the radius this way (`method: 'derived'`, sources = JMDC bibcode + distance source). This is the most honest radius for giants.

The Pease 1931 Betelgeuse measurement is itself a history hook: the first star whose size was measured. Cite Michelson & Pease 1921, ApJ 53, 249.

### 4.5 NASA Exoplanet Archive (planet hosts)

Endpoint: `https://exoplanetarchive.ipac.caltech.edu/TAP/sync`. The license is public; acknowledge per the archive's policy.

```sql
select hostname, hd_name, hip_name, sy_vmag, sy_dist, count(*) as npl, min(disc_year) as first_disc
from pscomppars where sy_vmag < 6.5 group by hostname, hd_name, hip_name, sy_vmag, sy_dist order by sy_vmag
```

The query returned 171 host rows. The first entries are `alf Tau` (V 0.87; Aldebaran b, contested by later work, so mark it `disputed`), `HD 62509` (Pollux, 2006), `gam1 Leo`, `alf Ari`, `bet UMi` (Kochab), `gam Cep` (2003), `tau Cet` (3 planets), `eps Eri` (2000), `ups And` (1996, 3 planets) and `tau Boo` (1996).

To capture HD 209458 and HD 189733, which are deliberately included at V ≈ 7.6, use `sy_vmag < 8`.

### 4.6 Wikidata and Wikipedia (curation aids, not primary sources)

- Wikidata SPARQL (CC0) works with an English sitelink join. Properties: P6879 Teff, P2060 luminosity, P2120 radius, P2067 mass.
- Sample result: Betelgeuse 3,654 K, L 60,000, R 768, M 17.8; Mira 3,000 K and M 1.2 only; Sirius (a *system* item) has Teff 9,797 and nothing else.
- Coverage is patchy, and the values lack per-value references in the result. **Use Wikidata only to find the paper a value comes from, then cite the paper.**
- The Wikipedia REST summary (`/api/rest_v1/page/summary/Betelgeuse`) works. Text is CC BY-SA 4.0. **Do not copy card text from Wikipedia.** Write original text and cite the primary papers.

### 4.7 Pitfalls the pipeline must handle (seen in the queries above)

1. **Saturation:** Gaia has no astrometry for Mira, and garbage for μ Cep (RUWE 3).
2. **Binarity:** Albireo A has RUWE 9.4. Treat RUWE > 1.4 as unreliable.
3. **Supergiant distances:** Gaia gives VY CMa 2.4 kpc against 1.2 kpc from masers, and RW Cep 8.8 kpc. Always curate.
4. **Snapshot magnitudes for variables:** SIMBAD gives Mira V 6.53 and R Lep 7.76. Use the GCVS/VSX range.
5. **Multi-entry measurement tables:** filter `mesFe_h` with the MAD rule, and keep `mesVar` out entirely.
6. **WDS faint survey components:** filter them out.
7. **Bayer superscripts:** SIMBAD `* bet01 Cyg` must match BSC `β¹`. Join on HR or HD, never on names.
8. **The BSC `K` temperature is not Teff.**
9. **Duplicate proper names** in `bsc5-short.json` (`Mizar` ×2). The KB record name wins in Journeys.

---

## 5. Build pipeline (for the implementer)

```
script/build-star-kb.py            (python3 -I, stdlib only, like the existing download scripts)
  inputs:  client/public/data/bsc5-short.json, binocular-catalog.json,
           script/star-kb/curated/*.yaml   (one file per curated star or group; hand-written; reviewed)
           script/star-kb/sources.yaml
  fetch:   SIMBAD (Harvard) bulk HR dump + curated id list; Hipparcos 2007 + Gaia DR3 (ESAC);
           V/50, GCVS, VSX, WDS, JMDC (IDIA VizieR); Exoplanet Archive
           → cached raw files in script/data-cache/stars/<source>/<query-hash>.{csv,tsv}
  derive:  distance (policy S4), M_V, L (with BC), R (from θ or Stefan–Boltzmann), stage default,
           colorHex (reuse the Planck ratio formula), hrPoint
  merge:   curated YAML overrides catalog tier field-by-field; provenance.overrides lists them
  validate (fails the build):
           every journey-eligible record has kind, ≥1 teaches, ≥1 sourced numeric fact, seeText, understandText (engine gate, doc 05 §4)
           every FactValue.sourceId exists in sources.json; lo ≤ value ≤ hi
           physics sanity: |L − 4πR²σT⁴| within 0.3 dex when all three present; M_V vs spType class within 2 mag
           no derived value displayed with > 2 sig figs; volatile=true for classes mira/r-crb/recurrent-nova/lbv/semiregular
  outputs: client/public/data/journeys/stars.kb.json      (~320 records, target ≤ 600 KB raw, ~150 KB gzip)
           client/public/data/journeys/hr-background.json  ([bv, Mv] × ~8,700, rounded to 0.01 → ~110 KB)
           client/public/data/journeys/sources.json       (shared with DSO half)
           (optional) client/public/data/journeys/star-stubs.json  (layer C, ~450 KB)
```

- Everything under `client/public/data/` is copied to `dist/public` and picked up by `script/build.ts`'s offline manifest, which walks `dist/public`. No service-worker change is needed.
- Add a Vitest validator (`client/src/lib/__tests__/star-kb.test.ts`) that re-runs the schema and sanity checks on the shipped JSON, so a hand edit can't break invariants.

### 5.1 Derivation formulas (with the method label they produce)

- **Distance** (`method: measured`, from ϖ): d = 1000/ϖ pc. Use it only when σϖ/ϖ < 0.1. The range is 1000/(ϖ ± σ).
- **Absolute magnitude:** M_V = V + 5 log₁₀(ϖ/100) − A_V. Set A_V = 0 for d < 75 pc. Otherwise use a curated value, or 0 with a flag.
- **Luminosity** (`derived`): log L/L☉ = −0.4 (M_V + BC_V − 4.74). BC_V comes from Teff via the Flower 1996 polynomials, using the [Torres 2010, AJ 140, 1158] corrected coefficients. **For Teff < 3,300 K or for carbon stars, do not derive L.** Curate it or leave it empty.
- **Radius** (`derived`):
  - preferred: from angular diameter (§4.4);
  - otherwise from Stefan–Boltzmann, R/R☉ = √(L/L☉) × (5772/Teff)².
- **Mass and age:** curated only (`literature`) for named showpieces; otherwise omit. Never ship a mass for a single star from a model without a citation. For cluster and group members, take the group age with the `membership` source.
- **Stage default** (when no curation):

| Luminosity class | Default stage |
|---|---|
| V or IV-V | `main-sequence` |
| IV | `subgiant` |
| III, with G8–K2 and M_V between +0.2 and +1.2 | `red-clump` (`stageConfidence: 'likely'`) |
| III, otherwise | `red-giant-branch` |
| II or Ib | supergiant by temperature |
| Ia or Iab | supergiant by temperature |
| 0 (zero) or "Ia+" | `yellow-hypergiant` or `lbv` (curate) |

  Overrides by spectral or variability type:
  - C or S type, or GCVS `M`: `tp-agb`.
  - `e` with an O/B spectral type: `main-sequence` plus the Be concept.

### 5.2 Worked example: Betelgeuse (what a finished record should contain)

```jsonc
{
  "id": "STAR-Betelgeuse", "kind": "variable", "name": "Betelgeuse",
  "aliases": ["α Ori", "58 Ori", "HR 2061", "HD 39801", "HIP 27989", "* alf Ori"],
  "hr": 2061, "hd": 39801, "hip": 27989, "simbadMainId": "* alf Ori", "constellation": "Ori",
  "vMag": { "value": 0.50, "lo": 0.0, "hi": 1.6, "unit": "mag", "sourceId": "gcvs", "method": "measured", "note": "range; 2020 minimum ≈ 1.6" },
  "bv": { "value": 1.85, "unit": "mag", "sourceId": "bsc5-v50", "method": "measured" },
  "spType": { "text": "M1-M2Ia-Iab", "class": "M", "subclass": 1.5, "lumClass": "Ia-Iab", "sourceId": "simbad" },
  "teffK": { "value": 3630, "lo": 3600, "hi": 3660, "unit": "K", "sourceId": "simbad-mesfeh-median", "method": "literature", "note": "median of post-2000 entries after MAD rejection" },
  "distancePc": { "value": 168, "lo": 153, "hi": 195, "unit": "pc", "sourceId": "joyce2020", "method": "literature" },
  "radiusRsun": { "value": 764, "lo": 702, "hi": 880, "unit": "Rsun", "sourceId": "joyce2020", "method": "literature" },
  "massMsun": { "value": 18, "lo": 16.5, "hi": 19, "unit": "Msun", "sourceId": "joyce2020", "method": "literature" },
  "angularDiameterMas": { "value": 42, "lo": 37, "hi": 49, "unit": "mas", "sourceId": "jmdc", "method": "measured", "note": "band- and epoch-dependent" },
  "evolutionaryStage": "red-supergiant", "stageConfidence": "established",
  "variability": { "class": "semiregular", "gcvsType": "SRC", "vMax": 0.0, "vMin": 1.6, "band": "V",
                   "periodDays": { "value": 2335, "unit": "d", "sourceId": "gcvs", "method": "measured", "note": "long secondary period; ~400 d fundamental per literature" },
                   "binocularVisibleAtMin": true, "volatile": true, "sourceId": "gcvs" },
  "multiplicity": { "components": [], "pairs": [], "systemNote": "A close faint companion (α Ori B, 'Siwarha') was reported in 2025 from speckle imaging; verify before shipping." },
  "membership": [{ "group": "Orion OB1 (debated; likely runaway from it)", "groupId": "ori-ob1", "role": "probable", "sourceId": "verify" }],
  "teaches": [{ "conceptId": "LIGHT.color-temp", "strength": 3 }, { "conceptId": "STAR.size", "strength": 3 },
              { "conceptId": "STAR.supergiant-fate", "strength": 3 }, { "conceptId": "VAR.dust-fading", "strength": 2 }],
  "roles": ["supergiant", "variable"],
  "superlatives": [{ "claim": "first star other than the Sun with a directly imaged surface", "scope": "historical (HST 1996)", "sourceId": "gilliland1996" }],
  "misconceptions": ["MC2", "MC4", "MC6"],
  "links": [{ "to": "STAR-Rigel", "type": "CONTRAST", "text": "Same constellation, opposite ends of the temperature scale." },
            { "to": "M1", "type": "LIFE_NEXT", "text": "The Crab shows what a star like this leaves behind." }],
  "seeText": "A steady orange-red point, obviously warmer than Rigel or Bellatrix. Defocus slightly to make the color pop.",
  "lookFor": ["compare its color with Rigel across Orion", "compare its brightness with Procyon and Aldebaran"],
  "visual": { "colorHex": "<stellarColor(3630)>", "hrPoint": { "bv": 1.85, "absMagV": -5.6 }, "sizeDiagram": true, "lightCurve": true,
              "imageIds": ["eso2109a-betelgeuse-dimming"] },
  "provenance": { "builtAt": "…", "pipelineVersion": "1", "overrides": ["distancePc", "radiusRsun", "massMsun"] }
}
```

- The values marked as literature come from [Joyce et al. 2020, ApJ 902, 63], which used seismic and evolutionary modeling to get d = 168 (+27/−15) pc and R = 764 (+116/−62) R☉. The implementer must transcribe the exact ranges from the paper.
- The dimming dust explanation is from [Montargès et al. 2021, Nature 594, 365] ([ESO eso2109](https://www.eso.org/public/images/eso2109a/)).

---

## 6. Images and visuals for stars

Stars are unresolved points. Even in research images, only a handful are resolved, so this is mostly **generated, data-driven visuals** that teach. The first three are mandatory for every star card; the others depend on the star.

1. **Color swatch with a temperature bar.** Use `stellarColor(teffK ?? K, bv)` along a 2,500–40,000 K log bar, and mark the Sun at 5,772 K. Label it "display color, not what your eye sees". Faint stars look white because of `PERC.night-eyes`.
2. **HR-diagram dot over a real HR diagram.**
   - The background is `hr-background.json`: B−V and M_V for about 8,700 BSC stars with σϖ/ϖ < 10% (from the SIMBAD bulk dump plus V/50 B−V).
   - The visitor sees the main sequence, giant branch and supergiants made of *naked-eye stars*.
   - Highlight the current stop, earlier journey stops (faded, connected in order: a life-path view) and the Sun.
   - This is the single best teaching visual in the feature. It covers the `STAR.luminosity-class`, `STAR.size` and `LIFE.giant` concepts.
3. **Size comparison.** Concentric circles to scale (linear when the ratio is ≤ 100, otherwise log with an explicit "log scale" label):
   - Sun, Earth, Earth's orbit (215 R☉), Mars's orbit (328 R☉) and Jupiter's orbit (1,118 R☉) as rings;
   - Betelgeuse reaches beyond Mars's orbit; VY CMa beyond Jupiter's orbit;
   - for dwarfs, compare with Jupiter and Earth (white dwarf ≈ Earth).
4. **Schematic light curve** for variables: shape by class (EA dip, β Lyr continuous, Cepheid sawtooth, Mira sinusoid with large range, R CrB sudden drop), with the true range and period on the axes. It is labeled "typical shape, not a forecast".
   - **Algol is the exception: predict its minima offline** from a published ephemeris. GCVS gives P = 2.8673043 d with epoch fields; prefer a recent O−C-corrected ephemeris (e.g. Kreiner 2004, AcA 54, 207, as in SIMBAD `mesVar`).
   - Show "next eclipse minima at your site" with a ±1 h caveat. This is a superb binocular activity.
   - Do the same for β Lyr (P = 12.94 d), λ Tau (3.95 d) and δ Cep (5.366 d; maxima).
5. **Binocular-field view for doubles.**
   - Reuse `optical-star-field.ts` at the user's true field and magnification. Draw the pair at real separation and PA, with sizes scaled by magnitude.
   - Add a "split?" verdict from `binocular-assessment.ts`.
   - Add a magnified inset showing the PA and the separation in arcseconds.
6. **Distance and light-travel strip** (for `DIST`/`TIME` concepts): "light that left this star in 1478" (show the year only if σd/d < 15%; MC5 honesty rule).
7. **Real images, about 12, curated.** All of these are CC BY 4.0 (ESO, ESA/Hubble, ESA/Webb) or NASA public domain. Download once, re-encode to ≤ 120 KB WebP/JPEG, and credit them in `client/public/data/journeys/images/CREDITS.md`. Verified pages:
   - Betelgeuse before and during the Great Dimming: https://www.eso.org/public/images/eso2109a/ (ESO/M. Montargès et al., CC BY 4.0).
   - Antares surface, VLTI reconstruction: https://www.eso.org/public/images/eso1726a/ (ESO/K. Ohnaka, CC BY 4.0; Ohnaka et al. 2017, Nature 548, 310).
   - R Sculptoris ALMA spiral (AGB mass loss; southern, but a perfect `STAR.agb-massloss` illustration usable on any carbon-star card): https://www.eso.org/public/images/eso1239a/.
   - Sirius A and its white dwarf companion: https://esahubble.org/images/heic0516a/ (NASA, ESA, H. Bond (STScI), M. Barstow; CC BY 4.0).
   - To verify and add: the Mira GALEX UV tail (NASA PIA09820; Martin et al. 2007, Nature 448, 780), Fomalhaut's debris disk (HST/JWST), the Altair CHARA surface image (Monnier et al. 2007, Science 317, 342), WR 124 (JWST), and the ε Aur eclipse-disk reconstruction (Kloppenborg 2010).
   - The ESO license is CC BY 4.0 per https://www.eso.org/public/copyright/ (checked).
8. **The existing DSS2 field cutouts** (3.7° field) stay for the 43 existing STAR/DS targets as "what the field looks like". New stars do not get cutouts in v1, since alasky is unreachable and the payload grows.

The incremental offline payload is about 1.5 MB of photos plus about 0.9 MB of JSON. That is negligible next to the existing 38 MB.

---

## 7. Star-centric concept stories (15 of them, region-compact)

These are seeds for curated `edges.json` links and for the engine's archetype tests. Each is built to fit within about a 40–50° patch, so there is no zig-zagging. The season is for mid-northern latitudes in the evening. "B" means binoculars, "NE" naked eye.

1. **Orion: a stellar life cycle in one constellation** (winter; Orion, Taurus). Doc 04 A1 and A8.
   - Path: λ Ori (O8 star, ~5 Myr, in the λ Ori ring, NE + B) → M42 (the nursery, DSO) → the Belt (Ori OB1b blue supergiants, ~5–10 Myr) → Rigel (B8 Ia blue supergiant) → Betelgeuse (red supergiant, near its end) → M1 (the remnant of a star like it, challenge).
   - Physics: mass decides fate; massive stars live only a few Myr.
   - The twist is MC6 at Betelgeuse: "not any day now; the dimming was dust".
2. **Two clusters and an impostor** (winter; Taurus). A5 and `SKY.projection`.
   - Path: Pleiades (≈ 100–125 Myr; Pleione Be-star shell episodes) → Hyades (≈ 625–680 Myr, 47 pc; the four red-clump giants γ, δ¹, ε, θ¹) → **Aldebaran** (K5 III at 20 pc: in front of the Hyades and not a member, MC9) → θ¹/θ² Tau (a naked-eye pair in the cluster: one red clump giant and one A star of the same age).
   - Physics: the turn-off. The Pleiades still have blue B stars; the Hyades' B stars are gone and became white dwarfs.
   - Sources: Pleiades lithium-depletion age 125 Myr [Stauffer et al. 1998, ApJ 499, L199]; Hyades distance [Perryman et al. 1998, A&A 331, 81].
3. **The Ursa Major family and its two strangers** (spring; Big Dipper). A5 and `KIN.moving-group`.
   - Path: Merak → Phecda → Megrez → Alioth → Mizar & Alcor (one moving family, ~414 Myr) → then Dubhe and Alkaid, which are not members and are headed elsewhere. Dubhe is a K giant with a different motion.
   - Payoff: the Dipper's shape will distort over 100,000 years.
   - Bonus: Mizar was the first telescopic double (c. 1650) and Mizar A the first spectroscopic binary (Pickering 1889). Alcor itself has a red-dwarf companion [Mamajek et al. 2010, AJ 139, 919].
4. **How big can a star be?** (autumn; Cepheus, Cygnus, Lacerta). A7 and `STAR.size`.
   - Path: 61 Cyg A/B (K dwarfs, 0.7 R☉, 3.5 pc) → Deneb (A2 Ia, ~200 R☉, very luminous and distant) → μ Cep (Garnet Star, ~1,000 R☉ class, B−V 2.2) → VV Cep (an M supergiant with a hot companion that it eclipses every 20 years).
   - Ending: the size diagram puts all four inside Jupiter's orbit circle.
   - Twist: the faintest-looking of the four (61 Cyg) is the closest.
5. **The black hole you can see the companion of** (summer and autumn; Cygnus). A8 and `STAR.black-hole-binary`.
   - Path: Albireo (gold and blue; are they even a pair? MC10) → η Cyg → **HDE 226868** (V 8.9, 0.4° from η Cyg; an O9.7 supergiant orbiting a 21 M☉ black hole every 5.6 d [Miller-Jones et al. 2021]) → P Cyg (an LBV that erupted in 1600, a star near the edge of stability) → the Crescent Nebula NGC 6888 (a Wolf–Rayet wind bubble, DSO, challenge).
   - Physics: what's left after the most massive stars die.
6. **Red, redder, reddest: carbon stars and where your carbon came from** (winter version: Lepus and Orion; spring version: Canes Venatici and Ursa Major).
   - Winter path: Betelgeuse (M supergiant, oxygen-rich) → W Ori (carbon star, ~6 mag) → R Lep, Hind's Crimson Star (deep red; best near maximum, `volatile`).
   - Spring path: Arcturus (K giant) → La Superba (Y CVn, C-N5) → Cor Caroli (blue-white contrast) → … M51 region (DSO).
   - Concepts: `STAR.carbon-dredge-up` → `LIFE.recycling`. Teach `PERC.purkinje` as an observing trick.
7. **Stars that change: an autumn variable-star circuit** (autumn; Cepheus, Cassiopeia, Perseus). A10.
   - Path: δ Cep (the Cepheid prototype; compare with ε and ζ Cep, P 5.37 d) → μ Cep (semiregular red supergiant) → ρ Cas (yellow hypergiant, outbursts) → γ Cas (Be-star prototype; 1937 outburst) → Algol (eclipsing; show tonight's predicted minimum).
   - The yardstick bridge: δ Cep teaches Leavitt's law, then M31 (DSO), where Hubble found Cepheids.
8. **Our neighbors** (winter; Canis Major, Canis Minor, Monoceros). A3 and `NEAR.neighborhood`.
   - Path: Sirius (2.6 pc; white-dwarf companion, HST image) → Procyon (3.5 pc; white-dwarf companion too) → … then the honest twist: the most common neighbor type, red dwarfs, is invisible to the eye.
   - A spring version uses Lalande 21185 (V 7.5, 2.5 pc, a binocular target in Ursa Major).
   - Concepts: `DIST.light-year`, `STAR.white-dwarf` (the Sun's fate seen by proxy).
9. **Worlds around other suns** (autumn; Pegasus, Andromeda). `PLAN.host`.
   - Path: 51 Peg (1995 Nobel planet) → HD 209458 (V 7.6, first transiting planet: "you are looking at a star whose planet we've watched cross its face") → υ And (first multi-planet system around a Sun-like star) → M31 (DSO) as the scale payoff.
   - A summer version: 16 Cyg A/B (a binocular pair; B hosts an eccentric giant planet) → HD 189733 (next to M27).
10. **The oldest things in the binocular sky** (late spring; Boötes, Serpens, Libra). A11 and `KIN.halo-star`.
    - Path: Arcturus (an old thick-disk giant passing through) → M5 (globular, ≈ 12 Gyr, DSO) → **HD 140283** (V 7.2, a halo subgiant 12 Gyr old: one of the oldest stars with a well-measured age).
    - Physics: metal-poor means "born before the Galaxy was enriched".
11. **Scorpius: grown-up children of a nursery, beside an ancient swarm** (summer; Scorpius). A5 and contrast.
    - Path: Antares (red supergiant of Upper Sco, ~11 Myr) → σ Sco and the ρ Oph cloud direction (Sco-Cen nursery) → M4 (old globular 1.3° from Antares) → δ Sco (Be star, 2000 brightening) → ν Sco / β Sco (wide multiples) → ζ¹/ζ² Sco and NGC 6231 (one of the most luminous stars known, for southern-ish sites).
    - Contrast: ~10 Myr versus ~12 Gyr in the same binocular field.
12. **Seeing double, and doubting it** (summer; Lyra). A9.
    - Path: ε Lyr (double-double: each wide component is itself a tight pair, making a physical quadruple) → ζ Lyr (wide pair) → δ Lyr (an optical red-and-blue pair, so a chance alignment) → β Lyr (an eclipsing mass-transfer binary, 12.9 d; compare with γ Lyr over nights) → RR Lyr (prototype RR Lyrae; challenge) → M57 (DSO; the end of a Sun-like star).
13. **The star that will explode and the star that hides** (spring and summer; Corona Borealis). A10 and `VAR.nova` / `VAR.dust-fading`.
    - Path: T CrB (a recurrent nova; erupted in 1866 and 1946; an eruption is expected; check AAVSO) → R CrB (fades unpredictably by up to 8 mag as soot forms) → ε CrB (planet host, a steady comparison).
    - All three sit inside 3°, which is perfect for one binocular field.
    - This story is `volatile` by design. The card says what to do in either state.
14. **Spinning stars** (summer; the Summer Triangle). `STAR.rotation`.
    - Path: Vega (seen pole-on, rotating fast; debris disk) → Altair (rotates in about 9 h; imaged as squashed, Monnier 2007) → Deneb (contrast: a slow, huge supergiant).
    - A winter variant: Regulus (spinning near breakup; McAlister et al. 2005, ApJ 628, 439).
15. **Auriga: an eclipsing mystery, a runaway, and a pair of giants** (winter; Auriga). A10 and `KIN.runaway`.
    - Path: Capella (two giants, one helium-burning in the red clump [Torres et al. 2015, ApJ 807, 26]) → ε Aur (27-year eclipse by a dark dusty disk; next eclipse 2036–38) → ζ Aur (eclipsing K supergiant + B star) → **AE Aur** (O9.5 V, ejected from the Orion Nebula Cluster region about 2.5 Myr ago with μ Col [Hoogerwerf et al. 2001, A&A 365, 49]; lights the Flaming Star Nebula) → M36/M37/M38 (clusters of different ages, DSO).

---

## 8. Curation workload and order of work

- **Phase A (automatic, about 1 day):**
  - build the pipeline and caches;
  - fill the catalog tier for 173 layer-A plus about 150 layer-B stars;
  - generate `hr-background.json`;
  - run validator failures through a review list.
- **Phase B (curation, about 2 to 4 days of expert time):** write YAML for the about 70 showpiece stars used in §7 stories first. Each needs literature distance, R, M and age with bibcodes, plus `teaches`, `superlatives`, `links`, `seeText`, `understandText` and `historyHook`. After that, give the other curated stars at least `teaches`, `seeText`, sourced Teff and distance, and stage.
- **Phase C:** write image credits, the Algol/β Lyr/δ Cep ephemerides and the volatile-star cards.
- Every curated numeric fact gets a bibcode. A reviewer checks 10% of facts at random against the cited paper; the reviewer's initials go into `provenance.curatedBy`.

---

## 9. Risks and open questions

1. **The CDS main hosts are unreachable from this machine.** The pipeline depends on the Harvard SIMBAD mirror and the IDIA VizieR mirror; the latter was the only VizieR mirror that answered. If IDIA fails, fallbacks are the Gaia archive (which also hosts Hipparcos) and NASA HEASARC TAP (reachable; it carries GCVS and WDS copies, untested here). `download-finder-stars.py` and `download-binocular-media.py` also point at CDS hosts.
2. **Stage scales disagree.** Doc 05 uses `LifeStage` 0–6 and doc 04 uses `evoStage` 0–8. The orchestrator must pick one; the §2.3 mapping supports both.
3. **Volatile stars:** T CrB, R CrB, Betelgeuse, Miras and novae. Offline data goes stale, so cards must be state-agnostic. Optionally, an online-only "check AAVSO" link.
4. **Curated literature values carry real uncertainty.** μ Cep's distance and radius, VY CMa's radius, and Betelgeuse's distance (literature spans ~150–220 pc) are examples. Cards must show ranges and avoid false precision. The validator enforces the 2-significant-figure rule for derived and model values.
5. **The "splittable" heuristic must be calibrated against `binocular-assessment.ts`.** Do not invent a second rule. Existing data shows Albireo 34″ as "stability dependent at 10×" and 100 Her 14″ as "a real test".
6. **Licensing:**
   - VSX's exact license terms should be confirmed on aavso.org (403 from here).
   - Gaia is CC BY-SA 3.0 IGO. Shipping derived numbers is fine with attribution, but the share-alike clause should be acknowledged in CREDITS.
   - Wikipedia text must not be copied.
7. **Facts marked "verify" in this doc must be checked before shipping:** the Alioth field claim, Betelgeuse's companion, the HD 189733–M27 offset, the 40 Eri B separation, χ Cyg's range record, γ Com membership, and some layer-B doubles.
8. **The selection is northern-biased by design** (the default site is San Francisco). Southern showpieces are included but are thin in stories. A southern story pack (Crux, Carina, Centaurus) is a later increment.
9. **Layer C stubs** (about 450 KB) are optional. Ship them only if the star inspector uses them.

## Sources cited (catalog and service level)

- SIMBAD: Wenger et al. 2000, A&AS 143, 9 — https://simbad.cfa.harvard.edu (mirror)
- VizieR: Ochsenbein et al. 2000, A&AS 143, 23 — https://vizier.idia.ac.za (mirror); reuse policy https://cds.unistra.fr/vizier-org/licences_vizier.html
- Bright Star Catalogue 5th ed.: Hoffleit & Warren 1991 (VizieR V/50)
- Hipparcos new reduction: van Leeuwen 2007, A&A 474, 653
- Gaia DR3: Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1; license https://www.cosmos.esa.int/web/gaia-users/license
- GCVS: Samus et al. 2017, Astron. Rep. 61, 80 (VizieR B/gcvs); VSX: Watson et al. 2006 (VizieR B/vsx)
- WDS: Mason et al. 2001, AJ 122, 3466 (VizieR B/wds)
- JMDC: Duvert 2016 (VizieR II/345); JSDC v2: Chelli et al. 2016, A&A 589, A112 (VizieR II/346)
- NASA Exoplanet Archive, `pscomppars` table — https://exoplanetarchive.ipac.caltech.edu
- ESO image license — https://www.eso.org/public/copyright/ ; images eso2109a, eso1726a, eso1239a; ESA/Hubble heic0516a
- T CrB status (late August 2026, unconfirmed eruption): [Star Walk](https://starwalk.space/ay/en/tcrb), [Sky & Telescope](https://skyandtelescope.org/astronomy-blogs/stargazing-why-we-look-up/waiting-for-the-blaze-star/)
- Papers cited inline: Joyce et al. 2020 (ApJ 902, 63); Montargès et al. 2021 (Nature 594, 365); Ohnaka et al. 2017 (Nature 548, 310); Wittkowski et al. 2012 (A&A 540, L12); Miller-Jones et al. 2021 (Science 371, 1046); King et al. 2003 (AJ 125, 1980); Jones et al. 2015 (ApJ 813, 58); Mamajek et al. 2010 (AJ 139, 919); de Zeeuw et al. 1999 (AJ 117, 354); Brown et al. 1994 (A&A 289, 101); Stauffer et al. 1998 (ApJ 499, L199); Perryman et al. 1998 (A&A 331, 81); Hoogerwerf et al. 2001 (A&A 365, 49); Bond et al. 2013 (ApJ 765, L12); Tang & Joyce 2021 (RNAAS 5, 117); Ramírez & Allende Prieto 2011 (ApJ 743, 135); Porto de Mello & da Silva 1997 (ApJ 482, L89); Mayor & Queloz 1995 (Nature 378, 355); Charbonneau et al. 2000 (ApJ 529, L45); Henry et al. 2000 (ApJ 529, L41); Kloppenborg et al. 2010 (Nature 464, 870); Domiciano de Souza et al. 2003 (A&A 407, L47); Monnier et al. 2007 (Science 317, 342); McAlister et al. 2005 (ApJ 628, 439); Torres et al. 2015 (ApJ 807, 26); Drimmel et al. 2019 (RNAAS 3, 79); Gilliland & Dupree 1996 (ApJ 463, L29); Michelson & Pease 1921 (ApJ 53, 249); Torres 2010 (AJ 140, 1158); Martin et al. 2007 (Nature 448, 780). Implementers: confirm each bibcode via ADS before entering it in `sources.json`.
