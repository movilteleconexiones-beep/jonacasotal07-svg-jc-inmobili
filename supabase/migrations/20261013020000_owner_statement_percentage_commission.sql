-- Invoiced owner statement commission rates: retain monetary ledger and
-- derive it atomically on the server from the percentage and paid rent.
-- Existing draft statements and monetary accounting RPC remain unchanged.
BEGIN;

CREATE FUNCTION public.create_owner_draft_statement_by_percentage(
 target_org uuid,target_lease uuid,target_month date,
 agency_commission_percentage numeric,withholding_tax numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  paid_income numeric;
  derived_commission numeric;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.has_org_permission(target_org,'owner_statements.create') OR
     NOT public.has_org_permission(target_org,'rent_payments.view') THEN
    RAISE EXCEPTION 'Not authorized to create owner statement'
      USING ERRCODE='42501';
  END IF;
  IF agency_commission_percentage IS NULL OR
     agency_commission_percentage<0 OR agency_commission_percentage>100 OR
     agency_commission_percentage<>round(agency_commission_percentage,2) THEN
    RAISE EXCEPTION 'Commission percentage must be between 0 and 100 with at most 2 decimals'
      USING ERRCODE='22023';
  END IF;
  IF target_month IS NULL OR NOT isfinite(target_month) OR
     extract(day from target_month)<>1 THEN
    RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';
  END IF;

  -- Keep the standard lease lock order. Prevent a receipt write while
  -- determining the base of this owner's financial statement.
  PERFORM 1 FROM public.leases l
    WHERE l.organization_id=target_org AND l.id=target_lease FOR UPDATE;
  PERFORM 1 FROM public.rent_payments p
    WHERE p.organization_id=target_org AND p.lease_id=target_lease
      AND p.period_month=target_month
    FOR UPDATE;

  SELECT COALESCE(SUM(p.paid_amount),0) INTO paid_income
  FROM public.rent_payments p
  WHERE p.organization_id=target_org AND p.lease_id=target_lease
    AND p.period_month=target_month AND p.status<>'CANCELLED';

  derived_commission:=round(paid_income*agency_commission_percentage/100,2);

  -- Reuse existing safety checks, financial constraints, owner linkage
  -- and insert logic instead of bypassing them.
  RETURN public.create_owner_draft_statement(
    target_org,target_lease,target_month,derived_commission,withholding_tax);
END;
$$;

REVOKE ALL ON FUNCTION public.create_owner_draft_statement_by_percentage(uuid,uuid,date,numeric,numeric)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_draft_statement_by_percentage(uuid,uuid,date,numeric,numeric)
 TO authenticated;
COMMENT ON FUNCTION public.create_owner_draft_statement_by_percentage(uuid,uuid,date,numeric,numeric)
 IS 'Creates an audited owner draft with percent-based commission, deriving the monetary amount from recorded receipts under locks.';
COMMIT;
