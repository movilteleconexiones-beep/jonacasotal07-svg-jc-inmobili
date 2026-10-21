-- Artificial table fixture: never execute against Supabase production.
CREATE TABLE public.deals(id uuid PRIMARY KEY, organization_id uuid NOT NULL, contact_id uuid, property_id uuid);
CREATE TABLE public.maintenance_requests(id uuid PRIMARY KEY, organization_id uuid NOT NULL);
CREATE TABLE public.portal_access_links(id uuid PRIMARY KEY, contact_id uuid, owner_id uuid);
