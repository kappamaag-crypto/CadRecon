"""CadRecon Online Accurate — opt-in, single-tenant development API.

This is an isolated self-hosted pilot API, NOT a production multi-tenant SaaS.
GitHub Pages is static; an operator must deploy this module separately.

Controls: fail-closed bearer auth, explicit per-file consent, bounded queue,
non-persistent job results, per-job secrets, size/pixel limits, no model data
in logs, and delete-on-request. A real cloud launch still requires persistent
queue, tenant isolation, encrypted storage, region/retention decisions,
monitoring, malware sandboxing, and independent security review.
"""
from __future__ import annotations

import hmac
import io
import os
import secrets
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from backend.recognizer import process

MAX_UPLOAD = 25 * 1024 * 1024
MAX_PIXELS = 42_000_000
MAX_RECORDS = 20
TTL_SECONDS = 15 * 60
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cadrecon-ocr")
jobs_lock = threading.RLock()


@dataclass
class Job:
    id: str
    secret: str
    created: float
    expires: float
    status: str = "queued"
    future: Future | None = None
    result: dict[str, Any] | None = None
    failure: str | None = None


jobs: dict[str, Job] = {}

app = FastAPI(
    title="CadRecon Online Accurate (single-tenant pilot)",
    version="0.1.0",
    docs_url=None, redoc_url=None, openapi_url=None,
)
default_origins = "https://kappamaag-crypto.github.io"
origins = [item.strip() for item in os.environ.get(
    "CADRECON_ONLINE_ORIGINS", default_origins).split(",") if item.strip()]
# No wildcard CORS or cookies. Token auth is mandatory for ALL jobs.
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "X-Job-Token", "Content-Type"],
    expose_headers=[],
)


def require_auth(authorization: str | None) -> None:
    expected = os.environ.get("CADRECON_ONLINE_TOKEN", "")
    if len(expected) < 24:
        raise HTTPException(503, "Online service is not configured")
    if not hmac.compare_digest(authorization or "", "Bearer " + expected):
        raise HTTPException(401, "Invalid access token")


def prune() -> None:
    """Remove expired jobs; workers discard results of missing records."""
    now = time.monotonic()
    with jobs_lock:
        for jid, job in list(jobs.items()):
            if now >= job.expires:
                if job.future is not None:
                    job.future.cancel()
                job.result = None
                del jobs[jid]


def owned_job(job_id: str, job_token: str | None) -> Job:
    prune()
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or not job_token or not hmac.compare_digest(job.secret, job_token):
            # Deliberately indistinguishable for unknown id and invalid secret.
            raise HTTPException(404, "Job not found")
        return job


def validate_image(payload: bytes) -> np.ndarray:
    """Reject huge compressed images before expensive OpenCV decoding."""
    if not payload or len(payload) > MAX_UPLOAD:
        raise HTTPException(413, "Image exceeds 25 MB")
    if not (payload.startswith(b"\x89PNG\r\n\x1a\n")
            or payload.startswith(b"\xff\xd8\xff")
            or payload.startswith((b"II*\x00", b"MM\x00*"))):
        raise HTTPException(415, "Only PNG/JPEG/TIFF images are supported")
    try:
        with Image.open(io.BytesIO(payload)) as im:
            if im.format not in ("PNG", "JPEG", "TIFF"):
                raise HTTPException(415, "Unsupported image encoding")
            w, h = im.size
            if w < 2 or h < 2 or w * h > MAX_PIXELS:
                raise HTTPException(413, "Image exceeds 42 MP")
            if getattr(im, "n_frames", 1) > 1:
                raise HTTPException(415, "Send one page per job")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(415, "Unreadable image") from None
    # cv2 will not execute PDF JavaScript; input is an image only.
    img = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(415, "Cannot decode image")
    decoded_height, decoded_width = img.shape[:2]
    if decoded_height < 2 or decoded_width < 2 or decoded_height * decoded_width > MAX_PIXELS:
        raise HTTPException(413, "Decoded image exceeds 42 MP")
    return img


def work(jid: str, image: np.ndarray) -> None:
    with jobs_lock:
        job = jobs.get(jid)
        if job is None or job.status == "cancelled":
            return
        job.status = "running"
    try:
        result = process(image)
    except Exception:
        # Avoid logging confidential drawing text or raw backend exceptions.
        with jobs_lock:
            job = jobs.get(jid)
            if job and job.status != "cancelled":
                job.failure = "Recognition failed"
                job.status = "failed"
        return
    with jobs_lock:
        job = jobs.get(jid)
        if job and job.status != "cancelled" and time.monotonic() < job.expires:
            job.result = result
            job.status = "succeeded"


@app.get("/v1/health")
def health():
    return {"ready": len(os.environ.get("CADRECON_ONLINE_TOKEN", "")) >= 24,
            "profile": "single-tenant-pilot", "storage": "ephemeral-memory",
            "engine": "PaddleOCR + OpenCV"}


@app.post("/v1/jobs", status_code=202)
async def submit(
    image: UploadFile = File(...),
    consent: bool = Form(False),
    authorization: str | None = Header(default=None),
):
    require_auth(authorization)
    if not consent:
        raise HTTPException(422, "Explicit upload consent is required")
    prune()
    with jobs_lock:
        active = sum(j.status in ("queued", "running") for j in jobs.values())
        if len(jobs) >= MAX_RECORDS or active >= 3:
            raise HTTPException(429, "Service queue is full")
    payload = await image.read(MAX_UPLOAD + 1)
    data = validate_image(payload)
    jid = secrets.token_urlsafe(20)
    secret = secrets.token_urlsafe(32)
    now = time.monotonic()
    job = Job(jid, secret, now, now + TTL_SECONDS)
    with jobs_lock:
        # Recheck after expensive image decode; no unbounded overflow.
        if len(jobs) >= MAX_RECORDS:
            raise HTTPException(429, "Service queue is full")
        jobs[jid] = job
        job.future = pool.submit(work, jid, data)
    return {"id": jid, "job_token": secret, "status": "queued",
            "expires_in_seconds": TTL_SECONDS}


@app.get("/v1/jobs/{job_id}")
def status(job_id: str, authorization: str | None = Header(default=None),
           x_job_token: str | None = Header(default=None)):
    require_auth(authorization)
    job = owned_job(job_id, x_job_token)
    return {"id": job.id, "status": job.status, "expires_in_seconds":
            max(0, int(job.expires - time.monotonic()))}


@app.get("/v1/jobs/{job_id}/result")
def result(job_id: str, authorization: str | None = Header(default=None),
           x_job_token: str | None = Header(default=None)):
    require_auth(authorization)
    job = owned_job(job_id, x_job_token)
    if job.status == "failed":
        raise HTTPException(422, job.failure or "Recognition failed")
    if job.status != "succeeded" or job.result is None:
        raise HTTPException(409, "Result not ready")
    return job.result


@app.delete("/v1/jobs/{job_id}")
def delete(job_id: str, authorization: str | None = Header(default=None),
           x_job_token: str | None = Header(default=None)):
    require_auth(authorization)
    job = owned_job(job_id, x_job_token)
    with jobs_lock:
        job.status = "cancelled"
        job.result = None
        if job.future is not None:
            job.future.cancel()
        jobs.pop(job_id, None)
    return {"deleted": True}
