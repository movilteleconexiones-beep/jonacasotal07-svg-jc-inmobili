import json
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

if __name__ == "__main__":
    unittest.main()
