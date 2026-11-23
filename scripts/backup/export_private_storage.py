#!/usr/bin/env python3
"""Export private Supabase Storage objects to a local, access-restricted directory.

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_OUTPUT_DIR.
Never log or commit tokens or downloaded files.
"""
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
root = Path(os.environ["BACKUP_OUTPUT_DIR"]).resolve()
if not url.startswith("https://"):
    raise ValueError("SUPABASE_URL must use HTTPS")
if not root.is_dir() or root.is_symlink() or (root.stat().st_mode & 0o077):
    raise PermissionError("BACKUP_OUTPUT_DIR must exist, be private and not be a symlink")
if any(root.iterdir()):
    raise FileExistsError("BACKUP_OUTPUT_DIR must be empty")

def call(endpoint, payload=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = Request(
        url + "/storage/v1/" + endpoint,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    with urlopen(request, timeout=120) as response:
        return response.read()

buckets = json.loads(call("bucket"))
if not isinstance(buckets, list):
    raise ValueError("Invalid Storage bucket response")
manifest = []
bucket_manifest = []
seen_buckets = set()
seen_objects = set()
for bucket in buckets:
    bucket_id = bucket.get("id")
    if not isinstance(bucket_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", bucket_id):
        raise ValueError("Unsafe Storage bucket identifier")
    if bucket_id in seen_buckets:
        raise ValueError("Duplicate Storage bucket")
    seen_buckets.add(bucket_id)
    public = bucket.get("public", False)
    if not isinstance(public, bool):
        raise ValueError("Invalid bucket privacy flag")
    bucket_manifest.append({"id": bucket_id, "public": public})
    pending = [""]
    while pending:
        prefix = pending.pop()
        offset = 0
        while True:
            entries = json.loads(call(
                "object/list/" + quote(bucket_id, safe=""),
                {"prefix": prefix, "limit": 100, "offset": offset},
            ))
            for item in entries:
                name = item["name"]
                if name in (".", "..") or "/" in name or "\\" in name:
                    raise ValueError("Unsafe Storage path component")
                object_path = (prefix + "/" if prefix else "") + name
                if len(object_path) > 2048 or len(object_path.split("/")) > 20:
                    raise ValueError("Unsafe Storage path length")
                if item.get("id") is None:
                    pending.append(object_path)
                    continue
                object_id = (bucket_id, object_path)
                if object_id in seen_objects or len(seen_objects) >= 100_000:
                    raise ValueError("Duplicate or excessive Storage export")
                seen_objects.add(object_id)
                destination = root / "storage" / bucket_id / object_path
                if not destination.resolve().is_relative_to(root):
                    raise ValueError("Unsafe object path")
                destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                data = call(
                    "object/authenticated/"
                    + quote(bucket_id, safe="")
                    + "/"
                    + quote(object_path, safe="/")
                )
                with destination.open("xb") as output:
                    output.write(data)
                destination.chmod(0o600)
                metadata = item.get("metadata") or {}
                if not isinstance(metadata, dict):
                    raise ValueError("Invalid Storage metadata")
                expected_size = metadata.get("size")
                if expected_size is not None and len(data) != int(expected_size):
                    raise IOError(f"Storage size mismatch: {bucket_id}/{object_path}")
                manifest.append({
                    "bucket": bucket_id, "path": object_path,
                    "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                })
            if len(entries) < 100:
                break
            offset += len(entries)
with (root / "storage-manifest.json").open("x", encoding="utf-8") as output:
    json.dump(manifest, output, indent=2, ensure_ascii=False)
os.chmod(root / "storage-manifest.json", 0o600)
with (root / "bucket-manifest.json").open("x", encoding="utf-8") as output:
    json.dump(bucket_manifest, output, indent=2, ensure_ascii=False)
os.chmod(root / "bucket-manifest.json", 0o600)
print(f"Exported {len(manifest)} objects in {len(bucket_manifest)} buckets; verify and encrypt before transferring.")
