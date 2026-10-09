# Security gate: cascade paths still outside tested coverage

The real Supabase schema has CASCADE foreign keys from roles to organizations, role_permissions to permissions, and member_roles to organization_members/roles.

## Test matrix
| Mutation | Tenant advisory lock path | Verified in disposable CI | Remaining concern |
| --- | --- | --- | --- |
| Direct role_permissions DELETE | candidate BEFORE trigger | Yes | concurrent DML/row locks |
| Shared role grant INSERT | candidate BEFORE trigger | Yes | concurrent membership reassignment |
| DELETE roles (cascades) | role_permissions/member_roles triggers | Yes | cross-session deadlocks |
| DELETE permissions (cascades) | role_permissions trigger | No | deletion may touch many shared roles |
| DELETE organizations (cascades) | organization_members trigger plus nested cascades | No | ordering across tenants |
| UPDATE roles.active | no trigger in candidate | No | role-active semantics must be inspected |
| UPDATE roles.organization_id | no trigger in candidate | No | system/global role behavior |
| DELETE organization_members | membership trigger | No | nested member_roles cascades |

## Required next actions

1. Validate actual role permission resolution and whether `roles.active` is part of `has_org_permission`.
2. Extend disposable fixture with permission deletion and organization deletion cascade cases.
3. Run two-session concurrency tests with bounded lock/statement timeouts and deadlock detection.
4. Review execution privileges and security-definer search paths against production catalog.
5. Keep PR #57 draft. Do not run experimental migrations against the official project or accept real Wompi payments.

A passing CI suite is not proof that all mutation paths are safe.
