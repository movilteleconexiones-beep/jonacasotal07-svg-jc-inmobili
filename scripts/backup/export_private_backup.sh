#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL using your secret manager}"
: "${BACKUP_OUTPUT_DIR:?Set BACKUP_OUTPUT_DIR to a private destination}"
umask 077
# Marker appears only after both exports succeed and the manifests validate.
# An interrupted export must remain unmistakably incomplete.
if [[ -L "$BACKUP_OUTPUT_DIR" ]]; then echo "Refusing symlink destination" >&2; exit 1; fi
mkdir -p -m 700 "$BACKUP_OUTPUT_DIR"
chmod 700 "$BACKUP_OUTPUT_DIR"
if [[ -n "$(ls -A "$BACKUP_OUTPUT_DIR")" ]]; then echo "Backup directory must be empty" >&2; exit 1; fi
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$BACKUP_OUTPUT_DIR/database.dump"
sha256sum "$BACKUP_OUTPUT_DIR/database.dump" > "$BACKUP_OUTPUT_DIR/database.dump.sha256"
mkdir -m 700 "$BACKUP_OUTPUT_DIR/storage-export"
BACKUP_OUTPUT_DIR="$BACKUP_OUTPUT_DIR/storage-export" python3 scripts/backup/export_private_storage.py
python3 - "$BACKUP_OUTPUT_DIR" <<'PY'
import hashlib
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
entries = json.loads((root / "storage-export/storage-manifest.json").read_text())
for item in entries:
    path = root / "storage-export/storage" / item["bucket"] / item["path"]
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise SystemExit("Storage manifest validation failed")
if not (root / "database.dump").is_file() or not (root / "database.dump").stat().st_size:
    raise SystemExit("Database dump missing or empty")
(root / "EXPORT_COMPLETE.json").write_text(json.dumps({
    "status": "export_complete_restore_unverified",
    "storage_objects": len(entries),
    "database_dump_sha256": hashlib.sha256((root / "database.dump").read_bytes()).hexdigest()
}, indent=2))
(root / "EXPORT_COMPLETE.json").chmod(0o600)
PY
echo "Export complete; restore NOT verified. Encrypt off-host before retention."
