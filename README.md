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

Sky darkness and Moon illumination are astronomical calculations, not a weather forecast. Object altitude and integrated magnitude do not guarantee visibility: sky brightness, surface brightness, aperture, and experience matter. The object artwork illustrates a visual impression; it is not an astrophotograph.

## Offline use

Open the production app once online and wait for **Offline ready**. The build generates a manifest of every JS/CSS asset, icon, and all seven astronomy data files. The service worker stores that complete build before activating it. It can then reopen and calculate new routes without network access. The status checks that all required files are actually cached.

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
