# Angular footprints in the optical field

The planetarium uses full angular diameters, in degrees after conversion, rather
than treating its minimum-size identification symbols as an object's size.
Published boundaries are approximate. A galaxy's faint photographic outskirts,
an open cluster's outer members, and a binocular view need not have the same
detectable boundary.

## Coverage and source selection

All **253 extended targets** in the included catalogs have an angular footprint.
The remaining **44 entries are stars or double stars**, including M40; these have
point symbols, not invented stellar disks. No extended target is missing a size.

- **71** nebulae/galaxies use OpenNGC's published diameters. **47** entries have a
  position angle, measured east of celestial north. Their projected ellipses may
  therefore be oriented on the sky.
- **182** targets retain the existing observing catalog's dimensions: clusters,
  asterisms, star clouds, the Magellanic Clouds, and other unmatched entries.
  OpenNGC's cluster sizes often describe MWSC central regions; replacing the
  visual field boundaries with these smaller regions would be misleading for
  binocular framing. For example, NGC 869 and NGC 884 retain their 30′ observing
  extents rather than switching to OpenNGC's 14.4′ and 10.5′ central regions.
- **61** targets have two published axes. An absent minor axis is explicitly
  recorded as unknown (`minorKnown: false`). The helper's numeric `minor` then
  repeats `major` solely so a diameter envelope can be drawn.
- A missing position angle remains `null`; an oriented ellipse must not be
  invented. The UI can show a diameter envelope and the known dimensions.

Examples: M31 is 177.83′ × 69.66′ at PA 35°. M42 is 90′ × 60′ with unknown PA.
M45 has an approximately 110′ observing diameter. M57's OpenNGC optical diameter
is 1.27′; a minor axis or orientation is not supplied by that source. These
quantities describe approximate spatial coverage, not a prediction of visible
detail, surface brightness, color, or the limiting isophote in an eyepiece.

## OpenNGC provenance and attribution

The OpenNGC data subset in `client/src/lib/catalog-extents.json` is adapted from
[OpenNGC](https://github.com/mattiaverga/OpenNGC), by Mattia Verga and contributors,
and remains licensed under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
The license text is included in [licenses/OpenNGC-CC-BY-SA-4.0.txt](licenses/OpenNGC-CC-BY-SA-4.0.txt).
Changes: restricted the source to StarHop's existing catalog IDs, mapped Messier
identifiers to their NGC entries, and extracted only axes and position angle.
The source dataset's underlying galaxy measurements are mainly HyperLEDA, with
some NED/SIMBAD/2MASS fallback; nebula measurements derive from HEASARC. A quoted
catalog boundary is not necessarily a uniform visual-band isophote.

- CSV revision: `be3cd6c5498806a2fbb2f7e0452ef802dbb02be0` (2026-10-18).
- CSV: `database_files/NGC.csv`.
- SHA-256: `54abea0b57b0a103831bfc7a8e3a99a23acfbf4bb581fcf3d8af539cbb826c84`.
- The source [field guide](https://github.com/mattiaverga/OpenNGC/blob/be3cd6c5498806a2fbb2f7e0452ef802dbb02be0/NGC_guide.txt)
  defines MajAx/MinAx as arcminutes and PosAng as north eastwards.
- Retrieved on 2026-10-21.

To regenerate the subset with Python's standard library:

```sh
curl -L --fail -o /tmp/starhop-NGC.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/be3cd6c5498806a2fbb2f7e0452ef802dbb02be0/database_files/NGC.csv
python3 script/import-catalog-extents.py /tmp/starhop-NGC.csv
```

The importer rejects a different checksum so a future source change requires a
deliberate review. Tests check the full extended-target coverage, angular units,
representative objects, and explicit unknown axes/orientations.
