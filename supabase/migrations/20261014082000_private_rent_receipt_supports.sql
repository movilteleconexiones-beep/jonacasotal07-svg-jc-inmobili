-- Private audit-grade support for immutable rent receipt events.
-- The bank transfer / cash record remains a receipt of funds; evidence itself
-- is an uploaded document, not proof of bank settlement or automatic payment.
BEGIN;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('jco-rent-receipts-private','jco-rent-receipts-private',false,10485760,
 ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.rent_receipt_supports (
  receipt_id uuid PRIMARY KEY REFERENCES public.rent_receipts(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  rent_payment_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN
    ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_receipt_supports_payment_org_fk FOREIGN KEY (organization_id,rent_payment_id)
    REFERENCES public.rent_payments(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX rent_receipt_supports_org_payment_idx
  ON public.rent_receipt_supports(organization_id,rent_payment_id,created_at);

ALTER TABLE public.rent_receipt_supports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rent_receipt_supports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rent_receipt_supports TO authenticated;
CREATE POLICY rent_receipt_supports_read ON public.rent_receipt_supports
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'rent_payments.view'));

-- All keys are server-derived in the UI:
--   <org_uuid>/<payment_uuid>/<actor_uuid>/<idempotency_uuid>/comprobante.<extension>
-- A user cannot upload to another user's folder or another agency's receipts.
CREATE POLICY jco_rent_supports_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='jco-rent-receipts-private'
    AND auth.uid() IS NOT NULL
    AND name=concat_ws('/',
      split_part(name,'/',1),split_part(name,'/',2),
      auth.uid()::text,split_part(name,'/',4),split_part(name,'/',5))
    AND split_part(name,'/',6)=''
    AND split_part(name,'/',1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name,'/',2) ~* '^[0-9a-f-]{36}$'
    AND split_part(name,'/',4) ~* '^[0-9a-f-]{36}$'
    AND split_part(name,'/',5) IN ('comprobante.jpg','comprobante.png','comprobante.webp','comprobante.pdf')
    AND EXISTS (
      SELECT 1 FROM public.rent_payments rp
      WHERE rp.organization_id::text=split_part(name,'/',1)
        AND rp.id::text=split_part(name,'/',2)
        AND rp.status<>'CANCELLED'
        AND public.has_org_permission(rp.organization_id,'rent_payments.create')
    )
  );

CREATE POLICY jco_rent_supports_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id='jco-rent-receipts-private'
    AND EXISTS (
      SELECT 1 FROM public.rent_payments rp
      WHERE rp.organization_id::text=split_part(name,'/',1)
        AND rp.id::text=split_part(name,'/',2)
        AND (public.has_org_permission(rp.organization_id,'rent_payments.view')
          OR (auth.uid()::text=split_part(name,'/',3) AND
            public.has_org_permission(rp.organization_id,'rent_payments.create')))
    )
  );

-- Only the actor who uploaded the unlinked support can remove it.
-- A committed receipt support must stay immutable and cannot be destroyed
-- by editing or deleting a document from the UI.
CREATE POLICY jco_rent_supports_storage_unlinked_cleanup ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id='jco-rent-receipts-private'
    AND auth.uid()::text=split_part(name,'/',3)
    AND EXISTS (
      SELECT 1 FROM public.rent_payments rp
      WHERE rp.organization_id::text=split_part(name,'/',1)
        AND rp.id::text=split_part(name,'/',2)
        AND public.has_org_permission(rp.organization_id,'rent_payments.create')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.rent_receipt_supports rs WHERE rs.storage_path=name
    )
  );

CREATE OR REPLACE FUNCTION public.record_tenant_rent_receipt_with_evidence(
  target_org uuid,target_payment uuid,receipt_amount numeric,receipt_method text,
  receipt_reference text,request_key uuid,evidence_path text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  actor uuid:=auth.uid();
  support_file record;
  required_prefix text;
  filename text;
  expected_mime text;
  receipt_id uuid;
  prior public.rent_receipt_supports%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_org_permission(target_org,'rent_payments.create') THEN
    RAISE EXCEPTION 'Not authorized to record a rent receipt' USING ERRCODE='42501';
  END IF;
  IF evidence_path IS NULL OR request_key IS NULL THEN
    RAISE EXCEPTION 'Evidence and request key are required' USING ERRCODE='22023';
  END IF;
  required_prefix:=target_org::text||'/'||target_payment::text||'/'||
    actor::text||'/'||request_key::text||'/';
  IF left(evidence_path,length(required_prefix))<>required_prefix THEN
    RAISE EXCEPTION 'Evidence does not belong to this actor and payment' USING ERRCODE='42501';
  END IF;
  filename:=substr(evidence_path,length(required_prefix)+1);
  expected_mime:=CASE filename
    WHEN 'comprobante.jpg' THEN 'image/jpeg'
    WHEN 'comprobante.png' THEN 'image/png'
    WHEN 'comprobante.webp' THEN 'image/webp'
    WHEN 'comprobante.pdf' THEN 'application/pdf'
    ELSE NULL
  END;
  IF expected_mime IS NULL THEN
    RAISE EXCEPTION 'Unsupported evidence file format' USING ERRCODE='22023';
  END IF;

  SELECT o.metadata->>'mimetype' AS mime_type,
    nullif(o.metadata->>'size','')::bigint AS size_bytes
    INTO support_file
    FROM storage.objects o
    WHERE o.bucket_id='jco-rent-receipts-private'
      AND o.name=evidence_path;
  IF NOT FOUND OR support_file.mime_type IS DISTINCT FROM expected_mime OR
    support_file.size_bytes IS NULL OR support_file.size_bytes NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'Missing, invalid or oversized private evidence' USING ERRCODE='23514';
  END IF;

  -- Calls the existing atomic and idempotent ledger. If evidence linking
  -- fails, the entire transaction (including the payment) is rolled back.
  receipt_id:=public.record_tenant_rent_receipt(target_org,target_payment,
    receipt_amount,receipt_method,receipt_reference,request_key);

  SELECT * INTO prior FROM public.rent_receipt_supports
    WHERE public.rent_receipt_supports.receipt_id=receipt_id FOR UPDATE;
  IF FOUND THEN
    IF prior.organization_id<>target_org OR prior.rent_payment_id<>target_payment OR
       prior.storage_path<>evidence_path OR prior.uploaded_by<>actor THEN
      RAISE EXCEPTION 'Idempotency key belongs to a different proof'
        USING ERRCODE='23505';
    END IF;
    RETURN receipt_id;
  END IF;

  -- Do not retrofit proof to an old receipt after its original operation.
  IF NOT EXISTS (
    SELECT 1 FROM public.rent_receipts rr WHERE rr.id=receipt_id
      AND rr.organization_id=target_org AND rr.rent_payment_id=target_payment
      AND rr.created_by=actor AND rr.created_at >= now()-interval '15 minutes'
  ) THEN
    RAISE EXCEPTION 'Evidence must be attached when the receipt is recorded'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.rent_receipt_supports
    (receipt_id,organization_id,rent_payment_id,storage_path,mime_type,size_bytes,uploaded_by)
  VALUES (receipt_id,target_org,target_payment,evidence_path,
    expected_mime,support_file.size_bytes,actor);
  RETURN receipt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_tenant_rent_receipt_with_evidence(
  uuid,uuid,numeric,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_rent_receipt_with_evidence(
  uuid,uuid,numeric,text,text,uuid,text) TO authenticated;
COMMENT ON TABLE public.rent_receipt_supports IS
  'Immutable private evidence of rent receipt events. No bank settlement is inferred.';
COMMIT;
