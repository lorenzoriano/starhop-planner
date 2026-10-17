# Detailed offline finder fields

Source: Tycho-2 main catalogue, Høg et al. (2000), A&A 355, L27, via CDS/VizieR catalogue I/259/tyc2.
https://cdsarc.cds.unistra.fr/viz-bin/cat/I/259
https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=I/259/tyc2
CDS catalogue reuse/acknowledgement: https://cds.unistra.fr/vizier-org/licences_vizier.html
Retrieved 2026-10-16 (America/Los_Angeles).

297 complete indexed cone queries, radius 8 degrees, centered on the existing survey-image target coordinates. 977,292 records across overlapping fields; stars repeated in different fields represent the same sky. Selection: 8 < Tycho VT <= 10.5, in addition to the app's brighter catalog. Data columns: ICRS/J2000 RA and declination in degrees, VT magnitude, approximate Johnson B−V = 0.85(BT−VT). Positions rounded to 0.00001 degrees, magnitude/color to 0.01. Missing BT colors use neutral white. Epoch positions are not propagated for individual proper motion.

The depth control is for the reference chart, independently of the route's optics limit. It is not a guarantee that all plotted stars are visible with the chosen binoculars, sky brightness, or Moon. Fainter stars beyond VT10.5 and the deep field boundary are not invented. Nebula detail, unresolved cluster light and photographic exposure are not simulated. The separate photographic reference uses the existing DSS2 survey images.

Reproduce with `python3 script/download-finder-stars.py`. The build precaches each field for offline use. The runtime loads only the selected field, with an eight-field memory cache.

Visual-design reference (no code or artwork copied): Stellarium SkyDrawer's separation of magnitude, point size, brightness and B−V color.
https://stellarium.org/doc/23.0/classStelSkyDrawer.html
