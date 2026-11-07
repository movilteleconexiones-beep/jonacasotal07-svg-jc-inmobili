-- Defense in depth for Supabase API roles.
-- RLS governs row operations, but PostgreSQL TRUNCATE bypasses RLS.
-- The browser Data API does not require TRUNCATE, TRIGGER or REFERENCES.
-- Preserve SELECT/INSERT/UPDATE/DELETE privileges and every RLS policy.
-- Intentionally does not touch service_role, postgres, storage or auth schemas.
BEGIN;

REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- Future tables created directly by postgres must not regain these privileges
-- from this owner's default ACL. Other owners' defaults require separate review.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

COMMIT;
