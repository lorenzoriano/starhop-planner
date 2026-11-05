#!/usr/bin/env python3
"""Sky Journeys media: survey cutouts for master-list DSOs without bundled images + the media manifest.

1. For every master-list deep-sky object that has no entry in client/src/lib/binocular-media.json (the new
   objects of doc 03 §8.2, and any later addition), fetch survey cutouts from NASA SkyView
   (https://skyview.gsfc.nasa.gov, DSS2 Red + DSS2 Blue, DSS1 for wide fields; 2MASS Ks for fields ≤ 3°), compose them into
   colour JPEGs that match the bundled binocular images (640×480, baseline JPEG, north up, east left) and save
   them under client/public/data/journey-images/:
       <id>-optical.jpg   field sized to the object (doc 03 §8.2 "Image fov")
       <id>-context.jpg   3.7° binocular field, when the object field is smaller than that
       <id>-infrared.jpg  2MASS Ks near-infrared (grayscale), when the field is ≤ 3° (SkyView fails on wider 2MASS mosaics)
   CDS hips2fits (used for the bundled images) times out from the build host, hence SkyView (spec decision 10).
   Bands are fetched as FITS (read with a small stdlib reader) and given a percentile-clipped asinh stretch, which
   avoids amplifying JPEG artifacts. DSS colour is synthesised like the CDS DSS2 colour HiPS: red plate → R, blue
   plate → B, their mean → G. Fields ≥ 5° use the first-generation DSS (seamless mosaics); fields lacking a blue
   plate are rendered monochrome.
2. Write script/journeys/generated/media.auto.json: for every master-list object (stars and DSOs), the
   existing bundled survey cutouts and credited featured photographs (binocular-media.json,
   binocular-featured-images.json) plus the new journey images, as KbImage records with credit and license.

    python3 -I script/journeys/fetch_media.py                  # fetch missing images, write the manifest
    python3 -I script/journeys/fetch_media.py --manifest-only  # offline: manifest from files already on disk
    python3 -I script/journeys/fetch_media.py --refresh        # re-fetch every journey image
    python3 -I script/journeys/fetch_media.py --refresh --only=DN-Pipe,IC2944   # re-fetch some objects

Needs Pillow (as script/download-binocular-media.py does) for compositing and JPEG encoding.
"""
from __future__ import annotations

import array
import concurrent.futures
import datetime as dt
import hashlib
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PUBLIC = ROOT / "client" / "public"
LIB = ROOT / "client" / "src" / "lib"
IMG_DIR = PUBLIC / "data" / "journey-images"
OUT = HERE / "generated" / "media.auto.json"
SKYVIEW = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl"
UA = "StarHop Sky Journeys media build (educational, non-commercial)"
W, H = 640, 480
CONTEXT_FOV = 3.7
IR_MAX_FOV = 3.0
WIDE_FOV = 5.0

# Field widths (degrees) from doc 03 §8.2 "Image fov"; NGC 2438 shares the M46 field in its context view.
FOV = {"Cr69": 4, "NGC1977": 1.5, "NGC2438": 1, "DN-Pipe": 8, "DN-BarnardE": 2, "DN-Coalsack": 7,
       "MWF-CygnusRift": 15, "IC1396": 3, "IC2944": 2}

# Image centres that differ from the master-list position. The Coalsack's SIMBAD/OpenNGC position
# (12h31m19s −63°44′36″) sits at its western edge next to Acrux; the cloud's visual centre is about
# 12h50m −62°30′ (Caldwell 99, 7° × 5°), so its survey field is centred there.
CENTER = {"DN-Coalsack": (192.5, -62.5)}

# Visual review of every composite (2026-11-01). "reject": not published (file removed, not in the manifest);
# "note": appended to the caption.
REVIEW = {
    "data/journey-images/IC1396-infrared.jpg": {"reject": "2MASS atlas-tile background steps dominate the 3° mosaic"},
    "data/journey-images/DN-Coalsack-optical.jpg": {"reject": "the DSS/SERC-J plate seam is more prominent than the low-contrast cloud; use an in-app visual"},
    "data/journey-images/IC1396-optical.jpg": {"note": "Diagonal lines at lower right are plate defects, not objects."},
    "data/journey-images/IC1396-context.jpg": {"note": "Diagonal lines at lower right are plate defects, not objects."},
    "data/journey-images/DN-BarnardE-infrared.jpg": {"note": "Faint rectangular patches are survey tile boundaries."},
    "data/journey-images/IC2944-context.jpg": {"note": "The strip along the top edge is a plate boundary."},
    "data/journey-images/MWF-CygnusRift-optical.jpg": {"note": "A 15° mosaic of several plates: brightness steps and small plate labels are survey artifacts."},
}

CREDIT = {
    "dss-cds": ("Digitized Sky Survey · STScI / Caltech / UKST / AAO; color mosaic by CDS",
                "DSS2: educational non-commercial use with acknowledgment"),
    "2mass-cds": ("2MASS / UMass / IPAC-Caltech / NASA / NSF; color mosaic by CDS", "2MASS: public domain"),
    "dss-skyview": ("Digitized Sky Survey 2 (POSS-II / UK Schmidt) · STScI / Caltech / ROE / AAO; cutout via NASA SkyView; red + blue color composite by StarHop",
                    "DSS2: educational non-commercial use with acknowledgment"),
    "2mass-skyview": ("2MASS / UMass / IPAC-Caltech / NASA / NSF; Ks-band cutout via NASA SkyView",
                      "2MASS: public domain"),
}


def today() -> str:
    return dt.date.today().isoformat()


def skyview_url(survey: str, ra: float, dec: float, fov: float) -> str:
    q = {"Position": f"{ra:.5f},{dec:.5f}", "Survey": survey, "Pixels": f"{W},{H}",
         "Size": f"{fov:g},{fov * H / W:g}", "Projection": "Tan", "Coordinates": "J2000", "Return": "FITS"}
    return SKYVIEW + "?" + urllib.parse.urlencode(q)


def fetch(url: str, tries: int = 4, timeout: int = 300) -> bytes:
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
                body = r.read()
            if not body.startswith(b"SIMPLE  ="):
                raise ValueError("SkyView returned a non-FITS response (service error page)")
            return body
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def read_fits(body: bytes) -> list[float]:
    """Minimal FITS reader (primary HDU, 2-D image). Returns W*H floats, top row first (north up), NaN = blank."""
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
    data_start = ((pos + 2879) // 2880) * 2880
    bitpix, nx, ny = int(header["BITPIX"]), int(header["NAXIS1"]), int(header["NAXIS2"])
    if (nx, ny) != (W, H):
        raise ValueError(f"unexpected cutout size {(nx, ny)}")
    code = {-32: "f", -64: "d", 16: "h", 32: "i", 8: "B"}[bitpix]
    arr = array.array(code)
    arr.frombytes(body[data_start:data_start + nx * ny * arr.itemsize])
    if sys.byteorder == "little" and arr.itemsize > 1:
        arr.byteswap()
    bscale, bzero = float(header.get("BSCALE", 1) or 1), float(header.get("BZERO", 0) or 0)
    rows = [arr[r * nx:(r + 1) * nx] for r in range(ny)][::-1]  # FITS row 1 is the bottom (south)
    return [v * bscale + bzero for row in rows for v in row]


def band_quality(px: list[float]) -> float:
    """Fraction of usable pixels; SkyView fills uncovered sky with NaN or 0."""
    bad = sum(1 for v in px if v != v or v == 0.0)
    return 1 - bad / len(px)


def stretch(px: list[float], kind: str) -> bytes:
    """Percentile-clipped asinh stretch to 8 bits. Plates (DSS, photographic density) get a gentle curve,
    2MASS (linear flux, faint background) a stronger one."""
    good = sorted(v for v in px[::7] if v == v and v != 0.0)
    lo = good[int(len(good) * 0.005)]
    hi = good[min(len(good) - 1, int(len(good) * (0.998 if kind == "dss" else 0.9985)))]
    if hi <= lo:
        hi = lo + 1
    a = 2.0 if kind == "dss" else 25.0
    norm = math.asinh(a)
    out = bytearray(len(px))
    span = hi - lo
    for i, v in enumerate(px):
        if v != v:
            continue
        t = (v - lo) / span
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        out[i] = int(255 * math.asinh(a * t) / norm + 0.5)
    return bytes(out)


def compose(bands: list[list[float] | None], kind: str) -> bytes:
    from PIL import Image, ImageChops, ImageStat
    ims = [None if b is None else Image.frombytes("L", (W, H), stretch(b, kind)) for b in bands]
    if kind == "dss":  # [red, blue]; no usable blue plate -> monochrome from the single plate
        r, b = ims
        if b is None:
            out = Image.merge("RGB", (r, r, r))
        else:
            g = ImageChops.add(r, b, scale=2.0)
            out = Image.merge("RGB", (r, g, b))
    else:  # 2MASS Ks only: per-band tile offsets turn a J/H/Ks colour composite into a patchwork
        out = Image.merge("RGB", (ims[0], ims[0], ims[0]))
    if max(ImageStat.Stat(out).stddev) < 1:
        raise ValueError("blank cutout")
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=82, optimize=True)
    return buf.getvalue()


def plan_for(o: dict, extents: dict) -> list[dict]:
    fov = FOV.get(o["id"])
    if fov is None:
        e = extents.get(o["id"], {}).get("majorArcmin") or 30
        fov = max(0.6, min(7, round(e / 60 * 2, 2)))
    # Each band lists survey alternatives in order of preference. DSS2 has finer plates, but SkyView mosaics of
    # many DSS2 plates show strong seams beyond ~5°, so wide fields use the first-generation survey (DSS1 =
    # POSS-I E/O; "DSS" = POSS-I E in the north + SERC-J in the south), whose larger plates mosaic cleanly.
    if fov >= WIDE_FOV:
        dss = [["DSS1 Red", "DSS"], ["DSS1 Blue"]]
    else:
        dss = [["DSS2 Red", "DSS1 Red"], ["DSS2 Blue", "DSS1 Blue"]]
    jobs = [{"variant": "optical", "suffix": "optical", "fov": fov, "kind": "dss", "surveys": dss}]
    if fov < CONTEXT_FOV:
        jobs.append({"variant": "optical", "suffix": "context", "fov": CONTEXT_FOV, "kind": "dss",
                     "surveys": [["DSS2 Red", "DSS1 Red"], ["DSS2 Blue", "DSS1 Blue"]]})
    if fov <= IR_MAX_FOV:
        jobs.append({"variant": "infrared", "suffix": "infrared", "fov": fov, "kind": "2mass",
                     "surveys": [["2MASS-K"]]})
    ra, dec = CENTER.get(o["id"], (o["ra"], o["dec"]))
    for j in jobs:
        j.update({"id": o["id"], "ra": ra, "dec": dec, "path": f"data/journey-images/{o['id']}-{j['suffix']}.jpg"})
    return [j for j in jobs if not REVIEW.get(j["path"], {}).get("reject")]


def run_job(job: dict) -> dict:
    chosen: list[tuple[str, str, bytes, list[float]] | None] = []
    for alternatives in job["surveys"]:
        best = None
        for survey in alternatives:
            url = skyview_url(survey, job["ra"], job["dec"], job["fov"])
            try:
                body = fetch(url, tries=2 if job["kind"] == "2mass" else 3, timeout=240)
            except RuntimeError:
                if job["kind"] == "2mass":
                    raise
                continue
            try:
                px = read_fits(body)
            except (KeyError, ValueError):  # header-only FITS: the survey has no plate here
                continue
            q = band_quality(px)
            if best is None or q > best[4]:
                best = (survey, url, body, px, q)
            if q >= 0.98:
                break
        chosen.append(best[:4] if best and best[4] >= 0.9 else None)
    if chosen[0] is None:
        raise ValueError("no survey plate covers this field in the primary band")
    if job["kind"] == "2mass" and any(c is None for c in chosen):
        raise ValueError("incomplete 2MASS coverage")
    jpg = compose([c[3] if c else None for c in chosen], job["kind"])
    dest = PUBLIC / job["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(jpg)
    return {"path": job["path"], "ra": job["ra"], "dec": job["dec"], "fieldDeg": job["fov"], "retrieved": today(),
            "bytes": len(jpg), "sha256": hashlib.sha256(jpg).hexdigest(),
            "monochrome": job["kind"] == "dss" and chosen[1] is None,
            "bands": [{"survey": c[0], "url": c[1], "sha256": hashlib.sha256(c[2]).hexdigest()} for c in chosen if c]}


def caption(variant: str, fov: float, context: bool = False, survey: str = "DSS2") -> str:
    if variant == "infrared" and survey == "2MASS-JHK":
        return f"Near-infrared survey image (2MASS J/H/Ks in false color), {round(fov, 2):g}° wide; north up, east left. Dust that blocks visible light becomes partly transparent; the colors are not what the eye sees."
    if variant == "infrared":
        return f"Near-infrared survey image (2MASS Ks band, 2.2 µm, grayscale), {round(fov, 2):g}° wide; north up, east left. Dust that blocks visible light becomes partly transparent at this wavelength."
    if context:
        return f"A {round(fov, 2):g}° survey field, about one binocular view, centered on the object; north up, east left."
    return f"Optical survey photograph ({survey}), {round(fov, 2):g}° wide; north up, east left. A long telescope exposure: binoculars show less detail and little color."


def main() -> None:
    manifest_only = "--manifest-only" in sys.argv
    refresh = "--refresh" in sys.argv
    ol = json.loads((HERE / "object-list.json").read_text())
    media = json.loads((LIB / "binocular-media.json").read_text())
    featured = json.loads((LIB / "binocular-featured-images.json").read_text())
    extents = json.loads((LIB / "catalog-extents.json").read_text())
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    acquisitions: dict[str, dict] = dict(previous.get("acquisitions", {}))
    failures: list[dict] = []

    only = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")), None)
    need = [o for o in ol["objects"] if o["kind"] == "dso" and o["id"] not in media]
    jobs = [j for o in need for j in plan_for(o, extents)]
    todo = [j for j in jobs if (refresh and (only is None or j["id"] in only)) or not (PUBLIC / j["path"]).exists()]
    for path, r in REVIEW.items():  # rejected images are never published
        if r.get("reject"):
            (PUBLIC / path).unlink(missing_ok=True)
            acquisitions.pop(path, None)
    if todo and not manifest_only:
        print(f"Fetching {len(todo)} SkyView composites for {len(need)} objects …", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futs = {pool.submit(run_job, j): j for j in todo}
            for fut in concurrent.futures.as_completed(futs):
                j = futs[fut]
                try:
                    rec = fut.result()
                    acquisitions[j["path"]] = rec
                    print(f"  ok   {j['path']} ({rec['bytes'] // 1024} KB)", flush=True)
                except Exception as e:  # noqa: BLE001 - reported, manifest still written
                    failures.append({"path": j["path"], "error": str(e)[:300]})
                    print(f"  FAIL {j['path']}: {e}", flush=True)

    objects: dict[str, dict] = {}
    for o in ol["objects"]:
        oid, images = o["id"], []
        m, f = media.get(oid), featured.get(oid)
        feat = None
        if f:
            feat = {"src": f["path"], "credit": f["credit"], "license": f"{f['licenseName']} ({f['licenseUrl']})",
                    "caption": f["note"], "variant": "featured", "sourceUrl": f["source"]}
        if feat and f.get("useAsPrimary"):
            images.append(feat)
        if m:
            for im in m["images"]:
                if im.get("display") is False or not (PUBLIC / im["path"]).exists():
                    continue
                cred, lic = CREDIT["dss-cds" if im["variant"] == "optical" else "2mass-cds"]
                images.append({"src": im["path"], "credit": cred, "license": lic, "caption": caption(im["variant"], m["fov"], survey="2MASS-JHK" if im["variant"] == "infrared" else "DSS2"),
                               "fieldDeg": m["fov"], "variant": im["variant"], "sourceUrl": im["url"]})
        if feat and not f.get("useAsPrimary"):
            images.append(feat)
        if oid not in media and o["kind"] == "dso":
            for j in plan_for(o, extents):
                if not (PUBLIC / j["path"]).exists():
                    continue
                acq = acquisitions.get(j["path"], {})
                cred, lic = CREDIT["dss-skyview" if j["kind"] == "dss" else "2mass-skyview"]
                series = {"DSS2" if b["survey"].startswith("DSS2") else "DSS1" for b in acq.get("bands", []) if b["survey"].startswith("DSS")}
                if series == {"DSS1"}:
                    cred = cred.replace("Digitized Sky Survey 2 (POSS-II / UK Schmidt)", "Digitized Sky Survey 1 (POSS-I / UK Schmidt SERC)")
                elif series == {"DSS1", "DSS2"}:
                    cred = cred.replace("Digitized Sky Survey 2 (POSS-II / UK Schmidt)", "Digitized Sky Survey (DSS1 and DSS2 plates)")
                cred = cred.replace("red + blue color composite", "monochrome rendering" if acq.get("monochrome") else "red + blue color composite")
                cap = caption(j["variant"], j["fov"], j["suffix"] == "context", "DSS" if series == {"DSS1"} else "DSS2")
                if acq.get("monochrome"):
                    cap += " Monochrome: only one survey plate covers this field."
                if REVIEW.get(j["path"], {}).get("note"):
                    cap += " " + REVIEW[j["path"]]["note"]
                img = {"src": j["path"], "credit": cred, "license": lic, "caption": cap,
                       "fieldDeg": j["fov"], "variant": j["variant"]}
                if acq.get("bands"):
                    img["sourceUrl"] = acq["bands"][0]["url"]
                images.append(img)
        if images:
            objects[oid] = {"kind": o["kind"], "existing": bool(o.get("existing")), "images": images}

    doc = {
        "version": f"media.auto-{today()}",
        "generatedBy": "script/journeys/fetch_media.py",
        "notes": "KbImage records per master-list object. Bundled survey cutouts and featured photographs are referenced in place; "
                 "journey-images/ holds SkyView composites for objects without bundled images (credits: data/journey-images/CREDITS.md).",
        "objects": objects,
        "acquisitions": dict(sorted(acquisitions.items())),
        "failures": failures,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    n_img = sum(len(v["images"]) for v in objects.values())
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(objects)} objects with {n_img} images; "
          f"{len(need)} objects needed new cutouts, {len(failures)} failures.")


if __name__ == "__main__":
    main()
