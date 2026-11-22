#!/usr/bin/env python3
"""W0 deterministic, synthetic engineering drawing corpus (stdlib only).

Creates two minimal vector PDFs and two RGB PNG scans with a JSON truth manifest.
No user data, no fonts, no network, no external executables. This is benchmark
infrastructure, NOT a PDF/OCR/CAD production implementation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import struct
import zlib
from pathlib import Path

PAPER = [500, 350]  # PDF points, NOT millimetres
KAPPA = 0.5522847498307936


def pdf_page(path: Path, content: str) -> None:
    stream = content.encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 350] "
         b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    data = bytearray(b"%PDF-1.4\n%CADRECON-W0\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{i} 0 obj\n".encode())
        data.extend(obj)
        data.extend(b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for at in offsets[1:]:
        data.extend(f"{at:010d} 00000 n \n".encode())
    data.extend((f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\n"
                 f"startxref\n{xref}\n%%EOF\n").encode())
    path.write_bytes(data)


def pdf_vector(path: Path) -> None:
    # Two independent strokes, one PDF rectangle, one circle built from four
    # cubic Béziers. Native circle fitting is a W1 *goal*, not an expectation.
    x, y, r, k = 325, 135, 40, 40 * KAPPA
    content = f"""0.8 w
20 40 m 190 40 l S
20 40 m 20 200 l S
70 75 110 50 re S
{x+r:.8f} {y:.8f} m
{x+r:.8f} {y+k:.8f} {x+k:.8f} {y+r:.8f} {x:.8f} {y+r:.8f} c
{x-k:.8f} {y+r:.8f} {x-r:.8f} {y+k:.8f} {x-r:.8f} {y:.8f} c
{x-r:.8f} {y-k:.8f} {x-k:.8f} {y-r:.8f} {x:.8f} {y-r:.8f} c
{x+k:.8f} {y-r:.8f} {x+r:.8f} {y-k:.8f} {x+r:.8f} {y:.8f} c S
BT /F1 13 Tf 120 285 Td (6000) Tj ET
BT /F1 13 Tf 290 285 Td (R20) Tj ET
"""
    pdf_page(path, content)


def pdf_transform(path: Path) -> None:
    # Affine transforms must not leak between q/Q graphics state scopes.
    content = """1 w
q 1 0 0 1 40 60 cm 10 20 m 90 20 l S Q
q 0 1 -1 0 200 30 cm 10 20 m 90 20 l S Q
BT /F1 12 Tf 20 300 Td (6000) Tj ET
"""
    pdf_page(path, content)


def draw_raster(path: Path, degraded: bool = False) -> None:
    width, height = 900, 600
    pixels = bytearray([255]) * (width * height)
    rand = random.Random(27011)

    def dot(x: int, y: int, thick: int = 1) -> None:
        for dy in range(-thick, thick + 1):
            for dx in range(-thick, thick + 1):
                px, py = x + dx, y + dy
                if 0 <= px < width and 0 <= py < height:
                    pixels[py * width + px] = 0

    def line(x0: int, y0: int, x1: int, y1: int) -> None:
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for t in range(steps + 1):
            if degraded and 0.32 < t / max(1, steps) < 0.38:
                continue  # A genuinely missing segment cannot be known.
            x = round(x0 + (x1 - x0) * t / max(1, steps))
            y = round(y0 + (y1 - y0) * t / max(1, steps))
            dot(x, y)

    line(55, 70, 830, 70)
    line(55, 70, 55, 510)
    line(140, 200, 760, 480)
    for i in range(3600):
        a = i * math.tau / 3600
        if degraded and 0.15 < a / math.tau < 0.29:
            continue
        dot(round(550 + 80 * math.cos(a)), round(320 + 80 * math.sin(a)))

    if degraded:
        for _ in range(4800):
            idx = rand.randrange(len(pixels))
            pixels[idx] = 0 if rand.random() < 0.52 else 255

    raw = b"".join(b"\x00" + bytes(pixels[y*width:(y+1)*width])
                   for y in range(height))
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
           + chunk(b"pHYs", struct.pack(">IIB", 11811, 11811, 1))
           + chunk(b"IDAT", zlib.compress(raw, level=9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/w0-goldens")
    args = parser.parse_args()
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    pdf_vector(output / "native_curves.pdf")
    pdf_transform(output / "native_ctm.pdf")
    draw_raster(output / "scan_clean_300dpi.png")
    draw_raster(output / "scan_degraded_300dpi.png", degraded=True)
    cases = [
        {"id": "native_curves", "file": "native_curves.pdf",
         "kind": "vector", "paper_pt": PAPER,
         "truth": {"lines": 2, "rectangles": 1, "circles": 1,
                   "text_exact": ["6000", "R20"]},
         "notes": "PDF rectangle and 4 cubic Bézier quarter-arcs"},
        {"id": "native_ctm", "file": "native_ctm.pdf",
         "kind": "vector", "paper_pt": PAPER,
         "truth": {"lines": 2, "text_exact": ["6000"],
                   "line_endpoints_pt": [[[50, 80], [130, 80]], [[180, 40], [180, 120]]]},
         "notes": "Two q/cm/Q transforms, one rotated line"},
        {"id": "scan_clean", "file": "scan_clean_300dpi.png",
         "kind": "scan", "pixels": [900, 600], "synthetic_dpi": 300,
         "truth": {"lines": [[[55, 70], [830, 70]], [[55, 70], [55, 510]],
                             [[140, 200], [760, 480]]],
                   "circles": [{"center": [550, 320], "radius": 80}]},
         "notes": "Clean monochrome; 2px thick rendered strokes"},
        {"id": "scan_degraded", "file": "scan_degraded_300dpi.png",
         "kind": "scan", "pixels": [900, 600], "synthetic_dpi": 300,
         "truth": {"lines": [[[55, 70], [830, 70]], [[55, 70], [55, 510]],
                             [[140, 200], [760, 480]]],
                   "circles": [{"center": [550, 320], "radius": 80}]},
         "notes": "Missing strokes, incomplete circle and seeded noise; do not assert perfect recovery"},
    ]
    for entry in cases:
        entry["sha256"] = hashlib.sha256((output / entry["file"]).read_bytes()).hexdigest()
        entry["provenance"] = "synthetic-from-repo-script"
        entry["rights"] = "project-authored synthetic benchmark (may be published)"
        entry["real_world_validation"] = False
    (output / "manifest.json").write_text(
        json.dumps({"version": 1, "generator": "benchmarks/w0/generate_fixtures.py",
                    "cases": cases}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"generated": len(cases), "out": str(output),
                      "bytes": sum((output / x["file"]).stat().st_size for x in cases)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
