-- Rectify the clerical fields of an ACTIVE lease without replacing its signed
-- document, altering collected funds, or bypassing role/tenant authorization.
-- A private, transaction-scoped permit prevents direct client UPDATE of
-- contractual amounts through the generic Data API.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS jco_private.active_lease_correction_permits(
  organization_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  transaction_id bigint NOT NULL,
  actor_user_id uuid NOT NULL,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  PRIMARY KEY(organization_id,lease_id,transaction_id)
);
ALTER TABLE jco_private.active_lease_correction_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE jco_private.active_lease_correction_permits FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION jco_private.guard_active_lease_signed_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $guard$
DECLARE old_values jsonb; new_values jsonb;
BEGIN
  IF TG_OP<>'UPDATE' THEN RETURN NEW; END IF;
  IF OLD.status='DRAFT' AND NEW.status IN ('ACTIVE','RENEWAL') THEN
    IF ROW(NEW.monthly_rent,NEW.start_date,NEW.end_date,NEW.contract_number,
           NEW.tenant_id,NEW.owner_id,NEW.property_id)
       IS DISTINCT FROM
       ROW(OLD.monthly_rent,OLD.start_date,OLD.end_date,OLD.contract_number,
           OLD.tenant_id,OLD.owner_id,OLD.property_id) THEN
      RAISE EXCEPTION 'Activate a signed draft without rewriting its terms'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status NOT IN ('ACTIVE','RENEWAL') THEN RETURN NEW; END IF;
  -- A termination/cancellation cannot rewrite previously signed terms.
  IF NEW.status NOT IN ('ACTIVE','RENEWAL') AND
     ROW(NEW.monthly_rent,NEW.end_date,NEW.contract_number,NEW.tenant_id,NEW.owner_id,
         NEW.property_id,NEW.start_date,NEW.payment_day,NEW.adjustment_type,NEW.adjustment_percentage)
     IS DISTINCT FROM
     ROW(OLD.monthly_rent,OLD.end_date,OLD.contract_number,OLD.tenant_id,OLD.owner_id,
         OLD.property_id,OLD.start_date,OLD.payment_day,OLD.adjustment_type,OLD.adjustment_percentage) THEN
    RAISE EXCEPTION 'Terminating a lease must not rewrite signed terms'
      USING ERRCODE='23514';
  END IF;

  IF ROW(NEW.tenant_id,NEW.owner_id,NEW.property_id,NEW.start_date,
         NEW.payment_day,NEW.adjustment_type,NEW.adjustment_percentage)
     IS DISTINCT FROM
     ROW(OLD.tenant_id,OLD.owner_id,OLD.property_id,OLD.start_date,
         OLD.payment_day,OLD.adjustment_type,OLD.adjustment_percentage) THEN
    RAISE EXCEPTION 'An active signed contract cannot change its parties, apartment, start or billing rules'
      USING ERRCODE='23514';
  END IF;

  IF ROW(NEW.monthly_rent,NEW.end_date,NEW.contract_number)
     IS NOT DISTINCT FROM ROW(OLD.monthly_rent,OLD.end_date,OLD.contract_number)
     THEN RETURN NEW;
  END IF;

  old_values:=jsonb_build_object('monthly_rent',OLD.monthly_rent,'end_date',OLD.end_date,
    'contract_number',OLD.contract_number);
  new_values:=jsonb_build_object('monthly_rent',NEW.monthly_rent,'end_date',NEW.end_date,
    'contract_number',NEW.contract_number);
  IF NOT EXISTS(
    SELECT 1 FROM jco_private.active_lease_correction_permits permit
     WHERE permit.organization_id=OLD.organization_id AND permit.lease_id=OLD.id
       AND permit.transaction_id=txid_current()
       AND permit.actor_user_id=auth.uid()
       AND permit.old_values=old_values AND permit.new_values=new_values
  ) THEN
    RAISE EXCEPTION 'An active contract requires administrator correction with signed evidence and audit'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION jco_private.guard_active_lease_signed_terms() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jco_active_lease_terms_guard ON public.leases;
CREATE TRIGGER jco_active_lease_terms_guard
 BEFORE UPDATE OF status,monthly_rent,start_date,end_date,contract_number,
  owner_id,tenant_id,property_id,payment_day,adjustment_type,adjustment_percentage
 ON public.leases FOR EACH ROW
 EXECUTE FUNCTION jco_private.guard_active_lease_signed_terms();

CREATE OR REPLACE FUNCTION public.admin_rectify_active_lease(
 target_org uuid,target_lease uuid,corrected_rent numeric,
 corrected_end_date date,corrected_contract_number text,
 supporting_signed_document uuid,correction_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $rpc$
DECLARE lease_row public.leases%ROWTYPE;
  approved_document public.documents%ROWTYPE;
  old_values jsonb; new_values jsonb; contract_number_clean text;
  n integer;
BEGIN
 IF auth.uid() IS NULL
   OR NOT public.is_rental_lifecycle_admin(target_org)
   OR NOT public.has_org_permission(target_org,'leases.edit')
   OR NOT public.has_org_permission(target_org,'documents.view') THEN
   RAISE EXCEPTION 'Only the authorized administrator may rectify an active contract'
     USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(correction_reason,''))) NOT BETWEEN 15 AND 500
    OR corrected_rent IS NULL OR corrected_rent<=0
    OR corrected_rent>999999999999.99 OR corrected_rent<>round(corrected_rent,2)
    OR supporting_signed_document IS NULL THEN
    RAISE EXCEPTION 'Provide signed evidence, positive rent and a 15-500 character reason'
      USING ERRCODE='23514';
 END IF;
 contract_number_clean:=nullif(btrim(coalesce(corrected_contract_number,'')),'');
 IF length(coalesce(contract_number_clean,''))>100 THEN
    RAISE EXCEPTION 'Contract number exceeds 100 characters' USING ERRCODE='23514'; END IF;

 SELECT * INTO lease_row FROM public.leases
  WHERE organization_id=target_org AND id=target_lease FOR UPDATE;
 IF NOT FOUND OR lease_row.status NOT IN ('ACTIVE','RENEWAL') THEN
   RAISE EXCEPTION 'Only active contracts may be rectified here; use draft editor otherwise'
     USING ERRCODE='23514';
 END IF;
 IF corrected_end_date IS NOT NULL AND
    (NOT isfinite(corrected_end_date) OR corrected_end_date<lease_row.start_date) THEN
   RAISE EXCEPTION 'Contract end cannot precede its start'
     USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.leases other
           WHERE other.organization_id=target_org AND other.id<>target_lease
             AND other.contract_number=contract_number_clean
             AND contract_number_clean IS NOT NULL) THEN
   RAISE EXCEPTION 'A different contract already uses this number' USING ERRCODE='23505';
 END IF;

 SELECT * INTO approved_document FROM public.documents doc
  WHERE doc.id=supporting_signed_document AND doc.organization_id=target_org
    AND doc.entity_id=target_lease AND doc.entity_type='GENERAL'
    AND doc.document_type='CONTRACT' AND doc.storage_bucket='organization-documents'
    AND doc.mime_type='application/pdf'
    AND doc.storage_path LIKE
      target_org::text||'/leases/'||target_lease::text||'/signed/%.pdf';
 IF NOT FOUND OR NOT EXISTS(
   SELECT 1 FROM storage.objects file
   WHERE file.bucket_id=approved_document.storage_bucket
     AND file.name=approved_document.storage_path
 ) THEN
   RAISE EXCEPTION 'The supporting signed PDF is missing or belongs to another contract'
     USING ERRCODE='23514';
 END IF;

 IF EXISTS(SELECT 1 FROM public.rent_receipts receipt
           JOIN public.rent_payments pay ON pay.id=receipt.rent_payment_id
             AND pay.organization_id=target_org
           WHERE pay.lease_id=target_lease)
 OR EXISTS(SELECT 1 FROM public.rent_payments pay
           WHERE pay.organization_id=target_org AND pay.lease_id=target_lease
             AND (pay.paid_amount<>0 OR pay.status NOT IN ('PENDING','LATE')))
 OR EXISTS(SELECT 1 FROM public.owner_statements statement
           WHERE statement.organization_id=target_org AND statement.lease_id=target_lease)
 THEN
   RAISE EXCEPTION 'Collected/settled contracts cannot be rewritten. Request a financial correction or a signed addendum'
     USING ERRCODE='23514';
 END IF;
 IF EXISTS(
    SELECT 1 FROM public.rent_payments pay
    WHERE pay.organization_id=target_org AND pay.lease_id=target_lease
      AND (
        (corrected_end_date IS NOT NULL AND pay.period_month>
          date_trunc('month',corrected_end_date)::date)
        OR pay.expected_amount IS DISTINCT FROM COALESCE(
            (SELECT a.new_monthly_rent FROM public.lease_rent_amendments a
              WHERE a.organization_id=target_org AND a.lease_id=target_lease
                AND a.effective_month<=pay.period_month
              ORDER BY a.effective_month DESC LIMIT 1),
             corrected_rent)
      )
 ) THEN
   RAISE EXCEPTION 'Existing unpaid periods do not match the proposed terms. Correct those periods with their own audited procedure first'
     USING ERRCODE='23514';
 END IF;

 old_values:=jsonb_build_object('monthly_rent',lease_row.monthly_rent,
   'end_date',lease_row.end_date,'contract_number',lease_row.contract_number);
 new_values:=jsonb_build_object('monthly_rent',corrected_rent,
   'end_date',corrected_end_date,'contract_number',contract_number_clean);
 IF old_values=new_values THEN
   RAISE EXCEPTION 'There are no changes to save' USING ERRCODE='23514'; END IF;

 INSERT INTO jco_private.active_lease_correction_permits(
   organization_id,lease_id,transaction_id,actor_user_id,old_values,new_values
 ) VALUES(target_org,target_lease,txid_current(),auth.uid(),old_values,new_values);
 UPDATE public.leases
 SET monthly_rent=corrected_rent,end_date=corrected_end_date,
     contract_number=contract_number_clean,updated_at=now()
 WHERE organization_id=target_org AND id=target_lease
   AND status IN ('ACTIVE','RENEWAL');
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'The active contract was not updated' USING ERRCODE='40001'; END IF;
 DELETE FROM jco_private.active_lease_correction_permits
  WHERE organization_id=target_org AND lease_id=target_lease
    AND transaction_id=txid_current();

 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target_org,auth.uid(),'lease.active_rectified','LEASE',target_lease,
  jsonb_build_object('reason',btrim(correction_reason),
  'before',old_values,'after',new_values,
  'signed_document_id',supporting_signed_document,
  'signed_document_storage_path',approved_document.storage_path,
  'financial_movements_modified',false));
 RETURN target_lease;
END $rpc$;
REVOKE ALL ON FUNCTION public.admin_rectify_active_lease(uuid,uuid,numeric,date,text,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_rectify_active_lease(uuid,uuid,numeric,date,text,uuid,text)
  TO authenticated;
COMMIT;
