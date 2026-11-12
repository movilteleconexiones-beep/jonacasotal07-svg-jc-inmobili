-- G08 #91 isolated PostgreSQL 17 fixture. Nothing runs on Supabase production.
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

CREATE TABLE public.property_ownerships(
  property_id uuid NOT NULL REFERENCES public.properties(id),
  owner_id uuid NOT NULL REFERENCES public.property_owners(id),
  PRIMARY KEY(property_id,owner_id)
);
INSERT INTO public.organizations(id,status) VALUES
  ('11111111-1111-1111-1111-111111111111','ACTIVE'),
  ('22222222-2222-2222-2222-222222222222','ACTIVE');
INSERT INTO public.contacts(id,organization_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','22222222-2222-2222-2222-222222222222');
INSERT INTO public.properties(id,organization_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','11111111-1111-1111-1111-111111111111');
INSERT INTO public.property_owners(id,organization_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4','11111111-1111-1111-1111-111111111111');
INSERT INTO public.property_ownerships(property_id,owner_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
INSERT INTO public.leads(id,organization_id,contact_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
