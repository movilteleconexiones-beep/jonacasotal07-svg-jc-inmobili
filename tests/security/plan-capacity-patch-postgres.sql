\set ON_ERROR_STOP on
CREATE SCHEMA jco_private;
CREATE TABLE public.plans (id uuid primary key, active boolean not null, max_users int, max_properties int);
CREATE TABLE public.organization_members (id uuid primary key,organization_id uuid,status text,external_only boolean default false);
CREATE TABLE public.properties (id uuid primary key,organization_id uuid);
CREATE FUNCTION jco_private.is_external_only_member(p_member uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT external_only FROM public.organization_members WHERE id=p_member),false) $$;

-- Minimal representative PL/pgSQL functions. These are never connected to real billing.
CREATE FUNCTION public.billing_admin_action(target_org uuid, action text, reason text, target_plan uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE keys text[];
BEGIN
    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features WHERE false;
END
$f$;
CREATE FUNCTION public.platform_set_subscription(target_org uuid, target_plan_code text, target_billing_mode text, target_status text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE target_plan_id uuid; active_terms_id uuid;
BEGIN
  select id into target_plan_id from public.plans WHERE false;
  select id into active_terms_id FROM public.license_terms_versions WHERE false;
END
$f$;
CREATE FUNCTION public.process_verified_payment_event(p_reference text,p_transaction_id text,p_amount_in_cents bigint,p_currency text,p_status text,p_environment text,p_event_id text,p_payload_sha256 text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE reason text; org record; payment record;
BEGIN
  reason:=CASE
      WHEN false THEN 'ignored'
      ELSE NULL END;
  RETURN 'processed';
END
$f$;

\i supabase/migrations/20261031090000_guard_plan_capacity_for_billing.sql

DO $check$
DECLARE a text; b text; c text;
BEGIN
 a:=pg_get_functiondef('public.billing_admin_action(uuid,text,text,uuid)'::regprocedure);
 b:=pg_get_functiondef('public.platform_set_subscription(uuid,text,text,text)'::regprocedure);
 c:=pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure);
 IF position('jco_private.plan_capacity_fits(target_org,target_plan)' in a)=0
 OR position('jco_private.plan_capacity_fits(target_org,target_plan_id)' in b)=0
 OR position('jco_private.plan_capacity_fits(org.id,payment.plan_id)' in c)=0
 THEN RAISE EXCEPTION 'Full migration did not patch each guarded billing path'; END IF;
 IF has_function_privilege('anon','jco_private.plan_capacity_fits(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','jco_private.plan_capacity_fits(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Capacity helper exposed to untrusted role'; END IF;
END
$check$;
SELECT 'full migration patch fixture passed';
