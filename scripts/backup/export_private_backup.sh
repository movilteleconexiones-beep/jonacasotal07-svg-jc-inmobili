#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL using your secret manager}"
: "${BACKUP_OUTPUT_DIR:?Set BACKUP_OUTPUT_DIR to a private destination}"
umask 077
if [[ -L "$BACKUP_OUTPUT_DIR" ]]; then echo "Refusing symlink destination" >&2; exit 1; fi
mkdir -p -m 700 "$BACKUP_OUTPUT_DIR"
chmod 700 "$BACKUP_OUTPUT_DIR"
if [[ -n "$(ls -A "$BACKUP_OUTPUT_DIR")" ]]; then echo "Backup directory must be empty" >&2; exit 1; fi
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$BACKUP_OUTPUT_DIR/database.dump"
sha256sum "$BACKUP_OUTPUT_DIR/database.dump" > "$BACKUP_OUTPUT_DIR/database.dump.sha256"
mkdir -m 700 "$BACKUP_OUTPUT_DIR/storage-export"
BACKUP_OUTPUT_DIR="$BACKUP_OUTPUT_DIR/storage-export" python3 scripts/backup/export_private_storage.py
echo "Backup candidate exported locally. This does NOT prove restore; encrypt off-host and rehearse restore."
