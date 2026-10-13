# Repository assessment and direction

StarHop already has substantial astronomy functionality: real bright and dense star catalogs, Messier and binocular catalogs, variable reach A* routes, difficulty preferences, pattern recognition, stereographic charts, a collection of field guide routes, and local sky calculations. The Express server mainly hosts the frontend; normal observing does not need a database or remote service.

The strongest direction is a field companion that helps an observer choose a worthwhile target, find it, and remember the experience.

## Improvements implemented

| Area | Result |
| --- | --- |
| Observing flow | Tonight discovery, guided Star hop, and My night replace the long form as the main experience. |
| Graphics | Actual overhead sky with altitude rings and selectable targets, uncluttered object markers, illustrated object cards, and an eight hour altitude plot. |
| Planning | Location based time zone, twilight and Moon conditions, visible target filters, equipment preferences, and a search for a high target during darkness. |
| Learning | Stories and realistic observing tips for popular objects, with dark adaptation and finder field guidance. |
| In the field | One active hop at a time, field width distances, pattern confirmation, chart mirror/rotation, and red light mode. |
| Notes | Saved targets, observation timestamps, editable field notes, and Markdown/JSON exports, all on the device. |
| Reliability | Stale routes disappear when observing parameters change; catalog failures can be retried; stored settings and timestamps are validated. |
| Offline | The production build precaches all emitted assets and all seven catalogs. Status verifies stored resources. Remote fonts were removed, and unrelated caches are preserved. |
| Chart correctness | Fixed the factor of two discrepancy between projected star positions and the field of view/ruler scale. |
| Route correctness | Written Bayer/genitive star names resolve to exact catalog stars. Unresolved reference routes are omitted instead of substituting the anchor. Reference distances and patterns are calculated from real fields; scores are no longer fixed at 100. Duplicate calculated paths are removed. |

The first visit uses an explicitly labeled San Francisco location at 21:00. Recommendations prefer recognizable showpieces and established easy targets while accounting for altitude and equipment. This is a useful shortlist, not a model of whether every object will be visible.

## Next priorities

1. **Visibility and catalog quality.** Add angular size, surface brightness, sky brightness preferences, and aperture; review binocular tips and historical route instructions against reliable observing guides. Integrated magnitude alone is misleading for large diffuse nebulae. Expand curated guidance beyond the first showpieces.
2. **A complete session plan.** Suggest an order using dark observing windows, object altitude, angular travel, and Moon separation. Keep explicit user ordering. Support dated sessions and repeated observations of the same target; the current list keeps one observation timestamp and note per target.
3. **Field validation.** Try routes with actual handheld binoculars and common finder/diagonal configurations. Test on iOS and Android, especially installation, storage eviction, touch charts, and dim screen behavior. Red screen color also depends on the device brightness setting.
4. **Astronomy precision.** Review the existing fixed star coordinate transform for epoch/precession handling and improve low altitude behavior before promising high precision. Reconcile coordinate conventions between catalogs and planets.
5. **Maintainability and responsiveness.** Split page sections into smaller components and move expensive route computation into a worker. Lazy load photo calibration and routing views. Remove unused server/database scaffolding once its future role is decided.
6. **Portable data.** Add validated import and backup/restore for preferences and observation logs. The current exports are portable, while saved data remains tied to this browser and origin.

Weather, cloud cover, and local obstruction are not inferred by the app. Future online enrichments should be optional so the observing workflow continues to work without connectivity.
