-- Staging only: auditable receipt-derived settlement reconciliation. No banking.
BEGIN;
CREATE FUNCTION public.reconcile_owner_draft_statement(
 target_org uuid,target_statement uuid
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  statement public.owner_statements%ROWTYPE;
  approved_other numeric;
  detail_commission numeric;
  detail_tax numeric;
  commission_rows integer;
  tax_rows integer;
  pending_rows integer;
  collected numeric;
  net_total numeric;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.has_org_permission(target_org,'owner_statements.create') OR
     NOT public.has_org_permission(target_org,'rent_payments.view') THEN
    RAISE EXCEPTION 'Not allowed to reconcile this tenant statement' USING ERRCODE='42501';
  END IF;

  SELECT * INTO statement FROM public.owner_statements
    WHERE organization_id=target_org AND id=target_statement FOR UPDATE;
  IF NOT FOUND OR statement.status<>'DRAFT' THEN
    RAISE EXCEPTION 'Only existing draft settlements can be reconciled' USING ERRCODE='23514';
  END IF;

  SELECT
    coalesce(sum(amount) FILTER(
      WHERE status='APPROVED' AND responsible_party='OWNER' AND category NOT IN ('TAX','COMMISSION')),0),
    coalesce(sum(amount) FILTER(
      WHERE status='APPROVED' AND responsible_party='OWNER' AND category='COMMISSION'),0),
    coalesce(sum(amount) FILTER(
      WHERE status='APPROVED' AND responsible_party='OWNER' AND category='TAX'),0),
    count(*) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER' AND category='COMMISSION'),
    count(*) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER' AND category='TAX'),
    count(*) FILTER(WHERE status='DRAFT')
  INTO approved_other,detail_commission,detail_tax,commission_rows,tax_rows,pending_rows
  FROM public.owner_statement_deductions
  WHERE organization_id=target_org AND statement_id=target_statement;

  IF pending_rows>0 THEN
    RAISE EXCEPTION 'Approve or void all draft charges before reconciliation' USING ERRCODE='23514';
  END IF;
  IF (commission_rows>0 AND detail_commission<>statement.commission_amount) OR
     (tax_rows>0 AND detail_tax<>statement.tax_amount) THEN
    RAISE EXCEPTION 'Detailed commissions/taxes differ from statement totals' USING ERRCODE='23514';
  END IF;

  -- Take receipt parent locks to serialize reconciliation against receipt writes.
  PERFORM 1 FROM public.rent_payments
    WHERE organization_id=target_org AND lease_id=statement.lease_id AND
      period_month=statement.period_month
    FOR UPDATE;
  SELECT coalesce(sum(paid_amount),0) INTO collected FROM public.rent_payments
    WHERE organization_id=target_org AND lease_id=statement.lease_id AND
      period_month=statement.period_month AND status<>'CANCELLED';

  net_total:=collected-statement.commission_amount-statement.tax_amount-approved_other;
  IF net_total<0 THEN
    RAISE EXCEPTION 'Approved deductions exceed collected rent' USING ERRCODE='23514';
  END IF;

  UPDATE public.owner_statements
   SET gross_income=collected,other_deductions=approved_other,net_amount=net_total
   WHERE id=target_statement AND organization_id=target_org AND status='DRAFT';
  RETURN net_total;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_owner_draft_statement(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_owner_draft_statement(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.reconcile_owner_draft_statement(uuid,uuid) IS
 'Reconciles draft owner amounts with recorded tenant receipts and approved OWNER charges; does not transfer funds.';
COMMIT;
