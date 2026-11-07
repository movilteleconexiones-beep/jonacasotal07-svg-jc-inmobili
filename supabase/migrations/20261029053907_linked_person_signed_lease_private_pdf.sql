-- Personal signed-lease PDF visibility for external tenant/owner accounts.
-- Read-only. The private Storage bucket continues to enforce storage.objects RLS.
-- A GENERAL/CONTRACT document must be tied to an existing ACTIVE/TERMINATED lease,
-- and its immutable object key must match the exact organization and lease UUID.
-- No changes to existing staff privileges, write permissions, or payment records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='documents' AND policyname='jco_commercial_portal_read_guard'
    AND permissive='RESTRICTIVE' AND cmd='SELECT'
 ) THEN
  RAISE EXCEPTION 'Portal document restrictive read guard missing';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='portal_docs_storage_select' AND cmd='SELECT'
 ) THEN
  RAISE EXCEPTION 'Private storage signed-URL access guard missing';
 END IF;
END $preflight$;

DO $policy$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM pg_policies WHERE schemaname='public'
     AND tablename='documents' AND policyname='documents_signed_lease_external_select'
 ) THEN
   CREATE POLICY documents_signed_lease_external_select ON public.documents
     FOR SELECT TO authenticated
     USING (
       document_type='CONTRACT'
       AND entity_type='GENERAL'
       AND entity_id IS NOT NULL
       AND storage_bucket='organization-documents'
       AND left(storage_path,length(organization_id::text||'/leases/'||entity_id::text||'/signed/'))
             = organization_id::text||'/leases/'||entity_id::text||'/signed/'
       AND substring(storage_path FROM length(organization_id::text||'/leases/'||entity_id::text||'/signed/')+1)
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
       AND EXISTS (
         SELECT 1 FROM public.leases le
         WHERE le.id=documents.entity_id
           AND le.organization_id=documents.organization_id
           AND le.status IN ('ACTIVE','TERMINATED')
           AND EXISTS (
             SELECT 1 FROM public.portal_access_links l
             WHERE l.organization_id=documents.organization_id
               AND l.user_id=(SELECT auth.uid())
               AND (l.contact_id=le.tenant_id OR l.owner_id=le.owner_id)
           )
       )
     );
 ELSE
   RAISE EXCEPTION 'Policy already exists; review existing definition before rerunning';
 END IF;
END $policy$;
COMMIT;
