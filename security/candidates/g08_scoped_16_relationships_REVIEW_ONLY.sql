-- INMOJCO G08 / #91: staged ONLY; do not apply on production before isolated PG17 and PostgREST acceptance.
-- 16 tenant-scoped relationships; preserve original FK names and deletion behavior.
-- Notice: PostgreSQL 17 supports ON DELETE SET NULL (only_target_column) in composite FK.
SET LOCAL statement_timeout='35s';
SET LOCAL lock_timeout='3s';
DO $preflight$
DECLARE v_rec record; v_actual text; v_cross bigint;
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Only postgres migration executor'; END IF;
 IF EXISTS (SELECT 1 FROM public.organizations WHERE status NOT IN ('ACTIVE','INACTIVE'))
 THEN RAISE EXCEPTION 'Unexpected organization status'; END IF;
 FOR v_rec IN SELECT * FROM (VALUES
  ('leads','contact_id','contacts','CASCADE','leads_contact_id_fkey'),
  ('leads','property_id','properties','SET NULL (property_id)','leads_property_id_fkey'),
  ('activities','contact_id','contacts','CASCADE','activities_contact_id_fkey'),
  ('activities','deal_id','deals','CASCADE','activities_deal_id_fkey'),
  ('activities','lead_id','leads','CASCADE','activities_lead_id_fkey'),
  ('activities','property_id','properties','CASCADE','activities_property_id_fkey'),
  ('appointments','contact_id','contacts','SET NULL (contact_id)','appointments_contact_id_fkey'),
  ('appointments','lead_id','leads','SET NULL (lead_id)','appointments_lead_id_fkey'),
  ('appointments','property_id','properties','SET NULL (property_id)','appointments_property_id_fkey'),
  ('commissions','deal_id','deals','CASCADE','commissions_deal_id_fkey'),
  ('portal_access_links','contact_id','contacts','CASCADE','portal_access_links_contact_id_fkey'),
  ('portal_access_links','owner_id','property_owners','CASCADE','portal_access_links_owner_id_fkey'),
  ('property_consignments','contact_id','contacts','RESTRICT','property_consignments_contact_id_fkey'),
  ('property_consignments','lead_id','leads','RESTRICT','property_consignments_lead_id_fkey'),
  ('property_consignments','property_id','properties','RESTRICT','property_consignments_property_id_fkey'),
  ('property_private_photos','property_id','properties','CASCADE','property_private_photos_property_id_fkey')
 ) AS f(child_table,link_column,parent_table,delete_rule,fk_name)
 LOOP
   SELECT pg_get_constraintdef(c.oid) INTO v_actual FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.'||v_rec.child_table) AND c.conname=v_rec.fk_name AND c.contype='f';
   IF v_actual IS NULL OR
      v_actual NOT LIKE 'FOREIGN KEY ('||v_rec.link_column||') REFERENCES '||v_rec.parent_table||'(id) ON DELETE %'
   THEN RAISE EXCEPTION 'FK changed for %.%: %',v_rec.child_table,v_rec.link_column,v_actual; END IF;
   EXECUTE format(
      'SELECT count(*) FROM public.%I c JOIN public.%I p ON p.id=c.%I WHERE c.organization_id IS DISTINCT FROM p.organization_id',
      v_rec.child_table,v_rec.parent_table,v_rec.link_column
   ) INTO v_cross;
   IF v_cross<>0 THEN RAISE EXCEPTION 'Cross-tenant data already present: %.% % rows',v_rec.child_table,v_rec.link_column,v_cross; END IF;
 END LOOP;
END $preflight$;

-- Unique pair keys for parents previously exposed only by id.
ALTER TABLE public.leads ADD CONSTRAINT leads_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.deals ADD CONSTRAINT deals_tenant_id_unique UNIQUE (organization_id,id);

ALTER TABLE public.leads
  DROP CONSTRAINT leads_contact_id_fkey;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_contact_id_fkey
    FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.leads
  DROP CONSTRAINT leads_property_id_fkey;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_property_id_fkey
    FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
    ON DELETE SET NULL (property_id);

ALTER TABLE public.activities
  DROP CONSTRAINT activities_contact_id_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_contact_id_fkey
    FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.activities
  DROP CONSTRAINT activities_deal_id_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_deal_id_fkey
    FOREIGN KEY (organization_id,deal_id) REFERENCES public.deals(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.activities
  DROP CONSTRAINT activities_lead_id_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_lead_id_fkey
    FOREIGN KEY (organization_id,lead_id) REFERENCES public.leads(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.activities
  DROP CONSTRAINT activities_property_id_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_property_id_fkey
    FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.appointments
  DROP CONSTRAINT appointments_contact_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_contact_id_fkey
    FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
    ON DELETE SET NULL (contact_id);

ALTER TABLE public.appointments
  DROP CONSTRAINT appointments_lead_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_lead_id_fkey
    FOREIGN KEY (organization_id,lead_id) REFERENCES public.leads(organization_id,id)
    ON DELETE SET NULL (lead_id);

ALTER TABLE public.appointments
  DROP CONSTRAINT appointments_property_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_property_id_fkey
    FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
    ON DELETE SET NULL (property_id);

ALTER TABLE public.commissions
  DROP CONSTRAINT commissions_deal_id_fkey;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_deal_id_fkey
    FOREIGN KEY (organization_id,deal_id) REFERENCES public.deals(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.portal_access_links
  DROP CONSTRAINT portal_access_links_contact_id_fkey;
ALTER TABLE public.portal_access_links
  ADD CONSTRAINT portal_access_links_contact_id_fkey
    FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.portal_access_links
  DROP CONSTRAINT portal_access_links_owner_id_fkey;
ALTER TABLE public.portal_access_links
  ADD CONSTRAINT portal_access_links_owner_id_fkey
    FOREIGN KEY (organization_id,owner_id) REFERENCES public.property_owners(organization_id,id)
    ON DELETE CASCADE;

ALTER TABLE public.property_consignments
  DROP CONSTRAINT property_consignments_contact_id_fkey;
ALTER TABLE public.property_consignments
  ADD CONSTRAINT property_consignments_contact_id_fkey
    FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
    ON DELETE RESTRICT;

ALTER TABLE public.property_consignments
  DROP CONSTRAINT property_consignments_lead_id_fkey;
ALTER TABLE public.property_consignments
  ADD CONSTRAINT property_consignments_lead_id_fkey
    FOREIGN KEY (organization_id,lead_id) REFERENCES public.leads(organization_id,id)
    ON DELETE RESTRICT;

ALTER TABLE public.property_consignments
  DROP CONSTRAINT property_consignments_property_id_fkey;
ALTER TABLE public.property_consignments
  ADD CONSTRAINT property_consignments_property_id_fkey
    FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
    ON DELETE RESTRICT;

ALTER TABLE public.property_private_photos
  DROP CONSTRAINT property_private_photos_property_id_fkey;
ALTER TABLE public.property_private_photos
  ADD CONSTRAINT property_private_photos_property_id_fkey
    FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
    ON DELETE CASCADE;


DO $postflight$
DECLARE v_count int;
BEGIN
 SELECT count(*) INTO v_count FROM pg_constraint c
 WHERE c.contype='f'
 AND c.conname = ANY(ARRAY['leads_contact_id_fkey','leads_property_id_fkey','activities_contact_id_fkey','activities_deal_id_fkey','activities_lead_id_fkey','activities_property_id_fkey','appointments_contact_id_fkey','appointments_lead_id_fkey','appointments_property_id_fkey','commissions_deal_id_fkey','portal_access_links_contact_id_fkey','portal_access_links_owner_id_fkey','property_consignments_contact_id_fkey','property_consignments_lead_id_fkey','property_consignments_property_id_fkey','property_private_photos_property_id_fkey'])
 AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (organization_id, %';
 IF v_count<>16 THEN RAISE EXCEPTION 'Expected 16 validated tenant FKs, got %',v_count; END IF;
END $postflight$;
