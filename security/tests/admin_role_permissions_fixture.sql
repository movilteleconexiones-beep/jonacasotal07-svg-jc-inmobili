-- Completely synthetic fixture: separate PostgreSQL database, never production.
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END
$roles$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$SELECT nullif(current_setting('jco_test.actor',true),'')::uuid$$;

CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.organization_members(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL,status text NOT NULL
);
CREATE TABLE public.roles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id),
 key text,name text NOT NULL,description text,is_system_role boolean NOT NULL,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text UNIQUE NOT NULL,description text);
CREATE TABLE public.role_permissions(
 role_id uuid NOT NULL REFERENCES public.roles(id),
 permission_id uuid NOT NULL REFERENCES public.permissions(id),
 PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE public.member_roles(
 organization_member_id uuid NOT NULL REFERENCES public.organization_members(id),
 role_id uuid NOT NULL REFERENCES public.roles(id),
 PRIMARY KEY(organization_member_id,role_id)
);
CREATE TABLE public.audit_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid,actor_user_id uuid,action text NOT NULL,
 entity_type text,entity_id uuid,metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.has_org_permission(org uuid,requested text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.organization_members m
 JOIN public.member_roles mr ON mr.organization_member_id=m.id
 JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=org AND r.active
 JOIN public.role_permissions rp ON rp.role_id=r.id
 JOIN public.permissions p ON p.id=rp.permission_id AND p.key=requested
 WHERE m.organization_id=org AND m.user_id=auth.uid() AND m.status='ACTIVE'
 );
$$;
GRANT USAGE ON SCHEMA auth,public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(),public.has_org_permission(uuid,text) TO authenticated;
GRANT SELECT ON public.organization_members,public.member_roles,public.roles,public.permissions TO authenticated;
GRANT ALL ON public.role_permissions TO authenticated,anon;
GRANT SELECT ON public.audit_log TO authenticated;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select_test ON public.role_permissions
 FOR SELECT TO authenticated USING (true);

INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.organization_members VALUES
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','ACTIVE'),
 ('10000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002','ACTIVE'),
 ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','a0000000-0000-4000-8000-000000000003','ACTIVE');
INSERT INTO public.roles(id,organization_id,key,name,is_system_role) VALUES
 ('10000000-0000-4000-9000-000000000001','11111111-1111-4111-8111-111111111111','ADMIN','Administrador',true),
 ('10000000-0000-4000-9000-000000000002','11111111-1111-4111-8111-111111111111','AGENT','Asesor',true),
 ('10000000-0000-4000-9000-000000000003','11111111-1111-4111-8111-111111111111','CLIENT','Cliente',true),
 ('20000000-0000-4000-9000-000000000001','22222222-2222-4222-8222-222222222222','ADMIN','Administrador',true);
INSERT INTO public.member_roles VALUES
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-9000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-9000-000000000002'),
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-9000-000000000001');
INSERT INTO public.permissions(id,key) VALUES
 ('00000000-0000-4000-9000-000000000001','roles.view'),
 ('00000000-0000-4000-9000-000000000002','roles.edit'),
 ('00000000-0000-4000-9000-000000000003','roles.assign'),
 ('00000000-0000-4000-9000-000000000004','roles.create'),
 ('00000000-0000-4000-9000-000000000005','users.view'),
 ('00000000-0000-4000-9000-000000000006','users.edit'),
 ('00000000-0000-4000-9000-000000000007','properties.view'),
 ('00000000-0000-4000-9000-000000000008','leases.view'),
 ('00000000-0000-4000-9000-000000000009','commissions.edit'),
 ('00000000-0000-4000-9000-000000000010','rent_payments.create');
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE r.key='ADMIN' AND p.key IN (
  'roles.view','roles.edit','roles.assign','roles.create','users.view','users.edit',
  'properties.view','leases.view','rent_payments.create');
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE r.key='AGENT' AND p.key='properties.view';

\i supabase/migrations/20261014093000_audited_role_permission_editor.sql
