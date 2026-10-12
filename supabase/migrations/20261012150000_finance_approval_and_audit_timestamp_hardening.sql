-- Apply only after the audited finance migrations (20261012120000 - 143000).
-- Permission boundary: a lease must start DRAFT; activation requires leases.edit.
-- Audit boundary: clients cannot choose the server creation timestamps.
BEGIN;

ALTER POLICY leases_financial_insert ON public.leases
  WITH CHECK (
    public.has_org_permission(organization_id, 'leases.create')
    AND status = 'DRAFT'
  );

-- Runs before owner_statement_deductions_guard (trigger names sort lexically).
-- SECURITY INVOKER and no public EXECUTE: never expose a privileged RPC.
CREATE FUNCTION public.normalize_owner_deduction_audit_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_owner_deduction_audit_fields()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER aaa_owner_deductions_server_timestamps
  BEFORE INSERT ON public.owner_statement_deductions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_owner_deduction_audit_fields();

COMMENT ON FUNCTION public.normalize_owner_deduction_audit_fields() IS
  'Server-owned creation timestamps on immutable owner-deduction ledger events.';
COMMIT;
