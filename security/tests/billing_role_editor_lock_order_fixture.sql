-- Disposable concurrency test extension: use ONLY jco_role_lock_order_test.
-- Uses the same role-check data model as the existing billing fixture.
ALTER TABLE public.roles ADD COLUMN key text NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE public.roles ADD COLUMN name text NOT NULL DEFAULT 'Synthetic Role';
UPDATE public.roles SET key='ADMIN',name='Tenant A administrator'
 WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
INSERT INTO public.roles(id,organization_id,active,key,name) VALUES(
 '99999999-9999-4999-8999-999999999999',
 '11111111-1111-4111-8111-111111111111',true,'AGENT','Role changed concurrently');
INSERT INTO public.permissions(id,key) VALUES
 ('eeeeeeee-1111-4111-8111-111111111111','roles.edit');
INSERT INTO public.role_permissions(role_id,permission_id) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-1111-4111-8111-111111111111');
CREATE TABLE public.audit_log(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organization_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 action text NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,
 metadata jsonb NOT NULL
);

-- Deliberately pause AFTER FOR UPDATE, in the role-editor's delegation
-- permission check, to make the historical lock-order inversion reproducible.
-- This instrumentation is test-only and never appears in production DDL.
ALTER FUNCTION public.has_org_permission(uuid,text) RENAME TO fixture_permission_check;
CREATE FUNCTION public.has_org_permission(target_org uuid,permission_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $stub$
BEGIN
 IF permission_key='billing.manage'
    AND current_setting('app.simulate_role_lock_delay',true)='yes' THEN
   PERFORM pg_catalog.pg_sleep(1.0);
 END IF;
 RETURN public.fixture_permission_check(target_org,permission_key);
END $stub$;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;
