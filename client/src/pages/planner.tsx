import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import tzLookup from "tz-lookup";
import { useLocation } from "wouter";
import { pageForPath, pathForPage, targetFromPath, type Page } from "@/lib/navigation";
import { catalogSearchScore } from "@/lib/catalog-search";
import { readHopProgress, writeHopProgress, routeFingerprint, matchingRouteIndex } from "@/lib/hop-progress";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocalState } from "@/hooks/use-local-state";
import { useOffline } from "@/lib/offline";
import {
  defaultSettings,
  resolveLocalMoment,
  resolvePlannedMoment,
  settingsSchema,
  nightListSchema,
  type Settings,
  type NightItem,
} from "@/lib/session";
import {
  rankTargets,
  skyConditions,
  guideFor,
  compassLabel,
  altitudeLabel,
  type VisibleTarget,
} from "@/lib/observing";
import {
  Star,
  Telescope,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Download,
  Search,
  MapPin,
  Clock,
  Eye,
  ChevronRight,
  Crosshair,
  Loader2,
  AlertTriangle,
  Sparkles,
  WifiOff,
  Check,
  Plus,
  Moon,
  ArrowUpRight,
  Compass,
  BookOpen,
  CalendarDays,
  Settings2,
  Navigation,
  X,
  Binoculars,
  Image as ImageIcon,
  CheckCircle2,
  Circle,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";
import {
  planRoutes,
  findBestObservingTime,
  loadStars,
  loadMessier,
  loadConstellations,
  loadBinocularTargets,
  loadDenseStars,
  loadMilkyWay,
  buildUnifiedTargets,
  eqToHorizontal,
  angularDistance,
  getConstellationName,
  type ObservingParams,
  type Route,
  type SkyNode,
  type Star as CatalogStar,
  type UnifiedTarget,
  type ConstellationLine,
  type DenseStar,
  type MilkyWayFeature,
} from "@/lib/astronomy";
import type { CostStrategyId } from "@/lib/cost-strategies";
import { SkyChart } from "@/components/SkyChart";
import { HopFieldNavigation, HopViewDirection } from "@/components/HopFieldNavigation";
import { EyepieceCalculator } from "@/components/EyepieceCalculator";
import { NavigationStarResults, type NavigationStarHit } from "@/components/NavigationStarResults";
import { SkySafariExport } from "@/components/SkySafariExport";
import { AltitudeChart } from "@/components/ObservingVisuals";
import { ImageFallback } from "@/components/ImageFallback";
import { BinocularGuide } from "@/components/BinocularGuide";
import { MoonObservatory, MoonlightCard, LunarNightItem } from "@/components/MoonObservatory";
import { SavedLocations } from "@/components/SavedLocations";
import { savedLocationsSchema, matchingLocation, type SavedLocation } from "@/lib/saved-locations";
import { SessionPlanner } from "@/components/SessionPlanner";
import { TargetPhoto, TargetPhotoCredit } from "@/components/TargetPhoto";
import { emptyPlanner, plannerStoreSchema, makeSession, planningShortcut, sessionTimezone, starPlanningTarget, type PlannerStore, type ObservingSession } from "@/lib/session-planner";
import { lunarFeatures } from "@/lib/moon";

type Catalogs = {
  stars: CatalogStar[];
  targets: UnifiedTarget[];
  constellations: ConstellationLine[];
  dense: DenseStar[];
  milkyWay: MilkyWayFeature[];
};
const EMPTY_CATALOGS: Catalogs = {
  stars: [],
  targets: [],
  constellations: [],
  dense: [],
  milkyWay: [],
};

export default function PlannerPage() {
  const firstTarget=useRef((()=>{try{return !localStorage.getItem("starhop-settings-v2");}catch{return false;}})());
  const { toast } = useToast();
  const [settings, setSettings, settingsError] = useLocalState<Settings>(
    "starhop-settings-v2",
    defaultSettings,
    settingsSchema,
  );
  const [legacyNight, setLegacyNight, nightError] = useLocalState<NightItem[]>(
    "starhop-night-v2",
    [],
    nightListSchema,
  );
  const [plannerStore,setPlannerStore,plannerError] = useLocalState<PlannerStore>("starhop-session-planner-v1",emptyPlanner,plannerStoreSchema);
  const [savedLocations,setSavedLocations,locationsError] = useLocalState<SavedLocation[]>("starhop-saved-locations-v1",[],savedLocationsSchema);
  const activeSession = plannerStore.sessions.find(s=>s.id===plannerStore.activeId&&!s.archived);
  const night=activeSession?.items??legacyNight;
  function setNight(next:NightItem[]|((previous:NightItem[])=>NightItem[])) {
    if(activeSession) setPlannerStore(current=>({...current,sessions:current.sessions.map(s=>s.id===activeSession.id?{...s,items:typeof next==="function"?next(s.items):next}:s)}));
    else setLegacyNight(next);
  }
  const [inspectedStar,setInspectedStar] = useState<CatalogStar|null>(null);
  const update = (patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));
  const [location,navigate]=useLocation();
  const page=pageForPath(location)??"tonight";
  function setPage(next:Page,target?:string){navigate(pathForPage(next,target));}
  useEffect(()=>{if(!pageForPath(location))navigate("/",{replace:true});},[location,navigate]);
  useEffect(()=>{window.scrollTo({top:0,behavior:"instant"});},[page]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  useEffect(() => { if (page === "night") setSetupOpen(false); }, [page]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS);
  const [catalogError, setCatalogError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [visibleOnly, setVisibleOnly] = useState(true);
  const [friendlyOnly, setFriendlyOnly] = useState(false);
  const [limit, setLimit] = useState(8);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [savedHop] = useState(readHopProgress);
  const restoreAttempted = useRef(false);
  const storageWarning = useRef(false);
  const [algorithm, setAlgorithm] = useState<CostStrategyId>(savedHop?.algorithm ?? "auto");
  const [computing, setComputing] = useState(false);
  const [findingTime, setFindingTime] = useState(false);
  const [routeResult, setRouteResult] = useState<{
    key: string;
    result: Awaited<ReturnType<typeof planRoutes>>;
  } | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const featuredObjectRef = useRef<HTMLElement>(null);
  const [speed, setSpeed] = useState(3500);
  const [clockNow, setClockNow] = useState(() => new Date());
  const offline = useOffline();
  const {
    lat,
    lon,
    mode,
    fov,
    fovHeight,
    shape,
    limitingMag,
    targetId,
    difficulty,
  } = settings;
  const [lunarSelection, setLunarSelection] = useState(lunarFeatures[0].id);
  const timezone = useMemo(() => tzLookup(lat, lon), [lat, lon]);
  useEffect(() => {
    if (settings.timeMode !== "live") return;
    const refresh = () => setClockNow(new Date());
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const resume = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", resume);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", resume); };
  }, [settings.timeMode]);
  const observingDate =
    settings.timeMode === "live"
      ? formatInTimeZone(clockNow, timezone, "yyyy-MM-dd")
      : settings.date;
  const observingTime =
    settings.timeMode === "live"
      ? formatInTimeZone(clockNow, timezone, "HH:mm")
      : settings.time;
  const date = useMemo(
    () =>
      settings.timeMode === "live"
        ? clockNow
        : resolvePlannedMoment(settings.date, settings.time, timezone, settings.plannedAt),
    [settings.date, settings.time, settings.timeMode, settings.plannedAt, timezone, clockNow],
  );
  const params: ObservingParams = useMemo(
    () => ({
      lat,
      lon,
      date,
      fovWidth: fov,
      fovHeight: shape === "circle" ? fov : fovHeight,
      fovShape: shape,
      limitingMag,
      numRoutes: 3,
      targetId,
      observingMode: mode,
      difficulty,
      algorithm,
      startStarId: settings.startStarId,
    }),
    [
      lat,
      lon,
      date,
      fov,
      fovHeight,
      shape,
      limitingMag,
      targetId,
      mode,
      difficulty,
      algorithm,
      settings.startStarId,
    ],
  );
  const paramsKey = JSON.stringify({
    ...params,
    // Keep an in-progress route visible as the live clock advances.
    date: settings.timeMode === "live" ? "live" : params.date,
  });
  const keyRef = useRef(paramsKey);
  keyRef.current = paramsKey;
  const result = routeResult?.key === paramsKey ? routeResult.result : null;
  const route: Route | null = result?.routes[routeIndex] ?? null;
  const hop = route?.hops[step] ?? null;
  const selected = catalogs.targets.find((t) => t.id === targetId);
  const ranked = useMemo(
    () => rankTargets(catalogs.targets, lat, lon, date, mode),
    [catalogs.targets, lat, lon, date, mode],
  );
  const planningTargets = useMemo(()=>[...catalogs.targets,...catalogs.stars.map(starPlanningTarget)],[catalogs.targets,catalogs.stars]);
  const selection = ranked.find((t) => t.target.id === targetId);
  const selectedStart = catalogs.stars.find(star => star.id === settings.startStarId);
  const startOptions = useMemo(() => {
    if (!selected) return [];
    const nearby = catalogs.stars.filter(star => star.mag <= Math.min(4.5,limitingMag) && !!(star.name || star.bayer || star.flamsteed))
      .map(star => ({ star, ...eqToHorizontal(star.ra,star.dec,lat,lon,date), distance:angularDistance(star.ra,star.dec,selected.ra,selected.dec) }))
      .filter(star => star.alt >= 5).sort((a,b) => a.distance-b.distance || a.star.mag-b.star.mag).slice(0,80);
    if (selectedStart && !nearby.some(option => option.star.id === selectedStart.id)) nearby.unshift({ star:selectedStart, ...eqToHorizontal(selectedStart.ra,selectedStart.dec,lat,lon,date), distance:angularDistance(selectedStart.ra,selectedStart.dec,selected.ra,selected.dec) });
    return nearby;
  }, [selected, catalogs.stars, selectedStart, limitingMag, lat, lon, date]);
  const conditions = useMemo(
    () => skyConditions(lat, lon, date),
    [lat, lon, date],
  );
  const savedIds = new Set(night.map((t) => t.id));
  const observed = night.filter((t) => t.observedAt).length;
  const categories = useMemo(
    () =>
      Array.from(new Set(catalogs.targets.map((t) => t.categoryShort))).sort(),
    [catalogs.targets],
  );
  const filtered = useMemo(
    () =>
      ranked.filter(
        (o) =>
          (!visibleOnly || o.alt >= 15) &&
          (!friendlyOnly || guideFor(o.target).binocular) &&
          (category === "all" || o.target.categoryShort === category) &&
          Number.isFinite(catalogSearchScore(o.target,query,getConstellationName(o.target.con))),
      ).sort((a,b)=>catalogSearchScore(a.target,query,getConstellationName(a.target.con))-catalogSearchScore(b.target,query,getConstellationName(b.target.con))),
    [ranked, visibleOnly, friendlyOnly, category, query],
  );
  const starSearchTargets = useMemo(() => catalogs.stars.map(star => ({ star, target:starPlanningTarget(star) })), [catalogs.stars]);
  const starHits = useMemo<NavigationStarHit[]>(() => {
    if (!query.trim() || (category !== "all" && category !== "Star")) return [];
    return starSearchTargets.flatMap(({star,target}) => {
      const score = catalogSearchScore(target, query, getConstellationName(target.con));
      if (!Number.isFinite(score) || (friendlyOnly && star.mag > 6.5)) return [];
      const pos = eqToHorizontal(star.ra, star.dec, lat, lon, date);
      if (visibleOnly && pos.alt < 15) return [];
      if (filtered.some(object => /star/i.test(object.target.category) && angularDistance(star.ra, star.dec, object.target.ra, object.target.dec) < .02)) return [];
      return [{ star, name:target.name, ...pos, score }];
    }).sort((a,b) => a.score-b.score || a.star.mag-b.star.mag || b.alt-a.alt);
  }, [starSearchTargets, query, category, friendlyOnly, visibleOnly, lat, lon, date, filtered]);
  const previewNodes = useMemo<SkyNode[]>(
    () =>
      catalogs.stars
        .filter((s) => s.mag <= limitingMag)
        .map((s) => ({
          ...s,
          ...eqToHorizontal(s.ra, s.dec, lat, lon, date),
          name: s.name || s.bayer || s.id,
          type: "star" as const,
        }))
        .filter((s) => s.alt > 0),
    [catalogs.stars, limitingMag, lat, lon, date],
  );
  const previewTarget: SkyNode | null =
    selected && selection
      ? {
          ...selected,
          ...selection,
          alt: selection.alt,
          az: selection.az,
          name: selected.name,
          constellation: selected.con,
          type: selected.source === "messier" ? "messier" : "binocular",
        }
      : null;
  useEffect(()=>{
    if(!catalogs.targets.length)return;
    const linked=targetFromPath(location);
    if(linked){firstTarget.current=false;if(catalogs.targets.some(t=>t.id===linked)){if(targetId!==linked)update({targetId:linked,startStarId:undefined});}else navigate("/hop",{replace:true});return;}
    if(firstTarget.current){firstTarget.current=false;const pick=ranked.find(o=>o.alt>=15&&guideFor(o.target).binocular);if(pick)update({targetId:pick.target.id});}
  },[catalogs.targets.length,location]);
  const overviewNodes = useMemo<SkyNode[]>(() => {
    const objects = ranked.filter((o) => o.alt > 15).slice(0, 7);
    const markers = objects.map((o): SkyNode => ({ ...o.target, alt: o.alt, az: o.az, type: o.target.source === "messier" ? "messier" : "binocular", constellation: o.target.con }));
    if (previewTarget && previewTarget.alt > 0 && !markers.some((o) => o.id === previewTarget.id)) markers.push(previewTarget);
    return [...previewNodes, ...markers];
  }, [previewNodes, ranked, targetId]);

  const loadCatalogs = useCallback(async () => {
    setLoading(true);
    setCatalogError(false);
    try {
      const [stars, messier, binocular, constellations, dense, milkyWay] =
        await Promise.all([
          loadStars(),
          loadMessier(),
          loadBinocularTargets(),
          loadConstellations(),
          loadDenseStars(),
          loadMilkyWay(),
        ]);
      setCatalogs({
        stars,
        targets: buildUnifiedTargets(messier, binocular),
        constellations,
        dense,
        milkyWay,
      });
    } catch {
      setCatalogError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs]);
  useEffect(() => {
    document.documentElement.classList.toggle("red-light", settings.redLight);
  }, [settings.redLight]);
  useEffect(() => {
    setPlaying(false);
    setStep(0);
    setRouteIndex(0);
  }, [paramsKey]);
  useEffect(() => {
    if (loading || catalogError || page !== "hop" || restoreAttempted.current || computing || routeResult) return;
    const linked = targetFromPath(location);
    if (linked && linked !== targetId) return;
    restoreAttempted.current = true;
    if (!savedHop || savedHop.configKey !== paramsKey) return;
    const key = paramsKey;
    setComputing(true);
    void planRoutes(params).then(computed => {
      if (keyRef.current !== key) return;
      const index = matchingRouteIndex(computed.routes, savedHop);
      setRouteResult({ key, result: computed });
      setRouteIndex(index < 0 ? 0 : index);
      setStep(index < 0 ? 0 : savedHop.step);
      toast({ title: index < 0 ? "The sky or route has changed" : "Hop resumed",
        description: index < 0 ? "Plan checked for your current sky. Begin at the first field if a route is available." : `Restored field ${savedHop.step + 1}. Positions are recalculated for your observing time.` });
    }).catch(() => toast({ title: "Could not restore this hop", description: "Try planning the route again.", variant: "destructive" }))
      .finally(() => setComputing(false));
  }, [loading, catalogError, page, location, targetId, paramsKey, computing, routeResult]);
  useEffect(() => {
    if (!route || computing) return;
    const stored = writeHopProgress({ configKey: paramsKey, algorithm, fingerprint: routeFingerprint(route), step, savedAt: Date.now(), live: settings.timeMode === "live" });
    if (!stored && !storageWarning.current) {
      storageWarning.current = true;
      toast({ title: "Hop progress could not be saved", description: "Keep this page open, or allow site storage to resume after a reload." });
    }
  }, [route, step, paramsKey, algorithm, computing]);
  useEffect(() => {
    setLimit(8);
  }, [query, category, visibleOnly, friendlyOnly]);
  useEffect(() => {
    if (!playing || !route) return;
    const timer = setInterval(
      () =>
        setStep((prev) => {
          if (prev >= route.hops.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        }),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, route, speed]);

  function selectTarget(id: string) {
    firstTarget.current=false;
    if(id.startsWith("star:")){setInspectedStar(catalogs.stars.find(s=>`star:${s.id}`===id)??null);return;}
    const star=catalogs.stars.find(s=>s.id===id);
    if(star&&!catalogs.targets.some(t=>t.id===id)){setInspectedStar(star);return;}
    update({ targetId: id, ...(id !== targetId ? { startStarId:undefined } : {}) });
    if(page==="hop")navigate(pathForPage("hop",id),{replace:true});
  }
  function previewMoment(at:Date,latitude:number,longitude:number,navigate=true) {
    const zone=sessionTimezone({lat:latitude,lon:longitude});
    update({lat:latitude,lon:longitude,date:formatInTimeZone(at,zone,"yyyy-MM-dd"),time:formatInTimeZone(at,zone,"HH:mm"),timeMode:"planned",plannedAt:at.toISOString()});
    if(navigate)setPage("tonight");
  }
  function createSession(s:ObservingSession) {
    setPlannerStore(current=>({...current,sessions:[...current.sessions,s],activeId:s.id}));
    previewMoment(new Date(s.startAt),s.lat,s.lon,false); setPage("night");
  }
  function updateSession(s:ObservingSession) {
    setPlannerStore(current=>({...current,sessions:current.sessions.map(previous=>previous.id===s.id?s:previous)}));
    if(activeSession?.id===s.id&&!s.archived)previewMoment(new Date(s.startAt),s.lat,s.lon,false);
  }
  function selectSession(id:string|null) {
    setPlannerStore(current=>({...current,activeId:id}));
    const s=plannerStore.sessions.find(s=>s.id===id);if(s)previewMoment(new Date(s.startAt),s.lat,s.lon,false);
  }
  function visitScheduledTarget(id:string,at:Date) {
    previewMoment(at,activeSession?.lat??lat,activeSession?.lon??lon,false);
    if(id.startsWith("moon:")){setLunarSelection(id.slice(5));setPage("moon");}
    else if(id.startsWith("star:")){setInspectedStar(catalogs.stars.find(s=>`star:${s.id}`===id)??null);setPage("tonight");}
    else {update({targetId:id,...(id !== targetId ? {startStarId:undefined} : {})});setPage("hop",id);}
  }
  function saveNewSession(items: NightItem[], title: string) {
    const at = settings.timeMode === "live" ? planningShortcut("tonight", lat, lon).date : date;
    const s = makeSession(`${formatInTimeZone(at, timezone, "MMM d")} observing night`, at, lat, lon, items, matchingLocation(savedLocations,lat,lon)?.name??"");
    setPlannerStore(current => ({ ...current, sessions: [...current.sessions, s], activeId: s.id }));
    toast({ title, description: `${s.name}. Open Planner to edit its date, site and viewing sequence.` });
  }
  function toggleSave(id: string) {
    if(!activeSession&&!legacyNight.some(i=>i.id===id)) {
      saveNewSession([...legacyNight, { id, addedAt:new Date().toISOString(), notes:"" }], "Added to your observing session");
      return;
    }
    setNight((prev) =>
      prev.some((t) => t.id === id)
        ? prev.filter((t) => t.id !== id)
        : [...prev, { id, addedAt: new Date().toISOString(), notes: "" }],
    );
  }
  function markObserved(id: string) {
    const updateItems = (prev: NightItem[]) =>
      prev.some((t) => t.id === id)
        ? prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  observedAt: t.observedAt
                    ? undefined
                    : new Date().toISOString(),
                }
              : t,
          )
        : [
            ...prev,
            {
              id,
              addedAt: new Date().toISOString(),
              observedAt: new Date().toISOString(),
              notes: "",
            },
          ];
    // Completing a first hop uses the same dated destination as the add button.
    // Keep the map and its orientation in place while the session is created.
    if (!activeSession && page === "hop") {
      saveNewSession(updateItems(legacyNight), "Observation saved to your session");
      return;
    }
    setNight(updateItems);
  }
  function planLocalTime(localDate: string, localTime: string) {
    const at = resolveLocalMoment(localDate, localTime, timezone);
    if (!at) { toast({ title:"That local time does not exist", description:"The clock changes for daylight saving at your location. Choose a time before or after the jump." }); return; }
    update({ date:localDate, time:localTime, timeMode:"planned", plannedAt:at.toISOString() });
  }
  function useNow() {
    const now = new Date();
    setClockNow(now);
    update({
      date: formatInTimeZone(now, timezone, "yyyy-MM-dd"),
      time: formatInTimeZone(now, timezone, "HH:mm"),
      timeMode: "live",
      plannedAt:undefined,
    });
  }
  function locate() {
    if (!navigator.geolocation) {
      toast({
        title: "Location unavailable",
        description: "Enter your coordinates in the observing setup.",
        variant: "destructive",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        update({
          lat: Math.round(p.coords.latitude * 10000) / 10000,
          lon: Math.round(p.coords.longitude * 10000) / 10000,
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast({
          title: "Could not get your location",
          description: "You can enter latitude and longitude manually.",
          variant: "destructive",
        });
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }
  function selectInstrument(selectedMode: Settings["mode"]) {
    const patch = { mode: selectedMode, instrumentSelected: true, fov: selectedMode === "binocular" ? 7 : 5, fovHeight: selectedMode === "binocular" ? 7 : 5, shape: "circle" as const, limitingMag: selectedMode === "binocular" ? 6.5 : 8 };
    update(patch);
    return patch;
  }
  async function compute(chosenMode?: Settings["mode"], forcedStart?: string) {
    if (!settings.instrumentSelected && !chosenMode) {
      setInstrumentOpen(true);
      return;
    }
    const instrument = chosenMode ? selectInstrument(chosenMode) : null;
    const computeParams: ObservingParams = { ...(instrument ? { ...params, observingMode: instrument.mode, fovWidth: instrument.fov, fovHeight: instrument.fovHeight, fovShape: instrument.shape, limitingMag: instrument.limitingMag } : params), ...(forcedStart ? { startStarId:forcedStart } : {}) };
    setInstrumentOpen(false);
    setPage("hop",targetId);
    setComputing(true);
    setPlaying(false);
    const key = JSON.stringify({ ...computeParams, date: settings.timeMode === "live" ? "live" : computeParams.date });
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const computed = await planRoutes(computeParams);
      if (keyRef.current !== key) return;
      setRouteResult({ key, result: computed });
      setRouteIndex(0);
      setStep(0);
    } catch {
      toast({
        title: "Could not plan this route",
        description: "Check that the catalogs have loaded, then try again.",
        variant: "destructive",
      });
    } finally {
      setComputing(false);
    }
  }
  function advanceField() {
    if (!route) return;
    setPlaying(false);
    if (step < route.hops.length - 1) setStep(step + 1);
    else markObserved(targetId);
  }
  async function planBinocularHop(id: string, at: Date) {
    const localDate = formatInTimeZone(at, timezone, "yyyy-MM-dd");
    const localTime = formatInTimeZone(at, timezone, "HH:mm");
    const field = fov;
    const starLimit = limitingMag;
    const plannedParams: ObservingParams = {
      ...params,
      startStarId: undefined,
      date: fromZonedTime(`${localDate}T${localTime}:00`, timezone),
      targetId: id,
      observingMode: "binocular",
      fovWidth: field,
      fovHeight: field,
      fovShape: "circle",
      limitingMag: starLimit,
    };
    const key = JSON.stringify(plannedParams);
    update({ targetId: id, startStarId: undefined, date: localDate, time: localTime, timeMode: "planned", plannedAt:plannedParams.date.toISOString(), mode: "binocular", instrumentSelected: true, fov: field, fovHeight: field, shape: "circle", limitingMag: starLimit });
    setPage("hop",id);
    setRouteResult(null);
    setComputing(true);
    setPlaying(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const computed = await planRoutes(plannedParams);
      if (keyRef.current !== key) return;
      setRouteResult({ key, result: computed });
      setRouteIndex(0);
      setStep(0);
    } catch {
      toast({ title: "Could not plan this binocular hop", description: "Check that the sky catalogs have loaded and try again.", variant: "destructive" });
    } finally {
      setComputing(false);
    }
  }
  async function bestTime() {
    if (!selected) return;
    setFindingTime(true);
    const key = paramsKey;
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const window = findBestObservingTime(
        selected.ra,
        selected.dec,
        lat,
        lon,
        date,
      );
      if (keyRef.current !== key) return;
      if (window) {
        update({
          date: formatInTimeZone(window.date, timezone, "yyyy-MM-dd"),
          time: formatInTimeZone(window.date, timezone, "HH:mm"),
          timeMode: "planned",
          plannedAt:window.date.toISOString(),
        });
        toast({
          title: "A better observing window",
          description: `${selected.name} reaches ${Math.round(window.alt)}° in dark skies on ${formatInTimeZone(window.date, timezone, "MMM d, yyyy · HH:mm")}.`,
        });
      } else
        toast({
          title: "No suitable window found",
          description:
            "This object does not reach 30° during darkness here in the next year. Try another target.",
        });
    } catch {
      toast({
        title: "Could not find a window",
        description: "Check your location and time, then try again.",
        variant: "destructive",
      });
    } finally {
      setFindingTime(false);
    }
  }
  function download(content: string, filename: string, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportNight() {
    const exportZone=activeSession?sessionTimezone(activeSession):timezone;
    const exportDate=activeSession?new Date(activeSession.startAt):date;
    const lines = [
      `# ${activeSession?.name??"My StarHop observing night"}`,
      `${formatInTimeZone(exportDate,exportZone,"yyyy-MM-dd HH:mm")} (${exportZone})`,
      `Location: ${activeSession?.locationName ? `${activeSession.locationName} · ` : ""}${activeSession?.lat??lat}°, ${activeSession?.lon??lon}° · ${mode} · ${fov}° field`,
      "",
    ];
    night.forEach((item) => {
      const t = planningTargets.find((t) => t.id === item.id);
      lines.push(
        `## ${item.id.startsWith("moon:") ? `Moon — ${lunarFeatures.find(f => `moon:${f.id}` === item.id)?.name || item.id}` : t?.displayName || item.id}`,
        item.observedAt
          ? `Observed: ${formatInTimeZone(new Date(item.observedAt), exportZone, "MMM d, yyyy HH:mm")}`
          : "To observe",
        item.notes || "",
        "",
      );
    });
    download(
      lines.join("\n"),
      `starhop-night-${formatInTimeZone(exportDate,exportZone,"yyyy-MM-dd")}.md`,
      "text/markdown",
    );
  }
  function exportRoute() {
    if (!route || !selected) return;
    download(
      [
        `# Star hop to ${selected.displayName}`,
        `${observingDate} ${observingTime} (${timezone}) · ${lat}°, ${lon}°`,
        `${mode} · ${fov}° field · guide stars to magnitude ${limitingMag}`,
        "",
        ...route.hops.map(
          (h, i) =>
            `${i + 1}. ${h.instruction}\n   ${h.pattern} · Alt ${h.center.alt.toFixed(0)}° · Az ${h.center.az.toFixed(0)}°`,
        ),
        "",
        `At the target: ${guideFor(selected).lookFor}`,
      ].join("\n"),
      `starhop-${targetId}.md`,
      "text/markdown",
    );
  }

  function exportRouteJSON() {
    if (!route) return;
    download(
      JSON.stringify(
        {
          route,
          observingParams: params,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      `starhop-${targetId}-${route.id}.json`,
      "application/json",
    );
  }

  const dateLabel = formatInTimeZone(date, timezone, "EEE, MMM d, yyyy");
  const locationLabel = matchingLocation(savedLocations,lat,lon)?.name ??
    (lat === 37.77 && lon === -122.42
      ? "San Francisco · default location"
      : `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`);
  const offlineLabel =
    offline.state === "ready"
      ? offline.online
        ? "Offline ready"
        : "Working offline"
      : offline.state === "preparing"
        ? "Preparing offline…"
        : offline.online
          ? "Offline setup"
          : "Offline · not prepared";

  return (
    <div className="observatory-shell">
      <header className="app-header">
        <a
          href="#/"
          className="brand"
          onClick={() => setPage("tonight")}
          aria-label="StarHop home"
        >
          <StarHopLogo />
          <div>
            <span className="brand-title" data-testid="text-app-title">
              StarHop<span className="brand-dot">.</span>
            </span>
            <span className="brand-subtitle">
              A NIGHT SKY WATCHER COMPANION
            </span>
          </div>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {(
            [
              ["tonight", "Tonight", Compass],
              ["night", "Planner", CalendarDays],
              ["binocular", "Binoculars", Binoculars],
              ["moon", "Moon", Moon],
              ["hop", "Star hop", Navigation],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              data-testid={`tab-${id}`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {id === "night" && night.length > 0 && (
                <span className="nav-count">{night.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className={`icon-button mobile-setup-toggle ${page === "night" ? "planner-setup-toggle" : ""}`}
            onClick={() => setSetupOpen(!setupOpen)}
            aria-label="Observing setup"
            aria-expanded={setupOpen}
          >
            <Settings2 size={17} />
          </button>
          <button
            aria-label={offlineLabel}
            className={`offline-pill ${offline.state === "ready" ? "ready" : ""}`}
            onClick={() => setOfflineOpen(true)}
            data-testid="offline-indicator"
          >
            <span className="status-dot" />
            <span>{offlineLabel}</span>
          </button>
          <button
            className={`icon-button red-toggle ${settings.redLight ? "active" : ""}`}
            onClick={() => update({ redLight: !settings.redLight })}
            aria-label="Red light mode"
            aria-pressed={settings.redLight}
            title="Red light mode"
            data-testid="button-red-light"
          >
            <Moon size={18} />
          </button>
        </div>
      </header>

      <div className={`workspace-layout ${page === "night" ? "planning-workspace" : ""}`}>
        <aside className={`setup-panel ${setupOpen ? "open" : ""}`}>
          <div className="setup-title">
            <span className="eyebrow">YOUR OBSERVING SETUP</span>
            <Settings2 size={14} />
          </div>
          <section className="setup-section">
            <div className="section-label">
              <MapPin size={15} />
              <h2>Where are you watching?</h2>
            </div>
            <p className="location-name">{locationLabel}</p>
            <SavedLocations context="Sky" locations={savedLocations} lat={lat} lon={lon} onChange={setSavedLocations} onSelect={site=>update({lat:site.lat,lon:site.lon})}/>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <CoordinateInput
                label="Latitude"
                value={lat}
                min={-90}
                max={90}
                onChange={(v) => update({ lat: v })}
              />
              <CoordinateInput
                label="Longitude"
                value={lon}
                min={-180}
                max={180}
                onChange={(v) => update({ lon: v })}
              />
            </div>
            <button
              className="text-action mt-3"
              onClick={locate}
              disabled={locating}
            >
              {locating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Crosshair size={13} />
              )}
              Use my location
            </button>
          </section>
          <section className="setup-section">
            <div className="section-label">
              <Clock size={15} />
              <h2>Pick your moment</h2>
              <button className="text-action ml-auto" onClick={useNow}>
                Now
              </button>
            </div>
            <div className="grid grid-cols-[1.3fr_1fr] gap-2 mt-3">
              <div>
                <Label htmlFor="observing-date" className="field-label">
                  Date
                </Label>
                <Input
                  id="observing-date"
                  type="date"
                  value={observingDate}
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !isNaN(new Date(e.target.value).getTime())
                    )
                      planLocalTime(e.target.value, observingTime);
                  }}
                  data-testid="input-date"
                />
              </div>
              <div>
                <Label htmlFor="observing-time" className="field-label">
                  Local time
                </Label>
                <Input
                  id="observing-time"
                  type="time"
                  value={observingTime}
                  onChange={(e) => {
                    if (e.target.value)
                      planLocalTime(observingDate, e.target.value);
                  }}
                  data-testid="input-time"
                />
              </div>
            </div>
            <p className="setup-hint mt-2">{timezone.replaceAll("_", " ")}</p>
          </section>
          <section className="setup-section">
            <div className="section-label">
              {!settings.instrumentSelected ? <Eye size={16} /> : mode === "binocular" ? <Binoculars size={16} /> : <Telescope size={16} />}
              <h2>Your window to the sky</h2>
            </div>
            <div className="equipment-options">
              <button
                className={settings.instrumentSelected && mode === "binocular" ? "selected" : ""}
                aria-pressed={settings.instrumentSelected && mode === "binocular"}
                onClick={() => selectInstrument("binocular")}
                data-testid="button-mode-binocular"
              >
                <Binoculars size={22} />
                <span>Binoculars</span>
                <small>Wide & easy</small>
              </button>
              <button
                className={settings.instrumentSelected && mode === "telescope" ? "selected" : ""}
                aria-pressed={settings.instrumentSelected && mode === "telescope"}
                onClick={() => selectInstrument("telescope")}
                data-testid="button-mode-telescope"
              >
                <Telescope size={22} />
                <span>Small telescope</span>
                <small>Finder & eyepiece</small>
              </button>
            </div>
            {!settings.instrumentSelected && (
              <p className="setup-hint mt-2">
                Choose binoculars or a telescope for this session. StarHop will match the hop distances and guidance to your instrument.
              </p>
            )}
            <div className="flex justify-between mb-3">
              <Label className="field-label">Navigation field</Label>
              <span className="text-xs text-primary font-mono">
                {fov.toFixed(1)}°
              </span>
            </div>
            <Slider
              value={[fov]}
              onValueChange={([v]) => update({ fov: v })}
              min={0.5}
              max={12}
              step={0.1}
              aria-label="Navigation field of view"
              data-testid="slider-fov-width"
            />
            <p className="setup-hint mt-3">
              {mode === "binocular"
                ? "Match the field printed on your binoculars."
                : "Use your finder’s field while hopping, then switch to the eyepiece for detail."}
            </p>
            <details className="advanced-settings">
              <summary>
                Fine tune equipment <ChevronRight size={13} />
              </summary>
              <div className="space-y-4 pt-3">
                {mode === "telescope" && <EyepieceCalculator onApply={field => update({ fov: field, fovHeight: field, shape: "circle" })}/>}
                <div>
                  <Label className="field-label">
                    Faintest guide star · mag {limitingMag.toFixed(1)}
                  </Label>
                  <Slider
                    className="mt-2"
                    value={[limitingMag]}
                    onValueChange={([v]) => update({ limitingMag: v })}
                    min={3}
                    max={12}
                    step={0.1}
                    aria-label="Limiting guide star magnitude"
                  />
                </div>
                <div>
                  <Label className="field-label">Field shape</Label>
                  <Select
                    value={shape}
                    onValueChange={(v: "circle" | "rectangle") =>
                      update({ shape: v })
                    }
                    disabled={mode === "binocular"}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="circle">Circular field</SelectItem>
                      <SelectItem value="rectangle">
                        Rectangular field
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {shape === "rectangle" && (
                  <div>
                    <Label className="field-label">
                      Field height · {fovHeight.toFixed(1)}°
                    </Label>
                    <Slider
                      className="mt-2"
                      value={[fovHeight]}
                      onValueChange={([v]) => update({ fovHeight: v })}
                      min={0.5}
                      max={12}
                      step={0.1}
                      aria-label="Field height"
                    />
                  </div>
                )}
                <div>
                  <Label className="field-label">Route preference</Label>
                  <Select
                    value={algorithm}
                    onValueChange={(v: CostStrategyId) => setAlgorithm(v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatic</SelectItem>
                      <SelectItem value="landmark-discount">
                        Bright landmarks
                      </SelectItem>
                      <SelectItem value="confidence-decay">
                        Steady confidence
                      </SelectItem>
                      <SelectItem value="focal-search">
                        Flexible search
                      </SelectItem>
                      <SelectItem value="landmark-magnet">
                        Landmark attraction
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </details>
          </section>
          <section className="setup-section">
            <div className="section-label">
              <Navigation size={15} />
              <h2>A comfortable pace</h2>
            </div>
            <div className="pace-options">
              {(["beginner", "intermediate", "expert"] as const).map((d) => (
                <button
                  key={d}
                  className={difficulty === d ? "selected" : ""}
                  onClick={() => update({ difficulty: d })}
                  aria-pressed={difficulty === d}
                >
                  {d === "beginner"
                    ? "Guided"
                    : d === "intermediate"
                      ? "Balanced"
                      : "Direct"}
                </button>
              ))}
            </div>
            <p className="setup-hint">
              {difficulty === "beginner"
                ? "Shorter hops and bright landmarks. A good place to start."
                : difficulty === "intermediate"
                  ? "A balance of recognizable landmarks and fewer stops."
                  : "Longer sweeps for experienced observers."}
            </p>
          </section>
          <div className="field-tip">
            <Sparkles size={16} />
            <span className="eyebrow">A MOMENT TO ADAPT</span>
            <p>
              Give your eyes 20–30 minutes in the dark. Look slightly beside a
              faint object to bring it into view.
            </p>
            <button
              className="text-action"
              onClick={() => update({ redLight: !settings.redLight })}
            >
              {settings.redLight
                ? "Leave red light mode"
                : "Try red light mode"}
              <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="photo-chart-link" onClick={() => setPage("image")}>
            <ImageIcon size={15} />
            Calibrate a photo chart
            <ArrowUpRight size={13} />
          </button>
        </aside>

        <main className="main-content">
          {(settingsError || nightError || plannerError || locationsError) && (
            <div className="notice warning">
              <AlertTriangle size={16} />
              Device storage is unavailable. Export your notes before closing
              this page.
            </div>
          )}
          {catalogError && (
            <div className="notice warning">
              <AlertTriangle size={16} />
              <span>
                Could not load the sky catalogs. Connect once to prepare the app
                for offline use.
              </span>
              <Button variant="outline" size="sm" onClick={loadCatalogs}>
                Retry
              </Button>
            </div>
          )}
          {page !== "night" && <section className={`session-timebar ${settings.timeMode === "planned" ? "planned" : ""}`} aria-label="Observing time" data-testid="session-timebar">
            <div><Clock size={14} /><span><strong>{settings.timeMode === "live" ? "Live sky" : "Viewing planned sky"}</strong> · {dateLabel} · {observingTime}<small>{timezone.replaceAll("_", " ")} (UTC{formatInTimeZone(date,timezone,"xxx")}) · {locationLabel}</small>{activeSession&&<small className="session-list-context">Targets saved to “{activeSession.name}”</small>}</span></div>
            <div className="session-time-actions"><button className="text-action" onClick={()=>setPage("night")}><CalendarDays size={13}/>{activeSession ? `Planner · ${night.length} ${night.length===1?"object":"objects"}` : "Open planner"}</button><details><summary>Plan a time</summary><div><label>Date<input aria-label="Session date" type="date" value={observingDate} onChange={e => { if (e.target.value && Number.isFinite(new Date(e.target.value).getTime())) planLocalTime(e.target.value, observingTime); }} /></label><label>Time<input aria-label="Session time" type="time" value={observingTime} onChange={e => { if (e.target.value) planLocalTime(observingDate, e.target.value); }} /></label><small>Local time at your observing location.</small></div></details><button className="text-action" onClick={useNow}>{settings.timeMode === "live" ? "Refresh now" : "Use current time"}</button></div>
          </section>}
          {page === "tonight" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">LOOK UP. THERE’S A WHOLE UNIVERSE.</p>
                  <h1>
                    A little wonder, {formatInTimeZone(date,timezone,"yyyy-MM-dd")===formatInTimeZone(new Date(),timezone,"yyyy-MM-dd")?"tonight":"that night"}<span>.</span>
                  </h1>
                  <p>
                    Find your next faint fuzzy, familiar friend, or first
                    discovery.
                  </p>
                  <button className="text-action binocular-home-link" onClick={() => setPage("binocular")}>
                    <Binoculars size={14} /> Explore binocular favorites, month by month <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
              <div className="conditions-strip">
                <Condition
                  icon={<Sparkles />}
                  label="Sun position at your time"
                  value={conditions.darkness}
                  detail={
                    conditions.isDark
                      ? "Sun below −18°; clouds and light pollution not measured"
                      : `Sun altitude ${Math.round(conditions.sunAlt)}°`
                  }
                />
                <Condition
                  icon={<Moon />}
                  label={conditions.moonPhase}
                  value={`${conditions.illumination}% illuminated`}
                  detail={
                    conditions.moonAlt > 0
                      ? `Moon ${Math.round(conditions.moonAlt)}° above horizon`
                      : "Moon below the horizon"
                  }
                />
                <Condition
                  icon={<Eye />}
                  label="Catalog objects above 15°"
                  value={`${ranked.filter((t) => t.alt >= 15).length} objects`}
                  detail="Calculated from the included catalogs"
                />
                <Condition
                  icon={<BookOpen />}
                  label="Your observing list"
                  value={`${night.length} saved`}
                  detail={`${observed} observed · saved on this device`}
                />
              </div>
              <div className="data-source-row">
                <span>Calculated on this device from stored sky catalogs</span>
                <button className="text-action" onClick={() => setSourcesOpen(true)}>
                  Where the data comes from
                </button>
              </div>
              {conditions.moonAlt >= 15 && conditions.illumination >= 60 && <button className="moon-tonight-link" onClick={() => setPage("moon")}><Moon size={18} /><span>A bright Moon is up. Explore seas and ray systems, or find a darker window.</span><ArrowUpRight size={15} /></button>}
              <div className="tonight-hero">
                <section className="panel sky-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">GET YOUR BEARINGS</span>
                      <h2>Your sky, overhead</h2>
                    </div>
                    <span className="live-label">
                      {settings.timeMode === "live" ? "Live sky" : "Planned sky"} · {observingTime}
                    </span>
                  </div>
                  {loading ? (
                    <div className="sky-loading">
                      <Loader2 className="animate-spin" />
                      <p>Opening the sky atlas…</p>
                    </div>
                  ) : (
                    <SkyChart
                      overview
                      nodes={overviewNodes}
                      constellations={catalogs.constellations}
                      denseStars={catalogs.dense}
                      milkyWay={catalogs.milkyWay}
                      route={null}
                      targetNode={previewTarget}
                      animStep={0}
                      fovWidth={fov}
                      fovHeight={shape === "circle" ? fov : fovHeight}
                      fovShape={shape}
                      limitingMag={limitingMag}
                      onFovChange={(width) => update({ fov: width, ...(shape === "circle" ? { fovHeight: width } : {}) })}
                      onLimitingMagChange={(value) => update({ limitingMag: value })}
                      lat={lat}
                      lon={lon}
                      date={date}
                      onSelect={selectTarget}
                    />
                  )}
                  <div className="sky-caption">
                    <span>
                      <i className="legend-target" />
                      Deep sky object
                    </span>
                    <span>Outer ring = horizon · center = zenith</span>
                  </div>
                </section>
                {selected && selection ? (
                  <section className="panel featured-object" ref={featuredObjectRef}>
                    <div className="featured-art">
                      <TargetPhoto target={selected} />
                      <span className="art-badge">IN FOCUS</span>
                    </div>
                    <div className="featured-body">
                      <div className="flex items-center justify-between gap-2">
                        <span className="eyebrow">
                          {selected.id} · {selected.category.toUpperCase()}
                        </span>
                        <span
                          className={`visibility-tag ${selection.alt < 15 ? "low" : ""}`}
                        >
                          {altitudeLabel(selection.alt)}
                        </span>
                      </div>
                      <h2>{selected.name}</h2>
                      <p className="object-location">
                        {getConstellationName(selected.con)}
                        <span>·</span>
                        {Math.round(selection.alt)}°{" "}
                        {compassLabel(selection.az)}
                      </p>
                      <p className="object-story">{guideFor(selected).story}</p>
                      {!conditions.isDark&&<button className="text-action" onClick={()=>previewMoment(planningShortcut("tonight",lat,lon).date,lat,lon)}>Preview tonight after dark <ArrowUpRight size={13}/></button>}
                      <TargetPhotoCredit target={selected} />
                      <p className="equipment-tag">
                        <Eye size={14} />
                        {guideFor(selected).equipment}
                      </p>
                      <MoonlightCard target={selected} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} onMoon={() => setPage("moon")} />
                      <div className="featured-actions">
                        <Button
                          onClick={() => compute()}
                          disabled={computing || loading}
                          data-testid="button-compute"
                        >
                          <Navigation size={15} />
                          {settings.instrumentSelected ? "Show me the way" : "Choose your instrument"}
                          <ArrowUpRight size={15} />
                        </Button>
                        <button
                          className={`save-button ${savedIds.has(targetId) ? "saved" : ""}`}
                          onClick={() => toggleSave(targetId)}
                          aria-label={
                            savedIds.has(targetId)
                              ? "Remove from my night"
                              : "Add to my night"
                          }
                          title={
                            savedIds.has(targetId)
                              ? "Remove from my night"
                              : "Add to my night"
                          }
                          data-testid="button-save-target"
                        >
                          {savedIds.has(targetId) ? (
                            <Check size={18} />
                          ) : (
                            <Plus size={18} />
                          )}
                        </button>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="panel empty-state">
                    <Star size={30} />
                    <h2>
                      {loading
                        ? "Gathering a little starlight…"
                        : "Choose an object below"}
                    </h2>
                  </section>
                )}
              </div>
              <section className="discover-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">LET CURIOSITY LEAD</span>
                    <h2>What will you find?</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {filtered.length + starHits.length} objects match your setup
                  </span>
                </div>
                <div className="discovery-toolbar">
                  <div className="search-field">
                    <Search size={16} />
                    <Input
                      placeholder="Search objects, stars, constellations…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label="Search sky objects"
                      data-testid="input-target-search"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger
                      className="category-select"
                      aria-label="Object category"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All object types</SelectItem>
                      {categories.map((c) => (
                        <SelectItem value={c} key={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    className={`filter-toggle ${visibleOnly ? "active" : ""}`}
                    onClick={() => setVisibleOnly(!visibleOnly)}
                    aria-pressed={visibleOnly}
                  >
                    <Eye size={14} />
                    Above 15°
                  </button>
                  <button
                    className={`filter-toggle ${friendlyOnly ? "active" : ""}`}
                    onClick={() => setFriendlyOnly(!friendlyOnly)}
                    aria-pressed={friendlyOnly}
                  >
                    <Binoculars size={15} />
                    Binocular picks
                  </button>
                </div>
                {!conditions.isDark && (
                  <p className="twilight-note">
                    <Sparkles size={13} />
                    {conditions.darkness} at your selected time. Faint objects
                    are easier when the Sun is below −18°.
                  </p>
                )}
                {!!starHits.length && <NavigationStarResults hits={starHits.slice(0,limit)} savedIds={savedIds} onInspect={setInspectedStar} onSave={toggleSave}/>}
                <div className="object-grid">
                  {filtered.slice(0, limit).map((o) => (
                    <TargetCard
                      key={o.target.id}
                      object={o}
                      saved={savedIds.has(o.target.id)}
                      selected={targetId === o.target.id}
                      onSelect={() => {
                        selectTarget(o.target.id);
                        requestAnimationFrame(() =>
                          featuredObjectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
                        );
                      }}
                      onSave={() => toggleSave(o.target.id)}
                      onHop={() => {
                        selectTarget(o.target.id);
                        setPage("hop",o.target.id);
                      }}
                    />
                  ))}
                </div>
                {!loading && !filtered.length && !starHits.length && (
                  <div className="panel empty-state">
                    <Search size={28} />
                    <h3>No objects in this view</h3>
                    <p>
                      Try another time, turn off “Above 15°”, or broaden your
                      search.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setCategory("all");
                        setVisibleOnly(false);
                        setFriendlyOnly(false);
                      }}
                    >
                      Browse the full catalog
                    </Button>
                  </div>
                )}
                {Math.max(filtered.length, starHits.length) > limit && (
                  <button
                    className="load-more"
                    onClick={() => setLimit(limit + 12)}
                  >
                    {starHits.length ? "Explore more matches" : "Explore more objects"}
                    <ChevronRight size={15} />
                  </button>
                )}
              </section>
            </>
          )}

          {page === "hop" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ONE LANDMARK AT A TIME</p>
                  <h1>
                    Follow the stars<span>.</span>
                  </h1>
                  <p>
                    A familiar bright star. A few small steps. A new discovery.
                  </p>
                </div>
                <button
                  className="text-action"
                  onClick={() => setPage("tonight")}
                >
                  <ArrowLeft size={14} />
                  Explore targets
                </button>
              </div>
              <div className="hop-target-bar">
                <div className="flex items-center gap-3 min-w-0">
                  <Crosshair size={22} className="text-gold shrink-0" />
                  <div>
                    <span className="eyebrow">YOUR DESTINATION</span>
                    <h2>{selected?.displayName || targetId}</h2>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="visibility-tag">
                    {selection
                      ? `${Math.round(selection.alt)}° ${compassLabel(selection.az)}`
                      : "Loading"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={bestTime}
                    disabled={findingTime || computing || !selected}
                  >
                    {findingTime ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Clock size={14} />
                    )}
                    Find an astronomical night
                  </Button>
                  <Button
                    onClick={() => compute()}
                    disabled={computing || loading || !selected}
                    data-testid="button-plan-route"
                  >
                    {computing ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : (
                      <Navigation size={15} />
                    )}
                    {computing
                      ? "Tracing a path…"
                      : !settings.instrumentSelected
                        ? "Choose your instrument"
                      : result
                        ? "Replan route"
                        : "Plan my star hop"}
                  </Button>
                </div>
              </div>
              {selection && selection.alt < 15 && (
                <div className="notice warning">
                  <AlertTriangle size={16} />
                  <span>
                    {selection.alt < 0
                      ? "This object is below the horizon."
                      : "This object is very low in the sky."}{" "}
                    Use “Find an astronomical night” or choose a different time.
                  </span>
                </div>
              )}
              {result && !result.routes.length && (
                <div className="notice warning">
                  <Compass size={16} />
                  <span>
                    {result.anchorUnavailable
                      ? "Your starting star is too low or outside the guide-star limit. Choose another reference or use Automatic."
                      : result.belowHorizon
                      ? "The target is too low for a route at this time."
                      : "No usable route found. Try a wider navigation field or a fainter guide star limit."}
                  </span>
                </div>
              )}
              {result && result.routes.length > 0 && (
                <div className="route-options" aria-label="Available routes">
                  {result.routes.map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setRouteIndex(i);
                        setStep(0);
                        setPlaying(false);
                      }}
                      className={routeIndex === i ? "selected" : ""}
                      aria-pressed={routeIndex === i}
                      data-testid={`route-select-${i}`}
                    >
                      <span>
                        {r.isExpertRoute
                          ? "Field guide route"
                          : `Via ${r.startAnchor.name}`}
                      </span>
                      <small>
                        {r.hops.length} fields · {r.score}/100
                        {!r.isExpertRoute && result.routes.filter(candidate => !candidate.isExpertRoute && candidate.startAnchor.id === r.startAnchor.id).length > 1 && <>
                          {" · Route "}{result.routes.slice(0, i + 1).filter(candidate => !candidate.isExpertRoute && candidate.startAnchor.id === r.startAnchor.id).length}
                        </>}
                      </small>
                      {routeIndex === i && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
              <div className="route-start-choice"><label>Starting star <select aria-label="Starting star" value={settings.startStarId ?? ""} onChange={event => update({ startStarId:event.target.value || undefined })}>
                <option value="">Automatic starting stars</option>
                {startOptions.map(({star,alt}) => <option key={star.id} value={star.id}>{starPlanningTarget(star).name} · mag {star.mag.toFixed(1)} · {Math.round(alt)}° high</option>)}
              </select></label><small>Choose a visible reference and replan. Your field and guide-star limit still apply.</small></div>
              <div className="hop-layout">
                <section className="panel route-chart-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">YOUR FIELD MAP</span>
                      <h2>
                        {route
                          ? `From ${route.startAnchor.name}`
                          : "Get to know the neighborhood"}
                      </h2>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {fov.toFixed(1)}°{" "}
                      {shape === "circle"
                        ? "field"
                        : `× ${fovHeight.toFixed(1)}°`}
                    </span>
                  </div>
                  <SkyChart
                    nodes={result?.nodes ?? (previewTarget?[...previewNodes.filter(n=>n.id!==previewTarget.id),previewTarget]:previewNodes)}
                    onSelect={selectTarget}
                    constellations={catalogs.constellations}
                    route={route}
                    targetNode={result?.targetNode ?? previewTarget}
                    animStep={step}
                    fieldNavigation={route ? <HopFieldNavigation route={route} step={step} observed={!!night.find(item => item.id === targetId)?.observedAt} onPrevious={() => { setStep(Math.max(0, step - 1)); setPlaying(false); }} onNext={advanceField}/> : undefined}
                    fovWidth={fov}
                    fovHeight={shape === "circle" ? fov : fovHeight}
                    fovShape={shape}
                    lat={lat}
                    lon={lon}
                    date={date}
                    limitingMag={limitingMag}
                    denseStars={catalogs.dense}
                    milkyWay={catalogs.milkyWay}
                    onFovChange={(width) => update({ fov: width, ...(shape === "circle" ? { fovHeight: width } : {}) })}
                    onLimitingMagChange={(value) => update({ limitingMag: value })}
                  />
                  <div className="chart-footnote">
                    {route
                      ? "Continuous sky · Next field moves the view · Route overview shows the journey"
                      : "Equatorial map · north up, east left"}
                    {" · "}drag to pan, pinch to zoom
                  </div>
                </section>
                <div className="hop-guide-column">
                  <section className="panel current-field" aria-live="polite">
                    <span className="eyebrow">
                      {hop && route
                        ? `FIELD ${step + 1} OF ${route.hops.length}`
                        : "BEFORE YOU BEGIN"}
                    </span>
                    <h2>
                      {hop
                        ? step === 0
                          ? "Find your starting star"
                          : step === route!.hops.length - 1
                            ? "You’ve arrived"
                            : "Make the next hop"
                        : "Start with a bright landmark"}
                    </h2>
                    <p className="current-instruction">
                      {hop?.instruction ||
                        "Plan a route to connect your target with a recognizable bright star. Then move one field at a time, matching the patterns you see."}
                    </p>
                    {hop && (
                      <>
                        <div className="hop-metrics">
                          <span>
                            <Navigation size={13} />
                            {hop.distanceDeg > 0
                              ? `Sky: ${hop.distanceDeg.toFixed(1)}° ${hop.direction}`
                              : "Starting field"}
                          </span>
                          <HopViewDirection route={route!} step={step}/>
                          <span>
                            <ArrowUpRight size={13} />
                            {Math.round(hop.center.alt)}° high
                          </span>
                          {hop.distanceDeg > 0 && (
                            <span>
                              {(hop.distanceDeg / fov).toFixed(1)} field widths
                              {hop.distanceDeg > fov ? " · no overlap" : ""}
                            </span>
                          )}
                        </div>
                        {step > 0 && <p className="hop-direction-note">Chart directions show where the next field lies in your matched view. Telescope movement can differ from image motion.</p>}
                        <div className="pattern-tip">
                          <span className="eyebrow">CONFIRM YOUR FIELD</span>
                          <p>
                            {hop.pattern === hop.instruction
                              ? "Match the stars in your field to the chart before moving on."
                              : hop.pattern}
                          </p>
                          <small>
                            {hop.patternType} pattern ·{" "}
                            {hop.patternScore >= 75
                              ? "strong landmark"
                              : hop.patternScore >= 40
                                ? "use with nearby stars"
                                : "check carefully"}
                          </small>
                        </div>
                        <div className="step-progress">
                          {route!.hops.map((_, i) => (
                            <button
                              key={i}
                              className={i <= step ? "done" : ""}
                              onClick={() => {
                                setStep(i);
                                setPlaying(false);
                              }}
                              aria-label={`Go to field ${i + 1}`}
                              aria-current={i === step ? "step" : undefined}
                            />
                          ))}
                        </div>
                        <div className="step-controls">
                          <button
                            className="icon-button"
                            disabled={step === 0}
                            aria-label="Previous field"
                            onClick={() => {
                              setStep(step - 1);
                              setPlaying(false);
                            }}
                            data-testid="button-prev-step"
                          >
                            <SkipBack size={17} />
                          </button>
                          <Button
                            className="flex-1"
                            onClick={advanceField}
                            data-testid="button-next-step"
                          >
                            {step === route!.hops.length - 1 ? (
                              <>
                                <Check size={16} />
                                {night.find((t) => t.id === targetId)
                                  ?.observedAt
                                  ? "Mark unseen"
                                  : "I found it!"}
                              </>
                            ) : (
                              <>
                                Next field
                                <ChevronRight size={16} />
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="playback-row">
                          <button
                            className="text-action"
                            onClick={() => {
                              if (!playing && step >= route!.hops.length - 1)
                                setStep(0);
                              setPlaying(!playing);
                            }}
                            data-testid="button-play-pause"
                          >
                            {playing ? <Pause size={13} /> : <Play size={13} />}
                            {playing ? "Pause preview" : "Preview route"}
                          </button>
                          <select
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value))}
                            aria-label="Route preview speed"
                          >
                            <option value={1500}>Fast</option>
                            <option value={3500}>Steady</option>
                            <option value={6000}>Slow</option>
                          </select>
                        </div>
                      </>
                    )}
                    {!hop && (
                      <div className="pattern-tip">
                        <Eye size={18} />
                        <p>
                          Match the chart to your view. A telescope diagonal can
                          mirror the field; the map controls let you flip or
                          rotate it.
                        </p>
                      </div>
                    )}
                  </section>
                  {selected && (
                    <section className="panel at-the-eyepiece">
                      <div className="section-label">
                        <Eye size={15} />
                        <h2>At the eyepiece</h2>
                      </div>
                      <p>{guideFor(selected).lookFor}</p>
                      <MoonlightCard target={selected} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} onMoon={() => setPage("moon")} />
                      <AltitudeChart
                        target={selected}
                        lat={lat}
                        lon={lon}
                        date={date}
                        timezone={timezone}
                      />
                      <button
                        className="text-action mt-4"
                        onClick={() => toggleSave(targetId)}
                      >
                        {savedIds.has(targetId) ? (
                          <Check size={14} />
                        ) : (
                          <Plus size={14} />
                        )}
                        {savedIds.has(targetId)
                          ? "Saved to my night · remove"
                          : "Add to my night"}
                      </button>
                    </section>
                  )}
                </div>
              </div>
              {route && (
                <section className="panel all-steps">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">THE WHOLE JOURNEY</span>
                      <h2>Your route at a glance</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        className="text-action"
                        onClick={exportRoute}
                        data-testid="button-download-route"
                      >
                        <Download size={14} />
                        Field notes
                      </button>
                      <button
                        className="text-action"
                        onClick={exportRouteJSON}
                        data-testid="button-download-json"
                        aria-label="Download route JSON"
                      >
                        JSON
                      </button>
                    </div>
                  </div>
                  {route.hops.map((h, i) => (
                    <button
                      key={i}
                      className={`route-step ${i === step ? "active" : ""}`}
                      onClick={() => {
                        setStep(i);
                        setPlaying(false);
                      }}
                      data-testid={`hop-step-${i}`}
                    >
                      <span className="step-number">{i + 1}</span>
                      <div>
                        <p>{h.instruction}</p>
                        <small>
                          {h.distanceDeg > 0
                            ? `${h.distanceDeg.toFixed(1)}° · `
                            : ""}
                          {h.pattern !== h.instruction
                            ? h.pattern
                            : "Confirm this field on the chart."}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {route.expertSource && (
                    <p className="route-source">
                      Field guide source: {route.expertSource}
                    </p>
                  )}
                </section>
              )}
            </>
          )}

          {page === "night" && (
            <>
              <div className="page-heading night-page-heading"><div><p className="eyebrow">YOUR NEXT NIGHT OUT</p><h1>Plan your night<span>.</span></h1><p>Choose a night. Add targets. Follow the stars.</p></div></div>
              <SessionPlanner savedLocations={savedLocations} onLocationsChange={setSavedLocations} sessions={plannerStore.sessions} active={activeSession} targets={planningTargets} date={date} lat={lat} lon={lon} timezone={timezone} items={night} skyBrightness={settings.skyBrightness} live={settings.timeMode === "live"}
                onCreate={createSession} onUpdate={updateSession} onSelect={selectSession} onPreview={(at,a,b,stay)=>previewMoment(at,a,b,!stay)} onVisit={visitScheduledTarget} onAdd={toggleSave} onObserved={markObserved}
                onNotes={(id,notes)=>setNight(current=>current.map(item=>item.id===id?{...item,notes}:item))}
                actions={<><SkySafariExport items={night} targets={planningTargets} session={activeSession} date={date} lat={lat} lon={lon} skyBrightness={settings.skyBrightness}/><Button variant="outline" onClick={exportNight} disabled={!night.length}><Download size={15}/> Export notes</Button></>}
              />
            </>
          )}
          {page === "binocular" && (
            <BinocularGuide saveDestination={activeSession?.name??`${formatInTimeZone(settings.timeMode==="live"?planningShortcut("tonight",lat,lon).date:date,timezone,"MMM d")} observing night`} targets={catalogs.targets} stars={catalogs.stars} constellations={catalogs.constellations} denseStars={catalogs.dense} milkyWay={catalogs.milkyWay} fovWidth={fov} fovHeight={shape === "circle" ? fov : fovHeight} fovShape={shape} limitingMag={limitingMag} onFovChange={(width) => update({ fov: width, ...(shape === "circle" ? { fovHeight: width } : {}) })} onLimitingMagChange={(value) => update({ limitingMag: value })} lat={lat} lon={lon} timezone={timezone} observingDate={date} onInspect={selectTarget} skyBrightness={settings.skyBrightness} savedIds={savedIds} loading={loading} onSave={toggleSave} onPlan={planBinocularHop} />
          )}
          {page === "moon" && <MoonObservatory lat={lat} lon={lon} date={date} timezone={timezone} settings={settings} update={update} target={selected} initialFeatureId={lunarSelection} onDate={at => { setPlaying(false); update({ date:formatInTimeZone(at,timezone,"yyyy-MM-dd"), time:formatInTimeZone(at,timezone,"HH:mm"), timeMode:"planned", plannedAt:at.toISOString() }); }} savedIds={savedIds} onSave={toggleSave} />}
          {page === "image" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">BRING YOUR OWN CHART</p>
                  <h1>
                    A map you know<span>.</span>
                  </h1>
                  <p>
                    Calibrate a star chart image with known stars and mark your
                    destination.
                  </p>
                </div>
                <button
                  className="text-action"
                  onClick={() => setPage("tonight")}
                >
                  <ArrowLeft size={14} />
                  Back to tonight
                </button>
              </div>
              <ImageFallback />
            </>
          )}
          <footer className="app-footer">
            <span>
              <Star size={12} />A quieter screen. A bigger sky.
            </span>
            <span>Calculated locally · BSC5 & deep sky catalogs</span>
          </footer>
        </main>
      </div>
      <Dialog open={!!inspectedStar} onOpenChange={open=>{if(!open)setInspectedStar(null);}}><DialogContent className="star-detail-dialog"><DialogHeader><DialogTitle>{inspectedStar?starPlanningTarget(inspectedStar).name:"Star"}</DialogTitle><DialogDescription>Bright Star Catalogue · {formatInTimeZone(date,timezone,"MMM d, yyyy · HH:mm")} local</DialogDescription></DialogHeader>{inspectedStar&&(()=>{const target=starPlanningTarget(inspectedStar);const pos=eqToHorizontal(target.ra,target.dec,lat,lon,date);const node:SkyNode={...inspectedStar,...pos,id:target.id,name:target.name,type:"star"};return <><p className="object-location">Magnitude {target.mag.toFixed(1)} · {Math.round(pos.alt)}° {compassLabel(pos.az)} · {altitudeLabel(pos.alt)}</p><p>{activeSession?`Add to ${activeSession.name}, or remove it from that session.`:"Add this star to an observing session, then open Planner to choose a date and sequence."}</p><Button onClick={()=>toggleSave(target.id)}>{savedIds.has(target.id)?<Check size={14}/>:<Plus size={14}/>} {savedIds.has(target.id)?"Remove from session":"Add to session"}</Button>{selected&&<Button variant="outline" disabled={computing||loading||inspectedStar.mag>Math.min(4.5,limitingMag)||pos.alt<5} onClick={()=>{const id=inspectedStar.id;update({startStarId:id});setInspectedStar(null);void compute(undefined,id);}}>Start hop from this star</Button>}{selected&&<p className="setup-hint">Destination: {selected.name}. Starting references must be above 5° and magnitude {Math.min(4.5,limitingMag).toFixed(1)} or brighter at your observing time.</p>}<SkyChart onSelect={selectTarget} nodes={[...previewNodes.filter(s=>s.id!==inspectedStar.id),node]} constellations={catalogs.constellations} route={null} targetNode={node} animStep={0} fovWidth={fov} fovHeight={shape==="circle"?fov:fovHeight} fovShape={shape} lat={lat} lon={lon} date={date} limitingMag={limitingMag} denseStars={catalogs.dense} milkyWay={catalogs.milkyWay} onFovChange={width=>update({fov:width,...(shape==="circle"?{fovHeight:width}:{})})} onLimitingMagChange={value=>update({limitingMag:value})}/><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness}/></>;})()}</DialogContent></Dialog>
      <Dialog open={instrumentOpen} onOpenChange={setInstrumentOpen}>
        <DialogContent className="instrument-choice-dialog">
          <DialogHeader><DialogTitle>Choose your instrument</DialogTitle><DialogDescription>Start with a finder field that suits your view. Adjust the field width below the chart to match your optics.</DialogDescription></DialogHeader>
          <div className="instrument-choice-options">
            <button onClick={() => compute("binocular")}><Binoculars size={25}/><span>Binoculars</span><small>7° starting field · wide views</small></button>
            <button onClick={() => compute("telescope")}><Telescope size={25}/><span>Small telescope</span><small>5° finder field · then check at low power</small></button>
          </div>
          <p>The hop opens as soon as you choose. Use your actual finder field for the route.</p>
        </DialogContent>
      </Dialog>
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="data-sources-dialog">
          <DialogHeader>
            <DialogTitle>Where the sky information comes from</DialogTitle>
            <DialogDescription>
              StarHop works offline using catalog data bundled with the app. It
              does not download a live sky feed.
            </DialogDescription>
          </DialogHeader>
          <div className="data-sources-content">
            <p><strong>Positions and observing times.</strong> Star and deep-sky coordinates come from the included Bright Star, Hipparcos, Messier, and binocular-object catalogs. The app calculates altitude, direction, and route geometry from those coordinates, your location, and the selected time.</p>
            <p><strong>Sun and Moon.</strong> The bundled Astronomy Engine computes the Sun and Moon positions, Moon phase, and illumination on your device. “Astronomical night” means the Sun is at least 18° below the horizon.</p>
            <p><strong>What the sky conditions mean.</strong> The app has no weather, cloud, seeing, local light-pollution, or horizon-obstruction feed. A dark astronomical sky label describes the Sun’s position; it does not promise dark or clear observing conditions. Object magnitudes are catalog values and do not predict visibility by themselves.</p>
            <p><strong>Finding guides and artwork.</strong> Hop descriptions are curated observing instructions; named field-guide routes show their references in the route details. Object artwork is an illustration of a visual impression, not a telescope image or measured brightness map.</p>
            <p className="data-source-links">
              References: <a href="https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50" target="_blank" rel="noreferrer">Bright Star Catalogue</a>, <a href="https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239" target="_blank" rel="noreferrer">Hipparcos Catalogue</a>, <a href="https://messier.seds.org/" target="_blank" rel="noreferrer">SEDS Messier database</a>, and <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer">Astronomy Engine</a>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={offlineOpen} onOpenChange={setOfflineOpen}>
        <DialogContent className="offline-dialog">
          <DialogHeader>
            <div className="offline-dialog-icon">
              {offline.state === "ready" ? (
                <CheckCircle2 size={28} />
              ) : (
                <WifiOff size={28} />
              )}
            </div>
            <DialogTitle>
              {offline.state === "ready"
                ? "Ready for a night off the grid."
                : "Prepare before you head out."}
            </DialogTitle>
            <DialogDescription>
              {offline.state === "ready"
                ? "The app and every sky catalog are stored on this device. Reopen this same address or install the app, even without a connection."
                : offline.state === "unavailable"
                  ? "Offline preparation is available in the production build on HTTPS or localhost. This development preview still calculates everything locally."
                  : "Keep this page open while the app stores its charts and catalogs. A connection is only needed for the first visit and updates."}
            </DialogDescription>
          </DialogHeader>
          <div className="offline-checklist">
            {[
              "Bright and dense star catalogs",
              "Deep sky objects & constellation maps",
              "Milky Way & field guide routes",
              "Your observing list & notes",
            ].map((label) => (
              <div key={label}>
                {offline.state === "ready" ||
                (label === "Your observing list & notes" && !nightError) ? (
                  <Check size={15} />
                ) : (
                  <Circle size={15} />
                )}
                {label}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Notes stay in this browser. Export them for a backup. Clearing
            browser data removes downloaded catalogs and saved notes.
          </p>
          {offline.state === "error" && (
            <Button onClick={offline.prepare}>
              <RotateCcw size={15} />
              Retry offline preparation
            </Button>
          )}
          {offline.state === "preparing" && (
            <p className="text-sm flex gap-2 items-center">
              <Loader2 size={16} className="animate-spin" />
              Downloading the offline atlas…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Condition({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="condition">
      <div className="condition-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
function TargetCard({
  object,
  saved,
  selected,
  onSelect,
  onSave,
  onHop,
}: {
  object: VisibleTarget;
  saved: boolean;
  selected: boolean;
  onSelect: () => void;
  onSave: () => void;
  onHop: () => void;
}) {
  const { target, alt, az } = object;
  return (
    <article className={`target-card ${selected ? "selected" : ""}`}>
      <button
        className="target-card-main"
        onClick={onSelect}
        aria-label={`Explore ${target.displayName}`}
        aria-pressed={selected}
        title="Select this object and show its details above"
        data-testid={`target-${target.id}`}
      >
        <div className="target-thumbnail">
          <TargetPhoto target={target} compact />
        </div>
        <div className="target-card-info">
          <span className="eyebrow">
            {target.id} · {target.categoryShort}
          </span>
          <h3>{target.name}</h3>
          <p>{getConstellationName(target.con)}</p>
          <div className={`target-alt ${alt < 15 ? "low" : ""}`}>
            <span className="status-dot" />
            {Math.round(alt)}° {compassLabel(az)}
            <span>· mag {target.mag.toFixed(1)}</span>
          </div>
        </div>
      </button>
      <div className="target-card-actions">
        <button onClick={onHop}>
          Find it
          <ArrowUpRight size={13} />
        </button>
        <button
          className={saved ? "saved" : ""}
          onClick={onSave}
          aria-label={`${saved ? "Remove" : "Save"} ${target.name}`}
          aria-pressed={saved}
        >
          {saved ? <Check size={15} /> : <Plus size={15} />}
        </button>
      </div>
    </article>
  );
}
function CoordinateInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  return (
    <div>
      <Label htmlFor={`coordinate-${label}`} className="field-label">
        {label}
      </Label>
      <Input
        id={`coordinate-${label}`}
        type="number"
        step=".01"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n=Number(e.target.value);setInvalid(e.target.value!==""&&(!Number.isFinite(n)||n<min||n>max));
        }}
        onBlur={() => {
          const n = Number(draft);
          if (!draft.trim() || !Number.isFinite(n) || n < min || n > max) {
            setInvalid(true);
            return;
          }
          onChange(n);
        }}
        aria-invalid={invalid}
        data-testid={label === "Latitude" ? "input-lat" : "input-lon"}
      />
      {invalid && (
        <p className="text-xs text-destructive mt-1">
          Not applied. Use {min} to {max}°. Current location uses {value}°.
        </p>
      )}
    </div>
  );
}
function StarHopLogo() {
  return (
    <svg
      width="39"
      height="39"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="17" stroke="#829a9e" strokeOpacity=".3" />
      <path d="M10 27L17 13L28 17L24 29" stroke="#a3c8bf" strokeWidth="1.2" />
      <circle cx="10" cy="27" r="2" fill="#a3c8bf" />
      <circle cx="17" cy="13" r="2.6" fill="#e7e5d7" />
      <circle cx="28" cy="17" r="1.8" fill="#a3c8bf" />
      <path d="M24 24V34M19 29H29" stroke="#d9bc7e" strokeWidth="1.4" />
      <circle cx="24" cy="29" r="2.5" fill="#d9bc7e" />
    </svg>
  );
}
