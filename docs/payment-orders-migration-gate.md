# Payment orders 0026 — deployment gate

**NOT APPLIED.** This migration is a schema proposal, not a working payment system.

- `payment_orders` binds tenant, plan, billing mode, unique reference, COP amount in cents, Wompi environment and state.
- `payment_events` records event identity and a SHA-256 payload digest without storing card details. A unique provider/event key helps avoid duplicate processing.
- Tenant members and platform admins can read order summaries under RLS; direct browser writes are disallowed.
- Only a trusted server with authenticated Wompi webhook verification can write payment state and subscription changes.
- **Before deployment:** implement server endpoints, signature validation according to current Wompi documentation, idempotent transaction logic, event replay protection, server-side price quotes, payment status reconciliation, webhook audit and sandbox integration tests.
- **Important:** the schema constraints alone do not enforce valid payment transitions or guarantee that an APPROVED event is authentic. Never let a browser update `payment_orders` or `subscriptions`.
- Confirm RLS grants and existing migrations in a disposable staging database, then obtain explicit production authorization.
