# Onboarding security gate — phase 121

## Verified
GitHub Actions run 37883914468 passed the isolated captured-RPC smoke test and the separate transaction atomicity fixture. The smoke test currently has 14 lines and verifies only the happy path.

## Unverified — block production release
- Duplicate slug behavior and complete rollback using the captured RPC.
- Missing authenticated user and unsupported country rejection.
- Full role permission grants, default-role trigger interaction, and authorization boundaries.
- EXECUTE grants on the three-argument SECURITY DEFINER function.
- Rate limits, quotas, concurrent registrations and abuse controls.
- Production schema constraints and RLS interactions.

## Implementation plan
1. Add negative assertions to the disposable captured-RPC test only after the repository write operation is permitted.
2. Re-run CI and inspect individual test steps, not just workflow conclusion.
3. Compare production trigger/constraint definitions with disposable schema and close the gaps.
4. Keep the browser EXECUTE grant and all production deployments blocked until reviewed.

No production SQL changes or live Wompi payments are authorized by this document.
