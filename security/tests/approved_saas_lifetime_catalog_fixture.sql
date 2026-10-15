-- Dedicated production-shaped pricing fixture with representative subscriptions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE,
 name text NOT NULL,
 description text,
 billing_cycle text NOT NULL,
 price numeric NOT NULL,
 currency text NOT NULL,
 max_users integer,
 max_properties integer,
 max_storage_mb integer,
 ai_credits integer,
 active boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL UNIQUE,
 plan_id uuid REFERENCES public.plans(id),
 status text NOT NULL,
 billing_mode text NOT NULL,
 current_period_end timestamptz,
 notes text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_licenses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 license_type text NOT NULL,
 copyright_transferred boolean NOT NULL DEFAULT false,
 resale_allowed boolean NOT NULL DEFAULT false
);
CREATE TABLE public.payment_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid REFERENCES public.plans(id),
 amount_in_cents bigint NOT NULL
);
CREATE TABLE public.billing_activation_settings(
 sandbox_enabled boolean NOT NULL,
 production_enabled boolean NOT NULL,
 activation_mode text NOT NULL
);
INSERT INTO public.plans(code,name,billing_cycle,price,currency,
 max_users,max_properties,max_storage_mb,ai_credits,active)
VALUES
 ('BASIC','Básico','MONTHLY',0,'USD',5,200,2048,250,true),
 ('PRO','Profesional','MONTHLY',0,'USD',25,2000,10240,2000,true),
 ('LIFETIME','Licencia perpetua','ONE_TIME',0,'USD',NULL,NULL,NULL,NULL,true),
 ('ENTERPRISE','Enterprise','CUSTOM',0,'USD',NULL,NULL,NULL,NULL,true);
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_end)
SELECT '11111111-1111-4111-8111-111111111111',id,'TRIAL','SAAS_MONTHLY',now()+interval '8 days'
FROM public.plans WHERE code='BASIC';
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_end)
SELECT '22222222-2222-4222-8222-222222222222',id,'TRIAL','SAAS_MONTHLY',now()+interval '28 days'
FROM public.plans WHERE code='PRO';
INSERT INTO public.organization_licenses(organization_id,license_type)
VALUES('11111111-1111-4111-8111-111111111111','SAAS');
INSERT INTO public.payment_orders(plan_id,amount_in_cents)
SELECT id,12990000 FROM public.plans WHERE code='BASIC';
INSERT INTO public.billing_activation_settings VALUES(false,false,'VERIFIED_PAYMENT');

-- A forbidden write by the migration aborts the fixture immediately.
CREATE FUNCTION public.prevent_pricing_side_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Migration touched a protected operational table'; END;
$$;
CREATE TRIGGER no_subs BEFORE INSERT OR UPDATE OR DELETE ON public.subscriptions
 FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_side_effects();
CREATE TRIGGER no_license BEFORE INSERT OR UPDATE OR DELETE ON public.organization_licenses
 FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_side_effects();
CREATE TRIGGER no_order BEFORE INSERT OR UPDATE OR DELETE ON public.payment_orders
 FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_side_effects();
CREATE TRIGGER no_payment_flag BEFORE INSERT OR UPDATE OR DELETE ON public.billing_activation_settings
 FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_side_effects();
