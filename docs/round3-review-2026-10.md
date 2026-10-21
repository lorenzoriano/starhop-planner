# October review — round 3

## Changes

- Rank nights by observing merit, with unknown weather neutral and bad forecasts clearly penalized. Reject Moon-free windows shorter than 30 minutes and choose their highest-altitude instant.
- Explain the navigation minimum (15°) separately from the preferred detailed-view altitude (30°). Restore bright-core binocular guidance for large, bright galaxies using the actual suburban sky default.
- Keep equipment editing in the setup drawer. Save browsed month targets without changing the global observing time.
- Search Enter commits the visible query immediately. Exact/literal names suppress unrelated fuzzy matches, and hidden results name their filter.
- Make date controls tappable with Large text, compact the route controls with a planned route, align timeline numbering and scheduled times, and clear stale status messages.
- Use measured SVG coordinates, text-size-aware labels, neutral gray Moon curves and real line samples. Paginate lunar landmarks at every phase.
- Replace remaining catalog templates with facts derived from catalog data and directional finders checked against bundled star positions. Collapse secondary detail content and bring collection cards nearer the top.
- Attach labels to their own catalog positions. Opaque plates hide faint marks underneath; bright stars and prominent object symbols remain protected. Drop unsafe labels. List prominent visible constellations below the map when inline labels have no safe space.

## Automated checks

TypeScript, the full 343-test / 49-file suite, and production build passed. Regression coverage includes geometric label ownership, exact weather-ranking inputs, the short Lagoon window, peak-window selection, default-sky M31 ranking, finder geometry, browsing dates, graph Moon-down behavior and scheduled-time consistency.

## Browser acceptance harness

`script/review-round3/` contains reproducible Playwright checks for the numbered findings and the preservation checks. They need Playwright and Chromium (`/usr/bin/chromium` in this workspace). Set `NODE_PATH` to an existing Playwright installation if it is not installed locally. Screenshots write to `/tmp`.

Use `BASE_URL` for root, regression, binocular, charts, ranking, season and sky scripts; `URL` for Planner scripts; `STARHOP_URL` for the shared search script. URLs end in `/`; the search URL may include `#/`. Search functional checks can disable timing with `STARHOP_PERF=0`. Measure timing in a quiet production build, separately from other browsers and builds.

For public Pages verification the transport fetches the actual public assets with TLS-verifying curl, renders them at their original public URLs, and compares deployed JavaScript/CSS bytes to `dist/public`. It does not disable certificate checks. Set `STARHOP_DIST` if the tested build is elsewhere. Weather ranking uses a documented deterministic saved forecast fixture; it does not claim a live provider supplied those test predictions.

Issue replies and tracking issue #49 record per-item public verification and any deliberately declined behavior. They are authoritative for deployment status; local checks alone are not grounds to close an issue.
