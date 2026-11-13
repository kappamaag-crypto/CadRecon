"""Start using: python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765"""
import hmac
import io
import os

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.recognizer import process

app = FastAPI(title="CadRecon local recognition server", version="0.2.0")
allowed = os.getenv("CADRECON_ALLOWED_ORIGINS", "").split(",")
app.add_middleware(CORSMiddleware,allow_origins=[
    "https://kappamaag-crypto.github.io",
    "http://localhost:5173","http://127.0.0.1:5173",
    *[x.strip() for x in allowed if x.strip()],
],allow_methods=["GET","POST","OPTIONS"],allow_headers=["Authorization","Content-Type"])
MAX_FILE = 35*1024*1024
MAX_PIXELS = 42000000


@app.get("/health")
def health():
    return {"ok":True,"engine":"PaddleOCR PP-OCRv5 + OpenCV"}


@app.post("/recognize")
async def recognize(image: UploadFile=File(...),authorization: str|None=Header(default=None)):
    expected=os.getenv("CADRECON_TOKEN","")
    if expected and not hmac.compare_digest(authorization or "", "Bearer "+expected):
        raise HTTPException(status_code=401,detail="Invalid access token")
    payload=await image.read(MAX_FILE+1)
    if not payload or len(payload)>MAX_FILE:
        raise HTTPException(status_code=413,detail="Image exceeds 35MB")
    cv_image=cv2.imdecode(np.frombuffer(payload,dtype=np.uint8),cv2.IMREAD_COLOR)
    if cv_image is None:
        raise HTTPException(status_code=415,detail="Unreadable image")
    height,width=cv_image.shape[:2]
    if height*width>MAX_PIXELS:
        raise HTTPException(status_code=413,detail="Image too large, crop or reduce to 42MP")
    try:
        return process(cv_image)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e)) from e
