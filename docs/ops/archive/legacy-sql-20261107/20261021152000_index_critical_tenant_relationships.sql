-- Cover the most frequently traversed tenant-owned foreign-key relationships.
-- Preflight 2026-10-21: all three target tables below contain <= 1 row in production.
-- Indexes change query planning only; they do not change permissions or user data.
BEGIN;
CREATE INDEX IF NOT EXISTS deals_org_contact_fk_fast_idx
  ON public.deals (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS deals_org_property_fk_fast_idx
  ON public.deals (organization_id, property_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_org_fk_fast_idx
  ON public.maintenance_requests (organization_id);
CREATE INDEX IF NOT EXISTS portal_links_contact_fk_fast_idx
  ON public.portal_access_links (contact_id);
CREATE INDEX IF NOT EXISTS portal_links_owner_fk_fast_idx
  ON public.portal_access_links (owner_id);
COMMIT;
