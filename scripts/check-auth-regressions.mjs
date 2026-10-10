import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('../src/core/auth-policy.ts', import.meta.url), 'utf8');

const guards = [
  ['stale initial session', 'if (!mounted || authEventSeen) return;'],
  ['stale deferred callback', 'if (!mounted || currentAuthUserId.current !== nextUserId) return;'],
  ['identity change', 'if (currentAuthUserId.current !== nextUserId) {'],
  ['membership invalidation', 'membershipLoadVersion.current += 1;'],
  ['clear previous memberships', 'setMemberships([]);'],
  ['clear previous admin rights', 'setIsPlatformAdmin(false);'],
  ['loading completion guard', 'if (mounted && loadVersion === membershipLoadVersion.current) setLoading(false);'],
  ['initial session failure message', "setAccessError('No se pudo iniciar la sesión. Intenta actualizar el acceso.');"],
];

for (const [name, snippet] of guards) {
  assert.ok(source.includes(snippet), 'Missing auth guard: ' + name);
  process.stdout.write('PASS ' + name + '\n');
}

const scopedGuards = [
  ['identity change clears tenant and admin rights', /if \(currentAuthUserId\.current !== nextUserId\) \{[\s\S]*?setMemberships\(\[\]\);[\s\S]*?setIsPlatformAdmin\(false\);[\s\S]*?setActiveOrganizationId\(null\);/],
  ['deferred load checks identity before requesting memberships', /setTimeout\(\(\) => \{[\s\S]*?currentAuthUserId\.current !== nextUserId\) return;[\s\S]*?loadForUser\(nextSession\?\.user\.id \?\? null\)/],
  ['initial auth failure revokes tenant access', /Unable to initialize authentication[\s\S]*?setSession\(null\);[\s\S]*?setMemberships\(\[\]\);[\s\S]*?setIsPlatformAdmin\(false\);[\s\S]*?setActiveOrganizationId\(null\);/],
];

for (const [name, pattern] of scopedGuards) {
  assert.match(source, pattern, 'Missing scoped auth protection: ' + name);
  process.stdout.write('PASS ' + name + '\n');
}

const membershipGuards = [
  ['membership policy invoked', 'if (!isValidMembership(row, userId)) continue;'],
  ['effective permissions policy invoked', 'resolveEffectivePermissions(permissions, overrides ?? [])'],
];
for (const [name, snippet] of membershipGuards) {
  assert.ok(source.includes(snippet), 'Missing membership protection: ' + name);
  process.stdout.write('PASS ' + name + '\n');
}
assert.ok(policySource.includes("item.effect === 'DENY'"), 'Missing explicit denial policy');

assert.ok(
  source.includes('const linkedPermissions = Array.isArray(relation) ? relation : [relation];'),
  'Role permissions must accept array-shaped Supabase relations',
);
process.stdout.write('PASS role permission relation compatibility\n');

assert.ok(
  source.includes('eligibleRolesForOrganization(memberRoles ?? [], row.organization_id)'),
  'Joined roles must be normalized before tenant validation',
);
assert.ok(
  policySource.includes('(!role.organization_id || role.organization_id === organizationId)'),
  'Foreign-organization roles must not grant tenant permissions',
);
process.stdout.write('PASS tenant-scoped role filtering\n');
