-- READ-ONLY schema preflight. Run with a restricted, read-only connection.
-- This file does not grant permissions or modify any table.
BEGIN READ ONLY;
SELECT c.conrelid::regclass AS source_table,
       c.conname AS constraint_name,
       c.confrelid::regclass AS referenced_table,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
         ELSE 'UNKNOWN' END AS on_delete
FROM pg_catalog.pg_constraint c
WHERE c.contype = 'f'
  AND c.conrelid IN ('public.roles'::regclass,
                     'public.member_roles'::regclass,
                     'public.role_permissions'::regclass)
ORDER BY source_table::text, constraint_name;

SELECT t.event_object_table AS table_name,
       t.trigger_name,
       t.action_timing,
       t.event_manipulation,
       t.action_statement
FROM information_schema.triggers t
WHERE t.event_object_schema = 'public'
  AND t.event_object_table IN ('roles','member_roles','role_permissions')
ORDER BY t.event_object_table, t.trigger_name, t.event_manipulation;

SELECT r.rolname AS function_owner,
       p.proname AS function_name,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN ('lock_tenant_billing_authorization',
                    'serialize_member_billing_authorization',
                    'serialize_membership_billing_authorization',
                    'create_authorized_sandbox_payment_order',
                    'has_org_permission')
ORDER BY p.proname;
COMMIT;
