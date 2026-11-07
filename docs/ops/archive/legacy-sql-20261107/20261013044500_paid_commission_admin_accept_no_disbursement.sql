-- Administrative review for a PAID marker entered in error without actual cash disbursement.
-- Paid commission row remains immutable and every decision is audited.
CREATE OR REPLACE FUNCTION public.accept_erroneous_paid_commission_review(
 target_org uuid, target_request uuid, confirmation_no_disbursement boolean,
 approval_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=auth.uid(); req public.commission_review_requests%ROWTYPE;
 c public.commissions%ROWTYPE; correction public.commission_accounting_corrections%ROWTYPE;
 new_basis numeric; new_rate numeric; new_amount numeric;
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
    OR NOT public.commission_is_manager(target_org) THEN
   RAISE EXCEPTION 'Administrator authorization required' USING ERRCODE='42501';
 END IF;
 IF confirmation_no_disbursement IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Written confirmation of no cash disbursement is mandatory' USING ERRCODE='22023';
 END IF;
 IF length(btrim(coalesce(approval_reason,''))) NOT BETWEEN 20 AND 500 THEN
   RAISE EXCEPTION 'State the correction reason (20-500 characters)' USING ERRCODE='22023';
 END IF;
 SELECT * INTO req FROM public.commission_review_requests
  WHERE id=target_request AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR req.status<>'PENDING' OR req.request_type NOT IN ('VOID','EDIT') THEN
   RAISE EXCEPTION 'Pending commission review not found' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM public.commissions
  WHERE id=req.commission_id AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR c.status<>'PAID' OR c.paid_at IS NULL THEN
   RAISE EXCEPTION 'Commission must be marked paid for this correction' USING ERRCODE='23514';
 END IF;
 SELECT * INTO correction FROM public.commission_accounting_corrections
  WHERE commission_id=c.id AND organization_id=target_org;
 IF NOT FOUND THEN
   IF req.request_type='VOID' THEN
     new_basis:=coalesce(c.calculation_basis,1); new_rate:=0; new_amount:=0;
   ELSE
     new_basis:=(req.proposed_values->>'calculation_basis')::numeric;
     new_rate:=(req.proposed_values->>'percentage')::numeric;
     IF new_basis IS NULL OR new_basis<=0 OR new_rate IS NULL OR new_rate<0 OR new_rate>100 THEN
       RAISE EXCEPTION 'Invalid review proposal' USING ERRCODE='22023';
     END IF;
     new_amount:=round(new_basis*new_rate/100,2);
   END IF;
   IF new_amount>c.amount THEN
     RAISE EXCEPTION 'Correction cannot increase a falsely paid amount' USING ERRCODE='23514';
   END IF;
   INSERT INTO public.commission_accounting_corrections
    (organization_id,commission_id,review_request_id,original_amount,correct_basis,
     correct_percentage,corrected_amount,money_disbursed,reason,confirmed_by)
   VALUES(target_org,c.id,req.id,c.amount,new_basis,new_rate,new_amount,false,
     btrim(approval_reason),actor);
 ELSE
   new_amount:=correction.corrected_amount;
 END IF;
 UPDATE public.commission_review_requests
 SET status='APPROVED',reviewed_by=actor,reviewed_at=statement_timestamp(),
     review_reason=btrim(approval_reason)
 WHERE id=req.id AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.no_disbursement_review_approved','COMMISSION',c.id,
 jsonb_build_object('request_id',req.id,'original_amount',c.amount,'corrected_amount',new_amount,
 'difference_amount',c.amount-new_amount,'no_disbursement_confirmed',true,
 'self_authorized',actor=req.requested_by,'reason',btrim(approval_reason)));
 RETURN req.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_erroneous_paid_commission_review(uuid,uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_erroneous_paid_commission_review(uuid,uuid,boolean,text) TO authenticated;
