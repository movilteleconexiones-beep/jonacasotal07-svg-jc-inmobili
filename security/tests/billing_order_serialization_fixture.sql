-- SYNTHETIC PostgreSQL 17 fixture for billing lock candidate. Not production.
CREATE SCHEMA auth;
DO $roles$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END;
$roles$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,anon;

CREATE TABLE public.organizations (
 id uuid PRIMARY KEY,status text NOT NULL
);
CREATE TABLE public.organization_members (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL,status text NOT NULL
);
CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text UNIQUE NOT NULL);
CREATE TABLE public.member_permissions(
 organization_member_id uuid NOT NULL REFERENCES public.organization_members(id),
 permission_id uuid NOT NULL REFERENCES public.permissions(id),
 effect text NOT NULL CHECK(effect IN('ALLOW','DENY')),
 PRIMARY KEY(organization_member_id,permission_id)
);
CREATE TABLE public.roles(
 id uuid PRIMARY KEY,organization_id uuid REFERENCES public.organizations(id),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.member_roles(
 organization_member_id uuid NOT NULL REFERENCES public.organization_members(id),
 role_id uuid NOT NULL REFERENCES public.roles(id),
 PRIMARY KEY(organization_member_id,role_id)
);
CREATE TABLE public.role_permissions(
 role_id uuid NOT NULL REFERENCES public.roles(id),
 permission_id uuid NOT NULL REFERENCES public.permissions(id),
 PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE public.plans(
 id uuid PRIMARY KEY,code text UNIQUE NOT NULL,
 active boolean NOT NULL, currency text NOT NULL,
 price numeric NOT NULL, billing_cycle text NOT NULL
);
CREATE TABLE public.payment_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 plan_id uuid NOT NULL REFERENCES public.plans(id),
 billing_mode text NOT NULL,provider text NOT NULL,environment text NOT NULL,
 reference text NOT NULL UNIQUE,amount_in_cents bigint NOT NULL,currency text NOT NULL,
 status text NOT NULL,expires_at timestamptz NOT NULL
);

-- This fixture mimics the real permission hierarchy: explicit DENY > ALLOW >
-- role grants, with membership status and organizational scope.
CREATE FUNCTION public.has_org_permission(target_org uuid,permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $has$
WITH membership AS (
 SELECT id FROM public.organization_members
 WHERE organization_id=target_org AND user_id=auth.uid() AND status='ACTIVE'
), requested AS (
 SELECT id FROM public.permissions WHERE key=permission_key
), explicit AS (
 SELECT mp.effect FROM public.member_permissions mp
 JOIN membership m ON mp.organization_member_id=m.id
 JOIN requested p ON mp.permission_id=p.id
), granted AS (
 SELECT 1 FROM public.member_roles mr
 JOIN membership m ON m.id=mr.organization_member_id
 JOIN public.roles r ON r.id=mr.role_id AND r.active
    AND (r.organization_id=target_org OR r.organization_id IS NULL)
 JOIN public.role_permissions rp ON rp.role_id=r.id
 JOIN requested p ON p.id=rp.permission_id
)
SELECT CASE
 WHEN EXISTS(SELECT 1 FROM explicit WHERE effect='DENY') THEN false
 WHEN EXISTS(SELECT 1 FROM explicit WHERE effect='ALLOW') THEN true
 ELSE EXISTS(SELECT 1 FROM granted) END;
$has$;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;

INSERT INTO public.organizations(id,status) VALUES
 ('11111111-1111-4111-8111-111111111111','ACTIVE'),
 ('22222222-2222-4222-8222-222222222222','ACTIVE');
INSERT INTO public.organization_members(id,organization_id,user_id,status) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
  '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE');
INSERT INTO public.permissions(id,key) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','billing.manage');
INSERT INTO public.roles(id,organization_id,active) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',true),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',true);
INSERT INTO public.member_roles(organization_member_id,role_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO public.role_permissions(role_id,permission_id) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.member_permissions(organization_member_id,permission_id,effect)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','ALLOW');
INSERT INTO public.plans(id,code,active,currency,price,billing_cycle) VALUES
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','BASIC',true,'COP',149000,'MONTHLY');

-- Permission-table DML happens as fixture owner; client can only call RPC.
REVOKE ALL ON public.payment_orders FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.member_permissions,public.member_roles,public.role_permissions,
  public.organization_members,public.roles,public.organizations
  FROM PUBLIC,anon,authenticated;
