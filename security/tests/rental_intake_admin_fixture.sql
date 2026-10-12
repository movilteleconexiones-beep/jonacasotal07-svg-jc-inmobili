-- Additional isolated objects required for the guided onboarding release gate.
-- No production identifiers are used.
CREATE TABLE public.roles (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, key text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.permissions (id uuid PRIMARY KEY,key text NOT NULL UNIQUE);
CREATE TABLE public.role_permissions (
 role_id uuid NOT NULL,permission_id uuid NOT NULL,PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE public.organization_members (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,status text NOT NULL
);
CREATE TABLE public.member_roles (
 organization_member_id uuid NOT NULL,role_id uuid NOT NULL,
 PRIMARY KEY(organization_member_id,role_id)
);
CREATE TABLE public.documents (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,
 entity_type text NOT NULL,entity_id uuid,document_type text NOT NULL,
 storage_bucket text NOT NULL,storage_path text NOT NULL,mime_type text NOT NULL
);
CREATE SCHEMA storage;
CREATE TABLE storage.objects (bucket_id text NOT NULL,name text NOT NULL,PRIMARY KEY(bucket_id,name));

INSERT INTO public.roles(id,organization_id,key) VALUES
 ('a1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','ADMIN'),
 ('a1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','AGENT');
INSERT INTO public.permissions(id,key) VALUES
 ('b1000000-0000-4000-8000-000000000001','leases.view'),
 ('b1000000-0000-4000-8000-000000000002','leases.create'),
 ('b1000000-0000-4000-8000-000000000003','leases.edit');
INSERT INTO public.role_permissions(role_id,permission_id) VALUES
 ('a1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003');
INSERT INTO public.organization_members(id,organization_id,user_id,status) VALUES
 ('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001','ACTIVE'),
 ('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000002','ACTIVE');
INSERT INTO public.member_roles(organization_member_id,role_id) VALUES
 ('c1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001'),
 ('c1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');

-- The real Supabase storage and documents tables have policies.
-- Here SQL tests validate the trigger's business constraints in isolation.
