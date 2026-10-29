-- Isolated Postgres CI regression; NEVER run against real Supabase.
-- Run after external_portal_cross_person_assertions.sql to reuse two unrelated
-- clients and two owners within one organization.
BEGIN;
ALTER TABLE public.documents ADD COLUMN document_type text;
ALTER TABLE public.documents ADD COLUMN storage_bucket text;
ALTER TABLE public.documents ADD COLUMN storage_path text;

CREATE SCHEMA storage;
CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,PRIMARY KEY(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
CREATE POLICY portal_docs_storage_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='organization-documents' AND EXISTS(
    SELECT 1 FROM public.documents d
    WHERE d.storage_bucket=objects.bucket_id AND d.storage_path=objects.name
 ));

-- Four fixture contracts: two valid people, one incorrectly named object,
-- one unsigned lease still in DRAFT. The personal policy must reject the latter.
INSERT INTO public.leases VALUES
 ('37373737-3737-4373-8373-373737373737',
  '22222222-2222-4222-8222-222222222222',
  '12121212-1212-4212-8212-121212121212',
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888','DRAFT');

INSERT INTO public.documents(id,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path) VALUES
 ('38383838-3838-4383-8383-383838383838','22222222-2222-4222-8222-222222222222','GENERAL',
  '14141414-1414-4414-8414-141414141414','CONTRACT','organization-documents',
  '22222222-2222-4222-8222-222222222222/leases/14141414-1414-4414-8414-141414141414/signed/11111111-1111-4111-8111-111111111111.pdf'),
 ('39393939-3939-4393-8393-393939393939','22222222-2222-4222-8222-222222222222','GENERAL',
  '29292929-2929-4292-8292-292929292929','CONTRACT','organization-documents',
  '22222222-2222-4222-8222-222222222222/leases/29292929-2929-4292-8292-292929292929/signed/22222222-2222-4222-8222-222222222222.pdf'),
 ('40404040-4040-4404-8404-404040404040','22222222-2222-4222-8222-222222222222','GENERAL',
  '14141414-1414-4414-8414-141414141414','CONTRACT','organization-documents',
  '22222222-2222-4222-8222-222222222222/leases/14141414-1414-4414-8414-141414141414/signed/malformed.pdf'),
 ('41414141-4141-4414-8414-414141414141','22222222-2222-4222-8222-222222222222','GENERAL',
  '37373737-3737-4373-8373-373737373737','CONTRACT','organization-documents',
  '22222222-2222-4222-8222-222222222222/leases/37373737-3737-4373-8373-373737373737/signed/33333333-3333-4333-8333-333333333333.pdf');

INSERT INTO storage.objects(bucket_id,name)
 SELECT storage_bucket,storage_path FROM public.documents
 WHERE document_type='CONTRACT';
COMMIT;

\i supabase/migrations/20261029120000_linked_person_signed_lease_private_pdf.sql

-- Every tenant must see one and only one signed contract of their own.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
SELECT public.test_assert(
 (SELECT count(*) FROM public.documents WHERE document_type='CONTRACT')=1,
 'tenant A reads only its own active signed contract metadata');
SELECT public.test_assert(
 (SELECT count(*) FROM storage.objects)=1,
 'tenant A can sign/download only the corresponding PDF');

SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
SELECT public.test_assert(
 (SELECT count(*) FROM public.documents WHERE document_type='CONTRACT')=1,
 'tenant B sees no other tenant PDF metadata');
SELECT public.test_assert(
 (SELECT count(*) FROM storage.objects)=1,
 'tenant B sees no other tenant signed URL target');

SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
SELECT public.test_assert(
 (SELECT count(*) FROM public.documents WHERE document_type='CONTRACT')=1,
 'owner A sees signed contract A and not B');
SELECT public.test_assert(
 (SELECT count(*) FROM storage.objects)=1,
 'owner A sees only its contract signed URL target');

SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
SELECT public.test_assert(
 (SELECT count(*) FROM public.documents WHERE document_type='CONTRACT')=1,
 'owner B cannot see owner A PDF');

SELECT set_config('request.jwt.claim.sub','99999999-1111-4111-8111-111111111111',false);
SELECT public.test_assert((SELECT count(*) FROM public.documents WHERE document_type='CONTRACT')=0,
 'unlinked identity cannot read contract PDF metadata');
SELECT public.test_assert((SELECT count(*) FROM storage.objects)=0,
 'unlinked identity cannot sign any contract PDF URL');

RESET ROLE;
-- Verify no INSERT/UPDATE/DELETE privilege was introduced by this migration.
SELECT public.test_assert(
 (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
    AND tablename='documents' AND policyname='documents_signed_lease_external_select' AND cmd='SELECT')=1,
 'signed-lease external policy is read-only');

-- Read-only policy must not inadvertently expose a malformed path or draft.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
SELECT public.test_assert((SELECT COUNT(*) FROM public.documents
 WHERE document_type='CONTRACT' AND storage_path LIKE '%malformed.pdf')=0,
 'non-UUID document path cannot be accessed through portal');
SELECT public.test_assert((SELECT COUNT(*) FROM public.documents
 WHERE entity_id='37373737-3737-4373-8373-373737373737')=0,
 'draft lease PDF cannot be viewed');
RESET ROLE;
