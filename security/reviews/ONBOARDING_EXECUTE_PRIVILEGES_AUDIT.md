# Phase 95 — Organization onboarding EXECUTE privilege audit

## Official database evidence (read-only)
Both overloads of `public.create_organization_with_owner` are owned by `postgres`, have `SECURITY DEFINER=true`, and ACL `{postgres=X/postgres,service_role=X/postgres}`.

| Overload | anon EXECUTE | authenticated EXECUTE |
| --- | --- | --- |
| (org_name text, org_slug text) | false | false |
| (org_name text, org_slug text, org_country_code text) | false | false |

## Impact
Direct frontend `supabase.rpc('create_organization_with_owner', ...)` as `authenticated` cannot execute either overload under these grants. This is a potential onboarding blocker, **not** proof of a broken user flow: a privileged backend may invoke the function.

## Required next checks
1. Search application code for callers and identify whether they use frontend JWT or trusted backend service credentials.
2. If client invocation is intended, audit the function for abuse and consider a carefully reviewed EXECUTE grant to `authenticated`, never `anon`.
3. Verify rate limiting, ownership, duplicate slug protection, and country validation before widening access.
4. Never expose `service_role` credentials in browser code.
5. Test owner onboarding in a disposable environment and check permission assignment.
6. Preserve production ACL until a tested remediation is approved.

**No grants or production writes performed.**
