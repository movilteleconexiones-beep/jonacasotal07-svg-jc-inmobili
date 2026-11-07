-- Archiving affects presentation only: the source review and payment records remain intact.
ALTER TABLE public.commission_review_requests
 ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.admin_archive_commission_review(p_review_id uuid,p_organization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','auth'
AS $$
DECLARE v_status text; v_actor uuid := auth.uid();
BEGIN
 IF v_actor IS NULL OR NOT public.commission_is_manager(p_organization_id) THEN
   RAISE EXCEPTION 'Administrator permission required' USING ERRCODE='42501';
 END IF;
 SELECT status INTO v_status FROM public.commission_review_requests
 WHERE id=p_review_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='P0002'; END IF;
 IF v_status='PENDING' THEN RAISE EXCEPTION 'Pending reviews cannot be archived' USING ERRCODE='23514'; END IF;
 UPDATE public.commission_review_requests SET archived_at=COALESCE(archived_at,now()),
 archived_by=COALESCE(archived_by,v_actor)
 WHERE id=p_review_id AND organization_id=p_organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_commission_review(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_commission_review(uuid,uuid) TO authenticated;
