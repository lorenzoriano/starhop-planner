import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowUpRight, Binoculars, BookOpen, Check, Clock, Eye, MapPin, Navigation, Plus, Search, Star, WifiOff, X } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { angularDistance, eqToHorizontal, getConstellationName, stereographicProject, type Star as CatalogStar, type UnifiedTarget } from "@/lib/astronomy";
import { compassLabel, skyConditions } from "@/lib/observing";
import { BINOCULAR_BOOKS, BINOCULAR_ENTRIES, FAMILY_LABELS, LEVEL_LABELS, MONTH_NAMES, binocularCollection, binocularEvening, type BinocularFamily, type BinocularPick } from "@/lib/binocular-guide";

interface Props {
  targets: UnifiedTarget[]; stars: CatalogStar[]; lat: number; lon: number;
  timezone: string; observingDate: Date; savedIds: Set<string>; loading: boolean;
  onSave: (id: string) => void; onPlan: (id: string, at: Date) => void;
}

/** A real catalog field, with conventional map symbols rather than fabricated object imagery. */
function BinocularField({ target, stars }: { target: UnifiedTarget; stars: CatalogStar[] }) {
  const field = useMemo(() => stars
    .filter((s) => angularDistance(s.ra, s.dec, target.ra, target.dec) < 7)
    .map((s) => ({ ...s, point: stereographicProject(s.ra, s.dec, target.ra, target.dec, 20) }))
    .filter((s) => s.point && Math.abs(s.point.x) < 118 && Math.abs(s.point.y) < 84), [target, stars]);
  return (
    <svg className="binocular-field" viewBox="0 0 240 180" role="img" aria-label={`Catalog star field around ${target.name}; north up, east left. The dashed circle is a seven-degree reference field; gold marks the target position.`}>
      <rect width="240" height="180" fill="#09141d" />
      <path d="M120 10V170M10 90H230" stroke="#6e9688" strokeWidth=".5" opacity=".16" />
      <circle cx="120" cy="90" r="70" fill="#80bcad" fillOpacity=".035" stroke="#85b9aa" strokeOpacity=".26" strokeDasharray="3 5" />
      {field.map((s) => (
        <circle key={s.id} cx={120 + s.point!.x} cy={90 + s.point!.y}
          r={s.mag < 2 ? 2.7 : s.mag < 4 ? 1.6 : .7}
          fill={s.mag < 3 ? "#dce8df" : "#9cb8c7"} opacity={s.mag < 4 ? .9 : .55} />
      ))}
      <circle cx="120" cy="90" r="7" stroke="#dbbd7e" fill="none" strokeWidth="1" />
      <path d="M120 79V74M120 101V106M109 90H104M131 90H136" stroke="#dbbd7e" strokeWidth="1" />
      <text x="224" y="17" fill="#87a19d" fontSize="8" textAnchor="end">N ↑</text>
      <text x="16" y="166" fill="#73919c" fontSize="7" letterSpacing="1">CATALOG FIELD · NORTH UP</text>
      <text x="224" y="166" fill="#73919c" fontSize="7" textAnchor="end">12° WIDE</text>
    </svg>
  );
}

export function BinocularGuide({ targets, stars, lat, lon, timezone, observingDate, savedIds, loading, onSave, onPlan }: Props) {
  const currentYear = Number(formatInTimeZone(observingDate, timezone, "yyyy"));
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(Number(formatInTimeZone(observingDate, timezone, "M")));
  const [family, setFamily] = useState<BinocularFamily | "all">("all");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [aboveOnly, setAboveOnly] = useState(true);
  const [seasonalOnly, setSeasonalOnly] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const collection = useMemo(() => binocularCollection(targets, lat, lon, year, month, timezone), [targets, lat, lon, year, month, timezone]);
  const at = useMemo(() => binocularEvening(year, month, timezone), [year, month, timezone]);
  const conditions = useMemo(() => skyConditions(lat, lon, at), [lat, lon, at]);
  const fieldStars = useMemo(() => stars.filter((s) => s.mag <= 6.5), [stars]);
  const matches = (pick: BinocularPick) => (family === "all" || pick.family === family)
    && (level === "all" || pick.level === level)
    && `${pick.target.name} ${pick.name ?? ""} ${pick.target.id} ${getConstellationName(pick.target.con)}`.toLowerCase().includes(query.toLowerCase());
  const picks = collection.filter((p) => matches(p) && (!aboveOnly || p.alt >= 15) && (!seasonalOnly || p.bestMonths.includes(month)));
  const featured = picks.find((p) => p.level === "easy") ?? picks[0];
  const detail = collection.find((p) => p.targetId === opened);
  const place = `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
  const sampleLabel = formatInTimeZone(at, timezone, "MMM d, yyyy · HH:mm");
  const years = Array.from(new Set([currentYear - 1, currentYear, currentYear + 1, year])).sort();
  const selectMonth = (value: number) => { setMonth(value); setVisibleCount(12); };
  const reset = () => { setFamily("all"); setLevel("all"); setQuery(""); setAboveOnly(false); setSeasonalOnly(false); setVisibleCount(12); };

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
            const count = collection.filter((p) => p.bestMonths.includes(i + 1) && (!aboveOnly || p.monthlyAltitudes[i] >= 15)).length;
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
          <div className="binocular-feature-field"><BinocularField target={featured.target} stars={fieldStars} /><span className="binocular-field-caption">7° reference field · gold ring = target</span></div>
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
          <select aria-label="Binocular observing difficulty" value={level} onChange={(e) => { setLevel(e.target.value); setVisibleCount(12); }}><option value="all">All observing levels</option>{Object.entries(LEVEL_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
          <button className={`filter-toggle ${aboveOnly ? "active" : ""}`} aria-pressed={aboveOnly} onClick={() => setAboveOnly(!aboveOnly)}><Eye size={14} /> Above 15°</button>
          <button className={`filter-toggle ${seasonalOnly ? "active" : ""}`} aria-pressed={seasonalOnly} onClick={() => setSeasonalOnly(!seasonalOnly)}><Clock size={14} /> Monthly picks</button>
        </div>

        {loading ? <div className="panel empty-state"><Binoculars size={28} /><p>Opening the binocular field guide…</p></div> : !picks.length ? (
          <div className="panel empty-state"><Star size={28} /><h3>A different window may open the sky.</h3><p>No targets match these filters at this location and time. Try another month or browse the full collection.</p><Button variant="outline" onClick={reset}>Browse all binocular targets</Button></div>
        ) : (
          <div className="binocular-target-grid">
            {picks.slice(0, visibleCount).map((p) => <article className={`binocular-target-card level-${p.level}`} key={p.targetId}>
              <button className="binocular-target-main" onClick={() => setOpened(p.targetId)} aria-label={`Explore binocular target ${p.name ?? p.target.name}`} data-testid={`binocular-target-${p.targetId}`}>
                <div className="binocular-target-field"><BinocularField target={p.target} stars={fieldStars} /><span className="binocular-family-label">{FAMILY_LABELS[p.family]}</span></div>
                <div className="binocular-target-body"><span className="eyebrow">{p.target.id.replace("STAR-", "")} · {getConstellationName(p.target.con)}</span><h3>{p.name ?? p.target.name}</h3><p>{p.impression}</p><div className="binocular-card-position"><span className={p.alt < 15 ? "low" : ""}>{p.neverRises ? "Never rises here" : p.alt < 0 ? "Below horizon at 21:00" : `${Math.round(p.alt)}° ${compassLabel(p.az)} at 21:00`}</span><span>{p.variable ? "Variable star" : `mag ${p.target.mag.toFixed(1)}`}</span></div></div>
              </button>
              <div className="binocular-target-bottom"><span>{LEVEL_LABELS[p.level]}</span><button className={savedIds.has(p.targetId) ? "saved" : ""} onClick={() => onSave(p.targetId)} aria-label={`${savedIds.has(p.targetId) ? "Remove" : "Save"} ${p.name ?? p.target.name}`} aria-pressed={savedIds.has(p.targetId)}>{savedIds.has(p.targetId) ? <Check size={17} /> : <Plus size={17} />}</button></div>
            </article>)}
          </div>
        )}
        {picks.length > visibleCount && <button className="load-more" onClick={() => setVisibleCount(visibleCount + 12)}>More fields to discover <ArrowUpRight size={14} /></button>}
        <p className="binocular-collection-note"><WifiOff size={14} /> The collection, charts, and saved targets travel offline with the app. Reference links need a connection.</p>
      </section>

      <section className="binocular-books">
        <div className="section-heading"><div><span className="eyebrow">GOOD COMPANY ON THE BOOKSHELF</span><h2>From observers who know the sky.</h2></div><BookOpen size={23} /></div>
        <p className="binocular-books-intro">An original selection informed by published guides and public author notes. Each target links to its evidence; an index entry confirms book coverage, while an author article supports its observing guidance.</p>
        <div className="binocular-book-grid">{BINOCULAR_BOOKS.map((book) => <a className={`binocular-book book-${book.color}`} key={book.author} href={book.url} target="_blank" rel="noreferrer"><div className="binocular-book-spine"><span>{book.mark}</span><BookOpen size={25} strokeWidth={1} /><small>THE OBSERVING SHELF</small></div><div><h3>{book.title}</h3><span>{book.author}</span><p>{book.note}</p><small>View the reference <ArrowUpRight size={12} /></small></div></a>)}</div>
        <details className="binocular-provenance"><summary>About the selection and the month-by-month calendar</summary><p>We checked target names against O’Meara’s publisher index and supplemented them with Harrington’s binocular tours, Tonkin’s BinocularSky notes, and southern-sky references. The collection is not a reproduction of a book’s complete observing list. StarHop’s short notes and finder maps are original.</p><p>For each target, StarHop computes altitude at 21:00 local time on the 15th of each month. Monthly picks are above 40° or within 18° of that target’s highest sampled evening altitude; the Above 15° filter removes low fields. Month labels stay in calendar order in both hemispheres: latitude changes altitude and horizon access, rather than reversing the sky’s calendar. This is a planning guide, not a visibility or weather guarantee. Variable-star brightness and eclipse times are not forecast.</p><p>Inspired by the <a href="https://www.cloudynights.com/forums/topic/858306-best-binocular-targets-book/" target="_blank" rel="noreferrer">Cloudy Nights discussion of binocular observing books</a>.</p></details>
      </section>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setOpened(null); }}>
        <DialogContent className="binocular-detail">
          {detail && <>
            <DialogHeader><span className="eyebrow">{FAMILY_LABELS[detail.family]} · {detail.target.id}</span><DialogTitle>{detail.name ?? detail.target.name}</DialogTitle><DialogDescription>{getConstellationName(detail.target.con)} · {LEVEL_LABELS[detail.level]} · {detail.equipment}</DialogDescription></DialogHeader>
            <div className="binocular-detail-layout"><BinocularField target={detail.target} stars={fieldStars} /><div><h3>What to look for</h3><p>{detail.impression}</p><h3>Start here</h3><p>{detail.finding}</p></div></div>
            <div className="binocular-year-path"><span className="eyebrow">A YEAR IN YOUR SKY · ALTITUDE AT 21:00 ON THE 15TH</span><div className="binocular-altitude-months">{detail.monthlyAltitudes.map((alt, i) => <button key={i} className={month === i + 1 ? "active" : ""} onClick={() => selectMonth(i + 1)} aria-label={`${MONTH_NAMES[i]}, altitude ${Math.round(alt)} degrees at 21:00`} aria-pressed={month === i + 1}><span className="binocular-altitude-bar"><i style={{ height: `${Math.max(3, Math.max(0, alt) / 90 * 100)}%` }} className={alt < 15 ? "low" : ""} /></span><small>{MONTH_NAMES[i].slice(0, 3)}</small></button>)}</div><p>{detail.neverRises ? "This target never rises at your latitude. Change your observing location to explore its southern sky." : `${sampleLabel}: ${Math.round(detail.alt)}° ${compassLabel(detail.az)}. ${detail.alt < 15 ? "This is low or below the horizon; try another month or time." : "Aim for higher altitude and an unobstructed view."}`}</p></div>
            <div className="binocular-detail-actions"><Button disabled={detail.alt < 5} onClick={() => { setOpened(null); onPlan(detail.targetId, at); }}><Navigation size={15} /> Plan binocular hop</Button><button className={`save-button ${savedIds.has(detail.targetId) ? "saved" : ""}`} aria-label={`${savedIds.has(detail.targetId) ? "Remove from" : "Add to"} my night`} onClick={() => onSave(detail.targetId)}>{savedIds.has(detail.targetId) ? <Check size={18} /> : <Plus size={18} />}</button><span>Plans for {sampleLabel} local</span></div>
            {eqToHorizontal(detail.target.ra, detail.target.dec, lat, lon, observingDate).alt >= 5 && <button className="text-action" onClick={() => { setOpened(null); onPlan(detail.targetId, observingDate); }}>Use my current observing time instead <ArrowUpRight size={13} /></button>}
            <div className="binocular-detail-sources"><h3><BookOpen size={14} /> Follow the observer’s trail</h3>{detail.references.map((ref) => <a key={ref.url + ref.title} href={ref.url} target="_blank" rel="noreferrer">{ref.title}<ArrowUpRight size={12} /></a>)}<small>The dashed circle is a 7° reference field; match your actual optics in setup. Markers show positions, not photographs. {detail.variable ? "Brightness varies; no current magnitude is predicted." : "Magnitudes are catalog values; sky brightness and steadiness affect the view."}</small></div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
