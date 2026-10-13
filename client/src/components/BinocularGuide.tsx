import { MoonlightCard } from "./MoonObservatory";
import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowUpRight, Binoculars, BookOpen, Check, Clock, Eye, MapPin, Navigation, Plus, Search, Star, WifiOff, X } from "lucide-react";
import { Button } from "./ui/button";
import { BinocularImages, BinocularPhoto } from "./BinocularImages";
import { binocularDatabaseResources, binocularMedia } from "@/lib/binocular-media";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { eqToHorizontal, getConstellationName, type SkyNode, type ConstellationLine, type DenseStar, type MilkyWayFeature, type Star as CatalogStar, type UnifiedTarget } from "@/lib/astronomy";
import { SkyChart } from "./SkyChart";
import { BinocularObservations } from "./BinocularObservations";
import { compassLabel, skyConditions } from "@/lib/observing";
import { BINOCULAR_BOOKS, BINOCULAR_ENTRIES, FAMILY_LABELS, LEVEL_LABELS, MONTH_NAMES, binocularCollection, binocularEvening, type BinocularFamily, type BinocularPick } from "@/lib/binocular-guide";

interface Props {
  onInspect?:(id:string)=>void;
  skyBrightness?: number;
  targets: UnifiedTarget[]; stars: CatalogStar[]; lat: number; lon: number;
  timezone: string; observingDate: Date; savedIds: Set<string>; loading: boolean;
  onSave: (id: string) => void; onPlan: (id: string, at: Date) => void;
  constellations: ConstellationLine[]; denseStars: DenseStar[]; milkyWay: MilkyWayFeature[];
  fovWidth: number; fovHeight: number; fovShape: "circle" | "rectangle"; limitingMag: number;
  onFovChange: (width: number) => void; onLimitingMagChange: (magnitude: number) => void;
}

export function BinocularGuide({ onInspect, skyBrightness = 21.6, targets, stars, lat, lon, timezone, observingDate, savedIds, loading, onSave, onPlan, constellations, denseStars, milkyWay, fovWidth, fovHeight, fovShape, limitingMag, onFovChange, onLimitingMagChange }: Props) {
  const currentYear = Number(formatInTimeZone(observingDate, timezone, "yyyy"));
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(Number(formatInTimeZone(observingDate, timezone, "M")));
  const [family, setFamily] = useState<BinocularFamily | "all">("all");
  const [level, setLevel] = useState("all");
  const [smallOnly, setSmallOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [aboveOnly, setAboveOnly] = useState(true);
  const [seasonalOnly, setSeasonalOnly] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const collection = useMemo(() => binocularCollection(targets, lat, lon, year, month, timezone), [targets, lat, lon, year, month, timezone]);
  const at = useMemo(() => binocularEvening(year, month, timezone), [year, month, timezone]);
  const conditions = useMemo(() => skyConditions(lat, lon, at), [lat, lon, at]);
  const matches = (pick: BinocularPick) => (family === "all" || pick.family === family)
    && (!smallOnly || (pick.minAperture ?? 50) <= 50)
    && (level === "all" || pick.level === level)
    && `${pick.target.name} ${pick.name ?? ""} ${pick.target.id} ${getConstellationName(pick.target.con)}`.toLowerCase().includes(query.toLowerCase());
  const picks = collection.filter((p) => matches(p) && (!aboveOnly || p.alt >= 15) && (!seasonalOnly || p.bestMonths.includes(month)));
  const featured = picks.find((p) => p.level === "easy") ?? picks[0];
  const detail = collection.find((p) => p.targetId === opened);
  const fieldNodes = useMemo<SkyNode[]>(() => detail ? stars.filter((s) => s.mag <= limitingMag).map((s) => ({ ...s, ...eqToHorizontal(s.ra, s.dec, lat, lon, at), name: s.name || s.bayer || s.id, type: "star" as const })) : [], [stars, limitingMag, detail?.targetId, lat, lon, at]);
  const fieldTarget: SkyNode | null = detail ? { ...detail.target, alt: detail.alt, az: detail.az, type: detail.target.source === "messier" ? "messier" : "binocular", constellation: detail.target.con } : null;
  const place = `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
  const sampleLabel = formatInTimeZone(at, timezone, "MMM d, yyyy · HH:mm");
  const years = Array.from(new Set([currentYear - 1, currentYear, currentYear + 1, year])).sort();
  const selectMonth = (value: number) => { setMonth(value); setVisibleCount(12); };
  const reset = () => { setFamily("all"); setLevel("all"); setQuery(""); setSmallOnly(false); setAboveOnly(false); setSeasonalOnly(false); setVisibleCount(12); };

  return (
    <div className="binocular-guide" data-testid="binocular-guide">
      <div className="page-heading binocular-heading">
        <div>
          <p className="eyebrow">THE BINOCULAR OBSERVATORY</p>
          <h1>Two eyes. A whole sky<span>.</span></h1>
          <p>A year of small discoveries, from familiar stars to faraway islands of light.</p>
        </div>
        <div className="binocular-heading-mark" aria-hidden="true"><Binoculars strokeWidth={1} /></div>
      </div>

      <section className="binocular-calendar" aria-label="Monthly binocular guide">
        <div className="binocular-calendar-heading">
          <div><span className="eyebrow">TWELVE CHAPTERS, ONE SKY</span><h2>Where will {MONTH_NAMES[month - 1]} take you?</h2></div>
          <label className="binocular-year">Planning year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Binocular planning year">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <div className="binocular-months" role="group" aria-label="Choose a month">
          {MONTH_NAMES.map((name, i) => {
            const count = collection.filter((p) => (!smallOnly || (p.minAperture ?? 50) <= 50) && p.bestMonths.includes(i + 1) && (!aboveOnly || p.monthlyAltitudes[i] >= 15)).length;
            return <button key={name} className={month === i + 1 ? "active" : ""} aria-pressed={month === i + 1} onClick={() => selectMonth(i + 1)} data-testid={`binocular-month-${i + 1}`}>
              <span>{String(i + 1).padStart(2, "0")}</span><strong>{name.slice(0, 3)}</strong><small>{loading ? "…" : `${count} picks`}</small>
            </button>;
          })}
        </div>
        <div className="binocular-calendar-context">
          <span><MapPin size={13} /> {place}</span><span><Clock size={13} /> {sampleLabel} local</span><span>{conditions.darkness}</span>
        </div>
        <p className="binocular-method-note">Monthly picks are best placed around 21:00 on the 15th, calculated for your location. Check your actual observing time before heading out; weather and local obstructions are not included.</p>
      </section>

      {featured && (
        <section className="binocular-feature panel">
          <div className="binocular-feature-copy">
            <span className="eyebrow">A GOOD PLACE TO BEGIN · {MONTH_NAMES[month - 1].toUpperCase()}</span>
            <h2>{featured.name ?? featured.target.name}</h2>
            <p>{featured.impression}</p>
            <div className="binocular-meta"><span><Binoculars size={14} /> {featured.equipment}</span><span>{Math.round(featured.alt)}° {compassLabel(featured.az)} at 21:00</span></div>
            <button className="text-action" onClick={() => setOpened(featured.targetId)}>Explore this field <ArrowUpRight size={15} /></button>
          </div>
          <div className="binocular-feature-field"><BinocularPhoto id={featured.targetId} name={featured.name ?? featured.target.name} /><span className="binocular-field-caption">DSS2 optical survey · telescope photograph</span></div>
        </section>
      )}
      {!conditions.isDark && !loading && <p className="twilight-note binocular-twilight">At the sample time, the Sun is {Math.round(conditions.sunAlt)}° high. Bright stars may suit this window; faint deep-sky objects need a later, darker sky.</p>}

      <section className="binocular-collection">
        <div className="section-heading"><div><span className="eyebrow">LET THE FIELD SURPRISE YOU</span><h2>{seasonalOnly ? `${MONTH_NAMES[month - 1]}’s collection` : "The binocular collection"}</h2></div><span>{picks.length} of {BINOCULAR_ENTRIES.length} curated targets</span></div>
        <div className="binocular-family-tabs" role="group" aria-label="Binocular target type">
          <button className={family === "all" ? "active" : ""} aria-pressed={family === "all"} onClick={() => { setFamily("all"); setVisibleCount(12); }}>All discoveries</button>
          {(Object.keys(FAMILY_LABELS) as BinocularFamily[]).map((type) => <button key={type} className={family === type ? "active" : ""} aria-pressed={family === type} onClick={() => { setFamily(type); setVisibleCount(12); }}>{FAMILY_LABELS[type]}</button>)}
        </div>
        <div className="binocular-toolbar">
          <label className="binocular-search"><Search size={15} /><input aria-label="Search binocular targets" placeholder="A name, constellation, or catalog number…" value={query} onChange={(e) => { setQuery(e.target.value); setVisibleCount(12); }} />{query && <button onClick={() => setQuery("")} aria-label="Clear binocular search"><X size={14} /></button>}</label>
          <select aria-label="Binocular observing difficulty" value={level} onChange={(e) => { setLevel(e.target.value); if (e.target.value === "large") setSmallOnly(false); setVisibleCount(12); }}><option value="all">All observing levels</option>{Object.entries(LEVEL_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
          <button className={`filter-toggle ${smallOnly ? "active" : ""}`} aria-pressed={smallOnly} onClick={() => { if (!smallOnly && level === "large") setLevel("all"); setSmallOnly(!smallOnly); setVisibleCount(12); }}><Binoculars size={14} /> Small binoculars</button>
          <button className={`filter-toggle ${aboveOnly ? "active" : ""}`} aria-pressed={aboveOnly} onClick={() => setAboveOnly(!aboveOnly)}><Eye size={14} /> Above 15°</button>
          <button className={`filter-toggle ${seasonalOnly ? "active" : ""}`} aria-pressed={seasonalOnly} onClick={() => setSeasonalOnly(!seasonalOnly)}><Clock size={14} /> Monthly picks</button>
        </div>

        {loading ? <div className="panel empty-state"><Binoculars size={28} /><p>Opening the binocular field guide…</p></div> : !picks.length ? (
          <div className="panel empty-state"><Star size={28} /><h3>A different window may open the sky.</h3><p>No targets match these filters at this location and time. Try another month or browse the full collection.</p><Button variant="outline" onClick={reset}>Browse all binocular targets</Button></div>
        ) : (
          <div className="binocular-target-grid">
            {picks.slice(0, visibleCount).map((p) => <article className={`binocular-target-card level-${p.level}`} key={p.targetId}>
              <button className="binocular-target-main" onClick={() => setOpened(p.targetId)} aria-label={`Explore binocular target ${p.name ?? p.target.name}`} data-testid={`binocular-target-${p.targetId}`}>
                <div className="binocular-target-field"><BinocularPhoto id={p.targetId} name={p.name ?? p.target.name} /><span className="binocular-family-label">{FAMILY_LABELS[p.family]}</span><span className="binocular-photo-label">DSS2 · OPTICAL SURVEY</span></div>
                <div className="binocular-target-body"><span className="eyebrow">{p.target.id.replace("STAR-", "")} · {getConstellationName(p.target.con)}</span><h3>{p.name ?? p.target.name}</h3><p>{p.impression}</p><div className="binocular-card-position"><span className={p.alt < 15 ? "low" : ""}>{p.neverRises ? "Never rises here" : p.alt < 0 ? "Below horizon at 21:00" : `${Math.round(p.alt)}° ${compassLabel(p.az)} at 21:00`}</span><span>{p.variable ? "Variable star" : `mag ${p.target.mag.toFixed(1)}`}</span></div></div>
              </button>
              <div className="binocular-target-bottom"><span>{LEVEL_LABELS[p.level]}</span><button className={savedIds.has(p.targetId) ? "saved" : ""} onClick={() => onSave(p.targetId)} aria-label={`${savedIds.has(p.targetId) ? "Remove" : "Save"} ${p.name ?? p.target.name}`} aria-pressed={savedIds.has(p.targetId)}>{savedIds.has(p.targetId) ? <Check size={17} /> : <Plus size={17} />}</button></div>
            </article>)}
          </div>
        )}
        {picks.length > visibleCount && <button className="load-more" onClick={() => setVisibleCount(visibleCount + 12)}>More fields to discover <ArrowUpRight size={14} /></button>}
        <p className="binocular-collection-note"><WifiOff size={14} /> Every target has optical and infrared survey images, a finder chart, and sources. Images travel offline once “Offline ready” appears; external databases need a connection.</p>
        <p className="binocular-method-note">Small binoculars shows targets selected for instruments up to 50 mm. Turn it off to include the mounted 80 mm collection. Targets can be useful in several months; monthly counts reflect your location and filters.</p>
      </section>

      <section className="binocular-books">
        <div className="section-heading"><div><span className="eyebrow">GOOD COMPANY ON THE BOOKSHELF</span><h2>From observers who know the sky.</h2></div><BookOpen size={23} /></div>
        <p className="binocular-books-intro">An original selection informed by published guides and public author notes. Each target links to its evidence; an index entry confirms book coverage, while an author article supports its observing guidance.</p>
        <div className="binocular-book-grid">{BINOCULAR_BOOKS.map((book) => <a className={`binocular-book book-${book.color}`} key={book.author} href={book.url} target="_blank" rel="noreferrer"><div className="binocular-book-spine"><span>{book.mark}</span><BookOpen size={25} strokeWidth={1} /><small>THE OBSERVING SHELF</small></div><div><h3>{book.title}</h3><span>{book.author}</span><p>{book.note}</p><small>View the reference <ArrowUpRight size={12} /></small></div></a>)}</div>
        <details className="binocular-provenance"><summary>About the selection and the month-by-month calendar</summary><p>We checked target names against O’Meara’s publisher index and supplemented them with Harrington’s binocular tours, Tonkin’s BinocularSky notes, and the Astronomical League’s small-binocular, 80 mm, deep-sky and southern-sky programs. The collection is not a reproduction of a book’s complete observing list. StarHop’s short notes and finder maps are original.</p><p>For each target, StarHop computes altitude at 21:00 local time on the 15th of each month. Monthly picks are above 40° or within 18° of that target’s highest sampled evening altitude; the Above 15° filter removes low fields. Month labels stay in calendar order in both hemispheres: latitude changes altitude and horizon access, rather than reversing the sky’s calendar. This is a planning guide, not a visibility or weather guarantee. Variable-star brightness and eclipse times are not forecast.</p><p>Images are archived optical DSS2 and near-infrared 2MASS mosaics, served by <a href="https://alasky.cds.unistra.fr/hips-image-services/hips2fits" target="_blank" rel="noreferrer">CDS HiPS2FITS</a>. Each target provides credits, source cutouts, and use policies. They show telescope survey data, not a binocular view.</p><p>Inspired by the <a href="https://www.cloudynights.com/forums/topic/858306-best-binocular-targets-book/" target="_blank" rel="noreferrer">Cloudy Nights discussion of binocular observing books</a>.</p></details>
      </section>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setOpened(null); }}>
        <DialogContent className="binocular-detail">
          {detail && <>
            <DialogHeader><span className="eyebrow">{FAMILY_LABELS[detail.family]} · {detail.target.id}</span><DialogTitle>{detail.name ?? detail.target.name}</DialogTitle><DialogDescription>{getConstellationName(detail.target.con)} · {LEVEL_LABELS[detail.level]} · {detail.equipment}</DialogDescription></DialogHeader>
            <div className="binocular-detail-chart"><SkyChart onSelect={onInspect} key={detail.targetId} nodes={fieldTarget ? [...fieldNodes, fieldTarget] : fieldNodes} constellations={constellations} denseStars={denseStars} milkyWay={milkyWay} route={null} targetNode={fieldTarget} animStep={0} fovWidth={fovWidth} fovHeight={fovHeight} fovShape={fovShape} limitingMag={limitingMag} lat={lat} lon={lon} date={at} onFovChange={onFovChange} onLimitingMagChange={onLimitingMagChange} /></div>
            <MoonlightCard target={detail.target} lat={lat} lon={lon} date={at} skyBrightness={skyBrightness} />
            <div className="binocular-detail-notes"><div><h3>What to look for</h3><p>{detail.impression}</p></div><div><h3>Start here</h3><p>{detail.finding}</p></div></div>
            <BinocularObservations id={detail.targetId} />
            <details className="binocular-reference-photos"><summary>Reference photographs · optical, infrared & telescope views</summary><BinocularImages key={detail.targetId} id={detail.targetId} name={detail.name ?? detail.target.name} /></details>
            <div className="binocular-year-path"><span className="eyebrow">A YEAR IN YOUR SKY · ALTITUDE AT 21:00 ON THE 15TH</span><div className="binocular-altitude-months">{detail.monthlyAltitudes.map((alt, i) => <button key={i} className={month === i + 1 ? "active" : ""} onClick={() => selectMonth(i + 1)} aria-label={`${MONTH_NAMES[i]}, altitude ${Math.round(alt)} degrees at 21:00`} aria-pressed={month === i + 1}><span className="binocular-altitude-bar"><i style={{ height: `${Math.max(3, Math.max(0, alt) / 90 * 100)}%` }} className={alt < 15 ? "low" : ""} /></span><small>{MONTH_NAMES[i].slice(0, 3)}</small></button>)}</div><p>{detail.neverRises ? "This target never rises at your latitude. Change your observing location to explore its southern sky." : `${sampleLabel}: ${Math.round(detail.alt)}° ${compassLabel(detail.az)}. ${detail.alt < 15 ? "This is low or below the horizon; try another month or time." : "Aim for higher altitude and an unobstructed view."}`}</p></div>
            <div className="binocular-detail-actions"><Button disabled={detail.alt < 5} onClick={() => { setOpened(null); onPlan(detail.targetId, at); }}><Navigation size={15} /> Plan binocular hop</Button><button className={`save-button ${savedIds.has(detail.targetId) ? "saved" : ""}`} aria-label={`${savedIds.has(detail.targetId) ? "Remove from" : "Add to"} my night`} onClick={() => onSave(detail.targetId)}>{savedIds.has(detail.targetId) ? <Check size={18} /> : <Plus size={18} />}</button><span>Plans for {sampleLabel} local</span></div>
            {eqToHorizontal(detail.target.ra, detail.target.dec, lat, lon, observingDate).alt >= 5 && <button className="text-action" onClick={() => { setOpened(null); onPlan(detail.targetId, observingDate); }}>Use my current observing time instead <ArrowUpRight size={13} /></button>}
            <div className="binocular-detail-sources"><h3><BookOpen size={14} /> Follow the observer’s trail</h3>{detail.references.map((ref) => <a key={ref.url + ref.title} href={ref.url} target="_blank" rel="noreferrer">{ref.title}<ArrowUpRight size={12} /></a>)}<h3>Explore the public databases</h3>{binocularDatabaseResources(detail.target, binocularMedia(detail.targetId)?.fov ?? 2).map((ref) => <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer">{ref.title}<ArrowUpRight size={12} /></a>)}<small>The finder chart uses your configured field of view. Markers show positions. {detail.variable ? "Brightness varies; no current magnitude is predicted." : "Magnitudes are catalog values; sky brightness and steadiness affect the view."}</small></div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
