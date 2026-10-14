-- Administrative issuance is not proof of disbursement. Preserve financial data.
ALTER TABLE public.owner_statements
 ADD COLUMN IF NOT EXISTS issued_at timestamptz,
 ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.admin_issue_owner_statement(p_statement_id uuid,p_organization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','auth'
AS $$
DECLARE
 v_statement public.owner_statements%ROWTYPE;
 v_deductions numeric;
 v_pending integer;
BEGIN
 IF auth.uid() IS NULL
   OR NOT public.commission_is_manager(p_organization_id)
   OR NOT public.has_org_permission(p_organization_id,'owner_statements.create') THEN
   RAISE EXCEPTION 'No tienes permiso para confirmar la emisión' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_statement FROM public.owner_statements
 WHERE id=p_statement_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada' USING ERRCODE='P0002'; END IF;
 IF v_statement.status <> 'DRAFT' THEN
   RAISE EXCEPTION 'Solo se pueden emitir liquidaciones en borrador' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER'),0),
 count(*) FILTER(WHERE status='DRAFT')
 INTO v_deductions,v_pending
 FROM public.owner_statement_deductions
 WHERE statement_id=p_statement_id AND organization_id=p_organization_id;
 IF v_pending>0 THEN RAISE EXCEPTION 'Existen deducciones sin resolver' USING ERRCODE='23514'; END IF;
 IF v_deductions <> v_statement.other_deductions THEN
   RAISE EXCEPTION 'Las deducciones aprobadas no coinciden con el extracto' USING ERRCODE='23514';
 END IF;
 IF v_statement.net_amount <> v_statement.gross_income-v_statement.commission_amount-v_statement.tax_amount-v_statement.other_deductions THEN
   RAISE EXCEPTION 'La liquidación no está conciliada' USING ERRCODE='23514';
 END IF;
 UPDATE public.owner_statements SET status='GENERATED',issued_at=now(),issued_by=auth.uid()
 WHERE id=p_statement_id AND organization_id=p_organization_id AND status='DRAFT';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_issue_owner_statement(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_owner_statement(uuid,uuid) TO authenticated;
