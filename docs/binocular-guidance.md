# Binocular guidance and sky display

## Default optics

The owner’s KITE APC stabilized 14×50 ED is the default: 14× magnification, 50 mm aperture, 3.7° true field, 86% transmission. Its calculated exit pupil is 50/14 = 3.57 mm. These values come from the [manufacturer specification](https://kiteoptics.com/en/apc-stabilized-14x50-ed-li-ion-k280048). Existing explicit telescope and custom binocular settings remain intact; the old implicit/default 10×50, 7° profile migrates once. Later edits are retained. Binocular true field is stored separately from a telescope finder field, so switching instruments does not change the binocular assessment.

The optics row on Tonight, Catalog and Binoculars edits the shared profile. Sky brightness is an explicit user assumption; it is not measured from the device location. The default 21.6 mag/arcsec² represents a dark site. Suburban users should select a brighter sky assumption.

## Recommendation method and limits

Every unified catalog object gets the same explainable assessment. This is a heuristic, not a full implementation of a human visual threshold model. Its inputs are:

- Catalog magnitude, class, angular dimensions, and double-star component separation / magnitude difference.
- Original curated visual descriptions and aperture tiers, where available.
- Aperture, magnification, image stabilization, true field and optical transmission.
- Target altitude and extinction, Moon phase/height/separation, and the chosen moonless sky brightness.

The estimated stellar limit uses the [Unihedron sky brightness / NELM conversion](https://unihedron.com/projects/darksky/NELM2BCalc.html), an aperture gain relative to an assumed 6 mm eye pupil, throughput and differential extinction. It is only an approximate point-source limit: individual eyesight, exit pupil, magnification, binocular summation and background adaptation introduce large observer variation. Integrated extended-object magnitude is never presented as proof of detectability.

For diffuse objects with dimensions, mean surface brightness is `m + 2.5 log10(π/4 × major × minor × 3600)` with diameters in arcminutes. Object-to-sky intensity ratios provide coarse contrast tiers. Bright cores can be much easier than an object’s average; explicit curated exceptions retain M31’s central glow. Globular clusters get a warning about resolving individual stars. Tiny planetary nebulae can be detected while remaining visually star-like. Double-star splitting uses apparent separation, magnitude difference and stability as a conservative rule, not a telescope diffraction limit. Wide pairs and their close subpairs are distinguished in the notes.

Moon sky glow uses the existing Krisciunas–Schaefer scattering model and is zero while the Moon is down. Low altitude, diffuse-object moonlight and unsupported high magnification can downgrade advice. The condition label compares against the same optics at a dark reference sky: moonlight-driven difficulty asks for a darker Moon, while intrinsic size, faintness and aperture limitations retain telescope guidance. Daylight / twilight and horizon availability are separately labeled so intrinsic optical suitability does not imply visibility at that moment.

[Andrew Crumey’s visual contrast research](https://academic.oup.com/mnras/article/442/3/2600/1052389) explains why apparent angular size and contrast matter. In particular, a smaller exit pupil dims an extended object and its sky background together; it does not automatically increase contrast. The app does not claim to implement Crumey’s full threshold model. It does not predict weather, local obstructions, current variable-star brightness or detailed eyepiece appearance. Survey photos remain clearly labeled as telescope exposures.

The [generated catalog audit](binocular-catalog-audit.md) records all 297 assessments at one stated reference condition. Regenerate with `npx tsx script/audit-binocular-catalog.ts` after changing data or rules.

## Catalog planning filters

The whole catalog has a dedicated navigation destination. Search, object class, suitability, altitude, angular Moon distance and hours from upper transit can be combined for a selected moment, astronomical night, or local time range. All conditions must hold simultaneously. Time windows use five-minute samples plus exact altitude culminations; very short joint visibility intervals between samples may be missed. Cards show a suggested matching moment balancing altitude and modeled moonlight, rather than promising an optimum to the minute. Saving the first target without an active session starts a session at that card’s matching time; later additions go to the named active session. Planner arranges the sequence, so the individual card times are not reserved slots. Moon distance remains a geometric filter when the Moon is down; sky glow does not.

Astronomical darkness is Sun altitude below −18°, from evening dusk to morning dawn. Polar no-darkness windows return no matches. Overnight ranges and daylight-saving validation use the existing local-time resolver.

Design references were [Telescopius target filtering](https://forum.telescopius.com/t/multi-search-parameters-function/606) and [Mobile Observatory’s catalog/visibility tools](https://www.zima.co/documentation.html). The interface uses the app’s own visual language and a small set of directly editable filters.

## Catalog-driven stars

Bright Star Catalogue temperature (`K`) and dense-star B−V color index drive display hues. B−V is converted using the Ballesteros temperature approximation. Relative Planck radiances at representative RGB wavelengths, white balanced at 6500 K, give an approximate display color. Unknown measurements remain neutral. This does not reproduce atmospheric reddening, camera processing, monitor calibration or color sensitivity at low light levels.

Magnitude drives star marker radius monotonically, with a floor for legibility. Radius is a brightness cue, not physical stellar diameter. Catalog objects use separate outlined symbols; selected targets are gold. All catalog targets above the geometric horizon appear on the planetarium and can update the featured object. Labels are collision-limited; hovering or keyboard focusing a marker identifies it even when its label is omitted. Red-light mode deliberately suppresses normal colors.
