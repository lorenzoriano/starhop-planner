# StarHop Sky Journeys survey illustrations

These survey cutouts illustrate Sky Journeys objects that have no bundled image in
`data/binocular-images/`. They are educational illustrations, not live images and not
simulations of the binocular view. Their copyrights are separate from StarHop's MIT
software license. Coordinates, field widths, the SkyView request URL and a SHA-256 of
every source band are recorded in `script/journeys/generated/media.auto.json`
(`acquisitions`) in the source repository; `script/journeys/fetch_media.py` regenerates them.

All images are 640 × 480 pixels, gnomonic (TAN) projection, J2000, north up, east left.

## Optical: files ending in -optical.jpg and -context.jpg

Digitized Sky Survey 2 (DSS2) red and blue plates. The Digitized Sky Surveys were
produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166.
The images are based on photographic data obtained using the Oschin Schmidt Telescope on
Palomar Mountain (POSS-II) and the UK Schmidt Telescope. The plates were processed into the
present compressed digital form with the permission of these institutions. Survey copyright
holders include STScI/AURA, the California Institute of Technology, the Royal Observatory
Edinburgh / UK SERC-PPARC and the Anglo-Australian Observatory.
Educational and other noncommercial use is permitted with acknowledgment; commercial reuse
requires permission from the relevant copyright holders.

Policy and copyright details: https://archive.stsci.edu/publishing/data-use
The Second Palomar Observatory Sky Survey (POSS-II) was made by the California Institute of
Technology with funds from the National Science Foundation, the National Geographic Society,
the Sloan Foundation, the Samuel Oschin Foundation, and the Eastman Kodak Corporation.
The UK Schmidt Telescope was operated by the Royal Observatory Edinburgh, with funding from the
UK Science and Engineering Research Council (later the UK Particle Physics and Astronomy
Research Council), until 1988 June, and thereafter by the Anglo-Australian Observatory.

Survey acknowledgment: https://archive.stsci.edu/dss/acknowledging.html
Copyright notices per plate: https://archive.stsci.edu/dss/copyright.html

Fields of 5° or more use the first-generation survey (DSS1: POSS-I E red and O blue plates in
the north; UK Schmidt SERC-J plates in the south), because SkyView mosaics of many DSS2 plates
show strong seams at that size; DSS1 is also the fallback where a DSS2 plate is missing. The
acquisition record names the plate series used for each band. If only one plate covers a field,
the image is a monochrome rendering of that plate and its caption says so.

The National Geographic Society - Palomar Observatory Sky Atlas (POSS-I) was made by the
California Institute of Technology with grants from the National Geographic Society.

Color: StarHop combined the two plates the same way as the CDS DSS2 color mosaic used for
the bundled images: red plate → red channel, blue plate → blue channel, their mean → green,
after a percentile-clipped asinh stretch of each plate (applied to the FITS data, not to
JPEGs). Plate seams, plate-label marks, halos and saturated stars may be visible, especially in
the widest fields. `-context.jpg` files show a 3.7° field, about one binocular view.

## Near infrared: files ending in -infrared.jpg

Two Micron All Sky Survey (2MASS) Ks-band (2.2 µm) atlas images, shown in grayscale. (A J/H/Ks
color composite was tried; independent background offsets of the survey tiles in each band made a
patchwork, so a single band is used.) Faint rectangular patches can still mark tile boundaries.
This publication makes use of data products from the Two Micron All Sky Survey, which is a
joint project of the University of Massachusetts and the Infrared Processing and Analysis
Center/California Institute of Technology, funded by the National Aeronautics and Space
Administration and the National Science Foundation. The 2MASS images are in the public
domain; acknowledgment is requested. The wavelength is invisible to the eye.

Policy: https://www.ipac.caltech.edu/2mass/gallery/aboutimages.html

## Cutout service

This research made use of NASA's SkyView facility (https://skyview.gsfc.nasa.gov), located at
NASA Goddard Space Flight Center (McGlynn, Scollick & White 1998, IAU Symposium 179, 465).

## Reviewed and withheld

Every composite was inspected before publication. Not published: `IC1396-infrared` (2MASS
tile steps dominate the 3° mosaic) and `DN-Coalsack-optical` (plate seam more prominent than the
low-contrast cloud). Those objects rely on their other images or on in-app visuals. Image-specific
artifacts that remain (plate defects, tile edges, plate labels) are mentioned in the captions.
