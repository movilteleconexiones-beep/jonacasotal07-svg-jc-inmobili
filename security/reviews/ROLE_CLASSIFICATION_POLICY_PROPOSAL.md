# Phase 92 — Role classification policy (proposed)

**Status: proposed; product approval and isolated tests required.**

## Default authorization decision
Tenant administrators using `roles.assign` may assign only a role that:
1. Belongs to the same organization as the target member.
2. Is active.
3. Is not marked `is_system_role`.

Do **not** treat `roles.organization_id IS NULL` as an automatic permission to assign a global role. Deny global roles by default. A privileged provisioning process may explicitly allow selected system roles only after separate authorization, auditing, and testing.

## Compatibility considerations
- Existing `apply_default_role_permissions` creates grants for system role keys `ORGANIZATION_OWNER`, `ADMIN`, `MANAGER`, and `AGENT`. Product owners must define a safe way to provision these without opening the tenant-level assignment policy.
- Existing `create_custom_role` creates organization-scoped, active, non-system roles, consistent with the proposed tenant-admin rule.
- The current experimental candidate `member_role_tenant_rls_candidate.sql` is too permissive for global roles and must not be deployed as-is.
- Direct `member_roles` DML and privileged service-role paths must be audited.
- `roles.active` is currently ignored by production `has_org_permission`; authorization semantics require coordinated changes.

## Required regression matrix
| Role | Target member | Expected tenant-admin assignment |
| --- | --- | --- |
| Active custom role | Same organization | Allow |
| Active custom role | Different organization | Deny |
| Inactive custom role | Same organization | Deny |
| Global role | Any organization | Deny |
| System role | Same organization | Deny |
| Missing role | Any organization | Deny |

**Release gate: BLOCKED** until approved, implemented in an isolated environment, and validated under actual RLS.
