# Public-table privileges preflight

## Purpose
New tables under `public` must not assume Data API privileges are automatically granted. Before merging a migration, review access explicitly for `anon`, `authenticated`, and `service_role`.

## Required verification
1. Enumerate any new `CREATE TABLE public.*` objects, sequences, views, and RPCs.
2. Document whether each role needs SELECT, INSERT, UPDATE, DELETE or EXECUTE. Default to no access for financial and tenant-private tables.
3. Add explicit, narrowly scoped GRANT/REVOKE SQL for the selected objects and RLS policies.
4. In isolated PostgreSQL, test `has_table_privilege` and `has_sequence_privilege` for each role.
5. Verify a user from tenant A cannot access tenant B's rows. Verify client, advisor, coordinator, administrator and SuperAdmin paths.
6. Check new tenant signup and lead submission end-to-end before deploying.
7. Never use `GRANT ALL ON ALL TABLES` or disable RLS as a workaround.

## Release gate
Keep issue #205 open until a new-agency onboarding workflow runs against a migration-equivalent test environment. This file changes no production privileges.
