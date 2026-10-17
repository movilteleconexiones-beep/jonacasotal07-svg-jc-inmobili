import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuthLoadGate } from '../src/core/auth-load-gate.ts';

const authContext = readFileSync(
  new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8',
);

test('old permission response cannot overwrite a newer signed-in user', async () => {
  const gate = createAuthLoadGate();
  const commits = [];
  let resolveFirst;
  const slowLookup = new Promise(resolve => { resolveFirst = resolve; });
  const first = gate.begin();
  const pendingFirst = slowLookup.then(() => {
    if (gate.isCurrent(first)) commits.push('agency-A');
  });
  gate.invalidate(); // onAuthStateChange: account B has signed in
  const second = gate.begin();
  if (gate.isCurrent(second)) commits.push('agency-B');
  resolveFirst();
  await pendingFirst;
  assert.deepEqual(commits, ['agency-B']);
});

test('sign-out invalidates any in-flight membership or admin response', () => {
  const gate = createAuthLoadGate();
  const oldLoad = gate.begin();
  gate.invalidate();
  assert.equal(gate.isCurrent(oldLoad), false);
  const signedOut = gate.begin();
  assert.equal(gate.isCurrent(signedOut), true);
  const refresh = gate.begin();
  assert.equal(gate.isCurrent(signedOut), false);
  assert.equal(gate.isCurrent(refresh), true);
});

test('auth context clears branding and permission state when accounts change', () => {
  assert.match(authContext, /const currentAuthUserId = useRef<string \| null>\(null\)/);
  assert.match(authContext, /authLoadGate\.current\.invalidate\(\);\s*const nextUserId/);
  assert.match(authContext, /if \(currentAuthUserId\.current !== nextUserId\) \{/);
  assert.match(authContext, /setMemberships\(\[\]\);\s*setActiveOrganizationId\(null\);\s*setIsPlatformAdmin\(false\);/);
  assert.match(authContext, /if \(!authLoadGate\.current\.isCurrent\(generation\)\) return;/);
  assert.match(authContext, /if \(authLoadGate\.current\.isCurrent\(generation\)\) setLoading\(false\)/);
});

test('a stale getSession result and deferred auth callback are discarded', () => {
  assert.match(authContext, /if \(!mounted \|\| authEventVersion !== 0\) return;/);
  assert.match(authContext, /const version = \+\+authEventVersion/);
  assert.match(authContext, /if \(!mounted \|\| version !== authEventVersion\) return;/);
  assert.match(authContext, /authLoadGate\.current\.invalidate\(\);\s*subscription\.subscription\.unsubscribe\(\)/);
});
