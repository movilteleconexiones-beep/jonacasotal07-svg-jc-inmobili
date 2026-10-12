-- Minimal, isolated PostgreSQL 17 fixture; no live data or user accounts.
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.contacts(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL
);
CREATE TABLE public.properties(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL
);
CREATE TABLE public.leads(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  property_id uuid,
  CONSTRAINT leads_contact_id_fkey FOREIGN KEY(contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT leads_property_id_fkey FOREIGN KEY(property_id) REFERENCES public.properties(id) ON DELETE SET NULL
);
CREATE TABLE public.deals(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  contact_id uuid NOT NULL, property_id uuid NOT NULL,
  CONSTRAINT deals_contact_id_fkey FOREIGN KEY(contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT,
  CONSTRAINT deals_property_id_fkey FOREIGN KEY(property_id) REFERENCES public.properties(id) ON DELETE RESTRICT
);
CREATE TABLE public.commissions(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  CONSTRAINT commissions_deal_id_fkey FOREIGN KEY(deal_id) REFERENCES public.deals(id) ON DELETE CASCADE
);
INSERT INTO public.contacts(id,organization_id) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO public.properties(id,organization_id) VALUES
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111');
