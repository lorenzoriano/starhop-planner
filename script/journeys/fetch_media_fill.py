#!/usr/bin/env python3
"""Sky Journeys media fill: a picture for every master-list object that has none.

Owner brief (docs/sky-journeys/owner-feedback-r1.md, "Visuals and UI"): every stop has a picture, with a
tap-to-enlarge high-resolution view. Objects that already get an image from the curated tier, the licensed photographs
(media.licensed.json) or the survey manifest (media.auto.json) are left alone. For each remaining object:

1. Showpiece photograph (SHOWPIECES below): a real telescope photograph from ESA/Hubble or ESO, licence-checked on its
   page with the same rules as fetch_licensed_media.py (credit line present, CC BY 4.0 usage-terms link, no exception
   wording, "Observation" type), saved as a card copy (<= 1200 px, <= 250 KB, progressive JPEG) under
   client/public/data/journey-images/photos/<publisherId>.jpg and a large copy (<= 2400 px, <= 900 KB) under
   photos/large/<publisherId>.jpg when the source is bigger than the card copy.
2. Binocular-field survey photo, for every object: the DSS2 colour survey (CDS "DSS colored" HiPS, the survey the
   bundled binocular images were cut from), read tile by tile from ESA's ESASky mirror
   (https://skies.esac.esa.int/DSSColor; CDS hosts time out from the build host) and reprojected here onto a gnomonic
   (TAN) field centered on the object: 4° wide for stars (about one binocular field; extent-based for deep-sky
   objects, as in fetch_media.py), north up, east left. Rendered at 2400 x 1800 from order-6 tiles (6.4" pixels),
   given a gentle asinh lift, downsampled to 1200 x 900 and saved as a progressive JPEG of <= 250 KB under
   client/public/data/journey-images/fields/<id>.jpg. Star fields get four short marks around the centre so the target
   can be found among the field stars. The HiPS is blended across plates (no plate labels, faint seams), so it is
   preferred over raw SkyView mosaics; when the mirror fails, the script falls back to a NASA SkyView DSS2 red + blue
   cutout (DSS1 when that shows plate artefacts), composed as in fetch_media.py.

Writes script/journeys/generated/media.fill.json, consumed by the KB build (build_kb.ts): for an object whose merged
image list is empty, the build uses `objects[id].images` (KbImage records: src, large?, credit, license, caption,
fieldDeg?, variant, sourceUrl). Also writes CREDITS.md in fields/ and photos/.

    PY="uv run --with pillow --with numpy --with astropy --with astropy-healpix python -I"
    $PY script/journeys/fetch_media_fill.py                 # fetch what is missing
    $PY script/journeys/fetch_media_fill.py --manifest-only # offline: manifest from the files on disk
    $PY script/journeys/fetch_media_fill.py --refresh --only=HR264,HR424
    $PY script/journeys/fetch_media_fill.py --manifest-only --contact-sheet=/path/dir   # contact sheets for review
    --tile-cache=DIR keeps downloaded HiPS tiles (default: <system temp>/starhop-hips-dsscolor).
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import io
import json
import math
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # sibling build scripts (this repo's own code)
import fetch_licensed_media as LIC  # noqa: E402
import fetch_media as FM  # noqa: E402

ROOT = HERE.parents[1]
PUBLIC = ROOT / "client" / "public"
LIB = ROOT / "client" / "src" / "lib"
FIELD_DIR = PUBLIC / "data" / "journey-images" / "fields"
PHOTO_DIR = PUBLIC / "data" / "journey-images" / "photos"
FIELD_PREFIX = "data/journey-images/fields/"
PHOTO_PREFIX = "data/journey-images/photos/"
OUT = HERE / "generated" / "media.fill.json"

FETCH_W, FETCH_H = 1200, 900  # SkyView cutout (fallback); resampled to the card size
CARD_W, CARD_H = 1200, 900
HIPS_BASE = "https://skies.esac.esa.int/DSSColor"  # ESA mirror of CDS P/DSS2/color (hips_order 9, 512 px jpeg tiles)
HIPS_SOURCE_PAGE = "https://skies.esac.esa.int/DSSColor/properties"
HIPS_ORDER = 6  # tile order; pixels are HEALPix order 15 (about 6.4")
HIPS_LIFT = 1.5  # asinh lift on top of the survey's own colour stretch
TILE_CACHE = Path(__import__("tempfile").gettempdir()) / "starhop-hips-dsscolor"
CARD_MAX_BYTES = 250_000
STAR_FOV = 4.0
WIDE_FOV = 5.0
WORKERS = 3

HIPS_CREDIT = ("Digitized Sky Survey 2 (POSS-II / UK Schmidt plates) · STScI / NASA; colour HiPS by CDS (Strasbourg), "
               "via the ESASky mirror; field reprojected by StarHop")
DSS_CREDIT = ("Digitized Sky Survey (DSS2) via NASA SkyView · POSS-II / UK Schmidt plates: STScI / Caltech / ROE / AAO; "
              "colour composite by StarHop")
DSS1_CREDIT = ("Digitized Sky Survey (DSS1) via NASA SkyView · POSS-I / UK Schmidt SERC plates: STScI / Caltech / ROE / AAO; "
               "colour composite by StarHop")
DSS_LICENSE = "DSS2: educational non-commercial use with acknowledgment"

# Showpiece photographs for objects without any image. Each page was read (2026-11-02): the caption below restates
# what the publisher's description says the image shows, in plain words and without new numbers.
# first=True puts the photograph before the survey field (the card shows the first image).
SHOWPIECES: dict[str, list[dict]] = {
    "HR264": [{"site": "esahubble", "id": "heic1818a", "first": False,
               "caption": "Hubble's close-up of the Ghost Nebula (IC 63), a cloud of gas and dust next to γ Cassiopeiae. "
                          "The star, just outside the frame, makes the cloud glow and is slowly blowing it away."}],
    "HR424": [{"site": "esahubble", "id": "opo0602c", "first": True,
               "caption": "Hubble separates the North Star from its faint companion, Polaris B. A third star sits too "
                          "close to Polaris to show here, so the North Star is really a triple."}],
    "HD58061": [{"site": "eso", "id": "eso1546a", "first": True,
                 "caption": "The VLT's close-up of the dust clouds around the red hypergiant VY Canis Majoris, lit by "
                            "the star itself, which is hidden behind a mask at the centre. The crosses are instrument "
                            "artefacts."}],
    "HD31293": [{"site": "eso", "id": "eso2008a", "first": True,
                 "caption": "The VLT's view of the dusty disc around the young star AB Aurigae. The bright twist near "
                            "the centre may mark the spot where a planet is forming."}],
    "HR1895": [{"site": "esahubble", "id": "heic0601d", "first": True,
                "caption": "Hubble's view of the Trapezium, the heavyweight young stars at the heart of the Orion "
                           "Nebula. Their ultraviolet light, most of it from θ¹ Orionis C, carves out the cavity "
                           "they sit in."}],
    "HR5459": [{"site": "esahubble", "id": "potw1635a", "first": True,
                "caption": "Hubble's portrait of Alpha Centauri A (left) and B (right), the two Sun-like stars that "
                           "binoculars merge into one point of light."}],
    "HD192163": [{"site": "esahubble", "id": "opo0023c", "first": True,
                  "caption": "Hubble's close-up of the gas around WR 136. The star shed this material when it was a "
                             "red supergiant; its fierce wind is now tearing into it, shaping the Crescent Nebula."}],
    "HR1156": [{"site": "esahubble", "id": "opo0036a", "first": False,
                "caption": "Hubble's view of IC 349, a dark cloud drifting past Merope in the Pleiades. Starlight "
                           "reflects off the dust like a torch beam off a cave wall, and slowly pushes it aside."}],
    "HR1948": [{"site": "eso", "id": "eso0949a", "first": True,
                "caption": "VISTA's infrared view of the Flame Nebula beside Alnitak, the bright star at right. "
                           "Infrared light pierces the dust that hides the nebula's young cluster from the eye; the "
                           "Horsehead Nebula is the faint dark notch at lower right."}],
}

# Visual review of the contact sheets (fetch_media_fill.py --contact-sheet), 2026-11-02. "note" is appended to the
# caption; "mono": True renders the HiPS from its red channel in black and white (where the CDS composite lacks the blue
# plate, which shows as a hard-edged orange block; SkyView's own mosaics there are worse: monochrome, with strong plate
# seams and labels); "source": "skyview" skips the HiPS; "reject" drops the survey field.
_RING = "The faint ring near the edge is a reflection of a bright star inside the survey telescope, not a real object."
_RINGS = "The faint rings are reflections of bright stars inside the survey telescope, not real objects."
_TRAIL = "The straight streaks are trails left on the original plate by a satellite or aircraft."
_FLAW = "The dark smudges at left are flaws on the original photographic plate."
REVIEW: dict[str, dict] = {
    **{k: {"mono": True} for k in ("HR4730", "HR4731", "HR6247", "HR6508", "HR6527", "HR7020")},
    "HR1203": {"note": "The black patch at upper left is a gap in the survey data."},
    "HR591": {"note": "The blue shape at the left edge is a flaw on the original plate."},
    **{k: {"note": _RING} for k in ("HR3485", "HR3734", "HR4853", "HR5267", "HR5459", "HR5460", "HR5984", "HR5993",
                                    "HR6027", "HR6510", "HR6879")},
    "HR2286": {"note": _RINGS},
    "HR1605": {"note": "The large ring with a cross at left is a reflection of nearby Capella inside the survey "
                       "telescope, not a real object."},
    **{k: {"note": _FLAW} for k in ("HR2890", "HR2891", "HR2990")},
    **{k: {"note": _TRAIL} for k in ("HR337", "HR4295", "HR5191", "HR6132", "HR7735", "HR2845", "HR4554", "HR1142",
                                    "HR1145", "HR1149", "HR1156", "HR1165", "HR1178", "HR1180")},
    **{k: {"note": "Brightness steps in the background are joins between survey plates."}
       for k in ("HR9004", "HR3207", "HR5953")},
}

# Stars that move fast across the sky: on the survey plate (exposed decades ago) they sit a little off the marked
# centre, which is the catalogue position for epoch J2000.
FAST_MOVERS = {"HD33793", "HR4550", "HD217987", "HD202560", "HD95735", "HD1326", "HR1325", "HR509", "HR5459", "HR5460"}


def today() -> str:
    return dt.date.today().isoformat()


# ───────────────────────────── what needs a picture ─────────────────────────────

def load_names() -> dict[str, str]:
    names: dict[str, str] = {}
    for o in json.loads((HERE / "object-list.json").read_text())["objects"]:
        names[o["id"]] = o["name"]
    for f in sorted((HERE / "curated").glob("*-*.json")):
        try:
            data = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        for o in data.get("objects", []):
            d = (o.get("names") or {}).get("display")
            if d and o.get("id") in names:
                names[o["id"]] = d
    return names


def covered_ids() -> set[str]:
    """Objects that already get at least one image from the KB build's other media inputs (mirror of mergeObject)."""
    lic = json.loads((HERE / "generated" / "media.licensed.json").read_text()) if (HERE / "generated" / "media.licensed.json").exists() else {}
    lic_hit = {(r["objectId"], r["originalUrl"]) for r in lic.get("images", []) if (PUBLIC / r["localPath"]).exists()}
    auto = json.loads((HERE / "generated" / "media.auto.json").read_text()) if (HERE / "generated" / "media.auto.json").exists() else {}
    curated: dict[str, list[dict]] = {}
    for f in sorted((HERE / "curated").glob("*-*.json")):
        try:
            data = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        for o in data.get("objects", []):
            ims = (o.get("media") or {}).get("images") or []
            if ims:
                curated[o["id"]] = ims
    out = set()
    for o in json.loads((HERE / "object-list.json").read_text())["objects"]:
        oid = o["id"]
        if oid in curated:  # curated images replace auto ones entirely
            ok = any((im["src"].startswith(("http://", "https://")) and (oid, im["src"]) in lic_hit)
                     or (not im["src"].startswith(("http://", "https://")) and (PUBLIC / im["src"]).exists())
                     for im in curated[oid])
        else:
            ok = any((PUBLIC / im["src"]).exists() for im in auto.get("objects", {}).get(oid, {}).get("images", []))
        if ok:
            out.add(oid)
    return out


# ───────────────────────────── survey fields ─────────────────────────────

def field_fov(o: dict, extents: dict) -> float:
    if o["kind"] == "star":
        return STAR_FOV
    fov = FM.FOV.get(o["id"])
    if fov is None:
        e = extents.get(o["id"], {}).get("majorArcmin") or 30
        fov = max(0.6, min(7, round(e / 60 * 2, 2)))
    return max(fov, 1.0)


def skyview_url(survey: str, ra: float, dec: float, fov: float) -> str:
    q = {"Position": f"{ra:.5f},{dec:.5f}", "Survey": survey, "Pixels": f"{FETCH_W},{FETCH_H}",
         "Size": f"{fov:g},{fov * FETCH_H / FETCH_W:g}", "Projection": "Tan", "Coordinates": "J2000", "Return": "FITS"}
    return FM.SKYVIEW + "?" + urllib.parse.urlencode(q)


def read_fits(body: bytes):
    import numpy as np

    header: dict[str, str] = {}
    pos = 0
    while True:
        card = body[pos:pos + 80].decode("ascii", "replace")
        pos += 80
        key = card[:8].strip()
        if key == "END":
            break
        if card[8:10] == "= ":
            header[key] = card[10:].split("/")[0].strip().strip("'").strip()
    start = ((pos + 2879) // 2880) * 2880
    bitpix, nx, ny = int(header["BITPIX"]), int(header["NAXIS1"]), int(header["NAXIS2"])
    if (nx, ny) != (FETCH_W, FETCH_H):
        raise ValueError(f"unexpected cutout size {(nx, ny)}")
    dtype = {-32: ">f4", -64: ">f8", 16: ">i2", 32: ">i4", 8: "u1"}[bitpix]
    n = nx * ny * np.dtype(dtype).itemsize
    a = np.frombuffer(body[start:start + n], dtype=dtype).reshape(ny, nx).astype(np.float64)
    a = a * float(header.get("BSCALE", 1) or 1) + float(header.get("BZERO", 0) or 0)
    return a[::-1]  # FITS row 1 is the bottom (south): flip so north is up


def coverage(a) -> float:
    import numpy as np

    return float(np.mean(np.isfinite(a) & (a != 0)))


def stretch(a):
    import numpy as np

    good = a[np.isfinite(a) & (a != 0)]
    lo, hi = np.percentile(good, 0.5), np.percentile(good, 99.8)
    if hi <= lo:
        hi = lo + 1
    t = np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo), 0, 1)
    return np.arcsinh(2.0 * t) / math.asinh(2.0)


def add_marks(img, lum) -> None:
    """Four short marks around the image centre (the catalogue position), clear of the star's glow."""
    from PIL import ImageDraw

    import numpy as np

    w, h = img.size
    cx, cy = (w - 1) / 2, (h - 1) / 2
    radii = []
    for ang in range(0, 360, 45):
        dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        r, below = 0, 0
        for step in range(1, 120):
            x, y = int(round(cx + dx * step)), int(round(cy + dy * step))
            if lum[y, x] < 0.55:
                below += 1
                if below >= 3:
                    r = step - 2
                    break
            else:
                below = 0
        else:
            r = 120
        radii.append(r)
    glow = float(np.median(radii))
    gap = max(11.0, min(70.0, glow + 8))
    length = 20
    draw = ImageDraw.Draw(img, "RGBA")
    col = (255, 196, 92, 215)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x0, y0 = cx + dx * gap, cy + dy * gap
        x1, y1 = cx + dx * (gap + length), cy + dy * (gap + length)
        draw.line([(x0, y0), (x1, y1)], fill=col, width=2)


def artifact_blocks(arr) -> int:
    """Count 32 x 32 px blocks that look like plate artefacts rather than sky: holes (block median far below the
    field's) anywhere, and solid white blocks (plate labels, step wedges) along the border, away from the centre."""
    import numpy as np

    lum = arr.mean(axis=2)
    mn = arr.min(axis=2)
    h, w = lum.shape
    bs = 32
    gm = float(np.median(lum))
    n = 0
    for by in range(0, h - bs + 1, bs):
        for bx in range(0, w - bs + 1, bs):
            blk = lum[by:by + bs, bx:bx + bs]
            if gm > 0.04 and float(np.median(blk)) < 0.3 * gm and float(np.mean(blk < 0.3 * gm)) > 0.8:
                n += 1
                continue
            border = bx < 2 * bs or by < 2 * bs or bx >= w - 3 * bs or by >= h - 3 * bs
            if border and float(np.mean(mn[by:by + bs, bx:bx + bs] > 0.95)) > 0.6:
                n += 1
    return n


def compose(red, blue, marks: bool) -> tuple[bytes, dict]:
    import numpy as np
    from PIL import Image, ImageFilter

    R = stretch(red)
    if blue is None:
        rgb = np.dstack([R, R, R])
    else:
        B = stretch(blue)
        rgb = np.dstack([R, (R + B) / 2, B])
    img = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(0.6)).resize((CARD_W, CARD_H), Image.LANCZOS)
    arr = np.asarray(img).astype(np.float64) / 255
    lum = arr.mean(axis=2)
    stats = {"meanLum": round(float(lum.mean()), 4), "stdLum": round(float(lum.std()), 4),
             "saturatedFrac": round(float(np.mean(arr.min(axis=2) > 0.98)), 5), "artifactBlocks": artifact_blocks(arr)}
    if stats["stdLum"] < 0.01:
        raise ValueError("blank cutout")
    if stats["saturatedFrac"] > 0.08:
        raise ValueError(f"saturated cutout ({stats['saturatedFrac']:.1%} of pixels white)")
    if marks:
        add_marks(img, lum)
    for q in (74, 70, 66, 62, 58):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, progressive=True, optimize=True)
        if buf.tell() <= CARD_MAX_BYTES:
            stats["quality"] = q
            return buf.getvalue(), stats
    raise ValueError("cannot reach the card size limit")


# ───────────────────────────── HiPS (preferred) ─────────────────────────────

def _compact_bits(x):
    """Every other bit of x (bits 0, 2, 4, ...) packed together: de-interleaves a NESTED HEALPix sub-index."""
    x = x & 0x5555555555555555
    x = (x | (x >> 1)) & 0x3333333333333333
    x = (x | (x >> 2)) & 0x0F0F0F0F0F0F0F0F
    x = (x | (x >> 4)) & 0x00FF00FF00FF00FF
    x = (x | (x >> 8)) & 0x0000FFFF0000FFFF
    return (x | (x >> 16)) & 0x00000000FFFFFFFF


def tan_grid(ra0: float, dec0: float, fov: float, w: int, h: int):
    """(ra, dec) in degrees at each pixel centre of a gnomonic image, north up, east left, fov degrees wide."""
    import numpy as np

    s = math.radians(fov / w)
    xi = -(np.arange(w) + 0.5 - w / 2)[None, :] * s * np.ones((h, 1))   # east is left
    eta = -(np.arange(h) + 0.5 - h / 2)[:, None] * s * np.ones((1, w))  # north is up
    d0 = math.radians(dec0)
    den = math.cos(d0) - eta * math.sin(d0)
    ra = math.radians(ra0) + np.arctan2(xi, den)
    dec = np.arctan2(math.sin(d0) + eta * math.cos(d0), np.hypot(xi, den))
    return np.degrees(ra) % 360, np.degrees(dec)


def hips_tile(order: int, npix: int):
    import numpy as np
    from PIL import Image

    cache = TILE_CACHE / f"Norder{order}" / f"Npix{npix}.jpg"
    if not cache.exists():
        url = f"{HIPS_BASE}/Norder{order}/Dir{(npix // 10000) * 10000}/Npix{npix}.jpg"
        body = LIC.fetch(url, tries=4, timeout=90)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(body)
    with Image.open(cache) as im:
        return np.asarray(im.convert("RGB"))


def render_hips(ra0: float, dec0: float, fov: float, w: int, h: int):
    """Nearest-pixel reprojection of the HiPS onto a TAN grid. In this HiPS's jpeg tiles, the pixel of NESTED
    sub-index s (order HIPS_ORDER + 9) sits at column = odd bits of s, row = even bits of s (checked against a
    SkyView DSS2 red plate of the γ Cas field: r = 0.86; the other seven flips/transposes give |r| < 0.2)."""
    import numpy as np
    from astropy import units as u
    from astropy_healpix import lonlat_to_healpix

    ra, dec = tan_grid(ra0, dec0, fov, w, h)
    n = np.asarray(lonlat_to_healpix(ra * u.deg, dec * u.deg, 2 ** (HIPS_ORDER + 9), order="nested"), dtype=np.int64)
    tile, sub = n >> 18, n & 0x3FFFF
    row, col = _compact_bits(sub), _compact_bits(sub >> 1)
    out = np.zeros((h, w, 3), np.uint8)
    tiles = [int(t) for t in np.unique(tile)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        got = dict(zip(tiles, pool.map(lambda t: hips_tile(HIPS_ORDER, t), tiles)))
    for t in tiles:
        m = tile == t
        out[m] = got[t][row[m], col[m]]
    return out, len(tiles)


def run_field_hips(job: dict) -> dict:
    import numpy as np
    from PIL import Image

    raw, n_tiles = render_hips(job["ra"], job["dec"], job["fov"], CARD_W * 2, CARD_H * 2)
    mono = bool(REVIEW.get(job["id"], {}).get("mono"))
    if mono:  # red plate only: the composite's blue is missing in part of this field
        raw = np.repeat(raw[:, :, :1], 3, axis=2)
    x = raw.astype(np.float64) / 255
    lum = x.mean(axis=2)
    if float(np.mean(raw.max(axis=2) == 0)) > 0.2:  # a dark sky is near black, an uncovered area is exactly 0
        raise ValueError("HiPS field has empty areas")
    lo = float(np.percentile(lum, 1))
    hi = max(float(np.percentile(lum, 99.97)), lo + 0.05)
    x = np.arcsinh(HIPS_LIFT * np.clip((x - lo) / (hi - lo), 0, 1)) / math.asinh(HIPS_LIFT)
    img = Image.fromarray((x * 255 + 0.5).astype(np.uint8), "RGB").resize((CARD_W, CARD_H), Image.LANCZOS)
    arr = np.asarray(img).astype(np.float64) / 255
    stats = {"meanLum": round(float(arr.mean()), 4), "stdLum": round(float(arr.mean(axis=2).std()), 4),
             "saturatedFrac": round(float(np.mean(arr.min(axis=2) > 0.98)), 5)}
    if stats["stdLum"] < 0.01:
        raise ValueError("blank field")
    if stats["saturatedFrac"] > 0.08:
        raise ValueError(f"saturated field ({stats['saturatedFrac']:.1%} of pixels white)")
    if job["marks"]:
        add_marks(img, arr.mean(axis=2))
    jpg = None
    for scale in (1.0, 0.9, 0.8):  # dense Milky Way fields: step the size down before the quality floor
        im = img if scale == 1.0 else img.resize((round(CARD_W * scale), round(CARD_H * scale)), Image.LANCZOS)
        for q in (76, 72, 68, 64, 60):
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=q, progressive=True, optimize=True)
            if buf.tell() <= CARD_MAX_BYTES:
                jpg, stats["quality"] = buf.getvalue(), q
                break
        if jpg is not None:
            break
    if jpg is None:
        raise ValueError("cannot reach the card size limit")
    w_out, h_out = im.size
    dest = PUBLIC / job["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(jpg)
    return {"path": job["path"], "source": "hips", "ra": job["ra"], "dec": job["dec"], "fieldDeg": job["fov"],
            "retrieved": today(), "width": w_out, "height": h_out, "bytes": len(jpg),
            "sha256": hashlib.sha256(jpg).hexdigest(), "monochrome": mono, "marks": job["marks"], **stats,
            "hips": {"url": HIPS_BASE, "order": HIPS_ORDER, "tiles": n_tiles, "lift": HIPS_LIFT}}


def run_field(job: dict) -> dict:
    if REVIEW.get(job["id"], {}).get("source") == "skyview":
        return run_field_skyview(job)
    try:
        return run_field_hips(job)
    except Exception as e:  # noqa: BLE001 - fall back to SkyView plates
        print(f"  HiPS failed for {job['id']} ({e}); trying SkyView", file=sys.stderr, flush=True)
        rec = run_field_skyview(job)
        rec["hipsError"] = str(e)[:200]
        return rec


# ───────────────────────────── SkyView (fallback) ─────────────────────────────

DSS1_BANDS = [["DSS1 Red", "DSS"], ["DSS1 Blue"]]
DSS2_BANDS = [["DSS2 Red", "DSS1 Red"], ["DSS2 Blue", "DSS1 Blue"]]


def run_field_skyview(job: dict) -> dict:
    """DSS2 first (finer plates); when the composite shows plate artefacts (labels, holes), try the first-generation
    survey too and keep the cleaner of the two (DSS2 on a tie)."""
    plans = [DSS1_BANDS] if job["fov"] >= WIDE_FOV else [DSS2_BANDS, DSS1_BANDS]
    best = None
    errors = []
    for bands in plans:
        try:
            got = field_attempt(job, bands)
        except ValueError as e:
            errors.append(str(e))
            continue
        if best is None or got[1]["artifactBlocks"] < best[1]["artifactBlocks"]:
            best = got
        if best[1]["artifactBlocks"] == 0:
            break
    if best is None:
        raise ValueError("; ".join(errors))
    jpg, stats, chosen = best
    dest = PUBLIC / job["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(jpg)
    return {"path": job["path"], "source": "skyview", "ra": job["ra"], "dec": job["dec"], "fieldDeg": job["fov"],
            "retrieved": today(), "width": CARD_W, "height": CARD_H, "bytes": len(jpg), "sha256": hashlib.sha256(jpg).hexdigest(),
            "monochrome": chosen[1] is None, "marks": job["marks"], **stats,
            "bands": [{"survey": c[0], "url": c[1], "coverage": round(c[3], 4), "sha256": hashlib.sha256(c[2]).hexdigest()}
                      for c in chosen if c]}


def field_attempt(job: dict, alternatives: list[list[str]]):
    chosen = []
    for alts in alternatives:
        best = None
        for survey in alts:
            url = skyview_url(survey, job["ra"], job["dec"], job["fov"])
            try:
                body = FM.fetch(url, tries=3, timeout=240)
                a = read_fits(body)
            except (RuntimeError, KeyError, ValueError):
                continue
            q = coverage(a)
            if best is None or q > best[3]:
                best = (survey, url, body, q, a)
            if q >= 0.98:
                break
        chosen.append(best if best and best[3] >= 0.9 else None)
    if chosen[0] is None:
        raise ValueError("no survey plate covers this field in the red band")
    jpg, stats = compose(chosen[0][4], chosen[1][4] if chosen[1] else None, job["marks"])
    return jpg, stats, chosen


def field_caption(name: str, kind: str, oid: str, acq: dict) -> str:
    fov = acq.get("fieldDeg", STAR_FOV)
    if kind == "star":
        cap = (f"Survey photo of the binocular field around {name}, {fov:g}° wide; {name} is the star at the centre, "
               f"between the four marks. North up, east left. A long photographic exposure, so it shows more stars "
               f"and colour than binoculars do.")
        if oid in FAST_MOVERS:
            cap += (f" {name} moves fast across the sky, so on this plate, exposed decades ago, it can sit slightly "
                    f"off the marked centre.")
    else:
        cap = (f"Survey photo of the field around {name}, {fov:g}° wide, centered on it. North up, east left. A long "
               f"photographic exposure, so it shows more detail and colour than binoculars do.")
    if acq.get("monochrome"):
        cap += (" Shown in black and white: the survey's colour version lacks the blue plate here."
                if acq.get("source") == "hips" else " Monochrome: only one survey plate covers this field.")
    note = REVIEW.get(oid, {}).get("note")
    if note:
        cap += " " + note
    return cap


# ───────────────────────────── showpiece photographs ─────────────────────────────

def run_photo(sp: dict, refresh: bool) -> dict:
    info = LIC.check_django(sp["site"], sp["id"])
    if info.get("artwork") or info.get("imageType", "").lower() not in ("observation", "photographic"):
        raise LookupError(f"{info['sourcePageUrl']}: type {info.get('imageType')!r} is not an observation")
    pid = info["publisherId"]
    card = PHOTO_DIR / f"{pid}.jpg"
    large = PHOTO_DIR / "large" / f"{pid}.jpg"
    rec = {k: info[k] for k in ("publisher", "publisherId", "sourcePageUrl", "downloadUrl", "title", "credit", "license",
                                "licenseUrl", "termsUrl", "imageType")}
    sw, sh = info.get("pageSize") or (None, None)
    if refresh or not card.exists():
        time.sleep(0.5)
        body, w, h, sw0, sh0 = LIC.encode(LIC.fetch(info["downloadUrl"]))
        card.parent.mkdir(parents=True, exist_ok=True)
        card.write_bytes(body)
        sw, sh = sw or sw0, sh or sh0
    from PIL import Image

    with Image.open(card) as im:
        cw, ch = im.size
    rec.update({"sourceWidth": sw, "sourceHeight": sh, "width": cw, "height": ch, "bytes": card.stat().st_size,
                "sha256": hashlib.sha256(card.read_bytes()).hexdigest(), "retrieved": today()})
    if (refresh or not large.exists()) and sw and sh and max(sw, sh) > max(cw, ch):
        for url in LIC.large_sources(info["downloadUrl"]):
            n = LIC.content_length(url)
            if n is None or n > LIC.LARGE_DOWNLOAD_MAX:
                continue
            body, w, h, _, _ = LIC.encode(LIC.fetch(url, timeout=300), LIC.LARGE_EDGE, LIC.LARGE_MAX_BYTES)
            if max(w, h) > max(cw, ch) * 1.15:
                large.parent.mkdir(parents=True, exist_ok=True)
                large.write_bytes(body)
                rec["largeDownloadUrl"] = url
            break
    return rec


def photo_files_meta(rec: dict) -> dict:
    from PIL import Image

    out = dict(rec)
    large = PHOTO_DIR / "large" / f"{rec['publisherId']}.jpg"
    if large.exists():
        with Image.open(large) as im:
            w, h = im.size
        out.update({"largePath": PHOTO_PREFIX + "large/" + large.name, "largeWidth": w, "largeHeight": h,
                    "largeBytes": large.stat().st_size, "largeSha256": hashlib.sha256(large.read_bytes()).hexdigest()})
    else:
        for k in ("largePath", "largeWidth", "largeHeight", "largeBytes", "largeSha256", "largeDownloadUrl"):
            out.pop(k, None)
    return out


# ───────────────────────────── outputs ─────────────────────────────

def write_credits(photos: dict[str, dict]) -> None:
    FIELD_DIR.mkdir(parents=True, exist_ok=True)
    (FIELD_DIR / "CREDITS.md").write_text("\n".join([
        "# StarHop Sky Journeys binocular-field survey photos",
        "",
        "One survey photo per Sky Journeys object that has no other picture, centered on the object: 4° wide for stars",
        "(about one binocular field), north up, east left, 1200 x 900 pixels, gnomonic (TAN) projection, J2000. Four",
        "short marks around the centre of star fields point at the target; they were added by StarHop. These are",
        "educational illustrations made from long photographic exposures, not simulations of the binocular view.",
        "Their copyrights are separate from StarHop's MIT software license.",
        "",
        "Source: the Digitized Sky Survey 2 colour composite made by CDS (Strasbourg) as a HiPS (\"DSS colored\",",
        "ivo://CDS/P/DSS2/color; red from POSS-II F, AAO-SES, SR and SERC-ER plates, blue from POSS-II J and SERC-J/EJ",
        "plates, green their mean), read from ESA's ESASky mirror (https://skies.esac.esa.int/DSSColor/properties) and",
        "reprojected by StarHop, with a gentle brightness lift. Where the mirror failed, the field is a NASA SkyView",
        "(https://skyview.gsfc.nasa.gov) DSS2 (or DSS1) red + blue cutout composed by StarHop. Centres, field widths,",
        "the source used and SHA-256 hashes are recorded in `script/journeys/generated/media.fill.json` (`fields`) in",
        "the source repository; `script/journeys/fetch_media_fill.py` regenerates them.",
        "",
        "Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS. The Digitized Sky Surveys were produced at the",
        "Space Telescope Science Institute under U.S. Government grant NAG W-2166. The images of these surveys are based",
        "on photographic data obtained using the Oschin Schmidt Telescope on Palomar Mountain and the UK Schmidt",
        "Telescope. The plates were processed into the present compressed digital form with the permission of these",
        "institutions. The Second Palomar Observatory Sky Survey (POSS-II) was made by the California Institute of",
        "Technology with funds from the National Science Foundation, the National Geographic Society, the Sloan",
        "Foundation, the Samuel Oschin Foundation, and the Eastman Kodak Corporation. The UK Schmidt Telescope was",
        "operated by the Royal Observatory Edinburgh, with funding from the UK Science and Engineering Research Council",
        "(later the UK Particle Physics and Astronomy Research Council), until 1988 June, and thereafter by the",
        "Anglo-Australian Observatory. Educational and other noncommercial use is permitted with acknowledgment;",
        "commercial reuse requires permission from the relevant copyright holders.",
        "",
        "Policy and copyright details: https://archive.stsci.edu/publishing/data-use",
        "Survey acknowledgment: https://archive.stsci.edu/dss/acknowledging.html",
        "Copyright notices per plate: https://archive.stsci.edu/dss/copyright.html",
        "",
    ]))
    lines = [
        "# StarHop Sky Journeys showpiece photographs",
        "",
        "Telescope photographs from ESA/Hubble and ESO shown on Sky Journeys stop cards for stars that had no other",
        "picture. They are professional exposures (some in infrared or polarised light), not simulations of the",
        "binocular view. Their copyrights are separate from StarHop's MIT software license.",
        "",
        "Files were downscaled to at most 1200 pixels on the long edge (copies in `large/`, for the tap-to-enlarge view:",
        "at most 2400 pixels) and re-encoded as JPEG; they are otherwise unedited. Source pages, download URLs and",
        "SHA-256 hashes are recorded in `script/journeys/generated/media.fill.json` (`photos`) in the source repository;",
        "`script/journeys/fetch_media_fill.py` regenerates them. The app also shows each credit next to the image.",
        "",
        "- ESO images: Creative Commons Attribution 4.0 International (CC BY 4.0), https://www.eso.org/public/outreach/copyright/",
        "- ESA/Hubble images: CC BY 4.0, https://esahubble.org/copyright/",
        "",
        "CC BY 4.0 legal code: https://creativecommons.org/licenses/by/4.0/",
        "",
        "## Files",
        "",
    ]
    for oid, r in sorted(photos.items(), key=lambda kv: kv[1]["publisherId"]):
        lines += [f"- `{r['publisherId']}.jpg`{' (and `large/' + r['publisherId'] + '.jpg`)' if r.get('largePath') else ''}: "
                  f"{r['title'].rstrip('.')}. Credit: {r['credit'].rstrip('.')}.",
                  f"  {r['publisher']}, {r['license']}. Source: {r['sourcePageUrl']}",
                  f"  Used for: {oid}."]
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    (PHOTO_DIR / "CREDITS.md").write_text("\n".join(lines) + "\n")


def contact_sheets(objects: dict[str, dict], names: dict[str, str], out_dir: Path) -> None:
    from PIL import Image, ImageDraw

    out_dir.mkdir(parents=True, exist_ok=True)
    tiles = [(oid, im["src"]) for oid, v in objects.items() for im in v["images"]]
    tw, th, cols, rows = 256, 192, 5, 4
    for page in range(0, len(tiles), cols * rows):
        sheet = Image.new("RGB", (cols * tw, rows * (th + 16)), (30, 30, 30))
        d = ImageDraw.Draw(sheet)
        for i, (oid, src) in enumerate(tiles[page:page + cols * rows]):
            with Image.open(PUBLIC / src) as im:
                im = im.convert("RGB")
                im.thumbnail((tw, th))
                x, y = (i % cols) * tw, (i // cols) * (th + 16)
                sheet.paste(im, (x + (tw - im.width) // 2, y))
            d.text((x + 3, y + th + 2), f"{oid} {names.get(oid, '')}"[:40], fill=(255, 255, 255))
        sheet.save(out_dir / f"fill-{page // (cols * rows) + 1:03d}.jpg", quality=85)
    print(f"contact sheets in {out_dir}", file=sys.stderr)


def main() -> None:
    args = sys.argv[1:]
    manifest_only = "--manifest-only" in args
    refresh = "--refresh" in args
    only = next((a.split("=", 1)[1].split(",") for a in args if a.startswith("--only=")), None)
    sheet_dir = next((Path(a.split("=", 1)[1]) for a in args if a.startswith("--contact-sheet=")), None)
    global TILE_CACHE
    TILE_CACHE = next((Path(a.split("=", 1)[1]) for a in args if a.startswith("--tile-cache=")), TILE_CACHE)
    ol = json.loads((HERE / "object-list.json").read_text())["objects"]
    extents = json.loads((LIB / "catalog-extents.json").read_text())
    names = load_names()
    covered = covered_ids()
    need = [o for o in ol if o["id"] not in covered]
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    fields: dict[str, dict] = dict(previous.get("fields", {}))
    photos: dict[str, dict] = dict(previous.get("photos", {}))
    failures: list[dict] = []

    jobs = []
    for o in need:
        if REVIEW.get(o["id"], {}).get("reject"):
            continue
        path = f"{FIELD_PREFIX}{o['id']}.jpg"
        jobs.append({"id": o["id"], "path": path, "ra": o["ra"], "dec": o["dec"], "fov": field_fov(o, extents),
                     "marks": o["kind"] == "star"})
    todo = [j for j in jobs if (refresh and (only is None or j["id"] in only)) or not (PUBLIC / j["path"]).exists()
            or j["id"] not in fields]
    if todo and not manifest_only:
        print(f"Rendering {len(todo)} survey fields for {len(need)} objects without images …", file=sys.stderr, flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {pool.submit(run_field, j): j for j in todo}
            for n, fut in enumerate(concurrent.futures.as_completed(futs), 1):
                j = futs[fut]
                try:
                    fields[j["id"]] = fut.result()
                    print(f"  [{n}/{len(todo)}] ok   {j['id']} ({fields[j['id']]['bytes'] // 1024} KB)", file=sys.stderr, flush=True)
                except Exception as e:  # noqa: BLE001 - reported; the manifest is still written
                    failures.append({"id": j["id"], "what": "field", "error": str(e)[:300]})
                    print(f"  [{n}/{len(todo)}] FAIL {j['id']}: {e}", file=sys.stderr, flush=True)

    need_ids = {o["id"] for o in need}
    for oid, sps in SHOWPIECES.items():
        if oid not in need_ids:
            continue
        for sp in sps:
            if manifest_only and oid in photos:
                continue
            if not manifest_only and oid in photos and not refresh and (PHOTO_DIR / f"{sp['id']}.jpg").exists():
                continue
            if manifest_only:
                failures.append({"id": oid, "what": "photo", "error": "not fetched (run without --manifest-only)"})
                continue
            try:
                photos[oid] = run_photo(sp, refresh and (only is None or oid in only))
                print(f"  photo {oid}: {photos[oid]['publisherId']}", file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                failures.append({"id": oid, "what": "photo", "error": str(e)[:300]})
                print(f"  FAIL photo {oid}: {e}", file=sys.stderr)

    # Records only for objects that still need a picture and whose files exist; orphans are removed.
    fields = {k: v for k, v in fields.items() if k in need_ids and (PUBLIC / v["path"]).exists() and not REVIEW.get(k, {}).get("reject")}
    photos = {k: photo_files_meta(v) for k, v in photos.items() if k in need_ids and k in SHOWPIECES
              and (PHOTO_DIR / f"{v['publisherId']}.jpg").exists()}
    keep_fields = {Path(v["path"]).name for v in fields.values()}
    keep_photos = {f"{v['publisherId']}.jpg" for v in photos.values()}
    for f in FIELD_DIR.glob("*.jpg"):
        if f.name not in keep_fields:
            f.unlink()
    for f in [*PHOTO_DIR.glob("*.jpg"), *(PHOTO_DIR / "large").glob("*.jpg")]:
        if f.name not in keep_photos:
            f.unlink()

    objects: dict[str, dict] = {}
    for o in need:
        oid = o["id"]
        name = names.get(oid, o["name"])
        images = []
        field = None
        if oid in fields:
            acq = fields[oid]
            if acq.get("source") == "hips":
                credit, source_url = HIPS_CREDIT, HIPS_SOURCE_PAGE
            else:
                series = {"DSS2" if b["survey"].startswith("DSS2") else "DSS1" for b in acq["bands"]}
                credit = DSS_CREDIT if series == {"DSS2"} else DSS1_CREDIT if series == {"DSS1"} else DSS_CREDIT.replace(
                    "(DSS2)", "(DSS1 and DSS2 plates)").replace("POSS-II / UK Schmidt", "POSS-I, POSS-II and UK Schmidt")
                source_url = acq["bands"][0]["url"]
            field = {"src": acq["path"], "credit": credit, "license": DSS_LICENSE,
                     "caption": field_caption(name, o["kind"], oid, acq),
                     "fieldDeg": acq["fieldDeg"], "variant": "optical", "sourceUrl": source_url}
        photo = None
        if oid in photos:
            r = photos[oid]
            sp = SHOWPIECES[oid][0]
            photo = {"src": PHOTO_PREFIX + r["publisherId"] + ".jpg", "credit": r["credit"],
                     "license": r["license"], "caption": sp["caption"], "variant": "photo",
                     "sourceUrl": r["sourcePageUrl"]}
            if r.get("largePath"):
                photo = {"src": photo["src"], "large": r["largePath"], **{k: v for k, v in photo.items() if k != "src"}}
        if photo and SHOWPIECES[oid][0].get("first"):
            images = [photo] + ([field] if field else [])
        else:
            images = ([field] if field else []) + ([photo] if photo else [])
        if images:
            objects[oid] = {"kind": o["kind"], "images": images}

    write_credits(photos)
    field_bytes = sum(v["bytes"] for v in fields.values())
    photo_bytes = sum(v["bytes"] + v.get("largeBytes", 0) for v in photos.values())
    doc = {
        "version": f"media.fill-{today()}",
        "generatedBy": "script/journeys/fetch_media_fill.py",
        "notes": ("KbImage records for master-list objects that get no image from the curated tier, media.licensed.json "
                  "or media.auto.json. The KB build uses objects[id].images when an object's merged image list is empty. "
                  "fields/: DSS binocular-field survey photos; photos/: licence-checked showpiece photographs "
                  "(large/ holds the tap-to-enlarge copies). Credits: data/journey-images/{fields,photos}/CREDITS.md."),
        "totals": {"needed": len(need), "objects": len(objects), "fields": len(fields), "photos": len(photos),
                   "fieldBytes": field_bytes, "photoBytes": photo_bytes, "failures": len(failures)},
        "objects": objects,
        "fields": dict(sorted(fields.items())),
        "photos": dict(sorted(photos.items())),
        "failures": failures,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(objects)}/{len(need)} objects filled, {len(fields)} fields "
          f"({field_bytes / 1e6:.1f} MB), {len(photos)} photos ({photo_bytes / 1e6:.1f} MB), {len(failures)} failures",
          file=sys.stderr)
    if sheet_dir:
        contact_sheets(objects, names, sheet_dir)


if __name__ == "__main__":
    main()
