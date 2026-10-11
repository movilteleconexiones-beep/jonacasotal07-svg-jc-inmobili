import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const auth = readFileSync(new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../supabase/migrations/0002_organization_bootstrap.sql', import.meta.url), 'utf8');
const billing = readFileSync(new URL('../supabase/migrations/20261010222342_verified_tenant_billing.sql', import.meta.url), 'utf8');

test('organization onboarding retains an authenticated RPC call, never a direct privileged table write', () => {
  assert.match(auth, /supabase\.rpc\('create_organization_with_owner'/);
  assert.doesNotMatch(auth, /\.from\('roles'\)\.insert\(/);
  assert.doesNotMatch(auth, /\.from\('member_roles'\)\.insert\(/);
});

test('bootstrap creates an organization-specific owner role and assigns it to the new member', () => {
  assert.match(bootstrap, /new_org_id,\s*'ORGANIZATION_OWNER'/);
  assert.match(bootstrap, /insert into public\.member_roles\s*\(organization_member_id, role_id\)[\s\S]*?values\s*\(new_member_id, owner_role_id\)/i);
  assert.match(bootstrap, /auth\.uid\(\) is null/);
});

test('paid checkout refuses callers without organization owner authority', () => {
  assert.match(billing, /CREATE FUNCTION jco_private\.billing_owner\(target_org uuid\)/i);
  assert.match(billing, /r\.key='ORGANIZATION_OWNER'/);
  assert.match(billing, /NOT jco_private\.billing_owner\(target_org\)/);
  assert.match(billing, /target_environment='sandbox'[\s\S]*?NOT account\.is_test/);
});

test('onboarding permission must be reviewed before widening grants', () => {
  // Runtime grant state is checked separately in Supabase: authenticated currently
  // cannot execute either create_organization_with_owner overload.
  // This guard documents the dependency without silently adding a broad GRANT.
  assert.doesNotMatch(bootstrap, /GRANT\s+ALL\s+ON\s+SCHEMA\s+public\s+TO\s+anon/i);
});
