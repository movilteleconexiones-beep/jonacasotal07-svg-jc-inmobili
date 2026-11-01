#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin"
cat > "$root/bin/pg_dump" <<'SH'
#!/usr/bin/env bash
exit 23
SH
chmod +x "$root/bin/pg_dump"
export PATH="$root/bin:$PATH"
export DATABASE_URL="postgresql://unused.invalid/db"
export BACKUP_OUTPUT_DIR="$root/private"
if bash scripts/backup/export_private_backup.sh >/dev/null 2>&1; then
  echo "Failed pg_dump incorrectly reported success" >&2; exit 1
fi
test ! -e "$BACKUP_OUTPUT_DIR/EXPORT_COMPLETE.json" || {
  echo "False completion marker created" >&2; exit 1;
}
echo "Interrupted export correctly left no completion marker."
