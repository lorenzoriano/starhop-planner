#!/usr/bin/env python3
"""Sky Journeys licensed photographs: download, licence-check and re-encode the curated http(s) media images.

Curators (script/journeys/curated/*.json) cite real telescope photographs in `media.images[]` with an http(s) `src`
(ESO, ESA/Hubble, ESA/Webb, NASA). The app is offline-first, so this script turns each one into a bundled file:

1. Collect every curated image whose `src` is an http(s) URL (page or file).
2. Resolve it to the publisher's image page and verify the licence on that page:
     ESO          www.eso.org/public/images/<id>/      CC BY 4.0 ("Usage of ESO Images" terms)
     ESA/Hubble   esahubble.org/images/<id>/           CC BY 4.0 ("Usage of ESA/Hubble Images" terms)
     ESA/Webb     esawebb.org/images/<id>/             CC BY 4.0 ("Usage of ESA/Webb Images" terms)
     NASA         a NASA page whose credit names only NASA missions: public domain, credit requested
   The credit line is taken from the page (it is the line the publisher requires). An image is skipped, and listed
   under `skipped`, when the page cannot be fetched, has no credit line, lacks the publisher's licence link, or carries
   an explicit exception ("all rights reserved", "©", "not released under", ...).
   science.nasa.gov Webb assets are resolved to the identical ESA/Webb release (RESOLVE below), whose CC BY 4.0 terms
   are explicit; NASA's own Webb pages carry no per-image licence statement.
3. Download the publisher's 1280 px "screen" rendition (or the full-size "large" JPEG when the original is smaller),
   convert to sRGB, downscale to <= 1200 px on the long edge (never upscale) and save a progressive, optimised JPEG of
   <= 250 KB under client/public/data/journey-images/licensed/<publisherId>.jpg. One file per source image: objects that
   cite the same photograph share it.
4. Large copy for the tap-to-enlarge view: when the source is bigger than the card copy, download the publisher's
   "publicationjpg" rendition (or the full-size "large" JPEG when that is at most LARGE_DOWNLOAD_MAX bytes) and save a
   progressive JPEG of <= 2400 px / <= 900 KB under client/public/data/journey-images/licensed/large/<publisherId>.jpg.
   The KB build carries it as KbImage.large.
5. Write script/journeys/generated/media.licensed.json (consumed by the KB build) and the folder's CREDITS.md.

    uv run --with pillow python -I script/journeys/fetch_licensed_media.py                 # fetch missing files
    uv run --with pillow python -I script/journeys/fetch_licensed_media.py --refresh       # re-fetch everything
    uv run --with pillow python -I script/journeys/fetch_licensed_media.py --manifest-only # offline: rebuild the
        manifest + CREDITS.md from the previous manifest's page records and the files on disk (picks up caption edits)

media.licensed.json:
    { version, generatedBy, notes, totals: { files, bytes, entries, skipped },
      images:  [ { objectId, imageIndex, originalUrl, sourcePageUrl, downloadUrl, localPath, credit, curatorCredit,
                   license, licenseUrl, termsUrl, caption, variant, fieldDeg?, title, publisher, publisherId,
                   width, height, sourceWidth, sourceHeight, bytes, sha256, retrieved,
                   largePath?, largeWidth?, largeHeight?, largeBytes?, largeSha256?, largeDownloadUrl? } ],
      skipped: [ { objectId, imageIndex, originalUrl, reason } ] }
`localPath` is app-relative like every KbImage.src ("data/journey-images/licensed/eso2109a.jpg"; render as "./" + it).
The KB build replaces the curated http(s) KbImage with { src: localPath, large: largePath, credit, license, caption,
variant, fieldDeg, sourceUrl: sourcePageUrl } and drops images listed under `skipped`.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CURATED = HERE / "curated"
OUT = HERE / "generated" / "media.licensed.json"
IMG_DIR = ROOT / "client" / "public" / "data" / "journey-images" / "licensed"
APP_PREFIX = "data/journey-images/licensed/"
UA = "StarHop Sky Journeys media build (educational, non-commercial)"
LONG_EDGE = 1200
MAX_BYTES = 250_000
LARGE_DIR = IMG_DIR / "large"
LARGE_PREFIX = APP_PREFIX + "large/"
LARGE_EDGE = 2400
LARGE_MAX_BYTES = 900_000
LARGE_DOWNLOAD_MAX = 60_000_000  # never pull the multi-hundred-MB full-size originals

CC_BY = ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/")

# djangoplicity archives (same page layout on all three sites).
DJANGO = {
    "eso": {"name": "ESO", "page": "https://www.eso.org/public/images/{id}/", "terms": "https://www.eso.org/public/outreach/copyright/",
            "termsHref": "/public/outreach/copyright/", "hosts": ("eso.org",)},
    "esahubble": {"name": "ESA/Hubble", "page": "https://esahubble.org/images/{id}/", "terms": "https://esahubble.org/copyright/",
                  "termsHref": "/copyright/", "hosts": ("esahubble.org", "spacetelescope.org")},
    "esawebb": {"name": "ESA/Webb", "page": "https://esawebb.org/images/{id}/", "terms": "https://esawebb.org/copyright/",
                "termsHref": "/copyright/", "hosts": ("esawebb.org",)},
}

# Curated URLs on sites without a per-image licence statement, resolved to an equivalent licensed source.
# Each mapping was checked by hand (title, pixel size, credit): see the comments.
RESOLVE = {
    # NASA asset "Fomalhaut dusty debris disk (MIRI image)", 1092 x 977 = ESA/Webb weic2312a (same size, same credit).
    "https://science.nasa.gov/asset/webb/fomalhaut-dusty-debris-disk-miri-image/": ("esawebb", "weic2312a"),
    # NASA asset "Epsilon Indi Ab exoplanet (MIRI image)" = ESA/Webb weic2421a "Exoplanet Epsilon Indi Ab (MIRI image)".
    "https://science.nasa.gov/asset/webb/epsilon-indi-ab-exoplanet-miri-image/": ("esawebb", "weic2421a"),
}

# NASA-only files: (file URL) -> page to verify on. Public domain under NASA media guidelines when every credit
# component is a NASA mission (Chandra materials: "no claim to copyright is being asserted").
NASA_PAGES = {
    "https://heasarc.gsfc.nasa.gov/Images/objects/heapow/stars/zetaoph_chandra.jpg":
        "https://heasarc.gsfc.nasa.gov/docs/objects/heapow/archive/stars/zetaoph_chandra.html",
}
NASA_LICENSE = ("Public domain (NASA); credit requested", "https://www.nasa.gov/nasa-brand-center/images-and-media/")
NASA_EXTRA_TERMS = {"heasarc.gsfc.nasa.gov": "https://chandra.si.edu/photo/image_use.html"}

# Phrases that mark an image as NOT covered by the site's default licence.
EXCEPTION_RE = re.compile(r"all rights reserved|not released under|not covered by|©|\(c\)\s*\d{4}|copyright\s+(?:by|of|\d{4})"
                          r"|may not be (?:used|reproduced)|used with permission|courtesy of", re.I)


def today() -> str:
    return dt.date.today().isoformat()


def fetch(url: str, tries: int = 3, timeout: int = 90) -> bytes:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - network errors of every kind are retried
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed: {url}: {last}")


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip().replace(" ,", ",")


def credit_of(fragment: str) -> str:
    """Credit HTML -> one line: inline tags (links) vanish, <br>/paragraph breaks become sentence breaks."""
    lines = re.split(r"<br\s*/?>|</p>\s*<p[^>]*>", fragment)
    parts = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", ln))).strip() for ln in lines]
    out = ""
    for part in filter(None, parts):
        out = part if not out else (out + (" " if out[-1] in ".;:," else ". ") + part)
    return out


# ───────────────────────────── collect & resolve ─────────────────────────────

def collect() -> list[dict]:
    out = []
    for f in sorted(CURATED.glob("*.json")):
        data = json.loads(f.read_text())
        for o in data.get("objects", []):
            for i, im in enumerate((o.get("media") or {}).get("images") or []):
                src = im.get("src", "")
                if src.startswith(("http://", "https://")):
                    out.append({"file": f.name, "objectId": o["id"], "imageIndex": i, "src": src, "curated": im})
    return out


def resolve(src: str) -> dict:
    """-> {kind: 'django', site, id} | {kind: 'nasa', page, file} | {kind: 'unknown'}"""
    if src in RESOLVE:
        site, pid = RESOLVE[src]
        return {"kind": "django", "site": site, "id": pid}
    if src in NASA_PAGES:
        return {"kind": "nasa", "page": NASA_PAGES[src], "file": src}
    host = re.sub(r"^https?://([^/]+)/.*$", r"\1", src).lower()
    for site, d in DJANGO.items():
        if any(host == h or host.endswith("." + h) for h in d["hosts"]):
            m = (re.search(r"/images/(?:[a-z0-9]+/)?([A-Za-z0-9_-]+)\.(?:jpe?g|tif|png)$", src)
                 or re.search(r"/images/([A-Za-z0-9_-]+)/?$", src))
            if m:
                return {"kind": "django", "site": site, "id": m.group(1)}
    return {"kind": "unknown"}


def check_django(site: str, pid: str) -> dict:
    d = DJANGO[site]
    page_url = d["page"].format(id=pid)
    page = fetch(page_url).decode("utf-8", "replace")
    title = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    credit = re.search(r"<strong>Credit:</strong>\s*<div class=\"credit\">(.*?)</div>", page, re.S)
    size = (re.search(r"Size:\s*</t[hd]>\s*<td[^>]*>\s*(\d{2,5}) x (\d{2,5})", page)
            or re.search(r"(\d{2,5}) x (\d{2,5}) px", page))
    # "About the Image" Type (Observation / Photographic / Collage / Artwork / Illustration ...), the first Type row.
    itype = re.search(r"Type:\s*</t[hd]>\s*<td[^>]*>\s*([^<]+)", page)
    image_type = itype.group(1).strip() if itype else ""
    if not credit:
        raise LookupError(f"{page_url}: no credit line on the page")
    # The image's usage-terms link follows its credit block ("Usage of ESO Images ...", "Usage of ESA/Hubble/Webb ...").
    terms = re.search(r"<a [^>]*href=\"" + re.escape(d["termsHref"]) + r"\"[^>]*>\s*Usage of", page[credit.end():credit.end() + 3000])
    if not terms:
        raise LookupError(f"{page_url}: the page does not link the {d['name']} usage terms")
    credit_text = credit_of(credit.group(1))
    # Description + credit block: between the title and the end of the credit line.
    body = page[title.end() if title else 0: credit.end()]
    exc = EXCEPTION_RE.search(text_of(body))
    if exc:
        raise LookupError(f"{page_url}: licence exception on the page ({exc.group(0)!r})")
    renditions: dict[str, str] = {}
    for url, kind in re.findall(r"(https?://cdn\.[a-z.]+/(?:archives/)?images/(screen|large)/" + re.escape(pid) + r"\.jpg)", page):
        renditions.setdefault(kind, url.replace("http://", "https://"))
    sw, sh = (int(size.group(1)), int(size.group(2))) if size else (None, None)
    if sw and max(sw, sh) <= 1280 and "large" in renditions:
        download = renditions["large"]
    else:
        download = renditions.get("screen") or renditions.get("large")
    if not download:
        raise LookupError(f"{page_url}: no screen/large JPEG rendition linked")
    return {"publisher": d["name"], "publisherId": pid, "sourcePageUrl": page_url, "downloadUrl": download,
            "title": text_of(title.group(1)) if title else pid, "credit": credit_text,
            "license": CC_BY[0], "licenseUrl": CC_BY[1], "termsUrl": d["terms"], "pageSize": [sw, sh],
            "imageType": image_type, "artwork": bool(re.search(r"artwork|illustration|artist", image_type, re.I))}


def check_nasa(page_url: str, file_url: str) -> dict:
    page = fetch(page_url).decode("utf-8", "replace")
    t = text_of(re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S))
    m = re.search(r"Credit:\s*([^<]+)<", page)
    if not m:
        raise LookupError(f"{page_url}: no credit line on the page")
    credit = credit_of(m.group(1))
    parts = [p.split(":", 1)[-1].strip() for p in credit.split(";")]
    if not all(p.startswith("NASA/") or p == "NASA" for p in parts):
        raise LookupError(f"{page_url}: credit has non-NASA components ({credit}); not clearly public domain")
    if EXCEPTION_RE.search(t):
        raise LookupError(f"{page_url}: licence exception on the page")
    if file_url.rsplit("/", 1)[-1] not in page:
        raise LookupError(f"{page_url}: page does not show {file_url}")
    host = re.sub(r"^https?://([^/]+)/.*$", r"\1", file_url)
    stem = Path(file_url).stem
    return {"publisher": "NASA", "publisherId": f"nasa-{stem}", "sourcePageUrl": page_url, "downloadUrl": file_url,
            "title": stem, "credit": credit, "license": NASA_LICENSE[0], "licenseUrl": NASA_LICENSE[1],
            "termsUrl": NASA_EXTRA_TERMS.get(host, NASA_LICENSE[1]), "pageSize": [None, None],
            "imageType": "Observation", "artwork": False}


# ───────────────────────────── image ─────────────────────────────

def encode(raw: bytes, max_edge: int = LONG_EDGE, max_bytes: int = MAX_BYTES) -> tuple[bytes, int, int, int, int]:
    """Decode, convert to sRGB, downscale to <= max_edge px on the long edge (never upscale) and save a progressive JPEG
    of <= max_bytes. Returns (jpeg, width, height, sourceWidth, sourceHeight)."""
    from PIL import Image, ImageCms  # Pillow via `uv run --with pillow`

    Image.MAX_IMAGE_PIXELS = 400_000_000  # publication renditions of the big mosaics are large but trusted
    im = Image.open(io.BytesIO(raw))
    im.load()
    sw, sh = im.size
    icc = im.info.get("icc_profile")
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            im = ImageCms.profileToProfile(im, src, ImageCms.createProfile("sRGB"), outputMode=im.mode)
        except Exception:  # noqa: BLE001 - a broken profile: keep the pixels as they are
            pass
    long_edge = min(max_edge, max(sw, sh))
    while True:
        scale = long_edge / max(sw, sh)
        w, h = max(1, round(sw * scale)), max(1, round(sh * scale))
        img = im if (w, h) == im.size else im.resize((w, h), Image.LANCZOS)
        for q in (84, 80, 76, 72, 68, 64):
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=q, progressive=True, optimize=True)
            if buf.tell() <= max_bytes:
                return buf.getvalue(), w, h, sw, sh
        long_edge = int(long_edge * 0.9)


def content_length(url: str) -> int | None:
    """HEAD request -> Content-Length, or None when the file is missing / the server does not say."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            n = r.headers.get("Content-Length")
            return int(n) if n else None
    except Exception:  # noqa: BLE001 - 404 and network errors both mean "not usable"
        return None


def large_sources(download_url: str) -> list[str]:
    """Bigger renditions of a djangoplicity image, best first: publicationjpg, then the full-size "large" JPEG."""
    m = re.match(r"^(https://cdn\.[a-z.]+/(?:archives/)?images/)(?:screen|large)/([A-Za-z0-9_-]+)\.jpg$", download_url)
    if not m:
        return []
    return [f"{m.group(1)}publicationjpg/{m.group(2)}.jpg", f"{m.group(1)}large/{m.group(2)}.jpg"]


def make_large(pid: str, download_url: str, card_edge: int, source_edge: int | None) -> dict | None:
    """Write LARGE_DIR/<pid>.jpg when the source is bigger than the card copy. Returns its file record or None."""
    if not source_edge or source_edge <= card_edge:
        return None
    for url in large_sources(download_url):
        n = content_length(url)
        if n is None or n > LARGE_DOWNLOAD_MAX:
            continue
        time.sleep(0.5)
        body, w, h, _, _ = encode(fetch(url, timeout=300), LARGE_EDGE, LARGE_MAX_BYTES)
        if max(w, h) <= card_edge * 1.15:  # not meaningfully bigger than the card copy
            return None
        LARGE_DIR.mkdir(parents=True, exist_ok=True)
        (LARGE_DIR / f"{pid}.jpg").write_bytes(body)
        print(f"  large/{pid}.jpg: {w}x{h}, {len(body) // 1024} KB (from {url.rsplit('/', 2)[-2]})", file=sys.stderr)
        return {"largeDownloadUrl": url}
    return None


def large_meta(pid: str) -> dict | None:
    from PIL import Image

    path = LARGE_DIR / f"{pid}.jpg"
    if not path.exists():
        return None
    body = path.read_bytes()
    with Image.open(io.BytesIO(body)) as im:
        w, h = im.size
    return {"largePath": LARGE_PREFIX + path.name, "largeWidth": w, "largeHeight": h, "largeBytes": len(body),
            "largeSha256": hashlib.sha256(body).hexdigest()}


# ───────────────────────────── outputs ─────────────────────────────

def record(entry: dict, info: dict, file_meta: dict) -> dict:
    c = entry["curated"]
    r = {"objectId": entry["objectId"], "imageIndex": entry["imageIndex"], "originalUrl": entry["src"],
         "sourcePageUrl": info["sourcePageUrl"], "downloadUrl": info["downloadUrl"],
         "localPath": APP_PREFIX + info["publisherId"] + ".jpg",
         "credit": info["credit"], "curatorCredit": c.get("credit", ""),
         "license": info["license"], "licenseUrl": info["licenseUrl"], "termsUrl": info["termsUrl"],
         "caption": c.get("caption", ""), "variant": c.get("variant", "photo")}
    if c.get("fieldDeg") is not None:
        r["fieldDeg"] = c["fieldDeg"]
    r.update({"title": info["title"], "publisher": info["publisher"], "publisherId": info["publisherId"],
              "imageType": info.get("imageType", ""), "artwork": info.get("artwork", False)})
    if r["artwork"] and r["variant"] != "illustration":
        print(f"  NOTE {entry['objectId']}: {info['publisherId']} is {r['imageType']!r} but the curated variant is "
              f"{r['variant']!r} (should be 'illustration')", file=sys.stderr)
    r.update(file_meta)
    return r


def write_credits(images: list[dict], skipped: list[dict]) -> None:
    by_file: dict[str, list[dict]] = {}
    for r in images:
        by_file.setdefault(r["localPath"], []).append(r)
    lines = [
        "# StarHop Sky Journeys licensed photographs",
        "",
        "Telescope photographs from ESO, ESA/Hubble, ESA/Webb and NASA, shown on Sky Journeys stop cards. They are",
        "professional exposures (many in infrared, X-ray or submillimetre light, or false colour), not simulations",
        "of the binocular view. Their copyrights are separate from StarHop's MIT software license.",
        "",
        "Files were downscaled to at most 1200 pixels on the long edge (copies in `large/`, for the tap-to-enlarge view:",
        "at most 2400 pixels) and re-encoded as JPEG; they are otherwise unedited. Source pages, download URLs and",
        "SHA-256 hashes are recorded in",
        "`script/journeys/generated/media.licensed.json` in the source repository;",
        "`script/journeys/fetch_licensed_media.py` regenerates them. The app also shows each credit next to the image.",
        "",
        "- ESO images: Creative Commons Attribution 4.0 International (CC BY 4.0), https://www.eso.org/public/outreach/copyright/",
        "- ESA/Hubble images: CC BY 4.0, https://esahubble.org/copyright/",
        "- ESA/Webb images: CC BY 4.0, https://esawebb.org/copyright/",
        "- NASA images: not subject to copyright in the United States; credit requested,",
        "  https://www.nasa.gov/nasa-brand-center/images-and-media/ (Chandra: https://chandra.si.edu/photo/image_use.html)",
        "",
        "CC BY 4.0 legal code: https://creativecommons.org/licenses/by/4.0/",
        "",
        "## Files",
        "",
    ]
    for path in sorted(by_file):
        rs = by_file[path]
        r = rs[0]
        objs = ", ".join(sorted({x["objectId"] for x in rs}))
        lines += [f"- `{Path(path).name}`{' (and `large/' + Path(path).name + '`)' if r.get('largePath') else ''}: {r['title'].rstrip('.')}. Credit: {r['credit'].rstrip('.')}.",
                  f"  {r['publisher']}, {r['license']}{' (artist' + chr(39) + 's impression)' if r['artwork'] else ''}. Source: {r['sourcePageUrl']}",
                  f"  Used for: {objs}."]
    if skipped:
        lines += ["", "## Not bundled", ""]
        lines += [f"- {s['objectId']}: {s['originalUrl']} ({s['reason']})" for s in skipped]
    (IMG_DIR / "CREDITS.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    args = set(sys.argv[1:])
    refresh, manifest_only = "--refresh" in args, "--manifest-only" in args
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    entries = collect()
    prev = json.loads(OUT.read_text()) if OUT.exists() else {"images": [], "skipped": []}
    prev_by_url = {r["originalUrl"]: r for r in prev.get("images", [])}
    prev_skip = {s["originalUrl"]: s for s in prev.get("skipped", [])}

    infos: dict[str, dict | Exception] = {}
    done: set[str] = set()  # files written in this run (two URLs may resolve to the same photograph)
    for e in entries:
        src = e["src"]
        if src in infos:
            continue
        p = prev_by_url.get(src)
        if manifest_only or (p and not refresh and (ROOT / "client" / "public" / p["localPath"]).exists()):
            if p and (ROOT / "client" / "public" / p["localPath"]).exists():
                infos[src] = {k: p[k] for k in ("publisher", "publisherId", "sourcePageUrl", "downloadUrl", "title",
                                                "credit", "license", "licenseUrl", "termsUrl", "imageType", "artwork")}
                continue
            if manifest_only:
                infos[src] = LookupError(prev_skip.get(src, {}).get("reason", "not fetched (run without --manifest-only)"))
                continue
        res = resolve(src)
        try:
            if res["kind"] == "django":
                info = check_django(res["site"], res["id"])
            elif res["kind"] == "nasa":
                info = check_nasa(res["page"], res["file"])
            else:
                raise LookupError("unrecognised host: no per-image licence statement this script can verify")
            name = info["publisherId"] + ".jpg"
            path = IMG_DIR / name
            if name not in done and (refresh or not path.exists()):
                time.sleep(0.5)
                body, w, h, sw, sh = encode(fetch(info["downloadUrl"]))
                path.write_bytes(body)
                done.add(name)
                print(f"  {name}: {sw}x{sh} -> {w}x{h}, {len(body) // 1024} KB", file=sys.stderr)
            infos[src] = info
        except Exception as ex:  # noqa: BLE001 - every failure is recorded as a skip with its reason
            infos[src] = ex
            print(f"  SKIP {e['objectId']}: {ex}", file=sys.stderr)

    from PIL import Image

    images, skipped, seen_files = [], [], {}
    for e in entries:
        info = infos[e["src"]]
        if isinstance(info, Exception):
            skipped.append({"objectId": e["objectId"], "imageIndex": e["imageIndex"], "originalUrl": e["src"], "reason": str(info)})
            continue
        path = IMG_DIR / (info["publisherId"] + ".jpg")
        if path.name not in seen_files:
            body = path.read_bytes()
            with Image.open(io.BytesIO(body)) as im:
                w, h = im.size
            p = prev_by_url.get(e["src"]) or {}
            seen_files[path.name] = {"width": w, "height": h,
                                     "sourceWidth": p.get("sourceWidth"), "sourceHeight": p.get("sourceHeight"),
                                     "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                                     "retrieved": p.get("retrieved") if p.get("sha256") == hashlib.sha256(body).hexdigest() else today()}
            src_w = p.get("sourceWidth") or (info.get("pageSize") or [None, None])[0]
            src_h = p.get("sourceHeight") or (info.get("pageSize") or [None, None])[1]
            src_edge = max(src_w, src_h) if src_w and src_h else None
            large_url = p.get("largeDownloadUrl")
            if not manifest_only and (refresh or not (LARGE_DIR / path.name).exists()):
                try:
                    got = make_large(info["publisherId"], info["downloadUrl"], max(w, h), src_edge)
                    large_url = got["largeDownloadUrl"] if got else None
                    if not got:
                        (LARGE_DIR / path.name).unlink(missing_ok=True)
                except Exception as ex:  # noqa: BLE001 - the card copy still ships; the lightbox falls back to it
                    print(f"  NOTE large copy of {path.name} failed: {ex}", file=sys.stderr)
            lm = large_meta(info["publisherId"])
            if lm:
                seen_files[path.name].update(lm)
                if large_url:
                    seen_files[path.name]["largeDownloadUrl"] = large_url
        images.append(record(e, info, seen_files[path.name]))

    # Source dimensions: from the page (djangoplicity "Size") or measured at download time and kept across runs.
    for r in images:
        if r.get("sourceWidth") is None:
            pg = infos[r["originalUrl"]].get("pageSize") or [None, None]
            r["sourceWidth"], r["sourceHeight"] = pg
    # Orphans (files no longer referenced) are removed so the folder mirrors the manifest.
    for f in [*IMG_DIR.glob("*.jpg"), *LARGE_DIR.glob("*.jpg")]:
        if f.name not in seen_files or (f.parent == LARGE_DIR and not seen_files[f.name].get("largePath")):
            f.unlink()
            print(f"  removed orphan {f.relative_to(IMG_DIR)}", file=sys.stderr)

    total = sum(v["bytes"] + v.get("largeBytes", 0) for v in seen_files.values())
    out = {
        "version": f"media.licensed-{today()}",
        "generatedBy": "script/journeys/fetch_licensed_media.py",
        "notes": ("Curated http(s) media images resolved to licence-verified, bundled JPEGs (<= 1200 px, <= 250 KB, "
                  "progressive), plus a large copy (<= 2400 px, <= 900 KB) when the source is bigger. localPath and "
                  "largePath are app-relative like KbImage.src. The KB build substitutes each curated "
                  "http(s) KbImage (matched by objectId + imageIndex/originalUrl) with {src: localPath, large: largePath, "
                  "credit, license, caption, variant, fieldDeg, sourceUrl: sourcePageUrl} and drops images listed in `skipped`. "
                  "Credits: data/journey-images/licensed/CREDITS.md."),
        "totals": {"files": len(seen_files), "largeFiles": sum(1 for v in seen_files.values() if v.get("largePath")),
                   "bytes": total, "entries": len(images), "skipped": len(skipped)},
        "images": images,
        "skipped": skipped,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    write_credits(images, skipped)
    print(f"{len(images)} entries, {len(seen_files)} files, {total / 1e6:.2f} MB; {len(skipped)} skipped", file=sys.stderr)


if __name__ == "__main__":
    main()
