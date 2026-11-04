-- Proof on synthetic data: RLS controls which agency row a staff member writes,
-- but legacy single-column foreign keys do not bind linked records to that agency.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $pre$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contacts
   WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
   RAISE EXCEPTION 'Bad fixture: staff can already read beta contact';
 END IF;
END $pre$;
INSERT INTO public.leads(id,organization_id,contact_id,property_id) VALUES (
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '11111111-1111-4111-8111-111111111111',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'bbbbbbbb-0000-4000-8000-000000000002');
COMMIT;

-- Privileged existing review RPCs also need a database integrity boundary.
INSERT INTO public.property_consignments(id,organization_id,contact_id,lead_id,property_id)
VALUES (
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 '11111111-1111-4111-8111-111111111111',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'bbbbbbbb-2222-4222-8222-222222222222',
 'bbbbbbbb-0000-4000-8000-000000000002');

DO $pre$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
  WHERE l.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    AND l.organization_id<>c.organization_id
 ) OR NOT EXISTS(
  SELECT 1 FROM public.property_consignments pc
  JOIN public.leads l ON l.id=pc.lead_id
  WHERE pc.id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    AND pc.organization_id<>l.organization_id
 ) THEN RAISE EXCEPTION 'Single-column cross-agency weakness was not reproduced'; END IF;
END $pre$;
SELECT 'PASS: isolated legacy CRM links can cross tenants despite agency RLS' AS result;
