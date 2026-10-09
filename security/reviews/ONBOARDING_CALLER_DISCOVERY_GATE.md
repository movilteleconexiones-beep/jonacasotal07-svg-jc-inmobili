# Phase 96 — Onboarding caller discovery gate

## Findings
- GitHub code search on the default branch returned no matches for `create_organization_with_owner`, `organization_with_owner`, `supabase.rpc`, or `createOrganization`. This is **inconclusive**, not evidence that onboarding is absent; branch and search indexing coverage may differ.
- The repository `package.json` confirms React, Vite, `@supabase/supabase-js`, and an Express Wompi server.
- Production ACL audit confirmed both onboarding RPC overloads are callable by `service_role` and `postgres`, not by `authenticated` or `anon`.

## Follow-up before granting permissions
1. Inspect the full frontend source tree and deployment-specific server/edge functions for onboarding calls, not only indexed search.
2. Determine the actual caller identity and how JWT claims are propagated.
3. If the intended caller is an authenticated browser session, perform abuse-case review of SECURITY DEFINER onboarding before considering an authenticated EXECUTE grant.
4. If the intended caller is a backend service, verify service credentials remain server-side and that the backend validates the user's identity.
5. Add end-to-end registration tests in an isolated environment.

**Release gate remains BLOCKED. No production grants or payment changes.**
