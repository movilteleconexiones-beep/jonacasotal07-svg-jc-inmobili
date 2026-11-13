import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../security/candidates/g10_platform_members_safe_admin_REVIEW_ONLY.sql', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/modules/platform/PlatformMembers.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/modules/platform/SuperAdminModule.tsx', import.meta.url), 'utf8');

test('server-side platform membership management checks superadmin and never exposes anon RPC', () => {
  assert.match(sql, /auth\.uid\(\) IS NULL OR NOT public\.is_platform_admin\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_get_organization_members\(uuid,integer,integer\) FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_set_organization_member_status\(uuid,uuid,text,text\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.platform_get_organization_members.*TO authenticated/);
});
test('central update protects owner and superadmin, scopes tenant, audits reason', () => {
  assert.match(sql, /affected_user = auth\.uid\(\)/);
  assert.match(sql, /public\.platform_admins pa WHERE pa\.user_id = affected_user AND pa\.active/);
  assert.match(sql, /owner_count <= 1/);
  assert.match(sql, /m\.id = target_member AND m\.organization_id = target_org/);
  assert.match(sql, /INSERT INTO public\.audit_log/);
  assert.match(sql, /length\(btrim\(reason\)\) NOT BETWEEN 10 AND 500/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
test('central UI never mutates tenant membership tables directly', () => {
  assert.match(component, /rpc\('platform_get_organization_members'/);
  assert.match(component, /rpc\('platform_set_organization_member_status'/);
  assert.doesNotMatch(component, /from\('organization_members'\)\.update/);
  assert.match(component, /member\.is_protected/);
  assert.match(component, /const request = \+\+requestId\.current/);
  assert.match(admin, /<PlatformMembers organization=\{selectedOrganization\}/);
});
