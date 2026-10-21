# Round-four review: issues 59 and 60

## Geometry and label correctness

The responsive chart's projection callback already captured its measured width, but stars, constellation paths and route paths did not depend on that callback. They could retain the square first-render centre while rings and constellation names used the measured centre. Those consumers now depend directly on `project`. Geometry is deferred until the SVG has been measured, avoiding a wasted square projection before the first paint.

The browser regression uses Astronomy Engine's J2000-to-horizontal rotation independently of the app's projection function. It checks Polaris, Capella, Deneb, Vega and Betelgeuse where above the horizon, on October 20 and November 8, at 1024/1280/1440/1920 and 393 px, including actual resizes. It also checks the target/field centre and distances between constellation captions and their figure segments. Caption candidates come from their own figure's segments, with short perpendicular offsets when needed. An exact point-to-segment distance check rejects any caption closer to another figure, with a two-pixel safety margin. This keeps useful captions beside the lines while preserving their association.

Phones use compact IAU constellation codes, with full-name buttons that highlight the corresponding figure on the map. This replaces the passive list with a spatial interaction.

Name plates protect stars through magnitude 4.5 and catalog deep-sky symbols, including Messier and Caldwell objects. Unresolved copies of the same named star do not compete with each other. Every accepted plate touches its owning point, so an unobscured faint point outside the plate is necessarily farther away. This means the ownership test can index protected symbols without rebuilding a grid of thousands of faint background stars. Crowded names may still be omitted; priority changes do not guarantee that Deneb, Altair, Capella and M31 can all be labelled safely in a 393 px whole-sky view. That remaining limitation must be explicit in the issue disposition, including crowded desktop scenes where formerly shown names are suppressed.

## Other changes

- Explicit two-column desktop hop layout restores map width while preserving first-screen visibility.
- Binocular search opens on desktop; phone filters remain collapsed.
- Escape dismisses suggestions without clearing the query; literal continuations retain Mizar & Alcor and M3x. Catalog designations have spaces in both cards and suggestions. Filter messages distinguish values just below a threshold.
- Replaced 36 static-power/template notes with individual object context, membership or positional facts, and added source references. Nine lunar sea descriptions now use their own landmarks and outlines. Profile-dependent optical calculations remain in the existing assessment rather than frozen into prose.
- Negative feature Sun altitude uses “below”; clock ring labels separate horizontally; Moon wording is gray; online fresh weather says Forecast and offline data identifies its cache.
- Narrow timeline slots omit numbers while the legend keeps the order. Phone actions do not wrap, and the native date icon is hidden beside the app's calendar button.
- The setting-first schedule can leave a gap for a low rising target to improve, without overlapping the following slot or exceeding the session. The real-default November 8 regression schedules Orion's Belt above 30° within the night.

## Validation and publication

TypeScript, production build and the full 350-test / 49-file suite pass. `script/review-round4/` contains the independent geometry, plate, layout and performance browser checks. They use Playwright and Chromium; set `NODE_PATH` for an external Playwright install and `BASE_URL` for the server. The public transport fetches actual TLS-verified public bytes and compares assets with `dist/public`.

Performance comparisons use the same browser, 393×852 DPR3, San Francisco sky 19.0, October 24 at 21:30 and 4× CPU. Content readiness is measured on the committed star layer, separately from animation-frame scheduling. Absolute timings depend on this execution environment; issue comments record the final comparison and do not claim a universal sub-500 ms load.

Issues 59/60 remain authoritative for deployed per-item statuses. Local checks alone do not establish public verification.
