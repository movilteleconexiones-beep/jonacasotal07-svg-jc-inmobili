-- INMOJCO #104/#203. REVIEW-ONLY candidate: NOT a Supabase migration.
-- Do not execute on production before #104 history reconciliation, an
-- authorized deployment plan, verified backup and staging Auth/RLS tests.
-- Scope: existing public.maintenance_requests, anon CRUD ONLY.
-- The separate two-owner candidate handles MAINTAIN (including future ACL).
-- A missing or unexpected policy/owner means FAIL CLOSED, no partial REVOKE.
BEGIN;
DO $guard$
DECLARE v_oid oid := to_regclass('public.maintenance_requests');
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: must execute AS postgres';
  END IF;
  IF v_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid=v_oid AND c.relowner='postgres'::regrole
      AND c.relkind IN ('r','p') AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: expected postgres-owned RLS table';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid=v_oid) <> 2
     OR EXISTS (
       SELECT 1 FROM pg_policy p WHERE p.polrelid=v_oid AND
         (p.polname NOT IN ('maintenance_org_access','jco_commercial_access')
          OR cardinality(p.polroles) <> 1
          OR p.polroles[1] <> 'authenticated'::regrole::oid)
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy p WHERE p.polrelid=v_oid
         AND p.polname='maintenance_org_access' AND p.polpermissive
         AND p.polcmd='*' AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy p WHERE p.polrelid=v_oid
         AND p.polname='jco_commercial_access' AND NOT p.polpermissive
         AND p.polcmd='*' AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: RLS policy contract changed';
  END IF;
  -- Each observed policy has identical USING and WITH CHECK expressions.
  -- Reject asymmetric drift before touching grants; full semantic baselining
  -- of both expressions remains a separate pre-deployment requirement.
  IF EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid=v_oid
      AND pg_get_expr(p.polqual,p.polrelid)
          IS DISTINCT FROM pg_get_expr(p.polwithcheck,p.polrelid)
  ) THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: asymmetric RLS policy expressions';
  END IF;
  -- Production policy expressions observed via SELECT on 2026-11-03.
  -- Fail closed if BOTH USING and WITH CHECK are widened identically.
  -- Digest is of pg_get_expr output, not raw pg_node_tree bytes.
  IF EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid=v_oid AND (
      (p.polname='jco_commercial_access' AND
       md5(pg_get_expr(p.polqual,p.polrelid)) <> 'af2c87c5b0ad71d480f3aab921912bad')
      OR (p.polname='maintenance_org_access' AND
       md5(pg_get_expr(p.polqual,p.polrelid)) <> '8575656ba75ff57acadaaa0bcf9e6cab')
    )
  ) THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: RLS policy semantic baseline changed';
  END IF;
  -- A PUBLIC grant would survive REVOKE FROM anon; never claim success then.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(
      coalesce(c.relacl,acldefault('r',c.relowner))
    ) acl
    WHERE c.oid=v_oid AND acl.grantee=0
      AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) THEN
    RAISE EXCEPTION 'maintenance anon CRUD blocked: PUBLIC privileges remain';
  END IF;
END
$guard$;
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.maintenance_requests FROM anon;
DO $verify$
BEGIN
  IF has_table_privilege('anon','public.maintenance_requests','SELECT')
    OR has_table_privilege('anon','public.maintenance_requests','INSERT')
    OR has_table_privilege('anon','public.maintenance_requests','UPDATE')
    OR has_table_privilege('anon','public.maintenance_requests','DELETE')
  THEN
    RAISE EXCEPTION 'maintenance anon CRUD revocation not effective';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid='public.maintenance_requests'::regclass)
    OR NOT has_table_privilege('authenticated','public.maintenance_requests','SELECT')
    OR NOT has_table_privilege('service_role','public.maintenance_requests','SELECT')
  THEN
    RAISE EXCEPTION 'maintenance anon CRUD affected protected roles or RLS';
  END IF;
END
$verify$;
COMMIT;
