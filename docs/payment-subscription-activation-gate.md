# JCO: Verified payment subscription activation gate

**Migration 0028 is a proposal, NOT executed in Supabase.**

This migration replaces the 0027 RPC, preserving its service-role restriction, row locking, reference/amount/currency/environment checks and duplicate-event behavior. An approved Wompi payment and its corresponding monthly/annual subscription change occur in the **same database transaction**. A failed step rolls back the entire transaction.

## Critical requirements before deployment

1. Apply and test 0026, 0027 and 0028 together in an isolated staging database, not production.
2. Create active COP-priced MONTHLY and ANNUAL plans; existing seed plans are USD and/or zero-priced, so **APPROVED activation intentionally fails until real prices are configured**. Never assume a price.
3. Confirm organization eligibility, whether suspended agencies may be reactivated, and how an already-active or lifetime subscription should be handled before enabling this RPC. The draft currently reactivates an organization on a valid paid event; this needs business approval.
4. For renewals, the draft extends from the later of now or the existing period end. Review proration, upgrades and downgrades.
5. Lifetime license activation is explicitly blocked pending signed terms and legal acceptance checks.
6. A trusted backend must validate Wompi's signature, reconcile the transaction and call the service-role RPC; the frontend must never hold private keys.
7. Exercise concurrent approvals, duplicate webhook, rejected payment, wrong plan price, wrong currency, cross-tenant order, tampered transaction, and direct authenticated-user RPC denial.
8. Run migration and integration tests in staging before asking for explicit permission to deploy to production.

**No live payment processing or public-site changes are included.**
