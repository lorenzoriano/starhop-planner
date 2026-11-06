import { chartSolarSystemPositions } from "@/lib/astronomy";
import {AltitudeStatus} from "@/components/ExplainedStatus";
import { getSiteSkyBrightness, suggestedSiteSkyBrightness } from "@/lib/site-sky-brightness";
import { AppTextSizeControl } from "@/components/AppTextSizeControl";
import { targetDesignation } from "@/lib/catalog-presentation";
import { nearestMoonFreeTargetTime } from "@/lib/upcoming-nights";
import { TargetNightSuggestions } from "@/components/TargetNightSuggestions";
import {CoordinatePairInput} from "@/components/CoordinatePairInput";
import {CatalogCombobox} from "@/components/CatalogCombobox";
import { UpcomingNights } from "@/components/UpcomingNights";
import { OfflineControls } from "@/components/OfflineControls";
import { NightVisionFilter } from "@/components/NightVisionFilter";
import { planRoutesInWorker } from "@/lib/route-client";
import { locateDevice } from "@/lib/geolocation";
import { ObservingContextProvider, ContextDateButton, ContextLocationButton } from "@/components/ObservingContext";
import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { z } from "zod";
import { AstronomicalClock } from "@/components/AstronomicalClock";
import { clockNightDate, comparisonIds, CLOCK_LIMIT } from "@/lib/astronomical-clock";
import tzLookup from "tz-lookup";
import { useLocation } from "wouter";
import { pageForPath, pathForPage, targetFromPath, hopPath, parseHopLocation, catalogPath, journeysFocusPath, journeyOverviewStopPath, pathForJourneyRoute, navigateHash, type Page } from "@/lib/navigation";
import { applySettingsPatch } from "@/lib/settings-patch";
import { appendNightItems, nightHolds } from "@/lib/night-ops";
import { displayName, objectKey, objectName, resolveObject, sameObject, startStarFor, toSessionId, LINK_LABELS, type ChainStop, type JourneyRef, type ObjectActions, type ObjectSkyContext } from "@/lib/object-links";
import { TargetCard } from "@/components/TargetCard";
import { ObjectActionRow } from "@/components/ObjectActionRow";
import { useHopChain } from "@/components/useHopChain";
import { HopChainBar } from "@/components/HopChainBar";
import { catalogSearchScore, catalogSearchDiagnostics, searchCatalog } from "@/lib/catalog-search";
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
  mergeJourneyTag,
  stripStaleJourneyTags,
  type Settings,
  type NightItem,
} from "@/lib/session";
import {
  rankTonight,
  skyConditions,
  guideFor,
  compassLabel,
  altitudeLabel,
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
  Waypoints,
  RefreshCw,
} from "lucide-react";
import {
  planRoutes,
  formatRouteNodeName,
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
import { catalogDiameter } from "@/lib/finder-detail";
import { WeatherPanel } from "@/components/WeatherPanel";
import { SelectedTargetPlanning } from "@/components/SelectedTargetPlanning";
import { AltitudeChart } from "@/components/ObservingVisuals";
import { ImageFallback } from "@/components/ImageFallback";
import { BinocularGuide } from "@/components/BinocularGuide";
// Sky Journeys is the app's first split chunk (doc 01 §9); it is still precached by the build manifest.
const JourneysPage = lazy(() => import("@/components/journeys/JourneysPage"));
// Planner-only, and it pulls in the journey store schema (lib/journeys/progress → kb-schema): its own chunk, so the
// store and the KB schema stay out of the main bundle (useHopChain / HopChainBar / seeChainStop import the store lazily).
// (After the react import: Vite's dev transform turns the CJS import into a const, so `lazy` is not hoisted.)
const BackupControls = lazy(() => import("@/components/BackupControls").then((m) => ({ default: m.BackupControls })));
import { TonightJourneyTeaser, ObjectJourneyLinks } from "@/components/journeys/lazy-entry";
import { MoonObservatory, MoonlightCard, LunarNightItem } from "@/components/MoonObservatory";
import { SavedLocations } from "@/components/SavedLocations";
import { savedLocationsSchema, matchingLocation, knownLocationName, type SavedLocation } from "@/lib/saved-locations";
import { SessionPlanner } from "@/components/SessionPlanner";
import { PlanImportGate, SendPlanToPhone } from "@/components/plan-share-entry";
import { usePendingImport } from "@/lib/import-arrival";
import type { BackupData } from "@/lib/backup";
import { CatalogExplorer, openOwnChart } from "@/components/CatalogExplorer";
import { BinocularAssessment, BinocularProfileControls, BinocularProfileSummary, profileFromSettings } from "@/components/BinocularAssessment";
import { moonState } from "@/lib/moon";
import { MIN_ALT } from "@/lib/sky-feasibility";
import { objectSummary, objectSummaryText } from "@/lib/object-info";
import { chainCheckpoint, hopCountLabel, pickRoute, routeHops, routeOptionLabels, stopAtStep } from "@/lib/hop-chain";
import { plannerObservedIds, setSharedSkyInputs } from "@/lib/journeys/request-inputs";
import { binocularAssessment } from "@/lib/binocular-assessment";
import { TargetPhoto, TargetPhotoCredit } from "@/components/TargetPhoto";
import { emptyPlanner, plannerJourneyKeys, plannerStoreSchema, makeSession, planningShortcut, sessionTimezone, starPlanningTarget, stripStalePlannerJourneyTags, type PlannerStore, type ObservingSession } from "@/lib/session-planner";
import { lunarFeatures } from "@/lib/moon";

type Catalogs = {
  stars: CatalogStar[];
  targets: UnifiedTarget[];
  constellations: ConstellationLine[];
  dense: DenseStar[];
  milkyWay: MilkyWayFeature[];
};
/** Star hop lists first the route a chain would use (pickRoute: no detours beyond the leg bound), then the rest by score. */
function directFirst<T extends { routes: Route[] }>(result: T, fov: number): T {
  if (result.routes.length < 2 || result.routes.some((r) => !r.hops.length)) return result;
  const best = pickRoute(result.routes, fov);
  return best === result.routes[0] ? result : { ...result, routes: [best, ...result.routes.filter((r) => r !== best)] };
}
/**
 * Ids of a night's items that answer has() for any id form of the same object (lib/object-links sameObject):
 * STAR-Betelgeuse, HR2061 and star:HR2061 are one item. Tabs keep calling savedIds.has(id) with their own id form.
 */
class NightIdSet extends Set<string> {
  private readonly canonical: Set<string>;
  constructor(ids: Iterable<string>) { super(ids); this.canonical = new Set(Array.from(this, (id) => objectKey(id))); }
  override has(id: string) { return this.canonical.has(objectKey(id)); }
}
const PAGE_LABELS: Record<Page,string> = { tonight:"Tonight", journeys:"Journeys", night:"Planner", clock:"Clock", catalog:"Catalog", binocular:"Binoculars", moon:"Moon", hop:"Star hop", image:"chart" };
const EMPTY_CATALOGS: Catalogs = {
  stars: [],
  targets: [],
  constellations: [],
  dense: [],
  milkyWay: [],
};

export default function PlannerPage() {
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
  const [compareIds,setCompareIds,compareError]=useLocalState<string[]>("starhop-clock-objects-v1",settings.targetId?[settings.targetId]:[],z.unknown().transform(comparisonIds));
  const [savedLocations,setSavedLocations,locationsError] = useLocalState<SavedLocation[]>("starhop-saved-locations-v1",[],savedLocationsSchema);
  const activeSession = plannerStore.sessions.find(s=>s.id===plannerStore.activeId&&!s.archived);
  /** A "Send to phone" link is waiting (lib/import-arrival.ts): the import preview shows over the Planner. */
  const pendingImport=usePendingImport();
  const [lastObservationUndo,setLastObservationUndo]=useState<{sessionId:string|null;targetId:string;previousItem?:NightItem;loggedAt:string}|null>(null);
  const night=activeSession?.items??legacyNight;
  function setNight(next:NightItem[]|((previous:NightItem[])=>NightItem[])) {
    if(activeSession) setPlannerStore(current=>({...current,sessions:current.sessions.map(s=>s.id===activeSession.id?{...s,items:typeof next==="function"?next(s.items):next}:s)}));
    else setLegacyNight(next);
  }
  const [inspectedSolar,setInspectedSolar]=useState<SkyNode|null>(null);
  const [inspectedStar,setInspectedStar] = useState<CatalogStar|null>(null);
  /** "Moon effect" for a plain BSC star (not a unified target): the Moon tab shows that star instead of the stale selection. */
  const [moonStar,setMoonStar] = useState<UnifiedTarget|null>(null);
  useEffect(()=>setMoonStar(null),[settings.targetId]);
  const update = (patch: Partial<Settings>) => setSettings((prev) => applySettingsPatch(prev, patch));
  const [location,navigate]=useLocation();
  const page=pageForPath(location)??"tonight";
  function setPage(next:Page,target?:string){navigate(pathForPage(next,target));}
  // The page we came from (image page "Back to …" only when it was opened from another tab).
  const pageTrail=useRef<{current:Page;previous:Page|null}>({current:page,previous:null});
  if(pageTrail.current.current!==page)pageTrail.current={current:page,previous:pageTrail.current.current};
  useEffect(()=>{if(!pageForPath(location))navigate("/",{replace:true});},[location,navigate]);
  // On the Planner, journey tags whose key no longer resolves against the journeys KB (a KB rebuild removed the journey's
  // theme or objects) are dropped; the items stay planned. The check loads the KB lazily and never runs on the demo KB.
  const journeyTagKeys=[...plannerJourneyKeys(plannerStore),...legacyNight.flatMap(i=>i.journeyKey?[i.journeyKey]:[])].join("\n");
  useEffect(()=>{
    if(page!=="night"||!journeyTagKeys)return;
    let cancelled=false;
    void import("@/components/journeys/journey-engine").then(m=>m.realJourneyKeyResolver()).then(resolves=>{
      if(cancelled||!resolves)return;
      setPlannerStore(current=>stripStalePlannerJourneyTags(current,resolves));
      setLegacyNight(current=>stripStaleJourneyTags(current,resolves));
    },()=>{});
    return ()=>{cancelled=true;};
  },[page,journeyTagKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{window.scrollTo({top:0,behavior:"instant"});setInspectedStar(null);requestAnimationFrame(()=>document.querySelector('.main-nav [aria-current="page"]')?.scrollIntoView({block:"nearest",inline:"nearest"}));},[page]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [siteChange,setSiteChange]=useState<{lat:number;lon:number;name:string}|null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS);
  const [catalogError, setCatalogError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [startQuery,setStartQuery]=useState("");
  const [category, setCategory] = useState("all");
  const [visibleOnly, setVisibleOnly] = useState(true);
  const [friendlyOnly, setFriendlyOnly] = useState(false);
  const [limit, setLimit] = useState(8);
  const [offlineOpen, setOfflineOpen] = useState(false);
  useEffect(()=>{setSetupOpen(false);setInstrumentOpen(false);setSourcesOpen(false);setOfflineOpen(false);setSiteChange(null);},[location]);
  useEffect(()=>{try{const size=localStorage.getItem("starhop-text-size");document.documentElement.dataset.textSize=size==="small"||size==="large"?size:"medium";}catch{}},[]);
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
  const offline = useOffline({ busy: playing });
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
  const previousSite=useRef(`${lat},${lon}`);
  useEffect(()=>{const key=`${lat},${lon}`;if(previousSite.current===key)return;previousSite.current=key;update({skyBrightness:getSiteSkyBrightness(lat,lon)??suggestedSiteSkyBrightness(lat,lon)});},[lat,lon]);
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
      waypointIds:settings.waypointIds,
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
      settings.waypointIds,
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
  // Chained hop (journey / night / list): its combined route takes precedence; single-target replanning and
  // hop-progress persistence stay off while a chain is active.
  const hopChain = useHopChain({ params, catalog: catalogs, sessions: plannerStore.sessions, location, navigate, live: settings.timeMode === "live" });
  const chainActive = !!hopChain.source;
  /** A single hop opened from a journey stop (`?journey=KEY&stop=N`): the bar shows "Back to journey" and the next stop. */
  const hopJourneyRef = useMemo<JourneyRef | null>(() => { const here = parseHopLocation(location); return here?.journey?.stop && !here.chain ? { key: here.journey.key, stop: here.journey.stop, ...(here.journey.from ? { from: here.journey.from } : {}) } : null; }, [location]);
  const chainRoute = hopChain.chain?.route ?? null;
  const route: Route | null = chainRoute ?? result?.routes[routeIndex] ?? null;
  /** The chain stop whose leg holds the current field (Star hop "At the eyepiece" describes it). */
  const chainStopNow = hopChain.chain ? hopChain.chain.stops[Math.max(0, stopAtStep(hopChain.chain, step))] ?? null : null;
  const hop = route?.hops[step] ?? null;
  const selected = catalogs.targets.find((t) => t.id === targetId);
  /** A plain BSC star as Star hop destination (journey stops such as HR stars; planRoutes accepts HR<n>). */
  const hopStar = /^HR\d+$/.test(targetId) ? catalogs.stars.find((s) => s.id === targetId) : undefined;
  /** What Star hop is about right now: the chain stop whose leg holds the current field, else the destination (a plain BSC star too). */
  const eyepieceTarget = useMemo(() => {
    if (!chainStopNow) return selected ?? (hopStar ? starPlanningTarget(hopStar) : undefined);
    const r = resolveObject(chainStopNow.id, catalogs);
    if (r?.unifiedId) return catalogs.targets.find((t) => t.id === r.unifiedId);
    const star = r?.hr ? catalogs.stars.find((s) => s.hr === r.hr) : undefined;
    return star ? starPlanningTarget(star) : undefined;
  }, [chainStopNow, selected, hopStar, catalogs]);
  const eyepieceHz = eyepieceTarget ? eqToHorizontal(eyepieceTarget.ra, eyepieceTarget.dec, lat, lon, date) : null;
  const eyepieceAlt = eyepieceHz?.alt ?? 0;
  const eyepieceSaveId = eyepieceTarget ? toSessionId(eyepieceTarget.id) : targetId;
  /**
   * The journey stop Star hop is at: the current stop of a whole-journey chain, or a single hop opened from a journey
   * stop (`?journey=KEY&stop=N`) while its destination is still the one shown. Null outside a journey.
   */
  const hopStopRef = useMemo<{ key: string; stop: number } | null>(() => {
    if (chainStopNow) return hopChain.source?.kind === "journey" && chainStopNow.stop ? { key: hopChain.source.key, stop: chainStopNow.stop } : null;
    return hopJourneyRef && eyepieceTarget && sameObject(parseHopLocation(location)?.targetId ?? "", eyepieceTarget.id) ? { key: hopJourneyRef.key, stop: hopJourneyRef.stop } : null;
  }, [chainStopNow, hopChain.source, hopJourneyRef, eyepieceTarget, location]);
  /** That stop's own planned time (the journey's windowStart, from the device journey store, loaded lazily). */
  const [hopStopTime, setHopStopTime] = useState<{ key: string; stop: number; at?: Date } | null>(null);
  useEffect(() => {
    if (!hopStopRef) return;
    let live = true;
    void import("@/lib/journeys/progress").then(m => { if (live) setHopStopTime({ ...hopStopRef, at: m.storedStopTime(m.readJourneyStore(), hopStopRef) }); }, () => {});
    return () => { live = false; };
  }, [hopStopRef?.key, hopStopRef?.stop]); // eslint-disable-line react-hooks/exhaustive-deps
  const hopStopAt = hopStopRef && hopStopTime?.key === hopStopRef.key && hopStopTime.stop === hopStopRef.stop ? hopStopTime.at : undefined;
  const binocularProfile = useMemo(()=>profileFromSettings(settings),[settings.binocularMagnification,settings.binocularAperture,settings.binocularFov,settings.binocularStabilized,settings.binocularTransmission]);
  const currentMoon = useMemo(()=>moonState(lat,lon,date),[lat,lon,date]);
  // Tonight's Best on the shared sky model (altitude, Moon verdict, twilight, binocular rating); journeys borrow its top 8.
  const ranked = useMemo(
    () => rankTonight(catalogs.targets, lat, lon, date, mode, { skyBrightness: settings.skyBrightness, profile: binocularProfile, moon: currentMoon }),
    [catalogs.targets, lat, lon, date, mode, settings.skyBrightness, binocularProfile, currentMoon],
  );
  const tonightTopIds = useMemo(()=>ranked.slice(0,8).map(t=>t.target.id),[ranked]);
  const plannerObserved = useMemo(()=>plannerObservedIds(plannerStore.sessions),[plannerStore.sessions]);
  // One journeys request app-wide: Discovery, the teaser and every chip read these during their render (after ours).
  if(!loading)setSharedSkyInputs({observedIds:plannerObserved,boostIds:tonightTopIds});
  const planningTargets = useMemo(()=>[...catalogs.targets,...catalogs.stars.map(starPlanningTarget)],[catalogs.targets,catalogs.stars]);
  useEffect(()=>{
    if(loading)return;
    setCompareIds(current=>{const valid=current.filter(id=>planningTargets.some(target=>target.id===id));return valid.length===current.length?current:valid;});
  },[loading,planningTargets]);
  const selection = ranked.find((t) => t.target.id === targetId);
  const selectedStart = catalogs.stars.find(star => star.id === settings.startStarId);
  const startOptions = useMemo(() => {
    if (!selected) return [];
    const nearby = catalogs.stars.filter(star => star.mag <= Math.min(4.5,limitingMag) && !!(star.name || star.bayer || star.flamsteed))
      .map(star => ({ star, ...eqToHorizontal(star.ra,star.dec,lat,lon,date), distance:angularDistance(star.ra,star.dec,selected.ra,selected.dec) }))
      .filter(star => star.alt >= MIN_ALT.possible).sort((a,b) => a.distance-b.distance || a.star.mag-b.star.mag).slice(0,80);
    if (selectedStart && !nearby.some(option => option.star.id === selectedStart.id)) nearby.unshift({ star:selectedStart, ...eqToHorizontal(selectedStart.ra,selectedStart.dec,lat,lon,date), distance:angularDistance(selectedStart.ra,selectedStart.dec,selected.ra,selected.dec) });
    return nearby.filter(option=>!nearby.some(other=>other.star.id!==option.star.id&&other.star.mag<option.star.mag&&angularDistance(option.star.ra,option.star.dec,other.star.ra,other.star.dec)<.05));
  }, [selected, catalogs.stars, selectedStart, limitingMag, lat, lon, date]);
  const conditions = useMemo(
    () => skyConditions(lat, lon, date),
    [lat, lon, date],
  );
  const viewedSession=plannerStore.sessions.find(session=>!session.archived&&Math.abs(session.lat-lat)<.001&&Math.abs(session.lon-lon)<.001&&clockNightDate(new Date(session.startAt),timezone)===clockNightDate(date,timezone));
  const observationSession=page==="night"?activeSession:viewedSession;
  const observationNight=observationSession?.items??(page==="night"?legacyNight:[]);
  const saveDestination=viewedSession?.name??`${formatInTimeZone(new Date(`${clockNightDate(date,timezone)}T12:00:00Z`),"UTC","MMM d")} observing night (new)`;
  // The night "Add to tonight's plan" would use (nightSessionFor), matched in any id form.
  const savedIds = new NightIdSet((page==="night"?night:nightSessionFor(date)?.items??[]).map((t) => t.id));
  const observed = night.filter((t) => t.observedAt).length;
  const categories = useMemo(
    () =>
      Array.from(new Set(catalogs.targets.map((t) => t.categoryShort))).sort(),
    [catalogs.targets],
  );
  const queryMatches=useMemo(()=>query.trim()?new Set(searchCatalog(planningTargets,query).map(match=>match.target.id)):null,[planningTargets,query]);
  const filtered = useMemo(
    () =>
      ranked.filter(
        (o) =>
          (!visibleOnly || o.alt >= MIN_ALT.possible) &&
          (!friendlyOnly || guideFor(o.target).binocular) &&
          (category === "all" || o.target.categoryShort === category) &&
          (!queryMatches||queryMatches.has(o.target.id)),
      ).sort((a,b)=>catalogSearchScore(a.target,query,getConstellationName(a.target.con))-catalogSearchScore(b.target,query,getConstellationName(b.target.con))),
    [ranked, visibleOnly, friendlyOnly, category, query,queryMatches],
  );
  const starSearchTargets = useMemo(() => {const indexed=new Map(planningTargets.map(target=>[target.id,target]));return catalogs.stars.map(star=>({star,target:indexed.get(`star:${star.id}`)!}));}, [catalogs.stars,planningTargets]);
  const starHits = useMemo<NavigationStarHit[]>(() => {
    if (!query.trim() || (category !== "all" && category !== "Star")) return [];
    return starSearchTargets.flatMap(({star,target}) => {
      const score = catalogSearchScore(target, query, getConstellationName(target.con));
      if (!Number.isFinite(score) || (queryMatches&&!queryMatches.has(target.id)) || (friendlyOnly && star.mag > 6.5)) return [];
      const pos = eqToHorizontal(star.ra, star.dec, lat, lon, date);
      if (visibleOnly && pos.alt < MIN_ALT.possible) return [];
      if (filtered.some(object => /star/i.test(object.target.category) && angularDistance(star.ra, star.dec, object.target.ra, object.target.dec) < .02)) return [];
      return [{ star, name:target.name, ...pos, score }];
    }).sort((a,b) => a.score-b.score || a.star.mag-b.star.mag || b.alt-a.alt);
  }, [starSearchTargets, query, category, friendlyOnly, visibleOnly, lat, lon, date, filtered,queryMatches]);
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
    // A chain's final stop can be a KB-only object (RW Cephei): the chain URL stays, the chain resolves it.
    if(linked){if(catalogs.targets.some(t=>t.id===linked)||/^HR\d+$/.test(linked)&&catalogs.stars.some(s=>s.id===linked)){if(targetId!==linked)update({targetId:linked,startStarId:undefined});}else if(!parseHopLocation(location)?.chain)navigate("/hop",{replace:true});return;}

  },[catalogs.targets.length,location]);
  const overviewNodes = useMemo<SkyNode[]>(() => {
    const objects = ranked.filter((o) => o.alt > 0);
    const markers = objects.map((o): SkyNode => ({ ...o.target, alt: o.alt, az: o.az, type: o.target.source === "messier" ? "messier" : "binocular", constellation: o.target.con }));
    if (previewTarget && previewTarget.alt > 0 && !markers.some((o) => o.id === previewTarget.id)) markers.push(previewTarget);
    return [...previewNodes, ...markers,...chartSolarSystemPositions(lat,lon,date)];
  }, [previewNodes, ranked, targetId,lat,lon,date]);

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",settings.redLight?"#160000":"#08131b");
  }, [settings.redLight]);
  useEffect(() => {
    setPlaying(false);
    setStep(0);
    setRouteIndex(0);
  }, [paramsKey]);
  useEffect(() => {
    if (loading || catalogError || page !== "hop" || restoreAttempted.current || computing || routeResult || chainActive || parseHopLocation(location)?.chain) return;
    const linked = targetFromPath(location);
    if (linked && linked !== targetId) return;
    restoreAttempted.current = true;
    if (!savedHop || savedHop.configKey !== paramsKey) return;
    const key = paramsKey;
    setComputing(true);
    void planRoutesInWorker(params).then(planned => {
      if (keyRef.current !== key) return;
      const computed = directFirst(planned, params.fovWidth);
      const index = matchingRouteIndex(computed.routes, savedHop);
      setRouteResult({ key, result: computed });
      setRouteIndex(index < 0 ? 0 : index);
      setStep(index < 0 ? 0 : savedHop.step);
      toast({ title: index < 0 ? "The sky or route has changed" : "Hop resumed",
        description: index < 0 ? "Plan checked for your current sky. Begin at the first field if a route is available." : `Restored field ${savedHop.step + 1}. Positions are recalculated for your observing time.` });
    }).catch(error=>{if(error instanceof DOMException&&error.name==="AbortError")return;toast({ title: "Could not restore this hop", description: "Try planning the route again.", variant: "destructive" });})
      .finally(() => {if(keyRef.current===key)setComputing(false);});
  }, [loading, catalogError, page, location, targetId, paramsKey, computing, routeResult, chainActive]);
  useEffect(() => {
    if (!route || computing || chainActive) return;
    const stored = writeHopProgress({ configKey: paramsKey, algorithm, fingerprint: routeFingerprint(route), step, savedAt: Date.now(), live: settings.timeMode === "live" });
    if (!stored && !storageWarning.current) {
      storageWarning.current = true;
      toast({ title: "Hop progress could not be saved", description: "Keep this page open, or allow site storage to resume after a reload." });
    }
  }, [route, step, paramsKey, algorithm, computing, chainActive]);
  // A replanned chain can be shorter: keep the field index inside the route.
  useEffect(() => { if (route && step > route.hops.length - 1) setStep(Math.max(0, route.hops.length - 1)); }, [route, step]);
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

  /** The Star hop location for `id` that keeps the journey context of the current hop (`?journey=&stop=&from=`): replanning or re-selecting the same destination must not lose "Back to journey". */
  function hopLocationKeeping(id:string):string|null{
    const here=parseHopLocation(location);
    return here?.journey&&!here.chain&&sameObject(here.targetId,id)?hopPath(id,{journey:here.journey}):null;
  }
  function selectTarget(id: string) {
    const solar=overviewNodes.find(node=>node.id===id&&node.type==="planet");if(solar){setInspectedSolar(solar);return;}
    if(id.startsWith("star:")){setInspectedStar(catalogs.stars.find(s=>`star:${s.id}`===id)??null);return;}
    const star=catalogs.stars.find(s=>s.id===id);
    if(star&&!catalogs.targets.some(t=>t.id===id)){setInspectedStar(star);return;}
    update({ targetId: id, ...(id !== targetId ? { startStarId:undefined,waypointIds:[] } : {}) });
    if(page==="hop"){const keep=hopLocationKeeping(id);if(keep)navigateHash(keep,{replace:true});else navigate(pathForPage("hop",id),{replace:true});}
    if(page==="tonight"&&window.matchMedia("(max-width:760px)").matches)requestAnimationFrame(()=>featuredObjectRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  function checkAgainstMoon(id:string,at?:Date) {
    setPlaying(false);setMoonStar(null);
    update({targetId:id,...(id!==targetId?{startStarId:undefined,waypointIds:[]}:{})});
    if(at)previewMoment(at,lat,lon,false);
    setPage("moon");
  }
  function compareObjects(ids:string[],at?:Date,latitude=lat,longitude=lon) {
    const valid=ids.filter(id=>planningTargets.some(t=>t.id===id));
    setCompareIds(comparisonIds(valid));
    if(new Set(valid).size>CLOCK_LIMIT)toast({title:"Showing the first eight objects",description:"Remove an object in the clock to add another."});
    if(at)previewMoment(at,latitude,longitude,false);
    setInspectedStar(null);setPlaying(false);setPage("clock");
  }
  function previewMoment(at:Date,latitude:number,longitude:number,navigate=true) {
    const zone=sessionTimezone({lat:latitude,lon:longitude});
    update({lat:latitude,lon:longitude,date:formatInTimeZone(at,zone,"yyyy-MM-dd"),time:formatInTimeZone(at,zone,"HH:mm"),timeMode:"planned",plannedAt:at.toISOString()});
    if(navigate)setPage("tonight");
  }
  function requestSiteChange(latitude:number,longitude:number,name="") {
    const siteName=name||knownLocationName(savedLocations,latitude,longitude)||`${Math.abs(latitude).toFixed(2)}°${latitude>=0?"N":"S"} · ${Math.abs(longitude).toFixed(2)}°${longitude>=0?"E":"W"}`;
    if(activeSession&&(Math.abs(activeSession.lat-latitude)>.0001||Math.abs(activeSession.lon-longitude)>.0001)){
      setSiteChange({lat:latitude,lon:longitude,name:siteName});return;
    }
    update({lat:latitude,lon:longitude,plannedAt:undefined});
  }
  function finishSiteChange(moveNight:boolean) {
    if(!siteChange)return;
    const {lat:nextLat,lon:nextLon,name}=siteChange;
    if(moveNight&&activeSession){
      const oldZone=sessionTimezone(activeSession),nextZone=tzLookup(nextLat,nextLon),localDate=formatInTimeZone(new Date(activeSession.startAt),oldZone,"yyyy-MM-dd"),localTime=formatInTimeZone(new Date(activeSession.startAt),oldZone,"HH:mm"),nextStart=resolvePlannedMoment(localDate,localTime,nextZone);
      const moved={...activeSession,lat:nextLat,lon:nextLon,locationName:name,startAt:nextStart.toISOString()};
      setPlannerStore(current=>({...current,sessions:current.sessions.map(session=>session.id===moved.id?moved:session)}));
      update({lat:nextLat,lon:nextLon,date:localDate,time:localTime,timeMode:"planned",plannedAt:nextStart.toISOString()});
      toast({title:`Moved ${activeSession.name} to ${name}`,description:"Its target list, notes, and observations stay with the night."});
    }else{
      update({lat:nextLat,lon:nextLon,plannedAt:undefined});
      if(activeSession)toast({title:`Browsing at ${name}`,description:`${activeSession.name} stays at its saved site. Saves at this site will use a separate night.`});
    }
    setSiteChange(null);
  }
  /** Backup restore and "Send to phone" imports (lib/backup.ts, lib/plan-share.ts) replace the stored data with the merged result. */
  function applyImportedData(next:BackupData) {
    setSettings(next.settings);setPlannerStore(next.planner);setSavedLocations(next.savedLocations);setLegacyNight(next.unscheduled??[]);
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
  function saveNewSession(items: NightItem[], title: string, preferredAt?:Date): ObservingSession {
    const at = preferredAt ?? (settings.timeMode === "live" ? planningShortcut("tonight", lat, lon).date : date);
    const observingDate=clockNightDate(at,timezone),noon=resolveLocalMoment(observingDate,"12:00",timezone)??at;
    const s = makeSession(`${formatInTimeZone(noon, timezone, "MMM d")} observing night`, at, lat, lon, items, knownLocationName(savedLocations,lat,lon)??"");
    setPlannerStore(current => ({ ...current, sessions: [...current.sessions, s], activeId: s.id }));
    // Sky Journeys field mode confirms "Seen · saved to tonight's log" in place (design review r4: a toast there
    // covered the field-mode header and repeated the inline line), so the journeys page shows no toast.
    if(page!=="journeys")toast({ title: title === "Observation saved" ? `Observation saved to ${s.name}` : title, description: `${s.name}. Open Planner to edit its date, site and viewing sequence.` });
    return s;
  }
  /** The saved night an object added at `at` goes to: the active night when it is that night at this site, else any matching night. */
  function nightSessionFor(at:Date) {
    const matches=(session:ObservingSession)=>!session.archived&&Math.abs(session.lat-lat)<.001&&Math.abs(session.lon-lon)<.001&&clockNightDate(new Date(session.startAt),timezone)===clockNightDate(at,timezone);
    return activeSession&&matches(activeSession)?activeSession:plannerStore.sessions.find(matches);
  }
  /** "Add to tonight's plan" for one or many objects: add-only, in order, deduplicated (any id form), at most one new night. */
  function addManyToNight(ids:string[],preferredAt?:Date,meta:{journeyKey?:string;journeyStops?:number[];plannedAts?:(Date|undefined)[]}={}) {
    const at=preferredAt??date,addedAt=new Date().toISOString(),destination=nightSessionFor(at);
    const nameOf=(id:string)=>{const r=resolveObject(id,catalogs);return r?.unifiedId?displayName(catalogs.targets.find(t=>t.id===r.unifiedId)!):r?.name??id;};
    if(destination){
      const {added,updated}=appendNightItems(destination.items,ids,{at:addedAt,...meta});
      setPlannerStore(current=>({...current,activeId:destination.id,sessions:current.sessions.map(session=>session.id===destination.id?{...session,items:appendNightItems(session.items,ids,{at:addedAt,...meta}).items}:session)}));
      // Stops already in the night but untagged or untimed take the journey's stop and time (night-ops mergeJourneyTag).
      const what=(list:string[],one:string)=>list.length===1?nameOf(list[0]):`${list.length} ${one}`;
      toast({title:added.length?`Added ${what(added,"objects")} to ${destination.name}`:updated.length?`Updated ${what(updated,"stops")} in ${destination.name}`:`Already in ${destination.name}`,
        ...(added.length&&updated.length?{description:`${what(updated,"stops")} already there now ${updated.length===1?"has its":"have their"} journey time.`}:{})});
      return;
    }
    const {items}=appendNightItems([],ids,{at:addedAt,...meta});
    if(items.length)saveNewSession(items,`Added ${items.length===1?nameOf(items[0].id):`${items.length} objects`} to a new night`,at);
  }
  function toggleSave(id: string, preferredAt?:Date) {
    const at=preferredAt??date;
    const destination=nightSessionFor(at);
    // Any id form of the same object is one item (STAR-Betelgeuse = star:HR2061); new items store the session id.
    const itemId=toSessionId(id);
    if(destination){
      const removing=destination.items.some(item=>sameObject(item.id,id));
      setPlannerStore(current=>({...current,activeId:destination.id,sessions:current.sessions.map(session=>session.id===destination.id?{...session,items:removing?session.items.filter(item=>!sameObject(item.id,id)):[...session.items,{id:itemId,addedAt:new Date().toISOString(),notes:""}]}:session)}));
      toast({title:`${removing?"Removed from":"Added to"} ${destination.name}`});
    }else saveNewSession([{id:itemId,addedAt:new Date().toISOString(),notes:""}],"Added to night",at);
  }
  /**
   * Star hop's "Add to tonight's plan" toggle. At a journey stop (a single hop from the stop, or a chain stop) the add
   * goes through objectActions.addToNight with the journey, the stop number and the stop's planned time, so the item
   * joins the journey's block in the Planner; a stop already there with its tag and time is removed as usual.
   */
  function toggleHopSave(stopRef:{key:string;stop:number}|null,stopAt?:Date) {
    if(!stopRef||objectActions.isInNight(eyepieceSaveId,{journeyKey:stopRef.key,journeyStop:stopRef.stop,plannedAt:stopAt})){toggleSave(eyepieceSaveId);return;}
    objectActions.addToNight([eyepieceSaveId],{at:date,journeyKey:stopRef.key,journeyStops:[stopRef.stop],plannedAts:[stopAt]});
  }
  /**
   * "I see it": log on the viewed night; `journey` tags the item with the journey stop (Planner "Journey · stop n" badge)
   * and the stop's planned time, by the same rule as "Add to tonight's plan" (session.ts mergeJourneyTag).
   */
  function markObserved(id: string, journey?:{journeyKey:string;journeyStop?:number;plannedAt?:Date}) {
    const at=new Date().toISOString(),plannedIso=journey?.plannedAt&&Number.isFinite(journey.plannedAt.getTime())?journey.plannedAt.toISOString():undefined;
    const tag=(item:NightItem)=>journey?mergeJourneyTag(item,{journeyKey:journey.journeyKey,...(journey.journeyStop?{journeyStop:journey.journeyStop}:{}),...(plannedIso?{plannedAt:plannedIso}:{})}):item;
    const instrument=mode==="binocular"?`${settings.binocularMagnification}×${settings.binocularAperture}`:`Telescope · ${fov}° field`;
    // Matched in any id form (an item saved as STAR-Betelgeuse is the one "I see" logs for HR2061); a new item stores the session id.
    const existing=observationNight.find(item=>sameObject(item.id,id));
    const previousItem=existing?{...existing}:undefined;
    const updateItems=(items:NightItem[])=>items.some(item=>sameObject(item.id,id))
      ?items.map(item=>sameObject(item.id,id)?tag({...item,observedAt:at,observations:[...(item.observations??(item.observedAt?[{at:item.observedAt,notes:item.notes}]:[])),{at,notes:item.notes,instrument}]}):item)
      :[...items,tag({id:toSessionId(id),addedAt:at,observedAt:at,observations:[{at,notes:"",instrument}],notes:""})];
    // Log on the night the user is viewing; the Night planner logs against its selected active night.
    if(observationSession){
      setPlannerStore(current=>({...current,sessions:current.sessions.map(session=>session.id===observationSession.id?{...session,items:updateItems(session.items)}:session)}));
      setLastObservationUndo({sessionId:observationSession.id,targetId:id,previousItem,loggedAt:at});
      return;
    }
    // A first hop has no saved destination. Make the new night explicit in the toast.
    if(page==="hop"||page==="journeys"){
      const created=saveNewSession(updateItems([]),"Observation saved",date);
      setLastObservationUndo({sessionId:created.id,targetId:id,loggedAt:at});
      return;
    }
    setLegacyNight(updateItems);
    setLastObservationUndo({sessionId:null,targetId:id,previousItem,loggedAt:at});
  }
  function undoLastObservation(){
    if(!lastObservationUndo)return;
    const {sessionId,targetId,previousItem,loggedAt}=lastObservationUndo;
    const restore=(items:NightItem[])=>items.flatMap(item=>{
      if(!sameObject(item.id,targetId))return [item];
      const observations=[...(item.observations??[])];
      const loggedIndex=observations.map(observation=>observation.at).lastIndexOf(loggedAt);if(loggedIndex>=0)observations.splice(loggedIndex,1);
      if(!previousItem&&item.addedAt===loggedAt&&!item.notes&&!observations.length)return [];
      return [{...item,observations,observedAt:item.observedAt===loggedAt?(observations.at(-1)?.at??previousItem?.observedAt):item.observedAt}];
    });
    if(sessionId)setPlannerStore(current=>({...current,sessions:current.sessions.map(session=>session.id===sessionId?{...session,items:restore(session.items)}:session)}));
    else setLegacyNight(restore);
    setLastObservationUndo(null);
  }
  /** The object Star hop is about (chain stop or destination) is already logged on the viewed night (any id form). */
  const hereObserved=!!observationNight.find(item=>sameObject(item.id,eyepieceTarget?.id??targetId))?.observedAt;
  const nextUnobservedTarget=observationNight.find(item=>!sameObject(item.id,eyepieceTarget?.id??targetId)&&!item.observedAt&&planningTargets.some(target=>target.id===item.id));
  function goToNextUnobservedTarget(){
    if(!nextUnobservedTarget)return;
    setPlaying(false);setStep(0);setRouteResult(null);
    selectTarget(nextUnobservedTarget.id);
    if(nextUnobservedTarget.id.startsWith("star:"))setPage("tonight");else setPage("hop",nextUnobservedTarget.id);
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
  async function locate() {
    setLocating(true);
    const result = await locateDevice();
    setLocating(false);
    if (result.ok) requestSiteChange(result.position.lat, result.position.lon, "Current location");
    else toast({ title: "Could not get your location", description: result.message, variant: "destructive" });
  }
  function selectInstrument(selectedMode: Settings["mode"]) {
    const patch = { mode: selectedMode, instrumentSelected: true, fov: selectedMode === "binocular" ? settings.binocularFov : 5, fovHeight: selectedMode === "binocular" ? settings.binocularFov : 5, shape: "circle" as const, limitingMag: settings.limitingMag };
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
    const keep=hopLocationKeeping(targetId);
    if(keep){if(keep!==location)navigateHash(keep);}else setPage("hop",targetId);
    setComputing(true);
    setPlaying(false);
    const key = JSON.stringify({ ...computeParams, date: settings.timeMode === "live" ? "live" : computeParams.date });
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const computed = directFirst(await planRoutesInWorker(computeParams), computeParams.fovWidth);
      if (keyRef.current !== key) return;
      setRouteResult({ key, result: computed });
      setRouteIndex(0);
      setStep(0);
    } catch (error) {
      if(error instanceof DOMException&&error.name==="AbortError")return;
      toast({
        title: "Could not plan this route",
        description: "Check that the catalogs have loaded, then try again.",
        variant: "destructive",
      });
    } finally {
      if(keyRef.current===key)setComputing(false);
    }
  }
  useEffect(()=>{
    if(page!=="hop"||loading||!targetId||!routeResult||routeResult.key===paramsKey||chainActive)return;
    const timer=window.setTimeout(()=>void compute(),350);
    return()=>window.clearTimeout(timer);
  },[paramsKey,page,loading,chainActive]);
  /** The journey stop a chain stop belongs to (journey chains only). */
  const chainRefFor=(stop:ChainStop):JourneyRef|null=>hopChain.source?.kind==="journey"&&stop.stop?{key:hopChain.source.key,stop:stop.stop}:null;
  /** "I found it!" on the last field: log the object this hop is about (the chain stop, never a stale destination), with its journey stop. */
  function advanceField() {
    if (!route) return;
    setPlaying(false);
    if (step < route.hops.length - 1) { setStep(step + 1); return; }
    if (chainStopNow) seeChainStop(chainStopNow, chainRefFor(chainStopNow));
    else if (eyepieceTarget) seeChainStop({ id: eyepieceTarget.id, label: displayName(eyepieceTarget) }, hopJourneyRef && sameObject(parseHopLocation(location)?.targetId ?? "", eyepieceTarget.id) ? { key: hopJourneyRef.key, stop: hopJourneyRef.stop } : null);
    else markObserved(toSessionId(targetId));
  }
  /** Plan and open a binocular hop. keepLive: plan on the live sky instead of switching to planned time at `at`; location: hop URL carrying journey context (hopPath). */
  async function planBinocularHop(id: string, at: Date, startStarId?: string, opts:{location?:string;keepLive?:boolean}={}) {
    const keepLive=!!opts.keepLive&&settings.timeMode==="live";
    const localDate = formatInTimeZone(keepLive?date:at, timezone, "yyyy-MM-dd");
    const localTime = formatInTimeZone(keepLive?date:at, timezone, "HH:mm");
    const field = fov;
    const starLimit = limitingMag;
    const plannedParams: ObservingParams = {
      ...params,
      startStarId,
      waypointIds:[],
      date: keepLive ? date : fromZonedTime(`${localDate}T${localTime}:00`, timezone),
      targetId: id,
      observingMode: "binocular",
      fovWidth: field,
      fovHeight: field,
      fovShape: "circle",
      limitingMag: starLimit,
    };
    const key = JSON.stringify({ ...plannedParams, date: keepLive ? "live" : plannedParams.date });
    if(!keepLive&&settings.timeMode==="live")toast({title:`Viewing the planned sky at ${formatInTimeZone(plannedParams.date,timezone,"MMM d · HH:mm")}`,description:"The hop is planned for that time, not the live sky. Choose “Use current time” in the time bar to return to the live sky."});
    update({ targetId: id, startStarId,waypointIds:[], ...(keepLive?{}:{date: localDate, time: localTime, timeMode: "planned" as const, plannedAt:plannedParams.date.toISOString()}), mode: "binocular", instrumentSelected: true, fov: field, fovHeight: field, shape: "circle", limitingMag: starLimit });
    if(opts.location)navigateHash(opts.location);else setPage("hop",id);
    setRouteResult(null);
    setComputing(true);
    setPlaying(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const computed = directFirst(await planRoutesInWorker(plannedParams), plannedParams.fovWidth);
      if (keyRef.current !== key) return;
      setRouteResult({ key, result: computed });
      setRouteIndex(0);
      setStep(0);
    } catch (error) {
      if(error instanceof DOMException&&error.name==="AbortError")return;
      toast({ title: "Could not plan this binocular hop", description: "Check that the sky catalogs have loaded and try again.", variant: "destructive" });
    } finally {
      if(keyRef.current===key)setComputing(false);
    }
  }
  // ── Shared cross-tab object verbs (lib/object-links ObjectActions). Stable identity; always calls the latest planner state.
  const LIVE_HOP_WINDOW={before:15*60_000,after:60*60_000};
  const objectActionsImpl=useRef<ObjectActions>(null!);
  objectActionsImpl.current={
    inspect:(id,at)=>{
      if(at)previewMoment(at,lat,lon,false);
      const r=resolveObject(id,catalogs);
      if(r?.unifiedId){selectTarget(r.unifiedId);if(page!=="tonight")setPage("tonight");requestAnimationFrame(()=>featuredObjectRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));}
      else if(r?.hr)setInspectedStar(catalogs.stars.find(s=>s.hr===r.hr)??null);
    },
    hop:(id,o={})=>{
      const r=resolveObject(id,catalogs);if(!r?.routingId)return;
      const from=o.from?resolveObject(o.from,catalogs):null,startStarId=from&&!sameObject(from.routingId??"",r.routingId)?startStarFor(from,catalogs.stars,fov):undefined;
      // Keep the live sky when the requested time is (about) now; otherwise switch to planned time and say so.
      const at=o.at??date,keepLive=settings.timeMode==="live"&&at.getTime()>=date.getTime()-LIVE_HOP_WINDOW.before&&at.getTime()<=date.getTime()+LIVE_HOP_WINDOW.after;
      setPlaying(false);
      void planBinocularHop(r.routingId,at,startStarId,{keepLive,location:o.journey?hopPath(r.routingId,{journey:o.journey}):undefined});
    },
    hopChain:(src,at)=>{
      if(at)previewMoment(at,lat,lon,false);setPlaying(false);
      // Journeys are binocular stories: plan their chain with the binocular field (a telescope setup would hop in tiny fields).
      if(src.kind==="journey"&&(mode!=="binocular"||shape!=="circle"||fov!==(settings.binocularFov??fov))){const field=settings.binocularFov??fov;update({mode:"binocular",instrumentSelected:true,fov:field,fovHeight:field,shape:"circle"});}
      hopChain.start(src);
    },
    moon:(id,at)=>{
      const r=resolveObject(id,catalogs);if(r?.unifiedId){checkAgainstMoon(r.unifiedId,at);return;}
      // A plain BSC star: the Moon tab shows that star (never the previous selection).
      const star=r?.hr?catalogs.stars.find(s=>s.hr===r.hr):undefined;
      setPlaying(false);if(at)previewMoment(at,lat,lon,false);setMoonStar(star?starPlanningTarget(star):null);setInspectedStar(null);setPage("moon");
    },
    clock:(ids,at)=>compareObjects(ids.map(toSessionId),at),
    catalog:id=>{const r=resolveObject(id,catalogs);if(!r?.unifiedId&&r?.hr){setInspectedStar(catalogs.stars.find(s=>s.hr===r.hr)??null);return;}navigateHash(catalogPath(r?.unifiedId??id));},
    images:id=>{const r=resolveObject(id,catalogs);if(!r?.unifiedId&&r?.hr){setInspectedStar(catalogs.stars.find(s=>s.hr===r.hr)??null);return;}navigateHash(catalogPath(r?.unifiedId??id,{photos:true}));},
    addToNight:(ids,o={})=>addManyToNight(ids,o.at,{journeyKey:o.journeyKey,journeyStops:o.journeyStops,plannedAts:o.plannedAts}),
    // The same night addToNight uses (nightSessionFor), so "In tonight's plan" and the add agree.
    // With a journey tag: in the night with that stop and its time (nightHolds), else the add still fills them in.
    isInNight:(id,tag)=>{const items=page==="night"?night:nightSessionFor(date)?.items??[];return tag?.journeyKey?nightHolds(items,id,tag):items.some(item=>sameObject(item.id,id));},
    markObserved:(id,journey)=>markObserved(toSessionId(id),journey),
    journey:r=>{
      // A hop opened from the Overview's stop card returns to the Overview with that card open.
      if(r.key&&r.done)navigate(pathForJourneyRoute({view:"done",key:r.key}));
      else if(r.key&&r.stop&&r.from==="overview")navigateHash(journeyOverviewStopPath(r.key,r.stop));
      else if(r.key)navigate(pathForJourneyRoute(r.stop?{view:"stop",key:r.key,stop:r.stop}:{view:"overview",key:r.key}));
      else if(r.objectId)navigateHash(journeysFocusPath(r.objectId));
      else setPage("journeys");
    },
  };
  const objectActions=useMemo<ObjectActions>(()=>({
    inspect:(id,at)=>objectActionsImpl.current.inspect(id,at), hop:(id,o)=>objectActionsImpl.current.hop(id,o), hopChain:(src,at)=>objectActionsImpl.current.hopChain(src,at),
    moon:(id,at)=>objectActionsImpl.current.moon(id,at), clock:(ids,at)=>objectActionsImpl.current.clock(ids,at), catalog:id=>objectActionsImpl.current.catalog(id),
    images:id=>objectActionsImpl.current.images(id), addToNight:(ids,o)=>objectActionsImpl.current.addToNight(ids,o), isInNight:(id,tag)=>objectActionsImpl.current.isInNight(id,tag),
    markObserved:(id,journey)=>objectActionsImpl.current.markObserved(id,journey), journey:r=>objectActionsImpl.current.journey(r),
  }),[]);
  /** "I see <stop>" in the Star hop bar: journey outcome and Planner log together (progress.recordStopSeen, loaded lazily). */
  function seeChainStop(stop:ChainStop,ref:JourneyRef|null) {
    if(!ref){objectActions.markObserved(stop.id);return;}
    const live=settings.timeMode==="live",cat=catalogs;
    void import("@/lib/journeys/progress").then(m=>{if(!m.recordStopSeen(ref,(id,plannedAt)=>markObserved(id,{journeyKey:ref.key,journeyStop:ref.stop,plannedAt}),{live,logId:id=>resolveObject(id,cat)?.sessionId??null}))objectActions.markObserved(stop.id);},()=>objectActions.markObserved(stop.id));
  }
  const journeySky=useMemo<ObjectSkyContext>(()=>({at:date,lat,lon,timezone,live:settings.timeMode==="live",skyBrightness:settings.skyBrightness,profile:binocularProfile}),[date,lat,lon,timezone,settings.timeMode,settings.skyBrightness,binocularProfile]);
  async function bestTime() {
    if (!selected) return;
    setFindingTime(true);
    const key = paramsKey;
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const options={selected,lat,lon,timezone,date};
      const at=nearestMoonFreeTargetTime({...options,target:selected,minAltitude:MIN_ALT.possible});
      const window=at?{date:at,alt:eqToHorizontal(selected.ra,selected.dec,lat,lon,at).alt}:null;
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
            `No Moon-free dark window above 15° for at least 30 minutes in the next 30 nights. ${90-Math.abs(lat-selected.dec)<15?"This object never reaches 15° at this latitude.":"Try a later season or use the clock to inspect nights with moonlight."}`,
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
        `At the target: ${objectSummary(selected.id,{target:selected})?.lookFor ?? guideFor(selected).lookFor}`,
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
    ([{name:"San Francisco",lat:37.77,lon:-122.42},{name:"London",lat:51.5,lon:-.12},{name:"Sydney",lat:-33.87,lon:151.21}].find(site=>Math.abs(site.lat-lat)<1e-6&&Math.abs(site.lon-lon)<1e-6)?.name ??
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`);
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
    <ObservingContextProvider navigationKey={location} savedDates={plannerStore.sessions.filter(s=>!s.archived).map(s=>clockNightDate(new Date(s.startAt),sessionTimezone(s)))} skyBrightness={settings.skyBrightness} onSkyBrightness={value=>update({skyBrightness:value})} date={date} timezone={timezone} lat={lat} lon={lon} locationName={locationLabel} locations={savedLocations} onLocations={setSavedLocations} onTime={at=>previewMoment(at,lat,lon,false)} onLocation={(a,b)=>requestSiteChange(a,b)}>
    <NightVisionFilter enabled={settings.redLight}><a href="#main-content" className="skip-link">Skip to observing content</a>
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
              ["journeys", "Journeys", Waypoints],
              ["night", "Planner", CalendarDays],
              ["clock", "Clock", Clock],
              ["catalog", "Catalog", BookOpen],
              ["binocular", "Binoculars", Binoculars],
              ["moon", "Moon", Moon],
              ["hop", "Star hop", Navigation],
            ] as const
          ).map(([id, label, Icon]) => (
            <a
              href={`#${pathForPage(id)}`}
              key={id}
              onClick={event => {if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();if(id==="clock"&&page!=="clock"&&targetId)compareObjects([targetId]);else setPage(id);}}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              data-testid={`tab-${id}`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {id === "night" && night.length > 0 && (
                <span className="nav-count">{night.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className={`icon-button mobile-setup-toggle ${page === "night" ? "planner-setup-toggle" : ""}`}
            onClick={() => setSetupOpen(!setupOpen)}
            aria-label="Observing setup"
            title="Observing setup"
            aria-expanded={setupOpen}
          >
            <Settings2 size={17} />
          </button>
          {offline.updateReady ? (
            <button
              aria-label="StarHop was updated. Reload to use the new version"
              title="Reload to use the updated StarHop"
              className="offline-pill ready"
              onClick={offline.reloadForUpdate}
              data-testid="update-ready"
            >
              <RefreshCw size={13} />
              <span>Update ready</span>
            </button>
          ) : (
          <button
            aria-label={offlineLabel}
            title={offlineLabel}
            className={`offline-pill ${offline.state === "ready" ? "ready" : ""}`}
            onClick={() => setOfflineOpen(true)}
            data-testid="offline-indicator"
          >
            <span className="status-dot" />
            <span>{offline.state==="preparing"?"Preparing…":offline.state==="ready"&&!offline.online?"Offline mode":!offline.online?"Offline setup":offlineLabel}</span>
          </button>
          )}
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

      <div className="workspace-layout sky-workspace">
        <Dialog open={setupOpen} onOpenChange={setSetupOpen}><DialogContent className="observing-setup-dialog"><DialogHeader><DialogTitle>Observing setup</DialogTitle><DialogDescription>Location, time, instrument and route style.</DialogDescription></DialogHeader><aside className="setup-panel open">
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
            <button type="button" className="context-apply context-current-location" onClick={locate} disabled={locating}>
              {locating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Crosshair size={15} aria-hidden="true" />}
              {locating ? "Finding your location…" : "Use my current location"}
            </button>
            <ContextLocationButton>Site & sky brightness</ContextLocationButton>
            <SavedLocations context="Sky" locations={savedLocations} lat={lat} lon={lon} onChange={setSavedLocations} onSelect={site=>requestSiteChange(site.lat,site.lon,site.name)}/>
            <CoordinatePairInput onUse={(a,b)=>requestSiteChange(a,b)}/>
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
          </section>
          <section className="setup-section"><AppTextSizeControl/>
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
            {mode === "binocular" && <BinocularProfileControls settings={settings} update={update}/>}
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
            </button>
          </div>
          <button className="photo-chart-link" onClick={() => setPage("image")}>
            <ImageIcon size={15} />
            Calibrate a photo chart
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </aside></DialogContent></Dialog>

        <main id="main-content" className="main-content">
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
            <div><Clock size={14} /><span><strong>{settings.timeMode === "live" ? "Live sky" : "Viewing planned sky"}</strong> · <ContextDateButton>{dateLabel} · {observingTime}</ContextDateButton><small>{timezone.replaceAll("_", " ")} (UTC{formatInTimeZone(date,timezone,"xxx")}) · <ContextLocationButton>{locationLabel}</ContextLocationButton></small></span>{settings.timeMode==="planned"&&<button type="button" className="text-action timebar-now" onClick={useNow} aria-label="Set time to now">Now</button>}</div>
            <div className="session-time-actions"><button className="text-action" title={`Saving to: ${saveDestination}`} onClick={()=>setPage("night")}><CalendarDays size={13}/>{activeSession ? `Planner · ${night.length} ${night.length===1?"object":"objects"}` : "Open planner"}</button><button className="text-action" onClick={useNow}>{settings.timeMode === "live" ? "Refresh now" : "Use current time"}</button></div>
          </section>}
          {/* Tonight and Star hop: the time bar's Planner link names the night (title) and the add buttons say it: no third context bar. */}
          {page!=="night"&&page!=="binocular"&&page!=="tonight"&&page!=="hop"&&<div className="saving-context" role="status">Saving to: <strong>{saveDestination}</strong> · <ContextLocationButton>{locationLabel}</ContextLocationButton></div>}
          {page === "tonight" && <WeatherPanel overview onPlanNight={at=>{previewMoment(at,lat,lon,false);setPage("night");}} lat={lat} lon={lon} date={date} timezone={timezone} skyBrightness={settings.skyBrightness} locationName={locationLabel} onTime={at=>previewMoment(at,lat,lon,false)}/>}
          {page === "tonight" && (
            <>
              <div className="tonight-hero">
                <section className="panel sky-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">YOUR BINOCULAR SKY · {settings.binocularMagnification}×{settings.binocularAperture}</span>
                      <h1>Your planetarium</h1>
                    </div>
                    <div className="planetarium-heading-actions"><span className="live-label">{settings.timeMode === "live" ? "Live sky" : "Planned sky"} · {observingTime}</span><button className="text-action" onClick={()=>setPage("catalog")}>Browse {catalogs.targets.length || ""} objects <ChevronRight size={13} aria-hidden="true"/></button></div>
                  </div>
                  {loading ? (
                    <div className="sky-loading">
                      <Loader2 className="animate-spin" />
                      <p>Opening the sky atlas…</p>
                    </div>
                  ) : (
                    <SkyChart isBinocular={mode==="binocular"} onEditSetup={()=>setSetupOpen(true)} setupSummary={`${fov.toFixed(1)}° field · stars to mag ${limitingMag.toFixed(1)}`}
                      overview
                      targetDiameter={catalogDiameter(selected?.size)}
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
                      onFovChange={(width) => update({ fov: width, ...(mode === "binocular" ? { binocularFov: width } : {}), ...(shape === "circle" ? { fovHeight: width } : {}) })}
                      onLimitingMagChange={(value) => update({ limitingMag: value })}
                      lat={lat}
                      lon={lon}
                      date={date}
                      onSelect={selectTarget}
                    />
                  )}
                  <div className="sky-caption">
                    <span>
                      Tap or click a labeled symbol to select its object
                    </span>
                    <span>Star size = brightness · hue = catalog color</span>
                  </div>
                </section>
                {selected && selection ? (
                  <section className="panel featured-object" ref={featuredObjectRef}>
                    <div className="featured-art">
                      <TargetPhoto target={selected} opticalField={{width:fov,height:shape==='circle'?fov:fovHeight,shape,limitingMag,label:mode==='binocular'?`${settings.binocularMagnification}×${settings.binocularAperture} binoculars`:'Telescope',onChange:width=>update({fov:width,...(shape==='circle'?{fovHeight:width,binocularFov:mode==='binocular'?width:settings.binocularFov}:{})})}}/>
                      <span className="art-badge">SELECTED · {targetDesignation(selected)}</span>
                    </div>
                    <div className="featured-body">
                      <div className="flex items-center justify-between gap-2">
                        <span className="eyebrow">
                          {targetDesignation(selected)} · {selected.category.toUpperCase()}
                        </span>
                        <AltitudeStatus alt={selection.alt} sunAlt={conditions.sunAlt}/>
                      </div>
                      <div className="selected-object-heading"><h2>{objectName(selected).name}</h2><button className="text-action" aria-label="Clear selected object" onClick={()=>update({targetId:"",startStarId:undefined})}><X size={15}/></button></div><p className="selection-context">Selected object · choose another symbol to change it</p>
                      <p className="object-location">
                        {getConstellationName(selected.con)}
                        <span>·</span>
                        {Math.round(selection.alt)}°{" "}
                        {compassLabel(selection.az)}
                      </p>
                      <ObjectActionRow objectId={selected.id} name={displayName(selected)} actions={objectActions} at={date} omit={["hop","addToNight"]}/>
                      <Suspense fallback={null}><ObjectJourneyLinks objectId={selected.id} actions={objectActions} sky={journeySky}/></Suspense>
                      <TargetNightSuggestions target={selected} lat={lat} lon={lon} timezone={timezone} date={date} onDate={at=>previewMoment(at,lat,lon,false)}/><SelectedTargetPlanning target={selected} lat={lat} lon={lon} date={date} timezone={timezone} skyBrightness={settings.skyBrightness}/>
                      <details className="selected-target-story"><summary>About this object & photograph</summary><p className="object-story">{objectSummaryText(selected.id,{target:selected})||guideFor(selected).story}</p><TargetPhotoCredit target={selected}/></details>
                      {!conditions.isDark&&<button className="text-action" onClick={()=>previewMoment(planningShortcut("tonight",lat,lon).date,lat,lon)}>Preview tonight after dark</button>}
                      <BinocularAssessment target={selected} profile={binocularProfile} alt={selection.alt} moon={currentMoon} skyBrightness={settings.skyBrightness}/>
                      <details className="selected-moon-more"><summary>Moonlight at {formatInTimeZone(date,timezone,"MMM d · HH:mm")}</summary><MoonlightCard target={selected} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} onMoon={() => checkAgainstMoon(selected.id)} /></details>
                      <div className="featured-actions">
                        <Button
                          onClick={() => compute()}
                          disabled={computing || loading}
                          data-testid="button-compute"
                        >
                          <Navigation size={15} />
                          {settings.instrumentSelected ? LINK_LABELS.hop : "Choose your instrument"}
                        </Button>
                        <button
                          className={`save-button ${savedIds.has(targetId) ? "saved" : ""}`}
                          onClick={() => toggleSave(targetId)}
                          aria-label={
                            savedIds.has(targetId)
                              ? "Remove from tonight's plan"
                              : LINK_LABELS.addToNight
                          }
                          title={
                            savedIds.has(targetId)
                              ? "Remove from tonight's plan"
                              : LINK_LABELS.addToNight
                          }
                          data-testid="button-save-target"
                        >
                          {savedIds.has(targetId)?<Check size={18}/>:<Plus size={18}/>} {savedIds.has(targetId)?"Remove from tonight's plan":LINK_LABELS.addToNight}
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
                        : "Choose an object in the sky"}
                    </h2><p>Clusters, galaxies and nebulae have distinct symbols. Select one to see its photo, observing graph and binocular guidance.</p><button className="text-action" onClick={()=>setPage("catalog")}>Browse the full catalog <ChevronRight size={13} aria-hidden="true"/></button>
                  </section>
                )}
              </div>
              <Suspense fallback={null}><TonightJourneyTeaser lat={lat} lon={lon} date={date} timezone={timezone} live={settings.timeMode==="live"} skyBrightness={settings.skyBrightness} profile={binocularProfile} navigate={navigate}/></Suspense>
              <details open className="panel upcoming-nights-disclosure"><summary>Compare upcoming nights · Moon-free darkness</summary><UpcomingNights lat={lat} lon={lon} timezone={timezone} date={date} selected={selected} targets={planningTargets.filter(target=>night.some(item=>item.id===target.id))} onDate={at=>previewMoment(at,lat,lon,false)}/></details>
              <BinocularProfileSummary settings={settings} onEditSetup={()=>setSetupOpen(true)}/>
              <div className="data-source-row">
                <span>Calculated on this device from stored sky catalogs</span>
                <button className="text-action" onClick={() => setSourcesOpen(true)}>
                  Where the data comes from
                </button>
              </div>
              {conditions.moonAlt >= 15 && conditions.illumination >= 60 && <button className="moon-tonight-link" onClick={() => setPage("moon")}><Moon size={18} /><span>A bright Moon is up. Explore seas and ray systems, or find a darker window.</span><ChevronRight size={15} aria-hidden="true" /></button>}
              <section className="discover-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">LET CURIOSITY LEAD</span>
                    <h2>What will you find?</h2>
                  </div>
                  <button className="text-action" onClick={()=>setPage("catalog")}>Full catalog & filters <ChevronRight size={14} aria-hidden="true"/></button>
                </div>
                <div className="discovery-toolbar">
                  <CatalogCombobox className="tonight-search" targets={planningTargets} query={query} onQuery={setQuery} onSelect={target=>{selectTarget(target.id);setQuery("");requestAnimationFrame(()=>featuredObjectRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));}} savedIds={savedIds} label="Search sky objects" placeholder="Search objects, stars, constellations…"/>
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
                      fit={binocularAssessment(o.target,binocularProfile,{alt:o.alt,moon:currentMoon,skyBrightness:settings.skyBrightness}).label}
                      saved={savedIds.has(o.target.id)}
                      selected={targetId === o.target.id}
                      onSelect={() => {
                        selectTarget(o.target.id);
                        requestAnimationFrame(() =>
                          featuredObjectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
                        );
                      }}
                      onSave={() => toggleSave(o.target.id)}
                      actions={objectActions}
                      at={date}
                      summary={objectSummaryText(o.target.id,{target:o.target})}
                      linksSlot={<Suspense fallback={null}><ObjectJourneyLinks objectId={o.target.id} actions={objectActions} compact sky={journeySky}/></Suspense>}
                    />
                  ))}
                </div>
                {!loading && !filtered.length && !starHits.length && (
                  <div className="panel empty-state">
                    <Search size={28} />
                    <h3>{query.trim()?"Search results outside this view":"No objects in this view"}</h3>
                    <p>{catalogSearchDiagnostics(query,planningTargets,[...filtered.map(o=>o.target),...starHits.map(o=>starPlanningTarget(o.star))],target=>{const alt=eqToHorizontal(target.ra,target.dec,lat,lon,date).alt;return visibleOnly&&alt<15?`${target.name} is ${Math.abs(alt).toFixed(1)}° ${alt<0?'below the horizon':'high'}, below the Above 15° limit.`:category!=='all'?`Hidden by the ${category} object-type filter.`:friendlyOnly?'Hidden by Binocular picks.':undefined;}).message||'Try another time or broaden your filters.'}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCategory("all");
                        setVisibleOnly(false);
                        setFriendlyOnly(false);
                      }}
                    >
                      {query.trim()?"Show anyway":"Browse the full catalog"}
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
              {/* Journey strip / chain bar first, right under the time bar: where this hop sits in its journey and the way back. */}
              <HopChainBar chain={hopChain} step={step} onStep={next=>{setPlaying(false);setStep(next);}} actions={objectActions} onSeen={seeChainStop} journey={hopJourneyRef} catalog={catalogs}
                onLeaveJourney={()=>navigateHash(hopPath(parseHopLocation(location)?.targetId??targetId),{replace:true})}/>
              <div className="page-heading hop-page-heading">
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
              <CatalogCombobox targets={catalogs.targets} query={query} onQuery={setQuery} onSelect={target=>{selectTarget(target.id);setQuery("");}} label="Star hop destination" placeholder={eyepieceTarget?"Search to change the destination…":"Choose an object to hop to…"}/>
              {eyepieceTarget ? <div className="hop-target-bar" data-testid="hop-destination">
                <div className="hop-target-name">
                  <Crosshair size={22} className="text-gold shrink-0" aria-hidden="true"/>
                  <div className="min-w-0">
                    <span className="eyebrow">{chainStopNow ? `${hopChain.noun === "stop" ? "STOP" : "TARGET"} ${chainStopNow.stop ?? ""}`.trim() : "YOUR DESTINATION"}</span>
                    <h2>{chainStopNow ? chainStopNow.label : displayName(eyepieceTarget)}</h2>
                    {/* Where it is now: plain meta, not a control. */}
                    <p className="hop-target-meta" data-testid="hop-destination-meta">{eyepieceHz ? `${Math.round(eyepieceHz.alt)}° high · ${compassLabel(eyepieceHz.az)}` : ""}{eyepieceTarget.con ? ` · in ${getConstellationName(eyepieceTarget.con)}` : ""}</p>
                  </div>
                </div>
                {!chainActive && <Button
                    onClick={() => compute()}
                    disabled={computing || loading}
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
                        ? LINK_LABELS.replan
                        : LINK_LABELS.hop}
                  </Button>}
                <div className="hop-target-actions">
                  <ObjectActionRow objectId={eyepieceTarget.id} name={displayName(eyepieceTarget)} actions={objectActions} at={date} omit={["hop"]} variant="compact"
                    saved={hopStopRef?objectActions.isInNight(eyepieceSaveId,{journeyKey:hopStopRef.key,journeyStop:hopStopRef.stop,plannedAt:hopStopAt}):savedIds.has(eyepieceTarget.id)} onToggleSave={()=>toggleHopSave(hopStopRef,hopStopAt)}>
                    {/* The object Star hop is at (the chain's current stop, not its last), as the Catalog's own-chart link does. */}
                    <button type="button" className="object-action" onClick={()=>openOwnChart(eyepieceTarget.id,update)} data-testid="hop-own-chart"><ImageIcon size={14} aria-hidden="true"/>{LINK_LABELS.ownChart}</button>
                    {/* Only when the sky gets in the way: the destination is low, or a bright Moon is up. */}
                    {!chainActive && (eyepieceAlt < MIN_ALT.possible || (conditions.moonAlt > 0 && conditions.illumination >= 50)) && <button type="button" className="object-action" title="Find a Moon-free navigation window of at least 30 minutes above 15°; 30° or higher is preferred for detail." onClick={bestTime} disabled={findingTime || computing || !selected} data-testid="hop-moon-free-night">
                      {findingTime ? <Loader2 size={14} className="animate-spin" aria-hidden="true"/> : <Clock size={14} aria-hidden="true"/>}{LINK_LABELS.moonFreeNight}
                    </button>}
                  </ObjectActionRow>
                </div>
              </div> : !chainActive && <section className="panel empty-state hop-empty-state" data-testid="hop-empty-state">
                <Crosshair size={28} aria-hidden="true"/>
                <h2>{loading ? "Loading the sky catalogs…" : "Choose where to hop"}</h2>
                <p>Search for an object above, or start from tonight's picks or a sky journey.</p>
                <div className="hop-empty-actions">
                  <Button variant="outline" onClick={()=>setPage("tonight")}><Compass size={15}/> Pick from Tonight's Best</Button>
                  <Button variant="outline" onClick={()=>setPage("journeys")}><Waypoints size={15}/> Start a journey</Button>
                </div>
              </section>}

              {eyepieceTarget && eyepieceAlt < MIN_ALT.possible && (
                <div className="notice warning">
                  <AlertTriangle size={16} />
                  <span>
                    {eyepieceAlt < 0
                      ? "This object is below the horizon."
                      : "This object is very low in the sky."}{" "}
                    {chainActive ? "Choose a different time in the time bar." : `Use “${LINK_LABELS.moonFreeNight}” or choose a different time.`}
                  </span>
                </div>
              )}
              {!chainActive&&result?.warning&&<p className="twilight-note" role="status">{result.warning}</p>}
              {!chainActive && result && !result.routes.length && (
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
              {!chainActive&&eyepieceTarget&&<details className="route-settings hop-preflight"><summary>Route setup · minimum 15°, preferred 30°</summary><small className="hop-window-threshold">Moon-free navigation windows last at least 30 minutes above 15°. Aim for 30° or higher for the best detail.</small>              <div className="route-start-choice"><label>Starting star <input aria-label="Filter starting stars" placeholder="Filter by name or constellation" value={startQuery} onChange={e=>setStartQuery(e.target.value)}/><select aria-label="Starting star" value={settings.startStarId ?? ""} onChange={event => update({ startStarId:event.target.value || undefined })}>
                <option value="">Automatic starting stars</option>
                {startOptions.filter(({star})=>`${starPlanningTarget(star).name} ${getConstellationName(star.constellation??"")}`.toLowerCase().includes(startQuery.toLowerCase())).map(({star,alt}) => <option key={star.id} value={star.id}>{starPlanningTarget(star).name} · mag {star.mag.toFixed(1)} · {Math.round(alt)}° high</option>)}
              </select></label><small>Choose a visible reference and replan. Your field and guide-star limit still apply.</small></div>
              <div className="route-waypoints"><span>Required guide stars ({settings.waypointIds?.length??0}/8)</span>{(settings.waypointIds??[]).map(id=><button key={id} onClick={()=>update({waypointIds:settings.waypointIds?.filter(value=>value!==id)})}>{(()=>{const star=catalogs.stars.find(star=>star.id===id);return star?formatRouteNodeName({...star,name:star.name??star.bayer??star.id,...eqToHorizontal(star.ra,star.dec,lat,lon,date),type:"star"}):id;})()} ×</button>)}<small>Select a chart star to add it as a required waypoint. Routes visit them in this order.</small></div>
</details>}
              {!chainActive && result && result.routes.length > 0 && (
                <div className="route-options" aria-label="Available routes">
                  {routeOptionLabels(result.routes).map((label, i) => {
                    const r = result.routes[i];
                    return <button
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
                      <span>{label}</span>
                      {/* The same hop count as the journey cards and the chain bar (moves after the starting field). */}
                      <small>{hopCountLabel(routeHops(r))} · {r.score}/100</small>
                      {routeIndex === i && <Check size={14} />}
                    </button>;
                  })}
                </div>
              )}
              <div className="hop-layout">
                {eyepieceTarget&&<div className="hop-best-nights"><TargetNightSuggestions target={eyepieceTarget} lat={lat} lon={lon} timezone={timezone} date={date} onDate={at=>previewMoment(at,lat,lon,false)}/></div>}
                <section className="panel route-chart-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">YOUR FIELD MAP</span>
                      <h2>
                        {route
                          ? `Field ${step+1} · ${Math.round(route.hops[step]?.center.alt??route.startAnchor.alt)}° high · ${compassLabel(route.hops[step]?.center.az??route.startAnchor.az)}`
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
                  <SkyChart isBinocular={mode==="binocular"} onEditSetup={()=>setSetupOpen(true)} setupSummary={`${fov.toFixed(1)}° field · stars to mag ${limitingMag.toFixed(1)}`}
                    nodes={hopChain.chain?.nodes ?? result?.nodes ?? (previewTarget?[...previewNodes.filter(n=>n.id!==previewTarget.id),previewTarget]:previewNodes)}
                    onSelect={selectTarget}
                    constellations={catalogs.constellations}
                    route={route}
                    journey={hopChain.chain ? hopChain.overlay(step) ?? undefined : undefined}
                    targetNode={hopChain.chain?.targetNode ?? result?.targetNode ?? previewTarget}
                    animStep={step}
                    fieldNavigation={route ? <HopFieldNavigation route={route} step={step} checkpoint={hopChain.chain ? chainCheckpoint(hopChain.chain, step) : null} observed={hereObserved} onPrevious={() => { setStep(Math.max(0, step - 1)); setPlaying(false); }} onNext={advanceField}/> : undefined}
                    fovWidth={fov}
                    fovHeight={shape === "circle" ? fov : fovHeight}
                    fovShape={shape}
                    lat={lat}
                    lon={lon}
                    date={date}
                    limitingMag={limitingMag}
                    denseStars={catalogs.dense}
                    milkyWay={catalogs.milkyWay}
                    onFovChange={(width) => update({ fov: width, ...(mode === "binocular" ? { binocularFov: width } : {}), ...(shape === "circle" ? { fovHeight: width } : {}) })}
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
                        <div className={`step-progress${route!.hops.length > 12 ? " many" : ""}`}>
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
                                {hereObserved
                                  ? "Log another observation"
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
                        {(lastObservationUndo||nextUnobservedTarget)&&<div className="flex flex-wrap gap-2 mt-2" aria-label="Observation actions">
                          {lastObservationUndo&&<Button variant="outline" size="sm" onClick={undoLastObservation} data-testid="button-undo-observation"><RotateCcw size={14}/> Undo observation</Button>}
                          {nextUnobservedTarget&&<Button variant="outline" size="sm" onClick={goToNextUnobservedTarget} data-testid="button-next-target">Next target: {planningTargets.find(target=>target.id===nextUnobservedTarget.id)?.name??nextUnobservedTarget.id}<ChevronRight size={14}/></Button>}
                        </div>}
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
                  {eyepieceTarget && (
                    <section className="panel at-the-eyepiece">
                      <div className="section-label">
                        <Eye size={15} />
                        <h2>At the eyepiece{chainStopNow ? `: ${displayName(eyepieceTarget)}` : ""}</h2>
                      </div>
                      <p>{objectSummary(eyepieceTarget.id,{target:eyepieceTarget})?.lookFor ?? guideFor(eyepieceTarget).lookFor}</p>
                      <BinocularAssessment target={eyepieceTarget} profile={binocularProfile} alt={eyepieceAlt} moon={currentMoon} skyBrightness={settings.skyBrightness}/>
                      <details className="selected-moon-more"><summary>Moonlight at {formatInTimeZone(date,timezone,"MMM d · HH:mm")}</summary><MoonlightCard target={eyepieceTarget} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} onMoon={() => checkAgainstMoon(eyepieceTarget.id)} /></details>
                      <AltitudeChart
                        target={eyepieceTarget}
                        lat={lat}
                        lon={lon}
                        date={date}
                        timezone={timezone}
                      />
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
                      Classic route · source: {route.expertSource}
                    </p>
                  )}
                </section>
              )}
            </>
          )}

          {page === "night" && (
            <>
              <div className="page-heading night-page-heading"><div><p className="eyebrow">YOUR NEXT NIGHT OUT</p><h1>Plan your night<span>.</span></h1><p>Choose a night. Add targets. Follow the stars.</p></div></div>
              <SessionPlanner selectedTarget={selected} profile={binocularProfile} onCompare={(ids,at,a,b)=>compareObjects(ids,at,a,b)} savedLocations={savedLocations} onLocationsChange={setSavedLocations} sessions={plannerStore.sessions} active={activeSession} targets={planningTargets} date={date} lat={lat} lon={lon} timezone={timezone} items={night} skyBrightness={settings.skyBrightness} live={settings.timeMode === "live"}
                onCreate={createSession} onUpdate={updateSession} onSelect={selectSession} onPreview={(at,a,b,stay)=>previewMoment(at,a,b,!stay)} onVisit={visitScheduledTarget} onAdd={toggleSave} onObserved={markObserved} objectActions={objectActions}
                onNotes={(id,notes)=>setNight(current=>current.map(item=>item.id===id?{...item,notes}:item))}
                actions={<><Suspense fallback={null}><SendPlanToPhone session={activeSession} settings={settings} savedLocations={savedLocations}/></Suspense><SkySafariExport items={night} targets={planningTargets} session={activeSession} date={date} lat={lat} lon={lon} skyBrightness={settings.skyBrightness}/><Button variant="outline" onClick={exportNight} disabled={!night.length}><Download size={15}/> Export notes</Button></>}
              />
            </>
          )}
          {page === "binocular" && (
            <BinocularGuide locationName={locationLabel} isSavedAt={(id,at)=>plannerStore.sessions.some(session=>!session.archived&&Math.abs(session.lat-lat)<.001&&Math.abs(session.lon-lon)<.001&&clockNightDate(new Date(session.startAt),timezone)===clockNightDate(at,timezone)&&session.items.some(item=>item.id===id))} live={settings.timeMode==="live"} onDate={at=>previewMoment(at,lat,lon,false)} onEditSetup={()=>setSetupOpen(true)} onCompare={(id,at)=>compareObjects([id],at)} profile={binocularProfile} profileControls={<BinocularProfileSummary settings={settings} onEditSetup={()=>setSetupOpen(true)}/>} onMoon={checkAgainstMoon} saveDestination={saveDestination} targets={catalogs.targets} stars={catalogs.stars} constellations={catalogs.constellations} denseStars={catalogs.dense} milkyWay={catalogs.milkyWay} fovWidth={fov} fovHeight={shape === "circle" ? fov : fovHeight} fovShape={shape} limitingMag={limitingMag} onFovChange={(width) => update({ fov: width, ...(mode === "binocular" ? { binocularFov: width } : {}), ...(shape === "circle" ? { fovHeight: width } : {}) })} onLimitingMagChange={(value) => update({ limitingMag: value })} lat={lat} lon={lon} timezone={timezone} observingDate={date} onInspect={selectTarget} skyBrightness={settings.skyBrightness} savedIds={savedIds} loading={loading} onSave={toggleSave} onPlan={planBinocularHop} onJourneys={at=>{previewMoment(at,lat,lon,false);setPage("journeys");}} actions={objectActions} />
          )}
          {page === "journeys" && <Suspense fallback={<p className="journey-loading" role="status">Loading Sky Journeys…</p>}>
            <JourneysPage location={location} navigate={navigate} lat={lat} lon={lon} date={date} timezone={timezone} live={settings.timeMode==="live"} locationName={locationLabel} skyBrightness={settings.skyBrightness} profile={binocularProfile} stars={catalogs.stars} targets={catalogs.targets} constellations={catalogs.constellations} denseStars={catalogs.dense} milkyWay={catalogs.milkyWay} catalogsLoading={loading} moon={currentMoon} sunAlt={conditions.sunAlt} offlineLabel={offline.state==="ready"?"Offline ready ✓":offline.online?"Online":"Offline"} redLight={settings.redLight} onRedLight={on=>update({redLight:on})} onTime={at=>previewMoment(at,lat,lon,false)} onLive={useNow} onMoonTab={()=>setPage("moon")} onEditSetup={()=>setSetupOpen(true)} actions={objectActions} sessions={plannerStore.sessions} hopChain={hopChain}/>
          </Suspense>}
          {page === "catalog" && <CatalogExplorer onEditSetup={()=>setSetupOpen(true)} onCompare={(id,at)=>compareObjects([id],at)} targets={catalogs.targets} settings={settings} update={update} date={date} timezone={timezone} locationName={locationLabel} saveDestination={saveDestination} savedIds={savedIds} onSave={toggleSave} onMoon={checkAgainstMoon} onSky={(id,at)=>{selectTarget(id);previewMoment(at,lat,lon);setPage("tonight");window.scrollTo({top:0,behavior:"smooth"});}} actions={objectActions}/>}
          {page === "clock" && <><AstronomicalClock targets={planningTargets} ids={compareIds} onIds={setCompareIds} selectedId={targetId} sessionIds={night.map(item=>item.id)} lat={lat} lon={lon} date={date} timezone={timezone} locationName={locationLabel} locations={savedLocations} onLocation={(a,b)=>requestSiteChange(a,b)} onTime={at=>previewMoment(at,lat,lon,false)} onLive={()=>update({timeMode:"live"})} live={settings.timeMode==="live"} skyBrightness={settings.skyBrightness} profile={binocularProfile} actions={objectActions}/>{compareError&&<p role="alert">Your browser could not save the comparison list. Keep this tab open to retain it.</p>}</>}
          {page === "moon" && <MoonObservatory targets={catalogs.targets} onTarget={id=>{setMoonStar(null);selectTarget(id);}} locationName={locationLabel} lat={lat} lon={lon} date={date} timezone={timezone} settings={settings} update={update} target={moonStar??selected} initialFeatureId={lunarSelection} onDate={at => { setPlaying(false); update({ date:formatInTimeZone(at,timezone,"yyyy-MM-dd"), time:formatInTimeZone(at,timezone,"HH:mm"), timeMode:"planned", plannedAt:at.toISOString() }); }} savedIds={savedIds} onSave={toggleSave} actions={objectActions} />}
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
              </div>
              <div className="image-page"><ImageFallback objectId={settings.targetId||undefined} targets={catalogs.targets} stars={catalogs.stars} back={pageTrail.current.previous&&pageTrail.current.previous!=="image"?{label:`Back to ${PAGE_LABELS[pageTrail.current.previous]}`,onClick:()=>history.back()}:undefined}/></div>
            </>
          )}
          {page==="night"&&<Suspense fallback={null}><BackupControls data={{settings,planner:plannerStore,savedLocations,unscheduled:legacyNight}} onImport={applyImportedData}/></Suspense>}
          {pendingImport&&<Suspense fallback={null}><PlanImportGate data={{settings,planner:plannerStore,savedLocations,unscheduled:legacyNight}} onImport={(next,focus)=>{applyImportedData(next);if(focus){previewMoment(new Date(focus.startAt),focus.lat,focus.lon,false);setPage("night");}}}/></Suspense>}

          {page==="night"&&<OfflineControls {...offline}/>}
          <footer className="app-footer">
            <span>
              <Star size={12} />A quieter screen. A bigger sky.
            </span>
            <span>Calculated locally · BSC5 & deep sky catalogs</span>
          </footer>
        </main>
      </div>
      <Dialog open={!!inspectedSolar} onOpenChange={open=>{if(!open)setInspectedSolar(null);}}><DialogContent><DialogHeader><DialogTitle>{inspectedSolar?.name}</DialogTitle><DialogDescription>Solar system · {formatInTimeZone(date,timezone,"MMM d, yyyy · HH:mm")} local</DialogDescription></DialogHeader>{inspectedSolar&&<><p>{Math.round(inspectedSolar.alt)}° {compassLabel(inspectedSolar.az)} · {altitudeLabel(inspectedSolar.alt)}</p><p>Magnitude {inspectedSolar.mag.toFixed(1)} · RA {inspectedSolar.ra.toFixed(3)}° · Dec {inspectedSolar.dec.toFixed(3)}°</p>{inspectedSolar.category==='Moon'?<><p>{currentMoon.phaseName} · {Math.round(currentMoon.illumination*100)}% illuminated</p><Button onClick={()=>{setInspectedSolar(null);setPage('moon');}}>Open lunar atlas</Button></>:<p>Binoculars show a bright point or small disc. A telescope is needed for fine planetary detail.</p>}</>}</DialogContent></Dialog>
      <Dialog open={!!inspectedStar} onOpenChange={open=>{if(!open)setInspectedStar(null);}}><DialogContent className="star-detail-dialog"><DialogHeader><DialogTitle>{inspectedStar?displayName(inspectedStar):"Star"}</DialogTitle><DialogDescription>Bright Star Catalogue · {formatInTimeZone(date,timezone,"MMM d, yyyy · HH:mm")} local</DialogDescription></DialogHeader>{inspectedStar&&(()=>{const target=starPlanningTarget(inspectedStar);const pos=eqToHorizontal(target.ra,target.dec,lat,lon,date);const node:SkyNode={...inspectedStar,...pos,id:target.id,name:target.name,type:"star"};return <>
        <p className="object-location">Magnitude {target.mag.toFixed(1)} · {Math.round(pos.alt)}° {compassLabel(pos.az)} · {altitudeLabel(pos.alt)}</p>
        {/* The shared object verbs (Catalog and Photos would reopen this dialog: a plain BSC star's entry is this dialog). */}
        <ObjectActionRow objectId={target.id} name={displayName(inspectedStar)} actions={objectActions} at={date} omit={["catalog","images"]} variant="full"
          hopDisabled={pos.alt<0?"Below the horizon at this time":undefined} saved={savedIds.has(target.id)} onToggleSave={()=>toggleSave(target.id)} onBefore={()=>setInspectedStar(null)}/>
        <Suspense fallback={null}><ObjectJourneyLinks objectId={target.id} actions={objectActions} compact sky={journeySky}/></Suspense>
        {selected&&<div className="star-dialog-hop-tools" aria-label={`Your hop to ${displayName(selected)}`}>
          <Button variant="outline" disabled={computing||loading||inspectedStar.mag>Math.min(4.5,limitingMag)||pos.alt<5} onClick={()=>{const id=inspectedStar.id;update({startStarId:id});setInspectedStar(null);void compute(undefined,id);}}>Start hop from this star</Button>
          {inspectedStar.mag<=limitingMag&&pos.alt>=5&&<Button variant="outline" disabled={(settings.waypointIds?.length??0)>=8||settings.waypointIds?.includes(inspectedStar.id)} onClick={()=>{update({waypointIds:[...(settings.waypointIds??[]),inspectedStar.id]});setInspectedStar(null);setPage("hop",targetId);}}>Add required guide waypoint</Button>}
          <p className="setup-hint">Destination: {displayName(selected)}. Starting references must be above 5° and magnitude {Math.min(4.5,limitingMag).toFixed(1)} or brighter at your observing time.</p>
        </div>}
        <SkyChart isBinocular={mode==="binocular"} onEditSetup={()=>setSetupOpen(true)} setupSummary={`${fov.toFixed(1)}° field · stars to mag ${limitingMag.toFixed(1)}`} onSelect={selectTarget} nodes={[...previewNodes.filter(s=>s.id!==inspectedStar.id),node]} constellations={catalogs.constellations} route={null} targetNode={node} animStep={0} fovWidth={fov} fovHeight={shape==="circle"?fov:fovHeight} fovShape={shape} lat={lat} lon={lon} date={date} limitingMag={limitingMag} denseStars={catalogs.dense} milkyWay={catalogs.milkyWay} onFovChange={width=>update({fov:width,...(shape==="circle"?{fovHeight:width}:{})})} onLimitingMagChange={value=>update({limitingMag:value})}/><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness}/></>;})()}</DialogContent></Dialog>
      <Dialog open={instrumentOpen} onOpenChange={setInstrumentOpen}>
        <DialogContent className="instrument-choice-dialog">
          <DialogHeader><DialogTitle>Choose your instrument</DialogTitle><DialogDescription>Start with a finder field that suits your view. Adjust the field width below the chart to match your optics.</DialogDescription></DialogHeader>
          <div className="instrument-choice-options">
            <button onClick={() => compute("binocular")}><Binoculars size={25}/><span>Binoculars</span><small>Your binocular field · wide views</small></button>
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
            <p><strong>What the sky conditions mean.</strong> The weather panel fetches and caches Open-Meteo forecasts for the selected site; coverage and model agreement are shown explicitly. Seeing and transparency are estimates rather than measurements. Local light pollution is a configurable assumption, and terrain obstructions are not modeled. Astronomical darkness describes the Sun’s position and does not promise clear conditions. Object magnitudes are catalog values and do not predict visibility by themselves.</p>
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
      <Dialog open={siteChange!==null} onOpenChange={open=>{if(!open)setSiteChange(null);}}>
        <DialogContent className="context-dialog">
          <DialogHeader><DialogTitle>Change observing site?</DialogTitle><DialogDescription>{activeSession?`Your active night “${activeSession.name}” is saved at ${activeSession.locationName||knownLocationName(savedLocations,activeSession.lat,activeSession.lon)||`${activeSession.lat.toFixed(2)}°, ${activeSession.lon.toFixed(2)}°`}. Choose whether to move that night or browse ${siteChange?.name??"the new site"}.`:"Choose how to apply this site."}</DialogDescription></DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={()=>finishSiteChange(false)}>Browse this site only</Button>
            {activeSession&&<Button onClick={()=>finishSiteChange(true)}>Move this night to {siteChange?.name}</Button>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </NightVisionFilter></ObservingContextProvider>
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
