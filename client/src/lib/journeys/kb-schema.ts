/**
 * zod mirrors of ./types.ts plus whole-KB referential validation.
 *
 * - Shape: every schema below mirrors one interface in types.ts; the compile-time checks at the bottom fail
 *   `tsc` if the two drift apart.
 * - References: parseKnowledgeBase() also checks ids, sourceIds, concept ids, edge endpoints, factRefs,
 *   narration keys and numeric ranges (validateKnowledgeBaseRefs).
 * - Unknown keys are stripped (zod default), except FactValue and StopCard which are strict so that typos in
 *   curated prose/facts fail loudly instead of disappearing.
 */
import { z } from 'zod';
import {
  BATCH_IDS, EDGE_TYPES, FACT_KEYS, OBJECT_ROLES,
  type Concept, type ContextNode, type Edge, type FactKey, type GbdtModel, type KbObject, type KnowledgeBase,
  type LinearModel, type NarrationBank, type ScorerModel, type Source, type Template, type HeuristicModel,
  type JourneyRequest, type JourneyResult, type LensesJsonFile, type ThemeLens, type ThemeLensSet,
} from './types';
import { questionProblems, sentenceCount } from './voice';

const lit = <T extends readonly [z.Primitive, z.Primitive, ...z.Primitive[]]>(values: T) =>
  z.union(values.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>, ...z.ZodLiteral<T[number]>[]]);

const id = z.string().min(1);
const text = z.string().min(1);

// ───────────── facts & sources ─────────────

export const FactMethodSchema = z.enum(['measured', 'literature', 'derived', 'model', 'catalog']);
export const FactKeySchema = z.enum(FACT_KEYS);

export const FactValueSchema = z
  .object({
    value: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unit: z.string(),
    sourceId: id,
    method: FactMethodSchema,
    note: z.string().optional(),
  })
  .strict()
  .refine((f) => (f.min === undefined || f.min <= f.value) && (f.max === undefined || f.value <= f.max), {
    message: 'FactValue requires min ≤ value ≤ max',
  });

export const FactsSchema = z.record(FactKeySchema, FactValueSchema);

export const SourceSchema = z.object({
  id,
  title: text,
  url: z.string().url(),
  publisher: text,
  license: z.string().optional(),
  kind: z.enum(['catalog', 'paper', 'web', 'book', 'image', 'curator']).optional(),
  citation: z.string().optional(),
  bibcode: z.string().optional(),
  retrieved: z.string().optional(),
});

// ───────────── enums ─────────────

export const ObjectRoleSchema = z.enum(OBJECT_ROLES);
export const EvoStageSchema = lit([0, 1, 2, 3, 4, 5, 6, 7, 8] as const);
export const Score5Schema = lit([1, 2, 3, 4, 5] as const);
export const ViewGradeSchema = lit([0, 1, 2, 3, 4] as const);
export const BatchIdSchema = z.enum(BATCH_IDS);
export const EdgeTypeSchema = z.enum(EDGE_TYPES);

export const EvolutionaryStageSchema = z.enum([
  'pre-main-sequence', 'zams', 'main-sequence', 'terminal-main-sequence', 'subgiant',
  'red-giant-branch', 'red-clump', 'horizontal-branch', 'early-agb', 'tp-agb',
  'post-agb', 'blue-supergiant', 'yellow-supergiant', 'yellow-hypergiant', 'red-supergiant',
  'lbv', 'wolf-rayet', 'white-dwarf', 'binary-interacting', 'compact-companion-host',
]);

export const VariabilityClassSchema = z.enum([
  'eclipsing-algol', 'eclipsing-beta-lyrae', 'eclipsing-long-period', 'cepheid', 'rr-lyrae', 'delta-scuti',
  'beta-cephei', 'mira', 'semiregular', 'irregular', 'rv-tauri', 'gamma-cas-be', 'r-crb', 'recurrent-nova',
  'dwarf-nova', 'alpha2-cvn', 'lbv', 'yellow-hypergiant', 'young-stellar-object', 'rotational', 'none-detectable',
]);

export const DeepSkyClassSchema = z.enum([
  'hii-region', 'reflection-nebula', 'dark-nebula', 'nebula-complex',
  'embedded-cluster', 'open-cluster', 'ob-association', 'moving-group', 'globular-cluster',
  'star-cloud', 'asterism',
  'planetary-nebula', 'supernova-remnant', 'wind-bubble',
  'galaxy-spiral', 'galaxy-barred-spiral', 'galaxy-lenticular', 'galaxy-elliptical',
  'galaxy-dwarf-elliptical', 'galaxy-irregular',
  'milky-way-field',
]);

export const DeepSkyTraitSchema = z.enum([
  'starburst', 'active-nucleus', 'interacting', 'satellite', 'edge-on',
  'core-collapsed', 'former-dwarf-nucleus', 'retrograde-halo',
  'contains-red-supergiants', 'contains-red-giants', 'contains-white-dwarfs', 'dissolving',
  'pulsar', 'historical-supernova',
  'naked-eye', 'line-of-sight-pair',
]);

export const MisconceptionIdSchema = z.enum([
  'MC1', 'MC2', 'MC3', 'MC4', 'MC5', 'MC6', 'MC7', 'MC8', 'MC9', 'MC10', 'MC11', 'MC12', 'MC13', 'MC14', 'MC15',
]);

// ───────────── pedagogy, media, card ─────────────

export const TeachTagSchema = z.object({ conceptId: id, strength: lit([1, 2, 3] as const) });

export const SuperlativeSchema = z.object({
  claim: text,
  scope: text,
  sourceId: id,
  tag: z.string().optional(),
});

const gradePair = z.object({ suburban: ViewGradeSchema, dark: ViewGradeSchema });
export const BinocularViewSchema = z.object({
  '7x50': gradePair,
  '10x50': gradePair,
  basis: z.enum(['curator', 'derived', 'sketch-evidence']),
  evidenceIds: z.array(z.string()).optional(),
});

export const KbImageSchema = z.object({
  src: text,
  large: z.string().min(1).optional(),
  credit: text,
  license: text,
  caption: text,
  fieldDeg: z.number().positive().optional(),
  variant: z.enum(['optical', 'infrared', 'featured', 'photo', 'illustration']).optional(),
  sourceUrl: z.string().url().optional(),
});

export const KbVisualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('temperature-swatch') }),
  z.object({ type: z.literal('hr-diagram') }),
  z.object({ type: z.literal('size-comparison'), compareWith: z.array(z.string()).optional() }),
  z.object({ type: z.literal('light-curve'), shape: z.enum(['eclipsing', 'pulsating', 'mira', 'irregular', 'fading', 'nova']) }),
  z.object({ type: z.literal('age-bar') }),
  z.object({ type: z.literal('distance-bar') }),
  z.object({ type: z.literal('binocular-field'), fieldDeg: z.number().positive().optional() }),
]);

export const KbMediaSchema = z.object({ images: z.array(KbImageSchema), visuals: z.array(KbVisualSchema) });

export const CardNumberSchema = z.object({
  label: text,
  factRef: FactKeySchema,
  comparisonKey: z.string().optional(),
});

export const StopCardSchema = z
  .object({
    question: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    glance: text,
    whyHere: text,
    see: text,
    understand: text,
    /** Optional in practice: one sentence, or '' when it would only repeat the card (owner brief r2). */
    wonder: z.string(),
    connect: z.string(),
    numbers: z.array(CardNumberSchema).max(5),
    photoCaption: text,
    notSee: z.string().optional(),
    deeper: z.string().optional(),
    tier: z.enum(['showpiece', 'supporting']),
  })
  .strict();

export const EventDependenceSchema = z.object({
  kind: z.enum(['nova-pending', 'dust-fading', 'dimming', 'eclipse-season', 'lpv-phase', 'outburst']),
  note: text,
  checkUrl: z.string().url().optional(),
});

export const ProvenanceSchema = z.object({
  status: z.enum(['auto', 'seeded', 'curated', 'reviewed']),
  batch: BatchIdSchema.optional(),
  curatedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  overrides: z.array(z.string()).optional(),
  ineligibleReason: z.string().optional(),
});

// ───────────── objects ─────────────

export const KbNamesSchema = z.object({
  display: text,
  designation: z.string().optional(),
  aliases: z.array(z.string()),
  simbadId: z.string().optional(),
});

const baseShape = {
  id,
  hr: z.number().int().positive().optional(),
  names: KbNamesSchema,
  con: z.string().regex(/^[A-Z][a-zA-Z]{2}$/, 'IAU constellation abbreviation'),
  ra: z.number().min(0).lt(360),
  dec: z.number().min(-90).max(90),
  mag: z.number().finite().nullable(),
  facts: FactsSchema,
  evoStage: EvoStageSchema.nullable(),
  contextIds: z.array(id),
  teaches: z.array(TeachTagSchema),
  roles: z.array(ObjectRoleSchema),
  wow: Score5Schema,
  insight: Score5Schema,
  obsDifficulty: Score5Schema,
  superlatives: z.array(SuperlativeSchema),
  misconceptions: z.array(MisconceptionIdSchema),
  historyHook: z.object({ text, sourceId: id }).optional(),
  showpiece: z.boolean(),
  interest: z.number().min(0).max(1),
  media: KbMediaSchema,
  card: StopCardSchema,
  eventDependent: EventDependenceSchema.optional(),
  sources: z.array(id),
  provenance: ProvenanceSchema.optional(),
};

export const SpectralTypeSchema = z.object({ text, class: text, lumClass: z.string().optional(), sourceId: id });

export const VariabilitySchema = z.object({
  class: VariabilityClassSchema,
  gcvsType: z.string(),
  vMax: z.number(),
  vMin: z.number(),
  periodDays: z.number().positive().optional(),
  epochJD: z.number().optional(),
  binocularVisibleAtMin: z.boolean(),
  volatile: z.boolean(),
  sourceId: id,
});

export const MultiplicitySchema = z.object({
  components: z.array(z.object({
    label: text,
    spType: z.string().optional(),
    vMag: z.number().optional(),
    notes: z.string().optional(),
  })),
  pairs: z.array(z.object({
    pair: text,
    sepArcsec: z.number().nonnegative(),
    paDeg: z.number(),
    epoch: z.number(),
    magPrimary: z.number(),
    magSecondary: z.number(),
    physical: z.enum(['bound', 'common-proper-motion', 'optical', 'debated', 'unknown']),
    orbitPeriodYr: z.number().positive().optional(),
    sourceId: id,
  })),
  systemNote: z.string().optional(),
});

export const StarObjectSchema = z.object({
  ...baseShape,
  kind: z.literal('star'),
  spectral: SpectralTypeSchema.optional(),
  evolutionaryStage: EvolutionaryStageSchema.optional(),
  stageConfidence: z.enum(['established', 'likely', 'debated']).optional(),
  variability: VariabilitySchema.optional(),
  multiplicity: MultiplicitySchema.optional(),
  membershipRole: z.enum(['member', 'probable', 'foreground', 'background', 'escaped-runaway']).optional(),
  population: z.enum(['thin-disk', 'thick-disk', 'halo']).optional(),
  exoplanets: z.object({
    count: z.number().int().nonnegative(),
    firstDiscoveryYear: z.number().int(),
    method: text,
    status: z.enum(['confirmed', 'disputed']),
    sourceId: id,
  }).optional(),
  pmRA: z.number().optional(),
  pmDec: z.number().optional(),
  view: BinocularViewSchema.optional(),
});

export const PoweredByKindSchema = z.enum([
  'ionizing-stars', 'reflected-starlight', 'silhouette', 'central-star-uv',
  'pulsar-wind', 'shock-heating', 'stellar-wind', 'starlight', 'agn-plus-stars',
]);

export const DsoObjectSchema = z.object({
  ...baseShape,
  kind: z.literal('dso'),
  dsoClass: DeepSkyClassSchema,
  secondaryClasses: z.array(DeepSkyClassSchema).optional(),
  traits: z.array(DeepSkyTraitSchema).optional(),
  morphology: z.object({ hubble: text, sourceId: id }).optional(),
  extent: z.object({
    majorArcmin: z.number().positive(),
    minorArcmin: z.number().positive().optional(),
    paDeg: z.number().optional(),
    sourceId: id,
  }).optional(),
  poweredBy: z.object({
    kind: PoweredByKindSchema,
    starIds: z.array(id).optional(),
    sourceIds: z.array(id),
    note: z.string().optional(),
  }).optional(),
  view: BinocularViewSchema,
  appearance: z.object({
    moonTolerance: z.enum(['high', 'medium', 'low']),
    resolves: z.enum(['stars', 'partly', 'glow', 'silhouette']),
    bestFieldDeg: z.number().positive(),
    colorVisible: z.boolean(),
    filterHelps: z.enum(['OIII', 'UHC', 'H-beta']).optional(),
  }),
});

export const KbObjectSchema = z.discriminatedUnion('kind', [StarObjectSchema, DsoObjectSchema]);

export const ContextNodeSchema = z.object({
  id: z.string().regex(/^ctx:/, 'context ids start with "ctx:"'),
  kind: z.enum(['ob-association', 'molecular-complex', 'moving-group', 'galaxy-group', 'galaxy-cluster',
    'host-galaxy', 'galactic-structure', 'stellar-system']),
  name: text,
  parentId: z.string().optional(),
  memberIds: z.array(id),
  facts: FactsSchema,
  text: z.string().optional(),
  sources: z.array(id),
});

export const ConceptSchema = z.object({
  id,
  title: text,
  tier: lit([0, 1, 2, 3] as const),
  bigIdea: text,
  prereqs: z.array(id),
  terms: z.array(z.string()),
  parent: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  bridge: z.string().min(1).optional(),
});

export const FactRefSchema = z.object({ objectId: id, fact: FactKeySchema });

export const EdgeSchema = z.object({
  from: id,
  to: id,
  type: EdgeTypeSchema,
  subtype: z.string(),
  strength: z.number().min(0.2).max(1),
  reasonKey: id,
  factRefs: z.array(FactRefSchema).optional(),
  curated: z.boolean(),
  directed: z.boolean().optional(),
  sourceIds: z.array(id).optional(),
});

// ───────────── templates & narration ─────────────

export const ArcRoleSchema = z.enum(['hook', 'build', 'twist', 'payoff', 'coda']);
const range = z.object({ min: z.number().optional(), max: z.number().optional() });

export const SlotMatchSchema = z.object({
  kinds: z.array(z.enum(['star', 'dso'])).optional(),
  dsoClasses: z.array(DeepSkyClassSchema).optional(),
  roles: z.array(ObjectRoleSchema).optional(),
  anyConcepts: z.array(id).optional(),
  allConcepts: z.array(id).optional(),
  evoStageIn: z.array(EvoStageSchema).optional(),
  superlativeTags: z.array(id).optional(),
  minWow: z.number().optional(),
  maxObsDifficulty: z.number().optional(),
  minInterest: z.number().optional(),
  factRanges: z.record(FactKeySchema, range).optional(),
  hasMisconception: z.boolean().optional(),
  variabilityClasses: z.array(VariabilityClassSchema).optional(),
  hasHistoryHook: z.boolean().optional(),
});

export const TemplateSlotSchema = z.object({
  arc: ArcRoleSchema,
  label: text,
  match: SlotMatchSchema,
  optional: z.boolean().optional(),
  repeat: z.tuple([z.number().int().nonnegative(), z.number().int().positive()]).optional(),
  inEdges: z.array(EdgeTypeSchema).min(1).optional(),
});

export const SwitchRuleSchema = z.object({
  to: z.array(id).min(1),
  atArc: ArcRoleSchema,
  via: z.array(EdgeTypeSchema).min(1),
  minStrength: z.number().min(0.2).max(1),
  announceKey: id,
});

export const TemplateSchema = z.object({
  id,
  archetype: z.string().regex(/^A\d{1,2}$/),
  title: text,
  titleKeys: z.array(id),
  drivingQuestion: text,
  hookLine: z.string().min(1).max(90),
  themeTags: z.array(id),
  slots: z.array(TemplateSlotSchema).min(1),
  order: z.enum(['strict', 'partial', 'free']),
  swapGroups: z.array(z.array(z.number().int().nonnegative())).optional(),
  edges: z.array(EdgeTypeSchema).min(1),
  progression: z.object({
    property: z.union([FactKeySchema, z.literal('evoStage')]),
    direction: z.enum(['up', 'down', 'arc']),
  }).optional(),
  length: z.tuple([z.number().int().min(3), z.number().int().max(10)]),
  defaultLength: z.number().int().min(3).max(10),
  ingredients: z.object({
    roles: z.array(z.object({ anyOf: z.array(ObjectRoleSchema).min(1), min: z.number().int().positive() })).optional(),
    minDistinctEvoStages: z.number().int().positive().optional(),
    factSpans: z.array(z.object({ fact: FactKeySchema, minSpan: z.number().optional(), minRatio: z.number().optional() })).optional(),
    minStars: z.number().int().positive().optional(),
    minSuperlatives: z.number().int().positive().optional(),
    minHistoryHooks: z.number().int().positive().optional(),
    minSkyBrightness: z.number().optional(),
    maxMoonIllumination: z.number().min(0).max(1).optional(),
    minMoonIllumination: z.number().min(0).max(1).optional(),
  }),
  coreConcepts: z.array(id),
  moonFriendly: z.boolean(),
  needsDark: z.boolean(),
  kidFriendly: z.boolean(),
  chainTo: z.array(id).optional(),
  questionKeys: z.array(id).optional(),
  hookKeys: z.array(id).optional(),
  payoffKeys: z.array(id).optional(),
  orderingPrinciple: z.string().optional(),
  moonSuitability: z.enum(['bright-ok', 'partial', 'dark-only']).optional(),
  switchRule: SwitchRuleSchema.optional(),
});

export const NarrationBandSchema = z.object({
  suffix: id,
  min: z.number().optional(),
  max: z.number().optional(),
  fact: FactKeySchema.optional(),
});

export const NarrationBankSchema = z.object({
  version: text,
  variants: z.record(z.string(), z.array(text).min(1)),
  placeholders: z.record(z.string(), z.string()).optional(),
  bands: z.record(z.string(), z.array(NarrationBandSchema).min(1)).optional(),
  citations: z.record(z.string(), z.array(z.string().url()).min(1)).optional(),
});

// ───────────── theme lenses (owner feedback r2) ─────────────

export const ThemeLensSchema = z.object({
  step: z.number().int(),
  beat: text,
  question: text,
  why: text,
  look: z.string().min(1).optional(),
  answer: text,
  story: text.optional(),
  rank: z.number().finite().optional(),
  verdict: text.optional(),
  minMagnification: z.number().positive().optional(),
}).strict();

export const StorylineBeatSchema = z.object({
  step: z.number().int(),
  label: text,
  maxStops: z.number().int().min(1).max(4).optional(),
}).strict();

export const LensTransitionsSchema = z.object({
  pairs: z.record(z.string().regex(/^-?\d+>-?\d+$/, 'pair keys read "<step>><step>", e.g. "1>2"'), z.array(text).min(1)).optional(),
  arrive: z.record(z.string().regex(/^-?\d+$/, 'arrive keys are a beat step, e.g. "3"'), z.array(text).min(1)).optional(),
}).strict();

const lensSetShape = {
  archetype: z.string().regex(/^A\d{1,2}$/),
  storyline: text,
  beats: z.array(StorylineBeatSchema).min(2),
  minBeats: z.number().int().min(1),
  endSteps: z.array(z.number().int()).min(1).optional(),
  firstSteps: z.array(z.number().int()).min(1).optional(),
  keySteps: z.array(z.number().int()).min(1).optional(),
  transitions: LensTransitionsSchema.optional(),
  objects: z.record(id, ThemeLensSchema),
};

/** Runtime lens set (lenses.json). */
export const ThemeLensSetSchema = z.object(lensSetShape).strict();
/** Source lens file (script/journeys/curated/lenses/<archetype>.json): the runtime set plus narration overrides. */
export const ThemeLensFileSchema = z.object({ ...lensSetShape, narration: z.record(z.string(), z.array(text).min(1)).optional() }).strict();
export const LensesJsonFileSchema = z.object({ version: text, lenses: z.array(ThemeLensSetSchema) });

/**
 * Shape-independent checks of the lens sets against the KB: one set per archetype, an active template of that
 * archetype, distinct beat steps, minBeats within the beats, every object in the KB with a step from the beats, a
 * question of at most 16 words ending with "?", and transition keys naming real beats. Issues name the archetype
 * and object id.
 */
export function lensIssues(lenses: readonly ThemeLensSet[], kb: Pick<KnowledgeBase, 'objects' | 'templates'>): string[] {
  const issues: string[] = [];
  const objectIds = new Set(kb.objects.map((o) => o.id));
  const seen = new Set<string>();
  for (const L of lenses) {
    const w = `lens ${L.archetype}`;
    if (seen.has(L.archetype)) issues.push(`${w}: more than one lens set for this archetype`);
    seen.add(L.archetype);
    if (!kb.templates.some((t) => t.archetype === L.archetype)) issues.push(`${w}: no active template has archetype ${L.archetype}`);
    const steps = new Set<number>();
    for (const b of L.beats) {
      if (steps.has(b.step)) issues.push(`${w}: beat step ${b.step} appears twice`);
      steps.add(b.step);
    }
    if (L.minBeats > L.beats.length) issues.push(`${w}: minBeats ${L.minBeats} > ${L.beats.length} beats`);
    for (const e of L.endSteps ?? []) if (!steps.has(e)) issues.push(`${w}: endSteps names ${e}, which is not a beat`);
    for (const e of L.firstSteps ?? []) if (!steps.has(e)) issues.push(`${w}: firstSteps names ${e}, which is not a beat`);
    for (const e of L.keySteps ?? []) if (!steps.has(e)) issues.push(`${w}: keySteps names ${e}, which is not a beat`);
    for (const [oid, lens] of Object.entries(L.objects)) {
      const ow = `${w} object ${oid}`;
      if (!objectIds.has(oid)) issues.push(`${ow}: not in the KB`);
      if (!steps.has(lens.step)) issues.push(`${ow}: step ${lens.step} is not a beat (${Array.from(steps).join(', ')})`);
      for (const q of questionProblems(lens.question)) issues.push(`${ow}: ${q}`);
      for (const k of ['beat', 'why', 'answer'] as const) if (!lens[k].trim()) issues.push(`${ow}: empty ${k}`);
      if (lens.look !== undefined && !lens.look.trim()) issues.push(`${ow}: empty look`);
      if (lens.story !== undefined) {
        const n = sentenceCount(lens.story);
        if (n < 1 || n > 4) issues.push(`${ow}: story has ${n} sentences (1–4)`);
      }
      if (lens.rank !== undefined && !Number.isFinite(lens.rank)) issues.push(`${ow}: rank is not a number`);
    }
    for (const k of Object.keys(L.transitions?.pairs ?? {})) {
      const [a, b] = k.split('>').map(Number);
      if (!steps.has(a) || !steps.has(b)) issues.push(`${w}: transition pair "${k}" names a step that is not a beat`);
      else if (b < a) issues.push(`${w}: transition pair "${k}" goes back (stops run in non-decreasing step order)`);
    }
    for (const k of Object.keys(L.transitions?.arrive ?? {})) if (!steps.has(Number(k))) issues.push(`${w}: arrive "${k}" is not a beat`);
  }
  return issues;
}

// ───────────── scorer model ─────────────

export const HeuristicModelSchema = z.object({
  type: z.literal('heuristic'),
  modelVersion: text,
  features: z.array(z.string()),
  weights: z.array(z.number()).optional(),
});

export const LinearModelSchema = z.object({
  type: z.literal('linear'),
  modelVersion: text,
  features: z.array(z.string()),
  mean: z.array(z.number()),
  std: z.array(z.number()),
  w: z.array(z.number()),
  b: z.number(),
  metrics: z.record(z.string(), z.number()).optional(),
});

export const GbdtModelSchema = z.object({
  type: z.literal('gbdt'),
  modelVersion: text,
  features: z.array(z.string()),
  base: z.number(),
  trees: z.array(z.object({
    f: z.array(z.number().int()),
    t: z.array(z.number()),
    l: z.array(z.number().int()),
    r: z.array(z.number().int()),
    v: z.array(z.number()),
  })),
  trainedOn: z.object({ slates: z.number(), date: z.string(), kbVersion: z.string(), featuresHash: z.string() }).optional(),
  metrics: z.record(z.string(), z.number()).optional(),
});

export const ScorerModelSchema = z.discriminatedUnion('type', [HeuristicModelSchema, LinearModelSchema, GbdtModelSchema]);

// ───────────── engine I/O (for worker messages and tests) ─────────────

const compass = z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

export const JourneyRequestSchema = z.object({
  instant: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  instrument: z.object({
    fovDeg: z.number().positive(),
    aperture: z.number().positive(),
    magnification: z.number().positive(),
    stabilized: z.boolean().optional(),
  }),
  skyBrightness: z.number(),
  theme: z.string().nullable().optional(),
  length: z.number().int().min(3).max(10).optional(),
  minAlt: z.number().min(20).max(60).optional(),
  regionRadius: z.number().min(20).max(40).optional(),
  seed: z.string().optional(),
  shuffle: z.number().int().nonnegative().optional(),
  openDirections: z.array(compass).optional(),
  level: z.enum(['first-night', 'curious', 'keen']).optional(),
  includeChallenge: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  minutesPerStop: z.number().positive().optional(),
  seenObjectIds: z.array(z.string()).optional(),
  timezone: z.string().optional(),
  horizon: z.object({ kind: z.literal('geometric'), stepDeg: z.number().positive(), alt: z.array(z.number()) }).nullable().optional(),
});

const rejectReason = z.enum(['altitude', 'terrain', 'twilight', 'moon-separation', 'moon-glow', 'binocular-rating',
  'extent', 'direction', 'region', 'not-eligible', 'story', 'geometry']);

export const JourneyStopSchema = z.object({
  index: z.number().int().nonnegative(),
  objectId: id,
  role: text,
  arc: ArcRoleSchema,
  link: z.object({
    from: id, type: EdgeTypeSchema, subtype: z.string(), strength: z.number(), reasonKey: z.string(), curated: z.boolean(),
  }).nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  altAtStart: z.number(),
  azAtStart: z.number(),
  moonSepDeg: z.number().nullable(),
  challenge: z.boolean(),
  transitionText: z.string().nullable(),
  whyHereText: z.string().optional(),
  getThere: z.object({
    mode: z.enum(['same-field', 'sweep', 'naked-eye-hop']),
    fields: z.number().nonnegative(),
    distanceDeg: z.number().nonnegative(),
    bearingText: z.string(),
    anchorId: z.string().optional(),
  }),
  transitionSkipText: z.string().optional(),
  lens: ThemeLensSchema.optional(),
});

const limitingFactor = z.enum(['moon', 'twilight', 'altitude', 'terrain', 'region', 'kb']);
const darkness = z.enum(['day', 'civil', 'nautical', 'astronomical', 'night']);
const nullableIso = z.string().nullable();

export const JourneyConditionsSchema = z.object({
  instant: z.string(),
  darkness,
  sunAltDeg: z.number(),
  darkWindow: z.object({ start: nullableIso, end: nullableIso }),
  moon: z.object({
    up: z.boolean(), illumination: z.number(), altDeg: z.number(), azDeg: z.number(), minSepDeg: z.number(),
    rise: nullableIso, set: nullableIso,
  }),
  glowLimits: z.object({ diffuse: z.number(), cluster: z.number(), star: z.number() }),
  sunLimits: z.object({ star: z.number(), dso: z.number() }),
  minAlt: z.number(),
  regionRadius: z.number(),
  skyBrightness: z.number(),
  limitingFactors: z.array(limitingFactor),
  relaxed: z.array(z.string()).optional(),
  closestMoonDeg: z.number().nullable().optional(),
});

export const JourneySwitchSchema = z.object({
  atStop: z.number().int().nonnegative(),
  fromTemplateId: id,
  toTemplateId: id,
  toTitle: z.string(),
});

export const JourneySchema = z.object({
  key: id,
  templateId: id,
  title: text,
  drivingQuestion: text,
  hook: text,
  stops: z.array(JourneyStopSchema).min(1),
  regionCenter: z.object({ ra: z.number(), dec: z.number(), altDeg: z.number(), azDeg: z.number(), label: z.string() }),
  regionRadius: z.number(),
  totalPathDeg: z.number(),
  durationMin: z.number(),
  difficulty: z.enum(['easy', 'moderate', 'stretch']),
  difficultyReason: z.string().optional(),
  score: z.number(),
  features: z.array(z.number()).optional(),
  bestWindow: z.object({ start: z.string(), end: z.string() }).optional(),
  story: z.string().optional(),
  payoff: z.string().optional(),
  regionName: z.string().optional(),
  conditions: JourneyConditionsSchema.optional(),
  switch: JourneySwitchSchema.optional(),
});

export const JourneyResultSchema = z.object({
  journeys: z.array(JourneySchema),
  seedKey: z.string().optional(),
  kbVersion: z.string().optional(),
  modelVersion: z.string().optional(),
  diagnostics: z.object({
    reasonsRejected: z.record(rejectReason, z.number()),
    limitingFactors: z.array(z.enum(['moon', 'twilight', 'altitude', 'terrain', 'region', 'kb'])),
    message: z.string(),
    relaxed: z.array(z.string()).optional(),
    candidates: z.number().optional(),
    validated: z.number().optional(),
    scorer: z.enum(['heuristic', 'linear', 'gbdt']).optional(),
    ms: z.number().optional(),
  }),
  conditions: JourneyConditionsSchema.optional(),
});

// ───────────── files & whole KB ─────────────

export const KbJsonFileSchema = z.object({
  version: text,
  objects: z.array(KbObjectSchema),
  contexts: z.array(ContextNodeSchema),
  sources: z.array(SourceSchema),
});
export const ConceptsJsonFileSchema = z.object({ version: text, concepts: z.array(ConceptSchema) });
export const EdgesJsonFileSchema = z.object({ version: text, edges: z.array(EdgeSchema) });
export const TemplatesJsonFileSchema = z.object({ version: text, templates: z.array(TemplateSchema) });

export const KnowledgeBaseShapeSchema = z.object({
  version: text,
  objects: z.array(KbObjectSchema),
  contexts: z.array(ContextNodeSchema),
  concepts: z.array(ConceptSchema),
  edges: z.array(EdgeSchema),
  templates: z.array(TemplateSchema),
  narration: NarrationBankSchema,
  sources: z.array(SourceSchema),
  lenses: z.array(ThemeLensSetSchema).optional(),
});

/** Referential and cross-field checks. Returns human-readable issues (empty = valid). */
export function validateKnowledgeBaseRefs(kb: KnowledgeBase): string[] {
  const issues: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) issues.push(`duplicate ${kind} id "${x}"`);
      seen.add(x);
    }
    return seen;
  };
  const sourceIds = dup('source', kb.sources.map((s) => s.id));
  const objectIds = dup('object', kb.objects.map((o) => o.id));
  const contextIds = dup('context', kb.contexts.map((c) => c.id));
  const conceptIds = dup('concept', kb.concepts.map((c) => c.id));
  dup('template', kb.templates.map((t) => t.id));
  for (const x of Array.from(objectIds)) if (contextIds.has(x)) issues.push(`id "${x}" used by both an object and a context`);
  const nodeIds = new Set([...Array.from(objectIds), ...Array.from(contextIds)]);
  const narrationKeys = new Set(Object.keys(kb.narration.variants));

  const src = (where: string, sid: string | undefined) => {
    if (sid !== undefined && !sourceIds.has(sid)) issues.push(`${where}: unknown sourceId "${sid}"`);
  };
  const facts = (where: string, f: Partial<Record<FactKey, { sourceId: string }>>) => {
    for (const [k, v] of Object.entries(f)) if (v) src(`${where}.facts.${k}`, v.sourceId);
  };

  for (const o of kb.objects) {
    const w = `object ${o.id}`;
    facts(w, o.facts);
    o.sources.forEach((s) => src(`${w}.sources`, s));
    o.superlatives.forEach((s) => src(`${w}.superlatives`, s.sourceId));
    src(`${w}.historyHook`, o.historyHook?.sourceId);
    for (const t of o.teaches) if (!conceptIds.has(t.conceptId)) issues.push(`${w}: unknown conceptId "${t.conceptId}"`);
    for (const c of o.contextIds) if (!contextIds.has(c)) issues.push(`${w}: unknown contextId "${c}"`);
    for (const n of o.card.numbers) {
      if (!o.facts[n.factRef]) issues.push(`${w}: card number "${n.label}" refers to missing fact "${n.factRef}"`);
    }
    if (o.kind === 'star') {
      src(`${w}.spectral`, o.spectral?.sourceId);
      src(`${w}.variability`, o.variability?.sourceId);
      o.multiplicity?.pairs.forEach((p) => src(`${w}.multiplicity`, p.sourceId));
      src(`${w}.exoplanets`, o.exoplanets?.sourceId);
      if (o.variability && o.variability.vMin < o.variability.vMax) issues.push(`${w}: variability vMin must be ≥ vMax (fainter)`);
    } else {
      src(`${w}.morphology`, o.morphology?.sourceId);
      src(`${w}.extent`, o.extent?.sourceId);
      o.poweredBy?.sourceIds.forEach((s) => src(`${w}.poweredBy`, s));
      for (const s of o.poweredBy?.starIds ?? []) if (!nodeIds.has(s)) issues.push(`${w}: poweredBy star "${s}" not in KB`);
    }
  }
  for (const c of kb.contexts) {
    const w = `context ${c.id}`;
    facts(w, c.facts);
    c.sources.forEach((s) => src(`${w}.sources`, s));
    for (const m of c.memberIds) if (!objectIds.has(m)) issues.push(`${w}: unknown member "${m}"`);
    if (c.parentId && !contextIds.has(c.parentId)) issues.push(`${w}: unknown parentId "${c.parentId}"`);
  }
  for (const c of kb.concepts) {
    for (const p of c.prereqs) if (!conceptIds.has(p)) issues.push(`concept ${c.id}: unknown prereq "${p}"`);
    if (c.parent && !conceptIds.has(c.parent)) issues.push(`concept ${c.id}: unknown parent "${c.parent}"`);
  }
  const byId = new Map(kb.objects.map((o) => [o.id, o] as const));
  const ctxById = new Map(kb.contexts.map((c) => [c.id, c] as const));
  kb.edges.forEach((e, i) => {
    const w = `edge #${i} ${e.from}>${e.to}`;
    if (!nodeIds.has(e.from)) issues.push(`${w}: unknown from`);
    if (!nodeIds.has(e.to)) issues.push(`${w}: unknown to`);
    if (e.from === e.to) issues.push(`${w}: self-loop`);
    if (!narrationKeys.has(e.reasonKey)) issues.push(`${w}: reasonKey "${e.reasonKey}" missing from narration`);
    e.sourceIds?.forEach((s) => src(w, s));
    for (const r of e.factRefs ?? []) {
      const owner = byId.get(r.objectId) ?? ctxById.get(r.objectId);
      if (!owner?.facts[r.fact]) issues.push(`${w}: factRef ${r.objectId}.${r.fact} not found`);
    }
  });
  for (const t of kb.templates) {
    for (const k of t.titleKeys) if (!narrationKeys.has(k)) issues.push(`template ${t.id}: titleKey "${k}" missing from narration`);
    for (const c of t.coreConcepts) if (!conceptIds.has(c)) issues.push(`template ${t.id}: unknown core concept "${c}"`);
    if (t.length[0] > t.length[1]) issues.push(`template ${t.id}: length min > max`);
    if (t.defaultLength < t.length[0] || t.defaultLength > t.length[1]) issues.push(`template ${t.id}: defaultLength outside length`);
    // optional story-grammar extensions (questionKeys / hookKeys / payoffKeys / switchRule / inEdges / slot concepts)
    const keyGroups: [string, string[] | undefined][] = [['questionKey', t.questionKeys], ['hookKey', t.hookKeys], ['payoffKey', t.payoffKeys]];
    for (const [what, keys] of keyGroups) {
      for (const k of keys ?? []) if (!narrationKeys.has(k)) issues.push(`template ${t.id}: ${what} "${k}" missing from narration`);
    }
    for (const to of t.chainTo ?? []) if (!kb.templates.some((x) => x.id === to)) issues.push(`template ${t.id}: chainTo "${to}" unknown`);
    if (t.switchRule) {
      const sr = t.switchRule;
      if (!narrationKeys.has(sr.announceKey)) issues.push(`template ${t.id}: switchRule.announceKey "${sr.announceKey}" missing from narration`);
      for (const to of sr.to) if (!(t.chainTo ?? []).includes(to)) issues.push(`template ${t.id}: switchRule target "${to}" not in chainTo`);
    }
    t.slots.forEach((s, i) => {
      for (const et of s.inEdges ?? []) if (!t.edges.includes(et)) issues.push(`template ${t.id} slot ${i}: inEdge ${et} not in template edges`);
      for (const c of [...(s.match.anyConcepts ?? []), ...(s.match.allConcepts ?? [])]) {
        if (!conceptIds.has(c)) issues.push(`template ${t.id} slot ${i}: unknown concept "${c}"`);
      }
    });
  }
  if (kb.lenses) issues.push(...lensIssues(kb.lenses, kb));
  for (const [base, bands] of Object.entries(kb.narration.bands ?? {})) {
    for (const b of bands) {
      if (!narrationKeys.has(`${base}.${b.suffix}`)) issues.push(`narration band "${base}.${b.suffix}" has no variants`);
      if (b.min !== undefined && b.max !== undefined && b.min >= b.max) issues.push(`narration band "${base}.${b.suffix}": min ≥ max`);
    }
  }
  return issues;
}

export class KnowledgeBaseError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid knowledge base (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n- ${issues.slice(0, 50).join('\n- ')}`);
    this.name = 'KnowledgeBaseError';
  }
}

/** Parse + validate an assembled KB. Throws KnowledgeBaseError listing every shape and reference issue. */
export function parseKnowledgeBase(input: unknown): KnowledgeBase {
  const parsed = KnowledgeBaseShapeSchema.safeParse(input);
  if (!parsed.success) {
    throw new KnowledgeBaseError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const kb = parsed.data as KnowledgeBase;
  const issues = validateKnowledgeBaseRefs(kb);
  if (issues.length) throw new KnowledgeBaseError(issues);
  return kb;
}

/** The runtime files of client/public/data/journeys/ (spec decision 8); lenses.json is optional. */
export const KB_FILES = ['kb.json', 'concepts.json', 'edges.json', 'templates.json', 'narration.json'] as const;
export const LENSES_FILE = 'lenses.json';

/** Assemble the runtime files (spec decision 8) into one KB, then parse + validate. `lenses` (lenses.json) is optional. */
export function knowledgeBaseFromFiles(files: {
  kb: unknown; concepts: unknown; edges: unknown; templates: unknown; narration: unknown; lenses?: unknown;
}): KnowledgeBase {
  const kb = KbJsonFileSchema.parse(files.kb);
  const lenses = files.lenses === undefined || files.lenses === null ? undefined : (LensesJsonFileSchema.parse(files.lenses) as LensesJsonFile).lenses;
  return parseKnowledgeBase({
    version: kb.version,
    objects: kb.objects,
    contexts: kb.contexts,
    sources: kb.sources,
    concepts: ConceptsJsonFileSchema.parse(files.concepts).concepts,
    edges: EdgesJsonFileSchema.parse(files.edges).edges,
    templates: TemplatesJsonFileSchema.parse(files.templates).templates,
    narration: NarrationBankSchema.parse(files.narration),
    ...(lenses && lenses.length ? { lenses } : {}),
  });
}

/**
 * Same as knowledgeBaseFromFiles, reading each runtime file by name through `read` (Node scripts and tests pass a
 * reader over client/public/data/journeys/). `read` returns undefined for a missing optional file (lenses.json).
 */
export function knowledgeBaseFromReader(read: (name: string) => unknown): KnowledgeBase {
  return knowledgeBaseFromFiles({
    kb: read('kb.json'), concepts: read('concepts.json'), edges: read('edges.json'), templates: read('templates.json'),
    narration: read('narration.json'), lenses: read(LENSES_FILE),
  });
}

export function parseScorerModel(input: unknown): ScorerModel {
  return ScorerModelSchema.parse(input) as ScorerModel;
}

// ───────────── compile-time drift checks (types.ts ⇄ schemas) ─────────────

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _Source = Assert<Same<z.infer<typeof SourceSchema>, Source>>;
type _Object = Assert<Same<z.infer<typeof KbObjectSchema>, KbObject>>;
type _Context = Assert<Same<z.infer<typeof ContextNodeSchema>, ContextNode>>;
type _Concept = Assert<Same<z.infer<typeof ConceptSchema>, Concept>>;
type _Edge = Assert<Same<z.infer<typeof EdgeSchema>, Edge>>;
type _Template = Assert<Same<z.infer<typeof TemplateSchema>, Template>>;
type _Narration = Assert<Same<z.infer<typeof NarrationBankSchema>, NarrationBank>>;
type _Kb = Assert<Same<z.infer<typeof KnowledgeBaseShapeSchema>, KnowledgeBase>>;
type _Heur = Assert<Same<z.infer<typeof HeuristicModelSchema>, HeuristicModel>>;
type _Lin = Assert<Same<z.infer<typeof LinearModelSchema>, LinearModel>>;
type _Gbdt = Assert<Same<z.infer<typeof GbdtModelSchema>, GbdtModel>>;
type _Req = Assert<Same<z.infer<typeof JourneyRequestSchema>, JourneyRequest>>;
type _Res = Assert<Same<z.infer<typeof JourneyResultSchema>, JourneyResult>>;
type _Lens = Assert<Same<z.infer<typeof ThemeLensSchema>, ThemeLens>>;
type _LensSet = Assert<Same<z.infer<typeof ThemeLensSetSchema>, ThemeLensSet>>;
type _LensFile = Assert<Same<z.infer<typeof LensesJsonFileSchema>, LensesJsonFile>>;
