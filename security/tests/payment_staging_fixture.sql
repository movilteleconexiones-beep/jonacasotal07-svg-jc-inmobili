-- Isolated PostgreSQL test fixtures. NEVER run against production.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.role', true),'')
$$;
DO $ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $;
CREATE TABLE public.organizations (
 id uuid PRIMARY KEY,
 plan_id uuid,
 status text NOT NULL DEFAULT 'ACTIVE',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.plans (
 id uuid PRIMARY KEY,
 active boolean NOT NULL DEFAULT true,
 currency text NOT NULL,
 price numeric(16,2) NOT NULL,
 billing_cycle text NOT NULL
);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_plan_fk
 FOREIGN KEY(plan_id) REFERENCES public.plans(id);
CREATE TABLE public.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
 plan_id uuid REFERENCES public.plans(id),
 status text NOT NULL,
 billing_mode text NOT NULL,
 current_period_start timestamptz,
 current_period_end timestamptz,
 updated_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
 LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.is_org_member(uuid) RETURNS boolean
 LANGUAGE sql STABLE AS $$ SELECT false $$;
INSERT INTO public.plans(id,currency,price,billing_cycle)
 VALUES('11111111-1111-4111-8111-111111111111','COP',1000,'MONTHLY');
INSERT INTO public.organizations(id)
 VALUES('22222222-2222-4222-8222-222222222222'),
       ('33333333-3333-4333-8333-333333333333');
