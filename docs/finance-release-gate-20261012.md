# INMOJCO financial release gate — 2026-10-12

## Source of truth
- Live Supabase project: `cuitgyqrjibgwuniapmk` (Sistema Inmobiliario JCO). Do not confuse with `nqzopzhmhqdssgpljypu`.
- Railway production frontend: `app.inmojco.com`, service `a1d375e9-e457-4d23-bfdf-11f175f5db75`, `main` branch.
- PR #102 is a **draft** until this release gate is completed.
- Wompi integrates platform subscriptions only, not tenant rent or owner payouts.

## Live database state verified on 2026-10-12
- No rows were present in `leases`, `rent_payments`, `owner_statements`, `rent_receipts`, or `owner_statement_deductions`.
- RLS policies gate finance tables with module-specific `has_org_permission`.
- `authenticated` cannot directly mutate rent aggregate payments or owner statement totals.
- Tenant-composite foreign keys are installed, including owner statement owner reference.
- Atomic receipt, period, draft statement, and reconciliation RPCs exist.
- `leases_financial_insert` requires `status='DRAFT'`.
- `aaa_owner_deductions_server_timestamps` normalizes insert audit timestamps.
- GitHub Actions run #485 passed SQL regression, concurrency checks and application build.
- A real authenticated transactional rehearsal **is not certified complete**; the test runner could not finish it.

## Migration history divergence: DO NOT RUN `supabase db push` BLINDLY
The database migration history currently contains two consolidated entries:
- `20261012070133 audited_rent_receipts_owner_deductions_finance_permissions`
- `20261012071309 finance_approval_and_audit_timestamp_hardening`

GitHub PR #102 instead carries **five** individual SQL files:
- `20261012120000_owner_statement_deduction_lines.sql`
- `20261012130000_rent_receipts_and_owner_drafts.sql`
- `20261012140000_reconcile_owner_deductions.sql`
- `20261012143000_finance_rls_and_tenant_links.sql`
- `20261012150000_finance_approval_and_audit_timestamp_hardening.sql`

Their schema effects are present, but their individual version IDs are not recorded as applied. Re-running these scripts against production would cause duplicate-object failures. Before the next DB deployment, compare checked-in SQL to `pg_get_functiondef`, `pg_policies`, `pg_constraint`, and `supabase_migrations.schema_migrations`; reconcile migration history using a reviewed migration-repair plan and a verified backup. Never delete financial tables to fix history.

## Remaining release checks
1. Verify Railway's effective `VITE_SUPABASE_URL` points to the correct live Supabase project. The connected Railway integration currently reveals variable **names**, not values.
2. Rehearse a complete authenticated flow with an **authorized** test account in a disposable environment, using rollback-protected transactions: draft contract -> activation -> monthly period -> two receipts -> duplicate idempotency -> overpayment rejection -> owner draft -> OWNER/TENANT deductions -> approvals -> reconciliation -> permission denial and tenancy boundaries.
3. Verify the session only sees its organization. Test a member who lacks a specific finance module permission.
4. Confirm UI shows all five inputs and actions even with empty datasets, and does not show a success message for zero-row UPDATEs.
5. Validate internal receipt vs. banking payout wording; confirm no Wompi or DIAN side effects on tenant rent.
6. Confirm database backup and rollback plan, run production release from `main`, and inspect Railway deployment plus real browser behavior.
7. Re-query ledger row counts and Supabase security advisors immediately after rollout.

## Unsafe shortcuts
- Do not run a multi-statement SQL preview against production assuming `ROLLBACK` will always be honored by a remote connector.
- Do not impersonate a customer session in a production smoke test without an explicitly authorized test mechanism.
- Do not conflate a green GitHub build with an accessible production feature.
- Do not reapply already-recorded finance migration DDL to the live database.
