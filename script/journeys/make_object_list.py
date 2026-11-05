#!/usr/bin/env python3
"""Build script/journeys/object-list.json: the v1 master list of Sky Journeys objects.

Selection (docs/sky-journeys/02 §3, 03 §1.2/§8, spec decision 9):
  stars  = layer A: every BSC star with V <= 3.0
         + every existing STAR-* and DS-* catalog target
         + layer B: the hand-picked binocular showcase stars of doc 02 §3.2 (HAND_STARS below)
  dso    = every binocular-guide deep-sky entry (cluster / nebula / galaxy / asterism) not in the 80 mm "large" tier
         + catalog-only objects promoted by doc 03 §8.1 (PROMOTED_DSO)
         + new objects from doc 03 §8.2 (NEW_DSO)

Ids: existing unified-target ids win (STAR-*, DS-*, AST-*, M*, NGC*...). Other BSC stars -> "HR<n>",
non-BSC stars -> "HD<n>" or "NAME-<Name>". `existing` = the id is already a unified catalog target
(messier.json / binocular-catalog.json), i.e. it has bundled images and a finder field.

Hand-picked stars are resolved through the SIMBAD Harvard mirror (CDS Strasbourg times out from the build
machine). Results are cached in script/journeys/cache/object-list-simbad.json so the build reruns offline:

    python3 -I script/journeys/make_object_list.py            # offline, uses the cache
    python3 -I script/journeys/make_object_list.py --refresh  # re-query SIMBAD, rewrite the cache

Stdlib only.
"""
from __future__ import annotations

import json
import math
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "client" / "public" / "data"
LIB = ROOT / "client" / "src" / "lib"
OUT = Path(__file__).resolve().parent / "object-list.json"
CACHE = Path(__file__).resolve().parent / "cache" / "object-list-simbad.json"
SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync"

# ───────────────────────────── batches ─────────────────────────────

BATCH_CONS = {
    "winter": "Ori Tau Aur Gem CMa CMi Mon Lep Cam",
    "spring": "Leo Cnc UMa CVn Com Vir Boo Hya Crv Crt Sex LMi Lyn UMi",
    "summer-north": "Lyr Cyg Vul Sge Del Aql Her CrB Dra Equ",
    "summer-south": "Sco Sgr Ser Sct Lup Lib CrA Nor Ara Tel",
    "autumn": "Cas Cep And Per Tri Peg Psc Cet Aqr Cap PsA Ari Lac Scl",
    "southern": "Car Cru Cen Vel Pup Mus Tuc Dor Men Pav Gru Phe Hor Pic Col Hyi Ret Vol Cir TrA Aps Oct Cha",
}
# Constellations the task brief does not name, assigned to the neighbouring batch (documented in README.md).
EXTRA_CONS = {"Ant": "southern", "Pyx": "southern", "Cae": "southern", "Ind": "southern",
              "For": "autumn", "Mic": "autumn"}
CON_BATCH = {c: b for b, cons in BATCH_CONS.items() for c in cons.split()}
CON_BATCH.update({c: b for c, b in EXTRA_CONS.items() if c not in CON_BATCH})


def batch_for(con: str, dec: float) -> str:
    if con == "Eri":
        return "winter" if dec > -30 else "southern"
    if con == "Oph":
        return "summer-north" if dec >= 0 else "summer-south"
    if con not in CON_BATCH:
        raise SystemExit(f"no batch for constellation {con!r}")
    return CON_BATCH[con]


# ───────────────────────────── hand lists ─────────────────────────────

# (SIMBAD identifier, constellation, display name, doc-02 role group). Order follows doc 02 §3.2.
HAND_STARS = [
    # supergiants, hypergiants, biggest stars
    ("* bet Ori", "Ori", "Rigel", "supergiant"), ("* alf Car", "Car", "Canopus", "supergiant"),
    ("* alf UMi", "UMi", "Polaris", "supergiant"), ("* alf Per", "Per", "Mirfak", "supergiant"),
    ("* del CMa", "CMa", "Wezen", "supergiant"), ("* eta CMa", "CMa", "Aludra", "supergiant"),
    ("* gam Cyg", "Cyg", "Sadr", "supergiant"), ("* eps Peg", "Peg", "Enif", "supergiant"),
    ("* eps Ori", "Ori", "Alnilam", "supergiant"), ("* zet Ori", "Ori", "Alnitak", "supergiant"),
    ("* del Ori", "Ori", "Mintaka", "supergiant"), ("V* VV Cep", "Cep", "VV Cephei", "supergiant"),
    ("* rho Cas", "Cas", "ρ Cassiopeiae", "supergiant"), ("* 6 Cas", "Cas", "6 Cassiopeiae", "supergiant"),
    ("* P Cyg", "Cyg", "P Cygni", "supergiant"), ("V* RW Cep", "Cep", "RW Cephei", "supergiant"),
    ("V* VY CMa", "CMa", "VY Canis Majoris", "supergiant"), ("* zet01 Sco", "Sco", "ζ¹ Scorpii", "supergiant"),
    ("* eps Aur", "Aur", "ε Aurigae", "supergiant"), ("HD 226868", "Cyg", "HDE 226868 (Cygnus X-1)", "supergiant"),
    ("* sig Ori", "Ori", "σ Orionis", "supergiant"),
    # hot, young, runaway
    ("* lam Ori", "Ori", "Meissa", "hot"), ("* iot Ori", "Ori", "ι Orionis", "hot"),
    ("* tet01 Ori C", "Ori", "θ¹ Orionis C", "hot"), ("* tet02 Ori A", "Ori", "θ² Orionis", "hot"),
    ("* 10 Lac", "Lac", "10 Lacertae", "hot"), ("* zet Oph", "Oph", "ζ Ophiuchi", "hot"),
    ("V* AE Aur", "Aur", "AE Aurigae", "hot"), ("* mu. Col", "Col", "μ Columbae", "hot"),
    ("* zet Pup", "Pup", "Naos", "hot"), ("* gam02 Vel", "Vel", "γ² Velorum", "hot"),
    ("* tau CMa", "CMa", "τ Canis Majoris", "hot"), ("* eta Tau", "Tau", "Alcyone", "hot"),
    ("* 27 Tau", "Tau", "Atlas", "hot"), ("* 17 Tau", "Tau", "Electra", "hot"),
    ("* 20 Tau", "Tau", "Maia", "hot"), ("* 23 Tau", "Tau", "Merope", "hot"),
    ("* 19 Tau", "Tau", "Taygeta", "hot"), ("* 28 Tau", "Tau", "Pleione", "hot"),
    ("* 9 Sgr", "Sgr", "9 Sagittarii", "hot"), ("WR 136", "Cyg", "WR 136", "hot"),
    ("* eta Car", "Car", "η Carinae", "hot"),
    # main sequence references, rotation, peculiar
    ("* alf CMa", "CMa", "Sirius", "ms"), ("* alf Lyr", "Lyr", "Vega", "ms"), ("* alf Aql", "Aql", "Altair", "ms"),
    ("* alf Leo", "Leo", "Regulus", "ms"), ("* alf Eri", "Eri", "Achernar", "ms"), ("* alf PsA", "PsA", "Fomalhaut", "ms"),
    ("* alf CMi", "CMi", "Procyon", "ms"), ("* bet Leo", "Leo", "Denebola", "ms"), ("* alf Gem", "Gem", "Castor", "ms"),
    ("* eps UMa", "UMa", "Alioth", "ms"), ("* gam Cas", "Cas", "γ Cassiopeiae", "ms"), ("* zet Tau", "Tau", "ζ Tauri", "ms"),
    ("* del Sco", "Sco", "Dschubba", "ms"), ("* bet CVn", "CVn", "Chara", "ms"),
    # red giants and the red clump
    ("* bet Gem", "Gem", "Pollux", "giant"), ("* alf Ari", "Ari", "Hamal", "giant"), ("* bet UMi", "UMi", "Kochab", "giant"),
    ("* alf UMa", "UMa", "Dubhe", "giant"), ("* alf Cet", "Cet", "Menkar", "giant"), ("* alf Ser", "Ser", "Unukalhai", "giant"),
    ("* alf Oph", "Oph", "Rasalhague", "giant"), ("* alf Cas", "Cas", "Schedar", "giant"),
    ("* gam Tau", "Tau", "γ Tauri", "giant"), ("* del01 Tau", "Tau", "δ¹ Tauri", "giant"), ("* eps Tau", "Tau", "Ain (ε Tauri)", "giant"),
    ("* bet And", "And", "Mirach", "giant"), ("* bet Peg", "Peg", "Scheat", "giant"), ("* gam Cru", "Cru", "Gacrux", "giant"),
    # AGB, Mira, S and carbon stars
    ("V* chi Cyg", "Cyg", "χ Cygni", "agb"), ("V* R Leo", "Leo", "R Leonis", "agb"), ("V* R Hya", "Hya", "R Hydrae", "agb"),
    ("V* g Her", "Her", "g Herculis (30 Her)", "agb"), ("V* W Cyg", "Cyg", "W Cygni", "agb"), ("* bet Gru", "Gru", "Tiaki (β Gruis)", "agb"),
    ("V* L02 Pup", "Pup", "L² Puppis", "agb"), ("V* R Lep", "Lep", "Hind's Crimson Star (R Lep)", "agb"),
    ("V* V Aql", "Aql", "V Aquilae", "agb"), ("V* T Lyr", "Lyr", "T Lyrae", "agb"), ("V* TX Psc", "Psc", "TX Piscium (19 Psc)", "agb"),
    ("V* W Ori", "Ori", "W Orionis", "agb"), ("V* X Cnc", "Cnc", "X Cancri", "agb"), ("V* RS Cyg", "Cyg", "RS Cygni", "agb"),
    ("V* V460 Cyg", "Cyg", "V460 Cygni", "agb"), ("V* UU Aur", "Aur", "UU Aurigae", "agb"), ("V* S Cep", "Cep", "S Cephei", "agb"),
    # pulsating yardsticks
    ("V* eta Aql", "Aql", "η Aquilae", "pulsator"), ("V* zet Gem", "Gem", "Mekbuda (ζ Gem)", "pulsator"),
    ("V* RR Lyr", "Lyr", "RR Lyrae", "pulsator"), ("* del Sct", "Sct", "δ Scuti", "pulsator"), ("* bet Cep", "Cep", "Alfirk (β Cep)", "pulsator"),
    ("V* R Sct", "Sct", "R Scuti", "pulsator"), ("V* U Mon", "Mon", "U Monocerotis", "pulsator"),
    # eclipsing and interacting binaries
    ("* bet Lyr", "Lyr", "Sheliak (β Lyr)", "eclipsing"), ("* lam Tau", "Tau", "λ Tauri", "eclipsing"), ("* del Lib", "Lib", "δ Librae", "eclipsing"),
    ("* zet Aur", "Aur", "ζ Aurigae", "eclipsing"), ("* 31 Cyg", "Cyg", "31 Cygni (ο¹ Cyg)", "eclipsing"),
    ("V* U Cep", "Cep", "U Cephei", "eclipsing"), ("V* RZ Cas", "Cas", "RZ Cassiopeiae", "eclipsing"),
    # novae, dust fadings, YSOs, cataclysmics (volatile)
    ("V* T CrB", "CrB", "T Coronae Borealis", "volatile"), ("V* R CrB", "CrB", "R Coronae Borealis", "volatile"),
    ("V* SS Cyg", "Cyg", "SS Cygni", "volatile"), ("V* AB Aur", "Aur", "AB Aurigae", "volatile"),
    ("V* FU Ori", "Ori", "FU Orionis", "volatile"), ("V* T Tau", "Tau", "T Tauri", "volatile"),
    # nearest stars, red dwarfs, high proper motion
    ("* alf Cen", "Cen", "α Centauri", "nearby"), ("* eps Eri", "Eri", "ε Eridani", "nearby"), ("* tau Cet", "Cet", "τ Ceti", "nearby"),
    ("* eps Ind", "Ind", "ε Indi", "nearby"), ("* omi02 Eri", "Eri", "40 Eridani (ο² Eri)", "nearby"),
    ("HD 95735", "UMa", "Lalande 21185", "nearby"), ("HD 202560", "Mic", "Lacaille 8760 (AX Mic)", "nearby"),
    ("HD 217987", "PsA", "Lacaille 9352", "nearby"), ("HD 1326", "And", "Groombridge 34", "nearby"),
    ("NAME Barnard's star", "Oph", "Barnard's Star", "nearby"), ("HD 33793", "Pic", "Kapteyn's Star", "nearby"),
    ("HD 103095", "UMa", "Groombridge 1830", "nearby"), ("HD 16160", "Cet", "HD 16160 (Gliese 105)", "nearby"),
    ("* 70 Oph", "Oph", "70 Ophiuchi", "nearby"), ("* 36 Oph", "Oph", "36 Ophiuchi", "nearby"),
    # planet hosts
    ("* 51 Peg", "Peg", "51 Pegasi", "planet"), ("* ups And", "And", "υ Andromedae", "planet"), ("* tau Boo", "Boo", "τ Boötis", "planet"),
    ("* 55 Cnc", "Cnc", "55 Cancri", "planet"), ("* 47 UMa", "UMa", "47 Ursae Majoris", "planet"), ("* 70 Vir", "Vir", "70 Virginis", "planet"),
    ("* 14 Her", "Her", "14 Herculis", "planet"), ("* rho CrB", "CrB", "ρ Coronae Borealis", "planet"),
    ("* 16 Cyg A", "Cyg", "16 Cygni A", "planet"), ("* 16 Cyg B", "Cyg", "16 Cygni B", "planet"),
    ("HD 209458", "Peg", "HD 209458", "planet"), ("HD 189733", "Vul", "HD 189733", "planet"),
    ("* gam Cep", "Cep", "Errai (γ Cep)", "planet"), ("* iot Dra", "Dra", "Edasich (ι Dra)", "planet"), ("* bet Pic", "Pic", "β Pictoris", "planet"),
    # halo, old, metal-poor; solar twins
    ("HD 140283", "Lib", "HD 140283 (Methuselah star)", "halo"), ("* 18 Sco", "Sco", "18 Scorpii", "twin"),
    # wide binocular doubles beyond the existing catalog pairs
    ("* zet01 Lyr", "Lyr", "ζ Lyrae", "double"), ("* del02 Lyr", "Lyr", "δ Lyrae", "double"), ("* nu. Sco", "Sco", "Jabbah (ν Sco)", "double"),
    ("* bet01 Sco", "Sco", "Acrab (β Sco)", "double"), ("* mu.01 Sco", "Sco", "μ¹ Scorpii", "double"), ("* ome01 Sco", "Sco", "ω¹ Scorpii", "double"),
    ("* kap Her", "Her", "κ Herculis", "double"), ("* del Boo", "Boo", "δ Boötis", "double"), ("* mu.01 Boo", "Boo", "Alkalurops (μ Boo)", "double"),
    ("* nu.01 Boo", "Boo", "ν Boötis", "double"), ("* tau01 Aqr", "Aqr", "τ Aquarii", "double"), ("* sig02 Tau", "Tau", "σ Tauri", "double"),
    ("* kap01 Tau", "Tau", "κ Tauri", "double"), ("* 19 Lyn A", "Lyn", "19 Lyncis", "double"), ("* gam02 Del", "Del", "γ Delphini", "double"),
    ("* psi01 Psc A", "Psc", "ψ¹ Piscium", "double"),
    # cluster / association pivots
    ("* bet UMa", "UMa", "Merak", "pivot"), ("* gam UMa", "UMa", "Phecda", "pivot"), ("* del UMa", "UMa", "Megrez", "pivot"),
    ("* pi. Sco", "Sco", "π Scorpii", "pivot"), ("* sig Sco", "Sco", "Alniyat (σ Sco)", "pivot"), ("* gam Com", "Com", "γ Comae Berenices", "pivot"),
]

# Catalog-only objects promoted by doc 03 §8.1 (P0 + P1).
PROMOTED_DSO = ["M43", "NGC884", "NGC2158", "NGC2362", "NGC6530", "NGC6960", "NGC6992", "NGC7293",
                "NGC2237", "NGC6871", "NGC6888", "M57", "M97",
                # round 3 (owner r2: southern A1/A8 nights need a visible death): Ghost of Jupiter, Hydra
                "NGC3242"]

# New objects (doc 03 §8.2): id, SIMBAD identifier (None = hand coordinates), con, name, fallback ra/dec.
# Tr 37 resolves to IC 1396 in SIMBAD and is kept as an alias of IC1396, not a separate record.
NEW_DSO = [
    ("Cr69", "Cl Collinder 69", "Ori", "λ Orionis Cluster (Collinder 69)", None),
    ("NGC1977", "NGC 1977", "Ori", "Running Man Nebula", None),
    ("NGC2438", "NGC 2438", "Pup", "NGC 2438 (planetary nebula in front of M46)", None),
    ("DN-Pipe", "NAME Pipe Nebula", "Oph", "Pipe Nebula (B59/B78)", None),
    ("DN-BarnardE", "Barnard 143", "Aql", "Barnard's E (B142/B143)", None),
    ("DN-Coalsack", "NAME Coalsack Nebula", "Cru", "Coalsack", None),
    ("MWF-CygnusRift", None, "Cyg", "Cygnus Rift", (300.0, 35.0)),
    ("IC1396", "IC 1396", "Cep", "IC 1396 and Trumpler 37 (Elephant's Trunk region)", None),
    ("IC2944", "IC 2944", "Cen", "Running Chicken Nebula (IC 2944)", None),
    # round 3 (owner r2): southern planetary nebulae for A1/A8 deaths. SIMBAD was unreachable on 2026-11-02, so
    # their cache rows were added by hand from OpenNGC (Gaia/SIMBAD positions); --refresh replaces them.
    ("NGC3132", "NGC 3132", "Vel", "Eight-Burst Nebula (NGC 3132)", None),
    ("NGC2440", "NGC 2440", "Pup", "NGC 2440 (planetary nebula south of M46)", None),
]

# Display-name fixes for BSC stars whose bsc5-short.json "N" name is wrong or ambiguous (KB build review, 2026-11).
BSC_NAME_FIXES = {
    6165: "τ Scorpii",   # bsc5-short calls τ Sco "Alniyat"; the IAU WGSN name Alniyat belongs to σ Sco (HR 6084), τ Sco is Paikauhale
    2890: "Castor B",    # both components of Castor are BSC entries; HR 2890 is the fainter B component (HR 2891 = Castor A)
}

# Display-name fixes by id, applied last (hand-picked names that resolved to another component).
ID_NAME_FIXES = {
    "HR5460": "α Centauri B",  # SIMBAD '* alf Cen' (hand list) resolves by position to HR 5460 = α² Cen = component B; HR 5459 is A
}

# Position fixes (J2000 deg) applied after selection; each carries the reason in the record's `note`.
POSITION_FIXES = {
    "NGC2527": (121.24583, -28.12194,
                "position from SIMBAD (Harvard mirror) NGC 2527, ICRS 08 04 59.0 -28 07 19 (2021A&A...647A..19T); "
                "the binocular-catalog position is 33' off"),
    "DN-Coalsack": (192.5, -62.5,
                    "visual centre of the dark cloud (~12h50m -62.5 deg, curator); the SIMBAD 'NAME Coalsack Nebula' "
                    "point (187.83, -63.74) lies near its western edge"),
}

# ───────────────────────────── parsing helpers ─────────────────────────────



def parse_ra(s: str) -> float:
    parts = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)]
    h, m, sec = (parts + [0, 0, 0])[:3]
    return (h + m / 60 + sec / 3600) * 15.0


def parse_dec(s: str) -> float:
    s = s.strip().replace("−", "-")
    sign = -1.0 if s.startswith("-") else 1.0
    parts = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)]
    d, m, sec = (parts + [0, 0, 0])[:3]
    return sign * (d + m / 60 + sec / 3600)


def sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r = math.radians
    c = math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def num(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# ───────────────────────────── SIMBAD (refresh only) ─────────────────────────────

def simbad_query(identifiers: list[str]) -> dict[str, dict]:
    quoted = ",".join("'" + i.replace("'", "''") + "'" for i in identifiers)
    adql = (
        "SELECT i.id AS qid, b.main_id, b.ra, b.dec, f.V, ids.ids FROM ident AS i "
        "JOIN basic AS b ON b.oid=i.oidref JOIN ids ON ids.oidref=b.oid "
        f"LEFT JOIN allfluxes AS f ON f.oidref=b.oid WHERE i.id IN ({quoted})"
    )
    body = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql}).encode()
    with urllib.request.urlopen(urllib.request.Request(SIMBAD_TAP, data=body), timeout=120) as resp:
        payload = json.load(resp)
    cols = [c["name"] for c in payload["metadata"]]
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    by_norm = {norm(i): i for i in identifiers}
    out: dict[str, dict] = {}
    for row in payload["data"]:
        rec = dict(zip(cols, row))
        key = by_norm.get(norm(rec["qid"]))
        if key is None:
            continue
        ids = rec["ids"].split("|")
        hr = next((int(m.group(1)) for x in ids if (m := re.fullmatch(r"HR\s+(\d+)", x.strip()))), None)
        hd = next((int(m.group(1)) for x in ids if (m := re.fullmatch(r"HD\s+(\d+)", x.strip()))), None)
        out[key] = {"main_id": norm(rec["main_id"]), "ra": rec["ra"], "dec": rec["dec"], "V": rec["V"], "hr": hr, "hd": hd}
    return out


def refresh_cache() -> None:
    idents = [s[0] for s in HAND_STARS] + [d[1] for d in NEW_DSO if d[1]]
    result: dict[str, dict] = {}
    for i in range(0, len(idents), 60):
        result.update(simbad_query(idents[i:i + 60]))
    missing = [i for i in idents if i not in result]
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({
        "source": SIMBAD_TAP,
        "note": "SIMBAD (Wenger et al. 2000) via the Harvard mirror; columns main_id, ra, dec (ICRS deg), V (allfluxes), HR/HD from ids.",
        "missing": missing,
        "objects": dict(sorted(result.items())),
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"cached {len(result)} SIMBAD records -> {CACHE.relative_to(ROOT)}; missing: {missing}")


# ───────────────────────────── build ─────────────────────────────

def load_catalogs():
    bsc = json.loads((DATA / "bsc5-short.json").read_text())
    messier = json.loads((DATA / "messier.json").read_text())
    bino = json.loads((DATA / "binocular-catalog.json").read_text())
    return bsc, messier, bino


def guide_entries() -> list[tuple[str, str, str]]:
    """(targetId, family, level) from binocular-guide.ts (inline entries) + binocular-guide-extra.json."""
    ts = (LIB / "binocular-guide.ts").read_text()
    entries = [(m.group(1), m.group(2), m.group(3)) for m in re.finditer(r'entry\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"', ts)]
    extra = json.loads((LIB / "binocular-guide-extra.json").read_text())
    entries += [(e["targetId"], e["family"], e["level"]) for e in extra]
    return entries


def main() -> None:
    if "--refresh" in sys.argv:
        refresh_cache()
    if not CACHE.exists():
        raise SystemExit(f"missing {CACHE}; run with --refresh once (needs network)")
    simbad = json.loads(CACHE.read_text())["objects"]
    bsc, messier, bino = load_catalogs()

    bsc_by_hr = {int(s["HR"]): s for s in bsc}
    bsc_pos = {hr: (parse_ra(s["RA"]), parse_dec(s["Dec"]), float(s["V"])) for hr, s in bsc_by_hr.items()}

    def bsc_name(hr: int) -> str:
        s = bsc_by_hr[hr]
        if hr in BSC_NAME_FIXES:
            return BSC_NAME_FIXES[hr]
        if s.get("N"):
            return s["N"]
        if s.get("B") and s.get("C"):
            return f'{s["B"]} {s["C"]}'
        if s.get("F") and s.get("C"):
            return f'{s["F"]} {s["C"]}'
        return f"HR {hr}"

    # unified targets (Messier first, binocular duplicates skipped — mirrors buildUnifiedTargets)
    unified: dict[str, dict] = {}
    for m in messier:
        unified[m["M"]] = {"name": m.get("N") or m["M"], "con": m["Con"], "ra": parse_ra(m["RA"]),
                           "dec": parse_dec(m["Dec"]), "mag": num(m.get("V")), "cat": "M-" + m["T"]}
    for b in bino:
        if b["id"] in unified:
            continue
        unified[b["id"]] = {"name": b["name"], "con": b["con"], "ra": parse_ra(b["ra"]), "dec": parse_dec(b["dec"]),
                            "mag": num(b.get("mag")), "cat": b["cat"]}

    records: dict[str, dict] = {}

    def add(rec: dict) -> None:
        if rec["id"] in records:
            records[rec["id"]]["selection"] = sorted(set(records[rec["id"]]["selection"]) | set(rec["selection"]))
            return
        rec["batch"] = batch_for(rec["con"], rec["dec"])
        records[rec["id"]] = rec

    # existing STAR-* / DS-*: attach the BSC HR of the primary by position (+ magnitude)
    existing_by_hr: dict[int, str] = {}
    for tid, t in unified.items():
        if not (tid.startswith("STAR-") or tid.startswith("DS-")):
            continue
        best = None
        for hr, (ra, dec, v) in bsc_pos.items():
            if abs(dec - t["dec"]) > 0.2:
                continue
            d = sep_deg(ra, dec, t["ra"], t["dec"])
            if d <= 0.12 and (t["mag"] is None or abs(v - t["mag"]) <= 1.0):
                score = d + 0.02 * abs(v - (t["mag"] if t["mag"] is not None else v))
                if best is None or score < best[0]:
                    best = (score, hr)
        hr = best[1] if best else None
        if hr is not None:
            existing_by_hr[hr] = tid
        add({"id": tid, "kind": "star", "hr": hr, "name": t["name"], "con": t["con"], "ra": round(t["ra"], 5),
             "dec": round(t["dec"], 5), "mag": t["mag"], "existing": True, "selection": ["existing-catalog-star"]})

    def star_id_for_hr(hr: int) -> tuple[str, bool]:
        return (existing_by_hr[hr], True) if hr in existing_by_hr else (f"HR{hr}", False)

    def bsc_match(ra: float, dec: float, v: float | None) -> int | None:
        """SIMBAD main ids are sometimes the multiple system (alf Cen, zet Ori) whose ids lack the HR of the
        component; fall back to the nearest BSC star within 3' (and 1.5 mag when V is known)."""
        best = None
        for hr, (bra, bdec, bv) in bsc_pos.items():
            if abs(bdec - dec) > 0.1:
                continue
            d = sep_deg(bra, bdec, ra, dec)
            if d <= 0.05 and (v is None or abs(bv - v) <= 1.5) and (best is None or d < best[0]):
                best = (d, hr)
        return best[1] if best else None

    def add_bsc(hr: int, selection: str, name: str | None = None, con: str | None = None) -> None:
        ra, dec, v = bsc_pos[hr]
        sid, existing = star_id_for_hr(hr)
        if sid in records:
            records[sid]["selection"] = sorted(set(records[sid]["selection"]) | {selection})
            if name and not existing:
                records[sid]["name"] = name  # curated display name beats the BSC fallback name
            return
        add({"id": sid, "kind": "star", "hr": hr, "name": name or bsc_name(hr), "con": con or bsc_by_hr[hr].get("C"),
             "ra": round(ra, 5), "dec": round(dec, 5), "mag": v, "existing": False, "selection": [selection]})

    # layer A: BSC V <= 3.0
    for hr, (_, _, v) in sorted(bsc_pos.items()):
        if v <= 3.0:
            add_bsc(hr, "bsc-v3")

    # layer B: hand-picked
    unresolved = []
    for ident, con, name, group in HAND_STARS:
        s = simbad.get(ident)
        if s is None:
            unresolved.append(ident)
            continue
        hr = s["hr"] if s["hr"] in bsc_by_hr else bsc_match(s["ra"], s["dec"], s["V"])
        if hr is not None:
            add_bsc(hr, f"handpicked:{group}", name=name, con=con)
            continue
        sid = f'HD{s["hd"]}' if s["hd"] else "NAME-" + re.sub(r"[^A-Za-z0-9]", "", name.split("(")[0])
        add({"id": sid, "kind": "star", "hr": None, "name": name, "con": con, "ra": round(s["ra"], 5),
             "dec": round(s["dec"], 5), "mag": s["V"], "existing": False, "selection": [f"handpicked:{group}"],
             "simbad": s["main_id"]})

    # deep sky: guide entries not in the 80 mm tier
    for tid, family, level in guide_entries():
        if family not in ("cluster", "nebula", "galaxy", "asterism") or level == "large":
            continue
        if tid not in unified:
            raise SystemExit(f"guide id {tid} is not a unified target")
        t = unified[tid]
        add({"id": tid, "kind": "dso", "hr": None, "name": t["name"], "con": t["con"], "ra": round(t["ra"], 5),
             "dec": round(t["dec"], 5), "mag": t["mag"], "existing": True, "selection": [f"guide:{level}"], "cat": t["cat"]})
    for tid in PROMOTED_DSO:
        t = unified[tid]
        add({"id": tid, "kind": "dso", "hr": None, "name": t["name"], "con": t["con"], "ra": round(t["ra"], 5),
             "dec": round(t["dec"], 5), "mag": t["mag"], "existing": True, "selection": ["promoted"], "cat": t["cat"]})
    for tid, ident, con, name, fallback in NEW_DSO:
        s = simbad.get(ident) if ident else None
        if ident and s is None:
            unresolved.append(ident)
            continue
        ra, dec = (s["ra"], s["dec"]) if s else fallback
        add({"id": tid, "kind": "dso", "hr": None, "name": name, "con": con, "ra": round(ra, 5), "dec": round(dec, 5),
             "mag": s["V"] if s else None, "existing": tid in unified, "selection": ["new"],
             **({"simbad": s["main_id"]} if s else {"note": "approximate centre of an extended Milky Way feature"})})

    if unresolved:
        raise SystemExit(f"unresolved SIMBAD identifiers (run --refresh): {unresolved}")

    for tid, name in ID_NAME_FIXES.items():
        records[tid]["name"] = name
    for tid, (ra, dec, why) in POSITION_FIXES.items():
        r = records[tid]
        r["ra"], r["dec"] = round(ra, 5), round(dec, 5)
        r["note"] = f'{r["note"]}; {why}' if r.get("note") else why
        if batch_for(r["con"], r["dec"]) != r["batch"]:
            raise SystemExit(f"position fix moves {tid} to another batch")

    out = []
    for r in sorted(records.values(), key=lambda r: (r["batch"], r["kind"], r["ra"])):
        rec = {k: r[k] for k in ("id", "kind", "hr", "name", "con", "ra", "dec", "mag", "existing", "batch", "selection")}
        if rec["hr"] is None:
            del rec["hr"]
        for k in ("cat", "simbad", "note"):
            if k in r:
                rec[k] = r[k]
        out.append(rec)

    ids = [r["id"] for r in out]
    assert len(ids) == len(set(ids)), "duplicate ids"
    OUT.write_text(json.dumps({
        "version": "object-list-v1",
        "generatedBy": "script/journeys/make_object_list.py",
        "counts": dict(sorted(Counter(f'{r["batch"]}/{r["kind"]}' for r in out).items())),
        "objects": out,
    }, ensure_ascii=False, indent=1) + "\n")

    counts = Counter((r["batch"], r["kind"]) for r in out)
    batches = list(BATCH_CONS)
    print(f'{"batch":<14}{"star":>6}{"dso":>6}{"total":>7}')
    for b in batches:
        print(f'{b:<14}{counts[(b, "star")]:>6}{counts[(b, "dso")]:>6}{counts[(b, "star")] + counts[(b, "dso")]:>7}')
    ns = sum(v for (b, k), v in counts.items() if k == "star")
    nd = sum(v for (b, k), v in counts.items() if k == "dso")
    print(f'{"TOTAL":<14}{ns:>6}{nd:>6}{ns + nd:>7}')
    print(f"existing={sum(r['existing'] for r in out)} new={sum(not r['existing'] for r in out)} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
