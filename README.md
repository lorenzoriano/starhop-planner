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
2. Choose binoculars or a telescope, and match the navigation field to your instrument. For a telescope, usually use the finder field while hopping.
3. Explore **Tonight**. The overhead chart shows the actual visible sky; the catalog can be filtered by altitude, object type, or binocular suitability.
4. Add objects to **My night**, or select **Star hop**. Plan a route and confirm each field before moving. Mirror and rotate the chart to match your optics.
5. Record observations and notes. Export notes as Markdown or a route as JSON. Red light mode dims and recolors the interface.

The **Binoculars** section offers 240 sourced targets: stars, asterisms, wide doubles, clusters, nebulae, and galaxies. Select a month to see recommendations calculated for your location at 21:00 on the 15th. Small binoculars is the default filter; turn it off for the separate mounted 80 mm tier. Every target includes optical DSS2 and near-infrared 2MASS survey images, an original finder chart, annual altitude pattern, observing notes, source references, and SIMBAD/Aladin links. Save targets to **My night** or plan a binocular hop at the displayed time. The 480 survey illustrations are bundled and cached offline; wait for **Offline ready** on your first online visit. External reference links need a connection. See [the research notes](docs/binocular-guide-research.md) for sources and image credits.

The Tonight sky, binocular finder and hopping route use the same chart controls. Adjust field width, star magnitude, brightness and labels; mirror or rotate the view to match your optics. Display preferences persist between sections and visits. **Fit field** frames the configured field, while **Stars only** removes constellation labels and navigation overlays. The binocular finder is the primary view; research photographs are expandable references, and selected targets link to actual binocular-observer sketches with recorded equipment and sky conditions.

Sky darkness and Moon illumination are astronomical calculations, not a weather forecast. Object altitude and integrated magnitude do not guarantee visibility: sky brightness, surface brightness, aperture, and experience matter. The general object artwork is labeled as an illustration. Catalog charts show real star positions to magnitude 8; stars-only mode does not simulate nebulae or guarantee eyepiece visibility.

## Moon observing and time

The **Moon** section contains 55 named seas, bays and craters with IAU/USGS coordinates, original observing notes and links to their feature records. The NASA LROC surface map is bundled offline. The atlas projects the surface for the actual observer, including lunar libration, and calculates the illuminated side. **Inspect atlas** enlarges it for identification; **Binocular field** uses your magnification, aperture and true field to scale and limit the preview. Mirror and rotation share the sky-chart display settings. The smooth-sphere preview does not simulate crater relief shadows, earthshine, eclipses or exact visual perception.

The daily Moon altitude chart shows your selected target too, plus astronomical darkness, rise/set azimuths and the highest point. Moonless windows cover the next 24 hours from the chosen moment and carry date labels; post-set shortcuts identify daylight or twilight. Choose a time or a moonless window to update the whole session. Times use the observing location's time zone and handle 23/25-hour daylight-saving days. No-event dates at polar latitudes are labeled. Flat horizon and standard refraction are assumed; terrain and weather are not measured.

Target guidance shows angular separation from the Moon, its illumination and altitude, catalog magnitude and a moonlight estimate based on the [Krisciunas–Schaefer paper](https://articles.adsabs.harvard.edu/pdf/1991PASP..103.1033K). The extra sky glow is expressed in magnitudes, not an object visibility probability. Change the assumed moonless zenith sky brightness in the Moon section; default extinction is 0.172 mag/airmass. Faint diffuse structure, bright stars and clusters receive different guidance. Twilight, low altitude, very close/far separation and eclipses limit the model's use.

The date bar stays visible on all pages and phones. **Live sky** follows the device clock every 30 seconds and on resume, including date rollover. **Planned session · fixed time** explicitly pins the chosen date and minute; **Use current time** returns to live. Full year, time zone and location are shown. The monthly binocular guide still uses its labeled sample time on the 15th; it is not a live clock. Inputs reject times skipped by a daylight-saving jump.

Moon features can be saved, marked observed and annotated in **My night**, and included in exported Markdown notes. Sources and credits are linked in the section and recorded in [the offline map credits](client/public/data/moon/CREDITS.md).

## Offline use

Open the production app once online and wait for **Offline ready**. The build generates a manifest of every JS/CSS asset, icon, and the astronomy catalogs, survey images and lunar map. The service worker stores that complete build before activating it. It can then reopen and calculate new routes without network access. The status checks that all required files are actually cached.

Install the app using your browser’s install or Add to Home Screen action if desired. Use the same browser and address at the observing site. Preferences, your list, and notes use local storage; clearing browser data removes them. Export notes for a portable backup. Each origin and hosting path keeps its own offline cache.

## Project layout

- `client/src/pages/planner.tsx`: Tonight, guided star hopping, the saved observing list, and setup.
- `client/src/components/ObservingVisuals.tsx`: overhead sky, object illustrations, and altitude forecast.
- `client/src/components/SkyChart.tsx`: detailed field chart, patterns, route overlays, and optical orientation.
- `client/src/lib/astronomy.ts`, `route-planner.ts`, `cost-strategies.ts`: catalogs, coordinates, patterns, and routing.
- `client/src/lib/observing.ts`: sky conditions, object guidance, and recommendations.
- `client/src/lib/session.ts`, `hooks/use-local-state.ts`: validated device storage.
- `client/src/lib/offline.ts`, `client/public/sw.js`, `script/build.ts`: production offline preparation.
- `server/`: Express hosting shell. The database/storage stubs are currently unused.

See [the repository assessment](docs/repository-assessment.md) for the changes and next priorities.
