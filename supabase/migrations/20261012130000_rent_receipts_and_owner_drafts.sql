-- REVIEW / STAGING ONLY: DO NOT APPLY TO PRODUCTION UNTIL SQL/APP E2E PASS.
-- Replaces unsafe direct rent updates with atomic authenticated receipts.
BEGIN;

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
REVOKE ALL ON FUNCTION public.create_tenant_rent_period(uuid,uuid,date) FROM PUBLIC;
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
REVOKE ALL ON FUNCTION public.record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC;
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
REVOKE ALL ON FUNCTION public.create_owner_draft_statement(uuid,uuid,date,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_owner_draft_statement(uuid,uuid,date,numeric,numeric) TO authenticated;

COMMENT ON TABLE public.rent_receipts IS
  'Immutable rent payment events. Wompi is only for central INMOJCO licenses, never rent collections.';
COMMIT;
