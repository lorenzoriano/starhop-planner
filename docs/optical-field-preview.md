# Optical field and photograph framing

The photograph preview compares **angular framing**, using the selected binocular or telescope's true field width. Aperture, visual limiting magnitude, seeing, eye adaptation and photographic exposure are not simulated by changing the field width. The dialog says that explicitly beside the preview.

## Calibration

Only bundled DSS2 optical cutouts with explicit north-up ICRS `TAN` projection metadata supply the photograph's angular scale. The primary display can be a different archival portrait, but an uncalibrated portrait is never assigned a guessed field size. If no calibrated optical photograph is available, the preview explains that its photographic framing cannot be simulated accurately.

- CDS HiPS2FITS documentation: <https://alasky.cds.unistra.fr/hips-image-services/hips2fits>
- Its `fov` parameter is **the largest image dimension**, not the diagonal.
- TAN image pixel scale is `2 tan(fov / 2) / max(width,height)` radians per pixel.
- A 4°-wide, 640×480 image therefore spans `2 atan(tan(2°) × 480/640)` vertically, approximately 3.0005°. It keeps its 4:3 image aspect ratio throughout the preview.
- The selected field's tangent width is `2 tan(fieldWidth / 2)`. Scaling the photograph and the optical opening by the same tangent-plane scale preserves their relative angular dimensions.
- Images smaller than the opening leave a **hatched missing-photograph area**. It is not presented as empty or starless sky.
- The cross uses the target's catalog RA/Dec projected into the photograph's gnomonic plane; the field is centered at the photograph's recorded RA/Dec. These can differ slightly.

The CDS service's FITS calibration was independently sampled with the same M31 center, projection and fov as the bundled cutout, at 64×48 to avoid downloading a large image:

<https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&ra=10.6750000&dec=41.2666667&width=64&height=48&fov=4&projection=TAN&coordsys=icrs&rotation_angle=0&format=fits>

Returned header:

```text
NAXIS1 = 64
NAXIS2 = 48
CRPIX1 = 32
CRPIX2 = 24
CDELT1 = -0.062525397163323
CDELT2 =  0.062525397163323
CTYPE1 = RA---TAN
CTYPE2 = DEC--TAN
CRVAL1 = 10.675
CRVAL2 = 41.2666667
```

`CDELT` matches `2 tan(2°) / 64` converted to degrees. The image placement also accounts for FITS's one-based reference-pixel convention: after north-up raster export, CRPIX is `(width/2 − 0.5, height/2 + 0.5)` in raster pixel-edge coordinates. This matters when viewing a narrow crop of a broad cutout.

## Controls and behavior

- “Preview optics” opens the framing dialog on the main selected object, the Moon comparison photo, and Binoculars detail. Compact catalog buttons remain free of nested buttons.
- Width starts from the selected optics; common width comparisons, an editable degree field and “Frame object” are available.
- Circle or rectangular opening follows the selected instrument. For a rectangle, editing width keeps its selected height; this matches the app's width control.
- Mirror and 90° rotation compare common telescope orientations.
- “Use this field in planetarium” explicitly applies the preview width to the selected observing setup. Merely trying a preview leaves the setup intact.
- Missing image data is distinct from a known angular field. Offline behavior reuses the app's bundled/cacheable images.

## Verification

Six algorithm tests cover exact TAN scaling, unchanged image proportions, circle/rectangle aspect, M31 and M45 metadata, RA wrapping, a high-declination target, missing metadata, invalid fields and FITS reference-pixel alignment. Browser test: `script/review-round5/photo-optics.cjs` measures actual SVG image dimensions at 7°, 3.7°, 1° and 0.2° and verifies apply behavior, orientation controls, missing-image-area copy and phone layout.
