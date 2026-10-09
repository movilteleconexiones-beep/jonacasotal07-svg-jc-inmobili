# JCO: payment transition and webhook integration gate

**Code status:** pure validation only. Not a deployed webhook or production payment processor.

The `payment-state-machine.ts` helper prohibits transitions away from APPROVED, DECLINED, VOIDED and ERROR, and only permits a PENDING order to reach one terminal status. It checks that reference, amount, currency and any previously linked transaction ID match.

## Server-only sequence

1. Validate Wompi webhook authenticity with the provider's current signature specification.
2. Resolve the stored order by immutable reference; never trust tenant ID or plan ID from webhook input.
3. Validate transaction ID, amount, currency and current provider status.
4. Lock the order row and use a database transaction to record a unique event and change the order state once.
5. Grant or renew a subscription only after a verified APPROVED event, using the order's stored organization and plan.
6. If a repeated event arrives, return an idempotent success without a second subscription change.
7. If an out-of-order event arrives after a terminal state, preserve the original state and flag for reconciliation.
8. Keep secrets out of Vite and logs; distinguish sandbox and production credentials.

**Warning:** the pure function `shouldGrantLicense` is not authorization and cannot verify signatures. It must not be called directly from a browser to write subscriptions.

## Pending work

- Implement server-side signature verification against Wompi's current specification.
- Implement a transactionally safe database procedure with restricted grants.
- Integrate server endpoints and sandbox test events.
- Test two-tenant isolation, duplicate event, false signature, mismatched amount, forged return URL and webhook replay.
- Review the draft migration 0026 before applying it to Supabase.
