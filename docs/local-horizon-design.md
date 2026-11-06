# Local horizon: design

Status: design agreed with the owner on 2026-11-06. Phase 1 (terrain horizon and app-wide use) is being built now.
The shared contract is `client/src/lib/horizon/types.ts`. Where this document and the code disagree, the code wins and
this document should be updated.

Research behind this design (desk research and measurements, 2026-11-06) is summarised here; the sources are listed in
[References](#references). Citations belong in this document only. The app itself shows plain explanations, never
citations (owner rule). Licence attributions for terrain data are a separate legal requirement (see
[Attribution](#attribution-and-licences)).

---

## 1. Goal and user story

**Goal.** StarHop should know the real skyline at an observing site, and use it everywhere it currently assumes a flat
horizon or a fixed minimum altitude.

**User story.** "I stand where I set up my telescope. Without doing anything, StarHop already knows the hills and
mountains around me. If I want, I sweep my phone around once (about a minute) so it also learns my trees and the
neighbour's roof. From then on, Tonight, Best tonight, rise and set times, the session planner and Sky Journeys only
suggest things I can actually see from that spot, and tell me when something clears the trees. I can look around a 360°
picture of my site with the stars drawn over it and drag a time slider to see when a target comes out from behind the
oak."

What success looks like:

- Terrain horizon appears for any site with zero taps, and works offline once computed.
- Photo capture takes about 1–2 minutes and at most three deliberate taps (start, optional alignment tap, save).
- Verdicts are honest: "clear", "marginal" (near the skyline, within the uncertainty) or "blocked", never a false
  precision.

## 2. What the owner said vs what we assume

| Topic | Owner decision (fixed) | Assumption (check later) |
|---|---|---|
| Where it runs | Everything on the phone in the PWA. No backend, no native app, no third-party app. | Chrome on Android is the target. iOS Safari lacks the Generic Sensor API; it gets terrain only until tested. |
| Optional server | The DGX Spark over Tailscale is an optional later "HQ" path only. | It is reachable only on the owner's tailnet, so it can never be required. |
| Layers | Two independent layers, TERRAIN and PHOTO, combined only at query time (max per azimuth), never merged. | Overhangs (gaps under tree crowns) are handled later from the stored mask, not the profile. |
| Terrain | Automatic from GPS and elevation tiles. Mapterhorn first, AWS Terrarium as fallback. Ray cast in a Web Worker. Stored per site. | 100 km reach is enough for nearly all sites; 1° azimuth bins are enough. |
| Viewer overlay | Terrain line drawn over the photos, PeakFinder-style. Agreement validates alignment; disagreement where hills form the skyline solves north and FOV. | Works only where distant hills form part of the skyline. Backyards fall back to other methods. |
| Camera calibration | Automatic: FOV (optionally one radial distortion term) from frame overlaps vs gyro rotation, stored once per device. | The video stream FOV is stable for a given camera and resolution. Stabilisation crop is the main unknown. |
| Day or night | Compass + magnetic declination as the first guess, then all of: tap the Sun, tap Moon/planet/bright star, automatic terrain match, drag a landmark. Keep the best one with its uncertainty. | Planets and bright stars are visible in the live preview at twilight. |
| Segmentation | Day/twilight: SegFormer-B0 ADE20K (Transformers.js/ONNX, lazy ~8 MB), guided-filter refinement, soft alpha for foliage, brush fixes. Night: user traces the skyline with a finger on a brightened frame. | WebGPU is available on the owner's phone; WASM fallback is acceptable at 10–60 s. |
| Geometry | No feature stitching. Sensor placement (RelativeOrientationSensor for geometry, AbsoluteOrientationSensor for heading, median offset). Optional overlap refinement. | Gyro drift over a 2-minute sweep is about 1° or less. |
| Viewer | Browsable 360°, Photo Sphere Viewer (lazy) or custom WebGL; stars and targets; time slider with one rotation per tick. | Photo Sphere Viewer is the default; custom WebGL only if bundle size becomes a problem. |
| Exports | Stellarium polygonal and NINA `.hrz` text. | The plain "az alt" text list also works for Telescopius, Cartes du Ciel, KStars. |
| Testing | Unit tests on synthetic elevation data; a simulation harness with Chrome fake camera and DevTools sensor overrides. | Only stabilisation crop, real drift and model speed need the real phone. |

## 3. Background in one page

- **Prior art.** Mobile Observatory added a terrain horizon (SRTM) and a finger-drawn horizon in 2026 and uses them for
  rise/set and "Tonight's Best". Observer Pro (iOS) traces the tree line with the camera and is praised as "couldn't be
  simpler". PeakFinder and PeakVisor draw a terrain skyline over the camera and correct the compass by matching it.
  Stellarium, NINA, Telescopius and SkySafari all read horizons, but users complain about multi-tool pipelines and
  imprecise north alignment. What users praise is the horizon being used everywhere, not the pretty panorama.
- **Photo Sphere is gone** on Pixel 8 and later. Most Android users in 2026 have no first-party 360° capture, so
  StarHop must capture inside the app. Importing a 360° photo is an optional extra.
- **The compass is the weak link.** Phone heading errors of 5–10° are typical and 30° near cars or metal. Level (from
  gravity) is good to about 1–2°. Relative rotation from the gyro is good to about 1° over a short sweep.
- **Terrain is cheap.** About 20–30 keyless, CORS-enabled tiles (3–5 MB) and a ray cast of under 1 s on desktop
  (1–2 s on a phone) give a 360-value profile that agrees with PVGIS to about 0.15° where the skyline is far away.

## 4. Architecture

### 4.1 Overview

```
            GPS / saved site                           guided camera sweep (phase 2)
                  |                                              |
        terrain.worker (fetch tiles, ray cast)     capture/ -> calibrate/ -> segment/
                  |                                              |
        HorizonProfile kind='terrain'               HorizonProfile kind='photo' (+ mask in IndexedDB)
                  \                                              /
                   \------------ store (per site) --------------/
                                       |
        profile.ts: threshold(az) = max over layers of geometric-equivalent skyline; isAboveLocalHorizon
                                       |
   Tonight / Best tonight / rise-set / binocular guide / session planner / journeys / SkyChart / viewer / exports
```

The two layers never write into each other. The terrain layer has exact geometry and needs no lens or north
calibration; the photo layer depends on calibration and alignment. If a photo calibration is wrong, deleting or
recapturing the photo layer restores the terrain-only horizon untouched.

### 4.2 Units

Signatures below are the intended shape. Phase 1 code is the source of truth.

| Unit | Phase | Responsibility | Main interface |
|---|---|---|---|
| `lib/horizon/types.ts` | 1 | Shared contract: `HorizonProfile`, `LocalHorizon`, `TerrainStatus`, `HorizonLayerKind`. | (exists) |
| `lib/horizon/terrain.ts` | 1 | Pure functions: tile maths, Terrarium decoding, distance-based zoom ladder, ray cast with curvature and refraction. No DOM, no fetch of its own (takes a tile loader), so it is unit-testable with synthetic tiles. | `computeTerrainProfile(lat, lon, loadTile, opts) → Promise<HorizonProfile>`; `decodeTerrarium(rgba) → Float32Array`; `zoomForDistance(d, lat, tolDeg)` |
| `lib/horizon/terrain.worker.ts` | 1 | Runs `terrain.ts` off the main thread. Fetches Mapterhorn WebP tiles, falls back to AWS Terrarium PNG on failure. Decodes with `createImageBitmap(..., {colorSpaceConversion:'none', premultiplyAlpha:'none'})` on an `OffscreenCanvas`. | messages in: `{type:'compute', id, lat, lon, opts}`; out: `{type:'progress', id, progress}`, `{type:'done', id, profile}`, `{type:'error', id, message, offline?}` |
| `lib/horizon/profile.ts` | 1 | Pure queries (section 4.4): apparent skyline for display, geometric-equivalent threshold for comparisons, hot-loop lookup, worker-friendly compact form, cache-key fingerprint, clear intervals (rise/set above the skyline), 8-direction summary for journeys, one-sentence summary. Text export/import is phase 4. | `horizonAltitudeAt(h, az)` (apparent, display), `horizonThresholdAt(h, az)`, `isAboveLocalHorizon(h, alt, az, margin)`, `clearanceDeg(h, alt, az)`, `horizonLookup(h)`, `compactHorizon(h) → CompactHorizon`, `horizonFingerprint(h)`, `clearIntervals(samples, h, {position})`, `blockedDirections8(h, deg)`, `compassWord(az)`, `horizonSummary(profile)`, `refractionDeg`, `geometricFromApparent` |
| `lib/horizon/store.ts` | 1 | Per-site storage of layers in localStorage, site keys, validation, size cap (section 5.1). | `horizonSiteKey(lat, lon)`, `readLocalHorizon(lat, lon) → LocalHorizon \| null`, `saveHorizonLayer(profile)`, `removeHorizonLayer(lat, lon, kind?)`, `storedHorizonSites()`, `storedHorizonKindsNear(sites, lat, lon)` |
| `lib/horizon/terrain-jobs.ts`, `terrain-client.ts` | 1 | One shared worker run per site for every component that asks (module-level registry), cancelled when nobody shows the site any more; automatic retry after 5 minutes on failure. | `startTerrainJob(lat, lon, forced?)`, `retainTerrainSite(key)`, `readSiteHorizon(lat, lon)`, `computeTerrainInWorker(lat, lon, opts)` |
| `lib/horizon/prefs.ts` | 1 | Global "Use my local horizon" switch (default on). Off: every view behaves as with a flat horizon; stored layers are kept. | `localHorizonEnabled()`, `setLocalHorizonEnabled(on)`, `activeStoredHorizon(lat, lon)` (non-React callers: exports, chain sources) |
| `hooks/use-local-horizon.ts` | 1 | React glue: reads the stored horizon, starts the shared terrain job when nothing is stored nearby (after a 1.5 s debounce, online only), exposes status. Every component that knows the site calls it itself; they share one computation. | `useLocalHorizon(lat, lon) → { horizon, status, recompute }`, `useLocalHorizonPreference()` |
| `components/LocalHorizonPanel.tsx` | 1 | Site dialog block (current site only): on/off switch, status and summary sentence, skyline silhouette chart, Recompute/Retry, "use ground height from the terrain map", terrain credits line. | `<LocalHorizonPanel lat lon elevation />` |
| `lib/horizon/capture/` | 2 | Camera stream (rear camera, 4:3), orientation sensors at 60 Hz, ring guide, still-detection, auto-capture, frame records. | `startCapture(opts) → CaptureSession`; frames `{bitmap, qRel, qAbs, t}` |
| `lib/horizon/calibrate/` | 2 | FOV (and optional `k1`) from overlaps; compass offset; declination (WMM); celestial, terrain and landmark yaw fixes; choose best yaw. | `solveFov(frames) → {hfovDeg, k1?, sigma}`; `yawFrom*(…) → YawFix`; `bestYaw(fixes) → YawFix` |
| `lib/horizon/segment/` | 2 | Lazy SegFormer worker, classical prior, guided filter, night trace, projection into the 0.25° grid, derived photo profile. | `segmentFrame(bitmap) → alpha`; `projectToGrid(frames, poses, alphas) → SkyGrid`; `gridToProfile(grid) → HorizonProfile` |
| `lib/horizon/viewer/` | 3 | Lazy 360° viewer, star layer, target markers, time slider, terrain overlay line, drag-to-align. | `<HorizonViewer site horizon />` (route chunk) |

Workers follow the existing pattern (`new Worker(new URL('./x.worker.ts', import.meta.url), {type:'module'})`, as in
`route-client.ts` and `journeys/journey-client.ts`).

### 4.3 Terrain algorithm (phase 1)

Parameters (from the prototype in the research notes):

| Parameter | Value | Why |
|---|---|---|
| Azimuth step | 1° (360 rays) | 0.5° costs 2× compute but no extra tiles; consider later for sharp peaks. |
| Start distance | 150 m | Closer ground is dominated by GPS error and is the photo layer's job. |
| Max distance | 100 km (200 km if local relief > 2 km) | 0.5° altitude at 100 km needs 1.5 km of relief. |
| Zoom ladder tolerance | 1° per DEM pixel at distance | MAE 0.02–0.08° vs the finest setting; 18–22 Mapterhorn tiles, 3–4 MB. |
| Earth curvature + terrestrial refraction | drop = d²(1−k)/2R, R = 6 371 km, k = 0.13 | 0.20° at 50 km, 0.39° at 100 km. |
| Observer height | DEM ground at site + 1.7 m eye | GPS altitude is ±10–30 m and is the biggest near-field error. |
| Output | `alt[360]` apparent degrees, `distanceKm[360]`, `groundM`, `source` | Negative values are kept (elevated sites). |

Each ray steps by `max(10 m, half a pixel at the chosen zoom)`, samples bilinearly, keeps the maximum of
`atan2(h − h0 − drop, d)` and the distance where it occurred. Tiles are fetched with at most 6 parallel requests and are
not kept after the computation (only the 360-number result is stored). Source order: Mapterhorn
(`tiles.mapterhorn.com/{z}/{x}/{y}.webp`, 512 px, z ≤ 17) then AWS (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
256 px, z ≤ 15). Never use the AWS EU replica (403). PVGIS and HeyWhatsThat are not usable from a browser.

### 4.4 Combining the layers at query time

```
skylineAlt(az) = max(terrain.alt(az), photo.alt(az))       // each linearly interpolated, azimuth wraps at 360
sigma(az)      = sigma of whichever layer wins at az
```

The terrain profile is apparent altitude (terrestrial refraction included); the photo layer is measured, so also
apparent. Stored profiles and every display of the skyline (charts, summaries) use these apparent values.

The app's star and deep-sky altitudes are **geometric** (`eqToHorizontal`, journeys `fastAltAz`), so phase 1 compares
them with the skyline's **geometric-equivalent threshold** instead: `threshold(az) = skylineAlt(az) − R(skylineAlt(az))`,
where R is Bennett's astronomical refraction for an apparent altitude (about 0.57° at 0°, 0.16° at 5°). Every
comparison goes through `lib/horizon/profile.ts` (`isAboveLocalHorizon`, `clearanceDeg`, `horizonThresholdAt`,
`horizonLookup`, `clearIntervals`, `compactHorizon` for workers); nothing compares a raw profile value with a star
altitude. Planets (`getPlanetPositions`) and the Moon (`moonState`) have apparent altitudes; they are converted first
(`alt − refractionDeg(alt)` / `geometricFromApparent`). Astronomical refraction is the same size as the error budget, so
mixing apparent and geometric values is a real bug to test for.

A minimum altitude (comfort, atmosphere: the Planner's 15°, journeys' lowest stop, catalog filters) combines with the
skyline and never replaces it: a target needs `alt ≥ max(minAlt, threshold(az))` (decided, Q1). Airmass, extinction and
sky brightness keep the true altitude; twilight and moonlight stay flat (a Moon behind a ridge still lights the sky).
"Behind the hills" is its own reason everywhere (`LimitFactor`/`RejectReason` `'terrain'`), distinct from "low in the
sky". With no horizon known (none stored, offline before the first computation, or the switch off) every comparison
keeps the flat rule and the app behaves exactly as before.

Phase 1 uses this binary clear/hidden test (with an optional margin). The uncertainty-aware verdict below is planned
for the photo layer (phase 2), where σ matters.

Verdict for a target at (az, alt):

| Verdict | Rule |
|---|---|
| clear | `alt ≥ skylineAlt(az) + 2·σ_eff` |
| marginal | within ±2·σ_eff of the skyline |
| blocked | `alt ≤ skylineAlt(az) − 2·σ_eff` |

`σ_eff = sqrt(σ_alt² + (slope(az)·σ_az)²)`, where `slope` is the skyline's local d(alt)/d(az). At a tree trunk or
roof corner the slope is steep, so an azimuth error turns into a large altitude error; this makes gaps honestly
"marginal" when north is uncertain. Terrain σ: 0.2° when the skyline is more than 5 km away, 1° when 1–5 km, 2° below
1 km (from the PVGIS comparison). The user's existing minimum-altitude setting still applies on top: an object must
also be above that value (Q1, decided).

### 4.5 How the horizon feeds the app

| Place | Today | With the horizon |
|---|---|---|
| Tonight / Best tonight lists | Object above a flat minimum altitude | Hidden objects get the below-horizon penalty, are not feasible and have no binocular rating; the filter reads "Above 15° and clear"; cards say "behind the hills". Star-hop routes drop hidden sky nodes and start stars (`ObservingParams.horizon`). |
| Best-time windows, rise/set | Rise/set at 0° or minimum altitude | Times when the object crosses the skyline: sampled every 5 min, refined by bisection (`clearIntervals`, `targetSkylineEvents`); "Clears your skyline 21:10". Moon-free windows can split into several. |
| Binocular guide | Altitude only | Highest clear altitude per window; cards say "Behind the hills to the southwest at 21:00". |
| Session planner | Flat horizon | Order, closing times and reasons use the skyline ("Behind the hills to the west until 23:10"). |
| Sky Journeys | `openDirections: Compass8[]` + `minAlt` (`lib/journeys/conditions.ts`) | Open directions are seeded from `blockedDirections8` until the user picks their own for the site; every stop is also checked against the per-azimuth threshold (`JourneyRequest.horizon`, reject reason `'terrain'`). Journey keys never carry the skyline. |
| Sky chart | Horizon circle | Overview mode only: skyline drawn as a dark silhouette band between the horizon circle and the threshold. |
| Viewer (phase 3) | — | 360° photo with stars, targets and the terrain line. |
| Exports (phase 4) | — | Stellarium polygonal, NINA `.hrz`. |

## 5. Data model and storage

### 5.1 Profiles (phase 1 onwards): localStorage

- Key `starhop-local-horizon-v1`, value `Record<siteKey, { savedAt: number; terrain?: HorizonProfile; photo?: HorizonProfile }>`
  (`lib/horizon/store.ts`). Every stored layer is validated on read; anything malformed is dropped.
- `siteKey` = lat and lon rounded to 3 decimals (about 100 m). A stored layer is reused anywhere within 200 m of where
  it was computed. A new site is computed automatically (online, after a 1.5 s debounce) when nothing is stored within
  200 m; otherwise only on request (Recompute). There is no age-based recompute yet.
- Layers are stored rounded to 0.1° and 0.1 km (about 3–4 KB per site with distances). Cap at 30 sites, the oldest
  write dropped first; on a quota error the newest half is kept.
- The global "Use my local horizon" switch is stored separately under `starhop-local-horizon-prefs-v1` as
  `{ enabled: boolean }` (default on; `lib/horizon/prefs.ts`).
- Backups (`lib/backup.ts`) exclude horizons: terrain is recomputable from the tiles. Shared plans never include them
  either (they describe the sender's site). Photo data (phase 2) will need its own export.
- Offline: the computed profile is enough; tiles are not cached. Saved locations show "horizon saved" when a terrain
  layer is stored nearby; it is computed when the site is first used online (not precomputed for every saved location).

### 5.2 Device calibration (phase 2): localStorage

Key `starhop-camera-calibration-v1`: per camera (track label + resolution + 4:3 or 16:9) store
`{ hfovDeg, vfovDeg, k1?, sigmaDeg, samples, updatedAt }`. Every new sweep refines it (running weighted mean) and a
large jump (> 3%) is treated as a different camera mode, not averaged.

### 5.3 Photo data (phase 2 onwards): IndexedDB

Database `starhop-horizon`, store `sites` keyed by `siteKey`. Call `navigator.storage.persist()` before the first save so
Chrome does not evict it.

| Item | Format | Size |
|---|---|---|
| Sky grid (source of truth for the photo layer) | uint8 alpha, 0.25°/px, az 0–360 × alt −10…+70 (1440 × 320), PNG | 20–100 KB |
| Panorama for the viewer | equirectangular WebP 4096 × 1024 (alt −10…+80), az 0 = north at x = 0 | 0.5–1.5 MB |
| Capture record | JSON: date, season (leaf-on/off), capture point note, device calibration used, yaw fix list with chosen source and σ, segmentation method and model version | < 2 KB |
| Raw frames | Not kept after processing (privacy and space) | — |

The photo `HorizonProfile` (`kind: 'photo'`, 1440 bins, `uncertaintyDeg` from alignment) is derived from the grid and
also stored in localStorage with the terrain profile, so the whole app keeps working from localStorage alone. The
grid in IndexedDB adds overhang handling (clear gaps under a tree crown) and the viewer. Total per site: about 1–2 MB.

## 6. Accuracy targets and error budget

**Targets:** skyline altitude ≤ 1–1.5°, azimuth ≤ 2°. With a magnetometer-only heading (5–10°) we still give an answer,
but with a wide "marginal" band.

**Why these numbers.** Near the horizon an object's altitude changes at about 15°/h · cos(latitude) · sin(azimuth):

| Latitude | Due E or W | Azimuth 120° | Azimuth 150° |
|---|---|---|---|
| 35° | 4.9 min per degree | 5.6 | 9.8 |
| 45° | 5.7 | 6.5 | 11.3 |
| 55° | 7.0 | 8.1 | 13.9 |

So 1° of altitude error is about 5–7 minutes near east and west, which is fine for planning. Near the meridian the
time error grows, but there the question is "does it clear at culmination", which the marginal band answers.

**Photo layer error budget** (one sigma, per frame unless noted):

| Source | Size | Mitigation |
|---|---|---|
| Level (pitch/roll from gravity) | 1–2° | Capture only when still; average samples. Celestial fixes also check pitch. |
| Relative yaw drift (gyro, 1–2 min) | 0.5–2° | Loop closure (last frame overlaps first); optional overlap refinement. |
| Absolute yaw, compass + declination | 5–10°, up to 30° | Seed only. Sun/Moon/planet/star tap, terrain match or landmark. |
| Declination model (WMM) | 0.3–0.5° | Included automatically. |
| FOV error | 3% gives about 1° at frame edge | Self-calibration to < 1%. |
| Video stabilisation crop | unknown, maybe 1–3° | Hold still before capture; check on a real phone. |
| Lens distortion residual | 0.1–0.5° at edge | Main camera only; optional `k1`. |
| Frame/sensor timing | ≈ 0 when still | Auto-capture only below 2°/s for 300 ms. |
| Arm parallax | 0.4–4° for a tree 5–30 m away | Rotate the phone around itself, close to the body. |
| Capture point vs eyepiece | up to ~11° for a tree 5 m away and 1 m offset | Capture standing at the telescope. |

**Terrain layer error** (vs PVGIS): 0.15° MAE for distant skylines; 0.5–0.7° MAE for valley sites with ridges 1–15
km away; several degrees for ridges under 1.5 km (observer height and DEM resolution). Refraction uncertainty is about
±0.05° at 100 km. 1° rays can miss a narrow peak. Elevation models differ: Copernicus is a surface model (includes some
forest and buildings), national LiDAR is bare earth, so near-field trees appear inconsistently. The photo layer covers
the near field.

## 7. Alignment strategy (true north)

All frames share one relative (gyro) frame, so a single good yaw fix aligns the whole sweep. Each method produces a
`YawFix { offsetDeg, sigmaDeg, source }`. The app keeps the fix with the smallest σ; the others are consistency checks.
If two fixes disagree by more than 3 combined σ, the app says so plainly ("the compass disagrees with the Sun by 14°;
using the Sun") and stores both.

| Method | When | Taps | Expected σ | How |
|---|---|---|---|---|
| Compass + declination (seed) | Always | 0 | 5–10° (30° near metal) | Median over the sweep of (absolute yaw − relative yaw), plus WMM declination (`geomagnetism`, WMM2025). A spread above about 3° means interference: suggest moving away from the car. |
| Tap the Sun | Day, Sun visible and above the skyline | 1 | 0.3–1° | Predicted Sun marker shown on the live preview; user centres the Sun in the reticle and taps. Centre-of-frame tap avoids FOV error. Also checks pitch. Auto-detect a saturated blob as a bonus. |
| Tap Moon / planet / bright star | Twilight and night | 1 per object | 0.5–1° | Same maths. The app lists the brightest objects above the skyline with their predicted positions. Two objects also fix roll. |
| Terrain skyline match | Distant hills form part of the skyline | 0 | 1–2° where it works | Photo skyline vs terrain profile: search yaw ±20° in 0.1° steps and FOV scale 0.95–1.05; robust (Huber) cost over bins where the terrain ridge is > 2 km away and the photo skyline is close to it. Accept only a sharp, unique minimum with residual < 0.5°; σ from the cost curvature. Rejects flat sites and backyards automatically. |
| Drag a landmark | Any time, in review or viewer | drag | 0.5–2° | Pick a landmark on the map (bearing from GPS coordinates), drag the photo until it lines up. Also the manual override for any other method. |

The terrain line drawn over the photos (viewer and review screen) shows the result: where hills form the skyline the
two lines should coincide. Agreement is the visible proof; disagreement feeds the terrain match.

## 8. Segmentation

| Situation | Method |
|---|---|
| Day, overcast or clear (best), and civil twilight | SegFormer-B0 ADE20K (`Xenova/segformer-b0-finetuned-ade-512-512`, fp16 7.9 MB, int8 4.4 MB) via Transformers.js, WebGPU with WASM fallback. Take P(sky) from the softmax, not the argmax. |
| Refinement | Weighted guided filter of P(sky) against the full-resolution frame, fused with a brightness/blue-ness prior. Recovers sky between leaves. Output soft alpha. |
| Model cannot load | Classical brightness/blue-ness threshold plus a per-column sky border. |
| Night | No automatic segmentation. Frame is brightened (gain, gamma, average of 8–16 still frames). The user traces the skyline with a finger across the strip; the trace snaps to the strongest edge within a few pixels. |
| Fixes | Brush to add or remove sky (two classes). SAM 2.1-tiny tap-to-fix (about 33 MB) only if the brush proves too slow. |
| Sun in frame | Mask a disc around the computed Sun position as "unknown" and fill from neighbouring frames; the guide warns before capture. |

Cells with alpha ≥ 0.5 are clear. Foliage gives intermediate alpha, stored as such. The model and runtime are fetched
only when the user opens the capture page, never in the service worker install.

**Licence note.** SegFormer weights are under the NVIDIA Source Code License (non-commercial, research or evaluation
use). ADE20K is also research-only. That is fine for a free hobby app but it is not open source. If StarHop ever
becomes commercial, switch to an MIT/Apache model (for example a small sky-only student distilled from OneFormer, MIT,
on the Spark).

## 9. UX flows (fewest clicks)

### Phase 1: terrain (zero taps)

1. The user picks or detects a site (as today). If no stored profile exists, the worker starts in the background.
2. A small line in the site/conditions area shows progress, then "Horizon: hills and mountains included". Offline with
   no stored profile: "Horizon: flat (no terrain data yet)". Errors fall back to flat, quietly.
3. All lists and times update when the profile arrives. Nothing blocks on it.
4. A settings switch "Use the real horizon" (default on). Turning it off restores flat-horizon behaviour.
5. Ridge distances let the UI say "hills to the east" vs "a nearby slope"; the sky chart shows the silhouette.

### Phase 2: capture (start, optional tap, save)

1. "Add trees and buildings" on the horizon card. Short instruction: stand where the telescope stands; turn the phone
   around itself, not at arm's length. Camera and motion permissions are requested here.
2. Ring guide: 8 dots at pitch +18° in landscape (45° steps). Moving the reticle onto a dot and holding still captures
   automatically (within 2–3° and under 2°/s for 300 ms). The ring closes on the first frame.
3. Optional second ring ("tall trees?"): 6 dots at pitch +55°.
4. Alignment, chosen automatically: the screen offers the best available tap ("The Sun is to your SW. Centre it and
   tap" / "Jupiter is low in the E. Centre it and tap"), with "Skip". Terrain match runs silently. FOV is solved from
   the same sweep (first sweep per device stores it).
5. Review: the photo strip with the sky mask tinted, the terrain line on top, and the yaw source with its ± value.
   Day: brush fixes. Night: trace the skyline with a finger. Optional landmark drag.
6. "Save". The photo layer joins the terrain layer; everything recalculates.

### Phase 3: viewer

"View my horizon": a 360° view of the site you can drag or move the phone around ("magic window"). Stars, planets and
planned targets drawn over the photo; the terrain line in a thin contrasting colour; a time slider for tonight. Stars
behind obstructions are dimmed. Drag-to-align is available here too.

### Phase 4

- Export: "Download for Stellarium" (polygonal list + `landscape.ini`) and "Download for NINA" (`.hrz`). Import: paste or
  open an "az alt" text file as a photo-equivalent layer.
- Seasonal recapture: the capture record stores the season; when leaves are likely different, the horizon card offers
  "Re-capture for summer leaves". Several seasonal photo layers may be kept; the one matching the date is used.
- Optional Spark HQ segmentation (OneFormer Swin-L, MIT) when on the tailnet.
- Optional 360° photo import (GPano XMP; heading treated as a hint and aligned with the usual methods).

## 10. Test strategy

### 10.1 Unit tests (vitest, `client/src/lib/__tests__/horizon-*.test.ts` and per-feature horizon tests)

Synthetic elevation data, no network:

| Test | Setup | Expectation |
|---|---|---|
| Terrarium decode | Known RGB values | `R·256 + G + B/256 − 32768` exactly; no colour management. |
| Flat sea-level plane | All zeros, observer 1.7 m | Horizon is a small negative dip, the same at every azimuth. |
| Single ridge | Wall of height H at distance d to the north only | North bin = `atan((H − h0 − drop)/d)` within 0.05°; ridge distance = d; other bins flat. |
| Curvature + refraction | Mountain at 100 km | Drop 683 m (k = 0.13) applied; result within 0.02° of the formula. |
| Cone mountain | Cone off-centre | Profile symmetric about the cone bearing. |
| Zoom ladder | Distances 0.15–100 km | Zooms monotonic, tile count in the expected range. |
| Fallback | Loader that fails for Mapterhorn | AWS source used; `source` label changes. |
| `profileAltAt` | Profile with a step at 359°/0° | Wraps correctly; linear in between. |
| Combine and verdict | Terrain + photo layers | Max per azimuth; clear/marginal/blocked match the σ rule; steep slope widens the margin. |
| Skyline crossings | Synthetic star track and skyline | Rise/set times within 1 min of brute force. |
| Apparent vs geometric | Object at geometric −0.3° | Counted as above a 0° skyline (refraction applied once). |
| Exports | Profile | Stellarium and NINA text round-trips through `parseAzAltText`. |
| Phase 2 maths | Synthetic poses and images | FOV from overlap within 1%; yaw combination picks lowest σ and flags disagreement; terrain match recovers a known offset. |

### 10.2 Simulation harness (phase 2): full capture without the owner's phone

Goal: drive the real capture page in Chromium with a synthetic world where the true skyline, FOV, north offset and
sensor errors are known, and check what the app recovers. Lives in `script/horizon-sim/` (Node, run on demand, not part
of `npm test`). Uses Playwright with the system Chromium, like the review scripts in `script/review-round4/`.

**1. Scene generator** (`make-scene.ts`, deterministic from a seed):

- World: an equirectangular image (8192 × 4096) of the site. Sky gradient (day: blue to white near the horizon; twilight;
  night: dark with stars from the app's own catalogue at the scene time and place). Ground and obstructions from a
  known skyline function: a terrain profile (from a synthetic DEM, see 4 below) plus "trees" (noisy blobs with
  see-through gaps) and "buildings" (rectangles with sharp corners). Sun or Moon disc drawn at the astronomy-engine
  position for the scene time.
- Truth file: true skyline per 0.25°, true sky grid, true HFOV, `k1`, true north offset, compass bias.

**2. Camera and motion script** (`make-video.ts`):

- A trajectory that follows the guide: move to each dot (60°/s), hold 1.5 s, move on; ends with the alignment tap pose.
- Pinhole camera with the chosen HFOV (for example 63.4°) and `k1`, 1280 × 960, 30 fps. Each frame is rendered by
  sampling the world image along the camera rays.
- Optional "stabilisation crop" model: a small per-frame shift proportional to angular speed.
- Each frame carries a frame-number barcode (black/white cells) in a 12-px strip at the bottom edge. The init script
  in step 5 reads it and hands the app a track with the strip cropped off, so the app sees a clean image and needs no
  test hooks.
- Output `scene.y4m` (YUV4MPEG2 4:2:0; MJPEG is the alternative for long runs) and `poses.json` (true orientation per
  frame).

**3. Sensor model** (`sensors.ts`): from the true pose per frame produce
- relative quaternion = truth × gyro drift (bias 0–0.02°/s around the vertical plus random walk),
- absolute quaternion = truth × compass error (constant bias 0–30°, plus a heading-dependent sinusoid of 5–10°
  amplitude, plus noise), referenced to **magnetic** north (declination from WMM at the scene location),
- quantised to 0.1° like Chrome.

**4. Synthetic terrain tiles:** the same synthetic DEM used for the world is encoded as Terrarium WebP/PNG tiles and
served with `page.route('**/tiles.mapterhorn.com/**')`, so the terrain layer and the photo agree and the terrain-match
alignment can be tested.

**5. Runner** (`run.ts`, Playwright):

- Launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --use-file-for-fake-video-capture=scene.y4m`. Grant `camera` and `geolocation`; `context.setGeolocation(site)`;
  `page.clock.setFixedTime(sceneTime)` so Sun and star positions match.
- Through a CDP session: `Emulation.setSensorOverrideEnabled` for `relative-orientation`, `absolute-orientation`,
  `accelerometer` and `gyroscope`, then `Emulation.setSensorOverrideReadings` with `{quaternion:{x,y,z,w}}` (and xyz for
  the others). For the `deviceorientation` fallback path use `DeviceOrientation.setDeviceOrientationOverride`. Check the
  exact sensor type names against the protocol version of the installed Chromium.
- Sync: `page.addInitScript` wraps `navigator.mediaDevices.getUserMedia`. It pipes the fake camera track through
  `MediaStreamTrackProcessor` → read barcode, crop strip → `MediaStreamTrackGenerator` and returns the generated track
  to the app. The frame number is reported to the runner via `page.exposeFunction`, which pushes the sensor readings
  for that frame. Because capture
  only fires after 300 ms of stillness and the trajectory holds each pose for 1.5 s, frame-level sync is enough.
  The fake device loops the file; the runner stops after one loop.
- Taps: when the page shows the alignment prompt, tap the reticle at the scripted moment. Night scenario: draw the
  skyline trace with `page.touchscreen`/mouse drags along the true skyline plus 0.3° noise.
- Read the result from localStorage/IndexedDB and compare with the truth file; write a small JSON/HTML report to the
  scratch area (not the repo).

**Scenarios and pass criteria:**

| Scenario | Checks |
|---|---|
| Day, Sun visible, hills | FOV within 1%; yaw within 0.5° of truth after Sun tap; photo skyline MAE ≤ 1° |
| Overcast day, no Sun, hills | Terrain match yaw within 2°; FOV agreement |
| Flat backyard, no Sun | Terrain match correctly declines; compass used with σ ≥ 5°; verdicts widen to marginal |
| Night, Moon tap, finger trace | Yaw within 1°; traced skyline MAE ≤ 1° |
| Compass bias 25° + deviation 8° | Disagreement message shown; Sun fix chosen |
| Gyro drift 1°/min | Loop closure keeps relative yaw error ≤ 1° |
| Distortion `k1` | With `k1` solved, edge error ≤ 0.5° |
| Stabilisation crop on | Measures the damage; documents what to test on a real phone |

Segmentation quality is not judged on synthetic images (the model was trained on real photos). It is checked on a
small set of real site photos (owner's, or openly licensed) with hand-made masks, offline.

**What only the real phone can tell us:** the stabilisation crop of the video stream, real gyro drift and compass
behaviour near the telescope, and model speed (WebGPU vs WASM).

## 11. Risks and open questions

| # | Risk or question | Plan |
|---|---|---|
| R1 | Video stabilisation shifts frames relative to the gyro. | Capture only when still; measure on the owner's phone in a 1-day spike; disable via constraints if exposed. |
| R2 | Generic Sensor API is "maintained for existing deployments" in the spec. | Still ships in Chrome. Keep a `deviceorientation` / `deviceorientationabsolute` fallback behind the same interface. |
| R3 | Mapterhorn is volunteer-run with no published rate limit. | Compute once per site, cache results, at most 6 parallel requests, AWS fallback. |
| R4 | Terrain near the observer (< 1.5 km) is unreliable. | Start rays at 150 m, larger σ for near ridges, photo layer covers it. |
| R5 | Night segmentation is weak. | Finger trace at night; recommend daytime/twilight capture; mask is static so one daylight capture serves all nights. |
| R6 | Model download (about 8 MB + runtime 10–20 MB) on poor signal. | Lazy, cached once; classical fallback; trace works without it. |
| R7 | Capture point differs from the eyepiece. | Instruction in the guide; store a "capture point" note. |
| R8 | Seasonal foliage. | Store season; recapture prompt; seasonal layers in phase 4. |
| R9 | IndexedDB eviction. | `navigator.storage.persist()`; profiles live in localStorage (not in backups; terrain is recomputed on demand). |
| Q1 | How should the existing minimum-altitude setting combine with the skyline? | Decided: require both, `alt ≥ max(minAlt, threshold(az))` (section 4.4). |
| Q2 | Default azimuth resolution for terrain: 1° or 0.5°? | Start at 1°; revisit if narrow peaks matter in practice. |
| Q3 | Should the photo layer keep overhangs (gaps under crowns) in verdicts, or only the profile? | Profile in phases 2–3; grid-based verdicts later if users need gaps. |
| Q4 | How to show the required tile attribution without "citations" in the UI? | One short credits line in the horizon settings/about panel (licence requirement, not a citation). Confirm wording. |
| Q5 | iOS support. | Terrain works everywhere; capture is Android Chrome first. |
| Q6 | Does WebXR (exact intrinsics, drift-free pose, daylight only, ARCore required) earn a "precision mode"? | Not planned; revisit if real-device drift or stabilisation turns out to be bad. |

## 12. Attribution and licences

| Component | Requirement |
|---|---|
| Mapterhorn tiles | Show "© Mapterhorn" linking to https://mapterhorn.com/attribution (151 sources, mostly CC BY 4.0 or open government data; Copernicus GLO-30 "full, free and open"). |
| AWS Terrain Tiles (fallback) | Attribute the sources per https://github.com/tilezen/joerd/blob/master/docs/attribution.md (USGS SRTM/3DEP/GMTED, Copernicus EU-DEM, Kartverket, LINZ, Geoscience Australia, UK Environment Agency, NRCan, INEGI, ArcticDEM, NOAA ETOPO1). |
| `HorizonProfile.source` | Records which source produced each profile so the credits line can name it. |
| WMM (via `geomagnetism`, Apache-2.0) | NOAA model, public domain. |
| SegFormer-B0 weights | NVIDIA Source Code License, non-commercial; ADE20K research-only. Note in the licences folder. |
| Transformers.js / ONNX Runtime Web | Apache-2.0 / MIT. |
| Photo Sphere Viewer, three.js | MIT. |

## 13. Phases

| Phase | Scope | Done when |
|---|---|---|
| 1 (in progress) | `types`, `terrain`, `terrain.worker`, `profile`, `store`, hook; integration into Tonight/Best tonight, windows, rise/set, binocular guide, session planner, journeys, sky chart silhouette; attribution line. | Unit tests pass; a mountain site shows a realistic profile; lists change accordingly; works offline after first visit. |
| 2 | `capture/`, `calibrate/`, `segment/`; capture and review pages; photo layer; simulation harness. | All harness scenarios pass; one real-phone session confirms R1 and model speed. |
| 3 | `viewer/`: 360° view, star layer, targets, time slider, terrain overlay, drag-to-align. | 60 fps slider on a mid-range phone; stars line up with the terrain line in harness scenes. |
| 4 | Export/import, seasonal recapture, optional Spark HQ segmentation, optional 360° photo import (GPano). | Files open in Stellarium and NINA. |

## References

Terrain and elevation data
- Mapterhorn tiles and TileJSON: https://tiles.mapterhorn.com/tilejson.json ; attribution: https://mapterhorn.com/attribution , https://download.mapterhorn.com/attribution.json
- AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/ ; attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- PVGIS API (no browser use by policy): https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en ; horizon tool: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/pvgis-tools/horizon-profile_en
- HeyWhatsThat tech FAQ: https://www.heywhatsthat.com/techfaq.html
- Open-Meteo elevation API: https://open-meteo.com/en/docs/elevation-api
- Patat 2011, horizon synthesis vs theodolite: https://arxiv.org/abs/1107.1957
- DEM resolution and near obstacles (GMD 2022): https://gmd.copernicus.org/articles/15/6817/2022/

Sensors and camera
- Chromium sensor mapping: https://chromium.googlesource.com/chromium/src/+/main/services/device/generic_sensor/android/java/src/org/chromium/device/sensors/PlatformSensorProvider.java
- Sensor frequency cap: https://chromium.googlesource.com/chromium/src/+/main/services/device/public/cpp/generic_sensor/sensor_traits.h
- Device orientation change in Chrome 50: https://developer.chrome.com/blog/device-orientation-changes
- W3C Orientation Sensor: https://w3c.github.io/orientation-sensor/
- Generic Sensor API in Chrome: https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor
- Android sensor types: https://source.android.com/docs/core/interaction/sensors/sensor-types ; https://developer.android.com/reference/android/hardware/SensorEvent
- Compass accuracy: https://srl.mcgill.ca/publications/2012-MOBIQUITOUS.pdf ; https://oro.open.ac.uk/84729 ; https://oro.open.ac.uk/62672 ; https://link.springer.com/article/10.1007/s41064-020-00093-1
- Pitch/roll accuracy, 56 phones: https://pmc.ncbi.nlm.nih.gov/articles/PMC7880912 ; Elias & Maas: https://isprs-annals.copernicus.org/articles/V-1-2020/181/2020/
- WMM and error model: https://www.ncei.noaa.gov/products/world-magnetic-model ; https://www.ncei.noaa.gov/products/world-magnetic-model/accuracy-limitations-error-model ; `geomagnetism`: https://www.npmjs.com/package/geomagnetism
- ImageCapture: https://developer.chrome.com/blog/imagecapture ; Image Capture spec: https://w3c.github.io/mediacapture-image/
- requestVideoFrameCallback: https://wicg.github.io/video-rvfc/
- WebXR raw camera access: https://immersive-web.github.io/raw-camera-access/
- VFTCam guided web capture: https://vftcam.stanford.edu/building-vftcam.html

Alignment
- Baboud et al., CVPR 2011, photo-to-terrain: https://resources.mpi-inf.mpg.de/photo-to-terrain
- Semantic VPS vs phone IMU: https://arxiv.org/pdf/2011.10743
- PeakFinder: https://www.peakfinder.com/support ; PeakVisor compass: https://peakvisor.com/en/news/most-precise-compass.html

Segmentation
- SegFormer: https://arxiv.org/abs/2105.15203 ; licence: https://github.com/NVlabs/SegFormer/blob/master/LICENSE ; ONNX: https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512
- Sky Optimization (Liba et al. 2020): https://arxiv.org/abs/2006.10172
- SkyFinder (La Place et al.): https://arxiv.org/abs/1712.09161
- Shen & Wang 2013 sky border: https://journals.sagepub.com/doi/full/10.5772/56884
- SAM 2.1 tiny ONNX: https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX
- OneFormer: https://github.com/SHI-Labs/OneFormer
- Browser inference measurements: https://arxiv.org/html/2402.05981v2 ; ORT WebGPU: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html ; Transformers.js WebGPU: https://huggingface.co/docs/transformers.js/guides/webgpu

Viewer
- Photo Sphere Viewer: https://photo-sphere-viewer.js.org/ ; cropped panoramas: https://photo-sphere-viewer.js.org/guide/adapters/equirectangular.html
- Pannellum: https://github.com/mpetroff/pannellum

Prior art and formats
- Stellarium landscapes: https://github.com/Stellarium/stellarium/blob/master/guide/ch_landscapes.tex ; https://stellarium.org/doc/head/classLandscapePolygonal.html
- NINA custom horizon: https://nighttime-imaging.eu/docs/master/site/tabs/options/general/
- Mobile Observatory: https://www.zima.co
- SkySafari custom horizon: https://userguide.skysafariastronomy.com/app-specific/settings-help/display-options-help/horizon-and-sky-help
- Telescopius horizon threads: https://forum.telescopius.com/t/local-horizon-mask-from-photosphere/457
- Nightwatch (open-source analogue): https://github.com/rsutcliffe/nightwatch
- User pipeline example: https://nightskymiddleton.uk/2023/01/16/creating-a-custom-horizon-in-n-i-n-a-stellarium-and-sky-safari/
- GPano metadata: https://developers.google.com/streetview/spherical-metadata
- Photo Sphere removal: https://9to5google.com/2023/10/11/google-camera-photo-sphere-pixel-8/ ; new Pixel Panorama: https://9to5google.com/2025/12/24/pixel-8-camera-new-panorama-mode/
- Web Share Target: https://developer.chrome.com/docs/capabilities/web-apis/web-share-target
