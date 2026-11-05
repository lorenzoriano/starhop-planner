#!/usr/bin/env python3
"""Build script/journeys/generated/dso.auto.json: the AUTO tier of the Sky Journeys deep-sky KB.

Binding spec: docs/sky-journeys/00-spec.md. Rules: docs/sky-journeys/03-astronomy-deep-sky.md
(§2.1 taxonomy, §3.3 view grades, §4.1 seed classes, §4.2 sources, §4.3 field precedence, §5.4 QA rules).
Output format: script/journeys/README.md ("Auto tier"). Every number is a FactValue with a sourceId and
method "catalog" (or "derived" for computed values such as sizeLy).

Sources (all reachable from the build host on 2026-11-01; CDS Strasbourg is NOT, so mirrors are used):
  open clusters  Hunt & Reffert 2024 (J/A+A/686/A42, includes the HR23 columns) via the IDIA VizieR mirror,
                 cross-checked against Cantat-Gaudin et al. 2020 (J/A+A/640/A1) on the same mirror
  globulars      Baumgardt combined table v4 (distances: Baumgardt & Vasiliev 2021; masses: Baumgardt & Hilker 2018)
                 + Harris 1996 (2010 edition) for [Fe/H]
  galaxies       NED-D (redshift-independent distances), median of Cepheid + TRGB rows when available
  PNe            Gaia-based central-star distances listed by SIMBAD mesDistance (González-Santamaría+2021 first)
  everything     SIMBAD TAP (Harvard mirror) for main ids, positions, radial velocities, published distances;
                 OpenNGC (pinned be3cd6c) for identifiers, Hubble types, surface brightness and extents of new objects;
                 client/src/lib/catalog-extents.json for the observing extents of existing targets

Crossmatch rules (doc 03 §5.4): an HR24 row is accepted only when (1) its name list contains the object's
catalog name, (2) Type == 'o' (NGC 6618 in HR24 is a 390 Myr moving group, not the M17 cluster), (3) its densest
point lies within the object's field and (4) its distance agrees within 25 % with an independent value
(Cantat-Gaudin 2020, else SIMBAD's published distances). Anything that fails lands in the top-level "qa" list
as "curated-required" instead of in the facts.

Raw responses are cached under script/journeys/cache/dso/ (MANIFEST.json records URL, date and SHA-256) and
committed, so the default run is offline:

    python3 -I script/journeys/build_dso_auto.py                  # offline, from the cache
    python3 -I script/journeys/build_dso_auto.py --fetch-missing  # fetch only what the cache lacks
    python3 -I script/journeys/build_dso_auto.py --refresh        # re-fetch everything

Media: images come from script/journeys/generated/media.auto.json (written by fetch_media.py; run it first).

Stdlib only.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import hashlib
import html
import io
import json
import math
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "client" / "public" / "data"
LIB = ROOT / "client" / "src" / "lib"
CACHE = HERE / "cache" / "dso"
MANIFEST = CACHE / "MANIFEST.json"
OBJECT_LIST = HERE / "object-list.json"
MEDIA = HERE / "generated" / "media.auto.json"
OUT = HERE / "generated" / "dso.auto.json"

LY_PER_PC = 3.261563777
UA = "StarHop Sky Journeys KB build (educational, non-commercial; https://github.com/)"

VIZIER = "https://vizier.idia.ac.za/viz-bin/asu-tsv"
SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync"
NED_D = "https://ned.ipac.caltech.edu/cgi-bin/nDistance"
OPENNGC_COMMIT = "be3cd6c5498806a2fbb2f7e0452ef802dbb02be0"
OPENNGC_NGC = f"https://raw.githubusercontent.com/mattiaverga/OpenNGC/{OPENNGC_COMMIT}/database_files/NGC.csv"
OPENNGC_ADD = f"https://raw.githubusercontent.com/mattiaverga/OpenNGC/{OPENNGC_COMMIT}/database_files/addendum.csv"
OPENNGC_NGC_SHA = "54abea0b57b0a103831bfc7a8e3a99a23acfbf4bb581fcf3d8af539cbb826c84"
HARRIS = "https://physics.mcmaster.ca/~harris/mwgc.dat"
BAUMGARDT = "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/combined_table.txt"

HR24_COLS = ("Name,ID,AllNames,Type,CST,N,RA_ICRS,DE_ICRS,r50,rt,r50pc,Plx,e_Plx,dist16,dist50,dist84,"
             "RV,e_RV,n_RV,CMDCl50,logAge16,logAge50,logAge84,AV50,rJpc,NJ,MassJ,e_MassJ,MassTot,e_MassTot,Note")
CG20_COLS = "Cluster,RA_ICRS,DE_ICRS,r50,nbstars07,plx,e_plx,AgeNN,AVNN,DistPc"
HR_BIBCODES = {"2023A&A...673A.114H", "2024A&A...686A..42H"}

# ───────────────────────────── sources (ids shared with the fixture KB are copied verbatim) ─────────────────────────────

SOURCES: dict[str, dict] = {
    "simbad": {"id": "simbad", "title": "SIMBAD astronomical database (Harvard mirror)", "url": "https://simbad.harvard.edu/simbad/", "publisher": "CDS Strasbourg", "kind": "catalog", "citation": "Wenger et al. 2000, A&AS 143, 9", "retrieved": "2026-11-01"},
    "hr24": {"id": "hr24", "title": "Improving the open cluster census. III. Using cluster masses, radii, and dynamics", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=J/A%2BA/686/A42", "publisher": "Astronomy & Astrophysics / VizieR (IDIA mirror)", "kind": "catalog", "citation": "Hunt & Reffert 2024, A&A 686, A42", "bibcode": "2024A&A...686A..42H", "license": "CDS terms; cite the paper", "retrieved": "2026-11-01"},
    "openngc": {"id": "openngc", "title": "OpenNGC (pinned be3cd6c) via catalog-extents.json", "url": "https://github.com/mattiaverga/OpenNGC", "publisher": "Mattia Verga", "kind": "catalog", "license": "CC BY-SA 4.0"},
    "catalog-extents": {"id": "catalog-extents", "title": "StarHop catalog-extents.json (observing extents)", "url": "https://github.com/mattiaverga/OpenNGC", "publisher": "StarHop Planner", "kind": "catalog", "citation": "client/src/lib/catalog-extents.json (OpenNGC where available, otherwise included observing extents)"},
    "cg2020": {"id": "cg2020", "title": "Painting a portrait of the Galactic disc with its stellar clusters", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=J/A%2BA/640/A1", "publisher": "Astronomy & Astrophysics / VizieR (IDIA mirror)", "kind": "catalog", "citation": "Cantat-Gaudin et al. 2020, A&A 640, A1", "bibcode": "2020A&A...640A...1C", "license": "CDS terms; cite the paper", "retrieved": "2026-11-01"},
    "bv21": {"id": "bv21", "title": "Accurate distances to Galactic globular clusters through a combination of Gaia EDR3, HST and literature data", "url": "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/", "publisher": "Monthly Notices of the RAS / H. Baumgardt (combined table, version 4, March 2023)", "kind": "catalog", "citation": "Baumgardt & Vasiliev 2021, MNRAS 505, 5957", "bibcode": "2021MNRAS.505.5957B", "retrieved": "2026-11-01"},
    "bh18": {"id": "bh18", "title": "Mean proper motions, space orbits, and velocity dispersion profiles of Galactic globular clusters derived from Gaia DR2 data (N-body fits; masses in the Baumgardt combined table v4)", "url": "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/", "publisher": "Monthly Notices of the RAS / H. Baumgardt", "kind": "catalog", "citation": "Baumgardt & Hilker 2018, MNRAS 478, 1520 (masses from N-body fits; Baumgardt 2017, MNRAS 464, 2174)", "bibcode": "2018MNRAS.478.1520B", "retrieved": "2026-11-01"},
    "harris2010": {"id": "harris2010", "title": "Catalog of Parameters for Milky Way Globular Clusters (2010 edition)", "url": "https://physics.mcmaster.ca/~harris/mwgc.dat", "publisher": "W. E. Harris, McMaster University", "kind": "catalog", "citation": "Harris 1996, AJ 112, 1487 (2010 edition, arXiv:1012.3224)", "bibcode": "1996AJ....112.1487H", "license": "Free to use; cite and refer to the source", "retrieved": "2026-11-01"},
    "ned-d": {"id": "ned-d", "title": "NED-D: redshift-independent distances in the NASA/IPAC Extragalactic Database", "url": "https://ned.ipac.caltech.edu/Library/Distances/", "publisher": "NASA/IPAC Extragalactic Database (NED)", "kind": "catalog", "citation": "Steer et al. 2017, AJ 153, 37", "bibcode": "2017AJ....153...37S", "license": "NED acknowledgment requested", "retrieved": "2026-11-01"},
    "gonzalez2021": {"id": "gonzalez2021", "title": "Planetary nebulae with Gaia EDR3 central stars: distances", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=J/A%2BA/656/A51", "publisher": "Astronomy & Astrophysics (via SIMBAD mesDistance)", "kind": "paper", "citation": "González-Santamaría et al. 2021, A&A 656, A51", "bibcode": "2021A&A...656A..51G", "retrieved": "2026-11-01"},
    "gaia-edr3": {"id": "gaia-edr3", "title": "Gaia Early Data Release 3 (catalogue I/350; distance = 1/parallax as listed by SIMBAD)", "url": "https://www.cosmos.esa.int/web/gaia/earlydr3", "publisher": "ESA / Gaia DPAC (via SIMBAD mesDistance)", "kind": "catalog", "citation": "Gaia Collaboration, Brown et al. 2021, A&A 649, A1", "bibcode": "2021A&A...649A...1G", "license": "ESA Gaia data: free use with acknowledgment", "retrieved": "2026-11-01"},
    "gaia-dr2": {"id": "gaia-dr2", "title": "Gaia Data Release 2 (catalogue I/345; distance = 1/parallax as listed by SIMBAD)", "url": "https://www.cosmos.esa.int/web/gaia/dr2", "publisher": "ESA / Gaia DPAC (via SIMBAD mesDistance)", "kind": "catalog", "citation": "Gaia Collaboration, Brown et al. 2018, A&A 616, A1", "bibcode": "2018A&A...616A...1G", "license": "ESA Gaia data: free use with acknowledgment", "retrieved": "2026-11-01"},
    "bailerjones2021": {"id": "bailerjones2021", "title": "Estimating distances from parallaxes. V. Geometric and photogeometric distances to 1.47 billion stars in Gaia EDR3", "url": "https://ui.adsabs.harvard.edu/abs/2021AJ....161..147B/abstract", "publisher": "The Astronomical Journal (via SIMBAD mesDistance)", "kind": "catalog", "citation": "Bailer-Jones et al. 2021, AJ 161, 147", "bibcode": "2021AJ....161..147B", "retrieved": "2026-11-01"},
}

# PN distance preference (Gaia central star), doc 03 §4.3. SIMBAD lists the Gaia catalogues themselves
# (I/350 = EDR3, I/345 = DR2) as 1/parallax distances; the dedicated PN papers come first when present.
PN_BIBCODES = [("2021A&A...656A..51G", "gonzalez2021"), ("2021AJ....161..147B", "bailerjones2021"),
               ("2020yCat.1350....0G", "gaia-edr3"), ("2018yCat.1345....0G", "gaia-dr2")]

# ───────────────────────────── seed taxonomy (doc 03 §2.1, §4.1, §8.2) ─────────────────────────────

CLASS_OVERRIDES = {
    "M16": "hii-region", "M78": "reflection-nebula", "M24": "star-cloud", "NGC6888": "wind-bubble",
    "NGC6530": "embedded-cluster", "NGC2264": "embedded-cluster",
    "AST-Hyades": "open-cluster", "AST-OrionBelt": "ob-association",
    "M32": "galaxy-dwarf-elliptical", "LMC": "galaxy-irregular", "SMC": "galaxy-irregular",
    "NGC5128": "galaxy-elliptical", "M82": "galaxy-irregular",
    # new objects (doc 03 §8.2)
    "Cr69": "open-cluster", "NGC1977": "reflection-nebula", "NGC2438": "planetary-nebula",
    "DN-Pipe": "dark-nebula", "DN-BarnardE": "dark-nebula", "DN-Coalsack": "dark-nebula",
    "MWF-CygnusRift": "milky-way-field", "IC1396": "hii-region", "IC2944": "hii-region",
}
SECONDARY = {"M8": ["embedded-cluster"], "M16": ["embedded-cluster"], "M42": ["embedded-cluster"],
             "IC1396": ["embedded-cluster"], "IC2944": ["embedded-cluster"]}
TRAITS = {"M82": ["starburst", "interacting"], "M81": ["interacting"], "M104": ["edge-on"], "M32": ["satellite"],
          "NGC5128": ["active-nucleus"], "M54": ["former-dwarf-nucleus"], "NGC5139": ["former-dwarf-nucleus"],
          "Mel111": ["dissolving"], "M1": ["pulsar", "historical-supernova"]}
CAT_CLASS = {"OC": "open-cluster", "M-OC": "open-cluster", "GC": "globular-cluster", "M-GC": "globular-cluster",
             "M-DN": "hii-region", "EN": "hii-region", "PN": "planetary-nebula", "M-PN": "planetary-nebula",
             "SNR": "supernova-remnant", "M-SN": "supernova-remnant", "M-SG": "galaxy-spiral",
             "M-EG": "galaxy-elliptical", "M-LG": "galaxy-lenticular", "M-IG": "galaxy-irregular",
             "AST": "asterism", "M-MW": "star-cloud", "GAL": "galaxy-spiral"}
CLUSTERLIKE = {"open-cluster", "embedded-cluster", "ob-association", "moving-group"}
NEBULA = {"hii-region", "reflection-nebula", "nebula-complex"}
GALAXY = {"galaxy-spiral", "galaxy-barred-spiral", "galaxy-lenticular", "galaxy-elliptical",
          "galaxy-dwarf-elliptical", "galaxy-irregular"}
DIFFUSE = NEBULA | GALAXY | {"planetary-nebula", "supernova-remnant", "wind-bubble"}

# Nebulae inherit the distance (and, with a sanity check, the age) of their ionizing / embedded cluster
# (doc 03 D6, §4.3). Value = HR24 name of that cluster. M17 -> NGC_6618 is the documented trap (§5.4.2).
EMBEDDED = {"M8": "NGC_6530", "M16": "NGC_6611", "M17": "NGC_6618", "NGC2237": "NGC_2244",
            "NGC3372": "Trumpler_16", "IC1396": "Trumpler_37", "IC2944": "IC_2944"}

# Guide level seeds for objects outside the binocular guide (promoted, doc 03 §8.1; new, §8.2).
# Levels follow the guide's vocabulary; they only seed `view` (basis "derived") and must be reviewed.
SEED_LEVEL = {"M43": "dark", "NGC884": "easy", "NGC2158": "challenge", "NGC6530": "easy", "NGC6960": "challenge",
              "NGC6992": "challenge", "NGC7293": "challenge", "NGC2362": "easy", "NGC2237": "challenge",
              "NGC6871": "easy", "NGC6888": "large", "M57": "large", "Cr69": "easy", "NGC1977": "challenge",
              "NGC2438": "large", "DN-Pipe": "dark", "DN-BarnardE": "challenge", "DN-Coalsack": "easy",
              "MWF-CygnusRift": "dark", "IC1396": "dark", "IC2944": "dark"}
LEVEL_GRADES = {"easy": (3, 4), "steady": (2, 3), "dark": (1, 3), "challenge": (0, 2), "large": (0, 1)}


# ───────────────────────────── small helpers ─────────────────────────────

def today() -> str:
    return dt.date.today().isoformat()


def sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r = math.radians
    c = (math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2)))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def num(x) -> float | None:
    if x is None:
        return None
    s = str(x).strip()
    if not s or s.lower() in ("nan", "null", "none"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def sig(x: float, n: int = 3) -> float:
    if x == 0:
        return 0.0
    d = n - int(math.floor(math.log10(abs(x)))) - 1
    v = round(x, d)
    return float(int(v)) if d <= 0 else v


def fact(value: float, unit: str, source: str, method: str = "catalog", lo: float | None = None,
         hi: float | None = None, note: str | None = None, n: int = 3) -> dict:
    f = {"value": sig(value, n), "unit": unit, "sourceId": source, "method": method}
    if lo is not None and hi is not None:
        lo, hi = sorted((lo, hi))
        lo, hi = sig(lo, n), sig(hi, n)
        if lo <= f["value"] <= hi and lo < hi:
            f["min"], f["max"] = lo, hi
    if note:
        f["note"] = note
    return f


def ident_norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())


def key_norm(s: str) -> str:
    """'NGC 0869' / 'NGC869' / 'Mel 025' -> 'NGC869' / 'MEL25' (prefix upper, number without zeros)."""
    m = re.fullmatch(r"([A-Za-z]+)\s*0*(\d+)([A-Za-z]?)", s.strip())
    return f"{m[1].upper()}{m[2]}{m[3].upper()}" if m else re.sub(r"\s+", "", s).upper()


# ───────────────────────────── cache + network ─────────────────────────────

class Cache:
    def __init__(self, mode: str):
        self.mode = mode  # offline | missing | refresh
        self.manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
        self.missing: list[str] = []
        self.fetched = 0

    def path(self, rel: str) -> Path:
        return CACHE / rel

    def want(self, rel: str) -> bool:
        """True if this run should (re)fetch rel."""
        return self.mode == "refresh" or (self.mode == "missing" and not self.path(rel).exists())

    def get(self, rel: str, url: str, data: bytes | None = None, note: str | None = None,
            gz: bool = False) -> bytes | None:
        p = self.path(rel)
        if self.want(rel):
            body = http(url, data)
            self.store(rel, body, url, note, gz=gz, post=data)
        if not p.exists():
            self.missing.append(rel)
            return None
        raw = p.read_bytes()
        return gzip.decompress(raw) if gz else raw

    def store(self, rel: str, body: bytes, url: str, note: str | None = None, gz: bool = False,
              post: bytes | None = None, extra: dict | None = None) -> None:
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(gzip.compress(body, mtime=0) if gz else body)
        entry = {"url": url, "retrieved": today(), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
        if post:
            entry["post"] = post.decode("utf-8", "replace")
        if gz:
            entry["gzip"] = True
        if note:
            entry["note"] = note
        if extra:
            entry.update(extra)
        self.manifest[rel] = entry
        self.fetched += 1

    def save_manifest(self) -> None:
        if self.fetched:
            MANIFEST.parent.mkdir(parents=True, exist_ok=True)
            MANIFEST.write_text(json.dumps(dict(sorted(self.manifest.items())), indent=1, ensure_ascii=False) + "\n")


def http(url: str, data: bytes | None = None, timeout: int = 120, tries: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            time.sleep(0.3)  # be gentle with the mirrors
            return body
        except Exception as e:  # noqa: BLE001 - retried, then re-raised
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed after {tries} tries: {url}: {last}")


def vizier_cone(source: str, cols: str, ra: float, dec: float, radius_arcmin: float) -> str:
    q = {"-source": source, "-out": cols, "-out.add": "_r", "-c": f"{ra:.5f} {dec:+.5f}",
         "-c.rm": f"{radius_arcmin:.1f}", "-out.max": "500", "-sort": "_r"}
    return VIZIER + "?" + urllib.parse.urlencode(q)


def parse_tsv(text: str) -> list[dict]:
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    if len(lines) < 3:
        return []
    head = [h.strip() for h in lines[0].split("\t")]
    rows = []
    for ln in lines[3:]:  # header, units, dashes
        cells = ln.split("\t")
        if len(cells) < len(head):
            continue
        rows.append({h: c.strip() for h, c in zip(head, cells)})
    return rows


def simbad_tap(query: str) -> tuple[str, bytes]:
    data = urllib.parse.urlencode({"request": "doQuery", "lang": "adql", "format": "csv", "query": query}).encode()
    return SIMBAD_TAP, data


# ───────────────────────────── identifiers per object ─────────────────────────────

def messier_ngc(oid: str, messier: dict) -> str | None:
    r = messier.get(oid)
    if not r:
        return None
    n = str(r.get("NGC") or "").strip()
    if re.fullmatch(r"\d+", n):
        return f"NGC{n}"
    if re.fullmatch(r"IC\s*\d+", n):
        return n.replace(" ", "")
    return None


def catalog_name(oid: str, messier: dict) -> str | None:
    """Primary NGC/IC/Mel/Cr/... id in compact form (NGC869, IC4725, Mel20, Cr463)."""
    if re.fullmatch(r"M\d+", oid):
        return messier_ngc(oid, messier)
    if re.fullmatch(r"(NGC|IC|Mel|Cr|Stock|Tr)\d+", oid):
        return oid
    return {"Mark6": "Mrk6", "AST-Hyades": "Mel25", "AST-OrionBelt": "Cr70", "AST-Coathanger": "Cr399",
            "AST-FlyingMinnow": "Mel31", "AST-KemblesCascade": "Kemble1", "M45": "Mel22"}.get(oid)


PREFIX_LONG = {"NGC": ("NGC", "NGC"), "IC": ("IC", "IC"), "Mel": ("Melotte", "Cl Melotte"),
               "Cr": ("Collinder", "Cl Collinder"), "Stock": ("Stock", "Cl Stock"), "Tr": ("Trumpler", "Cl Trumpler"),
               "Mrk": ("Markarian", "Cl Mrk"), "Kemble": ("Kemble", "Cl Kemble")}


def split_cat(name: str) -> tuple[str, str] | None:
    m = re.fullmatch(r"([A-Za-z]+?)(\d+)", name)
    return (m[1], m[2]) if m and m[1] in PREFIX_LONG else None


def simbad_ident(o: dict, messier: dict) -> str | None:
    if o.get("simbad"):
        return o["simbad"]
    oid = o["id"]
    if oid in ("LMC", "SMC"):
        return f"NAME {oid}"
    if re.fullmatch(r"M\d+", oid):
        return f"M {oid[1:]}"
    cn = catalog_name(oid, messier)
    sc = split_cat(cn) if cn else None
    return f"{PREFIX_LONG[sc[0]][1]} {sc[1]}" if sc else None


def hr24_names(o: dict, messier: dict) -> set[str]:
    oid = o["id"]
    names: set[str] = set()
    if re.fullmatch(r"M\d+", oid):
        names.add(oid)
    cn = catalog_name(oid, messier)
    sc = split_cat(cn) if cn else None
    if sc:
        names.add(f"{PREFIX_LONG[sc[0]][0]}_{sc[1]}")
    if oid == "IC1396":
        names.add("Trumpler_37")
    return names


def designation(o: dict, messier: dict) -> str:
    oid = o["id"]
    if re.fullmatch(r"M\d+", oid) or oid in ("LMC", "SMC"):
        return oid
    cn = catalog_name(oid, messier)
    sc = split_cat(cn) if cn else None
    if sc:
        return f"{sc[0]} {sc[1]}"
    return o.get("simbad") or o["name"]


def ned_name(oid: str) -> str:
    if re.fullmatch(r"M\d+", oid):
        return f"MESSIER {int(oid[1:]):03d}"
    m = re.fullmatch(r"(NGC|IC)(\d+)", oid)
    return f"{m[1]} {m[2]}" if m else oid


def cone_radius(extent_arcmin: float | None) -> float:
    return max(20.0, min(300.0, 0.75 * (extent_arcmin or 20.0)))


# ───────────────────────────── catalog readers ─────────────────────────────

def read_openngc(cache: Cache, wanted_keys: set[str]) -> dict[str, dict]:
    """Index OpenNGC rows by normalized key (Name, Identifiers, Messier number). Keeps a committed subset."""
    rel_sub, rel_add = "openngc-NGC.subset.csv", "openngc-addendum.csv"
    if cache.want(rel_sub):
        full = http(OPENNGC_NGC)
        sha = hashlib.sha256(full).hexdigest()
        if sha != OPENNGC_NGC_SHA:
            raise SystemExit(f"OpenNGC NGC.csv checksum {sha} differs from the pinned snapshot {OPENNGC_NGC_SHA}")
        text = full.decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
        keep = []
        by_name = {key_norm(r["Name"]): r for r in rows}
        for r in rows:
            ks = row_keys(r)
            if ks & wanted_keys:
                keep.append(r)
                for ref in (r.get("NGC"), r.get("IC")):  # follow duplicates to their master row
                    if r["Type"] == "Dup" and ref:
                        master = by_name.get(key_norm(("NGC" if ref == r.get("NGC") else "IC") + ref))
                        if master:
                            keep.append(master)
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=list(rows[0].keys()), delimiter=";", lineterminator="\n")
        w.writeheader()
        seen = set()
        for r in keep:
            if r["Name"] not in seen:
                seen.add(r["Name"])
                w.writerow(r)
        cache.store(rel_sub, out.getvalue().encode(), OPENNGC_NGC,
                    note="subset: rows matching master-list DSOs (Name, Identifiers or Messier number)",
                    extra={"fullSha256": sha, "fullBytes": len(full)})
    add = cache.get(rel_add, OPENNGC_ADD)
    sub = cache.path(rel_sub).read_bytes() if cache.path(rel_sub).exists() else None
    if sub is None:
        cache.missing.append(rel_sub)
    index: dict[str, dict] = {}
    for blob in (sub, add):
        if not blob:
            continue
        for r in csv.DictReader(io.StringIO(blob.decode("utf-8")), delimiter=";"):
            for k in row_keys(r):
                index.setdefault(k, r)
            index[key_norm(r["Name"])] = r
    # resolve Dup rows to their master
    for k, r in list(index.items()):
        if r["Type"] == "Dup":
            ref = ("NGC" + r["NGC"]) if r.get("NGC") else ("IC" + r["IC"]) if r.get("IC") else None
            if ref and key_norm(ref) in index and index[key_norm(ref)]["Type"] != "Dup":
                index[k] = index[key_norm(ref)]
    return index


def row_keys(r: dict) -> set[str]:
    ks = {key_norm(r["Name"])}
    if r.get("M"):
        ks.add(f"M{int(r['M'])}")
    for ident in (r.get("Identifiers") or "").split(","):
        if ident.strip():
            ks.add(key_norm(ident))
    return ks


def openngc_key(o: dict, messier: dict) -> list[str]:
    oid = o["id"]
    keys = []
    if re.fullmatch(r"M\d+", oid):
        keys.append(oid)
    cn = catalog_name(oid, messier)
    if cn:
        keys.append(key_norm(cn))
        sc = split_cat(cn)
        if sc and sc[0] == "Mel":
            keys.append(f"MEL{sc[1]}")
        if sc and sc[0] == "Cr":
            keys.append(f"CR{sc[1]}")
    return keys


def read_harris(text: str) -> dict[str, dict]:
    """Harris 2010: parts I-III keyed by 'NGC 6205'."""
    out: dict[str, dict] = {}
    part = 0
    for ln in text.splitlines():
        if "Part III:" in ln:
            part = 3
        elif "Part II:" in ln:
            part = 2
        elif "Part I:" in ln:
            part = 1
        hid = ln[:12].strip()
        if not part or not ln.startswith(" ") or not hid or hid.startswith(("ID", "-", "Part")):
            continue
        if part == 1:
            m = re.search(r"(\d\d \d\d \d\d\.\d+)\s+([+-]\d\d \d\d \d\d\.\d+)", ln)
            if m:
                out.setdefault(hid, {}).update({"ra_s": m[1], "dec_s": m[2]})
        elif part == 2 and hid in out:
            rest = ln[12:].split()
            if rest and num(rest[0]) is not None:
                out[hid]["feh"] = num(rest[0])
    return out


def harris_coords(rec: dict) -> tuple[float, float] | None:
    try:
        h, m, s = (float(x) for x in rec["ra_s"].split())
        d, dm, ds = rec["dec_s"].split()
        sign = -1 if d.startswith("-") else 1
        return 15 * (h + m / 60 + s / 3600), sign * (abs(float(d)) + float(dm) / 60 + float(ds) / 3600)
    except (KeyError, ValueError):
        return None


def read_baumgardt(text: str) -> dict[str, dict]:
    out = {}
    for ln in text.splitlines():
        if ln.startswith("#") or not ln.strip():
            continue
        c = ln.split()
        out.setdefault(c[0], {"ra": num(c[1]), "dec": num(c[2]), "rsun": num(c[3]), "drsun": num(c[4]),
                              "mass": num(c[9]), "dmass": num(c[10]), "rhl": num(c[16])})
    return out


def read_csv(blob: bytes | None) -> list[dict]:
    if not blob:
        return []
    return list(csv.DictReader(io.StringIO(blob.decode("utf-8"))))


def parse_ned(htmltext: str) -> dict:
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", htmltext, flags=re.S | re.I):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S | re.I)]
        if len(cells) >= 5 and num(cells[2]) is not None and re.fullmatch(r"\d{4}\S{15}", cells[4] or ""):
            rows.append({"mod": num(cells[0]), "dmpc": num(cells[2]), "method": cells[3], "ref": cells[4]})
    med = re.search(r"<td>Median</td>\s*<td>([\d.]+)</td>\s*<td>([\d.]+)</td>", htmltext)
    return {"rows": rows, "median_mpc": num(med[2]) if med else None}


def percentile(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def to_pc(dist: float, unit: str) -> float | None:
    u = unit.strip().lower()
    return dist * {"pc": 1, "kpc": 1e3, "mpc": 1e6}.get(u, float("nan")) if u in ("pc", "kpc", "mpc") else None


# ───────────────────────────── seeds ─────────────────────────────

def seed_class(o: dict, ongc: dict | None) -> str:
    if o["id"] in CLASS_OVERRIDES:
        return CLASS_OVERRIDES[o["id"]]
    cls = CAT_CLASS.get(o.get("cat") or "", "open-cluster")
    if cls == "asterism" and o["id"] in CLASS_OVERRIDES:
        return CLASS_OVERRIDES[o["id"]]
    if cls in GALAXY and ongc and ongc.get("Hubble"):
        h = ongc["Hubble"].strip()
        if h.startswith("SB"):
            return "galaxy-barred-spiral"
        if h.startswith("S0") or h.startswith("SA0") or h.startswith("SB0"):
            return "galaxy-lenticular"
        if h.startswith("E"):
            return "galaxy-elliptical"
        if h.startswith("I"):
            return "galaxy-irregular"
    return cls


def evo_stage(cls: str, age_myr: float | None) -> int | None:
    if cls in ("dark-nebula",) or cls in NEBULA:
        return 0
    if cls in ("embedded-cluster", "ob-association"):
        return 1
    if cls in ("open-cluster", "moving-group"):
        if age_myr is None:
            return None
        return 1 if age_myr <= 10 else 2 if age_myr <= 200 else 3 if age_myr <= 2000 else 4
    if cls == "globular-cluster":
        return 4
    if cls in ("planetary-nebula", "wind-bubble"):
        return 6
    if cls == "supernova-remnant":
        return 7
    if cls in GALAXY:
        return 8
    return None


def roles_for(cls: str, age_myr: float | None) -> list[str]:
    if cls in NEBULA or cls == "dark-nebula":
        return ["nursery"]
    if cls == "embedded-cluster":
        return ["young-cluster"]
    if cls == "ob-association":
        return ["association"]
    if cls in ("open-cluster", "moving-group"):
        if age_myr is None:
            return []
        return ["young-cluster"] if age_myr <= 200 else ["adult-cluster"] if age_myr <= 2000 else ["old-cluster"]
    return {"globular-cluster": ["globular"], "planetary-nebula": ["pn"], "supernova-remnant": ["snr"],
            "wind-bubble": ["supergiant"]}.get(cls, ["galaxy"] if cls in GALAXY else [])


def surface_brightness(mag: float | None, major: float | None, minor: float | None) -> float | None:
    if mag is None or not major:
        return None
    return mag + 2.5 * math.log10(math.pi / 4 * major * (minor or major) * 3600)


def seed_view(o: dict, cls: str, level: str | None, extent: dict | None) -> dict:
    """doc 03 §3.3 seeding: guide level -> 10x50 (suburban, dark); 7x50 adjusted by size; clamped by contrast."""
    sub, dark = LEVEL_GRADES.get(level or "dark", (1, 3))
    major = extent["majorArcmin"] if extent else None
    minor = extent.get("minorArcmin") if extent else None
    v10 = [sub, dark]
    v7 = list(v10)
    if major is not None and major < 10:
        v7 = [max(0, g - 1) for g in v7]
    elif major is not None and major > 60 and cls in ("dark-nebula", "hii-region", "milky-way-field", "star-cloud",
                                                      "open-cluster", "ob-association", "asterism"):
        v7 = [min(4, g + 1) for g in v7]
    sb = surface_brightness(o.get("mag"), major, minor) if cls in DIFFUSE else None
    # binocular-assessment.ts: a whole-disk average underrates bright, centrally concentrated galaxies (M31 core).
    if cls in GALAXY and major and major >= 60 and o.get("mag") is not None and o["mag"] <= 4.5:
        sb = None
    if sb is not None:
        for i, sky in enumerate((19.5, 21.6)):  # suburban, dark (doc 03 §3.3)
            contrast = 10 ** (0.4 * (sky - sb))
            cap = 1 if contrast < 0.08 else 2 if contrast < 0.25 else 4
            v10[i], v7[i] = min(v10[i], cap), min(v7[i], cap)
    return {"7x50": {"suburban": v7[0], "dark": v7[1]}, "10x50": {"suburban": v10[0], "dark": v10[1]},
            "basis": "derived"}


def seed_appearance(o: dict, cls: str, extent: dict | None) -> dict:
    oid, mag = o["id"], o.get("mag")
    if cls in ("open-cluster", "ob-association", "asterism", "embedded-cluster", "moving-group"):
        moon = "high" if (mag is not None and mag <= 6.0) or oid in ("AST-OrionBelt", "AST-Hyades") else "medium"
    elif cls == "globular-cluster" or oid in ("M42", "M8", "M31", "M27"):
        moon = "medium"
    else:
        moon = "low"
    if cls in ("dark-nebula", "milky-way-field"):
        resolves = "silhouette"
    elif cls in ("open-cluster", "ob-association", "asterism", "embedded-cluster", "moving-group", "star-cloud"):
        resolves = "stars"
    elif cls in NEBULA and oid in SECONDARY:
        resolves = "partly"
    else:
        resolves = "glow"
    major_deg = (extent["majorArcmin"] / 60) if extent else 1.0
    best = max(1.0, min(15.0, round(major_deg * 1.5 * 2) / 2))
    return {"moonTolerance": moon, "resolves": resolves, "bestFieldDeg": best, "colorVisible": False}


# ───────────────────────────── main build ─────────────────────────────

def main() -> None:
    mode = "refresh" if "--refresh" in sys.argv else "missing" if "--fetch-missing" in sys.argv else "offline"
    cache = Cache(mode)
    ol = json.loads(OBJECT_LIST.read_text())
    objs = [o for o in ol["objects"] if o["kind"] == "dso"]
    messier = {r["M"] if str(r["M"]).startswith("M") else f"M{r['M']}": r for r in json.loads((DATA / "messier.json").read_text())}
    binoc = {r["id"]: r for r in json.loads((DATA / "binocular-catalog.json").read_text())}
    extents = json.loads((LIB / "catalog-extents.json").read_text())
    media = json.loads(MEDIA.read_text())["objects"] if MEDIA.exists() else {}
    qa: list[dict] = []
    used_sources: set[str] = set()

    def flag(oid: str, issue: str, detail: str) -> None:
        qa.append({"id": oid, "issue": issue, "detail": detail})

    # ── OpenNGC
    wanted = {k for o in objs for k in openngc_key(o, messier)}
    ongc_index = read_openngc(cache, wanted)

    def ongc_row(o: dict) -> dict | None:
        for k in openngc_key(o, messier):
            if k in ongc_index:
                return ongc_index[k]
        return None

    ongc_rows = {o["id"]: ongc_row(o) for o in objs}
    classes = {o["id"]: seed_class(o, ongc_rows[o["id"]]) for o in objs}

    # ── SIMBAD basic + mesDistance (chunks of 60 identifiers)
    idents = {o["id"]: simbad_ident(o, messier) for o in objs}
    ident_list = sorted({v for v in idents.values() if v})
    basic_rows: list[dict] = []
    dist_rows: list[dict] = []
    for i in range(0, len(ident_list), 60):
        chunk = ident_list[i:i + 60]
        inlist = ",".join("'" + s.replace("'", "''") + "'" for s in chunk)
        q1 = ("SELECT i.id AS qid, b.main_id, b.otype, b.ra, b.dec, b.morph_type, b.galdim_majaxis, b.galdim_minaxis, "
              "b.rvz_radvel, b.rvz_type, b.rvz_err, b.rvz_bibcode FROM ident AS i JOIN basic AS b ON i.oidref=b.oid "
              f"WHERE i.id IN ({inlist})")
        q2 = ("SELECT i.id AS qid, b.main_id, d.dist, d.unit, d.plus_err, d.minus_err, d.method, d.bibcode "
              "FROM mesDistance AS d JOIN basic AS b ON d.oidref=b.oid JOIN ident AS i ON i.oidref=b.oid "
              f"WHERE i.id IN ({inlist})")
        n = i // 60
        for rel, q, sink in ((f"simbad/basic-{n}.csv", q1, basic_rows), (f"simbad/mesdistance-{n}.csv", q2, dist_rows)):
            url, data = simbad_tap(q)
            sink.extend(read_csv(cache.get(rel, url, data=data, note=f"SIMBAD TAP chunk {n}: {len(chunk)} identifiers")))
    simbad = {ident_norm(r["qid"]): r for r in basic_rows}
    sdist: dict[str, list[dict]] = {}
    for r in dist_rows:
        sdist.setdefault(ident_norm(r["main_id"]), []).append(r)

    # ── globular catalogs
    harris_txt = cache.get("harris-mwgc.dat", HARRIS)
    bv_txt = cache.get("baumgardt-combined_table.txt", BAUMGARDT, note="Baumgardt GC database, combined table v4 (Mar 2023)")
    harris = read_harris(harris_txt.decode("latin-1")) if harris_txt else {}
    bv = read_baumgardt(bv_txt.decode("latin-1")) if bv_txt else {}

    out_objects = []
    for o in objs:
        oid, cls = o["id"], classes[o["id"]]
        ongc = ongc_rows[oid]
        sb_row = simbad.get(ident_norm(idents[oid])) if idents[oid] else None
        facts: dict[str, dict] = {}
        srcs: set[str] = set()
        notes: list[str] = []

        # ── extent: existing observing extents, else OpenNGC, else SIMBAD galdim
        ext = None
        ce = extents.get(oid)
        if ce:
            src = "openngc" if ce["source"] != "included" else "catalog-extents"
            ext = {"majorArcmin": ce["majorArcmin"], "sourceId": src}
            if ce.get("minorArcmin"):
                ext["minorArcmin"] = ce["minorArcmin"]
            if ce.get("positionAngle") is not None:
                ext["paDeg"] = ce["positionAngle"]
        elif ongc and num(ongc.get("MajAx")):
            ext = {"majorArcmin": num(ongc["MajAx"]), "sourceId": "openngc"}
            if num(ongc.get("MinAx")):
                ext["minorArcmin"] = num(ongc["MinAx"])
            if num(ongc.get("PosAng")) is not None:
                ext["paDeg"] = num(ongc["PosAng"])
        elif sb_row and num(sb_row.get("galdim_majaxis")):
            ext = {"majorArcmin": num(sb_row["galdim_majaxis"]), "sourceId": "simbad"}
            if num(sb_row.get("galdim_minaxis")):
                ext["minorArcmin"] = num(sb_row["galdim_minaxis"])
        if ext and ext.get("minorArcmin") and ext["minorArcmin"] > ext["majorArcmin"]:
            ext["minorArcmin"] = ext["majorArcmin"]
        if ext:
            srcs.add(ext["sourceId"])
            dims = f"{ext['majorArcmin']:g}′" + (f" × {ext['minorArcmin']:g}′" if ext.get("minorArcmin") else "")
            facts["angularSizeArcmin"] = fact(ext["majorArcmin"], "arcmin", ext["sourceId"], n=4, note=dims)
        else:
            flag(oid, "no-extent", "no observing extent in catalog-extents.json, OpenNGC or SIMBAD; curator must supply one")

        # ── SIMBAD position sanity
        raw_sb, simbad_off = sb_row, 0.0
        if idents[oid] and not sb_row:
            flag(oid, "simbad-unresolved", f"SIMBAD did not resolve '{idents[oid]}'")
        elif sb_row and num(sb_row.get("ra")) is not None:
            d = sep_deg(o["ra"], o["dec"], num(sb_row["ra"]), num(sb_row["dec"])) * 60
            lim = max(30.0, (ext or {}).get("majorArcmin", 0))
            if d > lim:
                simbad_off = d
                flag(oid, "simbad-position", f"SIMBAD '{sb_row['main_id']}' lies {d:.0f}′ from the catalog position (limit {lim:.0f}′); identifier probably wrong, SIMBAD values not used")
                sb_row = None

        # ── independent distances from SIMBAD (exclude HR23/HR24 so the cluster check is independent)
        sd_rows = sdist.get(ident_norm(sb_row["main_id"])) if sb_row else []
        sd_pc = [(to_pc(num(r["dist"]), r["unit"]), r) for r in (sd_rows or []) if num(r["dist"]) and to_pc(num(r["dist"]), r["unit"])]
        indep_simbad = [p for p, r in sd_pc if r["bibcode"] not in HR_BIBCODES]

        hr_row = None
        age_myr = None
        cg_row = None
        # ── open clusters (and nebulae with an embedded cluster, and the two cluster-like asterisms)
        want_cluster = cls in CLUSTERLIKE or oid in EMBEDDED or oid in ("AST-Hyades",)
        if want_cluster or cls == "asterism":
            names = hr24_names(o, messier)
            if raw_sb and re.fullmatch(r"(NGC|IC) \d+", ident_norm(raw_sb["main_id"])):
                names.add(ident_norm(raw_sb["main_id"]).replace(" ", "_"))  # e.g. Mel 15 = IC 1805
            if oid in EMBEDDED:
                names = {EMBEDDED[oid]}
            radius = cone_radius((ext or {}).get("majorArcmin"))
            if simbad_off:  # catalog position disagrees with SIMBAD: widen the cone to cover both
                radius = max(radius, simbad_off + 20.0)
            hr_rows = parse_tsv((cache.get(f"hr24/{oid}.tsv", vizier_cone("J/A+A/686/A42/clusters", HR24_COLS, o["ra"], o["dec"], radius)) or b"").decode("utf-8", "replace"))
            cg_rows = parse_tsv((cache.get(f"cg20/{oid}.tsv", vizier_cone("J/A+A/640/A1/table1", CG20_COLS, o["ra"], o["dec"], radius)) or b"").decode("utf-8", "replace"))
            # rank: main Name equals a catalog name > catalog (non-Messier) name among aliases > Messier alias only
            def rank(r: dict) -> tuple:
                aka = set(r["AllNames"].split(","))
                cat_names = {n for n in names if not re.fullmatch(r"M\d+", n)}
                return (0 if r["Name"] in names else 1 if cat_names & aka else 2, num(r.get("_r")) or 0.0)
            matches = sorted((r for r in hr_rows if names & ({r["Name"]} | set(r["AllNames"].split(",")))), key=rank)
            all_names = set(names)
            for r in matches:
                all_names |= {r["Name"]} | set(r["AllNames"].split(","))
            cg_match = [r for r in cg_rows if r["Cluster"] in all_names]
            cg_row = cg_match[0] if cg_match else None
            if cls == "asterism":
                if matches:
                    m = matches[0]
                    flag(oid, "asterism-in-hr24", f"HR24 lists {m['Name']} (Type {m['Type']}, {num(m['dist50']):.0f} pc); not used for an asterism")
                else:
                    flag(oid, "asterism-not-a-cluster", f"no HR24 cluster named {sorted(names)} within {radius:.0f}′ (consistent with a chance alignment; see doc 03 §5.4.3)")
                matches = []
            elif not matches:
                flag(oid, "curated-required", f"no HR24 cluster named {sorted(names)} within {radius:.0f}′ of the catalog position")
            for m in matches[:3]:
                if hr_row:
                    break
                d50, plx_note = num(m["dist50"]), ""
                indep, indep_src = None, None
                if cg_row and num(cg_row.get("DistPc")):
                    indep, indep_src = num(cg_row["DistPc"]), "CG20"
                elif indep_simbad:
                    indep, indep_src = statistics.median(indep_simbad), "SIMBAD median"
                dpos = sep_deg(o["ra"], o["dec"], num(m["RA_ICRS"]), num(m["DE_ICRS"])) * 60
                if raw_sb and num(raw_sb.get("ra")) is not None:
                    dpos = min(dpos, sep_deg(num(raw_sb["ra"]), num(raw_sb["dec"]), num(m["RA_ICRS"]), num(m["DE_ICRS"])) * 60)
                pos_lim = max(15.0, 1.5 * (num(m["r50"]) or 0) * 60, 0.6 * ((ext or {}).get("majorArcmin") or 0))
                reasons = []
                if m["Type"] != "o":
                    reasons.append(f"Type '{m['Type']}' is not a bound open cluster")
                if dpos > pos_lim:
                    reasons.append(f"densest point {dpos:.0f}′ from the catalog position (limit {pos_lim:.0f}′)")
                if indep and d50 and abs(d50 - indep) / indep > 0.25:
                    reasons.append(f"distance {d50:.0f} pc disagrees with {indep_src} {indep:.0f} pc by more than 25 %")
                if reasons:
                    flag(oid, "curated-required", f"HR24 {m['Name']} rejected: " + "; ".join(reasons) + (f"; HR24 logAge50 {m['logAge50']}" if m.get("logAge50") else ""))
                    continue
                hr_row = m
                if not indep:
                    plx_note = "; no independent distance available for the 25 % check"
                emb = f"distance of the embedded/ionizing cluster {m['Name']}; " if oid in EMBEDDED else ""
                d16, d84 = num(m["dist16"]), num(m["dist84"])
                facts["distanceLy"] = fact(d50 * LY_PER_PC, "ly", "hr24",
                                           lo=d16 * LY_PER_PC if d16 else None, hi=d84 * LY_PER_PC if d84 else None,
                                           note=f"{emb}HR24 {m['Name']}: {d50:.1f} pc (16–84 %: {d16:.1f}–{d84:.1f}); "
                                                f"cross-check {indep_src or 'none'}{f' {indep:.0f} pc' if indep else ''}{plx_note}")
                srcs.add("hr24")
                la16, la50, la84 = num(m["logAge16"]), num(m["logAge50"]), num(m["logAge84"])
                if la50 is not None:
                    age = 10 ** la50 / 1e6
                    young_required = cls in NEBULA or cls == "embedded-cluster"
                    if young_required and age > 20:
                        flag(oid, "curated-required", f"HR24 neural-net age of {m['Name']} is {age:.0f} Myr, implausible for a cluster still inside its nebula; age not used (doc 03 §8.2)")
                    else:
                        age_myr = age
                        cg_age = f"; CG20 AgeNN {10 ** num(cg_row['AgeNN']) / 1e6:.0f} Myr" if cg_row and num(cg_row.get("AgeNN")) else ""
                        facts["ageMyr"] = fact(age, "Myr", "hr24",
                                               lo=10 ** la16 / 1e6 if la16 is not None else None,
                                               hi=10 ** la84 / 1e6 if la84 is not None else None,
                                               note=f"HR24 neural-net isochrone age (16–84 % range){cg_age}; showcase clusters need a curated literature age (doc 03 §5.4)")
                if oid not in EMBEDDED or cls in CLUSTERLIKE:
                    mj, emj = num(m["MassJ"]), num(m["e_MassJ"])
                    if mj:
                        facts["massMsun"] = fact(mj, "Msun", "hr24", lo=mj - emj if emj else None, hi=mj + emj if emj else None,
                                                 note=f"stellar mass within the Jacobi radius ({num(m['rJpc']) or 0:.1f} pc)", n=2)
                    elif num(m["MassTot"]):
                        mt, emt = num(m["MassTot"]), num(m["e_MassTot"])
                        facts["massMsun"] = fact(mt, "Msun", "hr24", lo=mt - emt if emt else None, hi=mt + emt if emt else None,
                                                 note="total observed stellar mass (no valid Jacobi radius)", n=2)
                    if num(m["N"]):
                        facts["memberCount"] = fact(num(m["N"]), "stars", "hr24", n=6,
                                                    note="Gaia DR3 members (HDBSCAN, roughly G < 20), not every star in the cluster")
                    if num(m["RV"]) is not None and (num(m["n_RV"]) or 0) >= 3:
                        rv, erv = num(m["RV"]), num(m["e_RV"])
                        facts["radialVelocityKms"] = fact(rv, "km/s", "hr24", lo=rv - erv if erv else None, hi=rv + erv if erv else None,
                                                          note=f"mean Gaia DR3 radial velocity of {int(num(m['n_RV']))} members")
            if not hr_row and cg_row and cls in CLUSTERLIKE and num(cg_row.get("DistPc")):
                dpc = num(cg_row["DistPc"])
                facts["distanceLy"] = fact(dpc * LY_PER_PC, "ly", "cg2020", note=f"CG20 {cg_row['Cluster']}: {dpc:.0f} pc (Gaia DR2 parallax); HR24 unavailable")
                srcs.add("cg2020")
                if num(cg_row.get("AgeNN")) is not None:
                    age_myr = 10 ** num(cg_row["AgeNN"]) / 1e6
                    facts["ageMyr"] = fact(age_myr, "Myr", "cg2020", note="CG20 neural-net age; needs a curated literature age for showcase use")

        # ── globular clusters: BV21 distance + BH18 mass + Harris [Fe/H]
        if cls == "globular-cluster":
            cn = catalog_name(oid, messier)
            sc = split_cat(cn) if cn else None
            key_bv = f"{sc[0]}_{sc[1]}" if sc else None
            key_h = f"{sc[0]} {sc[1]}" if sc else None
            b = bv.get(key_bv) if key_bv else None
            if b and sep_deg(o["ra"], o["dec"], b["ra"], b["dec"]) * 60 > 10:
                flag(oid, "curated-required", f"Baumgardt {key_bv} lies too far from the catalog position")
                b = None
            if b:
                d, e = b["rsun"] * 1000, (b["drsun"] or 0) * 1000
                facts["distanceLy"] = fact(d * LY_PER_PC, "ly", "bv21", lo=(d - e) * LY_PER_PC if e else None, hi=(d + e) * LY_PER_PC if e else None,
                                           note=f"{b['rsun']:.2f} ± {b['drsun'] or 0:.2f} kpc (Gaia EDR3 + HST + literature average)")
                facts["massMsun"] = fact(b["mass"], "Msun", "bh18", lo=b["mass"] - (b["dmass"] or 0) if b["dmass"] else None,
                                         hi=b["mass"] + (b["dmass"] or 0) if b["dmass"] else None, n=2,
                                         note=f"N-body fit mass; half-light radius {b['rhl']:.2f} pc")
                srcs |= {"bv21", "bh18"}
            else:
                flag(oid, "curated-required", f"no Baumgardt row for {key_bv}")
            h = harris.get(key_h) if key_h else None
            if h and h.get("feh") is not None:
                hc = harris_coords(h)
                if hc and sep_deg(o["ra"], o["dec"], *hc) * 60 < 10:
                    facts["feH"] = fact(h["feh"], "dex", "harris2010", n=3, note="[Fe/H] from the Harris catalog (2010 edition)")
                    srcs.add("harris2010")
                else:
                    flag(oid, "harris-position", f"Harris {key_h} position mismatch; [Fe/H] not used")
            elif key_h:
                flag(oid, "harris-missing", f"no Harris [Fe/H] for {key_h}")

        # ── galaxies: NED-D
        if cls in GALAXY:
            nn = ned_name(oid)
            blob = cache.get(f"ned/{oid}.html.gz", f"{NED_D}?{urllib.parse.urlencode({'name': nn})}", gz=True)
            ned = parse_ned(blob.decode("latin-1")) if blob else {"rows": [], "median_mpc": None}
            sel = [r for r in ned["rows"] if r["method"].strip() in ("Cepheids", "TRGB")]
            basis = "Cepheid and TRGB"
            if len(sel) < 3:
                sel, basis = ned["rows"], "all-method"
            if sel:
                ds = [r["dmpc"] for r in sel]
                med = statistics.median(ds)
                lo, hi = percentile(ds, 0.16), percentile(ds, 0.84)
                facts["distanceLy"] = fact(med * 1e6 * LY_PER_PC, "ly", "ned-d", lo=lo * 1e6 * LY_PER_PC, hi=hi * 1e6 * LY_PER_PC,
                                           note=f"median of {len(sel)} {basis} distances in NED-D: {med:.3g} Mpc (16–84 %: {lo:.3g}–{hi:.3g}); "
                                                f"NED median over all {len(ned['rows'])} rows {ned['median_mpc'] or float('nan'):.3g} Mpc")
                srcs.add("ned-d")
                if basis == "all-method":
                    flag(oid, "ned-few-primary", f"fewer than 3 Cepheid/TRGB rows in NED-D; all-method median used ({len(sel)} rows)")
            else:
                flag(oid, "curated-required", f"no NED-D distances for '{nn}'")
            if ongc and ongc.get("Hubble"):
                o_morph = {"hubble": ongc["Hubble"].strip(), "sourceId": "openngc"}
            elif sb_row and sb_row.get("morph_type"):
                o_morph = {"hubble": sb_row["morph_type"].strip(), "sourceId": "simbad"}
            else:
                o_morph = None
        else:
            o_morph = None

        # ── planetary nebulae: Gaia central-star distance via SIMBAD
        if cls == "planetary-nebula":
            chosen = None
            for bib, sid in PN_BIBCODES:
                cands = [(p, r) for p, r in sd_pc if r["bibcode"] == bib]
                if cands:
                    chosen = (cands[0], sid)
                    break
            others = [p for p, r in sd_pc if r["bibcode"] not in {b for b, _ in PN_BIBCODES}]
            if chosen and others and chosen[1] == "gaia-dr2":  # DR2-only parallaxes must agree with other estimates
                ref = statistics.median(others)
                gp = chosen[0][0]
                if abs(gp - ref) / ref > 0.5:
                    flag(oid, "curated-required", f"Gaia central-star distance {gp:.0f} pc ({chosen[0][1]['bibcode']}) disagrees with the median of other published values {ref:.0f} pc by more than 50 %; not used")
                    chosen = None
            if chosen:
                (p, r), sid = chosen
                pe, me = num(r.get("plus_err")), num(r.get("minus_err"))
                scale = p / num(r["dist"])
                facts["distanceLy"] = fact(p * LY_PER_PC, "ly", sid,
                                           lo=(p + me * scale) * LY_PER_PC if me is not None else None,
                                           hi=(p + pe * scale) * LY_PER_PC if pe is not None else None,
                                           note=f"Gaia central-star distance {r['dist']} {r['unit'].strip()} ({r['bibcode']}, via SIMBAD mesDistance; 1/parallax)"
                                                + (f"; other published values median {statistics.median(others):.0f} pc" if others else ""))
                srcs.add(sid)
            elif not any(q["id"] == oid and q["issue"] == "curated-required" for q in qa):
                flag(oid, "curated-required", "no Gaia central-star distance in SIMBAD mesDistance")

        # ── other nebulae without an accepted cluster: SIMBAD published distances (doc 03 §4.3 last resort)
        if "distanceLy" not in facts and cls in NEBULA and indep_simbad:
            med = statistics.median(indep_simbad)
            bibs = sorted({r["bibcode"] for p, r in sd_pc if r["bibcode"] not in HR_BIBCODES})
            facts["distanceLy"] = fact(med * LY_PER_PC, "ly", "simbad",
                                       lo=min(indep_simbad) * LY_PER_PC, hi=max(indep_simbad) * LY_PER_PC,
                                       note=f"median of {len(indep_simbad)} published distances in SIMBAD mesDistance ({', '.join(bibs[:6])}{'…' if len(bibs) > 6 else ''}); curated value preferred")
            srcs.add("simbad")
        if "distanceLy" not in facts and cls in ("supernova-remnant", "dark-nebula", "wind-bubble", "milky-way-field"):
            listed = "; ".join(f"{r['dist']} {r['unit'].strip()} {r['bibcode']}" for p, r in sd_pc[:8])
            flag(oid, "curated-required", f"{cls}: distance must come from curated literature (doc 03 §4.3)" + (f"; SIMBAD lists {listed}" if listed else ""))

        # ── radial velocity from SIMBAD (non-clusters, or clusters without a Gaia mean RV)
        if "radialVelocityKms" not in facts and sb_row and sb_row.get("rvz_type") == "v" and num(sb_row.get("rvz_radvel")) is not None:
            rv, erv = num(sb_row["rvz_radvel"]), num(sb_row.get("rvz_err"))
            facts["radialVelocityKms"] = fact(rv, "km/s", "simbad", lo=rv - erv if erv else None, hi=rv + erv if erv else None,
                                              note=f"heliocentric radial velocity ({sb_row.get('rvz_bibcode') or 'SIMBAD'})")
            srcs.add("simbad")

        # ── surface brightness (OpenNGC SurfBr, galaxies mostly)
        if ongc and num(ongc.get("SurfBr")) is not None:
            facts["surfaceBrightness"] = fact(num(ongc["SurfBr"]), "mag/arcsec2", "openngc", n=4,
                                              note="OpenNGC mean surface brightness within the 25 mag/arcsec² isophote")
            srcs.add("openngc")

        # ── derived physical size
        if "distanceLy" in facts and ext and cls not in ("asterism", "milky-way-field", "star-cloud"):
            dly = facts["distanceLy"]["value"]
            size = 2 * dly * math.tan(math.radians(ext["majorArcmin"] / 60) / 2)
            facts["sizeLy"] = fact(size, "ly", facts["distanceLy"]["sourceId"], method="derived", n=2,
                                   note=f"{ext['majorArcmin']:g}′ extent ({ext['sourceId']}) at {dly:g} ly; visible/catalog extent, not a tidal radius")

        # ── names
        aliases: list[str] = []
        def add_alias(a: str | None) -> None:
            if a and a.strip() and a.strip() not in aliases and a.strip() != o["name"]:
                aliases.append(a.strip())
        mrow = messier.get(oid)
        if mrow:
            n = str(mrow.get("NGC") or "")
            add_alias(f"NGC {n}" if re.fullmatch(r"\d+", n) else n)
            add_alias(mrow.get("N"))
        brow = binoc.get(oid)
        if brow:
            add_alias(brow.get("altId"))
            add_alias(brow.get("name"))
        if ongc:
            for a in (ongc.get("Common names") or "").split(","):
                add_alias(a)
            for a in (ongc.get("Identifiers") or "").split(","):
                add_alias(a)
            if ongc.get("M"):
                add_alias(f"M{int(ongc['M'])}")
        if sb_row:
            add_alias(ident_norm(sb_row["main_id"]))
        names = {"display": o["name"], "designation": designation(o, messier), "aliases": aliases[:12]}
        if sb_row:
            names["simbadId"] = ident_norm(sb_row["main_id"])

        level = next((s.split(":", 1)[1] for s in o["selection"] if s.startswith("guide:")), None) or SEED_LEVEL.get(oid)
        if level is None:
            flag(oid, "no-level", "no guide level; view seeded from the 'dark' default")

        rec: dict = {
            "id": oid, "kind": "dso", "names": names, "con": o["con"], "ra": o["ra"], "dec": o["dec"], "mag": o.get("mag"),
            "dsoClass": cls,
        }
        if oid in SECONDARY:
            rec["secondaryClasses"] = SECONDARY[oid]
        traits = list(TRAITS.get(oid, []))
        if o.get("mag") is not None and o["mag"] <= 4.5 and cls not in ("asterism",) and "naked-eye" not in traits:
            traits.append("naked-eye")
        if traits:
            rec["traits"] = traits
        if o_morph:
            rec["morphology"] = o_morph
            srcs.add(o_morph["sourceId"])
        if ext:
            rec["extent"] = ext
        rec["facts"] = facts
        rec["evoStage"] = evo_stage(cls, age_myr)
        rec["roles"] = roles_for(cls, age_myr)
        if rec["evoStage"] is None and cls in ("open-cluster", "moving-group"):
            flag(oid, "no-age", "open cluster without a catalog age: evoStage and roles left for the curator")
        rec["view"] = seed_view(o, cls, level, ext)
        rec["appearance"] = seed_appearance(o, cls, ext)
        m = media.get(oid)
        visuals = [{"type": "binocular-field", "fieldDeg": rec["appearance"]["bestFieldDeg"]}]
        if "distanceLy" in facts:
            visuals.insert(0, {"type": "distance-bar"})
        if "ageMyr" in facts:
            visuals.insert(0, {"type": "age-bar"})
        rec["media"] = {"images": m["images"] if m else [], "visuals": visuals}
        if not m or not m["images"]:
            flag(oid, "no-image", "no bundled or fetched image; run fetch_media.py")
        for f in facts.values():
            srcs.add(f["sourceId"])
        rec["sources"] = sorted(srcs)
        rec["provenance"] = {"status": "auto", "batch": o["batch"]}
        used_sources |= srcs
        out_objects.append(rec)

    cache.save_manifest()
    if cache.missing:
        miss = sorted(set(cache.missing))
        print(f"WARNING: {len(miss)} cache entries missing (run with --fetch-missing): {', '.join(miss[:10])}{' …' if len(miss) > 10 else ''}", file=sys.stderr)

    # ── self-check: every fact well-formed, every sourceId registered
    for rec in out_objects:
        for k, f in rec["facts"].items():
            assert f["sourceId"] in SOURCES, (rec["id"], k, f["sourceId"])
            assert f.get("min", f["value"]) <= f["value"] <= f.get("max", f["value"]), (rec["id"], k, f)
            assert f["method"] in ("catalog", "derived"), (rec["id"], k)
        for s in rec["sources"]:
            assert s in SOURCES, (rec["id"], s)

    retrieved = sorted({e["retrieved"] for e in cache.manifest.values()}) or [today()]
    doc = {
        "version": f"dso.auto-{retrieved[-1]}",
        "generatedBy": "script/journeys/build_dso_auto.py",
        "sources": [SOURCES[s] for s in sorted(used_sources)],
        "objects": out_objects,
        "qa": qa,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    n_dist = sum("distanceLy" in r["facts"] for r in out_objects)
    n_age = sum("ageMyr" in r["facts"] for r in out_objects)
    issues: dict[str, int] = {}
    for q in qa:
        issues[q["issue"]] = issues.get(q["issue"], 0) + 1
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(out_objects)} DSOs, {n_dist} with distance, {n_age} with age, "
          f"{sum(len(r['facts']) for r in out_objects)} facts, {len(used_sources)} sources; fetched {cache.fetched} files.")
    print("QA:", ", ".join(f"{k} {v}" for k, v in sorted(issues.items())))


if __name__ == "__main__":
    main()
