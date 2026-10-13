-- Recover an archived, incorrectly marked paid commission as a NEW editable commission.
-- Keep historical paid entry immutable and archived to avoid duplicate ledger movements.
CREATE TABLE IF NOT EXISTS public.commission_replacements (
 original_commission_id uuid PRIMARY KEY REFERENCES public.commissions(id),
 replacement_commission_id uuid NOT NULL UNIQUE REFERENCES public.commissions(id),
 organization_id uuid NOT NULL,
 created_by uuid NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_replacements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.commission_replacements TO authenticated;
CREATE POLICY commission_replacements_read ON public.commission_replacements FOR SELECT TO authenticated
 USING(public.has_org_permission(organization_id,'commissions.view'));

CREATE OR REPLACE FUNCTION public.replace_archived_commission(
 target_org uuid,target_commission uuid,correction_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $func$
DECLARE actor uuid:=auth.uid(); old_row public.commissions%ROWTYPE;
 corr public.commission_accounting_corrections%ROWTYPE; new_id uuid;
BEGIN
 IF actor IS NULL OR NOT public.commission_is_manager(target_org)
 OR NOT public.has_org_permission(target_org,'commissions.edit') THEN
   RAISE EXCEPTION 'Administrator permission required' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(correction_reason,''))) NOT BETWEEN 15 AND 500 THEN
   RAISE EXCEPTION 'Reason must contain 15-500 characters' USING ERRCODE='22023';
 END IF;
 SELECT * INTO old_row FROM public.commissions
 WHERE id=target_commission AND organization_id=target_org FOR UPDATE;
 SELECT * INTO corr FROM public.commission_accounting_corrections
 WHERE commission_id=target_commission AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR NOT corr.archived_from_active OR old_row.id IS NULL THEN
   RAISE EXCEPTION 'Only archived rectified commissions can be replaced' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.commission_replacements WHERE original_commission_id=target_commission) THEN
   RAISE EXCEPTION 'A replacement already exists for this commission' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.commissions
 (organization_id,deal_id,beneficiary_user_id,commission_type,percentage,calculation_basis,amount,currency,status,due_date,notes,created_by)
 VALUES(target_org,old_row.deal_id,old_row.beneficiary_user_id,old_row.commission_type,
 corr.correct_percentage,corr.correct_basis,corr.corrected_amount,old_row.currency,'PENDING',
 old_row.due_date,concat('Reemplazo de comisión retirada: ',left(btrim(correction_reason),250)),actor)
 RETURNING id INTO new_id;
 INSERT INTO public.commission_replacements(original_commission_id,replacement_commission_id,organization_id,created_by,reason)
 VALUES(target_commission,new_id,target_org,actor,btrim(correction_reason));
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'commissions.archived_replaced','COMMISSION',new_id,
 jsonb_build_object('original_id',target_commission,'corrected_amount',corr.corrected_amount,
 'previous_paid_history_preserved',true,'reason',btrim(correction_reason)));
 RETURN new_id;
END;
$func$;
REVOKE ALL ON FUNCTION public.replace_archived_commission(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_archived_commission(uuid,uuid,text) TO authenticated;
