# JCO Wompi-to-Supabase adapter

**Not deployed.** `server/supabase-payment-store.ts` maps an already-verified payment event into the proposed `process_verified_payment_event` RPC (migration 0027). The adapter accepts an injected server-side RPC client; it does not contain or expose service-role credentials.

- Deterministic event fingerprint uses normalized transaction data for retry idempotency. It is **not the provider's original event ID or a hash of the raw webhook payload**; review whether Wompi supplies a stable event ID before production and rename the database field if necessary.
- The RPC checks stored reference, environment, amount, currency and transaction ID and does not grant a license.
- The endpoint must verify Wompi's cryptographic signature and, where required, reconcile the transaction against Wompi's API **before** calling this adapter.
- Do not import this module into the Vite frontend. Do not instantiate the RPC client with a publishable/anon key.
- The payment-order and event migrations 0026/0027 remain unapplied; the code is not usable as an active payment gateway yet.
- A trusted license activation procedure and an authenticated, deployed webhook endpoint are still required.
