# GitHub issue resolution review — October 2026

Reviewed all 25 open reports and follow-up comments against the current source and production browser build. Reports were treated as hypotheses; optional design proposals were assessed against the owner’s prior requirements.

## Verification

- TypeScript and production build checks.
- Full unit/integration suite: 284 tests across 40 files.
- Browser: Fit field encloses the whole ring for M31, M45 and Albireo; lunar disk/field ratio is unchanged by zoom.
- Browser: real worker route, forced starting star, field advancement, M31-only Clock handoff, pinned dial, local Travel preview, Moon night axis, setup drawer and 393 px navigation.
- Browser: saving a viewed Oct 24 night preserves a different older night; JSON backup download; essential cache ready and successful offline reload.
- Planetarium DOM in the same M31 field: roughly 80,000 → 2,700 elements.

## Decisions

### #7 — Moon tab: inconsistent moonset/darkness times that drift with the current clock

**Disposition:** completed.

Fixed the remaining label/span mismatch. Moon charts and moonless windows use a stable local noon-to-noon observing night; the headline rise/set facts explicitly show the next events, with dates. The Moonset + 15 min action uses that same next set.

Exact twilight/rise-set roots are retained; rolling the clock within a night does not move the night’s windows. Regression tests compare evening and predawn selections.

### #21 — [UX]: Support two-stage finder-to-eyepiece optical profiles and named telescope orientation presets

**Disposition:** completed.

Added named optical presets and separate Finder hop / Eyepiece configurations, saved custom setups, measured field-width editing, reticle, mirror and rotation. Switching stages applies that stage. The all-sky planetarium always retains naked-eye orientation; the Moon preview optics are local.

Preset widths are estimates. A naked-eye 60° preset cannot be applied as a 0.2–15° optical field; the UI explains this. Profiles never silently apply merely because a collapsed control mounted.

### #22 — [UX]: Add DSO surface brightness (mag/arcmin²) and scaled angular size footprints on SkyChart

**Disposition:** not planned.

Implemented the safe portion: angular sizes always display units and degrees; diffuse objects show explicitly approximate mean surface brightness calculated from the bundled magnitude and axes. Existing binocular advice already models size, surface brightness and moonlight. The selected target has an angular-size reference ring.

The requested measured, position-angle-oriented ellipses are not solvable from this catalog: verified position angles, uniform extent definitions and photometric bandpasses are missing. I will not invent them or relabel approximate averages as measured visibility. Closing the exact proposal as not planned with these data limitations; the useful presentation fixes are shipped.

### #27 — [Enhancement]: Allow observers to override the starting anchor star or insert custom waypoints on SkyChart

**Disposition:** duplicate.

The manual-anchor and required-waypoint work is covered by #35. A starting-star selector retains the chosen star, and chart/star inspection can append up to eight required guide stars in order.

Closing as duplicate of #35, as requested in the follow-up. The actual implementation is tested against the full bundled catalog.

### #28 — [Bug/Performance]: Offload sky graph construction and multi-strategy A* route computation to a Web Worker

**Disposition:** completed.

Moved full graph construction and route planning into a Vite Web Worker. A new request terminates obsolete work; relative catalog fetches resolve against the app base URL, including GitHub Pages subpaths. Stale results are ignored.

Verified a real route in the production browser build. Browsers without Worker support retain a direct computation fallback; worker failures show an explicit error.

### #29 — [Bug/Astronomy]: Account for J2000-to-of-date precession in horizontal transforms and low-altitude refraction

**Disposition:** completed.

Fixed J2000 catalog coordinates to true equator/equinox of date before horizontal conversion, including precession and nutation. Inverse conversion keeps the planetarium zenith in the catalog frame. Culmination/transit searches and catalog transit filters use the same epoch.

Tested against independently assembled Astronomy Engine rotation plus geometric Horizon calculations. Altitude remains explicitly geometric: adding an unconditional refraction correction to it would mix conventions and double-count corrections in event searches. Rise/set use their documented horizon conventions; exact local atmospheric/terrain corrections cannot be inferred from the stored catalog.

### #30 — [Enhancement]: Add JSON backup import/restore and support multiple dated observations per target

**Disposition:** completed.

Added versioned JSON backup download and import with schema validation, a 5 MiB limit, preview counts, and explicit Merge or Replace. It includes settings, saved nights, unscheduled targets, site records, notes and observation histories. Repeated observation actions now append dated records instead of deleting the previous observation.

Tests verify malformed/version/oversized rejection, merging notes and multiple dated observations, and exact replace. Browser verification downloaded the backup successfully. Custom chart-display and optical-preset preferences remain device-specific; observing records and active instrument settings are included.

### #35 — [Astronomical UX] Observers cannot manually select a starting star or customize waypoints for star hop generation

**Disposition:** completed.

Manual starts are retained. Added up to eight required chart/star waypoints, ordered concatenated route legs, and a specific failure when a required point cannot connect. A reached faint guide star can continue the next leg without being rejected by the bright naked-eye starting-star limit.

Full-catalog regressions cover forced Mirach to M31 at 3.7°, ordered HR224, a magnitude-6.13 waypoint, and NGC 752. Guided falls back to an explicitly labelled Balanced route only when short-hop routing cannot connect; the starting star stays unchanged.

### #36 — Planning several nights: compare upcoming nights by Moon, weather and target visibility

**Disposition:** completed.

Added a seven-night comparison and best-three choices over the next 30 nights, showing Moon phase/illumination, actual moon-free astronomical-dark hours, selected-target useful altitude time, and feasible saved-target counts. Available cached forecasts show dark-hour average cloud; uncovered nights say unavailable. Picks can open the chosen night. Monthly binocular picks now evaluate an evening window.

The ranking explicitly describes geometric/Moon criteria. It does not fabricate 30-day weather or call unavailable weather bad. Moon-free dark hours are actual elapsed overlap, not a probability of detection. Saved-night creation can reuse targets; the proposed one-click movement of individual records is not adopted because it could detach notes from their original observation night.

### #37 — One source of truth for the observing night: date, site and display settings drift apart between tabs

**Disposition:** completed.

New saves use the viewed night and site, selecting a matching saved night or creating one instead of mutating an older active night. Planner draft weather is labelled as an unsaved preview. All-sky orientation is independent of optical mirroring; lunar preview optics no longer modify the global instrument. Clock Travel is a local preview until Keep time.

Browser test preserved the old night’s M13 and notes while creating an Oct 24 night for M31. Clock preview left stored plan time unchanged. Shared date/location dialogs remain available across views.

### #38 — Stargazing forecast: partial nights show a misleading 0/100, and numbers disagree on the same screen

**Disposition:** completed.

Fixed pre-noon night assignment and removed the fallback that selected noon when the planned night hour was unavailable. Unknown coverage has an explicit empty state rather than 0/100. Cloud numbers are scoped by night average, selected hour and models; the score range is labelled as a score. Added Moon context, guarded gust display, clearer full-width cloud/model chart, whole-hour ticks, darkness and Moon-up bands, and corrected source copy.

Regression covers a predawn forecast belonging to the previous local-noon night. The chart preserves abrupt real forecast changes; it does not smooth cloud transitions into invented values.

### #39 — Tonight page: answer "should I go out?" first, and slim down the object panel

**Disposition:** completed.

Added a compact observing summary above the large planetarium, retained the prominent forecast verdict, folded the long story/photo attribution behind a disclosure, and kept the requested altitude/Moon/Sun graph in the selected card. Increased chart/readout readability and faint-star floor; zoomed maps show a scale and the planetarium stops at the optical field rather than a 200× empty crop. Phone object selection brings details into view.

The proposal to reduce or demote the large planetarium is not adopted: the owner explicitly requested it as the central opening view. Forecast and geometric sky facts stay separately labelled. The graph’s right axis is Moon distance, not another altitude axis.

### #40 — Planner: stale night names, vague scheduling reasons, and no whole-night timeline

**Disposition:** completed.

Derived night names follow date edits while custom names remain. Added meaningful binocular-ranked suggestions, shared accessible search, a whole-night altitude overview with darkness/Moon-up bands and scheduled blocks, specific unavailable reasons, preview-weather labelling, and dated observation history. Export menu dismisses with Escape/outside click; archiving offers undo.

Tests cover derived-name preservation and a never-high-enough target. Route-scoped calendar state unmounts on navigation. Proposed automatic removal of unavailable targets is not adopted; records stay visible with reasons.

### #41 — Search: one shared search box with name aliases, typo tolerance and honest empty states

**Disposition:** completed.

Shared alias/token/typo ranking now handles Orion Nebula/M42, Brocchi/Collinder 399/Cr 399, h/chi Persei, Seven Sisters and misspellings. Exact Saturn/Jupiter requests do not return planetary nebulae. Added a common combobox with arrow-key highlight, Enter, Escape, status and lunar-feature hints in Tonight, Planner, Clock and Moon.

Search tests verify aliases, exact ID priority and typo cases. A deep-sky catalog does not falsely advertise a complete solar-system search; planet requests receive an honest message.

### #42 — Binoculars and Catalog: tall repetitive cards, no sort, unitless sizes, and a failed hop to NGC 752

**Disposition:** completed.

Binocular cards use compact curves with expandable full graphs; both browsers have useful sort and list choices, unit-bearing angular sizes, readable designations and approximate mean surface brightness. Catalog titles/photos open the selected object detail at the suggested time. Binocular tier defaults follow aperture, and save actions carry the actual observing time.

The NGC 752 3.7° route has a full-catalog regression. The survey-photo footprint is not a promise of an eyepiece view; I have not filled missing survey coverage with invented stars or nebulosity.

### #43 — Moon and Clock tabs: night-based time axis, correct moonset, readable charts and labelled craters

**Disposition:** completed.

Moon planning uses the same noon-to-noon observing night, correct next-event dates and stable dark windows. Full 0–180° separation is the default, with a clearly labelled detail scale; nearly flat separation is physically plausible because Earth rotates Moon and target together. Added more major crater labels with zoom and narrower quarter-phase labels.

Kept the astronomical dial prominent because the owner explicitly requested it. Click pins time until unlocked; Travel requires Keep time; seasonal monthly paths inspect actual samples rather than occupancy rectangles. The denominator of advanced recurrence is explicit.

### #44 — Star hop: poor automatic start stars, Guided pace fails without fallback, and route graphics compete with the route

**Disposition:** completed.

Automatic candidates now favor nearby visible references instead of an ideal distant separation. Guided gets a labelled Balanced fallback while preserving a forced anchor. Required waypoints, automatic replanning after parameter edits, field framing on Next, a gold route, reduced future-pattern clutter, stars-only target retention, and positive observation logging improve field use. Guide-star depth no longer resets when switching instruments.

Production browser check planned from forced Mirach and advanced fields. Full-catalog tests cover the fallback and waypoint cases. Route preference remains an advanced control rather than being treated as an observer-facing guarantee.

### #45 — Visual language: a minimum text size, one colour per sky body, matching chart legends, and a true red-light mode

**Disposition:** completed.

Added shared readable caption rules, larger phone body copy, larger tap targets and chart areas, neutral Moon shading/curves with dash patterns distinct from object and Sun curves, and pure-red luminance filtering with dimming for the app and dialogs. Updated browser theme color in red mode.

Red mode removes green/blue channels rather than applying the old sepia hue filter. Month and object colors remain distinct in normal mode; line styles carry meaning when colors collapse in red mode.

### #46 — Phones and small screens: squeezed tab bar, repeated header on every tab, off-screen details and small tap targets

**Disposition:** completed.

Kept seven destinations with a non-wrapping horizontally scrollable tab strip, active-tab reveal, normal navigation links, compact phone styling, readable body copy, larger controls and overflow-safe planner grids. Object selection brings the detail card into view on phones. Setup is now one dismissible drawer on all pages.

Verified at a real 393×852 viewport: document width and scroll width were both 393 px; the 487 px tab strip scrolls inside its 373 px area. No page-level horizontal overflow. A five-tab redesign is not adopted because Clock and Binoculars are explicit prominent features.

### #47 — Accessibility and performance: 4,540 focusable stars, an 80,000-element Tonight page, and a silent 53 MB offline download

**Disposition:** completed.

Batched faint catalog-star geometry instead of creating thousands of groups/title nodes and focus targets. The chart has one keyboard entry with arrow-key inspection/Enter selection; pointer hit testing retains selection of batched stars. Navigation is made of real links. Default offline preparation caches essentials; photos, lunar imagery and detailed finder fields cache on demand or through an explicit full-download control with progress.

Same-view browser measurement dropped from about 80,000 DOM elements to about 2,700, with zero per-star tab stops. Verified essential cache ready with most bulk assets absent, JSON backup download and successful offline reload. The manifest supplies sizes for honest totals.

### #48 — Information architecture: seven overlapping tabs, duplicated controls, and several names for the same action

**Disposition:** not planned.

Adopted the lower-risk alternative: keep seven named views, standardize accessible selection/search and Add to night actions, make Catalog titles/photos open existing rich details, and use one setup drawer. Optical controls no longer affect the all-sky view; lunar optics are a local preview.

The proposed five-destination merger and single universal card refactor are not adopted. The owner explicitly prioritizes a dedicated binocular collection and a prominent astronomical clock. Those surfaces have different jobs; merging them would remove requested discoverability. Closing the architectural proposal as not planned, with the concrete usability defects addressed in the linked issues.

### #49 — UX review (October 2026): summary and priorities

**Disposition:** completed.

Reviewed every open issue and its follow-up, independently checked factual claims, implemented verified corrections, tested the integrated release, and recorded an individual disposition for each report.

See the linked review journal for all 25 decisions, verification and declined proposals. #27 is a duplicate; #22 and #48 include explicit not-planned decisions rather than claims that their exact proposals shipped.

### #51 — Fit field clips the binocular circle and hides the hop stars

**Disposition:** completed.

Verified Fit field at the stated desktop size and M31 setup. The ring was fully inside the viewport in my reproduction. The claim that raw SVG radii imply subpixel display sizes was incorrect because the zoomed viewBox scales them. Increased the faint-star on-screen floor, reduced DOM overhead, retained correct scale, and frame the active field when advancing a hop.

Confirmed full rings on M31, M45 and Albireo. Measured M31 ring about 502 px inside a 684 px-high plot and previously about 1.1 px faint-star diameter; the updated selected field has visibly larger stars. I am not claiming a clipping defect I could not reproduce. The chart frame clips geometry; the FOV is a viewing reference, not a mask that removes surrounding sky.

### #52 — Object panel says transit is "None today" while the object culminates that night

**Disposition:** completed.

Confirmed the selected-object panel now resolves rise/transit/set over the selected observing night, including the previous evening for a predawn selection. This correction was already present in adcefcc; the epoch correction now keeps the transit calculation consistent too.

Civil-day and observing-night modes remain distinct. A transit outside the selected span is not fabricated; circumpolar targets can have no rise/set. Regression coverage includes genuine culminating, circumpolar and never-rising targets.

### #53 — Binocular-field zoom enlarges the Moon inside the field circle

**Disposition:** completed.

Confirmed the binocular Moon radius scaled with zoom while the field ring did not. Both now use the same zoom factor, preserving the disk-to-field angular ratio. Preview field width is local and its accessible description uses that local value.

Zoom magnifies the chart rather than claiming a change in Moon diameter, binocular magnification or true field. Larger zoom can crop both the field and Moon at the viewport boundary as expected.
