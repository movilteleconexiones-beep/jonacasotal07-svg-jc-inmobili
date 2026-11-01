#!/usr/bin/env python3
"""Export private Supabase Storage objects to a local, access-restricted directory.

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_OUTPUT_DIR.
Never log or commit tokens or downloaded files.
"""
import hashlib
import json
import os
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
manifest = []
for bucket in buckets:
    bucket_id = bucket["id"]
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
                if item.get("id") is None:
                    pending.append(object_path)
                    continue
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
                expected_size = item.get("metadata", {}).get("size")
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
print(f"Exported {len(manifest)} objects; verify and encrypt before transferring.")
