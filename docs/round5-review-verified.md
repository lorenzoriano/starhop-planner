# Round-5 verification

Review fixes were publicly verified on release **824343b**, after PRs #64 and
#65 deployed successfully. These issues were closed after verification:

- [#60: each section-1 finding](https://github.com/lorenzoriano/starhop-planner/issues/60#issuecomment-6332840381)
- [#63: each section-2 finding](https://github.com/lorenzoriano/starhop-planner/issues/63#issuecomment-6332840727)
- [#49 status table](https://github.com/lorenzoriano/starhop-planner/issues/49#issuecomment-6332893684)
- #59 remains closed.

## Public build identification

Public assets were fetched using verified TLS, and compared byte for byte with
the tested production build by `script/review-round4/public-transport.cjs`.
This transport never substitutes local application assets for public bytes.

| Asset | SHA-256 |
| --- | --- |
| index-DmAos-kc.js | a1ea4fb64852815d72c136b1d5323d571418e13d6875f56f768dedb722b6338c |
| index-D83JOdDE.css | 2f8f7afd12bfe323915ffe96afa4826e5d65d54d8ab5ad9d31fca0afbd3e1685 |

## Conditions and results

SF 37.77, −122.42; sky 19; America/Los_Angeles; 2026. Phones use DPR3.
Dates include Oct 20 21:00, Oct 21 06:00 and 21:00, Oct 24 21:30, Nov 8
22:00, Nov 20 19:00 and Dec 5 19:00. M13 uses May 8 23:00 for its visible
field. Widths include 360, 390, 393, 710, 900, 1000, 1024, 1100, 1280,
1440 and 1920; relevant phone cases use Medium and Large text.

Public browser suites passed for:

- Complete Hop action label pixels at all six phone width/text combinations:
  zero wrong hit targets, 8px gap to Remove. The runner waits for loaded catalog
  rows; its initial public fixture had a transient detached row and was corrected.
- Hop layout at 900–1100; destination text containment; clock text/hour-line
  intersection and visible ink; lunar label/marker hit testing; catalog actions.
- The desktop binocular label occupies one line; Sort has RGB(13,29,40)
  background, consistent with the dark toolbar.
- Independent star oracle: maximum error 0.43 CSS pixels. Nearest-own-figure
  caption checks pass across resized scenes. Caption/glyph overlap is zero.
- Solar ephemerides: maximum error 0.28 CSS pixels. Milky Way source membership:
  432 above-horizon samples, 340 inside the source outline, zero mismatches.
  Source-outline gaps are retained, rather than filled artificially.
- Required navigation names; selected M31/M45/NGC869/M13/M42 through zoom 0–3.
- Seven final hop fields (M31, M45, M13, M42, NGC869, M81, M15) at 1440 and
  393: selected symbol, field center and route endpoint coincide exactly.
- Three session schedules: displayed altitude agrees within 1°, no overlaps,
  no feasible free-slot altitude gain over 10°, correct rising/setting reasons.
- Online/offline weather wording and a predawn forecast Plan action. These
  checks use explicitly synthetic Open-Meteo-shaped fixtures, not real forecasts.
- Thirteen corrected binocular notes in actual dialogs, source link labels,
  all four distinct lunar tips, numeric search ordering and constellation action.
- Mare Humorum at Oct 21 06:00: Sun −0.169°, displayed as “Sun on this feature’s
  horizon”. No repeated lunar tip sentence remains.
- Calibrated optical opening, photograph proportions, width/apply behavior,
  and missing-image hatching on desktop and phones.
- Earlier overflow, search/Enter/Escape/alias, calendar, copies/notes, predawn
  saving, Moon scale/zoom, route, seasonal and binocular regressions.
- Seasonal Coathanger, M42, M31 and Polaris, including 12 monthly paths.
- Actual UI red-light toggle: zero non-red colored screenshot pixels.

Scripts are under `script/review-round5`. The earlier independent celestial
oracle is `script/review-round4/round4-sky.cjs`; general overflow and seasonal
checks remain under `script/review-round3`. Install Playwright, Chromium, sharp
and pngjs in a tooling workspace, provide `NODE_PATH` if needed, and set
`BASE_URL` to the public release. Search preservation also uses `STARHOP_URL`.

## Equal-font performance

393×852 DPR3, 4× CPU, labels fixed at 16px in both builds; rendered labels
measured 15.9999 CSS px. Baseline dd74a20 ran on the same machine. No other
browser/build/test was running during measurement.

| Measurement | Baseline | Public 824343b |
| --- | ---: | ---: |
| Warmed reload to first star layer | 6.018s | 6.463s |
| First Planner→Tonight switch | 1.915s | 3.551s |
| Later switches | 2.181 / 1.667 / 2.479 / 3.129s | 2.716 / 1.880 / 1.391 / 1.987s |
| Later-switch median | 2.330s | 1.934s |

The first public switch was slower. These results do not establish that every
transition is faster. A separate same-font local comparison before the final
caption-clearance refinement measured 6.889→5.416s reload and 2.006→1.755s
later-switch median. The earlier unequal-font comparison is superseded.
Default 12px chart names were visually inspected in actual DPR3 phone renders.

Review-fix gates: 374 tests in 53 files, type check and build pass. Hook lint
has zero errors and 63 pre-existing warnings outside SkyChart; missing SkyChart
projection dependencies are errors. The subsequent binocular star-field tab has
its own geometry/browser tests and build verification.
