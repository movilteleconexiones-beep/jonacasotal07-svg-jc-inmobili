# Onboarding captured-RPC integration evidence — phase 119

GitHub Actions run [37883914468](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/actions/runs/37883914468) completed with conclusion **success**.

Verified steps:
- `Onboarding transaction rollback fixture (isolated PostgreSQL)`: completed, success.
- `Captured onboarding RPC smoke test (isolated PostgreSQL)`: completed, success.

The latter executes `security/tests/fixtures/production_create_organization_with_owner.sql`, a snapshot of the actual official three-argument function, against `security/tests/fixtures/onboarding_real_rpc_schema.sql` and assertions in `security/tests/fixtures/onboarding_rpc_smoke.sql`. It checks creation of an organization, one membership, five active system roles and an audit event.

**Not yet covered:** production RLS policies, the actual default-role trigger, all constraints, permissions/EXECUTE ACL, cross-tenant assignments, duplicate slug rollback in the captured-RPC test, failure injection, concurrency, quotas and abuse resistance. A passing smoke test is not authorization to grant browser EXECUTE.

**Release decision:** BLOCKED. No changes to official Supabase or live Wompi.
