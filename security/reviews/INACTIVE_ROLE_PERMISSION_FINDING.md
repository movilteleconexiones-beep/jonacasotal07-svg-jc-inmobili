# Security finding: inactive roles still grant permissions

## Verified production behavior
Read-only inspection of `public.has_org_permission(uuid,text)` in the official Supabase project confirms that the role-derived grant joins `member_roles` directly to `role_permissions`, without joining `roles` or filtering `roles.active`.

**Consequence:** setting `roles.active=false` does not, by itself, revoke permissions granted through that role. Whether this is a security defect depends on the product's documented meaning of `active`, which must be clarified before a change.

## Proposed safe design review
- Decide whether an inactive role should deny all role-derived grants.
- If yes, update the authorization function to join `roles` and require `roles.active=true`.
- Serialize `roles.active` changes with order creation across every organization currently using the role, including global roles.
- Preserve explicit member DENY precedence; do not silently broaden ALLOW.
- Test revocation before order, order before revocation, cross-tenant shared roles, and concurrent role assignment.
- Compare existing database policies and RPC callers before replacing a SECURITY DEFINER function.
- Keep all changes in a disposable database and draft PR until approved.

**Status: OPEN; do not deploy an unreviewed fix.**
