-- Remove intentionally invalid synthetic rows BEFORE applying candidate FK.
DELETE FROM public.property_consignments
WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DELETE FROM public.leads
WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $clean$
BEGIN
 IF EXISTS(SELECT 1 FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
           WHERE l.organization_id<>c.organization_id)
 OR EXISTS(SELECT 1 FROM public.property_consignments pc JOIN public.leads l ON pc.lead_id=l.id
           WHERE pc.organization_id<>l.organization_id) THEN
   RAISE EXCEPTION 'Fixture cleanup failed';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname LIKE 'jco_%_org_%_fk') OR
 EXISTS(SELECT 1 FROM pg_catalog.pg_indexes WHERE indexname='jco_leads_org_id_contact_fk_key') THEN
   RAISE EXCEPTION 'Failed SQL candidate left partial DDL';
 END IF;
END $clean$;
