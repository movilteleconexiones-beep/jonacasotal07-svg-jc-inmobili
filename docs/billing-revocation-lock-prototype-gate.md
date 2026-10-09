# Billing revocation lock prototype 0033 — NOT DEPLOYABLE

This migration is an **incomplete experimental prototype**. It defines a deterministic transaction-scoped advisory lock per organization and triggers on member_permissions, member_roles, and organization_members. It does **not** modify the order-creation RPC 0032 to acquire this lock, and it does **not** cover role_permissions, roles, organizations, or all legacy write pathways. It has **no concurrency tests**. Therefore it **does not solve the race** and must not be applied in production or staging as a complete security fix.

Before use: establish a consistent lock order across all authorization mutations and order creation; cover role_permissions and role changes; verify multi-tenant role scope; handle UPDATE changes of organization_id; validate DELETE with cascading membership operations; avoid accidental privilege escalation from SECURITY DEFINER functions; run two-session PostgreSQL tests; confirm exact live schema and Supabase privileges. Existing user roles and UI must remain functional.

Observed read-only production audit: no current cross-organization role assignments; billing.manage not yet deployed; roles has apply_default_role_permissions_trigger. These facts can change and are not a substitute for enforcing invariants.
