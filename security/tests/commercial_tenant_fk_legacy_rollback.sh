#!/usr/bin/env bash
set -euo pipefail

# Independent PostgreSQL test databases, never production.
MIGRATION="supabase/migrations/20261011195000_commercial_tenant_reference_consistency.sql"
FIXTURE="security/tests/commercial_tenant_fk_fixture.sql"

for scenario in lead_contact lead_property deal_contact deal_property commission_deal; do
  db="jco_fk_preflight_$scenario"
  psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db" >/dev/null
  psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d "$db" -f "$FIXTURE" >/dev/null

  case "$scenario" in
    lead_contact)
      sql="INSERT INTO public.leads VALUES ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);";;
    lead_property)
      sql="INSERT INTO public.leads VALUES ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd');";;
    deal_contact)
      sql="INSERT INTO public.deals VALUES ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc');";;
    deal_property)
      sql="INSERT INTO public.deals VALUES ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd');";;
    commission_deal)
      psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.deals VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');" >/dev/null
      sql="INSERT INTO public.commissions VALUES ('10101010-1010-4010-8010-101010101010','22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-ffffffffffff');";;
  esac

  psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d "$db" -c "$sql" >/dev/null
  log="$(mktemp)"
  if psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d "$db" -f "$MIGRATION" >"$log" 2>&1; then
    echo "FAIL: $scenario allowed unsafe migration" >&2
    rm -f "$log"
    exit 1
  fi
  if ! grep -q 'Cross-organization CRM reference exists; migration aborted' "$log"; then
    echo "FAIL: $scenario did not hit expected preflight guard" >&2
    tail -n 15 "$log" >&2
    rm -f "$log"
    exit 1
  fi
  rm -f "$log"

  psql -h localhost -U postgres -v ON_ERROR_STOP=1 -d "$db" -c "
    DO \$\$
    DECLARE original_count integer; new_count integer; unique_count integer;
    BEGIN
      SELECT count(*) INTO original_count FROM pg_constraint
        WHERE conname IN ('leads_contact_id_fkey','leads_property_id_fkey',
          'deals_contact_id_fkey','deals_property_id_fkey','commissions_deal_id_fkey');
      SELECT count(*) INTO new_count FROM pg_constraint
        WHERE conname IN ('leads_contact_same_tenant_fk','leads_property_same_tenant_fk',
          'deals_contact_same_tenant_fk','deals_property_same_tenant_fk','commissions_deal_same_tenant_fk');
      SELECT count(*) INTO unique_count FROM pg_constraint
        WHERE conname IN ('contacts_tenant_identity_key','properties_tenant_identity_key',
          'deals_tenant_identity_key');
      IF original_count <> 5 OR new_count <> 0 OR unique_count <> 0 THEN
        RAISE EXCEPTION 'Migration did not completely roll back after preflight failure';
      END IF;
    END
    \$\$;" >/dev/null
  echo "PASS: $scenario rejected and original schema preserved"
done
