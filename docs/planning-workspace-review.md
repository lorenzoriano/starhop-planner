# Planning workspace verification

The planning redesign responds to the request for fewer clicks, less scrolling and one central place to build a night.

## Changes

- Planner is the second main navigation item and uses a single workbench. The general equipment sidebar and global preview-time strip do not compete with the session controls; advanced settings remain available through the header button.
- The first target can create the selected night. Plan tonight and Next new Moon create or select a session directly. Repeated quick-start actions reuse a matching saved night instead of creating duplicates.
- Date, local time and length are inline. Site/name/coordinates and minutes per target are an expandable part of that same form. Saved-night edits have an explicit Save changes action. Switching back to a saved night discards an unfinished new draft and restores that night's metadata.
- Search supports Enter and already-added results cannot accidentally toggle an object out of the list. High-altitude suggestions are calculated for the chosen or saved night, rather than the current global preview.
- Viewing order, find, observed/unobserved, removal and expandable notes share one list. Observed targets and unavailable slots are separate groups. The former second set of large photo/notes cards is removed from Planner; object photography remains in discovery and object views.
- The full calendar and archived nights open on demand. SkySafari export, text notes and session actions are in Export & more, represented by the download icon on phones.

## Checks

TypeScript, the production build and 178 tests across 19 files pass. New tests cover SkySafari identifiers, Julian dates, note escaping, lunar grouping, unsupported objects, ordered plans, actual file-sharing capability, civil-time validation, repeated/skipped DST hours, arbitrary valid session durations and preservation of legacy records.

Production Chromium checks cover a 375px phone viewport, desktop, red mode, creating a night with the first target, keyboard addition, inline notes, observed/unobserved transitions, saved date/time edits, removal, reload, independent sites and notes across nights, quick-start deduplication and returning from an unfinished new draft. Target search is around 520px from the top on the measured phone viewport. Mobile observation, find and removal controls have 44px targets.

The export check inspects actual downloaded .skylist and .txt contents, including a session whose date/site differ from the global preview. It verifies the scheduled subset, Moon grouping, manual-lookup retention, exact offline output, and simulated share success/cancellation/failure. Web Share simulation does not verify an Android receiver. No native SkySafari 8 Android installation is available here for an end-to-end import test; the exporter follows Simulation Curriculum's documented format and the dialog explains checking the imported count.

The independent observer checked the export dialog's initial empty/mobile states and import instructions, then hit its usage limit. The final redesigned workbench was verified directly in the parent browser pass; it is not represented as a completed independent review.
