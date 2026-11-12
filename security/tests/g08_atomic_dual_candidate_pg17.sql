-- G08 #91 isolated PostgreSQL 17 fixture. Nothing runs on Supabase production.
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA jco_private;
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;

CREATE TABLE public.organizations(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL);
CREATE TABLE public.properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL);
CREATE TABLE public.property_owners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL);
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid, property_id uuid);
CREATE TABLE public.deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL);
CREATE TABLE public.activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid, deal_id uuid, lead_id uuid, property_id uuid);
CREATE TABLE public.appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid, lead_id uuid, property_id uuid);
CREATE TABLE public.commissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, deal_id uuid NOT NULL);
CREATE TABLE public.portal_access_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid, owner_id uuid);
CREATE TABLE public.property_consignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid, lead_id uuid, property_id uuid);
CREATE TABLE public.property_private_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, property_id uuid);
ALTER TABLE public.contacts ADD CONSTRAINT contacts_tenant_id_fixture UNIQUE (organization_id,id);
ALTER TABLE public.properties ADD CONSTRAINT properties_tenant_id_fixture UNIQUE (organization_id,id);
ALTER TABLE public.property_owners ADD CONSTRAINT property_owners_tenant_id_fixture UNIQUE (organization_id,id);
ALTER TABLE public.leads ADD CONSTRAINT leads_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.activities ADD CONSTRAINT activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
ALTER TABLE public.activities ADD CONSTRAINT activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
ALTER TABLE public.activities ADD CONSTRAINT activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
ALTER TABLE public.activities ADD CONSTRAINT activities_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
ALTER TABLE public.portal_access_links ADD CONSTRAINT portal_access_links_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
ALTER TABLE public.portal_access_links ADD CONSTRAINT portal_access_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.property_owners(id) ON DELETE CASCADE;
ALTER TABLE public.property_consignments ADD CONSTRAINT property_consignments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;
ALTER TABLE public.property_consignments ADD CONSTRAINT property_consignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE RESTRICT;
ALTER TABLE public.property_consignments ADD CONSTRAINT property_consignments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;
ALTER TABLE public.property_private_photos ADD CONSTRAINT property_private_photos_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
CREATE TABLE public.property_ownerships (
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
 ownership_percentage numeric NOT NULL DEFAULT 100 CHECK (ownership_percentage>0 AND ownership_percentage<=100),
 is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY(property_id,owner_id)
);


-- Exact two REVIEW_ONLY candidate files under ONE uncommitted transaction.
-- If either candidate fails, ON_ERROR_STOP aborts and Postgres rolls back.
\ir ../candidates/g08_scoped_16_relationships_REVIEW_ONLY.sql
\ir ../candidates/g08_ownership_link_tenant_guard_REVIEW_ONLY.sql

DO $verify$
DECLARE
 org_a uuid:=gen_random_uuid();
 org_b uuid:=gen_random_uuid();
 prop_a uuid;
 owner_a uuid;
 owner_b uuid;
 contact_b uuid;
 total_fks int;
 total_guard_triggers int;
 denied boolean;
BEGIN
 SELECT count(*) INTO total_fks FROM pg_constraint c
  WHERE c.convalidated AND c.contype='f'
   AND c.conname=ANY(ARRAY[
'leads_contact_id_fkey','leads_property_id_fkey',
'activities_contact_id_fkey','activities_deal_id_fkey',
'activities_lead_id_fkey','activities_property_id_fkey',
'appointments_contact_id_fkey','appointments_lead_id_fkey',
'appointments_property_id_fkey','commissions_deal_id_fkey',
'portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey',
'property_consignments_contact_id_fkey','property_consignments_lead_id_fkey',
'property_consignments_property_id_fkey','property_private_photos_property_id_fkey'])
   AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (organization_id, %';
 IF total_fks<>16 THEN
  RAISE EXCEPTION 'G08 combined NO-GO: expected 16 validated composite FK, got %',total_fks;
 END IF;
 SELECT count(*) INTO total_guard_triggers FROM pg_trigger t
 WHERE t.tgname IN ('enforce_property_ownership_same_tenant',
                  'prevent_property_link_tenant_reassignment',
                  'prevent_owner_link_tenant_reassignment')
    AND t.tgenabled='O' AND NOT t.tgisinternal;
 IF total_guard_triggers<>3 THEN
  RAISE EXCEPTION 'G08 combined NO-GO: missing ownership triggers';
 END IF;

 INSERT INTO public.organizations VALUES(org_a,'ACTIVE'),(org_b,'ACTIVE');
 INSERT INTO public.properties(organization_id) VALUES(org_a) RETURNING id INTO prop_a;
 INSERT INTO public.property_owners(organization_id) VALUES(org_a) RETURNING id INTO owner_a;
 INSERT INTO public.property_owners(organization_id) VALUES(org_b) RETURNING id INTO owner_b;
 INSERT INTO public.contacts(organization_id) VALUES(org_b) RETURNING id INTO contact_b;
 INSERT INTO public.property_ownerships(property_id,owner_id,ownership_percentage)
  VALUES(prop_a,owner_a,100);
 denied:=false;
 BEGIN
   INSERT INTO public.property_ownerships(property_id,owner_id,ownership_percentage)
      VALUES(prop_a,owner_b,100);
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'G08 combined NO-GO: cross-tenant ownership accepted'; END IF;

 denied:=false;
 BEGIN
   UPDATE public.properties SET organization_id=org_b WHERE id=prop_a;
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'G08 combined NO-GO: reassignment of linked property accepted'; END IF;

 denied:=false;
 BEGIN
   INSERT INTO public.leads(organization_id,contact_id) VALUES(org_a,contact_b);
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'G08 combined NO-GO: cross-tenant lead accepted'; END IF;

 -- Confirm the guard functions remain inaccessible to anonymous callers.
 IF has_function_privilege('anon','jco_private.enforce_ownership_same_tenant()','EXECUTE')
 OR has_function_privilege('authenticated','jco_private.prevent_ownership_parent_reassignment()','EXECUTE')
 THEN RAISE EXCEPTION 'G08 combined NO-GO: privilege drift'; END IF;
 RAISE NOTICE 'G08 ATOMIC DRY-RUN PASS: 16 scoped FK and 3 guards; foreign tenant denied';
END $verify$;

-- Intentional successful rollback. No changes persist even in the isolated DB.
ROLLBACK;
DO $rolled_back$
BEGIN
 IF to_regclass('public.property_ownerships') IS NOT NULL
 OR to_regclass('public.leads') IS NOT NULL
 OR to_regprocedure('jco_private.enforce_ownership_same_tenant()') IS NOT NULL
 THEN RAISE EXCEPTION 'G08 dry-run did not roll back all candidate DDL'; END IF;
 RAISE NOTICE 'G08 ATOMIC ROLLBACK PASS: no candidate or fixture DDL persisted';
END $rolled_back$;
