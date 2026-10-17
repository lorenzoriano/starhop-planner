# StarHop

An offline night sky companion for observers with binoculars and small telescopes. Explore what is above the horizon, plan a route from a bright star to a deep sky object, and keep an observing list and field notes on your device.

## Run it

```sh
npm install
npm run dev
```

The server defaults to port 5000 and prints its address. No database or API key is needed.

```sh
npm run check
npm test
npm run build
npm start
```

Use the production build to test offline operation. Service workers need HTTPS or localhost; they are disabled in the development preview to avoid caching development modules.

## At the observing site

1. Set your location and local date and time. The first visit defaults to San Francisco, clearly labeled in the setup. Coordinates determine the time zone.
2. Choose binoculars or a telescope in the quick instrument dialog, and match the navigation field to your instrument. For a telescope, usually use the finder field while hopping.
3. Explore **Tonight**. The overhead chart shows the actual visible sky; the catalog can be filtered by altitude, object type, or binocular suitability.
4. Open **Planner** to create a dated session at your chosen site. Add objects from the catalog, binocular guide, lunar atlas or a named chart star. Select **Star hop** to find a target; mirror and rotate the chart to match your optics.
5. Record observations and notes. Export notes as Markdown or a route as JSON. Red light mode dims and recolors the interface.

The **Binoculars** section offers 240 sourced targets: stars, asterisms, wide doubles, clusters, nebulae, and galaxies. Cards initially use your observing date and time. Select a month to switch to its labeled reference on the 15th, 15 minutes after astronomical dusk (or the optional 21:00 sample). The calendar remains a seasonal reference; the collection’s explicit date/time controls determine actual card positions and timings. Small binoculars is the default filter; turn it off for the separate mounted 80 mm tier. Every target includes optical DSS2 and near-infrared 2MASS survey images, an original finder chart, annual altitude pattern, observing notes, source references, and SIMBAD/Aladin links. Save targets to your active session or plan a binocular hop at the displayed time. The 480 survey illustrations are bundled and cached offline; wait for **Offline ready** on your first online visit. External reference links need a connection. See [the research notes](docs/binocular-guide-research.md) for sources and image credits.


Binocular cards and details show **rise, upper transit and set** for the selected local calendar date and site. These are geometric flat-horizon estimates using the same fixed catalog coordinates as the charts; refraction, terrain and local obstructions are not modeled. Circumpolar objects show Always up; inaccessible objects show Never rises. A set time earlier than rise belongs to the morning of that selected date, not the following morning.

Use **When** to choose **At a chosen time**, **During the night**, or **Custom time range**, then set the minimum altitude (for example 50°). Night mode uses astronomical darkness, from astronomical dusk to astronomical dawn (Sun below −18°), within the selected local noon-to-noon interval; polar summer can have no matching darkness. A custom range such as 20:00–22:00 can require the altitude at **any point** or for the **whole range**. An end time at or before the start continues into the next local day. Cards and hop previews use each target’s highest altitude in the matching window; +1d marks a peak after midnight. Window modes turn off the optional monthly-picks restriction so it cannot silently hide suitable targets. Clear the altitude field for any altitude. These filters do not measure weather or guarantee visibility in moonlight. **Books & sources** is a compact disclosure at the end.


Binocular target details open the shared finder chart at a reference depth of magnitude 10.5, independently of the route’s limiting magnitude. The offline Tycho-2 fields add real ICRS/J2000 star positions and VT photometry around every target with bundled survey media. Deeper coverage extends 8° from the target; the brighter catalog supplies wider context. Smaller, dimmer points represent fainter stars, and the Milky Way outline is subdued in close fields. A fine gold outline shows the catalog object diameter where supplied. Hover over a star for coordinates and catalog magnitude. These are reference charts: unresolved cluster glow, nebulosity and exact visual detectability are not simulated. The separate survey photographs provide photographic context. [Catalog provenance and limits](client/public/data/finder-stars/CREDITS.md).

Each compact binocular card and its detail view includes the full astronomical-night graph. **Solid mint** is target altitude on the left 0–90° axis; **dashed gold** is angular distance from the Moon on the right 0–180° axis (180° is opposite the Moon). More gold background means stronger estimated moonlight, calculated from phase, lunar height and target separation using the existing Krisciunas–Schaefer model and configured sky brightness. The shading vanishes when the Moon is down. The night’s date, a 0% New Moon–100% Full Moon illumination meter and a suggested time are shown below. The meter follows the inspected time and explicitly labels a Moon below the horizon; illumination is distinct from the estimated sky-glow shading. Low sky glow uses enhanced visual contrast so weak moonlight remains visible. Hover over the plot for a crosshair and exact local time, altitude and Moon-distance readout; on phones, tap or drag horizontally while vertical swipes still scroll. Keyboard users can focus the plot and use arrows (one minute), Shift+arrows (15 minutes), Home/End (night boundaries), or Escape (clear). Inspecting the chart does not open the target details. Suggestions balance altitude against modeled glow, with stronger penalties for faint stellar and diffuse objects; they are not guarantees of visibility. Samples are about 15 minutes apart with altitude extrema included, and weather/local obstructions are not measured.

Planner has the same **Altitude & Moon graph** in each target row, with the first scheduled target initially expanded. Other graphs compute when opened. Suggestions are restricted to starting times that fit the selected session’s minutes per target; after-midnight sessions use the preceding evening’s night when it overlaps more. Individual suggestions can differ from the multi-target sequence, which also has to fit other targets and closing windows. Lunar landmarks continue to use the Moon atlas rather than a meaningless distance-from-itself graph.

The Tonight sky, binocular finder and hopping route use the same chart controls. Label size, star brightness and guide-star size stay visible below every chart. Adjust field width and star magnitude; mirror or rotate the view to match your optics. The Reticle selector adds calibrated Telrad (½°/2°/4°) or Rigel (½°/2°) rings as angular rulers. Their sizes are diameters; field width still controls route spacing. Labels use screen pixels and do not grow when you zoom. Routes open on the starting field, and **Route overview** shows the whole journey. On phones, Previous/Next and an expandable field guide sit directly below the map, before the adjustment controls. The guide distinguishes the celestial **Sky** bearing from the rotated/mirrored **Chart** direction and clock position. Chart directions describe the next field’s position; mount movement can differ from image motion. Display preferences persist between sections and visits. Ordinary wheel movement scrolls the page or dialog; Ctrl/⌘ + scroll zooms in 20% steps. **Fit field** frames the configured field, while **Stars only** removes constellation labels and navigation overlays. The binocular finder is the primary view; research photographs are expandable references, and selected targets link to actual binocular-observer sketches with recorded equipment and sky conditions.

Sky darkness and Moon illumination are astronomical calculations, not a weather forecast. Object altitude and integrated magnitude do not guarantee visibility: sky brightness, surface brightness, aperture, and experience matter. Tonight's featured object, discovery cards and saved catalog targets use actual DSS2 optical photographs. All 297 discovery objects have offline images; the 57 targets outside the binocular collection have optical cutouts in addition to that collection's 480 optical/infrared images. The featured panel links the original cutout and credits, gives the field width, and explains that telescope exposures show more color and detail than binoculars. Catalog charts show real star positions to magnitude 8; stars-only mode does not simulate nebulae or guarantee eyepiece visibility.

## Moon observing and time

The **Moon comparison object** picker makes the shared target explicit and lets you search by name, constellation or catalog number. Opening a binocular target selects it globally; its **Check against the Moon** button carries that detail view’s date and time into the Moon page. The star-hop destination has the same action. Changing the Moon comparison also changes the object shown in Tonight and Star hop, while preserving the current observing time and location.

The **Moon** section contains 55 named seas, bays and craters with IAU/USGS coordinates, original observing notes and links to their feature records. The 4K NASA LROC surface map and photographic reference crops for all 55 landmarks are bundled offline. The atlas renders the visible viewport afresh at the current zoom, rather than enlarging a fixed image; dragging uses a lightweight preview and restores sharper detail on release. Landmark cards include finding notes and fixed-lighting photographic crops from the 8K source mosaic, with credits; the deep-sky panel uses the shared optical survey photographs. The atlas projects the surface for the actual observer, including lunar libration, and calculates the illuminated side. **Inspect atlas** enlarges it for identification; **Binocular field** uses your magnification, aperture and true field to scale and limit the preview. Mirror and rotation share the sky-chart display settings. The smooth-sphere preview does not simulate crater relief shadows, earthshine, eclipses or exact visual perception.

The daily Moon altitude chart keeps the solid gold Moon curve and dashed mint target curve, with a visible legend. A separate aligned chart shows their angular separation across the sky, not merely their difference in height. A labeled detail scale and daily minimum/maximum make small changes visible; a button restores the full 0–180° scale. The chart explains why Earth’s rotation moves both objects together while the Moon’s orbit changes their separation more slowly. Saved observing-location names replace coordinates in the chart heading when available. Selected-time guidance combines this distance with Moon illumination, Moon altitude and target type. A high crescent is less bright than a high full Moon. Moonless windows cover the next 24 hours from the chosen moment, carry date labels and use searched rise/set and twilight crossings. Astronomical twilight uses the Sun’s geometric center at −18°. The “Moonset + 15 min” shortcut identifies daylight or twilight and makes its observing margin explicit. Choose a time or a moonless window to preview that sky. Times use the observing location's time zone and handle 23/25-hour daylight-saving days. No-event dates at polar latitudes are labeled. Flat horizon and standard refraction are assumed; terrain and weather are not measured.

The atlas has visible **Label size**, **+**, **−** and **Reset** controls. Drag with a mouse or finger to pan. Ordinary wheel movement scrolls the page; Ctrl/⌘ + scroll or a two-finger pinch zooms the chart. Panning preserves orientation; **Rotate** and **Mirror** change it explicitly. Landmark labels use screen pixels, remain upright and retain their chosen size when zooming. These display preferences are shared with star charts.

Target guidance shows angular separation from the Moon, its illumination and altitude, catalog magnitude and a moonlight estimate based on the [Krisciunas–Schaefer paper](https://articles.adsabs.harvard.edu/pdf/1991PASP..103.1033K). The extra sky glow is expressed in magnitudes, not an object visibility probability. Change the assumed moonless zenith sky brightness in the Moon section; default extinction is 0.172 mag/airmass. Faint diffuse structure, bright stars and clusters receive different guidance. Twilight, low altitude, very close/far separation and eclipses limit the model's use.

The date bar stays visible on all pages and phones. **Live sky** follows the device clock every 30 seconds and on resume, including date rollover. **Viewing planned sky** pins the preview date and minute; **Use current time** returns to live. Full year, time zone and location are shown. The binocular calendar uses labeled samples on the 15th; its collection can follow the observing time or use a separately selected date/window. Inputs reject times skipped by a daylight-saving jump.

Moon features can be saved, marked observed and annotated in **Planner**, and included in exported Markdown notes. Sources and credits are linked in the section and recorded in [the offline map credits](client/public/data/moon/CREDITS.md).

## Calendar and observing sessions

**Planner** is one compact workspace for the active night. **Plan tonight** creates or selects a nearby saved session with one click; **Next new Moon** starts a night near the next actual new Moon. Enter a date, local time and duration inline, then save changes. Site coordinates, names and minutes per target are under the site/details disclosure. The first target can save a new night without a separate creation dialog.

Search and press Enter to add a target, or use a high-altitude suggestion. The viewing order, observed toggles, removal and expandable field notes share one target list. Observed targets and objects outside the usable window are grouped separately. Use the night selector to switch sessions, **Calendar** for the full calendar and archived nights, and **Export & more** (the download icon on phones) for SkySafari, notes and session actions. The general time bar and equipment sidebar are tucked away on this view to keep the planning controls central; the settings button still opens advanced equipment controls.

**Save location** names the current coordinates for reuse, for example Home or a dark-sky campsite. The same saved-location picker is available directly in Planner and in the sky settings. Set coordinates in the site/details controls, or use the sky settings' **Use my location**, then save the spot. Selecting a saved location in an existing night is applied with **Save changes**; adding a target also saves pending changes. **Plan tonight** uses the selected spot directly. Saving an existing name updates its coordinates; **Manage location → Remove saved location** removes only the shortcut, leaving existing nights intact. Locations persist on this browser/device and work offline; they do not sync across devices.

Use the catalog search or an object's add/remove button to build the active session. Clicking an identified foreground chart star opens its details and a save button; faint background survey dots are contextual. Each session keeps its own targets, observations and notes. Completing a first hop with **I found it!** creates a dated session and records the observation while keeping the map in place. Switching sessions restores its observing time and site. Archive/restore retains its records, and the previous observing list remains available for migration.

The suggested viewing sequence allocates nonoverlapping slots within the session, prioritizes the first viewing window that closes, then considers altitude and estimated moonlight, and leaves targets without a usable slot clearly flagged. Stars can be considered in darker twilight; deep-sky targets require astronomical darkness. Lunar landmarks also require illumination, a visible hemisphere and separation from the Sun. The sequence is guidance, not a guarantee of visibility. Open a suggested slot to see the sky at that time.

Tabs have bookmarkable hash routes and work with browser Back/Forward and reload; target links such as `#/hop/M31` open their finder view.

Tonight search also finds Bright Star Catalogue names, Bayer designations such as Alpha UMi, Flamsteed numbers and HR identifiers. Inspect a result using the shared chart or add it to your session. The ordinary discovery gallery stays focused on curated objects. Search filters still apply; turn off **Above 15°** to include low or below-horizon stars.

On Star hop, choose a nearby **Starting star**, or use **Start hop from this star** in a star inspector, to keep your destination and plan from a visible reference. The chosen reference must be above 5° and within both the bright-anchor and guide-star limits. Unavailable starts produce a warning rather than an automatic substitution. Intermediate waypoint editing is not included.

Active hop progress is saved on this device. Reload regenerates positions and restores the same physical route and field when the observing settings still match. A changed path restarts at the first field with an explanation; live records expire after eight hours. Live sky keeps running rather than restoring an old instant. Orientation preferences persist, but manual camera position and zoom are not saved with the hop.

**Fine tune equipment** for a telescope includes an eyepiece calculator: telescope focal length, eyepiece focal length and apparent field give magnification and approximate true field. **Apply this field** changes the chart only when requested. Use a finder field for navigation when appropriate. **Optical finder · crosshair** uses your measured field width; magnification and aperture alone do not specify a finder's true field.

Previewing another date or site does not move a saved session. The time bar identifies which session receives added targets; saved target cards and exported notes use that session's date and site. Everything persists on the device and works offline after preparation.

## Export to SkySafari

In **Planner → Export & more → Export to SkySafari**, choose **Observing list** for all saved targets or **Night plan** for the active session's scheduled targets in the suggested order. Download the `.skylist` for SkySafari Plus and the `.txt` plan for times, site, observations and complete notes. Supported phone browsers also offer **Share .skylist** through the device's share sheet. Cancelling sharing does not download a file or claim it was imported.

On Android, open the `.skylist` in **Files → Downloads** with **SkySafari Plus**, then look under **Observe → Observing Lists**. If the file handler is not offered, try opening an email attachment with SkySafari. From a computer, transfer the file to the phone by USB or email and follow those steps. Device/version differences and the official Android troubleshooting link are explained in the export dialog. Set SkySafari's date/time and location separately from the plan; list import does not change them.

The exporter uses the documented V3 identifier format, including actual observed timestamps as Julian dates. Planned times remain comments. Lunar landmarks share one Moon entry with individual records in notes. Custom patterns without a standard identifier are explicitly listed for manual lookup and preserved with their positions in the complete notes file. StarHop never supplies its private target IDs as SkySafari database IDs. See [export details and compatibility limits](docs/skysafari-export.md).

## Offline use

Open the production app once online and wait for **Offline ready**. The build generates a manifest of every JS/CSS asset, icon, and the astronomy catalogs, survey images and lunar map. The service worker stores that complete build before activating it. It can then reopen and calculate new routes without network access. The status checks that all required files are actually cached.

Install the app using your browser’s install or Add to Home Screen action if desired. Use the same browser and address at the observing site. Preferences, your list, and notes use local storage; clearing browser data removes them. Export notes for a portable backup. Each origin and hosting path keeps its own offline cache.

## Project layout

- `client/src/pages/planner.tsx`: Tonight, guided star hopping, the saved observing list, and setup.
- `client/src/components/ObservingVisuals.tsx`: overhead sky, object illustrations, and altitude forecast.
- `client/src/components/SkyChart.tsx`: detailed field chart, patterns, route overlays, and optical orientation.
- `client/src/components/SessionPlanner.tsx`, `client/src/lib/session-planner.ts`: session calendar, storage schema and suggested viewing sequence.
- `client/src/components/MoonObservatory.tsx`, `client/src/lib/moon.ts`: Moon planning, atlas geometry and scattered moonlight estimate.
- `client/src/lib/astronomy.ts`, `route-planner.ts`, `cost-strategies.ts`: catalogs, coordinates, patterns, and routing.
- `client/src/lib/observing.ts`: sky conditions, object guidance, and recommendations.
- `client/src/lib/session.ts`, `hooks/use-local-state.ts`: validated device storage.
- `client/src/lib/offline.ts`, `client/public/sw.js`, `script/build.ts`: production offline preparation.
- `server/`: Express hosting shell. The database/storage stubs are currently unused.

See [the repository assessment](docs/repository-assessment.md) for the changes and next priorities.

## Verified feedback

See [the GitHub feedback review](docs/github-feedback-review.md) for issue-by-issue decisions, astronomical references, tests and deliberately qualified suggestions.
