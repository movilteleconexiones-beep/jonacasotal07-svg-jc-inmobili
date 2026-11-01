import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const sql=readFileSync(new URL('../docs/security/staging-coordinator-grants.sql',import.meta.url),'utf8');
test('coordinator grant is scoped and idempotent',()=>{
 assert.match(sql,/r\.key='MANAGER' AND r\.active AND r\.organization_id IS NOT NULL/);
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM public\.role_permissions rp/);
 assert.match(sql,/p\.key IN \('rent_payments\.create','rent_payments\.view'\)/);
 assert.match(sql,/r\.key='AGENT' AND r\.active/);
 assert.doesNotMatch(sql,/DELETE FROM public\.role_permissions/i);
});
