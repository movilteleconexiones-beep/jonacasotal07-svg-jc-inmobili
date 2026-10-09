# Phase 128 — Auth user referential integrity gate

Read-only catalog verification against official Supabase project `nqzopzhmhqdssgpljypu` confirmed:
- `organization_members.organization_id` references `organizations(id) ON DELETE CASCADE`.
- `organization_members.user_id` references `auth.users(id) ON DELETE CASCADE`.

The disposable onboarding fixture currently omits the `auth.users` table and user FK, so its passing smoke test does **not** establish production-equivalent identity referential integrity.

## Required isolated tests
1. Seed a synthetic auth user and create an organization using the captured RPC.
2. Reject owner membership for a user absent from `auth.users`.
3. Verify cascading deletion removes memberships and dependent role assignments without leaving orphans.
4. Verify the production RLS and SECURITY DEFINER function authorization model separately; FK correctness is not authorization.
5. Do not alter production tables or broaden `EXECUTE` privileges until these tests pass and security review is complete.

The attempted direct modification of the fixture was blocked by tool safety controls. This gate does not claim that change was applied.
