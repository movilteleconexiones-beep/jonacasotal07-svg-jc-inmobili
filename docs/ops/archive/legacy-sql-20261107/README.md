# INMOJCO #104 — Historic legacy migration sources

This archive contains all **109 original SQL files**, preserved byte-for-byte from the main branch before the proposed canonical migration cutover. Some are old drafts; never execute them merely because they appear here. The 99 replacement migration files in `supabase/migrations` have been reconstituted with original SQL bytes and true applied IDs from `docs/ops/snapshots/migration-source-parity-2026-11-06.json`.

**DRAFT ONLY, NO-GO:** Reconcile CI source references and the 2 off-ledger DDL prerequisites; verify rollback and all role/finance E2E checks. Do not run `supabase db push`, `migration repair`, or automatically merge this draft based on filename parity alone.
