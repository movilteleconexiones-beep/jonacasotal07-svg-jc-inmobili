-- Combined fake PostgreSQL fixture for agency catalog + custom brand migration.
-- Run after public_agency_catalog_fixture.sql, never on production.
-- The catalog fixture already created the jco_private schema and staff helper.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(
 id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,
 allowed_mime_types text[]
);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT ALL ON storage.buckets TO authenticated,service_role;

-- The real staff helper checks edit permission. Give B equivalent own-agency
-- permissions for the integration test, without granting B access to A.
INSERT INTO public.consignment_test_permissions(user_id,organization_id,permission_key)
VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222','properties.edit'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222','settings.view'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222','settings.edit');
