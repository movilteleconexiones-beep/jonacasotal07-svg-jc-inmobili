-- INMOJCO | CANDIDATE ONLY. NEVER execute on production while #104 is NO-GO.
-- Prevent concurrent duplicate CRM identities across independent staff sessions.
-- Not a migration; staging approval, fresh duplicate inventory and lock window required.
-- Identity scope: tenant + normalized email + normalized full name. Two people
-- with different names may share a mailbox; contacts without email are unchanged.
-- Existing tenant RLS, audit RPCs and anonymous public-lead reuse stay untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail BEFORE DDL if already ambiguous: do not silently merge/delete people.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts
    WHERE email IS NOT NULL AND pg_catalog.btrim(email) <> ''
      AND pg_catalog.btrim(first_name) <> ''
    GROUP BY organization_id,
      pg_catalog.lower(pg_catalog.btrim(email)),
      pg_catalog.lower(pg_catalog.btrim(first_name || ' ' || pg_catalog.coalesce(last_name,'')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'NO-GO: duplicate tenant/email/full-name contacts require manual review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='jco_contacts_tenant_email_name_unique')
  THEN
    RAISE EXCEPTION 'NO-GO: CRM identity index already exists; inspect definition before rerunning';
  END IF;
END $preflight$;

-- A unique B-tree index is the transaction-safe arbiter across concurrent
-- PostgREST INSERTs, admin corrections, and public website contact creation.
-- Do not introduce a UNIQUE email-alone rule: shared family/company mailboxes.
CREATE UNIQUE INDEX jco_contacts_tenant_email_name_unique
ON public.contacts (
  organization_id,
  pg_catalog.lower(pg_catalog.btrim(email)),
  pg_catalog.lower(pg_catalog.btrim(first_name || ' ' || pg_catalog.coalesce(last_name,'')))
)
WHERE email IS NOT NULL AND pg_catalog.btrim(email) <> ''
  AND pg_catalog.btrim(first_name) <> '';
COMMIT;
