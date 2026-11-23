#!/usr/bin/env python3
"""G18: offline integrity verification of an INMOJCO PostgreSQL + Storage export.

This is NOT a restoration and is deliberately unable to certify a GO for launch.
Process private data only on the host holding the original encrypted backup;
never upload the export, secrets or auth data to GitHub Actions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
BUCKET = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$")
MAX_OBJECTS = 100_000
MAX_DEPTH = 20
CHUNK_SIZE = 1024 * 1024


class UnsafeExport(RuntimeError):
    """Export cannot be certified. Report non-sensitive summary only."""


def require_file(path: Path, root: Path) -> None:
    if not path.exists() or path.is_symlink() or not path.is_file():
        raise UnsafeExport("backup_file_missing_or_symlink")
    # The export must be user-private throughout the accessible hierarchy.
    if (path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO)) != 0:
        raise UnsafeExport("backup_file_world_accessible")
    if not path.resolve(strict=True).is_relative_to(root):
        raise UnsafeExport("backup_file_outside_root")


def checksum(path: Path) -> tuple[str, int]:
    total = 0
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK_SIZE):
            total += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), total


def safe_name(value: object, bucket: bool = False) -> list[str]:
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise UnsafeExport("unsafe_object_path")
    parts = value.split("/")
    if bucket and not BUCKET.fullmatch(value):
        raise UnsafeExport("unsafe_bucket_identifier")
    if len(parts) > MAX_DEPTH or any(
        not p or p in {".", ".."} or "\\" in p or "\x00" in p or
        any(ord(ch) < 32 for ch in p) or len(p) > 255
        for p in parts
    ):
        raise UnsafeExport("unsafe_object_path")
    return parts


def verify_backup(root: Path, expected_objects: int, expected_bytes: int,
                  expected_buckets: int, pg_restore: str = "pg_restore") -> dict:
    if root.is_symlink() or not root.is_dir():
        raise UnsafeExport("private_export_directory_missing")
    root = root.resolve(strict=True)
    if root.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise UnsafeExport("private_export_directory_permissions")
    if expected_objects < 0 or expected_bytes < 0 or expected_buckets < 1:
        raise UnsafeExport("invalid_independent_baseline")

    db = root / "database.dump"
    sidecar = root / "database.dump.sha256"
    complete = root / "EXPORT_COMPLETE.json"
    storage_root = root / "storage-export"
    manifest_file = storage_root / "storage-manifest.json"
    buckets_file = storage_root / "bucket-manifest.json"
    for item in (db, sidecar, complete, manifest_file, buckets_file):
        require_file(item, root)
    if storage_root.is_symlink() or storage_root.stat().st_mode & 0o077:
        raise UnsafeExport("storage_directory_permissions")
    try:
        marker = json.loads(complete.read_text(encoding="utf-8"))
        objects = json.loads(manifest_file.read_text(encoding="utf-8"))
        buckets = json.loads(buckets_file.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise UnsafeExport("manifest_not_parseable") from exc

    if not isinstance(objects, list) or len(objects) != expected_objects or len(objects) > MAX_OBJECTS:
        raise UnsafeExport("storage_object_count_mismatch")
    if not isinstance(buckets, list) or len(buckets) != expected_buckets:
        raise UnsafeExport("storage_bucket_count_mismatch")
    seen_buckets = set()
    for b in buckets:
        if not isinstance(b, dict) or not isinstance(b.get("public"), bool):
            raise UnsafeExport("invalid_storage_bucket_manifest")
        safe_name(b.get("id"), bucket=True)
        if b["id"] in seen_buckets:
            raise UnsafeExport("duplicate_bucket")
        seen_buckets.add(b["id"])
    if marker.get("status") != "export_complete_restore_unverified":
        raise UnsafeExport("missing_export_completion_status")
    if marker.get("storage_objects") != expected_objects:
        raise UnsafeExport("completion_manifest_storage_count_mismatch")
    if marker.get("storage_buckets") != expected_buckets:
        raise UnsafeExport("completion_manifest_bucket_count_mismatch")

    db_sha, db_bytes = checksum(db)
    if db_bytes == 0 or not HEX_SHA256.fullmatch(db_sha):
        raise UnsafeExport("database_dump_empty")
    checksum_line = sidecar.read_text(encoding="utf-8").rstrip("\n")
    if (not checksum_line.startswith(db_sha + "  ") or
        Path(checksum_line[66:]).resolve() != db):
        raise UnsafeExport("database_checksum_sidecar_mismatch")
    if marker.get("database_dump_sha256") != db_sha:
        raise UnsafeExport("completion_database_hash_mismatch")

    # `pg_restore --list` checks archive structure without modifying *any* DB.
    # It does not prove the archive can be restored; a separate isolated restore
    # with `--exit-on-error` and data/ACL checks is mandatory.
    try:
        version = subprocess.run([pg_restore, "--version"], check=True, timeout=10,
                                 capture_output=True, text=True)
        if not re.search(r"PostgreSQL\) 17\.", version.stdout):
            raise UnsafeExport("pg_restore_17_required")
        subprocess.run([pg_restore, "--list", str(db)], check=True, timeout=60,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.SubprocessError, OSError) as exc:
        raise UnsafeExport("pg17_dump_structure_invalid") from exc

    present: set[tuple[str, str]] = set()
    total_bytes = 0
    for obj in objects:
        if not isinstance(obj, dict):
            raise UnsafeExport("invalid_object_entry")
        bucket, name = obj.get("bucket"), obj.get("path")
        safe_name(bucket, bucket=True)
        parts = safe_name(name)
        key = (bucket, name)
        if bucket not in seen_buckets or key in present:
            raise UnsafeExport("duplicate_or_unknown_bucket")
        present.add(key)
        size, expected_sha = obj.get("bytes"), obj.get("sha256")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise UnsafeExport("invalid_storage_size")
        if not isinstance(expected_sha, str) or not HEX_SHA256.fullmatch(expected_sha):
            raise UnsafeExport("invalid_storage_hash")
        payload = storage_root / "storage" / bucket
        for part in parts:
            payload /= part
            if payload.is_symlink():
                raise UnsafeExport("symlink_in_storage_path")
        require_file(payload, root)
        real_sha, real_bytes = checksum(payload)
        if real_sha != expected_sha or real_bytes != size:
            raise UnsafeExport("storage_bytes_or_sha256_mismatch")
        total_bytes += real_bytes
    if total_bytes != expected_bytes:
        raise UnsafeExport("independent_storage_bytes_mismatch")

    # Extra untracked payloads would mean we cannot prove the export manifest
    # contains every downloaded object.
    actual = set()
    folder = storage_root / "storage"
    if folder.exists():
        for f in folder.rglob("*"):
            if f.is_symlink():
                raise UnsafeExport("symlink_in_storage_tree")
            if f.is_file():
                rel = f.relative_to(folder)
                if len(rel.parts) < 2:
                    raise UnsafeExport("unknown_storage_payload")
                actual.add((rel.parts[0], "/".join(rel.parts[1:])))
    if present != actual:
        raise UnsafeExport("untracked_or_missing_storage_payload")
    return {
        "export_integrity": "PASS",
        "restore_verified": False,
        "production_migration_authorized": False,
        "database_dump_sha256": db_sha,
        "database_bytes": db_bytes,
        "storage_objects": expected_objects,
        "storage_buckets": expected_buckets,
        "storage_bytes": total_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify local export bytes; not a restore")
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--expected-objects", type=int, required=True)
    parser.add_argument("--expected-bytes", type=int, required=True)
    parser.add_argument("--expected-buckets", type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_backup(args.directory, args.expected_objects,
                  args.expected_bytes, args.expected_buckets), sort_keys=True))
        return 0
    except UnsafeExport as exc:
        print(json.dumps({"export_integrity": "FAIL", "reason": str(exc),
                          "restore_verified": False,
                          "production_migration_authorized": False}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())