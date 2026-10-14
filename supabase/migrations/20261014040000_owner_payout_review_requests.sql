CREATE TABLE IF NOT EXISTS public.owner_payout_review_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 payout_id uuid NOT NULL REFERENCES public.owner_statement_payouts(id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL REFERENCES auth.users(id),
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 15 AND 500),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED','REJECTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 review_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_payout_one_pending_review ON public.owner_payout_review_requests(organization_id,payout_id) WHERE status='PENDING';
ALTER TABLE public.owner_payout_review_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_payout_review_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_payout_review_requests TO authenticated;
CREATE POLICY owner_payout_review_read ON public.owner_payout_review_requests FOR SELECT TO authenticated
 USING (public.has_org_permission(organization_id,'owner_statements.view'));

CREATE OR REPLACE FUNCTION public.request_owner_payout_review(p_organization_id uuid,p_payout_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','auth'
AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_org_permission(p_organization_id,'owner_statements.view') THEN
   RAISE EXCEPTION 'Sin permiso para solicitar revisión' USING ERRCODE='42501';
 END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 15 AND 500 THEN
   RAISE EXCEPTION 'Motivo debe tener entre 15 y 500 caracteres' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.owner_statement_payouts
 WHERE id=p_payout_id AND organization_id=p_organization_id) THEN
   RAISE EXCEPTION 'Abono no encontrado' USING ERRCODE='P0002';
 END IF;
 IF EXISTS(SELECT 1 FROM public.owner_payout_review_requests
 WHERE payout_id=p_payout_id AND organization_id=p_organization_id AND status='PENDING') THEN
   RAISE EXCEPTION 'Ya existe una solicitud de revisión pendiente' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.owner_payout_review_requests(organization_id,payout_id,requested_by,reason)
 VALUES(p_organization_id,p_payout_id,auth.uid(),trim(p_reason)) RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_owner_payout_review(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_owner_payout_review(uuid,uuid,text) TO authenticated;
