# Phase 83 — Concurrent role-state lock ordering review

## Verified
The disposable PostgreSQL regression `security/tests/role_deactivation_concurrency.sh` passed in GitHub Actions run 37882024587. It demonstrates that one role deactivation attempt times out while one active order transaction holds the tenant advisory lock.

## Remaining concurrency hazard
The candidate trigger `security/experiments/role_state_lock_candidate.sql` is a BEFORE ROW trigger. PostgreSQL may acquire row-level locks on `roles` before the trigger acquires advisory locks. Meanwhile an order obtains the tenant advisory lock before reading authorization. This creates a possible opposing acquisition order:

- Transaction A: tenant advisory lock -> role-related row access.
- Transaction B: role row lock -> tenant advisory lock.

This ordering needs a two-session deadlock regression; one successful lock-timeout test does not rule out deadlock.

## Safer architecture to evaluate
Consider an explicit privileged role-mutation RPC that:
1. Resolves every affected tenant, including global-role assignments.
2. Acquires advisory locks in stable order **before** updating the role row.
3. Rechecks affected memberships after locking and before mutation.
4. Restricts direct role mutation to trusted paths and audits service-role/admin bypasses.
5. Validates concurrent member-role changes, cascading deletes, and authorization reads.

Do not implement this RPC in production without auditing existing role-management callers, grants, and triggers. The role-state trigger remains experimental and PR #57 must stay draft.
