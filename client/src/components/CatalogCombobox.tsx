import { useId, useMemo, useState } from "react";
import { getConstellationName, type UnifiedTarget } from "@/lib/astronomy";
import { catalogSearchScore, lunarSearchHint, unsupportedPlanetMessage } from "@/lib/catalog-search";

type CatalogComboboxProps = {
  targets: UnifiedTarget[];
  query: string;
  onQuery: (query: string) => void;
  onSelect: (target: UnifiedTarget) => void;
  savedIds?: Set<string>;
  label?: string;
  placeholder?: string;
  className?: string;
};

function visibleCatalogId(target: UnifiedTarget) {
  return /^(?:M\d+|NGC\s*\d+|IC\s*\d+|HR\s*\d+)$/i.test(target.id) ? target.id : undefined;
}

export function CatalogCombobox({ targets, query, onQuery, onSelect, savedIds, label = "Search catalog", placeholder = "Name, constellation or catalog number…", className = "" }: CatalogComboboxProps) {
  const generatedId = useId().replace(/:/g, "");
  const inputId = `catalog-combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState("");
  const results = useMemo(() => query.trim()
    ? targets.map(target => ({ target, score: catalogSearchScore(target, query, getConstellationName(target.con)) }))
      .filter(result => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || a.target.name.localeCompare(b.target.name))
      .slice(0, 7)
    : [], [targets, query]);
  const planetMessage = unsupportedPlanetMessage(query);
  const moonHint = lunarSearchHint(query);
  const noResults = planetMessage ?? moonHint ?? "No matching objects. Try a catalog number or another name.";
  const shownActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : -1;

  const select = (target: UnifiedTarget) => {
    if (savedIds?.has(target.id)) setStatus(`${target.name} is already in your saved targets.`);
    else setStatus(`${target.name} selected.`);
    onSelect(target);
  };

  return <div className={`catalog-combobox ${className}`.trim()}>
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={Boolean(query.trim())}
      aria-controls={listId}
      aria-activedescendant={shownActiveIndex >= 0 ? `${listId}-option-${shownActiveIndex}` : undefined}
      value={query}
      placeholder={placeholder}
      onChange={event => { onQuery(event.target.value); setActiveIndex(0); setStatus(""); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" && results.length) {
          event.preventDefault(); setActiveIndex(index => (index + 1) % results.length);
        } else if (event.key === "ArrowUp" && results.length) {
          event.preventDefault(); setActiveIndex(index => (index - 1 + results.length) % results.length);
        } else if (event.key === "Enter" && shownActiveIndex >= 0) {
          event.preventDefault(); select(results[shownActiveIndex].target);
        } else if (event.key === "Escape") {
          onQuery(""); setActiveIndex(0); setStatus("");
        }
      }}
    />
    {query.trim() && <ul id={listId} className="moon-target-results" role="listbox" aria-label="Matching catalog objects">
      {results.length ? results.map(({ target }, index) => {
        const catalogId = visibleCatalogId(target);
        const isSaved = savedIds?.has(target.id) ?? false;
        return <li key={target.id} role="presentation" onMouseEnter={() => setActiveIndex(index)}>
          <button
            id={`${listId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === shownActiveIndex}
            tabIndex={-1}
            style={index === shownActiveIndex ? { background: "#adcab31a" } : undefined}
            onClick={() => select(target)}
          >
            <strong>{target.name}</strong>
            <span>{[catalogId, target.categoryShort, getConstellationName(target.con), isSaved ? "Saved" : ""].filter(Boolean).join(" · ")}</span>
          </button>
        </li>;
      }) : <li role="option" aria-selected="false"><span>{noResults}</span></li>}
    </ul>}
    <div className="sr-only" role="status" aria-live="polite">{status}</div>
  </div>;
}
