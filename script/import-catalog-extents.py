#!/usr/bin/env python3
"""Extract angular footprints for StarHop's included targets from OpenNGC.

Usage: python3 script/import-catalog-extents.py /path/to/NGC.csv
See docs/catalog-angular-extents.md for the pinned source and checksum.
No positions, magnitudes, or observing catalog values are changed.
"""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = "54abea0b57b0a103831bfc7a8e3a99a23acfbf4bb581fcf3d8af539cbb826c84"


def local_dimensions(size):
    values = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", str(size or ""))]
    if not values or values[0] <= 0:
        return None
    factor = 60 if re.search(r"°|deg", str(size), re.I) else 1 / 60 if re.search(r'″|arcsec|"', str(size)) else 1
    major, minor = values[0] * factor, values[1] * factor if len(values) > 1 else None
    return major, minor


def main():
    path = Path(sys.argv[1])
    if hashlib.sha256(path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit("OpenNGC input differs from the documented snapshot; review before updating the checksum.")
    source = {r["Name"]: r for r in csv.DictReader(path.open(), delimiter=";")}
    messier = json.loads((ROOT / "client/public/data/messier.json").read_text())
    binocular = json.loads((ROOT / "client/public/data/binocular-catalog.json").read_text())
    objects = [{"id": r["M"], "cat": r["T"], "size": r.get("S"), "ngc": r.get("NGC")} for r in messier if r["T"] != "DS"]
    objects += [r for r in binocular if r["cat"] not in ("STAR", "DS")]
    result = {}
    for obj in objects:
        # Familiar cluster boundaries are more useful for field framing than
        # OpenNGC's frequently smaller MWSC central-region diameters.
        use_local = obj["cat"] in ("OC", "GC", "AST", "AS", "MW")
        key = None
        if obj.get("ngc") and re.fullmatch(r"\d+", obj["ngc"]):
            key = "NGC" + obj["ngc"].zfill(4)
        else:
            match = re.fullmatch(r"(NGC|IC)(\d+)", obj["id"])
            if match:
                key = match[1] + match[2].zfill(4)
        row = source.get(key)
        if not use_local and row and row["MajAx"]:
            major = float(row["MajAx"])
            minor = float(row["MinAx"]) if row["MinAx"] else None
            pa = float(row["PosAng"]) if row["PosAng"] else None
            origin = key
        else:
            dims = local_dimensions(obj.get("size"))
            if not dims:
                raise ValueError(f"Missing angular dimensions: {obj['id']}")
            major, minor = dims
            pa, origin = None, "included"
        if major <= 0 or minor is not None and (minor <= 0 or minor > major):
            raise ValueError(f"Invalid angular dimensions: {obj['id']}")
        result[obj["id"]] = {"majorArcmin": major, "minorArcmin": minor, "positionAngle": pa, "source": origin}
    destination = ROOT / "client/src/lib/catalog-extents.json"
    destination.write_text("{\n" + ",\n".join(f"  {json.dumps(key)}: {json.dumps(value, separators=(',', ':'))}" for key, value in result.items()) + "\n}\n")
    print(f"Wrote {len(result)} extents: {sum(r['source'] != 'included' for r in result.values())} OpenNGC, {sum(r['source'] == 'included' for r in result.values())} included catalog.")


if __name__ == "__main__":
    main()
