# Sky Journeys: codebase integration map

Branch `feature/sky-journeys`. Mapped 2026-11-01 against commit `92e5e10`. Line numbers refer to that commit. `planner.tsx`, `astronomy.ts` and `SkyChart.tsx` use very long lines, so search them with `grep -n` and do not rely on an editor's soft wrap.

This doc is for implementers. Each section gives the facts first and then a **Recommendation**.

---

## 0. TL;DR integration plan

1. **New page id `"journeys"`**, served at `#/journeys` and `#/journeys/<journeyKey>`. Add it to `lib/navigation.ts` and to the nav array at `pages/planner.tsx:904-913`. Add a render branch next to `page === "binocular"` (`planner.tsx:1923`).
2. **Build `components/SkyJourneys.tsx` like `BinocularGuide`.** It is a props-driven page. The planner owns the catalogs, the observing context and the session callbacks, and passes them down (`planner.tsx:1924`). The page owns no global state. It keeps only its own UI state in one new localStorage key, `starhop-sky-journeys-v1`.
3. **Pure logic goes in `client/src/lib/journeys/*`** and must have no React and no DOM. That covers the knowledge-base loader, candidate filtering (visibility, Moon, binocular fit), region clustering, story assembly, the scorer, and transition text. Run the assembly in a **dedicated Web Worker**, following `clock-season.worker.ts` (section 9). Do not run it through `route-client.ts`.
4. **Put the knowledge base in a new file, `client/public/data/sky-journeys-kb.json`**, and fetch it lazily. Do not import it into the main bundle. Ship the learned scorer weights as a small JSON file next to it. Both files are precached automatically (section 8).
5. **Reuse what exists.** Take visibility from `target-visibility.ts`, the Moon and moonlight from `moon.ts`, binocular fit from `binocular-assessment.ts`, cards from `TargetPhoto`, `BinocularImages` and `NightAltitudeChart`, the path map from `SkyChart` (add one optional prop for the journey polyline), and per-leg hops from `planRoutes`, with care (section 6).

---

## 1. Conventions you must follow

- **Code style.** The repo uses dense TypeScript, often one-liners, with zod schemas for everything that is persisted (`lib/session.ts`, `lib/session-planner.ts`). Persistent React state goes through `useLocalState(key, initial, schema)` (`hooks/use-local-state.ts`), which validates on read and silently falls back to `initial`.
- **Path aliases.** `@/` points to `client/src/`. Vitest has the same alias (`vite.config.ts`).
- **TypeScript is strict** (`tsconfig.json`). `npm run check` runs `tsc`.
- **ESLint.** `react-hooks/exhaustive-deps` is a warning everywhere and an **error in `SkyChart.tsx`** (`eslint.config.js`). Any change to SkyChart must have complete memo dependency arrays.
- **Coordinates.** All catalog RA/Dec values are **J2000 degrees**. `eqToHorizontal` precesses internally through `fixed-equatorial.ts`. The horizon is geometric (no refraction). Do not invent another transform.
- **Docs.** `README.md` is the current feature description. `CLAUDE.md` "Current Status" is stale: it says "40 tests", and there are now 379.

---

## 2. Top-level sections, hash routes, nav

### How it works now

| What | Where |
|---|---|
| App shell | `client/src/App.tsx:1-29`. wouter `Router` with `useHashLocation`, wrapped in `ChartPreferencesProvider`. It renders `PlannerPage` only. **There are no per-route components. The planner is the whole UI.** |
| Page ids and paths | `client/src/lib/navigation.ts:1-2`. `Page = "catalog"\|"tonight"\|"binocular"\|"moon"\|"hop"\|"night"\|"image"\|"clock"`, with paths such as `tonight → "/"`, `binocular → "/binoculars"`, `night → "/planner"`. |
| Path to page | `navigation.ts:3-7` (`pageForPath`). Only `hop` accepts a sub-path (`/hop/<id>`, regex at line 5). |
| Page to path | `navigation.ts:8` (`pathForPage(page, targetId?)`). It appends the id only for `hop`. |
| Current page | `planner.tsx:197-200`. `page = pageForPath(location) ?? "tonight"`, `setPage(next, target?) → navigate(pathForPage(...))`. An unknown path redirects to `/`. |
| Side effects of a page change | `planner.tsx:201` scrolls to the top and scrolls the active nav item into view. `planner.tsx:216` closes the setup, instrument, sources and offline dialogs whenever `location` changes. |
| Nav bar | `planner.tsx:903-930`. A `[id, label, Icon]` array, rendered as `<a href="#/..." data-testid="tab-${id}">`. The active tab gets `aria-current="page"`. |
| Page bodies | Conditional blocks inside `<main id="main-content">` (`planner.tsx:1243`). Tonight is at 1268-1490, hop at 1494, Planner (`night`) at 1913, Binoculars at 1923, Catalog at 1926, Clock at 1927, Moon at 1928, and the hidden `image` page at 1929. |
| Date/time bar | `planner.tsx:1263`, `data-testid="session-timebar"`. Every page shows it except `night`. Journeys gets it for free. |
| Footer | `planner.tsx:1956`. |

### Mobile nav

- CSS is in `client/src/index.css:224-228` (base) and `client/src/issue-ux.css:99-104, 117-153, 310-313, 345, 494-500`.
- At 760px and below, the nav is a full-width second row with **horizontal scroll** (`overflow-x:auto`, `scroll-snap`, minimum 62px per item, a fade mask at the right edge). An 8th item scrolls. It does not wrap or break the layout.
- Above 1101px, the header is a 3-column grid with the nav centered. An 8th item fits at 1280px.

### Adding the tab (exact edits)

1. In `lib/navigation.ts`:
   - Add `"journeys"` to `Page`.
   - Add `journeys:"/journeys"` to `paths`.
   - In `pageForPath`, accept `/^\/journeys\/[^/]+$/`.
   - In `pathForPage`, append `/${encodeURIComponent(key)}` for `journeys`.
   - Add `journeyFromPath(path)` modeled on `targetFromPath`.
2. In `pages/planner.tsx`, add `["journeys", "Journeys", <Icon>]` to the array at line 904. **Recommendation:** put it right after `"binocular"`, because the two belong together. For the icon, use lucide `Route`, `Milestone` or `Sparkles`, and check that the icon exists in lucide-react `^0.453`.
3. Add a render branch after line 1923: `{page === "journeys" && <SkyJourneys .../>}`. Pass the same props that `BinocularGuide` gets (section 3).
4. **This breaks one test:** `script/review-round3/round3-regression.cjs` asserts `nav.length === 7`. Update it to 8. No vitest test counts tabs.
5. The tab name: README and tests call the sections Tonight, Planner, Clock, Catalog, Binoculars, Moon and Star hop. "Journeys" keeps the label short enough for phones.

---

## 3. Global observing context (date, time, site, instrument)

### Settings (one object, localStorage key `starhop-settings-v2`)

Schema: `client/src/lib/session.ts:5-45`. Defaults: `session.ts:47-69`.

| Field | Meaning |
|---|---|
| `lat`, `lon` | Site. The default is San Francisco, 37.77 / -122.42. The time zone is derived with `tzLookup(lat, lon)` (`planner.tsx:248`). |
| `timeMode` | `"live"` follows the device clock, re-read every 30 s and on focus (`planner.tsx:251-261`). `"planned"` is a pinned instant. |
| `date`, `time`, `plannedAt` | The planned local date (`yyyy-MM-dd`), the local time (`HH:mm`), and an optional ISO instant used to disambiguate DST. |
| `mode` | `"binocular" \| "telescope"`. The default is binocular. |
| `fov`, `fovHeight`, `shape` | The navigation field. The default is 3.7° circle. |
| `limitingMag` | Star depth on charts and routes. The default is 8. |
| `difficulty` | Route profile: `beginner \| intermediate \| expert`. |
| `targetId`, `startStarId`, `waypointIds` | Current hop target. `startStarId` must match `^HR\d+$`. Changing `targetId` clears the start star and waypoints (`planner.tsx:192-196`). |
| `binocularMagnification`, `binocularAperture`, `binocularFov`, `binocularStabilized`, `binocularTransmission` | The binocular profile. The default is KITE APC 14×50, 3.7°, stabilized, 0.86. A migration is at `session.ts:41-45`. |
| `skyBrightness` | Moonless zenith brightness in mag/arcsec² (17-22, default 19). It updates automatically per site (`planner.tsx:249-250`, `site-sky-brightness.ts`). |
| `redLight` | Red light mode. |

### Derived values in `PlannerPage` (pass these as props)

- `date: Date` is **the single observing instant** (`planner.tsx:269-275`): live → `clockNow`, planned → `resolvePlannedMoment(...)`.
- `timezone` (`planner.tsx:248`).
- `binocularProfile` = `profileFromSettings(settings)` (`planner.tsx:343`, `components/BinocularAssessment.tsx:9`).
- `currentMoon` = `moonState(lat, lon, date)` (`planner.tsx:344`).
- `conditions` = `skyConditions(lat, lon, date)`, which holds sun altitude, darkness label and Moon phase (`planner.tsx:339`).
- `catalogs = {stars, targets, constellations, dense, milkyWay}`, loaded once (`planner.tsx:418-445`). `loading` and `catalogError` go with it.
- `planningTargets` = unified targets plus every BSC star as a `star:HR…` target (`planner.tsx:324`).
- `locationLabel`, `saveDestination` and `savedIds` (`planner.tsx:348-349`).

### Changing time or site from a page

- `previewMoment(at, lat, lon, navigate=true)` (`planner.tsx:524-528`) switches to planned mode at `at`. **Pass `navigate=false`**, or it jumps to Tonight. Pages receive this as an `onDate`/`onTime` callback, as in `BinocularGuide onDate={at=>previewMoment(at,lat,lon,false)}`.
- `requestSiteChange(lat, lon, name)` (`planner.tsx:529-535`).
- `ObservingContextScope` and `ContextDateButton` (`components/ObservingContext.tsx:98-111`) are inline date/site buttons that open the shared pickers.

### All localStorage keys (do not collide)

`starhop-settings-v2`, `starhop-night-v2` (legacy list), `starhop-session-planner-v1`, `starhop-clock-objects-v1`, `starhop-saved-locations-v1`, `starhop-chart-display-v1` (chart preferences), `starhop-hop-progress-v1`, `starhop-optical-profiles-v1`, `starhop-optical-selection-v1`, `starhop-site-sky-brightness-v1`, `starhop-weather-v1`, `starhop-forecast-models-v1`, `starhop-stargazing-profile-v1`, `starhop-text-size`. The sessionStorage key `starhop-highlight-constellation` is a cross-component signal for the overview chart.

**Recommendation:** add exactly one key, `starhop-sky-journeys-v1`, through `useLocalState` with a zod schema. Store the last theme, the visited or observed stop ids per journey key, and an in-progress cursor. Store **no generated journeys**. Regenerate them from (date, site, profile, theme, seed) so they never go stale. Backups (`lib/backup.ts:9-13`) cover settings, planner, savedLocations and unscheduled. Add journey progress to the backup only if product asks for it.

---

## 4. Catalogs, object model and target ids

### Files

| File | Loaded by | Count | Fields |
|---|---|---|---|
| `client/public/data/bsc5-short.json` (954 KB) | `loadStars()` at `astronomy.ts:231-248`, fetched | 9096 | `HR` (string), `RA` ("00h 05m 09.9s"), `Dec` ("+45° 13′ 45″"), `V` (string mag), `K` (**effective temperature in Kelvin**, string, present on 9095), `N` (proper name, 340), `B` (Bayer Greek letter, 1564), `C` (constellation abbr, 3144), `F` (Flamsteed, 2554), `magnitudeNote` (1). **No spectral type, B-V, parallax, distance, radius or luminosity.** |
| `client/public/data/messier.json` | `loadMessier()` at `astronomy.ts:250-266` | 110 | `M`, `NGC` (107), `T` (type code OC/GC/DN/PN/SG/EG/BG/IG/LG/SN/DS/AS/MW), `V`, `S` (size in arcmin, "6x4"), `RA`, `Dec`, `Con`, `N` (31) |
| `client/public/data/binocular-catalog.json` | `loadBinocularTargets()` at `astronomy.ts:317-340` | 187 | `id`, `cat` (STAR/DS/AST/OC/GC/EN/PN/SNR/GAL: OC 92, DS 27, AST 20, STAR 16, GC 10, GAL 8, PN 7, EN 5, SNR 2), `name`, `altId` (128), `ra`, `dec`, `mag`, `mag2`/`sep` (doubles, 27, sep in arcsec), `con`, `size` (144, string with unit), `desc`, `binoTip` |
| `client/public/data/constellations.lines.json`, `mw.json`, `stars-dense.json` | `astronomy.ts:268-299` | | Chart backgrounds. `DenseStar = [ra, dec, mag, bv]`. |
| `client/public/data/known-routes.json` | `loadKnownRoutes()` at `astronomy.ts:301` | | Expert hop routes per target, used inside `planRoutes`. |
| `client/src/lib/binocular-guide-extra.json` (bundled import) | `binocular-guide.ts:4, 36-105` | 179 + 4 inline = 183 guide entries | `targetId`, `family` (star/asterism/double/cluster/nebula/galaxy), `level` (easy/dark/steady/challenge/large), `equipment`, `impression`, `finding`, `minAperture`, `references[]`, `variable` (8) |
| `client/src/lib/binocular-media.json` (213 KB, bundled) | `binocular-media.ts:1-9` | **297 = every unified target** | `{ra, dec, fov, images:[{variant:"optical"\|"infrared", path:"data/binocular-images/<id>-<variant>.jpg", url:<CDS hips2fits URL>, display?, qualityNote?}]}` |
| `client/src/lib/binocular-featured-images.json` | `binocular-media.ts:2, 11` | 20 | Wikimedia telescope portraits with license, credit and `useAsPrimary`. |
| `client/src/lib/binocular-observation-references.json` | `BinocularObservations` | 28 | Links to real binocular sketches. |
| `client/src/lib/catalog-extents.json` | `catalog-extents.ts:26-43` | 253 | `{majorArcmin, minorArcmin, positionAngle, source}` (OpenNGC). |
| `client/src/lib/finder-fields.json` | `hooks/use-finder-stars.ts` | 297 | Index of `client/public/data/finder-stars/<id>.json` (Tycho-2, 8° radius, VT ≤ 10.5, `[ra, dec, mag, bv]`). |
| `client/src/lib/lunar-features.json` | `moon.ts:7` | 55 | `id`, `name`, `lat`, `lon`, `diameterKm`, `kind`, `minMagnification`, `rays`, `tip`, `source` |
| `observing.ts:14-95` `OBJECT_GUIDES` | `guideFor()` at `observing.ts:97` | 10 | Hand-written `story`/`lookFor` for M31, M45, M42, M13, M57, M81, M51, NGC869, Coathanger and Albireo. This is the only "story" prose in the repo. |

**Physics data is almost absent.** Apart from the BSC temperature (`K`) and the short `desc`/`impression` strings, nothing in the repo holds spectral class, distance, size, luminosity, age, evolutionary stage or multiplicity. The knowledge base must supply all of it.

### Unified model

`UnifiedTarget` (`astronomy.ts:342-359`) has these fields: `id, name, displayName, aliases?, mag, ra, dec, con, category, categoryShort, source:'messier'|'binocular', size?, sep?, mag2?, binoTip?, desc?`. `buildUnifiedTargets(messier, binocular)` (`astronomy.ts:361-427`) puts Messier first and skips binocular ids that duplicate a Messier id. **The result is 297 unified targets.**

### Id namespaces (important)

| Prefix / form | Meaning | Hop-routable (`planRoutes` targetId)? | Media? |
|---|---|---|---|
| `M1`..`M110` | Messier | yes | yes (DSS2 optical; 2MASS for most) |
| `NGC…`, `IC…`, `Mel…`, `Cr…`, `Tr…`, `Stock…`, `Mark6`, `LMC`, `SMC` | Binocular catalog deep-sky objects | yes | yes |
| `STAR-<Name>` (16: Algol, Mira, Betelgeuse, Aldebaran, Arcturus, Antares, Rasalgethi, MuCep, Capella, Sirius, Procyon, Vega, Deneb, Fomalhaut, Alphard, LaSuperba) | Curated stars | yes (as a binocular node) | yes |
| `DS-<Name>`, `AST-<Name>` | Doubles and asterisms | yes | yes |
| `HR<n>` | **SkyNode id** of a BSC star, as used inside routing and charts | yes, as a target, and as `startStarId` | no |
| `star:HR<n>` | **Planning/session id** of a BSC star (`starPlanningTarget`, `session-planner.ts:146-149`) | no. Strip the `star:` prefix first. | no |
| `moon:<featureId>` | Lunar landmark in sessions | no | crops in `data/moon/features/<id>.jpg` |

Aliases: `catalog-identifiers.ts:2-5` has `canonicalTargetId` (3 legacy renames). The HR numbers for the `STAR-*` targets are hard-coded in `binocular-media.ts:19`, and `MAJOR_STAR_NAMES` is at `astronomy.ts:429-438`.

**Duplicate identities.** Betelgeuse exists as `STAR-Betelgeuse` (binocular, has photos), `HR2061` (routing node) and `star:HR2061` (session item). **Recommendation:** the knowledge base keys every object by **one canonical stop id**: the `STAR-*`, `DS-*` or `AST-*` id when one exists, otherwise `M…`/`NGC…`, otherwise `star:HR…`. Store `hr` explicitly for any stellar object so routing can use `HR<n>`. Write a small `toRoutingId(stopId)` and `toSessionId(stopId)` in `lib/journeys/ids.ts`, and unit-test both.

### Target id to images and finder

- `primaryOpticalImage(id)` (`binocular-media.ts:30-36`) returns the featured portrait when `useAsPrimary` is set, otherwise the DSS2 optical image. It gives `{path, url, credit, caption, note, width, height, kind}`. The path is relative to the app root: render it as `src={"./"+path}`.
- `binocularMedia(id)` (`binocular-media.ts:9`) returns both survey bands with their `fov`. `SURVEY_CREDITS` (`binocular-media.ts:12-15`) holds the attribution text.
- `binocularDatabaseResources(target, fov)` (`binocular-media.ts:18-27`) returns SIMBAD and Aladin links.
- Finder chart: any `SkyChart` with `targetNode`, `limitingMag > 8` and no `overview` loads `data/finder-stars/<id>.json` automatically (`SkyChart.tsx:98`, `hooks/use-finder-stars.ts`).
- Card rendering: `TargetPhoto` and `BinocularImages` (section 5).
- **Gap:** `star:HR…` stops have no images and no finder file. New KB stars that are not among the 16 `STAR-*` need media. Generate it with the existing pipeline: `script/binocular-media-plan.ts` produces a plan, `script/download-binocular-media.py <plan.json>` fetches the CDS hips2fits DSS2 and 2MASS cutouts, and `script/download-finder-stars.py` fetches the Tycho-2 fields. That pipeline is keyed on **unified target ids** and writes to `binocular-media.json`. **Recommendation:** keep journey-only media in a separate manifest, `client/src/lib/journey-media.json` (or inside the KB JSON), with images under `client/public/data/journey-images/`. The guard test `binocular-guide.test.ts:64-111` requires every `binocular-media.json` entry to have decoded files at the catalog coordinates, and mixing in non-catalog ids would trip it.

---

## 5. Reusable computations (pure, testable in Node)

| Need | Function | Location | Notes |
|---|---|---|---|
| Alt/az | `eqToHorizontal(ra, dec, lat, lon, date)` → `{alt, az}` | `astronomy.ts:443` | J2000 input, precessed. Geometric. Az 0 = N, 90 = E. |
| Separation | `angularDistance(ra1, dec1, ra2, dec2)` (degrees) | `astronomy.ts:600` | Use for Moon separation and stop-to-stop legs. |
| Direction words | `directionBetween(...)` → "north-east" etc. | `astronomy.ts:609` | Celestial direction. Good for "from the previous stop, go …". |
| Planets | `getPlanetPositions`, `chartSolarSystemPositions` | `astronomy.ts:547, 590` | Optional journey stops later. |
| Rise/transit/set | `targetDayEvents(ra, dec, lat, lon, date, tz)`, `targetIntervalEvents(...)` | `target-visibility.ts:34, 25` | Exact, handles circumpolar and never-up cases. |
| Night window | `visibilityWindow(date, time, until, "night", tz, lat, lon)` | `target-visibility.ts:40-57` | Returns `{ok, start, end, segments[]}`. Segments are **astronomical darkness** (Sun < -18°) between local noons, and handle polar night and summer. |
| Max altitude in window | `targetWindow(ra, dec, lat, lon, window)` → `{max, min, bestAt}` | `target-visibility.ts:59` | Includes the exact culmination. |
| Altitude samples over the night | `nightAltitudeSamples(...)` | `target-visibility.ts:69` | 15-minute samples plus extrema. |
| Night for a session instant | `sessionNightWindow(start, end, tz, lat, lon)` | `observing-profile.ts:26` | Handles the after-midnight case. |
| Evening start | `eveningOn(localDate, lat, lon)` → dusk + 15 min | `session-planner.ts:23` | `planningShortcut("tonight"\|"new-moon", ...)` is at line 30. |
| Moon state | `moonState(lat, lon, date)` → `{alt, az, ra, dec (J2000), illumination 0-1, phaseAngle, phase, phaseName, magnitude, sunSeparation, distanceKm, diameter, sunAlt}` | `moon.ts:18-32` | `sunAlt` doubles as the twilight check. |
| Moonlight (Krisciunas-Schaefer 1991) | `scatteredMoonlight(moon, targetAlt, separation, skyBrightness, extinction=0.172)` → `{brightening (mag), skyBrightness, moonBrightness}` | `moon.ts:121-136` | Brightening is 0 when the Moon is down. The source is `MOONLIGHT_SOURCE`. |
| Moonlight verdict for a target | `targetMoonlight(target, lat, lon, date, sky)` → level, advice, `reliable` | `moon.ts:137-147` | It has the category heuristics (`diffuse` = galaxy, nebula or cloud). |
| Moon cache | `createMoonSampler(lat, lon)` | `observing-profile.ts:7` | **Use this.** `moonState` is not free. |
| Per-sample profile | `observationProfile(target, lat, lon, night, sky, moonAt)` and `observationAt(...)` | `observing-profile.ts:12, 37` | Altitude, separation and moonlight per sample. |
| Best time for one target | `suggestedObservation(samples, target, range?)` | `observing-profile.ts:19` | Score = `alt − moonlight·w`, where w = 14 for diffuse objects, 2 for bright stars and 6 otherwise. The altitude floor is 15°. |
| Moon-free windows | `moonFreeTargetWindows({...,target,minAltitude})`, `nearestMoonFreeTargetTime` | `upcoming-nights.ts:156, 210` | Multi-night search. |
| Sky state | `skyConditions(lat, lon, date)` | `observing.ts:137` | `isDark`, `darkness` label, `illumination` %. |
| Current ranking (static rules) | `rankTargets(targets, lat, lon, date, mode)` | `observing.ts:213-233` | A weak heuristic. Do not build on it. |
| Binocular fit | `binocularAssessment(target, profile, {alt, moon, skyBrightness})` → `{rating 0-3, label, reasons[], view, pointLimit, surfaceBrightness, contrast, glow, exitPupil, ...}` | `binocular-assessment.ts:26-82` | The **best available feature generator**. It models the limiting magnitude from the sky, aperture, transmission and extinction, mean surface brightness against the sky, splits of doubles, guide `level`/`minAperture`, moonlight glow and low altitude. Rating 0 is excellent and 3 means a telescope is more rewarding. |
| Monthly guide sampling | `binocularCollection(...)` | `binocular-guide.ts:127-141` | Shows how the guide samples 12 months. |
| Session sequencing | `suggestSequence(session, targets, sky)` | `session-planner.ts:49-132` | A 5-minute-quantum DP and beam search over order and time slots. It maximizes altitude minus moonlight subject to darkness and a 15° floor. **Its scoring is time-only and has no spatial or region term.** Reuse its "closing time" idea (lines 78-90) for ordering setting stops first. Do not reuse the DP for spatial journeys. |
| Projection helpers | `chartFrame(points)` (centroid frame), `skyZenith`, `projectChartPoint` | `chart-view.ts:7-30` | Useful for computing a journey's "region" centroid. |
| Star color | `stellarColor(temperature, bv)` | `stellar-appearance.ts:9` | Works with the BSC `K`. |

**Hard constraints mapped onto these:**

| Constraint | How to test it |
|---|---|
| Visible | `alt ≥ minAlt` at the stop's scheduled time. **Recommendation:** use ≥ 30° as the default and 20° as the floor. `GOOD_TARGET_ALTITUDE = 30` is already at `upcoming-nights.ts:8`. |
| Dark | `moon.sunAlt ≤ -18` for deep-sky objects. For stars with mag ≤ 5, ≤ -6 is enough. That is the `session-planner.ts:67` rule. |
| Away from the Moon | `scatteredMoonlight(...).brightening` below a category threshold, plus a minimum `angularDistance` to the Moon. |
| Binocular | `binocularAssessment(...).rating ≤ 1`, or ≤ 2 as a flagged challenge stop. |
| Region / no zig-zag | Use `angularDistance` legs and the alt/az spread. This is new code (section 10). |

---

## 6. Star hop: can we route stop N to stop N+1?

**Yes, with constraints.** API: `planRoutes(params: ObservingParams)` (`astronomy.ts:1728`). The browser calls it through `planRoutesInWorker(params)` (`lib/route-client.ts:4-14`).

- `params.targetId` can be any **SkyNode id**: `M…`, a binocular id, or **`HR<n>`** (stars are nodes). The node is only built when its altitude is at least 5° (`buildSkyNodes`, `astronomy.ts:661-743`).
- `params.startStarId` must be a node of `type==='star'` (an `HR<n>` id) with **mag ≤ 4.5** and alt ≥ 5° (`findAnchors`, `astronomy.ts:1412-1413`). With `startIsWaypoint: true`, the magnitude cap relaxes to `limitingMag`. **A deep-sky stop can never be a start.** From a deep-sky stop N, use the nearest catalog star that is bright enough, or set `startIsWaypoint` with a field star near N. A stop that is itself a star (`STAR-*` or `star:HR…`) maps to `HR<n>`.
- `waypointIds` (max 8, HR stars only) chains legs internally (`astronomy.ts:1729-1742`).
- The result is `{routes: Route[], nodes, targetNode, belowHorizon, anchorUnavailable?, warning?}`. `Route.hops[]` holds `HopStep{center, visibleGuideStars, pattern, direction, distanceDeg, instruction}` (`astronomy.ts:115-138`).
- **Measured cost** (Node on this machine, 3.7° binocular field, limiting mag 8, Milan, 2027-01-14 21:00 UTC): 180-300 ms per call. For example, Betelgeuse → M42 took 206 ms with 10 hops, Rigel → M42 181 ms with 4 hops, and Aldebaran → M45 184 ms with 9 hops. Every call reloads the cached catalogs and **rebuilds the whole sky graph**. Expect 3-5x slower on a phone.
- **`planRoutesInWorker` is single-flight.** Each call terminates the previous worker and rejects it with `AbortError` (`route-client.ts:6`). **Never call it in parallel for several legs.** Either chain the legs sequentially, or compute a leg only when the user opens "hop from previous stop" (recommended).
- Planner entry points:
  - `planBinocularHop(id, at)` (`planner.tsx:721-760`) sets planned time, binocular mode and target, navigates to `#/hop/<id>`, and computes. It **clears `startStarId`**.
  - `compute(mode?, forcedStart?)` (`planner.tsx:680-709`) accepts a forced start star.
  - **Recommendation:** add a sibling `planJourneyLeg(targetRoutingId, at, startHr?)` in the planner that sets `startStarId` and calls the existing flow. Pass it to SkyJourneys as `onHop(stopId, at, fromStopId?)`. The existing Star hop page then displays the leg with field-by-field navigation and "I found it!", which marks the stop observed through `markObserved`. Do not rebuild hop UI inside Journeys.
- **Recommendation for assembly:** do **not** call `planRoutes` while generating journeys, because it is too slow for candidate search. Use `angularDistance` legs, mapped against the field width (legs ≤ ~3-4 fields are "easy hops"), as the feasibility proxy. Call `planRoutes` lazily per leg on user demand.

---

## 7. Reusable UI

### `SkyChart` (`components/SkyChart.tsx`)

**Props** (`SkyChart.tsx:30-55`):

- `nodes: SkyNode[]`, `constellations`, `route: Route|null`, `targetNode: SkyNode|null`, `animStep`
- `fovWidth`, `fovHeight`, `fovShape`, `lat`, `lon`, `date`, `limitingMag`, `denseStars`, `milkyWay`
- `overview?` (zenith-centered all-sky planetarium), `onSelect?(id)`, `onFovChange?`, `onLimitingMagChange?`, `onEditSetup?`
- `setupSummary?`, `isBinocular?`, `fieldNavigation?: ReactNode`, `maxCatalogMagnitude?`, `targetDiameter?`

**Behavior:**

- **Route overlay.** `routePath` (`SkyChart.tsx:585-594`) draws a dashed polyline through `route.hops[].center`, with progress up to `animStep` and numbered hop markers (`SkyChart.tsx:1140-1160`). The view frames the hop span (`SkyChart.tsx:164-182`), and "Route overview" fits all hops (`SkyChart.tsx:1328`).
- **The overview mode is ideal for "the whole journey on tonight's sky".** It projects around the zenith with the horizon circle (`skyZenith`), which makes the "region of the sky" visible. Tonight's usage is at `planner.tsx:1286-1300`. The node list is built at `planner.tsx:411-416` (`overviewNodes`): stars `previewNodes` plus target markers plus solar system bodies.
- Chart preferences (mirror, rotation, labels, reticle) come from the `ChartPreferences` context and persist under `starhop-chart-display-v1` (`components/ChartPreferences.tsx:5-21`). Journeys inherits them automatically.

**How to overlay a multi-stop path.** Do not fake a `Route`: `HopStep` has many required fields, and the hop UI treats hops as fields. **Add one optional prop**, `journey?: {id:string; ra:number; dec:number; label:string}[]` plus `journeyStep?: number`. Render it in the same SVG layer as `routePath`, reusing `project(...)`. Number the stops and highlight the active one. In non-overview mode, set `fixedFrame`/`viewRadius` from `chartFrame(journey)` and the maximum pairwise separation, mirroring lines 165-182. Keep the `exhaustive-deps` error rule clean. Make sure every journey stop is in `nodes` (as a `SkyNode` with `type:'messier'|'binocular'|'star'`) so it gets a symbol and label.

### Other components

- **`TargetPhoto({target, compact?, opticalField?})`** (`components/TargetPhoto.tsx:7-16`) and **`TargetPhotoCredit`** (line 18). These are the primary photo plus caption. They show "Archive photograph unavailable" when an id has no media, which includes every `star:HR…`.
- **`BinocularImages({id, name})`** (`components/BinocularImages.tsx:10-31`) is the optical/infrared/featured switcher with credits. **`BinocularPhoto`** is at line 5.
- **`PhotoFieldPreview({target, field, inline?})`** (`components/PhotoFieldPreview.tsx:12`) is the photo-or-stars toggle framed at the binocular field. It embeds **`BinocularStarField({target, center, width, height, shape, mirrored, rotation, initialDepth})`** (`components/BinocularStarField.tsx:10`), a synthetic binocular view built from finder-stars. That is the closest thing to "what you will actually see" and belongs on every stop card.
- **`NightAltitudeChart({target, lat, lon, night, timezone, skyBrightness, moonAt, range?, selectedAt?, scheduledAt?})`** (`components/ObservingVisuals.tsx:112-204`) shows altitude, Moon distance and moonlight shading across the night. **`NightObservationDetails`** (line 205) is the collapsible version. `scheduledAt` can mark the stop's slot. The compact sparkline `CompactNightCurve` (`BinocularGuide.tsx:36`) is **not exported**. Export it if you want the same mini curve.
- **`BinocularAssessment({target, profile, alt, moon, skyBrightness, compact?})`** (`components/BinocularAssessment.tsx:31`) is the "Excellent / Worthwhile / Challenging" verdict with reasons.
- **`MoonlightCard`** (exported from `MoonObservatory.tsx:24`, used in `BinocularGuide.tsx:337`).
- **`AltitudeStatus` and `ExplainedStatus`** (`components/ExplainedStatus.tsx:8, 29`) are altitude badges with explanations.
- **`CatalogSkySymbol({category})`** (`components/CatalogSkySymbol.tsx:2`) is the object-type glyph.
- **Card pattern.** `BinocularGuide.tsx:301-310` renders the card grid (`article.binocular-target-card`, photo, eyebrow, h3, impression, compact curve, actions). The detail dialog at `BinocularGuide.tsx:324-350` shows the structure a stop card should copy: impression, then a finder `SkyChart`, conditions, assessment, the "Start here" finding text, `PhotoFieldPreview`, then reference photos. CSS is in `components/BinocularGuide.css`.
- **Add to session.**
  - `toggleSave(id, preferredAt?)` (`planner.tsx:577-586`) **toggles**: it removes the item if it is already present. It finds or creates the session for that night and site. Session item ids are unified ids, `star:HR…` or `moon:…`.
  - **Recommendation:** add an add-only `addManyToNight(ids, at)` in the planner, built on the same `matches`/`saveNewSession` logic, for "Save this journey to my night". Order is not stored: `suggestSequence` reorders the items, and that is acceptable. Use `isSavedAt` (`planner.tsx:1924`) for per-stop saved state.
- **Mark observed:** `markObserved(id)` (`planner.tsx:587`).
- **Red light** needs no work. `NightVisionFilter` (`components/NightVisionFilter.tsx`) wraps the shell, and `issue-ux.css:228-244` filters the shell and Radix dialogs. Anything rendered inside the planner or a Radix `Dialog` is covered. **Avoid custom portals to `document.body`.** Use colors from the existing palette (`index.css`). New photos are filtered automatically.
- **shadcn/ui** components live in `components/ui/*`, and the planner already uses `Dialog`, `Button`, `Select` and `Slider`.

---

## 8. Offline and service worker

- **Build** (`script/build.ts:37-81`): after `vite build`, it walks **every file in `dist/public`** (everything in `client/public` plus the hashed bundles), writes `offline-assets.json` with `files` and `sizes`, injects a content hash into `sw.js` and `index.html`. **There is no manual registration list.** Any new file under `client/public/` lands in the manifest automatically.
- **SW** (`client/public/sw.js`):
  - On install, it precaches all "essential" files.
  - Files matching `isBulkAsset` (`sw.js:8-15`) are deferred. Today that is `data/binocular-images/`, `data/finder-stars/`, and the moon feature crops and LROC map. They are cached on first view, or all at once by "Download all" (the `OFFLINE_DOWNLOAD_ALL` message, `sw.js:135-191`).
  - Fetch is cache-first, with on-demand caching of same-origin GETs.
- The SW is **only registered in production** (`lib/offline.ts:89-95`). In `npm run dev` there is no SW, so test offline behavior with `npm run build && npm start`.
- **Recommendations:**
  - Put the KB JSON at `client/public/data/sky-journeys-kb.json`, which makes it essential and precached on install. Keep it well under 1 MB, because install fetches it in batches of 16.
  - Put journey images in `client/public/data/journey-images/`, **and add that prefix to `isBulkAsset` in `sw.js:11-13`**. Otherwise every new photo becomes an install-blocking essential download.
  - Use JPEG at 640×480, like the existing 38 MB `binocular-images/`.
  - The Offline panel (`components/OfflineControls.tsx`, `lib/offline.ts`) reports bulk progress generically, so no change is needed there.
  - If a journey card should work offline without "Download all", consider caching only the images of the generated journey's stops (8-10 files) when the journey opens: `fetch()` them and the SW caches them.

---

## 9. Performance constraints and what is fragile

### Performance facts

- **Bundle:** one main chunk, `index-*.js`, at **1.48 MB minified / 430 KB gzip**, plus `route-worker` (90 KB) and `clock-season.worker` (146 KB). CSS is 247 KB. There is **no code splitting**: no `React.lazy`, and every `import x from "./*.json"` is inlined. Vite already warns about chunks over 500 KB.
- **Dist:** about 80 MB in 929 files. Most of that is `binocular-images` (38 MB), `finder-stars` (30 MB) and `moon` (7.3 MB).
- **Workers:**
  - `route-client.ts` creates a fresh module Worker per request, single-flight. The worker re-points `fetch` to `document.baseURI` (`route-worker.ts:1-6`).
  - `AstronomicalClock.tsx:253-275` creates `clock-season.worker.ts`. That worker is the **template to copy** for a `journey.worker.ts`: `postMessage(request)`, progress messages, then `{value}` or `{error}`.
- **Main-thread costs:** `moonState` and `eqToHorizontal` each call astronomy-engine. Scoring about 300 candidates × 20 time samples × the Moon model is cheap in a worker and noticeable on the main thread of a phone. Always cache Moon states per timestamp (`createMoonSampler`).

### Recommendations

- Lazy-load the Journeys page: `const SkyJourneys = lazy(() => import("@/components/SkyJourneys"))` in `planner.tsx`, inside `<Suspense>`. It becomes the repo's first split chunk, and it is still precached because the build manifest includes every emitted asset.
- Fetch the KB JSON inside the worker. Do not import it.
- Keep scorer weights as JSON (a decision tree or a linear model), evaluated in plain TypeScript. **No ML runtime dependency.**

### Fragile things

1. **The planner is a 2,224-line, 118 KB component.** Every render recomputes `ranked`, `filtered` and other values. Keep Journeys state local to `SkyJourneys`, and pass memoized props. In particular, wrap callbacks in `useCallback` where Journeys memoizes on them.
2. **`timeMode:"live"` re-renders every 30 s** (`planner.tsx:251-261`), and `date` changes each time. Key the journey generation on a **coarse** time, for example the observing night plus the 15-minute slot. Otherwise live mode regenerates the journey every 30 s and reshuffles stops in front of the user.
3. **`update({targetId})` clears `startStarId` and `waypointIds`** (`planner.tsx:192-196`). Set the target and the start in a single `update` call.
4. **`setPage` closes the dialogs** on every location change (`planner.tsx:216`). Deep-linking `#/journeys/<key>` must restore from the URL and from `starhop-sky-journeys-v1`, not from transient state.
5. **Hop progress restore** (`planner.tsx:456-500`, `lib/hop-progress.ts`) runs on the `hop` page. Navigating to a leg will interact with any saved hop progress that is less than 8 hours old.
6. **The SkyChart `exhaustive-deps` lint rule is an error.** Projection memos break visibly when a dependency is missing.
7. **Duplicate stellar identities** (`STAR-*`, `HR*`, `star:HR*`). See section 4.
8. **`toggleSave` removes an item that is already saved.** Never call it to "ensure" an item is present.
9. **The media guard tests** (`binocular-guide.test.ts:64-125`) require decoded images for every manifest entry. Do not add entries without the files.
10. **The nav-count assertion** in `script/review-round3/round3-regression.cjs` expects 7 tabs.
11. **`weather.test.ts` already fails** before any change: "finds dry windows only inside astronomical darkness…" fails on 2026-11-01 (1 of 379). It is date-dependent. Do not chase it as a regression.

---

## 10. What does not exist yet (Journeys must build it)

- A **spatial ordering and region constraint.** Nothing in the repo reasons about path geometry across objects. `suggestSequence` is purely temporal. Suggestion: compute the stops' horizontal positions (alt/az) at the journey's mid-time, require the whole set within one sky "patch", and order the stops as an open path with a monotone sweep. Penalize direction reversals, and use `angularDistance` legs scaled by the field width. The DP or beam search in `suggestSequence` shows the code style for bounded search.
- An **astrophysical knowledge base**: spectral type, distance, radius, luminosity, age, evolutionary stage, multiplicity and variability, all with sources.
- **Story and theme logic** with "why this stop" and "why from the previous stop" text.
- A **learned scorer.** There are no ML assets. Everything is heuristic: `rankTargets` and `binocularAssessment`.

---

## 11. Testing

### Vitest

- **Config:** `vite.config.ts`, the `test` block. Environment `node`, `globals: true`, include `client/src/**/*.test.ts` (**only `.ts`**, so there are no React component render tests and no jsdom), alias `@` → `client/src`.
- **Commands:** `npm test` (= `vitest run`) or `npx vitest run <file>`. The binary is `node_modules/.bin/vitest`, already installed.
- **Current state:** **54 files and 379 tests. 378 pass, 1 fails (pre-existing, see section 9). The run takes about 4 s.**
- **Layout:** `client/src/lib/__tests__/*.test.ts` (52 files plus `test-helpers.ts`) and `client/src/components/__tests__/*.test.ts` (2 files, which test pure helpers exported from components).
- **Catalog loading in tests:** stub fetch to read from `client/public`, as in `plan-routes.integration.test.ts`, `binocular-guide.test.ts:9` and others:
  ```ts
  vi.stubGlobal("fetch", async (input: string) => new Response(readFileSync(resolve(__dirname, "../../../public", input.replace(/^\.\//, "")), "utf8"), { status: 200 }));
  ```
  You can then call `loadStars()`, `loadMessier()`, `loadBinocularTargets()`, `buildUnifiedTargets()` and `planRoutes()` directly. `test-helpers.ts` also offers synchronous disk loaders (`loadTestCatalogs`, `findStar`, `findTarget`).
- **localStorage in tests:** use `vi.stubGlobal('localStorage', store)` with a Map-backed store (`stargazing-forecast.test.ts:58`).
- **Conventions:** use fixed dates and sites (SF 37.77 / -122.42 dominates, plus southern sites), and check results against astronomy-engine or published values rather than snapshots.
- **Recommendation:** add `client/src/lib/__tests__/journeys-*.test.ts` and assert the constraints as properties over a grid of (site × date × hour × Moon phase):
  - every stop alt ≥ the floor and dark enough
  - Moon brightening below the threshold
  - `binocularAssessment` rating within the allowed range
  - the region spread is bounded
  - reversals ≤ 1
  - 3-10 stops
  - the same inputs give the same output (determinism with a seed)
  - a KB schema test: every KB id resolves to a catalog target or BSC star, every field has a source

### Playwright review scripts

- **Location:** `script/review-round3/` (13), `review-round4/` (5), `review-round5/` (16). These are standalone `.cjs` Node scripts using `require('playwright')`. Some also use `astronomy-engine` for independent geometry checks and `node:assert/strict`.
- **Common pattern** (`review-round5/sky-visibility.cjs:1-12`, `review-round5/performance.cjs`):
  1. `chromium.launch(...)`, `newPage({viewport, serviceWorkers:'block'})`.
  2. `page.clock.setFixedTime(new Date(...))` freezes "now".
  3. `goto(base+'#/')`, then `waitForFunction(() => localStorage.getItem('starhop-settings-v2'))`, which waits for the app to write its defaults.
  4. Merge a seed into `starhop-settings-v2`, through `addInitScript` reading a sessionStorage seed or through `page.evaluate`, then `reload()`.
  5. Drive with `getByTestId('tab-…')`, `getByTestId('sky-chart-sky')`, `[data-star-id]`, `[data-label-owner]`.
- **Environment gotchas on this machine** (aarch64 DGX Spark):
  - The scripts hard-code `executablePath:'/usr/bin/chromium'`, which **does not exist here**. Omit `executablePath`, or set `CHROMIUM_PATH` where a script honors it. Playwright 1.64.1's bundled Chromium (`~/.cache/ms-playwright/chromium-1248`) works.
  - Playwright is **not** in the repo's `node_modules`. Use `NODE_PATH=/home/lorenzo/.npm/_npx/e41f203b7505f1fb/node_modules` (playwright 1.64.1, verified).
  - Default `BASE_URL`s in the scripts (5035/5036/5065) are stale. Always pass `BASE_URL`.

### Recipe for simulated-student agents (verified 2026-11-01)

1. **Start the dev server** on a port of your choice. If the port is busy, it silently falls back to a random free port, so **read the actual port from the log**:
   ```sh
   cd /home/lorenzo/starhop-planner
   PORT=5090 npm run dev > /tmp/<your-scratch>/dev.log 2>&1 &
   until grep -q "serving on" /tmp/<your-scratch>/dev.log; do sleep 1; done
   grep -o "http://localhost:[0-9]*" /tmp/<your-scratch>/dev.log   # actual URL
   ```
   In the verification run, port 5077 was taken by another process and the server picked 37651. Dev mode has no service worker. For offline tests, use `npm run build && PORT=… npm start` instead.
2. **Script skeleton** (`student.cjs`, run with `NODE_PATH=/home/lorenzo/.npm/_npx/e41f203b7505f1fb/node_modules BASE_URL=http://127.0.0.1:<port>/ node student.cjs`):
   ```js
   const {chromium}=require('playwright');
   (async()=>{
     const browser=await chromium.launch();               // bundled chromium; no executablePath
     const page=await browser.newPage({viewport:{width:393,height:852},serviceWorkers:'block'}); // phone; or 1280x900
     page.setDefaultTimeout(60000);
     await page.clock.setFixedTime(new Date('2027-01-15T04:00:00Z')); // freeze "now" (affects live mode)
     // Observing context: Milan, 14 Jan 2027 21:00 local (= 20:00Z), binoculars 14x50
     const seed={lat:45.46,lon:9.19,timeMode:'planned',date:'2027-01-14',time:'21:00',
       plannedAt:'2027-01-14T20:00:00.000Z',instrumentSelected:true,mode:'binocular',
       skyBrightness:20.5, binocularMagnification:10, binocularAperture:50, binocularFov:6.5, fov:6.5, fovHeight:6.5};
     await page.addInitScript(seed=>{try{const cur=JSON.parse(localStorage.getItem('starhop-settings-v2')||'null');
       if(cur&&!sessionStorage.getItem('seeded')){localStorage.setItem('starhop-settings-v2',JSON.stringify({...cur,...seed}));sessionStorage.setItem('seeded','1');}}catch{}},seed);
     await page.goto(process.env.BASE_URL+'#/');
     await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2')); // app wrote full defaults
     await page.reload();                                   // init script merges the seed exactly once
     await page.getByTestId('tab-journeys').click();        // or page.goto(BASE_URL+'#/journeys')
     // ... read cards, click stops, screenshot: await page.screenshot({path:'/tmp/<scratch>/j.png',fullPage:true});
     await browser.close();
   })();
   ```
   - The seed is **merged into the app's own defaults**. The settings schema rejects partial objects and silently falls back to defaults, which is why the script must wait for the first write before merging.
   - `plannedAt` must match `date`+`time` in the site's time zone, or it is ignored and the time is resolved from `date`+`time` (`session.ts:105-111`).
   - Pick `lat`/`lon`. The time zone is derived from them.
   - Turn on red light with `seed.redLight = true`, or click `getByTestId('button-red-light')`.
   - Sky darkness default: set `skyBrightness` (17 = city, 19 = suburb, 21.5 = dark site).
3. **Navigation and testids:**
   - Tabs: `tab-tonight`, `tab-night` (Planner), `tab-clock`, `tab-catalog`, `tab-binocular`, `tab-moon`, `tab-hop`, and the new `tab-journeys`.
   - Hash routes: `#/`, `#/planner`, `#/clock`, `#/catalog`, `#/binoculars`, `#/moon`, `#/hop`, `#/hop/<targetId>`, and the new `#/journeys[/<key>]`.
   - Other ids: `session-timebar` (date bar), `sky-chart-sky` (chart SVG), `offline-indicator`.
   - **Recommendation:** give Journeys stable testids: `journeys-theme-<id>`, `journey-stop-<n>`, `journey-stop-card`, `journey-path-chart`, `journey-hop-from-previous`, `journey-save-night`.
4. The verified smoke run printed `settings 45.46 9.19 2027-01-14 21:00 planned`, so the seed applied, and the hash navigation worked.

---

## 12. Proposed file layout for Sky Journeys

```
client/public/data/sky-journeys-kb.json          # knowledge base (fetched lazily; precached)
client/public/data/sky-journeys-model.json       # learned scorer weights / tree (small)
client/public/data/journey-images/*.jpg          # new media (add prefix to sw.js isBulkAsset)
client/src/lib/journeys/types.ts                 # KB + Journey/Stop types, zod schemas
client/src/lib/journeys/ids.ts                   # stopId <-> routing HR id <-> session id
client/src/lib/journeys/conditions.ts            # per-stop feasibility at time t (alt, dark, moon, binocular fit)
client/src/lib/journeys/region.ts                # patch selection, ordering, zig-zag metrics
client/src/lib/journeys/assemble.ts              # theme/story assembly + scoring (pure, seeded)
client/src/lib/journeys/scorer.ts                # evaluates model JSON (tree/linear), no deps
client/src/lib/journeys/narrative.ts             # "why this stop" / "why from previous" text templates
client/src/lib/journey.worker.ts                 # wraps assemble(); pattern of clock-season.worker.ts
client/src/components/SkyJourneys.tsx (+ .css)   # page; lazy-loaded from planner.tsx
client/src/components/JourneyStopCard.tsx        # reuses TargetPhoto, PhotoFieldPreview, NightAltitudeChart, BinocularAssessment
client/src/lib/__tests__/journeys-*.test.ts
script/review-journeys/*.cjs                     # playwright scenarios (use recipe above)
```

Planner touch points (keep them minimal):

- `navigation.ts`: the page and path.
- `planner.tsx:904` (nav entry) and around `:1923` (render branch).
- A new `planJourneyLeg` next to `planBinocularHop` (`:721`).
- A new add-only `addManyToNight` next to `toggleSave` (`:577`).
- `SkyChart.tsx`: the optional `journey`/`journeyStep` props.
- `sw.js`: the bulk prefix.
- `round3-regression.cjs`: 7 → 8 tabs.
