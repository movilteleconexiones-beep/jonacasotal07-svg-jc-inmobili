import assert from 'node:assert/strict';
import { test } from 'node:test';

function makeMembershipController() {
  let version = 0;
  let user = null;
  let memberships = [];
  let loading = false;

  return {
    changeUser(nextUser) {
      if (user !== nextUser) {
        version += 1;
        memberships = [];
        loading = Boolean(nextUser);
      }
      user = nextUser;
    },
    async load(userId, fetchMemberships) {
      const requestVersion = ++version;
      try {
        const result = await fetchMemberships();
        if (requestVersion === version && user === userId) memberships = result;
      } finally {
        if (requestVersion === version) loading = false;
      }
    },
    snapshot() { return { user, memberships, loading }; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('previous user memberships cannot overwrite the new account', async () => {
  const controller = makeMembershipController();
  const oldRequest = deferred();
  const newRequest = deferred();
  controller.changeUser('user-a');
  const oldLoad = controller.load('user-a', () => oldRequest.promise);
  controller.changeUser('user-b');
  const newLoad = controller.load('user-b', () => newRequest.promise);
  oldRequest.resolve(['organization-a']);
  await oldLoad;
  assert.deepEqual(controller.snapshot(), { user: 'user-b', memberships: [], loading: true });
  newRequest.resolve(['organization-b']);
  await newLoad;
  assert.deepEqual(controller.snapshot(), { user: 'user-b', memberships: ['organization-b'], loading: false });
});

test('sign out revokes memberships even when an old request resolves afterward', async () => {
  const controller = makeMembershipController();
  const pending = deferred();
  controller.changeUser('user-a');
  const load = controller.load('user-a', () => pending.promise);
  controller.changeUser(null);
  pending.resolve(['organization-a']);
  await load;
  assert.deepEqual(controller.snapshot(), { user: null, memberships: [], loading: false });
});

test('older refresh for the same user cannot replace a newer result', async () => {
  const controller = makeMembershipController();
  const older = deferred();
  const newer = deferred();
  controller.changeUser('user-a');
  const first = controller.load('user-a', () => older.promise);
  const second = controller.load('user-a', () => newer.promise);
  newer.resolve(['current-organization']);
  await second;
  older.resolve(['obsolete-organization']);
  await first;
  assert.deepEqual(controller.snapshot(), {
    user: 'user-a',
    memberships: ['current-organization'],
    loading: false,
  });
});

test('new account response wins even if it completes before the old account', async () => {
  const controller = makeMembershipController();
  const older = deferred();
  const newer = deferred();
  controller.changeUser('user-a');
  const first = controller.load('user-a', () => older.promise);
  controller.changeUser('user-b');
  const second = controller.load('user-b', () => newer.promise);
  newer.resolve(['organization-b']);
  await second;
  older.resolve(['organization-a']);
  await first;
  assert.deepEqual(controller.snapshot(), {
    user: 'user-b',
    memberships: ['organization-b'],
    loading: false,
  });
});
