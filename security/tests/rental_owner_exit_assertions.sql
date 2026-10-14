-- Runs only inside the isolated jco_guided_rent_test database after rental fixture.
-- No real properties, tenant accounts or financial rows are touched.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.property_owners
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid,actor_user_id uuid,action text NOT NULL,
 entity_type text,entity_id uuid,metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.property_ownerships(
 property_id uuid NOT NULL REFERENCES public.properties(id),
 owner_id uuid NOT NULL REFERENCES public.property_owners(id),
 ownership_percentage numeric NOT NULL DEFAULT 100,
 is_primary boolean NOT NULL DEFAULT true,
 created_at timestamptz DEFAULT now(),
 PRIMARY KEY(property_id,owner_id)
);
INSERT INTO public.property_ownerships(property_id,owner_id)
VALUES ('11111111-2222-4333-8444-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

\i supabase/migrations/20261014061000_audited_rental_end_owner_retirement.sql

CREATE FUNCTION pg_temp.expect_state(command text, expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN
   EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
 END;
 IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Expected %, received %: %',expected,coalesce(actual,'SUCCESS'),command;
 END IF;
END;
$$;

SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','d1000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
SELECT pg_temp.expect_state($$
 SELECT public.admin_finish_lease_and_release(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 (now() AT TIME ZONE 'America/Bogota')::date,
 'Entrega completa confirmada',true,false)
$$,'42501');

SELECT set_config('jco_test.actor','d1000000-0000-4000-8000-000000000001',false);
SELECT pg_temp.expect_state($$
 SELECT public.admin_finish_lease_and_release(
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 (now() AT TIME ZONE 'America/Bogota')::date,
 'Entrega completa confirmada',true,false)
$$,'42501');
SELECT pg_temp.expect_state($$
 SELECT public.admin_finish_lease_and_release(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 (now() AT TIME ZONE 'America/Bogota')::date,
 'Entrega completa confirmada',false,false)
$$,'23514');

-- A pending owner statement is not settled by terminating a contract.
INSERT INTO public.owner_statements(organization_id,lease_id,owner_id,period_month,status,
 gross_income,commission_amount,tax_amount,other_deductions,net_amount)
VALUES('11111111-1111-4111-8111-111111111111',
'33333333-3333-4333-8333-333333333333',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','DRAFT',0,0,0,0,0);

SELECT pg_temp.expect_state($$
 SELECT public.admin_finish_lease_and_release(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 (now() AT TIME ZONE 'America/Bogota')::date,
 'Entrega completa confirmada',true,false)
$$,'23514');

SELECT public.admin_finish_lease_and_release(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 (now() AT TIME ZONE 'America/Bogota')::date,
 'Entrega completa confirmada',true,true);

DO $check$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.leases WHERE id='33333333-3333-4333-8333-333333333333'
     AND status='FINISHED' AND terminated_by='d1000000-0000-4000-8000-000000000001')
 OR NOT EXISTS (SELECT 1 FROM public.properties
     WHERE id='11111111-2222-4333-8444-555555555555' AND status='AVAILABLE')
 OR NOT EXISTS (SELECT 1 FROM public.owner_statements
     WHERE owner_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND status='DRAFT')
 OR NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action='lease.finished') THEN
    RAISE EXCEPTION 'Termination failed to release inventory or preserve accounting history';
 END IF;
END
$check$;

-- Cannot withdraw owner before outstanding statements and draft leases are reviewed.
SELECT pg_temp.expect_state($$
 SELECT public.admin_retire_owner_agency(
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Retiro formal de la inmobiliaria')
$$,'23514');
UPDATE public.leases SET status='CANCELLED' WHERE id='55555555-5555-4555-8555-555555555555';
UPDATE public.owner_statements SET status='PAID' WHERE owner_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.admin_retire_owner_agency(
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Retiro formal de la inmobiliaria');

DO $check$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.property_owners
      WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND agency_status='RETIRED')
 OR NOT EXISTS (SELECT 1 FROM public.properties
      WHERE id='11111111-2222-4333-8444-555555555555' AND status='INACTIVE')
 OR NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action='owner.agency_retired') THEN
   RAISE EXCEPTION 'Withdrawal failed to deactivate inventory and preserve audit';
 END IF;
END
$check$;
SELECT pg_temp.expect_state($$
 INSERT INTO public.leases(id,organization_id,property_id,owner_id,monthly_rent,start_date,status)
 VALUES(gen_random_uuid(),'11111111-1111-4111-8111-111111111111',
 '11111111-2222-4333-8444-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 1000000,'2026-10-01','DRAFT')
$$,'23514');
RESET ROLE;
