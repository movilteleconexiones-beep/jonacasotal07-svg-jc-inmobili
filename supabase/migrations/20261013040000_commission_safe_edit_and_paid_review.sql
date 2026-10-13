-- Auditable corrections, soft cancellation, and independent approval of
-- financial commission review requests. No paid commission is overwritten.
BEGIN;
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS calculation_basis numeric(14,2);
ALTER TABLE public.commissions ADD CONSTRAINT commissions_calculation_basis_positive
 CHECK (calculation_basis IS NULL OR calculation_basis>0);
ALTER TABLE public.commissions ADD CONSTRAINT commissions_percentage_range
 CHECK (percentage IS NULL OR (percentage BETWEEN 0 AND 100 AND percentage=round(percentage,2)));

-- Block direct authenticated client PATCH/DELETE irrespective of permissive
-- legacy RLS policies; only authorized SECURITY DEFINER RPCs can update.
REVOKE UPDATE, DELETE ON public.commissions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.commission_is_manager(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE m.user_id=auth.uid() AND m.organization_id=target_org
     AND m.status='ACTIVE' AND r.organization_id=target_org AND r.active
     AND r.key IN ('ADMIN','ORGANIZATION_OWNER')
 );
$$;
REVOKE ALL ON FUNCTION public.commission_is_manager(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_commission_financial_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Commissions cannot be physically deleted; use audited cancellation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'PENDING' OR NEW.paid_at IS NOT NULL THEN
     RAISE EXCEPTION 'New commissions must begin PENDING with no paid timestamp' USING ERRCODE='23514';
   END IF;
   -- For interactive Data API inserts, require a percentage + declared basis.
   IF current_user IN ('authenticated','anon') THEN
     IF auth.uid() IS NULL OR
        NOT public.has_org_permission(NEW.organization_id,'commissions.create') OR
        NEW.created_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized commission creation' USING ERRCODE='42501';
     END IF;
     IF NEW.calculation_basis IS NULL THEN
       RAISE EXCEPTION 'Calculation basis is required for a new commission' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF TG_OP='UPDATE' THEN
   IF OLD.status='PAID' OR OLD.paid_at IS NOT NULL THEN
     RAISE EXCEPTION 'Paid commission history is immutable; request review instead' USING ERRCODE='23514';
   END IF;
   IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR
      NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at OR
      NEW.paid_at IS NOT NULL AND NEW.status<>'PAID' THEN
     RAISE EXCEPTION 'Identity and payment timestamps are server-owned' USING ERRCODE='23514';
   END IF;
   NEW.updated_at:=statement_timestamp();
 END IF;
 IF NEW.percentage IS NOT NULL AND NEW.calculation_basis IS NOT NULL THEN
   IF NEW.amount IS DISTINCT FROM round(NEW.percentage*NEW.calculation_basis/100,2) THEN
     RAISE EXCEPTION 'Commission amount must equal rate times calculation basis' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_commission_financial_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_commission_financial_history
 BEFORE INSERT OR UPDATE OR DELETE ON public.commissions FOR EACH ROW
 EXECUTE FUNCTION public.guard_commission_financial_history();

CREATE TABLE public.commission_review_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 commission_id uuid NOT NULL REFERENCES public.commissions(id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL,
 request_type text NOT NULL CHECK(request_type IN('EDIT','VOID')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 15 AND 500),
 proposed_values jsonb NOT NULL DEFAULT '{}'::jsonb,
 original_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid,
 reviewed_at timestamptz,
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT commission_review_decision_integrity CHECK (
   (status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR
   (status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND
    length(btrim(review_reason)) BETWEEN 10 AND 500)
 )
);
CREATE INDEX commission_review_tenant_idx ON public.commission_review_requests
 (organization_id,commission_id,created_at DESC);
CREATE UNIQUE INDEX commission_review_only_one_pending ON public.commission_review_requests
 (organization_id,commission_id) WHERE status='PENDING';
ALTER TABLE public.commission_review_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_review_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.commission_review_requests TO authenticated;
CREATE POLICY commission_review_view ON public.commission_review_requests
 FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'commissions.view'));

CREATE FUNCTION public.edit_unpaid_commission(
 target_org uuid,target_commission uuid,target_deal uuid,target_beneficiary uuid,
 target_type text,target_percentage numeric,target_basis numeric,
 target_due_date date,target_notes text,correction_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.commissions%ROWTYPE; new_amount numeric; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
   RAISE EXCEPTION 'No permission to edit commissions' USING ERRCODE='42501';
 END IF;
 IF target_percentage IS NULL OR target_percentage NOT BETWEEN 0 AND 100 OR
    target_percentage<>round(target_percentage,2) OR
    target_basis IS NULL OR target_basis<=0 OR target_basis>999999999999.99 OR
    target_basis<>round(target_basis,2) OR
    target_type NOT IN ('AGENT','CAPTOR','COORDINATOR','REFERRAL','COMPANY','OTHER') OR
    length(btrim(coalesce(correction_reason,''))) NOT BETWEEN 10 AND 500 OR
    length(coalesce(target_notes,''))>2000 THEN
   RAISE EXCEPTION 'Invalid commission values or correction reason' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.deals d WHERE d.id=target_deal AND d.organization_id=target_org)
 OR (target_beneficiary IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.organization_members m WHERE m.organization_id=target_org
      AND m.user_id=target_beneficiary AND m.status='ACTIVE'
 )) THEN RAISE EXCEPTION 'Invalid business or beneficiary for this agency' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM public.commissions
  WHERE organization_id=target_org AND id=target_commission FOR UPDATE;
 IF NOT FOUND OR c.status IN('PAID','CANCELLED') OR c.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paid/cancelled commissions cannot be edited; request review' USING ERRCODE='23514';
 END IF;
 IF c.status IN('APPROVED','PAYABLE') AND NOT public.commission_is_manager(target_org) THEN
    RAISE EXCEPTION 'Approved or payable commissions require administrator authorization' USING ERRCODE='42501';
 END IF;
 new_amount:=round(target_basis*target_percentage/100,2);
 UPDATE public.commissions SET deal_id=target_deal,beneficiary_user_id=target_beneficiary,
  commission_type=target_type,percentage=target_percentage,calculation_basis=target_basis,
  amount=new_amount,due_date=target_due_date,notes=nullif(btrim(target_notes),'')
 WHERE id=target_commission AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.corrected','COMMISSION',target_commission,
    jsonb_build_object('reason',btrim(correction_reason),
      'before',jsonb_build_object('deal_id',c.deal_id,'beneficiary_user_id',c.beneficiary_user_id,
      'commission_type',c.commission_type,'percentage',c.percentage,'amount',c.amount,
      'calculation_basis',c.calculation_basis,'due_date',c.due_date,'notes',c.notes),
      'after',jsonb_build_object('deal_id',target_deal,'beneficiary_user_id',target_beneficiary,
      'commission_type',target_type,'percentage',target_percentage,'amount',new_amount,
      'calculation_basis',target_basis,'due_date',target_due_date,'notes',target_notes)));
 RETURN target_commission;
END;
$$;

CREATE FUNCTION public.cancel_unpaid_commission(
 target_org uuid,target_commission uuid,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.commissions%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
    RAISE EXCEPTION 'No permission to cancel a commission' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Explain the cancellation (10–500 characters)' USING ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public.commissions WHERE id=target_commission AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR c.status IN('PAID','CANCELLED') OR c.paid_at IS NOT NULL THEN
   RAISE EXCEPTION 'Paid/cancelled commissions require review and cannot be voided directly' USING ERRCODE='23514';
 END IF;
 IF c.status IN('APPROVED','PAYABLE') AND NOT public.commission_is_manager(target_org) THEN
    RAISE EXCEPTION 'Administrator authorization required' USING ERRCODE='42501';
 END IF;
 UPDATE public.commissions SET status='CANCELLED' WHERE id=target_commission AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.cancelled','COMMISSION',target_commission,
    jsonb_build_object('reason',btrim(reason),'previous_status',c.status,
      'original_amount',c.amount,'original_percentage',c.percentage));
 RETURN target_commission;
END;
$$;

CREATE FUNCTION public.set_commission_status_audited(
 target_org uuid,target_commission uuid,new_status text,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.commissions%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
   RAISE EXCEPTION 'No permission to update commissions' USING ERRCODE='42501';
 END IF;
 IF new_status NOT IN ('PENDING','APPROVED','PAYABLE','PAID') OR
    length(btrim(coalesce(reason,''))) NOT BETWEEN 10 AND 500 THEN
   RAISE EXCEPTION 'Invalid status or audit reason (10–500 characters)' USING ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public.commissions WHERE organization_id=target_org AND id=target_commission FOR UPDATE;
 IF NOT FOUND OR c.status IN('PAID','CANCELLED') OR c.paid_at IS NOT NULL OR c.status=new_status THEN
   RAISE EXCEPTION 'Paid, cancelled or unchanged commission status cannot be overwritten' USING ERRCODE='23514';
 END IF;
 IF new_status='PAID' OR c.status IN ('APPROVED','PAYABLE') OR new_status IN ('APPROVED','PAYABLE') THEN
   IF NOT public.commission_is_manager(target_org) THEN
     RAISE EXCEPTION 'Administrator authorization is required to approve or mark commissions paid' USING ERRCODE='42501';
   END IF;
 END IF;
 IF new_status='PAID' AND c.status NOT IN ('APPROVED','PAYABLE') THEN
   RAISE EXCEPTION 'Approve a commission before recording it as paid' USING ERRCODE='23514';
 END IF;
 UPDATE public.commissions SET status=new_status,
  paid_at=CASE WHEN new_status='PAID' THEN statement_timestamp() ELSE NULL END
  WHERE id=target_commission AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.status_changed','COMMISSION',target_commission,
    jsonb_build_object('before',c.status,'after',new_status,'reason',btrim(reason),
      'amount',c.amount,'bank_transfer_executed',false));
 RETURN target_commission;
END;
$$;

CREATE FUNCTION public.request_paid_commission_review(
 target_org uuid,target_commission uuid,kind text,reason text,
 proposed_percentage numeric DEFAULT NULL,proposed_basis numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.commissions%ROWTYPE; new_id uuid; proposal jsonb:='{}'::jsonb; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
    RAISE EXCEPTION 'No permission to request review' USING ERRCODE='42501';
 END IF;
 IF kind NOT IN('EDIT','VOID') OR length(btrim(coalesce(reason,''))) NOT BETWEEN 15 AND 500 THEN
    RAISE EXCEPTION 'Explain the requested paid-commission change (15–500 characters)' USING ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public.commissions
 WHERE organization_id=target_org AND id=target_commission FOR UPDATE;
 IF NOT FOUND OR c.status<>'PAID' OR c.paid_at IS NULL THEN
   RAISE EXCEPTION 'Only paid commissions require this approval workflow' USING ERRCODE='23514';
 END IF;
 IF kind='EDIT' THEN
   IF proposed_percentage IS NULL OR proposed_percentage NOT BETWEEN 0 AND 100 OR
     proposed_percentage<>round(proposed_percentage,2) OR
     proposed_basis IS NULL OR proposed_basis<=0 OR proposed_basis>999999999999.99 OR
     proposed_basis<>round(proposed_basis,2) THEN
     RAISE EXCEPTION 'Invalid proposed percentage or calculation basis' USING ERRCODE='22023';
   END IF;
   proposal:=jsonb_build_object('percentage',proposed_percentage,
     'calculation_basis',proposed_basis,'amount',round(proposed_basis*proposed_percentage/100,2));
 END IF;
 INSERT INTO public.commission_review_requests
  (organization_id,commission_id,requested_by,request_type,reason,proposed_values,original_snapshot)
 VALUES(target_org,target_commission,actor,kind,btrim(reason),proposal,
  jsonb_build_object('status',c.status,'deal_id',c.deal_id,
   'beneficiary_user_id',c.beneficiary_user_id,'percentage',c.percentage,
   'calculation_basis',c.calculation_basis,'amount',c.amount,'paid_at',c.paid_at))
 RETURNING id INTO new_id;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.review_requested','COMMISSION',target_commission,
   jsonb_build_object('request_id',new_id,'kind',kind,'reason',btrim(reason),
     'proposal',proposal,'original_amount',c.amount));
 RETURN new_id;
END;
$$;

CREATE FUNCTION public.decide_paid_commission_review(
 target_org uuid,target_request uuid,decision text,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE review public.commission_review_requests%ROWTYPE; c public.commissions%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
 OR NOT public.commission_is_manager(target_org) THEN
    RAISE EXCEPTION 'Only a responsible administrator may review paid commissions' USING ERRCODE='42501';
 END IF;
 IF decision NOT IN('APPROVED','REJECTED') OR
    length(btrim(coalesce(reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Decision and reason are required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO review FROM public.commission_review_requests
  WHERE id=target_request AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR review.status<>'PENDING' OR review.requested_by=actor THEN
    RAISE EXCEPTION 'Review missing, already resolved or self-approval not allowed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM public.commissions WHERE id=review.commission_id
  AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR c.status<>'PAID' OR c.paid_at IS NULL THEN
    RAISE EXCEPTION 'Original paid entry must remain intact during review' USING ERRCODE='23514';
 END IF;
 UPDATE public.commission_review_requests
 SET status=decision,reviewed_by=actor,reviewed_at=statement_timestamp(),review_reason=btrim(reason)
 WHERE id=target_request AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.review_decided','COMMISSION',review.commission_id,
    jsonb_build_object('request_id',target_request,'decision',decision,
      'review_reason',btrim(reason),'requires_compensating_entry',decision='APPROVED',
      'original_amount',c.amount));
 -- An approval authorizes the accounting team to prepare a separately audited
 -- compensating entry. It deliberately DOES NOT rewrite a paid ledger record.
 RETURN target_request;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_unpaid_commission(uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_unpaid_commission(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_commission_status_audited(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_paid_commission_review(uuid,uuid,text,text,numeric,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_paid_commission_review(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_unpaid_commission(uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_commission(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_commission_status_audited(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_paid_commission_review(uuid,uuid,text,text,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_paid_commission_review(uuid,uuid,text,text) TO authenticated;
COMMIT;
