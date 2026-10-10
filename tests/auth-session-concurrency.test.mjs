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
