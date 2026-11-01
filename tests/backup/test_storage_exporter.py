import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/backup/export_private_storage.py"

class StorageExporterGuards(unittest.TestCase):
    def run_exporter(self, destination, url="http://localhost"):
        env = {**os.environ, "SUPABASE_URL": url,
               "SUPABASE_SERVICE_ROLE_KEY": "FICTIONAL_TEST_ONLY",
               "BACKUP_OUTPUT_DIR": str(destination)}
        return subprocess.run([sys.executable, str(SCRIPT)], env=env,
                              text=True, capture_output=True, timeout=10)

    def test_rejects_non_https_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_exporter(Path(tmp))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("HTTPS", result.stderr)

    def test_rejects_populated_destination_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "existing.dump").write_text("keep")
            result = self.run_exporter(Path(tmp), "https://example.invalid")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("empty", result.stderr)
            self.assertEqual((Path(tmp) / "existing.dump").read_text(), "keep")

    def test_rejects_unprivileged_destination_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.chmod(tmp, 0o755)
            result = self.run_exporter(Path(tmp), "https://example.invalid")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("private", result.stderr)

    def test_download_and_manifest_from_mock_storage(self):
        payload = b"fictional-pdf-bytes-for-test"
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/storage/v1/bucket":
                    data = json.dumps([{"id": "test-bucket"}]).encode()
                elif self.path == "/storage/v1/object/authenticated/test-bucket/sample.pdf":
                    data = payload
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(data)
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                self.rfile.read(length)
                data = json.dumps([{"id":"test-id","name":"sample.pdf","metadata":{"size":len(payload)}}]).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(data)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "private"
                output.mkdir(mode=0o700)
                # Mock endpoint is local HTTP; supply HTTPS by patching urllib URL opener in-process.
                import runpy
                from unittest.mock import patch
                import urllib.request
                original = urllib.request.urlopen
                def local_urlopen(request, timeout=None):
                    request.full_url = request.full_url.replace("https://mock.invalid", f"http://127.0.0.1:{server.server_port}")
                    return original(request, timeout=timeout)
                env = {"SUPABASE_URL":"https://mock.invalid","SUPABASE_SERVICE_ROLE_KEY":"FICTIONAL_TEST_ONLY","BACKUP_OUTPUT_DIR":str(output)}
                with patch.dict(os.environ, env), patch("urllib.request.urlopen", local_urlopen):
                    runpy.run_path(str(SCRIPT), run_name="__main__")
                stored = output / "storage" / "test-bucket" / "sample.pdf"
                self.assertEqual(stored.read_bytes(), payload)
                manifest = json.loads((output / "storage-manifest.json").read_text())
                self.assertEqual(manifest[0]["sha256"], hashlib.sha256(payload).hexdigest())
        finally:
            server.shutdown()
            server.server_close()

if __name__ == "__main__":
    unittest.main()
