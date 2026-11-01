#!/usr/bin/env bash
# Package an already completed export with age public-key encryption.
set -euo pipefail
: "${BACKUP_OUTPUT_DIR:?Set BACKUP_OUTPUT_DIR}"
: "${BACKUP_AGE_RECIPIENT:?Set recipient public key (age1...)}"
: "${BACKUP_ENCRYPTED_OUTPUT:?Set private destination for encrypted package}"
command -v age >/dev/null || { echo "age CLI required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar CLI required" >&2; exit 1; }
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] || { echo "Invalid age recipient" >&2; exit 1; }
[[ -f "$BACKUP_OUTPUT_DIR/EXPORT_COMPLETE.json" ]] || { echo "Export not marked complete" >&2; exit 1; }
[[ ! -e "$BACKUP_ENCRYPTED_OUTPUT" ]] || { echo "Encrypted target already exists" >&2; exit 1; }
umask 077
parent="$(dirname "$BACKUP_OUTPUT_DIR")"
base="$(basename "$BACKUP_OUTPUT_DIR")"
# Tar sends plaintext only through the pipe; age writes encrypted bytes to a new file.
[[ ! -e "$BACKUP_ENCRYPTED_OUTPUT.sha256" ]] || { echo "Checksum target already exists" >&2; exit 1; }
target_dir="$(dirname "$BACKUP_ENCRYPTED_OUTPUT")"
[[ -d "$target_dir" && ! -L "$target_dir" ]] || { echo "Encrypted destination directory missing or unsafe" >&2; exit 1; }
tmp="$(mktemp "$target_dir/.inmojco-encrypted.XXXXXXXX.age")"
trap 'rm -f "$tmp"' EXIT
tar -C "$parent" -cf - "$base" | age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp"
test -s "$tmp" || { echo "Empty encrypted package" >&2; exit 1; }
chmod 600 "$tmp"
# Publish only after the streaming pipeline succeeds.
mv -n "$tmp" "$BACKUP_ENCRYPTED_OUTPUT"
[[ -e "$tmp" ]] && { echo "Refusing overwrite" >&2; exit 1; }
trap - EXIT
sha256sum "$BACKUP_ENCRYPTED_OUTPUT" > "$BACKUP_ENCRYPTED_OUTPUT.sha256"
chmod 600 "$BACKUP_ENCRYPTED_OUTPUT.sha256"
echo "Encrypted package created. Restore has NOT been verified. Keep age private identity offline."
