# SkySafari list and night-plan export

Open **Planner → Export & more → Export to SkySafari**. On phones, Export & more is the download icon beside the night selector. The dialog contains the instructions even when your observing list is empty.

## Choose what to take

- **Observing list:** every saved target in the selected session (or the unscheduled list), in saved order. Actual observation times and object notes are included.
- **Night plan:** the active dated session's scheduled targets in the same suggested order used by Planner. Already observed targets and targets without a usable slot are excluded from this .skylist and identified in the preview. They remain in the complete notes file.

Download `.skylist` for the planetarium and `.txt` for the complete night plan. On devices that can share that exact file, **Share .skylist** opens the operating system's share sheet. Choose SkySafari if it is offered. A successful share means the device accepted the file; check the imported list in SkySafari to confirm import. Cancellation leaves the list untouched and does not trigger a download.

The text plan preserves the active session's local date, UTC offset, time zone, site, coordinates, duration, target slots, Moon separations, observing tips and recorded notes. Previewing a different sky in StarHop does not change that exported session. If SkySafari sorts the list, use the numbered target comments or text plan for the intended sequence.

## Android: SkySafari 8 Plus

1. Download the `.skylist` on the phone, or share it to SkySafari when that app appears in the device's share sheet.
2. Open the file from **Files → Downloads**, choosing SkySafari Plus as the receiving app. If Android does not offer it, email the unchanged file to yourself as an attachment; open or long-press the attachment and choose SkySafari rather than an email preview.
3. Open **Observe → Observing Lists** in SkySafari. Check the new list and expected object count before taking it into the field.
4. Set SkySafari's observing date/time and location from the text plan. Importing an observing list does not apply the observing site, change the sky time, or create a timed calendar session.

Email and file-opening behavior varies between Android versions, browsers and installed SkySafari builds. Simulation Curriculum documents [attachment-based import](https://support.simulationcurriculum.com/hc/en-us/articles/115015943028-Observing-Lists-Help). If file opening fails, use the installed app's Help for its import method. Its [Android 14 / SkySafari 7 support example](https://support.simulationcurriculum.com/hc/en-us/community/posts/28478507276567-How-To-Copy-Skylist-Files-To-Observing-List-Using-SkySafari-7-On-Android-Answer-Read-On) describes copying into the application's `files/Observing Lists` folder by USB. Do not assume that older SD-card instructions or a version 7 package name apply to version 8.

## Exporting on a computer

Download both files. Transfer the `.skylist` to the Android phone by USB or email, keeping its extension, then use the Android steps above. The `.txt` file is readable in a text editor or phone file viewer and contains the complete saved list, including manual-lookup targets. Creating both files works offline once StarHop is prepared; emailing and following external support links require a connection.

## Format and object matching

The serializer follows Simulation Curriculum's [documented observing-list format](https://support.simulationcurriculum.com/hc/en-us/articles/231539467-SkySafari-for-Android-Frequently-Asked-Questions): version 3, delimited objects, catalog identifiers, optional comments and Julian observation dates.

- It uses unresolved database indices (`-1,-1`) with the documented solar-system, star or deep-sky object type. SkySafari resolves its own internal database indices.
- Each entry supplies one catalog identifier, such as `M 31`, `NGC 869`, `HR 424`, `Beta Cyg` or `61 Cyg`. Nicknames are kept in comments. The format requires all supplied names to match; adding an unrecognized nickname alongside a valid catalog number can therefore prevent recognition.
- Only recorded `observedAt` timestamps populate `DateObserved`. Suggested times are comments, never fabricated observations.
- Comments encode newlines as literal `\n`; special/control characters cannot create additional object blocks.
- Aliases of the same object coalesce without discarding either saved record's notes.
- Lunar landmarks coalesce under **Moon**. Their names, individual scheduled times and recorded observations stay in comments and text notes. No aggregate Moon observation date is invented.
- Asterisms without a standard catalog identifier and unavailable records are explicitly excluded from the .skylist and retained in the text plan, including known coordinates for manual lookup. Recognized cluster aliases such as the Coathanger's `Cr 399` can be included.

This transfers an observing list and accompanying plan, not StarHop's interactive charts, route animation, photos or a SkySafari settings file. SkySafari's catalog coverage and Android import handling must be checked in the installed app. Automated tests validate format, identifiers, dates, grouping, exclusions, notes and browser file handoff; a native SkySafari 8 Android installation is not available in this workspace for an end-to-end import test.
