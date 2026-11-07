-- Evaluate the authenticated subject once per statement rather than for every
-- candidate deduction row. Preserve all tenant permissions and draft-only checks.
BEGIN;
ALTER POLICY owner_deductions_insert ON public.owner_statement_deductions
  WITH CHECK (
    public.has_org_permission(organization_id, 'owner_statements.create')
    AND created_by = (SELECT auth.uid())
    AND status = 'DRAFT'
  );
COMMIT;
