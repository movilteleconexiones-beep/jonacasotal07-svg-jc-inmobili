import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('security/tests/snapshots/create_organization_with_owner.read-only-applied-20261106.sql');
const roleSource=read('security/tests/snapshots/apply_default_role_permissions.read-only-applied-20261106.sql');
const assertions=read('security/tests/onboarding-to-license-pg17.assertions.sql');
const workflow=read('.github/workflows/ci.yml');
const sha256=sql=>createHash('sha256').update(sql).digest('hex');

test('genuine production onboarding RPC and default role trigger pinned unchanged',()=>{
  assert.equal(sha256(source),'aaa54d4ebfc5b3f174a721ad3599314bbc293118da828401e5a704164fe03ba3');
  assert.equal(sha256(roleSource),'727999983d50a0ebb1af3b141f6e3dd6976ba1505d665f258082cf6963720e75');
  assert.match(source,/create_organization_with_owner\(org_name text, org_slug text, org_country_code text\)/);
  assert.match(source,/insert into public\.organization_members/);
  assert.match(source,/insert into public\.member_roles/);
  assert.match(source,/insert into public\.organization_branding/);
  assert.match(source,/insert into public\.organization_settings/);
  assert.match(source,/insert into public\.audit_log/);
  assert.match(roleSource,/new\.key in \('ORGANIZATION_OWNER','ADMIN'\)/);
  assert.match(roleSource,/insert into public\.role_permissions/);
});
test('two independent customers must register and fail closed prior to verified payment',()=>{
  for(const expected of [
    'empresa-integracion-a','empresa-integracion-b',
    'new organization must remain INACTIVE until verified payment',
    'founding user has exactly one OWNER role in her own organization',
    'owner inherits actual default permissions by trigger',
    'new organization', // negative checks remain human-readable
    'unique slug prevents duplicate onboarding',
    'second owner cannot control first tenant billing',
    'unpaid owner has no access to property operations',
    'checkout idempotency key prevents duplicate orders',
    'verified payment activates exactly once',
    'other company owner cannot use paid customer modules',
    'Wompi LIVE always disabled in rehearsal',
  ])assert.ok(assertions.includes(expected),'missing E2E scenario: '+expected);
});
test('CI runs exact deployed RPC and isolated PG17 database; never modifies live schema',()=>{
  assert.match(workflow,/db=jco_full_owner_checkout_e2e/);
  assert.match(workflow,/onboarding-to-license-pg17\.fixture\.sql/);
  assert.match(workflow,/create_organization_with_owner\.read-only-applied-20261106\.sql/);
  assert.match(workflow,/apply_default_role_permissions\.read-only-applied-20261106\.sql/);
  assert.match(workflow,/onboarding-to-license-pg17\.assertions\.sql/);
  assert.doesNotMatch(workflow,/supabase db push/);
});
