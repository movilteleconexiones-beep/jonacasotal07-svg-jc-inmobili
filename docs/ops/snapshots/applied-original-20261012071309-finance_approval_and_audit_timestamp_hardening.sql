BEGIN;
ALTER POLICY leases_financial_insert ON public.leases
  WITH CHECK (
    public.has_org_permission(organization_id, 'leases.create')
    AND status = 'DRAFT'
  );
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