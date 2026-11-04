#!/usr/bin/env bash
# INMOJCO #104 / #203: disposable PostgreSQL 17 only; no live Supabase.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
[[ "$PGHOST" == localhost && "$PGPORT" == 5432 && "$PGUSER" == postgres ]] || exit 2
db=jco_portal_links_tenant_fk_test
candidate=security/candidates/portal_links_tenant_composite_fks.sql
log="${RUNNER_TEMP:-/tmp}/jco-portal-link-fk-deny.log"
cleanup(){
  code=$?
  trap - EXIT
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || code=1
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS anon, authenticated, service_role" || code=1
  exit "$code"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.contacts(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 CONSTRAINT financial_contacts_tenant_id_unique UNIQUE(organization_id,id)
);
CREATE TABLE public.property_owners(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 CONSTRAINT financial_property_owners_tenant_id_unique UNIQUE(organization_id,id)
);
CREATE TABLE public.portal_access_links(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
 owner_id uuid REFERENCES public.property_owners(id) ON DELETE CASCADE,
 CONSTRAINT portal_access_links_check CHECK(
   (contact_id IS NOT NULL AND owner_id IS NULL)
   OR (contact_id IS NULL AND owner_id IS NOT NULL)
 )
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_access_links ENABLE ROW LEVEL SECURITY;
-- Genuine-style staff policy already prevents the mismatch for ordinary users.
-- Defense in depth is required for service_role/security-definer operations.
CREATE POLICY portal_links_insert ON public.portal_access_links FOR INSERT TO authenticated
 WITH CHECK(organization_id=current_setting('app.tenant_id',true)::uuid
  AND (contact_id IS NULL OR EXISTS(
   SELECT 1 FROM public.contacts c WHERE c.id=contact_id
     AND c.organization_id=portal_access_links.organization_id))
  AND (owner_id IS NULL OR EXISTS(
   SELECT 1 FROM public.property_owners o WHERE o.id=owner_id
     AND o.organization_id=portal_access_links.organization_id)));
CREATE POLICY portal_links_select ON public.portal_access_links FOR SELECT TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY contact_read ON public.contacts FOR SELECT TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY owner_read ON public.property_owners FOR SELECT TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT ON public.portal_access_links TO authenticated;
GRANT SELECT ON public.contacts,public.property_owners TO authenticated;
GRANT ALL ON public.portal_access_links,public.contacts,public.property_owners TO service_role;
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.contacts VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO public.property_owners VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222');
INSERT INTO public.portal_access_links VALUES
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL),
 ('00000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',NULL,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
SQL
# Prove old DB constraint allows mismatched contact/owner links for a
# legitimate privileged SQL writer (ordinary staff RLS denies these).
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
INSERT INTO public.portal_access_links VALUES
 ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL),
 ('00000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',NULL,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.portal_access_links)<>4
 THEN RAISE EXCEPTION 'Synthetic legacy portal FK mismatch not reproduced'; END IF;
END $verify$;
ROLLBACK;
SQL
# Existing invalid links must fail closed; no partially changed DDL.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.portal_access_links VALUES ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: candidate accepted historical cross-agency portal link'; exit 1
fi
grep -q 'orphan or cross-organization portal links' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM pg_constraint WHERE conrelid='public.portal_access_links'::regclass AND conname='portal_access_links_contact_id_fkey' AND cardinality(conkey)=2")" == 0 ]] ||
 { echo 'ERROR: failed candidate left composite FK'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.portal_access_links WHERE id='00000000-0000-4000-8000-000000000003'"
# A nonowner should never apply these constraints.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE authenticated' -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: authenticated role unexpectedly accepted DDL'; exit 1
fi
# Apply and repeat; retain only one named relationship to each parent.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $verify$
DECLARE t text;
BEGIN
 IF (SELECT count(*) FROM public.portal_access_links)<>2
   OR NOT has_table_privilege('authenticated','public.portal_access_links','INSERT')
   OR NOT has_table_privilege('service_role','public.portal_access_links','SELECT')
   OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.portal_access_links'::regclass)
 THEN RAISE EXCEPTION 'Portal rows, RLS or authorized grants changed'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.portal_access_links'::regclass
     AND contype='f' AND confrelid='public.contacts'::regclass)<>1
   OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.portal_access_links'::regclass
     AND contype='f' AND confrelid='public.property_owners'::regclass)<>1
 THEN RAISE EXCEPTION 'Ambiguous PostgREST parent relationships'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint
   WHERE conrelid='public.portal_access_links'::regclass AND conname='portal_access_links_contact_id_fkey'
    AND convalidated AND pg_get_constraintdef(oid,true)=
    'FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE')
  OR NOT EXISTS(SELECT 1 FROM pg_constraint
   WHERE conrelid='public.portal_access_links'::regclass AND conname='portal_access_links_owner_id_fkey'
    AND convalidated AND pg_get_constraintdef(oid,true)=
    'FOREIGN KEY (organization_id, owner_id) REFERENCES property_owners(organization_id, id) ON DELETE CASCADE')
 THEN RAISE EXCEPTION 'Composite portal FKs invalid'; END IF;
END $verify$;
SQL
# Even postgres cannot associate portal A with contact/owner B after the FK.
for association in   "'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL"   "NULL,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'"; do
  if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.portal_access_links VALUES ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',$association)" > "$log" 2>&1; then
    echo "ERROR: cross-tenant portal link accepted: $association"; exit 1
  fi
  grep -q 'portal_access_links_' "$log"
done
# Authorized staff can still create correct contact and owner links.
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.portal_access_links)<>1
 THEN RAISE EXCEPTION 'Tenant A portal read drift'; END IF;
END $tenant$;
INSERT INTO public.portal_access_links VALUES
 ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
 '11111111-1111-4111-8111-111111111111',NULL,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.portal_access_links)<>1
 THEN RAISE EXCEPTION 'Tenant B portal read drift'; END IF;
END $tenant$;
ROLLBACK;
SQL
# Cascading delete still removes the link of the deleted contact or owner.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.contacts WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM public.portal_access_links")" == 1 ]] ||
 { echo 'ERROR: contact ON DELETE CASCADE drift'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.property_owners WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM public.portal_access_links")" == 0 ]] ||
 { echo 'ERROR: owner ON DELETE CASCADE drift'; exit 1; }
echo 'PASS: portal contact/owner same-org FKs, RLS, replay, PostgREST single relationship and cascades.'
