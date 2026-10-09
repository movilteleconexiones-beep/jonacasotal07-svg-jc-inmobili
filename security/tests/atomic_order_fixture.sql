-- Isolated PostgreSQL only; never run against production.
CREATE SCHEMA auth;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'')
$$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.organization_members(id uuid PRIMARY KEY,organization_id uuid NOT NULL,user_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text NOT NULL UNIQUE);
CREATE TABLE public.member_permissions(organization_member_id uuid,permission_id uuid,effect text);
CREATE TABLE public.member_roles(organization_member_id uuid,role_id uuid);
CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid);
CREATE TABLE public.plans(id uuid PRIMARY KEY,code text UNIQUE,active boolean NOT NULL,currency text NOT NULL,price numeric(16,2) NOT NULL,billing_cycle text NOT NULL);
CREATE TABLE public.payment_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 plan_id uuid NOT NULL,billing_mode text NOT NULL,provider text NOT NULL,
 environment text NOT NULL,reference text NOT NULL UNIQUE,amount_in_cents bigint NOT NULL,
 currency text NOT NULL,status text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE FUNCTION public.has_org_permission(target_org uuid,permission_key text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH membership AS (SELECT id FROM public.organization_members WHERE organization_id=target_org AND user_id=auth.uid() AND status='ACTIVE'),
 requested_permission AS (SELECT id FROM public.permissions WHERE key=permission_key),
 override_effect AS (SELECT mp.effect FROM public.member_permissions mp JOIN membership m ON m.id=mp.organization_member_id JOIN requested_permission p ON p.id=mp.permission_id),
 role_grant AS (SELECT EXISTS(SELECT 1 FROM public.member_roles mr JOIN membership m ON m.id=mr.organization_member_id JOIN public.role_permissions rp ON rp.role_id=mr.role_id JOIN requested_permission p ON p.id=rp.permission_id) AS granted)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM override_effect WHERE effect='DENY') THEN false WHEN EXISTS(SELECT 1 FROM override_effect WHERE effect='ALLOW') THEN true ELSE coalesce((SELECT granted FROM role_grant),false) END
$$;
INSERT INTO public.organizations VALUES ('22222222-2222-4222-8222-222222222222','ACTIVE'),('33333333-3333-4333-8333-333333333333','ACTIVE');
INSERT INTO public.organization_members VALUES ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','ACTIVE');
INSERT INTO public.permissions VALUES ('66666666-6666-4666-8666-666666666666','billing.manage');
INSERT INTO public.member_permissions VALUES ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','ALLOW');
INSERT INTO public.plans VALUES ('11111111-1111-4111-8111-111111111111','BASIC',true,'COP',104900,'MONTHLY');
