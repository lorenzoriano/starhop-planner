# Planetarium feedback review — 2026-10-18

## Tracked requests and decisions

| Request | Result |
| --- | --- |
| Constellations should have the same clear lines | All overview constellations use the previous focused style: 1.4 px, blue, 80% opacity. Finder routes retain their navigational emphasis. |
| Pleiades selection produces an oversized blue shape | Pleiades now has a fixed screen-size cluster symbol and, when zoomed, an angular-size outline. SVG definitions are unique to each chart and zero-size resize measurements are ignored. The exact screenshot artifact did not reproduce; desktop/mobile selection and zoom were checked for bounded symbols. |
| Remove the two research links from binocular recommendations | Removed the generic contrast/sky-brightness links from the recommendation disclosure. The explanatory assumptions remain; photograph attribution links remain with their images. |
| Why M2 on startup? | Old fresh-start ranking could pick M2, and settings restored the last selection thereafter. Fresh starts now select nothing. Existing choices are explicitly labeled as saved on this device and have a clear button. |
| Vega and the rest of the photo library | Reviewed the complete survey collection, replaced bad primary images, widened bright-source fields and omitted damaged gallery frames. See the audit below. |
| Show unselected deep-sky objects | All above-horizon catalog objects have clickable class symbols. Clusters, galaxies, nebulae and star patterns are distinguished in a visible key. Real DSOs receive label priority over informal fields; labels are capped on phones while all markers remain available. |
| Explain the horizon | The guide states that the circle's interior is above the horizon, edge is 0°, center is 90°. Stereographic altitude rings mark 30°/60°. Whole sky restores the horizon after zooming. Below-horizon catalog objects are excluded. |
| Add the shared graph to the selected card | The selected card reuses the other object/session graph: rise/transit/set, target altitude, angular Moon distance, Moon illumination, estimated sky glow and suggested observing time. Additional Sun/Moon altitude curves and a Whole selected day option support daylight planning. Astronomical night uses Sun below −18°, dusk through next dawn. Hover/touch/keyboard readouts include time and all four quantities. |
| Maintain aesthetics | Removed the duplicate floating overview legend, reduced phone label density, kept selected gold versus mint catalog symbols, preserved entire featured photos with a bounded height, and limited the graph's display width. |

## Image audit

- Visually reviewed 537 optical/infrared survey frames through complete contact sheets, plus existing portrait references. Replacements and wider fields were inspected separately.
- All 297 catalog targets have a decoded, nonblank primary optical image, with source and credit metadata. The repeatable decoder audit is [catalog-image-audit.json](catalog-image-audit.json); run `python3 script/audit-catalog-media.py` with Pillow installed.
- Expanded 24 bright-star/double-star fields, replacing 45 individual survey files. Bright individual stars use 3.7° context; the affected doubles use 1.5°. The generation plan preserves these choices.
- 19 targets now use credited primary photographs, including Vega, Sirius, M7, M13, M27, M43, M62, M64, M97, M108, M8/NGC 6530, M16, M17, M20, M42, NGC 3372, Albireo and Mizar/Alcor. There are 16 new local source-image files; M8 and NGC 6530 share a wide Lagoon field with an explicit identification note.
- 15 unsuitable historical optical frames and 9 badly saturated infrared frames are omitted from gallery choices. Raw files and source records are retained. Primary photos are shared across Tonight, the catalog, binocular cards, saved sessions and the Moon target card.
- Photographs retain the source-provided pixels. No missing detail was generated or recovered from clipping. Small saturated stellar cores, diffraction spikes, historical plate texture and differences between optical/infrared exposures can remain. The UI labels photographic detail honestly and does not promise an eyepiece view.
- New source pages, creators, CC/public-domain terms, direct downloads and dimensions are in `client/src/lib/binocular-featured-images.json`. Full credits and source links appear next to the featured/gallery image; compact surfaces have abbreviated credit/license labels.

## Verification

- TypeScript check and production build pass.
- 215 tests across 28 files pass, including real projection/altitude ring geometry, catalog class semantics, startup/settings migration, all primary files and attribution, wider-field metadata, damaged-frame omission, and a 25-hour DST selected-day profile with Sun/Moon data.
- Chromium at 919 px and 375 px: fresh empty selection, persistent and clearable selection, uniform constellation strokes, 165 visible catalog objects in the test sky, Pleiades selection, day/night graph, keyboard/cursor readout, replacement Vega image, and no JavaScript errors or horizontal overflow.
- Independent reviewer verified those selection and graph workflows, mobile layout, and Vega attribution. Their concrete duplicate-legend finding was corrected. Phone label density and large-card photo/graph sizing were tightened after the review.

Final parent recheck confirmed the duplicate legend is gone, the selected graph is bounded to 640 px and the full-frame photograph to 360 px. Opening a second star chart produced unique SVG definition IDs; the largest measured stellar core was 8.85 screen pixels in the zoomed test. After Offline ready, a disconnected reload preserved Pleiades, its graph, catalog search and the 960-pixel Vega replacement photo. No browser errors occurred.
