import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../security/ops/g11_cover_tenant_foreign_keys.sql',import.meta.url),'utf8');
const expected=[
  {
    "schema": "private",
    "table": "website_lead_consents",
    "columns": "organization_id, lead_id, contact_id",
    "constraint": "website_lead_consents_tenant_lead_fk",
    "index": "g11_idx_private_lead_consents_tenant_lead"
  },
  {
    "schema": "public",
    "table": "activities",
    "columns": "organization_id, contact_id",
    "constraint": "activities_contact_id_fkey",
    "index": "g11_idx_activities_tenant_contact"
  },
  {
    "schema": "public",
    "table": "activities",
    "columns": "organization_id, deal_id",
    "constraint": "activities_deal_id_fkey",
    "index": "g11_idx_activities_tenant_deal"
  },
  {
    "schema": "public",
    "table": "activities",
    "columns": "organization_id, lead_id",
    "constraint": "activities_lead_id_fkey",
    "index": "g11_idx_activities_tenant_lead"
  },
  {
    "schema": "public",
    "table": "activities",
    "columns": "organization_id, property_id",
    "constraint": "activities_property_id_fkey",
    "index": "g11_idx_activities_tenant_property"
  },
  {
    "schema": "public",
    "table": "appointments",
    "columns": "organization_id, contact_id",
    "constraint": "appointments_contact_id_fkey",
    "index": "g11_idx_appointments_tenant_contact"
  },
  {
    "schema": "public",
    "table": "appointments",
    "columns": "organization_id, lead_id",
    "constraint": "appointments_lead_id_fkey",
    "index": "g11_idx_appointments_tenant_lead"
  },
  {
    "schema": "public",
    "table": "appointments",
    "columns": "organization_id, property_id",
    "constraint": "appointments_property_id_fkey",
    "index": "g11_idx_appointments_tenant_property"
  },
  {
    "schema": "public",
    "table": "commissions",
    "columns": "organization_id, deal_id",
    "constraint": "commissions_deal_id_fkey",
    "index": "g11_idx_commissions_tenant_deal"
  },
  {
    "schema": "public",
    "table": "leads",
    "columns": "organization_id, contact_id",
    "constraint": "leads_contact_id_fkey",
    "index": "g11_idx_leads_tenant_contact"
  },
  {
    "schema": "public",
    "table": "leads",
    "columns": "organization_id, property_id",
    "constraint": "leads_property_id_fkey",
    "index": "g11_idx_leads_tenant_property"
  },
  {
    "schema": "public",
    "table": "maintenance_requests",
    "columns": "organization_id, property_id",
    "constraint": "maintenance_requests_property_id_fkey",
    "index": "g11_idx_maintenance_tenant_property"
  },
  {
    "schema": "public",
    "table": "portal_access_links",
    "columns": "organization_id, contact_id",
    "constraint": "portal_access_links_contact_id_fkey",
    "index": "g11_idx_portal_links_tenant_contact"
  },
  {
    "schema": "public",
    "table": "portal_access_links",
    "columns": "organization_id, owner_id",
    "constraint": "portal_access_links_owner_id_fkey",
    "index": "g11_idx_portal_links_tenant_owner"
  },
  {
    "schema": "public",
    "table": "property_consignments",
    "columns": "organization_id, contact_id",
    "constraint": "property_consignments_contact_id_fkey",
    "index": "g11_idx_consignments_tenant_contact"
  },
  {
    "schema": "public",
    "table": "property_consignments",
    "columns": "organization_id, lead_id",
    "constraint": "property_consignments_lead_id_fkey",
    "index": "g11_idx_consignments_tenant_lead"
  },
  {
    "schema": "public",
    "table": "property_consignments",
    "columns": "organization_id, property_id",
    "constraint": "property_consignments_property_id_fkey",
    "index": "g11_idx_consignments_tenant_property"
  }
];

test('G11 supports all 17 genuine tenant-scoped composite foreign keys',()=>{
 assert.equal(expected.length,17);
 assert.equal(new Set(expected.map(x=>x.constraint)).size,17);
 assert.equal(new Set(expected.map(x=>x.index)).size,17);
 for(const e of expected){
   assert.match(source,new RegExp('\\('+"'" +e.constraint+"',"+ "'" +e.index+"'," + "'" +e.schema+'.'+e.table+"'"+'\\)'));
   const needle='CREATE INDEX IF NOT EXISTS '+e.index+
      ' ON '+e.schema+'.'+e.table+' ('+e.columns+');';
   assert.ok(source.includes(needle),'Missing exact index '+e.index);
 }
});
test('G11 is atomic, fail-closed, with 17/17 catalog coverage and no financial mutations',()=>{
 assert.match(source,/^BEGIN;/m);
 assert.match(source,/^COMMIT;\\s*$/m);
 assert.match(source,/SET LOCAL lock_timeout='3s'/);
 assert.match(source,/current_user <> 'postgres'/);
 assert.match(source,/IF v_count<>17/);
 assert.match(source,/IF v_total<>17 OR v_verified<>17/);
 assert.match(source,/i.indisvalid AND i.indisready/);
 assert.match(source,/i.indkey\[pos\]/);
 assert.doesNotMatch(source,/\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP TABLE|GRANT|REVOKE|CREATE POLICY)\b/i);
 assert.equal((source.match(/^CREATE INDEX IF NOT EXISTS /gm)||[]).length,17);
});
