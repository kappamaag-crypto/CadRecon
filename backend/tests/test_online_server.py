import io
import os
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend.online_server import app, jobs, jobs_lock


TOKEN = "w0-pilot-test-only-do-not-use-12345"
AUTH = {"Authorization": "Bearer " + TOKEN}


def sample_png():
    out = io.BytesIO()
    Image.new("RGB", (64, 48), "white").save(out, format="PNG")
    return out.getvalue()


def upload(client, *, consent="true", headers=None, data=None):
    return client.post(
        "/v1/jobs",
        headers=headers if headers is not None else AUTH,
        data={"consent": consent},
        files={"image": ("sheet.png", data if data is not None else sample_png(), "image/png")},
    )


class TestOnlineAccuratePilot(unittest.TestCase):
    def setUp(self):
        with jobs_lock:
            jobs.clear()
        self.env = patch.dict(os.environ, {"CADRECON_ONLINE_TOKEN": TOKEN})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(app)

    def tearDown(self):
        with jobs_lock:
            jobs.clear()

    def test_unconfigured_service_fails_closed(self):
        with patch.dict(os.environ, {"CADRECON_ONLINE_TOKEN": ""}):
            self.assertEqual(upload(self.client).status_code, 503)

    def test_invalid_bearer_and_missing_consent_rejected(self):
        self.assertEqual(upload(self.client, headers={"Authorization": "Bearer wrong"}).status_code, 401)
        self.assertEqual(upload(self.client, consent="false").status_code, 422)

    def test_unsupported_image_rejected_before_model_call(self):
        with patch("backend.online_server.process") as model:
            self.assertEqual(upload(self.client, data=b"%PDF-1.4 invalid").status_code, 415)
            self.assertEqual(upload(self.client, data=b"").status_code, 413)
            model.assert_not_called()

    def test_job_lifecycle_requires_a_random_per_job_capability(self):
        result = {"engine": "mock", "width": 64, "height": 48, "texts": [],
                  "lines": [], "circles": [], "polygons": []}
        with patch("backend.online_server.process", return_value=result):
            submitted = upload(self.client)
            self.assertEqual(submitted.status_code, 202, submitted.text)
            body = submitted.json()
            self.assertEqual(body["status"], "queued")
            jid, capability = body["id"], body["job_token"]
            url = "/v1/jobs/" + jid
            self.assertEqual(self.client.get(url, headers=AUTH).status_code, 404)
            scoped = {**AUTH, "X-Job-Token": capability}
            for _ in range(100):
                current = self.client.get(url, headers=scoped)
                self.assertEqual(current.status_code, 200)
                if current.json()["status"] == "succeeded":
                    break
                time.sleep(.01)
            else:
                self.fail("Background test recognizer did not finish")
            self.assertEqual(self.client.get(url + "/result", headers=scoped).json(), result)
            self.assertEqual(self.client.delete(url, headers=scoped).json(), {"deleted": True})
            self.assertEqual(self.client.get(url, headers=scoped).status_code, 404)

    def test_job_cannot_be_read_with_another_capability(self):
        with patch("backend.online_server.process", return_value={"ok": True}):
            body = upload(self.client).json()
            self.assertEqual(
                self.client.get("/v1/jobs/" + body["id"],
                                headers={**AUTH, "X-Job-Token": "wrong"}).status_code,
                404,
            )


if __name__ == "__main__":
    unittest.main()
