-- Decisions are audit-only. They never mutate original payments or owner statements.
CREATE OR REPLACE FUNCTION public.admin_decide_owner_payout_review(
 p_organization_id uuid,p_review_id uuid,p_decision text,p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','auth'
AS $$
DECLARE v_review public.owner_payout_review_requests%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.commission_is_manager(p_organization_id)
   OR NOT public.has_org_permission(p_organization_id,'owner_statements.create') THEN
   RAISE EXCEPTION 'Solo el administrador puede resolver revisiones de abonos' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('RESOLVED','REJECTED') OR
    length(trim(coalesce(p_note,''))) NOT BETWEEN 15 AND 500 THEN
   RAISE EXCEPTION 'Decisión o justificación inválida' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_review FROM public.owner_payout_review_requests
 WHERE id=p_review_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE='P0002'; END IF;
 IF v_review.status <> 'PENDING' THEN
   RAISE EXCEPTION 'La solicitud ya fue resuelta' USING ERRCODE='23514';
 END IF;
 UPDATE public.owner_payout_review_requests SET status=p_decision,
   reviewed_by=auth.uid(),reviewed_at=now(),review_note=trim(p_note)
 WHERE id=p_review_id AND organization_id=p_organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_decide_owner_payout_review(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_owner_payout_review(uuid,uuid,text,text) TO authenticated;
