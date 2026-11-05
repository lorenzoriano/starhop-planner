/**
 * Sky Journeys: shared contracts (KB data model + engine I/O + scorer model).
 *
 * Binding spec: docs/sky-journeys/00-spec.md. Background: docs 02 (stars), 03 (deep sky), 04 (pedagogy),
 * 05 (engine), 06 (UX). Every runtime KB file is validated by the zod mirrors in ./kb-schema.ts, and the two
 * files are kept in sync by compile-time checks there. Change both together.
 *
 * Conventions
 * - Coordinates are ICRS/J2000 degrees (ra 0..360, dec -90..90).
 * - Every number shown to a user is a FactValue with a sourceId that resolves in KnowledgeBase.sources.
 * - Distances are canonical in light-years (`distanceLy`), ages in Myr (`ageMyr`).
 * - Object ids follow spec decision 9: existing unified-target ids (STAR-*, DS-*, AST-*, M42, NGC869 …);
 *   new BSC stars `HR<n>` (unpadded, same as the routing SkyNode id); non-BSC stars `HD<n>` or `NAME-<Name>`;
 *   context nodes `ctx:<Name>`.
 */

// ───────────────────────────── facts & sources ─────────────────────────────

export type FactMethod = 'measured' | 'literature' | 'derived' | 'model' | 'catalog';

/** One sourced number. `min`/`max` give the published range (or ±1σ) when known; `value` is what the engine uses. */
export interface FactValue {
  value: number;
  min?: number;
  max?: number;
  unit: string;
  sourceId: string;
  method: FactMethod;
  /** Short provenance note, e.g. "414±7 pc (VLBA)"; never shown as card prose. */
  note?: string;
}

/**
 * Canonical fact keys (both kinds share one record so the engine can read `facts.distanceLy` uniformly).
 * Units: distanceLy ly · ageMyr Myr · teffK K · radiusRsun R☉ · massMsun M☉ · lumLsun L☉ · sizeLy ly ·
 * memberCount stars · periodDays d · feH dex · bv mag · absMagV mag · angularSizeArcmin arcmin ·
 * surfaceBrightness mag/arcsec² · radialVelocityKms km/s · vsiniKms km/s · angularDiameterMas mas ·
 * properMotionMasYr mas/yr · spaceVelocityKms km/s · vMax/vMin mag (variables).
 */
export type FactKey =
  | 'distanceLy' | 'ageMyr' | 'teffK' | 'radiusRsun' | 'massMsun' | 'lumLsun'
  | 'sizeLy' | 'memberCount' | 'periodDays' | 'feH' | 'bv' | 'absMagV'
  | 'angularSizeArcmin' | 'surfaceBrightness' | 'radialVelocityKms' | 'vsiniKms'
  | 'angularDiameterMas' | 'properMotionMasYr' | 'spaceVelocityKms' | 'vMax' | 'vMin';

export const FACT_KEYS = [
  'distanceLy', 'ageMyr', 'teffK', 'radiusRsun', 'massMsun', 'lumLsun',
  'sizeLy', 'memberCount', 'periodDays', 'feH', 'bv', 'absMagV',
  'angularSizeArcmin', 'surfaceBrightness', 'radialVelocityKms', 'vsiniKms',
  'angularDiameterMas', 'properMotionMasYr', 'spaceVelocityKms', 'vMax', 'vMin',
] as const satisfies readonly FactKey[];

export type Facts = Partial<Record<FactKey, FactValue>>;

export interface Source {
  id: string;
  title: string;
  url: string;
  publisher: string;
  license?: string;
  kind?: 'catalog' | 'paper' | 'web' | 'book' | 'image' | 'curator';
  /** Full citation, e.g. "Joyce et al. 2020, ApJ 902, 63". */
  citation?: string;
  bibcode?: string;
  /** ISO date the source was read/queried. */
  retrieved?: string;
}

// ───────────────────────────── taxonomy enums ─────────────────────────────

/** doc 04 §2.4 roles (archetype slot matching). */
export type ObjectRole =
  | 'nursery' | 'young-cluster' | 'adult-cluster' | 'old-cluster' | 'globular'
  | 'main-sequence' | 'giant' | 'supergiant' | 'pn' | 'snr' | 'wd'
  | 'variable' | 'double' | 'galaxy' | 'association';

export const OBJECT_ROLES = [
  'nursery', 'young-cluster', 'adult-cluster', 'old-cluster', 'globular',
  'main-sequence', 'giant', 'supergiant', 'pn', 'snr', 'wd',
  'variable', 'double', 'galaxy', 'association',
] as const satisfies readonly ObjectRole[];

/**
 * doc 04 evoStage (spec decision 2: the ONLY authored life-stage scale):
 * 0 cloud · 1 embedded / ≤10 Myr cluster · 2 young ≤200 Myr · 3 intermediate ≤2 Gyr · 4 old cluster or globular ·
 * 5 giant/supergiant star · 6 PN or SN-imminent · 7 remnant · 8 galaxy (outside the sequence). null = n/a (asterism).
 * Main-sequence stars use 2 (≤200 Myr) or 3. Doc 05's 0..6 `LifeStage` is DERIVED in engine code.
 */
export type EvoStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** doc 05 engine life stage, derived from evoStage + evolutionaryStage/dsoClass (never authored). */
export type LifeStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** doc 02 §2.2 fine star evolutionary state. */
export type EvolutionaryStage =
  | 'pre-main-sequence' | 'zams' | 'main-sequence' | 'terminal-main-sequence' | 'subgiant'
  | 'red-giant-branch' | 'red-clump' | 'horizontal-branch' | 'early-agb' | 'tp-agb'
  | 'post-agb' | 'blue-supergiant' | 'yellow-supergiant' | 'yellow-hypergiant' | 'red-supergiant'
  | 'lbv' | 'wolf-rayet' | 'white-dwarf' | 'binary-interacting' | 'compact-companion-host';

/** doc 02 §2.2 coarse variability families. */
export type VariabilityClass =
  | 'eclipsing-algol' | 'eclipsing-beta-lyrae' | 'eclipsing-long-period' | 'cepheid' | 'rr-lyrae' | 'delta-scuti'
  | 'beta-cephei' | 'mira' | 'semiregular' | 'irregular' | 'rv-tauri' | 'gamma-cas-be' | 'r-crb' | 'recurrent-nova'
  | 'dwarf-nova' | 'alpha2-cvn' | 'lbv' | 'yellow-hypergiant' | 'young-stellar-object' | 'rotational' | 'none-detectable';

/** doc 03 §2.1 deep-sky class (one per object). */
export type DeepSkyClass =
  | 'hii-region' | 'reflection-nebula' | 'dark-nebula' | 'nebula-complex'
  | 'embedded-cluster' | 'open-cluster' | 'ob-association' | 'moving-group' | 'globular-cluster'
  | 'star-cloud' | 'asterism'
  | 'planetary-nebula' | 'supernova-remnant' | 'wind-bubble'
  | 'galaxy-spiral' | 'galaxy-barred-spiral' | 'galaxy-lenticular' | 'galaxy-elliptical'
  | 'galaxy-dwarf-elliptical' | 'galaxy-irregular'
  | 'milky-way-field';

/** doc 03 §2.1 traits. */
export type DeepSkyTrait =
  | 'starburst' | 'active-nucleus' | 'interacting' | 'satellite' | 'edge-on'
  | 'core-collapsed' | 'former-dwarf-nucleus' | 'retrograde-halo'
  | 'contains-red-supergiants' | 'contains-red-giants' | 'contains-white-dwarfs' | 'dissolving'
  | 'pulsar' | 'historical-supernova'
  | 'naked-eye' | 'line-of-sight-pair';

/** Misconception ids, doc 04 §6.5 (MC1..MC15). */
export type MisconceptionId =
  | 'MC1' | 'MC2' | 'MC3' | 'MC4' | 'MC5' | 'MC6' | 'MC7' | 'MC8'
  | 'MC9' | 'MC10' | 'MC11' | 'MC12' | 'MC13' | 'MC14' | 'MC15';

// ───────────────────────────── pedagogy ─────────────────────────────

export type Score5 = 1 | 2 | 3 | 4 | 5;

export interface TeachTag {
  /** A Concept.id (doc 04 coarse ids such as "LIFE.nursery" or doc 02 fine ids such as "STAR.red-clump"). */
  conceptId: string;
  /** 3 = textbook example. */
  strength: 1 | 2 | 3;
}

export interface Superlative {
  /** Card-ready claim, e.g. "nearest region forming massive stars". */
  claim: string;
  /** Explicit scope, e.g. "whole sky", "visible to the naked eye from mid-northern latitudes". */
  scope: string;
  sourceId: string;
  /** Machine tag for engine features/slots, e.g. "largest-star-in-view", "nearest", "oldest". */
  tag?: string;
}

/** Binocular view grade (doc 03 §3.3): 0 not seen · 1 suspected · 2 certain but faint · 3 easy · 4 showpiece. */
export type ViewGrade = 0 | 1 | 2 | 3 | 4;

export interface BinocularView {
  '7x50': { suburban: ViewGrade; dark: ViewGrade };
  '10x50': { suburban: ViewGrade; dark: ViewGrade };
  /** 'derived' = seeded by the pipeline, must become 'curator' or 'sketch-evidence' before journey use. */
  basis: 'curator' | 'derived' | 'sketch-evidence';
  evidenceIds?: string[];
}

// ───────────────────────────── media & card ─────────────────────────────

export interface KbImage {
  /** App-relative path (render as "./" + src), e.g. "data/binocular-images/M42-primary.jpg", or an https URL. */
  src: string;
  /** Larger copy for the tap-to-enlarge lightbox (app-relative path, lazily fetched). Falls back to src. */
  large?: string;
  credit: string;
  license: string;
  caption: string;
  /** Field width of the image in degrees, when known (survey cutouts). */
  fieldDeg?: number;
  variant?: 'optical' | 'infrared' | 'featured' | 'photo' | 'illustration';
  /** Page the image came from (license verification). */
  sourceUrl?: string;
}

/** In-app generated visuals (spec decision 11). Parameters are read from facts unless overridden. */
export type KbVisual =
  | { type: 'temperature-swatch' }
  | { type: 'hr-diagram' }
  | { type: 'size-comparison'; compareWith?: string[] }
  | { type: 'light-curve'; shape: 'eclipsing' | 'pulsating' | 'mira' | 'irregular' | 'fading' | 'nova' }
  | { type: 'age-bar' }
  | { type: 'distance-bar' }
  | { type: 'binocular-field'; fieldDeg?: number };

export interface KbMedia {
  images: KbImage[];
  visuals: KbVisual[];
}

export interface CardNumber {
  /** Short label, e.g. "Distance", "Surface temperature". */
  label: string;
  /** Key in this object's `facts`. */
  factRef: FactKey;
  /** Key for the relatable-scale template ("size.marble", "time.sun-day", "distance.light-left"), doc 06 §7.1. */
  comparisonKey?: string;
}

/**
 * Layered stop card (doc 04 §6.1, doc 06 §7; card order and budgets from the owner brief, see
 * docs/sky-journeys/voice.md "The card"). Original prose only. KB text is the default; narration may override
 * whyHere/transition per journey. Boxes: question ≤16 words, whyHere 1–2 sentences, see 2–4, understand 3–5,
 * answer 1–3; wonder, connect and glance one sentence each (wonder and connect may be ''). question + whyHere +
 * see + understand + answer: 130–200 words for a showpiece, 90–140 for a supporting card.
 */
export interface StopCard {
  /**
   * Owner feedback round 1: a card opens with the plain question this stop answers ("How can a star
   * vanish for a month?") and closes with its answer in one to three sentences. Every journey-eligible
   * curated card has both; they stay optional in the type for auto-tier objects.
   */
  question?: string;
  answer?: string;
  /** Layer 0 expectation line: what binoculars will honestly show. */
  glance: string;
  whyHere: string;
  see: string;
  understand: string;
  /** One sentence that adds something new, or '' when it would only repeat the card. */
  wonder: string;
  /** One sentence linking to the next idea, or ''. */
  connect: string;
  /** ≤5 rows; at most 4 shown above "All numbers". */
  numbers: CardNumber[];
  photoCaption: string;
  /** What photos show that binoculars won't (doc 03 notSeeText). */
  notSee?: string;
  deeper?: string;
  /** showpiece = full curated card; supporting = shorter card used mid-journey. */
  tier: 'showpiece' | 'supporting';
}

export interface EventDependence {
  kind: 'nova-pending' | 'dust-fading' | 'dimming' | 'eclipse-season' | 'lpv-phase' | 'outburst';
  /** Shown instead of a current brightness, e.g. "Check AAVSO for its current brightness". */
  note: string;
  checkUrl?: string;
}

export interface Provenance {
  /** auto = catalog tier only; journey-eligible needs curated or reviewed. */
  status: 'auto' | 'seeded' | 'curated' | 'reviewed';
  batch?: BatchId;
  curatedBy?: string;
  reviewedAt?: string;
  /** Fields where the curated tier overrode the auto tier, e.g. ["facts.ageMyr"]. */
  overrides?: string[];
  /** Why the build kept this record out of journeys (status 'seeded'); shown only in the inspector. */
  ineligibleReason?: string;
}

// ───────────────────────────── KB objects ─────────────────────────────

export interface KbNames {
  /** Display name, e.g. "Betelgeuse", "Orion Nebula". */
  display: string;
  /** Catalog designation for subtitles, e.g. "α Orionis", "M42". */
  designation?: string;
  /** Other names/ids (Bayer, Flamsteed, HD, NGC, nicknames) for search. */
  aliases: string[];
  simbadId?: string;
}

interface KbObjectBase {
  id: string;
  /** BSC HR number for any stellar record (routing uses `HR<n>`); also on DSOs dominated by one BSC star. */
  hr?: number;
  names: KbNames;
  /** IAU constellation abbreviation, e.g. "Ori". */
  con: string;
  /** J2000 degrees. */
  ra: number;
  dec: number;
  /** Reference V magnitude (variables: max light); null when meaningless (dark nebula, MW field). */
  mag: number | null;
  facts: Facts;
  /** evoStage 0..8 or null when not applicable (asterism, star cloud). */
  evoStage: EvoStage | null;
  contextIds: string[];

  // pedagogy (doc 04 §2.4)
  teaches: TeachTag[];
  roles: ObjectRole[];
  wow: Score5;
  insight: Score5;
  obsDifficulty: Score5;
  superlatives: Superlative[];
  misconceptions: MisconceptionId[];
  historyHook?: { text: string; sourceId: string };
  /** Finds itself (bright or iconic); good opener. */
  showpiece: boolean;
  /** Curated 0..1 interest prior (engine feature, never a filter). */
  interest: number;

  media: KbMedia;
  card: StopCard;
  eventDependent?: EventDependence;
  /** Every sourceId used anywhere in this record (facts, superlatives, hooks). */
  sources: string[];
  provenance?: Provenance;
}

export interface SpectralType {
  /** As published, e.g. "M1-M2 Ia-ab". */
  text: string;
  /** O B A F G K M (or C, S, W, D). */
  class: string;
  lumClass?: string;
  sourceId: string;
}

export interface Variability {
  class: VariabilityClass;
  /** Raw GCVS/VSX code, e.g. "SRC", "EA/SD", "M". */
  gcvsType: string;
  vMax: number;
  vMin: number;
  periodDays?: number;
  epochJD?: number;
  /** vMin ≤ 9.0. */
  binocularVisibleAtMin: boolean;
  /** Current state cannot be inferred offline (cards must not state current brightness). */
  volatile: boolean;
  sourceId: string;
}

export interface StarComponent {
  /** WDS component label, e.g. "A", "B", "Aa". */
  label: string;
  spType?: string;
  vMag?: number;
  notes?: string;
}

export interface PairMeasure {
  /** "AB", "AC", "Aa,Ab". */
  pair: string;
  sepArcsec: number;
  paDeg: number;
  epoch: number;
  magPrimary: number;
  magSecondary: number;
  physical: 'bound' | 'common-proper-motion' | 'optical' | 'debated' | 'unknown';
  orbitPeriodYr?: number;
  sourceId: string;
}

export interface Multiplicity {
  components: StarComponent[];
  pairs: PairMeasure[];
  systemNote?: string;
}

export interface StarObject extends KbObjectBase {
  kind: 'star';
  spectral?: SpectralType;
  evolutionaryStage?: EvolutionaryStage;
  stageConfidence?: 'established' | 'likely' | 'debated';
  variability?: Variability;
  multiplicity?: Multiplicity;
  /** Story role inside a group (contextIds lists the groups). */
  membershipRole?: 'member' | 'probable' | 'foreground' | 'background' | 'escaped-runaway';
  population?: 'thin-disk' | 'thick-disk' | 'halo';
  exoplanets?: { count: number; firstDiscoveryYear: number; method: string; status: 'confirmed' | 'disputed'; sourceId: string };
  /** Non-BSC stars only: proper motion (mas/yr) so the app can propagate positions (>1″/yr). */
  pmRA?: number;
  pmDec?: number;
  /** Binocular view grades are optional for stars (bright stars are trivially 4). */
  view?: BinocularView;
}

export type PoweredByKind =
  | 'ionizing-stars' | 'reflected-starlight' | 'silhouette' | 'central-star-uv'
  | 'pulsar-wind' | 'shock-heating' | 'stellar-wind' | 'starlight' | 'agn-plus-stars';

export interface DsoObject extends KbObjectBase {
  kind: 'dso';
  dsoClass: DeepSkyClass;
  secondaryClasses?: DeepSkyClass[];
  traits?: DeepSkyTrait[];
  morphology?: { hubble: string; sourceId: string };
  /** Angular extent (catalog-extents.json / OpenNGC). */
  extent?: { majorArcmin: number; minorArcmin?: number; paDeg?: number; sourceId: string };
  poweredBy?: { kind: PoweredByKind; starIds?: string[]; sourceIds: string[]; note?: string };
  view: BinocularView;
  appearance: {
    moonTolerance: 'high' | 'medium' | 'low';
    resolves: 'stars' | 'partly' | 'glow' | 'silhouette';
    /** Field needed to frame it with context, degrees. */
    bestFieldDeg: number;
    colorVisible: boolean;
    filterHelps?: 'OIII' | 'UHC' | 'H-beta';
  };
}

export type KbObject = StarObject | DsoObject;
export type KbObjectKind = KbObject['kind'];

// ───────────────────────────── context nodes ─────────────────────────────

export type ContextKind =
  | 'ob-association' | 'molecular-complex' | 'moving-group' | 'galaxy-group' | 'galaxy-cluster'
  | 'host-galaxy' | 'galactic-structure' | 'stellar-system';

/** Non-observable node that carries facts and text (doc 03 §6.1). Members share SIBLING/NEIGHBOR edges. */
export interface ContextNode {
  /** "ctx:OriOB1" … */
  id: string;
  kind: ContextKind;
  name: string;
  /** Parent context, e.g. ctx:OriOB1b → ctx:OriOB1. */
  parentId?: string;
  memberIds: string[];
  facts: Facts;
  text?: string;
  sources: string[];
}

// ───────────────────────────── concepts ─────────────────────────────

/** Concept graph node (doc 04 §2.2 plus doc 02 §2.4 fine concepts with `parent`). */
export interface Concept {
  /** "LIFE.nursery", "STAR.red-clump" … */
  id: string;
  title: string;
  /** 0 perceptual/sky literacy … 3 cosmic scale. */
  tier: 0 | 1 | 2 | 3;
  /** One-sentence card-ready big idea. */
  bigIdea: string;
  /** Soft prerequisites (concept ids). */
  prereqs: string[];
  /** Terms the concept introduces (cognitive-load counting). */
  terms: string[];
  /** Coarse parent for fine concepts (Jaccard on concept+parent). */
  parent?: string;
  /** Example KB object ids. */
  evidenceIds?: string[];
  /**
   * One-sentence bridge the narrator inserts when a stop needs this concept but no earlier stop taught it
   * (doc 04 §2.1: a bridge costs 1 load unit). Plain language, no new terms beyond `terms`.
   */
  bridge?: string;
}

// ───────────────────────────── edges ─────────────────────────────

/** Spec decision 3: doc 05's 9 types + LINE_OF_SIGHT. */
export type EdgeType =
  | 'LIFE_NEXT' | 'CAUSE' | 'SIBLING' | 'CONTRAST' | 'SAME_FAMILY'
  | 'SCALE' | 'TIME_MACHINE' | 'SAME_PHYSICS' | 'NEIGHBOR' | 'LINE_OF_SIGHT';

export const EDGE_TYPES = [
  'LIFE_NEXT', 'CAUSE', 'SIBLING', 'CONTRAST', 'SAME_FAMILY',
  'SCALE', 'TIME_MACHINE', 'SAME_PHYSICS', 'NEIGHBOR', 'LINE_OF_SIGHT',
] as const satisfies readonly EdgeType[];

export interface FactRef {
  objectId: string;
  fact: FactKey;
}

/**
 * Story edge. Curated edges ship in edges.json; derived edges are computed at load (same shape, curated:false).
 * NEIGHBOR alone never justifies a step (spec 3).
 */
export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  /** e.g. "ionizes", "same-cloud", "older-analog", "same-age-different-distance", "line-of-sight", "teffK". */
  subtype: string;
  /** 0.2..1. */
  strength: number;
  /** NarrationBank key for the transition text, e.g. "edge.M45>AST-Hyades" or "CONTRAST.teffK". */
  reasonKey: string;
  /** Facts the reason text relies on (validator checks they exist; narration fills placeholders from them). */
  factRefs?: FactRef[];
  curated: boolean;
  /** Default true. false = valid in both directions. */
  directed?: boolean;
  sourceIds?: string[];
}

// ───────────────────────────── templates (archetypes) ─────────────────────────────

/** doc 04 §3.0 arc roles. */
export type ArcRole = 'hook' | 'build' | 'twist' | 'payoff' | 'coda';

export interface SlotMatch {
  kinds?: KbObjectKind[];
  dsoClasses?: DeepSkyClass[];
  /** Any of these roles. */
  roles?: ObjectRole[];
  anyConcepts?: string[];
  allConcepts?: string[];
  evoStageIn?: EvoStage[];
  superlativeTags?: string[];
  minWow?: number;
  maxObsDifficulty?: number;
  minInterest?: number;
  /** Inclusive fact ranges, e.g. { teffK: { max: 4000 } }. */
  factRanges?: Partial<Record<FactKey, { min?: number; max?: number }>>;
  /** Object must carry at least one misconception tag (twist slots). */
  hasMisconception?: boolean;
  /** Star must have `variability.class` in this list (A10 mechanism slots). */
  variabilityClasses?: VariabilityClass[];
  /** Object must carry a `historyHook` (A4 time-machine slots). */
  hasHistoryHook?: boolean;
}

export interface TemplateSlot {
  arc: ArcRole;
  /** Story role, also the UI chip label (≤3 words), e.g. "Nursery", "Doomed giant". */
  label: string;
  match: SlotMatch;
  optional?: boolean;
  /** Consecutive fillers allowed, e.g. [1, 3]. Default [1, 1]. */
  repeat?: [number, number];
  /** Link types allowed to ARRIVE at this slot (subset of Template.edges); absent = any of Template.edges. */
  inEdges?: EdgeType[];
}

/** Minimum ingredients checked before attempting an archetype in a patch (doc 04 §3.1). */
export interface TemplateIngredients {
  roles?: { anyOf: ObjectRole[]; min: number }[];
  minDistinctEvoStages?: number;
  /** e.g. { fact: 'teffK', minSpan: 6000 } or { fact: 'distanceLy', minRatio: 100 }. */
  factSpans?: { fact: FactKey; minSpan?: number; minRatio?: number }[];
  minStars?: number;
  /** Candidates in the patch carrying ≥1 superlative (A7). */
  minSuperlatives?: number;
  /** Candidates in the patch carrying a historyHook (A4). */
  minHistoryHooks?: number;
  /** Zenith sky brightness must be at least this dark, mag/arcsec² (A11: Milky Way visible). */
  minSkyBrightness?: number;
  /** Attempt only when Moon illumination (0..1, Moon up) is ≤ this (A8, A11). */
  maxMoonIllumination?: number;
  /** Attempt only when Moon illumination (0..1, Moon up) is ≥ this (A12 constraint archetype). */
  minMoonIllumination?: number;
}

/**
 * The one allowed archetype switch per journey (spec decision 6, doc 04 §3.2). After the stop filling `atArc`,
 * the journey may continue with the target template's slots from its first `build` slot on; the stop just
 * filled serves as the target's hook. The switch link must be one of `via` with strength ≥ `minStrength`, and
 * the transition text must announce it using the narration key `announceKey` ({theme} = target title).
 */
export interface SwitchRule {
  to: string[];
  atArc: ArcRole;
  via: EdgeType[];
  minStrength: number;
  announceKey: string;
}

/** Archetype stored as data (spec decision 6; doc 04 §3, doc 05 §5.4). */
export interface Template {
  /** "A1-cradle-to-grave". */
  id: string;
  /** "A1" … "A12". */
  archetype: string;
  title: string;
  /** NarrationBank keys for title variants (may embed {region}). */
  titleKeys: string[];
  drivingQuestion: string;
  /** ≤90 chars discovery hook line. */
  hookLine: string;
  themeTags: string[];
  slots: TemplateSlot[];
  order: 'strict' | 'partial' | 'free';
  /** Slot indices that may permute (partial order). */
  swapGroups?: number[][];
  /** Allowed link types between consecutive stops. */
  edges: EdgeType[];
  progression?: { property: FactKey | 'evoStage'; direction: 'up' | 'down' | 'arc' };
  /** [min, max] stops. */
  length: [number, number];
  defaultLength: number;
  ingredients: TemplateIngredients;
  coreConcepts: string[];
  moonFriendly: boolean;
  needsDark: boolean;
  kidFriendly: boolean;
  /** Templates this one may chain into once (doc 04 §3.2). */
  chainTo?: string[];
  /** NarrationBank keys for driving-question variants (default text is `drivingQuestion`). */
  questionKeys?: string[];
  /** NarrationBank keys for discovery hook-line variants (each ≤90 chars; default is `hookLine`). */
  hookKeys?: string[];
  /** NarrationBank keys for the payoff line that answers the driving question at the payoff stop. */
  payoffKeys?: string[];
  /** Plain-language ordering principle (doc 04 §3.1), for authors and debug output. */
  orderingPrinciple?: string;
  /** doc 04 §3.2 matrix: bright Moon OK / partly / needs a dark (moonless) sky. */
  moonSuitability?: 'bright-ok' | 'partial' | 'dark-only';
  /** The single allowed archetype switch (its `to` must be within `chainTo`). */
  switchRule?: SwitchRule;
}

// ───────────────────────────── narration ─────────────────────────────

/**
 * Keyed text variants with {placeholders} (doc 05 §8). Key families:
 *  - "edge.<from>><to>"            curated transition (Edge.reasonKey)
 *  - "<EDGE_TYPE>[.<subtype>]"     generic transition, e.g. "CONTRAST.teffK", "LIFE_NEXT"
 *  - "title.<templateId>"          journey titles ("title.<templateId>.end<lastStep>" first: titles for the beat the
 *                                  night ends on, like the payoff./story. beat variants); "direction.<mode>" get-there text; "compare.<comparisonKey>"
 * Placeholders: {prev} {next} {prevVal} {nextVal} {ratioPhrase} {deg} {fields} {screenDir} {compassHint} {region}
 * {anchor} {value}. Variant picked by seeded rng without reuse inside a journey.
 * The shipped bank (client/public/data/journeys/narration.json) documents its full placeholder vocabulary in
 * `placeholders` and adds families "question.", "hook.", "payoff.", "switch.", "skip.", "bridge.", "why.", "notice.".
 */
export interface NarrationBank {
  version: string;
  variants: Record<string, string[]>;
  /** Placeholder vocabulary: name (without braces) → what the narrator substitutes. Documentation + test oracle. */
  placeholders?: Record<string, string>;
  /**
   * Value bands for comparison keys: base key (e.g. "compare.distance.light-left") → ordered bands. The narrator
   * picks the first band with min ≤ value < max and uses variants[`${base}.${suffix}`].
   */
  bands?: Record<string, NarrationBand[]>;
  /** Variant key (or key prefix ending in ".") → URLs backing historical anchors or constants in that text. */
  citations?: Record<string, string[]>;
}

export interface NarrationBand {
  suffix: string;
  /** Inclusive lower bound (absent = −∞). */
  min?: number;
  /** Exclusive upper bound (absent = +∞). */
  max?: number;
  /** Which fact the band reads (default: the card number's factRef). */
  fact?: FactKey;
}

// ───────────────────────────── knowledge base ─────────────────────────────

export interface KnowledgeBase {
  version: string;
  objects: KbObject[];
  contexts: ContextNode[];
  concepts: Concept[];
  edges: Edge[];
  templates: Template[];
  narration: NarrationBank;
  sources: Source[];
  /**
   * Theme lenses (owner feedback r2), one set per archetype that has one. An archetype with a lens set tells its
   * journeys through it: only objects with a lens there are used, in storyline-beat order.
   */
  lenses?: ThemeLensSet[];
}

/** Runtime files in client/public/data/journeys/ (spec decision 8); the loader assembles a KnowledgeBase. */
export interface KbJsonFile { version: string; objects: KbObject[]; contexts: ContextNode[]; sources: Source[] }
export interface ConceptsJsonFile { version: string; concepts: Concept[] }
export interface EdgesJsonFile { version: string; edges: Edge[] }
export interface TemplatesJsonFile { version: string; templates: Template[] }
export type NarrationJsonFile = NarrationBank;
/** model.json */
export type ModelJsonFile = ScorerModel;

/** Sky-region batches used by the build pipeline (script/journeys/object-list.json). */
export type BatchId = 'winter' | 'spring' | 'summer-north' | 'summer-south' | 'autumn' | 'southern';
export const BATCH_IDS = ['winter', 'spring', 'summer-north', 'summer-south', 'autumn', 'southern'] as const satisfies readonly BatchId[];

// ───────────────────────────── engine I/O ─────────────────────────────

export type Compass8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface JourneyInstrument {
  /** True field of view, degrees. */
  fovDeg: number;
  /** Objective diameter, mm. */
  aperture: number;
  magnification: number;
  stabilized?: boolean;
}

export interface JourneyRequest {
  /** ISO instant; the engine never reads Date.now(). */
  instant: string;
  lat: number;
  lon: number;
  instrument: JourneyInstrument;
  /** Zenith sky brightness, mag/arcsec². */
  skyBrightness: number;
  /** Template id or theme tag; null/undefined = surprise me. */
  theme?: string | null;
  /** Desired stop count (3..10, default 5). */
  length?: number;
  /** Default 30, user may lower to 20 (spec 4). */
  minAlt?: number;
  /** Default 30, 20..40. */
  regionRadius?: number;
  /** Extra seed material (stable per UI session); the engine also hashes night/slot/site/instrument/theme. */
  seed?: string;
  /** 0 = canonical ranking; k ≥ 1 = k-th shuffle. */
  shuffle?: number;
  /** Open-sky directions; default all. */
  openDirections?: Compass8[];
  level?: 'first-night' | 'curious' | 'keen';
  includeChallenge?: boolean;
  /** Number of journeys to return (default 3). */
  limit?: number;
  /** Default 8 min per stop. */
  minutesPerStop?: number;
  seenObjectIds?: string[];
  /**
   * Objects the observer logged in the Planner (observedAt), as KB ids (object-links toKbId; `star:HR<n>` is also
   * accepted). Unioned with seenObjectIds: one "seen" for the whole app (r5).
   */
  observedIds?: string[];
  /**
   * Tonight's Best top objects (KB ids): each boosted stop adds a small bonus (search.BOOST_STOP_BONUS), so a
   * journey "from tonight's best" leans toward them without overriding the story. Absent/empty = no effect.
   */
  boostIds?: string[];
  /**
   * Stops the journeys should include whenever the sky allows (KB ids), e.g. "a journey from my night": a strong
   * beam bonus (search.MUST_STOP_BONUS) plus a ranking bonus by coverage (assemble.MUST_INCLUDE_RANK). Never
   * breaks a hard constraint; an object that is not feasible tonight is simply left out. Absent/empty = no effect.
   */
  mustInclude?: string[];
  /** IANA time zone, used only to render local times in diagnostics messages (engine math is UTC). */
  timezone?: string;
}

export type Darkness = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

/** S0 output: conditions for the night, shared by all candidates. */
export interface NightContext {
  seedKey: string;
  instant: string;
  lat: number;
  lon: number;
  sunAltDeg: number;
  darkness: Darkness;
  /** ISO times of astronomical dusk/dawn around `instant` (null at high-latitude summer). */
  astroDusk: string | null;
  astroDawn: string | null;
  moon: { up: boolean; altDeg: number; azDeg: number; ra: number; dec: number; illumination: number };
  skyBrightness: number;
  minAlt: number;
  regionRadius: number;
  /** Sample instants used by the candidate table (ISO). */
  samples: string[];
}

export type RejectReason =
  | 'altitude' | 'twilight' | 'moon-separation' | 'moon-glow' | 'binocular-rating'
  | 'extent' | 'direction' | 'region' | 'not-eligible' | 'story' | 'geometry';

/** S1 row: one KB object's feasibility tonight. */
export interface Candidate {
  objectId: string;
  /** Feasible for at least one stop window. */
  feasible: boolean;
  altStart: number;
  altMax: number;
  azStart: number;
  moonSepDeg: number | null;
  moonGlowMag: number;
  /** binocularAssessment rating (0..3). */
  rating: 0 | 1 | 2 | 3;
  /** Minutes the object stays above minAlt after `instant`. */
  minutesAboveMinAlt: number;
  rejectReasons: RejectReason[];
}

export interface StopLink {
  from: string;
  type: EdgeType;
  subtype: string;
  strength: number;
  reasonKey: string;
  curated: boolean;
}

export type GetThereMode = 'same-field' | 'sweep' | 'naked-eye-hop';

/**
 * Owner feedback round 2: a card must say why the object is in THIS journey. A theme lens is the theme-specific part
 * of a card, written per (archetype, object) in script/journeys/curated/lenses/<archetype>.json. The card's general
 * text (see, understand, wonder, numbers) is shared across themes; the lens fields replace or lead it.
 */
export interface ThemeLens {
  /** Position in the theme's storyline (ThemeStoryline.beats[].step); stops run in non-decreasing step order. */
  step: number;
  /** Short label of the object's role in this story, shown as a chip ("Newborn family", "Rung 2: cluster parallax"). */
  beat: string;
  /** Theme-specific question the card opens with (replaces card.question). */
  question: string;
  /** Why this object is in this story: its role in the thread, without giving away the answer. */
  why: string;
  /** What to look at for this theme, true for binoculars (replaces card.see when present). */
  look?: string;
  /** Theme-specific answer that also moves the thread forward (replaces card.answer). */
  answer: string;
  /**
   * The mechanism / how-we-know for THIS theme, 2–4 sentences (round 3 contract). When present it fills the card's
   * Story box and the object's general story (card.understand) moves under the collapsed "More about {name}".
   */
  story?: string;
  /**
   * Order of stops that share a beat: ascending rank first. Writers set it to the theme's own quantity (age for A5,
   * distance for A3, temperature for A2, …), so two stops on one beat run in the theme's order.
   */
  rank?: number;
  /**
   * Short verdict for this object in the theme's question, a noun phrase that reads after "turned out to be"
   * ("a real pair", "two strangers lined up by chance"). The payoff's {tally} lists the visited stops' verdicts.
   */
  verdict?: string;
  /**
   * Least binocular magnification at which this stop shows what its look promises, when the pair data alone would
   * allow less (a faint companion lost in a bright star's glare at 7×). Below it the object is no stop of this theme
   * (lensVisibleOk).
   */
  minMagnification?: number;
}

/** One beat of a theme's storyline: the ordered ideas a journey of that theme walks through. */
export interface StorylineBeat {
  step: number;
  label: string;
  /** Most stops a journey may spend on this beat (default 1). */
  maxStops?: number;
}

/** A theme's written storyline (lenses file header). */
export interface ThemeStoryline {
  archetype: string;
  /** One paragraph: the thread every journey of this theme follows. */
  storyline: string;
  beats: StorylineBeat[];
  /** Fewest distinct beats a journey of this theme must cover. */
  minBeats: number;
  /**
   * Beats a journey of this theme may end on (default: any). Cradle to grave must end on its last stage (owner
   * feedback r2, rule 5), not on an aging giant.
   */
  endSteps?: number[];
  /**
   * Beats a journey of this theme may open on (round 3 contract). Default: the lowest beat that has an in-reach
   * candidate (engine rule), so a theme opens at its first chapter whenever the sky allows it.
   */
  firstSteps?: number[];
  /**
   * Beats that carry the theme's turn (owner feedback r3: A9's strangers, the twist that makes the rest matter).
   * Leaving such a beat out while a candidate is in reach costs KEY_BEAT_FACTOR × the usual coverage price
   * (search.ts lensCoverageTerm). Default: none.
   */
  keySteps?: number[];
}

/**
 * Theme-lens transition lines ({prev}, {next}, plus the edge placeholders): `pairs["1>2"]` for a step from beat 1
 * to beat 2 (same-beat repeats use "2>2"), `arrive["3"]` for arriving at beat 3 from any earlier beat.
 */
export interface LensTransitions {
  pairs?: Record<string, string[]>;
  arrive?: Record<string, string[]>;
}

/**
 * One theme's lens set at runtime (client/public/data/journeys/lenses.json, built from
 * script/journeys/curated/lenses/<archetype>.json). The source file's `narration` keys are merged into the
 * narration bank by the build, so they are not repeated here.
 */
export interface ThemeLensSet extends ThemeStoryline {
  transitions?: LensTransitions;
  /** objectId → lens. An object without a lens is not used in this theme. */
  objects: Record<string, ThemeLens>;
}

/** client/public/data/journeys/lenses.json */
export interface LensesJsonFile { version: string; lenses: ThemeLensSet[] }

export interface JourneyStop {
  index: number;
  objectId: string;
  /** Story role label (template slot label), e.g. "Nursery". */
  role: string;
  arc: ArcRole;
  /** Edge used to arrive; null on stop 0. */
  link: StopLink | null;
  windowStart: string;
  windowEnd: string;
  altAtStart: number;
  azAtStart: number;
  moonSepDeg: number | null;
  challenge: boolean;
  /** Rendered transition text (FROM THE LAST STOP); null on stop 0. */
  transitionText: string | null;
  /** Rendered why-here text for this journey (overrides card.whyHere when present). */
  whyHereText?: string;
  getThere: {
    mode: GetThereMode;
    /** Distance in binocular fields (distance / fovDeg). */
    fields: number;
    distanceDeg: number;
    bearingText: string;
    /** Naked-eye anchor object/star id for 'naked-eye-hop'. */
    anchorId?: string;
  };
  /**
   * Text shown when the observer SKIPS this stop: bridges the previous stop (or the start) to the next one
   * (narration "skip.*" family). Absent on the last stop.
   */
  transitionSkipText?: string;
  /** Theme lens for the archetype this stop is told under (after a switch, the switched-to archetype). */
  lens?: ThemeLens;
}

export interface Journey {
  /** Stable key (hash of ordered object ids + template id); used in #/journeys/:key. */
  key: string;
  templateId: string;
  title: string;
  drivingQuestion: string;
  /** ≤90 chars. */
  hook: string;
  stops: JourneyStop[];
  regionCenter: { ra: number; dec: number; altDeg: number; azDeg: number; label: string };
  regionRadius: number;
  totalPathDeg: number;
  durationMin: number;
  difficulty: 'easy' | 'moderate' | 'stretch';
  difficultyReason?: string;
  score: number;
  /** 36-vector in FEATURE_NAMES order (present for training/debug). */
  features?: number[];
  bestWindow?: { start: string; end: string };
  /** 2–3 sentence overview paragraph (narrated; journey overview screen). */
  story?: string;
  /**
   * The narrated answer to the driving question (owner feedback r1: open with the question, end with its answer).
   * It lives only here, never in a stop's `whyHereText` or `transitionText`. lib/journeys/stop-card.ts
   * resolveStopCard hands it to the last payoff-arc stop (`ResolvedStopCard.payoff`), and the overview's card shows
   * it there without a label (owner feedback r2: no "Where it lands"). In field mode the last card leaves it out,
   * and the done screen shows it under the driving question.
   */
  payoff?: string;
  /** Bare region name used in titles ({region}), e.g. "Orion". */
  regionName?: string;
  /** Observing conditions behind this journey (conditions strip). */
  conditions?: JourneyConditions;
  /** The single archetype switch (spec decision 6), when the journey takes it. */
  switch?: JourneySwitch;
}

/** Spec decision 6: the journey changes archetype once, after the stop at `atStop` (that stop is the new theme's hook). */
export interface JourneySwitch {
  /** Index of the stop that closes the first theme and opens the second. */
  atStop: number;
  fromTemplateId: string;
  toTemplateId: string;
  /** Title of the target template ({theme} in the switch announcement). */
  toTitle: string;
}

/** NightContext summary for the UI's conditions strip (shared by every journey of one request). */
export interface JourneyConditions {
  instant: string;
  darkness: Darkness;
  sunAltDeg: number;
  /** Astronomical night (Sun < −18°) around the instant; null ends when the Sun never gets that low. */
  darkWindow: { start: string | null; end: string | null };
  moon: {
    up: boolean;
    illumination: number;
    altDeg: number;
    azDeg: number;
    /** Minimum Moon distance enforced tonight (degrees, scales with phase). */
    minSepDeg: number;
    /** Next moonrise / moonset after the instant (ISO) or null. */
    rise: string | null;
    set: string | null;
  };
  /** Krisciunas–Schaefer moonlight brightening limits (mag) per category. */
  glowLimits: { diffuse: number; cluster: number; star: number };
  /** Sun altitude limits: stars allow nautical twilight, deep sky needs astronomical night. */
  sunLimits: { star: number; dso: number };
  minAlt: number;
  regionRadius: number;
  skyBrightness: number;
  limitingFactors: LimitingFactor[];
  /** Relaxations this journey relies on (subset of diagnostics.relaxed). */
  relaxed?: string[];
  /** Closest Moon approach of any stop while the Moon is up (journey-level only). */
  closestMoonDeg?: number | null;
}

export type LimitingFactor = 'moon' | 'twilight' | 'altitude' | 'region' | 'kb';

export interface JourneyResult {
  journeys: Journey[];
  seedKey?: string;
  kbVersion?: string;
  modelVersion?: string;
  diagnostics: {
    reasonsRejected: Partial<Record<RejectReason, number>>;
    limitingFactors: LimitingFactor[];
    /** Plain-language explanation for the conditions strip / empty state. */
    message: string;
    relaxed?: string[];
    candidates?: number;
    validated?: number;
    scorer?: ScorerModel['type'];
    ms?: number;
  };
  /** Night summary for the conditions strip (also present when no journey fits). */
  conditions?: JourneyConditions;
}

/** UI builds against this; the worker client and the fixture mock both implement it. */
export interface JourneyEngineClient {
  generate(req: JourneyRequest): Promise<JourneyResult>;
}

// ───────────────────────────── learned scorer ─────────────────────────────

/** doc 05 §7.2 — frozen order; features.ts asserts equality with model.features at load. */
export const FEATURE_NAMES = [
  // geometry / path comfort (0..8)
  'n_stops', 'mean_hop_deg', 'max_hop_deg', 'path_over_cap', 'mean_turn_deg',
  'sharp_turns', 'reversals', 'cap_used', 'log_hop_fields',
  // observing quality (9..17)
  'min_alt', 'mean_alt', 'max_glow', 'min_moon_sep', 'mean_rating',
  'has_challenge', 'min_margin_min', 'twilight_stops', 'setting_first',
  // story / teaching / wonder (18..31)
  'edge_strength_mean', 'edge_strength_min', 'curated_edge_frac', 'edge_type_count',
  'kind_count', 'concept_count', 'progression_rho', 'interest_mean', 'interest_max',
  'opener_showpiece', 'finale_lift', 'superlative_count', 'scale_span', 'theme_drift',
  // content support + context (32..35)
  'fact_coverage', 'image_coverage', 'moon_illum', 'sky_brightness',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface HeuristicModel {
  type: 'heuristic';
  modelVersion: string;
  features: string[];
  /** Optional per-feature weights (same order as features); absent = engine's built-in heuristic h. */
  weights?: number[];
}

export interface LinearModel {
  type: 'linear';
  modelVersion: string;
  features: string[];
  mean: number[];
  std: number[];
  w: number[];
  b: number;
  metrics?: Record<string, number>;
}

/** One tree in parallel arrays; leaves are negative child indices (~leafIndex), see doc 05 §7.5. */
export interface GbdtTree {
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  v: number[];
}

export interface GbdtModel {
  type: 'gbdt';
  modelVersion: string;
  features: string[];
  base: number;
  trees: GbdtTree[];
  trainedOn?: { slates: number; date: string; kbVersion: string; featuresHash: string };
  metrics?: Record<string, number>;
}

export type ScorerModel = HeuristicModel | LinearModel | GbdtModel;
