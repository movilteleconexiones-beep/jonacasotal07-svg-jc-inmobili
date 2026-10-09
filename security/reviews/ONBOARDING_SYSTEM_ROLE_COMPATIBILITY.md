# Phase 94 — Organization onboarding compatibility gate

Read-only inspection of the official Supabase function `public.create_organization_with_owner` (both overloads).

## Verified behavior
- The two-argument overload delegates to the three-argument overload with country `CO`.
- The three-argument SECURITY DEFINER function requires `auth.uid()`, validates organization name, slug, and active country profile.
- It creates the organization, active owner membership, branding, settings, compliance record, and audit log.
- It creates five organization-scoped **system** roles: `ORGANIZATION_OWNER`, `ADMIN`, `MANAGER`, `AGENT`, and `CLIENT`, all active.
- It assigns permissions to these roles, then inserts `member_roles(new_member_id,owner_role_id)`.
- Existing `apply_default_role_permissions` is also an AFTER INSERT trigger on roles, which means permissions may be inserted both by the trigger and the onboarding function with conflict handling.

## Security design implication
A blanket prohibition on assigning `is_system_role=true` through every database path would break owner onboarding. Restrict ordinary tenant-admin DML while preserving a narrowly scoped, authenticated, audited privileged onboarding function. The tenant assignment policy must not rely on a client-controlled session variable to recognize the privileged pathway.

## Required checks before deployment
1. Audit EXECUTE grants on both onboarding overloads.
2. Confirm the function owner and whether privileged RLS bypass is intentional.
3. Add disposable integration tests: create organization, verify exactly one owner membership/role assignment, and confirm permissions.
4. Verify ordinary `authenticated` users cannot directly assign privileged system roles outside onboarding.
5. Review repeat calls, duplicate slug handling, and transaction rollback behavior.
6. Preserve draft status until tests pass.

**No production changes.**
