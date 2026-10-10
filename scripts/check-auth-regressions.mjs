import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8');

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
