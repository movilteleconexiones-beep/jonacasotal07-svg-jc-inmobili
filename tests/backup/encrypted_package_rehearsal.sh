#!/usr/bin/env bash
set -euo pipefail
command -v age >/dev/null
command -v age-keygen >/dev/null
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
mkdir -m 700 "$work/source"
printf 'fictional receipt, no customer data\n' > "$work/source/test.txt"
printf '{"status":"export_complete_restore_unverified"}\n' > "$work/source/EXPORT_COMPLETE.json"
age-keygen -o "$work/key.txt" 2>/dev/null
recipient="$(age-keygen -y "$work/key.txt")"
BACKUP_OUTPUT_DIR="$work/source" BACKUP_AGE_RECIPIENT="$recipient" \
 BACKUP_ENCRYPTED_OUTPUT="$work/archive.age" bash scripts/backup/encrypt_completed_export.sh
test -s "$work/archive.age"
(cd "$work" && sha256sum -c archive.age.sha256)
mkdir "$work/recovered"
age -d -i "$work/key.txt" "$work/archive.age" | tar -x -C "$work/recovered"
cmp "$work/source/test.txt" "$work/recovered/source/test.txt"
if BACKUP_OUTPUT_DIR="$work/source" BACKUP_AGE_RECIPIENT="$recipient" \
 BACKUP_ENCRYPTED_OUTPUT="$work/archive.age" bash scripts/backup/encrypt_completed_export.sh >/dev/null 2>&1; then
  echo "Overwriting an encrypted package was permitted" >&2; exit 1
fi
printf x >> "$work/archive.age"
if (cd "$work" && sha256sum -c archive.age.sha256 >/dev/null 2>&1); then
  echo "Tampered encrypted package passed checksum" >&2; exit 1
fi
echo "Synthetic encryption, recovery, overwrite and tamper tests passed"
