CREATE OR REPLACE FUNCTION public.correct_owner_draft_commission_percentage(target_org uuid,target_statement uuid,new_percentage numeric,correction_reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE actor uuid:=auth.uid(); old_row public.owner_statements%ROWTYPE; collected numeric; calculated numeric;
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'owner_statements.create')
 OR NOT public.has_org_permission(target_org,'rent_payments.view')
 OR NOT public.commission_is_manager(target_org) THEN
 RAISE EXCEPTION 'Administrator authorization required' USING ERRCODE='42501'; END IF;
 IF new_percentage IS NULL OR new_percentage<0 OR new_percentage>100 OR new_percentage<>round(new_percentage,2)
 THEN RAISE EXCEPTION 'Invalid commission percentage' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(correction_reason,''))) NOT BETWEEN 15 AND 500
 THEN RAISE EXCEPTION 'Reason must contain 15 to 500 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO old_row FROM public.owner_statements WHERE id=target_statement AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR old_row.status<>'DRAFT' THEN RAISE EXCEPTION 'Only draft statements are editable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.owner_statement_deductions WHERE statement_id=target_statement AND organization_id=target_org AND category='COMMISSION' AND status='APPROVED') THEN
 RAISE EXCEPTION 'A detailed commission exists; reconcile it first' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.rent_payments WHERE organization_id=target_org AND lease_id=old_row.lease_id AND period_month=old_row.period_month FOR UPDATE;
 SELECT coalesce(sum(paid_amount),0) INTO collected FROM public.rent_payments WHERE organization_id=target_org AND lease_id=old_row.lease_id AND period_month=old_row.period_month AND status<>'CANCELLED';
 calculated:=round(collected*new_percentage/100,2);
 IF calculated+old_row.tax_amount+old_row.other_deductions>collected THEN
 RAISE EXCEPTION 'Charges exceed collected income' USING ERRCODE='23514'; END IF;
 UPDATE public.owner_statements SET commission_amount=calculated,
 net_amount=collected-calculated-tax_amount-other_deductions
 WHERE id=target_statement AND organization_id=target_org AND status='DRAFT';
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'owner_statement.commission_percentage_corrected','OWNER_STATEMENT',target_statement,
 pg_catalog.jsonb_build_object('old_commission',old_row.commission_amount,'new_commission',calculated,'percentage',new_percentage,
 'base_collected',collected,'reason',btrim(correction_reason)));
 RETURN calculated;
END;$fn$;
REVOKE ALL ON FUNCTION public.correct_owner_draft_commission_percentage(uuid,uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_owner_draft_commission_percentage(uuid,uuid,numeric,text) TO authenticated;