/**
 * Tappable glossary terms (owner feedback r1): the first occurrence of a defined term in a card gets a dotted
 * underline; tapping it shows the short plain-words definition in a small popover. Keyboard: Enter/Space opens,
 * Esc closes. The popover is in-flow (no role="dialog").
 */
import { Fragment, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { findGlossaryTerms, loadGlossary, type GlossaryEntry } from "./plain-language-adapter";

const GlossaryContext = createContext<GlossaryEntry[] | null>(null);

/** Supplies a fixed glossary (tests, previews). Without a provider, cards load data/journeys/glossary.json. */
export function GlossaryProvider({ children, entries }: { children: ReactNode; entries: GlossaryEntry[] }) {
  return <GlossaryContext.Provider value={entries}>{children}</GlossaryContext.Provider>;
}

let cached: GlossaryEntry[] | null = null;
export function useGlossary(): GlossaryEntry[] {
  const provided = useContext(GlossaryContext);
  const [loaded, setLoaded] = useState<GlossaryEntry[]>(cached ?? []);
  useEffect(() => {
    if (provided || cached) return;
    let alive = true;
    loadGlossary().then((g) => { cached = g; if (alive) setLoaded(g); });
    return () => { alive = false; };
  }, [provided]);
  return provided ?? loaded;
}

/**
 * One marker per card render: `mark(text)` links each term the first time it appears in this card and returns
 * plain text for later repeats. Call it in reading order.
 */
export function createGlossaryMarker(glossary: GlossaryEntry[]) {
  const used = new Set<string>();
  return function mark(text: string | null | undefined): ReactNode {
    if (!text) return text ?? null;
    const matches = findGlossaryTerms(text, glossary).filter((m) => {
      if (used.has(m.entry.id)) return false;
      used.add(m.entry.id);
      return true;
    });
    if (!matches.length) return text;
    const out: ReactNode[] = [];
    let at = 0;
    matches.forEach((m, k) => {
      if (m.start > at) out.push(<Fragment key={`t${k}`}>{text.slice(at, m.start)}</Fragment>);
      out.push(<GlossaryTerm key={`g${k}`} entry={m.entry}>{text.slice(m.start, m.end)}</GlossaryTerm>);
      at = m.end;
    });
    if (at < text.length) out.push(<Fragment key="tail">{text.slice(at)}</Fragment>);
    return out;
  };
}

export function GlossaryTerm({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const id = `jgloss-${useId().replaceAll(":", "")}`;
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  // Keep the popover inside the viewport (390 px phones): shift it left when it would overflow.
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const r = pop.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const over = r.right + shift - (vw - 12);
    const under = r.left + shift - 12;
    if (over > 0) setShift((s) => s - over); else if (under < 0) setShift((s) => s - under);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setShift(0); return; }
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);

  return <span className="jgloss" ref={wrap}>
    <button type="button" className="jgloss-term" aria-expanded={open} aria-controls={id} data-glossary-id={entry.id}
      onClick={() => setOpen((v) => !v)}>{children}</button>
    {open && <span className="jgloss-pop" id={id} role="note" ref={pop} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
      <strong>{entry.term}</strong> {entry.short}
    </span>}
  </span>;
}
