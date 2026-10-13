CREATE TABLE IF NOT EXISTS public.owner_deduction_replacements (
 original_deduction_id uuid PRIMARY KEY REFERENCES public.owner_statement_deductions(id),
 replacement_deduction_id uuid NOT NULL UNIQUE REFERENCES public.owner_statement_deductions(id),
 organization_id uuid NOT NULL,
 created_by uuid NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_deduction_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_deduction_replacements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_deduction_replacements TO authenticated;
CREATE POLICY deduction_replacements_read ON public.owner_deduction_replacements FOR SELECT TO authenticated
 USING(public.has_org_permission(organization_id,'owner_statements.view'));

CREATE OR REPLACE FUNCTION public.restore_voided_owner_deduction(
 target_org uuid,target_deduction uuid,restore_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $func$
DECLARE actor uuid:=auth.uid(); old_entry public.owner_statement_deductions%ROWTYPE; new_id uuid;
BEGIN
 IF actor IS NULL OR NOT public.commission_is_manager(target_org)
 OR NOT public.has_org_permission(target_org,'owner_statements.create') THEN
  RAISE EXCEPTION 'Only the organization administrator may restore a deduction' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(restore_reason,''))) NOT BETWEEN 15 AND 500 THEN
  RAISE EXCEPTION 'A reason of 15-500 characters is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old_entry FROM public.owner_statement_deductions
 WHERE id=target_deduction AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR old_entry.status<>'VOIDED' THEN
  RAISE EXCEPTION 'Only voided deductions may be restored' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.owner_statements WHERE id=old_entry.statement_id
  AND organization_id=target_org AND status='DRAFT' FOR UPDATE) THEN
  RAISE EXCEPTION 'Statement must be in draft status' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.owner_deduction_replacements WHERE original_deduction_id=target_deduction) THEN
  RAISE EXCEPTION 'Deduction already restored' USING ERRCODE='23514'; END IF;
 INSERT INTO public.owner_statement_deductions
 (organization_id,statement_id,charge_date,category,responsible_party,amount,
 description,support_reference,status,created_by)
 VALUES(target_org,old_entry.statement_id,old_entry.charge_date,old_entry.category,
 old_entry.responsible_party,old_entry.amount,
 concat('Recuperada para revisión: ',old_entry.description),old_entry.support_reference,'DRAFT',actor)
 RETURNING id INTO new_id;
 INSERT INTO public.owner_deduction_replacements(original_deduction_id,replacement_deduction_id,organization_id,created_by,reason)
 VALUES(target_deduction,new_id,target_org,actor,btrim(restore_reason));
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,actor,'owner_deductions.restored_as_draft','OWNER_STATEMENT_DEDUCTION',new_id,
 jsonb_build_object('previous_id',target_deduction,'reason',btrim(restore_reason),'amount',old_entry.amount,'original_preserved',true));
 RETURN new_id;
END;
$func$;
REVOKE ALL ON FUNCTION public.restore_voided_owner_deduction(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_voided_owner_deduction(uuid,uuid,text) TO authenticated;