CREATE OR REPLACE FUNCTION public.admin_record_commission_paid(
 target_org uuid,target_commission uuid,payment_reference text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $func$
DECLARE actor uuid:=auth.uid(); c public.commissions%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
  OR NOT public.commission_is_manager(target_org) THEN
  RAISE EXCEPTION 'Administrator permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(payment_reference,''))) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Real payment evidence or reference required (10-500 characters)' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.commissions
 WHERE id=target_commission AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN('PENDING','APPROVED','PAYABLE') OR c.paid_at IS NOT NULL THEN
  RAISE EXCEPTION 'Only unpaid active commissions may be marked paid' USING ERRCODE='23514'; END IF;
 UPDATE public.commissions SET status='PAID',paid_at=statement_timestamp()
 WHERE id=c.id AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.admin_marked_paid','COMMISSION',c.id,
 jsonb_build_object('before',c.status,'after','PAID','amount',c.amount,
 'payment_evidence',btrim(payment_reference),'cash_transfer_performed_by_software',false));
 RETURN c.id;
END;
$func$;
REVOKE ALL ON FUNCTION public.admin_record_commission_paid(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_record_commission_paid(uuid,uuid,text) TO authenticated;