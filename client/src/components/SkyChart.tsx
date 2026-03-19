import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  stereographicProject,
  angularDistance,
  type Route,
  type SkyNode,
  type ConstellationLine,
  type DenseStar,
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
  limitingMag: number;
  denseStars: DenseStar[];
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
  limitingMag,
  denseStars,
}: SkyChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredStar, setHoveredStar] = useState<SkyNode | null>(null);

  // Chart display controls (internal — shown as sliders in the overlay)
  const [labelSize, setLabelSize] = useState(7);    // 0 = no labels, 1-8 px
  const [starBrightness, setStarBrightness] = useState(7); // 1-10; /5 → multiplier (default 1.4×)
  const [navStarSize, setNavStarSize] = useState(5); // 1-10; /5 → multiplier (default 1.0×)
  const [showLegend, setShowLegend] = useState(true);
  const [showGhostCircles, setShowGhostCircles] = useState(true);

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
  const brightMul = starBrightness / 5; // 0.2 … 2.0, default 1.4
  const navMul = navStarSize / 5; // 0.2 … 2.0, default 1.0

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
    if (mag < 0.5) return 4.5;
    if (mag < 1.5) return 3.5;
    if (mag < 2.5) return 2.6;
    if (mag < 3.5) return 1.9;
    if (mag < 4.5) return 1.4;
    if (mag < 5.5) return 1.05;
    return 0.8;
  };

  const starColor = (mag: number) => {
    if (mag < 1.5) return '#f4f7ff';
    if (mag < 3.0) return '#d6def6';
    if (mag < 4.5) return '#9ba9cf';
    if (mag < 5.5) return '#5a6a90';
    return '#4a5870';
  };

  // Realistic star color from B-V color index (spectral type)
  const bvColor = (bv: number) => {
    if (bv <= -0.3) return '#a0b5ff'; // O-type: blue
    if (bv <= 0.0)  return '#c4d4ff'; // B-type: blue-white
    if (bv <= 0.3)  return '#e8eeff'; // A/F-type: white
    if (bv <= 0.6)  return '#fff8f0'; // F/G-type: yellow-white
    if (bv <= 1.0)  return '#ffddb0'; // G/K-type: yellow-orange
    if (bv <= 1.5)  return '#ffaa80'; // K-type: orange
    return '#ff9070';                 // M-type: red-orange
  };

  const bgStarSize = (mag: number) => {
    if (mag < 1) return 3.5;
    if (mag < 2) return 2.6;
    if (mag < 3) return 1.9;
    if (mag < 4) return 1.4;
    if (mag < 5) return 1.05;
    if (mag < 6) return 0.8;
    if (mag < 7) return 0.62;
    return 0.5;
  };

  const bgStarOpacity = (mag: number) => {
    if (mag < 2) return 0.95;
    if (mag < 3) return 0.88;
    if (mag < 4) return 0.75;
    if (mag < 5) return 0.60;
    if (mag < 6) return 0.45;
    if (mag < 7) return 0.32;
    return 0.22;
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

      // Show all stars up to the user's limiting magnitude
      return node.mag <= limitingMag;
    });
  }, [nodes, center.ra, center.dec, viewRadius, highlightedIds, limitingMag]);

  // Background star layer from dense Hipparcos catalog — pure rendering, no routing
  const backgroundStarLayer = useMemo(() => {
    const result: { x: number; y: number; mag: number; bv: number }[] = [];
    for (const star of denseStars) {
      const [ra, dec, mag, bv] = star;
      if (mag > limitingMag) continue;
      const dist = angularDistance(ra, dec, center.ra, center.dec);
      if (dist > viewRadius * 1.05) continue;
      const p = stereographicProject(ra, dec, center.ra, center.dec, scale);
      if (!p) continue;
      const x = cx + p.x;
      const y = cy + p.y;
      if (x < -8 || x > CHART_SIZE + 8 || y < -8 || y > CHART_SIZE + 8) continue;
      result.push({ x, y, mag, bv });
    }
    return result;
  }, [denseStars, limitingMag, center.ra, center.dec, viewRadius, scale]);

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

  // Compact chart labels: constellation abbreviation to save space
  const chartLabel = (star: SkyNode): string => {
    if (star.name && star.name.length > 2 && !star.name.startsWith('HR') && star.name !== star.bayer) {
      return star.name;
    }
    if (star.bayer && star.constellation) return `${star.bayer} ${star.constellation}`;
    if (star.flamsteed && star.constellation) return `${star.flamsteed} ${star.constellation}`;
    if (star.name && !star.name.startsWith('HR')) return star.name;
    return '';  // skip labels for HR-only stars
  };

  const labels = useMemo(() => {
    if (labelSize === 0) return [];
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
      const text = chartLabel(candidate.star);
      // Skip empty labels (HR-only stars) and deduplicate
      if (!text || usedNames.has(text)) continue;
      const charWidth = labelSize * 0.63;
      const lPad = Math.max(1, Math.round(labelSize * 0.4));
      const width = Math.max(labelSize * 2, text.length * charWidth);
      for (const placement of placements) {
        const x = candidate.point.x + placement.dx;
        const y = candidate.point.y + placement.dy;
        const left = placement.anchor === 'start' ? x - lPad : x - width - lPad;
        const right = placement.anchor === 'start' ? x + width + lPad : x + lPad;
        const top = y - labelSize - lPad;
        const bottom = y + lPad;
        const overlaps = accepted.some((label) => {
          const existingLeft = label.anchor === 'start' ? label.x - lPad : label.x - label.width - lPad;
          const existingRight = label.anchor === 'start' ? label.x + label.width + lPad : label.x + lPad;
          const existingTop = label.y - labelSize - lPad;
          const existingBottom = label.y + lPad;
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
      if (accepted.length >= 22) break;
    }

    return accepted;
  }, [plottedStars, activeConstellationIds, focusPoint, localRadius, labelSize]);

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

        {/* Dense background star field from Hipparcos catalog */}
        {backgroundStarLayer.map((star, i) => (
          <circle
            key={i}
            cx={star.x}
            cy={star.y}
            r={bgStarSize(star.mag) * brightMul}
            fill={bvColor(star.bv)}
            opacity={Math.min(0.97, bgStarOpacity(star.mag) * brightMul)}
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
              <circle cx={point.x} cy={point.y} r={radius * 3.5 * navMul} fill="white" opacity="0.05" />
            )}
            <circle
              cx={point.x}
              cy={point.y}
              r={isTarget ? Math.max(radius + 1.5 * navMul, 4.2 * navMul) : isAnchor || isPatternAnchor ? Math.max(radius + 0.8 * navMul, 2.8 * navMul) : isGuide ? radius * navMul : radius * Math.min(1.8, brightMul)}
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
                  : Math.min(0.95,
                      (star.mag < 2 ? 0.95 : star.mag < 3 ? 0.85 : star.mag < 4.2 ? 0.60 : star.mag < 5.0 ? 0.40 : star.mag < 5.8 ? 0.28 : 0.18)
                      * brightMul
                    )
              }
              filter={isTarget ? 'url(#glow-strong)' : star.mag < 1.2 || isAnchor || isPatternAnchor ? 'url(#glow-soft)' : undefined}
            />
          </g>
        ))}

        {showGhostCircles && route && route.hops
          .map((hop, index) => ({ hop, index }))
          .filter(({ index }) => index > animStep)
          .map(({ hop, index }) => {
            const pt = project(hop.center.ra, hop.center.dec);
            if (!pt) return null;
            return (
              <g key={`ghost-fov-${index}`}>
                {fovShape === 'circle' ? (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={(fovWidth / 2) * scale}
                    fill="rgba(245, 158, 11, 0.05)"
                    stroke="rgba(245, 158, 11, 0.30)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                ) : (
                  <rect
                    x={pt.x - (fovWidth / 2) * scale}
                    y={pt.y - (fovHeight / 2) * scale}
                    width={fovWidth * scale}
                    height={fovHeight * scale}
                    fill="rgba(245, 158, 11, 0.05)"
                    stroke="rgba(245, 158, 11, 0.30)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    rx="3"
                  />
                )}
              </g>
            );
          })}

        {route?.hops.map((hop, index) => {
          const point = project(hop.center.ra, hop.center.dec);
          if (!point) return null;
          const active = index === animStep;
          return (
            <g key={`hop-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={(active ? 4.3 : 2.6) * navMul}
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
          const text = chartLabel(label.star);
          if (!text) return null;
          const pad = Math.max(1, Math.round(labelSize * 0.4));
          return (
            <g key={`${label.star.id}-label`} pointerEvents="none">
              <rect
                x={label.anchor === 'start' ? label.x - pad : label.x - label.width - pad}
                y={label.y - labelSize - Math.round(pad * 0.5)}
                width={label.width + pad * 2}
                height={labelSize + pad * 2}
                rx={Math.min(4, labelSize * 0.5)}
                fill="rgba(8, 10, 18, 0.78)"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fill={label.isTarget ? '#ffd089' : label.isAnchor ? '#7dd3fc' : label.isPatternAnchor ? '#ddb8ff' : '#d6deef'}
                fontSize={labelSize}
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

        {/* Legend moved to HTML overlay */}

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

      {/* Chart controls overlay: sliders + zoom buttons */}
      <div className="absolute top-2 right-2 flex flex-row items-start gap-1.5">
        {/* Vertical sliders panel */}
        <div className="flex flex-row gap-2 bg-[#0d1220]/90 border border-[#1d2740] rounded-lg px-2 pt-1.5 pb-1">
          {/* Label size slider (0 = off) */}
          <div
            className="flex flex-col items-center gap-0.5"
            title={labelSize === 0 ? 'Labels: off' : `Labels: ${labelSize}px`}
          >
            <div style={{ width: 18, height: 60, position: 'relative', overflow: 'visible' }}>
              <input
                type="range"
                min={0} max={8} step={1}
                value={labelSize}
                onChange={e => setLabelSize(Number(e.target.value))}
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 60, height: 18, margin: 0,
                  transform: 'translate(-50%, -50%) rotate(-90deg)',
                  cursor: 'pointer',
                  accentColor: '#4fc3ff',
                }}
              />
            </div>
            <span className="text-[9px] font-bold select-none leading-none" style={{ color: '#4d6280' }}>A</span>
          </div>
          {/* Star brightness slider */}
          <div
            className="flex flex-col items-center gap-0.5"
            title={`Stars: ${Math.round(brightMul * 100)}%`}
          >
            <div style={{ width: 18, height: 60, position: 'relative', overflow: 'visible' }}>
              <input
                type="range"
                min={1} max={10} step={1}
                value={starBrightness}
                onChange={e => setStarBrightness(Number(e.target.value))}
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 60, height: 18, margin: 0,
                  transform: 'translate(-50%, -50%) rotate(-90deg)',
                  cursor: 'pointer',
                  accentColor: '#4fc3ff',
                }}
              />
            </div>
            <span className="text-[9px] select-none leading-none" style={{ color: '#4d6280' }}>★</span>
          </div>
          {/* Navigation star size slider */}
          <div
            className="flex flex-col items-center gap-0.5"
            title={`Nav stars: ${Math.round(navMul * 100)}%`}
          >
            <div style={{ width: 18, height: 60, position: 'relative', overflow: 'visible' }}>
              <input
                type="range"
                min={1} max={10} step={1}
                value={navStarSize}
                onChange={e => setNavStarSize(Number(e.target.value))}
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 60, height: 18, margin: 0,
                  transform: 'translate(-50%, -50%) rotate(-90deg)',
                  cursor: 'pointer',
                  accentColor: '#4fc3ff',
                }}
              />
            </div>
            <span className="text-[9px] select-none leading-none" style={{ color: '#4d6280' }}>◎</span>
          </div>
          {/* Ghost FOV circles toggle */}
          <div
            className="flex flex-col items-center gap-0.5"
            title={showGhostCircles ? 'Hide upcoming FOV circles' : 'Show upcoming FOV circles'}
          >
            <button
              onClick={() => setShowGhostCircles(v => !v)}
              style={{
                width: 18,
                height: 60,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle
                  cx="7" cy="7" r="5.5"
                  stroke={showGhostCircles ? 'rgba(245,158,11,0.75)' : 'rgba(77,98,128,0.6)'}
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                  fill={showGhostCircles ? 'rgba(245,158,11,0.12)' : 'none'}
                />
              </svg>
            </button>
            <span
              className="text-[9px] select-none leading-none"
              style={{ color: showGhostCircles ? 'rgba(245,158,11,0.6)' : '#4d6280' }}
            >
              ◌
            </span>
          </div>
        </div>

        {/* Zoom buttons */}
        <div className="flex flex-col gap-1" data-testid="zoom-controls">
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
      </div>

      {/* Legend overlay */}
      {showLegend ? (
        <div className="absolute top-2 left-2 bg-[#0d1220]/90 border border-[#1d2740] rounded-lg px-2 py-1.5 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-[5px] h-[5px] rounded-full bg-[#d6def6]" />
              <span className="text-[8px] text-[#7382a1] leading-none">Stars</span>
            </div>
            <button
              onClick={() => setShowLegend(false)}
              className="text-[#4d6280] hover:text-[#93a3c7] text-[9px] leading-none transition-colors"
              title="Hide legend"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-[5px] h-[5px] rounded-full bg-[#c084fc]" />
            <span className="text-[8px] text-[#7382a1] leading-none">Pattern</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-[5px] h-[5px] rounded-full bg-[#38bdf8]" />
            <span className="text-[8px] text-[#7382a1] leading-none">Anchor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-[5px] h-[5px] rounded-full bg-[#f59e0b]" />
            <span className="text-[8px] text-[#7382a1] leading-none">Target</span>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowLegend(true)}
          className="absolute top-2 left-2 w-6 h-6 rounded bg-[#0d1220]/90 border border-[#1d2740] text-[#4d6280] hover:text-[#93a3c7] flex items-center justify-center text-[10px] transition-colors"
          title="Show legend"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.5" />
            <line x1="6" y1="4.5" x2="6" y2="7.5" />
            <circle cx="6" cy="3.2" r="0.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}

      {/* Zoom level indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-[#121726]/80 border border-[#28314a] text-[10px] text-[#93a3c7] font-mono tabular-nums">
          {zoom.toFixed(1)}×
        </div>
      )}
    </div>
  );
}
