-- Tenant rent corrections: prospective amendments and protected obligation edits.
-- Existing paid receipts and owner statements are never modified.
BEGIN;

CREATE TABLE public.lease_rent_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 effective_month date NOT NULL,
 new_monthly_rent numeric(14,2) NOT NULL,
 reason text NOT NULL,
 document_reference text NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT lease_rent_amendment_org_lease_fk
  FOREIGN KEY (organization_id,lease_id)
  REFERENCES public.leases(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT lease_rent_amendment_effective_first_day
  CHECK (isfinite(effective_month) AND EXTRACT(day FROM effective_month)=1),
 CONSTRAINT lease_rent_amendment_positive_amount
  CHECK (new_monthly_rent>0 AND new_monthly_rent<=999999999999.99
    AND new_monthly_rent=round(new_monthly_rent,2)),
 CONSTRAINT lease_rent_amendment_reason CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
 CONSTRAINT lease_rent_amendment_reference CHECK (length(btrim(document_reference)) BETWEEN 3 AND 140),
 CONSTRAINT lease_rent_amendment_one_per_month UNIQUE(organization_id,lease_id,effective_month)
);
CREATE INDEX lease_rent_amendments_lookup
 ON public.lease_rent_amendments(organization_id,lease_id,effective_month DESC);
ALTER TABLE public.lease_rent_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_rent_amendments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lease_rent_amendments TO authenticated;
CREATE POLICY lease_rent_amendments_view ON public.lease_rent_amendments
 FOR SELECT TO authenticated USING (
  public.has_org_permission(organization_id,'leases.view')
 );

CREATE FUNCTION public.schedule_lease_rent_amendment(
 target_org uuid,target_lease uuid,target_month date,new_amount numeric,
 change_reason text,signed_addendum_reference text,request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  lease_row public.leases%ROWTYPE;
  existing public.lease_rent_amendments%ROWTYPE;
  current_amount numeric;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org,'leases.edit') OR
    NOT EXISTS (
      SELECT 1 FROM public.organization_members member
      JOIN public.member_roles mr ON mr.organization_member_id=member.id
      JOIN public.roles role ON role.id=mr.role_id
      WHERE member.organization_id=target_org AND member.user_id=auth.uid()
        AND member.status='ACTIVE' AND role.organization_id=target_org
        AND role.key='ADMIN' AND role.active
    ) THEN
    RAISE EXCEPTION 'Only authorized administrators can amend contract rent' USING ERRCODE='42501';
  END IF;
  IF request_key IS NULL OR target_month IS NULL OR NOT isfinite(target_month) OR
     EXTRACT(day FROM target_month)<>1 OR
     target_month<=(date_trunc('month',now() AT TIME ZONE 'America/Bogota'))::date OR
     new_amount IS NULL OR new_amount<=0 OR new_amount>999999999999.99 OR
     new_amount<>round(new_amount,2) OR
     length(btrim(coalesce(change_reason,''))) NOT BETWEEN 10 AND 500 OR
     length(btrim(coalesce(signed_addendum_reference,''))) NOT BETWEEN 3 AND 140 THEN
    RAISE EXCEPTION 'Invalid future month, rent, amendment reference or justification' USING ERRCODE='22023';
  END IF;
  SELECT * INTO lease_row FROM public.leases
   WHERE organization_id=target_org AND id=target_lease FOR UPDATE;
  IF NOT FOUND OR lease_row.status NOT IN ('ACTIVE','RENEWAL') OR
    (lease_row.end_date IS NOT NULL AND
       target_month>date_trunc('month',lease_row.end_date)::date) THEN
    RAISE EXCEPTION 'Only active leases with an effective month inside contract dates may be amended'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.lease_rent_amendments a WHERE a.request_key=schedule_lease_rent_amendment.request_key;
  IF FOUND THEN
    IF existing.organization_id=target_org AND existing.lease_id=target_lease AND
       existing.effective_month=target_month AND existing.new_monthly_rent=new_amount AND
       existing.reason=btrim(change_reason) AND
       existing.document_reference=btrim(signed_addendum_reference) AND
       existing.created_by=auth.uid() THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'The idempotency key belongs to a different amendment' USING ERRCODE='23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rent_payments
    WHERE organization_id=target_org AND lease_id=target_lease
      AND period_month>=target_month
  ) OR EXISTS (
    SELECT 1 FROM public.owner_statements
    WHERE organization_id=target_org AND lease_id=target_lease
      AND period_month>=target_month
  ) THEN
    RAISE EXCEPTION 'There are registered billing periods or statements at/after that month; review them first'
      USING ERRCODE='23514';
  END IF;
  SELECT COALESCE((
    SELECT a.new_monthly_rent FROM public.lease_rent_amendments a
    WHERE a.organization_id=target_org AND a.lease_id=target_lease
      AND a.effective_month<=target_month
    ORDER BY a.effective_month DESC LIMIT 1
  ),lease_row.monthly_rent) INTO current_amount;
  IF current_amount=new_amount THEN
    RAISE EXCEPTION 'New monthly rent equals current scheduled amount' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.lease_rent_amendments
    (organization_id,lease_id,effective_month,new_monthly_rent,reason,document_reference,request_key,created_by)
  VALUES(target_org,target_lease,target_month,new_amount,btrim(change_reason),
         btrim(signed_addendum_reference),request_key,auth.uid())
  RETURNING id INTO new_id;
  INSERT INTO public.audit_log
    (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'leases.rent_amendment_scheduled','LEASE',target_lease,
    jsonb_build_object('amendment_id',new_id,'effective_month',target_month,
      'previous_rent',current_amount,'new_rent',new_amount,
      'reason',btrim(change_reason),'document_reference',btrim(signed_addendum_reference)));
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_lease_rent_amendment(uuid,uuid,date,numeric,text,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_lease_rent_amendment(uuid,uuid,date,numeric,text,text,uuid)
 TO authenticated;

-- Preserve original authorization and locking. Apply only registered
-- prospective amendments, never rewrite prior rent periods or receipts.
CREATE OR REPLACE FUNCTION public.create_tenant_rent_period(
 target_org uuid,target_lease uuid,target_period date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  lease_record public.leases%ROWTYPE;
  new_id uuid;
  period_rent numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') THEN
    RAISE EXCEPTION 'Not authorized to create rent periods' USING ERRCODE='42501';
  END IF;
  IF target_period IS NULL OR NOT isfinite(target_period) OR
     extract(day from target_period)<>1 THEN
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
  SELECT COALESCE((
    SELECT a.new_monthly_rent FROM public.lease_rent_amendments a
    WHERE a.organization_id=target_org AND a.lease_id=target_lease
      AND a.effective_month<=target_period
    ORDER BY a.effective_month DESC LIMIT 1
  ),lease_record.monthly_rent) INTO period_rent;
  INSERT INTO public.rent_payments
    (organization_id,lease_id,period_month,expected_amount,paid_amount,status)
  VALUES (target_org,target_lease,target_period,period_rent,0,'PENDING')
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Only zero-paid, zero-receipt, no-statement obligations can be corrected.
CREATE FUNCTION public.correct_unpaid_rent_period(
 target_org uuid,target_payment uuid,corrected_amount numeric,reason text
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  entry public.rent_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') OR
    NOT EXISTS (
      SELECT 1 FROM public.organization_members member
      JOIN public.member_roles mr ON mr.organization_member_id=member.id
      JOIN public.roles role ON role.id=mr.role_id
      WHERE member.organization_id=target_org AND member.user_id=auth.uid()
        AND member.status='ACTIVE' AND role.organization_id=target_org
        AND role.key='ADMIN' AND role.active
    ) THEN
    RAISE EXCEPTION 'Only authorized administrators can correct unpaid rent' USING ERRCODE='42501';
  END IF;
  IF corrected_amount IS NULL OR corrected_amount<=0 OR
     corrected_amount>999999999999.99 OR corrected_amount<>round(corrected_amount,2) OR
     length(btrim(coalesce(reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Invalid amount or correction reason (10-500 characters)' USING ERRCODE='22023';
  END IF;
  -- Lock the lease before the period, matching receipt and statement flows.
  SELECT p.* INTO entry FROM public.rent_payments p
    WHERE p.id=target_payment AND p.organization_id=target_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.leases
    WHERE id=entry.lease_id AND organization_id=target_org FOR UPDATE;
  SELECT * INTO entry FROM public.rent_payments
    WHERE id=target_payment AND organization_id=target_org FOR UPDATE;
  IF NOT FOUND OR entry.status NOT IN ('PENDING','LATE') OR entry.paid_amount<>0 OR
    EXISTS(SELECT 1 FROM public.rent_receipts
      WHERE organization_id=target_org AND rent_payment_id=target_payment) OR
    EXISTS(SELECT 1 FROM public.owner_statements
      WHERE organization_id=target_org AND lease_id=entry.lease_id
        AND period_month=entry.period_month) THEN
    RAISE EXCEPTION 'Paid/partial periods, receipts or owner statements are immutable; request financial review'
      USING ERRCODE='23514';
  END IF;
  IF entry.expected_amount=corrected_amount THEN
    RAISE EXCEPTION 'New amount equals the existing obligation' USING ERRCODE='23514';
  END IF;
  UPDATE public.rent_payments
  SET expected_amount=corrected_amount
  WHERE organization_id=target_org AND id=target_payment;
  INSERT INTO public.audit_log
    (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'rent_period.amount_corrected','RENT_PAYMENT',target_payment,
    jsonb_build_object('period_month',entry.period_month,'lease_id',entry.lease_id,
     'old_amount',entry.expected_amount,'new_amount',corrected_amount,'reason',btrim(reason)));
  RETURN corrected_amount;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_unpaid_rent_period(uuid,uuid,numeric,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.correct_unpaid_rent_period(uuid,uuid,numeric,text)
 TO authenticated;

-- Paid or partial receipts must be corrected through future compensating
-- accounting workflows, not overwritten. This stores an auditable request only.
CREATE FUNCTION public.request_paid_rent_review(
 target_org uuid,target_payment uuid,reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  entry public.rent_payments%ROWTYPE;
  event_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') THEN
    RAISE EXCEPTION 'Not authorized to request rent review' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(reason,''))) NOT BETWEEN 15 AND 500 THEN
    RAISE EXCEPTION 'Review reason must be between 15 and 500 characters' USING ERRCODE='22023';
  END IF;
  SELECT * INTO entry FROM public.rent_payments
    WHERE organization_id=target_org AND id=target_payment;
  IF NOT FOUND OR entry.paid_amount<=0 OR entry.status NOT IN ('PAID','PARTIAL','LATE') THEN
    RAISE EXCEPTION 'Only periods with recorded payments may be reviewed' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.audit_log
    (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'rent_period.review_requested','RENT_PAYMENT',target_payment,
    jsonb_build_object('lease_id',entry.lease_id,'period_month',entry.period_month,
      'expected_amount',entry.expected_amount,'paid_amount',entry.paid_amount,
      'status',entry.status,'reason',btrim(reason)))
  RETURNING id INTO event_id;
  RETURN event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_paid_rent_review(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_paid_rent_review(uuid,uuid,text)
 TO authenticated;
COMMENT ON TABLE public.lease_rent_amendments IS
 'Signed forward-looking rent amendments. No historical receipt or financial statement rewrite.';
COMMIT;
