import io
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.server import app
from PIL import Image

def png():
    out=io.BytesIO()
    Image.new("RGB",(60,40),"white").save(out,format="PNG")
    return out.getvalue()

class TestServer(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(app)
    def test_health(self):
        self.assertTrue(self.client.get("/health").json()["ok"])
    def test_token_requires_authorization_when_configured(self):
        with patch.dict(os.environ,{"CADRECON_TOKEN":"testonly"}):
            r=self.client.post("/recognize",files={"image":("sample.png",png(),"image/png")})
            self.assertEqual(r.status_code,401)
    def test_recognition_proxies_local_inference_without_model_download(self):
        expected={"engine":"fixture","width":60,"height":40,"texts":[],"lines":[],"circles":[],"polygons":[]}
        with patch("backend.server.process",return_value=expected):
            r=self.client.post("/recognize",files={"image":("sample.png",png(),"image/png")})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json(),expected)
    def test_invalid_image_rejected(self):
        r=self.client.post("/recognize",files={"image":("broken.png",b"xxx","image/png")})
        self.assertEqual(r.status_code,415)
if __name__=="__main__":
    unittest.main()