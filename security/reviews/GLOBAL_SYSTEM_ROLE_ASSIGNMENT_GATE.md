# Phase 89 — Global and system role assignment gate

## Context
Production `roles` has `organization_id` nullable and `is_system_role` boolean. Production `member_roles_manage_admin` authorizes an administrator of the **member's** organization using `roles.assign`, but does not verify the role's organization or system status.

## Candidate limitation
The draft `security/experiments/member_role_tenant_rls_candidate.sql` allows a role with `organization_id IS NULL` to be assigned whenever the caller has `roles.assign` on the target organization. That is **not automatically safe**: a global system role may carry broad permissions and should not necessarily be assignable by tenant admins.

## Required decision before production
- Define which global/system role keys are tenant-assignable.
- Deny assignment of privileged system roles by default, rather than treating NULL organization as universal authorization.
- Require a separately authorized administrative pathway for privileged global roles.
- Validate `roles.active` semantics and deny assigning inactive roles if the product requires it.
- Audit all existing `member_roles` entries for foreign-tenant roles before enforcing constraints.
- Add positive tests for permitted global roles and negative tests for privileged global roles, foreign roles, and inactive roles.
- Confirm SELECT permissions and SECURITY DEFINER function exposure; RLS alone is not the full boundary.

**Release gate: BLOCKED** until explicit role classification and the corresponding authorization tests are approved. No production changes.
