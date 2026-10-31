\set ON_ERROR_STOP on
-- Real function definition from production via READ ONLY inspection; disposable fixture.
CREATE SCHEMA jco_private;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.plans(id uuid primary key,active boolean,max_users integer,max_properties integer);
CREATE TABLE public.organizations(id uuid primary key,plan_id uuid,status text,updated_at timestamptz default now());
CREATE TABLE public.organization_members(id uuid primary key,organization_id uuid,status text,external_only boolean default false);
CREATE TABLE public.properties(id bigint generated always as identity primary key,organization_id uuid);
CREATE FUNCTION jco_private.is_external_only_member(p_member uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT external_only FROM public.organization_members WHERE id=p_member),false) $$;
CREATE TABLE public.organization_billing_access(organization_id uuid primary key,requires_payment boolean default true,is_test boolean default true,allowed_permissions text[] default '{}',manual_access_until timestamptz,updated_at timestamptz default now());
CREATE TABLE public.billing_activation_settings(id boolean primary key,activation_mode text,sandbox_enabled boolean,production_enabled boolean);
CREATE TABLE public.subscriptions(id uuid default gen_random_uuid() primary key,organization_id uuid unique,plan_id uuid,status text,billing_mode text,current_period_start timestamptz,current_period_end timestamptz,cancelled_at timestamptz,updated_at timestamptz default now());
CREATE TABLE public.organization_licenses(organization_id uuid unique,license_type text,status text,starts_at timestamptz,ends_at timestamptz,updated_at timestamptz default now());
CREATE TABLE public.payment_orders(id uuid primary key,organization_id uuid,plan_id uuid,reference text unique,environment text,amount_in_cents bigint,currency text,provider_transaction_id text,status text,expires_at timestamptz,billing_mode text,permission_keys text[],approved_at timestamptz,fulfillment_status text,review_reason text,updated_at timestamptz default now());
CREATE TABLE public.payment_events(payment_order_id uuid,provider text default 'WOMPI',provider_event_id text unique,provider_transaction_id text,reported_status text,payload_sha256 text);
CREATE TABLE public.audit_log(organization_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
CREATE OR REPLACE FUNCTION public.process_verified_payment_event(p_reference text, p_transaction_id text, p_amount_in_cents bigint, p_currency text, p_status text, p_environment text, p_event_id text, p_payload_sha256 text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE payment public.payment_orders%ROWTYPE; org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE; existing public.subscriptions%ROWTYPE;
  settings public.billing_activation_settings%ROWTYPE; start_at timestamptz; end_at timestamptz;
  reason text; prior_event public.payment_events%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
    OR p_event_id IS NULL OR p_event_id !~ '^[a-f0-9]{64}$'
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR nullif(p_transaction_id,'') IS NULL THEN RETURN 'mismatch'; END IF;
  SELECT * INTO payment FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.environment IS DISTINCT FROM p_environment OR payment.amount_in_cents IS DISTINCT FROM p_amount_in_cents
    OR payment.currency IS DISTINCT FROM p_currency OR (payment.provider_transaction_id IS NOT NULL
      AND payment.provider_transaction_id<>p_transaction_id) THEN RETURN 'mismatch'; END IF;
  SELECT * INTO prior_event FROM public.payment_events WHERE provider='WOMPI' AND provider_event_id=p_event_id;
  IF FOUND THEN
    IF prior_event.payment_order_id=payment.id AND prior_event.provider_transaction_id=p_transaction_id
      AND prior_event.reported_status=p_status THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  -- Approved payments are immutable. Reversal events go to reconciliation.
  IF payment.status<>'PENDING' THEN RETURN 'conflict'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=payment.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=org.id;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF p_status='APPROVED' THEN
    SELECT * INTO existing FROM public.subscriptions WHERE organization_id=org.id FOR UPDATE;
    reason:=CASE
      WHEN payment.expires_at<=now() THEN 'expired_order'
      WHEN org.status NOT IN ('ACTIVE','INACTIVE','TRIAL') THEN 'organization_inactive'
      WHEN p_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test) THEN 'sandbox_isolation'
      WHEN p_environment='production' AND (NOT settings.production_enabled OR account.is_test) THEN 'production_disabled'
      WHEN settings.activation_mode='MANUAL' THEN 'manual_approval'
      WHEN existing.id IS NOT NULL AND (existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
        OR existing.status NOT IN ('TRIAL','ACTIVE')
        OR (existing.status='ACTIVE' AND existing.current_period_end>now() AND existing.plan_id IS DISTINCT FROM payment.plan_id)) THEN 'contract_review'
      WHEN EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=org.id
        AND (license_type<>'SAAS' OR status IN ('SUSPENDED','CANCELLED','TERMINATED'))) THEN 'license_review'
      ELSE NULL END;
    IF reason IS NULL THEN
      start_at:=CASE WHEN existing.status='ACTIVE' AND existing.current_period_end>now()
        THEN existing.current_period_start ELSE now() END;
      -- A trial never lengthens a newly purchased paid period.
      end_at:=greatest(now(), CASE WHEN existing.status='ACTIVE' THEN existing.current_period_end ELSE now() END)+
        CASE WHEN payment.billing_mode='SAAS_MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    END IF;
  END IF;
  -- A verified payment is recorded even if its fulfillment needs review.
  INSERT INTO public.payment_events(payment_order_id,provider_event_id,provider_transaction_id,
    reported_status,payload_sha256) VALUES(payment.id,p_event_id,p_transaction_id,p_status,p_payload_sha256);
  UPDATE public.payment_orders SET status=p_status,provider_transaction_id=p_transaction_id,
    approved_at=CASE WHEN p_status='APPROVED' THEN now() END,
    fulfillment_status=CASE WHEN p_status<>'APPROVED' THEN 'NO_ACCESS' WHEN reason IS NULL THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
    review_reason=reason,updated_at=now() WHERE id=payment.id;
  IF p_status='APPROVED' AND reason IS NULL THEN
    INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
      VALUES(org.id,payment.plan_id,'ACTIVE',payment.billing_mode,start_at,end_at)
      ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='ACTIVE',billing_mode=excluded.billing_mode,
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
        cancelled_at=NULL,updated_at=now();
    INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
      VALUES(org.id,'SAAS','ACTIVE',start_at,end_at) ON CONFLICT(organization_id) DO UPDATE SET
        status='ACTIVE',starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
    UPDATE public.organization_billing_access SET requires_payment=true,allowed_permissions=payment.permission_keys,
      manual_access_until=NULL,updated_at=now() WHERE organization_id=org.id;
    UPDATE public.organizations SET status='ACTIVE',plan_id=payment.plan_id,updated_at=now() WHERE id=org.id;
    INSERT INTO public.audit_log(organization_id,action,entity_type,entity_id,metadata)
      VALUES(org.id,'billing.payment_activated','payment_order',payment.id,
        jsonb_build_object('plan_id',payment.plan_id,'environment',p_environment,'period_end',end_at));
  END IF;
  RETURN 'processed';
END;
$function$
;
CREATE FUNCTION public.billing_admin_action(target_org uuid, action text, reason text, target_plan uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql AS $f$ DECLARE keys text[]; BEGIN
    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features WHERE false;
END $f$;
CREATE FUNCTION public.platform_set_subscription(target_org uuid,target_plan_code text,target_billing_mode text,target_status text)
RETURNS void LANGUAGE plpgsql AS $f$ DECLARE target_plan_id uuid; active_terms_id uuid; BEGIN
  select id into target_plan_id from public.plans WHERE false;
  select id into active_terms_id FROM public.license_terms_versions WHERE false;
END $f$;
\i supabase/migrations/20261031090000_guard_plan_capacity_for_billing.sql
DO $t$ BEGIN
 IF position('plan_capacity_review' IN pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure))=0
 THEN RAISE EXCEPTION 'Real Wompi RPC was not patched'; END IF;
END $t$;
SELECT 'full Wompi RPC compiles with migration in isolated postgres' AS result;

DO $checks$
DECLARE org uuid:='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
        basic uuid:='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
        pro uuid:='cccccccc-cccc-4ccc-cccc-cccccccccccc';
        ord uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        response text;
BEGIN
 INSERT INTO public.plans VALUES(basic,true,5,200),(pro,true,25,2000);
 INSERT INTO public.organizations(id,plan_id,status) VALUES(org,pro,'ACTIVE');
 INSERT INTO public.organization_billing_access(organization_id,requires_payment,is_test) VALUES(org,true,true);
 INSERT INTO public.billing_activation_settings VALUES(true,'VERIFIED_PAYMENT',true,false);
 INSERT INTO public.organization_members(id,organization_id,status,external_only)
 SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,org,'ACTIVE',false FROM generate_series(1,6) g;
 INSERT INTO public.payment_orders(id,organization_id,plan_id,reference,environment,amount_in_cents,currency,status,expires_at,billing_mode,permission_keys,fulfillment_status)
 VALUES(ord,org,basic,'integration-order','sandbox',990000,'COP','PENDING',now()+interval '1 day','SAAS_MONTHLY',ARRAY['properties.view'],'PENDING');
 response:=public.process_verified_payment_event('integration-order','transaction-01',990000,'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64));
 IF response <> 'processed' THEN RAISE EXCEPTION 'Real RPC did not process approved payment: %',response; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.payment_orders WHERE id=ord AND status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED' AND review_reason='plan_capacity_review')
 THEN RAISE EXCEPTION 'Real RPC did not retain approved payment for capacity review'; END IF;
 IF (SELECT plan_id FROM public.organizations WHERE id=org)<>pro THEN RAISE EXCEPTION 'Incompatible plan became active'; END IF;
 IF public.process_verified_payment_event('integration-order','transaction-01',990000,'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64))<>'duplicate'
 THEN RAISE EXCEPTION 'Real RPC duplicate detection failed'; END IF;
 IF (SELECT count(*) FROM public.payment_events WHERE payment_order_id=ord)<>1 THEN RAISE EXCEPTION 'Payment event duplicated'; END IF;
END $checks$;
SELECT 'real payment RPC review + idempotency verified' AS result;
