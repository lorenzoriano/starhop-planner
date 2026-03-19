import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  stereographicProject,
  angularDistance,
  type Route,
  type SkyNode,
  type ConstellationLine,
} from '@/lib/astronomy';

interface SkyChartProps {
  nodes: SkyNode[];
  constellations: ConstellationLine[];
  route: Route | null;
  targetNode: SkyNode | null;
  animStep: number;
  fovWidth: number;
  fovHeight: number;
  fovShape: 'circle' | 'rectangle';
  lat: number;
  lon: number;
  date: Date;
}

const CHART_SIZE = 600;
const CHART_PAD = 40;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

export function SkyChart({
  nodes,
  constellations,
  route,
  targetNode,
  animStep,
  fovWidth,
  fovHeight,
  fovShape,
}: SkyChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredStar, setHoveredStar] = useState<SkyNode | null>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Drag state (pointer-based for both mouse and touch)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  // Pinch state
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchCenter = useRef<{ x: number; y: number } | null>(null);
  const pinchStartZoom = useRef(1);

  const currentHop = route?.hops[animStep] ?? null;

  const center = useMemo(() => {
    if (currentHop) {
      return { ra: currentHop.center.ra, dec: currentHop.center.dec };
    }
    if (targetNode) {
      return { ra: targetNode.ra, dec: targetNode.dec };
    }
    return { ra: 0, dec: 25 };
  }, [currentHop, targetNode]);

  const viewRadius = useMemo(() => {
    if (currentHop) return Math.max(12, Math.min(22, fovWidth * 3.1));
    if (targetNode) return 24;
    return 40;
  }, [currentHop, targetNode, fovWidth]);

  // Reset zoom/pan when viewRadius changes (new route computed or cleared),
  // but NOT when stepping through hops — preserve user's zoom/pan across steps.
  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [viewRadius]);

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const isDefaultView = zoom === 1 && panX === 0 && panY === 0;

  // SVG viewBox with zoom and pan applied
  const viewBoxSize = CHART_SIZE / zoom;
  const viewBoxX = (CHART_SIZE - viewBoxSize) / 2 - panX;
  const viewBoxY = (CHART_SIZE - viewBoxSize) / 2 - panY;

  // Clamp pan so chart doesn't fly offscreen
  const clampPan = useCallback((px: number, py: number, z: number) => {
    const viewSize = CHART_SIZE / z;
    const maxPan = (CHART_SIZE - viewSize) / 2;
    const minPan = -(CHART_SIZE - viewSize) / 2;
    return {
      x: Math.max(minPan, Math.min(maxPan, px)),
      y: Math.max(minPan, Math.min(maxPan, py)),
    };
  }, []);

  // ───── Mouse wheel zoom ─────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * (1 + delta)));
      // Adjust pan to stay clamped
      setPanX((px) => clampPan(px, 0, next).x);
      setPanY((py) => clampPan(0, py, next).y);
      return next;
    });
  }, [clampPan]);

  // ───── Pointer (mouse/single-touch) drag ─────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only start drag for primary pointer (mouse left button or single touch)
    if (e.pointerType === 'touch') {
      // Let touch events handle multi-touch; for single touch we set up on touchStart
      return;
    }
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { x: panX, y: panY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [panX, panY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // handled by touch events
    if (!isDragging.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Convert pixel movement to SVG coordinate movement
    const scaleRatio = CHART_SIZE / (rect.width * zoom);
    const dx = (e.clientX - dragStart.current.x) * scaleRatio;
    const dy = (e.clientY - dragStart.current.y) * scaleRatio;
    const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, zoom);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [zoom, clampPan]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // ───── Touch pan & pinch-to-zoom ─────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStart.current = { x: panX, y: panY };
      lastPinchDist.current = null;
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      lastPinchDist.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      lastPinchCenter.current = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      pinchStartZoom.current = zoom;
      panStart.current = { x: panX, y: panY };
    }
  }, [panX, panY, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    if (e.touches.length === 1 && isDragging.current) {
      const scaleRatio = CHART_SIZE / (rect.width * zoom);
      const dx = (e.touches[0].clientX - dragStart.current.x) * scaleRatio;
      const dy = (e.touches[0].clientY - dragStart.current.y) * scaleRatio;
      const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, zoom);
      setPanX(clamped.x);
      setPanY(clamped.y);
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / lastPinchDist.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom.current * scale));
      setZoom(newZoom);
      // Also track pan movement during pinch
      if (lastPinchCenter.current) {
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        const scaleRatio = CHART_SIZE / (rect.width * newZoom);
        const dx = (cx - lastPinchCenter.current.x) * scaleRatio;
        const dy = (cy - lastPinchCenter.current.y) * scaleRatio;
        const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, newZoom);
        setPanX(clamped.x);
        setPanY(clamped.y);
      }
    }
  }, [zoom, clampPan]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      lastPinchDist.current = null;
      lastPinchCenter.current = null;
    }
    if (e.touches.length === 0) {
      isDragging.current = false;
    } else if (e.touches.length === 1) {
      // Switch from pinch to single-finger pan
      isDragging.current = true;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStart.current = { x: panX, y: panY };
    }
  }, [panX, panY]);

  // Prevent default on the container to avoid browser zoom on pinch
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    const preventWheel = (e: WheelEvent) => {
      if (el.contains(e.target as Node)) e.preventDefault();
    };
    el.addEventListener('touchmove', preventZoom, { passive: false });
    el.addEventListener('wheel', preventWheel, { passive: false });
    return () => {
      el.removeEventListener('touchmove', preventZoom);
      el.removeEventListener('wheel', preventWheel);
    };
  }, []);

  const scale = (CHART_SIZE - CHART_PAD * 2) / (viewRadius * 2);
  const cx = CHART_SIZE / 2;
  const cy = CHART_SIZE / 2;

  const project = (ra: number, dec: number) => {
    const p = stereographicProject(ra, dec, center.ra, center.dec, scale);
    if (!p) return null;
    const x = cx + p.x;
    const y = cy + p.y;
    if (x < -16 || x > CHART_SIZE + 16 || y < -16 || y > CHART_SIZE + 16) return null;
    return { x, y };
  };

  const starSize = (mag: number) => {
    if (mag < 0.5) return 4.6;
    if (mag < 1.5) return 3.8;
    if (mag < 2.5) return 2.8;
    if (mag < 3.5) return 2.1;
    if (mag < 4.5) return 1.6;
    if (mag < 5.5) return 1.2;
    return 0.9;
  };

  const starColor = (mag: number) => {
    if (mag < 1.5) return '#f4f7ff';
    if (mag < 3.0) return '#d6def6';
    if (mag < 4.5) return '#9ba9cf';
    if (mag < 5.5) return '#5a6a90';
    return '#4a5870';
  };

  const highlightedIds = useMemo(() => {
    const ids = new Set<string>();
    if (route?.startAnchor) ids.add(route.startAnchor.id);
    if (targetNode) ids.add(targetNode.id);
    route?.hops.forEach((hop, index) => {
      if (index === animStep) {
        hop.patternAnchors.forEach((star) => ids.add(star.id));
        hop.visibleGuideStars.slice(0, 5).forEach((star) => ids.add(star.id));
      }
    });
    if (hoveredStar) ids.add(hoveredStar.id);
    return ids;
  }, [route, targetNode, animStep, hoveredStar]);

  // Compute the "focus point" — the active hop center or target — for proximity enrichment
  const focusPoint = useMemo(() => {
    if (currentHop) return { ra: currentHop.center.ra, dec: currentHop.center.dec };
    if (targetNode) return { ra: targetNode.ra, dec: targetNode.dec };
    return null;
  }, [currentHop, targetNode]);

  // Constellation IDs relevant to the active hop's guide stars — show more of those figures
  const activeConstellationIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentHop) {
      for (const s of currentHop.patternAnchors) if (s.constellation) ids.add(s.constellation);
      for (const s of currentHop.visibleGuideStars.slice(0, 8)) if (s.constellation) ids.add(s.constellation);
    }
    if (targetNode?.constellation) ids.add(targetNode.constellation);
    if (route?.startAnchor?.constellation) ids.add(route.startAnchor.constellation);
    return ids;
  }, [currentHop, targetNode, route]);

  // The local enrichment radius — within this distance from the focus point, show deeper stars
  const localRadius = useMemo(() => {
    if (currentHop) return Math.max(8, fovWidth * 2.2);
    return 12;
  }, [currentHop, fovWidth]);

  const visibleStars = useMemo(() => {
    return nodes.filter((node) => {
      const distFromCenter = angularDistance(node.ra, node.dec, center.ra, center.dec);
      if (distFromCenter > viewRadius) return false;

      // Always show highlighted, planets, binoculars
      if (highlightedIds.has(node.id)) return true;
      if (node.type === 'planet') return true;
      if (node.type === 'binocular') return node.mag <= 6.5;

      // Distance from the active focus point (current hop center or target)
      const distFromFocus = focusPoint
        ? angularDistance(node.ra, node.dec, focusPoint.ra, focusPoint.dec)
        : Infinity;

      // Proximity-based magnitude limit:
      // - Inner zone (< localRadius * 0.5): mag 6.2 — rich local context
      // - Mid zone   (< localRadius):       mag 5.5 — moderate fill
      // - Outer zone  (rest of view):        mag 4.8 (with route) / 4.2 (no route)
      // Stars matching the active constellation also get a boost
      const inActiveConstellation = node.constellation && activeConstellationIds.has(node.constellation);
      const constellationBoost = inActiveConstellation ? 0.6 : 0;

      let magLimit: number;
      if (route) {
        if (distFromFocus < localRadius * 0.5) {
          magLimit = 6.2 + constellationBoost;
        } else if (distFromFocus < localRadius) {
          // Smooth falloff between inner and outer
          const t = (distFromFocus - localRadius * 0.5) / (localRadius * 0.5);
          magLimit = 6.2 - t * 1.4 + constellationBoost; // 6.2 → 4.8
        } else {
          magLimit = 4.8 + constellationBoost * 0.4;
        }
      } else {
        magLimit = 4.2 + constellationBoost;
      }

      return node.mag <= magLimit;
    });
  }, [nodes, center.ra, center.dec, viewRadius, highlightedIds, route, focusPoint, localRadius, activeConstellationIds]);

  const constellationPaths = useMemo(() => {
    const paths: { d: string; id: string; nearFocus: boolean }[] = [];
    for (const constellation of constellations) {
      // Check if any vertex of this constellation is near the focus
      const isNearFocus = focusPoint ? constellation.points.some(seg =>
        seg.some(([ra, dec]) => angularDistance(ra, dec, focusPoint.ra, focusPoint.dec) < localRadius * 1.2)
      ) : false;
      const isActiveConstellation = activeConstellationIds.has(constellation.id);
      const nearFocus = isNearFocus || isActiveConstellation;

      for (const segment of constellation.points) {
        let d = '';
        for (let i = 0; i < segment.length; i++) {
          const p = project(segment[i][0], segment[i][1]);
          if (!p) {
            if (d) {
              paths.push({ d, id: `${constellation.id}-${i}`, nearFocus });
              d = '';
            }
            continue;
          }
          d += d ? ` L${p.x},${p.y}` : `M${p.x},${p.y}`;
        }
        if (d) paths.push({ d, id: constellation.id, nearFocus });
      }
    }
    return paths;
  }, [constellations, center.ra, center.dec, scale, viewRadius, focusPoint, localRadius, activeConstellationIds]);

  const routePath = useMemo(() => {
    if (!route) return null;
    const points = route.hops
      .map((hop) => project(hop.center.ra, hop.center.dec))
      .filter(Boolean) as { x: number; y: number }[];
    if (points.length < 2) return null;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L${points[i].x},${points[i].y}`;
    return d;
  }, [route, center.ra, center.dec, scale, viewRadius]);

  const routeProgressPath = useMemo(() => {
    if (!route) return null;
    const points = route.hops
      .slice(0, animStep + 1)
      .map((hop) => project(hop.center.ra, hop.center.dec))
      .filter(Boolean) as { x: number; y: number }[];
    if (points.length < 2) return null;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L${points[i].x},${points[i].y}`;
    return d;
  }, [route, animStep, center.ra, center.dec, scale, viewRadius]);

  const plottedStars = useMemo(() => {
    return visibleStars
      .map((star) => {
        const point = project(star.ra, star.dec);
        if (!point) return null;
        const isAnchor = route?.startAnchor.id === star.id;
        const isTarget = targetNode?.id === star.id;
        const isPatternAnchor = currentHop?.patternAnchors.some((guide) => guide.id === star.id) ?? false;
        const isGuide = currentHop?.visibleGuideStars.some((guide) => guide.id === star.id) ?? false;
        return {
          star,
          point,
          radius: starSize(star.mag),
          isAnchor,
          isTarget,
          isPatternAnchor,
          isGuide,
        };
      })
      .filter(Boolean) as Array<{
      star: SkyNode;
      point: { x: number; y: number };
      radius: number;
      isAnchor: boolean;
      isTarget: boolean;
      isPatternAnchor: boolean;
      isGuide: boolean;
    }>;
  }, [visibleStars, route, targetNode, currentHop, center.ra, center.dec, scale]);

  const labels = useMemo(() => {
    const candidates = plottedStars
      .filter(({ star, isAnchor, isTarget, isPatternAnchor, isGuide }) => {
        if (isTarget || isAnchor || isPatternAnchor) return true;
        if (isGuide && !!star.name) return true;
        // Bright named stars always get labels
        if (star.mag < 1.1) return true;
        // Named stars in the active constellation up to mag 3.5
        if (star.name && star.constellation && activeConstellationIds.has(star.constellation) && star.mag < 3.5) return true;
        // Named stars near the focus point up to mag 2.8
        if (star.name && star.mag < 2.8 && focusPoint) {
          const d = angularDistance(star.ra, star.dec, focusPoint.ra, focusPoint.dec);
          if (d < localRadius) return true;
        }
        return false;
      })
      .sort((a, b) => {
        // Proximity to focus point boosts score for tie-breaking
        const focusBonusA = focusPoint ? Math.max(0, 15 - angularDistance(a.star.ra, a.star.dec, focusPoint.ra, focusPoint.dec)) : 0;
        const focusBonusB = focusPoint ? Math.max(0, 15 - angularDistance(b.star.ra, b.star.dec, focusPoint.ra, focusPoint.dec)) : 0;
        const scoreA = (a.isTarget ? 100 : 0) + (a.isAnchor ? 70 : 0) + (a.isPatternAnchor ? 45 : 0) + (a.isGuide ? 20 : 0) - a.star.mag * 4 + focusBonusA;
        const scoreB = (b.isTarget ? 100 : 0) + (b.isAnchor ? 70 : 0) + (b.isPatternAnchor ? 45 : 0) + (b.isGuide ? 20 : 0) - b.star.mag * 4 + focusBonusB;
        return scoreB - scoreA;
      });

    const placements = [
      { dx: 10, dy: -10, anchor: 'start' as const },
      { dx: 10, dy: 14, anchor: 'start' as const },
      { dx: -10, dy: -10, anchor: 'end' as const },
      { dx: -10, dy: 14, anchor: 'end' as const },
    ];

    const accepted: Array<{
      star: SkyNode;
      x: number;
      y: number;
      anchor: 'start' | 'end';
      width: number;
      isAnchor: boolean;
      isTarget: boolean;
      isPatternAnchor: boolean;
    }> = [];

    const usedNames = new Set<string>();
    for (const candidate of candidates) {
      const text = candidate.star.name || candidate.star.id;
      // Deduplicate by display name — skip if we already labelled a star with this name
      if (usedNames.has(text)) continue;
      const width = Math.max(36, text.length * 5.7);
      for (const placement of placements) {
        const x = candidate.point.x + placement.dx;
        const y = candidate.point.y + placement.dy;
        const left = placement.anchor === 'start' ? x - 3 : x - width - 3;
        const right = placement.anchor === 'start' ? x + width + 3 : x + 3;
        const top = y - 11;
        const bottom = y + 4;
        const overlaps = accepted.some((label) => {
          const existingLeft = label.anchor === 'start' ? label.x - 3 : label.x - label.width - 3;
          const existingRight = label.anchor === 'start' ? label.x + label.width + 3 : label.x + 3;
          const existingTop = label.y - 11;
          const existingBottom = label.y + 4;
          return !(right < existingLeft || left > existingRight || bottom < existingTop || top > existingBottom);
        });
        const outOfBounds = left < 6 || right > CHART_SIZE - 6 || top < 6 || bottom > CHART_SIZE - 6;
        if (!overlaps && !outOfBounds) {
          accepted.push({
            star: candidate.star,
            x,
            y,
            anchor: placement.anchor,
            width,
            isAnchor: candidate.isAnchor,
            isTarget: candidate.isTarget,
            isPatternAnchor: candidate.isPatternAnchor,
          });
          usedNames.add(text);
          break;
        }
      }
      if (accepted.length >= 14) break;
    }

    return accepted;
  }, [plottedStars, activeConstellationIds, focusPoint, localRadius]);

  const fovCenter = currentHop ? project(currentHop.center.ra, currentHop.center.dec) : null;

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      data-testid="sky-chart"
      style={{ touchAction: 'none' }}
    >
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`${viewBoxX.toFixed(2)} ${viewBoxY.toFixed(2)} ${viewBoxSize.toFixed(2)} ${viewBoxSize.toFixed(2)}`}
        className="bg-[#0a0c14] rounded-lg cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: '1/1', maxHeight: '600px' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <defs>
          <radialGradient id="sky-gradient">
            <stop offset="0%" stopColor="#0d1020" />
            <stop offset="100%" stopColor="#070910" />
          </radialGradient>
          <filter id="glow-soft">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-strong">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={CHART_SIZE} height={CHART_SIZE} fill="url(#sky-gradient)" rx="8" />

        {[5, 10, 20].filter((r) => r < viewRadius).map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r * scale}
            fill="none"
            stroke="#182034"
            strokeWidth="0.6"
            strokeDasharray="4 5"
          />
        ))}

        {constellationPaths.map((path, index) => (
          <path
            key={`${path.id}-${index}`}
            d={path.d}
            stroke={path.nearFocus ? '#2a3a5c' : '#1a2136'}
            strokeWidth={path.nearFocus ? 0.9 : 0.7}
            fill="none"
            opacity={path.nearFocus ? 0.55 : 0.3}
          />
        ))}

        {routePath && <path d={routePath} stroke="#315e86" strokeWidth="1.2" fill="none" opacity="0.26" strokeDasharray="5 4" />}
        {routeProgressPath && <path d={routeProgressPath} stroke="#4fc3ff" strokeWidth="1.8" fill="none" opacity="0.88" />}

        {plottedStars.map(({ star, point, radius, isAnchor, isTarget, isPatternAnchor, isGuide }) => (
          <g
            key={star.id}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(null)}
          >
            {(isTarget || isAnchor || isPatternAnchor) && (
              <circle cx={point.x} cy={point.y} r={radius * 3.5} fill="white" opacity="0.05" />
            )}
            <circle
              cx={point.x}
              cy={point.y}
              r={isTarget ? Math.max(radius + 1.5, 4.2) : isAnchor || isPatternAnchor ? Math.max(radius + 0.8, 2.8) : radius}
              fill={
                isTarget
                  ? '#f59e0b'
                  : isAnchor
                    ? '#38bdf8'
                    : isPatternAnchor
                      ? '#c084fc'
                      : isGuide
                        ? '#d6e4ff'
                        : starColor(star.mag)
              }
              opacity={
                isTarget || isAnchor || isPatternAnchor || isGuide
                  ? 0.98
                  : star.mag < 2
                    ? 0.92
                    : star.mag < 3
                      ? 0.78
                      : star.mag < 4.2
                        ? 0.48
                        : star.mag < 5.0
                          ? 0.30
                          : star.mag < 5.8
                            ? 0.20
                            : 0.13
              }
              filter={isTarget ? 'url(#glow-strong)' : star.mag < 1.2 || isAnchor || isPatternAnchor ? 'url(#glow-soft)' : undefined}
            />
          </g>
        ))}

        {route?.hops.map((hop, index) => {
          const point = project(hop.center.ra, hop.center.dec);
          if (!point) return null;
          const active = index === animStep;
          return (
            <g key={`hop-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={active ? 4.3 : 2.6}
                fill={index === 0 ? '#38bdf8' : index === route.hops.length - 1 ? '#f59e0b' : '#6366f1'}
                opacity={active ? 1 : 0.7}
                filter={active ? 'url(#glow-soft)' : undefined}
              />
              <text
                x={point.x}
                y={point.y - 8}
                textAnchor="middle"
                fill={active ? '#f5f7ff' : '#94a3c7'}
                fontSize="8"
                fontWeight={active ? '700' : '500'}
                fontFamily="var(--font-sans)"
              >
                {index + 1}
              </text>
            </g>
          );
        })}

        {fovCenter && (
          <g>
            {fovShape === 'circle' ? (
              <circle
                cx={fovCenter.x}
                cy={fovCenter.y}
                r={(fovWidth / 2) * scale}
                fill="rgba(79, 195, 255, 0.05)"
                stroke="rgba(79, 195, 255, 0.45)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            ) : (
              <rect
                x={fovCenter.x - (fovWidth / 2) * scale}
                y={fovCenter.y - (fovHeight / 2) * scale}
                width={fovWidth * scale}
                height={fovHeight * scale}
                fill="rgba(79, 195, 255, 0.05)"
                stroke="rgba(79, 195, 255, 0.45)"
                strokeWidth="1"
                strokeDasharray="4 4"
                rx="3"
              />
            )}
          </g>
        )}

        {labels.map((label) => {
          const text = label.star.name || label.star.id;
          return (
            <g key={`${label.star.id}-label`} pointerEvents="none">
              <rect
                x={label.anchor === 'start' ? label.x - 3 : label.x - label.width - 3}
                y={label.y - 11}
                width={label.width + 6}
                height="14"
                rx="4"
                fill="rgba(8, 10, 18, 0.78)"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fill={label.isTarget ? '#ffd089' : label.isAnchor ? '#7dd3fc' : label.isPatternAnchor ? '#ddb8ff' : '#d6deef'}
                fontSize="9"
                fontWeight={label.isTarget || label.isAnchor ? '700' : '500'}
                fontFamily="var(--font-sans)"
              >
                {text}
              </text>
            </g>
          );
        })}

        {hoveredStar && (() => {
          const point = project(hoveredStar.ra, hoveredStar.dec);
          if (!point) return null;
          return (
            <g pointerEvents="none">
              <rect x={point.x + 10} y={point.y - 28} width="150" height="42" rx="6" fill="#121726" stroke="#28314a" />
              <text x={point.x + 16} y={point.y - 12} fill="#edf2ff" fontSize="10" fontWeight="600" fontFamily="var(--font-sans)">
                {hoveredStar.name}
              </text>
              <text x={point.x + 16} y={point.y + 2} fill="#9aabce" fontSize="9" fontFamily="var(--font-sans)">
                mag {hoveredStar.mag.toFixed(1)} · {hoveredStar.constellation || hoveredStar.type}
              </text>
            </g>
          );
        })()}

        <g transform="translate(12, 12)">
          <rect width="136" height="70" rx="6" fill="#0d1220" stroke="#1d2740" opacity="0.94" />
          <circle cx="12" cy="16" r="3" fill="#d6def6" />
          <text x="20" y="19" fill="#93a3c7" fontSize="8" fontFamily="var(--font-sans)">Reference stars</text>
          <circle cx="12" cy="32" r="3" fill="#c084fc" />
          <text x="20" y="35" fill="#93a3c7" fontSize="8" fontFamily="var(--font-sans)">Pattern anchors</text>
          <circle cx="12" cy="48" r="3" fill="#38bdf8" />
          <text x="20" y="51" fill="#93a3c7" fontSize="8" fontFamily="var(--font-sans)">Route anchor</text>
          <circle cx="12" cy="64" r="3" fill="#f59e0b" />
          <text x="20" y="67" fill="#93a3c7" fontSize="8" fontFamily="var(--font-sans)">Target</text>
        </g>

        <g transform={`translate(${CHART_SIZE - 120}, ${CHART_SIZE - 20})`}>
          <line x1="0" y1="0" x2={10 * scale} y2="0" stroke="#5d6a87" strokeWidth="1" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="#5d6a87" strokeWidth="1" />
          <line x1={10 * scale} y1="-3" x2={10 * scale} y2="3" stroke="#5d6a87" strokeWidth="1" />
          <text x={5 * scale} y="-6" fill="#5d6a87" fontSize="8" textAnchor="middle" fontFamily="var(--font-sans)">10°</text>
        </g>

        <text x={CHART_SIZE - 16} y={24} textAnchor="end" fill="#7382a1" fontSize="8" fontFamily="var(--font-sans)">
          Finder view ±{viewRadius.toFixed(0)}°
        </text>
      </svg>

      {/* Zoom controls overlay */}
      <div className="absolute top-2 right-2 flex flex-col gap-1" data-testid="zoom-controls">
        <button
          onClick={() => {
            setZoom((z) => {
              const next = Math.min(MAX_ZOOM, z * 1.3);
              setPanX((px) => clampPan(px, 0, next).x);
              setPanY((py) => clampPan(0, py, next).y);
              return next;
            });
          }}
          className="w-7 h-7 rounded bg-[#121726]/90 border border-[#28314a] text-[#93a3c7] hover:text-white hover:border-[#4fc3ff]/50 flex items-center justify-center text-sm font-bold transition-colors"
          title="Zoom in"
          data-testid="button-zoom-in"
        >
          +
        </button>
        <button
          onClick={() => {
            setZoom((z) => {
              const next = Math.max(MIN_ZOOM, z / 1.3);
              setPanX((px) => clampPan(px, 0, next).x);
              setPanY((py) => clampPan(0, py, next).y);
              return next;
            });
          }}
          className="w-7 h-7 rounded bg-[#121726]/90 border border-[#28314a] text-[#93a3c7] hover:text-white hover:border-[#4fc3ff]/50 flex items-center justify-center text-sm font-bold transition-colors"
          title="Zoom out"
          data-testid="button-zoom-out"
        >
          −
        </button>
        {!isDefaultView && (
          <button
            onClick={handleResetView}
            className="w-7 h-7 rounded bg-[#121726]/90 border border-[#28314a] text-[#93a3c7] hover:text-white hover:border-[#4fc3ff]/50 flex items-center justify-center transition-colors"
            title="Reset view"
            data-testid="button-zoom-reset"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1v4h4" />
              <path d="M3.5 9a5 5 0 1 0 1-5.2L1 5" />
            </svg>
          </button>
        )}
      </div>

      {/* Zoom level indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-[#121726]/80 border border-[#28314a] text-[10px] text-[#93a3c7] font-mono tabular-nums">
          {zoom.toFixed(1)}×
        </div>
      )}
    </div>
  );
}
