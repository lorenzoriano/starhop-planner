# Follow-up to the review of build 6343d77

These are local changes awaiting publication. The live site must not be described as fixed until the reviewed commit is merged, deployed and checked. The ten issues with confirmed defects were reopened: #36, #37, #39, #40, #41, #42, #43, #44, #45 and #49.

## Findings and changes

| Issue | Verified cause / change | Evidence |
| --- | --- | --- |
| #36, #37 | The month synchronization effect depended on the local browsing flag and reset its own updates. Synchronization now follows external date changes, with local month browsing preserved. The Binoculars saving strip uses the browsed observing night. | Planned October → November stays on November; adding a card saves to the November 15 night, matching its button and saving strip. |
| #36, #40 | Planner's night tiles lived outside its draft state. They now update the Planner draft and shared preview together. Forecast and sequence use the resolved draft, with changes saved explicitly. | Choosing the October 21 tile fills October 22, 03:37 (the selected pre-dawn instant) in both date/time fields. Source records remain unchanged until saved. |
| #40 | Moving a session bypassed generated-name updates. Shared draft movement now updates generated evening names and preserves personal names. Suggestions rank optics, darkness, apparent scale and brightness before altitude, and can all be revealed. | Unit tests cover pre-dawn naming, personal names, notes, daylight exclusion, and availability of M31/M45 on a dark autumn night. |
| #39 | The star-name candidate threshold was magnitude 1.1 and unselected DSOs outranked navigation stars. Named stars through magnitude 2.5 now take priority with horizon-aware placement and a larger collision-checked budget. | Deneb, Polaris, Fomalhaut, Schedar and Caph are labelled in the checked San Francisco autumn sky. Labels may still be omitted to prevent overlap in a narrow or crowded view. |
| #39, #45 | A descendant SVG rule enlarged calendar icons; fixed viewBox text was stretched independently in the shared object chart. | The plot now measures its width; time labels use HTML layout. At 393/710/775/1440 px, horizontal and vertical SVG scale are equal, axis text renders at 12 px and the calendar icon at 13 px. |
| #41 | Each query normalized/scored the catalog repeatedly, then diagnostics searched again. | Normalized documents and scores are cached; one ranked result set feeds the combobox and diagnostics. Typing is local and committed after a 140 ms pause. Exact matches hidden by filters retain an honest diagnostic. Lunar no-match hints link to the landmark list in every shared combobox. |
| #42 | Eighteen entries retained repeated cluster text. | All eighteen have distinct descriptions and finder instructions, including NGC 6910/7235. Angular offsets from named reference stars are calculated from the bundled catalog coordinates. These are observing goals, not guaranteed binocular detail. |
| #43, #45 | Whole-hour ticks repeated/overlapped dusk/dawn; fixed desktop viewBoxes made phone text too small. | Measured SVG widths and spaced ticks in comparison, weather and seasonal charts; month dial text compensates for display scale. Moon altitude uses long/short dashes, separation short dashes, Sun dots. Negative altitude readouts say below horizon. |
| #43 | The Moon hero and page order ignored new-Moon / Moon-down conditions. | A dark-Moon heading and planning-first order appear when little lunar light is present or the Moon is down. Verified November 9: planning chart precedes atlas. |
| #44 | The Moon-free action preferred a ranked later night over the nearest usable interval. | It now chooses the earliest future usable window. M42 on October 19, 21:00 SF selects October 20, 03:43, not a night in November. Unit test verifies Moon down, astronomical darkness and target altitude. |
| #46, #48 | Planner action labels were hidden by CSS; the binocular guide still rendered the global optics editor. | Calendar / New night / Export & more labels remain visible. The guide shows a read-only optics summary and opens the shared setup drawer. All seven navigation links fit beside desktop actions. |

## Weather in night comparisons

The next-night cards and thirty-night recommendations show weather when the cached location forecast covers all astronomical dark hours and contains cloud, wind and precipitation data. Available recommendations combine weather (65%) with geometric merit (35%). Forecast-covered choices are explicitly shown first; unknown nights keep a geometric rank and are not treated as clear.

Every recommendation reports its availability reason: fetching / no report, offline without cache, provider error, expired report, before or beyond forecast coverage, partial dark-hour coverage, missing essential values, or no astronomical darkness. Cached report retrieval time and offline/older status stay visible. Forecasts remain limited to the provider's roughly seven-day horizon. The weather score is a disclosed planning heuristic, not a visibility probability.

## Verification

- 314 tests across 46 files; TypeScript check and production build pass.
- Production browser checks cover 393, 710, 775 and 1440 px; chart scaling, pointer/keyboard inspection, saving the browsed month, Planner tile synchronization, desktop navigation, lunar landmark navigation, nearest M42 window, new-Moon ordering, and distinct Moon dashes. No page errors in these checks.
- #51 / #52 retain their previous field-framing and transit tests. #53 was checked rather than changed: after six binocular-field zoom steps the Moon/field ratio stays approximately 0.1338, while the field ring grows beyond the frame and is cropped.
- Rendering performance: catalog hues use discrete display bins for faint-star path batching; stellar temperature/B−V still supplies their colors. Path geometry is memoized during pan, pan updates are limited to animation frames, and label collisions are recalculated when the drag ends.
- Performance measurements are specific to one headless Chromium machine and are recorded below; they are not device guarantees.

### Measured performance

Same 393 px viewport and four typed characters (`andr`), Chromium on this execution machine:

| Build | Tonight typing | Planner typing | Clock typing | DOM elements | Long tasks during 12-step pan |
| --- | ---: | ---: | ---: | ---: | --- |
| 6343d77 | 3792 ms | 1954 ms | 1904 ms | 2938 | twelve tasks, 61–102 ms |
| Follow-up | 220 ms | 109 ms | 114 ms | 2542 | none recorded |
| Follow-up, 4× CPU throttle | 264 ms | 155 ms | 198 ms | 2542 | pan checked at normal CPU rate |

Typing includes 20 ms between each of four characters. Search results update after the 140 ms pause, rather than forcing the whole page to update on each key. In the final normal-speed run, the first Tonight search still had one 280 ms result-update task; the throttled Clock run recorded one 55 ms task. These residual tasks are explicitly retained here instead of claiming every interaction is free of long tasks. The panning measurement was at normal CPU rate for both builds. Model/device performance can differ.
