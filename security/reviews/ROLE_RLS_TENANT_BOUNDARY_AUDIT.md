# Phase 85 — Production RLS and direct mutation audit

Read-only catalog inspection in official Supabase project `nqzopzhmhqdssgpljypu`.

## Confirmed
- RLS enabled on `roles`, `role_permissions`, `member_roles`, `member_permissions`, `organization_members`; FORCE RLS disabled.
- Both `anon` and `authenticated` have table-level UPDATE and DELETE grants on all five. Table grants alone do **not** imply anonymous access: policies shown below target `authenticated`.
- `roles_manage_admin`: ALL, authenticated; organization_id must be non-null, with `has_org_permission(organization_id,'roles.edit')` for USING and WITH CHECK.
- `role_permissions_manage_admin`: ALL, authenticated; checks role.organization_id non-null and `roles.edit` on that organization.
- `member_roles_manage_admin` and `member_permissions_manage_admin`: ALL, authenticated; checks `roles.assign` for organization of **target member** for USING and WITH CHECK.
- `organization_members`: SELECT requires `is_org_member`; INSERT requires `users.create`; UPDATE requires `users.edit`. No DELETE policy was returned.

## High-priority potential gap
`member_roles_manage_admin` checks only the organization of the target member; it does **not** inspect `member_roles.role_id` against `roles.organization_id`. If no trigger or other invariant enforces role tenancy, a tenant admin could potentially assign an organization-specific role belonging to another tenant. **This is a hypothesis, not a confirmed exploit.** Validate constraints/triggers and reproduce only on disposable fixtures.

## Required next steps
1. Read-only inspect constraints and triggers on `member_roles`, `roles`, and `role_permissions`.
2. Test cross-tenant assignment denial on isolated PostgreSQL using equivalent RLS and grants.
3. Consider policy WITH CHECK requiring the role be global or belong to the member's organization, while protecting system/global roles from unauthorized assignment.
4. Verify function EXECUTE grants and SECURITY DEFINER bypass exposure.
5. Preserve draft-only status; no live changes or real payments.
