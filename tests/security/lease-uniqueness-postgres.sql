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
 -- Reassigning a different property's ACTIVE contract to an occupied property
 -- must fail without silently altering its property_id.
 duplicate_rejected:=false;
 BEGIN
   UPDATE public.leases SET property_id=property
    WHERE organization_id=org AND property_id='dddddddd-dddd-4ddd-dddd-dddddddddddd';
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN RAISE EXCEPTION 'UPDATE moved ACTIVE contract onto occupied property'; END IF;
 IF (SELECT count(*) FROM public.leases WHERE organization_id=org
      AND property_id='dddddddd-dddd-4ddd-dddd-dddddddddddd' AND status='ACTIVE')<>1 THEN
   RAISE EXCEPTION 'Failed property reassignment changed original contract';
 END IF;
 -- Reassigning an ACTIVE contract from another organization to an occupied
 -- (organization_id,property_id) pair must also be rejected.
 duplicate_rejected:=false;
 BEGIN
   UPDATE public.leases SET organization_id=org
    WHERE organization_id=org2 AND property_id=property;
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN RAISE EXCEPTION 'UPDATE moved contract across organizations onto occupied property'; END IF;
 IF (SELECT count(*) FROM public.leases WHERE organization_id=org2 AND property_id=property AND status='ACTIVE')<>1 THEN
   RAISE EXCEPTION 'Failed organization reassignment changed original contract';
 END IF;
 -- Bulk insert with two open contracts must be rejected atomically:
 -- neither row may survive a single failed multi-row INSERT.
 duplicate_rejected:=false;
 BEGIN
   INSERT INTO public.leases(organization_id,property_id,status)
   VALUES (org,'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee','DRAFT'),
          (org,'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee','ACTIVE');
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN
   RAISE EXCEPTION 'Bulk insert with two open contracts was accepted';
 END IF;
 IF EXISTS (SELECT 1 FROM public.leases
             WHERE organization_id=org AND property_id='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee') THEN
   RAISE EXCEPTION 'Failed bulk insert left a partial contract behind';
 END IF;
 -- Reopening two historical contracts in a single UPDATE must fail atomically.
 -- This covers batch status changes even when neither row was open beforehand.
 INSERT INTO public.leases(organization_id,property_id,status)
 VALUES (org,'ffffffff-ffff-4fff-8fff-ffffffffffff','TERMINATED'),
        (org,'ffffffff-ffff-4fff-8fff-ffffffffffff','TERMINATED');
 duplicate_rejected:=false;
 BEGIN
   UPDATE public.leases SET status='ACTIVE'
    WHERE organization_id=org
      AND property_id='ffffffff-ffff-4fff-8fff-ffffffffffff';
 EXCEPTION WHEN unique_violation THEN duplicate_rejected:=true;
 END;
 IF NOT duplicate_rejected THEN
   RAISE EXCEPTION 'Bulk UPDATE reopened duplicate historical contracts';
 END IF;
 IF (SELECT count(*) FROM public.leases
     WHERE organization_id=org
       AND property_id='ffffffff-ffff-4fff-8fff-ffffffffffff'
       AND status='TERMINATED')<>2 THEN
   RAISE EXCEPTION 'Failed bulk UPDATE changed historical contracts';
 END IF;
END $test$;
SELECT 'lease active/open uniqueness checks passed' AS result;
