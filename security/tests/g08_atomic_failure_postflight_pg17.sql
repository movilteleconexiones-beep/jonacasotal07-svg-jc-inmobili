\set ON_ERROR_STOP on
-- Read-only post-failure assertions. The entire DDL group must roll back.
BEGIN READ ONLY;
DO $rollback_assert$
DECLARE
 original_fk int;
 scoped_fk int;
 unique_fk int;
 owner_guards int;
 crossed int;
BEGIN
 SELECT count(*) INTO original_fk FROM pg_constraint c WHERE
    c.contype='f' AND c.conname=ANY(ARRAY[
'leads_contact_id_fkey','leads_property_id_fkey',
'activities_contact_id_fkey','activities_deal_id_fkey',
'activities_lead_id_fkey','activities_property_id_fkey',
'appointments_contact_id_fkey','appointments_lead_id_fkey',
'appointments_property_id_fkey','commissions_deal_id_fkey',
'portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey',
'property_consignments_contact_id_fkey','property_consignments_lead_id_fkey',
'property_consignments_property_id_fkey','property_private_photos_property_id_fkey'])
    AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (%';
 SELECT count(*) INTO scoped_fk FROM pg_constraint c WHERE
    c.contype='f' AND c.conname=ANY(ARRAY[
'leads_contact_id_fkey','leads_property_id_fkey',
'activities_contact_id_fkey','activities_deal_id_fkey',
'activities_lead_id_fkey','activities_property_id_fkey',
'appointments_contact_id_fkey','appointments_lead_id_fkey',
'appointments_property_id_fkey','commissions_deal_id_fkey',
'portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey',
'property_consignments_contact_id_fkey','property_consignments_lead_id_fkey',
'property_consignments_property_id_fkey','property_private_photos_property_id_fkey'])
    AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (organization_id, %';
 SELECT count(*) INTO unique_fk FROM pg_constraint c WHERE
    c.conname IN ('leads_tenant_id_unique','deals_tenant_id_unique');
 SELECT count(*) INTO owner_guards FROM pg_trigger t WHERE
  t.tgname IN ('enforce_property_ownership_same_tenant',
    'prevent_property_link_tenant_reassignment',
    'prevent_owner_link_tenant_reassignment') AND NOT t.tgisinternal;
 SELECT count(*) INTO crossed FROM public.property_ownerships l
 JOIN public.properties p ON p.id=l.property_id
 JOIN public.property_owners o ON o.id=l.owner_id
 WHERE p.organization_id IS DISTINCT FROM o.organization_id;

 IF original_fk<>16 OR scoped_fk<>0 OR unique_fk<>0 OR owner_guards<>0 OR crossed<>1
 OR to_regprocedure('jco_private.enforce_ownership_same_tenant()') IS NOT NULL
 THEN
  RAISE EXCEPTION
   'G08 NO-GO: failed migration left partial DDL: legacy %, scoped %, unique %, guards %, bad_data %',
   original_fk,scoped_fk,unique_fk,owner_guards,crossed;
 END IF;
 RAISE NOTICE 'G08 NEGATIVE ATOMICITY PASS: second candidate rejected and all legacy FKs restored';
END $rollback_assert$;
ROLLBACK;
