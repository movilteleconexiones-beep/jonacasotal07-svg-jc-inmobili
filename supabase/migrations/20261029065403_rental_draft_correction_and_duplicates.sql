-- Prevent overlapping draft/active contracts and repeated signed PDF uploads.
-- Preserve all historical contracts, PDFs, financial records and audit trails.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leases
    WHERE status IN ('DRAFT','ACTIVE','RENEWAL')
    GROUP BY organization_id,property_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Existing overlapping draft/active contracts must be reviewed first';
  END IF;
END $check$;

CREATE UNIQUE INDEX IF NOT EXISTS leases_one_open_contract_per_property
  ON public.leases(organization_id,property_id)
  WHERE status IN ('DRAFT','ACTIVE','RENEWAL');

-- No automatic deletion of previously uploaded copies. Existing duplicated
-- PDFs require an explicit administrator review; new copies are blocked.
CREATE OR REPLACE FUNCTION jco_private.prevent_repeated_signed_lease_pdf()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $guard$
BEGIN
  IF NEW.entity_type='GENERAL' AND NEW.document_type='CONTRACT'
     AND NEW.storage_bucket='organization-documents'
     AND NEW.entity_id IS NOT NULL
     AND NEW.storage_path LIKE
       NEW.organization_id::text||'/leases/'||NEW.entity_id::text||'/signed/%.pdf'
  THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtext(NEW.organization_id::text),
       pg_catalog.hashtext(NEW.entity_id::text));
    IF EXISTS (
      SELECT 1 FROM public.documents existing
      WHERE existing.organization_id=NEW.organization_id
        AND existing.entity_type='GENERAL' AND existing.entity_id=NEW.entity_id
        AND existing.document_type='CONTRACT'
        AND existing.storage_bucket='organization-documents'
        AND existing.storage_path LIKE
          NEW.organization_id::text||'/leases/'||NEW.entity_id::text||'/signed/%.pdf'
    ) THEN
      RAISE EXCEPTION 'This lease already has a signed PDF. Contact the administrator to review existing documents before uploading a replacement.'
      USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION jco_private.prevent_repeated_signed_lease_pdf() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jco_unique_signed_lease_pdf ON public.documents;
CREATE TRIGGER jco_unique_signed_lease_pdf
BEFORE INSERT ON public.documents FOR EACH ROW
EXECUTE FUNCTION jco_private.prevent_repeated_signed_lease_pdf();

CREATE OR REPLACE FUNCTION public.admin_correct_lease_draft(
  target_org uuid,target_lease uuid,target_property uuid,target_tenant uuid,
  target_owner uuid,target_monthly_rent numeric,target_start date,target_end date,
  target_contract_number text,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $rpc$
DECLARE before_row public.leases%ROWTYPE; prop_status text; prop_operation text; n integer;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.is_rental_lifecycle_admin(target_org) OR
     NOT public.has_org_permission(target_org,'leases.edit') THEN
    RAISE EXCEPTION 'Administrative authorization required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(reason,'')))<12 OR length(btrim(reason))>500 THEN
    RAISE EXCEPTION 'Correction reason must have 12-500 characters' USING ERRCODE='23514';
  END IF;
  IF target_monthly_rent IS NULL OR target_monthly_rent<=0
     OR target_monthly_rent<>round(target_monthly_rent,2)
     OR target_start IS NULL OR NOT isfinite(target_start)
     OR (target_end IS NOT NULL AND (NOT isfinite(target_end) OR target_end<target_start))
     OR target_property IS NULL OR target_tenant IS NULL
  THEN RAISE EXCEPTION 'Invalid rent, dates or required references' USING ERRCODE='23514';
  END IF;
  SELECT * INTO before_row FROM public.leases
    WHERE id=target_lease AND organization_id=target_org FOR UPDATE;
  IF NOT FOUND OR before_row.status<>'DRAFT' THEN
    RAISE EXCEPTION 'Only unactivated drafts may be corrected' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.rent_payments WHERE organization_id=target_org AND lease_id=target_lease)
    OR EXISTS(SELECT 1 FROM public.owner_statements WHERE organization_id=target_org AND lease_id=target_lease)
  THEN RAISE EXCEPTION 'A lease with financial records cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.organization_id=target_org AND d.entity_id=target_lease
      AND d.entity_type='GENERAL' AND d.document_type='CONTRACT'
  ) AND (
    before_row.property_id IS DISTINCT FROM target_property
    OR before_row.tenant_id IS DISTINCT FROM target_tenant
    OR before_row.owner_id IS DISTINCT FROM target_owner
    OR before_row.monthly_rent IS DISTINCT FROM target_monthly_rent
    OR before_row.start_date IS DISTINCT FROM target_start
    OR before_row.end_date IS DISTINCT FROM target_end
    OR before_row.contract_number IS DISTINCT FROM nullif(btrim(target_contract_number),'')
  ) THEN
    RAISE EXCEPTION 'The draft already has a signed contract. Review/cancel it; do not rewrite signed terms'
      USING ERRCODE='23514';
  END IF;
  SELECT status,operation_type INTO prop_status,prop_operation
  FROM public.properties WHERE organization_id=target_org AND id=target_property FOR UPDATE;
  IF NOT FOUND OR prop_operation NOT IN ('RENT','SALE_OR_RENT')
     OR prop_status NOT IN ('AVAILABLE','RESERVED','NEGOTIATION','DRAFT') THEN
    RAISE EXCEPTION 'The selected property is not eligible for a new rental'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contacts c
                WHERE c.id=target_tenant AND c.organization_id=target_org) THEN
    RAISE EXCEPTION 'Tenant belongs to another organization or does not exist'
      USING ERRCODE='23514';
  END IF;
  IF target_owner IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.property_owners o
    JOIN public.property_ownerships own ON own.owner_id=o.id
    WHERE o.organization_id=target_org AND o.id=target_owner
      AND own.property_id=target_property AND o.agency_status='ACTIVE'
  ) THEN RAISE EXCEPTION 'Owner must be actively associated with this property'
    USING ERRCODE='23514';
  END IF;
  UPDATE public.leases SET
    property_id=target_property,tenant_id=target_tenant,owner_id=target_owner,
    monthly_rent=target_monthly_rent,start_date=target_start,end_date=target_end,
    contract_number=nullif(btrim(target_contract_number),''),
    updated_at=now()
  WHERE id=target_lease AND organization_id=target_org AND status='DRAFT';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'The draft changed during correction' USING ERRCODE='40001'; END IF;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'lease.draft_corrected','lease',target_lease,
    jsonb_build_object('reason',btrim(reason),
     'before',jsonb_build_object('property_id',before_row.property_id,'tenant_id',before_row.tenant_id,
       'owner_id',before_row.owner_id,'monthly_rent',before_row.monthly_rent,
       'start_date',before_row.start_date,'end_date',before_row.end_date,'contract_number',before_row.contract_number),
     'after',jsonb_build_object('property_id',target_property,'tenant_id',target_tenant,
       'owner_id',target_owner,'monthly_rent',target_monthly_rent,
       'start_date',target_start,'end_date',target_end,'contract_number',nullif(btrim(target_contract_number),''))));
  RETURN target_lease;
END $rpc$;
REVOKE ALL ON FUNCTION public.admin_correct_lease_draft(uuid,uuid,uuid,uuid,uuid,numeric,date,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_lease_draft(uuid,uuid,uuid,uuid,uuid,numeric,date,date,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_lease_draft(
  target_org uuid,target_lease uuid,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $rpc$
DECLARE before_row public.leases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.is_rental_lifecycle_admin(target_org) OR
     NOT public.has_org_permission(target_org,'leases.edit') THEN
    RAISE EXCEPTION 'Administrative authorization required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(reason,'')))<12 OR length(btrim(reason))>500 THEN
    RAISE EXCEPTION 'Cancellation reason must have 12-500 characters' USING ERRCODE='23514';
  END IF;
  SELECT * INTO before_row FROM public.leases
    WHERE id=target_lease AND organization_id=target_org FOR UPDATE;
  IF NOT FOUND OR before_row.status<>'DRAFT' THEN
    RAISE EXCEPTION 'Only drafts can be cancelled; active leases must use administrative closure'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.rent_payments WHERE organization_id=target_org AND lease_id=target_lease)
     OR EXISTS(SELECT 1 FROM public.owner_statements WHERE organization_id=target_org AND lease_id=target_lease)
  THEN RAISE EXCEPTION 'This contract has financial history and cannot be cancelled as a draft'
      USING ERRCODE='23514';
  END IF;
  UPDATE public.leases SET status='CANCELLED',updated_at=now()
    WHERE id=target_lease AND organization_id=target_org AND status='DRAFT';
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'lease.draft_cancelled','lease',target_lease,
    jsonb_build_object('reason',btrim(reason),'property_id',before_row.property_id,
      'contract_number',before_row.contract_number,
      'signed_documents_preserved',true,'financial_data_deleted',false));
  RETURN target_lease;
END $rpc$;
REVOKE ALL ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) TO authenticated;

COMMIT;
