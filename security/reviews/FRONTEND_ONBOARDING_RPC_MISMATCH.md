# Phase 97 — Confirmed frontend onboarding RPC privilege mismatch

## Direct source evidence
`src/core/auth-context.tsx` defines `createOrganization` and calls `supabase.rpc('create_organization_with_owner', ...)`. `src/lib/supabase.ts` constructs the browser Supabase client using a publishable key and persisted user auth session. The Wompi Express server in `server/wompi-runtime.ts` is a separate private payment runtime; it is not the caller of this onboarding RPC.

## Database evidence
Both overloads of `public.create_organization_with_owner` are SECURITY DEFINER, owned by postgres, and have EXECUTE ACL only for postgres/service_role, **not authenticated**.

## Conclusion
The direct browser onboarding RPC is not authorized under the current production grants. This is a confirmed frontend/database permission mismatch; whether users encounter it depends on their flow and deployment.

## Remediation gate
Do not grant EXECUTE yet. First review SECURITY DEFINER function for rate limits, organization spam, slug collision, audit completeness, search_path safety, and privilege escalation; then propose a least-privilege grant to authenticated only, accompanied by disposable integration tests. Never use the service-role key in the browser.

**No production changes.**
