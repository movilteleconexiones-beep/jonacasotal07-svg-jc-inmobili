# Billing permission revocation and order-creation concurrency contract

**Security review draft — not deployed.** Migration 0032 locks the organization and active membership row, but its `has_org_permission` read does not serialize all permission changes. A concurrent INSERT of a new DENY, deletion of an ALLOW, or removal of role_permissions may race order creation. This is a **production blocker**; isolated single-session SQL tests cannot prove concurrency safety.

## Required database contract

Every operation that creates a payment order **and every mutation** that can affect billing authorization for that organization must acquire the same transaction-scoped advisory lock, derived deterministically from the organization UUID, **before** reading or changing grants. Acquire it inside the database transaction, not in application memory. This includes INSERT/UPDATE/DELETE on member_permissions, member_roles, role_permissions, organization_members, and billing-related permission catalog or role changes. Organization suspension also needs a consistent lock order. A role shared across organizations requires locking all affected organizations in deterministic order, or prohibiting shared cross-organization role grants.

The transaction must then recheck auth.uid(), organization ACTIVE, active membership, explicit billing.manage and DENY precedence, derive trusted COP plan amount, and insert the order before releasing the lock on COMMIT. Revocation operations must acquire the identical lock **before** modifying permissions; otherwise the protocol is ineffective. Direct table writes, legacy RPCs and service-role pathways must be audited and migrated to trusted locked functions or triggers.

## Required independent validation

1. Session A starts order creation, holds the lock; Session B revokes billing.manage and blocks; after A commits, B revokes. The order's authorization must have been valid at its serialization point.
2. Session A revokes and holds the lock; session B attempts order creation and blocks; after A commits, B must fail without inserting an order.
3. Repeat for DENY insertion, role permission removal, membership deactivation, organization suspension and role sharing across tenants.
4. Verify concurrent duplicate reference insertion, lock ordering/deadlock handling, RLS, service-role restrictions, timeout/rate limits, audit logs, and rollbacks.
5. Test against a real Supabase staging branch, then independently review security and billing. **Do not deploy 0032 or open checkout until this contract is implemented and validated.**

Current status: design and release gate only. No advisory lock, revocation triggers or production deployment is claimed.
