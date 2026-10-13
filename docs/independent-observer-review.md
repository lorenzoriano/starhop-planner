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
