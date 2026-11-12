import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync(
  new URL('../security/tests/g08_production_read_only_preflight.sql', import.meta.url), 'utf8'
);
const fixture = readFileSync(
  new URL('../security/tests/g08_readonly_preflight_fixture_pg17.sql', import.meta.url), 'utf8'
);
const stripped = sql.replace(/--[^\n]*/g, ' ');

test('G08: production preflight is a zero-write explicit read-only transaction', () => {
  assert.match(stripped, /^\s*BEGIN TRANSACTION READ ONLY;/i);
  assert.match(stripped, /ROLLBACK;\s*$/i);
  assert.match(stripped, /SET LOCAL lock_timeout = '2s'/);
  assert.match(stripped, /SET LOCAL statement_timeout = '20s'/);
  assert.doesNotMatch(stripped,
    /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+(?:TABLE|FUNCTION|INDEX)|GRANT\s+|REVOKE\s+|COMMIT;)\b/i);
  assert.doesNotMatch(stripped, /COPY\s+|pg_read_file|pg_ls_dir|lo_import/i);
});

test('G08: preflight matches exactly the 16 legacy FK names and checks drift', () => {
  const expected = [
    'leads_contact_id_fkey','leads_property_id_fkey',
    'activities_contact_id_fkey','activities_deal_id_fkey',
    'activities_lead_id_fkey','activities_property_id_fkey',
    'appointments_contact_id_fkey','appointments_lead_id_fkey',
    'appointments_property_id_fkey','commissions_deal_id_fkey',
    'portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey',
    'property_consignments_contact_id_fkey','property_consignments_lead_id_fkey',
    'property_consignments_property_id_fkey','property_private_photos_property_id_fkey',
  ];
  for(const name of expected){
    assert.ok(sql.includes("'"+name+"'"), 'Missing FK '+name);
    assert.ok(fixture.includes('CONSTRAINT '+name+' '),'Fixture omits FK '+name);
  }
  assert.match(sql, /IF checked<>16 THEN RAISE EXCEPTION/);
  assert.match(sql, /actual_del<>link.delete_char/);
  assert.match(sql, /convalidated/);
  assert.match(sql, /foreign_rows<>0/);
  assert.match(sql, /ownership_foreign<>0/);
  assert.match(sql, /SCHEMA_READY_BACKUP_NOT_CERTIFIED/);
});

test('G08: parent uniqueness and ownership guards are preflight requirements',()=>{
  for(const name of ['contacts','properties','property_owners','leads','deals']) {
    assert.ok(sql.includes("'"+name+"'"), 'Missing parent '+name);
  }
  assert.match(sql,/UNIQUE \(organization_id, id\)/);
  assert.match(sql,/enforce_property_ownership_same_tenant/);
  assert.match(sql,/prevent_ownership_parent_reassignment/);
  assert.match(sql,/read_only/);
});
