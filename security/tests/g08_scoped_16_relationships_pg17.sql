-- G08 #91 isolated PostgreSQL 17 fixture. Nothing runs on Supabase production.
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
\ir ../candidates/g08_scoped_16_relationships_REVIEW_ONLY.sql
DO $run$
DECLARE v_org_a uuid:=gen_random_uuid();v_org_b uuid:=gen_random_uuid();
  ca uuid;cb uuid;pa uuid;pb uuid;oa uuid;ob uuid;la uuid;lb uuid;da uuid;db uuid;invalid boolean;
  c record; v_ref uuid; v_own uuid; v_rows int:=0; v_fk_count int;
BEGIN
 INSERT INTO public.organizations VALUES (v_org_a,'ACTIVE'),(v_org_b,'ACTIVE');
 INSERT INTO public.contacts(organization_id) VALUES(v_org_a) RETURNING id INTO ca;
 INSERT INTO public.contacts(organization_id) VALUES(v_org_b) RETURNING id INTO cb;
 INSERT INTO public.properties(organization_id) VALUES(v_org_a) RETURNING id INTO pa;
 INSERT INTO public.properties(organization_id) VALUES(v_org_b) RETURNING id INTO pb;
 INSERT INTO public.property_owners(organization_id) VALUES(v_org_a) RETURNING id INTO oa;
 INSERT INTO public.property_owners(organization_id) VALUES(v_org_b) RETURNING id INTO ob;
 INSERT INTO public.deals(organization_id) VALUES(v_org_a) RETURNING id INTO da;
 INSERT INTO public.deals(organization_id) VALUES(v_org_b) RETURNING id INTO db;
 INSERT INTO public.leads(organization_id) VALUES(v_org_a) RETURNING id INTO la;
 INSERT INTO public.leads(organization_id) VALUES(v_org_b) RETURNING id INTO lb;
 FOR c IN SELECT * FROM (VALUES
  ('leads','contact_id','contacts'),
  ('leads','property_id','properties'),
  ('activities','contact_id','contacts'),
  ('activities','deal_id','deals'),
  ('activities','lead_id','leads'),
  ('activities','property_id','properties'),
  ('appointments','contact_id','contacts'),
  ('appointments','lead_id','leads'),
  ('appointments','property_id','properties'),
  ('commissions','deal_id','deals'),
  ('portal_access_links','contact_id','contacts'),
  ('portal_access_links','owner_id','property_owners'),
  ('property_consignments','contact_id','contacts'),
  ('property_consignments','lead_id','leads'),
  ('property_consignments','property_id','properties'),
  ('property_private_photos','property_id','properties')
  ) AS config(child_table,foreign_column,parent_table)
 LOOP
  v_ref:=CASE c.parent_table WHEN 'contacts' THEN cb WHEN 'properties' THEN pb WHEN 'property_owners' THEN ob WHEN 'leads' THEN lb WHEN 'deals' THEN db END;
  v_own:=CASE c.parent_table WHEN 'contacts' THEN ca WHEN 'properties' THEN pa WHEN 'property_owners' THEN oa WHEN 'leads' THEN la WHEN 'deals' THEN da END;
  EXECUTE format('INSERT INTO public.%I (organization_id,%I) VALUES ($1,$2)',c.child_table,c.foreign_column) USING v_org_a,v_own;
  invalid:=false;
  BEGIN
   EXECUTE format('INSERT INTO public.%I (organization_id,%I) VALUES ($1,$2)',c.child_table,c.foreign_column) USING v_org_a,v_ref;
  EXCEPTION WHEN foreign_key_violation THEN invalid:=true; END;
  IF NOT invalid THEN RAISE EXCEPTION 'G08 cross-tenant INSERT accepted %.%',c.child_table,c.foreign_column; END IF;
  v_rows:=v_rows+1;
 END LOOP;
 IF v_rows<>16 THEN RAISE EXCEPTION 'Expected sixteen cross-tenant insert checks'; END IF;

 -- NULL-on-delete of composite FK must not erase required organization_id.
 INSERT INTO public.contacts(organization_id) VALUES(v_org_a) RETURNING id INTO ca;
 INSERT INTO public.appointments(organization_id,contact_id) VALUES(v_org_a,ca);
 DELETE FROM public.contacts WHERE id=ca;
 IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE organization_id=v_org_a AND contact_id IS NULL)
 THEN RAISE EXCEPTION 'ON DELETE SET NULL failed to preserve tenant'; END IF;

 -- RESTRICT must block deletion when a consignment refers to a property.
 INSERT INTO public.properties(organization_id) VALUES(v_org_a) RETURNING id INTO pa;
 INSERT INTO public.property_consignments(organization_id,property_id) VALUES(v_org_a,pa);
 invalid:=false;
 BEGIN DELETE FROM public.properties WHERE id=pa;
 EXCEPTION WHEN foreign_key_violation THEN invalid:=true; END;
 IF NOT invalid THEN RAISE EXCEPTION 'RESTRICT on consignment property was lost'; END IF;

 SELECT count(*) INTO v_fk_count FROM pg_constraint WHERE convalidated AND contype='f'
 AND conname=ANY(ARRAY['leads_contact_id_fkey','leads_property_id_fkey','activities_contact_id_fkey','activities_deal_id_fkey','activities_lead_id_fkey','activities_property_id_fkey','appointments_contact_id_fkey','appointments_lead_id_fkey','appointments_property_id_fkey','commissions_deal_id_fkey','portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey','property_consignments_contact_id_fkey','property_consignments_lead_id_fkey','property_consignments_property_id_fkey','property_private_photos_property_id_fkey'])
 AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id, %';
 IF v_fk_count<>16 THEN RAISE EXCEPTION 'G08 16 scoped FKs were not preserved'; END IF;
END $run$;
ROLLBACK;
