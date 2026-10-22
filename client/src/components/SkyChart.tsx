import { SolarSkySymbol } from "./SolarSkySymbol";
import { catalogExtent } from '@/lib/catalog-extents';
import { angularEllipse, angularField, unprojectChartPoint } from '@/lib/optical-geometry';
import { OpticalProfiles } from "./OpticalProfiles";
import { Maximize2, Minimize2 } from "lucide-react";
import { CatalogSkySymbol } from './CatalogSkySymbol';
import { isDeepSky, altitudeRingFraction, skyObjectKind } from '@/lib/planetarium';
import { stellarColor,stellarRadius } from '@/lib/stellar-appearance';
import { useFinderStars } from '@/hooks/use-finder-stars';
import { orientChartPoint } from '@/lib/observing';
import { chartFrame, projectChartPoint, skyZenith, fieldViewZoom } from '@/lib/chart-view';
import { milkyWayPaths as projectMilkyWay } from '@/lib/sky-polygons';
import { angularRing, RETICLE_DIAMETERS, type FinderReticle } from '@/lib/finder-view';
import { boxesOverlap,labelFits,labelPointLookup,constellationSymbolBox,pointSegmentDistanceSquared,type LabelBox } from '@/lib/chart-labels';
import { useChartPreferences } from './ChartPreferences';
import { memo, useMemo, useRef, useState, useCallback, useEffect, useLayoutEffect, useId, type ReactNode } from 'react';
import {
  angularDistance,
  eqToHorizontal,
  getConstellationName,
  type Route,
  type SkyNode,
  type ConstellationLine,
  type DenseStar,
  type MilkyWayFeature,
  type PatternType,
} from '@/lib/astronomy';
import "./SkyChart.css";

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
  milkyWay: MilkyWayFeature[];
  overview?: boolean;
  onSelect?: (id: string) => void;
  onFovChange?: (width: number) => void;
  onLimitingMagChange?: (magnitude: number) => void;
  onEditSetup?: () => void;
  setupSummary?: ReactNode;
  isBinocular?: boolean;
  fieldNavigation?: ReactNode;
  maxCatalogMagnitude?:number;
  targetDiameter?:number|null;
}

const CHART_SIZE = 600;
const CHART_PAD = 40;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 200;

function isBatchedStar(item:{star:SkyNode;isAnchor:boolean;isTarget:boolean;isPatternAnchor:boolean;isGuide:boolean}) {
  return item.star.type==='star'&&item.star.mag>3&&!item.isAnchor&&!item.isTarget&&!item.isPatternAnchor&&!item.isGuide;
}
/** Share geometry for faint catalog stars; no thousands of hidden buttons or title nodes. */
const BatchedStarLayer=memo(function BatchedStarLayer({points}:{points:Array<{x:number;y:number;r:number;color:string;opacity:number}>}) {
  const groups=new Map<string,{color:string;opacity:number;d:string}>();
  for(const point of points){
    const color=point.color.startsWith('rgb(')?point.color.replace(/\d+/g,value=>String(Math.min(255,Math.round(Number(value)/32)*32))):point.color;
    const opacity=Math.round(point.opacity*5)/5,key=`${color}/${opacity}`,group=groups.get(key)??{color,opacity,d:''};
    const x=+point.x.toFixed(2),y=+point.y.toFixed(2),r=+point.r.toFixed(4);group.d+=`M${x-r},${y}a${r},${r} 0 1 0 ${2*r},0a${r},${r} 0 1 0 ${-2*r},0`;
    groups.set(key,group);
  }
  return <g aria-hidden="true" pointerEvents="none" data-batched-stars={points.length}>{Array.from(groups,([key,group])=><path key={key} fill={group.color} opacity={group.opacity} d={group.d}/>)}</g>;
});

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
  milkyWay,
  lat, lon, date,
  overview = false,
  onSelect, onFovChange, onEditSetup, setupSummary, isBinocular=false, fieldNavigation, maxCatalogMagnitude=8, targetDiameter,
}: SkyChartProps) {
  const chartId=`sky-${useId().replaceAll(':','')}`;
  const [showObjects,setShowObjects]=useState(true);
  const [showOpticalField,setShowOpticalField]=useState(true);
  const [showAngularExtents,setShowAngularExtents]=useState(true);
  const deepCatalog=useFinderStars(targetNode?.id,limitingMag>8&&!overview);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredStar, setHoveredStar] = useState<SkyNode | null>(null);

  // Shared display preferences; primary controls remain visible below every chart.
  const { preferences, update: updateDisplay } = useChartPreferences();
  const { labelSize, starBrightness, navStarSize, showLegend, showGhostCircles, showConstellations, finderReticle } = preferences;
  const activeFinderReticle=isBinocular&&(finderReticle==="telrad"||finderReticle==="rigel")?"field":finderReticle;

  const mirrored=overview?false:preferences.mirrored;
  const rotation=overview?0:preferences.rotation;
  const starsOnly=overview?false:preferences.starsOnly;

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [viewport, setViewport] = useState({width:CHART_SIZE,height:CHART_SIZE,measured:false});
  const viewportPixels=Math.min(viewport.width,viewport.height);
  const chartAspect=Math.max(1,viewport.width/Math.max(1,viewport.height));
  const chartWidth=CHART_SIZE*chartAspect;
  const [isFullscreen,setIsFullscreen]=useState(false);
  const [highlightedFigure,setHighlightedFigure]=useState<string|null>(null);
  useEffect(()=>{
    if(!overview||!constellations.length)return;
    const highlight=()=>{const id=sessionStorage.getItem('starhop-highlight-constellation');if(!id||!constellations.some(c=>c.id===id))return;setHighlightedFigure(id);sessionStorage.removeItem('starhop-highlight-constellation');requestAnimationFrame(()=>svgRef.current?.scrollIntoView({behavior:'smooth',block:'center'}));};
    highlight();window.addEventListener('starhop:highlight-constellation',highlight);return()=>window.removeEventListener('starhop:highlight-constellation',highlight);
  },[overview,constellations]);
  useLayoutEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const measure = () => {
      const box = svg.getBoundingClientRect();
      if(box.width<=0||box.height<=0)return;
      setViewport(previous => previous.measured&&Math.abs(previous.width-box.width)<.5&&Math.abs(previous.height-box.height)<.5?previous:{width:box.width,height:box.height,measured:true});
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(()=>{const sync=()=>setIsFullscreen(document.fullscreenElement===containerRef.current);document.addEventListener("fullscreenchange",sync);return()=>document.removeEventListener("fullscreenchange",sync);},[]);

  // Drag state (pointer-based for both mouse and touch)
  const isDragging = useRef(false);
  const [dragVersion,setDragVersion]=useState(0);
  const didDrag = useRef(false);
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
    if (overview) return skyZenith(lat, lon, date);
    if (currentHop) {
      return { ra: currentHop.center.ra, dec: currentHop.center.dec };
    }
    if (targetNode) {
      return { ra: targetNode.ra, dec: targetNode.dec };
    }
    return { ra: 0, dec: 25 };
  }, [currentHop, targetNode, overview, lat, lon, date]);
  // The destination fixes north across its finder and every alternative route.
  const fixedFrame=useMemo(()=>targetNode??(route?chartFrame(route.hops.map(hop=>hop.center)):{ra:0,dec:25}),[targetNode,route]);
  const projectionFrame=overview?center:fixedFrame;

  const viewRadius = useMemo(() => {
    if (overview) return 90;
    if (currentHop) {
      const routeSpan = route
        ? Math.max(0, ...route.hops.map((hop) =>
            Math.max(...route.hops.map((other) =>
              angularDistance(hop.center.ra, hop.center.dec, other.center.ra, other.center.dec),
            )),
          ))
        : 0;
      return Math.max(12, Math.min(70, Math.max(fovWidth * 3.1, routeSpan + fovWidth * 1.5)));
    }
    if (targetNode) return Math.max(2, fovWidth * 0.85);
    return 40;
  }, [currentHop, targetNode, fovWidth, route, overview]);

  const planeRadius = 2 * Math.tan(viewRadius * Math.PI / 360) * 180 / Math.PI;
  const scale = (Math.min(chartWidth,CHART_SIZE) / 2 - CHART_PAD) / planeRadius;
  // Keep wide maps readable without changing which catalog stars are shown.
  const backgroundPointScale = Math.min(1, 12 / (viewRadius / zoom));
  const catalogPointScale = overview ? 1 : Math.max(0.25, backgroundPointScale);
  const scaleBarDegrees = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].filter((angle) => angle * scale * zoom <= 90).at(-1) ?? 0.05;
  const cx = chartWidth / 2;
  const cy = CHART_SIZE / 2;
  const fovRadius = 2 * Math.tan(fovWidth * Math.PI / 720) * 180 / Math.PI * scale;

  // The planetarium stops at a useful optical field instead of a 200× empty catalog crop.
  const zoomLimit=overview?Math.min(MAX_ZOOM,Math.max(12,fieldViewZoom(viewRadius,fovWidth,fovShape==="rectangle"?fovHeight:fovWidth,220))):MAX_ZOOM;
  const initialZoom = overview || !route ? 1 : fieldViewZoom(viewRadius, fovWidth, fovShape === "rectangle" ? fovHeight : fovWidth);
  const screenUnit = CHART_SIZE / viewportPixels / zoom;
  const labelUnits = Math.max(12, labelSize) * screenUnit;
  // Each hop frames its active field; orientation remains fixed across the route.
  useLayoutEffect(() => {
    setZoom(initialZoom); setPanX(0); setPanY(0);
  }, [initialZoom,viewRadius, route?.id, animStep, overview]);
  const handleResetView = useCallback(() => {
    setZoom(initialZoom); setPanX(0); setPanY(0);
  }, [initialZoom]);
  const isDefaultView = zoom === initialZoom && panX === 0 && panY === 0;

  // SVG viewBox with zoom and pan applied
  const viewBoxWidth = chartWidth / zoom;
  const viewBoxHeight = CHART_SIZE / zoom;
  const viewBoxX = (chartWidth - viewBoxWidth) / 2 - panX;
  const viewBoxY = (CHART_SIZE - viewBoxHeight) / 2 - panY;

  const labelViewport=useMemo(()=>({left:viewBoxX+6*screenUnit,top:viewBoxY+6*screenUnit,right:viewBoxX+viewBoxWidth-6*screenUnit,bottom:viewBoxY+viewBoxHeight-6*screenUnit}),[viewBoxX,viewBoxY,viewBoxWidth,viewBoxHeight,screenUnit]);
  const labelCircle=useMemo(()=>overview?{x:cx,y:cy,r:260-3*screenUnit}:undefined,[overview,cx,cy,screenUnit]);
  const reservedLabels=useMemo(()=>{
    const areas:LabelBox[]=[{left:viewBoxX+viewBoxWidth-75*screenUnit,top:viewBoxY,right:viewBoxX+viewBoxWidth,bottom:viewBoxY+75*screenUnit}];
    if(showLegend&&!starsOnly&&!overview)areas.push({left:viewBoxX,top:viewBoxY,right:viewBoxX+(route?280:180)*screenUnit,bottom:viewBoxY+42*screenUnit});
    if(overview)for(const altitude of [30,60]){const y=cy+260*altitudeRingFraction(altitude)-4*screenUnit;areas.push({left:cx+2*screenUnit,right:cx+83*screenUnit,top:y-13*screenUnit,bottom:y+3*screenUnit});}
    return areas;
  },[viewBoxX,viewBoxY,viewBoxWidth,screenUnit,showLegend,starsOnly,overview,route,cx,cy]);

  // Clamp pan so chart doesn't fly offscreen
  const clampPan = useCallback((px: number, py: number, z: number) => {
    const maxPanX = Math.max(0, (chartWidth - chartWidth/z) / 2);
    const maxPanY = Math.max(0, (CHART_SIZE - CHART_SIZE/z) / 2);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, [chartWidth]);

  // ───── Mouse wheel zoom ─────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if(!e.ctrlKey&&!e.metaKey)return;
    if((e.deltaY>0&&zoom<=MIN_ZOOM)||(e.deltaY<0&&zoom>=zoomLimit))return;
    e.stopPropagation();
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(zoomLimit, prev * (e.deltaY>0?1/1.2:1.2)));
      // Adjust pan to stay clamped
      setPanX((px) => clampPan(px, 0, next).x);
      setPanY((py) => clampPan(0, py, next).y);
      return next;
    });
  }, [clampPan,zoom,zoomLimit]);

  // ───── Pointer (mouse/single-touch) drag ─────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only start drag for primary pointer (mouse left button or single touch)
    if (e.pointerType === 'touch') {
      // Let touch events handle multi-touch; for single touch we set up on touchStart
      return;
    }
    if (e.button !== 0) return;
    didDrag.current = false;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { x: panX, y: panY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [panX, panY]);

  const queuedPan=useRef<{x:number;y:number}|null>(null),panFrame=useRef<number|null>(null);
  useEffect(()=>()=>{if(panFrame.current!==null)cancelAnimationFrame(panFrame.current);},[]);
  const queuePan=useCallback((value:{x:number;y:number})=>{
    queuedPan.current=value;
    if(panFrame.current!==null)return;
    panFrame.current=requestAnimationFrame(()=>{panFrame.current=null;const next=queuedPan.current;if(next){setPanX(next.x);setPanY(next.y);}});
  },[]);
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // handled by touch events
    if (!isDragging.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if(!rect)return;
    // Convert pixel movement to SVG coordinate movement
    const scaleRatio = CHART_SIZE / (Math.min(rect.width,rect.height) * zoom);
    const dx = (e.clientX - dragStart.current.x) * scaleRatio;
    const dy = (e.clientY - dragStart.current.y) * scaleRatio;
    if (Math.hypot(dx, dy) > 2) didDrag.current = true;
    const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, zoom);
    queuePan(clamped);
  }, [zoom, clampPan,queuePan]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    setDragVersion(value=>value+1);
  }, []);

  // ───── Touch pan & pinch-to-zoom ─────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      didDrag.current = false;
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
    // touch-action and the native pinch listener prevent browser gestures.
    const container = containerRef.current;
    if (!container) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if(!rect)return;

    if (e.touches.length === 1 && isDragging.current) {
      const scaleRatio = CHART_SIZE / (Math.min(rect.width,rect.height) * zoom);
      const dx = (e.touches[0].clientX - dragStart.current.x) * scaleRatio;
      const dy = (e.touches[0].clientY - dragStart.current.y) * scaleRatio;
      if (Math.hypot(dx, dy) > 2) didDrag.current = true;
      const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, zoom);
      queuePan(clamped);
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / lastPinchDist.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(zoomLimit, pinchStartZoom.current * scale));
      setZoom(newZoom);
      // Also track pan movement during pinch
      if (lastPinchCenter.current) {
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        const scaleRatio = CHART_SIZE / (Math.min(rect.width,rect.height) * newZoom);
        const dx = (cx - lastPinchCenter.current.x) * scaleRatio;
        const dy = (cy - lastPinchCenter.current.y) * scaleRatio;
        const clamped = clampPan(panStart.current.x + dx, panStart.current.y + dy, newZoom);
        setPanX(clamped.x);
        setPanY(clamped.y);
      }
    }
  }, [zoom, clampPan,zoomLimit,queuePan]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      lastPinchDist.current = null;
      lastPinchCenter.current = null;
    }
    if (e.touches.length === 0) {
      isDragging.current = false;
      setDragVersion(value=>value+1);
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
      // The modifier always belongs to chart zoom; never resize the browser at a limit.
      if((e.ctrlKey||e.metaKey)&&svgRef.current?.contains(e.target as Node))e.preventDefault();
    };
    el.addEventListener('touchmove', preventZoom, { passive: false });
    el.addEventListener('wheel', preventWheel, { passive: false });
    return () => {
      el.removeEventListener('touchmove', preventZoom);
      el.removeEventListener('wheel', preventWheel);
    };
  }, [zoom]);


  const project = useCallback((ra: number, dec: number) => {
    if (overview && angularDistance(ra, dec, center.ra, center.dec) > 90) return null;
    const p = projectChartPoint({ ra, dec }, projectionFrame, {ra:center.ra,dec:center.dec}, scale);
    if (!p) return null;
    const oriented = orientChartPoint(p, mirrored, rotation);
    const x = cx + oriented.x;
    const y = cy + oriented.y;
    if (x < -16 || x > chartWidth + 16 || y < -16 || y > CHART_SIZE + 16) return null;
    return { x, y };
  }, [projectionFrame, center.ra, center.dec, scale, mirrored, rotation, overview, chartWidth,cx,cy]);

  const starSize = (mag: number) => {
    if (mag < 0.5) return 4.5;
    if (mag < 1.5) return 3.5;
    if (mag < 2.5) return 2.6;
    if (mag < 3.5) return 1.9;
    if (mag < 4.5) return 1.4;
    if (mag < 5.5) return 1.05;
    return 0.8;
  };

  // Glow gradient ID from B-V color index for bright star halos
  const bvGlowId = (bv: number) => {
    if (bv <= -0.3) return 'glow-blue';
    if (bv <= 0.0)  return 'glow-bluewhite';
    if (bv <= 0.3)  return 'glow-white';
    if (bv <= 0.6)  return 'glow-yellowwhite';
    if (bv <= 1.0)  return 'glow-yellow';
    if (bv <= 1.5)  return 'glow-orange';
    return 'glow-red';
  };

  const bgStarSize = (mag: number) => {
    if (mag < 1) return 3.5;
    if (mag < 2) return 2.6;
    if (mag < 3) return 1.9;
    if (mag < 4) return 1.4;
    if (mag < 5) return 1.05;
    if (mag < 6) return 1.0;
    if (mag < 7) return 0.85;
    if (mag < 8) return 0.7;
    return Math.max(0.3,0.68-(mag-8)*0.14);
  };

  const bgStarOpacity = (mag: number) => {
    if (mag < 2) return 0.95;
    if (mag < 3) return 0.88;
    if (mag < 4) return 0.75;
    if (mag < 5) return 0.60;
    if (mag < 6) return 0.65;
    if (mag < 7) return 0.55;
    if (mag < 8) return 0.45;
    return Math.max(0.15,0.45-(mag-8)*0.12);
  };

  const highlightedIds = useMemo(() => {
    const ids = new Set<string>();
    if (route?.startAnchor) ids.add(route.startAnchor.id);
    if (targetNode) ids.add(targetNode.id);
    route?.hops.forEach((hop) => {
      hop.patternAnchors.forEach((star) => ids.add(star.id));
      hop.visibleGuideStars.slice(0, 5).forEach((star) => ids.add(star.id));
    });
    if (hoveredStar) ids.add(hoveredStar.id);
    return ids;
  }, [route, targetNode, hoveredStar]);

  // Compute the "focus point" — the active hop center or target — for proximity enrichment
  const focusPoint = useMemo(() => {
    if (currentHop) return { ra: currentHop.center.ra, dec: currentHop.center.dec };
    if (targetNode) return { ra: targetNode.ra, dec: targetNode.dec };
    return null;
  }, [currentHop, targetNode]);

  // Constellation IDs relevant to the active hop's guide stars — show more of those figures
  const activeConstellationIds = useMemo(() => {
    const ids = new Set<string>();
    if (route) {
      for (const hop of route.hops) {
        for (const s of hop.patternAnchors) if (s.constellation) ids.add(s.constellation);
        for (const s of hop.visibleGuideStars.slice(0, 8)) if (s.constellation) ids.add(s.constellation);
      }
    }
    if (targetNode?.constellation) ids.add(targetNode.constellation);
    if (route?.startAnchor?.constellation) ids.add(route.startAnchor.constellation);
    return ids;
  }, [targetNode, route]);

  // The local enrichment radius — within this distance from the focus point, show deeper stars
  const localRadius = useMemo(() => {
    if (currentHop) return Math.max(8, fovWidth * 2.2);
    return 12;
  }, [currentHop, fovWidth]);

  const visibleStars = useMemo(() => {
    if(!viewport.measured)return [];
    return nodes.filter((node) => {
      const distFromCenter = angularDistance(node.ra, node.dec, center.ra, center.dec);
      if (distFromCenter > viewRadius) return false;

      if(overview&&!showObjects&&(node.type==='binocular'||node.type==='messier'))return false;
      // Always show highlighted, planets, binoculars
      if (highlightedIds.has(node.id)) return true;
      if (node.type === 'planet') return true;
      if (node.type === 'binocular'||node.type === 'messier') return !overview||showObjects;

      // Show all stars up to the user's limiting magnitude
      return node.mag <= limitingMag;
    });
  }, [viewport.measured,nodes, center.ra, center.dec, viewRadius, highlightedIds, limitingMag, overview, showObjects]);

  // Background star layer from dense Hipparcos catalog — pure rendering, no routing
  const backgroundStarLayer = useMemo(() => {
    const result: { x: number; y: number; mag: number; bv: number; ra:number; dec:number }[] = [];
    if(!viewport.measured)return result;
    for (const star of [...denseStars,...deepCatalog.stars]) {
      const [ra, dec, mag, bv] = star;
      if (mag > limitingMag) continue;
      const dist = angularDistance(ra, dec, center.ra, center.dec);
      if (dist > viewRadius * Math.max(1.8,chartAspect*1.8)) continue;
      const p = project(ra, dec);
      if (!p) continue;
      const { x, y } = p;
      if (x < -8 || x > chartWidth + 8 || y < -8 || y > CHART_SIZE + 8) continue;
      result.push({ x, y, mag, bv, ra, dec });
    }
    return result;
  }, [viewport.measured,denseStars, deepCatalog.stars, limitingMag, project, viewRadius, chartAspect, chartWidth,center.ra,center.dec]);

  // ───── Milky Way outline paths (from d3-celestial mw.json) ─────
  // 5 nested polygon layers (ol1–ol5) rendered with additive opacity:
  // overlapping regions appear brighter, creating a natural brightness gradient.
  const milkyWayPaths=useMemo(()=>viewport.measured?projectMilkyWay(milkyWay,projectionFrame,center,scale,mirrored,rotation,overview,chartWidth,CHART_SIZE):[],[viewport.measured,milkyWay,projectionFrame,center,scale,mirrored,rotation,overview,chartWidth]);

  const constellationPaths = useMemo(() => {
    const paths: { d: string; id: string; nearFocus: boolean }[] = [];
    if(!viewport.measured)return paths;
    for (const constellation of constellations) {
      // Check if any vertex of this constellation is near the focus
      const isNearFocus = focusPoint ? constellation.points.some(seg =>
        seg.some(([ra, dec]) => angularDistance(ra, dec, focusPoint.ra, focusPoint.dec) < localRadius * 1.2)
      ) : false;
      const isActiveConstellation = activeConstellationIds.has(constellation.id);
      const nearFocus = overview || isNearFocus || isActiveConstellation;

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
  }, [viewport.measured,constellations, project, focusPoint, localRadius, activeConstellationIds, overview]);

  // ───── Constellation name labels at centroid of visible constellations ─────
  const constellationLabels = useMemo(() => {
    if (!showConstellations||!viewport.measured) return [];
    const labels: { x: number; y: number; name: string; key: string; nearFocus: boolean; prominence:number }[] = [];
    for (let index=0;index<constellations.length;index++) {
      const constellation=constellations[index];
      // Compute centroid of all vertices
      const vertices = constellation.points.flat().map(([ra, dec]) => ({ ra, dec }));
      if (!vertices.length) continue;
      const { ra: avgRa, dec: avgDec } = chartFrame(vertices);

      // Only show if centroid is within the view
      const dist = angularDistance(avgRa, avgDec, center.ra, center.dec);
      if (dist > viewRadius * 1.1) continue;

      const p = projectChartPoint({ ra: avgRa, dec: avgDec }, projectionFrame, {ra:center.ra,dec:center.dec}, scale);
      if (!p) continue;
      const oriented = orientChartPoint(p, mirrored, rotation);
      const x = cx + oriented.x;
      const y = cy + oriented.y;
      if (x < 20 || x > chartWidth - 20 || y < 20 || y > CHART_SIZE - 20) continue;

      const isNearFocus = focusPoint ? dist < localRadius * 1.2 : false;
      const isActive = activeConstellationIds.has(constellation.id);

      labels.push({
        x, y,
        name: getConstellationName(constellation.id),
        // Serpens has two separate source figures. Reusing its abbreviation
        // as a React key leaves stale labels behind after resize or filtering.
        key: `${constellation.id}-${index}`,
        nearFocus: overview || isNearFocus || isActive,
        prominence: ['Ori','Tau','Per','Cas','And','Peg','Cyg','Aur','Gem','UMa','UMi','Sco','Sgr','Leo','Cma'].includes(constellation.id)?100:0,
      });
    }
    return labels;
  }, [viewport.measured,constellations, projectionFrame, mirrored, rotation, center.ra, center.dec, scale, viewRadius, focusPoint, localRadius, activeConstellationIds, showConstellations, chartWidth,cx,cy,overview]);

  const routePath = useMemo(() => {
    if (!route) return null;
    const points = route.hops
      .map((hop) => project(hop.center.ra, hop.center.dec))
      .filter(Boolean) as { x: number; y: number }[];
    if (points.length < 2) return null;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L${points[i].x},${points[i].y}`;
    return d;
  }, [route, project]);

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
  }, [route, animStep, project]);

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
  }, [visibleStars, route, targetNode, currentHop, project]);

  // Compact chart labels: constellation abbreviation to save space
  const chartLabel = useCallback((star: SkyNode): string => {
    if(overview&&isDeepSky(star.category))return star.id.startsWith('AST-')?star.name:star.id;
    if (star.name && star.name.length > 2 && !star.name.startsWith('HR') && star.name !== star.bayer) {
      return star.name;
    }
    if (star.bayer && star.constellation) return `${star.bayer} ${star.constellation}`;
    if (star.flamsteed && star.constellation) return `${star.flamsteed} ${star.constellation}`;
    if (star.name && !star.name.startsWith('HR')) return star.name;
    return '';  // skip labels for HR-only stars
  },[overview]);

  type PlacedSkyLabel={star:SkyNode;x:number;y:number;anchor:'start'|'end'|'middle';width:number;isAnchor:boolean;isTarget:boolean;isPatternAnchor:boolean;box:LabelBox;leader:{x:number;y:number}|null};
  const labelCache=useRef<PlacedSkyLabel[]>([]);
  const constellationCache=useRef<Array<typeof constellationLabels[number]&{box:LabelBox}>>([]);
  const labels = useMemo(() => {
    // Re-place cached names when a drag finishes, even if geometry is unchanged.
    void dragVersion;
    if(isDragging.current)return labelCache.current;
    if (!viewport.measured) return [];
    const candidates = plottedStars
      .filter(({ star, isAnchor, isTarget, isPatternAnchor, isGuide }) => {
        if(labelSize===0)return isTarget;
        if (isTarget || isAnchor || isPatternAnchor || star.type==='planet') return true;
        if(overview&&isDeepSky(star.category))return true;
        if (isGuide && !!star.name) return true;
        // Bright named stars always get labels
        if (star.type==='star' && star.mag <= 2.5 && !!star.name && !star.name.startsWith('HR')) return true;
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
        const catalogPriority=(star:SkyNode)=>overview?(star.type==='star'&&star.mag<=2.5?100+(['Deneb','Polaris','Fomalhaut','Schedar','Caph'].includes(chartLabel(star))?15:0):isDeepSky(star.category)?(/^M\d+$/.test(star.id)?74:skyObjectKind(star.category)==='field'?8:25):0):0;
        const scoreA = (a.isTarget ? 10000 : 0) + (a.star.type==='planet'?900:0) + (['M31','M45'].includes(a.star.id)?700:0) + (a.isAnchor ? 70 : 0) + (a.isPatternAnchor ? 45 : 0) + (a.isGuide ? 20 : 0) + catalogPriority(a.star) - a.star.mag * 4 + focusBonusA;
        const scoreB = (b.isTarget ? 10000 : 0) + (b.star.type==='planet'?900:0) + (['M31','M45'].includes(b.star.id)?700:0) + (b.isAnchor ? 70 : 0) + (b.isPatternAnchor ? 45 : 0) + (b.isGuide ? 20 : 0) + catalogPriority(b.star) - b.star.mag * 4 + focusBonusB;
        return scoreB - scoreA;
      });

    // Names use explicit leaders. A nearby faint catalogue marker must not
    // veto a navigation name, but the entire marker remains unobscured.
    const protectedPoints=plottedStars.filter(item=>item.star.type!=='star'||item.star.mag<=4.5||item.isTarget||item.isAnchor).map(item=>({id:item.star.id,...item.point,blocksPriority:item.star.type==='planet'||item.star.type==='star'&&item.star.mag<=2,radius:(item.isTarget?10:item.star.type==='star'?Math.max(2,stellarRadius(item.star.mag)*Math.min(1.8,brightMul)*catalogPointScale):item.star.type==='planet'?7:6)*screenUnit}));
    const nearby=labelPointLookup(protectedPoints,32*screenUnit);
    const accepted:PlacedSkyLabel[]=[];
    const measure=document.createElement('canvas').getContext('2d');
    const family=getComputedStyle(svgRef.current??document.body).getPropertyValue('--font-sans')||'sans-serif';
    const usedNames=new Set<string>();
    let catalogLabels=0;
    for(const candidate of candidates){
      const priority=candidate.isTarget||candidate.isAnchor||candidate.isPatternAnchor||candidate.star.type==='planet'||candidate.star.type==='star'&&candidate.star.mag<=2.5||['M31','M45'].includes(candidate.star.id);
      const catalogLabel=overview&&!priority&&candidate.star.type!=='star';
      if(catalogLabel&&catalogLabels>=(viewportPixels<430?5:12))continue;
      const text=chartLabel(candidate.star);if(!text||usedNames.has(text))continue;
      if(measure)measure.font=`${candidate.isTarget||candidate.isAnchor?'700':'500'} ${labelUnits}px ${family}`;
      const width=Math.max(labelUnits*1.5,measure?.measureText(text).width??text.length*labelUnits*.63);
      const height=labelUnits*1.25,pad=2*screenUnit;
      let placed=false;
      // Short leaders are preferred. Longer choices are reserved for priority
      // names in rich fields, where an adjacent name would cover another target.
      for(const distance of (priority?[10,17,25,36,50,70,95]:[9,16,25])){
        for(const angle of [0,Math.PI,-Math.PI/4,Math.PI/4,-3*Math.PI/4,3*Math.PI/4,-Math.PI/2,Math.PI/2,...Array.from({length:16},(_,i)=>i*Math.PI/8)]){
          const x=candidate.point.x+Math.cos(angle)*(distance*screenUnit+width/2+pad);
          const midY=candidate.point.y+Math.sin(angle)*(distance*screenUnit+height/2+pad);
          const y=midY+labelUnits*.36;
          const box={left:x-width/2-pad,right:x+width/2+pad,top:midY-height/2,bottom:midY+height/2};
          if(!labelFits(box,labelViewport,labelCircle)||reservedLabels.some(area=>boxesOverlap(box,area))||accepted.some(label=>boxesOverlap(box,label.box,2*screenUnit)))continue;
          if(nearby(box,14*screenUnit).some(point=>{
            if(point.id===candidate.star.id)return false;
            if(priority&&!(point as typeof protectedPoints[number]).blocksPriority)return false;
            const r=(point as typeof protectedPoints[number]).radius+2*screenUnit;
            return boxesOverlap(box,{left:point.x-r,right:point.x+r,top:point.y-r,bottom:point.y+r});
          }))continue;
          accepted.push({star:candidate.star,x,y,anchor:'middle',width,isAnchor:candidate.isAnchor,isTarget:candidate.isTarget,isPatternAnchor:candidate.isPatternAnchor,box,leader:candidate.point});
          usedNames.add(text);if(catalogLabel)catalogLabels++;placed=true;break;
        }
        if(placed)break;
      }
      if(accepted.length>=(overview?(viewportPixels<430?32:60):36))break;
    }

    labelCache.current=accepted;
    return accepted;
  }, [viewport.measured,dragVersion,plottedStars, activeConstellationIds, focusPoint, localRadius, labelSize, labelUnits, screenUnit, overview, viewportPixels,brightMul,catalogPointScale,chartLabel,labelCircle,labelViewport,reservedLabels]);

  const placedConstellationLabels=useMemo(()=>{
    void dragVersion;
    if(isDragging.current)return constellationCache.current;
    const occupied=[...reservedLabels,...labels.map(label=>label.box),...plottedStars.flatMap(item=>{const box=constellationSymbolBox(item.star,item.point,screenUnit,item.isTarget);return box?[box]:[];})];
    const accepted:Array<typeof constellationLabels[number]&{box:LabelBox}>=[];
    const font=Math.max(12,labelSize*.85)*screenUnit;
    // Uppercase names vary considerably in width (e.g. SERPENS). Measure
    // the same font as the SVG so collision bounds match the visible text.
    const measure=document.createElement('canvas').getContext('2d');
    if(measure)measure.font=`500 ${font}px ${getComputedStyle(svgRef.current??document.body).getPropertyValue('--font-sans')||'sans-serif'}`;
    const figureSegments=new Map<string,Array<{x:number;y:number;length:number;nx:number;ny:number}>>();
    const segments:Array<{id:string;a:{x:number;y:number};b:{x:number;y:number}}>=[];
    for(const path of constellationPaths){
      const id=path.id.split('-')[0],anchors=figureSegments.get(id)??[];
      const points=Array.from(path.d.matchAll(/[ML]([\d.eE+-]+),([\d.eE+-]+)/g)).map(m=>({x:+m[1],y:+m[2]}));
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)continue;segments.push({id,a,b});for(const f of [.5,.25,.75])anchors.push({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,length,nx:(b.y-a.y)/length,ny:-(b.x-a.x)/length});}
      figureSegments.set(id,anchors);
    }
    for(const label of constellationLabels.slice().sort((a,b)=>Number(b.key.split('-')[0]===highlightedFigure)-Number(a.key.split('-')[0]===highlightedFigure)||b.prominence-a.prominence||Number(b.nearFocus)-Number(a.nearFocus)||Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy))){
      const text=overview&&viewportPixels<430&&label.key.split('-')[0]!==highlightedFigure?label.key.split('-')[0].toUpperCase():label.name.toUpperCase();
      const metrics=measure?.measureText(text);
      const width=(metrics?.width??text.length*font*.8)+text.length*.6*screenUnit;
      const ascent=Math.max(font,metrics?.fontBoundingBoxAscent??font);
      const descent=Math.max(font*.3,metrics?.fontBoundingBoxDescent??font*.3);
      // Anchor each name on its own figure, rather than nudging a centroid
      // into a neighbouring constellation. Try other segments when crowded.
      const options=(figureSegments.get(label.key.split('-')[0])??[]).filter(p=>p.length>font).sort((a,b)=>Math.hypot(a.x-label.x,a.y-label.y)-Math.hypot(b.x-label.x,b.y-label.y)||b.length-a.length).slice(0,24);
      const id=label.key.split('-')[0],ownSegments=segments.filter(s=>s.id===id);
      let placed=false;
      for(const option of options){
        for(const offset of [0,14,-14,28,-28]){
          const point={x:option.x+option.nx*offset*screenUnit,y:option.y+option.ny*offset*screenUnit};
          const x=point.x,y=point.y+font*.3;
          const box={left:x-width/2,right:x+width/2,top:y-ascent,bottom:y+descent};
          if(!labelFits(box,labelViewport,labelCircle)||occupied.some(area=>boxesOverlap(box,area,3*screenUnit)))continue;
          const own=Math.sqrt(Math.min(...ownSegments.map(s=>pointSegmentDistanceSquared(point,s.a,s.b)))),limit=own+2*screenUnit;
          // A cheap segment-bounds check avoids scanning every figure in detail.
          if(segments.some(s=>s.id!==id&&point.x>=Math.min(s.a.x,s.b.x)-limit&&point.x<=Math.max(s.a.x,s.b.x)+limit&&point.y>=Math.min(s.a.y,s.b.y)-limit&&point.y<=Math.max(s.a.y,s.b.y)+limit&&pointSegmentDistanceSquared(point,s.a,s.b)<limit*limit))continue;
          occupied.push(box);accepted.push({...label,x,y,box});placed=true;break;
        }
        if(placed)break;
      }
      if(overview&&accepted.length>=(viewportPixels<430?12:22))break;
    }
    constellationCache.current=accepted;
    return accepted;
  },[highlightedFigure,dragVersion,constellationPaths,constellationLabels,labels,plottedStars,labelSize,screenUnit,viewportPixels,cx,cy,labelCircle,labelViewport,overview,reservedLabels]);



  const figureChoices=useMemo(()=>{
    if(!overview)return [];
    const ids=Array.from(new Set(constellations.filter(c=>c.points.flat().some(([ra,dec])=>eqToHorizontal(ra,dec,lat,lon,date).alt>0)).map(c=>c.id)));
    return ids.map(id=>({id,name:getConstellationName(id)}));
  },[overview,constellations,lat,lon,date]);

  const visibleLabels=labels.filter(label=>!starsOnly||label.isTarget);

  const fovCenter = currentHop ? project(currentHop.center.ra, currentHop.center.dec) : targetNode ? project(targetNode.ra, targetNode.dec) : null;
  const finderRings = useMemo<Array<{ id: string; diameter?: number; d: string }>>(() => {
    const focus = currentHop?.center ?? targetNode;
    if (overview || !focus) return [];
    if (activeFinderReticle === 'crosshair') return [fovWidth, fovShape === 'rectangle' ? fovHeight : fovWidth].flatMap((field, axis) => {
      const points = Array.from({ length: 33 }, (_, index) => angularRing(focus, (index / 32 - .5) * field, 4)[axis === 0 ? 1 : 0]).map(point => project(point.ra, point.dec));
      if (points.some(point => !point)) return [];
      return [{ id: `axis-${axis}`, d: points.map((point, index) => `${index ? 'L' : 'M'}${point!.x},${point!.y}`).join(' ') }];
    });
    return RETICLE_DIAMETERS[activeFinderReticle].flatMap(diameter => {
      const points = angularRing(focus, diameter / 2).map(point => project(point.ra, point.dec));
      if (points.some(point => !point)) return [];
      return [{ id: String(diameter), diameter, d: points.map((point, index) => `${index ? 'L' : 'M'}${point!.x},${point!.y}`).join(' ') + ' Z' }];
    });
  }, [currentHop, targetNode, overview, activeFinderReticle, project, fovWidth, fovHeight, fovShape]);

  // These boundaries use sky angles, with no minimum pixel size. The compact
  // catalogue symbols remain separate locator marks when an object is tiny.
  const angularExtents=useMemo(()=>{
    if(!showAngularExtents||starsOnly)return [];
    return plottedStars.flatMap(({star,isTarget})=>{
      if(star.type==='star'||star.type==='planet')return [];
      const extent=catalogExtent(star)??(isTarget&&targetDiameter?{major:targetDiameter,minor:targetDiameter,positionAngle:null,minorKnown:false,source:'Catalog diameter'}:null);
      if(!extent)return [];
      // An unknown position angle is a diameter envelope, never an invented
      // rotation for an elongated galaxy or nebula.
      const oriented=extent.positionAngle!==null;
      const points=angularEllipse(star,extent.major,oriented?extent.minor:extent.major,extent.positionAngle??0).map(p=>{
        const projected=projectChartPoint(p,projectionFrame,center,scale);if(!projected)return null;
        const v=orientChartPoint(projected,mirrored,rotation);return{x:cx+v.x,y:cy+v.y};
      });
      if(points.some(p=>!p))return [];
      return [{id:star.id,isTarget,extent,oriented,d:points.map((p,i)=>`${i?'L':'M'}${p!.x},${p!.y}`).join(' ')+' Z'}];
    });
  },[showAngularExtents,starsOnly,plottedStars,targetDiameter,projectionFrame,center,scale,mirrored,rotation,cx,cy]);
  const opticalField=useMemo(()=>{
    if(!overview||!showOpticalField)return null;
    const at={x:viewBoxX+viewBoxWidth/2,y:viewBoxY+viewBoxHeight/2};
    const skyCenter=unprojectChartPoint({x:at.x-cx,y:at.y-cy},projectionFrame,center,scale);
    const points=angularField(skyCenter,fovWidth,fovHeight,fovShape).map(p=>projectChartPoint(p,projectionFrame,center,scale)).filter((p):p is {x:number;y:number}=>!!p);
    if(points.length<4)return null;
    return {center:skyCenter,x:at.x,y:at.y,d:points.map((p,i)=>`${i?'L':'M'}${cx+p.x},${cy+p.y}`).join(' ')+' Z'};
  },[overview,showOpticalField,viewBoxX,viewBoxY,viewBoxWidth,viewBoxHeight,cx,cy,projectionFrame,center,scale,fovWidth,fovHeight,fovShape]);
  const fitOpticalField=()=>{
    const focus=currentHop?.center??(targetNode&&(!overview||targetNode.alt>0)?targetNode:opticalField?.center??center);
    const at=project(focus.ra,focus.dec);if(!at)return;
    const points=angularField(focus,fovWidth,fovHeight,fovShape).flatMap(p=>{
      const v=projectChartPoint(p,projectionFrame,center,scale);if(!v)return [];
      const oriented=orientChartPoint(v,mirrored,rotation);return[{x:cx+oriented.x,y:cy+oriented.y}];
    });
    if(!points.length)return;
    const radiusX=Math.max(...points.map(p=>Math.abs(p.x-at.x))),radiusY=Math.max(...points.map(p=>Math.abs(p.y-at.y)));
    const z=Math.max(MIN_ZOOM,Math.min(zoomLimit,(chartWidth-80)/(2*radiusX),(CHART_SIZE-80)/(2*radiusY)));
    setZoom(z);setShowOpticalField(true);
    const p=clampPan(cx-at.x,cy-at.y,z);setPanX(p.x);setPanY(p.y);
  };

  // SVG shapes for pattern visualization
  const renderPatternShape = useCallback((
    patternType: PatternType,
    anchors: SkyNode[],
    opacity: number,
  ): React.ReactNode | null => {
    if (anchors.length < 2) return null;
    const projected = anchors
      .map(star => project(star.ra, star.dec))
      .filter(Boolean) as { x: number; y: number }[];
    if (projected.length < 2) return null;

    const strokeColor = '#c084fc';
    const fillColor = `rgba(192, 132, 252, ${(0.12 * opacity).toFixed(3)})`;
    const sw = 1.2;
    const so = opacity;

    switch (patternType) {
      case 'triangle':
      case 'diamond':
      case 'trapezoid':
      case 'kite': {
        if (projected.length < 3) return null;
        const pts = projected.map(p => `${p.x},${p.y}`).join(' ');
        return <polygon points={pts} fill={fillColor} stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} strokeLinejoin="round" />;
      }
      case 'chain':
      case 'zigzag': {
        const pts = projected.map(p => `${p.x},${p.y}`).join(' ');
        return <polyline points={pts} fill="none" stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} strokeDasharray={patternType === 'zigzag' ? '3 2' : '5 3'} strokeLinecap="round" />;
      }
      case 'arc': {
        if (projected.length < 3) return null;
        const d = projected.length === 3
          ? `M${projected[0].x},${projected[0].y} Q${projected[1].x},${projected[1].y} ${projected[2].x},${projected[2].y}`
          : `M${projected.map(p => `${p.x},${p.y}`).join(' L')}`;
        return <path d={d} fill="none" stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} strokeDasharray="4 3" strokeLinecap="round" />;
      }
      case 'cross': {
        if (projected.length < 4) return null;
        return (
          <g>
            <line x1={projected[0].x} y1={projected[0].y} x2={projected[1].x} y2={projected[1].y} stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} />
            <line x1={projected[2].x} y1={projected[2].y} x2={projected[3].x} y2={projected[3].y} stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} />
          </g>
        );
      }
      case 'arrow': {
        const pts = projected.map(p => `${p.x},${p.y}`).join(' ');
        return <polyline points={pts} fill="none" stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw} opacity={so} markerEnd={`url(#${chartId}-pattern-arrowhead)`} strokeLinecap="round" strokeLinejoin="round" />;
      }
      case 'bracket': {
        if (!fovCenter || projected.length < 2) return null;
        return (
          <g>
            {projected.map((p, i) => (
              <line key={i} x1={fovCenter.x} y1={fovCenter.y} x2={p.x} y2={p.y} stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw * 0.8} opacity={so * 0.7} strokeDasharray="4 3" />
            ))}
          </g>
        );
      }
      case 'pair': {
        return <line x1={projected[0].x} y1={projected[0].y} x2={projected[1].x} y2={projected[1].y} stroke={strokeColor} vectorEffect="non-scaling-stroke" strokeWidth={sw * 0.7} opacity={so * 0.5} strokeDasharray="3 4" />;
      }
      default:
        return null;
    }
  }, [project, fovCenter,chartId]);

  const patternShapeSvg = useMemo(() => {
    if (!route || !currentHop) return null;
    return renderPatternShape(currentHop.patternType, currentHop.patternAnchors, 0.55);
  }, [route, currentHop, renderPatternShape]);

  const ghostPatternShapes = useMemo(() => {
    if (!route) return null;
    return route.hops
      .filter((_, index) => index === animStep+1)
      .map((hop, i) => (
        <g key={`ghost-pattern-${i}`}>
          {renderPatternShape(hop.patternType, hop.patternAnchors, 0.12)}
        </g>
      ));
  }, [route, animStep, renderPatternShape]);

  // Geometry and catalog-derived colors are stable while panning. Reuse the
  // paths and let the SVG viewport clip them instead of rebuilding every star.
  const backgroundPoints=useMemo(()=>backgroundStarLayer.map(star=>({x:star.x,y:star.y,r:Math.max(.55,bgStarSize(star.mag)*brightMul*backgroundPointScale)*screenUnit,color:stellarColor(undefined,star.bv),opacity:Math.min(.97,bgStarOpacity(star.mag)*brightMul)})),[backgroundStarLayer,brightMul,backgroundPointScale,screenUnit]);
  const catalogPoints=useMemo(()=>plottedStars.filter(item=>isBatchedStar(item)&&item.star.mag>4.5).map(({star,point})=>({x:point.x,y:point.y,r:Math.max(.65,stellarRadius(star.mag)*Math.min(1.8,brightMul)*catalogPointScale)*screenUnit,color:stellarColor(star.temperature,star.bv),opacity:Math.min(.95,.6*brightMul)})),[plottedStars,brightMul,catalogPointScale,screenUnit]);
  const foregroundCatalogPoints=useMemo(()=>plottedStars.filter(item=>isBatchedStar(item)&&item.star.mag<=4.5).map(({star,point})=>({x:point.x,y:point.y,r:Math.max(.65,stellarRadius(star.mag)*Math.min(1.8,brightMul)*catalogPointScale)*screenUnit,color:stellarColor(star.temperature,star.bv),opacity:Math.min(.95,.6*brightMul)})),[plottedStars,brightMul,catalogPointScale,screenUnit]);
  return (
    <div
      ref={containerRef}
      className="sky-chart-root relative select-none"
      data-testid="sky-chart"
      data-projection={overview ? 'overhead' : 'fixed-equatorial'}
      data-rotation={rotation}
      data-mirrored={mirrored}
      data-zoom={zoom}
      data-fov-radius={fovRadius}
    >

      <svg
        onClick={event=>{
          if(!onSelect||didDrag.current||(event.target as Element).closest('[data-star-id],[role="button"]'))return;
          const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;
          const cursor=event.currentTarget.createSVGPoint();cursor.x=event.clientX;cursor.y=event.clientY;
          const point=cursor.matrixTransform(matrix.inverse());
          let distance=7*screenUnit,nearest:SkyNode|null=null;
          for(const item of plottedStars){if(!isBatchedStar(item))continue;const d=Math.hypot(item.point.x-point.x,item.point.y-point.y);if(d<distance){distance=d;nearest=item.star;}}
          if(nearest)onSelect(nearest.id);
        }}
        tabIndex={onSelect?0:undefined}
        onKeyDown={event=>{
          if(!onSelect)return;
          const choices=visibleLabels.filter(item=>item.x>=viewBoxX&&item.x<=viewBoxX+viewBoxWidth&&item.y>=viewBoxY&&item.y<=viewBoxY+viewBoxHeight);
          if(event.key==='Enter'&&hoveredStar){event.preventDefault();onSelect(hoveredStar.id);}
          if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&choices.length){event.preventDefault();const i=choices.findIndex(item=>item.star.id===hoveredStar?.id);setHoveredStar(choices[(i+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+choices.length)%choices.length].star);}
        }}
        ref={svgRef}
        width="100%"
        viewBox={`${viewBoxX.toFixed(2)} ${viewBoxY.toFixed(2)} ${viewBoxWidth.toFixed(2)} ${viewBoxHeight.toFixed(2)}`}
        className="bg-[#0a0c14] rounded-lg cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: 'auto', height: overview?'min(90vw, 76vh, 820px)':'min(90vw, 600px)', maxHeight: overview?'min(76vh, 820px)':'600px', touchAction: 'none' }}
        role="group"
        aria-label={overview ? "Interactive overhead sky chart. Arrow keys inspect labeled objects; Enter selects." : "Interactive star hopping field chart. Arrow keys inspect labeled objects; Enter selects."}
        data-testid="sky-chart-sky"
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
          <clipPath id={`${chartId}-sky-horizon-clip`}><circle cx={cx} cy={cy} r={CHART_SIZE / 2 - CHART_PAD} /></clipPath>
          <radialGradient id={`${chartId}-sky-gradient`}>
            <stop offset="0%" stopColor="#0d1020" />
            <stop offset="100%" stopColor="#070910" />
          </radialGradient>
          <filter id={`${chartId}-glow-soft`}>
            <feGaussianBlur stdDeviation={1.2*screenUnit} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${chartId}-glow-strong`}>
            <feGaussianBlur stdDeviation={2.2*screenUnit} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Star glow gradients by spectral type */}
          <radialGradient id={`${chartId}-glow-blue`}><stop offset="0%" stopColor="#a0b5ff" stopOpacity="0.4" /><stop offset="100%" stopColor="#a0b5ff" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-bluewhite`}><stop offset="0%" stopColor="#c4d4ff" stopOpacity="0.35" /><stop offset="100%" stopColor="#c4d4ff" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-white`}><stop offset="0%" stopColor="#e8eeff" stopOpacity="0.3" /><stop offset="100%" stopColor="#e8eeff" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-yellowwhite`}><stop offset="0%" stopColor="#fff8f0" stopOpacity="0.3" /><stop offset="100%" stopColor="#fff8f0" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-yellow`}><stop offset="0%" stopColor="#ffddb0" stopOpacity="0.25" /><stop offset="100%" stopColor="#ffddb0" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-orange`}><stop offset="0%" stopColor="#ffaa80" stopOpacity="0.25" /><stop offset="100%" stopColor="#ffaa80" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${chartId}-glow-red`}><stop offset="0%" stopColor="#ff9070" stopOpacity="0.25" /><stop offset="100%" stopColor="#ff9070" stopOpacity="0" /></radialGradient>
          <marker
            id={`${chartId}-pattern-arrowhead`}
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#c084fc" opacity="0.7" />
          </marker>
        </defs>

        <rect width={chartWidth} height={CHART_SIZE} fill={`url(#${chartId}-sky-gradient)`} rx="8" />

        <g clipPath={overview ? `url(#${chartId}-sky-horizon-clip)` : undefined}>

        {/* Milky Way band — 5 nested polygon layers with additive opacity */}
        <g clipPath="inset(0)">
          {!starsOnly && milkyWayPaths.map((path, i) => (
            <path data-milky-way={path.id} key={`mw-${path.id}-${i}`} d={path.d}
              fill={viewRadius<10?"rgba(170, 190, 255, 0.009)":"rgba(170, 190, 255, 0.028)"} fillRule="evenodd" stroke="none" />
          ))}
        </g>

        {overview&&[30,60].map(alt=><g key={alt} pointerEvents="none"><circle cx={cx} cy={cy} r={260*altitudeRingFraction(alt)} fill="none" stroke="#56736e" strokeWidth=".7" vectorEffect="non-scaling-stroke" strokeDasharray="3 6" opacity=".55"/><text x={cx+4*screenUnit} y={cy+260*altitudeRingFraction(alt)-4*screenUnit} fontSize={12*screenUnit} fill="#9bb7ae">{alt}° altitude</text></g>)}
        {!starsOnly && !overview && [5, 10, 20].filter((r) => r < viewRadius).map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r * scale}
            fill="none"
            stroke="#182034"
            vectorEffect="non-scaling-stroke" strokeWidth="0.6"
            strokeDasharray="4 5"
          />
        ))}

        {!starsOnly && showConstellations && constellationPaths.map((path, index) => (
          <path
            key={`${path.id}-${index}`}
            d={path.d}
            data-constellation-path={path.id}
            stroke={highlightedFigure===path.id.split('-')[0]?'#48dcf0':overview?'#5a8abf':path.nearFocus ? '#456383' : '#31465e'}
            vectorEffect="non-scaling-stroke" strokeWidth={highlightedFigure===path.id.split('-')[0]?3.5:overview?1.4:path.nearFocus ? 1 : 0.7}
            fill="none"
            opacity={highlightedFigure?(highlightedFigure===path.id.split('-')[0]?1:.18):overview?.8:path.nearFocus ? .55 : .3}
            strokeLinecap="round"
          />
        ))}

        {/* Constellation name labels */}
        {!starsOnly && labelSize > 0 && showConstellations && placedConstellationLabels.map((label) => (
          <text
            key={`cname-${label.key}`}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fill={label.nearFocus ? '#a7cfa0' : '#8bad86'}
            opacity={label.nearFocus ? 0.95 : 0.8}
            fontSize={Math.max(12, labelSize * 0.85)*screenUnit}
            data-chart-label="constellation"
            data-constellation-id={label.key.split('-')[0]}
            aria-label={`Constellation ${label.name}`}
            fontFamily="var(--font-sans)"
            fontWeight="500"
            letterSpacing={.6*screenUnit}
            paintOrder="stroke" stroke="#080a12" strokeWidth={3*screenUnit}
            pointerEvents="none"
          >
            <title>{label.name}</title>
            {overview&&viewportPixels<430&&label.key.split('-')[0]!==highlightedFigure?label.key.split('-')[0].toUpperCase():label.name.toUpperCase()}
          </text>
        ))}

        {/* Dense background star field from Hipparcos catalog */}
        <BatchedStarLayer points={backgroundPoints} />
        <BatchedStarLayer points={catalogPoints} />

        {!starsOnly && routePath && <path d={routePath} stroke="#ad8f58" vectorEffect="non-scaling-stroke" strokeWidth="1.2" fill="none" opacity="0.26" strokeDasharray="5 4" />}
        {!starsOnly && routeProgressPath && <path d={routeProgressPath} stroke="#e4ba72" vectorEffect="non-scaling-stroke" strokeWidth="1.8" fill="none" opacity="0.88" />}

        {/* Ghost pattern shapes for upcoming hops */}
        {!starsOnly && ghostPatternShapes}
        {/* Active pattern shape visualization */}
        {!starsOnly && patternShapeSvg}
        {!starsOnly && currentHop?.patternLabels.map(({label,star})=>{
          const point=project(star.ra,star.dec);
          if(!point)return null;
          const x=point.x+10*screenUnit,y=point.y-10*screenUnit,r=8*screenUnit;
          return <g key={`pattern-label-${label}`} data-pattern-label={label} aria-label={`Pattern point ${label}: ${star.name}`} pointerEvents="none">
            <circle cx={x} cy={y} r={r} fill="#301a46" stroke="#d6b4f5" strokeWidth={1} vectorEffect="non-scaling-stroke"/>
            <text x={x} y={y+4*screenUnit} textAnchor="middle" fill="#f5eaff" fontSize={12*screenUnit} fontWeight="700" fontFamily="var(--font-sans)">{label}</text>
          </g>;
        })}

        {!starsOnly && showGhostCircles && route && route.hops
          .map((hop, index) => ({ hop, index }))
          .filter(({ index }) => index === animStep+1)
          .map(({ hop, index }) => {
            const pt = project(hop.center.ra, hop.center.dec);
            if (!pt) return null;
            return (
              <g key={`ghost-fov-${index}`}>
                {fovShape === 'circle' ? (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={fovRadius}
                    fill="rgba(245, 158, 11, 0.05)"
                    stroke="rgba(245, 158, 11, 0.30)"
                    vectorEffect="non-scaling-stroke" strokeWidth="1"
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
                    vectorEffect="non-scaling-stroke" strokeWidth="1"
                    strokeDasharray="4 4"
                    rx="3"
                  />
                )}
              </g>
            );
          })}

        {!starsOnly && route?.hops.map((hop, index) => {
          const point = project(hop.center.ra, hop.center.dec);
          if (!point) return null;
          const active = index === animStep;
          return (
            <g key={`hop-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={(active ? 4.3 : 2.6) * navMul * screenUnit}
                fill={index === 0 ? '#38bdf8' : index === route.hops.length - 1 ? '#f59e0b' : '#6366f1'}
                opacity={active ? 1 : 0.7}
                filter={active ? `url(#${chartId}-glow-soft)` : undefined}
              />
              <text
                x={point.x}
                y={point.y - 8*screenUnit}
                textAnchor="middle"
                fill={active ? '#f5f7ff' : '#94a3c7'}
                fontSize={12*screenUnit}
                fontWeight={active ? '700' : '500'}
                fontFamily="var(--font-sans)"
              >
                {index + 1}
              </text>
            </g>
          );
        })}

        {fovCenter && !overview && (
          <g>
            {fovShape === 'circle' ? (
              <circle
                cx={fovCenter.x}
                cy={fovCenter.y}
                r={fovRadius}
                fill="rgba(79, 195, 255, 0.05)"
                stroke="rgba(79, 195, 255, 0.45)"
                vectorEffect="non-scaling-stroke" strokeWidth="1"
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
                vectorEffect="non-scaling-stroke" strokeWidth="1"
                strokeDasharray="4 4"
                rx="3"
              />
            )}
          </g>
        )}

        {angularExtents.map(outline=><path key={`extent-${outline.id}`} data-angular-extent={outline.id} data-target-extent={outline.isTarget?true:undefined} data-major-degrees={outline.extent.major} data-minor-degrees={outline.extent.minor} data-position-angle={outline.extent.positionAngle??'unknown'} d={outline.d} fill={outline.oriented?'#7cbaa60a':'none'} stroke={outline.isTarget?'#ddbd80':'#85b9ab'} strokeWidth={outline.isTarget?1.5:1} strokeDasharray={outline.oriented?'4 3':'1 4'} vectorEffect="non-scaling-stroke" opacity={outline.isTarget?.9:.6} pointerEvents="none"><title>{outline.id}: {outline.extent.major.toFixed(2)}° × {outline.extent.minor.toFixed(2)}° · {outline.oriented?`PA ${outline.extent.positionAngle}°`:'diameter envelope; orientation not catalogued'} · {outline.extent.source}</title></path>)}
        {!starsOnly && finderRings.map(ring => <path key={ring.id} data-reticle-diameter={ring.diameter} data-finder-crosshair={activeFinderReticle === 'crosshair' ? true : undefined} d={ring.d} fill="none" stroke="#adc7b6" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity=".85" pointerEvents="none"/>)}

        {visibleLabels.map((label) => {
          const text = chartLabel(label.star);
          if (!text) return null;
          const pad = Math.max(screenUnit, labelUnits * 0.4);
          return (
            <g data-label-owner={label.star.id} data-explicit-leader="true" key={`${label.star.id}-label`} pointerEvents={onSelect ? "auto" : "none"} role={onSelect ? "button" : undefined} tabIndex={undefined} aria-label={onSelect ? `Select ${chartLabel(label.star)}` : undefined} onClick={() => { if(!didDrag.current)onSelect?.(label.star.id); }} onKeyDown={event => {if(onSelect&&(event.key==="Enter"||event.key===" ")){event.preventDefault();onSelect(label.star.id);}}}>
              {label.leader&&<line x1={label.leader.x} y1={label.leader.y} x2={Math.max(label.box.left,Math.min(label.box.right,label.leader.x))} y2={Math.max(label.box.top,Math.min(label.box.bottom,label.leader.y))} stroke="currentColor" className="sky-label-leader" strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={.95}/>}
              <rect
                x={label.box.left}
                y={label.box.top}
                width={label.box.right-label.box.left}
                height={label.box.bottom-label.box.top}
                rx={Math.min(4*screenUnit, labelUnits * 0.5)}
                fill="transparent"
              />
              <text
                data-chart-label="star"
                paintOrder="stroke" stroke="#080a12" strokeWidth={3*screenUnit} strokeLinejoin="round"
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fill={label.isTarget ? '#ffd089' : label.isAnchor ? '#7dd3fc' : label.isPatternAnchor ? '#ddb8ff' : overview&&isDeepSky(label.star.category)?'#b3dbcd':'#d6deef'}
                fontSize={labelUnits}
                fontWeight={label.isTarget || label.isAnchor ? '700' : '500'}
                fontFamily="var(--font-sans)"
              >
                {text}
              </text>
            </g>
          );
        })}

        <BatchedStarLayer points={foregroundCatalogPoints}/>
        {plottedStars.filter(item => !isBatchedStar(item)&&(!starsOnly || item.isTarget || item.star.type === 'star' || item.star.type === 'planet')).slice().sort((a,b) => Number(a.isTarget)-Number(b.isTarget) || Number(a.star.type!=='star')-Number(b.star.type!=='star') || b.star.mag-a.star.mag).map(({ star, point, radius, isAnchor, isTarget, isPatternAnchor, isGuide }) => (
          <g
            key={star.id}
            data-star-id={star.id}
            data-solar-body={star.type==='planet'?star.name:undefined}
            data-sky-object={star.type==='messier'||star.type==='binocular'?star.id:undefined}
            role={onSelect ? 'button' : undefined}
            tabIndex={undefined}
            aria-label={onSelect ? `Select ${star.name}` : undefined}
            onClick={() => { if (!didDrag.current) onSelect?.(star.id); }}
            onKeyDown={(event) => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(star.id); } }}
            onFocus={()=>setHoveredStar(star)}
            onBlur={()=>setHoveredStar(null)}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(null)}
          >
            <title>{star.type==='star'?`${star.name} · catalog V ${star.mag.toFixed(2)}${star.temperature?` · ${Math.round(star.temperature)} K`:''} · RA ${star.ra.toFixed(3)}° · Dec ${star.dec.toFixed(3)}°`:`${star.name} · ${star.category??'Catalog object'} · ${Math.round(star.alt)}° high`}</title>
            {onSelect && <circle cx={point.x} cy={point.y} r={(star.type === "star" ? 5 : 12) * screenUnit} fill="transparent" />}
            {star.type==='planet'?<g transform={`translate(${point.x} ${point.y}) scale(${screenUnit})`}><SolarSkySymbol name={star.name} phase={star.phase}/></g>:star.type==='messier'||star.type==='binocular'?<g transform={`translate(${point.x} ${point.y}) scale(${screenUnit*Math.min(1.3,Math.max(.8,navMul))*(overview&&!isTarget?Math.min(1,(viewportPixels<430?.7:.9)+(zoom-1)*.1):1)})`}><CatalogSkySymbol category={star.category} selected={isTarget}/></g>:<>
            {!starsOnly && (isTarget || isAnchor || isPatternAnchor) && (
              <circle cx={point.x} cy={point.y} r={radius * 3.5 * navMul * screenUnit} fill="white" opacity="0.05" />
            )}
            {!starsOnly && (isAnchor || isPatternAnchor || isGuide) && <circle cx={point.x} cy={point.y} r={(radius+2)*navMul*screenUnit} fill="none" stroke={isAnchor?'#38bdf8':isPatternAnchor?'#c084fc':'#89b9d6'} strokeWidth={0.9*screenUnit} opacity={0.8}/>}
            <circle
              data-chart-star="true"
              cx={point.x}
              cy={point.y}
              r={(isTarget ? Math.max(radius + 1.5 * navMul, 4.2 * navMul) : isAnchor || isPatternAnchor ? Math.max(radius + 0.8 * navMul, 2.8 * navMul) : isGuide ? radius * navMul : Math.max(.65,stellarRadius(star.mag) * Math.min(1.8, brightMul) * catalogPointScale)) * screenUnit}
              fill={stellarColor(star.temperature,star.bv)}
              strokeWidth={(overview && !isTarget ? 0.9 : 1.2)*screenUnit}
              opacity={
                isTarget || isAnchor || isPatternAnchor || isGuide
                  ? 0.98
                  : Math.min(0.95,
                      (star.mag < 2 ? 0.95 : star.mag < 3 ? 0.85 : star.mag < 4.2 ? 0.75 : star.mag < 5.0 ? 0.65 : star.mag < 5.8 ? 0.55 : 0.45)
                      * brightMul
                    )
              }
              filter={starsOnly ? undefined : isTarget ? `url(#${chartId}-glow-strong)` : star.mag < 1.2 || isAnchor || isPatternAnchor ? `url(#${chartId}-glow-soft)` : undefined}
            />
            </>}
          </g>
        ))}

        {onSelect&&visibleLabels.map(label=><rect key={`hit-${label.star.id}`} data-label-hit-for={label.star.id} x={label.box.left} y={label.box.top} width={label.box.right-label.box.left} height={label.box.bottom-label.box.top} fill="transparent" role="button" tabIndex={0} aria-label={`Select ${chartLabel(label.star)}`} onClick={()=>{if(!didDrag.current)onSelect(label.star.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(label.star.id);}}}/>)}
        {!starsOnly&&labelSize>0&&showConstellations&&placedConstellationLabels.map(label=><rect key={`figure-hit-${label.key}`} data-constellation-hit-for={label.key.split('-')[0]} x={label.box.left} y={label.box.top} width={label.box.right-label.box.left} height={label.box.bottom-label.box.top} fill="transparent" role="button" tabIndex={0} aria-label={`Highlight ${label.name}`} onClick={()=>setHighlightedFigure(current=>current===label.key.split('-')[0]?null:label.key.split('-')[0])} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setHighlightedFigure(label.key.split('-')[0]);}}}><title>{label.name}</title></rect>)}
        {hoveredStar && (() => {
          const point = project(hoveredStar.ra, hoveredStar.dec);
          if (!point) return null;
          return (
            <g pointerEvents="none" transform={`translate(${point.x},${point.y}) scale(${screenUnit}) translate(${-point.x},${-point.y})`}>
              <rect x={point.x + 10} y={point.y - 28} width="150" height="42" rx="6" fill="#121726" stroke="#28314a" />
              <text x={point.x + 16} y={point.y - 12} fill="#edf2ff" fontSize="12" fontWeight="600" fontFamily="var(--font-sans)">
                {hoveredStar.name}
              </text>
              <text x={point.x + 16} y={point.y + 4} fill="#9aabce" fontSize="12" fontFamily="var(--font-sans)">
                mag {hoveredStar.mag.toFixed(1)} · {hoveredStar.constellation || hoveredStar.type}
              </text>
            </g>
          );
        })()}

        </g>
        {opticalField&&<g data-optical-field="true" data-field-width={fovWidth} data-field-height={fovShape==='circle'?fovWidth:fovHeight} data-center-ra={opticalField.center.ra} data-center-dec={opticalField.center.dec} pointerEvents="none"><path d={opticalField.d} fill="none" stroke="#e3d9b4" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeDasharray="7 4"/><path d={`M${opticalField.x-4*screenUnit},${opticalField.y}h${8*screenUnit}M${opticalField.x},${opticalField.y-4*screenUnit}v${8*screenUnit}`} stroke="#e3d9b4" strokeWidth={1} vectorEffect="non-scaling-stroke"/><title>{fovWidth}° {isBinocular?'binocular':'telescope'} true field · centered reference; pan the sky beneath it</title></g>}
        {overview && <g>
          <circle cx={cx} cy={cy} r={CHART_SIZE / 2 - CHART_PAD} fill="none" stroke="#76948b" vectorEffect="non-scaling-stroke" strokeWidth="1" />
          {[{ label: 'N', x: 0, y: -280 }, { label: 'E', x: -280, y: 0 }, { label: 'S', x: 0, y: 280 }, { label: 'W', x: 280, y: 0 }].map((point) => {
            const p = orientChartPoint(point, mirrored, rotation);
            return <text key={point.label} x={cx + p.x} y={cy + p.y + 4*screenUnit} textAnchor="middle" fill="#afc9b7" fontSize={12*screenUnit}>{point.label}</text>;
          })}
        </g>}

        {overview&&highlightedFigure&&<text data-active-figure-name={highlightedFigure} x={viewBoxX+12*screenUnit} y={viewBoxY+viewBoxHeight-12*screenUnit} fill="#48dcf0" paintOrder="stroke" stroke="#080a12" strokeWidth={3*screenUnit} fontSize={14*screenUnit} pointerEvents="none">{getConstellationName(highlightedFigure)} · highlighted</text>}
        {/* Legend moved to HTML overlay */}

        {(!overview||zoom>1) && <g transform={`translate(${viewBoxX + viewBoxWidth - 120 / zoom}, ${viewBoxY + viewBoxHeight - 20 / zoom})`}>
          <line x1="0" y1="0" x2={scaleBarDegrees * scale} y2="0" stroke="#8797a5" vectorEffect="non-scaling-stroke" strokeWidth={1} />
          <line x1="0" y1={-3 / zoom} x2="0" y2={3 / zoom} stroke="#8797a5" vectorEffect="non-scaling-stroke" strokeWidth={1} />
          <line x1={scaleBarDegrees * scale} y1={-3 / zoom} x2={scaleBarDegrees * scale} y2={3 / zoom} stroke="#8797a5" vectorEffect="non-scaling-stroke" strokeWidth={1} />
          <text x={scaleBarDegrees / 2 * scale} y={-12*screenUnit} fill="#8797a5" fontSize={12*screenUnit} textAnchor="middle" fontFamily="var(--font-sans)">{scaleBarDegrees}°</text>
        </g>}


      </svg>

      {overview&&<div className="planetarium-guide"><label><input type="checkbox" checked={labelSize>0} onChange={e=>updateDisplay({labelSize:e.target.checked?16:0})}/>Names</label><label><input type="checkbox" checked={showObjects} onChange={e=>setShowObjects(e.target.checked)}/>Catalog objects · {nodes.filter(n=>n.type==='messier'||n.type==='binocular').length} above horizon</label>{zoom===1&&<span>Inside circle = above horizon · edge 0° · center 90°</span>}<div className="planetarium-symbol-key">{[{category:"Open Cluster",name:"Open cluster"},{category:"Globular Cluster",name:"Globular cluster"},{category:"Galaxy",name:"Galaxy"},{category:"Emission Nebula",name:"Nebula"},{category:"Asterism",name:"Star pattern"}].map(kind=><span key={kind.name}><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><CatalogSkySymbol category={kind.category}/></svg>{kind.name}</span>)}<span><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><SolarSkySymbol name="Moon" phase={90}/></svg>Moon · current phase</span><span><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><SolarSkySymbol name="Saturn"/></svg>Planet · tap to identify</span><span className="selected-symbol-key">Gold = selected object · Cyan = highlighted figure</span></div>{showConstellations&&figureChoices.length>0&&<div className="planetarium-figure-picker" style={{flexBasis:'100%',minWidth:0,width:'100%'}}><span>Choose a name to highlight its figure</span><div role="group" aria-label="Highlight a constellation" style={{display:'flex',gap:6,overflowX:'auto',maxWidth:'100%',padding:'6px 0'}}>{figureChoices.map(c=><button key={c.id} type="button" aria-label={c.name} aria-pressed={highlightedFigure===c.id} title={`Highlight ${c.name} on the map`} onClick={()=>{setHighlightedFigure(current=>current===c.id?null:c.id);svgRef.current?.scrollIntoView({behavior:'smooth',block:'center'});}} style={{flex:'0 0 auto',whiteSpace:'nowrap',border:'1px solid #3c5b64',borderRadius:20,padding:'7px 12px',minHeight:44,background:highlightedFigure===c.id?'#193540':'transparent',color:highlightedFigure===c.id?'#48dcf0':'#add0bc'}}>{c.name} · {c.id.toUpperCase()}</button>)}</div></div>}</div>}
      {starsOnly&&<div className="stars-only-indicator" role="status">Stars only · destination marker retained</div>}
      {fieldNavigation}

      <div className="chart-toolbar">
        <div className="chart-toolbar-group" data-testid="zoom-controls">
          <button aria-label="Zoom in" title="Zoom in" data-testid="button-zoom-in" onClick={() => setZoom(z => Math.min(zoomLimit, z * 1.2))}>+</button>
          <button aria-label="Zoom out" title="Zoom out" data-testid="button-zoom-out" onClick={() => { const z = Math.max(MIN_ZOOM, zoom / 1.2); setZoom(z); setPanX(px => clampPan(px, 0, z).x); setPanY(py => clampPan(0, py, z).y); }}>−</button>
          <button onClick={handleResetView} data-testid="button-zoom-reset">{overview?'Whole sky':`Reset ${zoom!==1?`${zoom.toFixed(1)}×`:''}`}</button>
          <button disabled={!overview&&!fovCenter} onClick={fitOpticalField} data-testid="button-fit-field">Fit field</button>
          {route && <button onClick={() => {const points=route.hops.map(hop=>project(hop.center.ra,hop.center.dec)).filter((point):point is {x:number;y:number}=>!!point);if(!points.length)return;const xs=points.map(point=>point.x),ys=points.map(point=>point.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),padding=Math.max(fovWidth,fovHeight)*scale;const z=Math.max(MIN_ZOOM,Math.min(zoomLimit,(chartWidth-80)/(right-left+padding),(CHART_SIZE-80)/(bottom-top+padding)));setZoom(z);const pan=clampPan(cx-(left+right)/2,cy-(top+bottom)/2,z);setPanX(pan.x);setPanY(pan.y);}} data-testid="button-route-overview">Route overview</button>}
        </div>
        <div className="chart-toolbar-group">
          {!overview&&<><button className={mirrored ? 'active' : ''} aria-pressed={mirrored} onClick={() => updateDisplay({ mirrored: !mirrored })} data-testid="button-mirror-chart">Mirror</button>
          <button onClick={() => updateDisplay({ rotation: ((rotation + 90) % 360) as 0 | 90 | 180 | 270 })} data-testid="button-rotate-chart">Rotate · {rotation}°</button></>}
          <button type="button" title={isFullscreen?"Exit full screen":"View chart full screen"} aria-label={isFullscreen?"Exit chart full screen":"View chart full screen"} onClick={()=>{if(isFullscreen)void document.exitFullscreen();else void containerRef.current?.requestFullscreen();}}>{isFullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{isFullscreen?"Exit full screen":"Full screen"}</span></button>
        </div>
      </div>
      {overview&&<div className="chart-optical-reference" aria-label="Optical field reference">
        <label><input type="checkbox" checked={showOpticalField} onChange={event=>setShowOpticalField(event.target.checked)}/>Optics field · {isBinocular?'binoculars':'telescope'}</label>
        <label>True field <input aria-label="Planetarium true field width" type="number" min="0.2" max="15" step="0.1" value={fovWidth} onChange={event=>{const value=Number(event.target.value);if(value>=.2&&value<=15)onFovChange?.(value);}} disabled={!onFovChange}/>°</label>
        <label><input type="checkbox" checked={showAngularExtents} onChange={event=>setShowAngularExtents(event.target.checked)}/>Angular size outlines</label>
        <p>Pan the sky beneath the centered field. “Fit field” centers your selected object and enlarges the reference. Small symbols locate objects; outlines use catalog angular sizes, with no minimum display size. Dotted circles are diameter envelopes where orientation is unknown. Published boundaries depend on how faint an outer region was measured. Angular outlines: included catalog / <a href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noreferrer">OpenNGC (CC BY-SA 4.0)</a>.</p>
        {targetNode&&isDeepSky(targetNode.category)&&(()=>{const extent=catalogExtent(targetNode);return <span className="chart-extent-readout">{targetNode.name} · {extent?`${(extent.major*60).toFixed(1)}′${extent.minorKnown?` × ${(extent.minor*60).toFixed(1)}′`:''} across · ${Math.round(extent.major/fovWidth*100)}% of field width${extent.positionAngle===null?' · orientation not catalogued':''}`:'angular size unavailable in the catalog'}</span>;})()}
      </div>}
      {(setupSummary||onEditSetup)&&<div className="chart-setup-summary"><span>{setupSummary??`Field ${fovWidth.toFixed(1)}° · stars to mag ${Math.min(maxCatalogMagnitude,limitingMag).toFixed(1)}`}</span>{onEditSetup&&<button type="button" onClick={onEditSetup}>Edit observing setup</button>}</div>}
      <details className="chart-optics-details" open={overview?undefined:viewport.width>=600}><summary>{overview?'Display and labels':'Field and display'}</summary>
      <div className="chart-field-controls">
        {!overview && <label>Reticle <select aria-label="Finder reticle" value={activeFinderReticle} onChange={event => updateDisplay({ finderReticle: event.target.value as FinderReticle })}>
          <option value="field">Field only</option>{!isBinocular&&<><option value="telrad">Telrad · ½° / 2° / 4°</option><option value="rigel">Rigel · ½° / 2°</option></>}<option value="crosshair">Optical finder · crosshair</option>
        </select></label>}
        <button className={starsOnly ? 'active' : ''} aria-pressed={starsOnly} onClick={() => updateDisplay({ starsOnly: !starsOnly })} data-testid="button-stars-only">Stars only</button>
      </div>
      {!overview && activeFinderReticle !== 'field' && !starsOnly && <p className="chart-reticle-note">{activeFinderReticle === 'crosshair' ? 'Crosshair follows your field · Set your finder’s measured width.' : 'Ring diameters in degrees · Field width sets hop spacing.'}</p>}
      <div className="chart-readability-controls" aria-label="Chart readability">
          <label>Label size<output>{labelSize === 0 ? "Off" : `${labelSize}px`}</output><input aria-label="Chart label size" type="range" min={0} max={30} value={labelSize} onChange={e => updateDisplay({ labelSize: Number(e.target.value) })} /></label>
          <label>Star brightness<output>{starBrightness}</output><input aria-label="Chart star brightness" type="range" min={1} max={10} value={starBrightness} onChange={e => updateDisplay({ starBrightness: Number(e.target.value) })} /></label>
          <label>Guide star size<output>{navStarSize}</output><input aria-label="Chart guide star size" type="range" min={1} max={10} value={navStarSize} onChange={e => updateDisplay({ navStarSize: Number(e.target.value) })} /></label>
      </div>
      <details className="chart-display-settings">
        <summary>Chart layers & display</summary>
        <div className="display-options">
          <label><input type="checkbox" checked={showConstellations} onChange={e => updateDisplay({ showConstellations: e.target.checked })} />Constellation lines</label>
          <label><input type="checkbox" checked={showGhostCircles} disabled={!route} onChange={e => updateDisplay({ showGhostCircles: e.target.checked })} />Upcoming fields</label>
          <label><input type="checkbox" checked={showLegend} onChange={e => updateDisplay({ showLegend: e.target.checked })} />Legend</label>
        </div>
      </details>
      </details>
      {!overview&&!isBinocular&&<details className="optical-profile-disclosure"><summary>Finder orientation profiles</summary><p>Navigation field width is edited in observing setup.</p><OpticalProfiles onApply={profile=>{updateDisplay({mirrored:profile.mirrored,rotation:profile.rotation,finderReticle:profile.reticle});}}/></details>}
      <p className={`chart-accuracy-note ${overview?'overview-accuracy-note':''}`}><span className="chart-pointer-instructions">Ctrl / ⌘ + scroll to zoom · drag to pan · click a labeled symbol to inspect. </span><span className="chart-touch-instructions">Pinch to zoom · drag to pan · tap a labeled symbol to inspect. </span>{starsOnly ? 'Catalog stars without labels or guide patterns. Nebulosity is not simulated.' : 'Dot size follows catalog magnitude; hue follows temperature or B−V color where known (neutral otherwise). Sizes are not stellar diameters. Constellation names are green.'} {maxCatalogMagnitude>8?deepCatalog.state==='ready'?'Tycho-2 reference stars to VT 10.5 within 8° of the target; brighter context outside. This chart can show stars fainter than your optics reveal.':deepCatalog.state==='loading'?'Loading the detailed offline finder field…':deepCatalog.state==='error'?'Detailed field unavailable; showing the bright-star catalog to magnitude 8.':'Bright-star catalog to magnitude 8. Increase depth for the detailed finder field.':'Star catalog extends to magnitude 8; the view depends on your optics and sky.'}</p>
      {showLegend && !starsOnly && !overview && <div className="absolute top-3 left-3 flex gap-3 rounded border border-[#2a414e] bg-[#0a1721]/90 px-2 py-1.5 text-[9px]">
        {route && <><span className="text-[#38bdf8]">● Anchor</span><span className="text-[#c084fc]">● Pattern</span></>}<span className="text-[#d8bc80]">● Selected</span><span className="text-[#a7cfa0]">Constellation</span>
      </div>}
      {!overview&&<svg className="absolute top-3 right-3 pointer-events-none" width="60" height="60" viewBox="0 0 60 60" aria-label={`Chart orientation, ${mirrored ? 'mirrored, ' : ''}rotated ${rotation} degrees`}>
        {([{ label: 'N', point: { x: 0, y: -16 } }, { label: 'E', point: { x: -16, y: 0 } }]).map(({ label, point }) => {
          const p = orientChartPoint(point, mirrored, rotation);
          return <g key={label}><line x1="30" y1="30" x2={30 + p.x} y2={30 + p.y} stroke="#91aab6" vectorEffect="non-scaling-stroke" strokeWidth="1" /><text x={30 + p.x * 1.5} y={33 + p.y * 1.5} textAnchor="middle" fill="#b0c6cc" fontSize="12">{label}</text></g>;
        })}
      </svg>}
    </div>
  );
}
