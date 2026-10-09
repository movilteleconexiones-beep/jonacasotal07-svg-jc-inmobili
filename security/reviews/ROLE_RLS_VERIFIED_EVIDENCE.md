# Phase 91 — Cross-tenant role RLS verification

## Confirmed CI evidence
GitHub Actions run 37882421222 completed successfully:
- `Cross-tenant role assignment RLS negative reproduction (isolated PostgreSQL)`: passed; the original policy fixture accepted a foreign-tenant role assignment.
- `Cross-tenant role assignment RLS fix (isolated PostgreSQL)`: passed; the candidate policy accepted a same-tenant role and rejected the foreign-tenant role via RLS.

These are isolated fixtures, not tests against the production database.

## Production catalog context
Read-only inspection showed no rows in `public.roles` at the time of inspection. There is no current global/system role inventory to use as a definitive allowlist.

## Security gap still open
The current candidate allows any `organization_id IS NULL` global role when the caller has `roles.assign` on the target organization. That could permit unintended assignment of privileged global/system roles. A stricter candidate was attempted but the tool operation was blocked; **no stricter candidate file was created**.

## Release decision
**BLOCKED.** Require product-approved classification of system/global roles, tests for inactive and privileged roles, direct DML privilege audit, and concurrency checks before deployment.
