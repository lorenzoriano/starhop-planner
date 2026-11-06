import { useMemo, useState, type ReactNode } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, CircleHelp, Eye, Images, Lightbulb, Maximize2, Navigation } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { eqToHorizontal, getConstellationName, type UnifiedTarget } from '@/lib/astronomy';
import type { BinocularProfile } from '@/lib/binocular-assessment';
import { objectSummary } from '@/lib/object-info';
import { moonState } from '@/lib/moon';
import { kbToUnifiedTarget, objectName, type LegReport } from '@/lib/object-links';
import { clockNightDate } from '@/lib/astronomical-clock';
import { visibilityWindow } from '@/lib/target-visibility';
import { horizonThresholdAt } from '@/lib/horizon/profile';
import { useLocalHorizon } from '@/hooks/use-local-horizon';
import { SURVEY_CREDITS, binocularMedia, primaryOpticalImage } from '@/lib/binocular-media';
import type { FactKey, Journey, JourneyStop, KbImage, KbObject, KnowledgeBase, StarObject } from '@/lib/journeys/types';
import {
  cardSources, compareWithPrevious, formatFactDisplay, formatFactRange, lightCurveShapeFor, lightLeft,
  objectTeff, relatableLine, relativeUncertainty, stopYear, visualReferenceIds, visualsFor, hrMarkers,
} from '@/lib/journeys/visual-data';
import { BinocularStarField } from '../BinocularStarField';
import { PhotoFieldPreview } from '../PhotoFieldPreview';
import { BinocularAssessment } from '../BinocularAssessment';
import { MoonlightCard } from '../MoonObservatory';
import { NightAltitudeChart } from '../ObservingVisuals';
import { ClusterAgeBar, CloudSize, DistanceLadder, HrMiniDiagram, LightCurveSketch, SizeComparison, TemperatureSwatch } from './visuals';
import { createGlossaryMarker, useGlossary } from './Glossary';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { catalogDetails, plainClass } from './plain-language-adapter';
import { resolveStopCard } from '@/lib/journeys/stop-card';
import { COMPASS_WORDS, NEUTRAL_BRIDGE, chapterOf, compassOf, getThereFor, journeySpine, journeyStory, legSummary, plannedFov, stopBeatLabel, stopRoleLine } from './journey-view';
import { StorySpine } from './StorySpine';
import './StopCard.css';

/** 'read' is the shell's name for 'overview' (a card opened on the Overview). */
export type StopCardMode = 'overview' | 'read' | 'field';

export interface StopCardProps {
  object: KbObject;
  stop: JourneyStop;
  journey: Journey;
  kb: KnowledgeBase;
  /** overview = opened on the Overview (with Get there); field = the field shell owns Get there, the photo is dimmed. */
  mode: StopCardMode;
  /** Objects of the earlier stops the observer saw, in stop order (HR trail, comparisons). */
  prevObjects?: KbObject[];
  /** Alternative to prevObjects: ids of earlier stops seen, oldest first (resolved through `kb`). */
  trailObjectIds?: string[];
  /**
   * Skip-aware "from the last stop" text chosen by the shell. undefined = use stop.transitionText and name the
   * link's source; null = no transition (stop 1, or the shell suppressed it).
   */
  transition?: { heading: string; text: string } | null;
  /** True binocular field in degrees (defaults to what the stop's get-there numbers imply, else 6.5°). */
  fovDeg?: number;
  /** Live altitude in degrees (field mode); defaults to the altitude at the start of the stop window. */
  altitudeDeg?: number;
  /**
   * Inside an overview stop item whose toggle already shows the number, beat and name: the card drops its own
   * beat line and title (the subtitle stays) and loses its outer frame.
   */
  embedded?: boolean;
  /**
   * The observing context for the app's shared widgets under "More" (BinocularAssessment, MoonlightCard,
   * NightAltitudeChart) and the catalog name line. `at` is the instant they describe: the stop's scheduled time on the
   * Overview, now in field mode. Without it (tests, previews) the card shows the story only.
   */
  sky?: StopCardSky;
  /** Star hop's report for the leg into this stop, when the journey's hop chain has been planned (its real hop count). */
  legReport?: LegReport | null;
}

export interface StopCardSky { targets: readonly UnifiedTarget[]; lat: number; lon: number; timezone: string; skyBrightness: number; profile: BinocularProfile; at: Date }

/** The shared Tonight widgets for a stop (inside "More"): the same numbers as Tonight, Moon and Binoculars. */
function SharedSkyWidgets({ target, sky }: { target: UnifiedTarget; sky: StopCardSky }) {
  const { lat, lon, timezone, at, skyBrightness, profile } = sky;
  const pos = useMemo(() => eqToHorizontal(target.ra, target.dec, lat, lon, at), [target.ra, target.dec, lat, lon, at]);
  const alt = pos.alt;
  // The site's skyline in the stop's direction, so the assessment says "Behind the hills" when it is (else unchanged).
  const { horizon } = useLocalHorizon(lat, lon);
  const horizonAlt = horizonThresholdAt(horizon, pos.az) ?? undefined;
  const moon = useMemo(() => moonState(lat, lon, at), [lat, lon, at]);
  const night = useMemo(() => visibilityWindow(clockNightDate(at, timezone), '12:00', '00:00', 'night', timezone, lat, lon), [at, timezone, lat, lon]);
  return <>
    <section className="jstop-more-section jstop-shared" data-testid="journey-stop-assessment" aria-label="In your binoculars tonight">
      <h4>In your binoculars at {formatInTimeZone(at, timezone, 'HH:mm')}</h4>
      <BinocularAssessment target={target} profile={profile} alt={alt} moon={moon} skyBrightness={skyBrightness} compact {...(horizonAlt !== undefined ? { horizonAlt, horizonAz: pos.az } : {})} />
    </section>
    <section className="jstop-more-section jstop-shared" data-testid="journey-stop-moonlight" aria-label="Moon effect">
      <h4>Moon effect</h4>
      <MoonlightCard target={target} lat={lat} lon={lon} date={at} skyBrightness={skyBrightness} />
    </section>
    <section className="jstop-more-section jstop-shared" data-testid="journey-stop-visibility" aria-label="Visibility tonight">
      <h4>Visibility tonight</h4>
      <NightAltitudeChart target={target} lat={lat} lon={lon} night={night} timezone={timezone} skyBrightness={skyBrightness} scheduledAt={at} selectedAt={at} />
    </section>
  </>;
}

// ───────────────────────────── pictures ─────────────────────────────

/** photo = a real photograph (Hubble, ESO, an observatory portrait); survey = a sky-survey field; infrared last. */
export type PictureKind = 'photo' | 'survey' | 'illustration' | 'infrared';
export interface GalleryImage extends LightboxImage { kind: PictureKind }

const href = (src: string) => (/^https?:|^\.\/|^\//.test(src) ? src : `./${src}`);
const KIND_RANK: Record<PictureKind, number> = { photo: 0, survey: 1, illustration: 2, infrared: 3 };
const KIND_LABEL: Record<PictureKind, string> = { photo: 'Photograph', survey: 'Sky-survey photograph', illustration: 'Illustration', infrared: 'Infrared view' };

function kindOf(i: KbImage): PictureKind {
  if (i.variant === 'infrared') return 'infrared';
  if (i.variant === 'illustration') return 'illustration';
  if (i.variant === 'photo' || i.variant === 'featured') return 'photo';
  // A survey cutout carries its field width; an optical image without one is a framed photograph.
  return i.fieldDeg ? 'survey' : 'photo';
}

/**
 * Every picture of an object for the card and the lightbox gallery, best first: real photographs before
 * survey fields, illustrations, then infrared. Falls back to the app's audited optical image and survey infrared.
 */
export function galleryImages(o: KbObject): GalleryImage[] {
  const name = o.names.display;
  // A star's close-up of a nebula around it (Hubble's Crescent Nebula for WR 136) contradicts a card that says the
  // binoculars show "a plain white point": for a star, a survey field leads and such a photo comes second (r4).
  const hasSurvey = o.media.images.some((i) => kindOf(i) === 'survey');
  const nebulaCloseUp = (i: KbImage) => o.kind === 'star' && hasSurvey && kindOf(i) === 'photo' && /nebula|\bgas\b|shell|filament/i.test(i.caption);
  const rank = (i: KbImage) => (nebulaCloseUp(i) ? KIND_RANK.survey + 0.5 : KIND_RANK[kindOf(i)]);
  const out: GalleryImage[] = o.media.images.map((i, k) => ({ i, k, kind: kindOf(i) }))
    .sort((a, b) => rank(a.i) - rank(b.i) || a.k - b.k)
    .map(({ i, kind }) => ({
      kind, src: href(i.src), large: i.large ? href(i.large) : undefined, caption: i.caption, credit: i.credit, license: i.license, sourceUrl: i.sourceUrl,
      label: KIND_LABEL[kind], alt: `${KIND_LABEL[kind]} of ${name}. ${i.caption}`.trim(),
    }));
  if (!out.some((g) => g.kind !== 'infrared')) {
    const p = primaryOpticalImage(o.id);
    if (p) {
      const kind: PictureKind = p.kind === 'portrait' ? 'photo' : 'survey';
      out.unshift({ kind, src: `./${p.path}`, caption: p.note, credit: p.credit, license: p.licenseName, sourceUrl: p.url, label: KIND_LABEL[kind], alt: `${KIND_LABEL[kind]} of ${name}. ${p.note}` });
    }
  }
  if (out.length && !out.some((g) => g.kind === 'infrared')) {
    const ir = binocularMedia(o.id)?.images.find((i) => i.variant === 'infrared' && i.display !== false);
    if (ir) out.push({ kind: 'infrared', src: href(ir.path), caption: SURVEY_CREDITS.infrared.note, credit: SURVEY_CREDITS.infrared.credit, license: 'Survey image', sourceUrl: ir.url, label: KIND_LABEL.infrared, alt: `Near-infrared view of ${name}.` });
  }
  const seen = new Set<string>();
  return out.filter((g) => (seen.has(g.src) ? false : (seen.add(g.src), true)));
}

/** The picture the card shows (the best of the gallery), or null when the object has none. */
export function choosePhoto(o: KbObject): GalleryImage | null {
  return galleryImages(o)[0] ?? null;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** True when `text` adds nothing: empty, or already said word for word in one of `others`. */
const repeats = (text: string | null | undefined, others: (string | null | undefined)[]) => {
  const t = text ? norm(text) : '';
  return !t || others.some((o) => !!o && norm(o).includes(t));
};

/** Remembered across cards in this session: whether "More" was left open in field mode (doc 06 §7). */
let moreOpenInField = false;

type BoxKind = 'see' | 'understand' | 'answer';

/** A box with an icon and a text label; colour is never the only cue (label + icon + border style). */
function Box({ kind, icon, title, children, testId }: { kind: BoxKind; icon: ReactNode; title: string; children: ReactNode; testId?: string }) {
  return <section className={`jbox jbox-${kind}`} data-section={kind} data-testid={testId} aria-label={title}>
    <h3 className="jbox-head"><span className="jbox-icon" aria-hidden="true">{icon}</span><span className="jbox-label">{title}</span></h3>
    <div className="jbox-body">{children}</div>
  </section>;
}

export function StopCard({ object, stop, journey, kb, mode: modeProp, prevObjects: prevProp, trailObjectIds, transition, fovDeg, altitudeDeg, embedded = false, sky, legReport }: StopCardProps) {
  const card = object.card;
  const mode: 'overview' | 'field' = modeProp === 'read' ? 'overview' : modeProp;
  const field = mode === 'field';
  const stopNumber = stop.index + 1;
  const refYear = stopYear(stop.windowStart);
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);
  // The app's own target when the stop is one (so simulations and assessments match Tonight), else the KB conversion.
  const target = useMemo(() => kbToUnifiedTarget(object, { targets: sky?.targets, missingMag: 6 }), [object, sky?.targets]);
  const isCatalogTarget = useMemo(() => !!sky?.targets.includes(target), [sky?.targets, target]);
  // One name per object on every tab (r5 UX #3): the title is the app's display label ("ET Cluster (NGC 457)"), the
  // same as Star hop, the Planner and Tonight; the theme's prose keeps its own wording.
  const label = useMemo(() => objectName(object as Parameters<typeof objectName>[0], sky?.targets).label, [object, sky?.targets]);
  // The app's one short description (lib/object-info), so this object reads the same on every tab; the journey's
  // story stays on top and this sits under More, "Also in the Catalog".
  // A generic line ("X is a star in Y.") says nothing the card has not: only a real description shows.
  const notes = useMemo(() => {
    const summary = sky ? objectSummary(object.id, { targets: sky.targets, ...(isCatalogTarget ? { target } : {}) }) : null;
    return summary && summary.source !== 'generic' ? summary : null;
  }, [sky, object.id, isCatalogTarget, target]);
  const [moreOpen, setMoreOpen] = useState(false);
  const gallery = useMemo(() => galleryImages(object), [object]);
  const photo = gallery[0] ?? null;
  const fov = Math.max(1, Math.min(12, fovDeg ?? plannedFov(stop, 6.5)));
  const glossary = useGlossary();
  // One marker per render: each glossary term is linked at its first appearance in this card only (reading order).
  const mark = createGlossaryMarker(glossary);

  const byId = useMemo(() => new Map(kb.objects.map((o) => [o.id, o])), [kb.objects]);
  const prevObjects = useMemo(() => prevProp ?? (trailObjectIds ?? []).flatMap((id) => { const o = byId.get(id); return o ? [o] : []; }), [prevProp, trailObjectIds, byId]);
  const prevWithNumbers = useMemo(() => prevObjects.map((o, k) => {
    const s = journey.stops.slice(0, stop.index).find((x) => x.objectId === o.id);
    return { obj: o, stopNumber: s ? s.index + 1 : k + 1 };
  }), [prevObjects, journey.stops, stop.index]);
  const fromObj = stop.link ? byId.get(stop.link.from) ?? prevObjects[prevObjects.length - 1] : undefined;

  const visuals = visualsFor(object);
  const refIds = visualReferenceIds(visuals);
  const sources = cardSources(object, kb.sources, refIds);
  const sourceById = new Map(kb.sources.map((s) => [s.id, s]));

  // The same words as Get there ("toward the east"), not an abbreviation (design review r4).
  const altText = `${Math.round(altitudeDeg ?? stop.altAtStart)}° up, toward the ${COMPASS_WORDS[compassOf(stop.azAtStart)]}`;
  const distance = object.facts.distanceLy;
  const lightLine = distance ? lightLeft(distance.value, refYear, relativeUncertainty(distance)) : null;
  const numbers = card.numbers.filter((n) => object.facts[n.factRef]);
  const topNumbers = numbers.slice(0, 4), moreNumbers = numbers.slice(4);

  const prevStar = [...prevObjects].reverse().find((o): o is StarObject => o.kind === 'star' && !!o.facts.radiusRsun);
  const prevCloud = [...prevObjects].reverse().find((o) => o.kind === 'dso' && !!o.facts.sizeLy);
  const allStops = journey.stops.map((s) => ({ obj: byId.get(s.objectId) ?? (s.objectId === object.id ? object : undefined), stopNumber: s.index + 1 }))
    .filter((s): s is { obj: KbObject; stopNumber: number } => !!s.obj);
  const teff = objectTeff(object);
  const star = object.kind === 'star' ? object : null;
  const curveShape = star ? (object.media.visuals.find((v) => v.type === 'light-curve') as { shape: Parameters<typeof LightCurveSketch>[0]['shape'] } | undefined)?.shape ?? lightCurveShapeFor(star.variability?.class) : null;

  // ── texts (the card reads: spine → question → picture → why in this journey → get there → see → story → answer → coda → payoff) ──
  // Owner feedback r2: the theme lens says why the object is in THIS journey. resolveStopCard (lib) decides which text
  // fills each box (lens first, then the narrated and shared card text); this component only lays it out.
  const resolved = useMemo(() => resolveStopCard(journey, stop, object), [journey, stop, object]);
  const lens = resolved.lensed ? stop.lens : undefined;
  const beatLabel = resolved.beat || stopBeatLabel(stop);
  const spine = useMemo(() => journeySpine(journey, kb), [journey, kb]);
  const chapter = lens ? chapterOf(spine, stop.index) : null;
  const roleLine = chapter ? stopRoleLine(stop, chapter.label) : null;
  const question = resolved.question;
  const fromText = transition !== undefined ? transition : stop.index > 0 && resolved.transition ? { heading: `From ${fromObj ? objectName(fromObj as Parameters<typeof objectName>[0], sky?.targets).label : 'the last stop'}`, text: resolved.transition } : null;
  const whyText = resolved.why;
  const seeText = resolved.look;
  const answerText = resolved.answer;
  // The generic skip bridge says nothing about the sky, so the box starts straight with why-here instead.
  const wayLead = fromText && fromText.text !== NEUTRAL_BRIDGE && !repeats(fromText.text, [whyText]) ? fromText : null;
  // Round 3 contract: a lens with its own story fills the Story box and the object's general story moves under
  // "More about {name}". r5 (voice.md rule 2): a story box always shows; should a lens story be missing, the shared
  // card's `understand` fills it (and then does not repeat under More).
  const lensStory = lens ? resolved.story || null : null;
  const storyText = lens ? lensStory ?? card.understand : card.understand;
  const asideText = lens && lensStory && !repeats(card.understand, [lensStory, whyText, answerText, seeText]) ? card.understand : null;
  const whyTitle = lens ? 'Why it’s in this journey' : 'On the way';
  const wonderText = repeats(resolved.wonder, [seeText, card.understand, answerText, whyText]) ? '' : resolved.wonder;
  const connectText = repeats(card.connect, [seeText, card.understand, answerText, whyText, wonderText]) ? '' : card.connect;
  const glanceText = repeats(card.glance, [seeText]) ? '' : card.glance;
  // The journey's answer (Journey.payoff) closes its payoff stop when the card has no payoff of its own.
  const journeyPayoff = !resolved.payoff && stop.arc === 'payoff' ? journeyStory(journey).payoff : null;
  // In the field the done screen shows the payoff right after Finish, so the last card does not say it first.
  const payoffText = field ? null : resolved.payoff ?? (journeyPayoff && !repeats(journeyPayoff, [answerText, whyText]) ? journeyPayoff : null);

  // Glossary marks follow reading order, so a term is linked where the reader first meets it.
  // (Embedded, the description is not shown, so it must not use up a term's first link.)
  const description = embedded ? null : mark(capitalize(plainClass(object)));
  const questionNode = question ? mark(question) : null;
  const fromNode = wayLead ? mark(wayLead.text) : null;
  const whyNode = whyText ? mark(whyText) : null;
  const glanceNode = glanceText ? mark(glanceText) : null;
  const getThereNode = !field ? mark(stop.getThere.bearingText) : null;
  const seeNode = mark(seeText);
  // The Story box must follow the lens or step aside (design review r2, the "cards are disjoint" complaint): a lens
  // stop shows the lens's own story when it has one; the object's general story (card.understand) moves under More.
  const storyNode = storyText ? mark(storyText) : null;
  const answerNode = answerText ? mark(answerText) : null;
  const payoffNode = payoffText ? mark(payoffText) : null;
  const wonderNode = wonderText ? mark(wonderText) : null;
  const connectNode = connectText ? mark(connectText) : null;
  const asideNode = asideText ? mark(asideText) : null;
  const historyNode = object.historyHook ? mark(object.historyHook.text) : null;
  const deeperNode = card.deeper ? mark(card.deeper) : null;

  const catalog = catalogDetails(object);
  // The same one-line leg summary as field mode's chip, counted from where the hop starts (the anchor for a jump), so
  // the meta never sets "a 19° jump" beside the directions' "two fields (8°)".
  const getThereMeta = field ? null : legSummary(getThereFor(journey, stop.index, stop.index - 1, byId, fov), legReport);
  const photoNote = card.notSee ?? card.photoCaption;

  const renderNumber = (n: (typeof numbers)[number]) => {
    const f = object.facts[n.factRef as FactKey]!;
    const range = formatFactRange(n.factRef, f);
    const src = sourceById.get(f.sourceId);
    const prevCmp = compareWithPrevious(n.factRef, object, prevWithNumbers);
    return (
      <div className="jstop-number" key={n.factRef} data-fact={n.factRef}>
        <dt>{n.label}</dt>
        <dd>
          <span className="jstop-number-value">{formatFactDisplay(n.factRef, f)}</span>
          <span className="jstop-number-relatable">{relatableLine(object, n.factRef, n.comparisonKey, kb.narration, { refYear, seed: object.id })}</span>
          {prevCmp && <span className="jstop-number-prev">{prevCmp}</span>}
          <details className="jstop-number-detail">
            <summary>{range ? 'Range & source' : 'Source'}</summary>
            {range && <p>Published range: {range}.</p>}
            <p>Method: {f.method === 'measured' ? 'measured' : f.method === 'model' ? 'from models' : f.method === 'derived' ? 'calculated from other measurements' : f.method === 'catalog' ? 'catalog value' : 'from the literature'}.</p>
            {src && <p><a href={src.url} target="_blank" rel="noreferrer">{src.citation ?? src.title} <span aria-label="opens online">↗</span></a></p>}
          </details>
        </dd>
      </div>
    );
  };

  const simulation = (
    <figure className="jstop-sim" data-testid="journey-stop-sim">
      <BinocularStarField target={target} center={target} width={fov} height={fov} shape="circle" mirrored={false} rotation={0} initialDepth={7.5} />
      <figcaption>In your binoculars <span>(simulated, {fov.toFixed(1)}° field)</span></figcaption>
    </figure>
  );

  return (
    <article className={`jstop jstop-${mode}${embedded ? ' jstop-embedded' : ''}`} data-testid="journey-stop-card" data-stop={stopNumber} data-object-id={object.id} data-lens={lens ? 'theme' : undefined}
      aria-labelledby={embedded ? undefined : `jstop-title-${stop.index}`} aria-label={embedded ? `Stop ${stopNumber}: ${label}` : undefined}>
      {/* Embedded in the overview, the grouped stop list already shows the thread; in the field the stepper shows the
          stop number, so only "next: …" stays (design review r2: no undecodable dot spine). */}
      {/* Field mode names the chapter in the header instead; "Next in the story" follows "I see it" there (r4). */}
      {!embedded && !field && <StorySpine beats={spine} current={stop.index} variant="compact" totalStops={journey.stops.length}/>}
      <header className="jstop-glance">
        {/* Design review r4: one gold label, the storyline chapter; the lens's role for this stop is a plain subtitle
            under the name, shown only when it adds to the chapter. */}
        {!embedded && <p className="jstop-role">
          <span className="jstop-beat" data-testid="journey-stop-beat">{chapter ? `Chapter ${chapter.n} of ${chapter.total} · ${chapter.label}` : beatLabel}</span>
          {stop.challenge && <span className="jstop-chip jstop-chip-challenge" title="Hard in binoculars; skip without guilt">◆ Challenge</span>}
        </p>}
        {!embedded && <h2 id={`jstop-title-${stop.index}`} className="jstop-title">{label}</h2>}
        {!embedded && chapter && roleLine && <p className="jstop-lensrole" data-testid="journey-stop-role">{roleLine}</p>}
        {/* The overview row already shows the kind and the altitude; the opened card adds only where to look. */}
        <p className="jstop-subtitle" data-testid="journey-stop-description">
          {embedded ? <>
            <span>In {getConstellationName(object.con)}</span>
            <span className="jstop-alt"> · toward the {COMPASS_WORDS[compassOf(stop.azAtStart)]}</span>
          </> : <>
            <span className="jstop-kind">{description}</span>
            <span> in {getConstellationName(object.con)}</span>
            <span className="jstop-alt"> · {altText}</span>
          </>}
        </p>
      </header>

      {questionNode && (
        <section className="jstop-question" data-testid="journey-stop-question" aria-label="The question">
          <span className="jstop-question-icon" aria-hidden="true"><CircleHelp size={20}/></span>
          <p className="jstop-question-text">{questionNode}</p>
        </section>
      )}

      {/* Why it is in THIS journey: an unboxed lead straight under the question (question → why → look → answer). */}
      {whyNode && (
        <section className="jstop-why" data-section="way" data-testid="journey-stop-why" aria-label={whyTitle}>
          <h3 className="sr-only">{whyTitle}</h3>
          {wayLead && <p className="jstop-from" data-testid="journey-stop-from-previous">{wayLead.heading}</p>}
          <p className="jstop-why-text">{fromNode && <>{fromNode}{' '}</>}{whyNode}</p>
        </section>
      )}

      <figure className={`jstop-hero${field ? ' jstop-photo-dimmed' : ''}`} data-testid="journey-stop-hero" data-kind={photo?.kind ?? 'none'}>
        {photo ? (
          <button type="button" className="jstop-photo-frame" data-testid="journey-stop-photo-toggle" onClick={() => setLightboxAt(0)}
            aria-label={`Enlarge the ${photo.label?.toLowerCase() ?? 'picture'} of ${label}${gallery.length > 1 ? ` (${gallery.length} pictures)` : ''}`} aria-haspopup="dialog">
            <img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" />
            <span className="jstop-photo-overlay" aria-hidden="true"><Maximize2 size={13}/>{gallery.length > 1 ? <><Images size={13}/>{gallery.length}</> : 'Enlarge'}</span>
          </button>
        ) : teff ? (
          <div className="jstop-photo-none" data-testid="journey-stop-visual-fallback"><TemperatureSwatch teffK={teff} name={label} compact /></div>
        ) : (
          <div className="jstop-photo-none jstop-wide" data-testid="journey-stop-visual-fallback">
            <BinocularStarField target={target} center={target} width={20} height={20} shape="circle" mirrored={false} rotation={0} initialDepth={5.5} />
          </div>
        )}
        <figcaption>
          {glanceNode && <p className="jstop-caption" data-testid="journey-stop-glance">{glanceNode}</p>}
          {/* One line on the card; the line opens the viewer, which shows the full credit, licence and source link. */}
          {photo ? (
            <button type="button" className="jstop-credit" onClick={() => setLightboxAt(0)} aria-haspopup="dialog" aria-label={`Picture credit: ${photo.credit}. Open the picture for the full credit and source`}>
              <span className="jstop-credit-text">{photo.label}: {photo.credit} · {photo.license}</span><span className="jstop-credit-more">details</span>
            </button>
          ) : <p className="jstop-credit">{teff ? 'Its color, from its measured temperature.' : 'Simulated naked-eye view, 20° around it.'}</p>}
        </figcaption>
      </figure>
      {lightboxAt !== null && gallery.length > 0 && <ImageLightbox images={gallery} start={lightboxAt} title={label} onClose={() => setLightboxAt(null)} />}

      {/* Planning view: Get there is one quiet line (field mode owns the directions). */}
      {getThereNode && (
        <p className="jstop-getthere" data-section="getthere" data-testid="journey-stop-getthere">
          <span className="jstop-getthere-icon" aria-hidden="true"><Navigation size={14}/></span>
          <span><strong>Get there</strong>{getThereMeta && <> · {getThereMeta}</>}. {getThereNode}</span>
        </p>
      )}

      <div className="jstop-boxes">
        <Box kind="see" icon={<Eye size={16}/>} title="What you’ll see" testId="journey-stop-expectation">
          <p>{seeNode}</p>
          {object.eventDependent && (
            <p className="jstop-notice" role="note">◇ {object.eventDependent.note}{object.eventDependent.checkUrl && <> <a href={object.eventDependent.checkUrl} target="_blank" rel="noreferrer">Check online ↗</a></>}</p>
          )}
          {simulation}
        </Box>

        {storyNode && (
          <Box kind="understand" icon={<Lightbulb size={16}/>} title="The story" testId="journey-stop-story">
            <p>{storyNode}</p>
          </Box>
        )}

        {answerNode && (
          <Box kind="answer" icon={<CheckCircle2 size={17}/>} title="The answer" testId="journey-stop-answer">
            <p className="jbox-answer-text">{answerNode}</p>
          </Box>
        )}

        {/* A lens stop ends on its answer: the object's general wonder and connection (often about another idea, e.g.
            a black hole on a record-breakers card) move under "More about {name}" (design review r4, owner-sim r3). */}
        {!resolved.codaUnderMore && (wonderNode || connectNode) && (
          <p className="jstop-coda" data-testid="journey-stop-coda">{wonderNode}{wonderNode && connectNode && ' '}{connectNode}</p>
        )}
        {payoffNode && (
          // Owner feedback r2: no label on the conclusion ("Where it lands" is gone); the box is just the payoff.
          <section className="jstop-payoff" data-testid="journey-stop-payoff" aria-label="The journey’s conclusion">
            <span className="jstop-payoff-mark" aria-hidden="true">✦</span>
            <p className="jstop-payoff-text">{payoffNode}</p>
          </section>
        )}
      </div>

      <details className="jstop-more" data-testid="journey-stop-more" open={field && moreOpenInField ? true : undefined}
        onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setMoreOpen(open); if (field) moreOpenInField = open; }}>
        <summary><span className="jstop-more-icon" aria-hidden="true"><BookOpen size={15}/></span><span className="jstop-more-label">More<small>{asideNode || (resolved.codaUnderMore && (wonderNode || connectNode)) ? `About ${label}, numbers, how we know, sources` : 'Numbers, how we know, catalog details, sources'}</small></span><ChevronDown className="jstop-more-chevron" size={18} aria-hidden="true"/></summary>
        <div className="jstop-more-body">
          {(asideNode || (resolved.codaUnderMore && (wonderNode || connectNode))) && (
            <section className="jstop-more-section" data-testid="journey-stop-aside" aria-label={`More about ${label}`}>
              <h4>More about {label}</h4>
              {asideNode && <p>{asideNode}</p>}
              {resolved.codaUnderMore && (wonderNode || connectNode) && <p className="jstop-more-coda" data-testid="journey-stop-coda">{wonderNode}{wonderNode && connectNode && ' '}{connectNode}</p>}
            </section>
          )}
          {/* r5: the app's shared widgets and the Catalog's description, so this object reads the same on every tab.
              Rendered only once More is open: the charts are not free. */}
          {sky && moreOpen && <SharedSkyWidgets target={target} sky={sky} />}
          {notes && (
            <section className="jstop-more-section jstop-catalog-notes" data-testid="journey-stop-catalog-notes" aria-label="Also in the Catalog">
              <h4>Also in the Catalog</h4>
              <p>{notes.text}</p>
              {notes.lookFor && <p className="jstop-catalog-finding">{notes.lookFor}</p>}
            </section>
          )}
          <section className="jstop-more-section" data-testid="journey-stop-numbers" aria-label="Numbers and sizes">
            <h4>Numbers &amp; sizes</h4>
            {topNumbers.length > 0 && <dl className="jstop-number-list">{topNumbers.map(renderNumber)}</dl>}
            {moreNumbers.length > 0 && (
              <details className="jstop-more-numbers"><summary>All numbers</summary><dl className="jstop-number-list">{moreNumbers.map(renderNumber)}</dl></details>
            )}
            {lightLine && <p className="jstop-lightleft">{lightLine.year ? `The light reaching your eye tonight left ${label} around ${lightLine.year}.` : `The light reaching your eye tonight set out about ${lightLine.ago} ago.`}</p>}
            {object.superlatives.slice(0, 1).map((s) => <p key={s.claim} className="jstop-record">Record: {s.claim} ({s.scope}).</p>)}
            <div className="jstop-visuals">
              {visuals.includes('temperature-swatch') && teff && <TemperatureSwatch teffK={teff} name={label} />}
              {visuals.includes('hr-diagram') && <HrMiniDiagram markers={hrMarkers(object, prevWithNumbers, stopNumber)} />}
              {visuals.includes('size-comparison') && object.facts.radiusRsun && (
                <SizeComparison id={object.id} name={label} radiusRsun={object.facts.radiusRsun.value}
                  prev={prevStar && prevStar.id !== object.id ? { id: prevStar.id, name: objectName(prevStar as Parameters<typeof objectName>[0], sky?.targets).label, radiusRsun: prevStar.facts.radiusRsun!.value } : null} />
              )}
              {visuals.includes('cloud-size') && object.facts.sizeLy && (
                <CloudSize name={label} sizeLy={object.facts.sizeLy.value} prev={prevCloud ? { name: objectName(prevCloud as Parameters<typeof objectName>[0], sky?.targets).label, sizeLy: prevCloud.facts.sizeLy!.value } : null} />
              )}
              {visuals.includes('light-curve') && star && curveShape && (
                <LightCurveSketch id={object.id} name={label} shape={curveShape} vMax={star.variability?.vMax ?? star.facts.vMax?.value} vMin={star.variability?.vMin ?? star.facts.vMin?.value}
                  periodDays={star.variability?.periodDays ?? star.facts.periodDays?.value} betaLyrae={star.variability?.class === 'eclipsing-beta-lyrae'} />
              )}
              {visuals.includes('age-bar') && <ClusterAgeBar stops={allStops.filter((s) => s.stopNumber <= stopNumber)} currentStopNumber={stopNumber} name={label} />}
              {visuals.includes('distance-ladder') && <DistanceLadder stops={allStops} refYear={refYear} currentStopNumber={stopNumber} />}
            </div>
          </section>

          {(deeperNode || historyNode) && (
            <section className="jstop-more-section" aria-label="How we know">
              <h4>How we know</h4>
              {deeperNode && <p className="jstop-deeper">{deeperNode}</p>}
              {historyNode && <p>{historyNode}</p>}
            </section>
          )}

          {photo && (
            <section className="jstop-more-section" aria-label="About the pictures">
              <h4>About the pictures</h4>
              {photoNote && <p>{photoNote}</p>}
              {!field && <PhotoFieldPreview target={target} field={{ width: fov, height: fov, shape: 'circle', label: 'Journey binoculars' }} inline />}
            </section>
          )}

          {catalog.length > 0 && (
            <section className="jstop-more-section jstop-catalog" data-testid="journey-stop-catalog" aria-label="Catalog details">
              <h4>Catalog details</h4>
              <dl>{catalog.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
            </section>
          )}

          {sources.length > 0 && (
            <section className="jstop-more-section" data-testid="journey-stop-sources" aria-label="Sources">
              <h4>Sources</h4>
              <ul className="jstop-source-list">
                {sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.citation ?? s.title} <span aria-label="opens online">↗</span></a>{s.citation ? <span className="jstop-source-title"> · {s.title}</span> : null}</li>)}
              </ul>
            </section>
          )}
        </div>
      </details>
    </article>
  );
}

