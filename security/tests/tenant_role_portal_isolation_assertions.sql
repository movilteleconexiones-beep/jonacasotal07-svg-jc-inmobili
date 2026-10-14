CREATE FUNCTION pg_temp.expect_rejection(command text,expected text)
RETURNS void LANGUAGE plpgsql AS $
DECLARE state text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE;
 END;
 IF state IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Expected %, received %, command %',
    expected,coalesce(state,'SUCCESS'),command;
 END IF;
END;
$;

-- Continuing the isolated two-tenant permissions fixture, not production.
-- Set a MANAGER profile to verify that both operational roles are editable.
INSERT INTO public.roles(id,organization_id,key,name,is_system_role,active)
VALUES ('10000000-0000-4000-9000-000000000004',
        '11111111-1111-4111-8111-111111111111',
        'MANAGER','Coordinador',true,true);

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT '10000000-0000-4000-9000-000000000004',p.id FROM public.permissions p
WHERE p.key='properties.view';

\i supabase/migrations/20261014123500_isolate_client_portal_role_grants.sql

-- A CLIENT role may not acquire organization-wide permissions even via
-- the administrator's audited RPC.
SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-9000-000000000003',
  ARRAY['properties.view']::text[],ARRAY[]::text[])
$$,'42501');

-- An advisor profile can lose and regain an operational permission.
SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['leases.view']::text[],ARRAY['properties.view']::text[]);
DO $check$
BEGIN
 IF EXISTS(
   SELECT 1 FROM public.role_permissions rp
   JOIN public.permissions p ON p.id=rp.permission_id
   WHERE rp.role_id='10000000-0000-4000-9000-000000000002' AND p.key='properties.view'
 ) THEN RAISE EXCEPTION 'Advisor revoked permission remained active'; END IF;
END
$check$;

-- Coordinator changes must not modify advisor, administrator or client.
SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000004',
 ARRAY['leases.view','properties.view']::text[],ARRAY['properties.view']::text[]);
DO $check$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.role_permissions rp
  JOIN public.permissions p ON p.id=rp.permission_id
  WHERE rp.role_id='10000000-0000-4000-9000-000000000004' AND p.key='leases.view'
 ) OR EXISTS(
  SELECT 1 FROM public.role_permissions rp
  JOIN public.roles r ON r.id=rp.role_id
  WHERE r.key='CLIENT'
 ) THEN
   RAISE EXCEPTION 'Coordinator edit failed or affected private Client portal';
 END IF;
END
$check$;
RESET ROLE;

-- Even a misconfigured server-side insertion is rejected for CLIENT.
SELECT pg_temp.expect_rejection($$
 INSERT INTO public.role_permissions(role_id,permission_id)
 VALUES('10000000-0000-4000-9000-000000000003',
        '00000000-0000-4000-9000-000000000007')
$$,'42501');

DO $check$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM public.roles r WHERE r.key='CLIENT'
    AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=r.id)
 ) THEN RAISE EXCEPTION 'Client portal role is not isolated'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE action='role.permissions_changed')<>4
 THEN RAISE EXCEPTION 'Expected exactly four audited role modifications'; END IF;
END
$check$;
