import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source=readFileSync(new URL('../supabase/migrations/20261107133623_scope_maintenance_property_to_tenant.sql',import.meta.url),'utf8');
const pg17=readFileSync(new URL('../security/tests/g08_maintenance_property_tenant_fk_pg17.sql',import.meta.url),'utf8');

test('G08: migration is the immutable SQL already applied in Supabase',()=>{
 assert.equal(createHash('md5').update(source).digest('hex'),'caac0d0074807576d4f9dfea82e2bd9a');
});
test('G08: preserve original relation name and cascade when hardening tenant references',()=>{
 assert.match(source,/maintenance_requests_property_id_fkey/);
 assert.match(source,/FOREIGN KEY \(organization_id,property_id\)/);
 assert.match(source,/REFERENCES public\.properties\(organization_id,id\)/);
 assert.match(source,/ON DELETE CASCADE/);
 assert.match(source,/Missing unique \(organization_id,id\) property key/);
 assert.match(source,/Existing cross-tenant maintenance property reference/);
 assert.match(source,/convalidated/);
 assert.match(source,/lock_timeout = '3s'/);
 assert.doesNotMatch(source,/\bCOMMIT;|\bTRUNCATE\b|\bDELETE FROM public\.maintenance_requests/);
});
test('G08: local PG17 fixture rejects cross-tenant INSERT/UPDATE and preserves cascade',()=>{
 assert.match(pg17,/foreign_key_violation/);
 assert.match(pg17,/Foreign-tenant INSERT was accepted/);
 assert.match(pg17,/Foreign-tenant UPDATE was accepted/);
 assert.match(pg17,/ON DELETE CASCADE behavior changed/);
 assert.match(pg17,/^(?:--[^\n]*\n|\s)*BEGIN;/);
 assert.match(pg17,/ROLLBACK;\s*$/);
});
