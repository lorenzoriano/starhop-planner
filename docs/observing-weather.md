# Location forecasts and offline weather

## Source choice

StarHop uses [Open-Meteo's global forecast API](https://open-meteo.com/en/docs), with its automatic Best Match model selection. It supports direct browser requests, hourly cloud layers and weather visibility without an API key. Data is attributed to Open-Meteo under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its [free API terms](https://open-meteo.com/en/terms) permit personal/noncommercial sites such as this app; commercial deployment would need an appropriate plan.

## Astronomy forecast review — October 19, 2026

The user requested a deeper comparison with [Clear Outside](https://clearoutside.com/forecast/), [this Cloudy Nights discussion](https://www.cloudynights.com/forums/topic/895204-best-weather-app-for-cloud-predictions/) and [ClearSkys](https://clearskys.app/).

| Service | Verified finding | Integration decision |
| --- | --- | --- |
| ClearSkys | Its [published methodology](https://clearskys.app/guides/how-stargazing-score-works) uses Open-Meteo cloud layers, weather, Moon/darkness, observing profiles and upper-air wind as a seeing proxy. | The first StarHop implementation lacked this astronomy interpretation. Added a separate, disclosed observing outlook rather than treating ordinary weather visibility as seeing. No accuracy claim is borrowed from their app. |
| Clear Outside | The coordinate-specific forecast page works. Its public pages and terms were reviewed; no documented public data API or browser CORS support was found. | Added an exact-location comparison link. Did not depend on scraping its HTML table as a production data interface. |
| Astrospheric | Its [documented API](https://www.astrospheric.com/DynamicContent/api_info_v2?src=helppage) provides astronomy forecasts and requires a private key through Pro access. | Exact-location comparison link is available. Asked whether the user already has Pro; did not create a paid account, publish a private key or substitute their website's private endpoints. |
| meteoblue | Its forecast API has a Seeing package and credential/credit requirements. | A possible authenticated source if the user has API access; no credentials are configured. |
| 7Timer ASTRO | Live SF/Sydney requests returned a current `2026101912` model run, with three-day seeing/transparency data. Both documented HTTPS JSON endpoints lacked `Access-Control-Allow-Origin`; Chromium could not read the response cross-origin from StarHop. Data is offered for noncommercial use, and the author asks developers to notify them. | Valid astronomy data, but the static Pages deployment needs an authorized server relay to use it. No untrusted public CORS proxy, `no-cors` workaround or obsolete bundled forecast was introduced. |
| ECMWF + NOAA GFS | A documented Open-Meteo request returned both independent cloud forecasts and 250 hPa winds, with browser CORS enabled. | Added live multi-model comparison, upper-air wind indicators and per-site offline storage. |

The Cloudy Nights discussion also makes a useful practical point: observers compare sources because a clear-sky label can be wrong locally. This is not evidence that any one source is universally the most accurate.

### What the astronomy layer adds

- Three saved observing profiles: **Binocular sky**, **Faint deep sky**, **Moon & planets**. They respond differently to Moon sky glow and upper-air wind.
- Hourly Sun/Moon geometry calculated locally, including true astronomical darkness and whether the Moon is below the horizon. Sky glow uses the existing scattered-moonlight model at the zenith and the user's assumed moonless sky brightness. Daylight/twilight is not presented as a dark-sky Moon-glow measurement.
- A bounded 0–100 planning heuristic, not a probability of detecting a target. Cloud/rain can dominate it; wet or opaque skies cannot receive a good score. Missing essential weather gives no score. Surface weather, dew and haze remain distinct from astronomical seeing.
- Actual ECMWF IFS 0.25° and NOAA GFS cloud values for the same UTC hour, with a chart band spanning them. This is not a statistical confidence interval. Open-Meteo may interpolate model output to its hourly display.
- The **cloud-model range** holds the remaining weather inputs constant and substitutes local, ECMWF and GFS cloud cover. It shows how sensitive the outlook is to cloud uncertainty. Materially different scores produce **Uncertain forecast**. Candidate windows with cloud disagreement are labeled **Tentative**.
- 250 hPa wind speed from the models is displayed as a jet-stream/steadiness indicator. It is not labeled as measured seeing, FWHM in arcseconds or measured transparency. Jet speed alone cannot predict complete atmospheric turbulence.
- Suggested two-hour windows are now ranked by the selected astronomy profile, including Moon glow, rather than weather alone. Object altitude and angular Moon distance still belong to the object's own planning graph.

### Additional offline behavior

The comparison is saved independently in `starhop-forecast-models-v1`, for up to 50 locations, with compact numeric rows to reduce local-storage pressure. Requests are deduplicated, timed out and backed off after failure. It normally refreshes after six hours; manual Refresh updates both datasets. A failed comparison does not remove weather or an older successful comparison. Each dataset has its own retrieval time and stale/expired status. Model hours outside coverage stay unknown. All astronomy calculations and profile changes work offline using the saved data.

## User flow

- A compact **Stargazing forecast** panel sits below the observing-time bar. It automatically fetches for the selected coordinates, even while folded.
- Expand it for cloud cover, low/middle/high cloud, precipitation chance, temperature/dew point, humidity, wind/gusts and horizontal weather visibility. Inspect by hover, touch, keyboard arrows, Home or End.
- The timeline spans the selected observing night from local noon to the following noon; shading marks actual astronomical darkness, with the Sun below −18°. No darkness is invented in polar summer.
- A suggested two-hour window must be fully dark, in the future, have no missing required fields, no significant forecast precipitation, precipitation chance below 30%, cloud no greater than 50%, sustained wind below 25 km/h, gusts below 40 km/h and visibility at least 10 km. Ranking then uses the selected astronomy outlook, including weather, Moon interference and observing profile. These are practical planning heuristics, not a probability of detecting a target.
- **Use this observing time** previews the selected weather hour. In Planner it edits the draft; the existing save/add-target flow saves the night. The planner's weather follows its draft date and location immediately, including changes to an existing session before saving. Target ordering and optical/binocular assessments remain independent of weather; the UI says so.
- Dates outside the retained forecast show its actual available dates. Forecasts normally cover the current day plus six days ahead, with one preceding day included. They are not historical observations or long-range predictions.

## Cache and failure behavior

- The last successful complete response is stored per coordinate in `starhop-weather-v1` local storage, independent of service-worker asset versions. Location keys and requests use 0.001° coordinates, finer than the weather models' grid spacing.
- Up to 50 recent location reports are retained. Expired reports are not deleted just because the device goes offline. Updating one location preserves the other locations' reports.
- Reports are fresh for one hour. The mounted panel checks once a minute and refreshes when stale and connected; returning online/focusing the app also checks. A manual Refresh is available. Coordinate entry is debounced, requests in flight are shared, and failed attempts have a retry backoff.
- Network errors, timeouts, rate limits and invalid/incomplete responses do not overwrite the saved report. Switching locations immediately stops showing the old location, and late responses are stored only for their original location.
- Offline, older and expired forecasts are explicitly labeled, with an absolute **Retrieved** time. Retrieved is the download time, not a claim about a weather station observation or model initialization. Expired forecasts remain reference predictions. An uncached location shows an empty state instead of another location's report. Storage/quota failure is disclosed; an in-memory response is not promised to survive closing the app.
- UTC epoch hours and explicit metric units avoid device time-zone ambiguity. Provider precipitation, probability and gust values describe the preceding hour; they are shifted to align each displayed interval with the following hour. A final unavailable interval remains unknown.

## Verification

- TypeScript, production build, and 224 tests across 29 files pass. New tests cover location keys, UTC/unit validation, null handling, interval alignment, malformed/truncated forecasts, cache freshness/expiry, per-site persistence, quota failure, request deduplication, cache reuse and failed-refresh preservation. Astronomy tests cover DST, southern sites, polar darkness, out-of-range dates and rejection of unsuitable/missing-data windows.
- Real provider requests succeeded in Chromium for San Francisco and Sydney. Reload reused a fresh report with no new request. Changing the planner site fetched the correct location and used Australia/Sydney times.
- At 375 px, the chart changes to a readable narrow viewBox and the metrics use two columns, without horizontal overflow. Chart keyboard inspection and using its time updated the observing context.
- After Offline ready, a disconnected reload retained the forecast and metrics. An older cached report remained readable with an explicit older/offline label, and Refresh was disabled. No JavaScript errors occurred.


## Astronomy-layer verification

- 235 tests across 30 files, TypeScript and production build pass. New tests cover Moon up/down and phase brightness, profile differences, astronomical darkness, daylight handling, dew/missing data, cloud/rain dominance, upper-air wind interpretation, cloud-model uncertainty, light-pollution assumptions, real site geometry, finite rankings, model units/UTC/nulls/coverage, independent cache persistence, compressed-cache reopening, deduplicated requests and malformed-update preservation.
- A real San Francisco forecast for October 24, 21:00 returned ECMWF cloud 91% and GFS 23%. The binocular/deep-sky/lunar outlooks were 49/33/69 with a full raised Moon; the UI displayed model disagreement, a cloud-sensitive range and a tentative window. These values describe that test snapshot, not a frozen forecast.
- Chromium confirmed 7Timer's JSON could not be read cross-origin. The coordinate-specific comparison links preserve the selected site.
- At 375 px, the profile control, astronomy factors, comparison band and metrics were readable without horizontal overflow. A fixed browser date with real timers was used for responsive screenshots.
- Reload reused both fresh forecasts without network requests. A disconnected reload retained the model band and astronomy outlook, explicitly marked the comparison as offline, and allowed profile changes without a connection. No JavaScript errors occurred.

The final compressed-cache build was also checked through the planner's Sydney site selection. It fetched a separate model report, displayed Australia/Sydney times, returned to the San Francisco cache correctly, and reopened both datasets offline. This checks the final storage format rather than only the earlier uncompressed prototype.
