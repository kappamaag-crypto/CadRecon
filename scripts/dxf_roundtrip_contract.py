"""Independent DXF R2000/AC1015 write/read contract using ezdxf.
Synthetic fixtures only: this is NOT a KOMPAS-3D v25/DWG/CDW round trip.
Called after Vitest writes /tmp/cadrecon-*-test.dxf.
"""
from __future__ import annotations
import collections
import tempfile
from pathlib import Path
import ezdxf

FIXTURES = [
    "/tmp/cadrecon-test.dxf",
    "/tmp/cadrecon-eskd-test.dxf",
    "/tmp/cadrecon-spline-test.dxf",
    "/tmp/cadrecon-styled-test.dxf",
    "/tmp/cadrecon-cadtools-test.dxf",
]

def vec(v):
    return tuple(round(float(x), 6) for x in v)

def entity_key(e):
    """Stable geometry/semantic fingerprint, intentionally no internal DXF handle."""
    k = e.dxftype()
    layer = e.dxf.layer
    if k == "LINE":
        geometry = (vec(e.dxf.start), vec(e.dxf.end), e.dxf.get("linetype", "BYLAYER"))
    elif k == "CIRCLE":
        geometry = (vec(e.dxf.center), round(e.dxf.radius, 6))
    elif k == "ARC":
        geometry = (vec(e.dxf.center), round(e.dxf.radius, 6),
                    round(e.dxf.start_angle, 6), round(e.dxf.end_angle, 6))
    elif k == "ELLIPSE":
        geometry = (vec(e.dxf.center), vec(e.dxf.major_axis),
                    round(e.dxf.ratio, 6))
    elif k == "SPLINE":
        geometry = (int(e.dxf.degree), tuple(vec(p) for p in e.control_points),
                    tuple(round(x, 6) for x in e.knots))
    elif k == "LWPOLYLINE":
        geometry = (tuple(tuple(round(float(x), 6) for x in p)
                          for p in e.get_points("xy")), bool(e.closed))
    elif k == "TEXT":
        geometry = (vec(e.dxf.insert), e.dxf.text)
    elif k == "DIMENSION":
        geometry = (e.dxf.geometry, int(e.dxf.dimtype & 7),
                    e.dxf.get("text", ""))
    elif k == "INSERT":
        geometry = (e.dxf.name, vec(e.dxf.insert))
    else:
        # Detect loss even for HATCH and other entities, without pretending
        # to compare unsupported geometry implementations.
        geometry = None
    return (k, layer, geometry)

def check_document(path: str) -> None:
    source = Path(path)
    if not source.is_file():
        raise AssertionError("Missing generated fixture: " + path)
    original = ezdxf.readfile(path)
    assert not original.audit().has_errors, "Source DXF audit failed: " + path
    before = collections.Counter(entity_key(e) for e in original.modelspace())
    assert before, "Empty DXF: " + path

    with tempfile.TemporaryDirectory(prefix="cadrecon-dxf-roundtrip-") as tmp:
        saved = Path(tmp) / source.name
        original.saveas(saved)
        restored = ezdxf.readfile(str(saved))
        assert not restored.audit().has_errors, "DXF write/reopen audit failed: " + path
        after = collections.Counter(entity_key(e) for e in restored.modelspace())
        assert before == after, (
            "DXF entity type/layer/geometry changed on independent write/reopen: " + path
            + "\nMissing: " + str(before - after) + "\nAdded: " + str(after - before)
        )
        for k in ("$ACADVER", "$INSUNITS"):
            assert original.header.get(k) == restored.header.get(k), (
                "DXF header changed: " + str(k) + " in " + path
            )
        if "styled" in path:
            assert {"DASHED", "CENTER"}.issubset({s.dxf.name for s in restored.linetypes})
        if "spline" in path:
            assert restored.header.get("$INSUNITS") == 0, "Uncalibrated PDF cannot claim mm"
        print(f"ROUNDTRIP PASS {source.name}: {sum(before.values())} editable entities")

if __name__ == "__main__":
    for file in FIXTURES:
        check_document(file)
