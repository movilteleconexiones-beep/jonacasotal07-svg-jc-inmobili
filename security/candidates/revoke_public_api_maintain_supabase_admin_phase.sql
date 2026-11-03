-- INMOJCO #104/#203 — REVIEW ONLY. NOT A SUPABASE MIGRATION.
-- Completes the other default-ACL owner's side of the MAINTAIN cleanup.
-- Supabase hosted SQL sessions as postgres CANNOT run this phase by default;
-- use an explicitly authorized supabase_admin session or privileged process.
-- Do NOT attempt SET ROLE to bypass membership restrictions.
BEGIN;
DO $preflight$
BEGIN
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 'MAINTAIN phase-2 blocked: must execute AS supabase_admin (actual: %)',current_user;
  END IF;
END
$preflight$;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon,authenticated;
COMMIT;
