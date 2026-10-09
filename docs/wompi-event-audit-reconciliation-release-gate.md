# Wompi event audit and reconciliation gate (pre-release)

**Status:** release blocker. This document is a review checklist, not proof of live compliance. No production payment activation.

## Current implementation and gaps

- Webhook signature is verified before invoking the trusted Supabase RPC.
- RPC is service-role only and atomically locks the order, stores an event and updates subscriptions on approved eligible orders.
- `server/supabase-payment-store.ts` currently generates one deterministic SHA-256 fingerprint from provider/environment/reference/transaction/amount/currency/status and supplies it **both** as `p_event_id` and `p_payload_sha256`. This is **not** the original Wompi event ID and **not** the SHA-256 of the original HTTP payload. Do not describe these fields as raw event evidence.
- `expired_order` and `manual_review` are intentionally non-success results; operators must reconcile them manually against Wompi.

## Release gates

1. Obtain official Wompi event documentation and test fixtures. Define a stable provider event identifier, signed payload canonicalization, and safe retention/redaction policy before changing the idempotency model.
2. Preserve signature verification and immutable provider reference, transaction ID, amount, currency, environment and event time. Do not store private keys, events secret or sensitive payment data in audit tables or logs.
3. Make event ingestion idempotent under concurrent retries. Detect same provider event ID with changed content and quarantine conflicts.
4. Define reconciliation of `expired_order`, `manual_review`, `mismatch`, `conflict`, chargebacks and refunds; ensure the customer is not charged again merely because a webhook was rejected.
5. Verify actual Wompi Sandbox callbacks end-to-end using an isolated Supabase staging branch, including approved, declined, pending, duplicate, delayed and malformed events.
6. Require tenant authorization for order creation; prices and organization ownership must be checked on the server, never accepted from browser input.
7. Record operational alerts, access-controlled audit trails and retention policies. Test backup/restore and incident response before production.
8. Obtain a final human go/no-go for real payments, fiscal compliance and customer-facing terms. Keep `WOMPI_ENV=sandbox` until then.

## Production safety

Migrations 0026-0029 are drafts and must not be applied to the official Supabase project before staging validation. The public INMOJCO website appearance must remain unchanged.
