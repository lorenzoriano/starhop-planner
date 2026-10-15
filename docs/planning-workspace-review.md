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

## Independent review

The independent observer completed a fresh exploratory review on October 15, 2026, using the final workbench at 375px and desktop widths, normal and red modes. It checked first-target creation, mixed targets, date/site conversion, notes and observation preservation, fresh records when reusing targets, archive/restore, returning from a new draft, duplicate additions and repeated Plan tonight actions. Mixed SkySafari downloads preserved the saved site's time despite a different global preview, grouped lunar landmarks, retained manual-lookup targets in notes and used only actual observation dates. An offline reload produced a byte-identical list. No browser errors or horizontal overflow were found.

The review found one concrete layout defect: the command panel's inherited overflow clipping hid Archive night in the export menu when site details were collapsed. A scoped overflow rule fixes the dropdown without changing other panels. Both reviewers verified that the entire Archive button receives pointer hits at 375px and 1440px; the independent observer also archived and restored the same records and checked the normal-phone and red-desktop appearance after the fix. Ordinary automated clicks had masked the original defect by scrolling the clipped ancestor, so pointer hit tests were added to the browser verification.

No further reproducible defect remained in the reviewed workflows. Native Android/SkySafari import remains unverified as described above.
