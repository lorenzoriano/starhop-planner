/**
 * Route map (owner feedback r1: "see the hops … zoom in and move around"). A star chart framed on the whole
 * journey (SkyChart's fixed equatorial projection: north up, east left, constellation figures, stars to the
 * binocular limit) with every stop numbered and named, the hop lines in order, and the selected binocular field
 * drawn around the current stop. Pinch / Ctrl+wheel / buttons zoom, drag pans, "Fit route" re-frames.
 * Inline on the Overview, and full screen from the Overview or field mode ("Map").
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { SkyChart, type JourneyOverlay, type JourneyOverlayStopState } from "@/components/SkyChart";
import type { Journey } from "@/lib/journeys/types";
import { objectName } from "@/lib/object-links";
import type { JourneysShared } from "./JourneysPage";
import { plainClass } from "./plain-language-adapter";
import { overlayStop } from "./journey-view";
import { trapTab, useOverlayDismiss } from "./use-overlay-dismiss";

export interface RouteMapProps {
  shared: JourneysShared;
  journey: Journey;
  /** Visit state per stop index (default: all to do). */
  states?: JourneyOverlayStopState[];
  /** Stop the binocular field is drawn around (current stop in field mode; highlighted or first on the Overview). */
  fieldAt?: number | null;
  highlight?: number | null;
  onStopSelect?: (index: number) => void;
  onStopHover?: (index: number | null) => void;
}

/**
 * View radius (degrees) that frames the whole route tightly: the stops' extent on a tangent plane around their
 * mean direction, fitted to the chart's aspect (SkyChart sizes its radius to the shorter, vertical side).
 */
export function routeRadiusDeg(points: { ra: number; dec: number }[], fovDeg: number, aspect: number): number {
  if (!points.length) return fovDeg * 1.2;
  const rad = Math.PI / 180;
  const v = points.map((p) => [Math.cos(p.dec * rad) * Math.cos(p.ra * rad), Math.cos(p.dec * rad) * Math.sin(p.ra * rad), Math.sin(p.dec * rad)]);
  const m = [0, 1, 2].map((k) => v.reduce((s, x) => s + x[k], 0));
  const n = Math.hypot(m[0], m[1], m[2]) || 1;
  const c = m.map((x) => x / n);
  const ra0 = Math.atan2(c[1], c[0]), dec0 = Math.asin(c[2]);
  let maxX = 0, maxY = 0;
  for (const p of points) {
    const ra = p.ra * rad, dec = p.dec * rad;
    const cosc = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
    const x = (Math.cos(dec) * Math.sin(ra - ra0)) / cosc / rad;
    const y = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosc / rad;
    maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y));
  }
  return Math.max(fovDeg * 1.2, Math.min(70, Math.max(maxY, maxX / Math.max(1, aspect)) * 1.12 + fovDeg * 0.6 + 0.8));
}

function useRouteOverlay({ shared, journey, states, fieldAt, highlight, onStopSelect, onStopHover }: RouteMapProps, fullscreen: boolean, aspect: number): JourneyOverlay {
  const { objects, page } = shared;
  const fov = page.profile.fov;
  const points = useMemo(() => journey.stops.flatMap((s) => { const o = objects.get(s.objectId); return o ? [{ ra: o.ra, dec: o.dec }] : []; }), [journey, objects]);
  const radius = Math.round(routeRadiusDeg(points, fov, aspect) * 10) / 10;
  return useMemo<JourneyOverlay>(() => ({
    stops: journey.stops.flatMap((stop, i) => {
      const o = objects.get(stop.objectId);
      // The map label is the app's one name in its short form (objectName.name: "ET Cluster" for "ET Cluster (NGC 457)").
      return o ? [{ ...overlayStop(o, states?.[i] ?? "todo"), label: objectName(o, page.targets).name }] : [];
    }),
    labels: "all",
    fieldAt: fieldAt ?? null,
    highlight: highlight ?? null,
    onStopSelect, onStopHover,
    moon: shared.moonRing,
    regionBufferDeg: Math.max(1, fov * 0.6),
    wheelZoom: fullscreen,
    fieldRadiusDeg: radius,
  }), [journey, objects, states, fieldAt, highlight, onStopSelect, onStopHover, shared.moonRing, fov, fullscreen, radius, page.targets]);
}

function RouteChart(props: RouteMapProps & { fullscreen: boolean }) {
  const { shared, journey, fullscreen } = props;
  const { page } = shared;
  // Measure the chart's aspect so the default view frames the route edge to edge.
  const wrap = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const svg = el.querySelector('svg[data-testid="sky-chart-sky"]');
      const r = svg?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) setAspect((a) => { const next = Math.round((r.width / r.height) * 20) / 20; return Math.abs(next - a) > 0.04 ? next : a; });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const overlay = useRouteOverlay(props, fullscreen, aspect);
  const nodes = useMemo(() => [...shared.skyNodes, ...shared.stopNodes(journey)], [shared, journey]);
  return <div ref={wrap} className="jmap-chart-inner"><SkyChart nodes={nodes} constellations={page.constellations} route={null} targetNode={null} animStep={0}
    fovWidth={page.profile.fov} fovHeight={page.profile.fov} fovShape="circle" lat={page.lat} lon={page.lon} date={page.date}
    limitingMag={6.5} denseStars={page.denseStars} milkyWay={page.milkyWay} isBinocular journey={overlay}/></div>;
}

/** The map key: open on wide screens; on phones a one-line "Key" disclosure (design review r4: five stacked lines). */
function MapKey({ fov }: { fov: number }) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || !!window.matchMedia?.("(min-width: 760px)").matches);
  return <details className="jmap-key-wrap" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary className="jmap-key-summary">Key<span> · rings are stops, north up, east left</span></summary>
    <p className="jmap-key">
      <span><b className="jmap-key-badge" aria-hidden="true">1</b> stops, ringed and numbered</span>
      <span><b className="jmap-key-line" aria-hidden="true"/> hops (arrow = direction)</span>
      <span><b className="jmap-key-field" aria-hidden="true"/> your {fov.toFixed(1)}° binocular field</span>
      <span><b className="jmap-key-hull" aria-hidden="true"/> the patch of sky this journey covers</span>
      <span>north up, east left</span>
    </p>
  </details>;
}

/** Inline route map with a "Full screen" button; `leading` replaces the "Route map" heading (e.g. a view switch). */
export function JourneyRouteMap({ leading, ...props }: RouteMapProps & { leading?: ReactNode }) {
  const [full, setFull] = useState(false);
  const [wheelHint, setWheelHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    setWheelHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setWheelHint(false), 1600);
  };
  return <div className="jmap" data-testid="journey-route-map">
    <div className="jmap-head">
      {leading ?? <h2 className="jmap-title">Route map</h2>}
      <button type="button" className="journey-button small" onClick={() => setFull(true)} data-testid="journey-map-fullscreen"><Maximize2 size={14} aria-hidden="true"/>Full screen</button>
    </div>
    <div className="jmap-chart" onWheel={onWheel}>
      <RouteChart {...props} fullscreen={false}/>
      {wheelHint && <p className="jmap-wheel-hint" role="status">Hold Ctrl (⌘ on Mac) and scroll to zoom, or open the map full screen</p>}
    </div>
    <MapKey fov={props.shared.page.profile.fov}/>
    {full && <JourneyMapDialog {...props} onClose={() => setFull(false)}/>}
  </div>;
}

/** Full-screen route map (portal on <body>, role="dialog"): Esc, Back or Close returns. */
export function JourneyMapDialog(props: RouteMapProps & { onClose: () => void; title?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Tapping a stop in the list below the map moves the binocular field and the highlight to it.
  const [focus, setFocus] = useState<number | null>(null);
  const { objects } = props.shared;
  useOverlayDismiss(props.onClose, closeRef, "route-map");
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.onClose(); } else trapTab(e);
  };
  return createPortal(
    <div className="jmap-dialog" role="dialog" aria-modal="true" aria-label={`Route map: ${props.journey.title}`} onKeyDown={onKey} data-testid="journey-map-dialog">
      <div className="jmap-dialog-bar">
        <p className="jmap-dialog-title"><strong>Route map</strong><span>{props.title ?? props.journey.title}</span></p>
        <button type="button" ref={closeRef} className="journey-button small" onClick={props.onClose} aria-label="Close the route map" data-testid="journey-map-close"><X size={16} aria-hidden="true"/>Close</button>
      </div>
      <div className="jmap-dialog-chart"><RouteChart {...props} fieldAt={focus ?? props.fieldAt} highlight={focus ?? props.highlight} fullscreen/></div>
      <MapKey fov={props.shared.page.profile.fov}/>
      <ol className="jmap-stops" aria-label="Stops">
        {props.journey.stops.map((stop, i) => {
          const o = objects.get(stop.objectId);
          const state = props.states?.[i] ?? "todo";
          return <li key={stop.objectId + i}>
            <button type="button" aria-pressed={(focus ?? props.fieldAt) === i} onClick={() => setFocus(i)}>
              <span className={`journey-badge ${state === "done" ? "done" : state === "skipped" ? "skipped" : ""}`} aria-hidden="true">{i + 1}</span>
              <span className="jmap-stop-text"><strong>{o ? objectName(o, props.shared.page.targets).label : stop.objectId}</strong><small>{o ? plainClass(o) : ""}{state === "current" ? " · you are here" : state === "done" ? " · seen" : state === "skipped" ? " · skipped" : ""}</small></span>
            </button>
          </li>;
        })}
      </ol>
    </div>,
    document.body,
  );
}
