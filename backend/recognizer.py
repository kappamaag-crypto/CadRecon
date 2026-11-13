"""CadRecon local advanced recognizer. No remote upload is performed by this server."""
import functools
import math
import os
from typing import Any

import cv2
import numpy as np

MAX_LINES = 16000
MAX_POLYS = 1000
MAX_CIRCLES = 450


@functools.lru_cache(maxsize=1)
def paddle():
    # Lazy init: tests and geometry recognition work without installing large OCR models.
    from paddleocr import PaddleOCR
    return PaddleOCR(
        lang="ru", ocr_version="PP-OCRv5",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=True,
        device=os.getenv("CADRECON_DEVICE", "cpu"),
    )


def parse_paddle_result(payload: Any) -> list[dict]:
    """Accept PaddleOCR 3.x result.json or {"res": {...}} wrapper."""
    if not isinstance(payload, dict):
        return []
    data = payload.get("res", payload)
    if not isinstance(data, dict):
        return []
    texts = data.get("rec_texts", [])
    boxes = data.get("rec_boxes", [])
    scores = data.get("rec_scores", [])
    output = []
    for text, box, score in zip(texts, boxes, scores):
        if not isinstance(text, str) or not text.strip() or len(box) < 4:
            continue
        x0, y0, x1, y1 = (float(x) for x in box[:4])
        if not all(math.isfinite(x) for x in (x0, y0, x1, y1)):
            continue
        output.append({"text": text.strip(), "box": [x0, y0, x1, y1],
                       "confidence": float(max(0, min(1, score)))})
    return output


def detect_text(image: np.ndarray) -> list[dict]:
    """PaddleOCR PP-OCRv5 Cyrillic/East-Slavic, with numeric scores and bounding boxes."""
    results = paddle().predict(image)
    output = []
    for result in results:
        data = result.json if hasattr(result, "json") else result
        output.extend(parse_paddle_result(data))
    return output


def _mask_text(gray: np.ndarray, labels: list[dict]) -> np.ndarray:
    result = gray.copy()
    height, width = gray.shape
    for t in labels:
        x0, y0, x1, y1 = t["box"]
        # mask only high-confidence OCR text; avoid erasing nearby geometry arbitrarily
        if t["confidence"] < .55:
            continue
        margin = 1
        xa, ya = max(0, int(x0)-margin), max(0, int(y0)-margin)
        xb, yb = min(width-1, int(x1)+margin), min(height-1, int(y1)+margin)
        cv2.rectangle(result, (xa, ya), (xb, yb), 255, -1)
    return result


def detect_geometry(image: np.ndarray, labels: list[dict] | None = None) -> dict:
    """Complementary LSD + probabilistic Hough detection on ORIGINAL resolution.

    Both are imperfect; return hypotheses, not structural as-built CAD geometry.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image.copy()
    height, width = gray.shape
    masked = _mask_text(gray, labels or [])
    clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8))
    enhanced = clahe.apply(masked)
    # Thin vertical/horizontal strokes and diagonal segments are collected separately.
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    found = []
    lsd_lines = lsd.detect(enhanced)[0]
    if lsd_lines is not None:
        for line in lsd_lines.reshape(-1, 4):
            x0, y0, x1, y1 = (float(x) for x in line)
            length = math.hypot(x1-x0, y1-y0)
            if length >= 8:
                found.append((x0, y0, x1, y1, .72))
    threshold = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 9,
    )
    min_length = max(8, min(38, round(min(width, height) * .01)))
    hough = cv2.HoughLinesP(
        threshold, rho=1, theta=np.pi/360, threshold=20,
        minLineLength=min_length, maxLineGap=8,
    )
    if hough is not None:
        for item in hough.reshape(-1, 4):
            x0, y0, x1, y1 = (float(x) for x in item)
            if math.hypot(x1-x0, y1-y0) >= 8:
                found.append((x0, y0, x1, y1, .62))
    dedup = set()
    lines = []
    # Stronger and longer geometric hypotheses first; avoids output dominated by text strokes.
    found.sort(key=lambda line: math.hypot(line[2]-line[0], line[3]-line[1]), reverse=True)
    for x0, y0, x1, y1, confidence in found:
        a = (x0,y0);b = (x1,y1)
        if a > b:
            a,b = b,a
        key = tuple(round(v/3) for v in (*a,*b))
        if key in dedup:
            continue
        dedup.add(key)
        lines.append({"a": list(a), "b": list(b), "confidence": confidence})
        if len(lines)>=MAX_LINES:
            break

    polygons, circles = [], []
    # Work on contour topology for small bolt holes, hexagonal nuts and washers.
    contours, _ = cv2.findContours(threshold, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 30 or area > width*height*.025:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter < 16:
            continue
        approx = cv2.approxPolyDP(contour, .028*perimeter, True).reshape(-1, 2)
        if 5<=len(approx)<=8 and cv2.isContourConvex(approx):
            if len(polygons)<MAX_POLYS:
                polygons.append({"points": approx.astype(float).tolist(), "confidence": .60})
        elif len(approx)>8:
            circularity=4*math.pi*area/max(1,perimeter*perimeter)
            if circularity>.76 and len(circles)<MAX_CIRCLES:
                (x,y),radius=cv2.minEnclosingCircle(contour)
                if 3<radius<400:
                    circles.append({"center":[float(x),float(y)],"radius":float(radius),"confidence":min(.83,circularity)})
    return {"lines":lines,"circles":circles,"polygons":polygons}


def process(image: np.ndarray) -> dict:
    height,width = image.shape[:2]
    warnings = []
    try:
        texts = detect_text(image)
    except Exception as exc:
        # Do not misrepresent OCR errors as empty legitimate recognition.
        raise RuntimeError(f"PaddleOCR failed: {exc}") from exc
    geo=detect_geometry(image,texts)
    if len(geo["lines"])>=MAX_LINES:
        warnings.append("Достигнут предел распознанных линий; требуется обработка листа фрагментами.")
    return {"engine":"PaddleOCR PP-OCRv5 Russian + OpenCV LSD/Hough",
      "width":width,"height":height,"texts":texts,**geo,"warnings":warnings}
