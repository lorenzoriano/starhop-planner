# Reopened issue verification — October 20, 2026

This pass uses the latest reopening comments as its acceptance criteria. It supersedes the blanket closure claims in the earlier review. The accepted seven-tab structure and large opening planetarium are retained.

## First release

`6ded8e8` adds decimal coordinate-pair input and fixes #52 by searching rise, transit and set over the actual observing-night interval. The exact M31 / San Francisco / October 20 at 03:00 reproduction reports transit **23:58**, with rise 15:07 and set 08:49. Tests also retain both transits on October 19. The public deployment served the same verified production bundle.

## Follow-up fixes

| Issue | Implemented and checked |
| --- | --- |
| #36 | Upcoming nights open by default near the top of Planner and after the opening sky on Tonight. Tiles choose a dark instant. Shared calendars show lunar phase, saved nights and fully covered forecast hints. Moon planning searches 30 nights with a real target-altitude threshold. Duplicate and New Moon carryover preserve the source records. Object details and Hop expose target-specific best nights. Seasonal hours default to Moon-free darkness. |
| #37 | Binocular month browsing is an explicit lens with “Set as observing night”; date/time edits update the shared context. Saves and button state use the viewed site's observing night. Site changes offer moving the existing night or browsing separately. Known site names are reused. Predawn night names use the previous evening. The saving destination remains visible while scrolling. |
| #39 | The opening forecast overview reports a verdict, dusk/dawn, lunar events and a covered two-hour window or an explicit unavailable state. The old duplicate summary is removed. Selected-object moonlight details are folded and timestamped. The chart legend uses actual object symbols, including globular clusters. Wide chart geometry covers the full viewport. |
| #40 | The whole-night timeline has numbered slots and a styled legend. Shared dialogs close on navigation. Suggested times are marked; below-horizon Moon information is contextual. Unavailable targets offer an extension or a clearly labelled session move. Suggestions examine the session interval and reuse lunar samples rather than repeating ephemerides for thousands of reference stars. |
| #41 | `andromda` ranks M31 first. Vega, Sirius, Betelgeuse and Mizar catalog copies are deduplicated without merging distinct neighboring stars. Owl Cluster is an alias. Catalog/Binocular search distinguishes hidden matches from missing names and unsupported planets. Empty queries skip diagnostics; spatial indexing avoids quadratic deduplication. |
| #42 | New settings use an explicitly unmeasured conservative sky reference rather than pristine San Francisco skies. Site assumptions can be selected in the location dialog and persisted by coordinates; existing custom values survive. Phone month controls wrap. Selected ranges drive graphs. Detail actions stay accessible, equipment is labelled suggested, and the two reported NGC descriptions use distinct catalog facts. |
| #43 | Moon windows require the selected target above the altitude limit. New Moon planning precedes the atlas. The dial is quieter, supports focused object curves, and shows a clear horizon. Clock ticks use local whole hours. Mobile chart labels are readable. The atlas offers all 55 features and keeps local preview optics separate. |
| #44 | Target changes centrally clear start/waypoint state, including direct Hop URLs. M31 uses a nearby classic reference with a labelled Balanced fallback; M13 retains eta Herculis. Route names include constellation context and pattern A–D labels match instructions. Fresh Hop offers destination search. Night finding is target/Moon-aware and explains impossible geometry. Start-star filtering excludes low automatic candidates. Route overview fits its path, Stars only retains a labelled destination, and observation logging offers Undo and Next target. |
| #45 | Caption floors, phone body sizes, touch targets and chart legend styles are consistent. Moon altitude and separation have distinguishable styles. Old gold-chart descriptions are removed. App text size is available in Setup, including legacy body/control text. Existing red-light behavior is retained. |
| #46 | All seven tabs have no page-level horizontal overflow at 390, 393 and 1440 pixels. Date context is more compact, the symbol key follows the chart, and redundant forecast headers are folded. The planetarium is visible on the first phone screen. Touch instructions, full screen, labelled actions, tab-edge fade and visible offline status improve phone use. |
| #48 | Object actions use “Add to night” and “Hop to it.” Clock list actions say “Compare” to identify their actual effect. Chart-level field/magnitude inputs are replaced by a Setup summary/link. Telescope finder reticles and profiles are hidden in binocular contexts. |
| #51 | Exact M31 / San Francisco / October 20 03:00 / KITE 14×50 / 3.7° Fit field reproduction fits completely. Geometry is clipped to the chart frame. Star/label sizes remain useful at field scale. A resize feedback loop was also fixed by sizing the physical SVG independently of its measured aspect ratio. |

## Evidence

- `npm test -- --maxWorkers=2`: **306 tests pass, 44 files**.
- `npm run check`: passes.
- `npm run build`: passes.
- Browser: exact coordinate parsing and transit reproduction; predawn save name; moving a saved night without splitting its list; calendar navigation cleanup; direct-URL waypoint reset; real-catalog typo selection.
- Browser: duplicate/carryover leave original notes and observations untouched; new copies start fresh. Large text at 393px has no page overflow.
- Browser: all seven tabs at 1440, 390 and 393px; no page overflow or page errors. Opening phone chart begins around 530px in the tested saved-night context.
- Clock checks cover actual Polaris, M31, M42, M13 and Omega Centauri entries, distinct object/month colors, point hover, chosen-versus-hover date and lock behavior. Additional scientific regressions compare winter/summer/autumn geometry and reverse pole/southern behavior at Sydney.

## Limits and decisions

- Weather beyond coverage stays unknown; cached predictions are dated, not treated as current measurements. Lunar sky glow, binocular appearance and half-hour seasonal integration remain estimates.
- Site sky references are observer assumptions, not measured or geocoded light-pollution values. Previously explicit custom settings are preserved and can be confirmed for a site.
- Copies reset observation records. Moving the whole night is explicit; Undo removes the logged observation while preserving subsequent notes.
- The long-term wishlist and proposed five-tab redesign are not part of the accepted reopening scope. Saved nights and explicit duplicate/carryover cover the current list-planning workflow.

## Browser feedback after 6343d77

- Removed sticky positioning from the saving/location strip so it scrolls away instead of obscuring the planetarium.
- Added hover, focus and tap explanations for selected-object altitude ratings, binocular recommendations, availability and Moonlight ratings. Explanations use the current geometry/model values and distinguish altitude from daylight visibility.
- Replaced the fixed, stretched night-chart viewBox with a measured responsive plot. Axis text uses uniform scaling; time labels flow as three HTML groups. Scoped chart SVG styles to avoid resizing the nested calendar icon.
- Verified the production build at 393, 710, 775 and 1440 px with M31 on January 31, 2027, San Francisco. Equal SVG horizontal/vertical scale, no page overflow or time-label overlap, normal 13 px calendar icon, correct pointer and Home/End keyboard inspection after resizing. Status help works on hover, keyboard focus, tap, click-to-pin and Escape. Inspected chart and mobile popover screenshots; no browser errors.
- Validation: 306 tests passed; TypeScript check and production build passed.
