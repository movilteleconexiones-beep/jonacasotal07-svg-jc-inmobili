#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL using your secret manager}"
: "${BACKUP_OUTPUT_DIR:?Set BACKUP_OUTPUT_DIR to a private destination}"
umask 077
mkdir -p "$BACKUP_OUTPUT_DIR"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$BACKUP_OUTPUT_DIR/database.dump"
sha256sum "$BACKUP_OUTPUT_DIR/database.dump" > "$BACKUP_OUTPUT_DIR/database.dump.sha256"
python3 scripts/backup/export_private_storage.py
echo "Backup candidate exported locally. This does NOT prove restore; encrypt off-host and rehearse restore."
