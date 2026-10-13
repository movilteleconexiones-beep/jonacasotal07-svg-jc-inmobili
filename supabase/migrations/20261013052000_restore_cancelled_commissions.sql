CREATE OR REPLACE FUNCTION public.restore_cancelled_commission(target_org uuid,target_commission uuid,correction_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $func$
DECLARE actor uuid:=auth.uid(); c public.commissions%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
 OR NOT public.commission_is_manager(target_org) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(correction_reason,''))) NOT BETWEEN 15 AND 500 THEN
 RAISE EXCEPTION 'Reason must contain 15-500 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.commissions WHERE id=target_commission AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR c.status<>'CANCELLED' OR c.paid_at IS NOT NULL THEN
 RAISE EXCEPTION 'Only cancelled never-paid commissions can be restored' USING ERRCODE='23514'; END IF;
 UPDATE public.commissions SET status='PENDING' WHERE id=c.id AND organization_id=target_org;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.cancelled_restored','COMMISSION',c.id,
 jsonb_build_object('previous_status','CANCELLED','new_status','PENDING',
 'reason',btrim(correction_reason),'amount',c.amount));
 RETURN c.id;
END;
$func$;
REVOKE ALL ON FUNCTION public.restore_cancelled_commission(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_commission(uuid,uuid,text) TO authenticated;