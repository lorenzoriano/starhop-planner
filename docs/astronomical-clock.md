# Astronomical clock and shared object comparison

## Why this is native — research, October 19, 2026

Reviewed Astrospheric's [clock documentation](https://www.astrospheric.com/DynamicContent/skyclock), [official embed interface](https://www.astrospheric.com/embed/) and [v2 API](https://www.astrospheric.com/DynamicContent/api_info_v2).

The documented embed is a location-aware weather control with cloud maps and forecast-hour inspection. Its public JavaScript methods are Create and ChangeLocation; it provides no documented clock object, calendar, time-travel or offline interface. The Pro data API has astronomy calculations but requires a private key and is documented for personal projects. A shared published API key would not be an appropriate integration.

StarHop therefore implements its own 24-hour polar clock, inspired by Astrospheric's altitude/time representation, using the existing Astronomy Engine and catalog data. It reuses no vendor code, imagery or private endpoints. The clock needs no forecast provider, account or subscription. It runs for the app's selected location and shares the app's chosen instant with Tonight, binoculars, Moon and planning.

## User flow

- Open **Clock**, or **Astronomical clock & compare** from a selected Tonight target, star detail, star hop or binocular detail. Binocular card footers and catalog cards have shortcuts. Planner's **Clock & compare this night** carries the resolved draft date/site and session targets.
- Search for up to eight catalog objects or stars. The comparison list persists on this device in `starhop-clock-objects-v1`. Explicit additions preserve the current set; excess items are disclosed rather than silently replacing it. Use **Add session objects** to combine a session with that set. Lunar landmarks are excluded; the Moon is always present.
- All selected objects appear together with matching colors in the polar clock, altitude comparison, Moon-distance comparison and seasonal chart. Chips highlight individual curves and their rise/transit/set event spokes. Moon context can also show event spokes.
- Date input and calendar choose the observing night. Local time input, elapsed-time slider, ten-minute keyboard steps and hour/night animation provide time travel. **Now** restores live mode. Hover is temporary inspection; clicking/tapping commits the time to the rest of the app.
- **Across the seasons** accepts an inclusive interval of up to 366 dates. It shades outer clock bands by qualifying frequency at each local half hour, plots all objects' qualifying hours across dates and offers daily tiles. A date click opens that observing night. Change altitude and Moon separation limits to suit the session.

## Time and geometry

- Each observing night runs from local noon to the following local noon. Early-morning selected times belong to the preceding evening. Midnight is at the top, noon at the bottom; the plot is time versus altitude, not a direction map. Altitude −90° maps to center, 0° to the horizon ring, +90° to the outer circle.
- Noon-to-noon elapsed time can be 23 or 25 hours at daylight-saving changes. The slider uses real UTC instants. The dial uses local wall time and breaks paths at a DST discontinuity instead of connecting across an hour jump. Repeated wall hours share an angular sector; UTC offsets in readouts disambiguate them. Skipped local times are rejected. Night animation preserves local time rather than adding 24 elapsed hours.
- Curves sample at ten minutes and include exact solar twilight crossings and catalog rise/transit/set. A Moon curve need not close at noon: the Moon moves over the displayed night. Object coordinates and angular separations use the same catalog/J2000 convention as other StarHop charts. Moon position is topocentric; Moon height includes the existing standard refraction treatment. Terrain and real horizon obstructions are not measured.
- Object and Moon events belong to the displayed noon-to-noon night. `+1d` labels the next civil date. Circumpolar / never-rising objects are identified. The Moon uses disk rise/set searches; it can have no rise or set in a given interval.
- Comparison altitude charts default to astronomical dusk–dawn, using computed Sun −18° boundaries; a noon-to-noon option includes daylight. The chart clips heights below −30°; the dial retains the full −90° range. Exact cursor readouts compute current target altitude, angular Moon distance, illumination and estimated added sky glow. The latter reuses the app's clear-air scattered-moonlight model and configured baseline sky brightness.

## Seasonal interpretation and offline behavior

The worker visits every date and every half-hour midpoint, requiring all of these at once:

1. Sun at/below −18°.
2. Object altitude at/above the chosen threshold.
3. Moon separation at/above the threshold while the Moon is above −1°. A Moon below −1° passes this filter.

Daily totals are approximate elapsed hours. The local-time bands show the fraction of sampled half-hour occurrences meeting these rules; a repeated DST hour contributes both occurrences. Moon illumination is displayed separately; the separation rule is deliberately geometric and does not imply a visibility/contrast guarantee. Changing thresholds cancels an old calculation and starts a new worker, keeping the interactive clock responsive. A full year for two targets took about four to six seconds in the Chromium verification environment.

The worker asset is included in the existing complete offline manifest. No network is needed for clock, calendar, object charts or seasonal recalculation once the app is offline ready. Comparison selection persists independently of app-cache versions. Storage failure is disclosed. Seasonal results are recomputed rather than saved as a stale weather report. Existing per-location weather caches remain independent and retain older reports offline.

## Forecast recommendation

The specialist forecast decision is separate from the clock. Astrospheric's [model explanation](https://www.astrospheric.com/DynamicContent/astrospheric) documents Canadian RDPS seeing/transparency, NOAA smoke and multiple North American cloud models. This is a meaningful capability beyond a jet-wind proxy, especially for high-magnification imaging/planetary work. It is a strong regional comparison source, not evidence of universal site-level superiority.

[ClearSkys](https://clearskys.app/about) uses Open-Meteo and MET Norway plus astronomical interpretation; it is not an independently superior seeing model simply because its UI is astronomy-specific. The previous [forecast review](observing-weather.md) also verified Clear Outside's lack of a documented browser data API, 7Timer's browser CORS restriction and meteoblue's credential requirements.

For ordinary 14×50 binocular planning, cloud layers, model disagreement, darkness and Moon interference are the useful first priorities. Retain StarHop's free, cached Open-Meteo/ECMWF/GFS setup and the coordinate-specific Astrospheric comparison link. No subscription is required for this release. If the owner later wants integrated specialist North American seeing/transparency/smoke, evaluate Astrospheric against local observations and confirm API permission for this deployment; use a protected backend for any shared credentials. Do not claim a worldwide best provider without local forecast verification.

## Verification

- TypeScript, production build and 244 tests across 31 files pass. New tests cover real object/Moon geometry, polar projection, exact astronomical twilight bounds, next-day events, DST noon bounds and curve discontinuities, persistence sanitization, leap-year intervals, polar daylight and simultaneous seasonal criteria.
- Chromium checked object search, multiple curves, calendar, keyboard stepping, time animation, a full year for two objects, seasonal date jumps and 375 px controls without document overflow or JavaScript errors.
- Binocular card shortcuts retained the existing comparison set. A Sydney planner draft carried its unsaved site/date to the clock and used Australia/Sydney.
- After Offline ready, a disconnected reload retained the object set, started a fresh seasonal worker calculation and allowed future-date/keyboard time travel. This verifies the worker asset itself is cached, not just a previously computed in-memory result.

## Seasonal trajectory clocks — October 19 refinement

Compared three real-data prototypes: faint daily ghost trails, altitude/time occupancy cells, and representative paths colored by month. Ghost trails obscure timing when many dates overlap. A full-year density plot with all hours included can also approach a rotationally symmetric band: the object's fixed declination determines its altitude range while sidereal timing moves the peak around the local-time dial. This is expected geometry, not evidence of an object remaining at one height.

The refinement shows **two simultaneous clocks** for one chosen object:

- **Paths colored by month:** one actual sampled observing night near the 15th of each calendar month in the interval. Month labels isolate a path and offer a link to open that date in the daily clock. If the interval clips a month, its nearest available date is used and labeled honestly.
- **Occupancy:** each local half-hour × 5° altitude cell reports how often samples fall there across the interval. Brightness uses a disclosed nonlinear perceptual scale with a percentage key; zero is invisible. Hover, touch or keyboard inspection gives the time, height band, frequency and real matching dates. The chosen night's finer daily curve can be switched on for comparison; it starts hidden so it does not obscure narrow bands such as Polaris.

Both clocks share the object and time filter: all 24 hours, astronomical darkness (default), or samples meeting the existing observing limits. Neither has Sun/Moon curves; they remain on the daily comparison clock. The hours-per-night chart remains below with its existing altitude and Moon-distance limits. Object and time-filter selections survive recomputing a date interval or changing location.

The worker retains all sampled altitudes independently of visibility thresholds. Occupancy normalizes each local-time column separately; repeated DST hours are averaged within a date, and dates without a skipped local half hour do not contribute a denominator to that column. Fractions describe recurrence of calculated geometry, not weather probabilities or measured detectability. Below-horizon paths are preserved. The dial's angular axis remains clock time, not azimuth.

The object palette now uses saturated green, pink, orange, blue, red, teal, violet and yellow. Objects stay solid across the daily clock and comparison charts; the Moon is neutral silver with long dashes and the Sun has short amber dashes. This provides a shape cue as well as stronger color separation.

### Broader verification

New tests use the Coathanger (summer), M42 (winter), M31 (autumn) and Polaris together over a complete year. They compare evening heights across seasons, check representative samples against the independent coordinate transform, verify normalized occupancy and real matching dates, and exercise repeated/skipped clock hours. Polaris stays near the observer's latitude in San Francisco, remains below the horizon from Sydney, and sits near the rim at 89°N. Polar summer has no astronomical-darkness trajectory while its all-hours geometry remains available. Short intervals and leap day retain real monthly representatives.

The release passes TypeScript, production build and 253 tests across 32 files. Browser verification inspected all four real catalog cases, month isolation/date travel, pointer and keyboard cell inspection, and opening an actual matching date. A Sydney site change retained Polaris and the time filter, correctly moved its complete trajectory below the horizon, and a polar-summer test kept raw geometry while removing false darkness. Both clocks stacked without horizontal overflow at 375 px and recalculated after a disconnected reload.
