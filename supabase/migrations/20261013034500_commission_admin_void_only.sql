-- Restrict commission cancellation to organizational managers in the RPC itself.
CREATE OR REPLACE FUNCTION public.cancel_unpaid_commission(target_org uuid, target_commission uuid, reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c public.commissions%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
    OR NOT public.commission_is_manager(target_org) THEN
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
$function$


CREATE OR REPLACE FUNCTION public.request_paid_commission_review(target_org uuid, target_commission uuid, kind text, reason text, proposed_percentage numeric DEFAULT NULL::numeric, proposed_basis numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c public.commissions%ROWTYPE; new_id uuid; proposal jsonb:='{}'::jsonb; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
    RAISE EXCEPTION 'No permission to request review' USING ERRCODE='42501';
 END IF;
 IF kind='VOID' AND NOT public.commission_is_manager(target_org) THEN
   RAISE EXCEPTION 'Only an administrator can request commission cancellation' USING ERRCODE='42501';
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
$function$

