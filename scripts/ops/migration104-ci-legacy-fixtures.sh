#!/usr/bin/env bash
# DRAFT #104 — CI ONLY: temporarily use 109 archived historical SQL sources
# for existing legacy unit/isolated PG fixtures after exact 99 canonical cutover
# has been independently verified. NEVER run on a user's PC or in production.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" || -z "${RUNNER_TEMP:-}" ]]; then
  echo "NO-GO: legacy fixture compatibility is allowed ONLY in ephemeral GitHub Actions" >&2
  exit 2
fi
if [[ ! -f docs/ops/snapshots/legacy-sql-sha-2026-11-07.json ]]; then
  echo "NO-GO: immutable archived source manifest missing" >&2
  exit 2
fi
node --test tests/migration104-cutover-gate.test.mjs
node scripts/ops/migration104-cutover-gate.mjs
# Exercise every current offline audit against the REAL 99-file candidate
# before any temporary legacy fixture overlay. This proves that local
# historical tooling works without relying on CI-specific copy operations.
node scripts/ops/migration-source-parity-gate.mjs
node scripts/ops/reconstruct-applied-99.mjs
node scripts/ops/migration-version-risk-map.mjs
node scripts/ops/migration104-canonical-workspace.mjs
set +e
node scripts/ops/finance-migration-gate.mjs --ledger docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json > "$RUNNER_TEMP/canonical-finance-no-go.txt" 2>&1
finance_status=$?
set -e
if [[ "$finance_status" -ne 2 ]]; then
  cat "$RUNNER_TEMP/canonical-finance-no-go.txt"
  echo "NO-GO: finance gate must not authorize production SQL" >&2
  exit 2
fi
grep -q 'Do not run db push' "$RUNNER_TEMP/canonical-finance-no-go.txt"
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l)" -eq 99
archive="$RUNNER_TEMP/inmojco-104-canonical-sql-for-review"
if [[ -e "$archive" ]]; then
  echo "NO-GO: canonical CI snapshot path already exists" >&2
  exit 2
fi
mv supabase/migrations "$archive"
mkdir -p supabase/migrations
cp docs/ops/archive/legacy-sql-20261107/*.sql supabase/migrations/
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l)" -eq 109
echo "DRAFT #104: canonical 99 files verified and preserved in runner temporary directory; 109 legacy fixture sources activated for existing CI only; NO production SQL write."
