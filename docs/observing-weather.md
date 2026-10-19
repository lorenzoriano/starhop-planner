# Location forecasts and offline weather

## Source choice

StarHop uses [Open-Meteo's global forecast API](https://open-meteo.com/en/docs), with its automatic Best Match model selection. It supports direct browser requests, hourly cloud layers and weather visibility without an API key. Data is attributed to Open-Meteo under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its [free API terms](https://open-meteo.com/en/terms) permit personal/noncommercial sites such as this app; commercial deployment would need an appropriate plan.

The astronomy-specific [7Timer ASTRO product](https://www.7timer.info/doc.php?lang=en) also provides seeing/transparency categories over three days. This integration favors a longer hourly weather forecast and does not turn ordinary weather visibility into an invented astronomical seeing estimate. This source choice is not a claim that one provider is the most accurate at every observing site.

## User flow

- A compact **Observing weather** panel sits below the observing-time bar. It automatically fetches for the selected coordinates, even while folded.
- Expand it for cloud cover, low/middle/high cloud, precipitation chance, temperature/dew point, humidity, wind/gusts and horizontal weather visibility. Inspect by hover, touch, keyboard arrows, Home or End.
- The timeline spans the selected observing night from local noon to the following noon; shading marks actual astronomical darkness, with the Sun below −18°. No darkness is invented in polar summer.
- A suggested two-hour window must be fully dark, in the future, have no missing required fields, no significant forecast precipitation, precipitation chance below 30%, cloud no greater than 50%, sustained wind below 25 km/h, gusts below 40 km/h and visibility at least 10 km. Ranking then favors less cloud, lighter wind and lower dew risk. These are practical planning heuristics, not a probability of detecting a target.
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
