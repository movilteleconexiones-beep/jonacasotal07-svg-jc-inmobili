-- Hide rectified erroneous commissions from active workflows without deleting immutable accounting evidence.
ALTER TABLE public.commission_accounting_corrections
 ADD COLUMN IF NOT EXISTS archived_from_active boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS archived_by uuid,
 ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE OR REPLACE FUNCTION public.archive_rectified_commission(
 target_org uuid, target_commission uuid, reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $func$
DECLARE actor uuid:=auth.uid(); c public.commissions%ROWTYPE; correction public.commission_accounting_corrections%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.has_org_permission(target_org,'commissions.edit')
   OR NOT public.commission_is_manager(target_org) THEN
   RAISE EXCEPTION 'Only the organization administrator can archive commissions' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(reason,''))) NOT BETWEEN 15 AND 500 THEN
   RAISE EXCEPTION 'Archive justification requires 15 to 500 characters' USING ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public.commissions WHERE id=target_commission AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commission not found' USING ERRCODE='23514'; END IF;
 SELECT * INTO correction FROM public.commission_accounting_corrections
  WHERE commission_id=c.id AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR correction.archived_from_active THEN
   RAISE EXCEPTION 'Commission is not rectified or is already archived' USING ERRCODE='23514';
 END IF;
 UPDATE public.commission_accounting_corrections
 SET archived_from_active=true,archived_at=statement_timestamp(),
     archived_by=actor,archive_reason=btrim(reason)
 WHERE id=correction.id;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.rectified_archived','COMMISSION',c.id,
  jsonb_build_object('reason',btrim(reason),'original_amount',c.amount,
  'corrected_amount',correction.corrected_amount,'preserved_ledger',true));
 RETURN c.id;
END;
$func$;
REVOKE ALL ON FUNCTION public.archive_rectified_commission(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_rectified_commission(uuid,uuid,text) TO authenticated;
