CREATE FUNCTION pg_temp.expect_rejection(command text,expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE;
 END;
 IF state IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Expected %, received %, command %',expected,coalesce(state,'SUCCESS'),command;
 END IF;
END;
$$;

SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;

-- Client-side direct writes are blocked even if the user is administrator.
DO $check$
BEGIN
 IF has_table_privilege('authenticated','public.role_permissions','INSERT') OR
    has_table_privilege('authenticated','public.role_permissions','DELETE') OR
    has_table_privilege('authenticated','public.role_permissions','UPDATE') THEN
  RAISE EXCEPTION 'Direct grant DML is still accessible from authenticated';
 END IF;
END
$check$;
SELECT pg_temp.expect_rejection($$
 INSERT INTO public.role_permissions(role_id,permission_id)
 VALUES('10000000-0000-4000-9000-000000000002','00000000-0000-4000-9000-000000000008')
$$,'42501');

-- Successful addition of a permission held by the administrator.
SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['leases.view','properties.view']::text[],
 ARRAY['properties.view']::text[]);
DO $check$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.role_permissions rp
  JOIN public.permissions p ON p.id=rp.permission_id
  WHERE rp.role_id='10000000-0000-4000-9000-000000000002' AND p.key='leases.view'
 ) THEN RAISE EXCEPTION 'Permission was not added'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.audit_log WHERE action='role.permissions_changed'
     AND entity_id='10000000-0000-4000-9000-000000000002'
     AND metadata->'added'='["leases.view"]'::jsonb
 ) THEN RAISE EXCEPTION 'Permission change not audited'; END IF;
END
$check$;

-- Stale form is blocked before it removes anyone's real permissions.
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['properties.view']::text[],ARRAY['properties.view']::text[])
$$,'40001');

-- An advisor cannot grant themselves role privileges.
SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000002',false);
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['properties.view']::text[],ARRAY['leases.view','properties.view']::text[])
$$,'42501');

-- Another organization's administrator cannot touch these rows.
SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000003',false);
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['properties.view']::text[],ARRAY['leases.view','properties.view']::text[])
$$,'42501');
SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000001',false);

-- Admin may edit a tenant's advisor/client but not another tenant or owner role.
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '20000000-0000-4000-9000-000000000001',
 ARRAY['properties.view']::text[],ARRAY[]::text[])
$$,'42501');
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['leases.view','properties.view','roles.edit']::text[],
 ARRAY['leases.view','properties.view']::text[])
$$,'42501');

-- Cannot grant a permission that the acting admin does not hold.
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['commissions.edit','leases.view','properties.view']::text[],
 ARRAY['leases.view','properties.view']::text[])
$$,'42501');

-- No unknown keys, duplicate keys, or removing core ADMIN controls.
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['leases.view','properties.view','bogus.key']::text[],
 ARRAY['leases.view','properties.view']::text[])
$$,'22023');
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['leases.view','properties.view','properties.view']::text[],
 ARRAY['leases.view','properties.view']::text[])
$$,'22023');
SELECT pg_temp.expect_rejection($$
 SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000001',
 ARRAY['roles.edit','roles.assign','users.view','users.edit']::text[],
 ARRAY['leases.view','properties.view','rent_payments.create','roles.assign','roles.create','roles.edit','roles.view','users.edit','users.view']::text[])
$$,'23514');

-- A normal removal changes only the chosen role in this organization.
SELECT public.admin_update_role_permissions(
 '11111111-1111-4111-8111-111111111111',
 '10000000-0000-4000-9000-000000000002',
 ARRAY['properties.view']::text[],ARRAY['leases.view','properties.view']::text[]);
DO $check$
BEGIN
 IF (SELECT count(*) FROM public.role_permissions WHERE role_id='10000000-0000-4000-9000-000000000002')<>1 OR
   (SELECT count(*) FROM public.role_permissions WHERE role_id='20000000-0000-4000-9000-000000000001')<>9 OR
   (SELECT count(*) FROM public.audit_log WHERE action='role.permissions_changed')<>2 THEN
   RAISE EXCEPTION 'Role edit altered unrelated tenants or failed to log remove';
 END IF;
END
$check$;

-- Legacy custom-role route cannot bypass restricted permission selection.
SELECT pg_temp.expect_rejection($$
 SELECT public.create_custom_role(
 '11111111-1111-4111-8111-111111111111','Bypass role','bad',
 ARRAY['roles.edit']::text[])
$$,'42501');
SELECT pg_temp.expect_rejection($$
 SELECT public.create_custom_role(
 '11111111-1111-4111-8111-111111111111','Bypass role','bad',
 ARRAY['commissions.edit']::text[])
$$,'42501');

-- Allowed role creation still works for a legitimate operational profile.
SELECT public.create_custom_role(
 '11111111-1111-4111-8111-111111111111','Captador','Rol de captación',
 ARRAY['properties.view','leases.view']::text[]) AS created_custom_id \gset
DO $check$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.roles r
  WHERE r.name='Captador' AND r.organization_id='11111111-1111-4111-8111-111111111111'
    AND NOT r.is_system_role) THEN
  RAISE EXCEPTION 'Legitimate custom role creation regressed';
 END IF;
END
$check$;
-- Protected profiles remain immutable even through a direct API-level update.
SELECT pg_temp.expect_rejection($
 UPDATE public.roles SET name='Alterado'
 WHERE id='10000000-0000-4000-9000-000000000001'
$,'42501');
SELECT pg_temp.expect_rejection($
 UPDATE public.roles SET key='ADMIN'
 WHERE name='Captador' AND organization_id='11111111-1111-4111-8111-111111111111'
$,'42501');
UPDATE public.roles SET active=false
 WHERE name='Captador' AND organization_id='11111111-1111-4111-8111-111111111111';
DO $check$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.roles WHERE name='Captador' AND NOT active)
 THEN RAISE EXCEPTION 'Legitimate custom role retirement was blocked'; END IF;
END
$check$;
RESET ROLE;
