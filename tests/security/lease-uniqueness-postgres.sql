\set ON_ERROR_STOP on
-- Safe isolated PostgreSQL 17 regression: never connects to Supabase production.
CREATE TABLE public.leases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 property_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT'
);
-- Mirror both production partial unique indexes (verified read-only 2026-10-31).
CREATE UNIQUE INDEX leases_one_open_contract_per_property
 ON public.leases(organization_id,property_id)
 WHERE status IN ('DRAFT','ACTIVE','RENEWAL');
CREATE UNIQUE INDEX leases_one_occupied_contract_per_property
 ON public.leases(organization_id,property_id)
 WHERE status IN ('ACTIVE','RENEWAL');
DO $test$
DECLARE
  org uuid := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  org2 uuid := 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  property uuid := 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  duplicate_rejected boolean;
BEGIN
 INSERT INTO public.leases(organization_id,property_id,status) VALUES (org,property,'DRAFT');
 duplicate_rejected:=false;
 BEGIN
   INSERT INTO public.leases(organization_id,property_id,status) VALUES(org,property,'ACTIVE');
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN RAISE EXCEPTION 'Duplicate ACTIVE contract allowed next to DRAFT'; END IF;
 UPDATE public.leases SET status='ACTIVE' WHERE organization_id=org;
 duplicate_rejected:=false;
 BEGIN
   INSERT INTO public.leases(organization_id,property_id,status) VALUES(org,property,'RENEWAL');
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN RAISE EXCEPTION 'Duplicate RENEWAL contract allowed next to ACTIVE'; END IF;
 -- Another organization can have the same property UUID without violating this index.
 INSERT INTO public.leases(organization_id,property_id,status) VALUES(org2,property,'ACTIVE');
 UPDATE public.leases SET status='TERMINATED' WHERE organization_id=org;
 INSERT INTO public.leases(organization_id,property_id,status) VALUES(org,property,'DRAFT');
 IF (SELECT count(*) FROM public.leases WHERE organization_id=org)<>2 THEN
 RAISE EXCEPTION 'Closed historical contract unexpectedly removed'; END IF;
 -- Updating a historical contract back to ACTIVE must also fail while DRAFT exists.
 duplicate_rejected:=false;
 BEGIN
   UPDATE public.leases SET status='ACTIVE'
    WHERE organization_id=org AND status='TERMINATED';
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN RAISE EXCEPTION 'UPDATE reopened a duplicate ACTIVE contract'; END IF;
 -- A different property of the same organization must remain independently usable.
 INSERT INTO public.leases(organization_id,property_id,status)
 VALUES (org,'dddddddd-dddd-4ddd-dddd-dddddddddddd','ACTIVE');
END $test$;
SELECT 'lease active/open uniqueness checks passed' AS result;
