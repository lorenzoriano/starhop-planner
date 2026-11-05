/**
 * Full-screen image viewer (owner feedback r1: "click on an image and have an enlarged, high-resolution version").
 * Shows KbImage.large ?? src, with pinch / wheel / button zoom, drag pan, double-tap to zoom, and the credit,
 * licence and caption. With several images it is a gallery: previous / next buttons, ←/→ keys (when not zoomed),
 * a horizontal swipe, and a thumbnail strip. Closes with Esc, the browser Back button, the close button, or a tap
 * outside the image.
 * Rendered in a portal on <body> with role="dialog"; red-light mode turns its image red via red-theme.css.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";
import { trapTab, useOverlayDismiss } from "./use-overlay-dismiss";

export interface LightboxImage {
  /** Card-size image (shown while the large one loads, and as the fallback). */
  src: string;
  /** High-resolution copy, when the KB has one. */
  large?: string;
  alt: string;
  caption?: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
  /** What kind of picture this is, e.g. "Photograph", "Sky-survey photograph", "Infrared view". */
  label?: string;
}

const MIN = 1, MAX = 8;
/** The gesture hint shows on the first open only (per device). */
export const LIGHTBOX_HINT_KEY = "starhop-lightbox-hint-seen";

/** One short line: touch devices get gestures only; keyboard keys are noise there. */
export function lightboxHint(touch: boolean, gallery: boolean): string {
  return touch
    ? `Pinch to zoom${gallery ? " · swipe for next" : ""}`
    : `Scroll or double-click to zoom${gallery ? " · ←/→ for next" : ""} · Esc to close`;
}
function hintSeen(): boolean {
  try { return !!localStorage.getItem(LIGHTBOX_HINT_KEY); } catch { return false; }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function ImageLightbox({ images, start = 0, title, onClose }: { images: readonly LightboxImage[]; start?: number; title: string; onClose: () => void }) {
  const count = images.length;
  const [at, setAt] = useState(() => clamp(start, 0, Math.max(0, count - 1)));
  const image = images[at] ?? images[0];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [largeOk, setLargeOk] = useState<boolean | null>(image.large ? null : false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ zoom: number; pan: { x: number; y: number }; dist: number; mid: { x: number; y: number }; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const [showHint] = useState(() => !hintSeen());
  useEffect(() => { try { localStorage.setItem(LIGHTBOX_HINT_KEY, "1"); } catch { /* private mode: show it again next time */ } }, []);
  const touch = typeof window !== "undefined" && (!!window.matchMedia?.("(pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0);

  useOverlayDismiss(onClose, closeRef, "lightbox");

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const setZoomAround = useCallback((next: number, at?: { x: number; y: number }) => {
    const z = zoomRef.current, p = panRef.current;
    const nz = clamp(next, MIN, MAX);
    if (nz === z) return;
    let np = p;
    if (nz === 1) np = { x: 0, y: 0 };
    else {
      // Keep the point under the cursor/fingers (or the centre) fixed while zooming.
      const box = stage.current?.getBoundingClientRect();
      const cx = box && at ? at.x - (box.left + box.width / 2) : 0, cy = box && at ? at.y - (box.top + box.height / 2) : 0;
      np = { x: cx - (cx - p.x) * (nz / z), y: cy - (cy - p.y) * (nz / z) };
    }
    zoomRef.current = nz; panRef.current = np;
    setZoom(nz); setPan(np);
  }, []);

  const show = useCallback((next: number) => {
    if (count < 2) return;
    const i = ((next % count) + count) % count;
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 };
    setZoom(1); setPan({ x: 0, y: 0 });
    setLargeOk(images[i].large ? null : false);
    setAt(i);
  }, [count, images]);

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    // Keys belong to the viewer while it is open (field mode listens on window for ←/→/Space/S/R/Esc).
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoomAround(zoom * 1.5); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoomAround(zoom / 1.5); }
    else if (e.key === "0") { e.preventDefault(); setZoomAround(1); }
    else if (zoom === 1 && count > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); show(at + (e.key === "ArrowLeft" ? -1 : 1)); }
    else if (zoom > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const d = 60;
      setPan((p) => ({ x: p.x + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0), y: p.y + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0) }));
    } else trapTab(e);
  };

  // Native wheel listener: React's onWheel is passive and cannot stop the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setZoomAround((zoomRef.current) * (e.deltaY > 0 ? 1 / 1.2 : 1.2), { x: e.clientX, y: e.clientY }); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setZoomAround]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { zoom, pan, dist, mid, moved: gesture.current?.moved ?? false };
    if (pts.length === 1) gesture.current.moved = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    const g = gesture.current;
    if (pts.length >= 2 && g.dist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      g.moved = true;
      const nz = clamp(g.zoom * (dist / g.dist), MIN, MAX);
      const box = stage.current!.getBoundingClientRect();
      const cx = g.mid.x - (box.left + box.width / 2), cy = g.mid.y - (box.top + box.height / 2);
      setZoom(nz);
      setPan(nz === 1 ? { x: 0, y: 0 } : { x: cx - (cx - g.pan.x) * (nz / g.zoom), y: cy - (cy - g.pan.y) * (nz / g.zoom) });
    } else if (pts.length === 1) {
      const dx = pts[0].x - g.mid.x, dy = pts[0].y - g.mid.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (zoom > 1) setPan({ x: g.pan.x + dx, y: g.pan.y + dy });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // One finger lifted after a pinch: restart a pan from the remaining finger.
      const rest = Array.from(pointers.current.values())[0];
      gesture.current = { zoom, pan, dist: 0, mid: rest, moved: true };
      return;
    }
    gesture.current = null;
    // A horizontal swipe on an unzoomed image pages the gallery.
    if (g && g.moved && zoom === 1 && count > 1 && e.type !== "pointercancel" && g.dist === 0) {
      const dx = e.clientX - g.mid.x, dy = e.clientY - g.mid.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { show(at + (dx < 0 ? 1 : -1)); return; }
    }
    if (!g || g.moved || e.type === "pointercancel") return;
    const onImage = (e.target as HTMLElement).tagName === "IMG";
    const now = Date.now();
    if (onImage && now - lastTap.current < 320) { lastTap.current = 0; setZoomAround(zoom > 1 ? 1 : 2.5, { x: e.clientX, y: e.clientY }); return; }
    lastTap.current = now;
    // A tap on the dark surround (not the photo) closes the viewer.
    if (!onImage) onClose();
  };

  const shown = largeOk && image.large ? image.large : image.src;
  const pct = Math.round(zoom * 100);

  return createPortal(
    <div className="jlightbox" role="dialog" aria-modal="true" aria-label={`${title}: enlarged image`} onKeyDown={onKey} data-testid="journey-lightbox">
      <div className="jlightbox-bar">
        <p className="jlightbox-title">{title}{count > 1 && <span className="jlightbox-count" aria-live="polite"> · {at + 1} of {count}</span>}</p>
        <div className="jlightbox-tools" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setZoomAround(zoom / 1.5)} disabled={zoom <= MIN} aria-label="Zoom out"><Minus size={18} aria-hidden="true"/></button>
          <span className="jlightbox-zoom jlightbox-optional" aria-live="polite">{pct}%</span>
          <button type="button" onClick={() => setZoomAround(zoom * 1.5)} disabled={zoom >= MAX} aria-label="Zoom in"><Plus size={18} aria-hidden="true"/></button>
          <button type="button" className="jlightbox-optional" onClick={() => setZoomAround(1)} disabled={zoom === 1} aria-label="Fit image to screen"><RotateCcw size={16} aria-hidden="true"/></button>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Close enlarged image" className="jlightbox-close" data-testid="journey-lightbox-close"><X size={20} aria-hidden="true"/><span>Close</span></button>
        </div>
      </div>
      <div className="jlightbox-stage" ref={stage} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ cursor: zoom > 1 ? "grab" : "zoom-in" }}>
        {image.large && largeOk === null && <img key={`pre-${at}`} className="jlightbox-preload" src={image.large} alt="" aria-hidden="true" onLoad={() => setLargeOk(true)} onError={() => setLargeOk(false)}/>}
        <img key={at} src={shown} alt={image.alt} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}/>
        {image.large && largeOk === null && <p className="jlightbox-loading" role="status">Loading the full-size image…</p>}
        {count > 1 && <>
          <button type="button" className="jlightbox-nav jlightbox-prev" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => show(at - 1)} aria-label="Previous picture" data-testid="journey-lightbox-prev"><ChevronLeft size={22} aria-hidden="true"/></button>
          <button type="button" className="jlightbox-nav jlightbox-next" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => show(at + 1)} aria-label="Next picture" data-testid="journey-lightbox-next"><ChevronRight size={22} aria-hidden="true"/></button>
        </>}
      </div>
      <div className="jlightbox-info">
        {count > 1 && <div className="jlightbox-thumbs" role="group" aria-label="Pictures">
          {images.map((im, i) => <button key={im.src} type="button" aria-pressed={i === at} aria-label={`Picture ${i + 1} of ${count}${im.label ? `: ${im.label}` : ""}`} onClick={() => show(i)}>
            <img src={im.src} alt="" loading="lazy"/>
          </button>)}
        </div>}
        {(image.label || image.caption) && <p>{image.label && <strong className="jlightbox-kind">{image.label}. </strong>}{image.caption}</p>}
        <p className="jlightbox-credit">{[image.credit, image.license].filter(Boolean).join(" · ")}{image.sourceUrl && <> · <a href={image.sourceUrl} target="_blank" rel="noreferrer">source ↗</a></>}</p>
        {showHint && <p className="jlightbox-hint">{lightboxHint(touch, count > 1)}</p>}
      </div>
    </div>,
    document.body,
  );
}
