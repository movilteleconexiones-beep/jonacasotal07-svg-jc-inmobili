#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?DB_URL must be a disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/role_tenant_boundary_fixture.sql
echo "PASS: cross-tenant role assignment predicate rejects foreign role"
