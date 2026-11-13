-- G09 rollback ONLY if the new shared-owner functionality has NOT yet been used.
-- Baseline function was captured from production BEFORE installation, hash c3e1ce9d703bc89c940db384cfc7d405.
-- This is NOT an instruction to undo owner payouts or delete issued financial records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $rollback_guard$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)') IS NULL
 OR to_regprocedure('jco_private.allocate_owner_amount(uuid,numeric)') IS NULL
 THEN RAISE EXCEPTION 'G09 rollback refuses unknown schema or executor'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.owner_statements s JOIN public.leases l
    ON l.id=s.lease_id AND l.organization_id=s.organization_id
   WHERE (SELECT count(*) FROM public.property_ownerships po
     WHERE po.property_id=l.property_id)>1
 ) OR EXISTS (
   SELECT 1 FROM public.audit_log
   WHERE action='owner_statement.shared_draft_created'
 ) THEN
   RAISE EXCEPTION 'G09 multi-owner activity already exists; requires explicit accounting migration plan';
 END IF;
END $rollback_guard$;
DROP TRIGGER owner_statements_shared_cap ON public.owner_statements;
DROP FUNCTION public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric);
DROP FUNCTION jco_private.enforce_shared_owner_statement_cap();
-- Restore original settlement logic to identical audited pre-G09 definition.
CREATE OR REPLACE FUNCTION public.reconcile_owner_draft_statement(target_org uuid, target_statement uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
$function$;
DROP FUNCTION jco_private.allocate_owner_amount(uuid,numeric);
COMMIT;
