# Independent observer review

Reviewed 2026-10-13 in fresh Chromium contexts, independently from implementation and parent verification. Desktop and 390-pixel mobile; San Francisco and Sydney; October 18 and October 25 observing sessions. The reviewer did not edit or publish code.

## Observer feedback

The Moon/target comparison, dated darkness windows, enlarged reference atlas versus binocular field, and realistic observing descriptions make the app useful with modest equipment. The M31 star-hop route provided recognizable landmarks and field confirmation. Saving observations, notes, Markdown export and offline reopening worked. Mobile had no horizontal overflow.

## Findings and changes

| Finding | Priority | Change |
| --- | --- | --- |
| A date's darkness suggestion could refer to the morning before the selected observing evening. | P2 | Suggestions now cover the next 24 hours from the chosen moment and include dates. SF Oct 18 at 21:00 offers Oct 19, 00:30–05:45. Choosing it plans Oct 19 at 03:07. |
| The post-Moonset shortcut could lead into daylight without a cue. | P2 | The shortcut shows the actual planned time and daylight/twilight/night context: Oct 26, 08:27 · daylight in the tested full-Moon session. |
| An unsupported optics value silently reverted while typing. | P3 | Supported binocular ranges are visible; 50× produces “Use 5–40”. Partial entry is preserved, and valid 20×/80 mm produces a 4.0 mm exit pupil and 3.0″ nominal resolution. |
| Target altitude and direction were easy to miss on the Moon page. | P3 | Moonlight cards now include target altitude, compass direction and altitude status. A low target is highlighted independently of the Moon's brightness. |
| The mobile lunar section required too much scrolling between the atlas and collection. | P3 | Jump controls reach the daily chart, atlas and landmarks, with a return-to-atlas control beside the collection. |

The reviewer verified the first three fixes in the browser and rechecked the last two after the final build.

## Workflows explored

- Change observing location and local date/time; verify corresponding time zone/UTC offset.
- Compare full-Moon interference with a selected M31 target; choose a future darkness window and a post-set time.
- Identify Tycho, alter binocular optics and display orientation, save it, mark observed, add a note, reload and export notes.
- Plan an M31 hop and confirm recognizable route fields.
- Explore at 390-pixel mobile width and reopen the Moon section offline after preparation.

## Practical limits

The atlas is a smooth-sphere preview using NASA LROC texture and IAU geometry. It does not model crater-relief shadows, earthshine, eclipses, atmospheric seeing or individual eyesight. Moonlight is an estimate using assumed clear-air extinction and moonless sky brightness, not a weather forecast or a probability of seeing an object. Local horizon obstructions are not measured. These limits are explained in the interface.

## Follow-up chart annotation

The user reported hidden label-size controls and an unhelpful tiny starting field. Shared chart controls now keep label size, star brightness and guide-star size visible. Routes open framed on their starting field; Route overview and Reset switch between context and the active field. Label sizes are measured in screen pixels, star glyphs and line widths remain readable while zooming, and label placement checks the visible viewport.

The independent reviewer checked Job’s Coffin via Altair with a 3.7° field at 390 and 776 pixels. The active field was readable at 18-pixel labels; all three controls were visible; mirror/90° rotation and zoom survived Next; the overview worked; Tonight inherited the shared display preferences. No horizontal overflow occurred. Dense overview labels at a large chosen size remain a tradeoff: reduce the visible label-size slider for more context.

## Calendar, Moon separation and atlas interaction

The reviewer explored separate San Francisco and Sydney sessions, October 18/25 and November 8, at 776/390 pixels. The calendar, site/time editor, target additions/removals, session-specific notes, archive/restore and offline reopening worked. Tonight after dark selected October 13 at 20:16 with the Sun below −18°. A San Francisco sequence allocated Albireo at 21:00, M31 at 21:15 and a lunar feature at 21:30; the Sydney session scheduled 47 Tucanae and flagged low M31/Altair rather than suggesting them. Changing one session's notes or list did not change the other.

The Moon graph now distinguishes height above the horizon from angular separation. Visible legends explain the gold Moon-altitude curve, dashed mint target-altitude curve, darkness and chosen-time cursor. The separate 0–180° curve and selected-time guidance reacted to changes of target and time. In the full-Moon San Francisco scenario, M31 was about 30° from a 100%-illuminated Moon at 35° altitude; changing to M2 produced about 65° separation. These are astronomical geometry checks, not evidence that a target will be visible.

| Finding | Priority | Change and recheck |
| --- | --- | --- |
| Overlapping chart-star hit areas selected a faint neighbor instead of Altair. | P2 | Bright stars render above faint stars with smaller hit areas; named labels select their exact star. Reviewer verified Altair's marker and label at Sydney November 8, 22:00. |
| Previewing another night could make saved target cards show that preview's altitude. | P2 | Saved cards, opening actions and export use their owning session's date/site. The time bar identifies which session receives targets. Reviewer verified an October 25 preview retained October 18 M31 at 55° E and opening it restored October 18. |
| Pinch zoom failed when a finger began on a lunar landmark label. | P2 | Landmark touches join gesture tracking; selection occurs only after an unmoved tap. Drag/pinch does not select a landmark. |

Mouse drag, wheel zoom, ± controls, Reset and touch pan worked. Panning preserved the selected 90° orientation; Reset restored a centered 1× view without resetting orientation. Lunar labels remained 18 screen pixels during zoom and shared their setting with Tonight. Mobile had no horizontal overflow. The implementation also disables text selection while dragging the atlas. The final independent recheck at 390 pixels confirmed a label-start pinch changed 1× to 1.8× without selecting a landmark, a plain tap selected Mare Nectaris, dragging a label only panned, and keyboard Enter selected Mare Crisium. No issue remained from these checks.

Parent verification covered the complete session/calendar workflow, named-star addition, new-Moon shortcut, angular-distance chart, notes isolation, mobile layout and offline persistence without browser errors. The core regression suite passed 134 tests across 14 files, plus TypeScript and the production build.

## Real photographs on Tonight

Following the user's photo annotation, generated object-category artwork was replaced with actual DSS2 optical survey exposures on Tonight's featured panel, discovery cards and saved catalog targets. Optical coverage now includes all 297 unified discovery targets, with 57 additional local cutouts. The original binocular collection retains its optical/infrared pairs and licensed portrait references. The featured panel states the field width, links the original photograph and credit policy, and explains that a telescope exposure reveals more detail and color than binoculars.

The independent reviewer selected M27, M57 and M31 and verified loaded local 640×480 photos, matching card-to-feature selections and individual source/credit links. Saving M31 retained its photo in Planner. At 390 pixels, the photo appeared above the feature text without horizontal overflow. After offline preparation, a disconnected reload retained M31 and all eight visible card photographs. No illustration or generated field-impression labeling remained. The reviewer noted that M57 honestly appears as a small survey target rather than an exaggerated ring.

The parent checked M27/M57/M31 selection, saved-session photography, credits, mobile and offline use without browser errors. A catalog-wide regression verifies optical image files, source survey and coordinates for every discovery object; all 135 tests across 14 files passed, along with TypeScript and the production build.

The reviewer caught a mobile blank strip after the desktop aspect-ratio adjustment. Explicit full-width sizing and a mobile aspect-ratio override fixed it. The final independent recheck confirmed the photo fills the 352-pixel card content at a 390-pixel viewport, with no overflow; desktop and tablet retain 4:3 imagery. The desktop featured panel no longer stretches into a large empty gap.


## GitHub feedback review

A separate review pass checked the 19 GitHub reports against the published baseline, then explored the revised production build. Confirmed repairs include the M8-first sequence (M8 → M13 → M39), the missing neighborhood target, daylight guidance, exact/spaced catalog search, ordinary wheel scrolling, the mobile time editor, selected-calendar contrast and hash navigation with Back/reload. The broad header-scroll claim did not reproduce; the featured action did.

At San Francisco, June's after-dark sample is 22:43 with the Sun below −18°; the retained 21:00 reference correctly warns of civil twilight. The explicit next-occurrence action plans June 2027. Adding from the monthly sample matches the named destination session rather than silently moving it to the sample date. Next new Moon stays in Planner; empty search and singular counts are clear. The reviewer caught the literal sample-time text and a mobile popup border clipping; both were fixed and rechecked.

The reviewer inspected 375, 620, 776 and 1440 pixel layouts, red mode, plain scrolling through the binocular dialog and Ctrl-wheel zoom in 20% steps. No horizontal overflow remained. Label placement was refined against actual rendered font metrics. The two Serpens source figures now have unique keys, fixing a stale label left behind on resize; centered target placements preserve long destination names on small screens. The quiet palette, typography and chart density were preserved.

Parent browser verification compared Milky Way shading with the source spherical polygons at 3,976 plotted catalog-star positions, then repeated all 3,976 checks after mirror/90° rotation. Every membership matched. It also verified an offline reload of a target bookmark, persistent orientation and migration of old target IDs with merged notes and retained observing timestamps, without browser errors. TypeScript, the production build and all 150 tests across 15 files passed. See [the issue-by-issue decisions](github-feedback-review.md) for qualified suggestions and astronomical references.


## Issues #20–#26

The independent reviewer explored the selected changes on 390-pixel mobile and desktop layouts. The fresh instrument action opens a compact, opaque two-choice dialog; binocular and telescope choices immediately plan with their actual 7°/5° fields. Compact Previous/Next and an optional full field guide appear directly below the SVG, before adjustment controls. The 352-pixel chart and 44-pixel buttons fit together while stepping. Sky bearings stay fixed while Chart directions update with rotation and mirroring; the wording distinguishes image position from mount motion.

Telrad and Rigel show three and two calibrated rings. The chosen reticle persists through a new context/reload and disconnected use. Labels, the existing palette, desktop layout and red mode remain readable. The reviewer found that first completion originally went to the legacy unscheduled list. The follow-up fix was rechecked against `index-CZpQsI92.js`: completing a first hop creates and activates a dated observing session, retains the actual observation timestamp, and Mark unseen clears only that timestamp. Both actions preserve the route, map position, 180° rotation, mirror, 18-pixel labels and zoom. No remaining defect was found in this focused check.

Parent checks additionally compared direction tags with actual plotted star coordinates, measured reticle diameter ratios, and verified that session creation copies old notes and earlier observation timestamps intact. Both instrument presets, mobile stepping, offline replanning and stored display preferences passed without browser errors. TypeScript, the production build and 156 tests across 16 files pass. The search report was checked against the public Pages build and is already resolved. Automatic optical stages and surface-brightness scoring/footprints are deferred with reasons in [the follow-up decisions](github-feedback-review.md).
