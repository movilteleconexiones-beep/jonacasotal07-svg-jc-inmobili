# JCO payment event processing: release checklist

**Status:** SQL draft only; no Supabase changes made.

Migration `0027_process_verified_payment_events.sql` introduces a restricted `process_verified_payment_event` RPC. It checks the caller's service role, locks the payment order, compares reference, transaction, amount, currency and environment, records a unique event and updates the order atomically.

The procedure **does not activate subscriptions**. This is deliberate: Wompi authenticity must be verified before calling the RPC, and a separate license-grant procedure must enforce plan compatibility, periods and tenant identity.

## Before executing 0026 and 0027

1. Confirm the hosting platform and implement the actual server-side webhook endpoint, using verified Wompi event data only.
2. Check the correct provider event ID format and SHA-256 payload digest derivation.
3. Make the server-side payment store call the RPC only after signature validation and trusted transaction reconciliation.
4. Review Wompi signature properties and environment against current provider documentation.
5. Implement and test subscription activation separately, using order-owned organization and plan, not browser parameters.
6. Test duplicate event ID, conflicting event data, mismatched amount, wrong tenant, concurrent webhook delivery, terminal state replay, wrong environment and direct browser RPC access.
7. Review migration grants, SECURITY DEFINER privileges and RLS in staging, and obtain explicit production authorization.

The existing `platform_set_subscription` must not be used as an automated Wompi payment approval function.
