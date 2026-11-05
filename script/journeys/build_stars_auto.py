#!/usr/bin/env python3
"""Sky Journeys: AUTOMATIC star data (catalog tier) for every star in script/journeys/object-list.json.

Outputs
  script/journeys/generated/stars.auto.json          auto-tier star records (Partial<KbObject>, see README.md)
  client/public/data/journeys/hr-background.json     compact HR-diagram background (~8,700 BSC stars)

Sources (doc 02 §4; every query was tested from the build machine; CDS Strasbourg hosts time out, so mirrors are used)
  SIMBAD TAP (Harvard mirror)  identifiers, spectral type, PM, RV, photometry, mesFe_h Teff/[Fe/H], bulk HR parallaxes
  VizieR (IDIA mirror)          BSC5 V/50 (V, B−V), JMDC II/345 + JSDC v2 II/346 (angular diameters),
                                VSX B/vsx + GCVS B/gcvs (variability), WDS B/wds (multiplicity)
  Gaia archive (ESAC)           Hipparcos 2007 new reduction, Gaia DR3 (parallax, RUWE)
  NASA Exoplanet Archive        planet hosts (pscomppars)

Policies (doc 02 S4, §4.3, §4.7, §5.1; spec decisions 1, 8, 10)
  distance   V < 5.5: Hipparcos 2007 (Gaia DR3 fallback only if Hip σϖ/ϖ ≥ 10 % and Gaia passes the filter);
             V ≥ 5.5: Gaia DR3 only if RUWE < 1.4 and σϖ/ϖ < 10 %, else Hipparcos 2007.
             σϖ/ϖ ≥ 10 % → value rounded to 2 significant figures and flagged uncertain; ≥ 50 % or ϖ ≤ 0 → omitted.
             Supergiants, Miras/AGB stars and V ≤ 2 are flagged `needsLiterature` (curators must override).
  Teff       SIMBAD mesFe_h: median of post-2000 determinations after 3-MAD rejection (method catalog);
             else Flower 1996 B−V relation with the Torres 2010 corrected coefficients (method derived, reddening ignored);
             never from colour for M/C/S/WR/WD stars, AGB otypes or variables with amplitude ≥ 0.5 mag.
  diameter   JMDC limb-darkened measurements (median) → JSDC v2 predicted LDD (χ² ≤ 5, CalFlag bit 1 clear, not
             carbon/AGB; CalFlag bits 2/4 noted as caveats) → JMDC uniform-disk.
  radius     θ·d/9.305 when distance σ/d < 20 %; else Stefan–Boltzmann from L and Teff (both derived).
  luminosity log L = −0.4 (M_V + BC_V(Teff) − 4.73), BC from Torres 2010; A_V = 0 assumed;
             skipped for Teff < 3300 K, carbon/S stars, amplitude ≥ 1 mag variables and uncertain distances.
  variability VSX (row whose name matches a SIMBAD identifier, VSX flag 0) else GCVS; kept when amplitude ≥ 0.1 mag.
  mag        BSC V (SIMBAD V for non-BSC); max light for periodic variables with amplitude ≥ 1 mag (types.ts);
             eruptive stars (novae, LBVs, YSOs) use SIMBAD's quiescent V when the BSC lists outburst light (T CrB).
  stage      doc 02 §5.1 defaults (stageConfidence "likely"), plus otype rules (RR* → horizontal-branch, RV* → post-agb);
             deviation: luminosity class II counts as a supergiant only when M_V < −4.
  multiplicity WDS rows of the star's own WDS system that involve its component, sep ≥ 3″, mag2 ≤ 9.0, not SHY/SMR
             survey pairs, not flagged X (dubious), not the 999.9″ WDS placeholder; existing DS-* targets also keep their
             catalog pair (separation ±25 %, mag ±1.5) when it is fainter than 9.0. physical: WDS note O/C → bound, T/V/Z → common-proper-motion,
             S/U/Y → optical, else unknown (curators decide).

Every number is a FactValue {value, min?, max?, unit, sourceId, method: catalog|derived, note?}.
Non-schema diagnostics live in each record's `auto` block (stripped by the KB zod parse): HD/HIP/Gaia ids,
distance tier, flags for curators.

Every raw response is cached under script/journeys/cache/stars/ (request + retrieved date + body), so a rerun is offline:
    python3 -I script/journeys/build_stars_auto.py              # cache first, network only for missing entries
    python3 -I script/journeys/build_stars_auto.py --offline    # fail on any cache miss
    python3 -I script/journeys/build_stars_auto.py --refresh    # re-query everything
Stdlib only.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "client" / "public" / "data"
OBJECT_LIST = HERE / "object-list.json"
CACHE = HERE / "cache" / "stars"
OUT_AUTO = HERE / "generated" / "stars.auto.json"
OUT_HR = DATA / "journeys" / "hr-background.json"
MEDIA = ROOT / "client" / "src" / "lib" / "binocular-media.json"
PIPELINE_VERSION = "stars.auto/1"

SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync"
VIZIER = "https://vizier.idia.ac.za/viz-bin/asu-tsv"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
EXO_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"

LY_PER_PC = 3.261564
MBOL_SUN = 4.73          # Torres 2010 §3: consistent with Flower's BC scale
TEFF_SUN = 5772.0        # IAU 2015 nominal (Prša et al. 2016)
RSUN_MAS_AT_1PC = 9.305  # angular diameter (mas) of 1 R☉ at 1 pc

# SIMBAD identifier used for object-list entries that have neither an HR number nor a `simbad` id.
IDENT_OVERRIDE = {"DS-Winnecke4": "HD 238107"}  # Winnecke 4 = M40; primary is HD 238107 (WDS 12222+5805)

DS_CATALOG: dict[str, dict] = {}  # binocular-catalog.json DS-* entries (filled in main)

# Planet claims that later work disputes (archive lists them as confirmed).
DISPUTED_PLANETS = {29139: "reichert2019"}  # Aldebaran b: Reichert et al. 2019, A&A 625, A22

# ───────────────────────────── sources registry ─────────────────────────────
# simbad / hip2007 / gcvs are byte-identical to the fixture KB records so the merge de-duplicates them.

def sources_registry(retrieved: str) -> dict[str, dict]:
    r = retrieved
    s = [
        {"id": "simbad", "title": "SIMBAD astronomical database (Harvard mirror)", "url": "https://simbad.harvard.edu/simbad/",
         "publisher": "CDS Strasbourg", "kind": "catalog", "citation": "Wenger et al. 2000, A&AS 143, 9", "retrieved": r},
        {"id": "hip2007", "title": "Validation of the new Hipparcos reduction",
         "url": "https://ui.adsabs.harvard.edu/abs/2007A%26A...474..653V/abstract", "publisher": "Astronomy & Astrophysics",
         "kind": "catalog", "citation": "van Leeuwen 2007, A&A 474, 653", "bibcode": "2007A&A...474..653V", "retrieved": r},
        {"id": "gcvs", "title": "General Catalogue of Variable Stars (GCVS 5.1)", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=B/gcvs",
         "publisher": "Sternberg Astronomical Institute / VizieR (IDIA mirror)", "kind": "catalog",
         "citation": "Samus et al. 2017, Astron. Rep. 61, 80", "retrieved": r},
        {"id": "bsc5", "title": "Bright Star Catalogue, 5th Revised Ed.", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=V/50",
         "publisher": "Yale University Observatory / VizieR (IDIA mirror)", "kind": "catalog",
         "citation": "Hoffleit & Warren 1991, VizieR V/50", "bibcode": "1991bsc..book.....H", "retrieved": r},
        {"id": "gaiadr3", "title": "Gaia Data Release 3: Summary of the content and survey properties",
         "url": "https://www.cosmos.esa.int/web/gaia/dr3", "publisher": "ESA/Gaia/DPAC", "kind": "catalog",
         "citation": "Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1", "bibcode": "2023A&A...674A...1G",
         "license": "CC BY-SA 3.0 IGO", "retrieved": r},
        {"id": "vsx", "title": "AAVSO International Variable Star Index (VSX)", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=B/vsx",
         "publisher": "AAVSO / VizieR (IDIA mirror)", "kind": "catalog", "citation": "Watson, Henden & Price 2006, SASS 25, 47",
         "bibcode": "2006SASS...25...47W", "license": "AAVSO VSX terms (attribution)", "retrieved": r},
        {"id": "wds", "title": "The Washington Visual Double Star Catalog (WDS)", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=B/wds",
         "publisher": "US Naval Observatory / VizieR (IDIA mirror)", "kind": "catalog",
         "citation": "Mason et al. 2001, AJ 122, 3466 (continuously updated); note-flag key: https://ftp.lowell.edu/pub/bas/wdskey.txt",
         "bibcode": "2001AJ....122.3466M", "retrieved": r},
        {"id": "jmdc", "title": "JMMC Measured Stellar Diameters Catalogue (JMDC)", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=II/345",
         "publisher": "JMMC / VizieR (IDIA mirror)", "kind": "catalog",
         "citation": "Duvert 2016, VizieR II/345 (as part of Chelli et al. 2016, A&A 589, A112)", "bibcode": "2016yCat.2345....0D", "retrieved": r},
        {"id": "jsdc2", "title": "JMMC Stellar Diameters Catalogue, version 2 (JSDC)", "url": "https://vizier.idia.ac.za/viz-bin/VizieR?-source=II/346",
         "publisher": "JMMC / VizieR (IDIA mirror)", "kind": "catalog",
         "citation": "Bourgès et al. 2017, VizieR II/346; method: Chelli et al. 2016, A&A 589, A112", "bibcode": "2016A&A...589A.112C", "retrieved": r},
        {"id": "simbad-mesfeh", "title": "SIMBAD mesFe_h measurement table (Teff, log g, [Fe/H] compilation)",
         "url": "https://simbad.harvard.edu/simbad/sim-tap", "publisher": "CDS Strasbourg", "kind": "catalog",
         "citation": "SIMBAD mesFe_h (PASTEL, Soubiran et al. 2016, A&A 591, A118, plus later papers); median of post-2000 entries after 3-MAD rejection",
         "retrieved": r},
        {"id": "torres2010", "title": "On the use of empirical bolometric corrections for stars", "url": "https://arxiv.org/abs/1008.3913",
         "publisher": "The Astronomical Journal", "kind": "paper",
         "citation": "Torres 2010, AJ 140, 1158 (corrected Flower 1996 BC_V and B−V–Teff coefficients)", "bibcode": "2010AJ....140.1158T"},
        {"id": "nasa-exoplanet-archive", "title": "NASA Exoplanet Archive: Planetary Systems Composite Parameters",
         "url": "https://exoplanetarchive.ipac.caltech.edu/", "publisher": "NASA Exoplanet Science Institute / IPAC", "kind": "catalog",
         "citation": "Akeson et al. 2013, PASP 125, 989", "bibcode": "2013PASP..125..989A", "retrieved": r},
        {"id": "reichert2019", "title": "Precise radial velocities of giant stars. XII. Evidence against the proposed planet Aldebaran b",
         "url": "https://arxiv.org/abs/1903.09157", "publisher": "Astronomy & Astrophysics", "kind": "paper",
         "citation": "Reichert et al. 2019, A&A 625, A22", "bibcode": "2019A&A...625A..22R"},
    ]
    return {x["id"]: x for x in s}


# ───────────────────────────── cached fetching ─────────────────────────────

class Fetcher:
    def __init__(self, mode: str):
        self.mode = mode  # "cache" | "offline" | "refresh"
        self.dates: set[str] = set()
        self.network = 0

    def get(self, rel: str, url: str, data: dict | None = None, host: str = "") -> str:
        path = CACHE / rel
        request = {"url": url, "data": data}
        if self.mode != "refresh" and path.exists():
            cached = json.loads(path.read_text())
            if cached.get("request") == request:
                self.dates.add(cached["retrieved"])
                return cached["body"]
        if self.mode == "offline":
            raise SystemExit(f"cache miss (offline): {rel}")
        body = self._http(url, data)
        if url.startswith(VIZIER):
            body = strip_vizier_comments(body)
        self.network += 1
        today = date.today().isoformat()
        self.dates.add(today)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"request": request, "host": urllib.parse.urlsplit(url).netloc,
                                    "retrieved": today, "body": body}, ensure_ascii=False, indent=0))
        return body

    @staticmethod
    def _http(url: str, data: dict | None) -> str:
        payload = urllib.parse.urlencode(data).encode() if data else None
        last: Exception | None = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, data=payload, headers={"User-Agent": "starhop-journeys-build/1"})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    return resp.read().decode("utf-8", errors="replace")
            except Exception as e:  # noqa: BLE001 - retry on any network error
                last = e
                time.sleep(2 + 4 * attempt)
        raise SystemExit(f"network failure for {url}: {last}")


def strip_vizier_comments(body: str) -> str:
    """Drop VizieR's per-response '#' metadata (INFO/Column/Table lines, ~4 KB each); the table itself is untouched."""
    return "\n".join(line for line in body.splitlines() if not line.startswith("#")) + "\n"


def tap_json(f: Fetcher, rel: str, query: str) -> list[dict]:
    body = f.get(rel, SIMBAD_TAP, {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query})
    d = json.loads(body)
    names = [c["name"] for c in d["metadata"]]
    return [dict(zip(names, row)) for row in d["data"]]


def tap_csv(f: Fetcher, rel: str, endpoint: str, query: str) -> list[dict]:
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": query}
    if endpoint == EXO_TAP:
        data = {"query": query, "format": "csv"}
    body = f.get(rel, endpoint, data)
    return list(csv.DictReader(io.StringIO(body)))


def vizier(f: Fetcher, rel: str, params: list[tuple[str, str]]) -> list[dict]:
    url = VIZIER + "?" + urllib.parse.urlencode(params, safe="/=,_")
    return parse_tsv(f.get(rel, url))


def parse_tsv(text: str) -> list[dict]:
    """VizieR asu-tsv: comments (#), then header, units, dashes, rows; blank line between tables."""
    rows: list[dict] = []
    header: list[str] | None = None
    stage = 0
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        if not line.strip():
            header, stage = None, 0
            continue
        cells = [c.strip() for c in line.split("\t")]
        if header is None:
            header, stage = cells, 1
            continue
        if stage == 1:          # units
            stage = 2
            continue
        if stage == 2 and set(line.replace("\t", "")) <= {"-", " "}:
            stage = 3
            continue
        if stage >= 2:
            stage = 3
            rows.append(dict(zip(header, cells)))
    return rows


def num(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return None if (isinstance(x, float) and math.isnan(x)) else float(x)
    s = str(x).strip().rstrip(":")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def rdist(row: dict) -> float:
    """VizieR `_r` (arcsec from the cone centre); 0.0 is a valid exact match."""
    r = num(row.get("_r"))
    return 99.0 if r is None else r


def lead_int(s: str | None) -> int | None:
    """'65378A' -> 65378 (SIMBAD component suffixes such as HIP 65378A)."""
    m = re.match(r"\s*(\d+)", s or "")
    return int(m.group(1)) if m else None


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())


# ───────────────────────────── names ─────────────────────────────

GREEK = {"alf": "α", "bet": "β", "gam": "γ", "del": "δ", "eps": "ε", "zet": "ζ", "eta": "η", "tet": "θ", "iot": "ι",
         "kap": "κ", "lam": "λ", "mu.": "μ", "mu": "μ", "nu.": "ν", "nu": "ν", "ksi": "ξ", "omi": "ο", "pi.": "π", "pi": "π",
         "rho": "ρ", "sig": "σ", "tau": "τ", "ups": "υ", "phi": "φ", "chi": "χ", "psi": "ψ", "ome": "ω"}
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
GENITIVE = {
    "And": "Andromedae", "Ant": "Antliae", "Aps": "Apodis", "Aqr": "Aquarii", "Aql": "Aquilae", "Ara": "Arae", "Ari": "Arietis",
    "Aur": "Aurigae", "Boo": "Boötis", "Cae": "Caeli", "Cam": "Camelopardalis", "Cnc": "Cancri", "CVn": "Canum Venaticorum",
    "CMa": "Canis Majoris", "CMi": "Canis Minoris", "Cap": "Capricorni", "Car": "Carinae", "Cas": "Cassiopeiae", "Cen": "Centauri",
    "Cep": "Cephei", "Cet": "Ceti", "Cha": "Chamaeleontis", "Cir": "Circini", "Col": "Columbae", "Com": "Comae Berenices",
    "CrA": "Coronae Australis", "CrB": "Coronae Borealis", "Crv": "Corvi", "Crt": "Crateris", "Cru": "Crucis", "Cyg": "Cygni",
    "Del": "Delphini", "Dor": "Doradus", "Dra": "Draconis", "Equ": "Equulei", "Eri": "Eridani", "For": "Fornacis",
    "Gem": "Geminorum", "Gru": "Gruis", "Her": "Herculis", "Hor": "Horologii", "Hya": "Hydrae", "Hyi": "Hydri", "Ind": "Indi",
    "Lac": "Lacertae", "Leo": "Leonis", "LMi": "Leonis Minoris", "Lep": "Leporis", "Lib": "Librae", "Lup": "Lupi", "Lyn": "Lyncis",
    "Lyr": "Lyrae", "Men": "Mensae", "Mic": "Microscopii", "Mon": "Monocerotis", "Mus": "Muscae", "Nor": "Normae", "Oct": "Octantis",
    "Oph": "Ophiuchi", "Ori": "Orionis", "Pav": "Pavonis", "Peg": "Pegasi", "Per": "Persei", "Phe": "Phoenicis", "Pic": "Pictoris",
    "Psc": "Piscium", "PsA": "Piscis Austrini", "Pup": "Puppis", "Pyx": "Pyxidis", "Ret": "Reticuli", "Sge": "Sagittae",
    "Sgr": "Sagittarii", "Sco": "Scorpii", "Scl": "Sculptoris", "Sct": "Scuti", "Ser": "Serpentis", "Sex": "Sextantis",
    "Tau": "Tauri", "Tel": "Telescopii", "Tri": "Trianguli", "TrA": "Trianguli Australis", "Tuc": "Tucanae", "UMa": "Ursae Majoris",
    "UMi": "Ursae Minoris", "Vel": "Velorum", "Vir": "Virginis", "Vol": "Volantis", "Vul": "Vulpeculae",
}


def bayer_greek(ident: str) -> str | None:
    """'* alf01 CVn A' -> 'α¹ CVn A' (None if not a Bayer identifier)."""
    m = re.match(r"^\*\s+([a-z]{2,3}\.?)(\d{0,2})\s+([A-Z][A-Za-z]{1,2})(\s+.*)?$", ident)
    if not m or m.group(1) not in GREEK:
        return None
    sup = str(int(m.group(2))).translate(SUP) if m.group(2) else ""
    return f"{GREEK[m.group(1)]}{sup} {m.group(3)}{(m.group(4) or '').rstrip()}"


def designation_from_ids(ids: list[str]) -> str | None:
    """Prefer Bayer, then Flamsteed, then a GCVS name, written with the constellation genitive."""
    for kind in ("bayer", "flam", "var"):
        for i in ids:
            if kind == "bayer":
                g = bayer_greek(i)
                if g:
                    letter, con, *rest = g.split(" ")
                    if con in GENITIVE:
                        return " ".join([letter, GENITIVE[con], *rest])
            elif kind == "flam":
                m = re.match(r"^\*\s+(\d+)\s+([A-Z][A-Za-z]{1,2})(\s+[A-Z])?$", i)
                if m and m.group(2) in GENITIVE:
                    return f"{m.group(1)} {GENITIVE[m.group(2)]}{m.group(3) or ''}"
            else:
                m = re.match(r"^V\*\s+([A-Z]{1,2}|V\d+)\s+([A-Z][A-Za-z]{1,2})$", i)
                if m and m.group(2) in GENITIVE:
                    return f"{m.group(1)} {GENITIVE[m.group(2)]}"
    return None


ALIAS_PREFIXES = ("NAME ", "* ", "V* ", "HR ", "HD ", "HIP ", "Gaia DR3 ", "GJ ", "WDS J", "SAO ", "ADS ")


def aliases_from_ids(ids: list[str]) -> list[str]:
    out: list[str] = []
    for i in ids:
        if not i.startswith(ALIAS_PREFIXES):
            continue
        if i.startswith("NAME "):
            out.append(i[5:])
        elif i.startswith(("* ", "V* ")):
            plain = i.split(" ", 1)[1]
            out.append(plain)
            g = bayer_greek(i if i.startswith("* ") else "* " + plain)
            if g:
                out.append(g)
        elif i.startswith("WDS J"):
            out.append("WDS " + i[5:15])          # one system id, component suffixes dropped
        else:
            out.append(i)
    seen: set[str] = set()
    return [a for a in out if not (a in seen or seen.add(a))]


# ───────────────────────────── spectral types & stages ─────────────────────────────

LUM_RE = re.compile(r"(0-Ia|Ia\+|Ia0|Ia-Iab|Iab-Ib|Iab|Ia|Ib-II|Ib|III-IV|III|II-III|II|IV-V|IV|VI|V)")


def parse_sptype(sp: str) -> tuple[str | None, str | None]:
    s = sp.strip()
    am = re.match(r"^k[A-Z][\d.:]*h([OBAFGKM])", s)   # Am notation kA4hA5mA5Va: the hydrogen type gives the class
    if am:
        rest = re.sub(r"m[A-Z][\d.:]*", "", re.sub(r"^[\d.:/\-]+", "", s[am.end():]))
        lm = LUM_RE.search(rest)
        return am.group(1), (lm.group(1) if lm else None)
    m = re.match(r"^(?:sd|esd|d|g|c)?(WN|WC|WO|DA|DB|DO|DQ|DZ|DC|MS|SC|[OBAFGKMCSD])", s)
    if not m:
        return None, None
    cls = {"WN": "W", "WC": "W", "WO": "W", "MS": "S", "SC": "S"}.get(m.group(1), m.group(1)[0])
    rest = s[m.end():]
    rest = re.sub(r"^[\d.:/\-]+", "", rest) if cls not in ("C", "S") else rest
    lm = LUM_RE.search(rest)
    lum = lm.group(1) if lm and cls not in ("W", "D") else None
    if lum is None and re.match(r"^_0(?![\d.])", rest):     # "G2_0" (ρ Cas): luminosity class 0 = hypergiant
        lum = "0"
    if s.startswith("sd"):
        lum = "VI"
    return cls, lum


def lum_family(lum: str | None) -> str | None:
    if not lum:
        return None
    head = re.split(r"[-/]", lum)[0]
    if head in ("0", "Ia+", "Ia0"):
        return "hyper"
    if head in ("Ia", "Iab", "Ib", "I"):
        return "super"
    return {"II": "bright", "III": "giant", "IV": "sub", "V": "dwarf", "VI": "dwarf"}.get(head)


PMS_OTYPES = {"TT*", "Y*O", "Or*", "FU*", "Ae*", "Y*?", "TT?"}
AGB_OTYPES = {"C*", "S*", "Mi*", "AB*", "C*?", "S*?"}


def default_stage(cls, lum, otype, sp_text, var_class, mv, sub_k_g8_k2) -> tuple[str | None, str]:
    """doc 02 §5.1 stage default. Returns (stage, rule)."""
    otype = otype or ""
    if otype in ("WD*", "WD?"):
        return "white-dwarf", "otype"
    if otype in ("HXB", "XB*", "HXB?"):
        return "compact-companion-host", "otype"
    if otype in PMS_OTYPES:
        return "pre-main-sequence", "otype"
    if otype in ("WR*",) or cls == "W":
        return "wolf-rayet", "spectral"
    if otype in ("RR*", "RR?"):
        return "horizontal-branch", "otype RR Lyrae"
    if otype in ("RV*", "RV?", "pA*", "post-AGB*"):
        return "post-agb", "otype RV Tau / post-AGB"
    if otype in ("LBV*", "LB*", "LBV") or (sp_text or "").startswith("LBV"):
        return "lbv", "otype"
    if cls in ("C", "S") or otype in AGB_OTYPES or var_class == "mira":
        return "tp-agb", "carbon/S/Mira"
    if cls == "D":
        return "white-dwarf", "spectral"
    fam = lum_family(lum)
    if fam is None and otype in ("s*r", "s*y", "s*b", "s?r", "s?y", "s?b"):
        fam = "super"
    if cls is None:
        return None, "none"
    hot = cls in ("O", "B")
    if "e" in (sp_text or "") and hot and fam in (None, "dwarf", "sub", "giant"):
        return "main-sequence", "Be"
    if fam == "bright" and (mv is None or mv > -4.0):
        # Deviation from doc 02 §5.1: luminosity class II is a bright *giant*; only treat it as a supergiant when
        # M_V < −4 (e.g. Albireo A, K3 II at M_V ≈ −2.5, is a giant, not a red supergiant).
        fam = "giant"
    if fam in ("super", "bright", "hyper"):
        if fam == "hyper" and cls in ("F", "G", "K"):
            return "yellow-hypergiant", "lum 0/Ia+"
        if cls in ("O", "B", "A"):
            return "blue-supergiant", "lum I/II"
        if cls in ("F", "G"):
            return "yellow-supergiant", "lum I/II"
        return "red-supergiant", "lum I/II"
    if fam == "dwarf":
        return "main-sequence", "lum V"
    if fam == "sub":
        return ("terminal-main-sequence" if cls in ("O", "B", "A") else "subgiant"), "lum IV"
    if fam == "giant":
        if cls in ("O", "B", "A"):
            return "terminal-main-sequence", "hot lum III"
        if sub_k_g8_k2 and mv is not None and 0.2 <= mv <= 1.2:
            return "red-clump", "G8-K2 III, M_V 0.2..1.2"
        return "red-giant-branch", "lum III"
    return None, "none"


def evo_stage_for(stage: str | None, cls: str | None) -> int | None:
    if stage is None:
        return None
    if stage == "pre-main-sequence":
        return 1
    if stage in ("zams", "main-sequence", "terminal-main-sequence"):
        return 2 if cls in ("O", "B") else 3
    if stage == "white-dwarf":
        return 7
    if stage == "post-agb":
        return 6
    return 5


def g8_k2(sp: str) -> bool:
    m = re.match(r"^([GK])(\d(?:\.\d)?)", sp.strip())
    if not m:
        return False
    v = float(m.group(2))
    return (m.group(1) == "G" and v >= 8) or (m.group(1) == "K" and v <= 2)


# ───────────────────────────── physics ─────────────────────────────

BC_COEF = [  # Torres 2010 Table 1 (Flower 1996 BC_V, corrected)
    (3.70, [-0.190537291496456E+05, 0.155144866764412E+05, -0.421278819301717E+04, 0.381476328422343E+03]),
    (3.90, [-0.370510203809015E+05, 0.385672629965804E+05, -0.150651486316025E+05, 0.261724637119416E+04,
            -0.170623810323864E+03]),
    (9.99, [-0.118115450538963E+06, 0.137145973583929E+06, -0.636233812100225E+05, 0.147412923562646E+05,
            -0.170587278406872E+04, 0.788731721804990E+02]),
]
TEFF_BV_DWARF_GIANT = [3.979145106714099, -0.654992268598245, 1.740690042385095, -4.608815154057166,
                       6.792599779944473, -5.396909891322525, 2.192970376522490, -0.359495739295671]
TEFF_BV_SUPERGIANT = [4.012559732366214, -1.055043117465989, 2.133394538571825, -2.459769794654992,
                      1.349423943497744, -0.283942579112032]


def poly(c: list[float], x: float) -> float:
    return sum(a * x ** i for i, a in enumerate(c))


def bc_v(teff: float) -> float:
    lt = math.log10(teff)
    for lim, c in BC_COEF:
        if lt < lim:
            return poly(c, lt)
    return poly(BC_COEF[-1][1], lt)


def teff_from_bv(bv: float, supergiant: bool) -> float | None:
    """Flower 1996 / Torres 2010 Table 2. Valid colour window kept conservative (unreddened assumption)."""
    if supergiant:
        if not (-0.25 <= bv <= 1.75):
            return None
        return 10 ** poly(TEFF_BV_SUPERGIANT, bv)
    if not (-0.25 <= bv <= 1.65):
        return None
    return 10 ** poly(TEFF_BV_DWARF_GIANT, bv)


def sig(x: float, n: int) -> float:
    if x == 0 or not math.isfinite(x):
        return x
    d = n - int(math.floor(math.log10(abs(x)))) - 1
    r = round(x, d)
    return int(r) if d <= 0 else r


def fv(value, unit, source, method, note=None, lo=None, hi=None, digits=None) -> dict:
    """Build a FactValue; rounding is monotonic so min ≤ value ≤ max survives."""
    rd = (lambda x: sig(x, digits)) if digits else (lambda x: x)
    out = {"value": rd(value)}
    if lo is not None and hi is not None:
        lo2, hi2 = rd(min(lo, hi)), rd(max(lo, hi))
        if lo2 <= out["value"] <= hi2 and lo2 != hi2:
            out["min"], out["max"] = lo2, hi2
    out.update({"unit": unit, "sourceId": source, "method": method})
    if note:
        out["note"] = note
    return out


def robust_median(vals: list[float]) -> tuple[float, list[float]]:
    med = statistics.median(vals)
    mad = statistics.median([abs(v - med) for v in vals])
    mad = max(mad, 0.01 * abs(med), 1e-6)
    keep = [v for v in vals if abs(v - med) <= 3 * mad]
    return statistics.median(keep), keep


# ───────────────────────────── variability ─────────────────────────────

def var_class(code: str, period: float | None) -> str | None:
    c = code.upper().replace(":", "")
    c = re.split(r"[+|/]", c)[0].strip()
    if c.startswith("EA"):
        return "eclipsing-long-period" if (period and period >= 100) else "eclipsing-algol"
    if c.startswith(("EB", "EW")):
        return "eclipsing-beta-lyrae"
    if c in ("E", "EP"):
        return "eclipsing-algol"
    if c.startswith(("DCEP", "CEP", "CW", "ACEP")):
        return "cepheid"
    if c.startswith("RR"):
        return "rr-lyrae"
    if c.startswith(("DSCT", "SXPHE", "GDOR")):
        return "delta-scuti"
    if c.startswith(("BCEP", "SPB")):
        return "beta-cephei"
    if c == "M":
        return "mira"
    if c.startswith(("SR", "LPV")):
        return "semiregular"
    if c.startswith("RV"):
        return "rv-tauri"
    if c.startswith(("GCAS", "BE")):
        return "gamma-cas-be"
    if c.startswith(("RCB", "DYPER")):
        return "r-crb"
    if c.startswith("NR"):
        return "recurrent-nova"
    if c.startswith(("UG", "NL", "ZAND")):
        return "dwarf-nova"
    if c.startswith(("ACV", "SXARI")):
        return "alpha2-cvn"
    if c.startswith(("SDOR", "LBV")):
        return "lbv"
    if c.startswith(("IN", "IS", "FUOR", "UXOR", "YSO", "TTS", "CTTS", "WTTS", "EXOR")):
        return "young-stellar-object"
    if c.startswith(("ELL", "ROT", "BY", "RS", "FKCOM")):
        return "rotational"
    if c.startswith(("L", "I", "WR", "VAR", "MISC", "*")):
        return "irregular"
    return None


VOLATILE = {"mira", "semiregular", "irregular", "r-crb", "recurrent-nova", "dwarf-nova", "lbv",
            "young-stellar-object", "gamma-cas-be", "yellow-hypergiant"}
ERUPTIVE = {"recurrent-nova", "dwarf-nova", "lbv", "young-stellar-object"}
MAX_LIGHT_CLASSES = {"mira", "semiregular", "rv-tauri", "cepheid", "rr-lyrae", "delta-scuti", "beta-cephei",
                     "eclipsing-algol", "eclipsing-beta-lyrae", "eclipsing-long-period"}
VISUAL_BANDS = {"V", "VIS", "VIS.", "HP", "TESS", "CV", "G", "Y", ""}


def name_key(s: str) -> str:
    s = s.lower().replace("v* ", "").replace("* ", "")
    s = re.sub(r"\bv0+(\d)", r"v\1", s)
    s = re.sub(r"([a-z]{2,3})0(\d)\b", r"\1\2", s)   # alf01 -> alf1 (VSX/GCVS spellings vary)
    return re.sub(r"[\s.]", "", s)


def pick_variability(vsx_rows, gcvs_rows, idkeys: set[str], gcvs_names: set[str]) -> dict | None:
    def match(rows, field):
        named = [r for r in rows if name_key(r.get(field, "")) in idkeys]
        if named:
            return named[0], "name"
        close = [r for r in rows if rdist(r) <= 3.0]
        return (close[0], "position≤3″") if close else (None, None)

    vsx, vhow = match([r for r in vsx_rows if r.get("V", "0") == "0"], "Name")
    gc, ghow = match(gcvs_rows, "GCVS")
    if gc is not None and ghow != "name" and gcvs_names and name_key(gc.get("GCVS", "")) not in gcvs_names:
        gc = None

    def decode(row, src):
        if src == "vsx":
            mx, mn, amp_flag = num(row.get("max")), num(row.get("min")), row.get("f_min", "") == "("
            band, per, code, name = row.get("n_max", ""), num(row.get("Period")), row.get("Type", ""), row.get("Name", "")
        else:
            mx, mn, amp_flag = num(row.get("magMax")), num(row.get("Min1")), row.get("n_Min1", "") == "("
            band, per, code, name = row.get("flt", ""), num(row.get("Period")), row.get("VarType", ""), row.get("GCVS", "")
        if mx is None:
            return None
        if mn is not None and amp_flag:
            mn = mx + mn
        return {"max": mx, "min": mn, "band": band.strip(), "period": per if per and per > 0 else None,
                "code": code.strip(), "name": name.strip(), "src": src}

    a = decode(vsx, "vsx") if vsx is not None else None
    b = decode(gc, "gcvs") if gc is not None else None
    if a is None and b is None:
        return None
    best = a or b
    other = b if best is a else None
    if best["period"] is None and other and other["period"]:
        best = {**best, "period": other["period"], "periodSrc": "gcvs"}
    best["alt"] = other
    best["how"] = vhow if best["src"] == "vsx" else ghow
    return best


# ───────────────────────────── main build ─────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="never touch the network; fail on cache miss")
    ap.add_argument("--refresh", action="store_true", help="re-query every source and rewrite the cache")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    f = Fetcher("offline" if args.offline else "refresh" if args.refresh else "cache")

    olist = json.loads(OBJECT_LIST.read_text())
    stars = [o for o in olist["objects"] if o["kind"] == "star"]
    bsc_short = {int(s["HR"]): s for s in json.loads((DATA / "bsc5-short.json").read_text())}
    media = json.loads(MEDIA.read_text())
    DS_CATALOG.update({x["id"]: x for x in json.loads((DATA / "binocular-catalog.json").read_text())
                       if str(x.get("id", "")).startswith("DS-")})

    # 1. BSC5 V/50 (whole catalog: V, B−V, SpType, HD)
    v50 = vizier(f, "bsc5-v50.json", [("-source", "V/50/catalog"), ("-out", "HR,Name,HD,Vmag,B-V,SpType,MultID,VarID"),
                                       ("-out.max", "unlimited")])
    v50 = {int(r["HR"]): r for r in v50 if r.get("HR", "").strip().isdigit()}

    # 2. SIMBAD bulk HR dump (parallaxes for the HR background; doc 02 §4.1)
    bulk = tap_json(f, "simbad-hr-bulk.json",
                    "SELECT i.id AS hr, b.plx_value, b.plx_err, b.plx_bibcode FROM ident AS i "
                    "JOIN basic AS b ON b.oid=i.oidref WHERE i.id LIKE 'HR %'")
    bulk_by_hr: dict[int, dict] = {}
    for r in bulk:
        m = re.match(r"HR\s+(\d+)$", r["hr"])
        if m:
            bulk_by_hr[int(m.group(1))] = r

    # 3. SIMBAD details for our stars
    ident_for: dict[str, str] = {}
    for o in stars:
        ident_for[o["id"]] = IDENT_OVERRIDE.get(o["id"]) or (f"HR {o['hr']}" if o.get("hr") else o.get("simbad"))
        if not ident_for[o["id"]]:
            raise SystemExit(f"no SIMBAD identifier for {o['id']}")
    idents = sorted(set(ident_for.values()))
    simbad_rows: dict[str, dict] = {}
    for k in range(0, len(idents), 80):
        chunk = idents[k:k + 80]
        lst = ",".join("'" + i.replace("'", "''") + "'" for i in chunk)
        rows = tap_json(f, f"simbad-targets-{k // 80:02d}.json",
                        "SELECT i.id AS qid, b.oid, b.main_id, b.ra, b.dec, b.pmra, b.pmdec, b.sp_type, b.sp_bibcode, "
                        "b.plx_value, b.plx_err, b.plx_bibcode, b.otype, b.rvz_radvel, b.rvz_bibcode, f.V, f.B, ids.ids "
                        "FROM ident AS i JOIN basic AS b ON b.oid=i.oidref LEFT JOIN allfluxes AS f ON f.oidref=b.oid "
                        f"LEFT JOIN ids ON ids.oidref=b.oid WHERE i.id IN ({lst})")
        for r in rows:
            simbad_rows[norm_ws(r["qid"])] = r
    missing = [i for i in idents if norm_ws(i) not in simbad_rows]
    if missing:
        print(f"WARNING: SIMBAD did not resolve {missing}", file=sys.stderr)

    def sim(o) -> dict | None:
        return simbad_rows.get(norm_ws(ident_for[o["id"]]))

    # 4. mesFe_h (Teff, [Fe/H]) for our stars
    oids = sorted({int(sim(o)["oid"]) for o in stars if sim(o)})
    mes: dict[int, list[dict]] = {}
    for k in range(0, len(oids), 150):
        chunk = oids[k:k + 150]
        rows = tap_json(f, f"simbad-mesfeh-{k // 150:02d}.json",
                        "SELECT oidref, teff, log_g, fe_h, bibcode FROM mesFe_h WHERE oidref IN (" + ",".join(map(str, chunk)) + ")")
        for r in rows:
            mes.setdefault(int(r["oidref"]), []).append(r)

    # identifiers
    def ids_of(o) -> list[str]:
        s = sim(o)
        return [norm_ws(x) for x in (s["ids"] or "").split("|")] if s else []

    def ident_num(ids: list[str], prefix: str) -> str | None:
        for i in ids:
            if i.startswith(prefix):
                return i[len(prefix):].strip()
        return None

    # 5. Hipparcos 2007 + Gaia DR3
    hips = sorted({h for o in stars if (h := lead_int(ident_num(ids_of(o), "HIP ")))})
    hip_rows = {int(r["hip"]): r for r in tap_csv(f, "hip2007.json", GAIA_TAP,
                "SELECT hip, plx, e_plx, hp_mag, b_v FROM public.hipparcos_newreduction WHERE hip IN (" + ",".join(map(str, hips)) + ")")}
    gids = sorted({g for o in stars if (g := ident_num(ids_of(o), "Gaia DR3 "))})
    gaia_rows = {r["source_id"]: r for r in tap_csv(f, "gaiadr3.json", GAIA_TAP,
                 "SELECT source_id, parallax, parallax_error, ruwe, phot_g_mean_mag FROM gaiadr3.gaia_source "
                 "WHERE source_id IN (" + ",".join(gids) + ")")}

    # 6. exoplanet hosts
    exo = tap_csv(f, "exoplanets.json", EXO_TAP,
                  "select pl_name,hostname,hd_name,hip_name,disc_year,discoverymethod,sy_vmag from pscomppars where sy_vmag < 10")

    # 7. per-star VizieR cone/ID queries (parallel)
    def per_star(o):
        s = sim(o)
        if not s:
            return o["id"], {}
        ra, dec = float(s["ra"]), float(s["dec"])
        c = f"{ra:.6f}{dec:+.6f}"
        out = {}
        out["jmdc"] = vizier(f, f"jmdc/{o['id']}.json", [("-source", "II/345/jmdc"), ("-c", c), ("-c.rs", "10"),
                             ("-out", "ID1,ID2,UDdiam,LDdiam,e_LDdiam,Band,BibCode,SimbadName"), ("-out.add", "_r"), ("-sort", "_r")])
        out["jsdc"] = vizier(f, f"jsdc/{o['id']}.json", [("-source", "II/346/jsdc_v2"), ("-c", c), ("-c.rs", "10"),
                             ("-out", "Name,SpType,Vmag,LDD,e_LDD,LDDCHI,CalFlag,SimbadName"), ("-out.add", "_r"), ("-sort", "_r")])
        out["vsx"] = vizier(f, f"vsx/{o['id']}.json", [("-source", "B/vsx/vsx"), ("-c", c), ("-c.rs", "30"),
                            ("-out", "Name,V,Type,max,n_max,f_min,min,n_min,Period,Sp"), ("-out.add", "_r"), ("-sort", "_r")])
        if any(i.startswith("V* ") for i in ids_of(o)):
            out["gcvs"] = vizier(f, f"gcvs/{o['id']}.json", [("-source", "B/gcvs/gcvs_cat"), ("-c", c), ("-c.rs", "60"),
                                 ("-out", "GCVS,VarType,magMax,Min1,n_Min1,flt,Period,SpType"), ("-out.add", "_r"), ("-sort", "_r")])
        wds = next((i for i in ids_of(o) if i.startswith("WDS J")), None)
        if wds:
            code = re.match(r"WDS J(\d{5}[+-]\d{4})", wds)
            if code:
                out["wds"] = vizier(f, f"wds/{code.group(1)}.json", [("-source", "B/wds/wds"), ("WDS", code.group(1)),
                                    ("-out", "WDS,Disc,Comp,Obs2,pa2,sep2,mag1,mag2,SpType,pmRA1,pmDE1,pmRA2,pmDE2,Notes")])
        return o["id"], out

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        viz = dict(pool.map(per_star, stars))

    retrieved = max(f.dates) if f.dates else date.today().isoformat()
    registry = sources_registry(retrieved)

    records = []
    for o in stars:
        records.append(build_record(o, sim(o), ids_of(o), bsc_short, v50, mes, hip_rows, gaia_rows, exo, viz[o["id"]], media))

    used = sorted({sid for r in records for sid in r["sources"]})
    coverage = coverage_table(records)
    OUT_AUTO.parent.mkdir(parents=True, exist_ok=True)
    OUT_AUTO.write_text(json.dumps({
        "version": f"stars.auto-{retrieved}",
        "generatedBy": "script/journeys/build_stars_auto.py",
        "pipelineVersion": PIPELINE_VERSION,
        "notes": ("Auto (catalog) tier. Curated files override field by field (README.md). The per-record `auto` block is "
                  "build diagnostics (ids, distance tier, curator flags) and is stripped by the KB schema."),
        "coverage": coverage,
        "sources": [registry[s] for s in used],
        "objects": records,
    }, ensure_ascii=False, indent=1) + "\n")

    hr = build_hr_background(v50, bulk_by_hr, retrieved)
    OUT_HR.parent.mkdir(parents=True, exist_ok=True)
    OUT_HR.write_text(json.dumps(hr, ensure_ascii=False, separators=(",", ":")) + "\n")

    print(f"wrote {OUT_AUTO.relative_to(ROOT)} ({len(records)} stars, {OUT_AUTO.stat().st_size // 1024} KB); "
          f"{OUT_HR.relative_to(ROOT)} ({hr['count']} stars, {OUT_HR.stat().st_size // 1024} KB); "
          f"network requests: {f.network}")
    print_coverage(coverage, len(records))


def build_record(o, s, ids, bsc_short, v50, mes, hip_rows, gaia_rows, exo, viz, media) -> dict:
    srcs: set[str] = set()
    flags: list[str] = []
    facts: dict[str, dict] = {}
    hr = o.get("hr")
    b = v50.get(hr) if hr else None
    auto: dict = {"simbadOid": int(s["oid"]) if s else None, "otype": s["otype"] if s else None}

    def ident(prefix):
        for i in ids:
            if i.startswith(prefix):
                return i[len(prefix):].strip()
        return None

    hd = ident("HD ")
    hip = ident("HIP ")
    gaia_id = ident("Gaia DR3 ")
    auto.update({"hd": lead_int(hd) or (lead_int(b.get("HD")) if b else None), "hip": lead_int(hip), "gaiaDr3": gaia_id})

    rec: dict = {"id": o["id"], "kind": "star"}
    if hr:
        rec["hr"] = hr

    # names
    names = {"display": o["name"], "aliases": aliases_from_ids(ids)}
    desig = designation_from_ids(ids)
    if desig and desig != o["name"]:
        names["designation"] = desig
    if s:
        names["simbadId"] = norm_ws(s["main_id"])
        srcs.add("simbad")
    rec["names"] = names
    rec["con"] = o["con"]

    # position: BSC stars from bsc5-short.json (single source of truth), others from the master list
    if hr and hr in bsc_short:
        rec["ra"], rec["dec"] = round(sexa_ra(bsc_short[hr]["RA"]), 5), round(sexa_dec(bsc_short[hr]["Dec"]), 5)
    else:
        rec["ra"], rec["dec"] = o["ra"], o["dec"]
        if s and s.get("pmra") is not None:
            rec["pmRA"], rec["pmDec"] = round(float(s["pmra"]), 3), round(float(s["pmdec"]), 3)

    # photometry
    v_bsc = num(b.get("Vmag")) if b else None
    v_sim = num(s.get("V")) if s else None
    vmag, vsrc = (v_bsc, "bsc5") if v_bsc is not None else (v_sim, "simbad") if v_sim is not None else (o.get("mag"), "object-list")
    bv_b = num(b.get("B-V")) if b else None
    if bv_b is not None:
        facts["bv"] = fv(bv_b, "mag", "bsc5", "catalog")
        srcs.add("bsc5")
    elif s and num(s.get("B")) is not None and v_sim is not None:
        facts["bv"] = fv(round(num(s["B"]) - v_sim, 2), "mag", "simbad", "catalog", note="B and V from SIMBAD (mixed sources)")
    bv = facts.get("bv", {}).get("value")

    # spectral type
    sp_text = (s.get("sp_type") if s else None) or (b.get("SpType") if b else None)
    cls = lum = None
    if sp_text:
        cls, lum = parse_sptype(sp_text)
        if cls:
            spec = {"text": sp_text, "class": cls, "sourceId": "simbad" if s and s.get("sp_type") else "bsc5"}
            if lum:
                spec["lumClass"] = lum
            rec["spectral"] = spec
            srcs.add(spec["sourceId"])
    carbon = cls in ("C", "S") or (s and s.get("otype") in ("C*", "S*"))

    # variability (needed before distance flags and mag)
    idkeys = {name_key(i) for i in ids}
    gcvs_names = {name_key(i) for i in ids if i.startswith("V* ")}
    var = pick_variability(viz.get("vsx", []), viz.get("gcvs", []), idkeys, gcvs_names)
    vclass = None
    amp = None
    if var:
        vclass = var_class(var["code"], var["period"])
        amp = (var["min"] - var["max"]) if var["min"] is not None else None
        band = var["band"].upper()
        auto["variabilityMatch"] = f"{var['src']}:{var['name']} ({var['how']})"
        notable = vclass not in (None, "irregular", "rotational") or (amp is not None and amp >= 0.1)
        if vclass and (amp is None or amp >= 0.1) and notable:
            v = {"class": vclass, "gcvsType": var["code"], "vMax": var["max"],
                 "vMin": var["min"] if var["min"] is not None else var["max"],
                 "binocularVisibleAtMin": (var["min"] if var["min"] is not None else var["max"]) <= 9.0,
                 "volatile": vclass in VOLATILE, "sourceId": var["src"]}
            if var["period"]:
                v["periodDays"] = var["period"]
            rec["variability"] = v
            srcs.add(var["src"])
            bnote = f"{band or '?'} band" + ("" if band in VISUAL_BANDS else " (not visual: compare with care)")
            facts["vMax"] = fv(var["max"], "mag", var["src"], "catalog", note=f"maximum, {bnote}")
            if var["min"] is not None:
                facts["vMin"] = fv(var["min"], "mag", var["src"], "catalog", note=f"minimum, {bnote}")
            if var["period"]:
                psrc = var.get("periodSrc", var["src"])
                facts["periodDays"] = fv(var["period"], "d", psrc, "catalog")
                srcs.add(psrc)
            if var.get("alt"):
                srcs.add(var["alt"]["src"])
                auto["variabilityAlt"] = {k: var["alt"][k] for k in ("src", "name", "code", "max", "min", "period")}
            if vclass in VOLATILE:
                flags.append("volatile-variable: cards must not state current brightness")
        else:
            auto["minorVariability"] = {k: var[k] for k in ("src", "name", "code", "max", "min", "period")}

    # Eruptive stars: the BSC lists outburst light (T CrB 2.0); use SIMBAD's quiescent V for distance policy and M_V.
    if vclass in ERUPTIVE and v_sim is not None and vsrc == "bsc5" and vmag is not None and abs(v_sim - vmag) > 1.0:
        auto["vmagRule"] = f"quiescent SIMBAD V {v_sim} replaces BSC V {vmag} (eruptive variable)"
        vmag, vsrc = v_sim, "simbad"
    if vmag is None and var:
        vmag, vsrc = var["max"], var["src"]
        auto["vmagRule"] = "no catalog V; variability maximum used"

    # reference magnitude: max light for large-amplitude periodic variables (types.ts), catalog V otherwise
    mag = vmag
    if "variability" in rec and amp is not None and amp >= 1.0 and vclass in MAX_LIGHT_CLASSES \
            and var["band"].upper() in VISUAL_BANDS:
        mag = var["max"]
        auto["magRule"] = "max light (periodic variable, amplitude ≥ 1 mag)"
    rec["mag"] = mag if mag is None else round(mag, 3)
    if vsrc in ("bsc5", "simbad", "vsx", "gcvs"):
        srcs.add(vsrc)

    # distance (doc 02 S4)
    hip_r = hip_rows.get(auto["hip"]) if auto["hip"] else None
    gaia_r = gaia_rows.get(gaia_id) if gaia_id else None
    hip_p = (num(hip_r["plx"]), num(hip_r["e_plx"])) if hip_r else (None, None)
    g_p = (num(gaia_r["parallax"]), num(gaia_r["parallax_error"])) if gaia_r else (None, None)
    g_ruwe = num(gaia_r["ruwe"]) if gaia_r else None

    def rel(p):
        return (p[1] / p[0]) if p[0] and p[0] > 0 and p[1] is not None else math.inf

    gaia_ok = g_p[0] is not None and g_ruwe is not None and g_ruwe < 1.4 and rel(g_p) < 0.1
    choice = None
    if vmag is not None and vmag < 5.5:
        if hip_p[0] is not None:
            choice = ("hip2007", hip_p, "Hipparcos 2007 (V < 5.5)")
        if (choice is None or rel(hip_p) >= 0.1) and gaia_ok:
            choice = ("gaiadr3", g_p, f"Gaia DR3 fallback (Hipparcos σϖ/ϖ ≥ 10 %; RUWE {g_ruwe:.2f})")
    else:
        if gaia_ok:
            choice = ("gaiadr3", g_p, f"Gaia DR3 (RUWE {g_ruwe:.2f})")
        elif hip_p[0] is not None:
            why = "no Gaia DR3 astrometry" if g_p[0] is None else f"Gaia DR3 rejected (RUWE {g_ruwe}, σϖ/ϖ {rel(g_p):.0%})"
            choice = ("hip2007", hip_p, f"Hipparcos 2007 ({why})")
    lum_fam = lum_family(lum)
    needs_lit = (vmag is not None and vmag <= 2.0) or lum_fam in ("super", "hyper") or vclass == "mira" or carbon \
        or (s and s.get("otype") in ("Mi*", "AB*", "s*r", "s*y", "s*b"))
    dist = None  # (pc, lo_pc, hi_pc, relerr)
    if choice:
        src, (p, e), why = choice
        r_ = rel((p, e))
        auto["distance"] = {"tier": src, "plxMas": p, "plxErrMas": e, "relErr": round(r_, 4) if math.isfinite(r_) else None,
                            "rule": why, "uncertain": r_ >= 0.1, "needsLiterature": bool(needs_lit)}
        if p and p > 0 and r_ < 0.5:
            d = 1000 / p
            lo, hi = 1000 / (p + e), 1000 / (p - e)
            dist = (d, lo, hi, r_)
            digits = 3 if r_ < 0.1 else 2
            note = f"1/ϖ, ϖ = {p:g} ± {e:g} mas; {why}"
            if r_ >= 0.1:
                note = f"UNCERTAIN (σϖ/ϖ = {r_:.0%}); " + note
                flags.append("distance-uncertain")
            if needs_lit:
                note += "; curate a literature distance (supergiant/AGB/V ≤ 2 policy)"
                flags.append("distance-needs-literature")
            facts["distanceLy"] = fv(d * LY_PER_PC, "ly", src, "derived", note=note, lo=lo * LY_PER_PC, hi=hi * LY_PER_PC, digits=digits)
            srcs.add(src)
        else:
            flags.append("distance-omitted: parallax missing, non-positive or σϖ/ϖ ≥ 50 %")
    else:
        flags.append("distance-omitted: no usable parallax")
        auto["distance"] = {"tier": None, "needsLiterature": bool(needs_lit)}
    if "distanceLy" not in facts and g_p[0] and g_p[0] > 0 and rel(g_p) < 0.1 and not gaia_ok:
        flags.append(f"gaia-rejected-by-policy: ϖ = {g_p[0]:.3f} ± {g_p[1]:.3f} mas but RUWE {g_ruwe:.2f} ≥ 1.4 "
                     "(binary/saturation); curate a literature distance")
    if gaia_r:
        auto["gaia"] = {"plx": g_p[0], "plxErr": g_p[1], "ruwe": g_ruwe, "G": num(gaia_r["phot_g_mean_mag"])}

    # absolute magnitude (A_V = 0)
    mv = None
    if dist and vmag is not None:
        d, lo, hi, r_ = dist
        mv = vmag - 5 * math.log10(d / 10)
        note = f"M_V = V − 5 log₁₀(d/10 pc), V = {vmag} ({vsrc}), extinction ignored" + (" (d > 75 pc: A_V may matter)" if d > 75 else "")
        facts["absMagV"] = fv(round(mv, 2), "mag", auto["distance"]["tier"], "derived", note=note,
                              lo=round(vmag - 5 * math.log10(hi / 10), 2), hi=round(vmag - 5 * math.log10(lo / 10), 2))

    # Teff
    teff = None
    entries = mes.get(int(s["oid"]), []) if s else []
    tvals = [(num(r["teff"]), r["bibcode"]) for r in entries if num(r["teff"])]
    recent = [(t, bc) for t, bc in tvals if bc and bc[:4].isdigit() and int(bc[:4]) >= 2000]
    pool = recent or tvals
    if pool:
        med, keep = robust_median([t for t, _ in pool])
        teff = med
        years = sorted(bc[:4] for _, bc in pool if bc)
        note = (f"median of {len(keep)}/{len(pool)} mesFe_h determinations "
                f"({'2000+' if recent else 'all years'}; {years[0]}–{years[-1]}), 3-MAD filtered")
        facts["teffK"] = fv(round(med), "K", "simbad-mesfeh", "catalog", note=note,
                            lo=round(min(keep)) if len(keep) > 1 else None, hi=round(max(keep)) if len(keep) > 1 else None)
        srcs.add("simbad-mesfeh")
        fe = [num(r["fe_h"]) for r in (entries if not recent else [r for r in entries if r["bibcode"] and r["bibcode"][:4].isdigit() and int(r["bibcode"][:4]) >= 2000])
              if num(r["fe_h"]) is not None]
        if fe:
            fmed, fkeep = robust_median(fe)
            facts["feH"] = fv(round(fmed, 2), "dex", "simbad-mesfeh", "catalog", note=f"median of {len(fkeep)} [Fe/H] determinations",
                              lo=round(min(fkeep), 2) if len(fkeep) > 1 else None, hi=round(max(fkeep), 2) if len(fkeep) > 1 else None)
    elif bv is not None and not carbon and cls not in ("M", "W", "D") and not (amp is not None and amp >= 0.5) \
            and not (s and s.get("otype") in AGB_OTYPES):
        # B−V saturates for M stars and is phase-dependent for large-amplitude variables: leave those to curation.
        t = teff_from_bv(bv, lum_fam in ("super", "hyper", "bright"))
        if t:
            teff = t
            facts["teffK"] = fv(t, "K", "torres2010", "derived", digits=2,
                                note=f"from B−V = {bv} via Flower 1996 ({'supergiant' if lum_fam in ('super', 'hyper', 'bright') else 'dwarf/giant'} relation, Torres 2010 coefficients); reddening ignored")
            srcs.add("torres2010")
            flags.append("teff-from-colour")
    if teff is None:
        flags.append("teff-missing")

    # angular diameter
    theta = None
    jm = viz.get("jmdc", [])
    if jm:
        nearest = jm[0].get("SimbadName", "")
        jm = [r for r in jm if r.get("SimbadName", "") == nearest and rdist(r) <= 5]
    ld = [(num(r["LDdiam"]), num(r.get("e_LDdiam")), r.get("Band", ""), r.get("BibCode", "")) for r in jm if num(r.get("LDdiam"))]
    ud = [(num(r["UDdiam"]), num(r.get("e_LDdiam")), r.get("Band", ""), r.get("BibCode", "")) for r in jm if num(r.get("UDdiam"))]
    js = [r for r in viz.get("jsdc", []) if rdist(r) <= 5]
    # JSDC CalFlag bits (VizieR II/346 note 3): 1 = LDD χ² > 5, 2 = WDS double < 1″, 4 = variable/binary otype.
    # Reject bit 1 and carbon/S/AGB stars (surface-brightness relation unreliable); annotate bits 2 and 4.
    agb_like = carbon or (s and s.get("otype") in AGB_OTYPES)
    js_ok = [r for r in js if num(r.get("LDD")) and not (int(num(r.get("CalFlag")) or 0) & 1)
             and (num(r.get("LDDCHI")) or 0) <= 5 and not agb_like]
    if ld:
        vals = [x[0] for x in ld]
        theta = statistics.median(vals)
        bands = sorted({x[2] for x in ld if x[2]})
        facts["angularDiameterMas"] = fv(sig(theta, 3), "mas", "jmdc", "catalog", lo=min(vals), hi=max(vals),
                                         note=f"limb-darkened; median of {len(vals)} measurement(s) ({', '.join(bands) or 'band n/a'})")
        srcs.add("jmdc")
    elif js_ok:
        r = js_ok[0]
        theta, e = num(r["LDD"]), num(r.get("e_LDD")) or 0
        cal = int(num(r.get("CalFlag")) or 0)
        caveat = "; ".join(x for bit, x in ((2, "close double < 1″"), (4, "variable or binary star")) if cal & bit)
        facts["angularDiameterMas"] = fv(sig(theta, 3), "mas", "jsdc2", "catalog", lo=sig(theta - e, 3) if e else None,
                                         hi=sig(theta + e, 3) if e else None,
                                         note="predicted from photometry (surface-brightness relation)" + (f"; caveat: {caveat}" if caveat else ""))
        srcs.add("jsdc2")
    elif ud:
        vals = [x[0] for x in ud]
        theta = statistics.median(vals)
        facts["angularDiameterMas"] = fv(sig(theta, 3), "mas", "jmdc", "catalog", lo=min(vals), hi=max(vals),
                                         note=f"uniform-disk (underestimates true size by a few %); median of {len(vals)}")
        srcs.add("jmdc")
    if js and not js_ok and not ld:
        auto["jsdcRejected"] = {"LDD": num(js[0].get("LDD")), "CalFlag": js[0].get("CalFlag"), "chi2": num(js[0].get("LDDCHI"))}

    # luminosity (derived)
    lsun = None
    var_amp_big = amp is not None and amp >= 1.0 and "variability" in rec
    if mv is not None and teff and dist and dist[3] < 0.2 and teff >= 3300 and not carbon and not var_amp_big:
        bc = bc_v(teff)
        logl = -0.4 * (mv + bc - MBOL_SUN)
        lo_mv, hi_mv = facts["absMagV"].get("min", mv), facts["absMagV"].get("max", mv)
        lsun = 10 ** logl
        facts["lumLsun"] = fv(lsun, "Lsun", "torres2010", "derived", digits=3,
                              lo=10 ** (-0.4 * (hi_mv + bc - MBOL_SUN)), hi=10 ** (-0.4 * (lo_mv + bc - MBOL_SUN)),
                              note=f"log L = −0.4(M_V + BC_V − 4.73), BC_V({round(teff)} K) = {bc:.2f}; A_V = 0")
        srcs.add("torres2010")
    elif mv is not None and teff:
        why = ("Teff < 3300 K" if teff < 3300 else "carbon/S star" if carbon else "large-amplitude variable" if var_amp_big
               else "distance σ ≥ 20 %")
        auto["lumSkipped"] = why

    # radius (derived)
    if theta and dist and dist[3] < 0.2:
        d, lo, hi, _ = dist
        tf = facts["angularDiameterMas"]
        r = theta * d / RSUN_MAS_AT_1PC
        facts["radiusRsun"] = fv(r, "Rsun", tf["sourceId"], "derived", digits=3,
                                 lo=tf.get("min", theta) * lo / RSUN_MAS_AT_1PC, hi=tf.get("max", theta) * hi / RSUN_MAS_AT_1PC,
                                 note=f"R = θ·d / 9.305 (θ {sig(theta, 3)} mas, d {sig(d, 3)} pc from {auto['distance']['tier']})")
    elif lsun and teff:
        r = math.sqrt(lsun) * (TEFF_SUN / teff) ** 2
        lf = facts["lumLsun"]
        facts["radiusRsun"] = fv(r, "Rsun", "torres2010", "derived", digits=2,
                                 lo=math.sqrt(lf.get("min", lsun)) * (TEFF_SUN / teff) ** 2,
                                 hi=math.sqrt(lf.get("max", lsun)) * (TEFF_SUN / teff) ** 2,
                                 note="Stefan–Boltzmann R = √L·(5772 K/Teff)²; L and Teff as above")
    # consistency check (doc 02 §5 validate)
    if lsun and teff and "radiusRsun" in facts and facts["radiusRsun"]["note"].startswith("R = θ"):
        r = facts["radiusRsun"]["value"]
        lsb = r * r * (teff / TEFF_SUN) ** 4
        if abs(math.log10(lsb / lsun)) > 0.3:
            flags.append(f"L-R-Teff inconsistent by {math.log10(lsb / lsun):+.2f} dex (check distance/extinction/Teff)")

    # kinematics
    if s and s.get("pmra") is not None and s.get("pmdec") is not None:
        pm = math.hypot(float(s["pmra"]), float(s["pmdec"]))
        facts["properMotionMasYr"] = fv(sig(pm, 4), "mas/yr", "simbad", "catalog")
    if s and s.get("rvz_radvel") is not None:
        facts["radialVelocityKms"] = fv(round(float(s["rvz_radvel"]), 2), "km/s", "simbad", "catalog",
                                        note=f"SIMBAD ({s.get('rvz_bibcode') or 'bibcode n/a'})")

    # multiplicity (WDS)
    comp_letter = None
    wid = next((i for i in ids if i.startswith("WDS J")), None)
    if wid:
        m = re.match(r"WDS J\d{5}[+-]\d{4}(\S*)", wid)
        comp_letter = (m.group(1) or "A") if m else "A"
    pairs, close = [], []
    # Existing DS-* targets name their own pair in binocular-catalog.json; keep that pair even when the companion is
    # fainter than 9.0 (Winnecke 4 B ≈ 10), matched by separation (±25 %) and magnitude (±1.5).
    cat_sep = num((DS_CATALOG.get(o["id"]) or {}).get("sep"))
    cat_m2 = num((DS_CATALOG.get(o["id"]) or {}).get("mag2"))
    for r in viz.get("wds", []):
        comp = r.get("Comp", "").strip() or "AB"
        parts = [p for p in re.split(r"[,]", comp) if p] if "," in comp else ([comp[0], comp[1:]] if len(comp) >= 2 else [comp])
        mine = comp_letter[0] if comp_letter else "A"
        if not any(p.startswith(mine) for p in parts):
            continue
        sep, m1, m2 = num(r.get("sep2")), num(r.get("mag1")), num(r.get("mag2"))
        notes = r.get("Notes", "")
        disc = r.get("Disc", "")
        if sep is None:
            continue
        if sep < 3.0:
            close.append(f"{comp} {sep:g}″")
            continue
        if sep >= 999.9:      # WDS field maximum: a placeholder for very wide pairs, not a measured separation
            continue
        named_pair = (cat_sep is not None and cat_m2 is not None and m2 is not None
                      and abs(sep - cat_sep) <= 0.25 * cat_sep and abs(m2 - cat_m2) <= 1.5)
        if m2 is None or (m2 > 9.0 and not named_pair) or disc.startswith(("SHY", "SMR")) or "X" in notes:
            continue
        physical = ("bound" if ("O" in notes or "C" in notes) else "common-proper-motion" if any(c in notes for c in "TVZ")
                    else "optical" if any(c in notes for c in "SUY") else "unknown")
        pairs.append({"pair": comp, "sepArcsec": sep, "paDeg": num(r.get("pa2")) or 0, "epoch": int(num(r.get("Obs2")) or 0),
                      "magPrimary": m1 if m1 is not None else (vmag or 0), "magSecondary": m2, "physical": physical,
                      "sourceId": "wds", "_disc": disc, "_notes": notes})
    if pairs or close:
        comps: dict[str, dict] = {}
        for p in pairs:
            a, bb = (p["pair"].split(",") if "," in p["pair"] else [p["pair"][0], p["pair"][1:]])
            comps.setdefault(a, {"label": a, "vMag": p["magPrimary"]})
            comps.setdefault(bb, {"label": bb, "vMag": p["magSecondary"]})
        note_parts = []
        if pairs:
            note_parts.append("WDS " + wid.split()[1][1:11] + ": " + ", ".join(f"{p['_disc']} {p['pair']}" for p in pairs))
        if close:
            note_parts.append(f"also {len(close)} pair(s) closer than 3″ ({', '.join(close[:4])}{'…' if len(close) > 4 else ''}), not separable in binoculars")
        if pairs:
            rec["multiplicity"] = {"components": list(comps.values()),
                                   "pairs": [{k: v for k, v in p.items() if not k.startswith("_")} for p in pairs],
                                   "systemNote": "; ".join(note_parts)}
            srcs.add("wds")
        else:
            auto["wdsCloseOnly"] = "; ".join(note_parts)

    # exoplanets
    hdn, hipn = auto["hd"], auto["hip"]
    hits = [r for r in exo if (hdn and r.get("hd_name", "").replace(" ", "") == f"HD{hdn}")
            or (hipn and r.get("hip_name", "").replace(" ", "") == f"HIP{hipn}")]
    if hits:
        first = min(hits, key=lambda r: int(r["disc_year"] or 9999))
        ex = {"count": len(hits), "firstDiscoveryYear": int(first["disc_year"]), "method": first["discoverymethod"],
              "status": "confirmed", "sourceId": "nasa-exoplanet-archive"}
        if hdn in DISPUTED_PLANETS:
            ex["status"] = "disputed"
            srcs.add(DISPUTED_PLANETS[hdn])
        rec["exoplanets"] = ex
        auto["planets"] = sorted(r["pl_name"] for r in hits)
        srcs.add("nasa-exoplanet-archive")

    # stage seed
    stage, rule = default_stage(cls, lum, s.get("otype") if s else None, sp_text, vclass, mv, g8_k2(sp_text or ""))
    if stage:
        rec["evolutionaryStage"] = stage
        rec["stageConfidence"] = "likely"
        auto["stageRule"] = rule
    rec["evoStage"] = evo_stage_for(stage, cls)

    rec["facts"] = {k: facts[k] for k in sorted(facts)}

    # media: existing survey cutouts + generated-visual seeds
    images = []
    for im in (media.get(o["id"], {}) or {}).get("images", []):
        if im.get("display") is False:
            continue
        opt = im["variant"] == "optical"
        images.append({"src": im["path"],
                       "credit": ("Digitized Sky Survey · STScI / Caltech / UKST / AAO; color mosaic by CDS" if opt
                                  else "2MASS / UMass / IPAC-Caltech / NASA / NSF; color mosaic by CDS"),
                       "license": ("DSS2: educational non-commercial use with acknowledgment" if opt
                                   else "2MASS: educational use with acknowledgment"),
                       "caption": (f"Survey photograph of the field around {o['name']}; the star itself is a saturated point." if opt
                                   else f"False-colour near-infrared survey view of the field around {o['name']}."),
                       "fieldDeg": media[o["id"]].get("fov", 3.7), "variant": im["variant"]})
    visuals = []
    if "teffK" in facts or "bv" in facts:
        visuals.append({"type": "temperature-swatch"})
    if "absMagV" in facts and "bv" in facts:
        visuals.append({"type": "hr-diagram"})
    if "radiusRsun" in facts:
        visuals.append({"type": "size-comparison"})
    if "variability" in rec:
        shape = {"eclipsing-algol": "eclipsing", "eclipsing-beta-lyrae": "eclipsing", "eclipsing-long-period": "eclipsing",
                 "cepheid": "pulsating", "rr-lyrae": "pulsating", "delta-scuti": "pulsating", "beta-cephei": "pulsating",
                 "mira": "mira", "r-crb": "fading", "recurrent-nova": "nova", "dwarf-nova": "nova"}.get(vclass, "irregular")
        visuals.append({"type": "light-curve", "shape": shape})
    if "multiplicity" in rec:
        visuals.append({"type": "binocular-field"})
    rec["media"] = {"images": images, "visuals": visuals}

    rec["sources"] = sorted(srcs)
    rec["provenance"] = {"status": "auto", "batch": o["batch"]}
    auto["flags"] = flags
    rec["auto"] = auto
    return rec


def sexa_ra(s: str) -> float:
    m = re.match(r"(\d+)h\s*(\d+)m\s*([\d.]+)s", s)
    return 15 * (int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600)


def sexa_dec(s: str) -> float:
    m = re.match(r"([+\-−])?(\d+)°\s*(\d+)′\s*([\d.]+)″", s)
    v = int(m.group(2)) + int(m.group(3)) / 60 + float(m.group(4)) / 3600
    return -v if m.group(1) in ("-", "−") else v


# ───────────────────────────── HR background ─────────────────────────────

def build_hr_background(v50: dict, bulk_by_hr: dict, retrieved: str) -> dict:
    """B−V and M_V for BSC stars whose SIMBAD parallax has σϖ/ϖ < 10 % (doc 02 §6.2). Columnar, rounded to 0.01."""
    hr_l, bv_l, mv_l = [], [], []
    for hr in sorted(v50):
        r = v50[hr]
        v, bv = num(r.get("Vmag")), num(r.get("B-V"))
        b = bulk_by_hr.get(hr)
        if v is None or bv is None or not b:
            continue
        p, e = num(b.get("plx_value")), num(b.get("plx_err"))
        if not p or p <= 0 or e is None or e / p >= 0.1:
            continue
        hr_l.append(hr)
        bv_l.append(round(bv, 2))
        mv_l.append(round(v + 5 * math.log10(p / 100), 2))
    return {
        "version": f"hr-background-{retrieved}",
        "generatedBy": "script/journeys/build_stars_auto.py",
        "description": ("HR diagram of naked-eye stars: BSC5 (V/50) V and B−V, SIMBAD best parallax (Gaia DR3 / Hipparcos 2007) "
                        "with σϖ/ϖ < 10 %. absMagV = V + 5 log10(ϖ/100 mas); no extinction correction. Columnar arrays."),
        "sources": ["bsc5", "simbad"],
        "count": len(hr_l),
        "hr": hr_l,
        "bv": bv_l,
        "absMagV": mv_l,
    }


# ───────────────────────────── coverage ─────────────────────────────

def coverage_table(records: list[dict]) -> list[dict]:
    def cnt(pred):
        return sum(1 for r in records if pred(r))

    def fact(k, src=None, method=None):
        return lambda r: k in r["facts"] and (src is None or r["facts"][k]["sourceId"] == src) and \
            (method is None or r["facts"][k]["method"] == method)

    rows = [
        ("names.designation", lambda r: "designation" in r["names"]),
        ("names.simbadId", lambda r: "simbadId" in r["names"]),
        ("hip id", lambda r: r["auto"]["hip"] is not None),
        ("gaia dr3 id", lambda r: r["auto"]["gaiaDr3"] is not None),
        ("spectral", lambda r: "spectral" in r),
        ("spectral.lumClass", lambda r: "lumClass" in r.get("spectral", {})),
        ("facts.bv", fact("bv")),
        ("facts.distanceLy", fact("distanceLy")),
        ("  … from hip2007", fact("distanceLy", "hip2007")),
        ("  … from gaiadr3", fact("distanceLy", "gaiadr3")),
        ("  … uncertain (σϖ/ϖ ≥ 10 %)", lambda r: "distance-uncertain" in r["auto"]["flags"]),
        ("  … needs literature (policy)", lambda r: r["auto"].get("distance", {}).get("needsLiterature")),
        ("facts.absMagV", fact("absMagV")),
        ("facts.teffK", fact("teffK")),
        ("  … mesFe_h (catalog)", fact("teffK", "simbad-mesfeh")),
        ("  … colour relation (derived)", fact("teffK", "torres2010")),
        ("facts.feH", fact("feH")),
        ("facts.angularDiameterMas", fact("angularDiameterMas")),
        ("  … JMDC measured", fact("angularDiameterMas", "jmdc")),
        ("  … JSDC predicted", fact("angularDiameterMas", "jsdc2")),
        ("facts.radiusRsun", fact("radiusRsun")),
        ("  … from θ and d", lambda r: "radiusRsun" in r["facts"] and r["facts"]["radiusRsun"]["note"].startswith("R = θ")),
        ("  … Stefan–Boltzmann", lambda r: "radiusRsun" in r["facts"] and r["facts"]["radiusRsun"]["note"].startswith("Stefan")),
        ("facts.lumLsun", fact("lumLsun")),
        ("variability", lambda r: "variability" in r),
        ("  … volatile", lambda r: r.get("variability", {}).get("volatile")),
        ("facts.periodDays", fact("periodDays")),
        ("multiplicity (WDS pairs ≥ 3″, mag2 ≤ 9)", lambda r: "multiplicity" in r),
        ("exoplanets", lambda r: "exoplanets" in r),
        ("facts.properMotionMasYr", fact("properMotionMasYr")),
        ("facts.radialVelocityKms", fact("radialVelocityKms")),
        ("evolutionaryStage (seed)", lambda r: "evolutionaryStage" in r),
        ("evoStage (seed)", lambda r: r["evoStage"] is not None),
        ("media.images (survey)", lambda r: bool(r["media"]["images"])),
    ]
    return [{"field": name, "count": cnt(pred)} for name, pred in rows]


def print_coverage(cov: list[dict], n: int) -> None:
    print(f"\n| field | stars (of {n}) | % |\n|---|---:|---:|")
    for row in cov:
        print(f"| {row['field']} | {row['count']} | {100 * row['count'] / n:.0f} |")


if __name__ == "__main__":
    main()
