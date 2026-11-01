#!/usr/bin/env bash
set -euo pipefail
umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
createdb backup_source
psql -v ON_ERROR_STOP=1 -d backup_source <<'SQL'
CREATE TABLE public.sample_organizations(id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.sample_receipts(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.sample_organizations(id), amount integer NOT NULL CHECK(amount>0));
INSERT INTO public.sample_organizations VALUES (1,'FICTITIOUS JCO'),(2,'FICTITIOUS OTHER');
INSERT INTO public.sample_receipts VALUES (10,1,100),(11,2,200);
SQL
pg_dump --dbname=backup_source --format=custom --no-owner --no-acl --file="$tmp/database.dump"
test -s "$tmp/database.dump"
sha256sum "$tmp/database.dump" > "$tmp/database.dump.sha256"
(cd "$tmp" && sha256sum -c database.dump.sha256)
createdb backup_restored
pg_restore --dbname=backup_restored --no-owner --no-acl --exit-on-error "$tmp/database.dump"
actual="$(psql -Atq -d backup_restored -c 'SELECT count(*)::text || chr(58) || sum(amount)::text FROM public.sample_receipts')"
test "$actual" = "2:300" || { echo "Restoration integrity check failed: $actual" >&2; exit 1; }
echo "Synthetic PostgreSQL restore verified; production recovery NOT verified."
