import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared behaviour of the full-screen journey overlays (image lightbox, route map):
 * the browser Back button closes them (a same-URL history entry is pushed while open, so hash routing is not
 * touched), the page behind does not scroll, focus moves in on open and returns to the opener on close.
 */
export function useOverlayDismiss(onClose: () => void, focusRef: RefObject<HTMLElement | null>, tag: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    let closedByBack = false;
    try { window.history.pushState({ journeyOverlay: tag }, ""); } catch { /* sandboxed frame */ }
    const onPop = () => { closedByBack = true; onCloseRef.current(); };
    window.addEventListener("popstate", onPop);
    // Esc closes even when focus has fallen to <body> (e.g. after dragging the chart); capture phase so the
    // field-mode shortcuts on window never see it.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); } };
    window.addEventListener("keydown", onKey, true);
    focusRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      if (!closedByBack && (window.history.state as { journeyOverlay?: string } | null)?.journeyOverlay === tag) window.history.back();
      opener?.focus?.();
    };
  }, [tag, focusRef]);
}

/** Tab / Shift+Tab stay inside the overlay. */
export function trapTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0'], input, select"))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
