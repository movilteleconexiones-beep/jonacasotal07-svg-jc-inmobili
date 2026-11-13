-- G11 | 13 Nov 2026 | PostgreSQL 17 FK-coverage indexes for CRM, Agenda, finance, intake.
-- SOURCE: current Supabase Performance Advisor and pg_constraint in official production.
-- Conservative non-unique B-tree indexes: no changes to RLS, FK, data, roles, billing or auth.
-- Runs in ONE transaction with lock/statement timeouts. With large tables use a
-- separately reviewed CONCURRENTLY rollout; these small pre-launch tables are safe.
-- Never apply via supabase db push because canonical migration inventory #104 is frozen.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $preflight$
DECLARE
  v_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only trusted migration executor may add indexes';
  END IF;
  SELECT count(*) INTO v_count
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE c.contype='f' AND (c.conname,n.nspname||'.'||t.relname) IN (VALUES
    ('website_lead_consents_tenant_lead_fk','private.website_lead_consents'),
    ('activities_contact_id_fkey','public.activities'),
    ('activities_deal_id_fkey','public.activities'),
    ('activities_lead_id_fkey','public.activities'),
    ('activities_property_id_fkey','public.activities'),
    ('appointments_contact_id_fkey','public.appointments'),
    ('appointments_lead_id_fkey','public.appointments'),
    ('appointments_property_id_fkey','public.appointments'),
    ('commissions_deal_id_fkey','public.commissions'),
    ('leads_contact_id_fkey','public.leads'),
    ('leads_property_id_fkey','public.leads'),
    ('maintenance_requests_property_id_fkey','public.maintenance_requests'),
    ('portal_access_links_contact_id_fkey','public.portal_access_links'),
    ('portal_access_links_owner_id_fkey','public.portal_access_links'),
    ('property_consignments_contact_id_fkey','public.property_consignments'),
    ('property_consignments_lead_id_fkey','public.property_consignments'),
    ('property_consignments_property_id_fkey','public.property_consignments')
  );
  IF v_count<>17 THEN
    RAISE EXCEPTION 'Expected 17 tenant-scoped FKs, found %',v_count;
  END IF;
END $preflight$;

CREATE INDEX IF NOT EXISTS g11_idx_private_lead_consents_tenant_lead ON private.website_lead_consents (organization_id, lead_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_activities_tenant_contact ON public.activities (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_activities_tenant_deal ON public.activities (organization_id, deal_id);
CREATE INDEX IF NOT EXISTS g11_idx_activities_tenant_lead ON public.activities (organization_id, lead_id);
CREATE INDEX IF NOT EXISTS g11_idx_activities_tenant_property ON public.activities (organization_id, property_id);
CREATE INDEX IF NOT EXISTS g11_idx_appointments_tenant_contact ON public.appointments (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_appointments_tenant_lead ON public.appointments (organization_id, lead_id);
CREATE INDEX IF NOT EXISTS g11_idx_appointments_tenant_property ON public.appointments (organization_id, property_id);
CREATE INDEX IF NOT EXISTS g11_idx_commissions_tenant_deal ON public.commissions (organization_id, deal_id);
CREATE INDEX IF NOT EXISTS g11_idx_leads_tenant_contact ON public.leads (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_leads_tenant_property ON public.leads (organization_id, property_id);
CREATE INDEX IF NOT EXISTS g11_idx_maintenance_tenant_property ON public.maintenance_requests (organization_id, property_id);
CREATE INDEX IF NOT EXISTS g11_idx_portal_links_tenant_contact ON public.portal_access_links (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_portal_links_tenant_owner ON public.portal_access_links (organization_id, owner_id);
CREATE INDEX IF NOT EXISTS g11_idx_consignments_tenant_contact ON public.property_consignments (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS g11_idx_consignments_tenant_lead ON public.property_consignments (organization_id, lead_id);
CREATE INDEX IF NOT EXISTS g11_idx_consignments_tenant_property ON public.property_consignments (organization_id, property_id);

DO $postflight$
DECLARE v_total int;v_verified int;v_missing text;
BEGIN
 SELECT all_expected,verified,missing INTO v_total,v_verified,v_missing FROM (
WITH expected(constraint_name,index_name,relname) AS (VALUES
    ('website_lead_consents_tenant_lead_fk','g11_idx_private_lead_consents_tenant_lead','private.website_lead_consents'),
    ('activities_contact_id_fkey','g11_idx_activities_tenant_contact','public.activities'),
    ('activities_deal_id_fkey','g11_idx_activities_tenant_deal','public.activities'),
    ('activities_lead_id_fkey','g11_idx_activities_tenant_lead','public.activities'),
    ('activities_property_id_fkey','g11_idx_activities_tenant_property','public.activities'),
    ('appointments_contact_id_fkey','g11_idx_appointments_tenant_contact','public.appointments'),
    ('appointments_lead_id_fkey','g11_idx_appointments_tenant_lead','public.appointments'),
    ('appointments_property_id_fkey','g11_idx_appointments_tenant_property','public.appointments'),
    ('commissions_deal_id_fkey','g11_idx_commissions_tenant_deal','public.commissions'),
    ('leads_contact_id_fkey','g11_idx_leads_tenant_contact','public.leads'),
    ('leads_property_id_fkey','g11_idx_leads_tenant_property','public.leads'),
    ('maintenance_requests_property_id_fkey','g11_idx_maintenance_tenant_property','public.maintenance_requests'),
    ('portal_access_links_contact_id_fkey','g11_idx_portal_links_tenant_contact','public.portal_access_links'),
    ('portal_access_links_owner_id_fkey','g11_idx_portal_links_tenant_owner','public.portal_access_links'),
    ('property_consignments_contact_id_fkey','g11_idx_consignments_tenant_contact','public.property_consignments'),
    ('property_consignments_lead_id_fkey','g11_idx_consignments_tenant_lead','public.property_consignments'),
    ('property_consignments_property_id_fkey','g11_idx_consignments_tenant_property','public.property_consignments')
), verified AS (
 SELECT e.constraint_name,e.index_name,e.relname,
        EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_class t ON t.oid=c.conrelid
           JOIN pg_namespace n ON n.oid=t.relnamespace
           JOIN pg_index i ON i.indrelid=t.oid
           JOIN pg_class idx ON idx.oid=i.indexrelid
           WHERE c.conname=e.constraint_name AND c.contype='f'
            AND n.nspname||'.'||t.relname=e.relname
            AND idx.relname=e.index_name
            AND i.indisvalid AND i.indisready AND i.indnkeyatts >= cardinality(c.conkey)
            AND ARRAY(
               SELECT i.indkey[pos]::smallint
               FROM generate_series(0,cardinality(c.conkey)-1) AS pos
               ORDER BY pos
             )=c.conkey
        ) AS covered
 FROM expected e
)
SELECT count(*) AS all_expected,
       count(*) FILTER(WHERE covered) AS verified,
       string_agg(constraint_name,', ' ORDER BY constraint_name)
          FILTER(WHERE NOT covered) AS missing
FROM verified
 ) result;
 IF v_total<>17 OR v_verified<>17 THEN
   RAISE EXCEPTION 'G11 FK index coverage failed: % / %, missing %', v_verified,v_total,v_missing;
 END IF;
END $postflight$;

COMMIT;
