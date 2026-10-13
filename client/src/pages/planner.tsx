import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import tzLookup from "tz-lookup";
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
import {
  SkyOverview,
  ObjectArt,
  AltitudeChart,
} from "@/components/ObservingVisuals";
import { ImageFallback } from "@/components/ImageFallback";

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
type Page = "tonight" | "hop" | "night" | "image";

export default function PlannerPage() {
  const { toast } = useToast();
  const [settings, setSettings, settingsError] = useLocalState(
    "starhop-settings-v2",
    defaultSettings,
    settingsSchema,
  );
  const [night, setNight, nightError] = useLocalState<NightItem[]>(
    "starhop-night-v2",
    [],
    nightListSchema,
  );
  const update = (patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));
  const [page, setPage] = useState<Page>("tonight");
  const [setupOpen, setSetupOpen] = useState(false);
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
  const [algorithm, setAlgorithm] = useState<CostStrategyId>("auto");
  const [computing, setComputing] = useState(false);
  const [findingTime, setFindingTime] = useState(false);
  const [routeResult, setRouteResult] = useState<{
    key: string;
    result: Awaited<ReturnType<typeof planRoutes>>;
  } | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3500);
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
  const timezone = useMemo(() => tzLookup(lat, lon), [lat, lon]);
  const date = useMemo(
    () => fromZonedTime(`${settings.date}T${settings.time}:00`, timezone),
    [settings.date, settings.time, timezone],
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
    ],
  );
  const paramsKey = JSON.stringify(params);
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
  const selection = ranked.find((t) => t.target.id === targetId);
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
          (!query ||
            `${o.target.id} ${o.target.name} ${o.target.category} ${getConstellationName(o.target.con)}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [ranked, visibleOnly, friendlyOnly, category, query],
  );
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
          type: selected.source === "messier" ? "messier" : "binocular",
        }
      : null;

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
    update({ targetId: id });
  }
  function toggleSave(id: string) {
    setNight((prev) =>
      prev.some((t) => t.id === id)
        ? prev.filter((t) => t.id !== id)
        : [...prev, { id, addedAt: new Date().toISOString(), notes: "" }],
    );
  }
  function markObserved(id: string) {
    setNight((prev) =>
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
          ],
    );
  }
  function useNow() {
    update({
      date: formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"),
      time: formatInTimeZone(new Date(), timezone, "HH:mm"),
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
  async function compute() {
    setPage("hop");
    setComputing(true);
    setPlaying(false);
    const key = paramsKey;
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const computed = await planRoutes(params);
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
    const lines = [
      `# My StarHop observing night`,
      `${settings.date} at ${settings.time} (${timezone})`,
      `Location: ${lat}°, ${lon}° · ${mode} · ${fov}° field`,
      "",
    ];
    night.forEach((item) => {
      const t = catalogs.targets.find((t) => t.id === item.id);
      lines.push(
        `## ${t?.displayName || item.id}`,
        item.observedAt
          ? `Observed: ${formatInTimeZone(new Date(item.observedAt), timezone, "MMM d, yyyy HH:mm")}`
          : "To observe",
        item.notes || "",
        "",
      );
    });
    download(
      lines.join("\n"),
      `starhop-night-${settings.date}.md`,
      "text/markdown",
    );
  }
  function exportRoute() {
    if (!route || !selected) return;
    download(
      [
        `# Star hop to ${selected.displayName}`,
        `${settings.date} ${settings.time} (${timezone}) · ${lat}°, ${lon}°`,
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

  const dateLabel = formatInTimeZone(date, timezone, "EEE, MMM d");
  const locationLabel =
    lat === 37.77 && lon === -122.42
      ? "San Francisco · default location"
      : `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
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
              ["hop", "Star hop", Navigation],
              ["night", "My night", BookOpen],
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
            className="icon-button mobile-setup-toggle"
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

      <div className="workspace-layout">
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
                  value={settings.date}
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !isNaN(new Date(e.target.value).getTime())
                    )
                      update({ date: e.target.value });
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
                  value={settings.time}
                  onChange={(e) => {
                    if (e.target.value) update({ time: e.target.value });
                  }}
                  data-testid="input-time"
                />
              </div>
            </div>
            <p className="setup-hint mt-2">{timezone.replaceAll("_", " ")}</p>
          </section>
          <section className="setup-section">
            <div className="section-label">
              <Binoculars size={16} />
              <h2>Your window to the sky</h2>
            </div>
            <div className="equipment-options">
              <button
                className={mode === "binocular" ? "selected" : ""}
                aria-pressed={mode === "binocular"}
                onClick={() =>
                  update({
                    mode: "binocular",
                    fov: 7,
                    fovHeight: 7,
                    shape: "circle",
                    limitingMag: 6.5,
                  })
                }
                data-testid="button-mode-binocular"
              >
                <Binoculars size={22} />
                <span>Binoculars</span>
                <small>Wide & easy</small>
              </button>
              <button
                className={mode === "telescope" ? "selected" : ""}
                aria-pressed={mode === "telescope"}
                onClick={() =>
                  update({
                    mode: "telescope",
                    fov: 5,
                    fovHeight: 5,
                    limitingMag: 8,
                  })
                }
                data-testid="button-mode-telescope"
              >
                <Telescope size={22} />
                <span>Small telescope</span>
                <small>Finder & eyepiece</small>
              </button>
            </div>
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
          {(settingsError || nightError) && (
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
          {page === "tonight" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">LOOK UP. THERE’S A WHOLE UNIVERSE.</p>
                  <h1>
                    A little wonder, tonight<span>.</span>
                  </h1>
                  <p>
                    Find your next faint fuzzy, familiar friend, or first
                    discovery.
                  </p>
                </div>
                <div className="date-stamp">
                  <span>{dateLabel}</span>
                  <strong>{settings.time}</strong>
                  <small>AT YOUR OBSERVING LOCATION</small>
                </div>
              </div>
              <div className="conditions-strip">
                <Condition
                  icon={<Sparkles />}
                  label="Sky at your time"
                  value={conditions.darkness}
                  detail={
                    conditions.isDark
                      ? "Sun below −18°"
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
                  label="Above 15° at your time"
                  value={`${ranked.filter((t) => t.alt >= 15).length} objects`}
                  detail="From the combined catalogs"
                />
                <Condition
                  icon={<BookOpen />}
                  label="Your observing list"
                  value={`${night.length} saved`}
                  detail={`${observed} observed · saved on this device`}
                />
              </div>
              <div className="tonight-hero">
                <section className="panel sky-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">GET YOUR BEARINGS</span>
                      <h2>Your sky, overhead</h2>
                    </div>
                    <span className="live-label">
                      <span className="status-dot" />
                      {settings.time} local
                    </span>
                  </div>
                  {loading ? (
                    <div className="sky-loading">
                      <Loader2 className="animate-spin" />
                      <p>Opening the sky atlas…</p>
                    </div>
                  ) : (
                    <SkyOverview
                      stars={catalogs.stars}
                      constellations={catalogs.constellations}
                      objects={ranked}
                      lat={lat}
                      lon={lon}
                      date={date}
                      selectedId={targetId}
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
                  <section className="panel featured-object">
                    <div className="featured-art">
                      <ObjectArt target={selected} />
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
                      <p className="equipment-tag">
                        <Binoculars size={14} />
                        {guideFor(selected).equipment}
                      </p>
                      <div className="featured-actions">
                        <Button
                          onClick={compute}
                          disabled={computing || loading}
                          data-testid="button-compute"
                        >
                          <Navigation size={15} />
                          Show me the way
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
                    {filtered.length} objects match your setup
                  </span>
                </div>
                <div className="discovery-toolbar">
                  <div className="search-field">
                    <Search size={16} />
                    <Input
                      placeholder="Search objects, constellations…"
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
                <div className="object-grid">
                  {filtered.slice(0, limit).map((o) => (
                    <TargetCard
                      key={o.target.id}
                      object={o}
                      saved={savedIds.has(o.target.id)}
                      selected={targetId === o.target.id}
                      onSelect={() => selectTarget(o.target.id)}
                      onSave={() => toggleSave(o.target.id)}
                      onHop={() => {
                        selectTarget(o.target.id);
                        setPage("hop");
                      }}
                    />
                  ))}
                </div>
                {!loading && !filtered.length && (
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
                {filtered.length > limit && (
                  <button
                    className="load-more"
                    onClick={() => setLimit(limit + 12)}
                  >
                    Explore more objects
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
                    Find a dark window
                  </Button>
                  <Button
                    onClick={compute}
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
                    Use “Find a dark window” or choose a different time.
                  </span>
                </div>
              )}
              {result && !result.routes.length && (
                <div className="notice warning">
                  <Compass size={16} />
                  <span>
                    {result.belowHorizon
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
                      </small>
                      {routeIndex === i && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
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
                    nodes={result?.nodes ?? previewNodes}
                    constellations={catalogs.constellations}
                    route={route}
                    targetNode={result?.targetNode ?? previewTarget}
                    animStep={step}
                    fovWidth={fov}
                    fovHeight={shape === "circle" ? fov : fovHeight}
                    fovShape={shape}
                    lat={lat}
                    lon={lon}
                    date={date}
                    limitingMag={limitingMag}
                    denseStars={catalogs.dense}
                    milkyWay={catalogs.milkyWay}
                  />
                  <div className="chart-footnote">
                    Equatorial map · north up, east left · drag to pan, pinch to
                    zoom
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
                              ? `${hop.distanceDeg.toFixed(1)}° ${hop.direction}`
                              : "Starting field"}
                          </span>
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
                            onClick={() => {
                              if (step < route!.hops.length - 1) {
                                setStep(step + 1);
                                setPlaying(false);
                              } else {
                                markObserved(targetId);
                              }
                            }}
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
              <div className="page-heading">
                <div>
                  <p className="eyebrow">SMALL DISCOVERIES, WORTH KEEPING</p>
                  <h1>
                    Make a night of it<span>.</span>
                  </h1>
                  <p>
                    Your observing list and field notes, saved on this device.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={exportNight}
                  disabled={!night.length}
                >
                  <Download size={15} />
                  Export notes
                </Button>
              </div>
              <div className="night-summary">
                <span>
                  <BookOpen size={17} />
                  <strong>{night.length}</strong> on your list
                </span>
                <span>
                  <CheckCircle2 size={17} />
                  <strong>{observed}</strong> observed
                </span>
                <div className="night-progress">
                  <div
                    style={{
                      width: `${night.length ? (observed / night.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              {!night.length && (
                <div className="panel empty-state night-empty">
                  <BookOpen size={38} />
                  <h2>A night starts with a little curiosity.</h2>
                  <p>
                    Add objects with the + button, follow their star hops, and
                    keep a note of what you saw.
                  </p>
                  <Button onClick={() => setPage("tonight")}>
                    <Compass size={16} />
                    Find something wonderful
                  </Button>
                </div>
              )}
              <div className="night-list">
                {night.map((item) => {
                  const object = ranked.find((o) => o.target.id === item.id);
                  if (!object) return null;
                  return (
                    <article
                      key={item.id}
                      className={`panel night-item ${item.observedAt ? "observed" : ""}`}
                    >
                      <div className="night-item-art">
                        <ObjectArt target={object.target} compact />
                      </div>
                      <div className="night-item-body">
                        <div className="flex justify-between gap-3">
                          <div>
                            <span className="eyebrow">
                              {object.target.id} · {object.target.category}
                            </span>
                            <h2>{object.target.name}</h2>
                            <p className="object-location">
                              {getConstellationName(object.target.con)} ·{" "}
                              {Math.round(object.alt)}°{" "}
                              {compassLabel(object.az)} ·{" "}
                              {altitudeLabel(object.alt)}
                            </p>
                          </div>
                          <button
                            className="icon-button"
                            onClick={() => toggleSave(item.id)}
                            aria-label={`Remove ${object.target.name} from my night`}
                            title="Remove from list"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="night-item-actions">
                          <button
                            className={`observed-toggle ${item.observedAt ? "active" : ""}`}
                            onClick={() => markObserved(item.id)}
                          >
                            {item.observedAt ? (
                              <CheckCircle2 size={16} />
                            ) : (
                              <Circle size={16} />
                            )}
                            {item.observedAt
                              ? `Observed ${formatInTimeZone(new Date(item.observedAt), timezone, "MMM d")}`
                              : "Mark as observed"}
                          </button>
                          <button
                            className="text-action"
                            onClick={() => {
                              selectTarget(item.id);
                              setPage("hop");
                            }}
                          >
                            Star hop
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                        <Label
                          htmlFor={`note-${item.id}`}
                          className="field-label"
                        >
                          Your field notes
                        </Label>
                        <Textarea
                          id={`note-${item.id}`}
                          placeholder="What caught your eye? Conditions, colors, a sketch to try next time…"
                          value={item.notes}
                          onChange={(e) =>
                            setNight((prev) =>
                              prev.map((t) =>
                                t.id === item.id
                                  ? { ...t, notes: e.target.value }
                                  : t,
                              ),
                            )
                          }
                          rows={2}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
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
        data-testid={`target-${target.id}`}
      >
        <div className="target-thumbnail">
          <ObjectArt target={target} compact />
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
          setInvalid(false);
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
          Use {min} to {max}°.
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
