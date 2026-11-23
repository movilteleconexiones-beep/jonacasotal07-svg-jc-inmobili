"""G18 synthetic verifier tests: never access live Supabase or any user data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/backup/verify_private_export.py'
spec = importlib.util.spec_from_file_location('verify_private_export', SCRIPT)
g18 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g18)


def write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    path.write_bytes(data)
    os.chmod(path, 0o600)


class G18OfflineGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'private space'
        self.root.mkdir(mode=0o700)
        self.binary = Path(self.tmp.name) / 'pg_restore'
        self.binary.write_text('#!/bin/sh\ncase "$1" in --version) echo "pg_restore (PostgreSQL) 17.11";; --list) exit 0;; *) exit 1;; esac\n')
        self.binary.chmod(0o700)
        self.db = self.root / 'database.dump'
        self.data = b'fictional pg17 custom format bytes'
        write_private(self.db,self.data)
        digest = hashlib.sha256(self.data).hexdigest()
        write_private(self.root/'database.dump.sha256',f'{digest}  {self.db}\n'.encode())
        self.storage = self.root / 'storage-export'
        self.storage.mkdir(mode=0o700)
        self.one = self.storage/'storage'/'photos'/'building'/'demo.pdf'
        self.two = self.storage/'storage'/'docs'/'legal.txt'
        write_private(self.one,b'not customer photo')
        write_private(self.two,b'fictional agreement')
        self.total_bytes=len(self.one.read_bytes())+len(self.two.read_bytes())
        self.manifest = [dict(bucket=bucket,path=path,bytes=len(obj),sha256=hashlib.sha256(obj).hexdigest()) for bucket,path,obj in (
          ('photos','building/demo.pdf',self.one.read_bytes()),('docs','legal.txt',self.two.read_bytes()))]
        write_private(self.storage/'storage-manifest.json',json.dumps(self.manifest).encode())
        write_private(self.storage/'bucket-manifest.json',json.dumps([{'id':'docs','public':False},{'id':'photos','public':False},{'id':'empty','public':False}]).encode())
        write_private(self.root/'EXPORT_COMPLETE.json',json.dumps({'status':'export_complete_restore_unverified','storage_objects':2,'storage_buckets':3,'database_dump_sha256':digest}).encode())

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self,**k):
        return g18.verify_backup(self.root,k.get('expected_objects',2),k.get('expected_bytes',self.total_bytes),k.get('expected_buckets',3),str(self.binary))

    def test_fixture_passes_but_restore_remains_unverified(self):
        result=self.verify()
        self.assertEqual(result['export_integrity'],'PASS')
        self.assertFalse(result['restore_verified'])
        self.assertFalse(result['production_migration_authorized'])
        self.assertEqual(result['storage_buckets'],3)

    def test_modified_private_bytes_fail(self):
        self.one.write_bytes(b'X'+self.one.read_bytes()[1:])
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_missing_storage_bytes_fail(self):
        self.two.unlink()
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_untracked_file_fails(self):
        write_private(self.storage/'storage'/'photos'/'extra.pdf',b'test')
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_wrong_independent_baseline_fails(self):
        with self.assertRaises(g18.UnsafeExport):self.verify(expected_objects=3)
        with self.assertRaises(g18.UnsafeExport):self.verify(expected_bytes=999999)
        with self.assertRaises(g18.UnsafeExport):self.verify(expected_buckets=2)

    def test_symlinks_fail(self):
        self.two.unlink()
        self.two.symlink_to(self.one)
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_duplicate_manifest_entry_fails(self):
        self.manifest[1]=self.manifest[0]
        write_private(self.storage/'storage-manifest.json',json.dumps(self.manifest).encode())
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_tampered_pg_dump_fails(self):
        self.db.write_bytes(b'changed')
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_public_permissions_fail(self):
        self.one.chmod(0o644)
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_wrong_pg_client_version_fails(self):
        self.binary.write_text('#!/bin/sh\necho "pg_restore (PostgreSQL) 16.10"\n')
        with self.assertRaises(g18.UnsafeExport):self.verify()

    def test_unsafe_bucket_and_traversal_fail(self):
        self.manifest[0]['bucket']='../../other'
        write_private(self.storage/'storage-manifest.json',json.dumps(self.manifest).encode())
        with self.assertRaises(g18.UnsafeExport):self.verify()


if __name__=='__main__':unittest.main()