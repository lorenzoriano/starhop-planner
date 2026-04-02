import { useState, useCallback, useMemo, useRef, useEffect, useSyncExternalStore } from 'react';
import tzLookup from 'tz-lookup';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  Star, Telescope, Play, Pause, SkipForward, SkipBack, Download, Search,
  MapPin, Clock, Eye, ChevronRight, Crosshair, Loader2, AlertTriangle,
  Info, Sparkles, Image as ImageIcon, WifiOff, Wifi
} from 'lucide-react';
import {
  planRoutes, findBestObservingTime, loadMessier, loadConstellations, loadBinocularTargets, loadDenseStars, loadMilkyWay,
  buildUnifiedTargets,
  PRESETS, BINOCULAR_CATEGORY_LABELS,
  type Route, type SkyNode, type ObservingParams, type MessierObject, type ConstellationLine, type ObservingMode,
  type BinocularTarget, type UnifiedTarget, type BinocularCategory, type DenseStar, type MilkyWayFeature, type DifficultyLevel,
} from '@/lib/astronomy';
import type { CostStrategyId } from '@/lib/cost-strategies';
import { SkyChart } from '@/components/SkyChart';
import { ImageFallback } from '@/components/ImageFallback';
import { PerplexityAttribution } from '@/components/PerplexityAttribution';

export default function PlannerPage() {
  const { toast } = useToast();
  // Observing params
  const [lat, setLat] = useState(37.77);
  const [lon, setLon] = useState(-122.42);
  const [dateStr, setDateStr] = useState(formatDate(new Date()));
  const [timeStr, setTimeStr] = useState('21:00');
  const [fovWidth, setFovWidth] = useState(5);
  const [fovHeight, setFovHeight] = useState(3.5);
  const [fovShape, setFovShape] = useState<'circle' | 'rectangle'>('circle');
  const [limitingMag, setLimitingMag] = useState(6.0);
  const [numRoutes, setNumRoutes] = useState(3);
  const [observingMode, setObservingMode] = useState<ObservingMode>('telescope');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('intermediate');
  const [algorithm, setAlgorithm] = useState<CostStrategyId>('auto');
  const [targetId, setTargetId] = useState('M31');
  const [targetSearch, setTargetSearch] = useState('');

  // Results
  const [routes, setRoutes] = useState<Route[]>([]);
  const [nodes, setNodes] = useState<SkyNode[]>([]);
  const [targetNode, setTargetNode] = useState<SkyNode | null>(null);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [isComputing, setIsComputing] = useState(false);
  const [belowHorizon, setBelowHorizon] = useState(false);
  const [isFindingBestTime, setIsFindingBestTime] = useState(false);
  const [hasComputed, setHasComputed] = useState(false);

  // Animation
  const [animStep, setAnimStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [animSpeed, setAnimSpeed] = useState(2000);

  // Catalogs
  const [messierList, setMessierList] = useState<MessierObject[]>([]);
  const [binocularTargets, setBinocularTargets] = useState<BinocularTarget[]>([]);
  const [constellations, setConstellations] = useState<ConstellationLine[]>([]);
  const [unifiedTargets, setUnifiedTargets] = useState<UnifiedTarget[]>([]);
  const [denseStars, setDenseStars] = useState<DenseStar[]>([]);
  const [milkyWay, setMilkyWay] = useState<MilkyWayFeature[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Tab
  const [activeTab, setActiveTab] = useState('planner');

  useEffect(() => {
    Promise.all([loadMessier(), loadBinocularTargets(), loadConstellations(), loadDenseStars(), loadMilkyWay()]).then(
      ([m, b, c, d, mw]) => {
        setMessierList(m);
        setBinocularTargets(b);
        setConstellations(c);
        setDenseStars(d);
        setMilkyWay(mw);
        setUnifiedTargets(buildUnifiedTargets(m, b));
      }
    );
  }, []);

  // All unique categories derived from the unified target list
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of unifiedTargets) cats.add(t.categoryShort);
    return Array.from(cats).sort();
  }, [unifiedTargets]);

  const filteredTargets = useMemo(() => {
    let list = unifiedTargets;

    // Apply category filter
    if (categoryFilter !== 'all') {
      list = list.filter(t => t.categoryShort === categoryFilter);
    }

    // Apply text search
    if (targetSearch) {
      const q = targetSearch.toLowerCase();
      list = list.filter(t =>
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.displayName.toLowerCase().includes(q) ||
        t.con.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.desc && t.desc.toLowerCase().includes(q))
      );
    }

    return list.slice(0, 30);
  }, [targetSearch, categoryFilter, unifiedTargets]);

  const observingTimeZone = useMemo(() => {
    try {
      return tzLookup(lat, lon);
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }, [lat, lon]);

  const observingDate = useMemo(() => {
    const localIso = `${dateStr}T${timeStr}:00`;
    return fromZonedTime(localIso, observingTimeZone);
  }, [dateStr, timeStr, observingTimeZone]);

  const handleFindBestTime = useCallback(async () => {
    setIsFindingBestTime(true);
    // Yield to the event loop so React paints the spinner before the
    // synchronous scan (~88–440 ms) blocks the JS thread.
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const [messier, binoTargets] = await Promise.all([
        loadMessier(),
        loadBinocularTargets(),
      ]);
      const mTarget = messier.find(m => m.id === targetId);
      const bTarget = binoTargets.find(t => t.id === targetId);
      const target = mTarget ?? bTarget;

      if (!target) {
        toast({ title: 'Target not found', description: `Could not find catalog data for ${targetId}.`, variant: 'destructive' });
        return;
      }

      const result = findBestObservingTime(
        target.ra,
        target.dec,
        lat,
        lon,
        observingDate,
      );

      if (!result) {
        toast({
          title: 'No visible window',
          description: `${targetId} doesn't reach 30° above the horizon at this location within the next year.`,
          variant: 'destructive',
        });
        return;
      }

      setDateStr(formatInTimeZone(result.date, observingTimeZone, 'yyyy-MM-dd'));
      setTimeStr(formatInTimeZone(result.date, observingTimeZone, 'HH:mm'));
      toast({
        title: 'Time updated',
        description: `Switched to ${formatInTimeZone(result.date, observingTimeZone, 'MMM d')} — ${targetId} will be at ${Math.round(result.alt)}°. Click 'Plan Star-Hop Routes' to compute.`,
      });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Could not search for an observing window.', variant: 'destructive' });
    } finally {
      setIsFindingBestTime(false);
    }
  }, [targetId, lat, lon, observingDate, observingTimeZone, toast]);

  const handleCompute = useCallback(async () => {
    setIsComputing(true);
    setHasComputed(false);
    setBelowHorizon(false);
    try {
      const params: ObservingParams = {
        lat, lon, date: observingDate,
        fovWidth, fovHeight, fovShape,
        limitingMag, numRoutes, targetId,
        observingMode,
        difficulty,
        algorithm,
      };
      const result = await planRoutes(params);
      setRoutes(result.routes);
      setNodes(result.nodes);
      setTargetNode(result.targetNode);
      setBelowHorizon(result.belowHorizon);
      setSelectedRouteIdx(0);
      setAnimStep(0);
      setIsPlaying(false);
      setHasComputed(true);

      if (result.belowHorizon) {
        toast({ title: 'Target below horizon', description: `${targetId} is below the horizon at this time and location.`, variant: 'destructive' });
      } else if (result.routes.length === 0) {
        toast({ title: 'No routes found', description: 'Try adjusting parameters or choosing a different target.', variant: 'destructive' });
      } else {
        toast({ title: `Found ${result.routes.length} route${result.routes.length > 1 ? 's' : ''}`, description: `Best route has ${result.routes[0].hops.length} hops with score ${result.routes[0].score}/100.` });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to compute routes. Check parameters.', variant: 'destructive' });
    }
    setIsComputing(false);
  }, [lat, lon, observingDate, fovWidth, fovHeight, fovShape, limitingMag, numRoutes, targetId, observingMode, difficulty, algorithm, toast]);

  const selectedRoute = routes[selectedRouteIdx] || null;

  // Animation controls
  useEffect(() => {
    if (isPlaying && selectedRoute) {
      animRef.current = setInterval(() => {
        setAnimStep(prev => {
          if (prev >= selectedRoute.hops.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, animSpeed);
    }
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, [isPlaying, selectedRoute, animSpeed]);

  const handlePlay = () => {
    if (!selectedRoute) return;
    if (animStep >= selectedRoute.hops.length - 1) setAnimStep(0);
    setIsPlaying(true);
  };

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setTargetId(preset.targetId);
    setLat(preset.lat);
    setLon(preset.lon);
  };

  const applyObservingMode = (mode: ObservingMode) => {
    setObservingMode(mode);
    if (mode === 'binocular') {
      setFovShape('circle');
      setFovWidth((prev) => (prev < 5 ? 7 : prev));
      setLimitingMag((prev) => Math.min(prev, 7.0));
      setNumRoutes((prev) => Math.min(prev, 4));
    }
  };

  const handleDownloadJSON = () => {
    if (!selectedRoute) return;
    const data = {
      route: selectedRoute,
      observingParams: { lat, lon, date: observingDate.toISOString(), fovWidth, fovHeight, fovShape, limitingMag, observingMode },
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starhop-${targetId}-${selectedRoute.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 px-4 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StarHopLogo />
            <div>
              <h1 className="text-lg font-semibold tracking-tight" data-testid="text-app-title">StarHop Planner</h1>
              <p className="text-xs text-muted-foreground">Interactive star-hopping route finder</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <OfflineIndicator />
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-muted/50">
                <TabsTrigger value="planner" className="text-xs" data-testid="tab-planner">
                  <Telescope className="w-3.5 h-3.5 mr-1.5" />Planner
                </TabsTrigger>
                <TabsTrigger value="image" className="text-xs" data-testid="tab-image">
                  <ImageIcon className="w-3.5 h-3.5 mr-1.5" />Image Mode
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </header>

      {activeTab === 'image' ? (
        <ImageFallback />
      ) : (
      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Left Panel — Controls */}
        <div className="space-y-4">
          {/* Quick Presets */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-medium">Quick Presets</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.targetId}
                  onClick={() => handlePreset(p)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    targetId === p.targetId
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'border-border hover:border-primary/30 hover:text-primary/80'
                  }`}
                  data-testid={`preset-${p.targetId}`}
                >
                  {p.targetId}
                </button>
              ))}
            </div>
          </Card>

          {/* Target Selection */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <Crosshair className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-medium">Target</h2>
              <span className="text-[10px] text-muted-foreground ml-auto">{unifiedTargets.length} objects</span>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name, type, constellation…"
                  value={targetSearch}
                  onChange={e => setTargetSearch(e.target.value)}
                  className="pl-8 h-9 text-sm bg-background"
                  data-testid="input-target-search"
                />
              </div>
              {/* Category filter pills */}
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    categoryFilter === 'all'
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'border-border hover:border-primary/30 text-muted-foreground'
                  }`}
                  data-testid="filter-all"
                >
                  All
                </button>
                {availableCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      categoryFilter === cat
                        ? 'bg-primary/20 border-primary/50 text-primary'
                        : 'border-border hover:border-primary/30 text-muted-foreground'
                    }`}
                    data-testid={`filter-${cat}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5 rounded border border-border/50 bg-background/50 p-1">
                {filteredTargets.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTargetId(t.id); setTargetSearch(''); }}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                      targetId === t.id ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50'
                    }`}
                    data-testid={`target-${t.id}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium truncate">{t.displayName}</span>
                      <span className="flex-shrink-0 flex items-center gap-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border/60">{t.categoryShort}</Badge>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{t.mag.toFixed(1)}</span>
                      </span>
                    </div>
                    {t.binoTip && targetId !== t.id && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{t.binoTip}</p>
                    )}
                  </button>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">No targets match your search</p>
                )}
              </div>
              {/* Selected target info — contained with overflow protection */}
              {(() => {
                const sel = unifiedTargets.find(t => t.id === targetId);
                if (!sel) return (
                  <div className="rounded border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Selected: <span className="text-foreground font-medium">{targetId}</span>
                  </div>
                );
                return (
                  <div className="rounded border border-border/40 bg-muted/30 px-3 py-2 text-xs space-y-0.5 max-h-24 overflow-y-auto">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-foreground font-medium truncate max-w-[200px]">{sel.displayName}</span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{sel.categoryShort}</Badge>
                    </div>
                    {sel.desc && <p className="text-muted-foreground line-clamp-2">{sel.desc}</p>}
                    {sel.binoTip && <p className="text-primary/80 italic line-clamp-2">{sel.binoTip}</p>}
                  </div>
                );
              })()}
            </div>
          </Card>

          {/* Location & Time */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium">Location & Time</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input type="number" step="0.01" value={lat} onChange={e => setLat(parseFloat(e.target.value) || 0)} className="h-8 text-sm bg-background" data-testid="input-lat" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input type="number" step="0.01" value={lon} onChange={e => setLon(parseFloat(e.target.value) || 0)} className="h-8 text-sm bg-background" data-testid="input-lon" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="h-8 text-sm bg-background [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer" data-testid="input-date" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Local Time</Label>
                <Input type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)} className="h-8 text-sm bg-background [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer" data-testid="input-time" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Time is interpreted in the observing location timezone: {observingTimeZone}
            </p>
          </Card>

          {/* Observing Mode */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium">Observing Mode</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={observingMode === 'telescope' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyObservingMode('telescope')}
                data-testid="button-mode-telescope"
              >
                Telescope
              </Button>
              <Button
                variant={observingMode === 'binocular' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyObservingMode('binocular')}
                data-testid="button-mode-binocular"
              >
                Binoculars
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {observingMode === 'binocular'
                ? 'Favor wider, brighter, pattern-led hops that fit common hand-held binocular fields.'
                : 'Use more flexible star-hop spacing for finder scopes and telescopic views.'}
            </p>
          </Card>

          {/* Difficulty Level */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium">Difficulty</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={difficulty === 'beginner' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDifficulty('beginner')}
              >
                Beginner
              </Button>
              <Button
                variant={difficulty === 'intermediate' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDifficulty('intermediate')}
              >
                Normal
              </Button>
              <Button
                variant={difficulty === 'expert' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDifficulty('expert')}
              >
                Expert
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {difficulty === 'beginner'
                ? 'More waypoints with bright landmarks. Easier to follow but more steps.'
                : difficulty === 'expert'
                ? 'Minimal stops with longer sweeps. Fastest but requires experience.'
                : 'Balanced route with moderate stops at key landmarks.'}
            </p>
            {/* Algorithm selector (Advanced) */}
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Advanced: Routing Algorithm
              </summary>
              <div className="mt-2">
                <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as CostStrategyId)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (recommended)</SelectItem>
                    <SelectItem value="landmark-discount">Landmark Discount</SelectItem>
                    <SelectItem value="confidence-decay">Confidence Decay</SelectItem>
                    <SelectItem value="focal-search">Focal Search</SelectItem>
                    <SelectItem value="landmark-magnet">Landmark Magnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </details>
          </Card>

          {/* FOV Settings */}
          <Card className="p-4 bg-card border-card-border">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium">Field of View</h2>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">FOV Shape</Label>
                <Select value={fovShape} onValueChange={(v: 'circle' | 'rectangle') => setFovShape(v)} disabled={observingMode === 'binocular'}>
                  <SelectTrigger className="h-8 text-sm bg-background" data-testid="select-fov-shape">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="circle">Circle (eyepiece)</SelectItem>
                    <SelectItem value="rectangle">Rectangle (camera)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Width: {fovWidth}°</Label>
                <Slider value={[fovWidth]} onValueChange={([v]) => setFovWidth(v)} min={1} max={15} step={0.1} className="mt-1" data-testid="slider-fov-width" />
              </div>
              {fovShape === 'rectangle' && (
                <div>
                  <Label className="text-xs text-muted-foreground">Height: {fovHeight}°</Label>
                  <Slider value={[fovHeight]} onValueChange={([v]) => setFovHeight(v)} min={1} max={15} step={0.1} className="mt-1" data-testid="slider-fov-height" />
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Limiting Mag: {limitingMag}</Label>
                <Slider value={[limitingMag]} onValueChange={([v]) => setLimitingMag(v)} min={3} max={10} step={0.5} className="mt-1" data-testid="slider-limiting-mag" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Routes: {numRoutes}</Label>
                <Slider value={[numRoutes]} onValueChange={([v]) => setNumRoutes(v)} min={1} max={5} step={1} className="mt-1" data-testid="slider-num-routes" />
              </div>
            </div>
          </Card>

          {/* Compute Button */}
          <Button
            onClick={handleCompute}
            disabled={isComputing}
            className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
            data-testid="button-compute"
          >
            {isComputing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Computing Routes...</>
            ) : (
              <><Telescope className="w-4 h-4 mr-2" />Plan Star-Hop Routes</>
            )}
          </Button>
        </div>

        {/* Right Panel — Sky Chart & Results */}
        <div className="space-y-4">
          {/* Sky Chart */}
          <Card className="bg-card border-card-border overflow-hidden">
            <SkyChart
              nodes={nodes}
              constellations={constellations}
              route={selectedRoute}
              targetNode={targetNode}
              animStep={animStep}
              fovWidth={fovWidth}
              fovHeight={fovShape === 'circle' ? fovWidth : fovHeight}
              fovShape={fovShape}
              lat={lat}
              lon={lon}
              date={observingDate}
              limitingMag={limitingMag}
              denseStars={denseStars}
              milkyWay={milkyWay}
            />
          </Card>

          {/* Below Horizon Warning */}
          {belowHorizon && (
            <Card className="p-4 bg-destructive/10 border-destructive/30">
              <div className="flex items-center justify-between gap-2 text-destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">{targetId} is below the horizon at this time and location.</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFindBestTime}
                  disabled={isFindingBestTime || isComputing}
                  className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  {isFindingBestTime ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Searching…</>
                  ) : (
                    'Plan for best time'
                  )}
                </Button>
              </div>
            </Card>
          )}

          {/* Route Results */}
          {hasComputed && routes.length > 0 && (
            <>
              {/* Route Selector */}
              <div className="flex items-center gap-2 flex-wrap">
                {routes.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedRouteIdx(i); setAnimStep(0); setIsPlaying(false); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                      selectedRouteIdx === i
                        ? 'bg-primary/15 border-primary/50 text-primary glow-primary'
                        : 'border-border hover:border-primary/30'
                    }`}
                    data-testid={`route-select-${i}`}
                  >
                    <span className="font-medium">Route {i + 1}</span>
                    {r.isExpertRoute && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/50 text-amber-400">
                        Expert
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {r.hops.length} hops
                    </Badge>
                    <Badge variant={r.score >= 70 ? 'default' : r.score >= 40 ? 'secondary' : 'destructive'} className="text-xs">
                      {r.score}/100
                    </Badge>
                    <Badge variant="outline" className="text-xs capitalize">
                      {observingMode}
                    </Badge>
                  </button>
                ))}
              </div>

              {/* Playback Controls */}
              {selectedRoute && (
                <Card className="p-3 bg-card border-card-border">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setAnimStep(Math.max(0, animStep - 1)); setIsPlaying(false); }} data-testid="button-prev-step">
                        <SkipBack className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant={isPlaying ? 'default' : 'ghost'} onClick={isPlaying ? () => setIsPlaying(false) : handlePlay} data-testid="button-play-pause">
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAnimStep(Math.min((selectedRoute?.hops.length || 1) - 1, animStep + 1)); setIsPlaying(false); }} data-testid="button-next-step">
                        <SkipForward className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Step {animStep + 1}/{selectedRoute.hops.length}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${((animStep + 1) / selectedRoute.hops.length) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Speed</Label>
                      <Select value={String(animSpeed)} onValueChange={v => setAnimSpeed(parseInt(v))}>
                        <SelectTrigger className="h-7 w-20 text-xs" data-testid="select-speed">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1000">Fast</SelectItem>
                          <SelectItem value="2000">Normal</SelectItem>
                          <SelectItem value="3500">Slow</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" onClick={handleDownloadJSON} data-testid="button-download-json">
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              {/* Hop Instructions */}
              {selectedRoute && (
                <Card className="p-4 bg-card border-card-border">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4 text-primary" />
                    Route Instructions
                    <span className="text-xs text-muted-foreground ml-auto">
                      From {selectedRoute.startAnchor.name} → {selectedRoute.target.name}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {selectedRoute.hops.map((hop, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                          animStep === i
                            ? 'bg-primary/10 border-primary/40'
                            : 'border-transparent hover:bg-muted/30'
                        }`}
                        onClick={() => { setAnimStep(i); setIsPlaying(false); }}
                        data-testid={`hop-step-${i}`}
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          animStep === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{hop.instruction}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {hop.distanceDeg > 0 && (
                              <Badge variant="outline" className="text-xs">{hop.distanceDeg.toFixed(1)}°</Badge>
                            )}
                            {hop.distanceDeg > 0 && (() => {
                              const ratio = hop.distanceDeg / fovWidth;
                              const overlap = Math.max(0, Math.round((1 - ratio) * 100));
                              return (
                                <Badge
                                  variant={ratio <= 0.85 ? 'default' : 'destructive'}
                                  className="text-xs"
                                >
                                  {ratio <= 1 ? `${overlap}% overlap` : 'no overlap'}
                                </Badge>
                              );
                            })()}
                            {hop.direction && (
                              <Badge variant="outline" className="text-xs">{hop.direction}</Badge>
                            )}
                            <Badge variant="outline" className="text-xs capitalize">
                              {hop.patternType} · {hop.patternScore >= 90 ? 'Excellent' : hop.patternScore >= 75 ? 'Strong' : hop.patternScore >= 55 ? 'Good' : hop.patternScore >= 35 ? 'Fair' : 'Weak'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{hop.pattern}</span>
                          </div>
                        </div>
                        <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${
                          animStep === i ? 'text-primary rotate-90' : 'text-muted-foreground'
                        }`} />
                      </div>
                    ))}
                  </div>
                  {selectedRoute.isExpertRoute && selectedRoute.expertSource && (
                    <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/30">
                      Source: {selectedRoute.expertSource}
                    </p>
                  )}
                </Card>
              )}
            </>
          )}

          {/* Empty state */}
          {!hasComputed && (
            <Card className="p-12 bg-card border-card-border text-center">
              <Telescope className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Ready to plan</h3>
              <p className="text-xs text-muted-foreground/70">
                Select a target, set your location and time, then click "Plan Star-Hop Routes".
              </p>
            </Card>
          )}
        </div>
      </div>
      )}

      {/* Footer */}
      <footer className="border-t border-border/30 px-4 py-4 mt-8">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>StarHop Planner — Uses astronomy-engine, BSC5, Messier, Caldwell, and binocular target catalogs.</span>
          <PerplexityAttribution />
        </div>
      </footer>
    </div>
  );
}

function StarHopLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="StarHop Planner logo" className="flex-shrink-0">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle cx="16" cy="16" r="8" stroke="hsl(200 85% 50%)" strokeWidth="1" strokeDasharray="2 3" />
      <circle cx="10" cy="10" r="2" fill="hsl(200 85% 50%)" />
      <circle cx="20" cy="8" r="1.5" fill="hsl(200 85% 60%)" />
      <circle cx="22" cy="16" r="1.8" fill="hsl(200 85% 55%)" />
      <circle cx="18" cy="22" r="2.2" fill="hsl(38 90% 55%)" />
      <line x1="10" y1="10" x2="20" y2="8" stroke="hsl(200 85% 50%)" strokeWidth="1" opacity="0.6" />
      <line x1="20" y1="8" x2="22" y2="16" stroke="hsl(200 85% 50%)" strokeWidth="1" opacity="0.6" />
      <line x1="22" y1="16" x2="18" y2="22" stroke="hsl(200 85% 50%)" strokeWidth="1" opacity="0.6" />
    </svg>
  );
}

function useOnlineStatus() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true
  );
}

function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-medium" data-testid="offline-indicator">
      <WifiOff className="w-3 h-3" />
      <span>Offline</span>
    </div>
  );
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
