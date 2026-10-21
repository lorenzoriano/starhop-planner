import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { getConstellationName, type UnifiedTarget } from "@/lib/astronomy";
import { catalogSearchDiagnosticsFromMatches, prepareCatalogSearch, searchCatalog, lunarSearchHint } from "@/lib/catalog-search";

type CatalogComboboxProps = {
  targets: UnifiedTarget[];
  query: string;
  onQuery: (query: string) => void;
  onSelect: (target: UnifiedTarget) => void;
  savedIds?: Set<string>;
  label?: string;
  placeholder?: string;
  className?: string;
  lunarHintAction?: ReactNode;
  /** Called on each edit, before the debounced parent search updates. */
  onTyping?: () => void;
  announceSelection?: boolean;
};

function visibleCatalogId(target: UnifiedTarget) {
  return /^(?:M\d+|NGC\s*\d+|IC\s*\d+|HR\s*\d+)$/i.test(target.id) ? target.id : undefined;
}

export function CatalogCombobox({ targets, query, onQuery, onSelect, savedIds, label = "Search catalog", placeholder = "Name, constellation or catalog number…", className = "", lunarHintAction, onTyping, announceSelection = true }: CatalogComboboxProps) {
  const generatedId = useId().replace(/:/g, "");
  const inputId = `catalog-combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState("");
  // Input stays local while typing. Committing once after a pause also avoids
  // rebuilding the planetarium / Planner / Clock for every individual key.
  const [draft,setDraft]=useState(query);
  const emittedQuery=useRef(query),onQueryRef=useRef(onQuery);
  onQueryRef.current=onQuery;
  useEffect(()=>{
    if(query!==emittedQuery.current){emittedQuery.current=query;setDraft(query);}
  },[query]);
  useEffect(()=>{
    if(draft===query)return;
    const timer=setTimeout(()=>{emittedQuery.current=draft;onQueryRef.current(draft);},140);
    return ()=>clearTimeout(timer);
  },[draft,query]);
  // Warm normalized rows in small tasks after paint, rather than doing a large
  // one-off normalization pass on the first search keystroke.
  useEffect(()=>{
    let index=0;
    let timer:ReturnType<typeof setTimeout>;
    const prepare=()=>{prepareCatalogSearch(targets.slice(index,index+150));index+=150;if(index<targets.length)timer=setTimeout(prepare,0);};
    timer=setTimeout(prepare,0);
    return ()=>clearTimeout(timer);
  },[targets]);
  useEffect(()=>setStatus(""),[query,savedIds]);
  const matches=useMemo(()=>searchCatalog(targets,query,7),[targets,query]);
  const pending=draft!==query;
  const results=pending?[]:matches;
  const diagnostics=useMemo(()=>catalogSearchDiagnosticsFromMatches(query,matches),[query,matches]);
  const moonHint=lunarSearchHint(draft);
  const noResults=pending?"Searching…":!draft.trim()||results.length?"":diagnostics.message;
  const clearQuery=()=>{setDraft("");emittedQuery.current="";onQueryRef.current("");setActiveIndex(0);setStatus("");};
  const shownActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : -1;

  const select = (target: UnifiedTarget) => {
    if (announceSelection) {
      if (savedIds?.has(target.id)) setStatus(`${target.name} is already in your saved targets.`);
      else setStatus(`${target.name} selected.`);
    }
    onSelect(target);
  };

  return <div className={`catalog-combobox ${className}`.trim()}>
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={Boolean(draft.trim())}
      aria-controls={listId}
      aria-activedescendant={shownActiveIndex >= 0 ? `${listId}-option-${shownActiveIndex}` : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={event => { setDraft(event.target.value); setActiveIndex(0); setStatus(""); onTyping?.(); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" && results.length) {
          event.preventDefault(); setActiveIndex(index => (index + 1) % results.length);
        } else if (event.key === "ArrowUp" && results.length) {
          event.preventDefault(); setActiveIndex(index => (index - 1 + results.length) % results.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          // Enter commits the text the user can see, even inside the debounce
          // interval. Never select an option from the previous query.
          const fresh = pending ? searchCatalog(targets, draft, 7) : results;
          if (pending) { emittedQuery.current=draft; onQueryRef.current(draft); }
          const match=fresh[Math.min(activeIndex, fresh.length-1)];
          if (match) select(match.target);
          else setStatus(catalogSearchDiagnosticsFromMatches(draft, fresh).message);
        } else if (event.key === "Escape") {
          clearQuery();
        }
      }}
    />
    {draft.trim() && <ul id={listId} className="moon-target-results" role="listbox" aria-label="Matching catalog objects" aria-busy={pending}>
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
      }) : <li role="option" aria-selected="false"><span>{noResults}</span>{!pending && moonHint && (lunarHintAction??<a href="#/moon" onClick={navigateToLunarLandmarks}>Browse lunar landmarks</a>)}</li>}
    </ul>}
    {status && <p className="catalog-combobox-status" role="status" aria-live="polite">{status}</p>}
  </div>;
}

/** Hash routing uses the first fragment, so scroll after the Moon page mounts. */
function navigateToLunarLandmarks(event: React.MouseEvent<HTMLAnchorElement>) {
  if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  const reveal=()=>{
    const landmarks=document.getElementById("lunar-landmarks");
    if(!landmarks)return false;
    landmarks.scrollIntoView({behavior:"smooth",block:"start"});
    return true;
  };
  if(reveal())return;
  const observer=new MutationObserver(()=>{if(reveal()){observer.disconnect();clearTimeout(timeout);}});
  observer.observe(document.body,{childList:true,subtree:true});
  const timeout=setTimeout(()=>observer.disconnect(),5000);
  window.location.hash="/moon";
}
