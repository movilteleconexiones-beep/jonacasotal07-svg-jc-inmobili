-- #91 / G08: isolated PostgreSQL 17 relational integrity and delete semantics.
-- Runs in a throwaway PostgreSQL database on GitHub Actions, not Supabase.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  CONSTRAINT financial_properties_tenant_id_unique UNIQUE (organization_id,id)
);
CREATE TABLE public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  title text NOT NULL,
  CONSTRAINT maintenance_requests_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE
);
\ir ../candidates/g08_maintenance_property_tenant_fk_review.sql
DO $assertions$
DECLARE org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid();
  a_property uuid; b_property uuid; qa_id uuid; cascade_id uuid;
  rejected boolean;
BEGIN
 INSERT INTO public.properties(organization_id) VALUES(org_a) RETURNING id INTO a_property;
 INSERT INTO public.properties(organization_id) VALUES(org_b) RETURNING id INTO b_property;
 INSERT INTO public.maintenance_requests(organization_id,property_id,title)
 VALUES(org_a,a_property,'Valid tenant-bound maintenance') RETURNING id INTO qa_id;
 rejected:=false;
 BEGIN INSERT INTO public.maintenance_requests(organization_id,property_id,title)
 VALUES(org_a,b_property,'ILLEGAL foreign-tenant property');
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Foreign-tenant INSERT was accepted'; END IF;
 rejected:=false;
 BEGIN UPDATE public.maintenance_requests SET property_id=b_property WHERE id=qa_id;
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Foreign-tenant UPDATE was accepted'; END IF;
 IF (SELECT property_id FROM public.maintenance_requests WHERE id=qa_id) IS DISTINCT FROM a_property
 THEN RAISE EXCEPTION 'Denied UPDATE corrupted original property link'; END IF;
 INSERT INTO public.properties(organization_id) VALUES(org_a) RETURNING id INTO cascade_id;
 INSERT INTO public.maintenance_requests(organization_id,property_id,title)
 VALUES(org_a,cascade_id,'Will cascade');
 DELETE FROM public.properties WHERE id=cascade_id;
 IF EXISTS (SELECT 1 FROM public.maintenance_requests WHERE property_id=cascade_id)
 THEN RAISE EXCEPTION 'ON DELETE CASCADE behavior changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.maintenance_requests WHERE id=qa_id)
 THEN RAISE EXCEPTION 'Unrelated maintenance was deleted'; END IF;
END $assertions$;
ROLLBACK;
