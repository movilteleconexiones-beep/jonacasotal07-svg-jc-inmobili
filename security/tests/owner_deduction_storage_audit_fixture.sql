-- SQL fixture for isolated PostgreSQL 17 only. NEVER run on production.
CREATE SCHEMA storage;
CREATE TABLE storage.objects (
  bucket_id text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (bucket_id, name)
);
CREATE TABLE public.documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_id uuid,
  entity_type text NOT NULL,
  document_type text NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid
);
-- Valid PDFs for two independent agencies.
INSERT INTO storage.objects(bucket_id,name) VALUES
('organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/invoice/55555555-5555-4555-8555-555555555555.pdf'),
('organization-documents','22222222-2222-4222-8222-222222222222/owner-deductions/44444444-4444-4444-8444-444444444444/payment/66666666-6666-4666-8666-666666666666.pdf'),
-- Orphaned valid Storage object, malformed Storage path and object mislinked by tenant.
('organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/invoice/77777777-7777-4777-8777-777777777777.pdf'),
('organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/not-a-uuid/invoice/err.pdf'),
('organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/payment/88888888-8888-4888-8888-888888888888.pdf');
INSERT INTO public.documents VALUES
('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','GENERAL','INVOICE','organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/invoice/55555555-5555-4555-8555-555555555555.pdf','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('00000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','GENERAL','INVOICE','organization-documents','22222222-2222-4222-8222-222222222222/owner-deductions/44444444-4444-4444-8444-444444444444/payment/66666666-6666-4666-8666-666666666666.pdf','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
-- Metadata referencing missing Storage.
('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','GENERAL','INVOICE','organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/payment/99999999-9999-4999-8999-999999999999.pdf','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
-- Mislinked: document tenant does not match Storage path's tenant.
('00000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','GENERAL','INVOICE','organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/payment/88888888-8888-4888-8888-888888888888.pdf','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
-- Duplicate documents rows for one physical private object.
('00000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','GENERAL','INVOICE','organization-documents','11111111-1111-4111-8111-111111111111/owner-deductions/33333333-3333-4333-8333-333333333333/invoice/55555555-5555-4555-8555-555555555555.pdf','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
