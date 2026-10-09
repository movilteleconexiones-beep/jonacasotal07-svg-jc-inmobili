# INMOJCO — Functional release blockers (code inspection)

Reviewed `main`: `package.json`, `src/main.tsx`, `index.html`, `vite.config.ts`, `src/lib/supabase.ts`, `src/core/auth-context.tsx`.

## Immediate priorities

1. **Onboarding blocked**: browser `createOrganization()` calls `create_organization_with_owner` (3 args). Official function EXECUTE ACL previously inspected allows only `postgres` and `service_role`, not authenticated users. **Do not grant EXECUTE until authenticated-user abuse, identity, tenant isolation and transaction tests are complete.**
2. **Unsafe environment fallback for staging**: `src/lib/supabase.ts` falls back to the official Supabase project when *both* VITE vars are absent. Paired-but-missing env configuration must fail closed in staging/preview; require explicit `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` per deployment, without exposing secrets.
3. **Start-up reproducibility**: `package.json` uses `npm run dev` on port 3000, `npm run build`, and `npm run lint` (`tsc --noEmit`). Verify clean install with lockfile and actual browser navigation, not just database fixture CI.
4. **Authorization integrity**: `loadMemberships` filters active roles in the UI but database authorization must independently enforce role status, same-tenant role membership, and RLS. Frontend permissions are not a security boundary.
5. **Payments**: Wompi sandbox-only end-to-end checkout, webhook signature and idempotency tests before considering live payments.

## Release acceptance gates
- Clean `npm ci`, `npm run lint`, `npm run build` pass on target branch.
- Authenticated user can register, sign in, create an organization, log out, and log back in without privileged service-role keys in browser.
- Two independent organizations cannot read or mutate each other's tenant data.
- Core property/lead/deal workflows pass browser end-to-end testing.
- Wompi sandbox succeeds/fails/retries correctly; no real charges.
- Production rollout is a separate, reviewed approval step with rollback plan.

This document records inspected code and known blockers, **not** a claim that the app has been repaired or is production ready.
