BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- STAGING REVIEW ONLY. This migration must not be applied to production before
-- independent Supabase/PostgREST, RLS, tax and transaction-lock validation.
-- A classified, immutable deduction log for each owner's period statement.
-- It DOES NOT recalculate existing statements or transfer money.

-- Each statement is globally identified by id, but a composite FK is needed
-- to guarantee all ledger entries belong to the same inmobiliaria.
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statements_org_id_key UNIQUE (organization_id, id);

CREATE TABLE public.owner_statement_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  charge_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'WATER','ELECTRICITY','GAS','WASTE','BUILDING_FEE',
    'MAINTENANCE','REPAIRS','INSURANCE','TAX','COMMISSION','OTHER'
  )),
  responsible_party text NOT NULL CHECK (responsible_party IN ('OWNER','TENANT','AGENCY')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 4 AND 500),
  support_reference text CHECK (support_reference IS NULL OR length(support_reference) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','VOIDED')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_deductions_statement_same_tenant_fk
    FOREIGN KEY (organization_id, statement_id)
    REFERENCES public.owner_statements(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_deductions_void_reason_check
    CHECK (status <> 'VOIDED' OR (void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 6 AND 500))
);

CREATE INDEX owner_deductions_statement_created_idx
  ON public.owner_statement_deductions (organization_id, statement_id, created_at DESC);

-- Serialize mutations with statement state changes and reject edits to a
-- generated/paid statement. Even draft entries are immutable: corrections
-- require an auditable VOID and a new line.
CREATE FUNCTION public.guard_owner_statement_deduction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  parent_status text;
  actor uuid;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE='42501';
  END IF;
  -- SECURITY DEFINER is used only to lock the parent statement without
  -- granting every accounting user UPDATE rights on all statements.
  -- Perform the same tenant/permission check inside this privileged boundary.
  IF TG_OP <> 'DELETE' AND NOT public.has_org_permission(NEW.organization_id, 'owner_statements.create') THEN
    RAISE EXCEPTION 'Not authorized to alter this organization statement' USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deduction entries must be voided rather than deleted' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'VOIDED' OR NEW.status = OLD.status OR
       (OLD.status = 'APPROVED' AND NEW.status <> 'VOIDED') OR
       (OLD.status = 'DRAFT' AND NEW.status NOT IN ('APPROVED','VOIDED')) THEN
      RAISE EXCEPTION 'Invalid deduction status transition' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW.organization_id,NEW.statement_id,NEW.charge_date,NEW.category,
           NEW.responsible_party,NEW.amount,NEW.description,NEW.support_reference,
           NEW.created_by,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.organization_id,OLD.statement_id,OLD.charge_date,OLD.category,
           OLD.responsible_party,OLD.amount,OLD.description,OLD.support_reference,
           OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Deduction values are immutable; void and replace' USING ERRCODE='23514';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
       NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
       NEW.voided_by IS DISTINCT FROM OLD.voided_by OR
       NEW.voided_at IS DISTINCT FROM OLD.voided_at OR
       (NEW.status <> 'VOIDED' AND NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
      RAISE EXCEPTION 'Approval and void metadata is server-owned' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.status <> 'DRAFT' OR NEW.created_by <> actor OR
        NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR
        NEW.voided_by IS NOT NULL OR NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
    RAISE EXCEPTION 'New deductions must be draft entries authored by the user' USING ERRCODE='23514';
  END IF;

  SELECT s.status INTO parent_status
  FROM public.owner_statements s
  WHERE s.organization_id = NEW.organization_id AND s.id = NEW.statement_id
  FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft owner statements accept deductions' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'APPROVED' THEN
      NEW.approved_at := now();
      NEW.approved_by := actor;
      NEW.void_reason := NULL;
    ELSIF NEW.status = 'VOIDED' THEN
      NEW.voided_at := now();
      NEW.voided_by := actor;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_owner_statement_deduction_change()
  FROM PUBLIC,anon,authenticated;

CREATE TRIGGER owner_statement_deductions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.owner_statement_deductions
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_statement_deduction_change();

ALTER TABLE public.owner_statement_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_statement_deductions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.owner_statement_deductions TO authenticated;

CREATE POLICY owner_deductions_view
ON public.owner_statement_deductions FOR SELECT TO authenticated
USING (public.has_org_permission(organization_id, 'owner_statements.view'));

CREATE POLICY owner_deductions_insert
ON public.owner_statement_deductions FOR INSERT TO authenticated
WITH CHECK (public.has_org_permission(organization_id, 'owner_statements.create')
  AND created_by = auth.uid() AND status = 'DRAFT');

CREATE POLICY owner_deductions_update_status
ON public.owner_statement_deductions FOR UPDATE TO authenticated
USING (public.has_org_permission(organization_id, 'owner_statements.create'))
WITH CHECK (public.has_org_permission(organization_id, 'owner_statements.create'));

COMMENT ON TABLE public.owner_statement_deductions IS
'Per-owner per-period classified charges. No automatic ledger payouts, tax decisions, or recalculation of owner_statements.';
COMMENT ON COLUMN public.owner_statement_deductions.responsible_party IS
'OWNER affects the owner''s deduction reconciliation; TENANT and AGENCY must never be deducted from owner net.';
COMMENT ON COLUMN public.owner_statement_deductions.category IS
'TAX and COMMISSION are separate columns in owner_statements and must not be counted again as other_deductions.';

-- REVIEW / STAGING ONLY: DO NOT APPLY TO PRODUCTION UNTIL SQL/APP E2E PASS.
-- Replaces unsafe direct rent updates with atomic authenticated receipts.

ALTER TABLE public.leases ADD CONSTRAINT leases_org_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.rent_payments ADD CONSTRAINT rent_payments_org_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.rent_payments ADD CONSTRAINT rent_payments_unique_period
  UNIQUE (organization_id,lease_id,period_month);
ALTER TABLE public.rent_payments ADD CONSTRAINT rent_payments_lease_same_org_fk
  FOREIGN KEY (organization_id,lease_id) REFERENCES public.leases (organization_id,id);
ALTER TABLE public.owner_statements ADD CONSTRAINT owner_statement_unique_per_month
  UNIQUE (organization_id,lease_id,owner_id,period_month);
ALTER TABLE public.owner_statements ADD CONSTRAINT owner_statement_lease_same_org_fk
  FOREIGN KEY (organization_id,lease_id) REFERENCES public.leases(organization_id,id);

CREATE TABLE public.rent_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rent_payment_id uuid NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  method text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','OTHER')),
  support_reference text NOT NULL CHECK (length(btrim(support_reference)) BETWEEN 3 AND 140),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_receipts_period_same_org_fk
    FOREIGN KEY (organization_id,rent_payment_id)
    REFERENCES public.rent_payments (organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX rent_receipts_period_idx ON public.rent_receipts(organization_id,rent_payment_id,created_at);

ALTER TABLE public.rent_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rent_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rent_receipts TO authenticated;

CREATE POLICY rent_receipts_view ON public.rent_receipts FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'rent_payments.view'));

-- RLS for legacy rent_payments uses wide membership grants, not granular role
-- checks, so client writes MUST be removed and routed through guarded RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.rent_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rent_payments TO authenticated;

CREATE FUNCTION public.create_tenant_rent_period(
  target_org uuid,target_lease uuid,target_period date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  lease_record public.leases%ROWTYPE;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') THEN
    RAISE EXCEPTION 'Not authorized to create rent periods' USING ERRCODE='42501';
  END IF;
  IF target_period IS NULL OR extract(day from target_period)<>1 THEN
    RAISE EXCEPTION 'Period must begin on day one' USING ERRCODE='22023';
  END IF;
  SELECT * INTO lease_record FROM public.leases
    WHERE organization_id=target_org AND id=target_lease FOR UPDATE;
  IF NOT FOUND OR lease_record.status <> 'ACTIVE' OR lease_record.monthly_rent<=0 THEN
    RAISE EXCEPTION 'An active lease with positive rent is required' USING ERRCODE='23514';
  END IF;
  IF target_period<date_trunc('month',lease_record.start_date)::date OR
     (lease_record.end_date IS NOT NULL AND
      target_period>date_trunc('month',lease_record.end_date)::date) THEN
    RAISE EXCEPTION 'Period is outside lease dates' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.rent_payments
    (organization_id,lease_id,period_month,expected_amount,paid_amount,status)
  VALUES (target_org,target_lease,target_period,lease_record.monthly_rent,0,'PENDING')
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_tenant_rent_period(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_rent_period(uuid,uuid,date) TO authenticated;

CREATE FUNCTION public.record_tenant_rent_receipt(
  target_org uuid,target_payment uuid,receipt_amount numeric,receipt_method text,
  receipt_reference text,request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  actor uuid;
  entry public.rent_payments%ROWTYPE;
  prior public.rent_receipts%ROWTYPE;
  receipt_id uuid;
  new_paid numeric;
BEGIN
  actor:=auth.uid();
  IF actor IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') THEN
    RAISE EXCEPTION 'Not authorized to register rent payments' USING ERRCODE='42501';
  END IF;
  IF receipt_amount IS NULL OR receipt_amount<=0 OR
     receipt_amount>999999999999.99 OR receipt_amount<>round(receipt_amount,2) OR
     receipt_method NOT IN ('CASH','BANK_TRANSFER','OTHER') OR
     length(btrim(coalesce(receipt_reference,''))) NOT BETWEEN 3 AND 140 OR
     request_key IS NULL THEN
    RAISE EXCEPTION 'Invalid receipt amount, method, reference or request key' USING ERRCODE='22023';
  END IF;

  SELECT * INTO entry FROM public.rent_payments
  WHERE organization_id=target_org AND id=target_payment FOR UPDATE;
  IF NOT FOUND OR entry.status='CANCELLED' THEN
    RAISE EXCEPTION 'Unknown or cancelled rent obligation' USING ERRCODE='23514';
  END IF;

  SELECT * INTO prior FROM public.rent_receipts WHERE idempotency_key=request_key;
  IF FOUND THEN
    IF prior.organization_id=target_org AND prior.rent_payment_id=target_payment AND
       prior.amount=receipt_amount AND prior.method=receipt_method AND
       prior.support_reference=btrim(receipt_reference) AND prior.created_by=actor THEN
      RETURN prior.id;
    END IF;
    RAISE EXCEPTION 'Idempotency key was already used for another receipt' USING ERRCODE='23505';
  END IF;

  new_paid:=entry.paid_amount+receipt_amount;
  IF new_paid>entry.expected_amount THEN
    RAISE EXCEPTION 'Receipt exceeds the recorded pending amount' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.rent_receipts
    (organization_id,rent_payment_id,idempotency_key,amount,method,support_reference,created_by)
  VALUES (target_org,target_payment,request_key,receipt_amount,receipt_method,btrim(receipt_reference),actor)
  RETURNING id INTO receipt_id;

  UPDATE public.rent_payments
    SET paid_amount=new_paid,
        status=CASE WHEN new_paid=entry.expected_amount THEN 'PAID' ELSE 'PARTIAL' END,
        paid_at=now()
    WHERE organization_id=target_org AND id=target_payment;
  RETURN receipt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid) TO authenticated;

CREATE FUNCTION public.create_owner_draft_statement(
 target_org uuid,target_lease uuid,target_month date,
 agency_commission numeric,withholding_tax numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  l public.leases%ROWTYPE;
  income numeric;
  record_id uuid;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.has_org_permission(target_org,'owner_statements.create') OR
     NOT public.has_org_permission(target_org,'rent_payments.view') THEN
    RAISE EXCEPTION 'Not authorized to create this owner statement' USING ERRCODE='42501';
  END IF;
  IF target_month IS NULL OR extract(day from target_month)<>1 OR
     agency_commission IS NULL OR withholding_tax IS NULL OR
     agency_commission<0 OR withholding_tax<0 OR
     agency_commission<>round(agency_commission,2) OR withholding_tax<>round(withholding_tax,2) THEN
    RAISE EXCEPTION 'Invalid statement month or tax/commission amount' USING ERRCODE='22023';
  END IF;

  SELECT * INTO l FROM public.leases
    WHERE id=target_lease AND organization_id=target_org FOR UPDATE;
  IF NOT FOUND OR l.owner_id IS NULL OR l.status NOT IN ('ACTIVE','RENEWAL','FINISHED') OR
    NOT EXISTS(SELECT 1 FROM public.property_owners po
       WHERE po.id=l.owner_id AND po.organization_id=target_org) THEN
    RAISE EXCEPTION 'Lease has no valid owner for this agency' USING ERRCODE='23514';
  END IF;

  SELECT coalesce(sum(paid_amount),0) INTO income FROM public.rent_payments
    WHERE lease_id=target_lease AND organization_id=target_org AND
      period_month=target_month AND status<>'CANCELLED';
  IF agency_commission+withholding_tax>income THEN
    RAISE EXCEPTION 'Deductions exceed recorded rent receipts' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.owner_statements
    (organization_id,lease_id,owner_id,period_month,gross_income,commission_amount,
      tax_amount,other_deductions,net_amount,status)
  VALUES (target_org,target_lease,l.owner_id,target_month,income,agency_commission,
      withholding_tax,0,income-agency_commission-withholding_tax,'DRAFT')
  RETURNING id INTO record_id;
  RETURN record_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_owner_draft_statement(uuid,uuid,date,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_draft_statement(uuid,uuid,date,numeric,numeric) TO authenticated;

COMMENT ON TABLE public.rent_receipts IS
  'Immutable rent payment events. Wompi is only for central INMOJCO licenses, never rent collections.';

-- Staging only: auditable receipt-derived settlement reconciliation. No banking.

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

-- Staging only. Restrict financial table writes and make every lease relation
-- tenant-composite even when valid UUIDs belong to different organizations.

-- Supabase may default to ALL table privileges. TRUNCATE bypasses RLS,
-- so removing INSERT/UPDATE/DELETE alone does not protect financial ledgers.
REVOKE ALL ON public.leases,public.rent_payments,public.owner_statements
  FROM PUBLIC,anon;
REVOKE TRUNCATE,REFERENCES,TRIGGER
  ON public.leases,public.rent_payments,public.owner_statements,
     public.owner_statement_deductions,public.rent_receipts
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.leases TO authenticated;

-- Abort before acquiring schema locks if historic cross-organization records exist.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.properties p ON p.id=l.property_id
    WHERE p.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.contacts c ON c.id=l.tenant_id
    WHERE c.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.property_owners o ON o.id=l.owner_id
    WHERE o.organization_id<>l.organization_id
  ) THEN
    RAISE EXCEPTION 'Existing cross-organization lease relations require manual review'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.owner_statements s
    JOIN public.property_owners o ON o.id=s.owner_id
    WHERE o.organization_id<>s.organization_id
  ) THEN
    RAISE EXCEPTION 'Existing cross-organization settlement owner relations require manual review'
      USING ERRCODE='23514';
  END IF;
END
$preflight$;

-- These constraints are needed for a tenant-bound composite FK; existing
-- single-column IDs already have unique primary keys.
ALTER TABLE public.properties
  ADD CONSTRAINT financial_properties_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.contacts
  ADD CONSTRAINT financial_contacts_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.property_owners
  ADD CONSTRAINT financial_property_owners_tenant_id_unique UNIQUE (organization_id,id);

-- A settlement must not reference an owner from a different organization.
-- Replace the legacy single-column FK to preserve unambiguous PostgREST joins.
ALTER TABLE public.owner_statements DROP CONSTRAINT owner_statements_owner_id_fkey;
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statement_owner_same_tenant_fk
    FOREIGN KEY (organization_id,owner_id)
    REFERENCES public.property_owners(organization_id,id) ON DELETE RESTRICT;

-- Replace (do not duplicate) old single-column FKs to avoid ambiguous
-- PostgREST joins against the same destination table.
ALTER TABLE public.leases DROP CONSTRAINT leases_property_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_tenant_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_owner_id_fkey;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_property_same_tenant_fk
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_tenant_same_tenant_fk
    FOREIGN KEY (organization_id,tenant_id)
    REFERENCES public.contacts(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_owner_same_tenant_fk
    FOREIGN KEY (organization_id,owner_id)
    REFERENCES public.property_owners(organization_id,id) ON DELETE RESTRICT;

-- Existing tenant membership policies for leases are permissive. Add
-- RESTRICTIVE policies so broad legacy ALL policies cannot bypass granular
-- authorization. Revisit inherited commercial entitlements separately.
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY leases_financial_view ON public.leases AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'leases.view'));
CREATE POLICY leases_financial_insert ON public.leases AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organization_id,'leases.create'));
CREATE POLICY leases_financial_update ON public.leases AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_org_permission(organization_id,'leases.edit'))
  WITH CHECK (public.has_org_permission(organization_id,'leases.edit'));
REVOKE DELETE ON public.leases FROM PUBLIC,anon,authenticated;

-- A user must never forge an owner's net or mark a payment made directly.
-- create_owner_draft_statement and reconcile_owner_draft_statement are
-- server-only privileged functions that validate organization permissions.
REVOKE INSERT, UPDATE, DELETE ON public.owner_statements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_statements TO authenticated;
ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_statement_financial_view
  ON public.owner_statements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'owner_statements.view'));

-- The receipt migration already revoked direct rent_payments mutations,
-- but its legacy SELECT rules also need a granular read permission.
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rent_payments_financial_view
  ON public.rent_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'rent_payments.view'));

-- Reject non-finite amounts, fractions below one cent and invalid dates even
-- when a caller skips the browser's form validation. The upper bound also
-- rejects PostgreSQL numeric NaN/Infinity, which positive-only checks allow.
ALTER TABLE public.leases
  ADD CONSTRAINT leases_financial_amount_valid CHECK (
    monthly_rent BETWEEN 0 AND 999999999999.99 AND monthly_rent=round(monthly_rent,2)
    AND (status NOT IN ('ACTIVE','RENEWAL') OR (monthly_rent>0 AND tenant_id IS NOT NULL))),
  ADD CONSTRAINT leases_financial_dates_valid CHECK (
    isfinite(start_date) AND (end_date IS NULL OR (isfinite(end_date) AND end_date>=start_date)));
ALTER TABLE public.rent_payments
  ADD CONSTRAINT rent_payment_financial_amounts_valid CHECK (
    expected_amount>0 AND expected_amount<=999999999999.99
    AND expected_amount=round(expected_amount,2)
    AND paid_amount BETWEEN 0 AND expected_amount AND paid_amount=round(paid_amount,2)),
  ADD CONSTRAINT rent_payment_month_valid CHECK (
    isfinite(period_month) AND extract(day FROM period_month)=1);
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statement_financial_amounts_valid CHECK (
    gross_income BETWEEN 0 AND 999999999999.99 AND gross_income=round(gross_income,2)
    AND commission_amount BETWEEN 0 AND gross_income AND commission_amount=round(commission_amount,2)
    AND tax_amount BETWEEN 0 AND gross_income AND tax_amount=round(tax_amount,2)
    AND other_deductions BETWEEN 0 AND gross_income AND other_deductions=round(other_deductions,2)
    AND net_amount BETWEEN 0 AND gross_income
    AND net_amount=gross_income-commission_amount-tax_amount-other_deductions),
  ADD CONSTRAINT owner_statement_month_valid CHECK (
    isfinite(period_month) AND extract(day FROM period_month)=1);
ALTER TABLE public.owner_statement_deductions
  ADD CONSTRAINT owner_deduction_finite_amount CHECK (amount<=999999999999.99);
ALTER TABLE public.rent_receipts
  ADD CONSTRAINT rent_receipt_finite_amount CHECK (amount<=999999999999.99);

-- This privileged function is invoked by its trigger, never as a client RPC.
REVOKE ALL ON FUNCTION public.guard_owner_statement_deduction_change()
  FROM PUBLIC,anon,authenticated;

COMMENT ON POLICY leases_financial_insert ON public.leases IS
  'Restrictive tenant permission gate, also enforced against legacy ALL policies.';

NOTIFY pgrst, 'reload schema';
COMMIT;