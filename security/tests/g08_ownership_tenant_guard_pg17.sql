-- PostgreSQL 17 disposable G08 owner/property derived tenant guard.
\set ON_ERROR_STOP on
BEGIN;
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA jco_private;
CREATE TABLE public.properties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL
);
CREATE TABLE public.property_owners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL
);
CREATE TABLE public.property_ownerships (
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
 ownership_percentage numeric NOT NULL DEFAULT 100 CHECK (ownership_percentage>0 AND ownership_percentage<=100),
 is_primary boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(property_id,owner_id)
);
\ir ../candidates/g08_ownership_link_tenant_guard_REVIEW_ONLY.sql

DO $checks$
DECLARE org_a uuid:=gen_random_uuid();org_b uuid:=gen_random_uuid();
 prop_a uuid;prop_b uuid;owner_a uuid;owner_b uuid; no_links uuid;
 denied boolean; n int;
BEGIN
 INSERT INTO public.properties(organization_id) VALUES(org_a) RETURNING id INTO prop_a;
 INSERT INTO public.properties(organization_id) VALUES(org_b) RETURNING id INTO prop_b;
 INSERT INTO public.property_owners(organization_id) VALUES(org_a) RETURNING id INTO owner_a;
 INSERT INTO public.property_owners(organization_id) VALUES(org_b) RETURNING id INTO owner_b;
 INSERT INTO public.property_ownerships(property_id,owner_id,ownership_percentage)
 VALUES(prop_a,owner_a,60);
 denied:=false;
 BEGIN
 INSERT INTO public.property_ownerships(property_id,owner_id,ownership_percentage)
 VALUES(prop_a,owner_b,30);
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-org ownership INSERT accepted'; END IF;
 denied:=false;
 BEGIN UPDATE public.property_ownerships SET owner_id=owner_b WHERE property_id=prop_a AND owner_id=owner_a;
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-org ownership UPDATE accepted'; END IF;
 denied:=false;
 BEGIN UPDATE public.properties SET organization_id=org_b WHERE id=prop_a;
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Linked property org transfer accepted'; END IF;
 denied:=false;
 BEGIN UPDATE public.property_owners SET organization_id=org_b WHERE id=owner_a;
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Linked owner org transfer accepted'; END IF;
 -- Changing unrelated data is unaffected.
 UPDATE public.property_ownerships SET ownership_percentage=75
 WHERE property_id=prop_a AND owner_id=owner_a;
 IF NOT EXISTS(SELECT 1 FROM public.property_ownerships WHERE property_id=prop_a
  AND owner_id=owner_a AND ownership_percentage=75) THEN RAISE EXCEPTION 'Valid owner edit blocked'; END IF;
 INSERT INTO public.properties(organization_id) VALUES(org_a) RETURNING id INTO no_links;
 UPDATE public.properties SET organization_id=org_b WHERE id=no_links;
 IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=no_links AND organization_id=org_b)
 THEN RAISE EXCEPTION 'Unlinked property transfer blocked'; END IF;
 DELETE FROM public.properties WHERE id=prop_a;
 IF EXISTS(SELECT 1 FROM public.property_ownerships WHERE property_id=prop_a)
 THEN RAISE EXCEPTION 'Cascade deletion no longer works'; END IF;
 IF EXISTS(SELECT 1 FROM public.property_ownerships WHERE owner_id=owner_b)
 THEN RAISE EXCEPTION 'Rejected cross-org link remained'; END IF;
 SELECT count(*) INTO n FROM pg_trigger WHERE tgname IN (
 'enforce_property_ownership_same_tenant','prevent_property_link_tenant_reassignment',
 'prevent_owner_link_tenant_reassignment') AND tgenabled='O';
 IF n<>3 THEN RAISE EXCEPTION 'Expected 3 ownership security triggers'; END IF;
END $checks$;
ROLLBACK;
