-- Targeted non-unique FK indexes for owner/tenant joins and financial lookups.
-- Existing primary/unique indexes and tenant RLS rules remain unchanged.
CREATE INDEX IF NOT EXISTS leases_org_owner_fk_idx ON public.leases (organization_id,owner_id);
CREATE INDEX IF NOT EXISTS leases_org_tenant_fk_idx ON public.leases (organization_id,tenant_id);
CREATE INDEX IF NOT EXISTS owner_statements_org_owner_fk_idx ON public.owner_statements (organization_id,owner_id);
CREATE INDEX IF NOT EXISTS commission_review_requests_commission_fk_idx ON public.commission_review_requests (commission_id);
