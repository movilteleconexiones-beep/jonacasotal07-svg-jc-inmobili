\set ON_ERROR_STOP on
-- Behavioral integration fixture for the approved-payment review contract.
-- This is a minimal model, NOT the full production Wompi RPC.
CREATE SCHEMA jco_private;
CREATE TABLE public.plans(id uuid primary key,active boolean,max_users integer,max_properties integer);
CREATE TABLE public.organization_members(id uuid primary key,organization_id uuid,status text,external_only boolean default false);
CREATE TABLE public.properties(id bigint generated always as identity primary key,organization_id uuid);
CREATE FUNCTION jco_private.is_external_only_member(p_member uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT coalesce((SELECT external_only FROM public.organization_members WHERE id=p_member),false);
$$;
\! sed '/^DO \$patch\$/,$d' supabase/migrations/20261031090000_guard_plan_capacity_for_billing.sql > /tmp/payment-helper.sql
\i /tmp/payment-helper.sql

CREATE TABLE public.organizations(id uuid primary key,plan_id uuid not null);
CREATE TABLE public.payment_orders(id uuid primary key,organization_id uuid,plan_id uuid,status text not null default 'PENDING',fulfillment_status text not null default 'PENDING',review_reason text,reference text unique);
CREATE TABLE public.payment_events(event_id text primary key,order_id uuid not null);
CREATE FUNCTION public.fixture_process_approved(p_reference text,p_event text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE o public.payment_orders%ROWTYPE; org public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_events WHERE event_id=p_event AND order_id=o.id) THEN RETURN 'duplicate'; END IF;
  IF o.status<>'PENDING' THEN RETURN 'conflict'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=o.organization_id FOR UPDATE;
  INSERT INTO public.payment_events VALUES (p_event,o.id);
  UPDATE public.payment_orders SET status='APPROVED',
    fulfillment_status=CASE WHEN jco_private.plan_capacity_fits(org.id,o.plan_id) THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
    review_reason=CASE WHEN jco_private.plan_capacity_fits(org.id,o.plan_id) THEN NULL ELSE 'plan_capacity_review' END WHERE id=o.id;
  IF jco_private.plan_capacity_fits(org.id,o.plan_id) THEN
     UPDATE public.organizations SET plan_id=o.plan_id WHERE id=o.organization_id;
  END IF;
  RETURN 'processed';
END $$;

DO $t$
DECLARE org uuid:='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  basic uuid:='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  pro uuid:='cccccccc-cccc-4ccc-cccc-cccccccccccc';
  ord uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
BEGIN
 INSERT INTO public.plans VALUES(basic,true,5,200),(pro,true,25,2000);
 INSERT INTO public.organizations VALUES(org,pro);
 INSERT INTO public.organization_members
 SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,org,'ACTIVE',false
 FROM generate_series(1,6) g;
 INSERT INTO public.payment_orders(id,organization_id,plan_id,reference) VALUES(ord,org,basic,'fixture-order');
 IF public.fixture_process_approved('fixture-order','event-1')<>'processed' THEN RAISE EXCEPTION 'First approved event failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_orders WHERE id=ord AND status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED' AND review_reason='plan_capacity_review')
 THEN RAISE EXCEPTION 'Approved payment not retained for capacity review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=org AND plan_id=pro) THEN RAISE EXCEPTION 'Incompatible downgrade activated'; END IF;
 IF public.fixture_process_approved('fixture-order','event-1')<>'duplicate' THEN RAISE EXCEPTION 'Duplicate event not idempotent'; END IF;
 IF (SELECT count(*) FROM public.payment_events WHERE order_id=ord)<>1 THEN RAISE EXCEPTION 'Repeated event inserted'; END IF;
END $t$;
SELECT 'payment review behavioral fixture passed';
