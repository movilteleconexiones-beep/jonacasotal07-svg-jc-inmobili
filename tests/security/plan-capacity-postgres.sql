\set ON_ERROR_STOP on
CREATE SCHEMA jco_private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.plans (id uuid primary key, active boolean not null, max_users integer, max_properties integer);
CREATE TABLE public.organization_members (id uuid primary key, organization_id uuid not null, status text not null, external_only boolean not null default false);
CREATE TABLE public.properties (id bigint generated always as identity primary key, organization_id uuid not null);
CREATE FUNCTION jco_private.is_external_only_member(p_member uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT external_only FROM public.organization_members WHERE id=p_member),false);
$$;
-- Execute the genuine proposed helper definition (before the privileged function patch).
\! sed '/^DO \$patch\$/,$d' supabase/migrations/20261031090000_guard_plan_capacity_for_billing.sql > /tmp/capacity-helper.sql
\i /tmp/capacity-helper.sql

DO $t$
DECLARE org uuid := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
        basic uuid := 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
        pro uuid := 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
BEGIN
  INSERT INTO public.plans VALUES (basic,true,5,200),(pro,true,25,2000);
  INSERT INTO public.organization_members(id,organization_id,status,external_only)
  SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,org,'ACTIVE',false
  FROM generate_series(1,5) g;
  IF NOT jco_private.plan_capacity_fits(org,basic) THEN RAISE EXCEPTION '5 seats must fit'; END IF;
  INSERT INTO public.organization_members VALUES ('00000000-0000-4000-8000-000000000006',org,'ACTIVE',true);
  IF NOT jco_private.plan_capacity_fits(org,basic) THEN RAISE EXCEPTION 'external-only client must not consume seat'; END IF;
  UPDATE public.organization_members SET external_only=false WHERE id='00000000-0000-4000-8000-000000000006';
  IF jco_private.plan_capacity_fits(org,basic) THEN RAISE EXCEPTION 'mixed-role sixth seat must fail'; END IF;
  IF NOT jco_private.plan_capacity_fits(org,pro) THEN RAISE EXCEPTION '6 seats fit PRO'; END IF;
  UPDATE public.organization_members SET status='INACTIVE' WHERE id='00000000-0000-4000-8000-000000000006';
  INSERT INTO public.properties(organization_id) SELECT org FROM generate_series(1,200);
  IF NOT jco_private.plan_capacity_fits(org,basic) THEN RAISE EXCEPTION '200 properties must fit'; END IF;
  INSERT INTO public.properties(organization_id) VALUES (org);
  IF jco_private.plan_capacity_fits(org,basic) THEN RAISE EXCEPTION '201 properties must fail'; END IF;
  IF NOT jco_private.plan_capacity_fits(org,pro) THEN RAISE EXCEPTION '201 properties fit PRO'; END IF;
END $t$;
SELECT 'capacity fixture passed' AS result;
